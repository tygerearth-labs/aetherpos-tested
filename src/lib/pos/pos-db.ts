/**
 * pos-db.ts — AetherPOS POS Offline Database (Dexie / IndexedDB)
 *
 * PR 3 — Offline POS with Dexie.
 *
 * Design:
 *   - Working-set cache ONLY. Do NOT mirror the full catalog.
 *   - Cache: featured products, search results, opened variants,
 *            products added to cart, active promos, outlet settings,
 *            crew permissions, customers used by POS.
 *   - cart + customerOutbox + transactionOutbox survive reload.
 *   - Never clear before successful response. Failed sync preserves cache.
 *   - valid deletedIds remove stale products.
 *
 * Tables:
 *   posProducts       — parent products (no variant preload)
 *   posVariants       — variants fetched on-demand
 *   categories        — category list
 *   customers         — customers used by POS (working set)
 *   promos            — active promos
 *   outletSettings    — cached outlet settings (key/value)
 *   crewPermissions   — cached crew permission pages
 *   cart              — persistent cart (survives reload)
 *   customerOutbox    — offline-created customers pending sync
 *   transactionOutbox — offline checkouts pending sync (localTransactionId = eventId)
 *   syncMeta          — sync metadata (last sync times, version)
 *
 * @boundary COCKPIT only — no engine imports. This is a client-side cache.
 */

import Dexie, { type EntityTable } from 'dexie'

// ════════════════════════════════════════════════════════════
// Cached Product (parent only — no variant preload per PR 2)
// ════════════════════════════════════════════════════════════

export interface CachedPosProduct {
  id: string
  name: string
  price: number
  stock: number
  hpp: number
  sku: string | null
  barcode: string | null
  categoryId: string | null
  categoryName: string | null
  image: string | null
  unit: string
  hasVariants: boolean
  _variantCount: number
  /** variants NOT preloaded (PR 2). Empty array. Fetched on-demand. */
  variants: never[]
  /** source: 'featured' | 'search' | 'cart' | 'lookup' */
  source?: string
  cachedAt: number
}

export interface CachedPosVariant {
  id: string
  productId: string
  name: string
  sku: string | null
  barcode: string | null
  price: number
  hpp: number
  stock: number
  cachedAt: number
}

export interface CachedCategory {
  id: string
  name: string
  color: string
  cachedAt: number
}

export interface CachedCustomer {
  id: string
  name: string
  whatsapp: string
  points: number
  totalSpend: number
  /** true = created locally, pending sync */
  isLocal?: boolean
  cachedAt: number
}

export interface CachedPromo {
  id: string
  name: string
  type: string
  value: number
  minPurchase: number | null
  maxDiscount: number | null
  active: boolean
  validUntil: string | null
  cachedAt: number
}

export interface CachedOutletSetting {
  key: string
  value: string // JSON stringified
  updatedAt: string
}

export interface CachedCrewPermission {
  userId: string
  pages: string
  cachedAt: number
}

// ════════════════════════════════════════════════════════════
// Persistent Cart (survives reload)
// ════════════════════════════════════════════════════════════

export interface CartRow {
  /** composite key: productId or productId_variantId */
  id: string
  productId: string
  variantId: string | null
  product: CachedPosProduct
  variant: CachedPosVariant | null
  qty: number
  customPrice: number | null
  addedAt: number
}

// ════════════════════════════════════════════════════════════
// Customer Outbox (offline-created customers)
// ════════════════════════════════════════════════════════════

export type OutboxSyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT' | 'ABANDONED'

export interface CustomerOutboxRow {
  /** local UUID — used to reference this customer in transactionOutbox */
  id: string
  name: string
  whatsapp: string
  createdAt: number
  status: OutboxSyncStatus
  /** server-assigned customer id after sync (for resolving localCustomerId) */
  serverId: string | null
  error: string | null
  retryCount: number
}

// ════════════════════════════════════════════════════════════
// Transaction Outbox (offline checkouts)
// ════════════════════════════════════════════════════════════

export interface TransactionSnapshot {
  itemPrices: Array<{ productId: string; variantId: string | null; price: number; qty: number; customPrice: number | null }>
  manualDiscount: number
  promoDiscount: number
  pointsDiscount: number
  taxAmount: number
  grandTotal: number
  promoId: string | null
  pointsUsed: number
  ppnRate: number
}

export interface TransactionOutboxRow {
  /** localTransactionId — also sent as eventId for idempotency (DEX-007) */
  id: string
  /** full checkout payload (matches /api/transactions/sync shape) */
  payload: {
    customerId: string | null
    /** true if customerId is a local outbox id (needs resolution before sync) */
    customerIsLocal: boolean
    items: Array<{
      productId: string
      productName: string
      price: number
      qty: number
      subtotal: number
      variantId?: string | null
      variantName?: string | null
      itemDiscount?: number
    }>
    subtotal: number
    discount: number
    pointsUsed: number
    taxAmount?: number
    total: number
    paymentMethod: string
    paidAmount: number
    change: number
    promoId?: string | null
    promoDiscount?: number
  }
  /** persisted calculation snapshot for audit/receipt */
  snapshot: TransactionSnapshot
  createdAt: number
  status: OutboxSyncStatus
  serverId: string | null
  invoiceNumber: string | null
  error: string | null
  retryCount: number
}

