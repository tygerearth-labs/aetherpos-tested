'use client'

/**
 * PendingTransactionsList Component
 *
 * Extracted from pos-page.tsx (OfflineSyncContent sub-component).
 * Displays and manages offline/pending transactions that need synchronization.
 *
 * @module components/pos/components/PendingTransactionsList
 *
 * Features:
 * - Shows list of unsynced transactions from IndexedDB
 * - Individual and bulk sync operations
 * - Delete individual or all pending transactions
 * - Offline status warning banner
 * - Summary stats bar (transaction count, total nominal, connection status)
 * - Retry count badges and error display
 *
 * BUG-04: Auto-sync race condition is preserved exactly as in original code.
 * No modifications to sync logic have been made.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Loader2, Check, X, WifiOff, RefreshCw, Package, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { localDB, type OfflineTransaction } from '@/lib/local-db'

/**
 * Props interface for PendingTransactionsList component.
 */
interface PendingTransactionsListProps {
  /** List of offline/unsynced transactions from IndexedDB */
  offlineList: OfflineTransaction[]
  /** Current online/offline network status */
  isOnline: boolean
  /** Callback invoked when one or more transactions are successfully synced */
  onSynced: () => void
}

/**
 * PendingTransactionsList — Displays and manages offline pending transactions.
 *
 * This component renders:
 * - Offline warning banner (when `isOnline` is false)
 * - Summary stats bar (count, total nominal, connection status)
 * - Bulk actions bar (sync all / delete all)
 * - Scrollable transaction list with per-item sync/delete controls
 *
 * All IndexedDB operations (`localDB.*`) are preserved exactly as in the original.
 * The BUG-04 auto-sync race condition is intentionally preserved.
 *
 * @example
 * ```tsx
 * <PendingTransactionsList
 *   offlineList={offlineTransactions}
 *   isOnline={isOnline}
 *   onSynced={() => refetch()}
 * />
 * ```
 */
