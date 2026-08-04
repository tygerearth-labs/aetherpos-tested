'use client'

/**
 * StockOpnameFloatingWidget — global "Stock Opname Berjalan" pill.
 *
 * AETHER MOBILE UI CLEANUP (Section C):
 *   - HIDDEN entirely on the Stock Opname page (both desktop and mobile).
 *     The SO page has its own in-page counting UI (quick-count-widget) so the
 *     global pill is redundant there. Tapping the pill on any other page
 *     navigates to the SO page (which auto-resumes the session).
 *   - Mobile: compact mini-bar (max 64–72px tall) showing only title, scope,
 *     progress bar, and a chevron. Long helper text removed. Sits above the
 *     bottom nav with safe-area-bottom padding.
 *   - Desktop: unchanged fuller card (title + scope + progress + duration).
 *
 * Visibility rules:
 *   - Show when a Dexie session exists AND status ∈ {COUNTING, PAUSED}
 *   - Hide when currentPage === 'stock-opname' (always, any device)
 *
 * Position: bottom-right on desktop (above bottom nav on mobile). Stacks
 * below BulkFloatingWidget (which sits at bottom-[140px]) so the two never
 * overlap.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { ClipboardCheck, Pause, ChevronRight } from 'lucide-react'
import { usePageStore } from '@/hooks/use-page-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { getAetherDB } from '@/lib/offline/aether-db'

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) {
    return `${h}j ${m % 60}m`
  }
  if (m > 0) {
    return `${m}m ${s % 60}d`
  }
  return `${s}d`
}

export function StockOpnameFloatingWidget() {
  const { currentPage, setCurrentPage } = usePageStore()
  const isMobile = useIsMobile()
  const session = useLiveQuery(() => getAetherDB().stockOpnameSession.get('current'), [])
  const [, setTick] = useState(0)

  // Re-render every 10s while a session is active so the elapsed time updates.
  useEffect(() => {
    if (!session) return
    const t = setInterval(() => setTick((n) => n + 1), 10_000)
    return () => clearInterval(t)
  }, [session])

  if (!session || session.status === 'DRAFT') {
    return null
  }

  // Only surface COUNTING and PAUSED (REVIEW/COMPLETING are transient / handled on-page).
  if (session.status !== 'COUNTING' && session.status !== 'PAUSED') {
    return null
  }

  // AETHER MOBILE UI CLEANUP (Section C): hide entirely on the SO page.
  // The SO page has its own in-page counting UI; the global pill is noise there.
  if (currentPage === 'stock-opname') {
    return null
  }

  const isPaused = session.status === 'PAUSED'
  const isCounting = session.status === 'COUNTING'
  const counted = session.countedItems
  const total = session.totalItems
  const pct = total > 0 ? Math.min(100, Math.round((counted / total) * 100)) : 0
  const elapsed = session.startedAt ? Date.now() - new Date(session.startedAt).getTime() : 0

  const title = isCounting ? 'Stock Opname Berjalan' : 'Stock Opname Dijeda'
  const accentBar = isCounting ? 'bg-amber-500' : 'bg-amber-500'

  const handleClick = () => {
    setCurrentPage('stock-opname')
  }

  // ── Mobile: compact mini-bar (max ~72px tall) ──
  // Single row: icon · title + scope · count · chevron
  // Second row: thin progress bar
  if (isMobile) {
    return (
      <AnimatePresence>
        <motion.div
          key={session.id + session.status}
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          // Sits ABOVE the mobile bottom nav (which is ~64px tall + safe-area).
          // bottom-[5.5rem] = 88px clears the nav; safe-area-bottom adds the
          // iOS home indicator gap on top of that.
          className="fixed left-3 right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40"
        >
          <button
            type="button"
            onClick={handleClick}
            className="group relative w-full max-w-[calc(100vw-1.5rem)] mx-auto overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/[0.10] backdrop-blur-md shadow-lg shadow-amber-900/20 text-left transition-all hover:border-amber-500/50 hover:bg-amber-500/[0.14] min-h-[64px] max-h-[72px]"
            aria-label={`${title} — klik untuk melanjutkan`}
          >
            <div className={`absolute inset-x-0 top-0 h-0.5 ${accentBar}`} />
            <div className="p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                {isCounting ? (
                  <ClipboardCheck className="h-4 w-4 text-amber-500 shrink-0" />
                ) : (
                  <Pause className="h-4 w-4 text-amber-500 shrink-0" />
                )}
                <span className="text-[11px] font-semibold text-foreground flex-1 truncate">
                  {title}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {counted}/{total}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </div>
              <div className="flex items-center gap-2">
                <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
                  {formatDuration(elapsed)}
                </span>
              </div>
            </div>
          </button>
        </motion.div>
      </AnimatePresence>
    )
  }

  // ── Desktop: fuller card (unchanged layout) ──
  return (
    <AnimatePresence>
      <motion.div
        key={session.id + session.status}
        initial={{ opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="fixed bottom-6 right-6 z-40"
      >
        <button
          type="button"
          onClick={handleClick}
          className="group relative w-[260px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] backdrop-blur-md shadow-2xl shadow-amber-900/20 text-left transition-all hover:border-amber-500/50 hover:bg-amber-500/[0.12]"
          aria-label={`${title} — klik untuk melanjutkan`}
        >
          <div className={`absolute inset-x-0 top-0 h-0.5 ${accentBar}`} />
          <div className="p-3.5 space-y-2.5">
            <div className="flex items-center gap-2">
              {isCounting ? (
                <ClipboardCheck className="h-4 w-4 text-amber-500 shrink-0" />
              ) : (
                <Pause className="h-4 w-4 text-amber-500 shrink-0" />
              )}
              <span className="text-xs font-semibold text-foreground flex-1 truncate">
                {title}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
            </div>

            <p className="text-[10px] text-muted-foreground truncate">
              {session.scopeLabel || 'Semua Item'}
            </p>

            <div className="space-y-1">
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <span className="font-semibold text-foreground">{counted}</span>
                  {'/'}
                  <span>{total} item</span>
                </span>
                <span>{formatDuration(elapsed)}</span>
              </div>
            </div>

            {isPaused ? (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                Progres tersimpan · klik untuk lanjut
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Klik untuk lanjut menghitung
              </p>
            )}
          </div>
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