// ════════════════════════════════════════════════════════════
// Sync Meta
// ════════════════════════════════════════════════════════════

export interface SyncMetaRow {
  key: string
  value: string
  updatedAt: string
}

// ════════════════════════════════════════════════════════════
// Dexie Database
// ════════════════════════════════════════════════════════════

class PosDB extends Dexie {
  posProducts!: EntityTable<CachedPosProduct, 'id'>
  posVariants!: EntityTable<CachedPosVariant, 'id'>
  categories!: EntityTable<CachedCategory, 'id'>
  customers!: EntityTable<CachedCustomer, 'id'>
  promos!: EntityTable<CachedPromo, 'id'>
  outletSettings!: EntityTable<CachedOutletSetting, 'key'>
  crewPermissions!: EntityTable<CachedCrewPermission, 'userId'>
  cart!: EntityTable<CartRow, 'id'>
  customerOutbox!: EntityTable<CustomerOutboxRow, 'id'>
  transactionOutbox!: EntityTable<TransactionOutboxRow, 'id'>
  syncMeta!: EntityTable<SyncMetaRow, 'key'>

  constructor() {
    super('aetherpos-pos')

    this.version(1).stores({
      // Working-set cache (upsert, never clear before success)
      posProducts:       'id, name, sku, barcode, categoryId, hasVariants, source, cachedAt',
      posVariants:       'id, productId, name, sku, barcode, cachedAt',
      categories:        'id, name, cachedAt',
      customers:         'id, name, whatsapp, isLocal, cachedAt',
      promos:            'id, name, active, cachedAt',
      outletSettings:    'key',
      crewPermissions:   'userId, cachedAt',
      // Persistent cart + outbox (survive reload)
      cart:              'id, productId, variantId, addedAt',
      customerOutbox:    'id, status, createdAt, serverId',
      transactionOutbox: 'id, status, createdAt, serverId',
      syncMeta:          'key',
    })
  }
}

// ── Singleton (client-side only) ──

let _db: PosDB | null = null

export function getPosDB(): PosDB {
  if (typeof window === 'undefined') {
    throw new Error('[PosDB] Cannot access IndexedDB on server side')
  }
  if (!_db) {
    _db = new PosDB()
  }
  return _db
}

/**
 * Safe accessor — returns null on server side or if IndexedDB is unavailable.
 * Use this in hooks that run during SSR.
 */
export function tryGetPosDB(): PosDB | null {
  try {
    return getPosDB()
  } catch {
    return null
  }
}

// ════════════════════════════════════════════════════════════
// Working-set cache helpers
// ════════════════════════════════════════════════════════════

/**
 * Upsert products into the working-set cache. Never clears existing data.
 * Call this after every successful backend response (featured, search, lookup, cart-add).
 */
export async function cacheProducts(products: CachedPosProduct[], source: string): Promise<void> {
  const db = tryGetPosDB()
  if (!db || products.length === 0) return
  const stamped = products.map(p => ({ ...p, source, cachedAt: Date.now() }))
  await db.posProducts.bulkPut(stamped)
}

/**
 * Upsert variants into the working-set cache (on-demand, after variant picker open).
 */
export async function cacheVariants(productId: string, variants: CachedPosVariant[]): Promise<void> {
  const db = tryGetPosDB()
  if (!db || variants.length === 0) return
  const stamped = variants.map(v => ({ ...v, cachedAt: Date.now() }))
  await db.posVariants.bulkPut(stamped)
}

/**
 * Remove stale products whose IDs are in `deletedIds`.
 * Safety: only removes explicitly-listed IDs, never bulk-clears.
 */
export async function removeStaleProducts(deletedIds: string[]): Promise<void> {
  const db = tryGetPosDB()
  if (!db || deletedIds.length === 0) return
  await db.posProducts.bulkDelete(deletedIds)
}

/**
 * Persist the cart so it survives reload.
 */
export async function saveCart(rows: CartRow[]): Promise<void> {
  const db = tryGetPosDB()
  if (!db) return
  await db.cart.clear()
  if (rows.length > 0) {
    await db.cart.bulkPut(rows)
  }
}

/**
 * Load the persisted cart on mount.
 */
export async function loadCart(): Promise<CartRow[]> {
  const db = tryGetPosDB()
  if (!db) return []
  return db.cart.orderBy('addedAt').toArray()
}

/**
 * Clear the persisted cart after a successful checkout (receipt finished).
 * NOTE: transactionOutbox is NOT cleared here — it survives until sync confirms.
 */
export async function clearCart(): Promise<void> {
  const db = tryGetPosDB()
  if (!db) return
  await db.cart.clear()
}

export type {
  CachedPosProduct,
  CachedPosVariant,
}
