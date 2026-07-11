/**
 * Offline FEFO Engine — First Expired, First Out (Dexie / IndexedDB)
 *
 * Offline-first port of the server-side FEFO engine.
 * Uses Dexie transactions for atomicity across multiple tables.
 *
 * ALUR:
 *   Checkout (offline) → OfflineFEFO.consumeBatch(...)
 *     ↓
 *   Query AVAILABLE batches sorted by expiredDate ASC (null last)
 *     ↓
 *   Deduct from batch 1 until consumed → move to batch 2 → ...
 *     ↓
 *   Create BatchConsumptionLog per batch used
 *     ↓
 *   Update InventoryBatch.remainingQty + InventoryItem.stock (atomic Dexie tx)
 *
 * VOID (offline):
 *   Void → OfflineFEFO.restoreFromLogs(...)
 *     ↓
 *   Read BatchConsumptionLog for the transaction
 *     ↓
 *   Restore each batch's remainingQty + InventoryItem.stock
 *
 * DESIGN DECISIONS:
 *   - All writes go through direct Dexie puts (NOT OfflineRepo) to keep
 *     a single Dexie transaction spanning multiple tables.
 *   - InventoryItem.stock is denormalized: always recalculated from AVAILABLE batches.
 *   - No AuditLog (cloud-only).
 *   - Sync queue entries are enqueued AFTER the Dexie transaction commits.
 *   - All Date fields are ISO 8601 strings (not Date objects).
 */

import {
  getAetherDB,
  type AetherDBType,
  type SyncAction,
  type OfflineInventoryBatch,
  type OfflineInventoryItem,
  type OfflineBatchConsumptionLog,
  type OfflineInventoryMovement,
} from './aether-db'
import { syncEnqueueBatch } from './sync-queue'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export interface BatchConsumptionResult {
  inventoryItemId: string
  itemName: string
  baseUnit: string
  totalConsumed: number
  batchConsumptions: Array<{
    batchId: string
    batchNumber: string
    expiredDate: string | null
    quantityConsumed: number
    previousRemaining: number
    newRemaining: number
  }>
}

export interface BatchRestorationResult {
  inventoryItemId: string
  itemName: string
  baseUnit: string
  totalRestored: number
  batchRestorations: Array<{
    batchId: string
    batchNumber: string
    quantityRestored: number
    previousRemaining: number
    newRemaining: number
  }>
}

export interface CreateBatchesFromPurchaseParams {
  purchaseOrderId: string
  items: Array<{
    inventoryItemId: string
    name: string
    baseQty: number
    unitCost: number
    batch?: string | null
    expiredDate?: string | null
  }>
  outletId: string
  supplierId?: string | null
  supplierName?: string | null
}

export interface ConsumeBatchParams {
  inventoryItemId: string
  quantityNeeded: number
  transactionId: string
  invoiceNumber: string
  outletId: string
  userId: string
  sourceDetails: string
}

export interface RestoreFromLogsParams {
  transactionId: string
  invoiceNumber: string
  outletId: string
  userId: string
}

// ════════════════════════════════════════════════════════════
// Internal types
// ════════════════════════════════════════════════════════════

interface SyncEntry {
  entity: string
  entityId: string
  action: SyncAction
  payload: Record<string, unknown>
}

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════

/**
 * FEFO sort: expiredDate ASC (null last), then createdAt ASC.
 * Dexie can't do SQL CASE WHEN, so we sort in JS.
 */
function fefoSort(batches: OfflineInventoryBatch[]): OfflineInventoryBatch[] {
  return [...batches].sort((a, b) => {
    // Batches WITH expiredDate come before batches WITHOUT
    const aHasExpiry = a.expiredDate !== null ? 0 : 1
    const bHasExpiry = b.expiredDate !== null ? 0 : 1
    if (aHasExpiry !== bHasExpiry) return aHasExpiry - bHasExpiry

    // Both have or both lack expiry — compare values
    if (a.expiredDate && b.expiredDate) {
      const cmp = a.expiredDate.localeCompare(b.expiredDate)
      if (cmp !== 0) return cmp
    }

    // Tie-break: older batch first
    return a.createdAt.localeCompare(b.createdAt)
  })
}

