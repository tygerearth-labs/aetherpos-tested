'use client'

/**
 * useOutboxPending — reactive boolean indicating whether the Dexie
 * `syncQueue` table (in aether-db.ts) has any PENDING or FAILED rows.
 *
 * Used by the build-version-guard critical-activity registry to register
 * an `outbox-sync` activity so a build update / hard reload warns the
 * user that local transactions have not yet been synced to the server.
 *
 * SSR-safe: returns 0 when IndexedDB is unavailable (SSR, blocked, or
 * the AetherDB hasn't been initialized yet).
 *
 * NOTE: This watches the GLOBAL sync queue (`aetherpos-offline.syncQueue`),
 * not the POS-only `transactionOutbox` table in pos-db.ts. The POS
 * transactionOutbox has its own live count in `usePosSync().unsyncedCount`.
 */

import { useLiveQuery } from 'dexie-react-hooks'

/**
 * @returns the count of PENDING/FAILED rows in the global syncQueue, or 0
 *          if Dexie is unavailable.
 */
export function useOutboxPending(): number {
  const count = useLiveQuery(async () => {
    if (typeof window === 'undefined') return 0
    // Lazy import so SSR doesn't try to touch IndexedDB at module load.
    const { getAetherDB } = await import('@/lib/offline/aether-db')
    let db
    try {
      db = getAetherDB()
    } catch {
      return 0
    }
    if (!db) return 0
    const pending = await db.syncQueue.where('status').equals('PENDING').count()
    const failed = await db.syncQueue.where('status').equals('FAILED').count()
    return pending + failed
  }, [])
  return count ?? 0
}
