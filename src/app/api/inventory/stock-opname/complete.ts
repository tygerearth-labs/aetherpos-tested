import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLog } from '@/lib/safe-audit'
import { invalidateOutletExpiry } from '@/lib/cache'

/**
 * POST /api/inventory/stock-opname/complete
 * 
 * COMPLETES a stock opname session.
 * 
 * CRITICAL: Delta is calculated from SNAPSHOT, not live stock!
 * 
 * Algorithm:
 *   1. Receive snapshots from Dexie (client)
 *   2. Re-fetch CURRENT server stock (may have changed during counting!)
 *   3. Calculate: delta = physicalQty - systemQty (snapshot)
 *   4. Apply: newStock = currentStock + delta
 *   5. Create InventoryMovement(type: "STOCK_OPNAME")
 *   6. Update InventoryBatch if batch-level counting was done
 *
 * This ensures transactions during counting are NOT lost or overwritten!
 */

export const maxDuration = 120 // 2 minutes for large datasets

// Types matching client-side StockOpnameSnapshot
interface OpnameSnapshotItem {
  inventoryItemId: string
  batchId: string | null
  itemName: string
  itemSku: string | null
  itemUnit: string
  batchNumber: string | null
  systemQty: number        // Frozen at snapshot time
  physicalQty: number | null // User's count (null = not counted)
  notes: string | null
}

interface CompleteOpnameRequest {
  snapshots: OpnameSnapshotItem[]
  notes?: string
  startedAt: string       // ISO 8601 - when opname was started
  opnameId?: string       // AUDIT-2-006: client-generated idempotency key (UUID)
}

interface AdjustmentResult {
  inventoryItemId: string
  itemName: string
  batchId: string | null
  batchNumber: string | null
  
  // Snapshot values
  systemQty: number       // What system had at snapshot time
  physicalQty: number     // What user counted
  
  // Server values (current, may differ from snapshot)
  currentStock: number    // What server has NOW
  
