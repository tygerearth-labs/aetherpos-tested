import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const userId = user.id
    const outletId = user.outletId

    const { id } = await params
    const body = await request.json()
    const { quantity } = body

    if (!quantity || quantity <= 0) {
      return safeJsonError('Quantity must be greater than 0', 400)
    }

    const existing = await db.product.findFirst({
      where: { id, outletId },
      select: { id: true, name: true, stock: true, hasVariants: true },
    })
    if (!existing) {
      return safeJsonError('Product not found', 404)
    }

    if (existing.hasVariants) {
      return safeJsonError(
        'Produk dengan varian tidak bisa di-restock secara langsung. Gunakan edit produk untuk mengubah stok varian.',
        400
      )
    }

    const product = await db.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { stock: { increment: quantity } },
      })

      await tx.auditLog.create({
        data: {
          action: 'RESTOCK',
          entityType: 'PRODUCT',
          entityId: id,
          details: JSON.stringify({
            productName: updated.name,
            quantityAdded: quantity,
            previousStock: existing.stock,
            newStock: updated.stock,
          }),
          outletId,
          userId,
        },
      })

      return updated
    })

    return safeJson(product)
  } catch (error) {
    console.error('Restock POST error:', error)
    return safeJsonError('Failed to restock product')
  }
}
