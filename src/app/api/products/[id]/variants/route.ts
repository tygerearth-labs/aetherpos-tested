import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLog } from '@/lib/safe-audit'
import { generateVariantSKU } from '@/lib/sku-generator'

// ─── GET ─── List all variants for a product ─────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId

    const { id } = await params

    // Verify product belongs to the user's outlet
    const product = await db.product.findFirst({
      where: { id, outletId },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    const variants = await db.productVariant.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'asc' },
    })

    return safeJson(variants)
  } catch (error) {
    console.error('Product variants GET error:', error)
    return safeJsonError('Failed to fetch variants')
  }
}

// ─── POST ─── Create a new variant for a product ────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const userId = user.id

    const { id } = await params

    // Verify product belongs to the user's outlet
    const product = await db.product.findFirst({
      where: { id, outletId },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    const body = await request.json()
    const { name, sku, barcode, hpp, price, stock } = body

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return safeJsonError('Variant name is required', 400)
    }
    if (price === undefined || price === null || price <= 0) {
      return safeJsonError('Variant price must be greater than 0', 400)
    }

    // Check unique name per product
    const existingVariant = await db.productVariant.findUnique({
      where: { name_productId: { name: name.trim(), productId: id } },
    })
    if (existingVariant) {
      return safeJsonError('Variant name already exists for this product', 400)
    }

    // Validate manual variant SKU uniqueness
    if (sku?.trim()) {
      const trimmedSku = sku.trim()
      const skuExists = await db.productVariant.findFirst({
        where: { sku: trimmedSku, outletId },
        select: { id: true, name: true },
      })
      if (skuExists) {
        return safeJsonError(`SKU varian "${trimmedSku}" sudah digunakan oleh varian "${skuExists.name}"`, 400)
      }
    }

    const variant = await db.$transaction(async (tx) => {
      // Auto-generate variant SKU if not provided
      const finalVariantSku = sku?.trim() || await generateVariantSKU(product.name, name.trim(), outletId)
      // Auto-generate barcode from SKU if not provided
      const finalVariantBarcode = barcode?.trim() || finalVariantSku

      // Create the variant
      const created = await tx.productVariant.create({
        data: {
          productId: id,
          name: name.trim(),
          sku: finalVariantSku,
          barcode: finalVariantBarcode,
          hpp: typeof hpp === 'number' ? hpp : 0,
          price,
          stock: typeof stock === 'number' ? stock : 0,
          outletId,
        },
      })

      // Set product hasVariants = true
      await tx.product.update({
        where: { id },
        data: { hasVariants: true },
      })

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'VARIANT',
          entityId: created.id,
          details: JSON.stringify({
            productName: product.name,
            productId: id,
            variantName: created.name,
            variantPrice: created.price,
            variantStock: created.stock,
          }),
          outletId,
          userId,
        },
      })

      return created
    })

    return safeJsonCreated(variant)
  } catch (error) {
    console.error('Product variant POST error:', error)
    return safeJsonError('Failed to create variant')
  }
}

