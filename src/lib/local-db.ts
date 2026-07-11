/**
 * local-db.ts — Stub for IndexedDB (Dexie) offline cache.
 *
 * This is a minimal stub so the app compiles. Replace with real
 * Dexie implementation when offline-first is needed.
 */

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

interface SyncMeta {
  key: string
  value: number
}

interface Setting {
  key: string
  value: unknown
}

// ── Noop table stub ──
function createNoopTable<T>() {
  return {
    clear: async () => {},
    bulkPut: async (_items: T[]) => {},
    count: async () => 0,
    get: async (_key: string) => undefined as T | undefined,
    put: async (_item: T) => {},
    toArray: async () => [] as T[],
  }
}

export const localDB = {
  products: createNoopTable<CachedProduct>(),
  customers: createNoopTable<CachedCustomer>(),
  categories: createNoopTable<CachedCategory>(),
  promos: createNoopTable<CachedPromo>(),
  syncMeta: createNoopTable<SyncMeta>(),
  settings: createNoopTable<Setting>(),
}