function PendingTransactionsList({
  offlineList,
  isOnline,
  onSynced,
}: PendingTransactionsListProps) {
  // ─── Local State ───────────────────────────────────────────────
  /** Set of transaction IDs currently being synced individually */
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set())
  /** Flag indicating bulk sync-all operation is in progress */
  const [syncingAll, setSyncingAll] = useState(false)

  // ─── Handlers ──────────────────────────────────────────────────

  /**
   * Sync a single offline transaction to the server.
   *
   * Updates localDB on success (marks as synced) or failure (increments retryCount).
   * Preserves BUG-04 race condition: no locking mechanism around sync state.
   *
   * @param tx - The OfflineTransaction to sync
   */
  const syncOne = async (tx: OfflineTransaction) => {
    if (!tx.id || syncingIds.has(tx.id)) return
    setSyncingIds(prev => new Set(prev).add(tx.id!))
    try {
      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [tx] }),
      })
      const data = await res.json()
      if (res.ok && data.results?.[0]?.success) {
        await localDB.transactions.update(tx.id, {
          isSynced: 1,
          syncedAt: Date.now(),
          invoiceNumber: data.results[0].invoiceNumber,
          serverTransactionId: data.results[0].serverId,
        })
        toast.success('Transaksi berhasil disync!')
        onSynced()
      } else {
        const error = data.results?.[0]?.error || data.error || 'Gagal sync'
        await localDB.transactions.update(tx.id, {
          retryCount: (tx.retryCount || 0) + 1,
          lastError: error,
        })
        toast.error('Sync gagal', { description: error })
      }
    } catch {
      await localDB.transactions.update(tx.id, {
        retryCount: (tx.retryCount || 0) + 1,
        lastError: 'Tidak ada koneksi internet',
      })
      toast.error('Sync gagal — tidak ada koneksi')
    } finally {
      setSyncingIds(prev => {
        const next = new Set(prev)
        next.delete(tx.id!)
        return next
      })
    }
  }

  /**
   * Sync all offline transactions in a single batch request.
   *
   * Iterates over results and updates each transaction in localDB individually.
   * Shows success/error toasts with counts.
   * Preserves BUG-04: no guard against concurrent syncAll calls beyond `syncingAll` flag.
   */
  const syncAll = async () => {
    if (!offlineList || offlineList.length === 0 || syncingAll) return
    setSyncingAll(true)
    try {
      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: offlineList }),
      })
      const data = await res.json()
      if (res.ok) {
        let synced = 0
        let failed = 0
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
            failed++
          }
        }
        if (synced > 0) {
          toast.success(`${synced} transaksi berhasil disync!`)
          onSynced()
        }
        if (failed > 0) {
          toast.error(`${failed} transaksi gagal sync`, { description: 'Periksa stok produk.' })
        }
      } else {
        toast.error('Sync gagal — server error')
      }
    } catch {
      toast.error('Sync gagal — tidak ada koneksi internet')
    } finally {
      setSyncingAll(false)
    }
  }

  /**
   * Delete a single offline transaction from IndexedDB.
   * @param id - The transaction ID to delete
   */
  const deleteOne = async (id: number) => {
    await localDB.transactions.delete(id)
    toast.success('Transaksi offline dihapus')
  }

  /**
   * Delete all offline transactions from IndexedDB.
   * Iterates through offlineList and deletes each by ID.
   */
  const deleteAll = async () => {
    if (!offlineList) return
    for (const tx of offlineList) {
      if (tx.id) await localDB.transactions.delete(tx.id)
    }
    toast.success(`${offlineList.length} transaksi offline dihapus`)
  }

  // ─── Helpers ───────────────────────────────────────────────────

  /**
   * Format a timestamp to Indonesian locale date+time string.
   * @param ts - Unix timestamp in milliseconds
   * @returns Formatted string e.g. "01 Jan 2025, 14:30"
   */
  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  /**
   * Extract display info from an OfflineTransaction payload.
   * @param tx - The offline transaction
   * @returns Object with invoice number, total amount, and item count
   */
  const getTxInfo = (tx: OfflineTransaction) => {
    const p = tx.payload
    const invoice = (tx.invoiceNumber as string) || (p.invoiceNumber as string) || `OFF-${tx.createdAt.toString(36).toUpperCase()}`
    const total = (p.total as number) || (p.subtotal as number) || 0
    const items = (p.items as Array<{ product?: { name: string }; variant?: { name: string }; qty: number }>) || []
    const itemCount = items.reduce((s, i) => s + (i.qty || 1), 0)
    return { invoice, total, itemCount }
  }

  // ─── Render ────────────────────────────────────────────────────

  // Loading state — when offlineList is null/undefined (still fetching)
  if (!offlineList) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
      </div>
    )
  }

  // Empty state — all transactions synced
  if (offlineList.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center mx-auto mb-3.5">
          <Check className="h-7 w-7 text-emerald-400" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-bold text-white">Semua Tersinkronisasi</p>
        <p className="text-xs text-slate-500 mt-1.5">Tidak ada transaksi yang perlu disinkronkan</p>
        <Separator className="mt-5 bg-white/[0.06]" />
      </div>
    )
  }

  // Calculate total nominal across all pending transactions
  const totalNominal = offlineList.reduce((s, tx) => {
    const p = tx.payload
    return s + ((p.total as number) || (p.subtotal as number) || 0)
  }, 0)

  return (
    <div className="space-y-3 py-2">
      {/* Offline warning banner */}
      {!isOnline && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/[0.15]">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <WifiOff className="h-4 w-4 text-red-400 shrink-0" strokeWidth={1.5} />
          <div className="min-w-0">
            <p className="text-[11px] text-red-400 font-bold leading-tight">Mode Offline Aktif</p>
            <p className="text-[10px] text-red-400/60 mt-0.5 leading-relaxed">Sinkronisasi otomatis akan dilakukan saat koneksi kembali</p>
          </div>
        </div>
      )}

      {/* Summary stats bar */}
      <div className="flex gap-2">
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
          <p className="text-[10px] text-slate-500">Transaksi</p>
          <p className="text-sm font-bold text-white tabular-nums">{offlineList.length}</p>
        </div>
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
          <p className="text-[10px] text-slate-500">Total Nominal</p>
          <p className="text-sm font-bold text-white tabular-nums">{formatCurrency(totalNominal)}</p>
        </div>
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
          <p className="text-[10px] text-slate-500">Status</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", isOnline ? "bg-emerald-400" : "bg-red-400")} />
            <span className={cn("text-xs font-semibold", isOnline ? "text-emerald-400" : "text-red-400")}>{isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Sticky bulk actions bar */}
      <div className="sticky top-0 z-10 -mx-1 px-1 pb-2 bg-nebula/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2">
          <Button
            size="sm"
            onClick={syncAll}
            disabled={syncingAll || !isOnline}
            className="h-8 text-[11px] font-medium rounded-lg theme-bg hover:theme-hover text-white transition-colors disabled:opacity-40"
          >
            {syncingAll ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" strokeWidth={1.5} />}
            Sinkronkan Semua
            {offlineList.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 bg-white/[0.15] text-white border-white/[0.2] text-[9px] px-1.5 py-0 h-4 font-semibold">
                {offlineList.length}
              </Badge>
            )}
          </Button>
          <button
            onClick={deleteAll}
            className="text-[11px] text-slate-500 hover:text-red-400 transition-colors font-medium shrink-0"
          >
            Hapus Semua
          </button>
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-2.5 max-h-[50vh] overflow-y-auto">
        {offlineList.map((tx) => {
          const { invoice, total, itemCount } = getTxInfo(tx)
          const isSyncing = syncingIds.has(tx.id!)
          const hasError = !!tx.lastError
          const borderColor = hasError ? 'border-l-red-500/40' : 'border-l-amber-500/40'

          return (
            <div key={tx.id} className={cn(
              "relative rounded-xl border border-white/[0.06] bg-white/[0.02] border-l-[3px] p-3.5 space-y-3",
              borderColor
            )}>
              {/* Delete button overlay top-right */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deleteOne(tx.id!)}
                className="absolute top-2.5 right-2.5 h-6 w-6 px-0 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </Button>

              {/* Header: Invoice + OFFLINE tag + item count | Total */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-slate-200 font-mono truncate">{invoice}</p>
                    <Badge variant="secondary" className="bg-red-500/10 text-red-400 border-red-500/15 text-[8px] px-1.5 py-0 h-4 font-bold tracking-wider shrink-0">
                      OFFLINE
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Package className="h-2.5 w-2.5" strokeWidth={1.5} />
                      {itemCount} item
                    </span>
                    <span className="text-slate-700">·</span>
                    <span className="text-[10px] text-slate-600">{formatTime(tx.createdAt)}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  <p className="text-sm font-bold text-white tabular-nums">{formatCurrency(total)}</p>
                </div>
              </div>

              {/* Status section: retry badge + error */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[9px] px-1.5 py-0 h-4 font-semibold border",
                    (tx.retryCount || 0) > 2
                      ? "bg-red-500/10 text-red-400 border-red-500/15"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/15"
                  )}
                >
                  {(tx.retryCount || 0)}x retry
                </Badge>
                {tx.lastError && (
                  <span className="flex items-center gap-1 text-[10px] text-red-400/80 min-w-0">
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} />
                    <span className="truncate" title={tx.lastError}>{tx.lastError}</span>
                  </span>
                )}
              </div>

              {/* Sync button — full width */}
              <Button
                size="sm"
                onClick={() => syncOne(tx)}
                disabled={isSyncing || !isOnline}
                className="w-full h-8 text-[11px] font-medium rounded-xl theme-bg hover:theme-hover text-white transition-colors disabled:opacity-40"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Menyinkronkan...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 h-3 w-3" strokeWidth={1.5} />
                    Sync Sekarang
                  </>
                )}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default PendingTransactionsList
