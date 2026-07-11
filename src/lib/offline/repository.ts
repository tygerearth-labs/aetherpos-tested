/**
 * repository.ts — Base Repository untuk Dexie CRUD
 *
 * Setiap write otomatis:
 *   1. Set syncStatus = PENDING
 *   2. Increment version
 *   3. Update updatedAt
 *   4. Push ke syncQueue
 *
 * Soft delete: set deletedAt, bukan hapus dari Dexie.
 */

import { getAetherDB, type OfflineRecord, type SyncStatus } from './aether-db'
import { syncEnqueue } from './sync-queue'
import type { EntityTable } from 'dexie'

// ════════════════════════════════════════════════════════════
// Entity name map
// ════════════════════════════════════════════════════════════

type TableName =
  | 'products' | 'variants' | 'inventoryItems' | 'inventoryBatches'
  | 'customers' | 'suppliers' | 'purchases' | 'purchaseItems'
  | 'transactions' | 'transactionItems' | 'inventoryMovements'
  | 'batchConsumptionLogs'

// ════════════════════════════════════════════════════════════
// Repository Options
// ════════════════════════════════════════════════════════════

interface RepoOptions<T extends OfflineRecord> {
  /** Nama table (harus match Dexie table key) */
  tableName: TableName
  /** Default values untuk field selain OfflineRecord */
  defaults?: Partial<Omit<T, keyof OfflineRecord>>
  /** Skip syncQueue enqueue (untuk initial data pull dari server) */
  skipSync?: boolean
}

// ════════════════════════════════════════════════════════════
// Base Repository
// ════════════════════════════════════════════════════════════

export class OfflineRepo<T extends OfflineRecord> {
  protected tableName: TableName
  protected defaults: Partial<Omit<T, keyof OfflineRecord>>
  private skipSyncDefault: boolean

  constructor(opts: RepoOptions<T>) {
    this.tableName = opts.tableName
    this.defaults = opts.defaults ?? {}
    this.skipSyncDefault = opts.skipSync ?? false
  }

  // ── Table accessor ──
  protected get table(): EntityTable<T, 'id'> {
    const db = getAetherDB()
    return db[this.tableName] as unknown as EntityTable<T, 'id'>
  }

  // ══════════════════════════════════════════════════════════
  // Read
  // ══════════════════════════════════════════════════════════

  async getById(id: string): Promise<T | undefined> {
    const item = await this.table.get(id)
    // Soft delete filter
    if (item && item.deletedAt) return undefined
    return item
  }

  async getAll(): Promise<T[]> {
    return this.table.filter(item => !item.deletedAt).toArray()
  }

  async getWhere(predicate: (item: T) => boolean): Promise<T[]> {
    return this.table.filter(item => !item.deletedAt && predicate(item)).toArray()
  }

  async count(): Promise<number> {
    return this.table.filter(item => !item.deletedAt).count()
  }

  async getBySyncStatus(status: SyncStatus): Promise<T[]> {
    return this.table.where('syncStatus').equals(status).toArray()
  }

  /** Include soft-deleted items (untuk sync engine) */
  async getAllWithDeleted(): Promise<T[]> {
    return this.table.toArray()
  }

  // ══════════════════════════════════════════════════════════
  // Write
  // ══════════════════════════════════════════════════════════

  /**
   * Create — insert record baru.
   * Jika record sudah ada (same id), akan update.
   */
  async create(data: Omit<T, keyof OfflineRecord> & Partial<OfflineRecord>, opts?: { skipSync?: boolean }): Promise<T> {
    const now = new Date().toISOString()

    const record: T = {
      ...this.defaults,
      ...data,
      syncStatus: (data as Partial<OfflineRecord>).syncStatus ?? 'PENDING',
      version: ((data as Partial<OfflineRecord>).version ?? 0) + 1,
      updatedAt: now,
      createdAt: (data as Partial<OfflineRecord>).createdAt ?? now,
      deletedAt: null,
    } as T

    const db = getAetherDB()

    // Check if exists (for idempotent create)
    const existing = await this.table.get(record.id)
    const action = existing ? 'UPDATE' : 'CREATE'

    // Use Dexie transaction: put record + enqueue sync
    await db.transaction('rw', [this.tableName, 'syncQueue'], async () => {
      await this.table.put(record)

      if (!(opts?.skipSync ?? this.skipSyncDefault)) {
        await syncEnqueue(
          this.tableName,
          record.id,
          action as 'CREATE' | 'UPDATE',
          record as unknown as Record<string, unknown>
        )
      }
    })

    return record
  }

