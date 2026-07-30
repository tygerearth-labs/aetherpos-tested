'use client'

import React from 'react'
import { AlertTriangle, WifiOff, RefreshCw, ArrowLeft, ShoppingCart, Loader2 } from 'lucide-react'
import {
  isChunkLoadError,
  canAttemptChunkReload,
  performChunkReload,
  resetChunkReloadGuard,
} from '@/lib/chunk-load-error'
import { usePageStore } from '@/hooks/use-page-store'
import {
  hasCriticalActivity,
  getActiveActivities,
  hasInFlightActivity,
} from '@/lib/build-guard/critical-activity-registry'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  /** Which force-reload confirmation dialog is open (Path 2 only). */
  confirmDialog: 'none' | 'simple' | 'hard'
}

/**
 * ErrorBoundary with ChunkLoadError awareness + critical-activity gating.
 *
 * Four recovery paths:
 *
 * 1. ChunkLoadError + OFFLINE:
 *    The lazy chunk was never cached. Show "Halaman ini belum tersedia secara
 *    offline" with a "Kembali ke POS" action. NO reload (guaranteed to fail).
 *
 * 2. ChunkLoadError + ONLINE + critical activities active + not yet reloaded:
 *    Stale build, but reloading would interrupt active work (POS cart, bulk
 *    job, dirty form, in-flight API call, etc.). Show a WARNING screen
 *    listing the active activities. The force-reload button behavior
 *    follows a 3-tier safety ladder (mirrors update-banner.tsx):
 *      - any in-flight activity  → force button HIDDEN. Only "Kembali".
 *        (Reloading mid-API-call leaves the user unsure whether the
 *        transaction succeeded.)
 *      - any data-loss activity  → force button shown; click opens a HARD
 *        confirmation dialog listing every active activity. Only the second
 *        click ("Tetap muat ulang") triggers performChunkReload().
 *      - only interrupt          → force button shown; click opens a SIMPLE
 *        confirmation dialog. One click on "Muat ulang" triggers reload.
 *    In all tiers the user can also choose "Kembali" (go back to the
 *    previous page — state survives in Zustand/Dexie; the update banner
 *    will apply the update when safe).
 *
 * 3. ChunkLoadError + ONLINE + no critical activities + not yet reloaded:
 *    Stale build, safe to reload. Perform ONE controlled reload
 *    (sessionStorage guard). Render a brief "Memperbarui..." state.
 *
 * 4. ChunkLoadError + ONLINE + already reloaded:
 *    The reload didn't fix it (genuinely broken build). Show recovery UI
 *    with "Muat ulang aplikasi" (clear cache + SW + reload) + "Kembali".
 *
 * 5. Any other error:
 *    Generic "Terjadi kesalahan" with "Coba Lagi" (resets boundary state).
 *
 * Raw chunk hashes / module IDs are NEVER shown to the user — only friendly
 * Indonesian copy.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, confirmDialog: 'none' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, confirmDialog: 'none' }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (isChunkLoadError(error)) {
      // Chunk load failures are expected under offline/stale-build conditions;
      // log at info level so dev tools show the context without console noise.
      console.info('[ErrorBoundary] ChunkLoadError caught:', error.message, errorInfo)
    } else {
      console.error('[ErrorBoundary] Caught error:', error, errorInfo)
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, confirmDialog: 'none' })
  }

  private handleBackToPOS = () => {
    // Navigate via the page store (Zustand) — POS is FULL offline + chunk
    // already cached, so this navigation won't throw.
    try {
      usePageStore.getState().setCurrentPage('pos')
    } catch {
      window.location.href = '/'
    }
    this.setState({ hasError: false, error: null, confirmDialog: 'none' })
  }

  private handleBack = () => {
    // Go back to dashboard (READ_ONLY, chunk prefetched) — safer than POS
    // for non-POS contexts. State survives in Zustand/Dexie.
    try {
      usePageStore.getState().setCurrentPage('dashboard')
    } catch {
      window.location.href = '/'
    }
    this.setState({ hasError: false, error: null, confirmDialog: 'none' })
  }

  private handleClearCacheAndReload = () => {
    // Clear SW caches + sessionStorage guard, then reload
    resetChunkReloadGuard()
    const w = window as Window & typeof globalThis
    if (typeof w.caches !== 'undefined') {
      w.caches.keys().then((names) => {
        Promise.all(names.map((n) => w.caches.delete(n))).then(() => {
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then((regs) => {
              Promise.all(regs.map((r) => r.unregister())).then(() => {
                w.location.reload()
              })
            })
          } else {
            w.location.reload()
          }
        })
      })
    } else {
      w.location.reload()
    }
  }

  /**
   * Open the appropriate force-reload confirmation dialog based on the
   * highest-severity active activity (3-tier safety ladder):
   *   - any in-flight  → caller should NOT render the force button at all
   *                      (defensive: this method no-ops if called anyway)
   *   - any data-loss  → hard confirmation dialog (lists activities)
   *   - only interrupt → simple confirmation dialog
   */
  private handleOpenForceConfirm = () => {
    const activities = getActiveActivities()
    if (activities.some((a) => a.severity === 'in-flight')) return // defensive
    const hasDataLoss = activities.some((a) => a.severity === 'data-loss')
    this.setState({ confirmDialog: hasDataLoss ? 'hard' : 'simple' })
  }

  /**
   * User confirmed in the dialog — actually reload now. The dialog auto-closes
   * via AlertDialogAction; we also reset the state defensively.
   */
  private handleConfirmForceReload = () => {
    this.setState({ confirmDialog: 'none' })
    performChunkReload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const error = this.state.error
      const isChunk = isChunkLoadError(error)
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
      const alreadyReloaded = !canAttemptChunkReload()
      const hasActiveWork = hasCriticalActivity()
      const activeActivities = getActiveActivities()

      // ── Path 1: ChunkLoadError + OFFLINE ──
      if (isChunk && !isOnline) {
        return (
          <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
            <div className="h-14 w-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
              <WifiOff className="h-7 w-7 text-amber-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">
              Halaman ini belum tersedia secara offline
            </h2>
            <p className="text-sm text-slate-400 max-w-md mb-1">
              Anda sedang offline dan halaman ini belum dimuat sebelumnya.
              Buka halaman ini saat online sekali untuk membuatnya tersedia offline.
            </p>
            <p className="text-xs text-slate-500 max-w-sm mb-6">
              Transaksi lokal Anda di POS tetap aman dan akan disinkronkan saat koneksi kembali.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={this.handleBackToPOS}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.06] border border-white/[0.08] px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/[0.1] transition-colors"
              >
                <ShoppingCart className="h-4 w-4" />
                Kembali ke POS
              </button>
            </div>
          </div>
        )
      }

      // ── Path 2: ChunkLoadError + ONLINE + critical activities active + first attempt ──
      //
      // 3-tier force-reload safety ladder (mirrors update-banner.tsx):
      //   • any in-flight  → force button HIDDEN. Show an explanatory message
      //     + only the "Kembali" button (cannot reload mid-API-call).
      //   • any data-loss  → force button shown; click opens HARD confirmation
      //     dialog listing every active activity. Only "Tetap muat ulang"
      //     triggers performChunkReload().
      //   • only interrupt → force button shown; click opens SIMPLE confirmation
      //     dialog. One click on "Muat ulang" triggers performChunkReload().
      if (isChunk && isOnline && hasActiveWork && !alreadyReloaded) {
        const hasInFlight = hasInFlightActivity()
        const hasDataLoss = activeActivities.some((a) => a.severity === 'data-loss')

        const activityBadgeClass = (sev: string) =>
          sev === 'in-flight'
            ? 'bg-rose-500/10 border-rose-500/25 text-rose-300'
            : sev === 'data-loss'
              ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
              : 'bg-sky-500/10 border-sky-500/25 text-sky-300'

        return (
          <>
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
              <div className="h-14 w-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
                <AlertTriangle className="h-7 w-7 text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold text-white mb-2">
                Versi aplikasi berubah
              </h2>
              <p className="text-sm text-slate-400 max-w-md mb-1">
                {hasInFlight
                  ? 'Transaksi sedang berjalan. Selesaikan terlebih dahulu, lalu muat ulang.'
                  : hasDataLoss
                    ? 'Anda memiliki pekerjaan aktif yang belum tersimpan. Muat ulang sekarang berisiko kehilangan data.'
                    : 'Ada proses berjalan. Muat ulang akan menghentikannya sementara.'}
              </p>
              <p className="text-xs text-slate-500 max-w-sm mb-4">
                {hasInFlight
                  ? 'Tunggu hingga transaksi selesai, lalu muat ulang halaman ini.'
                  : 'Selesaikan pekerjaan Anda, lalu muat ulang. Atau muat ulang paksa sekarang (risiko ditanggung pengguna).'}
              </p>

              {/* Active activities list */}
              {activeActivities.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5 mb-6 max-w-md">
                  {activeActivities.slice(0, 5).map((a) => (
                    <span
                      key={a.id}
                      className={`inline-flex items-center px-2 py-1 rounded-md text-[11px] font-medium border ${activityBadgeClass(
                        a.severity,
                      )}`}
                    >
                      {a.label}
                    </span>
                  ))}
                  {activeActivities.length > 5 && (
                    <span className="inline-flex items-center px-2 py-1 text-[11px] text-slate-500">
                      +{activeActivities.length - 5} lainnya
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={this.handleBack}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.06] border border-white/[0.08] px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/[0.1] transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Kembali
                </button>
                {!hasInFlight && (
                  <button
                    onClick={this.handleOpenForceConfirm}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500/15 border border-amber-500/30 px-4 py-2.5 text-sm text-amber-200 hover:bg-amber-500/25 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Muat ulang paksa
                  </button>
                )}
              </div>
            </div>

            {/* ── Simple confirmation dialog (only interrupt activities) ── */}
            <AlertDialog
              open={this.state.confirmDialog === 'simple'}
              onOpenChange={(open) => !open && this.setState({ confirmDialog: 'none' })}
            >
              <AlertDialogContent className="bg-nebula border-white/[0.06]">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-white text-sm font-semibold">
                    Muat ulang sekarang?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-slate-400 text-xs">
                    Ada proses aktif yang akan terputus.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs">
                    Batal
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={this.handleConfirmForceReload}
                    className="bg-amber-500 hover:bg-amber-600 text-white h-8 text-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Muat ulang
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* ── Hard confirmation dialog (any data-loss activity) ── */}
            <AlertDialog
              open={this.state.confirmDialog === 'hard'}
              onOpenChange={(open) => !open && this.setState({ confirmDialog: 'none' })}
            >
              <AlertDialogContent className="bg-nebula border-white/[0.06]">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-white text-sm font-semibold">
                    Perubahan belum disimpan akan hilang
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-slate-400 text-xs">
                    Aktivitas aktif:
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  {activeActivities.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                          a.severity === 'in-flight'
                            ? 'bg-rose-400'
                            : a.severity === 'data-loss'
                              ? 'bg-amber-400'
                              : 'bg-sky-400'
                        }`}
                      />
                      {a.label}
                    </li>
                  ))}
                </ul>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs">
                    Kembali
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={this.handleConfirmForceReload}
                    className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Tetap muat ulang
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )
      }

      // ── Path 3: ChunkLoadError + ONLINE + no critical activities + first attempt ──
      if (isChunk && isOnline && !alreadyReloaded) {
        // Safe to auto-reload — no critical activities active.
        // Render a brief loading state; performChunkReload triggers in a microtask.
        queueMicrotask(() => {
          if (canAttemptChunkReload()) {
            performChunkReload()
          }
        })
        return (
          <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
            <div className="h-14 w-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4">
              <Loader2 className="h-7 w-7 text-cyan-400 animate-spin" />
            </div>
            <h2 className="text-base font-semibold text-white mb-2">
              Memperbarui aplikasi...
            </h2>
            <p className="text-xs text-slate-500 max-w-md">
              Versi baru terdeteksi. Memuat ulang secara otomatis.
            </p>
          </div>
        )
      }

      // ── Path 4: ChunkLoadError + ONLINE + already reloaded (broken build) ──
      if (isChunk && isOnline && alreadyReloaded) {
        return (
          <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
            <div className="h-14 w-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
              <AlertTriangle className="h-7 w-7 text-red-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">
              Versi aplikasi berubah
            </h2>
            <p className="text-sm text-slate-400 max-w-md mb-1">
              Aplikasi telah diperbarui. Muat ulang untuk mendapatkan versi terbaru.
            </p>
            <p className="text-xs text-slate-500 max-w-sm mb-6">
              Jika masalah berlanjut, bersihkan cache browser dan muat ulang.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={this.handleClearCacheAndReload}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.06] border border-white/[0.08] px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/[0.1] transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Muat ulang aplikasi
              </button>
              <button
                onClick={this.handleBackToPOS}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-transparent border border-white/[0.06] px-4 py-2.5 text-sm text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Kembali ke POS
              </button>
            </div>
          </div>
        )
      }

      // ── Path 5: Generic error ──
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <div className="h-14 w-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Terjadi kesalahan</h2>
          <p className="text-sm text-slate-400 max-w-md mb-1">
            Terjadi kesalahan saat memuat halaman ini.
          </p>
          {/* NOTE: we do NOT surface raw chunk hashes / module IDs to the user.
              The generic message above is all they see. The full error is
              logged to the console for diagnostics. */}
          <div className="flex gap-3 mt-6">
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 rounded-lg bg-white/[0.06] border border-white/[0.08] px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/[0.1] transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Coba Lagi
            </button>
            <button
              onClick={this.handleBackToPOS}
              className="inline-flex items-center gap-2 rounded-lg bg-transparent border border-white/[0.06] px-4 py-2.5 text-sm text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Kembali
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
