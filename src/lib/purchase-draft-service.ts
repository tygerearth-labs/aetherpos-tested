/**
 * purchase-draft-service.ts — Canonical transactional purchase persistence.
 *
 * `createPurchaseFromDraft(draft)` is the SINGLE entry point for creating a
 * PurchaseOrder + every downstream write. All three purchase creation flows
 * (manual form, Posting Langsung, Terapkan ke Form) converge here.
 *
 * ALL writes run inside ONE `$transaction`:
 *   1. Resolve + create new InventoryItems (for items with `newKey`).
 *   2. Validate supplier + capture name snapshot.
 *   3. Validate all inventory items exist.
 *   4. Generate order number (PO-YYYYMMDD-NNNN).
 *   5. Create PurchaseOrder + nested PurchaseOrderItems.
 *   6. Update InventoryItem.stock + avgCost + lastBusinessChangeAt.
 *   7. Create InventoryBatches (one per PO item, AVAILABLE status).
 *   8. Create InventoryMovements (PURCHASE, one per PO item).
 *   9. Emit audit event (V2 PURCHASE).
 *  10. Recalculate HPP for affected products.
 *  11. Recalculate sellable stock for linked Products/Variants.
 *
 * On ANY failure → full rollback. No orphan InventoryItems, no half-created PO,
 * no stale stock/movements. This replaces the historical 3-phase split where
 * new InventoryItems were created OUTSIDE the critical tx (orphan risk) and
 * audit/movements/recalc ran in separate non-critical txs (silent drift).
 */

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { recalculateAffectedProductStock } from '@/lib/comp-stock'
import { recalculateHppForAffectedProducts } from '@/lib/purchase-hpp'
import { buildPurchaseEvent, emitAuditEvent } from '@/lib/audit-v2'
import type { PurchaseDraft, PurchaseDraftItem } from '@/lib/purchase-draft'
import { validateCanonicalPurchaseUnits } from '@/lib/purchase-unit-resolver'

type TxClient = Prisma.TransactionClient

/**
 * Thrown for validation failures that should map to a specific HTTP status.
 * The API route catches this and returns `safeJsonError(message, status)`.
 */
export class PurchaseDraftError extends Error {
  constructor(message: string, public status: number = 500) {
    super(message)
    this.name = 'PurchaseDraftError'
  }
}

export interface CreatePurchaseFromDraftResult {
  purchaseOrder: Awaited<ReturnType<typeof db.purchaseOrder.create>>
  /** Only present when the draft contained `newKey` items. */
  importStats?: {
    newItemsCreated: number
    existingMatched: number
  }
}

// ────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────

interface ResolvedItem extends PurchaseDraftItem {
  /** Always set after resolution — the real InventoryItem.id to use. */
  inventoryItemId: string
}

interface StockUpdate {
  inventoryItemId: string
  name: string
  existingStock: number
  existingAvgCost: number
  addedBaseQty: number
  lineCost: number
  newStock: number
  newAvgCost: number
}

/**
 * Resolve `newKey` items into real InventoryItem.ids, creating new rows when
 * the name doesn't already exist in the outlet. Runs INSIDE the caller's tx
 * so new InventoryItems are atomic with the PO creation.
 *
 * Dedup by name (case-insensitive) within the batch: if two `newKey` items
 * share a name, the second is mapped to the first's resolved id.
 *
 * Returns `{ idMap, newItemsCreated, existingMatched }`.
 */
