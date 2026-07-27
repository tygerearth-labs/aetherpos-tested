'use client'

/**
 * AETHER BULK ENGINE V1 — queue drawer.
 *
 * Slide-in drawer listing all bulk jobs (queued/processing/paused/completed/
 * partial/failed/cancelled) with per-job actions: pause/resume/retry/cancel/
 * export-errors/remove. Lets the user manage multiple queued jobs.
 */

import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, CheckCircle2, AlertTriangle, XCircle, X, Pause, Play, RotateCcw,
  Trash2, Download, Clock,
} from 'lucide-react'
import { useBulkWorker } from './bulk-worker-context'
import type { BulkJob } from '@/lib/bulk-engine/dexie-db'

const STATUS_META: Record<string, { label: string; color: string; icon: 'spinner' | 'check' | 'alert' | 'x' | 'clock' }> = {
  queued: { label: 'Antri', color: 'slate', icon: 'clock' },
  processing: { label: 'Berjalan', color: 'emerald', icon: 'spinner' },
  paused: { label: 'Dijeda', color: 'amber', icon: 'alert' },
  completed: { label: 'Selesai', color: 'emerald', icon: 'check' },
  partial: { label: 'Sebagian', color: 'amber', icon: 'alert' },
  failed: { label: 'Gagal', color: 'red', icon: 'x' },
  cancelled: { label: 'Dibatalkan', color: 'slate', icon: 'x' },
}

function StatusIcon({ status }: { status: string }) {
  const meta = STATUS_META[status] || STATUS_META.queued
  if (meta.icon === 'spinner') return <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin shrink-0" />
  if (meta.icon === 'check') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
  if (meta.icon === 'alert') return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
  if (meta.icon === 'x') return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
  return <Clock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
}

function timeAgo(ts: number | null): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'baru saja'
  if (m < 60) return `${m}m lalu`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}j lalu`
  return `${Math.floor(h / 24)}h lalu`
}

export function BulkQueueDrawer() {
  const { jobs, queueDrawerOpen, closeQueueDrawer, openJobModal, pauseJob, resumeJob, retryJob, cancelJob, removeJob, exportErrors } = useBulkWorker()

  return (
    <AnimatePresence>
      {queueDrawerOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[85] bg-black/50"
            onClick={closeQueueDrawer}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="fixed top-0 right-0 bottom-0 z-[86] w-full max-w-md bg-nebula border-l border-stellar-border shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-stellar-border">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Antrian Bulk Job</h2>
                <span className="px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[10px] text-slate-400">{jobs.length}</span>
              </div>
              <button onClick={closeQueueDrawer} className="text-slate-500 hover:text-white p-1" aria-label="Tutup">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Job list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Clock className="h-8 w-8 text-slate-700 mb-2" />
                  <p className="text-[11px] text-slate-500">Belum ada bulk job.</p>
                  <p className="text-[10px] text-slate-600">Mulai import dari halaman produk, pelanggan, dst.</p>
                </div>
              ) : (
                jobs.map((job) => {
                  const meta = STATUS_META[job.status] || STATUS_META.queued
                  const processed = job.stats.processed + job.stats.skipped
                  const pct = job.totalRows > 0 ? Math.min(100, Math.round((processed / job.totalRows) * 100)) : 0
                  return (
                    <div
                      key={job.id}
                      className="rounded-xl border border-white/10 bg-white/[0.02] p-3 hover:border-white/15 transition-colors"
                    >
                      <div className="flex items-start gap-2">
                        <StatusIcon status={job.status} />
                        <div className="flex-1 min-w-0">
                          <button
                            onClick={() => { openJobModal(job.id); closeQueueDrawer() }}
                            className="text-left w-full"
                          >
                            <p className="text-xs font-medium text-white truncate">{job.label}</p>
                            <p className="text-[10px] text-slate-500 truncate">{job.fileName}</p>
                          </button>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium bg-${meta.color}-500/10 text-${meta.color}-400`}>
                              {meta.label}
                            </span>
                            <span className="text-[9px] text-slate-600">{timeAgo(job.completedAt || job.updatedAt)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      {(job.status === 'processing' || job.status === 'paused') && (
                        <div className="mt-2 space-y-1">
                          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-500">
                            <span>{processed}/{job.totalRows}</span>
                            <span>Batch {(job.currentBatch || 0) + 1}/{job.totalBatches}</span>
                          </div>
                        </div>
                      )}

                      {/* Stats */}
                      {(job.status === 'completed' || job.status === 'partial' || job.status === 'failed') && (
                        <div className="flex items-center gap-2 mt-1.5 text-[9px] text-slate-500">
                          {job.stats.created > 0 && <span className="text-emerald-400">{job.stats.created} buat</span>}
                          {job.stats.updated > 0 && <span className="text-emerald-400">{job.stats.updated} update</span>}
                          {job.errorCount > 0 && <span className="text-amber-400">{job.errorCount} error</span>}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-1 mt-2 -ml-1">
                        {job.status === 'processing' && (
                          <button onClick={() => pauseJob(job.id)} className="p-1 rounded hover:bg-white/[0.06] text-slate-400 hover:text-amber-400" title="Jeda">
                            <Pause className="h-3 w-3" />
                          </button>
                        )}
                        {job.status === 'paused' && (
                          <button onClick={() => resumeJob(job.id)} className="p-1 rounded hover:bg-white/[0.06] text-slate-400 hover:text-emerald-400" title="Lanjutkan">
                            <Play className="h-3 w-3" />
                          </button>
                        )}
                        {(job.status === 'partial' || job.status === 'failed') && (
                          <button onClick={() => retryJob(job.id)} className="p-1 rounded hover:bg-white/[0.06] text-slate-400 hover:text-emerald-400" title="Coba ulang">
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                        {job.errorCount > 0 && (
                          <button onClick={() => exportErrors(job.id)} className="p-1 rounded hover:bg-white/[0.06] text-slate-400 hover:text-amber-400" title="Export error">
                            <Download className="h-3 w-3" />
                          </button>
                        )}
                        {(job.status === 'processing' || job.status === 'paused' || job.status === 'queued') && (
                          <button onClick={() => cancelJob(job.id)} className="p-1 rounded hover:bg-white/[0.06] text-slate-400 hover:text-red-400" title="Batalkan">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                        {(job.status === 'completed' || job.status === 'partial' || job.status === 'failed' || job.status === 'cancelled') && (
                          <button onClick={() => removeJob(job.id)} className="p-1 rounded hover:bg-white/[0.06] text-slate-400 hover:text-red-400" title="Hapus">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
