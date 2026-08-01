'use client'

/**
 * StockOpnameFloatingWidget — global "Stock Opname Berjalan" pill.
 *
 * Always mounted in the authenticated app shell (alongside BulkFloatingWidget
 * and MigrationFloatingWidget). Surfaces an in-progress or paused stock opname
 * session so the user can jump back into counting with one click.
 *
 * Visibility rules:
 *   - Show when a Dexie session exists AND status ∈ {COUNTING, PAUSED}
 *   - Desktop: hide when currentPage === 'stock-opname' (the SO page has its
 *     own floating counting card).
 *   - Mobile: show even on the SO page when status === COUNTING, so a
 *     minimized counting dialog can be re-opened by tapping the pill. Tapping
 *     the pill on the SO page dispatches a `so-resume-counting` custom event
 *     that the SO page listens for to re-focus the next uncounted item.
 *
 * Click → navigate to the Stock Opname page (which auto-resumes the session),
 * or on mobile/SO-page → re-open the counting dialog.
 *
 * Position: bottom-right on desktop, above the mobile bottom nav on mobile.
 * Stacks below BulkFloatingWidget (which sits at bottom-[140px]) so the two
 * never overlap.
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

  const isOnSoPage = currentPage === 'stock-opname'

  // Desktop: hide the pill on the SO page (the page has its own floating card).
  // Mobile: keep the pill visible on the SO page when COUNTING so a minimized
  // counting dialog can be re-opened by tapping the pill.
  if (isOnSoPage && !isMobile) {
    return null
  }
  if (isOnSoPage && isMobile && session.status !== 'COUNTING') {
    // On mobile SO page, only show for COUNTING (PAUSED is handled on-page).
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
    if (isOnSoPage && isMobile && isCounting) {
      // Re-open the minimized counting dialog on the SO page.
      window.dispatchEvent(new CustomEvent('so-resume-counting'))
    } else {
      setCurrentPage('stock-opname')
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        key={session.id + session.status + String(isOnSoPage)}
        initial={{ opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="fixed bottom-20 right-3 z-40 md:bottom-6 md:right-6"
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

            {isOnSoPage && isMobile && isCounting ? (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                Hitungan diminimalkan · klik untuk lanjut
              </p>
            ) : isPaused ? (
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
