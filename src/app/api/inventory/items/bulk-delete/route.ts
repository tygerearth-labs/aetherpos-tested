import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLogMany } from '@/lib/safe-audit'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya owner yang bisa menghapus item', 403)
    }

    const outletId = user.outletId
    const body = await request.json()
    const { ids } = body as { ids: string[] }

    if (!Array.isArray(ids) || ids.length === 0) {
      return safeJsonError('IDs diperlukan', 400)
    }
    if (ids.length > 200) {
      return safeJsonError('Maksimal 200 item per hapus', 400)
    }

    const { count } = await db.$transaction(async (tx) => {
      // Delete compositions referencing these items (as ingredient)
      await tx.productComposition.deleteMany({
        where: { ingredientId: { in: ids } },
      })
      // Delete compositions referencing these items (as product)
      await tx.productComposition.deleteMany({
        where: { productId: { in: ids } },
      })
      // Delete batches
      await tx.inventoryBatch.deleteMany({
        where: { inventoryItemId: { in: ids } },
      })
      // Delete purchase items
      await tx.purchaseItem.deleteMany({
        where: { inventoryItemId: { in: ids } },
      })
      // Delete inventory items
      return tx.inventoryItem.deleteMany({
        where: { id: { in: ids }, outletId },
      })
    })

    // Audit log
    await safeAuditLogMany([{
      action: 'DELETE' as const,
      entityType: 'INVENTORY_ITEM' as const,
      entityId: 'bulk',
      details: JSON.stringify({ deleteType: 'BULK', deletedCount: count, ids }),
      outletId,
      userId: user.id,
    }])

    return safeJson({ deletedCount: count })
  } catch (error) {
    console.error('Inventory bulk delete error:', error)
    return safeJsonError('Gagal menghapus item inventory')
  }
}