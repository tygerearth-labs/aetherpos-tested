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
        _count: { select: { compositions: true, purchaseItems: true, movements: true, inventoryTransferItems: true, consumptionSnapshots: true, batches: true } },
      },
    })

    if (!item) {
      return safeJsonError('Inventory item not found', 404)
    }

    // Fetch batch summary for this item.
    // IMPORTANT: We surface counts and the nearest expiry from ALL batches
    // (AVAILABLE + EXPIRED + CONSUMED), not just AVAILABLE ones. Otherwise,
    // when every batch for an item is already EXPIRED, the UI would show
    // "0 batch" and no expiry date — making users think batch data is missing
    // even though expired batches exist and are visible in the Batch tab.
    let batchSummary: {
      totalBatches: number
      availableBatches: number
      expiredBatches: number
      totalRemainingQty: number
      nearestExpiryDate: string | null
      nearestExpiryStatus: 'EXPIRED' | 'EXPIRING_SOON' | 'FRESH' | null
    } = {
      totalBatches: 0,
      availableBatches: 0,
      expiredBatches: 0,
      totalRemainingQty: 0,
      nearestExpiryDate: null,
      nearestExpiryStatus: null,
    }

    try {
      const batches = await db.inventoryBatch.findMany({
        where: { inventoryItemId: id, outletId: user.outletId },
        select: { status: true, remainingQty: true, expiredDate: true },
        orderBy: { expiredDate: 'asc' },
      })
      const now = new Date()
      const available = batches.filter(b => b.status === 'AVAILABLE')
      const expired = batches.filter(b => b.status === 'EXPIRED')

      // Nearest expiry comes from ALL batches that have an expiry date,
      // so the user can see expired batches too (not just future ones).
      const allWithExpiry = batches
        .map(b => b.expiredDate)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())
      const nearest = allWithExpiry[0] ?? null

      let nearestExpiryStatus: 'EXPIRED' | 'EXPIRING_SOON' | 'FRESH' | null = null
      if (nearest) {
        const daysLeft = Math.ceil((nearest.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        if (daysLeft < 0) nearestExpiryStatus = 'EXPIRED'
        else if (daysLeft <= 30) nearestExpiryStatus = 'EXPIRING_SOON'
        else nearestExpiryStatus = 'FRESH'
      }

      batchSummary = {
        totalBatches: batches.length,
        availableBatches: available.length,
        expiredBatches: expired.length,
        // Remaining qty counts only AVAILABLE batches (expired stock is not sellable).
        totalRemainingQty: available.reduce((sum, b) => sum + (b.remainingQty || 0), 0),
        nearestExpiryDate: nearest ? nearest.toISOString() : null,
        nearestExpiryStatus,
      }
    } catch (batchErr) {
      console.warn('[InventoryItem GET] Failed to fetch batch summary:', batchErr)
    }

    // Fetch linked products (products that use this inventory item in composition)
    let linkedProducts: Array<{
      id: string; productId: string; productName: string; productSku: string | null;
      productImage: string | null; productPrice: number; productStock: number;
      variantId: string | null; variantName: string | null; variantPrice: number | null;
      qty: number; yieldPerBatch: number; baseUnit: string;
    }> = []

    try {
      const allComps = await db.productComposition.findMany({
        where: { inventoryItemId: id },
        select: { id: true, productId: true, variantId: true, qty: true, yieldPerBatch: true, baseUnit: true },
        orderBy: { createdAt: 'desc' },
      })

      const productIds = [...new Set(allComps.map((c) => c.productId))]
      const variantIds = [...new Set(allComps.filter((c) => c.variantId).map((c) => c.variantId!))]

      const [existingProducts, existingVariants] = await Promise.all([
        db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, sku: true, price: true, stock: true, hasVariants: true, image: true },
        }),
        variantIds.length > 0
          ? db.productVariant.findMany({
              where: { id: { in: variantIds } },
              select: { id: true, name: true, price: true, stock: true },
            })
          : Promise.resolve([]),
      ])

      const productMap = new Map(existingProducts.map((p) => [p.id, p]))
      const variantMap = new Map(existingVariants.map((v) => [v.id, v]))

      // Delete orphaned composition rows (product gone)
      const orphanIds = allComps.filter((c) => !productMap.has(c.productId)).map((c) => c.id)
      if (orphanIds.length > 0) {
        await db.productComposition.deleteMany({ where: { id: { in: orphanIds } } })
        const freshItem = await db.inventoryItem.findFirst({
          where: { id, outletId: user.outletId },
          include: { _count: { select: { compositions: true } } },
        })
        if (freshItem) item._count.compositions = freshItem._count.compositions
      }

      linkedProducts = allComps
        .filter((c) => productMap.has(c.productId))
        .map((c) => {
          const prod = productMap.get(c.productId)!
          const variant = c.variantId ? variantMap.get(c.variantId) : undefined
          return {
            id: c.id,
            productId: prod.id,
            productName: prod.name,
            productSku: prod.sku,
            productImage: prod.image,
            productPrice: prod.price,
            productStock: prod.stock,
            variantId: variant?.id || null,
            variantName: variant?.name || null,
            variantPrice: variant?.price || null,
            qty: c.qty,
            yieldPerBatch: c.yieldPerBatch,
            baseUnit: c.baseUnit,
          }
        })
    } catch (compError) {
      console.warn('[InventoryItem GET] Failed to fetch compositions:', compError)
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
      batchSummary,
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

// PATCH /api/inventory/items/[id] — archive or restore inventory item
export async function PATCH(
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
    const { action } = body as { action: 'archive' | 'restore' }

    if (action !== 'archive' && action !== 'restore') {
      return safeJsonError('Action harus archive atau restore', 400)
    }

    const existing = await db.inventoryItem.findFirst({
      where: { id, outletId },
    })
    if (!existing) {
      return safeJsonError('Inventory item not found', 404)
    }

    if (action === 'archive' && existing.status === 'ARCHIVED') {
      return safeJsonError('Item sudah tidak aktif', 400)
    }
    if (action === 'restore' && existing.status === 'ACTIVE') {
      return safeJsonError('Item sudah aktif', 400)
    }

    const newStatus = action === 'archive' ? 'ARCHIVED' : 'ACTIVE'

    await db.inventoryItem.update({
      where: { id },
      data: { status: newStatus },
    })

    await safeAuditLog({
      action: action === 'archive' ? 'ARCHIVE' : 'RESTORE',
      entityType: 'INVENTORY_ITEM',
      entityId: id,
      details: JSON.stringify({
        itemName: existing.name,
        sku: existing.sku,
        previousStatus: existing.status,
        newStatus,
      }),
      outletId,
      userId,
    })

    return safeJson({ success: true, status: newStatus })
  } catch (error) {
    console.error('Inventory item PATCH error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to update inventory item'
    return safeJsonError(msg, 500)
  }
}

// DELETE /api/inventory/items/[id] — hard delete inventory item
//
// SMART DELETE LOGIC:
//   ✅ ALLOWED: No history at all
//   ✅ ALLOWED: Only MIGRATION data (initial stock from upload template)
//   ❌ BLOCKED: Real business history (purchases, sales, transfers, manual adjustments)
//
// Migration data that gets cleaned up on delete:
//   - InventoryMovement with referenceType='MIGRATION'
//   - Auto 1:1 ProductComposition from product_stock mode
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

    const existing = await db.inventoryItem.findFirst({
      where: { id, outletId },
      include: {
        _count: {
          select: {
            compositions: true,
            purchaseItems: true,
            movements: true,
            inventoryTransferItems: true,
            consumptionSnapshots: true,
          },
        },
      },
    })
    if (!existing) {
      return safeJsonError('Inventory item not found', 404)
    }

    const counts = existing._count
    const totalRelations = counts.compositions + counts.purchaseItems + counts.movements
      + counts.inventoryTransferItems + counts.consumptionSnapshots

    // Quick path: no relations at all → safe to delete
    if (totalRelations === 0) {
      await db.$transaction(async (tx) => {
        await tx.auditLog.create({
          data: {
            action: 'DELETE',
            entityType: 'INVENTORY_ITEM',
            entityId: id,
            details: JSON.stringify({
              itemName: existing.name,
              sku: existing.sku,
              reason: 'NO_HISTORY',
            }),
            outletId,
            userId,
          },
        })
        await tx.inventoryItem.delete({ where: { id } })
      }, { timeout: 10000 })

      return safeJson({ success: true, message: 'Item dihapus (tidak ada histori)' })
    }

    // === DETAILED ANALYSIS FOR ITEMS WITH RELATIONS ===
    
    const analysis = {
      hasRealHistory: false,
      hasOnlyMigrationData: false,
      blockers: [] as string[],
      migrationData: [] as string[],
      details: {
        migrationMovements: 0,
        realMovements: 0,
        autoCompositions: 0,
        realCompositions: 0,
      },
    }

    // 1. Purchase Items: ALWAYS real history
    if (counts.purchaseItems > 0) {
      analysis.hasRealHistory = true
      analysis.blockers.push(`${counts.purchaseItems} riwayat pembelian`)
    }

    // 2. Transfer Items: ALWAYS real history
    if (counts.inventoryTransferItems > 0) {
      analysis.hasRealHistory = true
      analysis.blockers.push(`${counts.inventoryTransferItems} riwayat transfer`)
    }

    // 3. Consumption Snapshots: ALWAYS real history (from actual sales)
    if (counts.consumptionSnapshots > 0) {
      analysis.hasRealHistory = true
      analysis.blockers.push(`${counts.consumptionSnapshots} riwayat konsumsi penjualan`)
    }

    // 4. Movements: Check types (MIGRATION vs real business)
    if (counts.movements > 0) {
      const movementTypes = await db.inventoryMovement.groupBy({
        by: ['referenceType'],
        where: {
          inventoryItemId: id,
          outletId,
        },
        _count: true,
      })

      const migrationMovements = movementTypes.find(m => m.referenceType === 'MIGRATION')?._count || 0
      const realMovements = counts.movements - migrationMovements

      analysis.details.migrationMovements = migrationMovements
      analysis.details.realMovements = realMovements

      if (realMovements > 0) {
        analysis.hasRealHistory = true
        analysis.blockers.push(`${realMovements} pergerakan stok bisnis`)
      }
      if (migrationMovements > 0) {
        analysis.migrationData.push(`${migrationMovements} catatan stok awal migrasi`)
      }
    }

    // 5. Compositions: Check if auto 1:1 or manual BOM
    if (counts.compositions > 0) {
      const compositions = await db.productComposition.findMany({
        where: {
          inventoryItemId: id,
        },
        select: {
          id: true,
          qty: true,
          baseUnit: true,
          productId: true,
        },
      })

      let autoCount = 0
      let realCount = 0

      for (const comp of compositions) {
        // Auto 1:1 links have qty=1 and valid baseUnit
        const isAutoLink = comp.qty === 1 && comp.baseUnit !== null
        
        if (isAutoLink) {
          autoCount++
        } else {
          realCount++
        }
      }

      analysis.details.autoCompositions = autoCount
      analysis.details.realCompositions = realCount

      if (realCount > 0) {
        analysis.hasRealHistory = true
        analysis.blockers.push(`${realCount} komposisi/resep produk`)
      }
      if (autoCount > 0) {
        analysis.migrationData.push(`${autoCount} link otomatis produk↔inventori`)
      }
    }

    // FINAL DECISION
    if (analysis.hasRealHistory) {
      // Has real business history → CANNOT delete
      return safeJson({
        blocked: true,
        blockType: 'hasRealHistory',
        message: 'Item ini memiliki histori bisnis dan tidak dapat dihapus',
        blockers: analysis.blockers,
        migrationInfo: analysis.migrationData.length > 0 ? analysis.migrationData : undefined,
        suggestion: 'Gunakan "Nonaktifkan" untuk menyembunyikan item tanpa menghapus data.',
        analysis,
      })
    }

    // Only has migration/system data → ALLOW delete with cleanup
    await db.$transaction(async (tx) => {
      // 1. Clean up migration movements
      if (analysis.details.migrationMovements > 0) {
        await tx.inventoryMovement.deleteMany({
          where: {
            inventoryItemId: id,
            referenceType: 'MIGRATION',
            outletId,
          },
        })
      }

      // 2. Clean up compositions (auto 1:1 links)
      await tx.productComposition.deleteMany({
        where: {
          inventoryItemId: id,
        },
      })

      // 3. Clean up batches
      await tx.inventoryBatch.deleteMany({
        where: { inventoryItemId: id },
      })

      // 4. Audit log before deletion
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
            reason: 'MIGRATION_DATA_ONLY',
            cleanedUp: analysis.migrationData,
          }),
          outletId,
          userId,
        },
      })

      // 5. Finally delete the item
      await tx.inventoryItem.delete({ where: { id } })
    }, { timeout: 10000 })

    return safeJson({ 
      success: true, 
      message: `Item dihapus. Data sistem telah dibersihkan: ${analysis.migrationData.join(', ')}`,
      cleanedUp: analysis.migrationData,
    })
  } catch (error) {
    console.error('Inventory item DELETE error:', error)
    const msg = error instanceof Error ? error.message : 'Failed to delete inventory item'
    return safeJsonError(msg, 500)
  }
}
