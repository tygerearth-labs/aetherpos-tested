'use client'

/**
 * AETHER BULK ENGINE — shared upload dialog (V2 redesigned UX).
 *
 * Redesigned for clearer visual hierarchy and a proper step flow:
 *  - Upload view: Template card → Drop zone → Validation stats → Preview → CTA
 *  - Job view: Hero header → Progress hero → Result hero → Batch list → Footer
 *
 * Security: template download always uses fetch→blob→objectURL→click so the
 * API endpoint URL is never exposed in a new browser tab address bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, CheckCircle2, AlertTriangle, XCircle, Upload, FileSpreadsheet,
  Download, Play, Pause, RotateCcw, X, Minimize2, Trash2, Clock, FileDown,
  Info, Layers, ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { useBulkWorker } from './bulk-worker-context'
import { getClientAdapter } from '@/lib/bulk-engine/registry-client'
import { generateTemplate } from '@/lib/bulk-engine/sheet-parse'
import { useCriticalActivity } from '@/hooks/use-critical-activity'
import type { ParsedRow } from '@/lib/bulk-engine/types'

// ── Helpers ────────────────────────────────────────────────────────────────

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
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}d`
  const h = Math.floor(m / 60)
  return `${h}j ${m % 60}m`
}

/** Fetch a server-side template as a blob and trigger a download without exposing the URL. */
async function downloadBlobFromUrl(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gagal mengunduh template (${res.status})${text ? `: ${text.slice(0, 120)}` : ''}`)
  }
  const blob = await res.blob()
  // Prefer server-provided filename via Content-Disposition; fall back to fallbackName.
  const cd = res.headers.get('Content-Disposition') || ''
  const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i)
  const fileName = match ? decodeURIComponent(match[1]) : fallbackName
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(objUrl), 1500)
}

// ── Container ──────────────────────────────────────────────────────────────

export function BulkUploadDialog() {
  const {
    modalState, closeDialog, closeModal, startJob, openBatches, openJob,
    pauseJob, resumeJob, retryJob, cancelJob, removeJob, exportErrors,
  } = useBulkWorker()

  if (modalState.type === 'closed') return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-md p-3 sm:p-4"
        onClick={closeModal}
      >
        <motion.div
          initial={{ scale: 0.96, y: 16, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: 16, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="w-full max-w-xl max-h-[92vh] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0B1220] shadow-2xl shadow-black/60"
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
  const [downloading, setDownloading] = useState(false)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [validCount, setValidCount] = useState(0)
  const [invalidCount, setInvalidCount] = useState(0)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // File-upload critical activity covers the *parsing* window between the
  // user picking a file and the bulk job entering 'processing' state. Once
  // the job is processing, bulk-job takes over (handled by the worker
  // provider). Severity `interrupt` — parsing restarts cleanly on reload.
  useCriticalActivity(
    'file-upload',
    'file-upload-bulk-dialog',
    'Parsing file bulk sedang berjalan',
    parsing,
    'interrupt',
  )

  const isMigration = kind === 'migration-products'

  const handleFile = useCallback(
    async (f: File) => {
      if (!adapter) return
      if (f.size > 5 * 1024 * 1024) {
        toast.error('Ukuran file maksimal 5MB')
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
        toast.error('Gagal parse file', {
          description: err instanceof Error ? err.message : String(err),
        })
        setFile(null)
      } finally {
        setParsing(false)
      }
    },
    [adapter],
  )

  const handleDownloadTemplate = useCallback(async () => {
    if (!adapter) return
    setDownloading(true)
    try {
      if (adapter.templateEndpoint) {
        const params = isMigration && config.mode ? `?mode=${config.mode}` : ''
        const safeKind = kind.replace(/[^a-zA-Z0-9-_]/g, '-')
        await downloadBlobFromUrl(
          `${adapter.templateEndpoint}${params}`,
          `template-${safeKind}.xlsx`,
        )
      } else {
        const blob = await generateTemplate(adapter.templateColumns)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const safeKind = kind.replace(/[^a-zA-Z0-9-_]/g, '-')
        a.download = `template-${safeKind}.xlsx`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1500)
      }
      toast.success('Template berhasil diunduh')
    } catch (err) {
      toast.error('Gagal mengunduh template', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setDownloading(false)
    }
  }, [adapter, kind, isMigration, config.mode])

  const handleStart = useCallback(async () => {
    if (!file || !adapter) return
    await onStart(file, kind, config)
  }, [file, adapter, kind, config, onStart])

  if (!adapter) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">Adapter &quot;{kind}&quot; tidak ditemukan.</p>
        <button onClick={onClose} className="mt-4 text-xs text-slate-400 hover:text-white">Tutup</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col max-h-[92vh]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">{adapter.label}</h2>
            <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">{adapter.description}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white p-1.5 -mr-1 rounded-lg hover:bg-white/[0.05] transition-colors shrink-0"
          aria-label="Tutup"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Migration mode selector */}
        {isMigration && (
          <div>
            <label className="text-[11px] font-medium text-slate-400 mb-1.5 block uppercase tracking-wide">
              Mode Migrasi
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'product_only', l: 'Produk Saja' },
                { v: 'product_stock', l: 'Produk + Stok' },
                { v: 'product_inventory', l: 'Produk + Bahan + BOM' },
              ].map((m) => (
                <button
                  key={m.v}
                  onClick={() => setConfig({ mode: m.v })}
                  className={`px-2.5 py-2 rounded-lg text-[11px] font-medium border transition-all ${
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

        {/* Step 1: Template card */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
              <FileDown className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-wider">Langkah 1</span>
              </div>
              <p className="text-xs font-medium text-white mt-0.5">Unduh template Excel</p>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                Pakai template agar kolom sesuai &amp; data langsung terbaca sistem.
              </p>
              <button
                onClick={handleDownloadTemplate}
                disabled={downloading}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 text-[11px] font-medium text-emerald-300 transition-colors disabled:opacity-50"
              >
                {downloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {downloading ? 'Mengunduh…' : 'Download template'}
              </button>
            </div>
          </div>
        </div>

        {/* Step 2: Drop zone */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-wider">Langkah 2</span>
            <span className="text-xs font-medium text-white">Upload file Excel</span>
          </div>
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
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
            className={`rounded-xl border-2 border-dashed p-7 text-center cursor-pointer transition-all ${
              dragOver
                ? 'border-emerald-500/50 bg-emerald-500/[0.06]'
                : file
                  ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
                  : 'border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.03]'
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
                <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
                <span className="text-xs text-slate-400">Memproses file…</span>
              </div>
            ) : file ? (
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-10 w-10 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
                <span className="text-xs text-white font-medium">{file.name}</span>
                <span className="text-[10px] text-slate-500">{(file.size / 1024).toFixed(1)} KB · klik untuk ganti</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="h-10 w-10 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                  <Upload className="h-5 w-5 text-slate-400" />
                </div>
                <span className="text-xs text-slate-300 font-medium">Klik atau drag file ke sini</span>
                <span className="text-[10px] text-slate-600">.xlsx, .xls, .csv · maks 5 MB</span>
              </div>
            )}
          </div>
        </div>

        {/* Validation summary */}
        {file && !parsing && adapter.executionMode === 'rows' && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <ValidationStat label="Total Baris" value={rows.length} tone="neutral" />
            <ValidationStat label="Valid" value={validCount} tone="emerald" />
            <ValidationStat label="Invalid" value={invalidCount} tone={invalidCount > 0 ? 'amber' : 'neutral'} />
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="rounded-xl bg-amber-500/[0.06] border border-amber-500/20 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px] font-semibold text-amber-300">Peringatan parsing</span>
            </div>
            <ul className="text-[10px] text-amber-200/80 space-y-0.5 ml-5 list-disc">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        {/* Preview table */}
        {rows.length > 0 && adapter.executionMode === 'rows' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-slate-400">Preview (5 baris pertama)</span>
              <span className="text-[10px] text-slate-600">{rows.length} total baris</span>
            </div>
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <div className="max-h-44 overflow-y-auto aether-scroll">
                <table className="w-full text-[10px]">
                  <thead className="bg-white/[0.04] sticky top-0 z-10">
                    <tr>
                      <th className="px-2.5 py-2 text-left text-slate-500 font-medium w-8">#</th>
                      {adapter.templateColumns.slice(0, 6).map((c) => (
                        <th key={c.key} className="px-2.5 py-2 text-left text-slate-400 font-medium whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r) => (
                      <tr key={r.rowIndex} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="px-2.5 py-1.5 text-slate-600">{r.rowIndex}</td>
                        {adapter.templateColumns.slice(0, 6).map((c) => (
                          <td key={c.key} className="px-2.5 py-1.5 text-slate-300 truncate max-w-[110px]">
                            {String(r.data[c.key] ?? '').slice(0, 30) || <span className="text-slate-700">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Migration: batch estimate */}
        {file && isMigration && (
          <div className="rounded-xl bg-emerald-500/[0.05] border border-emerald-500/15 p-3 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <span className="text-[11px] text-emerald-200/80 leading-relaxed">
              File diproses dalam batch 50 produk. Total batch dihitung otomatis saat mulai.
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-white/[0.06] bg-white/[0.01]">
        <span className="text-[10px] text-slate-600 hidden sm:inline-flex items-center gap-1.5">
          <Layers className="h-3 w-3" />
          Batch 50 · Concurrency 1 · Atomic per batch
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] font-medium text-slate-400 hover:text-white transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleStart}
            disabled={!file || parsing || (isMigration && !config.mode)}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-semibold text-emerald-950 transition-colors shadow-lg shadow-emerald-500/20 disabled:shadow-none"
          >
            <Play className="h-3.5 w-3.5" />
            Mulai Proses
          </button>
        </div>
      </div>
    </div>
  )
}

function ValidationStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'neutral' | 'emerald' | 'amber'
}) {
  const styles =
    tone === 'emerald'
      ? 'bg-emerald-500/[0.06] border-emerald-500/20 text-emerald-300'
      : tone === 'amber'
        ? 'bg-amber-500/[0.06] border-amber-500/20 text-amber-300'
        : 'bg-white/[0.03] border-white/[0.08] text-slate-300'
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${styles}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-sm font-bold mt-0.5">{value}</div>
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
    // Prime elapsed immediately so the first render shows the right value
    // before the interval ticks. This is a one-shot sync with external time,
    // not a cascading state update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsed(Date.now() - job.startedAt)
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

  const remaining = Math.max(0, job.totalRows - processed)
  const etaMs = isProcessing && processed > 0 && elapsed > 0 ? (elapsed / processed) * remaining : 0

  const successCount = job.stats.created + job.stats.updated
  const skippedCount = job.stats.skipped
  const failedCount = job.errorCount
  const hasResult = isCompleted || isPartial || isFailed

  const heroTone = isFailed ? 'red' : isPartial ? 'amber' : isCompleted ? 'emerald' : isPaused ? 'amber' : 'emerald'
  const heroLabel = isProcessing ? 'Sedang memproses' : isPaused ? 'Dijeda' : isPartial ? 'Sebagian berhasil' : isFailed ? 'Gagal' : isCompleted ? 'Selesai' : 'Dibatalkan'

  return (
    <div className="flex flex-col max-h-[92vh]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${
            heroTone === 'emerald'
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : heroTone === 'amber'
                ? 'bg-amber-500/10 border-amber-500/20'
                : 'bg-red-500/10 border-red-500/20'
          }`}>
            {isProcessing && <Loader2 className={`h-5 w-5 animate-spin ${heroTone === 'amber' ? 'text-amber-400' : 'text-emerald-400'}`} />}
            {isCompleted && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
            {isPartial && <AlertTriangle className="h-5 w-5 text-amber-400" />}
            {isFailed && <XCircle className="h-5 w-5 text-red-400" />}
            {isPaused && <Pause className="h-5 w-5 text-amber-400" />}
            {isCancelled && <XCircle className="h-5 w-5 text-slate-500" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">{job.label}</h2>
            <p className="text-[11px] text-slate-400 truncate max-w-[280px] mt-0.5">{job.fileName}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white p-1.5 -mr-1 rounded-lg hover:bg-white/[0.05] transition-colors shrink-0"
          aria-label="Minimize"
          title="Minimize (job tetap berjalan)"
        >
          <Minimize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Hero: progress OR result */}
        {!hasResult ? (
          <ProgressHero
            tone={heroTone}
            label={heroLabel}
            pct={pct}
            processed={processed}
            total={job.totalRows}
            elapsed={elapsed}
            etaMs={etaMs}
            isProcessing={isProcessing}
            currentBatch={currentBatch}
            totalBatches={job.totalBatches}
          />
        ) : (
          <ResultHero
            tone={heroTone}
            label={heroLabel}
            elapsed={elapsed}
            successCount={successCount}
            skippedCount={skippedCount}
            failedCount={failedCount}
            isCompleted={isCompleted}
            isPartial={isPartial}
            isFailed={isFailed}
            onExportErrors={onExportErrors}
          />
        )}

        {/* Live stats grid (during processing, not in result view) */}
        {!hasResult && (
          <div className="grid grid-cols-3 gap-2">
            <LiveStat label="Dibuat" value={job.stats.created} tone="emerald" />
            <LiveStat label="Diperbarui" value={job.stats.updated} tone="emerald" />
            <LiveStat label="Dilewati" value={job.stats.skipped} tone="slate" />
          </div>
        )}

        {/* Error during processing */}
        {job.errorCount > 0 && !hasResult && (
          <div className="rounded-xl bg-amber-500/[0.06] border border-amber-500/20 p-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px] text-amber-300 truncate">{job.errorCount} baris error</span>
            </div>
            <button
              onClick={onExportErrors}
              className="inline-flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 font-medium shrink-0"
            >
              <Download className="h-3 w-3" /> Export
            </button>
          </div>
        )}

        {/* Summary details (completed) */}
        {job.summary && (isCompleted || isPartial) && (
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
            <div className="text-[11px] font-medium text-white mb-1.5">{job.summary.label}</div>
            <ul className="text-[10px] text-slate-400 space-y-0.5">
              {job.summary.details.map((d, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-slate-600 mt-0.5">•</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Batch list */}
        {batches.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-slate-400">Batch ({batches.length})</span>
              <span className="text-[10px] text-slate-600">{batches.filter((b) => b.status === 'completed').length} selesai</span>
            </div>
            <div className="rounded-xl border border-white/[0.06] divide-y divide-white/[0.04] overflow-hidden">
              <div className="max-h-40 overflow-y-auto aether-scroll">
                {batches.map((b) => (
                  <div key={b.id} className="flex items-center gap-2.5 text-[10px] px-3 py-2 hover:bg-white/[0.02]">
                    {b.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                    {b.status === 'processing' && <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin shrink-0" />}
                    {b.status === 'failed' && <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                    {b.status === 'queued' && <div className="h-3.5 w-3.5 rounded-full border border-slate-600 shrink-0" />}
                    <span className="text-slate-400 w-14 shrink-0">Batch {b.batchIndex + 1}</span>
                    <span className="text-slate-500 flex-1 truncate">
                      {b.status === 'completed' && `${b.stats.created + b.stats.updated + b.stats.skipped} diproses`}
                      {b.status === 'processing' && 'Memproses…'}
                      {b.status === 'failed' && (b.error || 'Gagal')}
                      {b.status === 'queued' && 'Antri'}
                    </span>
                    {b.durationMs > 0 && <span className="text-slate-600 tabular-nums shrink-0">{(b.durationMs / 1000).toFixed(1)}s</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Last error */}
        {job.lastBatchError && (
          <div className="rounded-xl bg-red-500/[0.06] border border-red-500/20 p-3">
            <div className="text-[10px] text-red-400 font-semibold mb-0.5">Error terakhir</div>
            <div className="text-[10px] text-red-300/80 break-words">{job.lastBatchError}</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-white/[0.06] bg-white/[0.01]">
        <div className="flex items-center gap-1">
          {(isCompleted || isPartial || isFailed || isCancelled) && (
            <button
              onClick={onRemove}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] text-slate-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/[0.06]"
            >
              <Trash2 className="h-3 w-3" /> Hapus
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <button
              onClick={onPause}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.08] text-[11px] text-slate-300 transition-colors"
            >
              <Pause className="h-3.5 w-3.5" /> Jeda
            </button>
          )}
          {isPaused && (
            <button
              onClick={onResume}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[11px] font-semibold text-emerald-950 transition-colors shadow-lg shadow-emerald-500/20"
            >
              <Play className="h-3.5 w-3.5" /> Lanjutkan
            </button>
          )}
          {(isPartial || isFailed) && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[11px] font-semibold text-emerald-950 transition-colors shadow-lg shadow-emerald-500/20"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Coba Ulang
            </button>
          )}
          {(isProcessing || isPaused) && (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-[11px] text-red-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Batalkan
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:text-white transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Job view sub-components ───────────────────────────────────────────────

function ProgressHero({
  tone,
  label,
  pct,
  processed,
  total,
  elapsed,
  etaMs,
  isProcessing,
  currentBatch,
  totalBatches,
}: {
  tone: string
  label: string
  pct: number
  processed: number
  total: number
  elapsed: number
  etaMs: number
  isProcessing: boolean
  currentBatch: import('@/lib/bulk-engine/dexie-db').BulkBatch | undefined
  totalBatches: number
}) {
  const accent = tone === 'amber' ? 'amber' : 'emerald'
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-${accent}-500/15 text-${accent}-400 border border-${accent}-500/20`}>
            {isProcessing && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            {label}
          </span>
        </div>
        <span className="text-2xl font-bold text-white tabular-nums">{pct}%</span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06] mb-3">
        <div
          className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-${accent}-500 to-${accent}-400 transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Layers className="h-2.5 w-2.5" />
          {processed} / {total} baris
        </span>
        <span className="inline-flex items-center gap-2 tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(elapsed)}
          </span>
          {isProcessing && etaMs > 0 && (
            <>
              <span className="text-slate-600">·</span>
              <span>ETA <span className={`text-${accent}-400 font-medium`}>{formatEta(etaMs)}</span></span>
            </>
          )}
        </span>
      </div>
      {currentBatch && (
        <div className="mt-2 pt-2 border-t border-white/[0.04] text-[10px] text-slate-500">
          Batch {currentBatch.batchIndex + 1}/{totalBatches || '?'} · attempt {currentBatch.attemptCount}
        </div>
      )}
    </div>
  )
}

function ResultHero({
  tone,
  label,
  elapsed,
  successCount,
  skippedCount,
  failedCount,
  isCompleted,
  isPartial,
  isFailed,
  onExportErrors,
}: {
  tone: string
  label: string
  elapsed: number
  successCount: number
  skippedCount: number
  failedCount: number
  isCompleted: boolean
  isPartial: boolean
  isFailed: boolean
  onExportErrors: () => void
}) {
  return (
    <div className={`rounded-2xl border p-4 ${
      tone === 'red'
        ? 'bg-red-500/[0.06] border-red-500/20'
        : tone === 'amber'
          ? 'bg-amber-500/[0.06] border-amber-500/20'
          : 'bg-emerald-500/[0.06] border-emerald-500/20'
    }`}>
      <div className="flex items-center gap-2.5 mb-3">
        {isCompleted && <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />}
        {isPartial && <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />}
        {isFailed && <XCircle className="h-5 w-5 text-red-400 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white">{label}</div>
          <div className="text-[10px] text-slate-400 inline-flex items-center gap-1 mt-0.5">
            <Clock className="h-2.5 w-2.5" />
            Selesai dalam {formatDuration(elapsed)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <ResultStat
          label="Berhasil"
          value={successCount}
          tone="emerald"
          emphasized={successCount > 0}
        />
        <ResultStat
          label="Dilewati"
          value={skippedCount}
          tone="slate"
          emphasized={false}
        />
        <ResultStat
          label="Gagal"
          value={failedCount}
          tone={failedCount > 0 ? 'red' : 'slate'}
          emphasized={failedCount > 0}
        />
      </div>

      {failedCount > 0 && (
        <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between">
          <span className="text-[10px] text-amber-300/80 inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Ada baris yang gagal diproses
          </span>
          <button
            onClick={onExportErrors}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 text-[10px] text-amber-300 font-medium transition-colors"
          >
            <Download className="h-3 w-3" /> Export error
          </button>
        </div>
      )}
    </div>
  )
}

function ResultStat({
  label,
  value,
  tone,
  emphasized,
}: {
  label: string
  value: number
  tone: 'emerald' | 'slate' | 'red'
  emphasized: boolean
}) {
  const styles =
    tone === 'emerald'
      ? 'bg-emerald-500/[0.08] border-emerald-500/15'
      : tone === 'red'
        ? 'bg-red-500/[0.08] border-red-500/15'
        : 'bg-white/[0.03] border-white/[0.06]'
  const valueColor =
    tone === 'emerald'
      ? 'text-emerald-400'
      : tone === 'red'
        ? 'text-red-400'
        : 'text-slate-300'
  return (
    <div className={`rounded-xl border px-2.5 py-2 ${styles}`}>
      <div className={`text-[9px] uppercase tracking-wide ${tone === 'emerald' ? 'text-emerald-400/70' : tone === 'red' ? 'text-red-400/70' : 'text-slate-500'}`}>
        {label}
      </div>
      <div className={`text-lg font-bold ${valueColor} tabular-nums ${emphasized ? '' : 'opacity-80'}`}>
        {value}
      </div>
    </div>
  )
}

function LiveStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'emerald' | 'slate'
}) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${
      tone === 'emerald'
        ? 'bg-emerald-500/[0.05] border-emerald-500/15'
        : 'bg-white/[0.03] border-white/[0.06]'
    }`}>
      <div className={`text-[10px] ${tone === 'emerald' ? 'text-emerald-400/70' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-sm font-semibold ${tone === 'emerald' ? 'text-emerald-400' : 'text-slate-300'} tabular-nums`}>{value}</div>
    </div>
  )
}
