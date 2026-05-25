'use client'

/**
 * local-db.ts — IndexedDB (Dexie) offline-first data store.
 *
 * Stores products, categories, customers, promos, and transactions locally
 * so the POS works offline. Data is synced from the server via sync-service.ts.
 *
 * IMPORTANT: This file MUST have 'use client' because Dexie/IndexedDB
 * is browser-only and will fail in Turbopack's server-side bundle.
 */

import Dexie, { type Table } from 'dexie'

// ============================================================
// Types
// ============================================================

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
  variants: {
    id: string
    name: string
    sku: string | null
    price: number
    hpp: number
    stock: number
  }[]
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

export interface CachedTransaction {
  id?: number
  payload: Record<string, unknown>
  isSynced: number // 0 = pending, 1 = synced
  createdAt: number
  syncedAt?: number
  invoiceNumber?: string
  serverTransactionId?: string
  retryCount?: number
  lastError?: string
}

interface SyncMeta {
  key: string
  value: number
}

interface CachedSetting {
  key: string
  data: Record<string, unknown>
  updatedAt: string
}

// ============================================================
// Database
// ============================================================

class AetherPOSDB extends Dexie {
  products!: Table<CachedProduct, string>
  categories!: Table<CachedCategory, string>
  customers!: Table<CachedCustomer, string>
  promos!: Table<CachedPromo, string>
  transactions!: Table<CachedTransaction, number>
  syncMeta!: Table<SyncMeta, string>
  settings!: Table<CachedSetting, string>

  constructor() {
    super('aether-pos-db')

    this.version(1).stores({
      products: 'id, name, sku, barcode, categoryId',
      categories: 'id, name',
      customers: 'id, name, whatsapp',
      promos: 'id, name, type, active',
      transactions: '++id, isSynced, createdAt',
      syncMeta: 'key',
      settings: 'key',
    })
  }
}

export const localDB = new AetherPOSDB()