// ─── PUT ─── Batch update variants for a product ────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const userId = user.id

    const { id } = await params

    // Verify product belongs to the user's outlet
    const product = await db.product.findFirst({
      where: { id, outletId },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    const body = await request.json()
    const { variants } = body

    if (!Array.isArray(variants) || variants.length === 0) {
      return safeJsonError('variants array is required and must not be empty', 400)
    }

    const updatedVariants = await db.$transaction(async (tx) => {
      const results = []

      for (const v of variants) {
        if (!v.id) continue

        // Verify variant belongs to this product
        const existing = await tx.productVariant.findFirst({
          where: { id: v.id, productId: id },
        })
        if (!existing) continue

        // Build update data from provided fields
        const updateData: Record<string, unknown> = {}
        if (v.name !== undefined) updateData.name = typeof v.name === 'string' ? v.name.trim() : v.name
        if (v.sku !== undefined) updateData.sku = v.sku?.trim() || null
        if (v.barcode !== undefined) updateData.barcode = v.barcode?.trim() || null
        if (v.hpp !== undefined) updateData.hpp = v.hpp
        if (v.price !== undefined) updateData.price = v.price
        if (v.stock !== undefined) updateData.stock = v.stock

        // Check unique name if being changed
        if (updateData.name && updateData.name !== existing.name) {
          const nameConflict = await tx.productVariant.findUnique({
            where: { name_productId: { name: updateData.name as string, productId: id } },
          })
          if (nameConflict) {
            throw new Error(`Variant name "${updateData.name}" already exists for this product`)
          }
        }

        // Check SKU uniqueness if being changed
        if (v.sku !== undefined && v.sku?.trim() && v.sku.trim() !== existing.sku) {
          const skuConflict = await tx.productVariant.findFirst({
            where: { sku: v.sku.trim(), outletId, id: { not: v.id } },
          })
          if (skuConflict) {
            throw new Error(`SKU varian "${v.sku.trim()}" sudah digunakan oleh varian lain`)
          }
        }

        const updated = await tx.productVariant.update({
          where: { id: v.id },
          data: updateData,
        })

        // Per-variant audit log with detailed change tracking
        const variantChanges: Record<string, { from: unknown; to: unknown }> = {}
        if (v.name !== undefined && v.name !== existing.name) variantChanges.name = { from: existing.name, to: v.name }
        if (v.sku !== undefined && v.sku !== existing.sku) variantChanges.sku = { from: existing.sku, to: v.sku?.trim() || null }
        if (v.hpp !== undefined && v.hpp !== existing.hpp) variantChanges.hpp = { from: existing.hpp, to: v.hpp }
        if (v.price !== undefined && v.price !== existing.price) variantChanges.price = { from: existing.price, to: v.price }
        if (v.stock !== undefined && v.stock !== existing.stock) variantChanges.stock = { from: existing.stock, to: v.stock }

        if (Object.keys(variantChanges).length > 0) {
          await tx.auditLog.create({
            data: {
              action: 'UPDATE',
              entityType: 'VARIANT',
              entityId: v.id,
              details: JSON.stringify({
                productName: product.name,
                productId: id,
                variantName: updated.name,
                variantSku: updated.sku,
                changes: variantChanges,
              }),
              outletId,
              userId,
            },
          })
        }

        results.push(updated)
      }

      // Only create parent-level audit log if variants were updated
      if (results.length > 0) {
        await tx.auditLog.create({
          data: {
            action: 'UPDATE',
            entityType: 'PRODUCT',
            entityId: id,
            details: JSON.stringify({
              productName: product.name,
              updatedVariantCount: results.length,
              variantNames: results.map((r) => r.name),
            }),
            outletId,
            userId,
          },
        })
      }

      return results
    })

    return safeJson(updatedVariants)
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      return safeJsonError(error.message, 400)
    }
    console.error('Product variant PUT error:', error)
    return safeJsonError('Failed to update variants')
  }
}

// ─── DELETE ─── Delete a variant by query param ─────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const userId = user.id

    const { id } = await params

    // Verify product belongs to the user's outlet
    const product = await db.product.findFirst({
      where: { id, outletId },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    // Get variant ID from query params
    const variantId = request.nextUrl.searchParams.get('variantId')
    if (!variantId) {
      return safeJsonError('variantId query parameter is required', 400)
    }

    // Verify variant belongs to this product
    const variant = await db.productVariant.findFirst({
      where: { id: variantId, productId: id },
    })
    if (!variant) {
      return safeJsonError('Variant not found', 404)
    }

    await db.$transaction(async (tx) => {
      // Delete the variant
      await tx.productVariant.delete({
        where: { id: variantId },
      })

      // Check remaining variants for this product
      const remainingCount = await tx.productVariant.count({
        where: { productId: id },
      })

      // If no variants left, set product hasVariants = false
      if (remainingCount === 0) {
        await tx.product.update({
          where: { id },
          data: { hasVariants: false },
        })
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: 'DELETE',
          entityType: 'VARIANT',
          entityId: variantId,
          details: JSON.stringify({
            productName: product.name,
            productId: id,
            variantName: variant.name,
            variantPrice: variant.price,
            variantStock: variant.stock,
            remainingVariants: remainingCount,
          }),
          outletId,
          userId,
        },
      })
    })

    return safeJson({ success: true })
  } catch (error) {
    console.error('Product variant DELETE error:', error)
    return safeJsonError('Failed to delete variant')
  }
}
