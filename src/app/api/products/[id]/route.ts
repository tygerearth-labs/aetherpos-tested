import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { generateUniqueSKU, generateVariantSKU } from '@/lib/sku-generator'
import { validateCompositionStock } from '@/lib/comp-stock'

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
    const { name, sku, barcode, hpp, price, stock, lowStockAlert, image, unit, categoryId, hasVariants, variants } = body

    // Check unique name if changed
    // FIX-E (P2-4 AUDIT-4): Use NOT: { id } for defensive correctness —
    // avoids false positive if pre-check `name !== existing.name` is ever refactored out.
    if (name && name !== existing.name) {
      const nameExists = await db.product.findFirst({
        where: { name, outletId, NOT: { id } },
      })
      if (nameExists) {
        return safeJsonError('Product name already exists in this outlet', 400)
      }
    }

    // FIX-B (P0-2 AUDIT-4): Validate user-provided SKU uniqueness per outlet (excluding self).
    const trimmedSkuInput = typeof sku === 'string' ? sku.trim() : ''
    if (trimmedSkuInput && trimmedSkuInput !== existing.sku) {
      const skuCollision = await db.product.findFirst({
        where: { sku: trimmedSkuInput, outletId, NOT: { id } },
      })
      if (skuCollision) {
        return safeJsonError(`SKU "${trimmedSkuInput}" sudah digunakan oleh produk lain di outlet ini`, 400)
      }
      const variantSkuCollision = await db.productVariant.findFirst({
        where: { sku: trimmedSkuInput, outletId, NOT: { product: { id } } },
      })
      if (variantSkuCollision) {
        return safeJsonError(`SKU "${trimmedSkuInput}" sudah digunakan oleh varian produk lain`, 400)
      }
    }

    // FIX-B (P0-2 AUDIT-4): Validate user-provided barcode uniqueness per outlet (excluding self).
    const trimmedBarcodeInput = typeof barcode === 'string' ? barcode.trim() : ''
    if (trimmedBarcodeInput && trimmedBarcodeInput !== existing.barcode) {
      const barcodeCollision = await db.product.findFirst({
        where: { barcode: trimmedBarcodeInput, outletId, NOT: { id } },
      })
      if (barcodeCollision) {
        return safeJsonError(`Barcode "${trimmedBarcodeInput}" sudah digunakan oleh produk lain di outlet ini`, 400)
      }
    }

    // FIX-E (P0-3 AUDIT-4): Validate categoryId belongs to this outlet.
    // Without this check, a user could link their product to another outlet's category.
    if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
      const category = await db.category.findFirst({
        where: { id: categoryId, outletId },
      })
      if (!category) {
        return safeJsonError('Category not found in this outlet', 400)
      }
    }

    // Validate composition stock capacity when stock is being changed
    if (stock !== undefined && !existing.hasVariants) {
      const compError = await validateCompositionStock(id, outletId, stock)
      if (compError) {
        return safeJsonError(compError, 400)
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

    // Auto-generate SKU if empty string provided (user cleared it) or not set
    let finalSku = sku
    let finalBarcode = barcode
    if (sku !== undefined) {
      if (!sku?.trim()) {
        // SKU was cleared or empty — auto-generate
        finalSku = await generateUniqueSKU(name || existing.name, outletId)
      } else {
        finalSku = sku.trim()
      }
    }
    // Auto-generate barcode from SKU if barcode not provided or empty
    if (finalSku) {
      finalBarcode = finalBarcode?.trim() || finalSku
    }

    // Auto-generate variant SKUs
    const variantsWithSku = await Promise.all(
      parsedVariants.map(async (v) => {
        const vSku = v.sku?.trim() || await generateVariantSKU(name || existing.name, v.name, outletId)
        return {
          ...v,
          sku: vSku,
          barcode: vSku,
        }
      })
    )

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
      if (finalSku !== undefined) updateData.sku = finalSku || null
      if (finalBarcode !== undefined) updateData.barcode = finalBarcode || null
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

      // Handle variants — upsert-by-name pattern (P1-1 AUDIT-3 fix)
      // PREVIOUSLY: full-replace (delete all + create all). This orphaned
      // TransactionItem.variantId for past sales because schema onDelete=SetNull
      // sets the FK to NULL when the variant is deleted. Snapshots survived but
      // variant-level analytics joins lost the FK link, and void could not
      // restore variant stock.
      // NOW: match incoming variants to existing variants by name (case-insensitive).
      //  - Match found → UPDATE (preserves variant ID, keeps historical FK intact)
      //  - No match in incoming → DELETE (truly removed variants)
      //  - No match in existing → CREATE (new variants)
      // Trade-off: renaming a variant still loses its ID (treated as delete + create),
      // but that's an acceptable edge case — snapshots preserve historical names.
      if (variants !== undefined) {
        const oldVariants = existing.variants
        const oldByName = new Map(
          oldVariants.map((v) => [v.name.trim().toLowerCase(), v])
        )
        const incomingByName = new Map<
          string,
          (typeof variantsWithSku)[number]
        >()
        for (const v of variantsWithSku) {
          const key = v.name.trim().toLowerCase()
          // If duplicate names slipped past the unique-name check (shouldn't happen),
          // last one wins — this is consistent with prior createMany behavior.
          incomingByName.set(key, v)
        }

        const toDelete: string[] = []
        const toUpdate: Array<{
          id: string
          data: {
            name: string
            sku: string
            barcode: string
            hpp: number
            price: number
            stock: number
          }
        }> = []
        const toCreate: Array<{
          productId: string
          name: string
          sku: string
          barcode: string
          hpp: number
          price: number
          stock: number
          outletId: string
        }> = []

        // Categorize existing variants: update if name matches, delete otherwise
        for (const [key, oldV] of oldByName.entries()) {
          const incoming = incomingByName.get(key)
          if (incoming) {
            toUpdate.push({
              id: oldV.id,
              data: {
                name: incoming.name,
                sku: incoming.sku,
                barcode: incoming.barcode,
                hpp: incoming.hpp || 0,
                price: incoming.price,
                stock: incoming.stock || 0,
              },
            })
          } else {
            toDelete.push(oldV.id)
          }
        }

        // Categorize incoming variants not matched → CREATE
        for (const [key, incoming] of incomingByName.entries()) {
          if (!oldByName.has(key)) {
            toCreate.push({
              productId: id,
              name: incoming.name,
              sku: incoming.sku,
              barcode: incoming.barcode,
              hpp: incoming.hpp || 0,
              price: incoming.price,
              stock: incoming.stock || 0,
              outletId,
            })
          }
        }

        // Execute deletes (orphan TransactionItem.variantId will be SetNull'd)
        if (toDelete.length > 0) {
          await tx.productVariant.deleteMany({
            where: { id: { in: toDelete } },
          })
        }
        // Execute updates (preserves ID — historical transactions keep FK link)
        for (const u of toUpdate) {
          await tx.productVariant.update({
            where: { id: u.id },
            data: u.data,
          })
        }
        // Execute creates
        if (toCreate.length > 0) {
          await tx.productVariant.createMany({ data: toCreate })
        }

        // PARENT STOCK RECALCULATION — after any variant change (delete/update/create),
        // parent.Product.stock must equal SUM(variants.stock). This invariant was NOT
        // enforced by the old full-replace pattern either, leaving parent.stock stale
        // after variant edits. Backported from bulk-update-excel route (AUDIT-2 fix).
        // Atomic raw SQL avoids TOCTOU race with concurrent sales/syncs.
        await tx.$executeRaw`
          UPDATE "Product" SET stock = (
            SELECT COALESCE(SUM(stock), 0) FROM "ProductVariant"
            WHERE "productId" = ${id} AND "outletId" = ${outletId}
          )
          WHERE id = ${id}
        `

        changes.variants = {
          from: {
            count: oldVariants.length,
            names: oldVariants.map((v) => v.name),
          },
          to: {
            count: variantsWithSku.length,
            names: variantsWithSku.map((v) => v.name),
          },
          // P1-1 audit trail: which variants preserved vs recreated vs removed
          preservedVariantIds: toUpdate.map((u) => u.id),
          deletedVariantIds: toDelete,
          createdVariantCount: toCreate.length,
        }
      }

      // Create audit log only if there are actual changes
      if (Object.keys(changes).length > 0) {
        await tx.auditLog.create({
          data: {
            action: 'UPDATE',
            entityType: 'PRODUCT',
            entityId: id,
            details: JSON.stringify({ productName: updated.name, productSku: existing.sku || null, changes }),
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
        _count: { select: { compositions: true } },
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

    // Delete product — explicitly clean up compositions & variants to avoid orphan FK refs in SQLite
    await db.$transaction(async (tx) => {
      // 1. Explicitly delete all compositions referencing this product
      if (existing._count.compositions > 0) {
        await tx.productComposition.deleteMany({ where: { productId: id } })
      }
      // 2. Delete product (variants auto-delete via onDelete: Cascade)
      await tx.product.delete({ where: { id } })
    }, { timeout: 30000 })

    return safeJson({ success: true })
  } catch (error) {
    console.error('Product DELETE error:', error)
    return safeJsonError('Failed to delete product')
  }
}
