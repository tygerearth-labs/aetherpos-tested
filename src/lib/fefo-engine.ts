/**
 * FEFO Engine — First Expired, First Out
 *
 * Core engine for AetherPOS Inventory Intelligence.
 * Automatically selects the closest-to-expiry batch when consuming inventory.
 *
 * ALUR:
 *   Checkout → InventoryConsumptionService
 *     ↓
 *   FEFOEngine.consumeBatch(tx, inventoryItemId, qty)
 *     ↓
 *   Query AVAILABLE batches sorted by expiredDate ASC (null last)
 *     ↓
 *   Deduct from batch 1 until consumed → move to batch 2 → ...
 *     ↓
 *   Create BatchConsumptionLog per batch used
 *     ↓
 *   Update InventoryBatch.remainingQty + InventoryItem.stock (atomic)
 *
 * VOID:
 *   Void → FEFOEngine.restoreFromLogs(tx, transactionId)
 *     ↓
 *   Read BatchConsumptionLog for the transaction
 *     ↓
 *   Restore each batch's remainingQty + InventoryItem.stock
 *
 * DESIGN DECISIONS:
 *   - Batches without expiredDate are sorted LAST (treated as "long shelf life")
 *   - Partial consumption across batches is supported (e.g., need 15kg, batch A has 10kg, batch B has 20kg)
 *   - All operations happen within the caller's Prisma transaction
 *   - InventoryItem.stock is denormalized: always kept in sync with sum(batch.remainingQty)
 */

import { Prisma } from '@prisma/client'
import { ciContains } from '@/lib/api/api-helpers'

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
    expiredDate: Date | null
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

interface AvailableBatch {
  id: string
  batchNumber: string
  inventoryItemId: string
  initialQty: number
  remainingQty: number
  unitCost: number
  expiredDate: Date | null
  status: string
  inventoryItem: {
    name: string
    baseUnit: string
  }
}

type TxClient = Parameters<Parameters<typeof Prisma.prototype.$transaction>[0]>[0]

// ════════════════════════════════════════════════════════════
// FEFO Engine
// ════════════════════════════════════════════════════════════

export class FEFOEngine {

  /**
   * Consume inventory using FEFO (First Expired, First Out).
   *
   * Picks the closest-to-expiry AVAILABLE batch first.
   * If a batch is fully consumed, its status changes to CONSUMED.
   * Supports partial consumption across multiple batches.
   *
   * @param tx - Prisma transaction client
   * @param inventoryItemId - Which inventory item to consume
   * @param quantityNeeded - How much to consume (in base unit)
   * @param transactionId - Transaction ID for BatchConsumptionLog
   * @param invoiceNumber - Invoice number (snapshot)
   * @param outletId - Outlet ID
   * @param sourceDetails - JSON string: [{productName, variantName?, productQty}]
   * @returns BatchConsumptionResult with per-batch breakdown
   * @throws Error if insufficient batch stock
   */
  static async consumeBatch(
    tx: TxClient,
    params: {
      inventoryItemId: string
      quantityNeeded: number
      transactionId: string
      invoiceNumber: string
      outletId: string
      userId: string
      sourceDetails: string
    }
  ): Promise<BatchConsumptionResult> {
    const { inventoryItemId, quantityNeeded, transactionId, invoiceNumber, outletId, userId, sourceDetails } = params

    // 0. Mark expired batches before FEFO selection (BAT-008 fix)
    //    Ensures expired batches are never consumed during checkout.
    const now = new Date()
    await tx.inventoryBatch.updateMany({
      where: {
        inventoryItemId,
        outletId,
        status: 'AVAILABLE',
        expiredDate: { lt: now },
        remainingQty: { gt: 0 },
      },
      data: { status: 'EXPIRED', updatedAt: now },
    })

    // 1. Fetch AVAILABLE batches sorted by FEFO: expiredDate ASC, null last
    //    BAT-008: Also filter out expired dates directly as a safety net
    const batches: AvailableBatch[] = await tx.$queryRaw`
      SELECT
        ib.id, ib."batchNumber", ib."inventoryItemId", ib."initialQty",
        ib."remainingQty", ib."unitCost", ib."expiredDate", ib.status,
        ii.name as "itemName", ii."baseUnit" as "baseUnit"
      FROM "InventoryBatch" ib
      JOIN "InventoryItem" ii ON ii.id = ib."inventoryItemId"
      WHERE ib."inventoryItemId" = ${inventoryItemId}
        AND ib."outletId" = ${outletId}
        AND ib.status = 'AVAILABLE'
        AND ib."remainingQty" > 0
        AND (ib."expiredDate" IS NULL OR ib."expiredDate" >= ${now})
      ORDER BY
        CASE WHEN ib."expiredDate" IS NULL THEN 1 ELSE 0 END,
        ib."expiredDate" ASC,
        ib."createdAt" ASC
    `

    if (batches.length === 0) {
      // No batches available — fall through (let the caller handle plain stock deduction)
      return {
        inventoryItemId,
        itemName: '',
        baseUnit: '',
        totalConsumed: 0,
        batchConsumptions: [],
      }
    }

    const itemName = batches[0].inventoryItem.name
    const baseUnit = batches[0].inventoryItem.baseUnit

    // 2. Calculate total available across all batches
    const totalAvailable = batches.reduce((sum, b) => sum + b.remainingQty, 0)
    if (totalAvailable < quantityNeeded) {
      throw new Error(
        `Stok batch untuk "${itemName}" tidak cukup. ` +
        `Tersedia: ${totalAvailable} ${baseUnit} (dari ${batches.length} batch), ` +
        `Dibutuhkan: ${quantityNeeded} ${baseUnit}`
      )
    }

    // 3. FEFO: consume from closest-to-expiry batches first
    let remaining = quantityNeeded
    const batchConsumptions: BatchConsumptionResult['batchConsumptions'] = []

    for (const batch of batches) {
      if (remaining <= 0) break

      const consumeFromThisBatch = Math.min(remaining, batch.remainingQty)
      const newRemaining = batch.remainingQty - consumeFromThisBatch
      const newStatus = newRemaining <= 0 ? 'CONSUMED' : 'AVAILABLE'

      // Update batch
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: {
          remainingQty: newRemaining,
          status: newStatus,
          updatedAt: new Date(),
        },
      })

