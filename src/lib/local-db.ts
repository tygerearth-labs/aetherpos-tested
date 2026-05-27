/**
 * local-db.ts — IndexedDB via Dexie for Offline Mode
 *
 * Stores cached products, customers, promos, categories, and offline transactions
 * in the browser's IndexedDB for use when the device is offline.
 */

import Dexie from 'dexie'
import type { EntityTable } from 'dexie'

// ============================================================
// Types
// ============================================================

export interface CachedProductVariant {
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
  variants: CachedProductVariant[]
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

export interface OfflineTransaction {
  id?: number // auto-incremented
  payload: Record<string, unknown>
  isSynced: 0 | 1
  createdAt: number
  retryCount: number
  // Fields populated after successful sync
  syncedAt?: number
  invoiceNumber?: string
  serverTransactionId?: string
  // Fields populated on sync failure
  lastError?: string
}

export interface SyncMeta {
  key: string
  value: number
}

export interface CachedSettings {
  key: string // always 'outlet-settings'
  data: Record<string, unknown>
  updatedAt: string
}

// ============================================================
// Database
// ============================================================

class AetherDB extends Dexie {
  products!: EntityTable<CachedProduct, 'id'>
  categories!: EntityTable<CachedCategory, 'id'>
  customers!: EntityTable<CachedCustomer, 'id'>
  promos!: EntityTable<CachedPromo, 'id'>
  transactions!: EntityTable<OfflineTransaction, 'id'>
  syncMeta!: EntityTable<SyncMeta, 'key'>
  settings!: EntityTable<CachedSettings, 'key'>

  constructor() {
    super('aether-pos-local')

    this.version(3).stores({
      products: 'id, name, sku, barcode, categoryId, updatedAt',
      categories: 'id, name, updatedAt',
      customers: 'id, name, whatsapp, updatedAt',
      promos: 'id, name, type, active, updatedAt',
      transactions: '++id, isSynced, createdAt',
      syncMeta: 'key',
      settings: 'key',
    })
  }
}

export const localDB = new AetherDB()
