'use client'

import React from 'react'
import { AlertTriangle, RefreshCw, WifiOff, ArrowLeft } from 'lucide-react'
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
 * Detects ChunkLoadError — thrown by webpack/Next.js when a lazy-loaded
 * JS/CSS chunk fails to load (network failure, deployment skew, offline, etc.)
 *
 * Checks both the canonical error name and a defensive message pattern
 * to catch wrapped/rethrown variants.
 */
function isChunkLoadError(error: Error | null | undefined): boolean {
  if (!error) return false
  if (error.name === 'ChunkLoadError') return true
  return /Loading (?:CSS )?chunk/i.test(error.message || '')
}

/**
 * Human-friendly fallback shown when a page chunk fails to load while offline.
 *
 * Instead of surfacing a raw ChunkLoadError, tells the user the page isn't
 * available offline — but POS still works and transactions will sync when
 * the connection comes back. Provides a single, clear action: back to POS.
 */
function OfflinePageFallback({ onBackToPos }: { onBackToPos: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="h-14 w-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
        <WifiOff className="h-7 w-7 text-amber-400" />
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">
        Halaman ini belum tersedia saat offline.
      </h2>
      <p className="text-sm text-slate-400 max-w-md mb-6">
        POS tetap bisa digunakan dan transaksi akan disinkronkan saat koneksi kembali.
      </p>
      <button
        onClick={onBackToPos}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-sm text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/20 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Kembali ke POS
      </button>
    </div>
  )
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  /**
   * Resets the error state and navigates back to POS.
   *
   * The state reset is essential: LazyPage/ErrorBoundary stays mounted in the
   * same tree position across page changes, so without clearing hasError the
   * fallback would persist even after setCurrentPage('pos').
   */
  private handleBackToPos = () => {
    this.setState({ hasError: false, error: null })
    usePageStore.getState().setCurrentPage('pos')
  }

  render() {
    if (this.state.hasError) {
      // Offline + ChunkLoadError → page chunk not cached, show human-friendly
      // fallback instead of the raw error. POS remains usable offline.
      if (
        isChunkLoadError(this.state.error) &&
        typeof navigator !== 'undefined' &&
        !navigator.onLine
      ) {
        return <OfflinePageFallback onBackToPos={this.handleBackToPos} />
      }

      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <div className="h-14 w-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Halaman Error</h2>
          <p className="text-sm text-slate-400 max-w-md mb-1">
            Terjadi kesalahan saat memuat halaman ini.
          </p>
          {this.state.error?.message && (
            <p className="text-xs text-slate-500 max-w-md mb-6 font-mono break-all">
              {this.state.error.message}
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
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
