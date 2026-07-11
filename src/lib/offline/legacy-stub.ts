/**
 * legacy-stub.ts — Noop stub for backward compatibility.
 *
 * Code lama yang import { localDB } from '@/lib/local-db' tetap jalan.
 * Tapi untuk code baru, gunakan @/lib/offline/* .
 */

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
  syncMeta: createNoopTable<{ key: string; value: number }>(),
  settings: createNoopTable<{ key: string; value: unknown }>(),
}

export type { CachedProduct, CachedCustomer, CachedPromo, CachedCategory }