async function resolveNewItems(
  tx: TxClient,
  outletId: string,
  draftItems: PurchaseDraftItem[],
): Promise<{
  idMap: Map<string, string>
  newItemsCreated: number
  existingMatched: number
}> {
  const newKeyItems = draftItems.filter((i): i is PurchaseDraftItem & { newKey: string } =>
    i.inventoryItemId === null && i.newKey !== null,
  )
  const idMap = new Map<string, string>()
  let newItemsCreated = 0
  let existingMatched = 0

  if (newKeyItems.length === 0) return { idMap, newItemsCreated, existingMatched }

  // Dedup by name (case-insensitive) within the batch.
  const seenNames = new Map<string, string>() // lowerName → first newKey
  const deduped: Array<{ newKey: string; name: string; sku: string | null; baseUnit: string }> = []
  const dupKeyMap = new Map<string, string>() // dupKey → firstKey

  for (const item of newKeyItems) {
    const nameTrim = item.name.trim()
    if (!nameTrim) continue
    const nameLower = nameTrim.toLowerCase()
    if (seenNames.has(nameLower)) {
      dupKeyMap.set(item.newKey, seenNames.get(nameLower)!)
    } else {
      seenNames.set(nameLower, item.newKey)
      deduped.push({
        newKey: item.newKey,
        name: nameTrim,
        sku: item.sku?.trim() || null,
        baseUnit: item.baseUnit.trim() || 'pcs',
      })
    }
  }

  // Check which names already exist in DB (1 query, inside tx).
  const uniqueNames = [...new Set(deduped.map((i) => i.name))]
  const existing = await tx.inventoryItem.findMany({
    where: { outletId, name: { in: uniqueNames } },
    select: { id: true, name: true },
  })
  const existingByName = new Map(existing.map((e) => [e.name.toLowerCase(), e.id]))
  existingMatched = existing.length

  const toCreate: typeof deduped = []
  for (const item of deduped) {
    const nameLower = item.name.toLowerCase()
    const existingId = existingByName.get(nameLower)
    if (existingId) {
      idMap.set(item.newKey, existingId)
    } else {
      toCreate.push(item)
    }
  }

  // Create truly new items inside the tx (one by one — needed to capture ids
  // without a fragile fetch-back-by-name race). For typical Excel imports
  // (10-50 new items) this is fast; the tx holds for < 1s.
  for (const item of toCreate) {
    const created = await tx.inventoryItem.create({
      data: {
        name: item.name,
        sku: item.sku,
        baseUnit: item.baseUnit,
        stock: 0,
        avgCost: 0,
        lowStockAlert: 0,
        outletId,
        categoryId: null,
      },
    })
    idMap.set(item.newKey, created.id)
    newItemsCreated++
  }

  // Map duplicates to first occurrence's ID.
  for (const [dupKey, firstKey] of dupKeyMap) {
    const id = idMap.get(firstKey)
    if (id) idMap.set(dupKey, id)
  }

  return { idMap, newItemsCreated, existingMatched }
}

/**
 * Build the merged stock-update map (one entry per distinct InventoryItem).
 * Multiple PO items referencing the same InventoryItem collapse into a single
 * stock update, using the original `existingStock` as the baseline.
 */
