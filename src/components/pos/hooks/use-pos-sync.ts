/**
 * usePosSync() — Online/offline detection, outbox sync, sync triggers, and
 * sync status for the POS sync button.
 *
 * PR 3 — Offline POS with Dexie:
 *   Sync triggers:
 *     - reconnect (window 'online' event)
 *     - window focus
 *     - BroadcastChannel (cross-tab)
 *     - manual sync
 *     - lightweight status check (periodic)
 *   Sync button states: Synced | Syncing | Offline | Failed | Conflict
 *   Safety:
 *     - never clear Dexie before successful response
 *     - failed sync preserves cache + outbox (retryCount++)
 *     - sync retry is duplicate-safe (eventId idempotency, DEX-007)
 *
 * @boundary COCKPIT only — no engine imports
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useLiveQuery } from 'dexie-react-hooks'
import { tryGetPosDB } from '@/lib/pos/pos-db'
import { syncOutboxTracked } from './use-pos-checkout'

// ==================== TYPES ====================

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'failed' | 'conflict'

interface UsePosSyncOptions {
  onRefreshProducts?: () => void
  /** Patch React product-grid state from updatedStock (no refetch). See
   *  use-pos-products.patchProductStock for details. */
  onPatchProductStock?: (stock: { products: Record<string, number>; variants: Record<string, number> }) => void
  onRefreshCustomers?: () => void
  onRefreshCategories?: () => void
}

interface UsePosSyncReturn {
  isOnline: boolean
  syncing: boolean
  syncStatus: SyncStatus
  unsyncedCount: number
  pendingListOpen: boolean
  offlineListOpen: boolean
  lastSyncAt: number | null
  setPendingListOpen: (open: boolean) => void
  setOfflineListOpen: (open: boolean) => void
  handleSync: () => Promise<void>
  timeAgo: (ts: number | null) => string | null
}

// ==================== HOOK IMPLEMENTATION ====================