  // Calculations
  delta: number           // = physicalQty - systemQty
  adjustedStock: number   // = currentStock + delta
  varianceValue: number   // = delta × avgCost (for reporting)
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    // CREW-003 FIX: Only OWNER can complete stock opname (financial-impact variance)
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya OWNER yang dapat melakukan aksi ini', 403)
    }

    const outletId = user.outletId
    const userId = user.id

    // Parse request
    let body: CompleteOpnameRequest
    try {
      body = await request.json()
    } catch {
      return safeJsonError('Request body tidak valid', 400)
    }

    const { snapshots, notes: opnameNotes, startedAt, opnameId } = body

    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      return safeJsonError('Data snapshot tidak valid', 400)
    }

    // AUDIT-2-006 FIX: Idempotency — if the client sends an opnameId, check
    // whether this opname was already completed. Without this, a network
    // failure between server-commit and client-receive causes the client to
    // retry → stock adjusted twice. Verified by audit: same payload submitted
    // twice → stock 45→50 (delta +5 applied twice).
    // Uses the same auditLog-as-idempotency-store pattern as /api/transactions/sync.
    if (opnameId) {
      const existing = await db.auditLog.findFirst({
        where: { outletId, action: 'STOCK_OPNAME_DEDUP', entityId: opnameId },
      })
      if (existing) {
        try {
          const parsed = JSON.parse(existing.details || '{}')
          console.log(`[StockOpname] AUDIT-2-006: Duplicate opnameId ${opnameId} ignored`)
          return safeJson({
            success: true,
            message: 'Stock opname sudah pernah diselesaikan (duplicate diabaikan)',
            summary: parsed.summary,
            duplicate: true,
          })
        } catch {
          return safeJson({ success: true, message: 'Stock opname sudah pernah diselesaikan', duplicate: true })
        }
      }
    }

    console.log(`[StockOpname] Starting completion: ${snapshots.length} items`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 1: PARALLEL PRE-LOAD
    // Get current server state for ALL items in snapshot
    // ══════════════════════════════════════════════════════════════════
    
    const inventoryItemIds = [...new Set(snapshots.map(s => s.inventoryItemId))]
    
    const [currentItems, currentBatches] = await Promise.all([
      // Current inventory items (MAY have changed since snapshot!)
      db.inventoryItem.findMany({
        where: { 
          id: { in: inventoryItemIds },
          outletId,
        },
        select: { id: true, name: true, stock: true, avgCost: true },
      }),
      
      // Current batches for these items
      // M2A-001 FIX: Include expiredDate + createdAt for FEFO sorting when
      // distributing item-level deltas across batches.
      db.inventoryBatch.findMany({
        where: { 
          inventoryItemId: { in: inventoryItemIds },
          outletId,
          status: 'AVAILABLE',
        },
        select: { id: true, batchNumber: true, inventoryItemId: true, remainingQty: true, unitCost: true, expiredDate: true, createdAt: true },
      }),
    ])

    // Build lookup maps
    const currentItemMap = new Map(currentItems.map(item => [item.id, item]))
    const currentBatchMap = new Map(currentBatches.map(b => [b.id, b]))

    console.log(`[StockOpname] Pre-loaded ${currentItems.length} items, ${currentBatches.length} batches`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 2: CALCULATE ADJUSTMENTS
    //
    // AUDIT-2-004 FIX: Group snapshots by inventoryItemId and compute ONE
    // aggregate delta per item. Previously, for an item with N batches the
    // client submitted N snapshots, and the server applied `currentStock + delta`
    // for EACH snapshot (using the SAME stale currentStock read at PHASE 1).
    // The last update won → stock = stale + last_delta, but sum(batches) =
    // original + sum(all_deltas). DRIFT = sum(all_deltas except last).
    // Verified by audit: 2 batches, count A 60→55 (Δ-5), B 40→38 (Δ-2).
    // Final stock=98, sum(batches)=93. DRIFT=5.
    //
    // AUDIT-2-005 FIX: Anti-fraud — the server no longer trusts the client's
    // `systemQty` blindly. If the client claims systemQty=0 but the server's
    // current stock > 0, the server uses its OWN current stock as the baseline
    // (a client claiming 0 system stock to inflate via a large physicalQty is
    // the documented fraud vector). Verified by audit: malicious payload
    // systemQty=0, physicalQty=200 → stock 100→300.
    //
    // Algorithm (per item, aggregated):
    //   1. Collect all snapshots for this item (item-level + batch-level)
    //   2. If ANY batch-level snapshot exists, aggregate batch deltas →
    //      itemDelta = sum(batch deltas). Item-level snapshot (if also present)
    //      is IGNORED for stock computation (batch-level is more precise) but
    //      is still used for the movement record.
    //   3. If ONLY item-level snapshot exists, itemDelta = physicalQty - systemQty.
    //   4. adjustedStock = max(0, currentStock + itemDelta)
    // ══════════════════════════════════════════════════════════════════

    // Group snapshots by inventoryItemId
    const snapshotsByItem = new Map<string, OpnameSnapshotItem[]>()
    for (const snap of snapshots) {
      if (snap.physicalQty === null || snap.physicalQty === undefined) continue
      const arr = snapshotsByItem.get(snap.inventoryItemId) || []
      arr.push(snap)
      snapshotsByItem.set(snap.inventoryItemId, arr)
    }

    const adjustments: AdjustmentResult[] = []
    const batchAdjustments: Array<{
      batchId: string
      batchNumber: string
      delta: number
      newRemainingQty: number
    }> = []

    let totalVarianceValue = 0
    let varianceCount = 0

    for (const [itemId, itemSnaps] of snapshotsByItem) {
      const currentItem = currentItemMap.get(itemId)
      if (!currentItem) {
        console.warn(`[StockOpname] Item ${itemId} not found on server`)
        continue
      }

      const currentStock = currentItem.stock
      const batchSnaps = itemSnaps.filter(s => s.batchId && currentBatchMap.has(s.batchId))
      const itemSnapsOnly = itemSnaps.filter(s => !s.batchId)

      // AUDIT-2-005: Determine the systemQty baseline. If the client claims 0
      // but the server has stock, use the server's current stock (anti-fraud).
      // Otherwise trust the client's snapshot (preserves concurrent-tx design).
      const resolveSystemQty = (clientSystemQty: number): number => {
        if (clientSystemQty <= 0 && currentStock > 0) {
          console.warn(
            `[StockOpname] AUDIT-2-005: Item "${currentItem.name}" client systemQty=${clientSystemQty} ` +
            `but server stock=${currentStock}. Using server stock as baseline (anti-fraud).`
          )
          return currentStock
        }
        return clientSystemQty
      }

      let itemDelta: number
      let systemQtyForRecord: number
      let physicalQtyForRecord: number

      if (batchSnaps.length > 0) {
        // Batch-level counting — aggregate batch deltas.
        let batchDeltaSum = 0
        physicalQtyForRecord = 0
        systemQtyForRecord = 0
        for (const bs of batchSnaps) {
          const batch = currentBatchMap.get(bs.batchId!)!
          const bSys = resolveSystemQty(bs.systemQty)
          const bDelta = bs.physicalQty - bSys
          const newRemainingQty = Math.max(0, batch.remainingQty + bDelta)
          batchAdjustments.push({
            batchId: bs.batchId!,
            batchNumber: bs.batchNumber || batch.batchNumber,
            delta: bDelta,
            newRemainingQty,
          })
          batchDeltaSum += bDelta
          physicalQtyForRecord += bs.physicalQty
          systemQtyForRecord += bSys
        }
        itemDelta = batchDeltaSum
      } else {
        // Item-level only
        const snap = itemSnapsOnly[0]
        systemQtyForRecord = resolveSystemQty(snap.systemQty)
        physicalQtyForRecord = snap.physicalQty
        itemDelta = snap.physicalQty - systemQtyForRecord

        // M2A-001 FIX: If this item has AVAILABLE batches, distribute the delta
        // across batches to maintain the invariant: stock == sum(AVAILABLE batches).
        // Without this, item-level opname on batch-tracked items updates stock but
        // not batches → drift.
        const itemBatches = currentBatches
          .filter(b => b.inventoryItemId === itemId && b.remainingQty > 0)
          .sort((a, b) => {
            // FEFO order: expiredDate ASC (null last), then createdAt ASC
            const aHasExp = a.expiredDate ? 0 : 1
            const bHasExp = b.expiredDate ? 0 : 1
            if (aHasExp !== bHasExp) return aHasExp - bHasExp
            if (a.expiredDate && b.expiredDate) {
              return new Date(a.expiredDate).getTime() - new Date(b.expiredDate).getTime()
            }
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          })

        if (itemBatches.length > 0 && itemDelta !== 0) {
          if (itemDelta < 0) {
            // Negative delta: consume from batches via FEFO (same as a sale)
            let remainingToConsume = Math.abs(itemDelta)
            for (const batch of itemBatches) {
              if (remainingToConsume <= 0) break
              const consume = Math.min(remainingToConsume, batch.remainingQty)
              batchAdjustments.push({
                batchId: batch.id,
                batchNumber: batch.batchNumber,
                delta: -consume,
                newRemainingQty: batch.remainingQty - consume,
              })
              remainingToConsume -= consume
            }
            // If batches were insufficient (remainingToConsume > 0), the extra
            // negative delta is applied to stock only (batch tracking gap logged).
            if (remainingToConsume > 0) {
              console.warn(
                `[StockOpname] M2A-001: Item "${currentItem.name}" negative delta ${itemDelta} ` +
                `exceeds available batch qty by ${remainingToConsume}. Stock adjusted, batch gap untracked.`
              )
            }
          } else {
            // Positive delta: add to the oldest AVAILABLE batch (FEFO first)
            const oldestBatch = itemBatches[0]
            batchAdjustments.push({
              batchId: oldestBatch.id,
              batchNumber: oldestBatch.batchNumber,
              delta: itemDelta,
              newRemainingQty: oldestBatch.remainingQty + itemDelta,
            })
          }
        }
      }

      if (itemDelta === 0) continue

      const adjustedStock = Math.max(0, currentStock + itemDelta)
      const varianceValue = Math.abs(itemDelta) * currentItem.avgCost

      adjustments.push({
        inventoryItemId: itemId,
        itemName: currentItem.name,
        batchId: batchSnaps.length > 0 ? batchSnaps[0].batchId : null,
        batchNumber: batchSnaps.length > 0 ? batchSnaps[0].batchNumber : null,
        systemQty: systemQtyForRecord,
        physicalQty: physicalQtyForRecord,
        currentStock,
        delta: itemDelta,
        adjustedStock,
        varianceValue,
      })
      totalVarianceValue += varianceValue
      varianceCount++
    }

    console.log(`[StockOpname] Calculated ${adjustments.length} adjustments, ${batchAdjustments.length} batch updates`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 3: APPLY ADJUSTMENTS IN A SINGLE TRANSACTION
    //
    // AUDIT-2-009 FIX: Previously adjustments were split into chunks of 50,
    // each in its own $transaction. Batch updates were ALL processed in chunk 0.
    // If chunk 2 failed, chunk 0 (with ALL batch updates) was already committed
    // → items 100-149 had batch updates but no item.stock update → DRIFT.
    // Now ALL adjustments + batch updates run in ONE transaction. SQLite handles
    // thousands of writes in a single tx efficiently. If any step fails, the
    // entire opname rolls back (atomicity guaranteed).
    // ══════════════════════════════════════════════════════════════════

    let movementsCreated = 0
    let batchesUpdated = 0

    await db.$transaction(async (tx) => {
      // Process each item adjustment (ONE per item now — aggregated in PHASE 2)
      for (const adj of adjustments) {
        // 1. Create InventoryMovement (PERMANENT RECORD)
        await tx.inventoryMovement.create({
          data: {
            type: 'STOCK_OPNAME',
            quantity: adj.delta,                    // Can be positive or negative
            previousStock: adj.currentStock,         // What it was BEFORE this adjustment
            newStock: adj.adjustedStock,             // What it is NOW
            referenceType: 'STOCK_OPNAME',
            notes: opnameNotes || `Stock Opname: ${adj.systemQty} → ${adj.physicalQty}`,
            outletId,
            inventoryItemId: adj.inventoryItemId,
            userId,
          },
        })

        // 2. Update InventoryItem.stock (ONCE per item — no more last-write-wins drift)
        await tx.inventoryItem.update({
          where: { id: adj.inventoryItemId },
          data: { stock: adj.adjustedStock },
        })

        movementsCreated++
      }

      // Process ALL batch adjustments in the SAME transaction
      // M2A-001 FIX: Also update status when batch is fully consumed (remainingQty=0 → CONSUMED)
      for (const ba of batchAdjustments) {
        const newStatus = ba.newRemainingQty <= 0 ? 'CONSUMED' : 'AVAILABLE'
        await tx.inventoryBatch.update({
          where: { id: ba.batchId },
          data: { 
            remainingQty: ba.newRemainingQty,
            status: newStatus,
            updatedAt: new Date(),
          },
        })
        batchesUpdated++
      }

      // AUDIT-2-006 FIX: Write the idempotency marker INSIDE the transaction
      // so it commits atomically with the adjustments. If this opnameId was
      // already processed, the unique index (auditlog_sync_dedup... pattern)
      // would reject — but since STOCK_OPNAME_DEDUP uses a separate action
      // value, we rely on the pre-check at the top + this atomic insert.
      if (opnameId) {
        await tx.auditLog.create({
          data: {
            action: 'STOCK_OPNAME_DEDUP',
            entityType: 'STOCK_OPNAME',
            entityId: opnameId,
            details: JSON.stringify({
              summary: {
                totalSnapshots: snapshots.length,
                itemsCounted: snapshots.filter(s => s.physicalQty !== null).length,
                adjustmentsMade: movementsCreated,
                batchUpdates: batchesUpdated,
                varianceItems: varianceCount,
                totalVarianceValue: Math.round(totalVarianceValue * 100) / 100,
              },
              startedAt,
              completedAt: new Date().toISOString(),
            }),
            outletId,
            userId,
          },
        })
      }
    }, {
      timeout: 120000, // 2 minutes for large datasets (matches maxDuration)
    })

    // ══════════════════════════════════════════════════════════════════
    // PHASE 4: AUDIT LOG & RESPONSE
    // ══════════════════════════════════════════════════════════════════

    const totalTime = Date.now() - startTime
    
    // Summary audit log
    await safeAuditLog({
      action: 'STOCK_OPNAME_COMPLETE',
      entityType: 'INVENTORY_MOVEMENT',
      details: JSON.stringify({
        totalItems: snapshots.length,
        itemsCounted: snapshots.filter(s => s.physicalQty !== null).length,
        adjustmentsMade: movementsCreated,
        batchUpdates: batchesUpdated,
        totalVarianceValue,
        varianceItems: varianceCount,
        notes: opnameNotes,
        startedAt,
        completedAt: new Date().toISOString(),
        processingTimeMs: totalTime,
      }),
      outletId,
      userId,
    })

    console.log(`[StockOpname] Completed in ${totalTime}ms:`, {
      snapshotsReceived: snapshots.length,
      adjustmentsMade: movementsCreated,
      batchUpdates: batchesUpdated,
      totalVarianceValue,
    })

    // Stock & batches changed → invalidate cached expiry/freshness/heatmap
    // so dashboard reflects the new state on next read.
    invalidateOutletExpiry(outletId)

    return safeJson({
      success: true,
      message: 'Stock opname berhasil diselesaikan',
      summary: {
        totalSnapshots: snapshots.length,
        itemsCounted: snapshots.filter(s => s.physicalQty !== null).length,
        adjustmentsMade: movementsCreated,
        batchUpdates: batchesUpdated,
        varianceItems: varianceCount,
        totalVarianceValue: Math.round(totalVarianceValue * 100) / 100,
        processingTimeMs: totalTime,
      },
      // Detailed adjustments (for receipt/report)
      adjustments: adjustments.map(adj => ({
        itemName: adj.itemName,
        batchNumber: adj.batchNumber,
        systemQty: adj.systemQty,
        physicalQty: adj.physicalQty,
        currentStock: adj.currentStock,
        delta: adj.delta,
        adjustedStock: adj.adjustedStock,
        varianceValue: Math.round(adj.varianceValue * 100) / 100,
      })),
    })

  } catch (error) {
    console.error('[StockOpname] Error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Gagal menyelesaikan stock opname: ${message}`, 500)
  }
}