/**
 * Fetch AVAILABLE, non-deleted batches for an inventory item at an outlet.
 * Uses the `inventoryItemId` index and filters outletId in-memory
 * (no compound index exists in the schema).
 */
async function fetchAvailableBatches(
  db: AetherDBType,
  inventoryItemId: string,
  outletId: string,
): Promise<OfflineInventoryBatch[]> {
  const allBatches = await db.inventoryBatches
    .where('inventoryItemId')
    .equals(inventoryItemId)
    .toArray()

  const now = new Date()

  // BAT-008 FIX: Also filter out expired batches and mark them
  const safeBatches: OfflineInventoryBatch[] = []
  for (const b of allBatches) {
    if (b.outletId !== outletId || b.status !== 'AVAILABLE' || b.remainingQty <= 0 || b.deletedAt !== null) {
      continue
    }
    // Check if expired
    if (b.expiredDate !== null && new Date(b.expiredDate) < now) {
      // Mark as expired
      b.status = 'EXPIRED'
      b.updatedAt = now.toISOString()
      await db.inventoryBatches.put(b)
      continue
    }
    safeBatches.push(b)
  }

  return safeBatches
}

/**
 * Calculate stock from all AVAILABLE, non-deleted batches for an item at an outlet.
 * Works both inside and outside a Dexie transaction.
 */
async function sumAvailableBatchStock(
  db: AetherDBType,
  inventoryItemId: string,
  outletId: string,
): Promise<number> {
  const allBatches = await db.inventoryBatches
    .where('inventoryItemId')
    .equals(inventoryItemId)
    .toArray()

  const now = new Date()

  return allBatches
    .filter(b => {
      if (b.outletId !== outletId || b.status !== 'AVAILABLE' || b.deletedAt !== null) return false
      // BAT-008: Exclude expired batches
      if (b.expiredDate !== null && new Date(b.expiredDate) < now) return false
      return b.remainingQty > 0
    })
    .reduce((sum, b) => sum + b.remainingQty, 0)
}

// ════════════════════════════════════════════════════════════
// Offline FEFO Engine
// ════════════════════════════════════════════════════════════

export class OfflineFEFO {

  // ─── Tables used in write transactions ───
  private static readonly WRITE_TABLES = [
    'inventoryBatches',
    'inventoryItems',
    'batchConsumptionLogs',
    'inventoryMovements',
  ] as const

  // ═════════════════════════════════════════════════════════
  // consumeBatch
  // ═════════════════════════════════════════════════════════

