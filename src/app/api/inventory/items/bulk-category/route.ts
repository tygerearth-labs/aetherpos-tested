import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeEmitAuditEvent, buildBulkBatchEvent } from '@/lib/audit-v2'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

const MAX_ITEMS = 200

/**
 * PATCH /api/inventory/items/bulk-category
 * Move multiple inventory items to a different category.
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    // OWNER always allowed; CREW allowed if they have "purchase" page access
    if (user.role !== 'OWNER') {
      const crewPerm = await db.crewPermission.findUnique({
        where: { userId: user.id },
      })
      const pages = (crewPerm?.pages || 'pos').split(',')
      if (!pages.includes('purchase')) {
        return safeJsonError('Anda tidak memiliki akses untuk mengubah kategori', 403)
      }
    }

    const body = await request.json()
    const { ids, categoryId } = body as { ids?: string[]; categoryId?: string | null }

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ITEMS) {
      return safeJsonError(`Berikan 1-${MAX_ITEMS} item ID`, 400)
    }
    if (categoryId !== undefined && categoryId !== null && typeof categoryId !== 'string') {
      return safeJsonError('categoryId tidak valid', 400)
    }

    // Validate categoryId if provided
    if (categoryId) {
      const cat = await db.inventoryCategory.findFirst({
        where: { id: categoryId, outletId: user.outletId },
      })
      if (!cat) return safeJsonError('Kategori tidak ditemukan', 404)
    }

    // Fetch before-snapshots so we can record per-item diffs in the audit event.
    const beforeItems = await db.inventoryItem.findMany({
      where: { id: { in: ids }, outletId: user.outletId },
      select: { id: true, name: true, sku: true, categoryId: true },
    })

    const result = await db.inventoryItem.updateMany({
      where: { id: { in: ids }, outletId: user.outletId },
      data: { categoryId: categoryId || null, lastBusinessChangeAt: new Date() },
    })

    // AuditLog V2 — ONE BULK_BATCH event for the bulk-category change.
    // Emitted AFTER the updateMany commits via safeEmitAuditEvent (non-tx, never throws).
    const operationId = `INV-BULK-CAT-${user.outletId.slice(-6)}-${Date.now()}`
    const changes = beforeItems.map((it) => ({
      entity: 'INVENTORY_ITEM',
      identifier: it.id,
      action: 'updated' as const,
      before: {
        name: it.name,
        sku: it.sku ?? '',
        categoryId: it.categoryId ?? '',
      },
      after: {
        name: it.name,
        sku: it.sku ?? '',
        categoryId: categoryId || '',
      },
      note: it.name,
    }))

    await safeEmitAuditEvent(
      buildBulkBatchEvent({
        adapterKind: 'inventory-category',
        operationId,
        jobId: operationId,
        batchIndex: 0,
        payloadHash: `${operationId}-${ids.length}`,
        status: 'completed',
        stats: {
          processed: ids.length,
          updated: result.count,
        },
        changes,
        errors: [],
        outletId: user.outletId,
        userId: user.id,
        markerDetails: {
          bulkCategoryChange: true,
          categoryId: categoryId || null,
          targetCount: ids.length,
          updatedCount: result.count,
        },
      }),
    )

    return safeJson({ updated: result.count })
  } catch (error) {
    console.error('Bulk category change error:', error)
    return safeJsonError('Gagal mengubah kategori')
  }
}