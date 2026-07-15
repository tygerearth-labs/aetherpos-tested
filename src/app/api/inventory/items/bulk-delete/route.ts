import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLogMany } from '@/lib/safe-audit'

// Types for detailed history analysis
interface ItemHistoryAnalysis {
  id: string
  name: string
  canDelete: boolean
  reason?: string
  hasRealHistory: boolean
  hasOnlyMigrationData: boolean
  details: {
    compositions: number
    purchaseItems: number
    movements: number
    transferItems: number
    consumptionSnapshots: number
    // Detailed breakdown
    migrationMovements: number   // Movements from initial stock (MIGRATION ref type)
    realMovements: number        // Actual business movements
    autoCompositions: number     // Auto 1:1 composition links from product_stock mode
    realCompositions: number     // Manual composition links (mode 3 / BOM)
  }
}

/**
 * SMART DELETE LOGIC for Inventory Items
 * 
 * Distinguishes between:
 * 1. REAL BUSINESS HISTORY (blocks deletion):
 *    - PurchaseOrderItem from actual purchases
 *    - InventoryMovement from RESTOCK/ADJUSTMENT/CONSUMPTION/TRANSFER
 *    - TransactionConsumption from sales
 *    - InventoryTransferItem from transfers
 *    - Manual ProductComposition (mode 3 / BOM recipes)
 * 
 * 2. MIGRATION/SYSTEM DATA (allows deletion + cleanup):
 *    - InventoryMovement with referenceType='MIGRATION' (initial stock)
 *    - Auto 1:1 ProductComposition from product_stock mode migration
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya owner yang bisa menghapus item', 403)
    }

    const outletId = user.outletId
    const body = await request.json()
    const { ids } = body as { ids: string[] }

    if (!Array.isArray(ids) || ids.length === 0) {
      return safeJsonError('IDs diperlukan', 400)
    }
    if (ids.length > 200) {
      return safeJsonError('Maksimal 200 item per hapus', 400)
    }

    // Fetch all items with their relation counts
    const items = await db.inventoryItem.findMany({
      where: {
        id: { in: ids },
        outletId,
      },
      select: {
        id: true,
        name: true,
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

    if (items.length === 0) {
      return safeJsonError('Item tidak ditemukan', 404)
    }

    // Analyze each item's history in detail
    const analyses: ItemHistoryAnalysis[] = []

    for (const item of items) {
      const c = item._count
      const analysis: ItemHistoryAnalysis = {
        id: item.id,
        name: item.name,
        canDelete: false,
        hasRealHistory: false,
        hasOnlyMigrationData: false,
        details: {
          compositions: c.compositions,
          purchaseItems: c.purchaseItems,
          movements: c.movements,
          transferItems: c.inventoryTransferItems,
          consumptionSnapshots: c.consumptionSnapshots,
          migrationMovements: 0,
          realMovements: 0,
          autoCompositions: 0,
          realCompositions: 0,
        },
      }

      // Quick check: if no relations at all, definitely deletable
      const totalRelations = c.compositions + c.purchaseItems + c.movements 
        + c.inventoryTransferItems + c.consumptionSnapshots
      
      if (totalRelations === 0) {
        analysis.canDelete = true
        analysis.reason = 'Tidak ada histori sama sekali'
        analyses.push(analysis)
        continue
      }

      // === DETAILED ANALYSIS FOR ITEMS WITH RELATIONS ===
      
      // 1. Purchase Items: ALWAYS real history (no migration creates these)
      if (c.purchaseItems > 0) {
        analysis.hasRealHistory = true
      }

      // 2. Transfer Items: ALWAYS real history
      if (c.inventoryTransferItems > 0) {
        analysis.hasRealHistory = true
      }

      // 3. Consumption Snapshots: ALWAYS real history (from actual sales)
      if (c.consumptionSnapshots > 0) {
        analysis.hasRealHistory = true
      }

      // 4. Movements: Need to check types
      if (c.movements > 0) {
        const movementTypes = await db.inventoryMovement.groupBy({
          by: ['referenceType'],
          where: {
            inventoryItemId: item.id,
            outletId,
          },
          _count: true,
          take: 10,
        })

        const migrationMovements = movementTypes.find(m => m.referenceType === 'MIGRATION')?._count || 0
        const realMovements = c.movements - migrationMovements

        analysis.details.migrationMovements = migrationMovements
        analysis.details.realMovements = realMovements

        if (realMovements > 0) {
          analysis.hasRealHistory = true
        }
      }

      // 5. Compositions: Need to check if auto 1:1 or manual BOM
      if (c.compositions > 0) {
        // Check compositions linked to this inventory item
        const compositions = await db.productComposition.findMany({
          where: {
            OR: [
              { inventoryItemId: item.id },
              { ingredientId: item.id },
            ],
          },
          select: {
            id: true,
            productId: true,
            qty: true,
            baseUnit: true,
          },
        })

        // Auto 1:1 compositions from product_stock mode have: qty=1, baseUnit matches inventory unit
        // Real BOM compositions have custom quantities and multiple ingredients per product
        let autoCount = 0
        let realCount = 0

        for (const comp of compositions) {
          // Check if this looks like an auto-generated 1:1 link
          // Auto links typically have qty=1 or exact match pattern
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
        }
      }

      // FINAL DECISION
      if (analysis.hasRealHistory) {
        // Has real business history → CANNOT delete, must archive
        analysis.canDelete = false
        const reasons: string[] = []
        if (analysis.details.purchaseItems > 0) reasons.push(`${analysis.details.purchaseItems} pembelian`)
        if (analysis.details.realMovements > 0) reasons.push(`${analysis.details.realMovements} pergerakan stok`)
        if (analysis.details.transferItems > 0) reasons.push(`${analysis.details.transferItems} transfer`)
        if (analysis.details.consumptionSnapshots > 0) reasons.push(`${analysis.details.consumptionSnapshots} konsumsi penjualan`)
        if (analysis.details.realCompositions > 0) reasons.push(`${analysis.details.realCompositions} komposisi/resep`)
        
        // Add info about migration data that will be cleaned up
        const migrationInfo: string[] = []
        if (analysis.details.migrationMovements > 0) migrationInfo.push(`${analysis.details.migrationMovements} stok awal`)
        if (analysis.details.autoCompositions > 0) migrationInfo.push(`${analysis.details.autoCompositions} link otomatis`)
        
        analysis.reason = `Histori bisnis: ${reasons.join(', ')}${migrationInfo.length > 0 ? ` (+${migrationInfo.join(', ')})` : ''}`
      } else {
        // Only has migration/system data → CAN delete (will clean up migration data)
        analysis.canDelete = true
        analysis.hasOnlyMigrationData = true
        const migrationData: string[] = []
        if (analysis.details.migrationMovements > 0) migrationData.push(`${analysis.details.migrationMovements} stok awal migrasi`)
        if (analysis.details.autoCompositions > 0) migrationData.push(`${analysis.details.autoCompositions} link produk otomatis`)
        analysis.reason = `Hanya data sistem: ${migrationData.join(', ')} → akan dibersihkan`
      }

      analyses.push(analysis)
    }

    // Separate into deletable and blocked
    const deletableItems = analyses.filter(a => a.canDelete)
    const blockedItems = analyses.filter(a => !a.canDelete)

    // If all items are blocked
    if (deletableItems.length === 0 && blockedItems.length > 0) {
      const blockedNames = blockedItems.map(a => `${a.name}: ${a.reason}`)
      
      return safeJson({
        deletedCount: 0,
        blockedCount: blockedItems.length,
        blockedItems: blockedNames,
        message: 'Semua item memiliki histori bisnis dan tidak dapat dihapus. Gunakan "Nonaktifkan" untuk menyembunyikan item.',
        analyses,
      })
    }

    // Delete allowed items (including those with only migration data)
    const idsToDelete = deletableItems.map(a => a.id)

    // For items with migration data, we need to clean up first
    const itemsWithMigrationData = deletableItems.filter(a => a.hasOnlyMigrationData)
    const itemIdsWithMigration = itemsWithMigrationData.map(a => a.id)

    const { count } = await db.$transaction(async (tx) => {
      // 1. Clean up migration movements for items that have them
      if (itemIdsWithMigration.length > 0) {
        await tx.inventoryMovement.deleteMany({
          where: {
            inventoryItemId: { in: itemIdsWithMigration },
            referenceType: 'MIGRATION',
            outletId,
          },
        })
      }

      // 2. Delete ALL compositions referencing these items (both auto and real, but we confirmed no real)
      await tx.productComposition.deleteMany({ 
        where: { 
          OR: [
            { inventoryItemId: { in: idsToDelete } },
            { ingredientId: { in: idsToDelete } },
            { productId: { in: idsToDelete } },
          ]
        } 
      })

      // 3. Delete batches
      await tx.inventoryBatch.deleteMany({ 
        where: { inventoryItemId: { in: idsToDelete } } 
      })

      // 4. Delete purchase items (shouldn't exist for deletable, but safety)
      await tx.purchaseItem.deleteMany({
        where: { inventoryItemId: { in: idsToDelete } },
      })

      // 5. Finally delete the inventory items
      return tx.inventoryItem.deleteMany({
        where: { id: { in: idsToDelete }, outletId },
      })
    })

    // Audit log
    await safeAuditLogMany([{
      action: 'DELETE' as const,
      entityType: 'INVENTORY_ITEM' as const,
      entityId: 'bulk',
      details: JSON.stringify({
        deleteType: blockedItems.length > 0 ? 'BULK_PARTIAL_SMART' : 'BULK_SMART',
        deletedCount: count,
        blockedCount: blockedItems.length,
        migrationCleanedUp: itemsWithMigrationData.length,
        deletedIds: idsToDelete,
        blockedIds: blockedItems.map(a => a.id),
        analyses: analyses.map(a => ({
          id: a.id,
          name: a.name,
          canDelete: a.canDelete,
          reason: a.reason,
        })),
      }),
      outletId,
      userId: user.id,
    }])

    // Build response
    const response: Record<string, unknown> = {
      deletedCount: count,
    }

    if (blockedItems.length > 0) {
      response.blockedCount = blockedItems.length
      response.blockedItems = blockedItems.map(a => `${a.name}: ${a.reason}`)
      response.message = `${count} item dihapus${itemsWithMigrationData.length > 0 ? ` (termasuk ${itemsWithMigrationData.length} item dengan data migrasi yang dibersihkan)` : ''}, ${blockedItems.length} item dilewati karena memiliki histori bisnis.`
    } else if (itemsWithMigrationData.length > 0) {
      response.message = `${count} item dihapus. Data stok awal & link otomatis telah dibersihkan.`
    } else {
      response.message = `${count} item dihapus berhasil.`
    }

    response.analyses = analyses

    return safeJson(response)
  } catch (error) {
    console.error('Inventory bulk delete error:', error)
    return safeJsonError('Gagal menghapus item inventory')
  }
}
