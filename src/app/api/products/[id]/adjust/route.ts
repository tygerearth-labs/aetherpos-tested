import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

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
    const { newStock, reason } = body

    if (newStock === undefined || newStock === null || newStock < 0) {
      return safeJsonError('Stock tidak boleh negatif', 400)
    }

    const existing = await db.product.findFirst({
      where: { id, outletId },
      select: { id: true, name: true, sku: true, stock: true, hasVariants: true },
    })
    if (!existing) {
      return safeJsonError('Product not found', 404)
    }

    if (existing.hasVariants) {
      return safeJsonError(
        'Produk dengan varian tidak bisa di-penyesuaian secara langsung. Gunakan edit produk untuk mengubah stok varian.',
        400
      )
    }

    const product = await db.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { stock: newStock },
      })

      await tx.auditLog.create({
        data: {
          action: 'ADJUSTMENT',
          entityType: 'STOCK',
          entityId: id,
          details: JSON.stringify({
            productName: updated.name,
            productSku: existing.sku || null,
            previousStock: existing.stock,
            newStock: updated.stock,
            adjustment: newStock - existing.stock,
            reason: reason || null,
          }),
          outletId,
          userId,
        },
      })

      return updated
    })

    return safeJson(product)
  } catch (error) {
    console.error('Adjust stock POST error:', error)
    return safeJsonError('Failed to adjust stock')
  }
}
