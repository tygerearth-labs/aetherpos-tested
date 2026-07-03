import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

// Helper: recalculate HPP for all products affected by the given inventory item IDs
async function recalculateHppForAffectedProducts(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  inventoryItemIds: string[]
) {
  const compositions = await tx.productComposition.findMany({
    where: {
      inventoryItemId: { in: inventoryItemIds },
      product: { hasComposition: true },
    },
    include: {
      product: {
        select: { id: true, hasVariants: true },
      },
      variant: {
        select: { id: true },
      },
      inventoryItem: {
        select: { avgCost: true },
      },
    },
  })

  if (compositions.length === 0) return

  const affectedProductIds = [...new Set(compositions.map((c) => c.productId))]

  for (const productId of affectedProductIds) {
    const productComps = compositions.filter((c) => c.productId === productId)
    const hasVariants = productComps[0].product.hasVariants

    if (hasVariants) {
      const variantIds = [...new Set(productComps.filter((c) => c.variantId).map((c) => c.variantId!))]
      for (const variantId of variantIds) {
        const variantComps = productComps.filter((c) => c.variantId === variantId)
        const newHpp = variantComps.reduce((sum, c) => sum + c.qty * c.inventoryItem.avgCost, 0)
        await tx.productVariant.update({
          where: { id: variantId },
          data: { hpp: newHpp },
        })
      }
      await tx.product.update({
        where: { id: productId },
        data: { hpp: 0 },
      })
    } else {
      const newHpp = productComps.reduce((sum, c) => sum + c.qty * c.inventoryItem.avgCost, 0)
      await tx.product.update({
        where: { id: productId },
        data: { hpp: newHpp },
      })
    }
  }
}

// GET /api/purchases/[id] — get purchase order detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    const order = await db.purchaseOrder.findFirst({
      where: { id, outletId: user.outletId },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                sku: true,
                baseUnit: true,
              },
            },
          },
        },
        supplier: {
          select: { id: true, name: true, phone: true, address: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    if (!order) {
      return safeJsonError('Purchase order not found', 404)
    }

    return safeJson(order)
  } catch (error) {
    console.error('Purchase order GET error:', error)
    return safeJsonError('Failed to load purchase order')
  }
}

// DELETE /api/purchases/[id] — delete purchase order (reverse inventory)
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

    const order = await db.purchaseOrder.findFirst({
      where: { id, outletId },
      include: {
        items: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, stock: true, avgCost: true },
            },
          },
        },
      },
    })

    if (!order) {
      return safeJsonError('Purchase order not found', 404)
    }

    await db.$transaction(async (tx) => {
      const affectedInventoryItemIds: string[] = []

      // Reverse inventory for each item
      for (const item of order.items) {
        const invItem = item.inventoryItem
        const baseQty = item.baseQty

        // Prevent negative stock
        if (invItem.stock < baseQty) {
          throw new Error(
            `Stok ${invItem.name} tidak mencukupi untuk pembatalan (stok saat ini: ${invItem.stock}, harus dikurangi: ${baseQty})`
          )
        }

        // Reverse weighted average cost
        // newStock = existingStock - baseQty
        // newAvgCost = (existingStock * existingAvgCost - baseQty * item.unitCost) / newStock
        const existingStock = invItem.stock
        const existingAvgCost = invItem.avgCost
        const newStock = existingStock - baseQty
        let newAvgCost = 0
        if (newStock > 0) {
          newAvgCost = (existingStock * existingAvgCost - baseQty * item.unitCost) / newStock
        }

        await tx.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            stock: newStock,
            avgCost: newAvgCost,
          },
        })

        // Audit log
        await tx.auditLog.create({
          data: {
            action: 'DELETE',
            entityType: 'INVENTORY_ITEM',
            entityId: item.inventoryItemId,
            details: JSON.stringify({
              itemName: invItem.name,
              action: 'REVERSE_PURCHASE',
              purchaseOrderNumber: order.orderNumber,
              baseQtyReversed: baseQty,
              previousStock: existingStock,
              newStock,
              previousAvgCost: existingAvgCost,
              newAvgCost,
            }),
            outletId,
            userId,
          },
        })

        affectedInventoryItemIds.push(item.inventoryItemId)
      }

      // Delete purchase order (items cascade delete)
      await tx.purchaseOrder.delete({
        where: { id },
      })

      // Recalculate HPP for affected products
      await recalculateHppForAffectedProducts(tx, affectedInventoryItemIds)
    })

    return safeJson({ success: true })
  } catch (error) {
    console.error('Purchase order DELETE error:', error)
    if (error instanceof Error && (error.message.includes('tidak mencukupi') || error.message.includes('stok'))) {
      return safeJsonError(error.message, 400)
    }
    return safeJsonError('Failed to delete purchase order')
  }
}