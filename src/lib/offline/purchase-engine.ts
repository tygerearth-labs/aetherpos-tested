/**
 * purchase-engine.ts — Offline Purchase Order Engine
 *
 * Handles purchase order creation and deletion entirely in Dexie.
 * All DB mutations are wrapped in a single Dexie transaction for atomicity.
 * After transaction commits, all created/updated records are enqueued
 * to the sync queue for eventual server reconciliation.
 *
 * Client-safe: no server imports, no AuditLog.
 */

import { getAetherDB } from './aether-db'
import type {
  OfflinePurchase,
  OfflinePurchaseItem,
  OfflineInventoryItem,
  OfflineInventoryMovement,
} from './aether-db'
import { OfflineFEFO } from './fefo-engine'
import { syncEnqueueBatch } from './sync-queue'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export interface CreatePurchaseItemInput {
  inventoryItemId: string
  name: string
  purchaseQty: number
  purchaseUnit: string
  baseQty: number
  baseUnit: string
  unitCost: number
  batch?: string | null
  expiredDate?: string | null
}

export interface CreatePurchaseParams {
  outletId: string
  userId: string
  supplierId?: string | null
  supplierName?: string | null
  items: CreatePurchaseItemInput[]
  notes?: string | null
}

export interface DeletePurchaseParams {
  purchaseId: string
  outletId: string
  userId: string
}

export interface CreatePurchaseResult {
  purchase: OfflinePurchase
  items: OfflinePurchaseItem[]
}

export interface DeletePurchaseResult {
  success: boolean
}

/** Tables touched by purchase operations */
const PURCHASE_TABLES = [
  'purchases',
  'purchaseItems',
  'inventoryItems',
  'inventoryMovements',
  'inventoryBatches',
] as const

// ════════════════════════════════════════════════════════════
// Helper: Generate Order Number  PO-YYYYMMDD-XXXX
// ════════════════════════════════════════════════════════════

async function generateOrderNumber(db: ReturnType<typeof getAetherDB>): Promise<string> {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const prefix = `PO-${y}${m}${d}-`

  const todayCount = await db.purchases
    .where('orderNumber')
    .startsWith(prefix)
    .count()

  const sequence = String(todayCount + 1).padStart(4, '0')
  return `${prefix}${sequence}`
}

// ════════════════════════════════════════════════════════════
// Engine
// ════════════════════════════════════════════════════════════

export class OfflinePurchaseEngine {
  // ──────────────────────────────────────────────────────────
  // Create Purchase
  // ──────────────────────────────────────────────────────────

