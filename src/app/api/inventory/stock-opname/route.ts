import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { POST as completeHandler } from './complete'

/**
 * GET /api/inventory/stock-opname
 * 
 * Returns ALL inventory items + batches for snapshot.
 * This is called when user starts a new stock opname.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const outletId = user.outletId

    // Fetch all ACTIVE inventory items with their batches
    const [items, batches, categories] = await Promise.all([
      db.inventoryItem.findMany({
        where: { outletId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          sku: true,
          baseUnit: true,
          stock: true,
          avgCost: true,
          categoryId: true,
        },
        orderBy: { name: 'asc' },
      }),
      
      db.inventoryBatch.findMany({
        where: { outletId, status: 'AVAILABLE' },
        select: {
          id: true,
          batchNumber: true,
          inventoryItemId: true,
          remainingQty: true,
          unitCost: true,
          expiredDate: true,
        },
      }),
      
      db.inventoryCategory.findMany({
        where: { outletId },
        select: { id: true, name: true },
      }),
    ])

    // Build category lookup
    const categoryMap = new Map(categories.map(c => [c.id, c.name]))

    // Build batch lookup per item
    const batchMap = new Map<string, typeof batches>()
    for (const batch of batches) {
      if (!batchMap.has(batch.inventoryItemId)) {
        batchMap.set(batch.inventoryItemId, [])
      }
      batchMap.get(batch.inventoryItemId)!.push(batch)
    }

    // Format snapshot data (what client will store in Dexie)
    const snapshotData = items.map(item => ({
      inventoryItemId: item.id,
      itemName: item.name,
      itemSku: item.sku,
      itemUnit: item.baseUnit,
      categoryId: item.categoryId,
      categoryName: item.categoryId ? categoryMap.get(item.categoryId) || null : null,
      systemQty: item.stock,           // Current system stock (frozen!)
      avgCost: item.avgCost,
      hasBatches: batchMap.has(item.id),
      batches: (batchMap.get(item.id) || []).map(b => ({
        batchId: b.id,
        batchNumber: b.batchNumber,
        remainingQty: b.remainingQty,
        unitCost: b.unitCost,
        expiredDate: b.expiredDate?.toISOString() || null,
      })),
    }))

    return safeJson({
      snapshotAt: new Date().toISOString(),
      totalItems: items.length,
      totalBatches: batches.length,
      items: snapshotData,
    })

  } catch (error) {
    console.error('[StockOpname] Snapshot error:', error)
    return safeJsonError('Gagal mengambil data inventory untuk stock opname')
  }
}

/**
 * POST /api/inventory/stock-opname
 * 
 * Complete stock opname - apply adjustments to server.
 * Delegates to complete.ts for the heavy lifting.
 */
export async function POST(request: NextRequest) {
  return completeHandler(request)
}