      // Create consumption log
      await tx.batchConsumptionLog.create({
        data: {
          transactionId,
          inventoryBatchId: batch.id,
          inventoryItemId,
          quantityConsumed: consumeFromThisBatch,
          batchNumber: batch.batchNumber,
          expiredDate: batch.expiredDate,
          invoiceNumber,
          sourceDetails,
          outletId,
        },
      })

      batchConsumptions.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiredDate: batch.expiredDate,
        quantityConsumed: consumeFromThisBatch,
        previousRemaining: batch.remainingQty,
        newRemaining,
      })

      remaining -= consumeFromThisBatch
    }

    // 4. Update InventoryItem.stock (denormalized total)
    //    Re-read all AVAILABLE batches for this item to get accurate total
    const updatedBatches = await tx.inventoryBatch.findMany({
      where: {
        inventoryItemId,
        outletId,
        status: { in: ['AVAILABLE'] },
      },
      select: { remainingQty: true },
    })
    const newTotalStock = updatedBatches.reduce((sum, b) => sum + b.remainingQty, 0)

    await tx.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { stock: newTotalStock },
    })

    // 5. Create inventory movement
    const previousStock = newTotalStock + quantityNeeded
    await tx.inventoryMovement.create({
      data: {
        type: 'CONSUMPTION',
        inventoryItemId,
        quantity: -quantityNeeded,
        previousStock,
        newStock: newTotalStock,
        referenceId: transactionId,
        referenceType: 'TRANSACTION',
        notes: `FEFO: ${itemName} -${quantityNeeded} ${baseUnit} (${invoiceNumber}) [${batchConsumptions.map(bc =>
          `${bc.batchNumber}: -${bc.quantityConsumed}${baseUnit}`
        ).join(', ')}]`,
        outletId,
        userId,
      },
    })

    // 6. Create audit log
    await tx.auditLog.create({
      data: {
        action: 'FEFO_CONSUME',
        entityType: 'INVENTORY_BATCH',
        entityId: inventoryItemId,
        details: JSON.stringify({
          invoiceNumber,
          itemName,
          baseUnit,
          totalConsumed: quantityNeeded,
          previousStock,
          newStock: newTotalStock,
          batches: batchConsumptions.map(bc => ({
            batchNumber: bc.batchNumber,
            expiredDate: bc.expiredDate?.toISOString() ?? null,
            consumed: bc.quantityConsumed,
            remaining: bc.newRemaining,
          })),
          sourceDetails: JSON.parse(sourceDetails),
        }),
        outletId,
        userId,
      },
    })

    console.log(
      `[FEFO] ${invoiceNumber} — consumed ${quantityNeeded} ${baseUnit} of "${itemName}" ` +
      `from ${batchConsumptions.length} batch(es): ${batchConsumptions.map(bc =>
        `${bc.batchNumber}(-${bc.quantityConsumed})`
      ).join(', ')}`
    )

    return {
      inventoryItemId,
      itemName,
      baseUnit,
      totalConsumed: quantityNeeded,
      batchConsumptions,
    }
  }

  /**
   * Restore inventory batches from BatchConsumptionLog (for void reversal).
   *
   * Reads the exact batch consumption logs from the voided transaction
   * and restores each batch's remainingQty.
   *
   * @param tx - Prisma transaction client
   * @param transactionId - Voided transaction ID
   * @param invoiceNumber - Invoice number (for audit/movement notes)
   * @param outletId - Outlet ID
   * @param userId - User performing the void
   */
  static async restoreFromLogs(
    tx: TxClient,
    params: {
      transactionId: string
      invoiceNumber: string
      outletId: string
      userId: string
    }
  ): Promise<void> {
    const { transactionId, invoiceNumber, outletId, userId } = params

    // 1. Read consumption logs
    const logs = await tx.batchConsumptionLog.findMany({
      where: { transactionId, outletId },
    })

    if (logs.length === 0) {
      console.log(`[FEFO:RESTORE] ${invoiceNumber} — no batch consumption logs found, skipping`)
      return
    }

    // Group by inventoryItemId
    const byItem = new Map<string, typeof logs>()
    for (const log of logs) {
      const existing = byItem.get(log.inventoryItemId) || []
      existing.push(log)
      byItem.set(log.inventoryItemId, existing)
    }

    // 2. Restore each batch
    for (const [inventoryItemId, itemLogs] of byItem) {
      let totalRestored = 0
      const batchRestorations: Array<{
        batchId: string
        batchNumber: string
        quantityRestored: number
        previousRemaining: number
        newRemaining: number
      }> = []

      for (const log of itemLogs) {
        // Fetch current batch
        const batch = await tx.inventoryBatch.findUnique({
          where: { id: log.inventoryBatchId },
        })

        if (!batch) {
          console.warn(`[FEFO:RESTORE] Batch ${log.inventoryBatchId} not found, skipping`)
          continue
        }

        const previousRemaining = batch.remainingQty
        const newRemaining = previousRemaining + log.quantityConsumed
        const newStatus = batch.status === 'CONSUMED' && newRemaining > 0 ? 'AVAILABLE' : batch.status

        await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: {
            remainingQty: newRemaining,
            status: newStatus,
            updatedAt: new Date(),
          },
        })

        totalRestored += log.quantityConsumed
        batchRestorations.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          quantityRestored: log.quantityConsumed,
          previousRemaining,
          newRemaining,
        })
      }

      // 3. Update InventoryItem.stock
      const invItem = await tx.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        select: { name: true, baseUnit: true, stock: true },
      })

      if (invItem) {
        const previousStock = invItem.stock
        const newStock = previousStock + totalRestored

        await tx.inventoryItem.update({
          where: { id: inventoryItemId },
          data: { stock: newStock },
        })

        // Create inventory movement
        await tx.inventoryMovement.create({
          data: {
            type: 'RESTOCK',
            inventoryItemId,
            quantity: totalRestored,
            previousStock,
            newStock,
            referenceId: transactionId,
            referenceType: 'VOID',
            notes: `FEFO Restore (void ${invoiceNumber}): ${invItem.name} +${totalRestored} ${invItem.baseUnit} [${batchRestorations.map(br =>
              `${br.batchNumber}:+${br.quantityRestored}`
            ).join(', ')}]`,
            outletId,
            userId,
          },
        })

        // Create audit log
        await tx.auditLog.create({
          data: {
            action: 'FEFO_RESTORE',
            entityType: 'INVENTORY_BATCH',
            entityId: inventoryItemId,
            details: JSON.stringify({
              invoiceNumber,
              reason: 'Void transaksi',
              itemName: invItem.name,
              baseUnit: invItem.baseUnit,
              totalRestored,
              previousStock,
              newStock,
              batches: batchRestorations.map(br => ({
                batchNumber: br.batchNumber,
                restored: br.quantityRestored,
                previousRemaining: br.previousRemaining,
                newRemaining: br.newRemaining,
              })),
            }),
            outletId,
            userId,
          },
        })
      }
    }

    console.log(
      `[FEFO:RESTORE] ${invoiceNumber} — restored ${logs.length} batch consumption log(s) for ${byItem.size} inventory item(s)`
    )
  }

  /**
   * Record batch consumption without modifying InventoryItem.stock.
   *
   * Used when InventoryConsumptionService has already deducted InventoryItem.stock.
   * Only updates InventoryBatch.remainingQty and creates BatchConsumptionLog.
   * Does NOT update InventoryItem.stock, InventoryMovement, or AuditLog.
   *
   * @param tx - Prisma transaction client
   * @param params - Consumption parameters
   * @returns BatchConsumptionResult or null if no batches exist for this item
   */
  static async recordBatchConsumption(
    tx: TxClient,
    params: {
      inventoryItemId: string
      quantityNeeded: number
      transactionId: string
      invoiceNumber: string
      outletId: string
      userId: string
      sourceDetails: string
    }
  ): Promise<BatchConsumptionResult | null> {
    const { inventoryItemId, quantityNeeded, transactionId, invoiceNumber, outletId, userId, sourceDetails } = params

    // 0. Mark expired batches before FEFO selection (BAT-008 fix)
    const now = new Date()
    await tx.inventoryBatch.updateMany({
      where: {
        inventoryItemId,
        outletId,
        status: 'AVAILABLE',
        expiredDate: { lt: now },
        remainingQty: { gt: 0 },
      },
      data: { status: 'EXPIRED', updatedAt: now },
    })

    // 1. Fetch AVAILABLE batches sorted by FEFO: expiredDate ASC, null last
    //    BAT-008: Filter out expired dates as safety net
    const batches: AvailableBatch[] = await tx.$queryRaw`
      SELECT
        ib.id, ib."batchNumber", ib."inventoryItemId", ib."initialQty",
        ib."remainingQty", ib."unitCost", ib."expiredDate", ib.status,
        ii.name as "itemName", ii."baseUnit" as "baseUnit"
      FROM "InventoryBatch" ib
      JOIN "InventoryItem" ii ON ii.id = ib."inventoryItemId"
      WHERE ib."inventoryItemId" = ${inventoryItemId}
        AND ib."outletId" = ${outletId}
        AND ib.status = 'AVAILABLE'
        AND ib."remainingQty" > 0
        AND (ib."expiredDate" IS NULL OR ib."expiredDate" >= ${now})
      ORDER BY
        CASE WHEN ib."expiredDate" IS NULL THEN 1 ELSE 0 END,
        ib."expiredDate" ASC,
        ib."createdAt" ASC
    `

    if (batches.length === 0) {
      // No batch tracking for this item — that's fine
      return null
    }

    const itemName = batches[0].inventoryItem.name
    const baseUnit = batches[0].inventoryItem.baseUnit

    // 2. Calculate total available across all batches
    const totalAvailable = batches.reduce((sum, b) => sum + b.remainingQty, 0)
    if (totalAvailable < quantityNeeded) {
      // INV-HC-05 FIX: Throw instead of silently capping.
      // If this fires, InventoryItem.stock and batch totals are out of sync.
      // The caller's transaction will rollback, preventing data corruption.
      throw new Error(
        `[FEFO:RECORD] ${invoiceNumber} — CRITICAL: Batch stock inconsistent for "${itemName}". ` +
        `Available (batches): ${totalAvailable} ${baseUnit}, needed: ${quantityNeeded} ${baseUnit}. ` +
        `InventoryItem.stock does not match sum(batch.remainingQty). Data integrity violation.`
      )
    }

    // 3. FEFO: consume from closest-to-expiry batches first
    let remaining = quantityNeeded
    const batchConsumptions: BatchConsumptionResult['batchConsumptions'] = []

    for (const batch of batches) {
      if (remaining <= 0) break

      const consumeFromThisBatch = Math.min(remaining, batch.remainingQty)
      const newRemaining = batch.remainingQty - consumeFromThisBatch
      const newStatus = newRemaining <= 0 ? 'CONSUMED' : 'AVAILABLE'

      // Update batch remainingQty only
      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: {
          remainingQty: newRemaining,
          status: newStatus,
          updatedAt: new Date(),
        },
      })

      // Create consumption log
      await tx.batchConsumptionLog.create({
        data: {
          transactionId,
          inventoryBatchId: batch.id,
          inventoryItemId,
          quantityConsumed: consumeFromThisBatch,
          batchNumber: batch.batchNumber,
          expiredDate: batch.expiredDate,
          invoiceNumber,
          sourceDetails,
          outletId,
        },
      })

      batchConsumptions.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiredDate: batch.expiredDate,
        quantityConsumed: consumeFromThisBatch,
        previousRemaining: batch.remainingQty,
        newRemaining,
      })

      remaining -= consumeFromThisBatch
    }

    const totalConsumed = batchConsumptions.reduce((sum, bc) => sum + bc.quantityConsumed, 0)

    console.log(
      `[FEFO:RECORD] ${invoiceNumber} — recorded ${totalConsumed} ${baseUnit} batch consumption for "${itemName}" ` +
      `from ${batchConsumptions.length} batch(es): ${batchConsumptions.map(bc =>
        `${bc.batchNumber}(-${bc.quantityConsumed})`
      ).join(', ')}`
    )

    return {
      inventoryItemId,
      itemName,
      baseUnit,
      totalConsumed,
      batchConsumptions,
    }
  }

  /**
   * Restore batches from consumption logs WITHOUT modifying InventoryItem.stock.
   *
   * Used when the void route has already restored InventoryItem.stock via
   * InventoryConsumptionService. This method ONLY restores InventoryBatch.remainingQty.
   * Does NOT update InventoryItem.stock, InventoryMovement, or AuditLog.
   *
   * @param tx - Prisma transaction client
   * @param params - Restoration parameters
   */
  static async restoreBatchesFromLogs(
    tx: TxClient,
    params: {
      transactionId: string
      invoiceNumber: string
      outletId: string
      userId: string
    }
  ): Promise<void> {
    const { transactionId, invoiceNumber, outletId } = params

    // 1. Read consumption logs
    const logs = await tx.batchConsumptionLog.findMany({
      where: { transactionId, outletId },
    })

    if (logs.length === 0) {
      console.log(`[FEFO:BATCH_RESTORE] ${invoiceNumber} — no batch consumption logs found, skipping`)
      return
    }

    let totalBatchesRestored = 0

    // 2. Restore each batch's remainingQty only
    for (const log of logs) {
      const batch = await tx.inventoryBatch.findUnique({
        where: { id: log.inventoryBatchId },
      })

      if (!batch) {
        console.warn(`[FEFO:BATCH_RESTORE] Batch ${log.inventoryBatchId} not found, skipping`)
        continue
      }

      const previousRemaining = batch.remainingQty
      const newRemaining = previousRemaining + log.quantityConsumed
      const newStatus = batch.status === 'CONSUMED' && newRemaining > 0 ? 'AVAILABLE' : batch.status

      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: {
          remainingQty: newRemaining,
          status: newStatus,
          updatedAt: new Date(),
        },
      })

      totalBatchesRestored++
    }

    console.log(
      `[FEFO:BATCH_RESTORE] ${invoiceNumber} — restored ${totalBatchesRestored} batch(es) from consumption logs ` +
      `(InventoryItem.stock not touched — already restored by void route)`
    )
  }

  /**
   * Create InventoryBatch records from a purchase order.
   * Called by the purchase API after creating PurchaseOrder + PurchaseOrderItems.
   *
   * For items with a batch number: create a named batch.
   * For items without a batch number: auto-generate one (e.g., "AUTO-20250715-0001").
   *
   * @param tx - Prisma transaction client
   * @param purchaseOrderId - The newly created PO
   * @param items - PO items with batch/expiry info
   * @param outletId - Outlet ID
   * @param supplierId - Optional supplier ID (for snapshot)
   * @param supplierName - Optional supplier name (for snapshot)
   */
  static async createBatchesFromPurchase(
    tx: TxClient,
    params: {
      purchaseOrderId: string
      items: Array<{
        inventoryItemId: string
        name: string
        baseQty: number
        unitCost: number
        batch?: string | null
        expiredDate?: Date | null
      }>
      outletId: string
      supplierId?: string | null
      supplierName?: string | null
    }
  ): Promise<void> {
    const { purchaseOrderId, items, outletId, supplierId, supplierName } = params

    const today = new Date()
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '')

    // Single count query for auto-generated batch numbers (instead of N+1)
    let autoBatchCounter = 0
    const needsAutoBatch = items.some(item => !item.batch?.trim())
    if (needsAutoBatch) {
      autoBatchCounter = await tx.inventoryBatch.count({
        where: {
          outletId,
          batchNumber: { startsWith: `AUTO-${dateStr}` },
        },
      })
    }

    for (const item of items) {
      // Generate batch number
      let batchNumber: string
      if (item.batch?.trim()) {
        batchNumber = item.batch.trim()
      } else {
        autoBatchCounter++
        batchNumber = `AUTO-${dateStr}-${String(autoBatchCounter).padStart(4, '0')}`
      }

      await tx.inventoryBatch.create({
        data: {
          batchNumber,
          inventoryItemId: item.inventoryItemId,
          initialQty: item.baseQty,
          remainingQty: item.baseQty,
          unitCost: item.unitCost,
          expiredDate: item.expiredDate || null,
          purchaseOrderId,
          supplierId: supplierId || null,
          supplierName: supplierName || null,
          status: 'AVAILABLE',
          outletId,
        },
      })
    }

    console.log(
      `[FEFO] Created ${items.length} batch record(s) for PO ${purchaseOrderId}`
    )
  }

  /**
   * Delete InventoryBatch records when a purchase order is deleted.
   * Only deletes batches that still have all their stock remaining (not partially consumed).
   * If a batch was partially consumed, it CANNOT be deleted — throws an error.
   *
   * @param tx - Prisma transaction client
   * @param purchaseOrderId - The PO being deleted
   * @param outletId - Outlet ID
   * @throws Error if any batch was partially consumed
   */
  static async deleteBatchesForPurchase(
    tx: TxClient,
    params: {
      purchaseOrderId: string
      outletId: string
    }
  ): Promise<void> {
    const { purchaseOrderId, outletId } = params

    const batches = await tx.inventoryBatch.findMany({
      where: { purchaseOrderId, outletId },
    })

    for (const batch of batches) {
      if (batch.remainingQty < batch.initialQty) {
        throw new Error(
          `Batch "${batch.batchNumber}" sudah terpakai (${batch.initialQty - batch.remainingQty} digunakan). ` +
          `Tidak bisa menghapus PO ini. Void transaksi terkait terlebih dahulu.`
        )
      }
    }

    // Delete consumption logs first (cascade should handle this, but be explicit)
    const batchIds = batches.map(b => b.id)
    await tx.batchConsumptionLog.deleteMany({
      where: { inventoryBatchId: { in: batchIds }, outletId },
    })

    // Delete batches
    await tx.inventoryBatch.deleteMany({
      where: { purchaseOrderId, outletId },
    })

    console.log(
      `[FEFO] Deleted ${batches.length} batch record(s) for PO ${purchaseOrderId}`
    )
  }

  /**
   * Check if a batch number already exists for this outlet (for Smart Purchase Warning).
   *
   * @returns Existing batch info or null
   */
  static async checkDuplicateBatch(
    tx: TxClient,
    params: {
      batchNumber: string
      outletId: string
    }
  ): Promise<{
    id: string
    batchNumber: string
    inventoryItemName: string
    baseUnit: string
    remainingQty: number
    expiredDate: Date | null
    purchaseOrderNumber: string
    createdAt: Date
  } | null> {
    const { batchNumber, outletId } = params

    // Case-insensitive duplicate check that works in BOTH PostgreSQL and SQLite.
    // - PostgreSQL: ciContains adds `mode: 'insensitive'`
    // - SQLite:     `contains` is already case-insensitive for ASCII
    const candidates = await tx.inventoryBatch.findMany({
      where: {
        ...ciContains('batchNumber', batchNumber),
        outletId,
        status: 'AVAILABLE',
      },
      include: {
        inventoryItem: { select: { name: true, baseUnit: true } },
        purchaseOrder: { select: { orderNumber: true } },
      },
      take: 50,
    })

    const lowered = batchNumber.toLowerCase()
    const batch = candidates.find(b => b.batchNumber.toLowerCase() === lowered)

    if (!batch) return null

    return {
      id: batch.id,
      batchNumber: batch.batchNumber,
      inventoryItemName: batch.inventoryItem.name,
      baseUnit: batch.inventoryItem.baseUnit,
      remainingQty: batch.remainingQty,
      expiredDate: batch.expiredDate,
      purchaseOrderNumber: batch.purchaseOrder?.orderNumber ?? '',
      createdAt: batch.createdAt,
    }
  }

  /**
   * Mark expired batches (status → EXPIRED).
   * Called periodically or on-access.
   *
   * @returns Number of batches marked as expired
   */
  static async markExpiredBatches(
    tx: TxClient,
    outletId: string
  ): Promise<number> {
    const now = new Date()

    const result = await tx.inventoryBatch.updateMany({
      where: {
        outletId,
        status: 'AVAILABLE',
        expiredDate: { lt: now },
        remainingQty: { gt: 0 },
      },
      data: {
        status: 'EXPIRED',
        updatedAt: now,
      },
    })

    if (result.count > 0) {
      console.log(`[FEFO] Marked ${result.count} batch(es) as EXPIRED for outlet ${outletId}`)
    }

    return result.count
  }

  /**
   * Calculate Inventory Freshness Score™ for an outlet.
   *
   * Score = (safeBatches / totalBatches) * 100
   *   - Safe: expiredDate > 30 days from now OR no expiredDate
   *   - Warning: expiredDate within 30 days
   *   - Expired: expiredDate < now
   *
   * @returns Score 0-100 + breakdown
   */
  static async calculateFreshnessScore(
    tx: TxClient,
    outletId: string
  ): Promise<{
    score: number
    grade: string
    totalBatchCount: number
    safeCount: number
    warningCount: number
    expiredCount: number
    noExpiryCount: number
    totalValue: number
    expiredValue: number
    warningValue: number
  }> {
    const now = new Date()
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const batches = await tx.inventoryBatch.findMany({
      where: {
        outletId,
        remainingQty: { gt: 0 },
      },
      select: {
        remainingQty: true,
        unitCost: true,
        expiredDate: true,
        status: true,
      },
    })

    let safeCount = 0
    let warningCount = 0
    let expiredCount = 0
    let noExpiryCount = 0
    let totalValue = 0
    let expiredValue = 0
    let warningValue = 0

    for (const batch of batches) {
      const batchValue = batch.remainingQty * batch.unitCost
      totalValue += batchValue

      if (batch.status === 'EXPIRED' || (batch.expiredDate && batch.expiredDate < now)) {
        expiredCount++
        expiredValue += batchValue
      } else if (!batch.expiredDate) {
        safeCount++
        noExpiryCount++
      } else if (batch.expiredDate <= thirtyDaysFromNow) {
        warningCount++
        warningValue += batchValue
      } else {
        safeCount++
      }
    }

    const totalBatchCount = batches.length
    const score = totalBatchCount > 0
      ? Math.round((safeCount / totalBatchCount) * 100)
      : 100 // No batches = perfect score

    let grade: string
    if (score >= 90) grade = 'A'
    else if (score >= 75) grade = 'B'
    else if (score >= 50) grade = 'C'
    else grade = 'D'

    return {
      score,
      grade,
      totalBatchCount,
      safeCount,
      warningCount,
      expiredCount,
      noExpiryCount,
      totalValue,
      expiredValue,
      warningValue,
    }
  }

  /**
   * Get expiry heatmap data for an outlet.
   * Groups batches by urgency: expired, <7 days, <30 days, safe.
   *
   * @returns Heatmap data grouped by inventory item
   */
  static async getExpiryHeatmap(
    tx: TxClient,
    outletId: string
  ): Promise<{
    expired: Array<{ inventoryItemId: string; itemName: string; batchNumber: string; remainingQty: number; unitCost: number; expiredDate: Date | null; totalLoss: number; baseUnit: string }>
    critical7d: Array<{ inventoryItemId: string; itemName: string; batchNumber: string; remainingQty: number; expiredDate: Date | null; baseUnit: string; daysUntilExpiry: number }>
    warning30d: Array<{ inventoryItemId: string; itemName: string; batchNumber: string; remainingQty: number; expiredDate: Date | null; baseUnit: string; daysUntilExpiry: number }>
    safeCount: number
  }> {
    const now = new Date()
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const batches = await tx.inventoryBatch.findMany({
      where: {
        outletId,
        remainingQty: { gt: 0 },
        status: { in: ['AVAILABLE', 'EXPIRED'] },
      },
      include: {
        inventoryItem: {
          select: { name: true, baseUnit: true },
        },
      },
      orderBy: { expiredDate: 'asc' },
    })

    const expired: Array<Record<string, unknown>> = []
    const critical7d: Array<Record<string, unknown>> = []
    const warning30d: Array<Record<string, unknown>> = []
    let safeCount = 0

    for (const batch of batches) {
      const isExpired = batch.status === 'EXPIRED' || (batch.expiredDate && batch.expiredDate < now)
      const daysUntilExpiry = batch.expiredDate
        ? Math.ceil((batch.expiredDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : null

      if (isExpired) {
        expired.push({
          ...batch,
          totalLoss: batch.remainingQty * batch.unitCost,
        })
      } else if (batch.expiredDate && batch.expiredDate <= sevenDays) {
        critical7d.push({
          ...batch,
          daysUntilExpiry: daysUntilExpiry!,
        })
      } else if (batch.expiredDate && batch.expiredDate <= thirtyDays) {
        warning30d.push({
          ...batch,
          daysUntilExpiry: daysUntilExpiry!,
        })
      } else {
        safeCount++
      }
    }

    return {
      expired: expired.map(b => ({
        inventoryItemId: b.inventoryItemId,
        itemName: (b as any).inventoryItem.name,
        batchNumber: b.batchNumber,
        remainingQty: b.remainingQty,
        unitCost: b.unitCost,
        expiredDate: b.expiredDate,
        totalLoss: (b as any).totalLoss,
        baseUnit: (b as any).inventoryItem.baseUnit,
      })),
      critical7d: critical7d.map(b => ({
        inventoryItemId: b.inventoryItemId,
        itemName: (b as any).inventoryItem.name,
        batchNumber: b.batchNumber,
        remainingQty: b.remainingQty,
        expiredDate: b.expiredDate,
        baseUnit: (b as any).inventoryItem.baseUnit,
        daysUntilExpiry: (b as any).daysUntilExpiry,
      })),
      warning30d: warning30d.map(b => ({
        inventoryItemId: b.inventoryItemId,
        itemName: (b as any).inventoryItem.name,
        batchNumber: b.batchNumber,
        remainingQty: b.remainingQty,
        expiredDate: b.expiredDate,
        baseUnit: (b as any).inventoryItem.baseUnit,
        daysUntilExpiry: (b as any).daysUntilExpiry,
      })),
      safeCount,
    }
  }

  /**
   * Get waste report (financial loss from expired items) for a date range.
   */
  static async getWasteReport(
    tx: TxClient,
    params: {
      outletId: string
      startDate: Date
      endDate: Date
    }
  ): Promise<{
    totalLoss: number
    items: Array<{
      id: string
      inventoryItemName: string
      batchNumber: string | null
      initialQty: number
      remainingQty: number
      baseUnit: string
      expiredDate: Date | null
      unitCost: number
      totalLoss: number
    }>
  }> {
    const { outletId, startDate, endDate } = params

    const batches = await tx.inventoryBatch.findMany({
      where: {
        outletId,
        status: 'EXPIRED',
        remainingQty: { gt: 0 },
        expiredDate: { gte: startDate, lte: endDate },
      },
      include: {
        inventoryItem: {
          select: { name: true, baseUnit: true },
        },
      },
      orderBy: { expiredDate: 'desc' },
    })

    // Return flat list of expired batches (one row per batch), matching the
    // UI's WasteReportItem interface. totalLoss is the sum across all batches.
    let totalLoss = 0
    const items = batches.map(batch => {
      const loss = batch.remainingQty * batch.unitCost
      totalLoss += loss
      return {
        id: batch.id,
        inventoryItemName: batch.inventoryItem.name,
        batchNumber: batch.batchNumber,
        initialQty: batch.initialQty,
        remainingQty: batch.remainingQty,
        baseUnit: batch.inventoryItem.baseUnit,
        expiredDate: batch.expiredDate,
        unitCost: batch.unitCost,
        totalLoss: loss,
      }
    })

    // Sort by loss descending (biggest waste first)
    items.sort((a, b) => b.totalLoss - a.totalLoss)

    return { totalLoss, items }
  }

  /**
   * Search batch by batch number — returns full traceability info.
   * Used for recall scenarios and customer complaints.
   */
  static async searchBatch(
    tx: TxClient,
    params: {
      batchNumber: string
      outletId: string
    }
  ): Promise<{
    batch: {
      id: string
      batchNumber: string
      inventoryItemId: string
      inventoryItem: { id: string; name: string; sku: string | null; baseUnit: string }
      baseUnit: string
      initialQty: number
      remainingQty: number
      unitCost: number
      expiredDate: Date | null
      daysUntilExpiry: number | null
      supplierName: string | null
      status: string
      createdAt: Date
    }
    purchaseOrder: {
      id: string
      orderNumber: string
      supplierName: string | null
      date: Date
      totalCost: number
    } | null
    transactions: Array<{
      id: string
      transactionId: string
      invoiceNumber: string
      date: Date
      qtyConsumed: number
      sourceProducts: string
      sourceDetails: Array<{ productName: string; variantName?: string; productQty: number }>
    }>
  } | null> {
    const { batchNumber, outletId } = params

    // Case-insensitive batch search that works in BOTH PostgreSQL and SQLite.
    // - PostgreSQL: ciContains adds `mode: 'insensitive'` (required for CI search)
    // - SQLite:     `contains` is already case-insensitive for ASCII
    //
    // We prefer an exact case-insensitive match first, then fall back to a
    // partial (contains) match for flexibility (e.g. "B2025" matches "B2025-001").
    const candidates = await tx.inventoryBatch.findMany({
      where: {
        OR: [
          ciContains('batchNumber', batchNumber),
        ],
        outletId,
      },
      include: {
        inventoryItem: { select: { id: true, name: true, sku: true, baseUnit: true } },
        purchaseOrder: {
          select: {
            id: true,
            orderNumber: true,
            createdAt: true,
            totalCost: true,
            supplier: { select: { name: true } },
          },
        },
      },
      take: 50,
    })

    // Prefer exact case-insensitive match; otherwise use the first partial match.
    const lowered = batchNumber.toLowerCase()
    const batch = candidates.find(b => b.batchNumber.toLowerCase() === lowered) || candidates[0]

    if (!batch) return null

    // Get all consumption logs for this batch
    const consumptionLogs = await tx.batchConsumptionLog.findMany({
      where: { inventoryBatchId: batch.id, outletId },
      orderBy: { createdAt: 'desc' },
    })

    const now = new Date()
    const daysUntilExpiry = batch.expiredDate
      ? Math.ceil((batch.expiredDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      : null

    return {
      batch: {
        id: batch.id,
        batchNumber: batch.batchNumber,
        inventoryItemId: batch.inventoryItemId,
        inventoryItem: {
          id: batch.inventoryItem.id,
          name: batch.inventoryItem.name,
          sku: batch.inventoryItem.sku,
          baseUnit: batch.inventoryItem.baseUnit,
        },
        baseUnit: batch.inventoryItem.baseUnit,
        initialQty: batch.initialQty,
        remainingQty: batch.remainingQty,
        unitCost: batch.unitCost,
        expiredDate: batch.expiredDate,
        daysUntilExpiry,
        supplierName: batch.supplierName,
        status: batch.status,
        createdAt: batch.createdAt,
      },
      purchaseOrder: batch.purchaseOrder
        ? {
            id: batch.purchaseOrder.id,
            orderNumber: batch.purchaseOrder.orderNumber,
            supplierName: batch.purchaseOrder.supplier?.name ?? null,
            date: batch.purchaseOrder.createdAt,
            totalCost: batch.purchaseOrder.totalCost,
          }
        : null,
      transactions: consumptionLogs.map(log => {
        const details = JSON.parse(log.sourceDetails || '[]') as Array<{ productName: string; variantName?: string; productQty: number }>
        return {
          id: log.id,
          transactionId: log.transactionId,
          invoiceNumber: log.invoiceNumber,
          date: log.createdAt,
          qtyConsumed: log.quantityConsumed,
          sourceProducts: details
            .map(d => d.variantName ? `${d.productName} (${d.variantName})` : d.productName)
            .join(', '),
          sourceDetails: details,
        }
      }),
    }
  }

  /**
   * Get batch timeline for a specific inventory item.
   * Shows all batches with their current status, remaining qty, and expiry.
   */
  static async getBatchTimeline(
    tx: TxClient,
    params: {
      inventoryItemId: string
      outletId: string
    }
  ): Promise<Array<{
    id: string
    batchNumber: string
    initialQty: number
    remainingQty: number
    unitCost: number
    baseUnit: string
    expiredDate: Date | null
    supplierName: string | null
    status: string
    purchaseOrderNumber: string
    createdAt: Date
    daysUntilExpiry: number | null
    consumptionPercentage: number
  }>> {
    const { inventoryItemId, outletId } = params
    const now = new Date()

    const batches = await tx.inventoryBatch.findMany({
      where: { inventoryItemId, outletId },
      include: {
        inventoryItem: { select: { baseUnit: true } },
        purchaseOrder: { select: { orderNumber: true } },
      },
      orderBy: [
        { status: 'asc' }, // AVAILABLE first
        { expiredDate: 'asc' }, // then by expiry
      ],
    })

    return batches.map(b => {
      const daysUntilExpiry = b.expiredDate
        ? Math.ceil((b.expiredDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : null

      return {
        id: b.id,
        batchNumber: b.batchNumber,
        initialQty: b.initialQty,
        remainingQty: b.remainingQty,
        unitCost: b.unitCost,
        baseUnit: b.inventoryItem.baseUnit,
        expiredDate: b.expiredDate,
        supplierName: b.supplierName,
        status: b.status,
        purchaseOrderNumber: b.purchaseOrder?.orderNumber ?? '',
        createdAt: b.createdAt,
        daysUntilExpiry,
        consumptionPercentage: b.initialQty > 0
          ? Math.round(((b.initialQty - b.remainingQty) / b.initialQty) * 100)
          : 0,
      }
    })
  }

  /**
   * Generate AI purchase recommendations based on consumption rate vs expiry.
   * Pure calculation — no LLM needed.
   */
  static async getPurchaseRecommendations(
    tx: TxClient,
    outletId: string
  ): Promise<Array<{
    inventoryItemId: string
    itemName: string
    baseUnit: string
    currentStock: number
    avgDailyConsumption: number
    nearestExpiryDate: Date | null
    daysUntilExpiry: number | null
    estimatedExpiryWaste: number
    recommendation: 'BUY' | 'HOLD' | 'URGENT_SELL' | 'NO_BATCH'
    reason: string
  }>> {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Get inventory items with compositions (only items used in products matter)
    const items = await tx.inventoryItem.findMany({
      where: {
        outletId,
        status: 'ACTIVE',
        compositions: { some: {} },
      },
      select: {
        id: true,
        name: true,
        baseUnit: true,
        stock: true,
      },
    })

    const recommendations: Array<Record<string, unknown>> = []

    for (const item of items) {
      // Calculate avg daily consumption from movements (last 30 days)
      const movements = await tx.inventoryMovement.findMany({
        where: {
          inventoryItemId: item.id,
          outletId,
          type: 'CONSUMPTION',
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { quantity: true },
      })

      const totalConsumed = Math.abs(movements.reduce((sum, m) => sum + m.quantity, 0))
      const avgDailyConsumption = totalConsumed / 30

      // Get nearest expiry batch
      const nearestBatch = await tx.inventoryBatch.findFirst({
        where: {
          inventoryItemId: item.id,
          outletId,
          status: { in: ['AVAILABLE'] },
          remainingQty: { gt: 0 },
        },
        orderBy: [
          { expiredDate: { sort: 'asc', nulls: 'last' } },
        ],
      })

      const daysUntilExpiry = nearestBatch?.expiredDate
        ? Math.ceil((nearestBatch.expiredDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : null

      let recommendation: 'BUY' | 'HOLD' | 'URGENT_SELL' | 'NO_BATCH' = 'NO_BATCH'
      let reason = ''

      if (!nearestBatch) {
        recommendation = 'NO_BATCH'
        reason = 'Tidak ada batch aktif. Pertimbangkan untuk melakukan pembelian.'
      } else if (daysUntilExpiry !== null && daysUntilExpiry <= 0) {
        recommendation = 'URGENT_SELL'
        reason = `Batch terdekat sudah expired. Segera buang atau diskon.`
      } else if (daysUntilExpiry !== null && avgDailyConsumption > 0) {
        const daysOfStock = item.stock / avgDailyConsumption
        if (daysUntilExpiry < daysOfStock) {
          // Will expire before stock runs out
          const estimatedWaste = Math.max(0, item.stock - (daysUntilExpiry * avgDailyConsumption))
          recommendation = 'HOLD'
          reason = `Stok cukup ${Math.round(daysOfStock)} hari, tapi batch expired ${daysUntilExpiry} hari lagi. Estimasi ${Math.round(estimatedWaste)} ${item.baseUnit} akan terbuang.`
        } else if (daysOfStock < 7) {
          recommendation = 'BUY'
          reason = `Stok hanya cukup ${Math.round(daysOfStock)} hari. Perlu pembelian segera.`
        } else {
          recommendation = 'HOLD'
          reason = `Stok cukup ${Math.round(daysOfStock)} hari. Tidak perlu pembelian minggu ini.`
        }
      } else if (avgDailyConsumption === 0 && item.stock > 0) {
        recommendation = 'HOLD'
        reason = `Stok ${item.stock} ${item.baseUnit} tersedia tapi tidak ada konsumsi 30 hari terakhir.`
      }

      recommendations.push({
        inventoryItemId: item.id,
        itemName: item.name,
        baseUnit: item.baseUnit,
        currentStock: item.stock,
        avgDailyConsumption: Math.round(avgDailyConsumption * 100) / 100,
        nearestExpiryDate: nearestBatch?.expiredDate || null,
        daysUntilExpiry,
        estimatedExpiryWaste: 0, // simplified for now
        recommendation,
        reason,
      })
    }

    return recommendations
  }
}