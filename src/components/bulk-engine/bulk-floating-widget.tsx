'use client'

/**
 * AETHER BULK ENGINE V1 — floating progress widget.
 *
 * Always mounted in the authenticated app shell. Shows a compact progress
 * pill for the active (or most recent) bulk job so the user sees progress
 * even after closing the dialog or navigating between pages.
 *
 * Positioned to not collide with the migration floating widget (which sits at
 * bottom-6 right-6). This widget stacks above it at bottom-[140px] right-6.
 *
 * Clicking the pill reopens the job detail modal.
 */

import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, CheckCircle2, AlertTriangle, XCircle, Layers, X, ListChecks,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useBulkWorker } from './bulk-worker-context'
import type { BulkJob } from '@/lib/bulk-engine/dexie-db'

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

function formatEta(ms: number): string {
  if (ms <= 0 || !isFinite(ms)) return '—'
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `${s}d`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}j ${m % 60}m`
}

function pickWidgetJob(jobs: BulkJob[]): BulkJob | null {
  const visible = jobs.filter((j) => !j.dismissedAt && j.status !== 'cancelled')
  if (visible.length === 0) return null
  const processing = visible.find((j) => j.status === 'processing')
  if (processing) return processing
  const paused = visible.find((j) => j.status === 'paused')
  if (paused) return paused
  const partial = visible.find((j) => j.status === 'partial' || j.status === 'failed')
  if (partial) return partial
  const completed = visible
    .filter((j) => j.status === 'completed')
    .sort((a, b) => (b.completedAt || b.updatedAt) - (a.completedAt || a.updatedAt))
  const top = completed[0]
  if (!top || !top.completedAt) return null
  if (Date.now() - top.completedAt > 60_000) return null
  return top
}

export function BulkFloatingWidget() {
  const { jobs, openJobModal, openQueueDrawer, dismissJob } = useBulkWorker()
  const [, setTick] = useState(0)

  // Re-render every second while a job is processing so the elapsed time
  // and ETA update live (Dexie useLiveQuery only re-renders on data changes,
  // which happen per-batch, not per-second).
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'processing')
    if (!hasActive) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [jobs])

  const job = pickWidgetJob(jobs)
  const activeCount = jobs.filter((j) => j.status === 'processing' || j.status === 'paused' || j.status === 'queued').length

  const processed = job ? job.stats.processed + job.stats.skipped : 0
  const pct = job && job.totalRows > 0 ? Math.min(100, Math.round((processed / job.totalRows) * 100)) : 0
  const elapsed = job && job.startedAt ? Date.now() - job.startedAt : 0
  const remaining = job ? Math.max(0, job.totalRows - processed) : 0
  const etaMs = job && job.status === 'processing' && processed > 0 && elapsed > 0
    ? (elapsed / processed) * remaining
    : 0

  const isProcessing = job?.status === 'processing'
  const isPaused = job?.status === 'paused'
  const isPartial = job?.status === 'partial'
  const isFailed = job?.status === 'failed'
  const isCompleted = job?.status === 'completed'

  const title = isProcessing
    ? 'Bulk berjalan'
    : isPaused
      ? 'Bulk dijeda'
      : isPartial
        ? 'Bulk sebagian'
        : isFailed
          ? 'Bulk gagal'
          : isCompleted
            ? 'Bulk selesai'
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
          className="fixed bottom-[140px] right-3 z-50 md:bottom-[140px] md:right-6"
        >
          <div className="relative w-[260px] max-w-[calc(100vw-1.5rem)]">
            {/* Main pill */}
            <button
              type="button"
              onClick={() => openJobModal(job.id)}
              className="group relative w-full overflow-hidden rounded-2xl border border-stellar-border bg-nebula/95 backdrop-blur-md shadow-2xl shadow-black/40 text-left transition-all hover:border-white/20"
            >
              <div
                className={`absolute inset-x-0 top-0 h-0.5 ${
                  isProcessing ? 'bg-emerald-500' : isPaused ? 'bg-amber-500' : isPartial ? 'bg-amber-500' : isFailed ? 'bg-red-500' : 'bg-emerald-500'
                }`}
              />
              <div className="p-3.5 space-y-2.5">
                <div className="flex items-center gap-2">
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 text-emerald-400 animate-spin shrink-0" />
                  ) : isPaused ? (
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
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
                    onClick={(e) => { e.stopPropagation(); dismissJob(job.id) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); dismissJob(job.id) } }}
                    className="text-slate-500 hover:text-white transition-colors p-0.5 -mr-1 cursor-pointer"
                    aria-label="Tutup widget"
                  >
                    <X className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 truncate">{job.label} · {job.fileName}</p>
                {(isProcessing || isPaused) && (
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
                      <span className="inline-flex items-center gap-1.5">
                        <span>{pct}% · {formatDuration(elapsed)}</span>
                        {etaMs > 0 && (
                          <span className="text-emerald-400">· ETA {formatEta(etaMs)}</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}
                {!isProcessing && !isPaused && (
                  <div className="flex items-center gap-3 text-[10px] text-slate-400 tabular-nums">
                    {job.stats.created > 0 && <span><span className="text-emerald-400 font-semibold">{job.stats.created}</span> dibuat</span>}
                    {job.stats.updated > 0 && <span><span className="text-emerald-400 font-semibold">{job.stats.updated}</span> update</span>}
                    {job.errorCount > 0 && <span><span className="text-amber-400 font-semibold">{job.errorCount}</span> error</span>}
                  </div>
                )}
                {(isPartial || isFailed) && (
                  <p className="text-[10px] text-amber-300/80">Klik untuk detail & lanjutkan</p>
                )}
              </div>
            </button>
            {/* Queue drawer toggle */}
            {activeCount > 1 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openQueueDrawer() }}
                className="absolute -top-2 -right-2 h-6 min-w-6 px-1.5 rounded-full bg-emerald-500 text-emerald-950 text-[10px] font-bold flex items-center justify-center shadow-lg border border-emerald-400"
                title="Lihat antrian job"
              >
                <ListChecks className="h-3 w-3 mr-0.5" />
                {activeCount}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
