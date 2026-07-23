'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, FileSpreadsheet, Check, Loader2,
  PartyPopper, ArrowRight, Download,
  Package, Boxes, X,
  FileSearch, ClipboardCheck, ArrowRightLeft, Cpu, Database,
  CircleCheck, CircleAlert, Copy, GitBranch, Tags, ScanBarcode,
  FlaskConical, TrendingUp, Link2, AlertTriangle,
  RefreshCw, Info, Layers, RotateCcw,
  Clock, Hourglass, ListChecks,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { ImportMode, ImportResult, MigrationStatus } from './migration-banner'

// MIG-BATCH-V2: Per-batch progress tracking
interface BatchProgress {
  batchNumber: number
  status: 'pending' | 'in_progress' | 'done' | 'failed'
  created: number
  skipped: number
  failed: number
  durationMs: number
}

interface ProcessingState {
  totalProducts: number
  totalBatches: number
  currentBatch: number
  batches: BatchProgress[]
  totalCreated: number
  totalSkipped: number
  totalFailed: number
  errors: string[]
  startTime: number
  batchError: string | null
  isProcessing: boolean
}

// Format milliseconds as MM:SS
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

type WizardStep = 'upload' | 'processing' | 'success'

interface MigrationWizardProps {
  mode: ImportMode
  state: string
  onStateChange: (state: 'idle' | 'choosing_mode' | 'uploading' | 'processing' | 'success') => void
  onSuccess: (result: ImportResult) => void
  onClose: () => void
  onDismiss: () => void
}

