/**
 * offline/index.ts — Barrel export untuk module offline.
 *
 * Usage:
 *   import { getAetherDB, productsRepo, syncEnqueue } from '@/lib/offline'
 */

// ── Database ──
export { getAetherDB } from './aether-db'
export type { AetherDBType } from './aether-db'

// ── Types ──
export type {
  SyncStatus,
  SyncAction,
  SyncQueueStatus,
  OfflineRecord,
  OfflineProduct,
  OfflineVariant,
  OfflineInventoryItem,
  OfflineInventoryBatch,
  OfflineCustomer,
  OfflineSupplier,
  OfflinePurchase,
  OfflinePurchaseItem,
  OfflineTransaction,
  OfflineTransactionItem,
  OfflineInventoryMovement,
  OfflineBatchConsumptionLog,
  SyncQueueItem,
  OfflineSetting,
  OfflineMetadata,
} from './aether-db'

// ── Repository ──
export { OfflineRepo } from './repository'
export {
  productsRepo,
  variantsRepo,
  inventoryItemsRepo,
  inventoryBatchesRepo,
  customersRepo,
  suppliersRepo,
  purchasesRepo,
  purchaseItemsRepo,
  transactionsRepo,
  transactionItemsRepo,
  inventoryMovementsRepo,
  batchConsumptionLogsRepo,
} from './repository'

// ── Sync Queue ──
export {
  syncEnqueue,
  syncEnqueueBatch,
  syncMarkSyncing,
  syncMarkSynced,
  syncMarkFailed,
  syncGetPending,
  syncIncrementRetry,
  syncCleanupSynced,
  syncGetStats,
  syncClearAll,
} from './sync-queue'
export type { PendingSyncItem } from './sync-queue'

// ── Engines ──
export { OfflineFEFO } from './fefo-engine'
export type { BatchConsumptionResult, BatchRestorationResult } from './fefo-engine'

export { OfflineTransactionEngine } from './transaction-engine'

export { OfflinePurchaseEngine } from './purchase-engine'