/**
 * aether-db.ts — AetherPOS Local Database (Dexie / IndexedDB)
 *
 * Arsitektur: Offline-First Event Store
 * ─────────────────────────────────────
 * Dexie = Source of Truth saat offline.
 * Setiap table punya syncStatus (PENDING / SYNCED / FAILED).
 * Stock TIDAK disync — dihitung ulang dari InventoryMovement.
 *
 * Cloud-only (tidak ada di Dexie):
 *   AuditLog, LoyaltyLog, TransactionConsumption, ProductComposition,
 *   OutletTransfer, TransferItem, CrewPermission, Plan, Promo, Category
 */

import Dexie, { type EntityTable } from 'dexie'

// ════════════════════════════════════════════════════════════
// Sync Status
// ════════════════════════════════════════════════════════════

export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED'

// ════════════════════════════════════════════════════════════
// Sync Queue Action
// ════════════════════════════════════════════════════════════

export type SyncAction = 'CREATE' | 'UPDATE' | 'DELETE'

export type SyncQueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED'

// ════════════════════════════════════════════════════════════
// Offline Record Base — every Dexie table extends this
// ════════════════════════════════════════════════════════════

export interface OfflineRecord {
  id: string
  syncStatus: SyncStatus
  version: number
  updatedAt: string          // ISO 8601
  createdAt: string          // ISO 8601
  deletedAt: string | null   // Soft delete — null = active
}

// ════════════════════════════════════════════════════════════
// Entity Types (flattened from Prisma — no relations)
// ════════════════════════════════════════════════════════════

export interface OfflineProduct extends OfflineRecord {
  name: string
  sku: string | null
  barcode: string | null
  hpp: number
  price: number
  bruto: number
  netto: number
  stock: number
  lowStockAlert: number
  unit: string
  image: string | null
  categoryId: string | null
  outletId: string
  hasVariants: boolean
  hasComposition: boolean
}

export interface OfflineVariant extends OfflineRecord {
  productId: string
  name: string
  sku: string | null
  barcode: string | null
  hpp: number
  price: number
  stock: number
  outletId: string
}

export interface OfflineInventoryItem extends OfflineRecord {
  name: string
  sku: string | null
  baseUnit: string
  stock: number
  avgCost: number
  lowStockAlert: number
  status: string              // ACTIVE | ARCHIVED
  outletId: string
  categoryId: string | null
}

export interface OfflineInventoryBatch extends OfflineRecord {
  batchNumber: string
  inventoryItemId: string
  initialQty: number
  remainingQty: number
  unitCost: number
  expiredDate: string | null   // ISO 8601
  purchaseOrderId: string
  purchaseOrderItemId: string | null
  supplierId: string | null
  supplierName: string | null
  status: string              // AVAILABLE | EXPIRED | CONSUMED | DISCARDED
  outletId: string
}

export interface OfflineCustomer extends OfflineRecord {
  name: string
  whatsapp: string
  totalSpend: number
  points: number
  outletId: string
}

export interface OfflineSupplier extends OfflineRecord {
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  outletId: string
}

export interface OfflinePurchase extends OfflineRecord {
  orderNumber: string
  supplierId: string | null
  totalCost: number
  notes: string | null
  outletId: string
  userId: string
}

export interface OfflinePurchaseItem extends OfflineRecord {
  purchaseOrderId: string
  inventoryItemId: string
  name: string
  purchaseQty: number
  purchaseUnit: string
  baseQty: number
  baseUnit: string
  unitCost: number
  totalCost: number
  batch: string | null
  expiredDate: string | null
  outletId: string
}

export interface OfflineTransaction extends OfflineRecord {
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
}

export interface OfflineTransactionItem extends OfflineRecord {
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
}

export interface OfflineInventoryMovement extends OfflineRecord {
  type: string               // RESTOCK | ADJUSTMENT | CONSUMPTION | TRANSFER_OUT | TRANSFER_IN | PURCHASE
  quantity: number
  previousStock: number
  newStock: number
  referenceId: string | null
  referenceType: string | null
  notes: string | null
  outletId: string
  inventoryItemId: string
  userId: string | null
}

export interface OfflineBatchConsumptionLog extends OfflineRecord {
  transactionId: string
  inventoryBatchId: string
  inventoryItemId: string
  quantityConsumed: number
  batchNumber: string
  expiredDate: string | null
  invoiceNumber: string
  sourceDetails: string      // JSON string
  outletId: string
}

// ════════════════════════════════════════════════════════════
// Sync Queue
// ════════════════════════════════════════════════════════════

export interface SyncQueueItem {
  id: string
  entity: string             // Table name: 'transactions', 'inventoryMovements', etc.
  entityId: string           // Record ID
  action: SyncAction         // CREATE | UPDATE | DELETE
  payload: string            // JSON string of the full record
  status: SyncQueueStatus    // PENDING | SYNCING | SYNCED | FAILED
  retryCount: number
  errorMessage: string | null
  createdAt: string          // ISO 8601
  syncedAt: string | null    // ISO 8601
}

// ════════════════════════════════════════════════════════════
// Settings & Metadata
// ════════════════════════════════════════════════════════════

export interface OfflineSetting {
  key: string
  value: string              // JSON stringified
  updatedAt: string
}

export interface OfflineMetadata {
  key: string
  value: string              // JSON stringified
  updatedAt: string
}

