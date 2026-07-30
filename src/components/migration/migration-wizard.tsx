'use client'

/**
 * MIG-BATCH-V3: Migration Wizard — detail modal content.
 *
 * Context-driven (no local batch loop). The processor provider owns the loop;
 * this component only renders the current modal step and reads live job/batch
 * data from Dexie via the processor context.
 *
 * Steps (driven by ctx.modalState):
 *  - mode_selection : pick ImportMode
 *  - upload         : drop zone + duplicate detection + "Mulai Import"
 *  - job (PROCESSING)        : real-time progress (products done / total, batch X/Y,
 *                              elapsed, ETA, per-batch status list)
 *  - job (COMPLETED/PARTIAL…) : result screen with retry / download errors / close
 *
 * The modal can be minimised (closeModal) — the floating widget keeps showing
 * progress and migration continues across page navigation.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, FileSpreadsheet, Check, Loader2,
  PartyPopper, ArrowRight, Download,
  Package, Boxes,
  CircleCheck, CircleAlert, Copy, GitBranch, Tags, ScanBarcode,
  FlaskConical, TrendingUp, Link2, AlertTriangle,
  RefreshCw, Info, Layers, RotateCcw,
  Clock, Hourglass, ListChecks, Database, Minimize2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { ImportMode, ImportResult, MigrationStatus } from './migration-banner'
import { ImportModeDialog } from './import-mode-dialog'
import { useMigrationProcessor } from './migration-context'
import type { MigrationJob, MigrationBatch } from '@/lib/migration/dexie-db'

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

type WizardStep = 'mode_selection' | 'upload' | 'processing' | 'success'

/** Map a Dexie job + batches into the ImportResult shape the success screen expects. */
function buildImportResult(job: MigrationJob, batches: MigrationBatch[]): ImportResult {
  const completedBatches = batches.filter((b) => b.status === 'COMPLETED').length
  const firstNonCompleted = batches.find((b) => b.status !== 'COMPLETED')
  const startBatch = firstNonCompleted ? firstNonCompleted.batchNumber : job.totalBatches
  const processed = job.createdCount + job.skippedCount + job.failedCount
  const status: MigrationStatus =
    job.status === 'DISMISSED'
      ? 'COMPLETED'
      : (job.status as MigrationStatus)
  return {
    productsCreated: job.createdCount,
    variantsCreated: job.variantsCreated ?? 0,
    productsSkipped: job.skippedCount,
    totalCategories: job.totalCategories ?? 0,
    barcodeCount: job.barcodeCount ?? 0,
    mode: job.mode as ImportMode,
    errors: job.errors ?? [],
    warnings: job.warnings ?? [],
    inventoryItemsCreated: job.inventoryItemsCreated,
    inventoryItemsSkipped: job.inventoryItemsSkipped,
    inventoryItemsUpdated: job.inventoryItemsUpdated,
    migrationDataCleaned: job.migrationDataCleaned,
    compositionsCreated: job.compositionsCreated,
    totalStock: job.totalStock,
    totalModalValue: job.totalModalValue,
    status,
    totalProducts: job.totalProducts,
    totalBatches: job.totalBatches,
    completedBatches,
    currentBatch: job.currentBatch,
    failedRows: job.failedCount,
    remainingProducts: Math.max(0, job.totalProducts - processed),
    startBatch,
    batchError: job.lastBatchError,
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export function MigrationWizard() {
  const ctx = useMigrationProcessor()
  const { modalState, openJob, openBatches, closeModal, retryJob, removeJob, startJob, checkDuplicate } = ctx

  // Determine step from modal state + job status.
  let wizardStep: WizardStep = 'mode_selection'
  if (modalState.type === 'upload') wizardStep = 'upload'
  if (modalState.type === 'job') {
    wizardStep = openJob?.status === 'PROCESSING' ? 'processing' : 'success'
  }

  const mode: ImportMode =
    modalState.type === 'upload'
      ? modalState.mode
      : openJob?.mode
        ? (openJob.mode as ImportMode)
        : 'product_only'
  const isInventory = mode === 'product_inventory'
  const isStockMode = mode === 'product_stock'
  const hasInventory = isInventory || isStockMode

  // ── Upload step: local file + duplicate state ──
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicateJob, setDuplicateJob] = useState<MigrationJob | null>(null)
  const [isCheckingDup, setIsCheckingDup] = useState(false)
  const [isStarting, setIsStarting] = useState(false)

  // Reset upload state when modal reopens to the upload step.
  useEffect(() => {
    if (modalState.type === 'upload') {
      // keep selectedFile if user is just re-entering; clear duplicate state
    }
  }, [modalState])

  const handleFileSelect = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
        setError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv')
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        setError('Ukuran file maksimal 5MB')
        return
      }
      setSelectedFile(file)
      setError(null)
      setDuplicateJob(null)
      setIsCheckingDup(true)
      try {
        const dup = await checkDuplicate(file, mode)
        setDuplicateJob(dup)
      } catch {
        // non-fatal — user can still start a new job
      } finally {
        setIsCheckingDup(false)
      }
    },
    [checkDuplicate, mode],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFileSelect(file)
    },
    [handleFileSelect],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const handleStartImport = useCallback(async () => {
    if (!selectedFile) return
    setIsStarting(true)
    try {
      await startJob(selectedFile, mode)
    } finally {
      setIsStarting(false)
    }
  }, [selectedFile, mode, startJob])

  const handleContinueDuplicate = useCallback(() => {
    if (!duplicateJob) return
    ctx.openModal(duplicateJob.id)
  }, [duplicateJob, ctx])

  // ── Processing step: live elapsed ticker ──
  const [, setTick] = useState(0)
  useEffect(() => {
    if (wizardStep !== 'processing' || !openJob) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [wizardStep, openJob])

  // ── Success step: derived values ──
  const result: ImportResult | null =
    wizardStep === 'success' && openJob ? buildImportResult(openJob, openBatches) : null

  const totalItems = (result?.productsCreated ?? 0) + (result?.variantsCreated ?? 0)
  const hasErrors = !!(result && result.errors.length > 0)
  const hasSkipped = !!(result && result.productsSkipped > 0)
  const hasWarnings = !!(result && result.warnings && result.warnings.length > 0)
  const hasRemigration = !!(result && ((result.inventoryItemsUpdated ?? 0) > 0 || (result.migrationDataCleaned ?? 0) > 0))

  const migrationStatus = result?.status || 'COMPLETED'
  const isPartial = migrationStatus === 'PARTIAL'
  const isFailed = migrationStatus === 'FAILED'
  const isCompletedWithErrors = migrationStatus === 'COMPLETED_WITH_ERRORS'
  const showSuccessHeader = !isPartial && !isFailed

  // ── Download errors ──
  const handleDownloadErrors = useCallback(() => {
    if (!result || result.errors.length === 0) return
    const lines = result.errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
    const header = `Daftar Error Migrasi\n${'='.repeat(50)}\nMode: ${mode}\nTotal error: ${result.errors.length}\n${'='.repeat(50)}\n\n`
    const blob = new Blob([header + lines], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `error-migrasi-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success('Daftar error berhasil diunduh')
  }, [result, mode])

  const handleRetry = useCallback(() => {
    if (!openJob) return
    retryJob(openJob.id)
  }, [openJob, retryJob])

  const handleCloseOrDismiss = useCallback(() => {
    // For completed jobs, dismiss (hide widget) + close. For partial/failed,
    // just close (widget still shows so user can retry later).
    if (openJob && (openJob.status === 'COMPLETED' || openJob.status === 'COMPLETED_WITH_ERRORS')) {
      ctx.dismissJob(openJob.id)
    }
    closeModal()
  }, [openJob, ctx, closeModal])

  // Modal open state
  const open = modalState.type !== 'closed'

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeModal()
      }}
    >
      <DialogContent className="sm:max-w-[480px] max-h-[85vh] bg-nebula border-stellar-border p-0 overflow-hidden flex flex-col">
        <div className="relative flex flex-col max-h-[80vh]">
          {/* Step indicator */}
          <div className="px-6 pt-5 pb-3 shrink-0">
            <div className="flex items-center gap-2 mb-3">
              {['Upload', 'Proses', 'Selesai'].map((label, i) => {
                const stepOrder = ['upload', 'processing', 'success'] as const
                const currentIdx =
                  wizardStep === 'mode_selection' ? -1 : stepOrder.indexOf(wizardStep as 'upload' | 'processing' | 'success')
                const isActive = i <= currentIdx
                const isCurrent = i === currentIdx
                return (
                  <div key={label} className="flex items-center gap-2 flex-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold transition-all duration-300',
                          isActive
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-white/[0.04] text-slate-600 border border-white/[0.08]',
                        )}
                      >
                        {i < currentIdx ? <Check className="h-3 w-3" /> : i + 1}
                      </div>
                      <span
                        className={cn(
                          'text-xs font-medium transition-colors',
                          isCurrent ? 'text-white' : isActive ? 'text-slate-400' : 'text-slate-600',
                        )}
                      >
                        {label}
                      </span>
                    </div>
                    {i < 2 && (
                      <div className={cn('flex-1 h-px mx-1 transition-colors', i < currentIdx ? 'bg-emerald-500/30' : 'bg-white/[0.06]')} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="px-6 pb-6 flex-1 overflow-y-auto custom-scrollbar">
            <AnimatePresence mode="wait">
              {/* ═══════ STEP: MODE SELECTION ═══════ */}
              {wizardStep === 'mode_selection' && (
                <motion.div
                  key="mode"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="text-center space-y-1 mb-4">
                    <h3 className="text-sm font-bold text-white">Pilih Mode Import</h3>
                    <p className="text-xs text-slate-400">Pilih sesuai kebutuhan bisnis Anda.</p>
                  </div>
                  <ImportModeDialog
                    selected={mode}
                    onSelect={(m) => ctx.selectMode(m)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={closeModal}
                    className="mt-4 text-xs text-slate-400 hover:text-white w-full"
                  >
                    Batal
                  </Button>
                </motion.div>
              )}

              {/* ═══════ STEP: UPLOAD ═══════ */}
              {wizardStep === 'upload' && (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-4"
                >
                  <div className="text-center space-y-1">
                    <h3 className="text-sm font-bold text-white">Upload File Excel</h3>
                    <p className="text-xs text-slate-400">
                      {isInventory
                        ? 'Isi Sheet 1–4 (produk, bahan baku & komposisi/BOM)'
                        : isStockMode
                          ? 'Isi STOK AWAL di Sheet 1 & 2 — stok gudang otomatis terbuat'
                          : 'Gunakan template migrasi atau file Excel dari POS lama Anda'}
                    </p>
                  </div>

                  {/* Download template */}
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation()
                      try {
                        const res = await fetch(`/api/migration/template?mode=${mode}`)
                        if (!res.ok) {
                          const errData = await res.json().catch(() => null)
                          throw new Error(errData?.error || `Server error (${res.status})`)
                        }
                        const blob = await res.blob()
                        if (blob.size === 0) throw new Error('File kosong — coba lagi')
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `template-migrasi-${mode}.xlsx`
                        document.body.appendChild(a)
                        a.click()
                        a.remove()
                        setTimeout(() => URL.revokeObjectURL(url), 1000)
                        toast.success('Template berhasil diunduh')
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : 'Gagal mengunduh template'
                        toast.error(msg)
                      }
                    }}
                    className="mx-auto flex items-center gap-1.5 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Belum punya file? Download template untuk mode ini
                  </button>

                  {/* Drop zone */}
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200',
                      isDragging
                        ? 'border-emerald-500/50 bg-emerald-500/[0.05]'
                        : selectedFile
                          ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
                          : 'border-white/[0.1] bg-white/[0.02] hover:border-white/[0.2] hover:bg-white/[0.04]',
                    )}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFileSelect(file)
                        e.target.value = ''
                      }}
                    />
                    {selectedFile ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-emerald-500/15 border border-emerald-500/20">
                          <FileSpreadsheet className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{selectedFile.name}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedFile(null); setDuplicateJob(null) }}
                          className="text-[11px] text-slate-400 hover:text-white transition-colors"
                        >
                          Ganti file
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                          <Upload className="h-5 w-5 text-slate-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-300">
                            Drag & drop atau <span className="text-emerald-400">klik untuk pilih</span>
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1">.xlsx, .xls, .csv — Maks. 5MB</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mode badge */}
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Mode:</span>
                    <span
                      className={cn(
                        'inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md',
                        isInventory
                          ? 'text-violet-300 bg-violet-500/15 border border-violet-500/20'
                          : isStockMode
                            ? 'text-cyan-300 bg-cyan-500/15 border border-cyan-500/20'
                            : 'text-emerald-300 bg-emerald-500/15 border border-emerald-500/20',
                      )}
                    >
                      {isInventory ? 'Produk + Komposisi' : isStockMode ? 'Produk + Stok Gudang' : 'Produk Saja'}
                    </span>
                  </div>

                  {/* Duplicate detection */}
                  {isCheckingDup && (
                    <div className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                      <Loader2 className="h-3.5 w-3.5 text-cyan-400 animate-spin" />
                      <span className="text-[11px] text-cyan-300">Memeriksa file duplikat…</span>
                    </div>
                  )}
                  {duplicateJob && (
                    <div className="space-y-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="text-[11px] text-amber-300 font-semibold">File ini sudah memiliki migrasi yang belum selesai</span>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Status: {duplicateJob.status === 'PROCESSING' ? 'Sedang berjalan' : duplicateJob.status === 'PARTIAL' ? 'Sebagian selesai' : 'Gagal'} ·{' '}
                        {duplicateJob.createdCount} produk dibuat · {duplicateJob.totalProducts} total
                      </p>
                      <Button
                        onClick={handleContinueDuplicate}
                        className="w-full bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold h-9 gap-2"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Lanjutkan Migrasi Ini
                      </Button>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
                    >
                      <span className="text-xs text-red-300">{error}</span>
                    </motion.div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="ghost" size="sm" onClick={ctx.backToModeSelection} className="text-xs text-slate-400 hover:text-white flex-1">
                      Kembali
                    </Button>
                    <Button
                      onClick={handleStartImport}
                      disabled={!selectedFile || isStarting || !!duplicateJob}
                      className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold h-9 gap-2 disabled:opacity-40"
                    >
                      {isStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                      Mulai Import
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* ═══════ STEP: PROCESSING (real-time) ═══════ */}
              {wizardStep === 'processing' && openJob && (() => {
                const job = openJob
                const batches = openBatches
                const doneBatches = batches.filter((b) => b.status === 'COMPLETED')
                const completedCount = doneBatches.length
                const totalDurationMs = doneBatches.reduce((sum, b) => sum + b.durationMs, 0)
                const avgBatchMs = completedCount > 0 ? totalDurationMs / completedCount : 0
                const remainingBatches = Math.max(0, job.totalBatches - completedCount)
                const etaMs = avgBatchMs * remainingBatches
                const processedProducts = job.createdCount + job.skippedCount + job.failedCount
                const progressPct = job.totalProducts > 0 ? Math.min(100, Math.round((processedProducts / job.totalProducts) * 100)) : 0
                const currentBatchNum = job.currentBatch
                const elapsedMs = job.startedAt ? Date.now() - job.startedAt : 0

                return (
                  <motion.div key="processing" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }} className="py-6 space-y-4">
                    <div className="text-center space-y-2">
                      <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-emerald-500/15 border border-emerald-500/20">
                        <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
                      </div>
                      <h3 className="text-sm font-bold text-white">Migrasi Sedang Berjalan</h3>
                    </div>

                    {/* Progress bar — real (processedProducts / totalProducts) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300 font-semibold">{progressPct}% selesai</span>
                        <span className="text-slate-400 tabular-nums">
                          {formatNumber(processedProducts)} dari {formatNumber(job.totalProducts)} produk
                        </span>
                      </div>
                      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>

                    {/* Batch + elapsed */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5 mb-0.5">
                          <Layers className="h-3 w-3 text-emerald-400" />
                          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Batch</span>
                        </div>
                        <p className="text-sm font-bold text-white tabular-nums">
                          {currentBatchNum + 1} <span className="text-slate-500 text-xs">/</span> {job.totalBatches || '?'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5 mb-0.5">
                          <Clock className="h-3 w-3 text-cyan-400" />
                          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Berjalan</span>
                        </div>
                        <p className="text-sm font-bold text-white tabular-nums">{formatDuration(elapsedMs)}</p>
                      </div>
                    </div>

                    {/* ETA */}
                    {etaMs > 0 && completedCount > 0 && (
                      <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                        <Hourglass className="h-3 w-3 text-amber-400" />
                        <span>Perkiraan selesai: <strong className="text-amber-300 tabular-nums">{formatDuration(etaMs)}</strong> lagi</span>
                      </div>
                    )}

                    {/* Stats grid */}
                    <div className="grid grid-cols-4 gap-1.5">
                      <div className="text-center p-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10">
                        <p className="text-sm font-bold text-emerald-300 tabular-nums">{formatNumber(job.createdCount)}</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">Dibuat</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                        <p className="text-sm font-bold text-slate-300 tabular-nums">{formatNumber(job.skippedCount)}</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">Dilewati</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/10">
                        <p className="text-sm font-bold text-amber-300 tabular-nums">{formatNumber(job.failedCount)}</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">Gagal</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                        <p className="text-sm font-bold text-slate-300 tabular-nums">{formatNumber(Math.max(0, job.totalProducts - processedProducts))}</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">Sisa</p>
                      </div>
                    </div>

                    {/* Per-batch status list */}
                    {job.totalBatches > 0 && job.totalBatches <= 20 && (
                      <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5 space-y-1.5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <ListChecks className="h-3 w-3 text-slate-400" />
                          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Status Batch</span>
                        </div>
                        <div className="max-h-32 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                          {Array.from({ length: job.totalBatches }, (_, i) => {
                            const batch = batches.find((b) => b.batchNumber === i)
                            const status = batch?.status === 'COMPLETED' ? 'done' : batch?.status === 'PROCESSING' ? 'in_progress' : batch?.status === 'FAILED' ? 'failed' : i < currentBatchNum ? 'done' : 'pending'
                            return (
                              <div key={i} className="flex items-center gap-2 text-[11px]">
                                {status === 'done' ? (
                                  <CircleCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                                ) : status === 'in_progress' ? (
                                  <Loader2 className="h-3 w-3 text-cyan-400 animate-spin shrink-0" />
                                ) : status === 'failed' ? (
                                  <CircleAlert className="h-3 w-3 text-red-400 shrink-0" />
                                ) : (
                                  <div className="h-3 w-3 rounded-full border border-slate-600 shrink-0" />
                                )}
                                <span className={cn('tabular-nums', status === 'done' ? 'text-slate-300' : status === 'in_progress' ? 'text-cyan-300 font-semibold' : status === 'failed' ? 'text-red-300' : 'text-slate-600')}>
                                  Batch {i + 1}
                                </span>
                                {batch?.status === 'COMPLETED' && (
                                  <span className="text-[9px] text-slate-500 ml-auto tabular-nums">{batch.created}d · {batch.skipped}s · {batch.failed}f · {formatDuration(batch.durationMs)}</span>
                                )}
                                {batch?.status === 'FAILED' && <span className="text-[9px] text-red-400 ml-auto">gagal</span>}
                                {status === 'in_progress' && <span className="text-[9px] text-cyan-400 ml-auto">memproses…</span>}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Current batch indicator — navigation-safe messaging */}
                    <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-slate-300">
                        <Database className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Batch {currentBatchNum + 1} sedang disimpan ke database</span>
                      </div>
                      <p className="text-[10px] text-slate-500 pl-5">
                        Aman berpindah halaman — migrasi tetap berjalan di latar. Batch yang sudah selesai tetap tersimpan jika proses terhenti.
                      </p>
                    </div>

                    {/* Minimise hint */}
                    <Button variant="ghost" size="sm" onClick={closeModal} className="w-full text-[11px] text-slate-400 hover:text-white h-8 gap-1.5">
                      <Minimize2 className="h-3 w-3" />
                      Minimalkan — lanjut pakai aplikasi
                    </Button>
                  </motion.div>
                )
              })()}

              {/* ═══════ STEP: SUCCESS / PARTIAL / FAILED ═══════ */}
              {wizardStep === 'success' && result && (
                <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }} className="py-2 space-y-4">
                  {/* Header */}
                  <div className="text-center space-y-2.5 pt-1">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 25, delay: 0.1 }} className={cn('inline-flex items-center justify-center h-16 w-16 rounded-2xl border', isPartial ? 'bg-amber-500/15 border-amber-500/25' : isFailed ? 'bg-red-500/15 border-red-500/25' : 'bg-emerald-500/15 border-emerald-500/25')}>
                      {isPartial ? <AlertTriangle className="h-8 w-8 text-amber-400" /> : isFailed ? <CircleAlert className="h-8 w-8 text-red-400" /> : <PartyPopper className="h-8 w-8 text-emerald-400" />}
                    </motion.div>
                    <motion.h3 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-xl font-bold text-white">
                      {isPartial ? 'Migrasi Sebagian Berhasil' : isFailed ? 'Migrasi Gagal' : isCompletedWithErrors ? 'Import Berhasil (dengan error)' : 'Import Berhasil'}
                    </motion.h3>
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                      <span className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border', isPartial ? 'bg-amber-500/15 border-amber-500/25 text-amber-300' : isFailed ? 'bg-red-500/15 border-red-500/25 text-red-300' : 'bg-emerald-500/15 border-emerald-500/25 text-emerald-300')}>
                        {isPartial ? <AlertTriangle className="h-3.5 w-3.5" /> : isFailed ? <CircleAlert className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
                        {isPartial ? `${formatNumber(result.completedBatches || 0)} dari ${formatNumber(result.totalBatches || 0)} batch selesai` : isFailed ? 'Tidak ada batch yang berhasil' : `${formatNumber(totalItems)} item berhasil diimport`}
                      </span>
                    </motion.div>
                  </div>

                  {/* Batch progress breakdown */}
                  {result.totalBatches !== undefined && result.totalBatches > 0 && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-xs font-semibold text-slate-300">Progress Batch</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="text-center p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"><p className="text-base font-bold text-white">{formatNumber(result.productsCreated || 0)}</p><p className="text-[10px] text-slate-500">Dibuat</p></div>
                        <div className="text-center p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"><p className="text-base font-bold text-white">{formatNumber(result.productsSkipped || 0)}</p><p className="text-[10px] text-slate-500">Dilewati (duplikat)</p></div>
                        <div className="text-center p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"><p className="text-base font-bold text-amber-300">{formatNumber(result.failedRows || 0)}</p><p className="text-[10px] text-slate-500">Gagal</p></div>
                        <div className="text-center p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"><p className="text-base font-bold text-slate-300">{formatNumber(result.remainingProducts || 0)}</p><p className="text-[10px] text-slate-500">Sisa</p></div>
                      </div>
                      <div className="text-[11px] text-slate-400 text-center">Batch {result.completedBatches || 0} / {result.totalBatches || 0} selesai{result.totalProducts !== undefined && ` · ${formatNumber(result.totalProducts)} total produk`}</div>
                    </motion.div>
                  )}

                  {/* PARTIAL: batch failure details */}
                  {isPartial && result.batchError && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3 space-y-2">
                      <div className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-amber-400" /><span className="text-xs font-semibold text-amber-300">Batch Gagal</span></div>
                      <p className="text-[11px] text-slate-300 leading-relaxed break-all">{result.batchError}</p>
                      <div className="flex items-center gap-4 pt-1 text-[10px] text-slate-400">
                        <span>Batch dibuat: <strong className="text-emerald-300">{formatNumber(result.productsCreated || 0)}</strong></span>
                        <span>Sisa: <strong className="text-amber-300">{formatNumber(result.remainingProducts || 0)}</strong></span>
                      </div>
                    </motion.div>
                  )}

                  {/* Stats grid — Products */}
                  {showSuccessHeader && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"><div className="flex items-center justify-center mb-1.5"><Package className="h-3.5 w-3.5 text-emerald-400" /></div><p className="text-lg font-bold text-white">{formatNumber(result.productsCreated)}</p><p className="text-[10px] text-slate-500 mt-0.5">Produk</p></div>
                        <div className="text-center p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"><div className="flex items-center justify-center mb-1.5"><GitBranch className="h-3.5 w-3.5 text-amber-400" /></div><p className="text-lg font-bold text-white">{formatNumber(result.variantsCreated)}</p><p className="text-[10px] text-slate-500 mt-0.5">Varian</p></div>
                        <div className="text-center p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"><div className="flex items-center justify-center mb-1.5"><Tags className="h-3.5 w-3.5 text-cyan-400" /></div><p className="text-lg font-bold text-white">{formatNumber(result.totalCategories)}</p><p className="text-[10px] text-slate-500 mt-0.5">Kategori</p></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="text-center p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"><div className="flex items-center justify-center mb-1"><ScanBarcode className="h-3.5 w-3.5 text-violet-400" /></div><p className="text-base font-bold text-white">{formatNumber(result.barcodeCount)}</p><p className="text-[10px] text-slate-500 mt-0.5">Barcode</p></div>
                        {hasSkipped ? (
                          <div className="text-center p-2.5 rounded-xl bg-amber-500/[0.04] border border-amber-500/10"><div className="flex items-center justify-center mb-1"><Copy className="h-3.5 w-3.5 text-amber-400" /></div><p className="text-base font-bold text-amber-300">{formatNumber(result.productsSkipped)}</p><p className="text-[10px] text-slate-500 mt-0.5">Duplikat Dilewati</p></div>
                        ) : (
                          <div className="text-center p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"><div className="flex items-center justify-center mb-1"><Copy className="h-3.5 w-3.5 text-slate-500" /></div><p className="text-base font-bold text-slate-500">0</p><p className="text-[10px] text-slate-500 mt-0.5">Duplikat Dilewati</p></div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Inventory stats */}
                  {hasInventory && (result.inventoryItemsCreated !== undefined || result.compositionsCreated !== undefined) && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }} className={cn('rounded-xl border p-4 space-y-3', isStockMode ? 'bg-cyan-500/[0.06] border-cyan-500/15' : 'bg-violet-500/[0.06] border-violet-500/15')}>
                      <div className="flex items-center gap-2 mb-2"><Boxes className={cn('h-3.5 w-3.5', isStockMode ? 'text-cyan-400' : 'text-violet-400')} /><span className={cn('text-xs font-semibold', isStockMode ? 'text-cyan-300' : 'text-violet-300')}>{isStockMode ? 'Stok Gudang' : 'Inventory Bahan Baku'}</span></div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center"><p className="text-base font-bold text-white">{formatNumber(result.inventoryItemsCreated)}</p><p className="text-[10px] text-slate-500">{isStockMode ? 'Item Stok' : 'Item'}</p></div>
                        <div className="text-center"><p className="text-base font-bold text-white">{formatNumber(result.totalStock)}</p><p className="text-[10px] text-slate-500">Total Stok</p></div>
                        <div className="text-center"><p className="text-base font-bold text-white">{formatCurrency(result.totalModalValue ?? 0)}</p><p className="text-[10px] text-slate-500">Nilai Modal</p></div>
                      </div>
                      {isStockMode ? (
                        <div className="flex items-center gap-2 pt-2 border-t border-cyan-500/10"><Link2 className="h-3 w-3 text-cyan-400/70 shrink-0" /><span className="text-[11px] text-slate-400">Produk otomatis terhubung ke stok gudang</span></div>
                      ) : result.compositionsCreated !== undefined && result.compositionsCreated > 0 ? (
                        <div className="flex items-center gap-2 pt-2 border-t border-violet-500/10"><FlaskConical className="h-3 w-3 text-violet-400/70 shrink-0" /><span className="text-[11px] text-slate-400"><span className="text-violet-300 font-semibold">{formatNumber(result.compositionsCreated)}</span> komposisi resep terbuat</span></div>
                      ) : null}
                    </motion.div>
                  )}

                  {/* Re-Migration info */}
                  {hasRemigration && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="rounded-xl bg-emerald-500/[0.06] border border-emerald-500/15 p-3 space-y-2.5">
                      <div className="flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5 text-emerald-400" /><span className="text-xs font-semibold text-emerald-300">Re-Migrasi: Data Diperbarui</span></div>
                      <div className="grid grid-cols-2 gap-2">
                        {(result.inventoryItemsUpdated ?? 0) > 0 && <div className="rounded-md bg-emerald-500/[0.08] px-2 py-1.5 text-center"><p className="text-sm font-bold text-emerald-300">{formatNumber(result.inventoryItemsUpdated)}</p><p className="text-[9px] text-slate-500">Item Di-update</p></div>}
                        {(result.migrationDataCleaned ?? 0) > 0 && <div className="rounded-md bg-cyan-500/[0.08] px-2 py-1.5 text-center"><p className="text-sm font-bold text-cyan-300">{formatNumber(result.migrationDataCleaned ?? 0)}</p><p className="text-[9px] text-slate-500">Data Lama Dibersihkan</p></div>}
                      </div>
                    </motion.div>
                  )}

                  {/* Warnings */}
                  {hasWarnings && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }} className="rounded-xl bg-blue-500/[0.06] border border-blue-500/15 p-3 space-y-2.5">
                      <div className="flex items-center gap-2"><Info className="h-3.5 w-3.5 text-blue-400" /><span className="text-xs font-semibold text-blue-300">{result.warnings!.length} Info Migrasi</span></div>
                      <div className="max-h-24 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                        {result.warnings!.map((warn, i) => (<p key={i} className="text-[11px] text-slate-400 leading-relaxed pl-5.5 relative before:content-['·'] before:absolute before:left-1.5 before:text-blue-500/60 before:font-bold">{warn}</p>))}
                      </div>
                    </motion.div>
                  )}

                  {/* Per-row errors */}
                  {hasErrors && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.65 }} className="rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><CircleAlert className="h-3.5 w-3.5 text-amber-400" /><span className="text-xs font-semibold text-amber-300">{result.errors.length} baris bermasalah</span></div>
                        <button onClick={handleDownloadErrors} className="text-[10px] text-amber-300 hover:text-amber-200 transition-colors flex items-center gap-1"><Download className="h-3 w-3" />Unduh</button>
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                        {result.errors.map((err, i) => (<p key={i} className="text-[11px] text-slate-400 leading-relaxed pl-5.5 relative before:content-['·'] before:absolute before:left-1.5 before:text-amber-500/60 before:font-bold">{err}</p>))}
                      </div>
                    </motion.div>
                  )}

                  {/* Action buttons */}
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }} className="space-y-2">
                    {(isPartial || isFailed) && (
                      <>
                        <Button onClick={handleRetry} className="w-full bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold h-10 gap-2">
                          <RotateCcw className="h-4 w-4" />
                          Lanjutkan Migrasi (dari batch {result.completedBatches || 0})
                        </Button>
                        {hasErrors && (
                          <Button onClick={handleDownloadErrors} variant="outline" className="w-full text-xs font-semibold h-9 gap-2 border-white/[0.1] text-slate-300 hover:text-white hover:bg-white/[0.04]">
                            <Download className="h-3.5 w-3.5" />Unduh Daftar Error
                          </Button>
                        )}
                      </>
                    )}

                    {!isPartial && !isFailed && hasErrors && (
                      <Button onClick={handleDownloadErrors} variant="outline" className="w-full text-xs font-semibold h-9 gap-2 border-white/[0.1] text-slate-300 hover:text-white hover:bg-white/[0.04]">
                        <Download className="h-3.5 w-3.5" />Unduh Daftar Error
                      </Button>
                    )}

                    {showSuccessHeader && (
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15">
                        <TrendingUp className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {isInventory ? <>Stok awal migrasi sudah tercatat. Untuk restock, gunakan menu <span className="font-semibold text-white">Pembelian</span></> : <>Stok awal migrasi sudah tercatat di audit log. Buka <span className="font-semibold text-white">POS</span> untuk mulai transaksi</>}
                        </p>
                      </div>
                    )}

                    <Button onClick={handleCloseOrDismiss} variant={isPartial || isFailed ? 'ghost' : 'default'} className={cn('w-full text-sm font-semibold h-10 gap-2', !isPartial && !isFailed && 'bg-emerald-600 hover:bg-emerald-500 text-white')}>
                      {isPartial || isFailed ? 'Tutup' : 'Mulai Berjualan'}
                      {!isPartial && !isFailed && <ArrowRight className="h-4 w-4" />}
                    </Button>
                  </motion.div>
                </motion.div>
              )}

              {/* Fallback: job view but job not loaded yet */}
              {modalState.type === 'job' && !openJob && (
                <div className="py-8 text-center">
                  <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mx-auto" />
                  <p className="text-xs text-slate-400 mt-3">Memuat data migrasi…</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
