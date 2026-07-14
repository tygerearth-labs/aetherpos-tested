import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
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

    const result = await db.inventoryItem.updateMany({
      where: { id: { in: ids }, outletId: user.outletId },
      data: { categoryId: categoryId || null },
    })

    await safeAuditLog({
      action: 'BULK_UPDATE',
      entityType: 'INVENTORY_ITEM',
      details: JSON.stringify({
        bulkCategoryChange: true,
        categoryId: categoryId || null,
        targetCount: ids.length,
        updatedCount: result.count,
      }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJson({ updated: result.count })
  } catch (error) {
    console.error('Bulk category change error:', error)
    return safeJsonError('Gagal mengubah kategori')
  }
}