  static async createPurchase(
    params: CreatePurchaseParams,
  ): Promise<CreatePurchaseResult> {
    const db = getAetherDB()
    const now = new Date().toISOString()

    // Pre-compute total cost
    const totalCost = params.items.reduce(
      (sum, item) => sum + item.baseQty * item.unitCost,
      0,
    )

    // Result containers — populated inside the transaction
    let createdPurchase!: OfflinePurchase
    const createdItems: OfflinePurchaseItem[] = []
    const syncEntries: Array<{
      entity: string
      entityId: string
      action: 'CREATE' | 'UPDATE' | 'DELETE'
      payload: Record<string, unknown>
    }> = []

    // ── Single atomic transaction ──
    await db.transaction('rw', [...PURCHASE_TABLES], async () => {
      // 1. Generate order number (inside tx for atomicity)
      const orderNumber = await generateOrderNumber(db)
      const purchaseId = crypto.randomUUID()

      // 2. Create OfflinePurchase
      createdPurchase = {
        id: purchaseId,
        orderNumber,
        supplierId: params.supplierId ?? null,
        totalCost,
        notes: params.notes ?? null,
        outletId: params.outletId,
        userId: params.userId,
        syncStatus: 'PENDING',
        version: 1,
        updatedAt: now,
        createdAt: now,
        deletedAt: null,
      }
      await db.purchases.add(createdPurchase)
      syncEntries.push({
        entity: 'purchases',
        entityId: purchaseId,
        action: 'CREATE',
        payload: createdPurchase as unknown as Record<string, unknown>,
      })

      // 3. Process each item
      for (const item of params.items) {
        const purchaseItemId = crypto.randomUUID()
        const itemTotalCost = item.baseQty * item.unitCost

        // a. Create OfflinePurchaseItem
        const purchaseItem: OfflinePurchaseItem = {
          id: purchaseItemId,
          purchaseOrderId: purchaseId,
          inventoryItemId: item.inventoryItemId,
          name: item.name,
          purchaseQty: item.purchaseQty,
          purchaseUnit: item.purchaseUnit,
          baseQty: item.baseQty,
          baseUnit: item.baseUnit,
          unitCost: item.unitCost,
          totalCost: itemTotalCost,
          batch: item.batch ?? null,
          expiredDate: item.expiredDate ?? null,
          outletId: params.outletId,
          syncStatus: 'PENDING',
          version: 1,
          updatedAt: now,
          createdAt: now,
          deletedAt: null,
        }
        await db.purchaseItems.add(purchaseItem)
        createdItems.push(purchaseItem)
        syncEntries.push({
          entity: 'purchaseItems',
          entityId: purchaseItemId,
          action: 'CREATE',
          payload: purchaseItem as unknown as Record<string, unknown>,
        })

        // b. Read OfflineInventoryItem
        const inventoryItem = await db.inventoryItems.get(item.inventoryItemId)
        if (!inventoryItem) {
          throw new Error(
            `Item inventori "${item.name}" tidak ditemukan`,
          )
        }

        // c. Weighted average cost
        const prevStock = inventoryItem.stock
        const prevAvgCost = inventoryItem.avgCost
        const newStock = prevStock + item.baseQty
        const newAvgCost =
          newStock > 0
            ? (prevStock * prevAvgCost + item.baseQty * item.unitCost) /
              newStock
            : 0

        // d. Update InventoryItem
        await db.inventoryItems.update(item.inventoryItemId, {
          stock: newStock,
          avgCost: Math.round(newAvgCost * 100) / 100,
          updatedAt: now,
          syncStatus: 'PENDING',
          version: inventoryItem.version + 1,
        })
        syncEntries.push({
          entity: 'inventoryItems',
          entityId: item.inventoryItemId,
          action: 'UPDATE',
          payload: {
            ...inventoryItem,
            stock: newStock,
            avgCost: Math.round(newAvgCost * 100) / 100,
            updatedAt: now,
            syncStatus: 'PENDING',
            version: inventoryItem.version + 1,
          } as unknown as Record<string, unknown>,
        })

        // e. Create InventoryMovement (PURCHASE)
        const movementId = crypto.randomUUID()
        const movement: OfflineInventoryMovement = {
          id: movementId,
          type: 'PURCHASE',
          quantity: item.baseQty,
          previousStock: prevStock,
          newStock,
          referenceId: purchaseId,
          referenceType: 'PURCHASE_ORDER',
          notes: `Pembelian: ${item.name}`,
          outletId: params.outletId,
          inventoryItemId: item.inventoryItemId,
          userId: params.userId,
          syncStatus: 'PENDING',
          version: 1,
          updatedAt: now,
          createdAt: now,
          deletedAt: null,
        }
        await db.inventoryMovements.add(movement)
        syncEntries.push({
          entity: 'inventoryMovements',
          entityId: movementId,
          action: 'CREATE',
          payload: movement as unknown as Record<string, unknown>,
        })
      }

      // 4. Create FEFO batch records (inside the same transaction)
      await OfflineFEFO.createBatchesFromPurchase({
        purchaseOrderId: createdPurchase.id,
        supplierId: params.supplierId ?? null,
        supplierName: params.supplierName ?? null,
        outletId: params.outletId,
        items: createdItems.map((pi) => ({
          purchaseOrderItemId: pi.id,
          inventoryItemId: pi.inventoryItemId,
          name: pi.name,
          baseQty: pi.baseQty,
          unitCost: pi.unitCost,
          batch: pi.batch,
          expiredDate: pi.expiredDate,
          outletId: pi.outletId,
        })),
      })
    })

    // 5. After transaction commits → enqueue to sync queue
    await syncEnqueueBatch(syncEntries)

    return { purchase: createdPurchase, items: createdItems }
  }

  // ──────────────────────────────────────────────────────────
  // Delete Purchase
  // ──────────────────────────────────────────────────────────

