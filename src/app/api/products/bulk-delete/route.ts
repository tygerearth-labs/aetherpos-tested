import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLogMany } from '@/lib/safe-audit'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya owner yang bisa menghapus produk', 403)
    }

    const outletId = user.outletId
    const userId = user.id
    const body = await request.json()
    const { productIds, selectAllMode } = body

    if (!selectAllMode && (!Array.isArray(productIds) || productIds.length === 0)) {
      return safeJsonError('Product IDs diperlukan', 400)
    }

    if (selectAllMode && (!Array.isArray(productIds) || productIds.length === 0)) {
      return safeJsonError('Setidaknya satu produk harus dipilih', 400)
    }

    const maxDelete = 500
    if (productIds.length > maxDelete) {
      return safeJsonError(`Maksimal ${maxDelete} produk yang bisa dihapus sekaligus`, 400)
    }

    // Delete in a transaction: compositions, variants, then products
    // TransactionItem rows are preserved — Prisma's onDelete: SetNull
    // will nullify productId/variantId, but snapshot fields (productName,
    // variantName, price, qty, subtotal) remain intact.
    const { count: deletedCount, productsForAudit, variantIds } = await db.$transaction(async (tx) => {
      // Get all product IDs to delete (including all if selectAllMode)
      const idsToDelete = selectAllMode
        ? (await tx.product.findMany({
            where: { outletId },
            select: { id: true },
          })).map((p) => p.id)
        : productIds

      if (idsToDelete.length === 0) return { count: 0, productsForAudit: [], variantIds: [] }

      // Delete product compositions (avoid orphan FK refs in SQLite)
      await tx.productComposition.deleteMany({
        where: { productId: { in: idsToDelete } },
      })

      // Fetch product info for audit log BEFORE deleting
      const productsForAudit = await tx.product.findMany({
        where: { id: { in: idsToDelete }, outletId },
        select: { id: true, name: true, price: true, stock: true, sku: true, hasVariants: true },
      })

      // Fetch variant info for audit log BEFORE deleting
      const variantInfo = await tx.productVariant.findMany({
        where: { productId: { in: idsToDelete } },
        select: { id: true, productId: true, name: true, price: true },
      })

      // Delete the products (variants cascade auto-delete)
      const result = await tx.product.deleteMany({
        where: { id: { in: idsToDelete }, outletId },
      })

      return { count: result.count, productsForAudit, variantIds: variantInfo }
    })

    // Create audit logs for deleted products (non-blocking, outside transaction)
    if (productsForAudit.length > 0) {
      const variantMap = new Map(variantIds.map((v) => [v.productId, v]))
      await safeAuditLogMany(productsForAudit.map((p) => {
        const productVariants = variantMap.get(p.id)
        return {
          action: 'DELETE' as const,
          entityType: 'PRODUCT' as const,
          entityId: p.id,
          details: JSON.stringify({
            productName: p.name,
            price: p.price,
            stock: p.stock,
            sku: p.sku,
            hasVariants: !!p.hasVariants,
            variantCount: productVariants ? productVariants.filter((v) => v.productId === p.id).length : 0,
            variantNames: productVariants?.filter((v) => v.productId === p.id).map((v) => v.name) || [],
            deleteType: 'BULK',
          }),
          outletId,
          userId: user.id,
        }
      }))
    }

    return safeJson({ deletedCount })
  } catch (error) {
    console.error('Bulk delete error:', error)
    return safeJsonError('Gagal menghapus produk')
  }
}
