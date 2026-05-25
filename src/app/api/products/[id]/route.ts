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
        variants: { select: { id: true, name: true, stock: true, sku: true, hpp: true, price: true } },
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
      // Track changes for audit log (non-stock fields only)
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      if (name !== undefined && name !== existing.name) changes.name = { from: existing.name, to: name }
      if (hpp !== undefined && hpp !== existing.hpp) changes.hpp = { from: existing.hpp, to: hpp }
      if (price !== undefined && price !== existing.price) changes.price = { from: existing.price, to: price }
      if (lowStockAlert !== undefined && lowStockAlert !== existing.lowStockAlert) changes.lowStockAlert = { from: existing.lowStockAlert, to: lowStockAlert }
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

      // ── Stock change audit log (separate from UPDATE) ──
      // When product stock is manually changed via edit form
      if (stock !== undefined && stock !== existing.stock) {
        const oldStock = existing.stock
        const newStock = stock
        const diff = newStock - oldStock

        if (diff > 0) {
          // Stock increased → log as RESTOCK
          await tx.auditLog.create({
            data: {
              action: 'RESTOCK',
              entityType: 'PRODUCT',
              entityId: id,
              details: JSON.stringify({
                productName: updated.name,
                quantityAdded: diff,
                previousStock: oldStock,
                newStock: newStock,
                source: 'manual_edit',
              }),
              outletId,
              userId,
            },
          })
        } else if (diff < 0) {
          // Stock decreased → log as ADJUSTMENT
          await tx.auditLog.create({
            data: {
              action: 'ADJUSTMENT',
              entityType: 'PRODUCT',
              entityId: id,
              details: JSON.stringify({
                productName: updated.name,
                stock: { from: oldStock, to: newStock },
                reason: 'Pengurangan stok manual',
                source: 'manual_edit',
              }),
              outletId,
              userId,
            },
          })
        }
      }

      // ── Handle variants — update-or-create to preserve variant IDs ──
      if (variants !== undefined) {
        // Build maps for efficient lookup
        const oldVariantMap = new Map(existing.variants.map((v) => [v.name.trim().toLowerCase(), v]))
        const oldVariantCount = existing.variants.length
        const processedNames = new Set<string>()
        const newVariantIds: Array<{ id: string; name: string }> = []

        for (const v of parsedVariants) {
          const vName = v.name.trim()
          const vKey = vName.toLowerCase()
          processedNames.add(vKey)

          const old = oldVariantMap.get(vKey)

          const newStock = v.stock || 0
          const newPrice = v.price
          const newSku = v.sku || null
          const newHpp = v.hpp || 0

          if (old) {
            // Update existing variant (preserves ID — keeps audit log linkage)
            await tx.productVariant.update({
              where: { id: old.id },
              data: { name: vName, sku: newSku, hpp: newHpp, price: newPrice, stock: newStock },
            })
            newVariantIds.push({ id: old.id, name: vName })

            // Log stock changes for this variant
            if (old.stock !== newStock) {
              const diff = newStock - old.stock
              if (diff > 0) {
                await tx.auditLog.create({
                  data: {
                    action: 'RESTOCK',
                    entityType: 'VARIANT',
                    entityId: old.id,
                    details: JSON.stringify({
                      variantName: vName,
                      parentProductName: updated.name,
                      parentId: id,
                      quantityAdded: diff,
                      previousStock: old.stock,
                      newStock: newStock,
                      source: 'manual_edit',
                    }),
                    outletId,
                    userId,
                  },
                })
              } else if (diff < 0) {
                await tx.auditLog.create({
                  data: {
                    action: 'ADJUSTMENT',
                    entityType: 'VARIANT',
                    entityId: old.id,
                    details: JSON.stringify({
                      variantName: vName,
                      parentProductName: updated.name,
                      parentId: id,
                      stock: { from: old.stock, to: newStock },
                      reason: 'Pengurangan stok varian manual',
                      source: 'manual_edit',
                    }),
                    outletId,
                    userId,
                  },
                })
              }
            }
          } else {
            // Create new variant
            const created = await tx.productVariant.create({
              data: {
                productId: id,
                name: vName,
                sku: newSku,
                hpp: newHpp,
                price: newPrice,
                stock: newStock,
                outletId,
              },
            })
            newVariantIds.push({ id: created.id, name: vName })
          }
        }

        // Delete variants that were removed (no longer in the payload)
        for (const oldV of existing.variants) {
          if (!processedNames.has(oldV.name.trim().toLowerCase())) {
            await tx.productVariant.delete({ where: { id: oldV.id } })
          }
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

      // Create UPDATE audit log for non-stock field changes
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
        variants: { orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, sku: true, barcode: true, hpp: true, price: true, stock: true, outletId: true, createdAt: true, updatedAt: true },
        },
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
      return safeJsonError('Hanya pemilik yang dapat menghapus produk', 404)
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