  static async deletePurchase(
    params: DeletePurchaseParams,
  ): Promise<DeletePurchaseResult> {
    const db = getAetherDB()
    const now = new Date().toISOString()

    const syncEntries: Array<{
      entity: string
      entityId: string
      action: 'CREATE' | 'UPDATE' | 'DELETE'
      payload: Record<string, unknown>
    }> = []

    // ── Single atomic transaction ──
    await db.transaction('rw', [...PURCHASE_TABLES], async () => {
      // 1. Read the purchase
      const purchase = await db.purchases.get(params.purchaseId)
      if (!purchase || purchase.deletedAt) {
        throw new Error('Purchase order tidak ditemukan')
      }

      // 2. Read purchase items
      const items = await db.purchaseItems
        .where('purchaseOrderId')
        .equals(params.purchaseId)
        .toArray()

      if (items.length === 0) {
        throw new Error('Purchase order tidak memiliki item')
      }

      // 3. Read ALL batches for this PO and check consumption
      //    CRITICAL: if ANY batch was partially consumed, block deletion
      const batches = await db.inventoryBatches
        .where('purchaseOrderId')
        .equals(params.purchaseId)
        .toArray()

      for (const batch of batches) {
        if (batch.remainingQty < batch.initialQty) {
          throw new Error(
            `Batch ${batch.batchNumber} sudah terpakai, tidak bisa hapus PO`,
          )
        }
      }

      // 4. For each item: reverse stock & recalculate avgCost
      for (const item of items) {
        const inventoryItem = await db.inventoryItems.get(
          item.inventoryItemId,
        )
        if (!inventoryItem) {
          throw new Error(
            `Item inventori "${item.name}" tidak ditemukan`,
          )
        }

        const prevStock = inventoryItem.stock
        const itemCost = item.baseQty * item.unitCost
        const oldTotalCost = prevStock * inventoryItem.avgCost
        const newStock = prevStock - item.baseQty
        const newAvgCost =
          newStock > 0 ? (oldTotalCost - itemCost) / newStock : 0

        // Reverse inventory item
        await db.inventoryItems.update(item.inventoryItemId, {
          stock: newStock,
          avgCost: Math.round(newAvgCost * 100) / 100,
          updatedAt: now,
          syncStatus: 'PENDING',
          version: inventoryItem.version + 1,
        })
        syncEntries.push({
          entity: 'inventoryItems',
          entityId: item.inventoryItemId,
          action: 'UPDATE',
          payload: {
            ...inventoryItem,
            stock: newStock,
            avgCost: Math.round(newAvgCost * 100) / 100,
            updatedAt: now,
            syncStatus: 'PENDING',
            version: inventoryItem.version + 1,
          } as unknown as Record<string, unknown>,
        })

        // Create reverse movement (ADJUSTMENT)
        const movementId = crypto.randomUUID()
        const movement: OfflineInventoryMovement = {
          id: movementId,
          type: 'ADJUSTMENT',
          quantity: -item.baseQty,
          previousStock: prevStock,
          newStock,
          referenceId: params.purchaseId,
          referenceType: 'PURCHASE_ORDER',
          notes: 'Hapus PO',
          outletId: params.outletId,
          inventoryItemId: item.inventoryItemId,
          userId: params.userId,
          syncStatus: 'PENDING',
          version: 1,
          updatedAt: now,
          createdAt: now,
          deletedAt: null,
        }
        await db.inventoryMovements.add(movement)
        syncEntries.push({
          entity: 'inventoryMovements',
          entityId: movementId,
          action: 'CREATE',
          payload: movement as unknown as Record<string, unknown>,
        })
      }

      // 5. Soft-delete all inventory batches for this PO
      for (const batch of batches) {
        await db.inventoryBatches.update(batch.id, {
          deletedAt: now,
          updatedAt: now,
          syncStatus: 'PENDING',
          version: batch.version + 1,
        })
        syncEntries.push({
          entity: 'inventoryBatches',
          entityId: batch.id,
          action: 'DELETE',
          payload: {
            id: batch.id,
            deletedAt: now,
          } as unknown as Record<string, unknown>,
        })
      }

      // 6. Soft-delete purchase items
      for (const item of items) {
        await db.purchaseItems.update(item.id, {
          deletedAt: now,
          updatedAt: now,
          syncStatus: 'PENDING',
          version: item.version + 1,
        })
        syncEntries.push({
          entity: 'purchaseItems',
          entityId: item.id,
          action: 'DELETE',
          payload: {
            id: item.id,
            deletedAt: now,
          } as unknown as Record<string, unknown>,
        })
      }

      // 7. Soft-delete purchase
      await db.purchases.update(params.purchaseId, {
        deletedAt: now,
        updatedAt: now,
        syncStatus: 'PENDING',
        version: purchase.version + 1,
      })
      syncEntries.push({
        entity: 'purchases',
        entityId: params.purchaseId,
        action: 'DELETE',
        payload: {
          id: params.purchaseId,
          deletedAt: now,
        } as unknown as Record<string, unknown>,
      })
    })

    // After transaction commits → enqueue to sync queue
    await syncEnqueueBatch(syncEntries)

    return { success: true }
  }
}