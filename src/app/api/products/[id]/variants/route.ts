import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/safe-response'
import { safeAuditLog } from '@/lib/safe-audit'

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

    const variant = await db.$transaction(async (tx) => {
      // Create the variant
      const created = await tx.productVariant.create({
        data: {
          productId: id,
          name: name.trim(),
          sku: sku?.trim() || null,
          barcode: barcode?.trim() || null,
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

        const updated = await tx.productVariant.update({
          where: { id: v.id },
          data: updateData,
        })

        results.push(updated)
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entityType: 'VARIANT',
          entityId: id,
          details: JSON.stringify({
            productName: product.name,
            productId: id,
            updatedCount: results.length,
            variantIds: results.map((r) => r.id),
          }),
          outletId,
          userId,
        },
      })

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
