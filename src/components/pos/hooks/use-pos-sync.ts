/**
 * usePosSync() — Online/offline detection, sync queue management, auto-sync,
 * manual sync, and data freshness tracking for POS.
 *
 * Extracted from pos-page.tsx Phase 1A modularization.
 * Original lines: 194-199 (sync states), 202-224 (time helpers + stale tick),
 *                 632-644 (online/offline detection), 646-650 (unsynced count),
 *                 652-717 (auto-sync effect), 719-753 (initial sync),
 *                 1504-1550 (handleSync), 576-578 (panel states)
 *
 * @phase 1A — Move code without changing meaning
 * @boundary COCKPIT only — no engine imports
 * @preserve BUG-04 (sync race condition) will be fixed in Phase 1B
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB } from '@/lib/local-db'
import { syncAllData, getAllSyncTimes, syncSettingsFromServer } from '@/lib/sync-service'

// ==================== INTERFACES ====================

interface SyncTimes {
  products: number | null
  categories: number | null
  customers: number | null
  promos: number | null
}

// ==================== HOOK OPTIONS ====================

interface UsePosSyncOptions {
  /** Callbacks for refreshing data after sync (from other hooks) */
  onRefreshProducts?: () => void
  onRefreshCustomers?: () => void
  onRefreshCategories?: () => void
}

// ==================== HOOK RETURN ====================

interface UsePosSyncReturn {
  // State
  isOnline: boolean
  syncing: boolean
  dataSyncing: boolean
  lastSyncTimes: SyncTimes
  unsyncedCount: number
  pendingListOpen: boolean
  offlineListOpen: boolean

  // Derived
  isSyncStale: boolean
  syncAgeSec: number

  // Refs (exposed for coordination with checkout)
  syncingRef: React.RefObject<boolean>
  checkoutSyncRef: React.RefObject<boolean>
  initialSyncDone: React.RefObject<boolean>

  // Actions
  setPendingListOpen: (open: boolean) => void
  setOfflineListOpen: (open: boolean) => void
  handleSync: () => Promise<void>
  timeAgo: (ts: number | null) => string | null
}

// ==================== HOOK IMPLEMENTATION ====================