function buildStockUpdateMap(
  resolvedItems: ResolvedItem[],
  invItemMap: Map<string, { id: string; name: string; stock: number; avgCost: number; baseUnit: string }>,
): Map<string, StockUpdate> {
  const map = new Map<string, StockUpdate>()
  for (const item of resolvedItems) {
    const inv = invItemMap.get(item.inventoryItemId)!
    const existing = map.get(item.inventoryItemId)
    if (existing) {
      existing.addedBaseQty += item.baseQty
      existing.lineCost += item.totalCost
      existing.newStock = existing.existingStock + existing.addedBaseQty
      existing.newAvgCost = existing.newStock > 0
        ? (existing.existingStock * existing.existingAvgCost + existing.lineCost) / existing.newStock
        : 0
    } else {
      const addedBaseQty = item.baseQty
      const lineCost = item.totalCost
      const newStock = inv.stock + addedBaseQty
      const newAvgCost = newStock > 0
        ? (inv.stock * inv.avgCost + lineCost) / newStock
        : 0
      map.set(item.inventoryItemId, {
        inventoryItemId: item.inventoryItemId,
        name: inv.name,
        existingStock: inv.stock,
        existingAvgCost: inv.avgCost,
        addedBaseQty,
        lineCost,
        newStock,
        newAvgCost,
      })
    }
  }
  return map
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Create a PurchaseOrder + all downstream writes from a canonical
 * `PurchaseDraft`. See module docstring for the full write sequence.
 *
 * @throws {PurchaseDraftError} for validation failures (status 400/404/409).
 * @throws Prisma errors for unexpected DB failures (caller maps P2002 → 409).
 */
export async function createPurchaseFromDraft(
  draft: PurchaseDraft,
): Promise<CreatePurchaseFromDraftResult> {
  // ── Pre-tx validation (cheap, no DB round-trip) ──
  if (!draft.items || draft.items.length === 0) {
    throw new PurchaseDraftError('Tidak ada item valid untuk pembelian', 400)
  }
  for (const item of draft.items) {
    if (!item.inventoryItemId && !item.newKey) {
      throw new PurchaseDraftError('Setiap item harus memiliki inventoryItemId atau newKey', 400)
    }
    if (!item.purchaseQty || item.purchaseQty <= 0) {
      throw new PurchaseDraftError('Jumlah pembelian harus lebih dari 0', 400)
    }
    if (item.unitCost === undefined || item.unitCost < 0) {
      throw new PurchaseDraftError('Harga satuan tidak boleh negatif', 400)
    }
    if (!item.totalCost || item.totalCost <= 0) {
      throw new PurchaseDraftError('Total biaya item harus lebih dari 0', 400)
    }

    // ── Canonical unit enforcement (independent of frontend validation) ──
    // Rejects: unsupported unit, unresolved mapping, missing baseUnit,
    // conversionFactor <= 0, inconsistent baseQty. See purchase-unit-resolver.ts.
    const unitViolations = validateCanonicalPurchaseUnits(
      {
        purchaseQty: item.purchaseQty,
        purchaseUnit: item.purchaseUnit,
        baseQty: item.baseQty,
        baseUnit: item.baseUnit,
        conversionFactor: item.conversionFactor,
      },
      item.name,
    )
    if (unitViolations.length > 0) {
      throw new PurchaseDraftError(unitViolations[0].message, 400)
    }
  }

  return db.$transaction(
    async (tx) => {
      // ── 1. Validate supplier + capture name snapshot ──
      let supplierName: string | null = null
      if (draft.supplierId) {
        const supplier = await tx.supplier.findFirst({
          where: { id: draft.supplierId, outletId: draft.outletId },
          select: { name: true },
        })
        if (!supplier) throw new PurchaseDraftError('Supplier not found', 400)
        supplierName = supplier.name
      }

      // ── 2. Resolve + create new InventoryItems ──
      const { idMap, newItemsCreated, existingMatched } = await resolveNewItems(
        tx,
        draft.outletId,
        draft.items,
      )

      // ── 3. Build resolved items (every row has a real inventoryItemId) ──
      const resolvedItems: ResolvedItem[] = draft.items.map((item) => {
        const realId = item.inventoryItemId ?? (item.newKey ? idMap.get(item.newKey) : undefined)
        if (!realId) {
          throw new PurchaseDraftError(
            `Tidak dapat menemukan/membuat inventory item untuk "${item.name}"`,
            400,
          )
        }
        return { ...item, inventoryItemId: realId }
      })

      // ── 4. Validate all inventory items exist ──
      const uniqueItemIds = [...new Set(resolvedItems.map((i) => i.inventoryItemId))]
      const inventoryItems = await tx.inventoryItem.findMany({
        where: { id: { in: uniqueItemIds }, outletId: draft.outletId },
        select: { id: true, name: true, stock: true, avgCost: true, baseUnit: true },
      })
      if (inventoryItems.length !== uniqueItemIds.length) {
        const found = new Set(inventoryItems.map((ii) => ii.id))
        const missing = uniqueItemIds.filter((id) => !found.has(id))
        console.error('[createPurchaseFromDraft] Items not found:', missing)
        throw new PurchaseDraftError('Satu atau lebih inventory item tidak ditemukan', 400)
      }
      const invItemMap = new Map(inventoryItems.map((ii) => [ii.id, ii]))

      // ── 5. Generate order number ──
      const now = new Date()
      const yyyy = now.getFullYear()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const todayStart = new Date(yyyy, now.getMonth(), now.getDate())
      const count = await tx.purchaseOrder.count({
        where: { outletId: draft.outletId, createdAt: { gte: todayStart } },
      })
      const orderNumber = `PO-${yyyy}${mm}${dd}-${String(Math.min(count + 1, 9999)).padStart(4, '0')}`

      const totalCost = resolvedItems.reduce((sum, i) => sum + i.totalCost, 0)

      // ── 6. Create PurchaseOrder + nested items ──
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId: draft.supplierId || null,
          totalCost,
          notes: draft.notes?.trim() || null,
          outletId: draft.outletId,
          userId: draft.userId,
          items: {
            create: resolvedItems.map((item) => {
              const invItem = invItemMap.get(item.inventoryItemId)!
              return {
                inventoryItemId: item.inventoryItemId,
                name: invItem.name,
                purchaseQty: item.purchaseQty,
                purchaseUnit: item.purchaseUnit,
                baseQty: item.baseQty,
                baseUnit: item.baseUnit,
                unitCost: item.unitCost,
                totalCost: item.totalCost,
                batch: item.batch?.trim() || null,
                expiredDate: item.expiredDate ? new Date(item.expiredDate) : null,
                outletId: draft.outletId,
              }
            }),
          },
        },
        include: {
          items: true,
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      })

      // ── 7. Build stock-update map + apply ──
      const updateMap = buildStockUpdateMap(resolvedItems, invItemMap)
      for (const [id, update] of updateMap) {
        await tx.inventoryItem.update({
          where: { id },
          data: {
            stock: update.newStock,
            avgCost: update.newAvgCost,
            lastBusinessChangeAt: now,
          },
        })
      }

      // ── 8. Create InventoryBatches (one per PO item) ──
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '')
      let autoBatchCounter = await tx.inventoryBatch.count({
        where: { outletId: draft.outletId, batchNumber: { startsWith: `AUTO-${dateStr}` } },
      })

      const batchData: Array<{
        batchNumber: string
        inventoryItemId: string
        initialQty: number
        remainingQty: number
        unitCost: number
        expiredDate: Date | null
        purchaseOrderId: string
        supplierId: string | null
        supplierName: string | null
        status: string
        outletId: string
      }> = []

      for (const item of resolvedItems) {
        let batchNumber: string
        if (item.batch && item.batch.trim()) {
          batchNumber = item.batch.trim()
        } else {
          autoBatchCounter++
          batchNumber = `AUTO-${dateStr}-${String(autoBatchCounter).padStart(4, '0')}`
        }
        batchData.push({
          batchNumber,
          inventoryItemId: item.inventoryItemId,
          initialQty: item.baseQty,
          remainingQty: item.baseQty,
          unitCost: item.unitCost,
          expiredDate: item.expiredDate ? new Date(item.expiredDate) : null,
          purchaseOrderId: purchaseOrder.id,
          supplierId: draft.supplierId || null,
          supplierName,
          status: 'AVAILABLE',
          outletId: draft.outletId,
        })
      }

      if (batchData.length > 0) {
        const CHUNK = 100
        for (let i = 0; i < batchData.length; i += CHUNK) {
          await tx.inventoryBatch.createMany({ data: batchData.slice(i, i + CHUNK) })
        }
      }

      // ── 9. Create InventoryMovements (PURCHASE, one per PO item) ──
      const movementData = resolvedItems.map((item) => {
        const upd = updateMap.get(item.inventoryItemId)!
        return {
          type: 'PURCHASE' as const,
          inventoryItemId: item.inventoryItemId,
          quantity: item.baseQty,
          previousStock: upd.existingStock,
          newStock: upd.newStock,
          referenceId: purchaseOrder.id,
          referenceType: 'PURCHASE_ORDER' as const,
          notes: `Pembelian: ${upd.name} (${orderNumber})${item.batch ? ` [Batch: ${item.batch}]` : ''}${item.expiredDate ? ` [Exp: ${item.expiredDate.split('T')[0]}]` : ''}`,
          outletId: draft.outletId,
          userId: draft.userId,
        }
      })
      {
        const CHUNK = 100
        for (let i = 0; i < movementData.length; i += CHUNK) {
          await tx.inventoryMovement.createMany({ data: movementData.slice(i, i + CHUNK) })
        }
      }

      // ── 10. Emit audit event (V2 PURCHASE) ──
      await emitAuditEvent(
        tx,
        buildPurchaseEvent({
          purchaseOrderId: purchaseOrder.id,
          orderNumber,
          supplierName: supplierName || undefined,
          items: resolvedItems.map((u) => ({
            name: invItemMap.get(u.inventoryItemId)!.name,
            qty: u.baseQty,
            unit: invItemMap.get(u.inventoryItemId)!.baseUnit,
            unitCost: u.unitCost,
            batchNumber: u.batch || undefined,
            expiredDate: u.expiredDate || undefined,
            lineTotal: u.totalCost,
          })),
          totalValue: totalCost,
          stockMovementCount: resolvedItems.length,
          hppImpactNote:
            'avgCost updated via weighted purchase cost; HPP + sellable stock recalculated in same tx.',
          outletId: draft.outletId,
          userId: draft.userId,
        }),
      )

      // ── 11. Recalculate HPP + sellable stock for linked products ──
      const affectedIds = [...updateMap.keys()]
      if (affectedIds.length > 0) {
        await recalculateHppForAffectedProducts(tx, affectedIds)
        await recalculateAffectedProductStock(tx, draft.outletId, affectedIds)
      }

      return {
        purchaseOrder,
        importStats:
          newItemsCreated > 0 || existingMatched > 0
            ? { newItemsCreated, existingMatched }
            : undefined,
      }
    },
    { timeout: 60000 },
  )
}
