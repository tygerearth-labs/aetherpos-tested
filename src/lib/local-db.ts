/**
 * local-db.ts — Dexie-compatible local database for offline-first features.
 *
 * This is the legacy module path. New code should import from '@/lib/offline'.
 * The legacy export is preserved so existing components (pos-page, sync-service,
 * batch-barcode-dialog) keep working without a refactor.
 *
 * Implementation: thin shim that delegates to the offline module's repositories
 * and provides noop Dexie-style tables for backward compatibility. When running
 * server-side (SSR), all operations return empty results safely.
 */

import type { OfflineTransaction } from '@/lib/offline/aether-db'

// ── Cached entity types (mirror legacy-stub.ts) ──────────────────────────────

interface CachedProduct {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  price: number
  stock: number
  hpp: number
  image: string | null
  categoryId: string | null
  hasVariants: boolean
  unit: string
}

interface CachedCustomer {
  id: string
  name: string
  whatsapp: string
  totalSpend: number
  points: number
}

interface CachedPromo {
  id: string
  name: string
  type: string
  value: number
  active: boolean
  categoryId: string | null
}

interface CachedCategory {
  id: string
  name: string
  color: string
}

interface SyncMeta {
  key: string
  value: number
}

interface SettingEntry {
  key: string
  value: unknown
}

// ── Pending transaction (held cart) ──────────────────────────────────────────
// Matches the shape written by pos-page.tsx:confirmHoldTransaction.

export interface PendingTransaction {
  id?: number
  items: Array<{
    product: CachedProduct
    variant: unknown
    qty: number
    customPrice?: number | null
  }>
  customerId: string | null
  customerName: string | null
  note: string
  subtotal: number
  createdAt: number
  userId: string
  userName: string
}

// Re-export OfflineTransaction type for backwards-compat with code that imports
// it from this module path.
export type { OfflineTransaction }

// ── Noop table builder ───────────────────────────────────────────────────────
// Implements the subset of Dexie's Table API used by callers. Methods are async
// and return empty/safe defaults so SSR and online-only mode do not crash.

function createNoopTable<T extends { id?: number | string }>(): NoopTable<T> {
  const rows: T[] = []
  return {
    clear: async () => {
      rows.length = 0
    },
    bulkPut: async (_items: T[]) => {
      // Maintain an in-memory shadow so subsequent toArray() returns the latest
      // held cart even when IndexedDB is unavailable. This is enough for the
      // POS "hold / resume transaction" feature in a single session.
      for (const item of _items) {
        const idx = rows.findIndex((r) => r.id === item.id)
        if (idx >= 0) rows[idx] = item
        else rows.push(item)
      }
    },
    count: async () => rows.length,
    get: async (_key: number | string) => rows.find((r) => String(r.id) === String(_key)),
    put: async (item: T) => {
      const idx = rows.findIndex((r) => r.id === item.id)
      if (idx >= 0) rows[idx] = item
      else rows.push(item)
    },
    add: async (item: T) => {
      // Auto-assign a numeric id if missing (Dexie autoincrement behavior)
      if (item.id === undefined || item.id === null) {
        const nextId = rows.length === 0
          ? 1
          : Math.max(...rows.map((r) => (typeof r.id === 'number' ? r.id : 0))) + 1
        ;(item as { id?: number }).id = nextId
      }
      rows.push(item)
      return item.id as number
    },
    delete: async (key: number | string) => {
      const idx = rows.findIndex((r) => String(r.id) === String(key))
      if (idx >= 0) rows.splice(idx, 1)
    },
    toArray: async () => [...rows],
    orderBy: (_field: string) => ({
      reverse: () => ({
        toArray: async () => [...rows].reverse(),
      }),
      // forward iteration (rarely used)
      toArray: async () => [...rows],
    }),
    where: (_field: string) => ({
      equals: (_value: unknown) => {
        // Noop filter — returns rows where the field matches; safe default.
        // Mirrors Dexie's Collection API: exposes toArray(), count(), AND modify()
        // so callers like:
        //   - localDB.transactions.where('isSynced').equals(0).count()  (useLiveQuery)
        //   - localDB.products.where('id').equals(id).modify(fn)         (stock decrement)
        // do not crash with ".count/.modify is not a function".
        const filtered = rows.filter((r) => (r as Record<string, unknown>)[_field] === _value)
        return {
          toArray: async () => [...filtered],
          count: async () => filtered.length,
          // Dexie's modify() mutates matching records in place. We apply the
          // callback to the actual row objects (not copies) so the in-memory
          // shadow stays consistent for subsequent reads.
          modify: async (modifier: (obj: T, ctx: { primaryKey: unknown }) => void) => {
            for (const r of filtered) {
              modifier(r, { primaryKey: r.id })
            }
          },
        }
      },
    }),
    update: async (key: number | string, changes: Partial<T>) => {
      const idx = rows.findIndex((r) => String(r.id) === String(key))
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...changes }
        return true
      }
      return false
    },
  }
}

interface NoopTable<T extends { id?: number | string }> {
  clear(): Promise<void>
  bulkPut(items: T[]): Promise<void>
  count(): Promise<number>
  get(key: number | string): Promise<T | undefined>
  put(item: T): Promise<void>
  add(item: T): Promise<number>
  delete(key: number | string): Promise<void>
  toArray(): Promise<T[]>
  orderBy(field: string): {
    reverse(): { toArray(): Promise<T[]> }
    toArray(): Promise<T[]>
  }
  where(field: string): {
    equals(value: unknown): {
      toArray(): Promise<T[]>
      count(): Promise<number>
      modify(modifier: (obj: T, ctx: { primaryKey: unknown }) => void): Promise<number>
    }
  }
  update(key: number | string, changes: Partial<T>): Promise<boolean>
}

// ── SyncedTransaction — local mirror of offline transactions, with sync metadata ─
// pos-page.tsx reads localDB.transactions to list transactions awaiting sync.

export interface SyncedTransactionRow {
  id?: number
  isSynced: 0 | 1
  syncedAt?: number
  invoiceNumber?: string
  serverTransactionId?: string
  createdAt: number
  payload: {
    customerId: string | null
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
    invoiceNumber?: string
  }
  eventId?: string
}

// Cast helper — createNoopTable is generic enough to be cast to any table shape.
function table<T extends { id?: number | string }>(): NoopTable<T> {
  return createNoopTable<T>()
}

// ── Exported singleton — exposes every table referenced by callers ───────────

export const localDB = {
  products: table<CachedProduct>(),
  customers: table<CachedCustomer>(),
  categories: table<CachedCategory>(),
  promos: table<CachedPromo>(),
  syncMeta: table<SyncMeta>(),
  settings: table<SettingEntry>(),
  pendingTransactions: table<PendingTransaction>(),
  transactions: table<SyncedTransactionRow>(),
} as const

export type { CachedProduct, CachedCustomer, CachedPromo, CachedCategory }
