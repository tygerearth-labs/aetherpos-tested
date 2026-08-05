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
import { logSyncTelemetry, type SyncTrigger } from '@/lib/sync-telemetry'

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

/**
 * IDLE AUTO-SYNC contract constants.
 *
 *   IDLE_THRESHOLD_MS — 15 continuous minutes of user inactivity must elapse
 *     before a background sync may fire. This is NOT a fixed interval: any
 *     pointerdown / touchstart / click / keydown / scroll resets the window.
 *
 *   IDLE_TICK_MS — how often the idle checker polls. Polling (vs a single
 *     setTimeout) is robust to background-tab throttling and lets us re-check
 *     the online / visible / pending / not-running preconditions every tick.
 *     30s granularity means an idle sync fires within 15:00–15:30 of inactivity.
 */
const IDLE_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes
const IDLE_TICK_MS = 30_000              // 30 seconds

export function usePosSync(options?: UsePosSyncOptions): UsePosSyncReturn {
  const { onRefreshProducts, onPatchProductStock, onRefreshCustomers, onRefreshCategories } = options || {}

  // Callback refs — keep runSync's useCallback deps EMPTY (stable identity).
  // pos-page.tsx passes inline arrow callbacks, so onRefreshProducts /
  // onPatchProductStock get a NEW identity every render. If runSync depended
  // on them directly, runSync's identity would change every render → every
  // effect with [runSync] dep (mount/online/idle) would re-fire, producing
  // spurious no-op sync calls. Reading via refs breaks that coupling without
  // changing behavior.
  const onRefreshProductsRef = useRef(onRefreshProducts)
  const onPatchProductStockRef = useRef(onPatchProductStock)
  onRefreshProductsRef.current = onRefreshProducts
  onPatchProductStockRef.current = onPatchProductStock

  const [isOnline, setIsOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced')
  const [pendingListOpen, setPendingListOpen] = useState(false)
  const [offlineListOpen, setOfflineListOpen] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)

  const syncingRef = useRef(false)
  const broadcastRef = useRef<BroadcastChannel | null>(null)

  // ── IDLE AUTO-SYNC refs ──
  // lastActivityAt: epoch ms of the most recent user activity event
  //   (pointerdown/touchstart/click/keydown/scroll). Reset to "now" on every
  //   activity → the 15-min idle window restarts from zero.
  // lastIdleSyncAt: epoch ms of the last idle-triggered sync. Enforces "one
  //   sync per idle window" — a second tick after the threshold must NOT fire
  //   again until the user becomes active and goes idle for another 15 min.
  const lastActivityAtRef = useRef<number>(Date.now())
  const lastIdleSyncAtRef = useRef<number>(0)
  // didMountSyncRef: guarantees the mount-time reconnect sync fires EXACTLY
  //   once. Without this, the mount effect's `[runSync]` dep would re-fire it
  //   on every render (runSync's identity is unstable because the POS page
  //   passes inline arrow callbacks to usePosSync), producing spurious no-op
  //   'reconnect' syncs. The single-flight lock already prevents duplicate
  //   /sync network calls, but this guard keeps the telemetry honest.
  const didMountSyncRef = useRef(false)

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
  // TRIGGER MODEL (idle-auto-sync contract):
  //   runSync accepts a `trigger` tag used only for telemetry. The three
  //   legitimate triggers are:
  //     - 'idle15m'   — fired by the idle timer after 15 min of inactivity
  //     - 'reconnect' — fired by the navigator 'online' event (or page mount)
  //                     when the outbox is non-empty
  //     - 'manual'    — fired by the Sync button (or a cross-tab relay)
  //   The legacy periodic 60s interval and the window-focus trigger were
  //   REMOVED:
  //     - the interval violated "NOT a fixed 15-minute interval"
  //     - the focus trigger violated "tab visible must not sync unless
  //       inactivity duration already reached 15 minutes"
  //   Failed items therefore retry on the next idle window (or reconnect /
  //   manual), never on a fixed cadence.
  //
  // OUTBOX CONTRADICTION FIX (toast discipline):
  //   - Success is SILENT when this run JOINED an in-flight sync that the
  //     checkout started (initiated === false). The checkout shows its own
  //     "Pembayaran berhasil" toast; a redundant "N tersinkron" would confuse.
  //   - Duplicate resolutions (DEX-007) are ALWAYS silent — they are background
  //     confirmations of already-committed transactions, not new events.
  //   - Genuine failures (failed > 0) always surface so the cashier can act.
  //   - Abandoned rows (exceeded retry cap) always surface as a warning.
  //
  // SINGLE-FLIGHT LOCK: syncingRef + the module-level syncOutboxPromise in
  //   syncOutboxTracked together guarantee only one sync run executes at a
  //   time. A second call (any trigger) while one is in-flight returns the
  //   zero-result early WITHOUT logging telemetry — so the telemetry log
  //   reflects only runs that actually executed.
  //
  // POST-CHECKOUT LATENCY FIX: onRefreshCustomers is NOT called after sync.
  //   Customer points (loyalty earn/redeem) change after a transaction sync,
  //   but refetching the entire /api/customers?limit=200 list just to update
  //   one customer's points is too expensive. The points display will refresh
  //   on next page visit or manual sync. Accepting points-display staleness
  //   in exchange for zero post-sync customer-list refetches. This function
  //   is fire-and-forget from the checkout path and never blocks the receipt
  //   modal, cart, or navigation.
  const runSync = useCallback(async (trigger: SyncTrigger = 'manual'): Promise<{ synced: number; failed: number; duplicateResolved: number; abandoned: number }> => {
    if (syncingRef.current) return { synced: 0, failed: 0, duplicateResolved: 0, abandoned: 0 }
    syncingRef.current = true
    setSyncing(true)
    const t0 = performance.now()
    let pendingCount = 0
    try {
      // Count pending/retryable-failed rows just before the run (telemetry +
      // honest "did nothing" reporting). Counted under the lock so it is not
      // disturbed by a concurrent caller (which would have early-returned).
      const db = tryGetPosDB()
      if (db) {
        try {
          pendingCount = await db.transactionOutbox.where('status').anyOf('PENDING', 'FAILED').count()
        } catch { /* Dexie not ready — treat as 0 */ }
      }
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
          onPatchProductStockRef.current?.(result.mergedStock)
        } else if (result.stockUpdateSource === 'refetched') {
          onRefreshProductsRef.current?.()
        }
        // 'skipped' → no product refresh needed (no stock changes)
      }
      if (initiated && result.synced > 0 && result.synced > result.duplicateResolved) {
        toast.success(`${result.synced} transaksi tersinkron`)
        patchReactState()
        // NOTE: onRefreshCustomers intentionally omitted — see comment above.
      } else if (initiated && result.synced > 0) {
        // All synced rows were duplicate resolutions — refresh data but stay silent.
        patchReactState()
        // NOTE: onRefreshCustomers intentionally omitted — see comment above.
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
      // Telemetry — one event per sync run that actually executed.
      logSyncTelemetry({
        trigger,
        lastActivityAt: lastActivityAtRef.current,
        idleDuration: trigger === 'idle15m' ? Date.now() - lastActivityAtRef.current : null,
        pendingCount,
        syncedCount: result.synced,
        failedCount: result.failed,
        duration: Math.round(performance.now() - t0),
        timestamp: Date.now(),
      })
      // Broadcast to other tabs
      try { broadcastRef.current?.postMessage({ type: 'sync-complete', synced: result.synced }) } catch {}
      return result
    } catch {
      // Telemetry for a run that threw (network error before any row synced).
      logSyncTelemetry({
        trigger,
        lastActivityAt: lastActivityAtRef.current,
        idleDuration: trigger === 'idle15m' ? Date.now() - lastActivityAtRef.current : null,
        pendingCount,
        syncedCount: 0,
        failedCount: pendingCount,
        duration: Math.round(performance.now() - t0),
        timestamp: Date.now(),
      })
      return { synced: 0, failed: 0, duplicateResolved: 0, abandoned: 0 }
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  // Empty deps: runSync reads callbacks via refs (see onRefreshProductsRef
  // comment above) so its identity is stable. This prevents every [runSync]
  // effect from re-firing on each render.
  }, [])

  // ── Online/offline detection ──
  // RECONNECT TRIGGER: on the navigator 'online' event, sync immediately BUT
  // ONLY when the outbox is non-empty. If the outbox is empty, going online
  // does nothing — no spurious /sync call. This is the one exception to the
  // "15-min idle" rule: a reconnect is an explicit signal that the network
  // recovered and pending work can now be pushed.
  useEffect(() => {
    setIsOnline(navigator.onLine)
    const handleOnline = () => {
      setIsOnline(true)
      setTimeout(() => {
        if (syncingRef.current) return
        const db = tryGetPosDB()
        if (!db) return
        db.transactionOutbox
          .where('status')
          .anyOf('PENDING', 'FAILED')
          .count()
          .then(count => { if (count > 0) void runSync('reconnect') })
          .catch(() => {})
      }, 500)
    }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [runSync])

  // ── IDLE AUTO-SYNC: activity tracking ──
  // Reset the 15-min idle window on every user activity. Any of these events
  // counts as "the user is here" → start counting from zero again. scroll uses
  // capture:true on document so container scrolls (which don't bubble to
  // window) are also caught. pointerdown covers mouse + pen; touchstart covers
  // touch; click covers taps/activations; keydown covers typing. passive:true
  // where safe to avoid scroll/touch jank.
  useEffect(() => {
    lastActivityAtRef.current = Date.now()
    const mark = () => { lastActivityAtRef.current = Date.now() }
    window.addEventListener('pointerdown', mark, { passive: true })
    window.addEventListener('touchstart', mark, { passive: true })
    window.addEventListener('click', mark, { passive: true })
    window.addEventListener('keydown', mark)
    document.addEventListener('scroll', mark, { passive: true, capture: true })
    return () => {
      window.removeEventListener('pointerdown', mark)
      window.removeEventListener('touchstart', mark)
      window.removeEventListener('click', mark)
      window.removeEventListener('keydown', mark)
      document.removeEventListener('scroll', mark, { capture: true })
    }
  }, [])

  // ── IDLE AUTO-SYNC: 15-minute inactivity timer ──
  // Polls every IDLE_TICK_MS (30s). Fires a background sync ONLY when ALL of:
  //   1. navigator.onLine === true
  //   2. document.visibilityState === 'visible'
  //   3. pending outbox count > 0
  //   4. no sync currently running (syncingRef)
  //   5. now - lastActivityAt >= IDLE_THRESHOLD_MS (15 min continuous idle)
  //   6. this idle window hasn't already been consumed
  //      (lastIdleSyncAt <= lastActivityAt)
  // This is NOT a fixed interval: any activity resets lastActivityAt, so the
  // window restarts from zero. Failed items remain pending and retry on the
  // NEXT idle window (or reconnect / manual). One sync per idle window — a
  // second tick while still idle does NOT re-fire until the user becomes
  // active and goes idle for another 15 min.
  useEffect(() => {
    const tick = () => {
      if (!navigator.onLine) return                                      // (1)
      if (document.visibilityState !== 'visible') return                 // (2)
      if (syncingRef.current) return                                     // (4)
      const now = Date.now()
      const lastAct = lastActivityAtRef.current
      if (now - lastAct < IDLE_THRESHOLD_MS) return                      // (5)
      if (lastIdleSyncAtRef.current > lastAct) return                    // (6)
      const db = tryGetPosDB()
      if (!db) return
      db.transactionOutbox
        .where('status')
        .anyOf('PENDING', 'FAILED')
        .count()
        .then(count => {
          if (count === 0) return                                        // (3)
          // Consume this idle window so the next tick (still idle) doesn't
          // fire again. The user must become active and go idle for another
          // 15 min before the next idle-triggered sync.
          lastIdleSyncAtRef.current = Date.now()
          void runSync('idle15m')
        })
        .catch(() => { /* Dexie not ready — retry next tick */ })
    }
    const iv = setInterval(tick, IDLE_TICK_MS)
    return () => clearInterval(iv)
  }, [runSync])

  // ── BroadcastChannel (cross-tab sync trigger) ──
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel('aetherpos-sync')
    broadcastRef.current = bc
    bc.onmessage = (e) => {
      if (e.data?.type === 'sync-complete' && navigator.onLine) {
        onRefreshProducts?.()
        onRefreshCustomers?.()
      }
      // Cross-tab relay of a sync request — treated as 'manual' since it
      // represents another tab's explicit sync intent.
      if (e.data?.type === 'sync-request' && navigator.onLine && !syncingRef.current) {
        void runSync('manual')
      }
    }
    return () => { bc.close(); broadcastRef.current = null }
  }, [runSync, onRefreshProducts, onRefreshCustomers])

  // ── NOTE: the legacy 60s periodic interval was REMOVED ──
  // It violated the idle-auto-sync contract ("NOT a fixed 15-minute interval"
  // and "tab visible must not sync unless 15 min idle"). Background syncs now
  // happen ONLY on: 15-min idle (idle15m), reconnect (with pending outbox),
  // or manual. The idle tick above (IDLE_TICK_MS) is a threshold CHECKER, not
  // a sync interval — it only fires runSync once the 15-min idle condition is
  // met, and at most once per idle window.

  // ── Initial sync on mount (if online + pending outbox) ──
  // Treated as a 'reconnect' trigger: a page load is effectively the app
  // reconnecting to its backend. Only fires when there are PENDING/FAILED rows
  // (e.g. stale entries from a prior session) so DEX-007 can resolve them
  // immediately. Does NOT violate "tab visible must not sync unless 15 min
  // idle" — mount is a one-time load, not a recurring visibility event.
  useEffect(() => {
    // One-shot: fire only on the true first mount, never on re-renders (even
    // if runSync's identity changes). See didMountSyncRef comment above.
    if (didMountSyncRef.current) return
    didMountSyncRef.current = true
    if (navigator.onLine) {
      const db = tryGetPosDB()
      if (db) {
        db.transactionOutbox
          .where('status')
          .anyOf('PENDING', 'FAILED')
          .count()
          .then(count => { if (count > 0) setTimeout(() => void runSync('reconnect'), 1000) })
          .catch(() => {})
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
    await runSync('manual')
  }, [unsyncedCount, runSync, onRefreshProducts, onRefreshCustomers, onRefreshCategories])

  return {
    isOnline, syncing, syncStatus, unsyncedCount,
    pendingListOpen, offlineListOpen, lastSyncAt,
    setPendingListOpen, setOfflineListOpen, handleSync, timeAgo,
  }
}