  /**
   * Consume inventory using FEFO (First Expired, First Out).
   *
   * Picks the closest-to-expiry AVAILABLE batch first.
   * If a batch is fully consumed, its status changes to CONSUMED.
   * Supports partial consumption across multiple batches.
   *
   * All DB writes happen in a single Dexie transaction.
   * Sync queue entries are enqueued AFTER the transaction commits.
   *
   * @returns BatchConsumptionResult with per-batch breakdown
   * @throws Error if insufficient batch stock (Indonesian message)
   */
  static async consumeBatch(
    params: ConsumeBatchParams,
  ): Promise<BatchConsumptionResult> {
    const db = getAetherDB()
    const {
      inventoryItemId, quantityNeeded, transactionId,
      invoiceNumber, outletId, userId, sourceDetails,
    } = params

    // Collected inside the tx, used after for sync enqueue
    let result: BatchConsumptionResult
    let syncEntries: SyncEntry[] = []

    await db.transaction('rw', [...OfflineFEFO.WRITE_TABLES], async () => {
      const now = new Date().toISOString()

      // 1. Fetch AVAILABLE batches for this item
      const batches = await fetchAvailableBatches(db, inventoryItemId, outletId)

      if (batches.length === 0) {
        result = {
          inventoryItemId,
          itemName: '',
          baseUnit: '',
          totalConsumed: 0,
          batchConsumptions: [],
        }
        return
      }

      // 2. Sort by FEFO
      const sorted = fefoSort(batches)

      // 3. Get inventory item info
      const invItem = await db.inventoryItems.get(inventoryItemId)
      const itemName = invItem?.name ?? ''
      const baseUnit = invItem?.baseUnit ?? ''

      // 4. Calculate total available
      const totalAvailable = sorted.reduce((sum, b) => sum + b.remainingQty, 0)
      if (totalAvailable < quantityNeeded) {
        throw new Error(
          `Stok batch untuk "${itemName}" tidak cukup. ` +
          `Tersedia: ${totalAvailable} ${baseUnit} (dari ${sorted.length} batch), ` +
          `Dibutuhkan: ${quantityNeeded} ${baseUnit}`,
        )
      }

      // 5. FEFO: consume from closest-to-expiry batches first
      let remaining = quantityNeeded
      const batchConsumptions: BatchConsumptionResult['batchConsumptions'] = []

      for (const batch of sorted) {
        if (remaining <= 0) break

        const consumeFromThisBatch = Math.min(remaining, batch.remainingQty)
        const newRemaining = batch.remainingQty - consumeFromThisBatch
        const newStatus: string = newRemaining <= 0 ? 'CONSUMED' : 'AVAILABLE'

        // Update batch
        const updatedBatch: OfflineInventoryBatch = {
          ...batch,
          remainingQty: newRemaining,
          status: newStatus,
          updatedAt: now,
          version: batch.version + 1,
        }
        await db.inventoryBatches.put(updatedBatch)

        // Create consumption log
        const log: OfflineBatchConsumptionLog = {
          id: crypto.randomUUID(),
          transactionId,
          inventoryBatchId: batch.id,
          inventoryItemId,
          quantityConsumed: consumeFromThisBatch,
          batchNumber: batch.batchNumber,
          expiredDate: batch.expiredDate,
          invoiceNumber,
          sourceDetails,
          outletId,
          syncStatus: 'PENDING',
          version: 1,
          updatedAt: now,
          createdAt: now,
          deletedAt: null,
        }
        await db.batchConsumptionLogs.put(log)

        batchConsumptions.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          expiredDate: batch.expiredDate,
          quantityConsumed: consumeFromThisBatch,
          previousRemaining: batch.remainingQty,
          newRemaining,
        })

        // Collect sync entries for this batch
        syncEntries.push(
          { entity: 'inventoryBatches', entityId: batch.id, action: 'UPDATE', payload: updatedBatch as unknown as Record<string, unknown> },
          { entity: 'batchConsumptionLogs', entityId: log.id, action: 'CREATE', payload: log as unknown as Record<string, unknown> },
        )

        remaining -= consumeFromThisBatch
      }

      // 6. Recalculate InventoryItem.stock = sum of all AVAILABLE batches remainingQty
      const newTotalStock = await sumAvailableBatchStock(db, inventoryItemId, outletId)
      const previousStock = newTotalStock + quantityNeeded

      if (invItem) {
        const updatedItem: OfflineInventoryItem = {
          ...invItem,
          stock: newTotalStock,
          updatedAt: now,
          version: invItem.version + 1,
        }
        await db.inventoryItems.put(updatedItem)

        // 7. Create inventory movement (CONSUMPTION)
        const movement: OfflineInventoryMovement = {
          id: crypto.randomUUID(),
          type: 'CONSUMPTION',
          quantity: -quantityNeeded,
          previousStock,
          newStock: newTotalStock,
          referenceId: transactionId,
          referenceType: 'TRANSACTION',
          notes: `FEFO: ${itemName} -${quantityNeeded} ${baseUnit} (${invoiceNumber}) [${batchConsumptions.map(bc =>
            `${bc.batchNumber}: -${bc.quantityConsumed}${baseUnit}`,
          ).join(', ')}]`,
          outletId,
          inventoryItemId,
          userId,
          syncStatus: 'PENDING',
          version: 1,
          updatedAt: now,
          createdAt: now,
          deletedAt: null,
        }
        await db.inventoryMovements.put(movement)

        syncEntries.push(
          { entity: 'inventoryItems', entityId: invItem.id, action: 'UPDATE', payload: updatedItem as unknown as Record<string, unknown> },
          { entity: 'inventoryMovements', entityId: movement.id, action: 'CREATE', payload: movement as unknown as Record<string, unknown> },
        )
      }

      result = {
        inventoryItemId,
        itemName,
        baseUnit,
        totalConsumed: quantityNeeded,
        batchConsumptions,
      }
    })

    // After the transaction — enqueue all sync entries in one batch
    if (syncEntries.length > 0) {
      await syncEnqueueBatch(syncEntries)
    }

    return result!
  }

  // ═════════════════════════════════════════════════════════
  // restoreFromLogs
  // ═════════════════════════════════════════════════════════

  /**
   * Restore inventory batches from BatchConsumptionLog (for void reversal).
   *
   * Reads the exact batch consumption logs from the voided transaction
   * and restores each batch's remainingQty.
   *
   * Each inventory item group runs in its own Dexie transaction.
   * Sync queue entries are enqueued AFTER all transactions commit.
   * No AuditLog (cloud-only).
   */
  static async restoreFromLogs(
    params: RestoreFromLogsParams,
  ): Promise<BatchRestorationResult[]> {
    const db = getAetherDB()
    const { transactionId, invoiceNumber, outletId, userId } = params

    // 1. Read consumption logs (outside any write transaction)
    const logs = await db.batchConsumptionLogs
      .where('transactionId')
      .equals(transactionId)
      .toArray()

    if (logs.length === 0) {
      return []
    }

    // 2. Group by inventoryItemId
    const byItem = new Map<string, OfflineBatchConsumptionLog[]>()
    for (const log of logs) {
      const existing = byItem.get(log.inventoryItemId) || []
      existing.push(log)
      byItem.set(log.inventoryItemId, existing)
    }

    // 3. Restore each inventory item group
    const results: BatchRestorationResult[] = []
    const allSyncEntries: SyncEntry[] = []

    for (const [inventoryItemId, itemLogs] of Array.from(byItem.entries())) {
      let totalRestored = 0
      const batchRestorations: BatchRestorationResult['batchRestorations'] = []

      // One transaction per inventory item
      await db.transaction('rw', [...OfflineFEFO.WRITE_TABLES], async () => {
        const now = new Date().toISOString()

        // Restore each batch
        for (const log of itemLogs) {
          const batch = await db.inventoryBatches.get(log.inventoryBatchId)
          if (!batch) continue

          const previousRemaining = batch.remainingQty
          const newRemaining = previousRemaining + log.quantityConsumed
          const newStatus: string = batch.status === 'CONSUMED' && newRemaining > 0
            ? 'AVAILABLE'
            : batch.status

          const updatedBatch: OfflineInventoryBatch = {
            ...batch,
            remainingQty: newRemaining,
            status: newStatus,
            updatedAt: now,
            version: batch.version + 1,
          }
          await db.inventoryBatches.put(updatedBatch)

          totalRestored += log.quantityConsumed
          batchRestorations.push({
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            quantityRestored: log.quantityConsumed,
            previousRemaining,
            newRemaining,
          })

          // Collect sync entry for the updated batch
          allSyncEntries.push({
            entity: 'inventoryBatches',
            entityId: batch.id,
            action: 'UPDATE',
            payload: updatedBatch as unknown as Record<string, unknown>,
          })
        }

        // Update InventoryItem.stock
        const invItem = await db.inventoryItems.get(inventoryItemId)
        if (invItem) {
          const previousStock = invItem.stock
          const newStock = previousStock + totalRestored

          const updatedItem: OfflineInventoryItem = {
            ...invItem,
            stock: newStock,
            updatedAt: now,
            version: invItem.version + 1,
          }
          await db.inventoryItems.put(updatedItem)

          // Create inventory movement (RESTOCK / VOID)
          const movement: OfflineInventoryMovement = {
            id: crypto.randomUUID(),
            type: 'RESTOCK',
            quantity: totalRestored,
            previousStock,
            newStock,
            referenceId: transactionId,
            referenceType: 'VOID',
            notes: `FEFO Restore (void ${invoiceNumber}): ${invItem.name} +${totalRestored} ${invItem.baseUnit} [${batchRestorations.map(br =>
              `${br.batchNumber}:+${br.quantityRestored}`,
            ).join(', ')}]`,
            outletId,
            inventoryItemId,
            userId,
            syncStatus: 'PENDING',
            version: 1,
            updatedAt: now,
            createdAt: now,
            deletedAt: null,
          }
          await db.inventoryMovements.put(movement)

          allSyncEntries.push(
            { entity: 'inventoryItems', entityId: invItem.id, action: 'UPDATE', payload: updatedItem as unknown as Record<string, unknown> },
            { entity: 'inventoryMovements', entityId: movement.id, action: 'CREATE', payload: movement as unknown as Record<string, unknown> },
          )
        }
      })

      // Read item info for the result (after tx)
      const invItem = await db.inventoryItems.get(inventoryItemId)
      results.push({
        inventoryItemId,
        itemName: invItem?.name ?? '',
        baseUnit: invItem?.baseUnit ?? '',
        totalRestored,
        batchRestorations,
      })
    }

    // After all transactions — enqueue sync
    if (allSyncEntries.length > 0) {
      await syncEnqueueBatch(allSyncEntries)
    }

    return results
  }

  // ═════════════════════════════════════════════════════════
  // createBatchesFromPurchase
  // ═════════════════════════════════════════════════════════

  /**
   * Create InventoryBatch records from a purchase order (offline).
   *
   * For items with a batch number: create a named batch.
   * For items without a batch number: auto-generate one (e.g., "AUTO-20250715-0001").
   *
   * No AuditLog (cloud-only).
   */
  static async createBatchesFromPurchase(
    params: CreateBatchesFromPurchaseParams,
  ): Promise<void> {
    const db = getAetherDB()
    const { purchaseOrderId, items, outletId, supplierId, supplierName } = params

    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const now = new Date().toISOString()
    const prefix = `AUTO-${dateStr}-`

    // Count existing batches with same prefix for auto-sequence
    const outletBatches = await db.inventoryBatches
      .where('outletId')
      .equals(outletId)
      .toArray()
    const existingAutoCount = outletBatches.filter(b => b.batchNumber.startsWith(prefix)).length

    const createdBatches: OfflineInventoryBatch[] = []

    await db.transaction('rw', ['inventoryBatches'], async () => {
      let autoSeq = existingAutoCount

      for (const item of items) {
        let batchNumber: string
        if (item.batch?.trim()) {
          batchNumber = item.batch.trim()
        } else {
          autoSeq++
          batchNumber = `${prefix}${String(autoSeq).padStart(4, '0')}`
        }

        const batch: OfflineInventoryBatch = {
          id: crypto.randomUUID(),
          batchNumber,
          inventoryItemId: item.inventoryItemId,
          initialQty: item.baseQty,
          remainingQty: item.baseQty,
          unitCost: item.unitCost,
          expiredDate: item.expiredDate ?? null,
          purchaseOrderId,
          purchaseOrderItemId: null,
          supplierId: supplierId ?? null,
          supplierName: supplierName ?? null,
          status: 'AVAILABLE',
          outletId,
          syncStatus: 'PENDING',
          version: 1,
          updatedAt: now,
          createdAt: now,
          deletedAt: null,
        }

        await db.inventoryBatches.put(batch)
        createdBatches.push(batch)
      }
    })

    // After transaction — enqueue sync for all created batches
    if (createdBatches.length > 0) {
      await syncEnqueueBatch(
        createdBatches.map(b => ({
          entity: 'inventoryBatches',
          entityId: b.id,
          action: 'CREATE' as SyncAction,
          payload: b as unknown as Record<string, unknown>,
        })),
      )
    }
  }

  // ═════════════════════════════════════════════════════════
  // calculateItemStock
  // ═════════════════════════════════════════════════════════

  /**
   * Calculate the current stock for an inventory item.
   *
   * Stock = sum of all AVAILABLE, non-deleted batches' remainingQty.
   * This is the source of truth — InventoryItem.stock is a denormalized cache.
   */
  static async calculateItemStock(
    inventoryItemId: string,
    outletId: string,
  ): Promise<number> {
    const db = getAetherDB()
    return sumAvailableBatchStock(db, inventoryItemId, outletId)
  }
}