/**
 * purchase-mutation-safety.ts — Canonical purchase mutation safety evaluator
 *
 * Single source of truth for "can this PurchaseOrder be edited / deleted?".
 *
 * WHY THIS EXISTS
 * ---------------
 * The PUT /api/purchases/[id] and DELETE /api/purchases/[id] handlers
 * previously guarded only on:
 *   1. Stock sufficiency (invItem.stock < baseQty → throw)
 *   2. Batch consumption (FEFOEngine.deleteBatchesForPurchase throws if
 *      remainingQty < initialQty)
 *
 * Those guards catch the immediate "can't reverse stock" case but MISS
 * several downstream-dependency cases that would leave derived caches
 * (Product.stock, ProductVariant.hpp, InventoryItem.avgCost, batch
 * remainingQty) inconsistent after a reverse:
 *   - PO item's inventoryItem is used in a ProductComposition (recipe)
 *     → editing/deleting the PO changes the inventory item's avgCost,
 *       but the composition's parent Product.hpp is NOT recalculated
 *       correctly if the composition has already been used in sales.
 *   - PO item's inventoryItem has TransactionConsumption rows (sold)
 *     → the sale already happened at the old avgCost; reversing the
 *       purchase would retroactively change COGS.
 *   - PO's batches have BatchConsumptionLog rows (FEFO consumed)
 *     → can't delete a batch that was partially consumed without
 *       destroying the consumption audit trail.
 *   - PO item's inventoryItem was transferred to another outlet
 *     → the transferred stock is now in another outlet's books;
 *       reversing the source PO would create negative stock.
 *   - PO's batches are EXPIRED or DISCARDED (waste)
 *     → the waste already happened; can't un-receive the batch.
 *   - Any InventoryMovement (adjustment, opname, consumption, transfer)
 *     happened for these items AFTER the PO was created (excluding the
 *     PO's own PURCHASE movement) → the derived stock/avgCost cache has
 *     moved on; a reverse would desync it.
 *
 * This evaluator runs all those checks in parallel (one round-trip) and
 * returns a structured result. It is TX-AWARE: pass a `tx` to run inside
 * an open $transaction (sees uncommitted writes), or omit to use the
 * global `db` (standalone reads).
 *
 * The existing in-tx stock + FEFO throws REMAIN as defense-in-depth —
 * they catch race conditions between the safety check and the actual
 * mutation.
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

type TxClient = Prisma.TransactionClient

export interface PurchaseMutationSafety {
  /** Safe to edit (PUT). Requires full reverse capability + no downstream deps. */
  canEdit: boolean
  /** Safe to delete (DELETE). Same preconditions as canEdit (both fully reverse). */
  canDelete: boolean
  /** Safe to reverse stock (precondition for both edit + delete). */
  canReverse: boolean
  /** Human-readable Indonesian blockers, e.g. "2 item terhubung ke produk (komposisi)". */
  reasons: string[]
  /** Structured counts for UI grouping. All per-PO (scoped to this PO's items/batches). */
  blockers: {
    compositionLinks: number
    transactionConsumption: number
    batchConsumption: number
    batchPartiallyConsumed: number
    subsequentMovements: number
    transferLinks: number
    wasteOrExpiry: number
    stockOpname: number
    insufficientStock: number
  }
}

/**
 * Evaluate whether a PurchaseOrder can be safely edited or deleted.
 *
 * @param purchaseId  The PO id to evaluate.
 * @param txOrDb      A Prisma transaction client (to run inside a $transaction)
 *                    or the global `db` (default, for standalone reads).
 * @returns           The safety result, or `null` if the PO doesn't exist.
 */
