import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

// GET /api/inventory/items/[id] — get single inventory item with linked products & movements
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params
    const url = new URL(request.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const limit = 20
    const skip = (page - 1) * limit

    const item = await db.inventoryItem.findFirst({
      where: { id, outletId: user.outletId },
      include: {
        category: { select: { id: true, name: true, color: true } },
        _count: { select: { compositions: true, purchaseItems: true, movements: true } },
      },
    })

    if (!item) {
      return safeJsonError('Inventory item not found', 404)
    }

    // Fetch linked products (products that use this inventory item in composition)
    const compositions = await db.productComposition.findMany({
      where: { inventoryItemId: id },
      include: {
        product: {
          select: { id: true, name: true, sku: true, price: true, stock: true, hasVariants: true, image: true },
        },
        variant: {
          select: { id: true, name: true, price: true, stock: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const linkedProducts = compositions.map((c) => ({
      id: c.id,
      productId: c.product.id,
      productName: c.product.name,
      productSku: c.product.sku,
      productImage: c.product.image,
      productPrice: c.product.price,
      productStock: c.product.stock,
      variantId: c.variant?.id || null,
      variantName: c.variant?.name || null,
      variantPrice: c.variant?.price || null,
      qty: c.qty,
      yieldPerBatch: c.yieldPerBatch,
      baseUnit: c.baseUnit,
    }))

    // Fetch recent movements
    const [movements, totalMovements] = await Promise.all([
      db.inventoryMovement.findMany({
        where: { inventoryItemId: id, outletId: user.outletId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
        include: {
          user: { select: { id: true, name: true } },
        },
      }),
      db.inventoryMovement.count({
        where: { inventoryItemId: id, outletId: user.outletId },
      }),
    ])

    const formattedMovements = movements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      previousStock: m.previousStock,
      newStock: m.newStock,
      referenceId: m.referenceId,
      referenceType: m.referenceType,
      notes: m.notes,
      createdAt: m.createdAt.toISOString(),
      userName: m.user?.name || null,
    }))

    return safeJson({
      ...item,
      linkedProducts,
      movements: formattedMovements,
      movementPagination: {
        page,
        totalPages: Math.ceil(totalMovements / limit),
        total: totalMovements,
      },
    })
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

    // Also block if there are purchase order items referencing this
    if (existing._count.purchaseItems > 0) {
      return safeJsonError(
        `Tidak dapat menghapus bahan baku ini karena sudah memiliki ${existing._count.purchaseItems} riwayat pembelian. Gunakan fitur nonaktifkan sebagai gantinya.`,
        400
      )
    }

    // Execute force delete: unlink compositions, set product stock=0, recalculate HPP, then delete
    if (forceDelete && existing._count.compositions > 0) {
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
            // No more compositions → set hasComposition = false, reset HPP, set stock = 0
            const product = compositions.find((c) => c.productId === productId)!.product
            await tx.product.update({
              where: { id: productId },
              data: {
                hasComposition: false,
                hpp: 0,
                stock: 0,
              },
            })

            // Also reset ALL variant stock and HPP if product has variants
            if (product.hasVariants) {
              const variantIds = compositions
                .filter((c) => c.productId === productId && c.variantId)
                .map((c) => c.variantId!)
              const uniqueVariantIds = [...new Set(variantIds)]

              for (const variantId of uniqueVariantIds) {
                const remainingVariantComps = await tx.productComposition.count({
                  where: { variantId },
                })
                if (remainingVariantComps === 0) {
                  await tx.productVariant.update({
                    where: { id: variantId },
                    data: { hpp: 0, stock: 0 },
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

              // Also zero out ALL variants of this product (not just the ones with this item)
              // because the product's recipe is now broken
              await tx.productVariant.updateMany({
                where: { productId },
                data: { stock: 0 },
              })
              // Re-sum parent product stock from variants
              const aggResult = await tx.productVariant.aggregate({
                where: { productId },
                _sum: { stock: true },
              })
              await tx.product.update({
                where: { id: productId },
                data: { stock: aggResult._sum.stock || 0 },
              })
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

        // 4. Create audit logs for affected products
        await tx.auditLog.createMany({
          data: affectedProductIds.map((productId) => ({
            action: 'UPDATE',
            entityType: 'PRODUCT',
            entityId: productId,
            details: JSON.stringify({
              reason: 'INVENTORY_ITEM_DELETED',
              inventoryItemId: id,
              inventoryItemName: existing.name,
              message: `Item "${existing.name}" dihapus dari inventory. Stok produk direset ke 0. Sesuaikan komposisi secara manual.`,
            }),
            outletId,
            userId,
          })),
        })

        // 5. Finally delete the inventory item
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