import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/safe-response'

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
      select: { productId: true, productName: true, variantId: true, variantName: true, qty: true },
    })

    // Perform void in a transaction: restore stock + create audit logs
    await db.$transaction(async (tx) => {
      // Restore stock for each item
      for (const item of transactionItems) {
        if (item.variantId) {
          // Increment variant stock
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.qty } },
          })
        } else {
          // Increment parent product stock
          await tx.product.update({
            where: { id: item.productId! },
            data: { stock: { increment: item.qty } },
          })
        }
      }

      // Fetch updated stocks for audit logs
      const productIds = transactionItems.filter(i => !i.variantId).map(i => i.productId!).filter(Boolean)
      const variantIds = transactionItems.filter(i => i.variantId).map(i => i.variantId!)

      const productStockMap = new Map<string, number>()
      if (productIds.length > 0) {
        const updatedProducts = await tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, stock: true },
        })
        for (const p of updatedProducts) productStockMap.set(p.id, p.stock)
      }

      const variantStockMap = new Map<string, number>()
      if (variantIds.length > 0) {
        const updatedVariants = await tx.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, stock: true },
        })
        for (const v of updatedVariants) variantStockMap.set(v.id, v.stock)
      }

      // Batch create audit logs for stock restoration
      await tx.auditLog.createMany({
        data: transactionItems.map(item => {
          const isVariant = !!item.variantId
          return {
            action: 'RESTOCK' as const,
            entityType: isVariant ? 'VARIANT' as const : 'PRODUCT' as const,
            entityId: isVariant ? item.variantId! : item.productId!,
            details: JSON.stringify({
              reason: `Void transaksi ${transaction.invoiceNumber}`,
              productName: item.productName,
              variantName: item.variantName ?? undefined,
              quantityAdded: item.qty,
              newStock: isVariant
                ? (variantStockMap.get(item.variantId!) ?? 0)
                : (productStockMap.get(item.productId!) ?? 0),
            }),
            outletId,
            userId,
          }
        }),
      })

      // Create void audit log
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
            itemsRestored: transactionItems.map(i => ({
              productName: i.productName,
              variantName: i.variantName ?? undefined,
              qty: i.qty,
            })),
          }),
          outletId,
          userId,
        },
      })
    }, { timeout: 10000 })

    return safeJson({ success: true, message: 'Transaction voided, stock restored' })
  } catch (error) {
    console.error('Void transaction error:', error)
    return safeJsonError('Failed to void transaction', 500)
  }
}
