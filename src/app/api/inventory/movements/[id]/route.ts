import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

// GET /api/inventory/movements/[id] — single movement detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    const movement = await db.inventoryMovement.findFirst({
      where: { id, outletId: user.outletId },
      include: {
        inventoryItem: { select: { id: true, name: true, sku: true, baseUnit: true } },
        user: { select: { id: true, name: true } },
      },
    })

    if (!movement) {
      return safeJsonError('Inventory movement not found', 404)
    }

    // Verify the movement belongs to the user's outlet (403 if not)
    if (movement.outletId !== user.outletId) {
      return safeJsonError('Forbidden', 403)
    }

    // Resolve reference label if applicable
    let referenceLabel: string | null = null
    if (movement.referenceType === 'TRANSFER' && movement.referenceId) {
      const transfer = await db.outletTransfer.findFirst({
        where: { id: movement.referenceId },
        select: { transferNumber: true },
      })
      referenceLabel = transfer?.transferNumber || null
    } else if (movement.referenceType === 'PURCHASE_ORDER' && movement.referenceId) {
      const po = await db.purchaseOrder.findFirst({
        where: { id: movement.referenceId },
        select: { orderNumber: true },
      })
      referenceLabel = po?.orderNumber || null
    }

    return safeJson({ ...movement, referenceLabel }, 200, CACHE.MEDIUM)
  } catch (error) {
    console.error('Inventory movement GET error:', error)
    return safeJsonError('Failed to load inventory movement')
  }
}