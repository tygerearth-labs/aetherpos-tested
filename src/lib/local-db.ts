/**
 * local-db.ts
 *
 * Dexie (IndexedDB) database for offline-first data storage.
 * Stores Products, Categories, Customers, Promos, sync metadata,
 * pending (held) transactions, and offline transactions
 * so the POS works even when offline.
 */

import Dexie, { type EntityTable } from 'dexie'

// ==================== TYPES ====================

export interface CachedVariant {
  id: string
  name: string
  sku: string | null
  price: number
  hpp: number
  stock: number
}

export interface CachedProduct {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  hpp: number
  price: number
  bruto: number
  netto: number
  stock: number
  lowStockAlert: number
  image: string | null
  categoryId: string | null
  hasVariants: boolean
  _variantCount: number
  variants: CachedVariant[]
  updatedAt: string
}

export interface CachedCategory {
  id: string
  name: string
  color: string
  updatedAt: string
}

export interface CachedCustomer {
  id: string
  name: string
  whatsapp: string
  points: number
  totalSpend: number
  updatedAt: string
}

export interface CachedPromo {
  id: string
  name: string
  type: string
  value: number
  minPurchase: number | null
  maxDiscount: number | null
  active: boolean
  updatedAt: string
}

/**
 * A held/parked transaction the user intends to resume later.
 * Auto-incremented `id` — referenced by PendingTransaction type.
 */
export interface PendingTransaction {
  id?: number
  items: Array<{
    product: Record<string, unknown>
    variant: Record<string, unknown> | null
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

/**
 * An offline transaction queued for sync to the server.
 * `isSynced`: 0 = pending, 1 = synced.
 * Auto-incremented `id`.
 */
export interface OfflineTransaction {
  id?: number
  payload: Record<string, unknown>
  isSynced: number
  createdAt: number
  retryCount?: number
  lastError?: string | null
  syncedAt?: number | null
  invoiceNumber?: string | null
  serverTransactionId?: string | null
}

interface SyncMeta {
  key: string
  value: number
}

interface SettingsCache {
  key: string
  data: Record<string, unknown>
  updatedAt: string
}

// ==================== DATABASE ====================

class AetherPOSDB extends Dexie {
  products!: EntityTable<CachedProduct, 'id'>
  categories!: EntityTable<CachedCategory, 'id'>
  customers!: EntityTable<CachedCustomer, 'id'>
  promos!: EntityTable<CachedPromo, 'id'>
  syncMeta!: EntityTable<SyncMeta, 'key'>
  settings!: EntityTable<SettingsCache, 'key'>
  pendingTransactions!: EntityTable<PendingTransaction, 'id'>
  transactions!: EntityTable<OfflineTransaction, 'id'>

  constructor() {
    super('AetherPOS')

    this.version(1).stores({
      products: 'id, name, sku, barcode, categoryId, price',
      categories: 'id, name',
      customers: 'id, name, whatsapp',
      promos: 'id, name, type, active',
      syncMeta: 'key',
      settings: 'key',
      pendingTransactions: '++id, createdAt',
      transactions: '++id, isSynced, createdAt',
    })
  }
}

export const localDB = new AetherPOSDB()
