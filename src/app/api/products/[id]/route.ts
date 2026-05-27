import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/safe-response'

interface VariantPayload {
  name: string
  sku?: string
  hpp?: number
  price: number
  stock?: number
}

// GET /api/products/[id] — fetch single product with variants
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

    const product = await db.product.findFirst({
      where: { id, outletId },
      include: {
        category: { select: { id: true, name: true, color: true } },
        variants: {
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { variants: true } },
      },
    })

    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    return safeJson({
      ...product,
      hasVariants: !!product.hasVariants,
      _variantCount: product._count.variants,
    })
  } catch (error) {
    console.error('Product GET error:', error)
    return safeJsonError('Failed to load product')
  }
}

// PUT /api/products/[id] — update product (with variant support)
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

    const existing = await db.product.findFirst({
      where: { id, outletId },
      include: {
        variants: { select: { id: true, name: true } },
      },
    })
    if (!existing) {
      return safeJsonError('Product not found', 404)
    }

    const body = await request.json()
    const { name, sku, hpp, price, stock, lowStockAlert, image, unit, categoryId, hasVariants, variants } = body

    // Check unique name if changed
    if (name && name !== existing.name) {
      const nameExists = await db.product.findFirst({
        where: { name, outletId },
      })
      if (nameExists) {
        return safeJsonError('Product name already exists in this outlet', 400)
      }
    }

    // Validate variants if hasVariants is true
    const parsedVariants: VariantPayload[] = Array.isArray(variants) ? variants : []
    if (hasVariants && parsedVariants.length === 0) {
      return safeJsonError('Setidaknya satu varian diperlukan saat hasVariants bernilai true', 400)
    }

    // Check for duplicate variant names
    if (parsedVariants.length > 0) {
      const variantNames = parsedVariants.map((v) => v.name?.trim().toLowerCase()).filter(Boolean)
      const uniqueNames = new Set(variantNames)
      if (uniqueNames.size !== variantNames.length) {
        return safeJsonError('Nama varian tidak boleh duplikat', 400)
      }
    }

    const product = await db.$transaction(async (tx) => {
      // Track changes for audit log
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      if (name !== undefined && name !== existing.name) changes.name = { from: existing.name, to: name }
      if (hpp !== undefined && hpp !== existing.hpp) changes.hpp = { from: existing.hpp, to: hpp }
      if (price !== undefined && price !== existing.price) changes.price = { from: existing.price, to: price }
      if (lowStockAlert !== undefined && lowStockAlert !== existing.lowStockAlert) changes.lowStockAlert = { from: existing.lowStockAlert, to: lowStockAlert }
      if (stock !== undefined && stock !== existing.stock) changes.stock = { from: existing.stock, to: stock }
      if (image !== undefined && image !== existing.image) changes.image = { from: existing.image, to: image }
      if (unit !== undefined && unit !== existing.unit) changes.unit = { from: existing.unit, to: unit }
      if (hasVariants !== undefined && hasVariants !== existing.hasVariants) changes.hasVariants = { from: existing.hasVariants, to: hasVariants }

      const updateData: Record<string, unknown> = {}
      if (name !== undefined) updateData.name = name
      if (sku !== undefined) updateData.sku = sku || null
      if (hpp !== undefined) updateData.hpp = hpp
      if (price !== undefined) updateData.price = price
      if (stock !== undefined) updateData.stock = stock
      if (lowStockAlert !== undefined) updateData.lowStockAlert = lowStockAlert
      if (image !== undefined) updateData.image = image || null
      if (unit !== undefined) updateData.unit = unit || 'pcs'
      if (categoryId !== undefined) updateData.categoryId = categoryId || null
      if (hasVariants !== undefined) updateData.hasVariants = hasVariants

      const updated = await tx.product.update({
        where: { id },
        data: updateData,
      })

      // Handle variants — full-replace pattern
      if (variants !== undefined) {
        // Delete all existing variants (cascade handles transactionItem references)
        const oldVariantCount = existing.variants.length
        if (oldVariantCount > 0) {
          await tx.productVariant.deleteMany({
            where: { productId: id },
          })
        }

        // Create new variants
        if (parsedVariants.length > 0) {
          await tx.productVariant.createMany({
            data: parsedVariants.map((v) => ({
              productId: id,
              name: v.name,
              sku: v.sku || null,
              hpp: v.hpp || 0,
              price: v.price,
              stock: v.stock || 0,
              outletId,
            })),
          })
        }

        changes.variants = {
          from: {
            count: oldVariantCount,
            names: existing.variants.map((v) => v.name),
          },
          to: {
            count: parsedVariants.length,
            names: parsedVariants.map((v) => v.name),
          },
        }
      }

      // Create audit log only if there are actual changes
      if (Object.keys(changes).length > 0) {
        await tx.auditLog.create({
          data: {
            action: 'UPDATE',
            entityType: 'PRODUCT',
            entityId: id,
            details: JSON.stringify({ productName: updated.name, changes }),
            outletId,
            userId,
          },
        })
      }

      return updated
    })

    // Fetch updated product with variants for response
    const productWithVariants = await db.product.findUnique({
      where: { id: product.id },
      include: {
        variants: { orderBy: { createdAt: 'asc' } },
        _count: { select: { variants: true } },
      },
    })

    return safeJson({
      ...productWithVariants,
      hasVariants: !!productWithVariants?.hasVariants,
      _variantCount: productWithVariants?._count?.variants ?? 0,
    })
  } catch (error) {
    console.error('Product PUT error:', error)
    return safeJsonError('Failed to update product')
  }
}

// DELETE /api/products/[id] — delete product (variants cascade auto-delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menghapus produk', 403)
    }
    const outletId = user.outletId
    const userId = user.id

    const { id } = await params

    const existing = await db.product.findFirst({
      where: { id, outletId },
      include: {
        variants: { select: { id: true, name: true } },
      },
    })
    if (!existing) {
      return safeJsonError('Product not found', 404)
    }

    // Create audit log before deleting (non-blocking)
    await safeAuditLog({
      action: 'DELETE',
      entityType: 'PRODUCT',
      entityId: id,
      details: JSON.stringify({
        productName: existing.name,
        price: existing.price,
        stock: existing.stock,
        sku: existing.sku,
        hasVariants: !!existing.hasVariants,
        variantCount: existing.variants.length,
        variantNames: existing.variants.map((v) => v.name),
      }),
      outletId,
      userId,
    })

    // Delete product — variants auto-delete via onDelete: Cascade
    await db.product.delete({
      where: { id },
    })

    return safeJson({ success: true })
  } catch (error) {
    console.error('Product DELETE error:', error)
    return safeJsonError('Failed to delete product')
  }
}
