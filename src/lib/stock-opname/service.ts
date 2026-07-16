/**
 * stock-opname-service.ts
 * 
 * Client-side service for Stock Opname (physical stock count).
 * Uses Dexie as transient workspace - NOT source of truth.
 * 
 * Flow:
 *   1. startOpname() → Fetch from API → Store in Dexie
 *   2. updateCount() → Update physicalQty in Dexie
 *   3. completeOpname() → Send to server → Clear Dexie
 *   4. cancelOpname() → Clear Dexie without saving
 */

import { getAetherDB, type StockOpnameSnapshot, type StockOpnameSession } from '@/lib/offline/aether-db'
import { v4 as uuidv4 } from 'uuid'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export type OpnameStatus = 'DRAFT' | 'COUNTING' | 'REVIEW' | 'COMPLETING'

export interface SnapshotItem {
  id: string
  inventoryItemId: string
  batchId: string | null
  itemName: string
  itemSku: string | null
  itemUnit: string
  batchNumber: string | null
  categoryId: string | null
  categoryName: string | null
  systemQty: number
  physicalQty: number | null
  isCounted: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface OpnameSession {
  status: OpnameStatus
  startedAt: string
  totalItems: number
  countedItems: number
  varianceItems: number
  notes: string | null
}

export interface CompleteResult {
  success: boolean
  summary: {
    totalSnapshots: number
    itemsCounted: number
    adjustmentsMade: number
    batchUpdates: number
    varianceItems: number
    totalVarianceValue: number
  }
  adjustments: Array<{
    itemName: string
    batchNumber: string | null
    systemQty: number
    physicalQty: number
    currentStock: number
    delta: number
    adjustedStock: number
    varianceValue: number
  }>
}

// ════════════════════════════════════════════════════════════
// Service Functions
// ════════════════════════════════════════════════════════════

/**
 * Check if there's an active (in-progress) opname session in Dexie
 */
export async function hasActiveOpname(): Promise<boolean> {
  const db = getAetherDB()
  const session = await db.stockOpnameSession.get('current')
  return !!session && session.status !== 'DRAFT' || false
}

/**
 * Get current opname session metadata
 */
export async function getOpnameSession(): Promise<OpnameSession | null> {
  const db = getAetherDB()
  const session = await db.stockOpnameSession.get('current')
  
  if (!session) return null
  
  // Recalculate counts from snapshots
  const snapshots = await db.stockOpnameSnapshots.toArray()
  const countedItems = snapshots.filter(s => s.physicalQty !== null).length
  const varianceItems = snapshots.filter(s => 
    s.physicalQty !== null && s.physicalQty !== s.systemQty
  ).length
  
  return {
    status: session.status,
    startedAt: session.startedAt,
    totalItems: session.totalItems,
    countedItems,
    varianceItems,
    notes: session.notes,
  }
}

/**
 * START a new stock opname.
 * 
 * 1. Clears any existing session data
 * 2. Fetches current inventory from server
 * 3. Stores snapshot in Dexie
 * 
 * @param outletId - The outlet ID to snapshot
 * @param options - Optional filters
 */
export async function startOpname(
  outletId: string,
  options?: { categoryIds?: string[]; includeZeroStock?: boolean }
): Promise<{ totalItems: number; totalBatches: number }> {
  const db = getAetherDB()
  
  // Clear any existing data first
  await clearOpnameData(db)
  
  // Fetch snapshot from server
  const response = await fetch(`/api/inventory/stock-opname?outletId=${outletId}`)
  if (!response.ok) {
    throw new Error(`Gagal mengambil data inventory: ${response.statusText}`)
  }
  
  const data = await response.json()
  const { items, totalBatches } = data
  
  // Filter options
  let filteredItems = items
  if (options?.categoryIds?.length) {
    filteredItems = filteredItems.filter(item => 
      item.categoryId && options.categoryIds!.includes(item.categoryId)
    )
  }
  if (options?.includeZeroStock === false) {
    filteredItems = filteredItems.filter(item => item.systemQty > 0)
  }
  
  // Convert to snapshot format and store in Dexie
  const now = new Date().toISOString()
  const snapshots: StockOpnameSnapshot[] = []
  
  for (const item of filteredItems) {
    // Create one snapshot per item (item-level counting)
    snapshots.push({
      id: uuidv4(),
      inventoryItemId: item.inventoryItemId,
      batchId: null,           // Item-level (no specific batch)
      itemName: item.itemName,
      itemSku: item.itemSku,
      itemUnit: item.itemUnit,
      batchNumber: null,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      systemQty: item.systemQty,
      physicalQty: null,      // Not yet counted
      isCounted: false,
      notes: null,
      createdAt: now,
      updatedAt: now,
    })
    
    // If item has batches, also create batch-level snapshots
    if (item.hasBatches && item.batches?.length) {
      for (const batch of item.batches) {
        snapshots.push({
          id: uuidv4(),
          inventoryItemId: item.inventoryItemId,
          batchId: batch.batchId,
          itemName: item.itemName,
          itemSku: item.itemSku,
          itemUnit: item.itemUnit,
          batchNumber: batch.batchNumber,
          categoryId: item.categoryId,
          categoryName: item.categoryName,
          systemQty: batch.remainingQty,  // Batch-level snapshot
          physicalQty: null,
          isCounted: false,
          notes: null,
          createdAt: now,
          updatedAt: now,
        })
      }
    }
  }
  
  // Batch insert into Dexie
  await db.stockOpnameSnapshots.bulkAdd(snapshots)
  
  // Create session record
  await db.stockOpnameSession.put({
    id: 'current',
    status: 'COUNTING',
    startedAt: now,
    totalItems: snapshots.length,
    countedItems: 0,
    varianceItems: 0,
    notes: null,
  })
  
  console.log(`[StockOpname] Started with ${snapshots.length} snapshots (${filteredItems.length} items + batches)`)
  
  return { totalItems: snapshots.length, totalBatches }
}

/**
 * Get all snapshots from Dexie
 */
export async function getAllSnapshots(): Promise<SnapshotItem[]> {
  const db = getAetherDB()
  return db.stockOpnameSnapshots.toArray()
}

/**
 * Get snapshots that haven't been counted yet
 */
export async function getUncountedSnapshots(): Promise<SnapshotItem[]> {
  const db = getAetherDB()
  return db.stockOpnameSnapshots.where('isCounted').equals(0).toArray()
}

/**
 * Get snapshots with variance (counted but different from system)
 */
export async function getVarianceSnapshots(): Promise<SnapshotItem[]> {
  const db = getAetherDB()
  const all = await db.stockOpnameSnapshots.toArray()
  return all.filter(s => 
    s.physicalQty !== null && Math.abs((s.physicalQty ?? 0) - s.systemQty) > 0.001
  )
}

/**
 * UPDATE physical count for a single snapshot
 */
export async function updateCount(
  snapshotId: string, 
  physicalQty: number, 
  notes?: string
): Promise<void> {
  const db = getAetherDB()
  
  await db.stockOpnameSnapshots.update(snapshotId, {
    physicalQty,
    isCounted: true,
    notes: notes || null,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Bulk update counts (for Excel import or barcode scanning)
 */
export async function bulkUpdateCounts(
  updates: Array<{ snapshotId: string; physicalQty: number; notes?: string }>
): Promise<void> {
  const db = getAetherDB()
  const now = new Date().toISOString()
  
  for (const update of updates) {
    await db.stockOpnameSnapshots.update(update.snapshotId, {
      physicalQty: update.physicalQty,
      isCounted: true,
      notes: update.notes || null,
      updatedAt: now,
    })
  }
}

/**
 * Find snapshot by barcode/scan value
 * Searches: itemName, itemSku, batchNumber
 */
export async function findByScan(
  scanValue: string
): Promise<SnapshotItem | null> {
  const db = getAetherDB()
  const normalized = scanValue.toLowerCase().trim()
  
  // Search in order: SKU → Barcode → Name → Batch Number
  const all = await db.stockOpnameSnapshots.toArray()
  
  return all.find(s => 
    s.itemSku?.toLowerCase() === normalized ||
    s.itemName.toLowerCase().includes(normalized) ||
    s.batchNumber?.toLowerCase() === normalized
  ) || null
}

/**
 * Set session status to REVIEW
 */
export async function setReviewing(notes?: string): Promise<void> {
  const db = getAetherDB()
  
  await db.stockOpnameSession.update('current', {
    status: 'REVIEW',
    notes: notes || null,
  })
}

/**
 * COMPLETE the stock opname.
 * 
 * Sends all counted snapshots to server for adjustment calculation.
 * Server will:
 *   1. Re-validate current stock
 *   2. Calculate delta = physical - snapshot
 *   3. Apply: newStock = current + delta
 *   4. Create InventoryMovement records
 * 
 * After successful completion, Dexie data is CLEARED.
 */
export async function completeOpname(): Promise<CompleteResult> {
  const db = getAetherDB()
  
  // Update status
  await db.stockOpnameSession.update('current', { status: 'COMPLETING' })
  
  // Get session info
  const session = await db.stockOpnameSession.get('current')
  
  // Get ALL snapshots (only counted ones matter)
  const snapshots = await db.stockOpnameSnapshots.toArray()
  const countedSnapshots = snapshots.filter(s => s.physicalQty !== null)
  
  // Prepare payload for server
  const payload = {
    snapshots: countedSnapshots.map(s => ({
      inventoryItemId: s.inventoryItemId,
      batchId: s.batchId,
      itemName: s.itemName,
      itemSku: s.itemSku,
      itemUnit: s.itemUnit,
      batchNumber: s.batchNumber,
      systemQty: s.systemQty,
      physicalQty: s.physicalQty,
      notes: s.notes,
    })),
    notes: session?.notes,
    startedAt: session?.startedAt,
  }
  
  // Send to server
  const response = await fetch('/api/inventory/stock-opname', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }))
    throw new Error(error.message || `Gagal menyelesaikan stock opname: ${response.statusText}`)
  }
  
  const result: CompleteResult = await response.json()
  
  // SUCCESS - Clear Dexie data
  await clearOpnameData(db)
  
  return result
}

/**
 * CANCEL the stock opname without saving.
 * Clears all Dexie data.
 */
export async function cancelOpname(): Promise<void> {
  const db = getAetherDB()
  await clearOpnameData(db)
}

/**
 * RESUME an existing opname session (after browser crash/reload)
 * Returns session info if exists, null otherwise
 */
export async function resumeOpname(): Promise<OpnameSession | null> {
  const db = getAetherDB()
  const session = await db.stockOpnameSession.get('current')
  
  if (!session) return null
  
  // Only resume if in COUNTING or REVIEW status
  if (!['COUNTING', 'REVIEW'].includes(session.status)) {
    // Stale session, clear it
    await clearOpnameData(db)
    return null
  }
  
  return getOpnameSession()
}

// ════════════════════════════════════════════════════════════
// Internal Helpers
// ════════════════════════════════════════════════════════════

async function clearOpnameData(db: ReturnType<typeof getAetherDB>): Promise<void> {
  await db.transaction('rw', [db.stockOpnameSnapshots, db.stockOpnameSession], async () => {
    await db.stockOpnameSnapshots.clear()
    await db.stockOpnameSession.clear()
  })
}
