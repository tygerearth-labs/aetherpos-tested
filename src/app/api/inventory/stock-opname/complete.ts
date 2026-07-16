import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLog } from '@/lib/safe-audit'

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
    
    const outletId = user.outletId
    const userId = user.id

    // Parse request
    let body: CompleteOpnameRequest
    try {
      body = await request.json()
    } catch {
      return safeJsonError('Request body tidak valid', 400)
    }

    const { snapshots, notes: opnameNotes, startedAt } = body

    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      return safeJsonError('Data snapshot tidak valid', 400)
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
      db.inventoryBatch.findMany({
        where: { 
          inventoryItemId: { in: inventoryItemIds },
          outletId,
          status: 'AVAILABLE',
        },
        select: { id: true, batchNumber: true, inventoryItemId: true, remainingQty: true, unitCost: true },
      }),
    ])

    // Build lookup maps
    const currentItemMap = new Map(currentItems.map(item => [item.id, item]))
    const currentBatchMap = new Map(currentBatches.map(b => [b.id, b]))

    console.log(`[StockOpname] Pre-loaded ${currentItems.length} items, ${currentBatches.length} batches`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 2: CALCULATE ADJUSTMENTS
    // Apply the DELTA algorithm:
    //   delta = physicalQty - systemQty (from snapshot)
    //   newStock = currentStock + delta
    // ══════════════════════════════════════════════════════════════════

    const adjustments: AdjustmentResult[] = []
    const batchAdjustments: Array<{
      batchId: string
      batchNumber: string
      delta: number
      newRemainingQty: number
    }> = []

    let totalVarianceValue = 0
    let varianceCount = 0

    for (const snap of snapshots) {
      // Skip uncounted items
      if (snap.physicalQty === null || snap.physicalQty === undefined) continue

      const currentItem = currentItemMap.get(snap.inventoryItemId)
      if (!currentItem) {
        console.warn(`[StockOpname] Item ${snap.inventoryItemId} (${snap.itemName}) not found on server`)
        continue
      }

      // Calculate DELTA from snapshot (NOT from current!)
      const delta = snap.physicalQty - snap.systemQty
      
      // If no variance, skip (optional optimization)
      // Comment this out if you want to record ALL counts even without variance
      if (delta === 0) continue

      // Apply to CURRENT server stock
      const currentStock = currentItem.stock
      const adjustedStock = Math.max(0, currentStock + delta) // Prevent negative
      const varianceValue = Math.abs(delta) * currentItem.avgCost

      const adjustment: AdjustmentResult = {
        inventoryItemId: snap.inventoryItemId,
        itemName: snap.itemName,
        batchId: snap.batchId,
        batchNumber: snap.batchNumber,
        systemQty: snap.systemQty,
        physicalQty: snap.physicalQty,
        currentStock,
        delta,
        adjustedStock,
        varianceValue,
      }

      adjustments.push(adjustment)
      totalVarianceValue += varianceValue
      varianceCount++

      // Track batch adjustments separately
      if (snap.batchId && currentBatchMap.has(snap.batchId)) {
        const batch = currentBatchMap.get(snap.batchId)!
        const newRemainingQty = Math.max(0, batch.remainingQty + delta)
        batchAdjustments.push({
          batchId: snap.batchId,
          batchNumber: snap.batchNumber || batch.batchNumber,
          delta,
          newRemainingQty,
        })
      }
    }

    console.log(`[StockOpname] Calculated ${adjustments.length} adjustments, ${batchAdjustments.length} batch updates`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 3: APPLY ADJUSTMENTS IN TRANSACTION
    // Create InventoryMovement records + update stocks
    // ══════════════════════════════════════════════════════════════════

    const CHUNK_SIZE = 50
    const chunks: AdjustmentResult[][] = []
    
    for (let i = 0; i < adjustments.length; i += CHUNK_SIZE) {
      chunks.push(adjustments.slice(i, i + CHUNK_SIZE))
    }

    let movementsCreated = 0
    let batchesUpdated = 0

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]

      await db.$transaction(async (tx) => {
        // Process each adjustment
        for (const adj of chunk) {
          // 1. Create InventoryMovement (PERMANENT RECORD)
          await tx.inventoryMovement.create({
            data: {
              type: 'STOCK_OPNAME',
              quantity: adj.delta,                    // Can be positive or negative
              previousStock: adj.currentStock,         // What it was BEFORE this adjustment
              newStock: adj.adjustedStock,             // What it is NOW
              referenceType: 'STOCK_OPNAME',
              notes: adj.notes || opnameNotes || `Stock Opname: ${adj.systemQty} → ${adj.physicalQty}`,
              outletId,
              inventoryItemId: adj.inventoryItemId,
              userId,
            },
          })

          // 2. Update InventoryItem.stock
          await tx.inventoryItem.update({
            where: { id: adj.inventoryItemId },
            data: { stock: adj.adjustedStock },
          })

          movementsCreated++
        }

        // Process batch adjustments (only in first chunk to avoid duplicates)
        if (chunkIndex === 0 && batchAdjustments.length > 0) {
          for (const ba of batchAdjustments) {
            await tx.inventoryBatch.update({
              where: { id: ba.batchId },
              data: { remainingQty: ba.newRemainingQty },
            })
            batchesUpdated++
          }
        }
      }, {
        timeout: 30000, // 30s per chunk
      })
    }

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
