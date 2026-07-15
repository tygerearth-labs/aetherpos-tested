import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLogMany } from '@/lib/safe-audit'

export async function POST(request: NextRequest) {
  // We track deletedCount outside the try/catch so we can return
  // success even if post-deletion operations (audit logs) fail.
  let deletedCount = 0

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
    const { productIds, selectAllMode, filter } = body

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

    // Build the where clause for selectAllMode using the same filters
    // as the products list API, so we only delete what the user sees.
    const selectAllWhere: Record<string, unknown> = { outletId }
    if (filter?.search) {
      selectAllWhere.OR = [
        { name: { contains: filter.search } },
        { sku: { contains: filter.search } },
        { barcode: { contains: filter.search } },
        { unit: { contains: filter.search } },
        { category: { name: { contains: filter.search } } },
        { variants: { some: { name: { contains: filter.search } } } },
        { variants: { some: { sku: { contains: filter.search } } } },
        { variants: { some: { barcode: { contains: filter.search } } } },
      ]
    }
    if (filter?.categoryId) {
      selectAllWhere.categoryId = filter.categoryId
    }

    // Delete in a transaction: compositions, variants, then products
    // TransactionItem rows are preserved — Prisma's onDelete: SetNull
    // will nullify productId/variantId, but snapshot fields (productName,
    // variantName, price, qty, subtotal) remain intact.
    const { count, productsForAudit, variantIds } = await db.$transaction(async (tx) => {
      // Get all product IDs to delete (using filters when selectAllMode)
      const idsToDelete = selectAllMode
        ? (await tx.product.findMany({
            where: selectAllWhere,
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

    // Store deletedCount IMMEDIATELY after successful transaction
    // This ensures we return success even if audit logging fails
    deletedCount = count

    // Create audit logs for deleted products (non-blocking, outside transaction)
    // Wrapped in try/catch to prevent audit failures from affecting the response
    if (productsForAudit.length > 0) {
      try {
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
      } catch (auditError) {
        // Audit log failure should NOT cause the delete to appear failed
        // Products are already deleted, just log the warning
        console.warn('[bulk-delete] Failed to create audit logs (non-critical):', auditError)
      }
    }

    // Return success with the actual deleted count
    return safeJson({ deletedCount })
  } catch (error) {
    console.error('Bulk delete error:', error)
    // If we have a deletedCount > 0, it means the transaction succeeded
    // but something else failed - still return success
    if (deletedCount > 0) {
      console.warn('[bulk-delete] Transaction succeeded but post-processing failed, returning success with deletedCount:', deletedCount)
      return safeJson({ deletedCount })
    }
    return safeJsonError('Gagal menghapus produk')
  }
}
