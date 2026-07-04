import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

// POST /api/inventory/items/[id]/adjust — manual stock adjustment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const userId = user.id
    const outletId = user.outletId
    const { id } = await params

    const body = await request.json()
    const { newStock, reason } = body

    if (newStock === undefined || newStock === null || newStock < 0) {
      return safeJsonError('Stock tidak boleh negatif', 400)
    }

    const existing = await db.inventoryItem.findFirst({
      where: { id, outletId },
      select: { id: true, name: true, stock: true, avgCost: true },
    })
    if (!existing) {
      return safeJsonError('Inventory item not found', 404)
    }

    const item = await db.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: { stock: newStock },
      })

      await tx.auditLog.create({
        data: {
          action: 'ADJUSTMENT',
          entityType: 'INVENTORY_ITEM',
          entityId: id,
          details: JSON.stringify({
            itemName: existing.name,
            previousStock: existing.stock,
            newStock,
            adjustment: newStock - existing.stock,
            reason: reason || null,
          }),
          outletId,
          userId,
        },
      })

      // Create inventory movement for adjustment
      await tx.inventoryMovement.create({
        data: {
          type: 'ADJUSTMENT',
          inventoryItemId: id,
          quantity: newStock - existing.stock,
          previousStock: existing.stock,
          newStock,
          referenceType: 'ADJUSTMENT',
          notes: reason || `Penyesuaian stok manual`,
          outletId,
          userId,
        },
      })

      return updated
    })

    return safeJson(item)
  } catch (error) {
    console.error('Inventory item adjust POST error:', error)
    return safeJsonError('Failed to adjust inventory stock')
  }
}