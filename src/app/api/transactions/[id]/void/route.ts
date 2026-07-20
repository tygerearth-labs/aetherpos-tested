import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { InventoryConsumptionService } from '@/lib/inventory-consumption-service'

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
      const snapshotCount = await tx.transactionConsumption.count({
        where: { transactionId: id },
      })
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
      // STEP 5: Fetch updated stocks for audit logs
      // ════════════════════════════════════════════════════════════
      const restockProductIds = transactionItems.filter(i => !i.variantId).map(i => i.productId!).filter(Boolean)
      const restockVariantIds = transactionItems.filter(i => i.variantId).map(i => i.variantId!)

      const productStockMap = new Map<string, number>()
      if (restockProductIds.length > 0) {
        const updatedProducts = await tx.product.findMany({
          where: { id: { in: restockProductIds } },
          select: { id: true, stock: true },
        })
        for (const p of updatedProducts) productStockMap.set(p.id, p.stock)
      }

      const variantStockMap = new Map<string, number>()
      if (restockVariantIds.length > 0) {
        const updatedVariants = await tx.productVariant.findMany({
          where: { id: { in: restockVariantIds } },
          select: { id: true, stock: true },
        })
        for (const v of updatedVariants) variantStockMap.set(v.id, v.stock)
      }

      // ════════════════════════════════════════════════════════════
      // STEP 6: Create audit logs
      // ════════════════════════════════════════════════════════════
      // RESTOCK logs per item
      await tx.auditLog.createMany({
        data: transactionItems.map(item => {
          const isVariant = !!item.variantId
          const newStock = isVariant
            ? (variantStockMap.get(item.variantId!) ?? 0)
            : (productStockMap.get(item.productId!) ?? 0)
          const previousStock = newStock - item.qty
          return {
            action: 'RESTOCK' as const,
            entityType: isVariant ? 'VARIANT' as const : 'PRODUCT' as const,
            entityId: isVariant ? item.variantId! : item.productId!,
            details: JSON.stringify({
              reason: `Void transaksi ${transaction.invoiceNumber}`,
              productName: item.productName,
              productSku: getProductSku(item),
              variantName: item.variantName ?? undefined,
              variantSku: getVariantSku(item),
              quantityAdded: item.qty,
              previousStock,
              newStock,
            }),
            outletId,
            userId,
          }
        }),
      })

      // VOID audit log (main record)
      await tx.auditLog.create({
        data: {
          action: 'VOID',
          entityType: 'TRANSACTION',
          entityId: id,
          details: JSON.stringify({
            invoiceNumber: transaction.invoiceNumber,
            total: transaction.total,
            reason: reason.trim(),
            voidedBy: user.name || user.email,
            voidedAt: new Date().toISOString(),
            inventoryRestored: true,
            inventoryRestoreMethod,
            loyaltyReversed: !!transaction.customerId,
            parentStockRecalculated: variantProductIds.length > 0,
            // P1-2 AUDIT-3: surface orphaned variant items explicitly so auditors
            // can see which line items had their variant stock skipped (variant was
            // deleted between sale and void).
            orphanedVariantItems: orphanedVariantItems.map(i => ({
              productName: i.productName,
              productSku: getProductSku(i),
              variantName: i.variantName,
              variantSku: getVariantSku(i),
              qty: i.qty,
              note: 'Variant was deleted after sale; variant stock NOT restored. Raw-material inventory was restored via snapshot.',
            })),
            itemsRestored: transactionItems.map(i => ({
              productName: i.productName,
              productSku: getProductSku(i),
              variantName: i.variantName ?? undefined,
              variantSku: getVariantSku(i),
              qty: i.qty,
              stockRestoreTarget:
                i.variantId ? 'VARIANT' :
                (i.variantName && i.variantName.trim().length > 0 ? 'ORPHANED_VARIANT_SKIPPED' : 'PRODUCT'),
            })),
          }),
          outletId,
          userId,
        },
      })
    }, { timeout: 15000 })

    return safeJson({ success: true, message: 'Transaction voided, stock restored, inventory reversed, loyalty adjusted' })
  } catch (error) {
    console.error('Void transaction error:', error)
    return safeJsonError('Failed to void transaction', 500)
  }
}