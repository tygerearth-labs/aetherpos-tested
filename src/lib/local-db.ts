/**
 * local-db.ts — Client-side IndexedDB (Dexie) for POS cache & offline transactions.
 *
 * Tables:
 *   products, customers, categories, promos → synced from server via sync-service
 *   pendingTransactions                    → held/deferred transactions in POS
 *   transactions                           → offline transaction queue (isSynced flag)
 *   syncMeta                               → last-sync timestamps
 *   settings                               → cached outlet settings
 */

import Dexie, { type EntityTable } from 'dexie'

// ==================== TYPES ====================

export interface CachedProduct {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  price: number
  hpp: number
  bruto?: number
  netto?: number
  stock: number
  lowStockAlert?: number
  image: string | null
  categoryId: string | null
  hasVariants: boolean
  unit?: string
  _variantCount?: number
  variants?: Array<{
    id: string
    name: string
    sku: string | null
    price: number
    hpp: number
    stock: number
  }>
  updatedAt?: string
}

export interface CachedCustomer {
  id: string
  name: string
  whatsapp: string
  totalSpend: number
  points: number
  updatedAt?: string
}

export interface CachedPromo {
  id: string
  name: string
  type: string
  value: number
  active: boolean
  categoryId: string | null
  minPurchase?: number | null
  maxDiscount?: number | null
  updatedAt?: string
}

export interface CachedCategory {
  id: string
  name: string
  color: string
  updatedAt?: string
}

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

export interface OfflineTransaction {
  id?: number
  isSynced: number
  payload: Record<string, unknown>
  invoiceNumber?: string
  createdAt: number
  updatedAt?: number
  retryCount?: number
  lastError?: string
  syncedAt?: number
}

// ==================== DEXIE DB ====================

class AetherLocalDB extends Dexie {
  products!: EntityTable<CachedProduct, 'id'>
  customers!: EntityTable<CachedCustomer, 'id'>
  categories!: EntityTable<CachedCategory, 'id'>
  promos!: EntityTable<CachedPromo, 'id'>
  pendingTransactions!: EntityTable<PendingTransaction, 'id'>
  transactions!: EntityTable<OfflineTransaction, 'id'>
  syncMeta!: EntityTable<{ key: string; value: number }, 'key'>
  settings!: EntityTable<{ key: string; data: unknown; updatedAt?: string }, 'key'>

  constructor() {
    super('aetherpos-local')

    this.version(1).stores({
      products: 'id, name, sku, barcode, categoryId',
      customers: 'id, name, whatsapp',
      categories: 'id, name',
      promos: 'id, name, active',
      pendingTransactions: '++id, createdAt',
      transactions: '++id, isSynced, createdAt',
      syncMeta: 'key',
      settings: 'key',
    })
  }
}

export const localDB = new AetherLocalDB()