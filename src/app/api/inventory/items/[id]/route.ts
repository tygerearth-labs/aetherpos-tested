import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

// GET /api/inventory/items/[id] — get single inventory item with composition count
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    const item = await db.inventoryItem.findFirst({
      where: { id, outletId: user.outletId },
      include: {
        category: { select: { id: true, name: true, color: true } },
        _count: { select: { compositions: true, purchaseItems: true } },
      },
    })

    if (!item) {
      return safeJsonError('Inventory item not found', 404)
    }

    return safeJson(item)
  } catch (error) {
    console.error('Inventory item GET error:', error)
    return safeJsonError('Failed to load inventory item')
  }
}

// PUT /api/inventory/items/[id] — update inventory item
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    const existing = await db.inventoryItem.findFirst({
      where: { id, outletId: user.outletId },
    })
    if (!existing) {
      return safeJsonError('Inventory item not found', 404)
    }

    const body = await request.json()
    const { name, sku, baseUnit, lowStockAlert, categoryId } = body

    // Validate categoryId if provided
    if (categoryId) {
      const category = await db.inventoryCategory.findFirst({
        where: { id: categoryId, outletId: user.outletId },
      })
      if (!category) {
        return safeJsonError('Category not found', 400)
      }
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (sku !== undefined) updateData.sku = sku?.trim() || null
    if (baseUnit !== undefined) updateData.baseUnit = baseUnit.trim()
    if (lowStockAlert !== undefined) updateData.lowStockAlert = lowStockAlert
    if (categoryId !== undefined) updateData.categoryId = categoryId || null

    const updated = await db.inventoryItem.update({
      where: { id },
      data: updateData,
      include: {
        category: { select: { id: true, name: true, color: true } },
      },
    })

    return safeJson(updated)
  } catch (error) {
    console.error('Inventory item PUT error:', error)
    return safeJsonError('Failed to update inventory item')
  }
}

// DELETE /api/inventory/items/[id] — delete inventory item
// Supports ?force=true to unlink compositions and delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const userId = user.id
    const outletId = user.outletId
    const { id } = await params

    const forceDelete = request.nextUrl.searchParams.get('force') === 'true'

    const existing = await db.inventoryItem.findFirst({
      where: { id, outletId },
      include: {
        _count: { select: { compositions: true, purchaseItems: true } },
      },
    })
    if (!existing) {
      return safeJsonError('Inventory item not found', 404)
    }

    // If item is used in compositions and NOT force-deleting, return linked products
    if (existing._count.compositions > 0 && !forceDelete) {
      // Fetch which products use this inventory item
      const linkedCompositions = await db.productComposition.findMany({
        where: { inventoryItemId: id },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              hasVariants: true,
            },
          },
          variant: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      const linkedProducts = linkedCompositions.map((c) => ({
        productId: c.product.id,
        productName: c.product.name,
        variantName: c.variant?.name || null,
        variantId: c.variantId || null,
        qty: c.qty,
        baseUnit: c.baseUnit,
      }))

      return safeJson({
        blocked: true,
        message: 'Bahan baku ini digunakan dalam komposisi produk',
        compositionCount: existing._count.compositions,
        linkedProducts,
      })
    }

    // If has purchase history and NOT force-deleting, block with info
    if (existing._count.purchaseItems > 0 && !forceDelete) {
      return safeJson({
        blocked: true,
        message: 'Bahan baku ini memiliki riwayat pembelian',
        hasPurchaseHistory: true,
        purchaseCount: existing._count.purchaseItems,
        compositionCount: existing._count.compositions,
        linkedProducts: [],
      })
    }

    // Execute force delete: unlink compositions, recalculate HPP, then delete
    if (existing._count.compositions > 0) {
      await db.$transaction(async (tx) => {
        // 1. Find all affected products before deleting compositions
        const compositions = await tx.productComposition.findMany({
          where: { inventoryItemId: id },
          include: {
            product: { select: { id: true, hasVariants: true, hasComposition: true } },
            variant: { select: { id: true } },
          },
        })

        // 2. Delete all compositions referencing this inventory item
        await tx.productComposition.deleteMany({
          where: { inventoryItemId: id },
        })

        // 3. For each affected product, check remaining compositions and update
        const affectedProductIds = [...new Set(compositions.map((c) => c.productId))]
        for (const productId of affectedProductIds) {
          const remainingComps = await tx.productComposition.count({
            where: { productId },
          })

          if (remainingComps === 0) {
            // No more compositions → set hasComposition = false, reset HPP
            const product = compositions.find((c) => c.productId === productId)!.product
            await tx.product.update({
              where: { id: productId },
              data: {
                hasComposition: false,
                hpp: 0,
              },
            })

            // Also reset all variant HPP if product has variants
            if (product.hasVariants) {
              const variantIds = compositions
                .filter((c) => c.productId === productId && c.variantId)
                .map((c) => c.variantId!)
              const uniqueVariantIds = [...new Set(variantIds)]

              // Reset variants that had this inventory item in their composition
              for (const variantId of uniqueVariantIds) {
                const remainingVariantComps = await tx.productComposition.count({
                  where: { variantId },
                })
                if (remainingVariantComps === 0) {
                  await tx.productVariant.update({
                    where: { id: variantId },
                    data: { hpp: 0 },
                  })
                } else {
                  // Recalculate HPP for variants that still have other compositions
                  const variantComps = await tx.productComposition.findMany({
                    where: { variantId },
                    include: {
                      inventoryItem: { select: { avgCost: true } },
                    },
                  })
                  const newHpp = variantComps.reduce(
                    (sum, c) => sum + c.qty * c.inventoryItem.avgCost,
                    0
                  )
                  await tx.productVariant.update({
                    where: { id: variantId },
                    data: { hpp: newHpp },
                  })
                }
              }
            }
          } else {
            // Still has compositions → recalculate HPP for remaining items
            const product = compositions.find((c) => c.productId === productId)!.product

            if (product.hasVariants) {
              const variantIds = compositions
                .filter((c) => c.productId === productId && c.variantId)
                .map((c) => c.variantId!)
              const uniqueVariantIds = [...new Set(variantIds)]

              for (const variantId of uniqueVariantIds) {
                const variantComps = await tx.productComposition.findMany({
                  where: { variantId },
                  include: {
                    inventoryItem: { select: { avgCost: true } },
                  },
                })
                const newHpp = variantComps.reduce(
                  (sum, c) => sum + c.qty * c.inventoryItem.avgCost,
                  0
                )
                await tx.productVariant.update({
                  where: { id: variantId },
                  data: { hpp: newHpp },
                })
              }
              // Product-level HPP stays 0 for variant products
            } else {
              const remainingCompsWithCost = await tx.productComposition.findMany({
                where: { productId },
                include: {
                  inventoryItem: { select: { avgCost: true } },
                },
              })
              const newHpp = remainingCompsWithCost.reduce(
                (sum, c) => sum + c.qty * c.inventoryItem.avgCost,
                0
              )
              await tx.product.update({
                where: { id: productId },
                data: { hpp: newHpp },
              })
            }
          }
        }

        // 4. Finally delete the inventory item
        await tx.inventoryItem.delete({ where: { id } })
      }, { timeout: 30000 })
    } else {
      // Simple delete (no compositions)
      await db.inventoryItem.delete({ where: { id } })
    }

    return safeJson({ success: true })
  } catch (error) {
    console.error('Inventory item DELETE error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to delete inventory item'
    return safeJsonError(msg, 500)
  }
}