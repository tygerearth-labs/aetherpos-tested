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
    migrationMovements: number
    realMovements: number
    autoCompositions: number
    realCompositions: number
  }
}

/**
 * SMART DELETE LOGIC for Inventory Items (Bulk)
 * 
 * Identical logic to single delete at /api/inventory/items/[id] DELETE
 * 
 * CAN DELETE:
 * - No history at all (totalRelations === 0)
 * - Only MIGRATION data (initial stock) + auto composition links
 * 
 * CANNOT DELETE (must use Archive instead):
 * - Real purchase history
 * - Transfer history between outlets  
 * - Sales/consumption transactions
 * - Manual BOM/composition recipes (qty != 1)
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

    console.log('[Bulk Delete] Processing', ids.length, 'items for outlet:', outletId)

    // Fetch all items with their relation counts
    const items = await db.inventoryItem.findMany({
      where: {
        id: { in: ids },
        outletId,
      },
      select: {
        id: true,
        name: true,
        stock: true,
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

    console.log('[Bulk Delete] Found', items.length, 'items in database')

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
      
      console.log(`[Bulk Delete] Item "${item.name}": stock=${item.stock}, relations=${totalRelations}`, 
        `{ comp: ${c.compositions}, purch: ${c.purchaseItems}, mov: ${c.movements}, transf: ${c.inventoryTransferItems}, cons: ${c.consumptionSnapshots }`)
      
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

      // 4. Movements: Need to check types (MIGRATION vs real business)
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

      // 5. Compositions: Check if auto 1:1 or manual BOM
      if (c.compositions > 0) {
        const compositions = await db.productComposition.findMany({
          where: {
            inventoryItemId: item.id,
          },
          select: {
            id: true,
            qty: true,
            baseUnit: true,
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
        
        analysis.reason = `Histori bisnis: ${reasons.join(', ')}`
        
        console.log(`[Bulk Delete] Item "${item.name}" BLOCKED:`, analysis.reason)
      } else {
        // Only has migration/system data → CAN delete (will clean up migration data)
        analysis.canDelete = true
        analysis.hasOnlyMigrationData = true
        const migrationData: string[] = []
        if (analysis.details.migrationMovements > 0) migrationData.push(`${analysis.details.migrationMovements} stok awal migrasi`)
        if (analysis.details.autoCompositions > 0) migrationData.push(`${analysis.details.autoCompositions} link produk otomatis`)
        analysis.reason = `Hanya data sistem: ${migrationData.join(', ')} → akan dibersihkan`
        
        console.log(`[Bulk Delete] Item "${item.name}" DELETABLE (migration data):`, analysis.reason)
      }

      analyses.push(analysis)
    }

    // Separate into deletable and blocked
    const deletableItems = analyses.filter(a => a.canDelete)
    const blockedItems = analyses.filter(a => !a.canDelete)

    console.log('[Bulk Delete] Result:', deletableItems.length, 'deletable,', blockedItems.length, 'blocked')

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

    // Get IDs to delete
    const idsToDelete = deletableItems.map(a => a.id)

    let deletedCount = 0
    
    // Execute deletion in transaction
    // IMPORTANT: These child relations do NOT have onDelete: Cascade:
    // - PurchaseOrderItem (line 514) - but items with purchaseItems should be blocked
    // - ProductComposition (line 536) - MUST delete explicitly
    // - InventoryBatch (line 588) - MUST delete explicitly
    // - InventoryMovement - MUST delete explicitly
    deletedCount = await db.$transaction(async (tx) => {
      
      console.log('[Bulk Delete] Starting transaction cleanup for', idsToDelete.length, 'items')
      
      // 1. Clean up ALL compositions for ALL deletable items (not just migration!)
      const itemsWithCompositions = deletableItems.filter(a => a.details.compositions > 0)
      if (itemsWithCompositions.length > 0) {
        console.log('[Bulk Delete] Cleaning up compositions for', itemsWithCompositions.length, 'items:',
          itemsWithCompositions.map(a => `${a.name} (${a.details.compositions} comps)`))
        
        await tx.productComposition.deleteMany({ 
          where: { 
            inventoryItemId: { in: idsToDelete },
          } 
        })
        console.log('[Bulk Delete] Compositions cleaned up')
      }

      // 2. Clean up movements for items with migration data
      const itemsWithMovements = deletableItems.filter(a => a.details.movements > 0)
      if (itemsWithMovements.length > 0) {
        console.log('[Bulk Delete] Cleaning up movements for', itemsWithMovements.length, 'items')
        
        await tx.inventoryMovement.deleteMany({
          where: {
            inventoryItemId: { in: idsToDelete },
            outletId,
          },
        })
        console.log('[Bulk Delete] Movements cleaned up')
      }

      // 3. Delete batches for all deletable items (no cascade)
      await tx.inventoryBatch.deleteMany({ 
        where: { inventoryItemId: { in: idsToDelete } } 
      })
      console.log('[Bulk Delete] Batches cleaned up')

      // Finally delete the inventory items
      // All child records cleaned up above, these should have cascade or be cleaned:
      // - compositions (ProductComposition) ✅ cleaned
      // - movements (InventoryMovement) ✅ cleaned  
      // - batches (InventoryBatch) ✅ cleaned
      // - inventoryTransferItems (InventoryTransferItem) - should be 0 for deletable items
      // - consumptionSnapshots (TransactionConsumption) - should be 0 for deletable items
      console.log('[Bulk Delete] Deleting', idsToDelete.length, 'inventory items...')
      
      const result = await tx.inventoryItem.deleteMany({
        where: { id: { in: idsToDelete }, outletId },
      })
      
      console.log('[Bulk Delete] Deleted', result.count, 'items')
      return result.count
    }, { 
      timeout: 30000,
      maxWait: 5000 // Max time to wait for transaction slot
    })

    // Audit log
    await safeAuditLogMany([{
      action: 'DELETE' as const,
      entityType: 'INVENTORY_ITEM' as const,
      entityId: 'bulk',
      details: JSON.stringify({
        deleteType: blockedItems.length > 0 ? 'BULK_PARTIAL_SMART' : 'BULK_SMART',
        deletedCount,
        blockedCount: blockedItems.length,
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
      deletedCount,
    }

    if (blockedItems.length > 0) {
      response.blockedCount = blockedItems.length
      response.blockedItems = blockedItems.map(a => `${a.name}: ${a.reason}`)
      response.message = `${deletedCount} item dihapus, ${blockedItems.length} item dilewati karena memiliki histori bisnis.`
    } else {
      response.message = `${deletedCount} item dihapus berhasil.`
    }

    response.analyses = analyses

    console.log('[Bulk Delete] SUCCESS:', response.message)
    return safeJson(response)
    
  } catch (error) {
    console.error('[Bulk Delete] ERROR:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : ''
    
    // Log detailed error for debugging
    console.error('[Bulk Delete] Error details:', {
      message: errorMessage,
      stack: errorStack,
      idsAttempted: ids.length,
    })
    
    // Provide specific error messages for common issues
    if (errorMessage.includes('Foreign key') || errorMessage.includes('foreign key')) {
      // Extract table name from error message if possible
      const tableMatch = errorMessage.match(/table "(\w+)"/) || errorMessage.match(/`(\w+)`/)
      const tableName = tableMatch ? tableMatch[1] : 'unknown'
      
      console.error('[Bulk Delete] FK Violation on table:', tableName)
      
      return safeJsonError(
        `Gagal menghapus: Item masih terhubung ke data ${tableName}. Detail: ${errorMessage.slice(0, 200)}`, 
        400
      )
    }
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      return safeJsonError('Operasi terlalu lama. Coba dengan jumlah item lebih sedikit (maks 50).', 408)
    }
    if (errorMessage.includes('Unique constraint') || errorMessage.includes('unique constraint')) {
      return safeJsonError('Terjadi konflik data. Refresh halaman dan coba lagi.', 409)
    }
    
    return safeJsonError(`Gagal menghapus item inventory: ${errorMessage.slice(0, 200)}`)
  }
}
