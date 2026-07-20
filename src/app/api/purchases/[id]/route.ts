import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { FEFOEngine } from '@/lib/fefo-engine'

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
        const batchCost = variantComps.reduce((sum, c) => sum + c.qty * c.inventoryItem.avgCost, 0)
        const yieldPerBatch = variantComps[0]?.yieldPerBatch || 1
        const newHpp = yieldPerBatch > 1 ? batchCost / yieldPerBatch : batchCost
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
      const batchCost = productComps.reduce((sum, c) => sum + c.qty * c.inventoryItem.avgCost, 0)
      const yieldPerBatch = productComps[0]?.yieldPerBatch || 1
      const newHpp = yieldPerBatch > 1 ? batchCost / yieldPerBatch : batchCost
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
          orderBy: { id: 'asc' },
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

    // Map everything to plain objects to avoid any Prisma serialization edge cases
    const result = {
      id: order.id,
      orderNumber: order.orderNumber,
      totalCost: order.totalCost,
      notes: order.notes,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt?.toISOString() ?? null,
      supplier: order.supplier ? { ...order.supplier } : null,
      createdBy: order.createdBy ? { ...order.createdBy } : null,
      items: order.items.map((item) => ({
        id: item.id,
        inventoryItemId: item.inventoryItemId,
        name: item.name,
        purchaseQty: item.purchaseQty,
        purchaseUnit: item.purchaseUnit,
        baseQty: item.baseQty,
        baseUnit: item.baseUnit,
        unitCost: item.unitCost,
        totalCost: item.totalCost,
        batch: item.batch,
        expiredDate: item.expiredDate?.toISOString() ?? null,
        inventoryItem: item.inventoryItem ? { ...item.inventoryItem } : null,
      })),
    }

    return safeJson(result)
  } catch (error) {
    console.error('Purchase order GET error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Failed to load purchase order: ${msg}`)
  }
}

