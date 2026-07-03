import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { validateCompositionStock, validateVariantCompositionStockBatch } from '@/lib/comp-stock'

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
    const { quantity, variants } = body

    const existing = await db.product.findFirst({
      where: { id, outletId },
      select: { id: true, name: true, sku: true, stock: true, hasVariants: true, hasComposition: true, hpp: true, price: true },
    })
    if (!existing) {
      return safeJsonError('Product not found', 404)
    }

    // ===== VARIANT RESTOCK =====
    if (existing.hasVariants) {
      if (!variants || !Array.isArray(variants) || variants.length === 0) {
        return safeJsonError('variants array is required for variant products', 400)
      }

      const invalidQuantities = variants.some((v: { quantity: number }) => !v.quantity || v.quantity <= 0)
      if (invalidQuantities) {
        return safeJsonError('Each variant quantity must be greater than 0', 400)
      }

      const variantIds = variants.map((v: { id: string }) => v.id)

      // Verify all variants belong to this product
      const existingVariants = await db.productVariant.findMany({
        where: { id: { in: variantIds }, productId: id, outletId },
        select: { id: true, name: true, sku: true, stock: true, price: true, hpp: true },
      })

      if (existingVariants.length !== variants.length) {
        return safeJsonError('One or more variants not found or do not belong to this product', 400)
      }

      // Validate variant composition stock capacity (if composition is active)
      if (existing.hasComposition) {
        const compErrors = await validateVariantCompositionStockBatch(
          variants.map((v: { id: string; quantity: number }) => {
            const ev = existingVariants.find((e) => e.id === v.id)!
            return {
              variantId: v.id,
              variantName: ev.name,
              currentStock: ev.stock,
              addStock: v.quantity,
            }
          })
        )
        if (compErrors.length > 0) {
          return safeJsonError(compErrors.join(' '), 400)
        }
      }

      const results = await db.$transaction(async (tx) => {
        const updatedVariants = []
        for (const variantReq of variants) {
          const variantBefore = existingVariants.find((v) => v.id === variantReq.id)!

          const updated = await tx.productVariant.update({
            where: { id: variantReq.id },
            data: { stock: { increment: variantReq.quantity } },
          })

          await tx.auditLog.create({
            data: {
              action: 'RESTOCK',
              entityType: 'VARIANT',
              entityId: variantReq.id,
              details: JSON.stringify({
                productName: existing.name,
                productSku: existing.sku || null,
                variantName: variantBefore.name,
                variantSku: variantBefore.sku || null,
                quantityAdded: variantReq.quantity,
                price: variantBefore.price,
                hpp: variantBefore.hpp,
                totalValue: variantReq.quantity * variantBefore.hpp,
                previousStock: variantBefore.stock,
                newStock: updated.stock,
              }),
              outletId,
              userId,
            },
          })

          updatedVariants.push(updated)
        }

        // Recalculate parent product aggregated stock
        const aggResult = await tx.productVariant.aggregate({
          where: { productId: id, outletId },
          _sum: { stock: true },
        })
        await tx.product.update({
          where: { id },
          data: { stock: aggResult._sum.stock ?? 0 },
        })

        return updatedVariants
      })

      return safeJson({ product: existing, updatedVariants: results })
    }

    // ===== NON-VARIANT RESTOCK (original behavior) =====
    if (!quantity || quantity <= 0) {
      return safeJsonError('Quantity must be greater than 0', 400)
    }

    // Validate composition stock capacity
    const compError = await validateCompositionStock(id, outletId, existing.stock + quantity)
    if (compError) {
      return safeJsonError(compError, 400)
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
            productSku: existing.sku || null,
            quantityAdded: quantity,
            price: existing.price,
            hpp: existing.hpp,
            totalValue: quantity * existing.hpp,
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