export function MigrationWizard({
  mode,
  state,
  onStateChange,
  onSuccess,
  onClose,
  onDismiss,
}: MigrationWizardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  // MIG-BATCH: resume support — startBatch for "Lanjutkan Migrasi"
  const [startBatch, setStartBatch] = useState(0)
  // MIG-BATCH-V2: real-time per-batch progress state
  const [processingState, setProcessingState] = useState<ProcessingState | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const isInventory = mode === 'product_inventory'
  const isStockMode = mode === 'product_stock'
  const hasInventory = isInventory || isStockMode

  // MIG-BATCH-V2: Live elapsed-time ticker (updates every second while processing)
  useEffect(() => {
    if (!processingState?.isProcessing) return
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - (processingState.startTime || Date.now()))
    }, 1000)
    return () => clearInterval(interval)
  }, [processingState?.isProcessing, processingState?.startTime])

  const handleFileSelect = useCallback((file: File) => {
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
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  // MIG-BATCH-V2: One-request-per-batch upload loop.
  // Frontend sends batch 0, gets per-batch response, updates real-time progress,
  // sends batch 1, etc. This gives true progress (no fake animation), accurate
  // elapsed time, and precise ETA. Resume is dedup-safe (re-sending completed
  // batches = 0 duplicates via server name-based dedup).
  const handleUpload = useCallback(async (resumeFromBatch = 0) => {
    if (!selectedFile) return
    setIsUploading(true)
    setError(null)
    setStartBatch(resumeFromBatch)
    onStateChange('processing')

    const startTime = Date.now()
    let accCreated = 0
    let accSkipped = 0
    let accFailed = 0
    let accBarcodeCount = 0
    const allErrors: string[] = []
    let totalBatches = 0
    let totalProducts = 0
    let currentBatch = resumeFromBatch

    // Initialize processing state for UI
    setProcessingState({
      totalProducts: 0,
      totalBatches: 0,
      currentBatch,
      batches: [],
      totalCreated: 0,
      totalSkipped: 0,
      totalFailed: 0,
      errors: [],
      startTime,
      batchError: null,
      isProcessing: true,
    })
    setElapsedMs(0)

    // Sequential batch loop
    while (true) {
      // Mark current batch as in_progress
      setProcessingState(prev => prev ? {
        ...prev,
        currentBatch,
        batches: [
          ...prev.batches.filter(b => b.batchNumber !== currentBatch),
          { batchNumber: currentBatch, status: 'in_progress', created: 0, skipped: 0, failed: 0, durationMs: 0 },
        ],
      } : null)

      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('mode', mode)
      formData.append('batchNumber', String(currentBatch))

      let data: any
      try {
        const res = await fetch('/api/migration/import', {
          method: 'POST',
          body: formData,
        })

        // MIG-BATCH-V2: Handle non-JSON responses (server 500 HTML error pages,
        // gateway timeouts, etc.) — never crash on res.json() parse failure.
        const contentType = res.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          const text = await res.text().catch(() => '')
          data = {
            error: `Server mengembalikan respons non-JSON (${res.status}): ${text.substring(0, 200) || 'Empty response'}`,
          }
        } else {
          data = await res.json()
        }
      } catch (fetchErr) {
        data = {
          error: fetchErr instanceof Error ? fetchErr.message : 'Network error — gagal terhubung ke server',
        }
      }

      // Batch failed (server error, non-JSON, or BATCH_FAILED status)
      if (!data || data.error || data.status === 'BATCH_FAILED') {
        const errMsg = data?.error || data?.batchError || 'Batch gagal diproses'
        const batchCreated = data?.batchCreated || 0
        const batchSkipped = data?.batchSkipped || 0
        const batchFailedRows = data?.batchFailed || 0
        const batchDurationMs = data?.batchDurationMs || 0
        const batchErrors: string[] = data?.errors || []
        totalProducts = data?.totalProducts || totalProducts
        totalBatches = data?.totalBatches || totalBatches

        allErrors.push(...batchErrors)
        accCreated += batchCreated
        accSkipped += batchSkipped
        accFailed += batchFailedRows

        setProcessingState(prev => prev ? {
          ...prev,
          totalProducts,
          totalBatches,
          totalCreated: accCreated,
          totalSkipped: accSkipped,
          totalFailed: accFailed,
          errors: [...allErrors],
          batchError: errMsg,
          isProcessing: false,
          batches: [
            ...prev.batches.filter(b => b.batchNumber !== currentBatch),
            { batchNumber: currentBatch, status: 'failed', created: batchCreated, skipped: batchSkipped, failed: batchFailedRows, durationMs: batchDurationMs },
          ],
        } : null)

        // Build PARTIAL result for the success screen
        const importResult: ImportResult = {
          productsCreated: accCreated,
          variantsCreated: 0,
          productsSkipped: accSkipped,
          totalCategories: 0,
          barcodeCount: accBarcodeCount,
          mode,
          errors: allErrors,
          warnings: [],
          status: 'PARTIAL',
          totalProducts,
          totalBatches,
          completedBatches: currentBatch,
          currentBatch,
          failedRows: accFailed,
          remainingProducts: data?.remainingProducts ?? Math.max(0, totalProducts - (currentBatch * 50)),
          startBatch: currentBatch,
          batchError: errMsg,
        }
        setResult(importResult)
        setStartBatch(currentBatch)
        onStateChange('success')
        setIsUploading(false)
        onSuccess(importResult)
        return
      }

      // Batch succeeded — accumulate stats
      const batchCreated = data.batchCreated || 0
      const batchSkipped = data.batchSkipped || 0
      const batchFailedRows = data.batchFailed || 0
      const batchDurationMs = data.batchDurationMs || 0
      const batchErrors: string[] = data.errors || []
      totalProducts = data.totalProducts || totalProducts
      totalBatches = data.totalBatches || totalBatches
      accCreated += batchCreated
      accSkipped += batchSkipped
      accFailed += batchFailedRows
      accBarcodeCount += data.barcodeCount || 0
      allErrors.push(...batchErrors)

      setProcessingState(prev => prev ? {
        ...prev,
        totalProducts,
        totalBatches,
        totalCreated: accCreated,
        totalSkipped: accSkipped,
        totalFailed: accFailed,
        errors: [...allErrors],
        batches: [
          ...prev.batches.filter(b => b.batchNumber !== currentBatch),
          { batchNumber: currentBatch, status: 'done', created: batchCreated, skipped: batchSkipped, failed: batchFailedRows, durationMs: batchDurationMs },
        ],
      } : null)

      // Last batch — build final COMPLETED result
      if (data.isLastBatch) {
        const importResult: ImportResult = {
          productsCreated: accCreated,
          variantsCreated: data.variantsCreated || 0,
          productsSkipped: accSkipped,
          totalCategories: data.totalCategories || 0,
          barcodeCount: accBarcodeCount,
          mode,
          errors: allErrors,
          warnings: data.warnings || [],
          inventoryItemsCreated: data.inventoryItemsCreated,
          inventoryItemsSkipped: data.inventoryItemsSkipped,
          inventoryItemsUpdated: data.inventoryItemsUpdated,
          migrationDataCleaned: data.migrationDataCleaned,
          compositionsCreated: data.compositionsCreated,
          totalStock: data.totalStock,
          totalModalValue: data.totalModalValue,
          status: allErrors.length > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
          totalProducts,
          totalBatches,
          completedBatches: totalBatches,
          currentBatch,
          failedRows: accFailed,
          remainingProducts: 0,
          startBatch: 0,
          batchError: null,
        }
        setResult(importResult)
        setProcessingState(prev => prev ? { ...prev, isProcessing: false } : null)
        onStateChange('success')
        setIsUploading(false)
        onSuccess(importResult)
        return
      }

      // Next batch
      currentBatch++
    }
  }, [selectedFile, mode, onStateChange, onSuccess])

  // MIG-BATCH: Resume handler — re-upload same file with startBatch=completedBatches.
  // Dedup is name-based on the server, so already-created products are skipped
  // automatically (no duplicate products). This is NOT a fake resume.
  const handleResume = useCallback(() => {
    if (!result) return
    const resumeFrom = result.completedBatches || 0
    setStartBatch(resumeFrom)
    handleUpload(resumeFrom)
  }, [result, handleUpload])

  // MIG-BATCH: Download errors as .txt file
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

  // Determine current wizard step
  let wizardStep: WizardStep = 'upload'
  if (state === 'processing') wizardStep = 'processing'
  if (state === 'success') wizardStep = 'success'

  // Derived values for success screen
  const totalItems = (result?.productsCreated ?? 0) + (result?.variantsCreated ?? 0)
  const hasErrors = result && result.errors.length > 0
  const hasSkipped = result && result.productsSkipped > 0
  const hasWarnings = result && result.warnings && result.warnings.length > 0
  const hasRemigration = result && ((result.inventoryItemsUpdated ?? 0) > 0 || (result.migrationDataCleaned ?? 0) > 0)

  // MIG-BATCH: status-aware UI
  const migrationStatus = result?.status || 'COMPLETED'
  const isPartial = migrationStatus === 'PARTIAL'
  const isFailed = migrationStatus === 'FAILED'
  const isCompletedWithErrors = migrationStatus === 'COMPLETED_WITH_ERRORS'
  const showSuccessHeader = !isPartial && !isFailed

  return (
    <div className="relative flex flex-col max-h-[80vh]">
      {/* Step indicator */}
      <div className="px-6 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-2 mb-3">
          {['Upload', 'Proses', 'Selesai'].map((label, i) => {
            const stepOrder = ['upload', 'processing', 'success'] as const
            const currentIdx = stepOrder.indexOf(wizardStep)
            const isActive = i <= currentIdx
            const isCurrent = i === currentIdx

            return (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-2">
                  <div className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold transition-all duration-300 ${
                    isActive
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-white/[0.04] text-slate-600 border border-white/[0.08]'
                  }`}>
                    {i < currentIdx ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span className={`text-xs font-medium transition-colors ${isCurrent ? 'text-white' : isActive ? 'text-slate-400' : 'text-slate-600'}`}>
                    {label}
                  </span>
                </div>
                {i < 2 && (
                  <div className={`flex-1 h-px mx-1 transition-colors ${i < currentIdx ? 'bg-emerald-500/30' : 'bg-white/[0.06]'}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Progress bar — indeterminate during processing (real progress shown on success) */}
        {wizardStep === 'processing' && (
          <Progress value={isUploading ? undefined : 0} className="h-1 bg-white/[0.06] [&>div]:bg-emerald-500" />
        )}
      </div>

      <div className="px-6 pb-6 flex-1 overflow-y-auto custom-scrollbar">
        <AnimatePresence mode="wait">
          {/* ═══════ STEP 1: UPLOAD ═══════ */}
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
                      : 'Gunakan template migrasi atau file Excel dari POS lama Anda'
                  }
                </p>
              </div>

              {/* Download template link */}
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
                    if (blob.size === 0) {
                      throw new Error('File kosong — coba lagi')
                    }
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
                    console.error('[Migration Template] Download failed:', msg)
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
                className={`relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
                  isDragging
                    ? 'border-emerald-500/50 bg-emerald-500/[0.05]'
                    : selectedFile
                      ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
                      : 'border-white/[0.1] bg-white/[0.02] hover:border-white/[0.2] hover:bg-white/[0.04]'
                }`}
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
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedFile(null) }}
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
                      <p className="text-[11px] text-slate-500 mt-1">
                        .xlsx, .xls, .csv — Maks. 5MB
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Mode badge */}
              <div className="flex items-center justify-center gap-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Mode:</span>
                <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-md ${
                  isInventory
                    ? 'text-violet-300 bg-violet-500/15 border border-violet-500/20'
                    : isStockMode
                      ? 'text-cyan-300 bg-cyan-500/15 border border-cyan-500/20'
                      : 'text-emerald-300 bg-emerald-500/15 border border-emerald-500/20'
                }`}>
                  {isInventory ? 'Produk + Komposisi' : isStockMode ? 'Produk + Stok Gudang' : 'Produk Saja'}
                </span>
              </div>

              {/* Resume badge */}
              {startBatch > 0 && (
                <div className="flex items-center justify-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[11px] text-amber-300">
                    Melanjutkan dari batch {startBatch} (dedup aman — produk yang sudah dibuat akan dilewati)
                  </span>
                </div>
              )}

              {/* Error */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
                >
                  <X className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-300">{error}</p>
                </motion.div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDismiss}
                  className="text-xs text-slate-400 hover:text-white flex-1"
                >
                  Kembali
                </Button>
                <Button
                  onClick={() => handleUpload(startBatch)}
                  disabled={!selectedFile || isUploading}
                  className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold h-9 gap-2 disabled:opacity-40"
                >
                  {isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5" />
                  )}
                  {startBatch > 0 ? `Lanjutkan dari batch ${startBatch}` : 'Mulai Import'}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══════ STEP 2: PROCESSING (real-time per-batch progress) ═══════ */}
          {wizardStep === 'processing' && (processingState ? (() => {
            const ps = processingState
            const doneBatches = ps.batches.filter(b => b.status === 'done')
            const completedCount = doneBatches.length
            const totalDurationMs = doneBatches.reduce((sum, b) => sum + b.durationMs, 0)
            const avgBatchMs = completedCount > 0 ? totalDurationMs / completedCount : 0
            const remainingBatches = Math.max(0, ps.totalBatches - completedCount)
            const etaMs = avgBatchMs * remainingBatches
            const processedProducts = ps.totalCreated + ps.totalSkipped + ps.totalFailed
            const progressPct = ps.totalProducts > 0 ? Math.min(100, Math.round((processedProducts / ps.totalProducts) * 100)) : 0
            const currentBatchNum = ps.currentBatch

            return (
              <motion.div
                key="processing"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="py-6 space-y-4"
              >
                {/* Header */}
                <div className="text-center space-y-2">
                  <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-emerald-500/15 border border-emerald-500/20">
                    <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
                  </div>
                  <h3 className="text-sm font-bold text-white">Migrasi Sedang Berjalan</h3>
                  {startBatch > 0 && (
                    <p className="text-[11px] text-amber-300">
                      Melanjutkan dari batch {startBatch + 1} (dedup aman — produk yang sudah dibuat akan dilewati)
                    </p>
                  )}
                </div>

                {/* Progress bar — based on processedProducts / totalProducts (real, not animation) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-semibold">{progressPct}% selesai</span>
                    <span className="text-slate-400 tabular-nums">
                      {formatNumber(processedProducts)} dari {formatNumber(ps.totalProducts)} produk
                    </span>
                  </div>
                  <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500 ease-out"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                {/* Batch + time info */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5 mb-0.5">
                      <Layers className="h-3 w-3 text-emerald-400" />
                      <span className="text-[10px] text-slate-500 uppercase tracking-wide">Batch</span>
                    </div>
                    <p className="text-sm font-bold text-white tabular-nums">
                      {currentBatchNum + 1} <span className="text-slate-500 text-xs">/</span> {ps.totalBatches || '?'}
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

                {/* Stats grid: Dibuat / Dilewati / Gagal / Sisa */}
                <div className="grid grid-cols-4 gap-1.5">
                  <div className="text-center p-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10">
                    <p className="text-sm font-bold text-emerald-300 tabular-nums">{formatNumber(ps.totalCreated)}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">Dibuat</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <p className="text-sm font-bold text-slate-300 tabular-nums">{formatNumber(ps.totalSkipped)}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">Dilewati</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/10">
                    <p className="text-sm font-bold text-amber-300 tabular-nums">{formatNumber(ps.totalFailed)}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">Gagal</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <p className="text-sm font-bold text-slate-300 tabular-nums">{formatNumber(Math.max(0, ps.totalProducts - processedProducts))}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">Sisa</p>
                  </div>
                </div>

                {/* Per-batch status list */}
                {ps.totalBatches > 0 && ps.totalBatches <= 20 && (
                  <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5 space-y-1.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <ListChecks className="h-3 w-3 text-slate-400" />
                      <span className="text-[10px] text-slate-500 uppercase tracking-wide">Status Batch</span>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                      {Array.from({ length: ps.totalBatches }, (_, i) => {
                        const batch = ps.batches.find(b => b.batchNumber === i)
                        const status = batch?.status || (i < ps.currentBatch ? 'done' : 'pending')
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
                            <span className={cn(
                              'tabular-nums',
                              status === 'done' ? 'text-slate-300' :
                              status === 'in_progress' ? 'text-cyan-300 font-semibold' :
                              status === 'failed' ? 'text-red-300' : 'text-slate-600'
                            )}>
                              Batch {i + 1}
                            </span>
                            {batch?.status === 'done' && (
                              <span className="text-[9px] text-slate-500 ml-auto tabular-nums">
                                {batch.created}d · {batch.skipped}s · {batch.failed}f · {formatDuration(batch.durationMs)}
                              </span>
                            )}
                            {batch?.status === 'failed' && (
                              <span className="text-[9px] text-red-400 ml-auto">gagal</span>
                            )}
                            {status === 'in_progress' && (
                              <span className="text-[9px] text-cyan-400 ml-auto">memproses…</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Current batch database write indicator */}
                <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <Database className="h-3.5 w-3.5 text-emerald-400" />
                    <span>
                      Batch {currentBatchNum + 1} sedang disimpan ke database
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 pl-5">
                    Batch yang sudah selesai tetap tersimpan jika proses terhenti.
                    Jangan tutup halaman ini.
                  </p>
                </div>
              </motion.div>
            )
          })() : (
            <div className="py-8 text-center">
              <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mx-auto" />
              <p className="text-xs text-slate-400 mt-3">Memulai migrasi…</p>
            </div>
          ))}

          {/* ═══════ STEP 3: RESULT (success / partial / failed) ═══════ */}
          {wizardStep === 'success' && result && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="py-2 space-y-4"
            >
              {/* Status header — adapts to COMPLETED / COMPLETED_WITH_ERRORS / PARTIAL / FAILED */}
              <div className="text-center space-y-2.5 pt-1">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25, delay: 0.1 }}
                  className={cn(
                    'inline-flex items-center justify-center h-16 w-16 rounded-2xl border',
                    isPartial
                      ? 'bg-amber-500/15 border-amber-500/25'
                      : isFailed
                        ? 'bg-red-500/15 border-red-500/25'
                        : 'bg-emerald-500/15 border-emerald-500/25'
                  )}
                >
                  {isPartial ? (
                    <AlertTriangle className="h-8 w-8 text-amber-400" />
                  ) : isFailed ? (
                    <X className="h-8 w-8 text-red-400" />
                  ) : (
                    <PartyPopper className="h-8 w-8 text-emerald-400" />
                  )}
                </motion.div>
                <motion.h3
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-xl font-bold text-white"
                >
                  {isPartial
                    ? 'Migrasi Sebagian Berhasil'
                    : isFailed
                      ? 'Migrasi Gagal'
                      : isCompletedWithErrors
                        ? 'Import Berhasil (dengan error)'
                        : 'Import Berhasil'}
                </motion.h3>

                {/* Status badge */}
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <span className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border',
                    isPartial
                      ? 'bg-amber-500/15 border-amber-500/25 text-amber-300'
                      : isFailed
                        ? 'bg-red-500/15 border-red-500/25 text-red-300'
                        : 'bg-emerald-500/15 border-emerald-500/25 text-emerald-300'
                  )}>
                    {isPartial ? <AlertTriangle className="h-3.5 w-3.5" /> : isFailed ? <X className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}
                    {isPartial
                      ? `${formatNumber(result.completedBatches || 0)} dari ${formatNumber(result.totalBatches || 0)} batch selesai`
                      : isFailed
                        ? 'Tidak ada batch yang berhasil'
                        : `${formatNumber(totalItems)} item berhasil diimport`
                    }
                  </span>
                </motion.div>
              </div>

              {/* MIG-BATCH: Real batch progress breakdown */}
              {(result.totalBatches !== undefined && result.totalBatches > 0) && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                  className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-xs font-semibold text-slate-300">Progress Batch</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-center p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <p className="text-base font-bold text-white">{formatNumber(result.productsCreated || 0)}</p>
                      <p className="text-[10px] text-slate-500">Dibuat</p>
                    </div>
                    <div className="text-center p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <p className="text-base font-bold text-white">{formatNumber(result.productsSkipped || 0)}</p>
                      <p className="text-[10px] text-slate-500">Dilewati (duplikat)</p>
                    </div>
                    <div className="text-center p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <p className="text-base font-bold text-amber-300">{formatNumber(result.failedRows || 0)}</p>
                      <p className="text-[10px] text-slate-500">Gagal</p>
                    </div>
                    <div className="text-center p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <p className="text-base font-bold text-slate-300">{formatNumber(result.remainingProducts || 0)}</p>
                      <p className="text-[10px] text-slate-500">Sisa</p>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 text-center">
                    Batch {result.completedBatches || 0} / {result.totalBatches || 0} selesai
                    {result.totalProducts !== undefined && ` · ${formatNumber(result.totalProducts)} total produk`}
                  </div>
                </motion.div>
              )}

              {/* PARTIAL: batch failure details */}
              {isPartial && result.batchError && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-xs font-semibold text-amber-300">Batch Gagal</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed break-all">
                    {result.batchError}
                  </p>
                  <div className="flex items-center gap-4 pt-1 text-[10px] text-slate-400">
                    <span>Batch dibuat: <strong className="text-emerald-300">{formatNumber(result.productsCreated || 0)}</strong></span>
                    <span>Sisa: <strong className="text-amber-300">{formatNumber(result.remainingProducts || 0)}</strong></span>
                  </div>
                </motion.div>
              )}

              {/* Stats grid — Products */}
              {showSuccessHeader && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="space-y-2"
                >
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex items-center justify-center mb-1.5">
                        <Package className="h-3.5 w-3.5 text-emerald-400" />
                      </div>
                      <p className="text-lg font-bold text-white">{formatNumber(result.productsCreated)}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Produk</p>
                    </div>
                    <div className="text-center p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex items-center justify-center mb-1.5">
                        <GitBranch className="h-3.5 w-3.5 text-amber-400" />
                      </div>
                      <p className="text-lg font-bold text-white">{formatNumber(result.variantsCreated)}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Varian</p>
                    </div>
                    <div className="text-center p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex items-center justify-center mb-1.5">
                        <Tags className="h-3.5 w-3.5 text-cyan-400" />
                      </div>
                      <p className="text-lg font-bold text-white">{formatNumber(result.totalCategories)}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Kategori</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-center p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex items-center justify-center mb-1">
                        <ScanBarcode className="h-3.5 w-3.5 text-violet-400" />
                      </div>
                      <p className="text-base font-bold text-white">{formatNumber(result.barcodeCount)}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Barcode</p>
                    </div>
                    {hasSkipped ? (
                      <div className="text-center p-2.5 rounded-xl bg-amber-500/[0.04] border border-amber-500/10">
                        <div className="flex items-center justify-center mb-1">
                          <Copy className="h-3.5 w-3.5 text-amber-400" />
                        </div>
                        <p className="text-base font-bold text-amber-300">{formatNumber(result.productsSkipped)}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Duplikat Dilewati</p>
                      </div>
                    ) : (
                      <div className="text-center p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                        <div className="flex items-center justify-center mb-1">
                          <Copy className="h-3.5 w-3.5 text-slate-500" />
                        </div>
                        <p className="text-base font-bold text-slate-500">0</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Duplikat Dilewati</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Inventory stats (product_stock and product_inventory modes) */}
              {hasInventory && (result.inventoryItemsCreated !== undefined || result.compositionsCreated !== undefined) && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55 }}
                  className={cn(
                    'rounded-xl border p-4 space-y-3',
                    isStockMode
                      ? 'bg-cyan-500/[0.06] border-cyan-500/15'
                      : 'bg-violet-500/[0.06] border-violet-500/15',
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Boxes className={cn('h-3.5 w-3.5', isStockMode ? 'text-cyan-400' : 'text-violet-400')} />
                    <span className={cn('text-xs font-semibold', isStockMode ? 'text-cyan-300' : 'text-violet-300')}>
                      {isStockMode ? 'Stok Gudang' : 'Inventory Bahan Baku'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center">
                      <p className="text-base font-bold text-white">{formatNumber(result.inventoryItemsCreated)}</p>
                      <p className="text-[10px] text-slate-500">{isStockMode ? 'Item Stok' : 'Item'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-base font-bold text-white">{formatNumber(result.totalStock)}</p>
                      <p className="text-[10px] text-slate-500">Total Stok</p>
                    </div>
                    <div className="text-center">
                      <p className="text-base font-bold text-white">{formatCurrency(result.totalModalValue ?? 0)}</p>
                      <p className="text-[10px] text-slate-500">Nilai Modal</p>
                    </div>
                  </div>
                  {isStockMode ? (
                    <div className="flex items-center gap-2 pt-2 border-t border-cyan-500/10">
                      <Link2 className="h-3 w-3 text-cyan-400/70 shrink-0" />
                      <span className="text-[11px] text-slate-400">
                        Produk otomatis terhubung ke stok gudang
                      </span>
                    </div>
                  ) : result.compositionsCreated !== undefined && result.compositionsCreated > 0 ? (
                    <div className="flex items-center gap-2 pt-2 border-t border-violet-500/10">
                      <FlaskConical className="h-3 w-3 text-violet-400/70 shrink-0" />
                      <span className="text-[11px] text-slate-400">
                        <span className="text-violet-300 font-semibold">{formatNumber(result.compositionsCreated)}</span> komposisi resep terbuat
                      </span>
                    </div>
                  ) : null}
                </motion.div>
              )}

              {/* Re-Migration Info */}
              {hasRemigration && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="rounded-xl bg-emerald-500/[0.06] border border-emerald-500/15 p-3 space-y-2.5"
                >
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-300">
                      Re-Migrasi: Data Diperbarui
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(result.inventoryItemsUpdated ?? 0) > 0 && (
                      <div className="rounded-md bg-emerald-500/[0.08] px-2 py-1.5 text-center">
                        <p className="text-sm font-bold text-emerald-300">{formatNumber(result.inventoryItemsUpdated)}</p>
                        <p className="text-[9px] text-slate-500">Item Di-update</p>
                      </div>
                    )}
                    {(result.migrationDataCleaned ?? 0) > 0 && (
                      <div className="rounded-md bg-cyan-500/[0.08] px-2 py-1.5 text-center">
                        <p className="text-sm font-bold text-cyan-300">{formatNumber(result.migrationDataCleaned ?? 0)}</p>
                        <p className="text-[9px] text-slate-500">Data Lama Dibersihkan</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Warnings from re-migration */}
              {hasWarnings && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65 }}
                  className="rounded-xl bg-blue-500/[0.06] border border-blue-500/15 p-3 space-y-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-xs font-semibold text-blue-300">
                      {result.warnings!.length} Info Migrasi
                    </span>
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {result.warnings!.map((warn, i) => (
                      <p key={i} className="text-[11px] text-slate-400 leading-relaxed pl-5.5 relative before:content-['·'] before:absolute before:left-1.5 before:text-blue-500/60 before:font-bold">
                        {warn}
                      </p>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* MIG-BATCH: Per-row validation errors (scrollable, with row numbers) */}
              {hasErrors && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65 }}
                  className="rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CircleAlert className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-xs font-semibold text-amber-300">
                        {result.errors.length} baris bermasalah
                      </span>
                    </div>
                    <button
                      onClick={handleDownloadErrors}
                      className="text-[10px] text-amber-300 hover:text-amber-200 transition-colors flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" />
                      Unduh
                    </button>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-[11px] text-slate-400 leading-relaxed pl-5.5 relative before:content-['·'] before:absolute before:left-1.5 before:text-amber-500/60 before:font-bold">
                        {err}
                      </p>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Critical Warning: Inventory not created in stock/inventory mode */}
              {hasInventory && result.productsCreated > 0 && result.inventoryItemsCreated === 0 && !hasErrors && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65 }}
                  className="rounded-xl bg-red-500/[0.06] border border-red-500/15 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                    <span className="text-xs font-semibold text-red-300">
                      Peringatan Stok/Inventory
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {isStockMode
                      ? 'Produk berhasil dibuat, tapi stok gudang TIDAK terbuat. Pastikan kolom STOK AWAL terisi di template.'
                      : 'Produk berhasil dibuat, tapi item inventory TIDAK terbuat. Pastikan sheet "Bahan Baku" terisi atau STOK AWAL > 0.'
                    }
                  </p>
                </motion.div>
              )}

              {hasInventory && result.productsCreated > 0 && result.inventoryItemsCreated! > 0 && result.inventoryItemsCreated < result.productsCreated && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65 }}
                  className="rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-xs font-semibold text-amber-300">
                      Sebagian Inventory Gagal
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {formatNumber(result.productsCreated - (result.inventoryItemsCreated ?? 0))} produk tidak memiliki inventory/stok. Pastikan kolom STOK AWAL terisi.
                  </p>
                </motion.div>
              )}

              {/* MIG-BATCH: Action buttons — 3 required for PARTIAL/FAILED, single for COMPLETED */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.75 }}
                className="space-y-2"
              >
                {/* PARTIAL / FAILED: resume + download errors + close */}
                {(isPartial || isFailed) && (
                  <>
                    <Button
                      onClick={handleResume}
                      disabled={isUploading}
                      className="w-full bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold h-10 gap-2"
                    >
                      {isUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      Lanjutkan Migrasi (dari batch {result.completedBatches || 0})
                    </Button>
                    {hasErrors && (
                      <Button
                        onClick={handleDownloadErrors}
                        variant="outline"
                        className="w-full text-xs font-semibold h-9 gap-2 border-white/[0.1] text-slate-300 hover:text-white hover:bg-white/[0.04]"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Unduh Daftar Error
                      </Button>
                    )}
                  </>
                )}

                {/* COMPLETED / COMPLETED_WITH_ERRORS: download errors (if any) + close */}
                {!isPartial && !isFailed && hasErrors && (
                  <Button
                    onClick={handleDownloadErrors}
                    variant="outline"
                    className="w-full text-xs font-semibold h-9 gap-2 border-white/[0.1] text-slate-300 hover:text-white hover:bg-white/[0.04]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Unduh Daftar Error
                  </Button>
                )}

                {/* Next steps hint (only for fully completed) */}
                {showSuccessHeader && (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15">
                    <TrendingUp className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {isInventory
                        ? <>Stok awal migrasi sudah tercatat. Untuk restock, gunakan menu <span className="font-semibold text-white">Pembelian</span></>
                        : <>Stok awal migrasi sudah tercatat di audit log. Buka <span className="font-semibold text-white">POS</span> untuk mulai transaksi</>
                      }
                    </p>
                  </div>
                )}

                <Button
                  onClick={onClose}
                  variant={isPartial || isFailed ? 'ghost' : 'default'}
                  className={cn(
                    'w-full text-sm font-semibold h-10 gap-2',
                    !isPartial && !isFailed && 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  )}
                >
                  {isPartial || isFailed ? 'Tutup' : 'Mulai Berjualan'}
                  {!isPartial && !isFailed && <ArrowRight className="h-4 w-4" />}
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
