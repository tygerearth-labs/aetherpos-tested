'use client'

/**
 * AETHER BULK ENGINE V1 — shared upload dialog.
 *
 * Reusable across all bulk flows. Renders:
 *  - File drop zone (.xlsx/.xls/.csv, ≤5MB)
 *  - Parse + preview (first 10 rows) + validation summary
 *  - Start button (writes job to Dexie, arms the worker)
 *  - Minimize button (closes dialog, job continues in background)
 *  - Template download
 *
 * When modalState = { type: 'job', jobId }, renders the live job progress
 * view instead (batch-by-batch status, elapsed, ETA, errors, retry/export).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, CheckCircle2, AlertTriangle, XCircle, Upload, FileSpreadsheet,
  Download, Play, Pause, RotateCcw, X, Minimize2, Trash2, ListChecks,
} from 'lucide-react'
import { useBulkWorker } from './bulk-worker-context'
import { getClientAdapter } from '@/lib/bulk-engine/registry-client'
import { generateTemplate } from '@/lib/bulk-engine/sheet-parse'
import type { ParsedRow } from '@/lib/bulk-engine/types'

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

export function BulkUploadDialog() {
  const { modalState, closeDialog, closeModal, startJob, openBatches, openJob, pauseJob, resumeJob, retryJob, cancelJob, removeJob, exportErrors } = useBulkWorker()

  if (modalState.type === 'closed') return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={closeModal}
      >
        <motion.div
          initial={{ scale: 0.95, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 20 }}
          className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-stellar-border bg-nebula shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {modalState.type === 'upload' && (
            <UploadView kind={modalState.kind} onClose={closeDialog} onStart={startJob} />
          )}
          {modalState.type === 'job' && openJob && (
            <JobView
              job={openJob}
              batches={openBatches}
              onClose={closeModal}
              onPause={() => pauseJob(openJob.id)}
              onResume={() => resumeJob(openJob.id)}
              onRetry={() => retryJob(openJob.id)}
              onCancel={() => cancelJob(openJob.id)}
              onRemove={() => removeJob(openJob.id)}
              onExportErrors={() => exportErrors(openJob.id)}
            />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Upload view ────────────────────────────────────────────────────────────

function UploadView({
  kind,
  onClose,
  onStart,
}: {
  kind: string
  onClose: () => void
  onStart: (file: File, kind: string, config?: Record<string, unknown>) => Promise<void>
}) {
  const adapter = getClientAdapter(kind)
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [validCount, setValidCount] = useState(0)
  const [invalidCount, setInvalidCount] = useState(0)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isMigration = kind === 'migration-products'

  const handleFile = useCallback(
    async (f: File) => {
      if (!adapter) return
      if (f.size > 5 * 1024 * 1024) {
        alert('Ukuran file maksimal 5MB.')
        return
      }
      setFile(f)
      setParsing(true)
      setRows([])
      setWarnings([])
      setValidCount(0)
      setInvalidCount(0)
      try {
        const parsed = await adapter.parseFile(f)
        setRows(parsed.rows)
        setWarnings(parsed.warnings || [])
        // Validate (only for row-mode; migration has no rows client-side).
        if (adapter.executionMode === 'rows' && parsed.rows.length > 0) {
          let valid = 0
          let invalid = 0
          for (const r of parsed.rows) {
            const v = adapter.validateRow(r)
            if (v.valid) valid++
            else invalid++
          }
          setValidCount(valid)
          setInvalidCount(invalid)
        }
      } catch (err) {
        alert('Gagal parse file: ' + (err instanceof Error ? err.message : String(err)))
        setFile(null)
      } finally {
        setParsing(false)
      }
    },
    [adapter],
  )

  const handleDownloadTemplate = useCallback(async () => {
    if (!adapter) return
    if (adapter.templateEndpoint) {
      // Download from server (migration, purchase).
      const params = isMigration && config.mode ? `?mode=${config.mode}` : ''
      window.open(`${adapter.templateEndpoint}${params}`, '_blank')
      return
    }
    // Generate client-side.
    try {
      const blob = await generateTemplate(adapter.templateColumns)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `template-${kind}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      alert('Gagal membuat template: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [adapter, kind, isMigration, config.mode])

  const handleStart = useCallback(async () => {
    if (!file || !adapter) return
    await onStart(file, kind, config)
  }, [file, adapter, kind, config, onStart])

  if (!adapter) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">Adapter "{kind}" tidak ditemukan.</p>
        <button onClick={onClose} className="mt-4 text-xs text-slate-400 hover:text-white">Tutup</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col max-h-[90vh]">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-stellar-border">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <FileSpreadsheet className="h-4.5 w-4.5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">{adapter.label}</h2>
            <p className="text-[11px] text-slate-400">{adapter.description}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white p-1" aria-label="Tutup">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Migration mode selector */}
        {isMigration && (
          <div>
            <label className="text-[11px] font-medium text-slate-400 mb-1.5 block">Mode Migrasi</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'product_only', l: 'Produk Saja' },
                { v: 'product_stock', l: 'Produk + Stok' },
                { v: 'product_inventory', l: 'Produk + Bahan + BOM' },
              ].map((m) => (
                <button
                  key={m.v}
                  onClick={() => setConfig({ mode: m.v })}
                  className={`px-3 py-2 rounded-lg text-[11px] font-medium border transition-all ${
                    config.mode === m.v
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-white/[0.03] border-white/10 text-slate-400 hover:border-white/20'
                  }`}
                >
                  {m.l}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Template download */}
        <button
          onClick={handleDownloadTemplate}
          className="inline-flex items-center gap-2 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Download template Excel
        </button>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files[0]
            if (f) handleFile(f)
          }}
          onClick={() => inputRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all ${
            dragOver
              ? 'border-emerald-500/50 bg-emerald-500/5'
              : 'border-white/15 bg-white/[0.02] hover:border-white/25'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
          {parsing ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
              <span className="text-[11px] text-slate-400">Memproses file…</span>
            </div>
          ) : file ? (
            <div className="flex flex-col items-center gap-1.5">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              <span className="text-xs text-white font-medium">{file.name}</span>
              <span className="text-[10px] text-slate-500">{(file.size / 1024).toFixed(1)} KB</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-6 w-6 text-slate-500" />
              <span className="text-xs text-slate-400">Klik atau drag file Excel ke sini</span>
              <span className="text-[10px] text-slate-600">.xlsx, .xls, .csv (maks 5MB)</span>
            </div>
          )}
        </div>

        {/* Validation summary */}
        {file && !parsing && adapter.executionMode === 'rows' && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-white/[0.03] border border-white/10 p-2.5">
              <div className="text-[10px] text-slate-500">Total Baris</div>
              <div className="text-sm font-semibold text-white">{rows.length}</div>
            </div>
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-2.5">
              <div className="text-[10px] text-emerald-400/70">Valid</div>
              <div className="text-sm font-semibold text-emerald-400">{validCount}</div>
            </div>
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-2.5">
              <div className="text-[10px] text-amber-400/70">Invalid</div>
              <div className="text-sm font-semibold text-amber-400">{invalidCount}</div>
            </div>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[11px] font-medium text-amber-400">Peringatan</span>
            </div>
            <ul className="text-[10px] text-amber-300/80 space-y-0.5">
              {warnings.map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
          </div>
        )}

        {/* Preview table (first 5 rows) */}
        {rows.length > 0 && adapter.executionMode === 'rows' && (
          <div>
            <div className="text-[11px] font-medium text-slate-400 mb-1.5">Preview (5 baris pertama)</div>
            <div className="rounded-lg border border-white/10 overflow-hidden max-h-48 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="bg-white/[0.03] sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-slate-500 font-medium">#</th>
                    {adapter.templateColumns.slice(0, 6).map((c) => (
                      <th key={c.key} className="px-2 py-1.5 text-left text-slate-500 font-medium">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r) => (
                    <tr key={r.rowIndex} className="border-t border-white/5">
                      <td className="px-2 py-1.5 text-slate-600">{r.rowIndex}</td>
                      {adapter.templateColumns.slice(0, 6).map((c) => (
                        <td key={c.key} className="px-2 py-1.5 text-slate-300 truncate max-w-[100px]">
                          {String(r.data[c.key] ?? '').slice(0, 30)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Migration: batch estimate */}
        {file && isMigration && (
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-3 text-[11px] text-emerald-300/80">
            File akan diproses dalam batch 50 produk. Total batch dihitung otomatis saat mulai.
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 p-4 border-t border-stellar-border">
        <span className="text-[10px] text-slate-600">Batch 50 · Concurrency 1 · Atomic per batch</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] text-slate-400 hover:text-white transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleStart}
            disabled={!file || parsing || (isMigration && !config.mode)}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-semibold text-emerald-950 transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            Mulai
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Job progress view ─────────────────────────────────────────────────────

function JobView({
  job,
  batches,
  onClose,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onRemove,
  onExportErrors,
}: {
  job: import('@/lib/bulk-engine/dexie-db').BulkJob
  batches: import('@/lib/bulk-engine/dexie-db').BulkBatch[]
  onClose: () => void
  onPause: () => void
  onResume: () => void
  onRetry: () => void
  onCancel: () => void
  onRemove: () => void
  onExportErrors: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!job.startedAt) return
    const t = setInterval(() => setElapsed(Date.now() - job.startedAt!), 1000)
    return () => clearInterval(t)
  }, [job.startedAt])

  const processed = job.stats.processed + job.stats.skipped
  const pct = job.totalRows > 0 ? Math.min(100, Math.round((processed / job.totalRows) * 100)) : 0
  const isProcessing = job.status === 'processing'
  const isPaused = job.status === 'paused'
  const isPartial = job.status === 'partial'
  const isFailed = job.status === 'failed'
  const isCompleted = job.status === 'completed'
  const isCancelled = job.status === 'cancelled'
  const currentBatch = batches.find((b) => b.status === 'processing')

  const statusColor = isProcessing ? 'emerald' : isPaused ? 'amber' : isPartial ? 'amber' : isFailed ? 'red' : isCompleted ? 'emerald' : 'slate'
  const statusLabel = isProcessing ? 'Berjalan' : isPaused ? 'Dijeda' : isPartial ? 'Sebagian' : isFailed ? 'Gagal' : isCompleted ? 'Selesai' : 'Dibatalkan'

  return (
    <div className="flex flex-col max-h-[90vh]">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-stellar-border">
        <div className="flex items-center gap-3">
          {isProcessing && <Loader2 className="h-4.5 w-4.5 text-emerald-400 animate-spin" />}
          {isCompleted && <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400" />}
          {isPartial && <AlertTriangle className="h-4.5 w-4.5 text-amber-400" />}
          {isFailed && <XCircle className="h-4.5 w-4.5 text-red-400" />}
          <div>
            <h2 className="text-sm font-semibold text-white">{job.label}</h2>
            <p className="text-[11px] text-slate-400 truncate max-w-[300px]">{job.fileName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Minimize */}
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1" aria-label="Minimize" title="Minimize (job tetap berjalan)">
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold bg-${statusColor}-500/15 text-${statusColor}-400 border border-${statusColor}-500/20`}>
            {statusLabel}
          </span>
          <span className="text-[10px] text-slate-500">{formatDuration(elapsed)}</span>
        </div>

        {/* Progress bar */}
        {(isProcessing || isPaused) && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">{processed} / {job.totalRows} baris</span>
              <span className="text-slate-500">{pct}%</span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            {currentBatch && (
              <div className="text-[10px] text-slate-500">
                Batch {currentBatch.batchIndex + 1}/{job.totalBatches} · attempt {currentBatch.attemptCount}
              </div>
            )}
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2">
          <StatBox label="Dibuat" value={job.stats.created} color="emerald" />
          <StatBox label="Diperbarui" value={job.stats.updated} color="emerald" />
          <StatBox label="Dilewati" value={job.stats.skipped} color="slate" />
        </div>
        {job.errorCount > 0 && (
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[11px] text-amber-300">{job.errorCount} baris error</span>
            </div>
            <button onClick={onExportErrors} className="inline-flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300">
              <Download className="h-3 w-3" /> Export
            </button>
          </div>
        )}

        {/* Summary (completed) */}
        {job.summary && (isCompleted || isPartial) && (
          <div className="rounded-lg bg-white/[0.03] border border-white/10 p-3">
            <div className="text-[11px] font-medium text-white mb-1">{job.summary.label}</div>
            <ul className="text-[10px] text-slate-400 space-y-0.5">
              {job.summary.details.map((d, i) => <li key={i}>• {d}</li>)}
            </ul>
          </div>
        )}

        {/* Batch list */}
        {batches.length > 0 && (
          <div>
            <div className="text-[11px] font-medium text-slate-400 mb-1.5">Batch ({batches.length})</div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {batches.map((b) => (
                <div key={b.id} className="flex items-center gap-2 text-[10px] py-1">
                  {b.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />}
                  {b.status === 'processing' && <Loader2 className="h-3 w-3 text-emerald-400 animate-spin shrink-0" />}
                  {b.status === 'failed' && <XCircle className="h-3 w-3 text-red-400 shrink-0" />}
                  {b.status === 'queued' && <div className="h-3 w-3 rounded-full border border-slate-600 shrink-0" />}
                  <span className="text-slate-400 w-16">Batch {b.batchIndex + 1}</span>
                  <span className="text-slate-500 flex-1 truncate">
                    {b.status === 'completed' && `${b.stats.created + b.stats.updated + b.stats.skipped} diproses`}
                    {b.status === 'processing' && 'Memproses…'}
                    {b.status === 'failed' && (b.error || 'Gagal')}
                    {b.status === 'queued' && 'Antri'}
                  </span>
                  {b.durationMs > 0 && <span className="text-slate-600">{(b.durationMs / 1000).toFixed(1)}s</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last error */}
        {job.lastBatchError && (
          <div className="rounded-lg bg-red-500/5 border border-red-500/15 p-2.5">
            <div className="text-[10px] text-red-400 font-medium mb-0.5">Error terakhir:</div>
            <div className="text-[10px] text-red-300/80">{job.lastBatchError}</div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-2 p-4 border-t border-stellar-border">
        <div className="flex items-center gap-1">
          {(isCompleted || isPartial || isFailed || isCancelled) && (
            <button onClick={onRemove} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] text-slate-500 hover:text-red-400 transition-colors">
              <Trash2 className="h-3 w-3" /> Hapus
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <button onClick={onPause} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.08] text-[11px] text-slate-300 transition-colors">
              <Pause className="h-3.5 w-3.5" /> Jeda
            </button>
          )}
          {isPaused && (
            <button onClick={onResume} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[11px] font-semibold text-emerald-950 transition-colors">
              <Play className="h-3.5 w-3.5" /> Lanjutkan
            </button>
          )}
          {(isPartial || isFailed) && (
            <button onClick={onRetry} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[11px] font-semibold text-emerald-950 transition-colors">
              <RotateCcw className="h-3.5 w-3.5" /> Coba Ulang
            </button>
          )}
          {(isProcessing || isPaused) && (
            <button onClick={onCancel} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-[11px] text-red-400 transition-colors">
              <X className="h-3.5 w-3.5" /> Batalkan
            </button>
          )}
          <button onClick={onClose} className="px-3 py-1.5 text-[11px] text-slate-400 hover:text-white transition-colors">
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg bg-${color}-500/5 border border-${color}-500/15 p-2.5`}>
      <div className={`text-[10px] text-${color}-400/70`}>{label}</div>
      <div className={`text-sm font-semibold text-${color}-400`}>{value}</div>
    </div>
  )
}