// ════════════════════════════════════════════════════════════
// Stock Opname Snapshot (Transient Workspace)
// ════════════════════════════════════════════════════════════
// 
// This is a TEMPORARY workspace for stock counting.
// NOT synced to server — cleared after opname completes.
//
// Flow:
//   Start Opname → Snapshot from server → User counts → Complete
//   → Server validates & applies adjustments → Clear Dexie

export interface StockOpnameSnapshot {
  id: string                    // Auto-generated UUID
  inventoryItemId: string       // FK to InventoryItem
  batchId: string | null        // FK to InventoryBatch (null = no batch)
  
  // Item info (snapshot at start time)
  itemName: string
  itemSku: string | null
  itemUnit: string
  batchNumber: string | null
  categoryId: string | null
  categoryName: string | null
  
  // Quantities
  systemQty: number             // System stock at snapshot time (frozen)
  physicalQty: number | null    // Physical count (user input, null = not counted)
  
  // Metadata
  isCounted: boolean            // Quick flag for filtering
  notes: string | null          // Reason for variance (optional)
  
  createdAt: string             // ISO 8601 - when snapshot was taken
  updatedAt: string             // ISO 8601 - last update time
}

// Session metadata for current/active opname
export interface StockOpnameSession {
  id: string                    // Always 'current' (singleton)
  status: 'DRAFT' | 'COUNTING' | 'REVIEW' | 'COMPLETING'
  startedAt: string             // ISO 8601
  totalItems: number            // Total items in this session
  countedItems: number          // Items that have physicalQty
  varianceItems: number         // Items where physicalQty !== systemQty
  notes: string | null
}

// ════════════════════════════════════════════════════════════
// Dexie Database
// ════════════════════════════════════════════════════════════

class AetherDB extends Dexie {
  products!: EntityTable<OfflineProduct, 'id'>
  variants!: EntityTable<OfflineVariant, 'id'>
  inventoryItems!: EntityTable<OfflineInventoryItem, 'id'>
  inventoryBatches!: EntityTable<OfflineInventoryBatch, 'id'>
  customers!: EntityTable<OfflineCustomer, 'id'>
  suppliers!: EntityTable<OfflineSupplier, 'id'>
  purchases!: EntityTable<OfflinePurchase, 'id'>
  purchaseItems!: EntityTable<OfflinePurchaseItem, 'id'>
  transactions!: EntityTable<OfflineTransaction, 'id'>
  transactionItems!: EntityTable<OfflineTransactionItem, 'id'>
  inventoryMovements!: EntityTable<OfflineInventoryMovement, 'id'>
  batchConsumptionLogs!: EntityTable<OfflineBatchConsumptionLog, 'id'>
  syncQueue!: EntityTable<SyncQueueItem, 'id'>
  settings!: EntityTable<OfflineSetting, 'key'>
  metadata!: EntityTable<OfflineMetadata, 'key'>
  
  // ── Stock Opname (Transient Workspace) ──
  stockOpnameSnapshots!: EntityTable<StockOpnameSnapshot, 'id'>
  stockOpnameSession!: EntityTable<StockOpnameSession, 'id'>

  constructor() {
    super('aetherpos-offline')

    this.version(2).stores({
      // ── Master Data ──
      products:             'id, name, sku, barcode, categoryId, outletId, syncStatus, deletedAt',
      variants:             'id, productId, name, sku, barcode, outletId, syncStatus, deletedAt',
      inventoryItems:       'id, name, sku, categoryId, outletId, syncStatus, deletedAt',
      inventoryBatches:     'id, batchNumber, inventoryItemId, purchaseOrderId, status, outletId, syncStatus, deletedAt',
      customers:            'id, name, whatsapp, outletId, syncStatus, deletedAt',
      suppliers:            'id, name, outletId, syncStatus, deletedAt',

      // ── Events (event store — jangan sync stock, sync events) ──
      purchases:            'id, orderNumber, supplierId, outletId, syncStatus, deletedAt',
      purchaseItems:        'id, purchaseOrderId, inventoryItemId, outletId, syncStatus, deletedAt',
      transactions:         'id, invoiceNumber, customerId, outletId, userId, syncStatus, deletedAt',
      transactionItems:     'id, transactionId, productId, variantId, syncStatus, deletedAt',
      inventoryMovements:   'id, type, inventoryItemId, referenceId, referenceType, outletId, syncStatus, deletedAt',
      batchConsumptionLogs: 'id, transactionId, inventoryBatchId, inventoryItemId, outletId, syncStatus, deletedAt',

      // ── Sync Queue ⭐ ──
      syncQueue:            'id, entity, entityId, action, status, createdAt',

      // ── Settings & Metadata ──
      settings:             'key',
      metadata:             'key',

      // ── Stock Opname (Transient - NOT synced) ──
      stockOpnameSnapshots: 'id, inventoryItemId, batchId, itemName, isCounted, createdAt',
      stockOpnameSession:   'id, status',  // Singleton: id = 'current'
    })
  }
}

// ── Singleton ──
let _db: AetherDB | null = null

export function getAetherDB(): AetherDB {
  if (typeof window === 'undefined') {
    throw new Error('[AetherDB] Cannot access IndexedDB on server side')
  }
  if (!_db) {
    _db = new AetherDB()
  }
  return _db
}

export type AetherDBType = AetherDB