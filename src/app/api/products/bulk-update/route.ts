import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'OWNER') {
      return safeJsonError('Only OWNER can bulk update products', 403)
    }
    const outletId = user.outletId
    const userId = user.id

    const body = await request.json()
    const { productIds, priceAdjustment, stockAdjustment, categoryId, selectAllMode } = body

    const isSelectAll = !!selectAllMode

    if (!isSelectAll && (!productIds || !Array.isArray(productIds) || productIds.length === 0)) {
      return safeJsonError('productIds is required and must be a non-empty array', 400)
    }

    if (!isSelectAll && productIds.length > 200) {
      return safeJsonError('Maximum 200 products per bulk update', 400)
    }

    if (!priceAdjustment && !stockAdjustment && categoryId === undefined) {
      return safeJsonError('At least one adjustment type (priceAdjustment, stockAdjustment, or categoryId) is required', 400)
    }

    // Validate price adjustment
    if (priceAdjustment) {
      const { type, value } = priceAdjustment
      if (!['percent', 'fixed'].includes(type)) {
        return safeJsonError('priceAdjustment.type must be "percent" or "fixed"', 400)
      }
      if (typeof value !== 'number' || value === 0) {
        return safeJsonError('priceAdjustment.value must be a non-zero number', 400)
      }
    }

    // Validate stock adjustment
    if (stockAdjustment) {
      const { type, value } = stockAdjustment
      if (!['add', 'subtract', 'set'].includes(type)) {
        return safeJsonError('stockAdjustment.type must be "add", "subtract", or "set"', 400)
      }
      if (typeof value !== 'number' || value < 0) {
        return safeJsonError('stockAdjustment.value must be a non-negative number', 400)
      }
    }

    // Validate categoryId if provided
    if (categoryId !== undefined && categoryId !== null) {
      const category = await db.category.findFirst({
        where: { id: categoryId, outletId },
      })
      if (!category) {
        return safeJsonError('Category not found', 400)
      }
    }

    // Verify all products belong to this outlet
    // If selectAllMode, fetch ALL products in the outlet
    const existingProducts = isSelectAll
      ? await db.product.findMany({
          where: { outletId },
          select: { id: true, name: true, price: true, stock: true, categoryId: true, hasVariants: true },
        })
      : await db.product.findMany({
          where: { id: { in: productIds }, outletId },
          select: { id: true, name: true, price: true, stock: true, categoryId: true, hasVariants: true },
        })

    if (existingProducts.length === 0) {
      return safeJsonError('No valid products found', 404)
    }

    // Process each product in a transaction
    let updatedCount = 0
    const auditLogs: Array<{
      action: string
      entityType: string
      entityId: string
      details: string
      outletId: string
      userId: string
    }> = []

    await db.$transaction(async (tx) => {
      for (const product of existingProducts) {
        const updates: Record<string, unknown> = {}
        const changes: Record<string, { from: unknown; to: unknown }> = {}

        // Price adjustment
        if (priceAdjustment) {
          const { type, value } = priceAdjustment
          const oldPrice = product.price
          let newPrice: number

          if (type === 'percent') {
            newPrice = Math.round(oldPrice * (1 + value / 100))
          } else {
            newPrice = Math.round(oldPrice + value)
          }

          // Ensure price doesn't go negative
          newPrice = Math.max(0, newPrice)
          updates.price = newPrice
          changes.price = { from: oldPrice, to: newPrice }
        }

        // Stock adjustment
        if (stockAdjustment) {
          const { type, value } = stockAdjustment
          const oldStock = product.stock
          let newStock: number

          if (type === 'add') {
            newStock = oldStock + Math.round(value)
          } else if (type === 'subtract') {
            newStock = Math.max(0, oldStock - Math.round(value))
          } else {
            newStock = Math.round(value)
          }

          updates.stock = newStock
          changes.stock = { from: oldStock, to: newStock }
        }

        // Category change
        if (categoryId !== undefined) {
          updates.categoryId = categoryId
          changes.categoryId = { from: product.categoryId || null, to: categoryId }
        }

        await tx.product.update({
          where: { id: product.id },
          data: updates,
        })

        // Propagate adjustments to variants if the product has them
        if (product.hasVariants) {
          // Price adjustment for variants
          if (priceAdjustment) {
            const variants = await tx.productVariant.findMany({
              where: { productId: product.id },
              select: { id: true, price: true },
            })

            for (const variant of variants) {
              const { type, value } = priceAdjustment
              let variantNewPrice: number

              if (type === 'percent') {
                variantNewPrice = Math.round(variant.price * (1 + value / 100))
              } else {
                variantNewPrice = Math.round(variant.price + value)
              }

              variantNewPrice = Math.max(0, variantNewPrice)
              await tx.productVariant.update({
                where: { id: variant.id },
                data: { price: variantNewPrice },
              })

              auditLogs.push({
                action: 'BULK_UPDATE',
                entityType: 'PRODUCT_VARIANT',
                entityId: variant.id,
                details: JSON.stringify({
                  parentProductName: product.name,
                  parentId: product.id,
                  price: { from: variant.price, to: variantNewPrice },
                  batchOperation: true,
                }),
                outletId,
                userId,
              })
            }
          }

          // Stock adjustment for variants
          if (stockAdjustment) {
            const variants = await tx.productVariant.findMany({
              where: { productId: product.id },
              select: { id: true, stock: true },
            })

            for (const variant of variants) {
              const { type, value } = stockAdjustment
              let variantNewStock: number

              if (type === 'add') {
                variantNewStock = variant.stock + Math.round(value)
              } else if (type === 'subtract') {
                variantNewStock = Math.max(0, variant.stock - Math.round(value))
              } else {
                variantNewStock = Math.round(value)
              }

              await tx.productVariant.update({
                where: { id: variant.id },
                data: { stock: variantNewStock },
              })

              auditLogs.push({
                action: 'BULK_UPDATE',
                entityType: 'PRODUCT_VARIANT',
                entityId: variant.id,
                details: JSON.stringify({
                  parentProductName: product.name,
                  parentId: product.id,
                  stock: { from: variant.stock, to: variantNewStock },
                  batchOperation: true,
                }),
                outletId,
                userId,
              })
            }
          }
        }

        auditLogs.push({
          action: 'BULK_UPDATE',
          entityType: 'PRODUCT',
          entityId: product.id,
          details: JSON.stringify({
            productName: product.name,
            changes,
            batchOperation: true,
          }),
          outletId,
          userId,
        })

        updatedCount++
      }

      // Create all audit logs
      if (auditLogs.length > 0) {
        await tx.auditLog.createMany({
          data: auditLogs,
        })
      }
    }, { timeout: 15000 })

    return safeJson({ updated: updatedCount })
  } catch (error) {
    console.error('Products bulk update POST error:', error)
    return safeJsonError('Failed to bulk update products')
  }
}
