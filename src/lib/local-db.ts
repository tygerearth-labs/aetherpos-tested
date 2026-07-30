/**
 * local-db.ts — Noop shim for backward compatibility.
 *
 * The real offline-first Dexie layer lives in @/lib/offline/* (aether-db.ts).
 * Legacy modules still import { localDB } from '@/lib/local-db' — this file
 * keeps those imports resolving so the app compiles. Every method is a noop
 * that returns empty/undefined/0, so legacy code paths degrade gracefully
 * (offline cache stays empty; online API calls still work).
 *
 * For NEW code, import from @/lib/offline/* instead.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cached entity types (mirror the legacy Dexie schema)
// ─────────────────────────────────────────────────────────────────────────────

export interface CachedProduct {
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

export interface CachedCustomer {
  id: string
  name: string
  whatsapp: string
  totalSpend: number
  points: number
}

export interface CachedPromo {
  id: string
  name: string
  type: string
  value: number
  active: boolean
  categoryId: string | null
}

export interface CachedCategory {
  id: string
  name: string
  color: string
}

export interface OfflineTransaction {
  id?: string
  invoiceNumber: string
  subtotal: number
  discount: number
  pointsUsed: number
  taxAmount: number
  total: number
  paymentMethod: string
  paidAmount: number
  change: number
  note: string | null
  outletId: string
  customerId: string | null
  userId: string
  syncStatus?: string
  createdAt?: string
  [key: string]: unknown
}

export interface OfflineTransactionItem {
  id?: string
  productId: string | null
  variantId: string | null
  productName: string
  productSku: string | null
  variantName: string | null
  variantSku: string | null
  price: number
  qty: number
  subtotal: number
  itemDiscount: number
  hpp: number
  transactionId: string
  [key: string]: unknown
}

export interface PendingTransaction {
  id: number
  createdAt: string
  [key: string]: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Noop table factory — every Dexie-like method returns a safe empty result.
// ─────────────────────────────────────────────────────────────────────────────

interface NoopCollection<T> {
  primaryKeys: () => Promise<string[]>
  toArray: () => Promise<T[]>
}

function createNoopCollection<T>(): NoopCollection<T> {
  return {
    primaryKeys: async () => [],
    toArray: async () => [],
  }
}

interface NoopTable<T, K = string | number> {
  clear: () => Promise<void>
  bulkPut: (_items: T[]) => Promise<K[]>
  bulkDelete: (_keys: K[]) => Promise<void>
  count: () => Promise<number>
  get: (_key: K) => Promise<T | undefined>
  put: (_item: T) => Promise<K>
  toArray: () => Promise<T[]>
  update: (_key: K, _changes: Partial<T>) => Promise<number>
  delete: (_key: K) => Promise<void>
  add: (_item: T) => Promise<K>
  toCollection: () => NoopCollection<T>
  orderBy: (_field: string) => { reverse: () => NoopCollection<T> }
}

function createNoopTable<T, K = string | number>(): NoopTable<T, K> {
  return {
    clear: async () => {},
    bulkPut: async () => [],
    bulkDelete: async () => {},
    count: async () => 0,
    get: async () => undefined,
    put: async () => (0 as unknown) as K,
    toArray: async () => [],
    update: async () => 0,
    delete: async () => {},
    add: async () => (0 as unknown) as K,
    toCollection: () => createNoopCollection<T>(),
    orderBy: () => ({ reverse: () => createNoopCollection<T>() }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public surface — the legacy `localDB` object.
// ─────────────────────────────────────────────────────────────────────────────

export const localDB = {
  products: createNoopTable<CachedProduct>(),
  customers: createNoopTable<CachedCustomer>(),
  categories: createNoopTable<CachedCategory>(),
  promos: createNoopTable<CachedPromo>(),
  syncMeta: createNoopTable<{ key: string; value: number }, string>(),
  settings: createNoopTable<{ key: string; value: unknown }, string>(),
  transactions: createNoopTable<OfflineTransaction>(),
  transactionItems: createNoopTable<OfflineTransactionItem>(),
  pendingTransactions: createNoopTable<PendingTransaction, number>(),
}
