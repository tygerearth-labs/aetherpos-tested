import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { InventoryConsumptionService } from '@/lib/inventory-consumption-service'
import { emitAuditEvent, buildVoidEvent } from '@/lib/audit-v2'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'OWNER') {
      return safeJsonError('Only OWNER can void transactions', 403)
    }

    const outletId = user.outletId
    const userId = user.id
    const { id } = await params

    // Verify transaction belongs to this outlet
    const transaction = await db.transaction.findFirst({
      where: { id, outletId },
    })
    if (!transaction) {
      return safeJsonError('Transaction not found', 404)
    }

    // Check if already voided
    const existingVoid = await db.auditLog.findFirst({
      where: {
        entityType: 'TRANSACTION',
        entityId: id,
        action: 'VOID',
        outletId,
      },
    })
    if (existingVoid) {
      return safeJsonError('Transaction already voided', 400)
    }

    const body = await request.json()
    const { reason } = body as { reason?: string }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return safeJsonError('Reason is required for void', 400)
    }

    // Fetch transaction items for stock restoration
    const transactionItems = await db.transactionItem.findMany({
      where: { transactionId: id },
      select: { productId: true, productName: true, productSku: true, variantId: true, variantName: true, variantSku: true, qty: true },
    })

    // Fetch product & variant SKUs for audit logs (fallback for old transactions without snapshot SKU)
    const needsSkuLookup = transactionItems.some(i => !i.productSku && i.productId) || transactionItems.some(i => !i.variantSku && i.variantId)
    const productIds = [...new Set(transactionItems.map(i => i.productId).filter(Boolean))]
    const variantIds = [...new Set(transactionItems.filter(i => i.variantId).map(i => i.variantId!))]

    let productSkuMap = new Map<string, string | null>()
    let variantSkuMap = new Map<string, string | null>()

    if (needsSkuLookup) {
      const [productSkuArr, variantSkuArr] = await Promise.all([
        productIds.length > 0
          ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true } }).then(arr => new Map(arr.map(p => [p.id, p.sku])))
          : Promise.resolve(new Map()),
        variantIds.length > 0
          ? db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, sku: true } }).then(arr => new Map(arr.map(v => [v.id, v.sku])))
          : Promise.resolve(new Map()),
      ])
      productSkuMap = productSkuArr
      variantSkuMap = variantSkuArr
    }

    // Helper: get SKU from snapshot first, fallback to DB lookup
    const getProductSku = (item: typeof transactionItems[number]) =>
      (item as any).productSku || productSkuMap.get(item.productId!) || null
    const getVariantSku = (item: typeof transactionItems[number]) =>
      (item as any).variantSku || (item.variantId ? (variantSkuMap.get(item.variantId) || null) : null)

    // Determine which product IDs need parent stock recalculation (variant products).
    // P1-2 AUDIT-3 fix: only count items whose variantId is still non-null.
    // Items where variantId was SetNull'd by variant deletion (variantName snapshot
    // still present) must NOT contribute to parent recalc — their parent.stock is
    // already SUM(variants.stock) and should remain so.
    const variantProductIds = [...new Set(
      transactionItems.filter(i => i.variantId).map(i => i.productId).filter(Boolean)
    )]

    // P1-2 AUDIT-3 fix: detect items that were ORIGINALLY variant sales but whose
    // variantId was SetNull'd by a later variant deletion (full-replace edit).
    // These items cannot have their variant stock restored (variant record is gone),
    // and incrementing the parent Product.stock would be wrong because parent.stock
    // for a hasVariants=true product must always equal SUM(variants.stock).
    // The inventory (raw material) restoration in STEP 3 still works correctly
    // because it uses TransactionConsumption snapshots keyed by transactionId.
    const orphanedVariantItems = transactionItems.filter(i =>
      !i.variantId &&
      i.productId &&
      i.variantName && i.variantName.trim().length > 0
    )

    // Perform void in a transaction: restore stock + reverse inventory + reverse loyalty + audit logs
    await db.$transaction(async (tx) => {
      // ════════════════════════════════════════════════════════════
      // STEP 1: Restore product/variant stock
      // ════════════════════════════════════════════════════════════
      for (const item of transactionItems) {
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.qty } },
          })
        } else if (item.productId) {
          // P1-2 AUDIT-3 fix: if this item was originally a variant sale
          // (variantName snapshot present) but variantId is NULL, the variant
          // was deleted after the sale. Skip parent.stock increment — it would
          // inflate parent.stock beyond SUM(variants.stock) and break the
          // invariant that parent.stock == SUM(variants.stock) for variant products.
          const wasOriginallyVariantSale =
            !!(item.variantName && item.variantName.trim().length > 0)
          if (wasOriginallyVariantSale) {
            // Cannot restore variant stock — variant record was deleted.
            // Inventory (raw material) restoration still happens via STEP 3 snapshots.
            continue
          }
          // Normal non-variant product → safe to restore parent.stock
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.qty } },
          })
        }
      }

      // ════════════════════════════════════════════════════════════
      // STEP 2 (GAP 3): Recalculate parent product stock for variants
      // ════════════════════════════════════════════════════════════
      for (const productId of variantProductIds) {
        const aggResult = await tx.productVariant.aggregate({
          where: { productId, outletId },
          _sum: { stock: true },
        })
        await tx.product.update({
          where: { id: productId },
          data: { stock: aggResult._sum.stock || 0 },
        })
      }

      // ════════════════════════════════════════════════════════════
      // STEP 3 (GAP 1): Reverse inventory (bahan baku) consumption
      //   PREFER snapshot from TransactionConsumption — this restores exactly
      //   what was consumed at checkout, even if recipe changed later.
      //   FALLBACK to recalculation for old transactions without snapshots.
      // ════════════════════════════════════════════════════════════
      let inventoryRestoreMethod: 'SNAPSHOT' | 'RECALC' | 'NONE' = 'NONE'

      // Try snapshot-first approach
      await InventoryConsumptionService.restoreFromSnapshots(tx, {
        transactionId: id,
        invoiceNumber: transaction.invoiceNumber,
        outletId,
        userId,
      })
      // Check if snapshots were found by querying after the call
      // (restoreFromSnapshots returns void, but logs when no snapshots found)
      // We fetch the snapshot rows (not just count) so the VOID event can
      // include an "Inventory Restored" section without extra queries.
      const consumptionSnapshots = await tx.transactionConsumption.findMany({
        where: { transactionId: id },
        select: { itemName: true, baseUnit: true, quantityUsed: true },
      })
      const snapshotCount = consumptionSnapshots.length
      if (snapshotCount > 0) {
        inventoryRestoreMethod = 'SNAPSHOT'
      } else {
        // Fallback: recalculate from current composition (for pre-snapshot transactions)
        inventoryRestoreMethod = 'RECALC'
        const reversableItems = transactionItems.filter(i => i.productId)
        if (reversableItems.length > 0) {
          await InventoryConsumptionService.reverseForTransaction(tx, {
            items: reversableItems.map(item => ({
              productId: item.productId!,
              variantId: item.variantId,
              productName: item.productName,
              variantName: item.variantName || undefined,
              qty: item.qty,
            })),
            transactionId: id,
            invoiceNumber: transaction.invoiceNumber,
            outletId,
            userId,
          })
        }
      }

      // ════════════════════════════════════════════════════════════
      // STEP 3.5: FEFO — Restore batch consumption
      //   Only restores InventoryBatch.remainingQty (not InventoryItem.stock,
      //   which was already restored by step 3).
      // ════════════════════════════════════════════════════════════
      try {
        const { FEFOEngine } = await import('@/lib/fefo-engine')
        await FEFOEngine.restoreBatchesFromLogs(tx, {
          transactionId: id,
          invoiceNumber: transaction.invoiceNumber,
          outletId,
          userId,
        })
      } catch (batchError) {
        console.warn(`[Void] FEFO batch restore failed (non-fatal):`, batchError)
      }

      // ════════════════════════════════════════════════════════════
      // STEP 4 (GAP 2): Reverse loyalty points & customer totalSpend
      // ════════════════════════════════════════════════════════════
      if (transaction.customerId) {
        // Find loyalty logs for this transaction
        const loyaltyLogs = await tx.loyaltyLog.findMany({
          where: { transactionId: id },
          select: { id: true, type: true, points: true, description: true },
        })

        let netPointsDelta = 0

        for (const log of loyaltyLogs) {
          if (log.type === 'EARN') {
            // Earned points → reverse: decrement points
            netPointsDelta -= Math.abs(log.points)
          } else if (log.type === 'REDEEM') {
            // Redeemed points → reverse: increment points back
            netPointsDelta += Math.abs(log.points)
          }
        }

        if (netPointsDelta !== 0 || transaction.total > 0) {
          const customerUpdateData: { totalSpend?: { decrement: number }; points?: { increment: number } | { decrement: number } } = {}

          // Always reverse totalSpend
          if (transaction.total > 0) {
            customerUpdateData.totalSpend = { decrement: transaction.total }
          }

          // Reverse points
          if (netPointsDelta > 0) {
            customerUpdateData.points = { increment: netPointsDelta }
          } else if (netPointsDelta < 0) {
            customerUpdateData.points = { decrement: Math.abs(netPointsDelta) }
          }

          if (Object.keys(customerUpdateData).length > 0) {
            await tx.customer.update({
              where: { id: transaction.customerId },
              data: customerUpdateData,
            })
          }
        }

        // Create reverse loyalty logs
        if (loyaltyLogs.length > 0) {
          const reverseLogs = loyaltyLogs.map(log => ({
            type: log.type === 'EARN' ? 'REDEEM' as const : 'EARN' as const,
            points: -log.points,
            description: `[VOID] ${log.description}`,
            customerId: transaction.customerId,
            transactionId: id,
          }))
          await tx.loyaltyLog.createMany({ data: reverseLogs })
        }
      }

      // ════════════════════════════════════════════════════════════
      // STEP 5: Audit log — ONE VOID event per void (event-oriented V2).
      // ════════════════════════════════════════════════════════════
      // Replaces the legacy N RESTOCK rows + 1 VOID row. Now a void of an
      // N-item transaction produces exactly 1 VOID audit row that includes
      // the restored items, the inventory (raw-material) restore snapshot,
      // loyalty reversal, and any orphaned-variant warnings — all grouped
      // into UI-ready sections. InventoryMovement remains the technical
      // ledger (unchanged).
      await emitAuditEvent(
        tx,
        buildVoidEvent({
          transactionId: id,
          invoiceNumber: transaction.invoiceNumber,
          total: transaction.total,
          reason: reason.trim(),
          voidedBy: user.name || user.email,
          itemsRestored: transactionItems.map((i) => ({
            productName: i.productName,
            variantName: i.variantName ?? null,
            qty: i.qty,
            target: i.variantId
              ? ('VARIANT' as const)
              : i.variantName && i.variantName.trim().length > 0
                ? ('ORPHANED_VARIANT_SKIPPED' as const)
                : ('PRODUCT' as const),
          })),
          inventoryRestored: consumptionSnapshots.map((s) => ({
            itemName: s.itemName,
            baseUnit: s.baseUnit,
            quantityRestored: s.quantityUsed,
            method: inventoryRestoreMethod,
          })),
          inventoryRestoreMethod,
          loyaltyReversed: !!transaction.customerId,
          orphanedVariantItems: orphanedVariantItems.map((i) => ({
            productName: i.productName,
            variantName: i.variantName ?? null,
            qty: i.qty,
          })),
          outletId,
          userId,
        }),
      )
    }, { timeout: 15000 })

    return safeJson({ success: true, message: 'Transaction voided, stock restored, inventory reversed, loyalty adjusted' })
  } catch (error) {
    console.error('Void transaction error:', error)
    return safeJsonError('Failed to void transaction', 500)
  }
}