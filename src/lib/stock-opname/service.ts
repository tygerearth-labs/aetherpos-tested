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

/**
 * Scope of items included in a stock opname session.
 *  - ALL_ITEMS      : every active inventory item in the outlet
 *  - CATEGORY       : items in one or more selected categories
 *  - SELECTED_ITEMS : an explicit list of inventory item IDs
 */
export type OpnameScope = 'ALL_ITEMS' | 'CATEGORY' | 'SELECTED_ITEMS'

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
  totalItems: number           // CANONICAL: item-level count only (excludes batch-level snapshots)
  countedItems: number         // CANONICAL: items with physicalQty !== null (item-level only)
  varianceItems: number        // CANONICAL: counted items where physicalQty != systemQty (item-level only)
  notes: string | null
  opnameId?: string            // AUDIT-2-006: idempotency key for server-side dedup
  scope?: OpnameScope          // UX V2: scope used to start this session
  scopeLabel?: string | null   // UX V2: human-readable scope label
  includeZeroStock?: boolean   // UX V2: whether zero-stock items were included
}

/**
 * Immutable completion summary built from snapshots BEFORE the API call.
 * Used by the Complete Dialog so it never shows 0 even if Dexie is reset.
 *
 * INVARIANTS:
 *   countedItems + uncountedItems == totalItems
 *   matchedItems + adjustedItems == countedItems
 *   totalPositiveDelta = sum(delta where delta > 0)
 *   totalNegativeDelta = sum(|delta| where delta < 0)
 */
export interface CompletionSummary {
  totalItems: number
  countedItems: number
  uncountedItems: number
  matchedItems: number          // counted && physicalQty == systemQty
  adjustedItems: number         // counted && physicalQty != systemQty
  totalPositiveDelta: number    // sum of positive deltas (stock added)
  totalNegativeDelta: number    // sum of |negative deltas| (stock removed)
  adjustments: Array<{
    snapshotId: string
    inventoryItemId: string
    itemName: string
    itemSku: string | null
    itemUnit: string
    categoryName: string | null
    systemQty: number
    physicalQty: number
    delta: number
  }>
}

