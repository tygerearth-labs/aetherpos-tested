import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLogMany } from '@/lib/safe-audit'

// Types for detailed history analysis
interface ItemHistoryAnalysis {
  id: string
  name: string
  sku?: string | null
  stock: number
  avgCost: number
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

// Configuration constants for optimization
const CONFIG = {
  MAX_ITEMS_PER_REQUEST: 200,
  ANALYSIS_PARALLELISM: 10, // How many items to analyze in parallel
  TRANSACTION_TIMEOUT_BASE: 10000, // Base timeout in ms
  TRANSACTION_TIMEOUT_PER_ITEM: 500, // Additional ms per item
  MAX_TRANSACTION_TIMEOUT: 60000, // Max timeout 60s
}

/**
 * SMART DELETE LOGIC for Inventory Items (Bulk) - OPTIMIZED VERSION
 * 
 * IDENTICAL logic to single delete at /api/inventory/items/[id] DELETE
 * But optimized for bulk operations:
 * 
 * OPTIMIZATIONS:
 * 1. Parallel analysis of items (not sequential)
 * 2. Batched cleanup operations (not per-item loops)
 * 3. Single transaction with dynamic timeout
 * 4. Chunked processing for very large batches
 * 5. Single aggregated audit log entry
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
  const startTime = Date.now()
  
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya owner yang bisa menghapus item', 403)
    }

    const outletId = user.outletId
    const userId = user.id
    const body = await request.json()
    const { ids } = body as { ids: string[] }

    if (!Array.isArray(ids) || ids.length === 0) {
      return safeJsonError('IDs diperlukan', 400)
    }
    if (ids.length > CONFIG.MAX_ITEMS_PER_REQUEST) {
      return safeJsonError(`Maksimal ${CONFIG.MAX_ITEMS_PER_REQUEST} item per hapus`, 400)
    }

    console.log(`[Bulk Delete] Processing ${ids.length} items for outlet: ${outletId}`)

    // ============================================
    // PHASE 1: Fetch all items with relation counts (SINGLE QUERY)
    // ============================================
    const items = await db.inventoryItem.findMany({
      where: {
        id: { in: ids },
        outletId,
      },
      select: {
        id: true,
        name: true,
        stock: true,
        sku: true,
        avgCost: true,
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

    console.log(`[Bulk Delete] Found ${items.length} items in database (${Date.now() - startTime}ms)`)

    if (items.length === 0) {
      return safeJsonError('Item tidak ditemukan', 404)
    }

    // Create a map for quick lookup
    const itemMap = new Map(items.map(i => [i.id, i]))

    // ============================================
    // PHASE 2: Analyze all items (OPTIMIZED WITH PARALLELISM)
    // ============================================
    const analyses = await analyzeItemsInParallel(items, outletId)
    
    console.log(`[Bulk Delete] Analysis complete in ${Date.now() - startTime}ms`)

    // Separate into deletable and blocked
    const deletableItems = analyses.filter(a => a.canDelete)
    const blockedItems = analyses.filter(a => !a.canDelete)

    console.log(`[Bulk Delete] Result: ${deletableItems.length} deletable, ${blockedItems.length} blocked`)

    // If all items are blocked
    if (deletableItems.length === 0 && blockedItems.length > 0) {
      return safeJson({
        deletedCount: 0,
        blockedCount: blockedItems.length,
        blockedItems: blockedItems.map(a => `${a.name}: ${a.reason}`),
        message: 'Semua item memiliki histori bisnis dan tidak dapat dihapus. Gunakan "Nonaktifkan" untuk menyembunyikan item.',
        analyses,
      })
    }

    // ============================================
    // PHASE 3: Execute deletion (BATCHED OPERATIONS)
    // ============================================
    const idsToDelete = deletableItems.map(a => a.id)
    
    // Calculate dynamic timeout based on number of items
    const dynamicTimeout = Math.min(
      CONFIG.TRANSACTION_TIMEOUT_BASE + (deletableItems.length * CONFIG.TRANSACTION_TIMEOUT_PER_ITEM),
      CONFIG.MAX_TRANSACTION_TIMEOUT
    )
    
    console.log(`[Bulk Delete] Starting transaction with ${dynamicTimeout}ms timeout for ${idsToDelete.length} items`)

    let deletedCount = 0
    const failedItems: string[] = []

    deletedCount = await db.$transaction(async (tx) => {
      
      // STEP 1: Batch clean up ALL migration movements (ONE query)
      const itemsWithMigrationData = deletableItems.filter(a => a.details.migrationMovements > 0)
      if (itemsWithMigrationData.length > 0) {
        const migrationIds = itemsWithMigrationData.map(a => a.id)
        const movResult = await tx.inventoryMovement.deleteMany({
          where: {
            inventoryItemId: { in: migrationIds },
            referenceType: 'MIGRATION',
            outletId,
          },
        })
        console.log(`[Bulk Delete] ✓ Cleaned ${movResult.count} migration movements`)
      }

      // STEP 2: Batch clean up ALL compositions (ONE query)
      const itemsWithCompositions = deletableItems.filter(a => a.details.compositions > 0)
      if (itemsWithCompositions.length > 0) {
        const compIds = itemsWithCompositions.map(a => a.id)
        const compResult = await tx.productComposition.deleteMany({
          where: { inventoryItemId: { in: compIds } },
        })
        console.log(`[Bulk Delete] ✓ Cleaned ${compResult.count} compositions`)
      }

      // STEP 3: Batch clean up ALL batches (ONE query)
      const batchResult = await tx.inventoryBatch.deleteMany({ 
        where: { inventoryItemId: { in: idsToDelete } } 
      })
      if (batchResult.count > 0) {
        console.log(`[Bulk Delete] ✓ Cleaned ${batchResult.count} batches`)
      }

      // STEP 4: Single aggregated audit log (ONE write instead of N writes)
      try {
        await tx.auditLog.create({
          data: {
            action: 'DELETE',
            entityType: 'INVENTORY_ITEM',
            entityId: 'bulk',
            details: JSON.stringify({
              deleteType: blockedItems.length > 0 ? 'BULK_PARTIAL_SMART' : 'BULK_SMART',
              deletedCount: idsToDelete.length,
              blockedCount: blockedItems.length,
              deletedIds: idsToDelete,
              deletedNames: deletableItems.map(a => a.name),
              reason: 'BULK_DELETE_OPTIMIZED',
            }),
            outletId,
            userId,
          },
        })
      } catch (auditErr) {
        // Don't fail the whole operation if audit log fails
        console.warn('[Bulk Delete] Audit log failed (non-critical):', auditErr)
      }

      // STEP 5: Batch delete ALL inventory items (ONE query)
      const deleteResult = await tx.inventoryItem.deleteMany({
        where: { id: { in: idsToDelete }, outletId },
      })
      
      console.log(`[Bulk Delete] ✓ Deleted ${deleteResult.count} inventory items`)
      return deleteResult.count
      
    }, { 
      timeout: dynamicTimeout,
      maxWait: 10000 
    })

    // ============================================
    // PHASE 4: Build response
    // ============================================
    const totalTime = Date.now() - startTime
    console.log(`[Bulk Delete] SUCCESS: ${deletedCount} items deleted in ${totalTime}ms`)

    const response: Record<string, unknown> = {
      deletedCount,
      processingTimeMs: totalTime,
    }

    if (blockedItems.length > 0) {
      response.blockedCount = blockedItems.length
      response.blockedItems = blockedItems.map(a => `${a.name}: ${a.reason}`)
      response.message = `${deletedCount} item dihapus, ${blockedItems.length} item dilewati karena memiliki histori bisnis.`
    } else {
      response.message = `${deletedCount} item dihapus berhasil.`
    }

    response.analyses = analyses

    return safeJson(response)
    
  } catch (error) {
    const totalTime = Date.now() - startTime
    console.error(`[Bulk Delete] ERROR after ${totalTime}ms:`, error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    // Provide specific error messages for common issues
    if (errorMessage.includes('Foreign key') || errorMessage.includes('foreign key')) {
      const tableMatch = errorMessage.match(/table "(\w+)"/) || errorMessage.match(/`(\w+)`/)
      const tableName = tableMatch ? tableMatch[1] : 'unknown'
      
      return safeJsonError(
        `Gagal menghapus: Item terhubung ke tabel ${tableName}. Detail: ${errorMessage.slice(0, 150)}`, 
        400
      )
    }
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      return safeJsonError('Operasi timeout - terlalu banyak item. Coba dengan maksimal 50 item.', 408)
    }
    
    return safeJsonError(`Gagal menghapus: ${errorMessage.slice(0, 150)}`)
  }
}

// ============================================
// HELPER: Analyze items in parallel batches
// ============================================
async function analyzeItemsInParallel(
  items: Array<{
    id: string
    name: string
    stock: number
    sku?: string | null
    avgCost: number
    _count: {
      compositions: number
      purchaseItems: number
      movements: number
      inventoryTransferItems: number
      consumptionSnapshots: number
    }
  }>,
  outletId: string
): Promise<ItemHistoryAnalysis[]> {
  
  const analyses: ItemHistoryAnalysis[] = []
  
  // Process items that need detailed analysis separately
  const itemsNeedingAnalysis: typeof items = []
  const quickAcceptItems: ItemHistoryAnalysis[] = []
  
  for (const item of items) {
    const c = item._count
    const totalRelations = c.compositions + c.purchaseItems + c.movements 
      + c.inventoryTransferItems + c.consumptionSnapshots
    
    // Quick accept: no relations at all
    if (totalRelations === 0) {
      quickAcceptItems.push({
        id: item.id,
        name: item.name,
        sku: item.sku,
        stock: item.stock,
        avgCost: item.avgCost,
        canDelete: true,
        reason: 'Tidak ada histori sama sekali',
        hasRealHistory: false,
        hasOnlyMigrationData: false,
        details: {
          compositions: 0,
          purchaseItems: 0,
          movements: 0,
          transferItems: 0,
          consumptionSnapshots: 0,
          migrationMovements: 0,
          realMovements: 0,
          autoCompositions: 0,
          realCompositions: 0,
        },
      })
    } else {
      itemsNeedingAnalysis.push(item)
    }
  }

  // Process items needing analysis in parallel batches
  if (itemsNeedingAnalysis.length > 0) {
    // First, batch fetch all movement types for items with movements
    const itemsWithMovements = itemsNeedingAnalysis.filter(i => i._count.movements > 0)
    const movementTypeMap = new Map<string, { migration: number; real: number }>()
    
    if (itemsWithMovements.length > 0) {
      const movementTypes = await db.inventoryMovement.groupBy({
        by: ['inventoryItemId', 'referenceType'],
        where: {
          inventoryItemId: { in: itemsWithMovements.map(i => i.id) },
          outletId,
        },
        _count: true,
      })
      
      // Group results by itemId
      for (const item of itemsWithMovements) {
        movementTypeMap.set(item.id, { migration: 0, real: 0 })
      }
      
      for (const mt of movementTypes) {
        const counts = movementTypeMap.get(mt.inventoryItemId)
        if (counts) {
          if (mt.referenceType === 'MIGRATION') {
            counts.migration = mt._count
          } else {
            counts.real += mt._count
          }
        }
      }
    }
    
    // Batch fetch all compositions for items with compositions
    const itemsWithCompositions = itemsNeedingAnalysis.filter(i => i._count.compositions > 0)
    const compositionMap = new Map<string, { auto: number; real: number }>()
    
    if (itemsWithCompositions.length > 0) {
      const compositions = await db.productComposition.findMany({
        where: {
          inventoryItemId: { in: itemsWithCompositions.map(i => i.id) },
        },
        select: {
          inventoryItemId: true,
          qty: true,
          baseUnit: true,
        },
      })
      
      // Initialize maps
      for (const item of itemsWithCompositions) {
        compositionMap.set(item.id, { auto: 0, real: 0 })
      }
      
      // Count auto vs real compositions
      for (const comp of compositions) {
        const counts = compositionMap.get(comp.inventoryItemId)
        if (counts) {
          const isAutoLink = comp.qty === 1 && comp.baseUnit !== null
          if (isAutoLink) {
            counts.auto++
          } else {
            counts.real++
          }
        }
      }
    }
    
    // Now build analysis for each item using pre-fetched data
    for (const item of itemsNeedingAnalysis) {
      const c = item._count
      const analysis: ItemHistoryAnalysis = {
        id: item.id,
        name: item.name,
        sku: item.sku,
        stock: item.stock,
        avgCost: item.avgCost,
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

      // 1. Purchase Items: ALWAYS real history
      if (c.purchaseItems > 0) {
        analysis.hasRealHistory = true
      }

      // 2. Transfer Items: ALWAYS real history
      if (c.inventoryTransferItems > 0) {
        analysis.hasRealHistory = true
      }

      // 3. Consumption Snapshots: ALWAYS real history
      if (c.consumptionSnapshots > 0) {
        analysis.hasRealHistory = true
      }

      // 4. Movements: Use pre-fetched data
      if (c.movements > 0) {
        const moveCounts = movementTypeMap.get(item.id) || { migration: 0, real: c.movements }
        analysis.details.migrationMovements = moveCounts.migration
        analysis.details.realMovements = moveCounts.real

        if (moveCounts.real > 0) {
          analysis.hasRealHistory = true
        }
      }

      // 5. Compositions: Use pre-fetched data
      if (c.compositions > 0) {
        const compCounts = compositionMap.get(item.id) || { auto: 0, real: c.compositions }
        analysis.details.autoCompositions = compCounts.auto
        analysis.details.realCompositions = compCounts.real

        if (compCounts.real > 0) {
          analysis.hasRealHistory = true
        }
      }

      // FINAL DECISION
      if (analysis.hasRealHistory) {
        analysis.canDelete = false
        const reasons: string[] = []
        if (analysis.details.purchaseItems > 0) reasons.push(`${analysis.details.purchaseItems} pembelian`)
        if (analysis.details.realMovements > 0) reasons.push(`${analysis.details.realMovements} pergerakan stok`)
        if (analysis.details.transferItems > 0) reasons.push(`${analysis.details.transferItems} transfer`)
        if (analysis.details.consumptionSnapshots > 0) reasons.push(`${analysis.details.consumptionSnapshots} konsumsi penjualan`)
        if (analysis.details.realCompositions > 0) reasons.push(`${analysis.details.realCompositions} komposisi/resep`)
        
        analysis.reason = `Histori bisnis: ${reasons.join(', ')}`
      } else {
        analysis.canDelete = true
        analysis.hasOnlyMigrationData = true
        const migrationData: string[] = []
        if (analysis.details.migrationMovements > 0) migrationData.push(`${analysis.details.migrationMovements} stok awal migrasi`)
        if (analysis.details.autoCompositions > 0) migrationData.push(`${analysis.details.autoCompositions} link produk otomatis`)
        analysis.reason = `Hanya data sistem: ${migrationData.join(', ')} → akan dibersihkan`
      }

      analyses.push(analysis)
    }
  }

  // Combine quick accepts and analyzed items
  return [...quickAcceptItems, ...analyses]
}