export function usePosSync(options?: UsePosSyncOptions): UsePosSyncReturn {
  const { onRefreshProducts, onPatchProductStock, onRefreshCustomers, onRefreshCategories } = options || {}

  const [isOnline, setIsOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced')
  const [pendingListOpen, setPendingListOpen] = useState(false)
  const [offlineListOpen, setOfflineListOpen] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)

  const syncingRef = useRef(false)
  const broadcastRef = useRef<BroadcastChannel | null>(null)

  // ── Live query for unsynced outbox count (transactionOutbox PENDING/FAILED) ──
  const unsyncedCount = useLiveQuery(async () => {
    const db = tryGetPosDB()
    if (!db) return 0
    const pending = await db.transactionOutbox.where('status').equals('PENDING').count()
    const failed = await db.transactionOutbox.where('status').equals('FAILED').count()
    return pending + failed
  }, []) ?? 0

  // ── Time formatter (full readable Indonesian) ──
  const timeAgo = useCallback((ts: number | null): string | null => {
    if (!ts) return null
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 60) return 'Baru saja'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min} menit lalu`
    const hrs = Math.floor(min / 60)
    if (hrs < 24) return `${hrs} jam lalu`
    return `${Math.floor(hrs / 24)} hari lalu`
  }, [])

  // ── Compute sync status from unsyncedCount + isOnline + syncing ──
  useEffect(() => {
    if (!isOnline) { setSyncStatus('offline'); return }
    if (syncing) { setSyncStatus('syncing'); return }
    if (unsyncedCount > 0) { setSyncStatus('failed'); return }
    setSyncStatus('synced')
  }, [isOnline, syncing, unsyncedCount])

  // ── Run sync (customerOutbox → resolve → transactionOutbox) ──
  //
  // OUTBOX CONTRADICTION FIX (toast discipline):
  //   - Success is SILENT when this run JOINED an in-flight sync that the
  //     checkout started (initiated === false). The checkout shows its own
  //     "Pembayaran berhasil" toast; a redundant "N tersinkron" would confuse.
  //   - Duplicate resolutions (DEX-007) are ALWAYS silent — they are background
  //     confirmations of already-committed transactions, not new events.
  //   - Genuine failures (failed > 0) always surface so the cashier can act.
  //   - Abandoned rows (exceeded retry cap) always surface as a warning.
  const runSync = useCallback(async (): Promise<{ synced: number; failed: number; duplicateResolved: number; abandoned: number }> => {
    if (syncingRef.current) return { synced: 0, failed: 0, duplicateResolved: 0, abandoned: 0 }
    syncingRef.current = true
    setSyncing(true)
    try {
      const { result, initiated } = await syncOutboxTracked()
      setLastSyncAt(Date.now())
      // Success toast: only when THIS call initiated the sync AND there were
      // genuinely new syncs (not just duplicate resolutions). Duplicates are
      // silent per the outbox contradiction fix.
      // PHASE 2 OPTIMIZATION (rule 10): When the sync response included
      // updatedStock and the Dexie cache was patched, also patch the React
      // product-grid state (no network refetch). Only fall back to a full
      // refetch when the patch didn't apply (threw, or no stock payload).
      const patchReactState = () => {
        if (result.stockUpdateSource === 'patched' && result.mergedStock) {
          onPatchProductStock?.(result.mergedStock)
        } else if (result.stockUpdateSource === 'refetched') {
          onRefreshProducts?.()
        }
        // 'skipped' → no product refresh needed (no stock changes)
      }
      if (initiated && result.synced > 0 && result.synced > result.duplicateResolved) {
        toast.success(`${result.synced} transaksi tersinkron`)
        patchReactState()
        onRefreshCustomers?.()
      } else if (initiated && result.synced > 0) {
        // All synced rows were duplicate resolutions — refresh data but stay silent.
        patchReactState()
        onRefreshCustomers?.()
      }
      if (result.abandoned > 0) {
        toast.warning(
          `${result.abandoned} transaksi ditinggalkan`,
          { description: `Melebihi batas retry — periksa manual di outbox.` },
        )
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} transaksi gagal sync`, { description: 'Periksa koneksi atau stok.' })
      }
      // Broadcast to other tabs
      try { broadcastRef.current?.postMessage({ type: 'sync-complete', synced: result.synced }) } catch {}
      return result
    } catch {
      return { synced: 0, failed: 0, duplicateResolved: 0, abandoned: 0 }
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [onRefreshProducts, onPatchProductStock, onRefreshCustomers])

  // ── Online/offline detection ──
  useEffect(() => {
    setIsOnline(navigator.onLine)
    const handleOnline = () => {
      setIsOnline(true)
      // PR 3: auto-sync on reconnect
      setTimeout(() => { runSync() }, 500)
    }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [runSync])

  // ── PR 3: Window focus trigger ──
  // UX FIX 2026-07-24: also trigger when there are FAILED rows (below retry
  // cap) so stale entries can resolve via DEX-007 on focus.
  useEffect(() => {
    const handleFocus = () => {
      if (navigator.onLine && !syncingRef.current) {
        const db = tryGetPosDB()
        if (db) {
          db.transactionOutbox.where('status').anyOf('PENDING', 'FAILED').count().then(count => {
            if (count > 0) runSync()
          })
        }
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [runSync])

  // ── PR 3: BroadcastChannel (cross-tab sync trigger) ──
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel('aetherpos-sync')
    broadcastRef.current = bc
    bc.onmessage = (e) => {
      if (e.data?.type === 'sync-complete' && navigator.onLine) {
        onRefreshProducts?.()
        onRefreshCustomers?.()
      }
      if (e.data?.type === 'sync-request' && navigator.onLine && !syncingRef.current) {
        runSync()
      }
    }
    return () => { bc.close(); broadcastRef.current = null }
  }, [runSync, onRefreshProducts, onRefreshCustomers])

  // ── PR 3: Lightweight periodic status check (every 60s) ──
  // UX FIX 2026-07-24: also check FAILED rows so they auto-retry.
  useEffect(() => {
    const iv = setInterval(() => {
      if (navigator.onLine && !syncingRef.current) {
        const db = tryGetPosDB()
        if (db) {
          db.transactionOutbox.where('status').anyOf('PENDING', 'FAILED').count().then(count => {
            if (count > 0) runSync()
          })
        }
      }
    }, 60_000)
    return () => clearInterval(iv)
  }, [runSync])

  // ── Initial sync on mount (if online + retryable) ──
  // UX FIX 2026-07-24: also fire when there are FAILED rows so stale entries
  // from a prior session can resolve via DEX-007 immediately on page load.
  useEffect(() => {
    if (navigator.onLine) {
      const db = tryGetPosDB()
      if (db) {
        db.transactionOutbox.where('status').anyOf('PENDING', 'FAILED').count().then(count => {
          if (count > 0) setTimeout(() => runSync(), 1000)
        })
      }
    }
  }, [runSync])

  // ── Manual sync handler ──
  // When there are pending/failed outbox rows, push them.
  // When there's nothing to push, treat the click as a manual refresh:
  // pull fresh products/customers/categories from server + update
  // lastSyncAt so the "Terakhir sync" label reflects the user's action.
  const handleSync = useCallback(async () => {
    if (!navigator.onLine) { toast.info('Tidak ada koneksi internet'); return }
    if (unsyncedCount === 0) {
      // Nothing to push — refresh local cache from server + stamp timestamp.
      setLastSyncAt(Date.now())
      onRefreshProducts?.()
      onRefreshCustomers?.()
      onRefreshCategories?.()
      broadcastRef.current?.postMessage({ type: 'sync-complete' })
      toast.success('Data diperbarui')
      return
    }
    await runSync()
  }, [unsyncedCount, runSync, onRefreshProducts, onRefreshCustomers, onRefreshCategories])

  return {
    isOnline, syncing, syncStatus, unsyncedCount,
    pendingListOpen, offlineListOpen, lastSyncAt,
    setPendingListOpen, setOfflineListOpen, handleSync, timeAgo,
  }
}