export function usePosSync(options?: UsePosSyncOptions): UsePosSyncReturn {
  const { onRefreshProducts, onRefreshCustomers, onRefreshCategories } = options || {}

  // ── Core State (originally lines 194-199, 576-578) ──
  const [isOnline, setIsOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [dataSyncing, setDataSyncing] = useState(false)
  const [lastSyncTimes, setLastSyncTimes] = useState<SyncTimes>({ products: null, categories: null, customers: null, promos: null })
  const [syncAgeSec, setSyncAgeSec] = useState(0)
  const [pendingListOpen, setPendingListOpen] = useState(false)
  const [offlineListOpen, setOfflineListOpen] = useState(false)

  // ── Refs for coordination (originally lines 187-189) ──
  const syncingRef = useRef(false)
  const checkoutSyncRef = useRef(false)
  const initialSyncDone = useRef(false)

  // ── Relative time formatter (originally lines 202-212) ──
  const timeAgo = useCallback((ts: number | null): string | null => {
    if (!ts) return null
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 60) return 'baru'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m`
    const hrs = Math.floor(min / 60)
    if (hrs < 24) return `${hrs}j`
    const days = Math.floor(hrs / 24)
    return `${days}h`
  }, [])

  // ── Whether product sync is considered stale (> 10 min) (originally lines 215-218) ──
  const isSyncStale = !lastSyncTimes.products || dataSyncing
    ? false
    : (Date.now() - lastSyncTimes.products) > 10 * 60 * 1000

  // ── Tick every 30s to recompute stale state (originally lines 221-224) ──
  useEffect(() => {
    const iv = setInterval(() => setSyncAgeSec(s => s + 1), 30_000)
    return () => clearInterval(iv)
  }, [])

  // ── Online/offline detection (originally lines 632-644) ──
  useEffect(() => {
    setIsOnline(navigator.onLine)
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // ── Live query for unsynced transactions (originally lines 646-650) ──
  const unsyncedCount = useLiveQuery(
    () => localDB.transactions.where('isSynced').equals(0).count(),
    []
  ) ?? 0

  // ── Auto-sync when coming back online (originally lines 652-717) ──
  // NOTE: BUG-04 (race condition between auto-sync and manual sync) preserved as-is
  //       Will be fixed in Phase 1B
  useEffect(() => {
    if (isOnline && initialSyncDone.current && !syncingRef.current && !checkoutSyncRef.current) {
      syncingRef.current = true
      const timer = setTimeout(async () => {
        try {
          const pending = await localDB.transactions.where('isSynced').equals(0).toArray()
          if (pending.length > 0) {
            const res = await fetch('/api/transactions/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transactions: pending }),
            })
            const data = await res.json()
            if (res.ok) {
              let synced = 0
              for (const result of data.results || []) {
                if (result.success) {
                  await localDB.transactions.update(result.localId, {
                    isSynced: 1,
                    syncedAt: Date.now(),
                    invoiceNumber: result.invoiceNumber,
                    serverTransactionId: result.serverId,
                  })
                  synced++
                } else {
                  const existing = await localDB.transactions.get(result.localId)
                  await localDB.transactions.update(result.localId, {
                    retryCount: (existing?.retryCount || 0) + 1,
                    lastError: result.error,
                  })
                }
              }
              if (synced > 0) {
                toast.success(`${synced} transaction(s) auto-synced!`)
                onRefreshProducts?.()
                onRefreshCustomers?.()
              }
              if (data.failed > 0) {
                toast.warning(`${data.failed} transaksi gagal sync`, { description: 'Buka menu "Offline" untuk detail.' })
              }
            }
          }

          setDataSyncing(true)
          const result = await syncAllData()
          syncSettingsFromServer() // cache settings for offline (fire-and-forget)
          onRefreshProducts?.()
          onRefreshCategories?.()
          onRefreshCustomers?.()
          const times = await getAllSyncTimes()
          setLastSyncTimes(times)
          setSyncAgeSec(0)
          setDataSyncing(false)
        } catch {
          setDataSyncing(false)
        } finally {
          syncingRef.current = false
        }
      }, 2000)
      return () => { clearTimeout(timer); syncingRef.current = false }
    }
  }, [isOnline, onRefreshProducts, onRefreshCustomers, onRefreshCategories])

  // ── Initial sync on mount (originally lines 719-753) ──
  useEffect(() => {
    if (isOnline && !initialSyncDone.current) {
      initialSyncDone.current = true
      const doInitialSync = async () => {
        setDataSyncing(true)
        try {
          const result = await syncAllData()
          syncSettingsFromServer() // cache settings for offline (fire-and-forget)
          onRefreshProducts?.()
          onRefreshCategories?.()
          onRefreshCustomers?.()
          const times = await getAllSyncTimes()
          setLastSyncTimes(times)
          setSyncAgeSec(0)
          if (result.products.count > 0 || result.customers.count > 0) {
            toast.success(`Data synced: ${result.products.count} produk, ${result.categories.count} kategori, ${result.customers.count} customer`)
          }
        } catch {
          onRefreshProducts?.()
          onRefreshCategories?.()
          onRefreshCustomers?.()
        } finally {
          setDataSyncing(false)
        }
      }
      doInitialSync()
    } else if (!isOnline && !initialSyncDone.current) {
      initialSyncDone.current = true
      onRefreshProducts?.()
      onRefreshCategories?.()
      onRefreshCustomers?.()
      getAllSyncTimes().then(setLastSyncTimes)
    }
  }, [isOnline, onRefreshProducts, onRefreshCategories, onRefreshCustomers])

  // ── Manual sync handler (originally lines 1506-1550) ──
  // NOTE: BUG-04 preserved — uses separate `syncing` state instead of `syncingRef`
  const handleSync = useCallback(async () => {
    if (syncing || unsyncedCount === 0) return
    setSyncing(true)
    try {
      const pending = await localDB.transactions.where('isSynced').equals(0).toArray()
      if (pending.length === 0) { toast.info('Tidak ada transaksi pending'); return }

      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: pending }),
      })
      const data = await res.json()

      if (res.ok) {
        for (const result of data.results || []) {
          if (result.success) {
            await localDB.transactions.update(result.localId, {
              isSynced: 1, syncedAt: Date.now(),
              invoiceNumber: result.invoiceNumber, serverTransactionId: result.serverId,
            })
          } else {
            const existing = await localDB.transactions.get(result.localId)
            await localDB.transactions.update(result.localId, {
              retryCount: (existing?.retryCount || 0) + 1, lastError: result.error,
            })
          }
        }
        if (data.synced > 0) {
          toast.success(`${data.synced} transaksi berhasil disync!`)
          onRefreshProducts?.()
          onRefreshCustomers?.()
        }
        if (data.failed > 0) {
          toast.error(`${data.failed} transaksi gagal sync`, { description: 'Periksa stok produk.' })
        }
      } else {
        toast.error('Sync gagal — server error')
      }
    } catch {
      toast.error('Sync gagal — tidak ada koneksi internet')
    } finally {
      setSyncing(false)
    }
  }, [syncing, unsyncedCount, onRefreshProducts, onRefreshCustomers])

  return {
    // State
    isOnline,
    syncing,
    dataSyncing,
    lastSyncTimes,
    unsyncedCount,
    pendingListOpen,
    offlineListOpen,

    // Derived
    isSyncStale,
    syncAgeSec,

    // Refs
    syncingRef,
    checkoutSyncRef,
    initialSyncDone,

    // Actions
    setPendingListOpen,
    setOfflineListOpen,
    handleSync,
    timeAgo,
  }
}