export async function evaluatePurchaseMutationSafety(
  purchaseId: string,
  txOrDb: TxClient | typeof db = db,
): Promise<PurchaseMutationSafety | null> {
  // ── 1. Fetch the PO with its items ──
  const po = await txOrDb.purchaseOrder.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          inventoryItemId: true,
          baseQty: true,
        },
      },
    },
  })

  if (!po) return null

  const inventoryItemIds = [...new Set(po.items.map((i) => i.inventoryItemId))]
  const hasItems = inventoryItemIds.length > 0

  // ── 2. Run all independent queries in parallel (one round-trip) ──
  const [
    compositionLinks,
    transactionConsumption,
    poBatches,
    transferLinks,
    subsequentMovements,
    stockOpname,
    invItems,
  ] = await Promise.all([
    hasItems
      ? txOrDb.productComposition.count({
          where: { inventoryItemId: { in: inventoryItemIds } },
        })
      : Promise.resolve(0),
    hasItems
      ? txOrDb.transactionConsumption.count({
          where: { inventoryItemId: { in: inventoryItemIds } },
        })
      : Promise.resolve(0),
    txOrDb.inventoryBatch.findMany({
      where: { purchaseOrderId: purchaseId },
      select: { id: true, initialQty: true, remainingQty: true, status: true },
    }),
    hasItems
      ? txOrDb.inventoryTransferItem.count({
          where: { inventoryItemId: { in: inventoryItemIds } },
        })
      : Promise.resolve(0),
    hasItems
      ? txOrDb.inventoryMovement.count({
          where: {
            inventoryItemId: { in: inventoryItemIds },
            createdAt: { gt: po.createdAt },
            // Exclude the PO's own PURCHASE / edit-reapply movements
            NOT: {
              referenceType: 'PURCHASE_ORDER',
              referenceId: purchaseId,
            },
          },
        })
      : Promise.resolve(0),
    hasItems
      ? txOrDb.inventoryMovement.count({
          where: {
            inventoryItemId: { in: inventoryItemIds },
            type: 'STOCK_OPNAME',
            createdAt: { gt: po.createdAt },
          },
        })
      : Promise.resolve(0),
    hasItems
      ? txOrDb.inventoryItem.findMany({
          where: { id: { in: inventoryItemIds } },
          select: { id: true, stock: true },
        })
      : Promise.resolve([] as { id: string; stock: number }[]),
  ])

  // ── 3. batchConsumption: count of BatchConsumptionLog for the PO's batches ──
  // (Depends on poBatches, so run after Promise.all resolves.)
  const batchIds = poBatches.map((b) => b.id)
  const batchConsumption =
    batchIds.length === 0
      ? 0
      : await txOrDb.batchConsumptionLog.count({
          where: { inventoryBatchId: { in: batchIds } },
        })

  // ── 4. Derive batch-level blockers from poBatches ──
  const batchPartiallyConsumed = poBatches.filter(
    (b) => b.remainingQty < b.initialQty,
  ).length
  const wasteOrExpiry = poBatches.filter(
    (b) => b.status === 'EXPIRED' || b.status === 'DISCARDED',
  ).length

  // ── 5. insufficientStock: count of PO items where current stock < baseQty ──
  // Only count items that still exist — orphaned items (inventoryItem deleted)
  // are skipped by the existing DELETE handler, so they must not block here.
  const invStockMap = new Map(invItems.map((i) => [i.id, i.stock]))
  let insufficientStock = 0
  for (const item of po.items) {
    if (!invStockMap.has(item.inventoryItemId)) continue // orphaned, skip
    const currentStock = invStockMap.get(item.inventoryItemId)!
    if (currentStock < item.baseQty) {
      insufficientStock++
    }
  }

  // ── 6. Assemble blockers struct ──
  const blockers = {
    compositionLinks,
    transactionConsumption,
    batchConsumption,
    batchPartiallyConsumed,
    subsequentMovements,
    transferLinks,
    wasteOrExpiry,
    stockOpname,
    insufficientStock,
  }

  // ── 7. Compute canReverse / canEdit / canDelete ──
  // canReverse: stock must be sufficient to give back, and no batch may be
  //             partially or fully consumed (FEFO integrity).
  const canReverse =
    insufficientStock === 0 &&
    batchPartiallyConsumed === 0 &&
    batchConsumption === 0

  // canEdit / canDelete: full reverse capability + no downstream dependencies.
  // Edit reverses old state then reapplies new — same reverse precondition
  // as delete. Both are blocked by any downstream dep that would desync a
  // derived cache (composition links, transaction consumption, transfers,
  // waste/expiry, subsequent stock movements).
  const canEdit =
    canReverse &&
    compositionLinks === 0 &&
    transactionConsumption === 0 &&
    transferLinks === 0 &&
    wasteOrExpiry === 0 &&
    stockOpname === 0 &&
    subsequentMovements === 0

  const canDelete = canEdit

  // ── 8. Build human-readable reasons (Indonesian) ──
  const reasons: string[] = []
  if (compositionLinks > 0) {
    reasons.push(
      `${compositionLinks} item terhubung ke produk (komposisi)`,
    )
  }
  if (transactionConsumption > 0) {
    reasons.push(`${transactionConsumption} item sudah dipakai transaksi`)
  }
  if (batchConsumption > 0) {
    reasons.push(`${batchConsumption} batch sudah dikonsumsi transaksi`)
  }
  if (batchPartiallyConsumed > 0) {
    reasons.push(`${batchPartiallyConsumed} batch sudah dipakai sebagian`)
  }
  if (transferLinks > 0) {
    reasons.push(
      `${transferLinks} item sudah ditransfer ke outlet lain`,
    )
  }
  if (wasteOrExpiry > 0) {
    reasons.push(`${wasteOrExpiry} batch sudah expired/dibusuk`)
  }
  if (insufficientStock > 0) {
    reasons.push(
      `Stok ${insufficientStock} item tidak mencukupi untuk pembatalan`,
    )
  }
  // stockOpname is a SUBSET of subsequentMovements — emit only ONE reason
  // to avoid double-counting in the UI. Prefer the more specific opname
  // message when present; fall back to the generic movement message.
  if (stockOpname > 0) {
    reasons.push(
      `${stockOpname} sesi stock opname terjadi setelah pembelian ini`,
    )
  } else if (subsequentMovements > 0) {
    reasons.push(
      `${subsequentMovements} gerakan stok terjadi setelah pembelian ini`,
    )
  }

  return { canEdit, canDelete, canReverse, reasons, blockers }
}
