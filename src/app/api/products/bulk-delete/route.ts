import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'

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

    // Delete in a transaction: variants, transaction items references, then products
    const deletedCount = await db.$transaction(async (tx) => {
      // Get all product IDs to delete (including all if selectAllMode)
      const idsToDelete = selectAllMode
        ? (await tx.product.findMany({
            where: { outletId },
            select: { id: true },
          })).map((p) => p.id)
        : productIds

      if (idsToDelete.length === 0) return 0

      // Delete transaction items referencing these products
      await tx.transactionItem.deleteMany({
        where: { productId: { in: idsToDelete } },
      })

      // Delete product variants
      await tx.productVariant.deleteMany({
        where: { productId: { in: idsToDelete } },
      })

      // Delete audit logs for these products and their variants
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { entityType: 'PRODUCT', entityId: { in: idsToDelete } },
            { entityType: 'VARIANT', entityId: { in: idsToDelete } },
          ],
        },
      })

      // Delete the products
      const result = await tx.product.deleteMany({
        where: { id: { in: idsToDelete }, outletId },
      })

      return result.count
    })

    return safeJson({ deletedCount })
  } catch (error) {
    console.error('Bulk delete error:', error)
    return safeJsonError('Gagal menghapus produk')
  }
}