  /**
   * Update — update record yang sudah ada.
   * Increment version, set PENDING.
   */
  async update(id: string, changes: Partial<Omit<T, 'id' | 'createdAt'>>, opts?: { skipSync?: boolean }): Promise<T | undefined> {
    const existing = await this.table.get(id)
    if (!existing) return undefined
    if (existing.deletedAt) return undefined  // Can't update soft-deleted

    const now = new Date().toISOString()
    const updated: T = {
      ...existing,
      ...changes,
      id: existing.id,
      createdAt: existing.createdAt,
      syncStatus: 'PENDING',
      version: existing.version + 1,
      updatedAt: now,
      deletedAt: null,
    }

    const db = getAetherDB()

    await db.transaction('rw', [this.tableName, 'syncQueue'], async () => {
      await this.table.put(updated)

      if (!(opts?.skipSync ?? this.skipSyncDefault)) {
        await syncEnqueue(
          this.tableName,
          id,
          'UPDATE',
          updated as unknown as Record<string, unknown>
        )
      }
    })

    return updated
  }

  // ══════════════════════════════════════════════════════════
  // Soft Delete
  // ══════════════════════════════════════════════════════════

  /**
   * Soft delete — set deletedAt.
   * Record tetap ada di Dexie sampai server konfirmasi.
   */
  async softDelete(id: string, opts?: { skipSync?: boolean }): Promise<boolean> {
    const existing = await this.table.get(id)
    if (!existing) return false
    if (existing.deletedAt) return false  // Already deleted

    const now = new Date().toISOString()
    const deleted: T = {
      ...existing,
      deletedAt: now,
      updatedAt: now,
      syncStatus: 'PENDING',
      version: existing.version + 1,
    }

    const db = getAetherDB()

    await db.transaction('rw', [this.tableName, 'syncQueue'], async () => {
      await this.table.put(deleted)

      if (!(opts?.skipSync ?? this.skipSyncDefault)) {
        await syncEnqueue(
          this.tableName,
          id,
          'DELETE',
          { id, deletedAt: now } as unknown as Record<string, unknown>
        )
      }
    })

    return true
  }

  /**
   * Hard delete — benar-benar hapus dari Dexie.
   * Hanya dipakai setelah server konfirmasi DELETE berhasil.
   */
  async hardDelete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  // ══════════════════════════════════════════════════════════
  // Sync Helpers
  // ══════════════════════════════════════════════════════════

  /** Mark record as SYNCED setelah server konfirmasi */
  async markSynced(id: string): Promise<void> {
    await this.table.update(id, { syncStatus: 'SYNCED' as SyncStatus })
  }

  /** Mark record as FAILED setelah sync gagal */
  async markFailed(id: string): Promise<void> {
    await this.table.update(id, { syncStatus: 'FAILED' as SyncStatus })
  }

  /**
   * Pull dari server — bulk put dengan skipSync.
   * Dipakai saat initial data load / sync download.
   */
  async pullFromServer(items: T[]): Promise<void> {
    const db = getAetherDB()
    await db.transaction('rw', [this.tableName], async () => {
      await this.table.bulkPut(items)
    })
  }

  /**
   * Clear seluruh table (untuk reset / re-pull).
   */
  async clear(): Promise<void> {
    await this.table.clear()
  }
}

// ════════════════════════════════════════════════════════════
// Convenience: Create typed repos
// ════════════════════════════════════════════════════════════

import type {
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
} from './aether-db'

// Singleton repos — bisa juga di-create per-component jika perlu
let _repos: Record<string, OfflineRepo<OfflineRecord>> | null = null

function getOrCreateRepo<T extends OfflineRecord>(opts: RepoOptions<T>): OfflineRepo<T> {
  if (!_repos) _repos = {}
  if (!_repos[opts.tableName]) {
    _repos[opts.tableName] = new OfflineRepo<T>(opts) as unknown as OfflineRepo<OfflineRecord>
  }
  return _repos[opts.tableName] as unknown as OfflineRepo<T>
}

export function productsRepo() {
  return getOrCreateRepo<OfflineProduct>({ tableName: 'products' })
}
export function variantsRepo() {
  return getOrCreateRepo<OfflineVariant>({ tableName: 'variants' })
}
export function inventoryItemsRepo() {
  return getOrCreateRepo<OfflineInventoryItem>({ tableName: 'inventoryItems' })
}
export function inventoryBatchesRepo() {
  return getOrCreateRepo<OfflineInventoryBatch>({ tableName: 'inventoryBatches' })
}
export function customersRepo() {
  return getOrCreateRepo<OfflineCustomer>({ tableName: 'customers' })
}
export function suppliersRepo() {
  return getOrCreateRepo<OfflineSupplier>({ tableName: 'suppliers' })
}
export function purchasesRepo() {
  return getOrCreateRepo<OfflinePurchase>({ tableName: 'purchases' })
}
export function purchaseItemsRepo() {
  return getOrCreateRepo<OfflinePurchaseItem>({ tableName: 'purchaseItems' })
}
export function transactionsRepo() {
  return getOrCreateRepo<OfflineTransaction>({ tableName: 'transactions' })
}
export function transactionItemsRepo() {
  return getOrCreateRepo<OfflineTransactionItem>({ tableName: 'transactionItems' })
}
export function inventoryMovementsRepo() {
  return getOrCreateRepo<OfflineInventoryMovement>({ tableName: 'inventoryMovements' })
}
export function batchConsumptionLogsRepo() {
  return getOrCreateRepo<OfflineBatchConsumptionLog>({ tableName: 'batchConsumptionLogs' })
}