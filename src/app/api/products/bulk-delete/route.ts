import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { emitAuditEvent, buildBulkBatchEvent, type BulkChangeInput } from '@/lib/audit-v2'
import { withInsensitiveMode } from '@/lib/api/api-helpers'

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
      selectAllWhere.OR = withInsensitiveMode([
        { name: { contains: filter.search } },
        { sku: { contains: filter.search } },
        { barcode: { contains: filter.search } },
        { unit: { contains: filter.search } },
        { category: { name: { contains: filter.search } } },
        { variants: { some: { name: { contains: filter.search } } } },
        { variants: { some: { sku: { contains: filter.search } } } },
        { variants: { some: { barcode: { contains: filter.search } } } },
      ]) as Record<string, unknown>[]
    }
    if (filter?.categoryId) {
      selectAllWhere.categoryId = filter.categoryId
    }

    // Delete in a transaction: compositions, variants, then products
    // TransactionItem rows are preserved — Prisma's onDelete: SetNull
    // will nullify productId/variantId, but snapshot fields (productName,
    // variantName, price, qty, subtotal) remain intact.
    // V2 Audit: ONE BULK_BATCH event inside the tx (atomic with the delete),
    // replaces N per-row safeAuditLogMany calls emitted after the tx.
    const operationId = `product-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const count = await db.$transaction(async (tx) => {
      // Get all product IDs to delete (using filters when selectAllMode)
      const idsToDelete = selectAllMode
        ? (await tx.product.findMany({
            where: selectAllWhere,
            select: { id: true },
          })).map((p) => p.id)
        : productIds

      if (idsToDelete.length === 0) return 0

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

      // V2: emit ONE BULK_BATCH event INSIDE the tx (atomic with the delete).
      // The `before` snapshot for each deleted product is taken from productsForAudit.
      const variantByProduct = new Map<string, typeof variantInfo>()
      for (const v of variantInfo) {
        const list = variantByProduct.get(v.productId) ?? []
        list.push(v)
        variantByProduct.set(v.productId, list)
      }
      const deleteChanges: BulkChangeInput[] = productsForAudit.map((p) => {
        const pVariants = variantByProduct.get(p.id) ?? []
        return {
          entity: 'PRODUCT',
          identifier: p.id,
          action: 'deleted' as const,
          before: {
            name: p.name,
            sku: p.sku,
            price: p.price,
            stock: p.stock,
            hasVariants: !!p.hasVariants,
            variantCount: pVariants.length,
            variantNames: pVariants.map((v) => v.name),
          },
          note: 'BULK',
        }
      })

      await emitAuditEvent(
        tx,
        buildBulkBatchEvent({
          adapterKind: 'product-delete',
          operationId,
          jobId: operationId,
          batchIndex: 1,
          payloadHash: '',
          status: 'completed',
          stats: {
            processed: idsToDelete.length,
            deleted: result.count,
            failed: idsToDelete.length - result.count,
          },
          changes: deleteChanges,
          errors: [],
          outletId,
          userId,
          markerDetails: {
            bulkDelete: true,
            deleteType: 'BULK',
            selectAllMode: !!selectAllMode,
            deletedCount: result.count,
            requestedCount: idsToDelete.length,
          },
        }),
      )

      return result.count
    }, {
      timeout: 30_000,  // V15.1 FIX: 30s — default 5s too short for large batch deletes
      maxWait: 5_000,
    })

    // Store deletedCount IMMEDIATELY after successful transaction
    // (audit is now atomic with the delete — no separate post-tx step).
    deletedCount = count

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
