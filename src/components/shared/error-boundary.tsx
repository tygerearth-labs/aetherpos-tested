'use client'

import React from 'react'
import { AlertTriangle, WifiOff, RefreshCw, ArrowLeft, ShoppingCart } from 'lucide-react'
import {
  isChunkLoadError,
  canAttemptChunkReload,
  performChunkReload,
  resetChunkReloadGuard,
} from '@/lib/chunk-load-error'
import { usePageStore } from '@/hooks/use-page-store'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * ErrorBoundary with ChunkLoadError awareness.
 *
 * Three recovery paths:
 *
 * 1. ChunkLoadError + OFFLINE:
 *    The lazy chunk was never cached (user hasn't visited this page online).
 *    Show "Halaman ini belum tersedia secara offline" with actions:
 *      - Kembali ke POS (the FULL-offline route)
 *    NO reload button (reload while offline is guaranteed to fail again).
 *
 * 2. ChunkLoadError + ONLINE (stale build / deploy mismatch):
 *    The chunk hash no longer exists on the server. Perform ONE controlled
 *    reload (sessionStorage guard). If reload already attempted, show
 *    recovery UI with "Muat ulang aplikasi" + "Clear cache" guidance.
 *
 * 3. Any other error:
 *    Generic "Terjadi kesalahan" with "Coba Lagi" (resets boundary state).
 *    Raw error message shown in mono font for diagnostics.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
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
    this.setState({ hasError: false, error: null })
  }

  private handleBackToPOS = () => {
    // Navigate via the page store (Zustand) — the app shell reads currentPage
    // and will render POS (which is FULL offline + chunk already cached).
    try {
      usePageStore.getState().setCurrentPage('pos')
    } catch {
      // Fallback: hard navigate to root (POS is the default on fresh load)
      window.location.href = '/'
    }
    this.setState({ hasError: false, error: null })
  }

  private handleClearCacheAndReload = () => {
    // Clear SW caches + sessionStorage guard, then reload
    resetChunkReloadGuard()
    const w = window as Window & typeof globalThis
    if (typeof w.caches !== 'undefined') {
      w.caches.keys().then((names) => {
        Promise.all(names.map((n) => w.caches.delete(n))).then(() => {
          // Also unregister SW so it re-registers clean
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

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      const error = this.state.error
      const isChunk = isChunkLoadError(error)
      // Read navigator.onLine directly (class component, no hook) — this is
      // fine because the boundary re-renders on state change, and online
      // status changes trigger app-shell re-render which re-mounts children.
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
      const alreadyReloaded = !canAttemptChunkReload()

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

      // ── Path 2: ChunkLoadError + ONLINE (stale build) ──
      if (isChunk && isOnline) {
        if (alreadyReloaded) {
          // Already attempted one reload — show recovery UI, do NOT loop
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
                  Kembali ke Dashboard
                </button>
              </div>
            </div>
          )
        }
        // First chunk failure online → auto-reload once (controlled)
        // Render a brief loading state; performChunkReload triggers immediately
        // (in a microtask to avoid setState-during-render warnings)
        queueMicrotask(() => {
          if (canAttemptChunkReload()) {
            performChunkReload()
          }
        })
        return (
          <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
            <div className="h-14 w-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4">
              <RefreshCw className="h-7 w-7 text-cyan-400 animate-spin" />
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

      // ── Path 3: Generic error ──
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <div className="h-14 w-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Terjadi kesalahan</h2>
          <p className="text-sm text-slate-400 max-w-md mb-1">
            Terjadi kesalahan saat memuat halaman ini.
          </p>
          {error?.message && (
            <p className="text-xs text-slate-500 max-w-md mb-6 font-mono break-all">
              {error.message}
            </p>
          )}
          <div className="flex gap-3">
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
