'use client'

/**
 * StockOpnamePage.tsx — V3
 *
 * Full workflow redesign with compact operational UX.
 *
 * Flow: DRAFT → COUNTING → REVIEW → COMPLETED
 *   (+ PAUSED: client-side UI state for "Tunda Sesi")
 *
 * V3 changes:
 *   - Start page: 3 mode cards (ALL/CATEGORY/SELECTED) + active panel + summary
 *   - Counting: compact session header with chips (no oversized cards),
 *     scan bar, compact QuickCountWidget with [−][input][+], filter toolbar,
 *     compact table, mobile bottom action bar
 *   - No play/pause icons — explicit labels everywhere
 *   - Tunda Sesi (pause) → PAUSED status → resume card on start page
 *   - Batalkan Sesi (cancel) in overflow menu, not standalone trash button
 *   - Review: compact summary + differences-default
 *   - Complete: immutable completionSummary, "Terapkan N Penyesuaian" or
 *     "Selesaikan Tanpa Penyesuaian" (zero-adjustment case)
 *
 * Controller owns all state + actions. Presentational sub-components live in
 * src/components/stock-opname/. This is NOT the SO-V2-DEBT-1 full refactor.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { usePageStore } from '@/hooks/use-page-store'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  ClipboardCheck,
  Search,
  AlertTriangle,
  CheckCircle2,
  Save,
  Camera,
  ScanLine,
  MoreVertical,
  Trash2,
  Pause,
  ArrowRight,
  Loader2,
  FileText,
  WifiOff,
  Wifi,
  PlusCircle,
  MinusCircle,
  History,
  Filter,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  startOpname,
  completeOpname,
  cancelOpname,
  pauseOpname,
  resumePausedOpname,
  resumeOpname,
  getAllSnapshots,
  updateCount,
  findByScan,
  getOpnameSession,
  setReviewing,
  previewOpname,
  buildCompletionSummary,
  getOpnameCategories,
  type OpnameStatus,
  type OpnameScope,
  type SnapshotItem,
  type OpnameSession,
  type CompleteResult,
  type CompletionSummary,
  type OpnameCategory,
} from '@/lib/stock-opname/service'
import {
  VARIANCE_EPSILON,
  fmtTime,
  fmtDateTime,
  fmtQty,
  fmtSignedDelta,
  varianceOf,
  isMatched,
  isDifference,
  impactText,
  STATUS_FILTER_OPTIONS,
  SORT_OPTIONS,
  type CountingFilter,
  type SortMode,
} from '@/components/stock-opname/types'
import {
  StockOpnameModeSelector,
  AllItemsModePanel,
  CategoryModePanel,
  SelectedItemsModePanel,
  StockOpnameSessionSummary,
} from '@/components/stock-opname/mode-selector'
import { StockOpnameQuickCountWidget } from '@/components/stock-opname/quick-count-widget'
import { BarcodeScannerDialog } from '@/components/shared/barcode-scanner-dialog'
import {
  StockOpnameStartDialog,
  StockOpnamePauseDialog,
  StockOpnameCancelDialog,
  StockOpnameCompleteDialog,
} from '@/components/stock-opname/dialogs'

// ════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════

export default function StockOpnamePage() {
  // ── Navigation ──
  const { setCurrentPage } = usePageStore()

  // ── Page-level state ──
  const [status, setStatus] = useState<OpnameStatus | 'COMPLETED' | null>(null)
  const [session, setSession] = useState<OpnameSession | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([])
  const [loading, setLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)

  // ── Start page state ──
  const [mode, setMode] = useState<OpnameScope>('ALL_ITEMS')
  const [includeZeroStock, setIncludeZeroStock] = useState(true)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [preview, setPreview] = useState<{
    itemCount: number
    categoryCount: number
    categories: OpnameCategory[]
    snapshotAt: string
  } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // ── Counting state ──
  const [scanInput, setScanInput] = useState('')
  const scanInputRef = useRef<HTMLInputElement>(null)
  const [focusedSnapshot, setFocusedSnapshot] = useState<SnapshotItem | null>(null)
  // Camera barcode scanner dialog state (counting search bar camera button)
  const [scanDialogOpen, setScanDialogOpen] = useState(false)
  const [filterMode, setFilterMode] = useState<CountingFilter>('ALL')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [sortMode, setSortMode] = useState<SortMode>('NAME')
  const [categories, setCategories] = useState<OpnameCategory[]>([])

  // ── Responsive: mobile uses a Dialog for counting; desktop uses floating card ──
  const isMobile = useIsMobile()

  // ── Review state ──
  const [reviewFilter, setReviewFilter] = useState<'DIFFERENCE' | 'ALL'>('DIFFERENCE')
  const [notes, setNotes] = useState('')

  // ── Complete state (immutable) ──
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null)
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null)

  // ── Dialogs ──
  const [showStartDialog, setShowStartDialog] = useState(false)
  const [showPauseDialog, setShowPauseDialog] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)

  // ════════════════════════════════════════════════════════════
  // Init: online/offline + resume existing session
  // ════════════════════════════════════════════════════════════
  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    setIsOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    checkExistingSession().finally(() => setBootstrapping(false))
  }, [])

  const checkExistingSession = async () => {
    try {
      const existing = await resumeOpname()
      if (existing) {
        setStatus(existing.status)
        setSession(existing)
        if (existing.status !== 'PAUSED') {
          const snaps = await getAllSnapshots()
          setSnapshots(snaps)
          const cats = await getOpnameCategories()
          setCategories(cats)
        }
        setNotes(existing.notes || '')
        setLastSavedAt(new Date().toISOString())
      }
    } catch (error) {
      console.error('[StockOpname] Resume error:', error)
    }
  }

  // ════════════════════════════════════════════════════════════
  // Preview (start page)
  // ════════════════════════════════════════════════════════════
  useEffect(() => {
    if (status !== null) return
    let cancelled = false
    setPreviewLoading(true)
    previewOpname('current', {
      scope: mode,
      categoryIds: mode === 'CATEGORY' ? selectedCategoryIds : undefined,
      selectedItemIds: mode === 'SELECTED_ITEMS' ? selectedItemIds : undefined,
      includeZeroStock,
    })
      .then((p) => {
        if (!cancelled) setPreview(p)
      })
      .catch((err) => {
        console.error('[StockOpname] Preview error:', err)
        if (!cancelled) setPreview(null)
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status, mode, includeZeroStock, selectedCategoryIds, selectedItemIds])

  // ════════════════════════════════════════════════════════════
  // Derived stats — canonical
  // ════════════════════════════════════════════════════════════
  const stats = useMemo(() => {
    const itemSnapshots = snapshots.filter((s) => s.batchId === null)
    const totalItems = session?.totalItems ?? itemSnapshots.length
    const countedItems = itemSnapshots.filter((s) => s.physicalQty !== null).length
    const uncountedItems = totalItems - countedItems
    const matchedItems = itemSnapshots.filter(isMatched).length
    const differenceItems = itemSnapshots.filter(isDifference).length
    return { totalItems, countedItems, uncountedItems, matchedItems, differenceItems }
  }, [snapshots, session])

  // ════════════════════════════════════════════════════════════
  // Actions: start
  // ════════════════════════════════════════════════════════════
  const handleStartConfirm = async () => {
    setLoading(true)
    try {
      const result = await startOpname('current', {
        scope: mode,
        categoryIds: mode === 'CATEGORY' ? selectedCategoryIds : undefined,
        selectedItemIds: mode === 'SELECTED_ITEMS' ? selectedItemIds : undefined,
        includeZeroStock,
      })
      const newSession = await getOpnameSession()
      setStatus('COUNTING')
      setSession(newSession)
      const snaps = await getAllSnapshots()
      setSnapshots(snaps)
      const cats = await getOpnameCategories()
      setCategories(cats)
      setLastSavedAt(new Date().toISOString())
      setShowStartDialog(false)
      toast.success('Stock opname dimulai', {
        description: `${result.totalItems} item siap dihitung`,
      })
      setTimeout(() => scanInputRef.current?.focus(), 100)
    } catch (error) {
      toast.error('Gagal memulai stock opname')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  // ════════════════════════════════════════════════════════════
  // Actions: scan
  // ════════════════════════════════════════════════════════════
  const handleScan = useCallback(async () => {
    const value = scanInput.trim()
    if (!value) return
    const found = await findByScan(value)
    if (found) {
      setFocusedSnapshot(found)
      setScanInput('')
    } else {
      toast.error('Item tidak ditemukan', {
        description: `"${value}" tidak cocok dengan SKU / nama / batch`,
      })
      setScanInput('')
      scanInputRef.current?.focus()
    }
  }, [scanInput])

  // Camera scanner result — verifies the scanned code matches a snapshot in
  // the ACTIVE opname session only (Dexie lookup via findByScan, which never
  // creates new snapshots). On FOUND: focuses the matched snapshot (opens/
  // refreshes the QuickCountWidget via key={focusedSnapshot.id}) and returns
  // true so the scanner auto-closes (closeOnSuccess). On NOT_FOUND: shows an
  // actionable error and returns false so the scanner stays open for re-scan.
  // Items outside the active session are NEVER added automatically — findByScan
  // only searches existing snapshots and never creates new ones (verified in
  // src/lib/stock-opname/service.ts).
  const handleScanResult = useCallback(async (code: string): Promise<boolean> => {
    const trimmed = code.trim()
    if (!trimmed) return false
    const found = await findByScan(trimmed)
    if (found) {
      setFocusedSnapshot(found)
      toast.success(`"${found.itemName}" difokuskan`)
      // QuickCountWidget remounts via key={focusedSnapshot.id} and auto-focuses
      // its physical-qty input on mount (existing useEffect in
      // quick-count-widget.tsx) so the operator can type the count immediately.
      return true
    }
    toast.error('Item tidak ditemukan', {
      description: `"${trimmed}" tidak cocok dengan SKU / nama / batch item di sesi opname aktif. Item di luar sesi tidak ditambahkan otomatis.`,
    })
    return false
  }, [])

  // ════════════════════════════════════════════════════════════
  // Actions: save physical count (from QuickCountWidget)
  // ════════════════════════════════════════════════════════════
  const handleSaveCount = async (snapshotId: string, qty: number) => {
    try {
      await updateCount(snapshotId, qty)
      setSnapshots((prev) =>
        prev.map((s) =>
          s.id === snapshotId
            ? { ...s, physicalQty: qty, isCounted: true, updatedAt: new Date().toISOString() }
            : s
        )
      )
      setLastSavedAt(new Date().toISOString())
      // Select next uncounted item if available
      const itemSnapshots = snapshots.filter((s) => s.batchId === null)
      const currentIdx = itemSnapshots.findIndex((s) => s.id === snapshotId)
      const nextUncounted = itemSnapshots
        .slice(currentIdx + 1)
        .find((s) => s.physicalQty === null && s.id !== snapshotId)
      if (nextUncounted) {
        setFocusedSnapshot(nextUncounted)
      } else {
        setFocusedSnapshot(null)
        setTimeout(() => scanInputRef.current?.focus(), 50)
      }
    } catch (error) {
      toast.error('Gagal menyimpan hitungan')
      console.error(error)
    }
  }

  const handleSkipCount = () => {
    // Skip to next uncounted item
    const itemSnapshots = snapshots.filter((s) => s.batchId === null)
    if (!focusedSnapshot) return
    const currentIdx = itemSnapshots.findIndex((s) => s.id === focusedSnapshot.id)
    const nextUncounted = itemSnapshots
      .slice(currentIdx + 1)
      .find((s) => s.physicalQty === null)
    if (nextUncounted) {
      setFocusedSnapshot(nextUncounted)
    } else {
      setFocusedSnapshot(null)
      setTimeout(() => scanInputRef.current?.focus(), 50)
    }
  }

  // Minimize the counting widget (mobile): dismiss the dialog and surface the
  // "Stock Opname Berjalan" pill. The pill re-opens the dialog via the
  // `so-resume-counting` event below.
  const handleMinimizeCount = useCallback(() => {
    setFocusedSnapshot(null)
    setTimeout(() => scanInputRef.current?.focus(), 50)
  }, [])

  // Listen for the "so-resume-counting" custom event dispatched by the global
  // Stock Opname pill when tapped on the SO page (mobile, counting minimized).
  // Re-focus the next uncounted item, or the first item if all are counted.
  useEffect(() => {
    const onResume = () => {
      const itemSnapshots = snapshots.filter((s) => s.batchId === null)
      const nextUncounted = itemSnapshots.find((s) => s.physicalQty === null)
      setFocusedSnapshot(nextUncounted ?? itemSnapshots[0] ?? null)
    }
    window.addEventListener('so-resume-counting', onResume)
    return () => window.removeEventListener('so-resume-counting', onResume)
  }, [snapshots])

  // ════════════════════════════════════════════════════════════
  // Actions: pause / resume / cancel
  // ════════════════════════════════════════════════════════════
  const handlePause = async () => {
    try {
      await pauseOpname()
      setStatus('PAUSED')
      setSession((prev) => (prev ? { ...prev, status: 'PAUSED' } : null))
      setShowPauseDialog(false)
      setFocusedSnapshot(null)
      toast.info('Sesi ditunda', {
        description: 'Progres tersimpan di perangkat. Klik Lanjutkan untuk melanjutkan.',
      })
    } catch (error) {
      toast.error('Gagal menunda sesi')
      console.error(error)
    }
  }

  const handleResume = async () => {
    try {
      await resumePausedOpname()
      const snaps = await getAllSnapshots()
      setSnapshots(snaps)
      setStatus('COUNTING')
      setSession((prev) => (prev ? { ...prev, status: 'COUNTING' } : null))
      setTimeout(() => scanInputRef.current?.focus(), 100)
    } catch (error) {
      toast.error('Gagal melanjutkan sesi')
      console.error(error)
    }
  }

  const handleCancel = async () => {
    try {
      await cancelOpname()
      setStatus(null)
      setSession(null)
      setSnapshots([])
      setCompletionSummary(null)
      setCompleteResult(null)
      setShowCancelDialog(false)
      toast.info('Stock opname dibatalkan')
    } catch (error) {
      toast.error('Gagal membatalkan')
    }
  }

  // ════════════════════════════════════════════════════════════
  // Actions: review / complete
  // ════════════════════════════════════════════════════════════
  const handleEnterReview = async () => {
    await setReviewing(notes)
    setStatus('REVIEW')
    setSession((prev) => (prev ? { ...prev, status: 'REVIEW', notes: notes || null } : null))
    toast.success('Masuk mode Review')
  }

  const handleOpenCompleteDialog = async () => {
    try {
      const summary = await buildCompletionSummary()
      setCompletionSummary(summary)
      setShowCompleteDialog(true)
    } catch (error) {
      console.error('[StockOpname] buildCompletionSummary error:', error)
      toast.error('Gagal menyiapkan ringkasan penyelesaian')
    }
  }

  const handleComplete = async () => {
    if (!completionSummary) return
    setLoading(true)
    try {
      const result = await completeOpname()
      setCompleteResult(result)
      setShowCompleteDialog(false)
      setStatus('COMPLETED')
      setSnapshots([])
      setSession(null)
      toast.success('Stock opname berhasil diselesaikan!', {
        description: `${result.summary.adjustmentsMade} penyesuaian diterapkan`,
      })
    } catch (error) {
      toast.error('Gagal menyelesaikan stock opname', {
        description: error instanceof Error ? error.message : undefined,
      })
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleNewSession = () => {
    setStatus(null)
    setCompletionSummary(null)
    setCompleteResult(null)
    setNotes('')
    setMode('ALL_ITEMS')
    setIncludeZeroStock(true)
    setSelectedCategoryIds([])
    setSelectedItemIds([])
  }

  // ════════════════════════════════════════════════════════════
  // Filtered + sorted snapshots (COUNTING page)
  // ════════════════════════════════════════════════════════════
  const filteredSnapshots = useMemo(() => {
    let list = snapshots.filter((s) => s.batchId === null)

    if (filterCategory !== 'all') {
      list = list.filter((s) => (s.categoryId || '__none__') === filterCategory)
    }

    switch (filterMode) {
      case 'UNCOUNTED':
        list = list.filter((s) => s.physicalQty === null)
        break
      case 'COUNTED':
        list = list.filter((s) => s.physicalQty !== null)
        break
      case 'MATCHED':
        list = list.filter(isMatched)
        break
      case 'DIFFERENCE':
        list = list.filter(isDifference)
        break
    }

    list = [...list]
    switch (sortMode) {
      case 'NAME':
        list.sort((a, b) => a.itemName.localeCompare(b.itemName))
        break
      case 'SKU':
        list.sort((a, b) => (a.itemSku || '').localeCompare(b.itemSku || ''))
        break
      case 'CATEGORY':
        list.sort(
          (a, b) =>
            (a.categoryName || 'Tanpa Kategori').localeCompare(
              b.categoryName || 'Tanpa Kategori'
            ) || a.itemName.localeCompare(b.itemName)
        )
        break
      case 'LAST_COUNTED':
        list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        break
    }
    return list
  }, [snapshots, filterCategory, filterMode, sortMode])

  // ════════════════════════════════════════════════════════════
  // Review table rows
  // ════════════════════════════════════════════════════════════
  const reviewRows = useMemo(() => {
    const list = snapshots.filter((s) => s.batchId === null)
    if (reviewFilter === 'DIFFERENCE') return list.filter(isDifference)
    return list.filter((s) => s.physicalQty !== null)
  }, [snapshots, reviewFilter])

  // ════════════════════════════════════════════════════════════
  // Selected items for SELECTED_ITEMS mode (resolved from IDs)
  // ════════════════════════════════════════════════════════════
  const fetchPickerItems = useCallback(async () => {
    const res = await fetch('/api/inventory/stock-opname?outletId=current')
    const data = await res.json()
    let list = (data.items as any[]).map((i) => ({
      inventoryItemId: i.inventoryItemId,
      itemName: i.itemName,
      itemSku: i.itemSku,
      categoryName: i.categoryName,
      systemQty: i.systemQty,
      itemUnit: i.itemUnit,
    }))
    if (!includeZeroStock) list = list.filter((i) => i.systemQty > 0)
    list.sort((a, b) => a.itemName.localeCompare(b.itemName))
    return list
  }, [includeZeroStock])

  // ════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════
  if (bootstrapping) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
          <Skeleton className="h-12 w-48 mb-4" />
          <Skeleton className="h-32 w-full mb-4" />
          <Skeleton className="h-64 w-full" />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Lightweight page header — icon + title + subtitle, no heavy banner */}
      <div className="max-w-5xl mx-auto w-full px-4 pt-5 pb-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <ClipboardCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">Stock Opname</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hitung stok fisik & sesuaikan dengan sistem
              </p>
            </div>
          </div>
          {session?.scopeLabel && (
            <Badge variant="outline" className="gap-1.5 px-2.5 py-1 text-xs shrink-0">
              <History className="h-3 w-3" />
              {session.scopeLabel}
            </Badge>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-4">
        <AnimatePresence mode="wait">
          {/* ════════════════════════════════════════════════════
           * RESUME CARD (PAUSED session exists)
           * ════════════════════════════════════════════════════ */}
          {status === 'PAUSED' && session && (
            <motion.div
              key="resume"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ResumeCard
                session={session}
                countedItems={snapshots.filter((s) => s.batchId === null && s.physicalQty !== null).length}
                lastSavedAt={lastSavedAt}
                onResume={handleResume}
                onCancel={() => setShowCancelDialog(true)}
              />
            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════
           * START PAGE (idle, no session)
           * V3.1 — focused central panel, Purchase-style mode cards,
           * single compact summary, sticky footer with Batal + CTA.
           * ════════════════════════════════════════════════════ */}
          {status === null && (
            <motion.div
              key="start"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-[980px] mx-auto"
            >
              <Card>
                <CardContent className="p-0">
                  {/* Panel title + helper */}
                  <div className="px-5 pt-5 pb-3">
                    <h2 className="text-base font-semibold">Mulai Sesi Baru</h2>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Pilih metode hitung stok sesuai kebutuhan operasional toko.
                    </p>
                  </div>

                  {/* Mode cards */}
                  <div className="px-5">
                    <StockOpnameModeSelector mode={mode} onChange={setMode} />
                  </div>

                  {/* Active mode configuration */}
                  <div className="px-5 pt-4 mt-4 border-t">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2.5">
                      Konfigurasi
                    </div>
                    {mode === 'ALL_ITEMS' && (
                      <AllItemsModePanel
                        includeZeroStock={includeZeroStock}
                        onIncludeZeroStockChange={setIncludeZeroStock}
                      />
                    )}
                    {mode === 'CATEGORY' && (
                      <CategoryModePanel
                        categories={preview?.categories ?? []}
                        selectedIds={selectedCategoryIds}
                        onSelectedIdsChange={setSelectedCategoryIds}
                        includeZeroStock={includeZeroStock}
                        onIncludeZeroStockChange={setIncludeZeroStock}
                        loading={previewLoading}
                      />
                    )}
                    {mode === 'SELECTED_ITEMS' && (
                      <SelectedItemsModePanel
                        // Parent only tracks IDs — the panel resolves the
                        // full PickerItem[] from its own fetched `allItems`.
                        selectedIds={selectedItemIds}
                        onSelectedIdsChange={setSelectedItemIds}
                        includeZeroStock={includeZeroStock}
                        onIncludeZeroStockChange={setIncludeZeroStock}
                        fetchItems={fetchPickerItems}
                      />
                    )}
                  </div>

                  {/* Single compact session summary */}
                  <div className="px-5 pt-4">
                    <StockOpnameSessionSummary
                      mode={mode}
                      itemCount={preview?.itemCount ?? 0}
                      categoryCount={selectedCategoryIds.length}
                      includeZeroStock={includeZeroStock}
                      loading={previewLoading}
                    />
                  </div>

                  {/* Concise information notice */}
                  <div className="px-5 pt-3">
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/30 border border-border">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Penjualan tetap dapat berjalan. Hindari pembelian, transfer, atau
                        adjustment manual pada item yang sedang dihitung agar review lebih mudah.
                      </p>
                    </div>
                  </div>

                  {/* Footer action — left Batal, right primary CTA.
                      Sticky so the CTA stays visible while the category/item
                      lists scroll. On mobile, sticks at bottom-14 (56px) to
                      clear the global mobile bottom nav (~56px, z-50); on
                      desktop, sticks at bottom-0. rounded-b-xl matches the
                      Card's rounded corners (Card has no overflow-hidden so
                      sticky works against the viewport). */}
                  <div className="sticky bottom-14 md:bottom-0 mt-4 px-5 py-3 border-t bg-card/95 backdrop-blur flex items-center gap-2 rounded-b-xl">
                    <Button
                      variant="ghost"
                      className="flex-1 sm:flex-none sm:px-6"
                      onClick={() => setCurrentPage('dashboard')}
                      disabled={loading}
                    >
                      Batal
                    </Button>
                    <Button
                      className="flex-[2] sm:flex-1"
                      onClick={() => setShowStartDialog(true)}
                      disabled={
                        loading ||
                        !preview ||
                        preview.itemCount === 0 ||
                        (mode === 'CATEGORY' && selectedCategoryIds.length === 0) ||
                        (mode === 'SELECTED_ITEMS' && selectedItemIds.length === 0)
                      }
                    >
                      Mulai Stock Opname
                      {preview && preview.itemCount > 0 && (
                        <span className="ml-1.5 opacity-80 tabular-nums">
                          · {preview.itemCount} Item
                        </span>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════
           * COUNTING PAGE
           * ════════════════════════════════════════════════════ */}
          {status === 'COUNTING' && session && (
            <motion.div
              key="counting"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3 pb-32 sm:pb-0"
            >
              {/* Compact session header */}
              <div className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Stock Opname Berjalan</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {session.scopeLabel || 'Semua Item'} · Mulai {fmtTime(session.startedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AutosaveBadge isOnline={isOnline} lastSavedAt={lastSavedAt} />
                    {/* Desktop actions */}
                    <div className="hidden sm:flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowPauseDialog(true)}
                      >
                        <Pause className="h-3.5 w-3.5 mr-1.5" />
                        Tunda Sesi
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleEnterReview}
                        disabled={stats.countedItems === 0}
                      >
                        Review ({stats.countedItems})
                      </Button>
                    </div>
                    {/* Overflow menu (mobile + desktop cancel) */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive sm:hidden"
                          onClick={() => setShowPauseDialog(true)}
                        >
                          <Pause className="h-4 w-4 mr-2" />
                          Tunda Sesi
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setShowCancelDialog(true)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Batalkan Sesi
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Progress */}
                <div className="flex items-center gap-2.5">
                  <div className="text-sm font-semibold tabular-nums shrink-0">
                    {stats.countedItems} dari {stats.totalItems} item
                  </div>
                  <Progress
                    value={
                      stats.totalItems > 0
                        ? (stats.countedItems / stats.totalItems) * 100
                        : 0
                    }
                    className="flex-1 h-1.5"
                  />
                  <div className="text-xs text-muted-foreground tabular-nums w-9 text-right shrink-0">
                    {stats.totalItems > 0
                      ? Math.round((stats.countedItems / stats.totalItems) * 100)
                      : 0}
                    %
                  </div>
                </div>

                {/* Compact status chips (not oversized cards) */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <Badge variant="outline" className="text-xs gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    Dihitung {stats.countedItems}
                  </Badge>
                  <Badge variant="outline" className="text-xs gap-1">
                    Belum {stats.uncountedItems}
                  </Badge>
                  {stats.differenceItems > 0 && (
                    <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-500/30">
                      <AlertTriangle className="h-3 w-3" />
                      Selisih {stats.differenceItems}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Scan / Search bar */}
              <div className="relative">
                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                <Input
                  ref={scanInputRef}
                  placeholder="Scan barcode atau cari nama/SKU..."
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleScan()
                    }
                  }}
                  className="pl-9 pr-10 h-10"
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-2"
                  onClick={() => setScanDialogOpen(true)}
                  title="Scan barcode dengan kamera"
                  aria-label="Scan barcode dengan kamera"
                >
                  <Camera className="h-4 w-4" />
                </Button>
              </div>

              {/* Filter + sort toolbar */}
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={filterMode} onValueChange={(v) => setFilterMode(v as CountingFilter)}>
                  <SelectTrigger className="w-full sm:w-[150px] h-9">
                    <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-full sm:w-[150px] h-9">
                    <SelectValue placeholder="Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.itemCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                  <SelectTrigger className="w-full sm:w-[130px] h-9">
                    <SelectValue placeholder="Urutkan" />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Compact table */}
              <div className="rounded-lg border overflow-hidden">
                <div className="max-h-[50vh] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="w-[35px]">#</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Snapshot</TableHead>
                        <TableHead className="text-right">Fisik</TableHead>
                        <TableHead className="text-right">Selisih</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSnapshots.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">
                            Tidak ada item yang cocok dengan filter
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredSnapshots.map((snap, idx) => {
                          const diff = varianceOf(snap)
                          const matched = isMatched(snap)
                          return (
                            <TableRow
                              key={snap.id}
                              id={`snap-${snap.id}`}
                              className={cn(
                                'cursor-pointer hover:bg-muted/50',
                                focusedSnapshot?.id === snap.id && 'bg-amber-500/5'
                              )}
                              onClick={() => setFocusedSnapshot(snap)}
                            >
                              <TableCell className="text-muted-foreground text-xs tabular-nums">
                                {idx + 1}
                              </TableCell>
                              <TableCell>
                                <div className="font-medium text-sm truncate max-w-[180px]">
                                  {snap.itemName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {snap.itemSku || '-'}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs tabular-nums">
                                {fmtQty(snap.systemQty)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs tabular-nums">
                                {snap.physicalQty !== null ? (
                                  <span className="font-semibold">{fmtQty(snap.physicalQty)}</span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  'text-right font-mono text-xs font-semibold tabular-nums',
                                  snap.physicalQty === null
                                    ? 'text-muted-foreground'
                                    : matched
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : diff > 0
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-red-600 dark:text-red-400'
                                )}
                              >
                                {snap.physicalQty === null
                                  ? '—'
                                  : fmtSignedDelta(diff)}
                              </TableCell>
                              <TableCell>
                                {snap.physicalQty === null ? (
                                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/30">
                                    Belum dihitung
                                  </Badge>
                                ) : matched ? (
                                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0 text-xs">
                                    Sesuai
                                  </Badge>
                                ) : (
                                  <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0 text-xs">
                                    Selisih
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Notes */}
              <Textarea
                placeholder="Catatan (opsional)..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="text-sm"
              />

              {/* Mobile bottom action bar — sits ABOVE the global sidebar
                  mobile nav (which is ~56px tall at z-50) so the SO actions
                  stay tappable. Counting content has `pb-32 sm:pb-0` below
                  to keep the last table row clear of this bar. */}
              <div className="sm:hidden fixed bottom-14 left-0 right-0 z-40 bg-card border-t px-4 py-2.5 flex gap-2 safe-area-pb">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowPauseDialog(true)}
                >
                  Tunda
                </Button>
                <Button
                  className="flex-[1.5]"
                  onClick={handleEnterReview}
                  disabled={stats.countedItems === 0}
                >
                  Review {stats.countedItems}
                </Button>
              </div>
              {/* Spacer so content isn't hidden behind mobile bar */}
              <div className="sm:hidden h-14" />
            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════
           * REVIEW PAGE
           * ════════════════════════════════════════════════════ */}
          {status === 'REVIEW' && session && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3 pb-32 sm:pb-0"
            >
              <div className="rounded-lg border bg-card p-3">
                <div className="text-sm font-semibold">Review Stock Opname</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Periksa item yang memiliki selisih sebelum menerapkan penyesuaian.
                </p>
              </div>

              {/* Compact summary chips */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-xs gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  Dihitung {stats.countedItems}
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  Sesuai {stats.matchedItems}
                </Badge>
                {stats.differenceItems > 0 && (
                  <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-500/30">
                    <AlertTriangle className="h-3 w-3" />
                    Ada Selisih {stats.differenceItems}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                  Belum {stats.uncountedItems}
                </Badge>
              </div>

              {/* Partial-completion notice */}
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Hanya item yang sudah dihitung yang akan diproses.{' '}
                  {stats.uncountedItems > 0 && (
                    <span className="font-medium">
                      {stats.uncountedItems} item belum dihitung
                    </span>
                  )}{' '}
                  dan tidak akan berubah.
                </p>
              </div>

              {/* Filter toggle */}
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant={reviewFilter === 'DIFFERENCE' ? 'default' : 'outline'}
                  onClick={() => setReviewFilter('DIFFERENCE')}
                >
                  Ada Selisih ({stats.differenceItems})
                </Button>
                <Button
                  size="sm"
                  variant={reviewFilter === 'ALL' ? 'default' : 'outline'}
                  onClick={() => setReviewFilter('ALL')}
                >
                  Semua Dihitung ({stats.countedItems})
                </Button>
              </div>

              {/* Differences table */}
              <div className="rounded-lg border overflow-hidden">
                <div className="max-h-[50vh] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Snapshot</TableHead>
                        <TableHead className="text-right">Fisik</TableHead>
                        <TableHead className="text-right">Selisih</TableHead>
                        <TableHead>Dampak</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reviewRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">
                            {reviewFilter === 'DIFFERENCE'
                              ? 'Tidak ada selisih. Semua item yang dihitung sesuai.'
                              : 'Belum ada item yang dihitung.'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        reviewRows.map((snap) => {
                          const diff = varianceOf(snap)
                          const matched = isMatched(snap)
                          return (
                            <TableRow key={snap.id}>
                              <TableCell>
                                <div className="font-medium text-sm">{snap.itemName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {snap.itemSku || '-'}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs tabular-nums">
                                {fmtQty(snap.systemQty)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                                {fmtQty(snap.physicalQty ?? 0)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  'text-right font-mono text-xs font-semibold tabular-nums',
                                  matched
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : diff > 0
                                      ? 'text-blue-600 dark:text-blue-400'
                                      : 'text-red-600 dark:text-red-400'
                                )}
                              >
                                {fmtSignedDelta(diff)}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {impactText(snap)}
                              </TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Desktop actions */}
              <div className="hidden sm:flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStatus('COUNTING')}
                >
                  Lanjut Hitung
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleOpenCompleteDialog}
                  disabled={loading || stats.countedItems === 0}
                >
                  Selesaikan {stats.countedItems} Item
                </Button>
              </div>

              {/* Mobile bottom action bar — sits ABOVE the global sidebar
                  mobile nav (which is ~56px tall at z-50) so the SO actions
                  stay tappable. Review content has `pb-32 sm:pb-0` below
                  to keep the last review row clear of this bar. */}
              <div className="sm:hidden fixed bottom-14 left-0 right-0 z-40 bg-card border-t px-4 py-2.5 flex gap-2 safe-area-pb">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStatus('COUNTING')}
                >
                  Lanjut Hitung
                </Button>
                <Button
                  className="flex-[1.5]"
                  onClick={handleOpenCompleteDialog}
                  disabled={loading || stats.countedItems === 0}
                >
                  Selesaikan {stats.countedItems}
                </Button>
              </div>
              <div className="sm:hidden h-14" />
            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════
           * COMPLETED RESULT
           * ════════════════════════════════════════════════════ */}
          {status === 'COMPLETED' && completionSummary && (
            <motion.div
              key="completed"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-lg mx-auto"
            >
              <Card>
                <CardContent className="p-5 space-y-4 text-center">
                  <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                  </div>
                  <div>
                    <div className="text-lg font-bold">Stock Opname Selesai</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {fmtDateTime(new Date().toISOString())}
                    </div>
                  </div>

                  {/* Summary grid */}
                  <div className="grid grid-cols-2 gap-2 text-left">
                    <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
                      <div className="text-xs text-muted-foreground">Item dihitung</div>
                      <div className="text-xl font-bold tabular-nums">
                        {completionSummary.countedItems}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <div className="text-xs text-muted-foreground">Item disesuaikan</div>
                      <div className="text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                        {completionSummary.adjustedItems}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
                      <div className="text-xs text-muted-foreground">Item tidak diubah</div>
                      <div className="text-xl font-bold tabular-nums">
                        {completionSummary.uncountedItems}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
                      <div className="text-xs text-muted-foreground">Item sesuai</div>
                      <div className="text-xl font-bold tabular-nums">
                        {completionSummary.matchedItems}
                      </div>
                    </div>
                  </div>

                  {/* Stock impact */}
                  <div className="p-3 rounded-lg bg-muted/30 border border-border">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      Dampak Stok
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2">
                        <PlusCircle className="h-4 w-4 text-blue-500" />
                        <div className="text-left">
                          <div className="text-xs text-muted-foreground">Bertambah</div>
                          <div className="text-base font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                            +{fmtQty(completionSummary.totalPositiveDelta)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <MinusCircle className="h-4 w-4 text-red-500" />
                        <div className="text-left">
                          <div className="text-xs text-muted-foreground">Berkurang</div>
                          <div className="text-base font-bold text-red-600 dark:text-red-400 tabular-nums">
                            −{fmtQty(completionSummary.totalNegativeDelta)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Adjusted-items list — Name + SKU + Snapshot→Fisik + Selisih */}
                  {completionSummary.adjustments.length > 0 && (
                    <div className="rounded-lg border border-border overflow-hidden text-left">
                      <div className="px-3 py-2 bg-muted/40 text-xs font-medium text-muted-foreground">
                        Item yang Disesuaikan ({completionSummary.adjustments.length})
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-border">
                        {completionSummary.adjustments.map((adj) => (
                          <div key={adj.snapshotId} className="px-3 py-2 space-y-0.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{adj.itemName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {adj.itemSku || 'Tanpa SKU'}
                                  {adj.categoryName && ` · ${adj.categoryName}`}
                                </div>
                              </div>
                              <div
                                className={cn(
                                  'text-sm font-semibold tabular-nums shrink-0',
                                  adj.delta > 0
                                    ? 'text-blue-600 dark:text-blue-400'
                                    : 'text-red-600 dark:text-red-400'
                                )}
                              >
                                {fmtSignedDelta(adj.delta)} {adj.itemUnit}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                              <span>Snapshot {fmtQty(adj.systemQty)}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                              <span>Fisik {fmtQty(adj.physicalQty)}</span>
                              <span className="text-muted-foreground/50">·</span>
                              <span>{adj.itemUnit}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {completeResult && (
                    <div className="text-xs text-muted-foreground">
                      {completeResult.summary.adjustmentsMade} penyesuaian diterapkan ·{' '}
                      {completeResult.summary.batchUpdates} batch diperbarui
                    </div>
                  )}

                  {/* CTAs — explicit labels, no play icons */}
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setCurrentPage('audit-log')}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Lihat Audit Log
                    </Button>
                    <Button className="flex-1" onClick={handleNewSession}>
                      Mulai Opname Baru
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ════════════════════════════════════════════════════════
       * COUNTING WIDGET
       * ── Responsive: mobile renders a centered Dialog (with Minimize →
       *    "Stock Opname Berjalan" pill), desktop renders a floating
       *    bottom-right card. Key forces remount when the focused snapshot
       *    changes.
       * ════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {status === 'COUNTING' && focusedSnapshot && (
          <StockOpnameQuickCountWidget
            key={focusedSnapshot.id}
            snapshot={focusedSnapshot}
            onSave={handleSaveCount}
            onSkip={handleSkipCount}
            onClose={() => {
              setFocusedSnapshot(null)
              setTimeout(() => scanInputRef.current?.focus(), 50)
            }}
            onMinimize={handleMinimizeCount}
            variant={isMobile ? 'dialog' : 'floating'}
            onNext={() => {}}
          />
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════
       * DIALOGS
       * ════════════════════════════════════════════════════════ */}
      <StockOpnameStartDialog
        open={showStartDialog}
        onOpenChange={setShowStartDialog}
        mode={mode}
        itemCount={preview?.itemCount ?? 0}
        categoryCount={selectedCategoryIds.length}
        includeZeroStock={includeZeroStock}
        loading={loading}
        onConfirm={handleStartConfirm}
      />

      <StockOpnamePauseDialog
        open={showPauseDialog}
        onOpenChange={setShowPauseDialog}
        countedItems={stats.countedItems}
        totalItems={stats.totalItems}
        lastSavedAt={lastSavedAt}
        onConfirm={handlePause}
      />

      <StockOpnameCancelDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        countedItems={stats.countedItems}
        totalItems={stats.totalItems}
        lastSavedAt={lastSavedAt}
        onConfirm={handleCancel}
      />

      <StockOpnameCompleteDialog
        open={showCompleteDialog}
        onOpenChange={setShowCompleteDialog}
        summary={completionSummary}
        loading={loading}
        onConfirm={handleComplete}
      />

      {/* Camera barcode scanner (counting search bar camera button).
          SIMPLE mode (onResult only) — handleScanResult resolves against the
          active session's Dexie snapshots via findByScan (no resolver wired).
          closeOnSuccess=true → dialog auto-closes ONLY when handleScanResult
          returns true (FOUND in active session). NEVER closes on NOT_FOUND or
          errors so the operator can re-scan. The matched snapshot opens the
          QuickCountWidget which auto-focuses its physical-qty input on remount. */}
      <BarcodeScannerDialog
        open={scanDialogOpen}
        onOpenChange={setScanDialogOpen}
        onResult={handleScanResult}
        closeOnSuccess
        title="Scan Item Opname"
        inputPlaceholder="Ketik barcode / SKU / nama item..."
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Sub-components (kept inline — simple enough not to extract)
// ════════════════════════════════════════════════════════════

function AutosaveBadge({
  isOnline,
  lastSavedAt,
}: {
  isOnline: boolean
  lastSavedAt: string | null
}) {
  if (!isOnline) {
    return (
      <Badge variant="outline" className="gap-1 text-xs text-amber-600 border-amber-500/30 px-1.5 py-0">
        <WifiOff className="h-3 w-3" />
        Offline
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 text-xs text-emerald-600 border-emerald-500/30 px-1.5 py-0">
      <Wifi className="h-3 w-3" />
      {lastSavedAt ? fmtTime(lastSavedAt) : 'Tersimpan'}
    </Badge>
  )
}

function ResumeCard({
  session,
  countedItems,
  lastSavedAt,
  onResume,
  onCancel,
}: {
  session: OpnameSession
  countedItems: number
  lastSavedAt: string | null
  onResume: () => void
  onCancel: () => void
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
            <Pause className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold">Stock Opname Belum Selesai</div>
            <div className="text-sm text-muted-foreground mt-0.5">
              <span className="font-medium tabular-nums">{countedItems}</span> dari{' '}
              <span className="tabular-nums">{session.totalItems}</span> item dihitung
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-y-1.5 text-sm">
          <div className="text-muted-foreground">Terakhir disimpan</div>
          <div className="font-medium">
            {lastSavedAt ? new Date(lastSavedAt).toLocaleString('id-ID') : 'Baru saja'}
          </div>
          <div className="text-muted-foreground">Mode</div>
          <div className="font-medium">{session.scopeLabel || 'Semua Item'}</div>
          <div className="text-muted-foreground">Dimulai</div>
          <div className="font-medium">{fmtDateTime(session.startedAt)}</div>
        </div>

        <div className="flex items-center gap-2">
          <Button className="flex-1" onClick={onResume}>
            Lanjutkan
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onCancel}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Batalkan Sesi
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  )
}
