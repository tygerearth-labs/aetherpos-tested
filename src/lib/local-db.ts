import Dexie, { type Table } from 'dexie'

// ==================== TYPES ====================

export interface ProductVariant {
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
  variants: ProductVariant[]
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
  totalSpend: number
  points: number
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
  id?: number
  payload: Record<string, unknown>
  isSynced: number
  createdAt: number
  retryCount: number
  syncedAt?: number
  invoiceNumber?: string
  serverTransactionId?: string
  lastError?: string
}

export interface PendingTransaction {
  id?: number
  items: Array<{
    product: CachedProduct
    variant: ProductVariant | null
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

export interface SyncMeta {
  key: string
  value: number
}

export interface CachedSetting {
  key: string
  data: Record<string, unknown>
  updatedAt: string
}

// ==================== DATABASE ====================

class LocalDatabase extends Dexie {
  products!: Table<CachedProduct, string>
  categories!: Table<CachedCategory, string>
  customers!: Table<CachedCustomer, string>
  promos!: Table<CachedPromo, string>
  transactions!: Table<OfflineTransaction, number>
  pendingTransactions!: Table<PendingTransaction, number>
  syncMeta!: Table<SyncMeta, string>
  settings!: Table<CachedSetting, string>

  constructor() {
    super('pos-offline-db')
    this.version(1).stores({
      products: 'id, name, sku, barcode, categoryId, updatedAt',
      categories: 'id, name',
      customers: 'id, name, whatsapp',
      promos: 'id, name, active',
      transactions: '++id, isSynced, createdAt',
      pendingTransactions: '++id, createdAt',
      syncMeta: 'key',
      settings: 'key',
    })
  }
}

export const localDB = new LocalDatabase()