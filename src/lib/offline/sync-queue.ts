/**
 * sync-queue.ts — Sync Queue Operations
 *
 * Jantung Sync Engine. Setiap write ke Dexie → enqueue ke syncQueue.
 * Saat online, sync worker upload queue ke server.
 */

import { getAetherDB, type SyncQueueItem, type SyncAction, type SyncQueueStatus } from './aether-db'

// ════════════════════════════════════════════════════════════
// Enqueue
// ════════════════════════════════════════════════════════════

export async function syncEnqueue(
  entity: string,
  entityId: string,
  action: SyncAction,
  payload: Record<string, unknown>
): Promise<SyncQueueItem> {
  const db = getAetherDB()
  const now = new Date().toISOString()

  const item: SyncQueueItem = {
    id: crypto.randomUUID(),    // Queue item ID (bukan entity ID)
    entity,
    entityId,
    action,
    payload: JSON.stringify(payload),
    status: 'PENDING',
    retryCount: 0,
    errorMessage: null,
    createdAt: now,
    syncedAt: null,
  }

  await db.syncQueue.add(item)
  return item
}

/**
 * Batch enqueue — untuk transaction atomic (1 transaksi = banyak items).
 * Semua queue items di-create dalam 1 Dexie transaction.
 */
export async function syncEnqueueBatch(
  entries: Array<{ entity: string; entityId: string; action: SyncAction; payload: Record<string, unknown> }>
): Promise<void> {
  const db = getAetherDB()
  const now = new Date().toISOString()

  const items: SyncQueueItem[] = entries.map(e => ({
    id: crypto.randomUUID(),
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    payload: JSON.stringify(e.payload),
    status: 'PENDING' as SyncQueueStatus,
    retryCount: 0,
    errorMessage: null,
    createdAt: now,
    syncedAt: null,
  }))

  await db.syncQueue.bulkAdd(items)
}

// ════════════════════════════════════════════════════════════
// Mark Status
// ════════════════════════════════════════════════════════════

export async function syncMarkSyncing(id: string): Promise<void> {
  const db = getAetherDB()
  await db.syncQueue.update(id, { status: 'SYNCING' })
}

export async function syncMarkSynced(id: string): Promise<void> {
  const db = getAetherDB()
  await db.syncQueue.update(id, {
    status: 'SYNCED',
    syncedAt: new Date().toISOString(),
  })
}

export async function syncMarkFailed(id: string, errorMessage: string): Promise<void> {
  const db = getAetherDB()
  await db.syncQueue.update(id, {
    status: 'FAILED',
    retryCount: 0,   // will be incremented by getPending
    errorMessage,
  })
}

// ════════════════════════════════════════════════════════════
// Get Pending Items
// ════════════════════════════════════════════════════════════

const MAX_RETRY = 5

export interface PendingSyncItem extends SyncQueueItem {
  _retryCount: number
}

/**
 * Ambil item PENDING atau FAILED (yang belum max retry).
 * Items di-sort by createdAt (FIFO — respect event order).
 */
export async function syncGetPending(limit = 50): Promise<SyncQueueItem[]> {
  const db = getAetherDB()

  const items = await db.syncQueue
    .where('status')
    .anyOf(['PENDING', 'FAILED'])
    .filter(item => {
      if (item.status === 'FAILED' && item.retryCount >= MAX_RETRY) {
        return false  // Skip items yang sudah max retry
      }
      return true
    })
    .sortBy('createdAt')

  return items.slice(0, limit)
}

// ════════════════════════════════════════════════════════════
// Increment Retry
// ════════════════════════════════════════════════════════════

export async function syncIncrementRetry(id: string, errorMessage: string): Promise<void> {
  const db = getAetherDB()
  const item = await db.syncQueue.get(id)
  if (!item) return

  const newRetryCount = item.retryCount + 1
  await db.syncQueue.update(id, {
    retryCount: newRetryCount,
    status: newRetryCount >= MAX_RETRY ? 'FAILED' : 'PENDING',
    errorMessage,
  })
}

// ════════════════════════════════════════════════════════════
// Cleanup & Stats
// ════════════════════════════════════════════════════════════

/** Hapus semua item yang sudah SYNCED (lebih dari N menit lalu) */
export async function syncCleanupSynced(olderThanMinutes = 30): Promise<number> {
  const db = getAetherDB()
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()

  const toDelete = await db.syncQueue
    .where('status')
    .equals('SYNCED')
    .filter(item => (item.syncedAt ?? '') < cutoff)
    .toArray()

  if (toDelete.length === 0) return 0

  await db.syncQueue.bulkDelete(toDelete.map(i => i.id))
  return toDelete.length
}

/** Stats untuk debugging */
export async function syncGetStats(): Promise<{
  pending: number
  syncing: number
  synced: number
  failed: number
  failedPermanent: number  // max retry exceeded
}> {
  const db = getAetherDB()
  const all = await db.syncQueue.toArray()

  return {
    pending: all.filter(i => i.status === 'PENDING').length,
    syncing: all.filter(i => i.status === 'SYNCING').length,
    synced: all.filter(i => i.status === 'SYNCED').length,
    failed: all.filter(i => i.status === 'FAILED' && i.retryCount < MAX_RETRY).length,
    failedPermanent: all.filter(i => i.status === 'FAILED' && i.retryCount >= MAX_RETRY).length,
  }
}

/** Hapus semua item di queue (untuk reset/debug) */
export async function syncClearAll(): Promise<void> {
  const db = getAetherDB()
  await db.syncQueue.clear()
}