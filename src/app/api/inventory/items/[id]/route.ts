import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLog } from '@/lib/safe-audit'

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
    let linkedProducts: Array<{
      id: string; productId: string; productName: string; productSku: string | null;
      productImage: string | null; productPrice: number; productStock: number;
      variantId: string | null; variantName: string | null; variantPrice: number | null;
      qty: number; yieldPerBatch: number; baseUnit: string;
    }> = []

    try {
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

      // Clean up orphaned compositions (product was deleted but composition remained)
      const orphanIds = compositions.filter((c) => !c.product).map((c) => c.id)
      if (orphanIds.length > 0) {
        await db.productComposition.deleteMany({ where: { id: { in: orphanIds } } })
        // Re-fetch with fresh count
        const freshItem = await db.inventoryItem.findFirst({
          where: { id, outletId: user.outletId },
          include: { _count: { select: { compositions: true } } },
        })
        if (freshItem) item._count.compositions = freshItem._count.compositions
      }

      // Filter out orphaned compositions and map to linked products
      linkedProducts = compositions
        .filter((c) => c.product)
        .map((c) => ({
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
    } catch (compError) {
      console.warn('[InventoryItem GET] Failed to fetch compositions, returning item without linked products:', compError)
    }

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
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Failed to load inventory item: ${msg}`)
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

      const linkedProducts = linkedCompositions
        .filter((c) => c.product)
        .map((c) => ({
          productId: c.product.id,
          productName: c.product.name,
          variantName: c.variant?.name || null,
          variantId: c.variantId || null,
          qty: c.qty,
          baseUnit: c.baseUnit,
        }))

      return safeJson({
        blocked: true,
        message: 'Item ini digunakan dalam komposisi produk',
        compositionCount: existing._count.compositions,
        linkedProducts,
      })
    }

    // If item has purchase order items referencing it — warn the user
    // With force=true, we nullify the FK reference instead of blocking
    if (existing._count.purchaseItems > 0 && !forceDelete) {
      return safeJson({
        blocked: true,
        blockType: 'purchaseItems',
        message: 'Item ini memiliki riwayat pembelian',
        purchaseItemCount: existing._count.purchaseItems,
        linkedProducts: [],
      })
    }

    // Execute force delete: unlink compositions, set product stock=0, recalculate HPP, then delete
    if (forceDelete && existing._count.compositions > 0) {
      await db.$transaction(async (tx) => {
        // 1. Nullify purchase order item references to this inventory item (keep purchase history)
        if (existing._count.purchaseItems > 0) {
          await tx.purchaseOrderItem.updateMany({
            where: { inventoryItemId: id },
            data: { inventoryItemId: '' },
          })
        }

        // 1b. Clean up inventory transfer items and consumption snapshots
        await tx.inventoryTransferItem.deleteMany({ where: { inventoryItemId: id } })
        await tx.transactionConsumption.deleteMany({ where: { inventoryItemId: id } })

        // 2. Find all affected products before deleting compositions
        const compositions = await tx.productComposition.findMany({
          where: { inventoryItemId: id },
          include: {
            product: { select: { id: true, hasVariants: true, hasComposition: true } },
            variant: { select: { id: true } },
          },
        })

        // 3. Delete all compositions referencing this inventory item
        await tx.productComposition.deleteMany({
          where: { inventoryItemId: id },
        })

        // 4. For each affected product, check remaining compositions and update
        const affectedProductIds = [...new Set(compositions.map((c) => c.productId))]

        // Helper: yield-aware HPP calculation (matches composition PUT logic)
        const calcHpp = (comps: Array<{ qty: number; yieldPerBatch: number; inventoryItem: { avgCost: number } }>) => {
          if (comps.length === 0) return 0
          const batchCost = comps.reduce((sum, c) => sum + c.qty * c.inventoryItem.avgCost, 0)
          const representativeYield = comps[0]?.yieldPerBatch || 1
          return representativeYield > 1 ? batchCost / representativeYield : batchCost
        }

        for (const productId of affectedProductIds) {
          const product = compositions.find((c) => c.productId === productId)!.product
          const remainingComps = await tx.productComposition.count({
            where: { productId },
          })

          if (remainingComps === 0) {
            // No more compositions → recipe broken → reset everything
            await tx.product.update({
              where: { id: productId },
              data: { hasComposition: false, hpp: 0, stock: 0 },
            })
            if (product.hasVariants) {
              // Zero out ALL variant stock + HPP
              await tx.productVariant.updateMany({
                where: { productId },
                data: { hpp: 0, stock: 0 },
              })
            }
          } else {
            // Still has compositions → recalculate HPP (yield-aware)
            if (product.hasVariants) {
              // Recalculate HPP per variant that was affected
              const affectedVariantIds = [...new Set(
                compositions
                  .filter((c) => c.productId === productId && c.variantId)
                  .map((c) => c.variantId!)
              )]
              for (const variantId of affectedVariantIds) {
                const variantComps = await tx.productComposition.findMany({
                  where: { variantId },
                  include: { inventoryItem: { select: { avgCost: true } } },
                })
                await tx.productVariant.update({
                  where: { id: variantId },
                  data: { hpp: calcHpp(variantComps) },
                })
              }
            } else {
              // Non-variant product: recalculate product-level HPP
              const remainingCompsWithCost = await tx.productComposition.findMany({
                where: { productId },
                include: { inventoryItem: { select: { avgCost: true } } },
              })
              await tx.product.update({
                where: { id: productId },
                data: { hpp: calcHpp(remainingCompsWithCost) },
              })
            }
          }
        }

        // 5. Create audit logs for affected products
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

        // 6. Audit log for inventory item deletion itself
        await tx.auditLog.create({
          data: {
            action: 'DELETE',
            entityType: 'INVENTORY_ITEM',
            entityId: id,
            details: JSON.stringify({
              itemName: existing.name,
              sku: existing.sku,
              stock: existing.stock,
              avgCost: existing.avgCost,
              baseUnit: existing.baseUnit,
              compositionCount: existing._count.compositions,
              purchaseItemCount: existing._count.purchaseItems,
              forceDelete: true,
              affectedProducts: affectedProductIds.length,
            }),
            outletId,
            userId,
          },
        })

        // 7. Finally delete the inventory item
        await tx.inventoryItem.delete({ where: { id } })
      }, { timeout: 30000 })
    } else if (existing._count.purchaseItems > 0) {
      // Force delete with purchase items but no compositions: nullify references first
      await db.$transaction(async (tx) => {
        // Audit log for inventory item deletion
        await tx.auditLog.create({
          data: {
            action: 'DELETE',
            entityType: 'INVENTORY_ITEM',
            entityId: id,
            details: JSON.stringify({
              itemName: existing.name,
              sku: existing.sku,
              stock: existing.stock,
              avgCost: existing.avgCost,
              baseUnit: existing.baseUnit,
              purchaseItemCount: existing._count.purchaseItems,
              forceDelete: true,
              reason: 'HAS_PURCHASE_HISTORY',
            }),
            outletId,
            userId,
          },
        })

        // Nullify purchase order item references (keep purchase history, just unlink)
        await tx.purchaseOrderItem.updateMany({
          where: { inventoryItemId: id },
          data: { inventoryItemId: '' },
        })

        // Delete movements referencing this item
        await tx.inventoryMovement.deleteMany({
          where: { inventoryItemId: id },
        })

        // Delete inventory transfer items and consumption snapshots
        await tx.inventoryTransferItem.deleteMany({ where: { inventoryItemId: id } })
        await tx.transactionConsumption.deleteMany({ where: { inventoryItemId: id } })

        // Delete the inventory item
        await tx.inventoryItem.delete({ where: { id } })
      }, { timeout: 30000 })
    } else {
      // Simple delete (no compositions, no purchase items)
      // Clean up any remaining child records (movements, transfer items, consumption snapshots)
      await db.$transaction(async (tx) => {
        // Audit log for inventory item deletion
        await tx.auditLog.create({
          data: {
            action: 'DELETE',
            entityType: 'INVENTORY_ITEM',
            entityId: id,
            details: JSON.stringify({
              itemName: existing.name,
              sku: existing.sku,
              stock: existing.stock,
              avgCost: existing.avgCost,
              baseUnit: existing.baseUnit,
              reason: 'SIMPLE_DELETE',
            }),
            outletId,
            userId,
          },
        })

        await tx.inventoryMovement.deleteMany({ where: { inventoryItemId: id } })
        await tx.inventoryTransferItem.deleteMany({ where: { inventoryItemId: id } })
        await tx.transactionConsumption.deleteMany({ where: { inventoryItemId: id } })
        await tx.inventoryItem.delete({ where: { id } })
      }, { timeout: 30000 })
    }

    return safeJson({ success: true })
  } catch (error) {
    console.error('Inventory item DELETE error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to delete inventory item'
    return safeJsonError(msg, 500)
  }
}