// PUT /api/purchases/[id] — edit purchase order (reverse old inventory, apply new)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const userId = user.id
    const outletId = user.outletId
    const { id } = await params

    const body = await request.json()
    const { notes, items } = body as {
      notes?: string
      items?: Array<{
        inventoryItemId: string
        purchaseQty: number
        purchaseUnit: string
        baseQty: number
        baseUnit: string
        unitCost: number
        totalCost: number
        batch?: string | null
        expiredDate?: string | null
      }>
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return safeJsonError('Purchase order must have at least 1 item', 400)
    }

    // Validate each item
    for (const item of items) {
      if (!item.inventoryItemId) {
        return safeJsonError('Setiap item harus memiliki inventoryItemId', 400)
      }
      if (!item.purchaseQty || item.purchaseQty <= 0) {
        return safeJsonError('Jumlah pembelian harus lebih dari 0', 400)
      }
      if (!item.baseQty || item.baseQty <= 0) {
        return safeJsonError('Isi per unit harus lebih dari 0', 400)
      }
      if (item.unitCost === undefined || item.unitCost < 0) {
        return safeJsonError('Harga satuan tidak boleh negatif', 400)
      }
      if (!item.totalCost || item.totalCost <= 0) {
        return safeJsonError('Total biaya item harus lebih dari 0', 400)
      }
    }

    // Fetch existing purchase order with items and inventory items
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

    // Validate all inventory items
    const itemIds = items.map((i) => i.inventoryItemId)
    const inventoryItems = await db.inventoryItem.findMany({
      where: { id: { in: itemIds }, outletId },
    })
    if (inventoryItems.length !== itemIds.length) {
      return safeJsonError('One or more inventory items not found', 400)
    }

    // Calculate total cost
    const totalCost = items.reduce((sum, item) => sum + (item.totalCost || 0), 0)

    const result = await db.$transaction(async (tx) => {
      const affectedInventoryItemIds: string[] = []

      // Build maps for old items
      const oldItemMap = new Map(order.items.map((item) => [item.inventoryItemId, item]))

      // Build maps for new items
      const newItemMap = new Map(items.map((item) => [item.inventoryItemId, item]))

      // ── STEP 1: Reverse old inventory changes for items that are removed or modified ──
      for (const oldItem of order.items) {
        const newItem = newItemMap.get(oldItem.inventoryItemId)
        const invItem = oldItem.inventoryItem

        // Skip stock reversal if inventory item was already deleted (orphaned PO item)
        if (!invItem) {
          continue
        }

        if (newItem) {
          // Item is modified: reverse the old qty (will re-apply new qty later)
          if (invItem.stock < oldItem.baseQty) {
            throw new Error(
              `Stok ${invItem.name} tidak mencukupi untuk edit (stok saat ini: ${invItem.stock}, harus dikurangi: ${oldItem.baseQty})`
            )
          }
          const existingStock = invItem.stock
          const existingAvgCost = invItem.avgCost
          const newStock = existingStock - oldItem.baseQty
          let newAvgCost = 0
          if (newStock > 0) {
            newAvgCost = (existingStock * existingAvgCost - oldItem.baseQty * oldItem.unitCost) / newStock
          }

          await tx.inventoryItem.update({
            where: { id: oldItem.inventoryItemId },
            data: { stock: newStock, avgCost: newAvgCost },
          })

          await tx.auditLog.create({
            data: {
              action: 'UPDATE',
              entityType: 'INVENTORY_ITEM',
              entityId: oldItem.inventoryItemId,
              details: JSON.stringify({
                itemName: invItem.name,
                action: 'REVERSE_PURCHASE_EDIT',
                purchaseOrderNumber: order.orderNumber,
                baseQtyReversed: oldItem.baseQty,
                previousStock: existingStock,
                newStock,
                previousAvgCost: existingAvgCost,
                newAvgCost,
                batch: oldItem.batch,
                expiredDate: oldItem.expiredDate?.toISOString() ?? null,
              }),
              outletId,
              userId,
            },
          })
        } else {
          // Item is removed entirely: reverse old stock
          if (invItem.stock < oldItem.baseQty) {
            throw new Error(
              `Stok ${invItem.name} tidak mencukupi untuk edit (stok saat ini: ${invItem.stock}, harus dikurangi: ${oldItem.baseQty})`
            )
          }
          const existingStock = invItem.stock
          const existingAvgCost = invItem.avgCost
          const newStock = existingStock - oldItem.baseQty
          let newAvgCost = 0
          if (newStock > 0) {
            newAvgCost = (existingStock * existingAvgCost - oldItem.baseQty * oldItem.unitCost) / newStock
          }

          await tx.inventoryItem.update({
            where: { id: oldItem.inventoryItemId },
            data: { stock: newStock, avgCost: newAvgCost },
          })

          await tx.auditLog.create({
            data: {
              action: 'UPDATE',
              entityType: 'INVENTORY_ITEM',
              entityId: oldItem.inventoryItemId,
              details: JSON.stringify({
                itemName: invItem.name,
                action: 'REMOVE_PURCHASE_ITEM',
                purchaseOrderNumber: order.orderNumber,
                baseQtyReversed: oldItem.baseQty,
                previousStock: existingStock,
                newStock,
                previousAvgCost: existingAvgCost,
                newAvgCost,
                batch: oldItem.batch,
                expiredDate: oldItem.expiredDate?.toISOString() ?? null,
              }),
              outletId,
              userId,
            },
          })
        }

        affectedInventoryItemIds.push(oldItem.inventoryItemId)
      }

      // ── STEP 2: Delete all old purchase order items ──
      await tx.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: id },
      })

      // ── STEP 3: Create new purchase order items ──
      const createdItems = await tx.purchaseOrderItem.createMany({
        data: items.map((item) => {
          const invItem = inventoryItems.find((ii) => ii.id === item.inventoryItemId)!
          return {
            purchaseOrderId: id,
            inventoryItemId: item.inventoryItemId,
            name: invItem.name,
            purchaseQty: item.purchaseQty,
            purchaseUnit: item.purchaseUnit,
            baseQty: item.baseQty,
            baseUnit: item.baseUnit,
            unitCost: item.unitCost,
            totalCost: item.totalCost || (item.baseQty * item.unitCost),
            batch: item.batch?.trim() || null,
            expiredDate: item.expiredDate ? new Date(item.expiredDate) : null,
            outletId,
          }
        }),
      })

      // ── STEP 4: Re-apply inventory changes for all new items ──
      for (const item of items) {
        const invItem = inventoryItems.find((ii) => ii.id === item.inventoryItemId)!
        // Re-fetch current stock since we may have reversed some items
        const currentInv = await tx.inventoryItem.findUnique({
          where: { id: item.inventoryItemId },
          select: { stock: true, avgCost: true },
        })
        const existingStock = currentInv?.stock ?? 0
        const existingAvgCost = currentInv?.avgCost ?? 0
        const baseQty = item.baseQty
        const unitCost = item.unitCost

        const newStock = existingStock + baseQty
        let newAvgCost = 0
        if (newStock > 0) {
          newAvgCost = (existingStock * existingAvgCost + baseQty * unitCost) / newStock
        }

        await tx.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            stock: newStock,
            avgCost: newAvgCost,
          },
        })

        // Audit log for re-applied purchase
        const wasOldItem = oldItemMap.has(item.inventoryItemId)
        await tx.auditLog.create({
          data: {
            action: 'UPDATE',
            entityType: 'INVENTORY_ITEM',
            entityId: item.inventoryItemId,
            details: JSON.stringify({
              itemName: invItem.name,
              action: wasOldItem ? 'REAPPLY_PURCHASE_EDIT' : 'ADD_PURCHASE_ITEM',
              purchaseOrderNumber: order.orderNumber,
              baseQtyAdded: baseQty,
              unitCost,
              previousStock: existingStock,
              newStock,
              previousAvgCost: existingAvgCost,
              newAvgCost,
              batch: item.batch?.trim() || null,
              expiredDate: item.expiredDate || null,
            }),
            outletId,
            userId,
          },
        })

        // Create inventory movement
        await tx.inventoryMovement.create({
          data: {
            type: 'ADJUSTMENT',
            inventoryItemId: item.inventoryItemId,
            quantity: baseQty,
            previousStock: existingStock,
            newStock,
            referenceId: id,
            referenceType: 'PURCHASE_ORDER',
            notes: `Edit pembelian: ${invItem.name} (${order.orderNumber})${item.batch?.trim() ? ` [Batch: ${item.batch.trim()}]` : ''}${item.expiredDate ? ` [Exp: ${item.expiredDate.split('T')[0]}]` : ''}`,
            outletId,
            userId,
          },
        })

        affectedInventoryItemIds.push(item.inventoryItemId)
      }

      // ── STEP 5: Update purchase order ──
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          totalCost,
          notes: notes?.trim() || null,
        },
      })

      // ── STEP 5.5: Create new InventoryBatch records for FEFO tracking ──
      //
      // AUDIT-3-002 FIX: Previously the old batch records were LEFT as AVAILABLE
      // with their full remainingQty, and NEW batches were created on top. This
      // broke `InventoryItem.stock == SUM(AVAILABLE batches.remainingQty)` and
      // caused FEFO to consume from phantom old batches. Verified by audit:
      // editing PO with batch A→B left BOTH batches as AVAILABLE.
      //
      // Now we DELETE the old batches first (same as the DELETE handler does).
      // `deleteBatchesForPurchase` throws if any batch was partially consumed
      // (remainingQty < initialQty) — this protects consumption-log integrity.
      // The stock check at STEP 1 already blocks edits when stock < oldBaseQty
      // (which happens when a sale consumed from the batch), so this is a
      // belt-and-suspenders guard with a clearer error message.
      await FEFOEngine.deleteBatchesForPurchase(tx, { purchaseOrderId: id, outletId })

      // Create new batch records to reflect the edited items.
      const orderSupplier = await tx.purchaseOrder.findFirst({
        where: { id, outletId },
        select: { supplier: { select: { id: true, name: true } } },
      })
      await FEFOEngine.createBatchesFromPurchase(tx, {
        purchaseOrderId: id,
        items: items.map(item => ({
          inventoryItemId: item.inventoryItemId,
          name: inventoryItems.find(ii => ii.id === item.inventoryItemId)!.name,
          baseQty: item.baseQty,
          unitCost: item.unitCost,
          batch: item.batch?.trim() || null,
          expiredDate: item.expiredDate ? new Date(item.expiredDate) : null,
        })),
        outletId,
        supplierId: orderSupplier?.supplier?.id || null,
        supplierName: orderSupplier?.supplier?.name || null,
      })

      // ── STEP 6: Recalculate HPP ──
      const uniqueAffectedIds = [...new Set(affectedInventoryItemIds)]
      await recalculateHppForAffectedProducts(tx, uniqueAffectedIds)

      // Return updated order
      return tx.purchaseOrder.findFirst({
        where: { id, outletId },
        include: {
          items: {
            orderBy: { id: 'asc' },
            include: {
              inventoryItem: {
                select: { id: true, name: true, sku: true, baseUnit: true },
              },
            },
          },
          supplier: { select: { id: true, name: true, phone: true, address: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      })
    }, { timeout: 30000 })

    // Map Prisma result to plain object for safe serialization
    const mapped = result ? {
      id: result.id,
      orderNumber: result.orderNumber,
      totalCost: result.totalCost,
      notes: result.notes,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt?.toISOString() ?? null,
      supplier: result.supplier ? { ...result.supplier } : null,
      createdBy: result.createdBy ? { ...result.createdBy } : null,
      items: (result.items || []).map((item: { id: string; inventoryItemId: string; name: string; purchaseQty: number; purchaseUnit: string; baseQty: number; baseUnit: string; unitCost: number; totalCost: number; batch?: string | null; expiredDate?: Date | null; inventoryItem?: { id: string; name: string; sku: string | null; baseUnit: string } | null }) => ({
        id: item.id,
        inventoryItemId: item.inventoryItemId,
        name: item.name,
        purchaseQty: item.purchaseQty,
        purchaseUnit: item.purchaseUnit,
        baseQty: item.baseQty,
        baseUnit: item.baseUnit,
        unitCost: item.unitCost,
        totalCost: item.totalCost,
        batch: item.batch,
        expiredDate: item.expiredDate?.toISOString() ?? null,
        inventoryItem: item.inventoryItem ? { ...item.inventoryItem } : null,
      })),
    } : null

    return safeJson(mapped)
  } catch (error) {
    console.error('Purchase order PUT error:', error)
    if (error instanceof Error && (error.message.includes('tidak mencukupi') || error.message.includes('stok'))) {
      return safeJsonError(error.message, 400)
    }
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Gagal mengedit pembelian: ${msg}`)
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
    // CREW-001 FIX: Only OWNER can delete purchase orders (destructive — destroys batch/stock history)
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya OWNER yang dapat melakukan aksi ini', 403)
    }
    const userId = user.id
    const outletId = user.outletId
    const { id } = await params

    // Fetch the PO with basic info first
    const poWithSupplier = await db.purchaseOrder.findFirst({
      where: { id, outletId },
      select: { 
        id: true, 
        orderNumber: true,
        totalCost: true,
        createdAt: true,
        supplier: { select: { id: true, name: true } },
      },
    })

    if (!poWithSupplier) {
      return safeJsonError('Purchase order not found', 404)
    }

    // Fetch items separately to handle orphaned inventory items gracefully
    // This avoids Prisma error when inventoryItem is null (deleted)
    const items = await db.purchaseOrderItem.findMany({
      where: { purchaseOrderId: id },
      orderBy: { id: 'asc' },
    })

    // Fetch inventory items that still exist (exclude deleted/orphaned ones)
    const itemInvIds = items.map(i => i.inventoryItemId).filter(Boolean)
    const existingInvItems = itemInvIds.length > 0 
      ? await db.inventoryItem.findMany({
          where: { id: { in: itemInvIds }, outletId },
          select: { id: true, name: true, stock: true, avgCost: true },
        })
      : []
    
    const invItemMap = new Map(existingInvItems.map(inv => [inv.id, inv]))

    // Build order object with items (handling orphaned items as null)
    const order = {
      ...poWithSupplier,
      items: items.map(item => ({
        ...item,
        inventoryItem: invItemMap.get(item.inventoryItemId) || null,
      })),
    }

    await db.$transaction(async (tx) => {
      const affectedInventoryItemIds: string[] = []

      // Delete InventoryBatch records for this PO (before inventory reversal)
      await FEFOEngine.deleteBatchesForPurchase(tx, { purchaseOrderId: id, outletId })

      // Reverse inventory for each item
      for (const item of order.items) {
        const invItem = item.inventoryItem
        const baseQty = item.baseQty

        // Skip stock reversal if inventory item was already deleted (orphaned PO item)
        if (!invItem) {
          console.warn(`[PO DELETE] Skipping orphaned PO item "${item.name}" (inventoryItemId=${item.inventoryItemId} no longer exists)`)
          continue
        }

        // Prevent negative stock
        if (invItem.stock < baseQty) {
          throw new Error(
            `Stok ${invItem.name} tidak mencukupi untuk pembatalan (stok saat ini: ${invItem.stock}, harus dikurangi: ${baseQty})`
          )
        }

        // Reverse weighted average cost
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
              batch: item.batch,
              expiredDate: item.expiredDate?.toISOString() ?? null,
            }),
            outletId,
            userId,
          },
        })

        affectedInventoryItemIds.push(item.inventoryItemId)
      }

      // Audit log for purchase order deletion itself
      await tx.auditLog.create({
        data: {
          action: 'DELETE',
          entityType: 'PURCHASE_ORDER',
          entityId: id,
          details: JSON.stringify({
            orderNumber: order.orderNumber,
            totalCost: order.totalCost,
            itemCount: order.items.length,
            itemNames: order.items.map((i) => i.name),
            batchInfo: order.items
              .filter((i) => i.batch || i.expiredDate)
              .map((i) => ({ name: i.name, batch: i.batch, expiredDate: i.expiredDate?.toISOString() ?? null })),
            supplierName: order.supplier?.name || null,
            createdAt: order.createdAt.toISOString(),
          }),
          outletId,
          userId,
        },
      })

      // Delete purchase order (items cascade delete)
      await tx.purchaseOrder.delete({
        where: { id },
      })

      // Recalculate HPP for affected products
      await recalculateHppForAffectedProducts(tx, affectedInventoryItemIds)
    }, { timeout: 30000 })

    return safeJson({ success: true })
  } catch (error) {
    console.error('Purchase order DELETE error:', error)
    if (error instanceof Error) {
      if (error.message.includes('tidak mencukupi') || error.message.includes('stok')) {
        // Add more context about why deletion failed
        const enhancedMessage = error.message + 
          '\n\nItem dalam pembelian ini sudah terpakai/dijual. ' +
          'Hapus pembelian yang sudah memiliki riwayat penggunaan tidak diperbolehkan untuk menjaga integritas data.'
        return safeJsonError(enhancedMessage, 400)
      }
      if (error.message.includes('sudah terpakai')) {
        return safeJsonError(error.message, 400)
      }
      // Return actual error detail for debugging
      return safeJsonError(`Gagal menghapus pembelian: ${error.message}`)
    }
    return safeJsonError('Gagal menghapus pembelian. Coba lagi beberapa saat.')
  }
}