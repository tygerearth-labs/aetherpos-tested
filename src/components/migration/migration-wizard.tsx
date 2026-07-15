'use client'

import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, FileSpreadsheet, Check, Loader2,
  PartyPopper, ArrowRight, Download,
  Package, Boxes, X,
  FileSearch, ClipboardCheck, ArrowRightLeft, Cpu, Database,
  CircleCheck, CircleAlert, Copy, GitBranch, Tags, ScanBarcode,
  FlaskConical, TrendingUp, Link2, AlertTriangle,
  RefreshCw, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { ImportMode, ImportResult } from './migration-banner'

type WizardStep = 'upload' | 'processing' | 'success'

interface ProcessingStep {
  id: string
  label: string
  icon: React.ElementType
  status: 'pending' | 'active' | 'done'
}

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
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([])
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  // Mutable ref so the setTimeout chain can accumulate "done" steps
  // without reverting to the original "pending" array on each tick.
  const stepsRef = useRef<ProcessingStep[]>([])

  const isInventory = mode === 'product_inventory'
  const isStockMode = mode === 'product_stock'
  const hasInventory = isInventory || isStockMode

  const baseSteps: ProcessingStep[] = [
    { id: 'reading', label: 'Membaca file', icon: FileSearch, status: 'pending' },
    { id: 'validating', label: 'Validasi data', icon: ClipboardCheck, status: 'pending' },
    { id: 'mapping', label: 'Mapping kolom', icon: ArrowRightLeft, status: 'pending' },
    { id: 'creating_product', label: 'Membuat Product', icon: Cpu, status: 'pending' },
  ]

  if (hasInventory) {
    baseSteps.push({ id: 'creating_inventory', label: isStockMode ? 'Membuat Stok Gudang' : 'Membuat Inventory', icon: Database, status: 'pending' })
  }

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

  const simulateProcessing = useCallback((steps: ProcessingStep[]) => {
    const durations = [600, 800, 600, 1200, ...(hasInventory ? [1000] : [])]
    let stepIndex = 0

    // Store a mutable copy in the ref so each tick builds on the previous state
    const mutableSteps = steps.map(s => ({ ...s }))
    stepsRef.current = mutableSteps
    setProcessingSteps([...mutableSteps])
    onStateChange('processing')

    const runStep = () => {
      if (stepIndex >= mutableSteps.length) return

      // Mark current as active (previous steps retain their 'done' status)
      mutableSteps[stepIndex] = { ...mutableSteps[stepIndex], status: 'active' }
      setProcessingSteps([...mutableSteps])
      setProgress(((stepIndex + 0.5) / mutableSteps.length) * 100)

      setTimeout(() => {
        mutableSteps[stepIndex] = { ...mutableSteps[stepIndex], status: 'done' }
        setProcessingSteps([...mutableSteps])
        setProgress(((stepIndex + 1) / mutableSteps.length) * 100)
        stepIndex++
        if (stepIndex < mutableSteps.length) {
          runStep()
        }
      }, durations[stepIndex])
    }

    // Small delay before starting
    setTimeout(runStep, 300)
  }, [hasInventory, onStateChange])

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return
    setIsUploading(true)
    setError(null)

    try {
      // Start processing animation
      const steps = baseSteps.map(s => ({ ...s, status: 'pending' as const }))
      simulateProcessing(steps)

      // Actually upload the file
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('mode', mode)

      const res = await fetch('/api/migration/import', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok || data.error) {
        setError(data.error || data.details || 'Gagal memproses file')
        onStateChange('uploading')
        setIsUploading(false)
        return
      }

      // Wait for processing animation to finish before showing success
      const totalAnimTime = baseSteps.length * 800 + 500
      setTimeout(() => {
        const importResult: ImportResult = {
          productsCreated: data.productsCreated,
          variantsCreated: data.variantsCreated,
          productsSkipped: data.productsSkipped,
          totalCategories: data.totalCategories,
          barcodeCount: data.barcodeCount,
          mode,
          errors: data.errors || [],
          warnings: data.warnings || [],
          inventoryItemsCreated: data.inventoryItemsCreated,
          inventoryItemsSkipped: data.inventoryItemsSkipped,
          inventoryItemsUpdated: data.inventoryItemsUpdated,
          migrationDataCleaned: data.migrationDataCleaned,
          compositionsCreated: data.compositionsCreated,
          totalStock: data.totalStock,
          totalModalValue: data.totalModalValue,
        }
        setResult(importResult)
        onStateChange('success')
        setIsUploading(false)
        onSuccess(importResult)
      }, totalAnimTime)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses file')
      onStateChange('uploading')
      setIsUploading(false)
    }
  }, [selectedFile, mode, baseSteps, simulateProcessing, onStateChange, onSuccess])

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
                <div className={`flex items-center gap-2 ${isCurrent ? '' : ''}`}>
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

        {/* Progress bar */}
        {wizardStep === 'processing' && (
          <Progress value={progress} className="h-1 bg-white/[0.06] [&>div]:bg-emerald-500" />
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
                      // Try to parse error message from server
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
                  onClick={handleUpload}
                  disabled={!selectedFile || isUploading}
                  className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold h-9 gap-2 disabled:opacity-40"
                >
                  {isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5" />
                  )}
                  Mulai Import
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══════ STEP 2: PROCESSING ═══════ */}
          {wizardStep === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="py-4 space-y-3"
            >
              <div className="text-center space-y-1 mb-5">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-emerald-500/15 border border-emerald-500/20 mb-2">
                  <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
                </div>
                <h3 className="text-sm font-bold text-white">Memproses Import...</h3>
                <p className="text-xs text-slate-400">Mohon tunggu, jangan tutup halaman ini</p>
              </div>

              {/* Step list */}
              <div className="space-y-2">
                {processingSteps.map((step, i) => {
                  const Icon = step.icon
                  return (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
                    >
                      <div className={`flex items-center justify-center h-7 w-7 rounded-lg shrink-0 transition-all duration-300 ${
                        step.status === 'done'
                          ? 'bg-emerald-500/20 border border-emerald-500/30'
                          : step.status === 'active'
                            ? 'bg-emerald-500/10 border border-emerald-500/20 animate-pulse'
                            : 'bg-white/[0.04] border border-white/[0.06]'
                      }`}>
                        {step.status === 'done' ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : step.status === 'active' ? (
                          <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin" />
                        ) : (
                          <Icon className="h-3.5 w-3.5 text-slate-600" />
                        )}
                      </div>
                      <span className={`text-xs font-medium transition-colors ${
                        step.status === 'done'
                          ? 'text-emerald-400'
                          : step.status === 'active'
                            ? 'text-white'
                            : 'text-slate-600'
                      }`}>
                        {step.label}
                      </span>
                    </motion.div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* ═══════ STEP 3: SUCCESS ═══════ */}
          {wizardStep === 'success' && result && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="py-2 space-y-4"
            >
              {/* Success header */}
              <div className="text-center space-y-2.5 pt-1">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25, delay: 0.1 }}
                  className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/25"
                >
                  <PartyPopper className="h-8 w-8 text-emerald-400" />
                </motion.div>
                <motion.h3
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-xl font-bold text-white"
                >
                  Import Berhasil
                </motion.h3>

                {/* Confirmation badge */}
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs font-semibold">
                    <CircleCheck className="h-3.5 w-3.5" />
                    Semua {formatNumber(totalItems)} item berhasil diimport
                  </span>
                </motion.div>
              </div>

              {/* Stats grid — Products */}
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
                      <p className="text-base font-bold text-white">{formatCurrency(result.totalModalValue)}</p>
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

              {/* Re-Migration Info: Items updated/cleaned during re-migration */}
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
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Item yang hanya memiliki data migrasi (stok awal testing) telah di-replace dengan data baru.
                  </p>
                </motion.div>
              )}

              {/* Warnings from re-migration (skipped items with real history) */}
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

              {/* Errors/Warnings section */}
              {hasErrors && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65 }}
                  className="rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3 space-y-2.5"
                >
                  <div className="flex items-center gap-2">
                    <CircleAlert className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-xs font-semibold text-amber-300">
                      {result.errors.length} peringatan
                    </span>
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
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

              {hasInventory && result.productsCreated > 0 && result.inventoryItemsCreated > 0 && result.inventoryItemsCreated < result.productsCreated && (
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
                    {formatNumber(result.productsCreated - result.inventoryItemsCreated)} produk tidak memiliki inventory/stok. Pastikan kolom STOK AWAL terisi.
                  </p>
                </motion.div>
              )}

              {/* Next steps hint */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.75 }}
                className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15"
              >
                <TrendingUp className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-300 leading-relaxed">
                  {isInventory
                    ? <>Stok awal migrasi sudah tercatat. Untuk restock, gunakan menu <span className="font-semibold text-white">Pembelian</span></>
                    : <>Stok awal migrasi sudah tercatat di audit log. Buka <span className="font-semibold text-white">POS</span> untuk mulai transaksi</>
                  }
                </p>
              </motion.div>

              {/* Close button */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85 }}
              >
                <Button
                  onClick={onClose}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold h-10 gap-2"
                >
                  Mulai Berjualan
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}