export interface OpnameCategory {
  id: string
  name: string
  itemCount: number
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

/** Options shared by previewOpname() and startOpname(). */
export interface OpnameStartOptions {
  scope?: OpnameScope
  categoryIds?: string[]
  selectedItemIds?: string[]
  includeZeroStock?: boolean
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
 * Get current opname session metadata.
 *
 * CANONICAL INVARIANT (UX V2):
 *   totalItems / countedItems / varianceItems are computed from ITEM-LEVEL
 *   snapshots only (batchId === null). Batch-level snapshots exist in Dexie
 *   for the server's FEFO distribution (M2A-001) but are NEVER shown to the
 *   user as separate rows, so they must NOT inflate the totals.
 */
export async function getOpnameSession(): Promise<OpnameSession | null> {
  const db = getAetherDB()
  const session = await db.stockOpnameSession.get('current')

  if (!session) return null

  // Recalculate counts from snapshots — ITEM-LEVEL ONLY.
  const snapshots = await db.stockOpnameSnapshots.toArray()
  const itemSnapshots = snapshots.filter(s => s.batchId === null)
  const totalItems = itemSnapshots.length
  const countedItems = itemSnapshots.filter(s => s.physicalQty !== null).length
  const varianceItems = itemSnapshots.filter(s =>
    s.physicalQty !== null && Math.abs((s.physicalQty ?? 0) - s.systemQty) > 0.001
  ).length

  return {
    status: session.status,
    startedAt: session.startedAt,
    totalItems,                    // CANONICAL — item-level only
    countedItems,                  // CANONICAL — item-level only
    varianceItems,                 // CANONICAL — item-level only
    notes: session.notes,
    opnameId: session.opnameId,
    scope: session.scope,
    scopeLabel: session.scopeLabel,
    includeZeroStock: session.includeZeroStock,
  }
}

/**
 * PREVIEW an opname without starting it.
 *
 * Fetches the snapshot data from the server and applies the same filters
 * that `startOpname()` would apply, then returns:
 *   - itemCount   : number of ITEM-LEVEL snapshots that would be created
 *   - categoryCount : number of distinct categories in the filtered set
 *   - categories  : per-category item counts (for the SELECTED_ITEMS preview)
 *   - snapshotAt  : ISO timestamp of the underlying server fetch
 *
 * NOTE: This does NOT store anything in Dexie. The user can call this to
 * see "292 item akan masuk sesi" before committing.
 */
export async function previewOpname(
  outletId: string,
  options?: OpnameStartOptions
): Promise<{
  itemCount: number
  categoryCount: number
  categories: OpnameCategory[]
  snapshotAt: string
}> {
  const data = await fetchSnapshot(outletId)
  const filtered = applyScopeFilter(data.items, options)

  // Distinct categories with item counts
  const catMap = new Map<string, OpnameCategory>()
  for (const item of filtered) {
    const id = item.categoryId
    const name = item.categoryName || 'Tanpa Kategori'
    if (!id) {
      const existing = catMap.get('__none__')
      if (existing) existing.itemCount++
      else catMap.set('__none__', { id: '__none__', name, itemCount: 1 })
      continue
    }
    const existing = catMap.get(id)
    if (existing) existing.itemCount++
    else catMap.set(id, { id, name, itemCount: 1 })
  }

  return {
    itemCount: filtered.length,
    categoryCount: catMap.size,
    categories: Array.from(catMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    snapshotAt: data.snapshotAt,
  }
}

/**
 * START a new stock opname.
 *
 * 1. Clears any existing session data
 * 2. Fetches current inventory from server
 * 3. Stores snapshot in Dexie (item-level + batch-level)
 *
 * CANONICAL INVARIANT (UX V2):
 *   `session.totalItems` = ITEM-LEVEL snapshot count (excludes batch-level).
 *   The toast, cards, review table, and complete dialog all read this same
 *   value via `getOpnameSession()`, eliminating the previous mismatch where
 *   the toast showed the raw snapshot length (items + batches) while the
 *   page showed the filtered item-level count.
 *
 * @param outletId - The outlet ID to snapshot
 * @param options  - Scope / categoryIds / selectedItemIds / includeZeroStock
 */
export async function startOpname(
  outletId: string,
  options?: OpnameStartOptions
): Promise<{ totalItems: number; totalBatches: number }> {
  const db = getAetherDB()

  // Clear any existing data first
  await clearOpnameData(db)

  // Fetch snapshot from server
  const data = await fetchSnapshot(outletId)
  const { totalBatches } = data
  const filteredItems = applyScopeFilter(data.items, options)

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
    // (used by server's FEFO distribution — M2A-001 — but never shown to user)
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

  // CANONICAL totalItems: ITEM-LEVEL only (batchId === null).
  // This is what every UI surface reads via getOpnameSession().
  const itemLevelCount = snapshots.filter(s => s.batchId === null).length

  // Build a human-readable scope label for display on cards/dialogs.
  const scopeLabel = buildScopeLabel(options, filteredItems.length)

  // AUDIT-2-006: Generate a stable opnameId (idempotency key) at start time.
  // This is sent to the server at complete time so the server can detect
  // duplicate submissions (network failure between server-commit and
  // client-receive → client retries → server sees same opnameId → skips).
  const opnameId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `opname-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  await db.stockOpnameSession.put({
    id: 'current',
    status: 'COUNTING',
    startedAt: now,
    totalItems: itemLevelCount,        // CANONICAL — item-level only
    countedItems: 0,
    varianceItems: 0,
    notes: null,
    opnameId,
    scope: options?.scope || 'ALL_ITEMS',
    scopeLabel,
    includeZeroStock: options?.includeZeroStock !== false,
  })

  console.log(
    `[StockOpname] Started: ${itemLevelCount} items (canonical), ` +
    `${snapshots.length} snapshots total (${snapshots.length - itemLevelCount} batch-level) ` +
    `for FEFO distribution`
  )

  return { totalItems: itemLevelCount, totalBatches }
}

/**
 * Build an immutable completion summary from the current Dexie snapshots.
 *
 * This MUST be called BEFORE the API complete call so the Complete Dialog
 * has a stable snapshot of what will be committed — independent of any
 * later filter/reset. The dialog reads `completionSummary` from React state,
 * NOT from derived/filtered rows.
 *
 * INVARIANTS enforced:
 *   countedItems + uncountedItems == totalItems
 *   matchedItems + adjustedItems == countedItems
 *   totalPositiveDelta = sum(delta where delta > 0)
 *   totalNegativeDelta = sum(|delta| where delta < 0)
 */
export async function buildCompletionSummary(): Promise<CompletionSummary> {
  const db = getAetherDB()
  const all = await db.stockOpnameSnapshots.toArray()
  const itemSnapshots = all.filter(s => s.batchId === null) // item-level only

  const totalItems = itemSnapshots.length
  const counted = itemSnapshots.filter(s => s.physicalQty !== null)
  const countedItems = counted.length
  const uncountedItems = totalItems - countedItems

  let matchedItems = 0
  let adjustedItems = 0
  let totalPositiveDelta = 0
  let totalNegativeDelta = 0

  const adjustments: CompletionSummary['adjustments'] = []
  for (const s of counted) {
    const delta = (s.physicalQty ?? 0) - s.systemQty
    if (Math.abs(delta) < 0.001) {
      matchedItems++
      continue
    }
    adjustedItems++
    if (delta > 0) totalPositiveDelta += delta
    else totalNegativeDelta += Math.abs(delta)
    adjustments.push({
      snapshotId: s.id,
      inventoryItemId: s.inventoryItemId,
      itemName: s.itemName,
      itemSku: s.itemSku,
      itemUnit: s.itemUnit,
      categoryName: s.categoryName,
      systemQty: s.systemQty,
      physicalQty: s.physicalQty ?? 0,
      delta,
    })
  }

  // Sort adjustments: largest absolute delta first (most impactful on top)
  adjustments.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return {
    totalItems,
    countedItems,
    uncountedItems,
    matchedItems,
    adjustedItems,
    totalPositiveDelta: Math.round(totalPositiveDelta * 1000) / 1000,
    totalNegativeDelta: Math.round(totalNegativeDelta * 1000) / 1000,
    adjustments,
  }
}

/**
 * Get the list of distinct categories present in the current opname session.
 * Used by the COUNTING page's category filter dropdown.
 */
export async function getOpnameCategories(): Promise<OpnameCategory[]> {
  const db = getAetherDB()
  const all = await db.stockOpnameSnapshots.toArray()
  const itemSnapshots = all.filter(s => s.batchId === null)

  const catMap = new Map<string, OpnameCategory>()
  for (const s of itemSnapshots) {
    const id = s.categoryId || '__none__'
    const name = s.categoryName || 'Tanpa Kategori'
    const existing = catMap.get(id)
    if (existing) existing.itemCount++
    else catMap.set(id, { id, name, itemCount: 1 })
  }
  return Array.from(catMap.values()).sort((a, b) => a.name.localeCompare(b.name))
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
 * UX V2 ORDERING (critical):
 *   1. Build immutable `completionSummary` BEFORE the API call (caller does
 *      this and stores it in React state — see stock-opname-page.tsx).
 *   2. POST to server.
 *   3. ONLY on 2xx response → clear Dexie. (Failed complete keeps Dexie so
 *      the user can retry / fix without losing their counts.)
 *   4. On failure: revert session.status from COMPLETING back to REVIEW so
 *      the user can adjust and retry.
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
    opnameId: session?.opnameId, // AUDIT-2-006: idempotency key
  }

  // Send to server
  const response = await fetch('/api/inventory/stock-opname', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    // FAILURE — keep Dexie intact, revert status so the user can retry.
    await db.stockOpnameSession.update('current', { status: 'REVIEW' }).catch(() => {})
    const error = await response.json().catch(() => ({ message: 'Unknown error' }))
    throw new Error(error.message || `Gagal menyelesaikan stock opname: ${response.statusText}`)
  }

  const result: CompleteResult = await response.json()

  // SUCCESS — server commit succeeded. NOW it is safe to clear Dexie.
  // (If we cleared before the fetch resolved and the server returned an
  //  error, the user's counts would be lost forever.)
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

/**
 * Raw server fetch for snapshot data. Shared by previewOpname() & startOpname()
 * so both see identical item sets.
 */
interface SnapshotApiItem {
  inventoryItemId: string
  itemName: string
  itemSku: string | null
  itemUnit: string
  categoryId: string | null
  categoryName: string | null
  systemQty: number
  avgCost: number
  hasBatches: boolean
  batches: Array<{
    batchId: string
    batchNumber: string
    remainingQty: number
    unitCost: number
    expiredDate: string | null
  }>
}

async function fetchSnapshot(
  outletId: string
): Promise<{ items: SnapshotApiItem[]; totalBatches: number; snapshotAt: string }> {
  const response = await fetch(`/api/inventory/stock-opname?outletId=${outletId}`)
  if (!response.ok) {
    throw new Error(`Gagal mengambil data inventory: ${response.statusText}`)
  }
  const data = await response.json()
  return {
    items: data.items as SnapshotApiItem[],
    totalBatches: data.totalBatches as number,
    snapshotAt: data.snapshotAt as string,
  }
}

/**
 * Apply scope/categoryIds/selectedItemIds/includeZeroStock filters to a list
 * of server-fetched items. Used by both previewOpname() and startOpname() so
 * the preview count is guaranteed to match the actual session count.
 */
function applyScopeFilter(
  items: SnapshotApiItem[],
  options?: OpnameStartOptions
): SnapshotApiItem[] {
  if (!options) return items

  let filtered = items

  // Scope filter
  if (options.scope === 'CATEGORY' && options.categoryIds?.length) {
    filtered = filtered.filter(item =>
      item.categoryId && options.categoryIds!.includes(item.categoryId)
    )
  } else if (options.scope === 'SELECTED_ITEMS' && options.selectedItemIds?.length) {
    const idSet = new Set(options.selectedItemIds)
    filtered = filtered.filter(item => idSet.has(item.inventoryItemId))
  }

  // Zero-stock filter (default: include zero-stock → so default is `!== false`)
  if (options.includeZeroStock === false) {
    filtered = filtered.filter(item => item.systemQty > 0)
  }

  return filtered
}

/**
 * Build a short human-readable scope label for display on cards/dialogs.
 * Examples:
 *   "Semua Inventory"
 *   "Kategori: Minuman, Snack"
 *   "3 Item Terpilih"
 */
function buildScopeLabel(options: OpnameStartOptions | undefined, itemCount: number): string {
  if (!options || !options.scope || options.scope === 'ALL_ITEMS') {
    return 'Semua Inventory'
  }
  if (options.scope === 'CATEGORY') {
    if (!options.categoryIds?.length) return 'Semua Inventory'
    // We can't access category names here without the server data, so use a
    // count-based label. The UI may enrich this with names from getOpnameCategories().
    return `${options.categoryIds.length} kategori terpilih`
  }
  if (options.scope === 'SELECTED_ITEMS') {
    return `${options.selectedItemIds?.length || itemCount} item terpilih`
  }
  return 'Semua Inventory'
}
