import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { emitAuditEvent, buildBulkBatchEvent, type BulkChangeInput } from '@/lib/audit-v2'

// POST /api/categories/bulk-delete — delete multiple product categories in ONE
// transaction and emit ONE BULK_BATCH audit event for the whole batch.
//
// Replaces the previous frontend pattern of looping `DELETE /api/categories/:id`
// which produced N audit rows per bulk action (1 delete = 1 log). Now a bulk
// delete of K categories produces exactly ONE audit row.
export async function POST(request: NextRequest) {
  let deletedCount = 0

  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menghapus kategori', 403)
    }

    const outletId = user.outletId
    const userId = user.id
    const body = await request.json()
    const { categoryIds } = body as { categoryIds?: string[] }

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return safeJsonError('Category IDs diperlukan', 400)
    }

    const maxDelete = 200
    if (categoryIds.length > maxDelete) {
      return safeJsonError(`Maksimal ${maxDelete} kategori yang bisa dihapus sekaligus`, 400)
    }

    const operationId = `category-delete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const count = await db.$transaction(async (tx) => {
      // Fetch all categories to delete (verify outlet ownership) + their
      // product counts BEFORE we touch anything, so the audit `before`
      // snapshot is accurate.
      const catsForAudit = await tx.category.findMany({
        where: { id: { in: categoryIds }, outletId },
        select: {
          id: true,
          name: true,
          color: true,
          _count: { select: { products: true } },
        },
      })

      if (catsForAudit.length === 0) return 0

      const idsToDelete = catsForAudit.map((c) => c.id)

      // Detach products (set categoryId to null) for ALL categories in the
      // batch, then delete the categories. Both inside the same tx so the
      // audit row commits atomically with the mutation.
      await tx.product.updateMany({
        where: { categoryId: { in: idsToDelete } },
        data: { categoryId: null },
      })

      const result = await tx.category.deleteMany({
        where: { id: { in: idsToDelete }, outletId },
      })

      // Build the per-category `before` snapshot for the single BULK_BATCH
      // audit row. Each entry is one row in the Changes table.
      const deleteChanges: BulkChangeInput[] = catsForAudit.map((c) => ({
        entity: 'CATEGORY',
        identifier: c.id,
        action: 'deleted' as const,
        before: {
          name: c.name,
          color: c.color,
          productsAffected: c._count.products,
        },
        note: 'BULK',
      }))

      const totalProductsAffected = catsForAudit.reduce(
        (sum, c) => sum + c._count.products,
        0,
      )

      await emitAuditEvent(
        tx,
        buildBulkBatchEvent({
          adapterKind: 'category-delete',
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
            deletedCount: result.count,
            requestedCount: idsToDelete.length,
            productsAffected: totalProductsAffected,
          },
        }),
      )

      return result.count
    }, {
      timeout: 30_000,
      maxWait: 5_000,
    })

    deletedCount = count

    return safeJson({ deletedCount })
  } catch (error) {
    console.error('Bulk category delete error:', error)
    if (deletedCount > 0) {
      console.warn(
        '[categories/bulk-delete] Transaction succeeded but post-processing failed, returning success with deletedCount:',
        deletedCount,
      )
      return safeJson({ deletedCount })
    }
    return safeJsonError('Gagal menghapus kategori')
  }
}
