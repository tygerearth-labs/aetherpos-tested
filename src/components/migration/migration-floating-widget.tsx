'use client'

/**
 * MIG-BATCH-V3: Global floating migration widget.
 *
 * Always mounted in the authenticated app shell. Shows a compact progress pill
 * for the active (or most recent) migration job so the user sees progress even
 * after closing the detail modal or navigating between pages.
 *
 * Clicking the pill reopens the detail modal.
 */

import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Layers,
  X,
} from 'lucide-react'
import { useMigrationProcessor } from './migration-context'
import type { MigrationJob } from '@/lib/migration/dexie-db'

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/** Pick the job the widget should surface (priority: PROCESSING > PARTIAL/FAILED > recent COMPLETED). */
function pickWidgetJob(jobs: MigrationJob[]): MigrationJob | null {
  const visible = jobs.filter((j) => j.status !== 'DISMISSED')
  if (visible.length === 0) return null
  const processing = visible.find((j) => j.status === 'PROCESSING')
  if (processing) return processing
  const partial = visible.find((j) => j.status === 'PARTIAL' || j.status === 'FAILED')
  if (partial) return partial
  // Most recent completed (auto-hide after 60s).
  const completed = visible
    .filter((j) => j.status === 'COMPLETED' || j.status === 'COMPLETED_WITH_ERRORS')
    .sort((a, b) => (b.completedAt || b.updatedAt) - (a.completedAt || a.updatedAt))
  const top = completed[0]
  if (!top || !top.completedAt) return null
  if (Date.now() - top.completedAt > 60_000) return null
  return top
}

export function MigrationFloatingWidget() {
  const { jobs, openModal, dismissJob } = useMigrationProcessor()

  const job = pickWidgetJob(jobs)

  const processed = job
    ? job.createdCount + job.skippedCount + job.failedCount
    : 0
  const pct = job && job.totalProducts > 0
    ? Math.min(100, Math.round((processed / job.totalProducts) * 100))
    : 0
  const elapsed = job && job.startedAt ? Date.now() - job.startedAt : 0

  const isProcessing = job?.status === 'PROCESSING'
  const isPartial = job?.status === 'PARTIAL'
  const isFailed = job?.status === 'FAILED'
  const isCompleted = job?.status === 'COMPLETED' || job?.status === 'COMPLETED_WITH_ERRORS'

  const title = isProcessing
    ? 'Migrasi berjalan'
    : isPartial
      ? 'Migrasi sebagian'
      : isFailed
        ? 'Migrasi gagal'
        : isCompleted
          ? 'Migrasi selesai'
          : ''

  return (
    <AnimatePresence>
      {job && (
        <motion.div
          key={job.id}
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-20 right-3 z-50 md:bottom-6 md:right-6"
        >
          <button
            type="button"
            onClick={() => openModal(job.id)}
            className="group relative w-[260px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-stellar-border bg-nebula/95 backdrop-blur-md shadow-2xl shadow-black/40 text-left transition-all hover:border-white/20"
          >
            {/* status accent bar */}
            <div
              className={`absolute inset-x-0 top-0 h-0.5 ${
                isProcessing
                  ? 'bg-emerald-500'
                  : isPartial
                    ? 'bg-amber-500'
                    : isFailed
                      ? 'bg-red-500'
                      : 'bg-emerald-500'
              }`}
            />

            <div className="p-3.5 space-y-2.5">
              {/* header */}
              <div className="flex items-center gap-2">
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 text-emerald-400 animate-spin shrink-0" />
                ) : isPartial ? (
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                ) : isFailed ? (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                )}
                <span className="text-xs font-semibold text-white flex-1 truncate">{title}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    dismissJob(job.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      dismissJob(job.id)
                    }
                  }}
                  className="text-slate-500 hover:text-white transition-colors p-0.5 -mr-1 cursor-pointer"
                  aria-label="Tutup widget"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              </div>

              {/* file name */}
              <p className="text-[10px] text-slate-400 truncate">{job.fileName}</p>

              {/* progress bar (only while processing) */}
              {isProcessing && (
                <div className="space-y-1">
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Layers className="h-2.5 w-2.5" />
                      Batch {(job.currentBatch || 0) + 1}/{job.totalBatches || '?'}
                    </span>
                    <span>{pct}% · {formatDuration(elapsed)}</span>
                  </div>
                </div>
              )}

              {/* completed/partial summary */}
              {!isProcessing && (
                <div className="flex items-center gap-3 text-[10px] text-slate-400 tabular-nums">
                  <span><span className="text-emerald-400 font-semibold">{job.createdCount}</span> dibuat</span>
                  <span><span className="text-slate-300 font-semibold">{job.skippedCount}</span> dilewati</span>
                  {job.failedCount > 0 && (
                    <span><span className="text-amber-400 font-semibold">{job.failedCount}</span> gagal</span>
                  )}
                </div>
              )}

              {/* partial/failed retry hint */}
              {(isPartial || isFailed) && (
                <p className="text-[10px] text-amber-300/80">Klik untuk melihat detail & lanjutkan</p>
              )}
            </div>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
