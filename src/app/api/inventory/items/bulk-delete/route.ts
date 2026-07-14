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

    // Check for items with business history before deleting
    const itemsWithHistory = await db.inventoryItem.findMany({
      where: {
        id: { in: ids },
        outletId,
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            compositions: true,
            purchaseItems: true,
            movements: true,
            inventoryTransferItems: true,
            consumptionSnapshots: true,
          },
        },
      },
    })

    const blockedItems = itemsWithHistory.filter(item => {
      const c = item._count
      return c.compositions + c.purchaseItems + c.movements + c.inventoryTransferItems + c.consumptionSnapshots > 0
    })

    if (blockedItems.length > 0) {
      const blockedNames = blockedItems.map(item => {
        const c = item._count
        const reasons: string[] = []
        if (c.compositions > 0) reasons.push(`${c.compositions} komposisi`)
        if (c.purchaseItems > 0) reasons.push(`${c.purchaseItems} pembelian`)
        if (c.movements > 0) reasons.push(`${c.movements} stok`)
        if (c.inventoryTransferItems > 0) reasons.push(`${c.inventoryTransferItems} transfer`)
        if (c.consumptionSnapshots > 0) reasons.push(`${c.consumptionSnapshots} konsumsi`)
        return `${item.name} (${reasons.join(', ')})`
      })

      const safeIds = itemsWithHistory
        .filter(item => {
          const c = item._count
          return c.compositions + c.purchaseItems + c.movements + c.inventoryTransferItems + c.consumptionSnapshots === 0
        })
        .map(item => item.id)

      // If some items can be deleted, do those only
      if (safeIds.length > 0) {
        const { count } = await db.$transaction(async (tx) => {
          await tx.productComposition.deleteMany({ where: { ingredientId: { in: safeIds } } })
          await tx.productComposition.deleteMany({ where: { productId: { in: safeIds } } })
          await tx.inventoryBatch.deleteMany({ where: { inventoryItemId: { in: safeIds } } })
          return tx.inventoryItem.deleteMany({ where: { id: { in: safeIds }, outletId } })
        })

        await safeAuditLogMany([{
          action: 'DELETE' as const,
          entityType: 'INVENTORY_ITEM' as const,
          entityId: 'bulk',
          details: JSON.stringify({
            deleteType: 'BULK_PARTIAL',
            deletedCount: count,
            blockedCount: blockedItems.length,
            blockedNames,
            safeIds,
          }),
          outletId,
          userId: user.id,
        }])

        return safeJson({
          deletedCount: count,
          blockedCount: blockedItems.length,
          blockedItems: blockedNames,
          message: `${count} item dihapus, ${blockedItems.length} item dilewati karena memiliki histori.`,
        })
      }

      // None can be deleted
      return safeJson({
        deletedCount: 0,
        blockedCount: blockedItems.length,
        blockedItems: blockedNames,
        message: 'Semua item memiliki histori bisnis dan tidak dapat dihapus. Gunakan "Nonaktifkan" untuk menyembunyikan item.',
      })
    }

    // All items are safe to delete
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