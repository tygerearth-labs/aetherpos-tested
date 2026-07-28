import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { withInsensitiveMode } from '@/lib/api/api-helpers'
import { emitAuditEvent, buildBulkBatchEvent, type BulkChangeInput } from '@/lib/audit-v2'

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
    const { productIds, priceAdjustment, stockAdjustment, categoryId, selectAllMode, filter } = body

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
    // If selectAllMode, fetch products matching the current filter
    const selectAllWhere: Record<string, unknown> = { outletId }
    if (filter?.search) {
      selectAllWhere.OR = withInsensitiveMode([
        { name: { contains: filter.search } },
        { sku: { contains: filter.search } },
        { barcode: { contains: filter.search } },
        { unit: { contains: filter.search } },
        { category: { name: { contains: filter.search } } },
        { variants: { some: { name: { contains: filter.search } } } },
        { variants: { some: { sku: { contains: filter.search } } } },
        { variants: { some: { barcode: { contains: filter.search } } } },
      ]) as Record<string, unknown>[]
    }
    if (filter?.categoryId) {
      selectAllWhere.categoryId = filter.categoryId
    }

    const existingProducts = isSelectAll
      ? await db.product.findMany({
          where: selectAllWhere,
          select: { id: true, name: true, sku: true, price: true, stock: true, categoryId: true, hasVariants: true, hpp: true },
        })
      : await db.product.findMany({
          where: { id: { in: productIds }, outletId },
          select: { id: true, name: true, sku: true, price: true, stock: true, categoryId: true, hasVariants: true, hpp: true },
        })

    if (existingProducts.length === 0) {
      return safeJsonError('No valid products found', 404)
    }

    // Process each product in a transaction
    let updatedCount = 0
    // V2: collect structured changes for ONE BULK_BATCH event (not N LEGACY rows)
    const bulkChanges: BulkChangeInput[] = []
    const operationId = `bulk-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

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

          // For variant products, stock will be recalculated from variants later
          // Only set parent stock directly for non-variant products
          if (!product.hasVariants) {
            updates.stock = newStock
          }
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
              select: { id: true, name: true, sku: true, price: true, stock: true, hpp: true },
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

              bulkChanges.push({
                entity: 'PRODUCT_VARIANT',
                identifier: variant.sku || variant.id,
                action: 'updated',
                before: { price: variant.price },
                after: { price: variantNewPrice },
                note: `variant of ${product.name}`,
              })
            }
          }

          // Stock adjustment for variants
          if (stockAdjustment) {
            const variants = await tx.productVariant.findMany({
              where: { productId: product.id },
              select: { id: true, name: true, sku: true, stock: true, price: true, hpp: true },
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

              bulkChanges.push({
                entity: 'PRODUCT_VARIANT',
                identifier: variant.sku || variant.id,
                action: 'updated',
                before: { stock: variant.stock },
                after: { stock: variantNewStock },
                note: `variant of ${product.name}`,
              })
            }

            // Recalculate parent product stock from all variants
            const stockAgg = await tx.productVariant.aggregate({
              where: { productId: product.id, outletId },
              _sum: { stock: true },
            })
            const aggregatedStock = stockAgg._sum.stock || 0

            // Write the correct aggregated stock back to the parent product
            await tx.product.update({
              where: { id: product.id },
              data: { stock: aggregatedStock },
            })

            // Update the changes record to reflect actual aggregated stock
            changes.stock = { from: product.stock, to: aggregatedStock }
          }
        }

        bulkChanges.push({
          entity: 'PRODUCT',
          identifier: product.sku || product.name,
          action: 'updated',
          before: {
            ...(changes.price ? { price: changes.price.from } : {}),
            ...(changes.stock ? { stock: changes.stock.from } : {}),
            ...(changes.categoryId ? { categoryId: changes.categoryId.from } : {}),
          },
          after: {
            ...(changes.price ? { price: changes.price.to } : {}),
            ...(changes.stock ? { stock: changes.stock.to } : {}),
            ...(changes.categoryId ? { categoryId: changes.categoryId.to } : {}),
          },
          note: product.name,
        })

        updatedCount++
      }

      // V2: emit ONE BULK_BATCH event for the whole operation (not N LEGACY rows)
      if (bulkChanges.length > 0) {
        await emitAuditEvent(
          tx,
          buildBulkBatchEvent({
            adapterKind: 'product-update',
            operationId,
            jobId: operationId,
            batchIndex: 1,
            payloadHash: '',
            status: 'completed',
            stats: { processed: updatedCount, updated: updatedCount },
            changes: bulkChanges,
            errors: [],
            outletId,
            userId,
            markerDetails: {
              adapterKind: 'product-update',
              operationId,
              updatedCount,
              batchOperation: true,
            },
          }),
        )
      }
    }, { timeout: 15000 })

    return safeJson({ updated: updatedCount })
  } catch (error) {
    console.error('Products bulk update POST error:', error)
    return safeJsonError('Failed to bulk update products')
  }
}
