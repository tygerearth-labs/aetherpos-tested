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
import { syncOutbox } from './use-pos-checkout'

// ==================== TYPES ====================

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'failed' | 'conflict'

interface UsePosSyncOptions {
  onRefreshProducts?: () => void
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
  const { onRefreshProducts, onRefreshCustomers, onRefreshCategories } = options || {}

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

  // ── Time formatter ──
  const timeAgo = useCallback((ts: number | null): string | null => {
    if (!ts) return null
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 60) return 'baru'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m`
    const hrs = Math.floor(min / 60)
    if (hrs < 24) return `${hrs}j`
    return `${Math.floor(hrs / 24)}h`
  }, [])

  // ── Compute sync status from unsyncedCount + isOnline + syncing ──
  useEffect(() => {
    if (!isOnline) { setSyncStatus('offline'); return }
    if (syncing) { setSyncStatus('syncing'); return }
    if (unsyncedCount > 0) { setSyncStatus('failed'); return }
    setSyncStatus('synced')
  }, [isOnline, syncing, unsyncedCount])

  // ── Run sync (customerOutbox → resolve → transactionOutbox) ──
  const runSync = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (syncingRef.current) return { synced: 0, failed: 0 }
    syncingRef.current = true
    setSyncing(true)
    try {
      const result = await syncOutbox()
      setLastSyncAt(Date.now())
      if (result.synced > 0) {
        toast.success(`${result.synced} transaksi tersinkron`)
        onRefreshProducts?.()
        onRefreshCustomers?.()
      }
      if (result.failed > 0 && result.synced === 0) {
        toast.error(`${result.failed} transaksi gagal sync`, { description: 'Periksa koneksi atau stok.' })
      }
      // Broadcast to other tabs
      try { broadcastRef.current?.postMessage({ type: 'sync-complete', synced: result.synced }) } catch {}
      return result
    } catch {
      return { synced: 0, failed: 0 }
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [onRefreshProducts, onRefreshCustomers])

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
  useEffect(() => {
    const handleFocus = () => {
      if (navigator.onLine && !syncingRef.current) {
        // Lightweight: only sync if there are pending items
        const db = tryGetPosDB()
        if (db) {
          db.transactionOutbox.where('status').equals('PENDING').count().then(count => {
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
  useEffect(() => {
    const iv = setInterval(() => {
      if (navigator.onLine && !syncingRef.current) {
        const db = tryGetPosDB()
        if (db) {
          db.transactionOutbox.where('status').equals('PENDING').count().then(count => {
            if (count > 0) runSync()
          })
        }
      }
    }, 60_000)
    return () => clearInterval(iv)
  }, [runSync])

  // ── Initial sync on mount (if online + pending) ──
  useEffect(() => {
    if (navigator.onLine) {
      const db = tryGetPosDB()
      if (db) {
        db.transactionOutbox.where('status').equals('PENDING').count().then(count => {
          if (count > 0) setTimeout(() => runSync(), 1000)
        })
      }
    }
  }, [runSync])

  // ── Manual sync handler ──
  const handleSync = useCallback(async () => {
    if (!navigator.onLine) { toast.info('Tidak ada koneksi internet'); return }
    if (unsyncedCount === 0) { toast.info('Tidak ada transaksi pending'); return }
    await runSync()
  }, [unsyncedCount, runSync])

  return {
    isOnline, syncing, syncStatus, unsyncedCount,
    pendingListOpen, offlineListOpen, lastSyncAt,
    setPendingListOpen, setOfflineListOpen, handleSync, timeAgo,
  }
}
