import Dexie, { type Table } from 'dexie'

// ── Types ──

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
  _variantCount: number
  unit: string
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

export interface CachedCategory {
  id: string
  name: string
  color: string
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

export interface OfflineTransaction {
  id?: number
  payload: Record<string, unknown>
  isSynced: 0 | 1
  createdAt: number
  retryCount: number
  invoiceNumber?: string
  localId?: number
  syncedAt?: number
  serverTransactionId?: string
  lastError?: string
}

export interface PendingTransaction {
  id?: number
  items: Array<{
    product: Record<string, unknown>
    variant?: Record<string, unknown>
    qty: number
    customPrice?: number
  }>
  customerId: string | null
  customerName: string | null
  note: string
  subtotal: number
  createdAt: number
  userId: string
  userName: string
}

interface SyncMeta {
  key: string
  value: number
}

interface Setting {
  key: string
  value?: unknown
  data?: unknown
  updatedAt?: string
}

// ── Dexie Database ──

class AetherDB extends Dexie {
  products!: Table<CachedProduct>
  categories!: Table<CachedCategory>
  customers!: Table<CachedCustomer>
  promos!: Table<CachedPromo>
  transactions!: Table<OfflineTransaction>
  pendingTransactions!: Table<PendingTransaction>
  syncMeta!: Table<SyncMeta>
  settings!: Table<Setting>

  constructor() {
    super('aether-pos-local')

    this.version(1).stores({
      products: 'id, sku, barcode, categoryId, name',
      categories: 'id, name',
      customers: 'id, name, whatsapp',
      promos: 'id, name',
      transactions: '++id, isSynced, createdAt',
      pendingTransactions: '++id, createdAt',
      syncMeta: 'key',
      settings: 'key',
    })
  }
}

export const localDB = new AetherDB()