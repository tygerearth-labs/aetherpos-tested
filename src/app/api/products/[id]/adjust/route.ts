import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { validateCompositionStock, validateVariantCompositionStock } from '@/lib/comp-stock'

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
    const { newStock, reason, variants } = body

    const existing = await db.product.findFirst({
      where: { id, outletId },
      select: { id: true, name: true, sku: true, stock: true, hasVariants: true, hasComposition: true },
    })
    if (!existing) {
      return safeJsonError('Product not found', 404)
    }

    // Variant adjustment flow
    if (existing.hasVariants) {
      if (!variants || !Array.isArray(variants) || variants.length === 0) {
        return safeJsonError(
          'Produk dengan varian memerlukan array variants: [{ id, newStock }]',
          400
        )
      }

      // Validate variant composition stock capacity if composition is active
      if (existing.hasComposition) {
        for (const v of variants) {
          if (v.newStock < 0) continue
          const compError = await validateVariantCompositionStock(v.id, '', v.newStock)
          if (compError) {
            return safeJsonError(compError, 400)
          }
        }
      }

      const result = await db.$transaction(async (tx) => {
        const adjustments: Array<{ variantId: string; variantName: string; previousStock: number; newStock: number }> = []

        for (const v of variants) {
          if (v.newStock === undefined || v.newStock === null || v.newStock < 0) {
            throw new Error(`Stock varian tidak boleh negatif`)
          }

          const variant = await tx.productVariant.findFirst({
            where: { id: v.id, productId: id, outletId },
            select: { id: true, name: true, stock: true },
          })
          if (!variant) {
            throw new Error(`Variant dengan ID ${v.id} tidak ditemukan`)
          }

          await tx.productVariant.update({
            where: { id: variant.id },
            data: { stock: v.newStock },
          })

          await tx.auditLog.create({
            data: {
              action: 'ADJUSTMENT',
              entityType: 'VARIANT',
              entityId: variant.id,
              details: JSON.stringify({
                productName: existing.name,
                productSku: existing.sku || null,
                variantName: variant.name,
                previousStock: variant.stock,
                newStock: v.newStock,
                adjustment: v.newStock - variant.stock,
                reason: reason || null,
              }),
              outletId,
              userId,
            },
          })

          adjustments.push({
            variantId: variant.id,
            variantName: variant.name,
            previousStock: variant.stock,
            newStock: v.newStock,
          })
        }

        // Recalculate parent product stock from all variants
        const aggResult = await tx.productVariant.aggregate({
          where: { productId: id, outletId },
          _sum: { stock: true },
        })
        const newParentStock = aggResult._sum.stock || 0
        await tx.product.update({
          where: { id },
          data: { stock: newParentStock },
        })

        return {
          previousParentStock: existing.stock,
          newParentStock,
          adjustments,
        }
      })

      return safeJson(result)
    }

    // Non-variant adjustment flow (existing behavior)
    if (newStock === undefined || newStock === null || newStock < 0) {
      return safeJsonError('Stock tidak boleh negatif', 400)
    }

    // Validate composition stock capacity
    if (existing.hasComposition) {
      const compError = await validateCompositionStock(id, outletId, newStock)
      if (compError) {
        return safeJsonError(compError, 400)
      }
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
    if (error instanceof Error && error.message.includes('tidak ditemukan')) {
      return safeJsonError(error.message, 400)
    }
    if (error instanceof Error && error.message.includes('negatif')) {
      return safeJsonError(error.message, 400)
    }
    return safeJsonError('Failed to adjust stock')
  }
}