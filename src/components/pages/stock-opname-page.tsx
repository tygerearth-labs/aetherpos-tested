'use client'

/**
 * StockOpnamePage.tsx — UX V2
 *
 * Physical stock count page. Uses Dexie as a TRANSIENT workspace — the server
 * remains the source of truth.
 *
 * Flow:  DRAFT → COUNTING → REVIEW → COMPLETED
 *
 * CANONICAL INVARIANTS (enforced by service.ts + this page):
 *   • `totalItems` = item-level snapshot count (excludes batch-level snapshots
 *     used by the server's FEFO distribution).
 *   • Toast, cards, review table, and complete dialog all read the SAME
 *     `totalItems` via `getOpnameSession()` / `completionSummary` — fixing
 *     the historical mismatch (toast=301 vs page=292).
 *   • `countedItems + uncountedItems === totalItems`.
 *   • `matchedItems + adjustedItems === countedItems`.
 *   • The Complete Dialog reads `completionSummary` from React state built
 *     BEFORE the API call — it NEVER derives from filtered/reset rows.
 *   • Failed complete keeps Dexie intact (user can retry); successful
 *     complete clears Dexie only AFTER the server commit succeeds.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePageStore } from '@/hooks/use-page-store'
import {
  ClipboardCheck,
  ClipboardList,
  Search,
  Package,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  RotateCcw,
  Save,
  Camera,
  ArrowRight,
  Loader2,
  FileText,
  Trash2,
  WifiOff,
  Wifi,
  ScanLine,
  ChevronRight,
  History,
  PlusCircle,
  MinusCircle,
  Boxes,
  Filter,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  startOpname,
  completeOpname,
  cancelOpname,
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

// ════════════════════════════════════════════════════════════
// Constants & helpers
// ════════════════════════════════════════════════════════════

const VARIANCE_EPSILON = 0.001

type CountingFilter = 'ALL' | 'UNCOUNTED' | 'COUNTED' | 'MATCHED' | 'DIFFERENCE'
type SortMode = 'NAME' | 'SKU' | 'CATEGORY' | 'LAST_COUNTED'

const SCOPE_OPTIONS: Array<{ value: OpnameScope; label: string; description: string }> = [
  {
    value: 'ALL_ITEMS',
    label: 'Semua Item Inventory',
    description: 'Setiap item aktif di outlet ini masuk sesi',
  },
  {
    value: 'CATEGORY',
    label: 'Berdasarkan Kategori',
    description: 'Pilih satu atau beberapa kategori',
  },
  {
    value: 'SELECTED_ITEMS',
    label: 'Pilih Item Tertentu',
    description: 'Centang item satu per satu',
  },
]

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function fmtDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function fmtQty(n: number): string {
  // Strip trailing zeros for display: 5.00 → "5", 5.50 → "5.5", 5.25 → "5.25"
  const rounded = Math.round(n * 1000) / 1000
  return rounded.toFixed(3).replace(/\.?0+$/, '') || '0'
}

function varianceOf(s: SnapshotItem): number {
  if (s.physicalQty === null) return 0
  return (s.physicalQty ?? 0) - s.systemQty
}

function isMatched(s: SnapshotItem): boolean {
  return s.physicalQty !== null && Math.abs(varianceOf(s)) < VARIANCE_EPSILON
}

function isDifference(s: SnapshotItem): boolean {
  return s.physicalQty !== null && Math.abs(varianceOf(s)) >= VARIANCE_EPSILON
}

// ════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════

export default function StockOpnamePage() {
  // ── Page-level state ──
  // status: null = IDLE/START page; 'COMPLETED' = UI-only final state (Dexie already cleared)
  const [status, setStatus] = useState<OpnameStatus | 'COMPLETED' | null>(null)
  const [session, setSession] = useState<OpnameSession | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([])
  const [loading, setLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(true)

  // ── Start page state ──
  const [scope, setScope] = useState<OpnameScope>('ALL_ITEMS')
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
  const [searchQuery, setSearchQuery] = useState('')
  const [scanInput, setScanInput] = useState('')
  const scanInputRef = useRef<HTMLInputElement>(null)
  const physicalInputRef = useRef<HTMLInputElement>(null)
  const [focusedSnapshot, setFocusedSnapshot] = useState<SnapshotItem | null>(null)
  const [physicalValue, setPhysicalValue] = useState<string>('')
  const [filterMode, setFilterMode] = useState<CountingFilter>('ALL')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [sortMode, setSortMode] = useState<SortMode>('NAME')
  const [categories, setCategories] = useState<OpnameCategory[]>([])

  // ── Review state ──
  const [reviewFilter, setReviewFilter] = useState<'DIFFERENCE' | 'ALL'>('DIFFERENCE')
  const [notes, setNotes] = useState('')

  // ── Complete state (immutable) ──
  // completionSummary is built BEFORE the API call. It is the SOLE source of
  // truth for the Complete Dialog — never derived from filtered/reset rows.
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null)
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null)

  // ── Other dialogs ──
  const [showStartDialog, setShowStartDialog] = useState(false)
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
        const snaps = await getAllSnapshots()
        setSnapshots(snaps)
        setNotes(existing.notes || '')
        const cats = await getOpnameCategories()
        setCategories(cats)
        setLastSavedAt(new Date().toISOString())
      }
    } catch (error) {
      console.error('[StockOpname] Resume error:', error)
    }
  }

  // ════════════════════════════════════════════════════════════
  // Preview (start page) — runs whenever scope/options change
  // ════════════════════════════════════════════════════════════
  useEffect(() => {
    if (status !== null) return // only run on start page
    let cancelled = false
    setPreviewLoading(true)
    previewOpname('current', {
      scope,
      categoryIds: scope === 'CATEGORY' ? selectedCategoryIds : undefined,
      selectedItemIds: scope === 'SELECTED_ITEMS' ? selectedItemIds : undefined,
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
  }, [status, scope, includeZeroStock, selectedCategoryIds, selectedItemIds])

  // ════════════════════════════════════════════════════════════
  // Derived stats — always read from canonical `session.totalItems`
  // ════════════════════════════════════════════════════════════
  const stats = useMemo(() => {
    const itemSnapshots = snapshots.filter((s) => s.batchId === null)
    const totalItems = session?.totalItems ?? itemSnapshots.length // canonical
    const countedItems = itemSnapshots.filter((s) => s.physicalQty !== null).length
    const uncountedItems = totalItems - countedItems
    const matchedItems = itemSnapshots.filter(isMatched).length
    const differenceItems = itemSnapshots.filter(isDifference).length
    return {
      totalItems,             // canonical — used by toast, cards, review, dialogs
      countedItems,
      uncountedItems,
      matchedItems,
      differenceItems,
    }
  }, [snapshots, session])

  // ════════════════════════════════════════════════════════════
  // Actions: start
  // ════════════════════════════════════════════════════════════
  const handleStartConfirm = async () => {
    setLoading(true)
    try {
      const result = await startOpname('current', {
        scope,
        categoryIds: scope === 'CATEGORY' ? selectedCategoryIds : undefined,
        selectedItemIds: scope === 'SELECTED_ITEMS' ? selectedItemIds : undefined,
        includeZeroStock,
      })

      // CANONICAL: read totalItems from session (item-level only) — fixes
      // the historical mismatch where the toast showed raw snapshot count
      // (items + batches) but the page showed item-level count.
      const newSession = await getOpnameSession()
      setStatus('COUNTING')
      setSession(newSession)
      const snaps = await getAllSnapshots()
      setSnapshots(snaps)
      const cats = await getOpnameCategories()
      setCategories(cats)
      setLastSavedAt(new Date().toISOString())
      setShowStartDialog(false)

      toast.success(`Stock opname dimulai`, {
        description: `${result.totalItems} item siap dihitung`,
      })

      // Focus the scanner for immediate barcode-first workflow
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
      // Open the focused physical-qty editor
      setFocusedSnapshot(found)
      setPhysicalValue(found.physicalQty !== null ? fmtQty(found.physicalQty) : '')
      setSearchQuery('')
      setScanInput('')
      setTimeout(() => physicalInputRef.current?.focus(), 50)
    } else {
      toast.error('Item tidak ditemukan', {
        description: `"${value}" tidak cocok dengan SKU / nama / batch`,
      })
      setScanInput('')
      scanInputRef.current?.focus()
    }
  }, [scanInput])

  // ════════════════════════════════════════════════════════════
  // Actions: save physical count
  // ════════════════════════════════════════════════════════════
  const savePhysical = async (snapshotId: string, qty: number | null) => {
    if (qty === null || isNaN(qty) || qty < 0) {
      toast.error('Jumlah fisik tidak valid')
      return
    }
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
      setFocusedSnapshot(null)
      setPhysicalValue('')
      // Re-focus scanner for next barcode
      setTimeout(() => scanInputRef.current?.focus(), 50)
    } catch (error) {
      toast.error('Gagal menyimpan hitungan')
      console.error(error)
    }
  }

  const handlePhysicalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!focusedSnapshot) return
    if (e.key === 'Enter') {
      e.preventDefault()
      const val = parseFloat(physicalValue)
      savePhysical(focusedSnapshot.id, isNaN(val) ? null : val)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setFocusedSnapshot(null)
      setPhysicalValue('')
      setTimeout(() => scanInputRef.current?.focus(), 50)
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
    // BUILD IMMUTABLE SUMMARY BEFORE the API call.
    // This is what the Complete Dialog reads — never re-derived from filtered/reset rows.
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
      // Keep completionSummary in state — the COMPLETED screen reads it.
      // Dexie is already cleared by completeOpname() (only on success).
      setSnapshots([])
      setSession(null)
      toast.success('Stock opname berhasil diselesaikan!', {
        description: `${result.summary.adjustmentsMade} penyesuaian diterapkan`,
      })
    } catch (error) {
      // Failed complete keeps Dexie intact (service.ts reverts status to REVIEW).
      // completionSummary remains valid; user can retry.
      toast.error('Gagal menyelesaikan stock opname', {
        description: error instanceof Error ? error.message : undefined,
      })
      console.error(error)
    } finally {
      setLoading(false)
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

  const handleNewSession = () => {
    setStatus(null)
    setCompletionSummary(null)
    setCompleteResult(null)
    setNotes('')
    setScope('ALL_ITEMS')
    setIncludeZeroStock(true)
    setSelectedCategoryIds([])
    setSelectedItemIds([])
  }

  // ════════════════════════════════════════════════════════════
  // Filtered + sorted snapshots (COUNTING page)
  // ════════════════════════════════════════════════════════════
  const filteredSnapshots = useMemo(() => {
    let list = snapshots.filter((s) => s.batchId === null) // item-level only

    // Search filter (separate from the scan box — this filters the table)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (s) =>
          s.itemName.toLowerCase().includes(q) ||
          s.itemSku?.toLowerCase().includes(q)
      )
    }

    // Category filter
    if (filterCategory !== 'all') {
      list = list.filter((s) => (s.categoryId || '__none__') === filterCategory)
    }

    // Status filter
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
      case 'ALL':
      default:
        break
    }

    // Sort
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
        list.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        break
    }

    return list
  }, [snapshots, searchQuery, filterCategory, filterMode, sortMode])

  // ════════════════════════════════════════════════════════════
  // Review table rows (default = differences only)
  // ════════════════════════════════════════════════════════════
  const reviewRows = useMemo(() => {
    const list = snapshots.filter((s) => s.batchId === null)
    if (reviewFilter === 'DIFFERENCE') {
      return list.filter(isDifference)
    }
    return list.filter((s) => s.physicalQty !== null) // COUNTED
  }, [snapshots, reviewFilter])

  // ════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════
  if (bootstrapping) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
          <Skeleton className="h-12 w-48 mb-4" />
          <Skeleton className="h-32 w-full mb-4" />
          <Skeleton className="h-64 w-full" />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Stock Opname
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Hitung stok fisik & sesuaikan dengan sistem
              </p>
            </div>
            {session && (
              <Badge variant="outline" className="gap-1.5 px-3 py-1">
                <History className="h-3 w-3" />
                {session.scopeLabel || 'Semua Inventory'}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        <AnimatePresence mode="wait">
          {/* ════════════════════════════════════════════════════
           * START PAGE (idle)
           * ════════════════════════════════════════════════════ */}
          {status === null && (
            <motion.div
              key="start"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                    Stock Opname Baru
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Pilih item yang akan dihitung dan buat snapshot stok sebagai
                    acuan perbandingan.
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Scope */}
                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">Scope</Label>
                    <RadioGroup
                      value={scope}
                      onValueChange={(v) => setScope(v as OpnameScope)}
                      className="gap-2"
                    >
                      {SCOPE_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          htmlFor={`scope-${opt.value}`}
                          className={cn(
                            'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                            scope === opt.value
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:bg-muted/50'
                          )}
                        >
                          <RadioGroupItem
                            id={`scope-${opt.value}`}
                            value={opt.value}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{opt.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {opt.description}
                            </div>
                          </div>
                        </label>
                      ))}
                    </RadioGroup>

                    {/* Category picker */}
                    {scope === 'CATEGORY' && (
                      <div className="ml-1 p-3 rounded-lg bg-muted/50 border border-border">
                        <div className="text-xs font-medium text-muted-foreground mb-2">
                          Pilih kategori:
                        </div>
                        {previewLoading && !preview ? (
                          <Skeleton className="h-8 w-full" />
                        ) : preview && preview.categories.length > 0 ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {preview.categories.map((cat) => (
                              <label
                                key={cat.id}
                                className="flex items-center gap-2 cursor-pointer text-sm"
                              >
                                <Checkbox
                                  checked={selectedCategoryIds.includes(cat.id)}
                                  onCheckedChange={(checked) => {
                                    setSelectedCategoryIds((prev) =>
                                      checked
                                        ? [...prev, cat.id]
                                        : prev.filter((id) => id !== cat.id)
                                    )
                                  }}
                                />
                                <span className="flex-1">{cat.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {cat.itemCount}
                                </Badge>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            Tidak ada kategori.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Selected items picker (simple search + checkbox list) */}
                    {scope === 'SELECTED_ITEMS' && (
                      <SelectedItemsPicker
                        selectedIds={selectedItemIds}
                        onChange={setSelectedItemIds}
                        includeZeroStock={includeZeroStock}
                      />
                    )}
                  </div>

                  {/* Zero-stock toggle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={includeZeroStock}
                      onCheckedChange={(v) => setIncludeZeroStock(v === true)}
                    />
                    <span className="text-sm">
                      Sertakan item dengan stok 0
                    </span>
                  </label>

                  {/* Preview summary */}
                  <div className="p-4 rounded-lg bg-muted/50 border border-border">
                    <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Ringkasan
                    </div>
                    {previewLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-5 w-32" />
                      </div>
                    ) : preview ? (
                      <div className="space-y-1 text-sm">
                        <div>
                          <span className="font-bold text-base">
                            {preview.itemCount}
                          </span>{' '}
                          item akan masuk sesi
                        </div>
                        <div className="text-muted-foreground">
                          {preview.categoryCount} kategori · Snapshot diambil saat
                          sesi dimulai
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        Gagal memuat preview.
                      </div>
                    )}
                  </div>

                  {/* Helper text — accurate snapshot semantics */}
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Penjualan tetap dapat berjalan. Saat diselesaikan, Aether
                      menerapkan selisih terhadap stok terbaru.
                    </p>
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={() => setShowStartDialog(true)}
                    disabled={loading || !preview || preview.itemCount === 0}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Mulai Stock Opname
                  </Button>
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
              className="space-y-4"
            >
              {/* Session header + progress */}
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-sm font-medium">Stock Opname</div>
                    <div className="text-xs text-muted-foreground">
                      Dimulai {fmtTime(session.startedAt)} · Tersimpan di perangkat
                    </div>
                  </div>
                  <AutosaveBadge
                    isOnline={isOnline}
                    lastSavedAt={lastSavedAt}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm font-semibold tabular-nums">
                    {stats.countedItems} / {stats.totalItems}
                  </div>
                  <Progress
                    value={
                      stats.totalItems > 0
                        ? (stats.countedItems / stats.totalItems) * 100
                        : 0
                    }
                    className="flex-1"
                  />
                  <div className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                    {stats.totalItems > 0
                      ? Math.round(
                          (stats.countedItems / stats.totalItems) * 100
                        )
                      : 0}
                    %
                  </div>
                </div>
              </Card>

              {/* Three stat cards */}
              <div className="grid grid-cols-3 gap-3">
                <Card
                  className={cn(
                    'p-3',
                    stats.countedItems > 0 && 'border-emerald-500/30 bg-emerald-500/5'
                  )}
                >
                  <div className="text-xs text-muted-foreground">
                    Sudah dihitung
                  </div>
                  <div className="text-2xl font-bold text-emerald-500 tabular-nums">
                    {stats.countedItems}
                  </div>
                </Card>
                <Card
                  className={cn(
                    'p-3',
                    stats.uncountedItems > 0 && 'border-amber-500/30 bg-amber-500/5'
                  )}
                >
                  <div className="text-xs text-muted-foreground">
                    Belum dihitung
                  </div>
                  <div className="text-2xl font-bold text-amber-500 tabular-nums">
                    {stats.uncountedItems}
                  </div>
                </Card>
                <Card
                  className={cn(
                    'p-3',
                    stats.differenceItems > 0 && 'border-red-500/30 bg-red-500/5'
                  )}
                >
                  <div className="text-xs text-muted-foreground">Ada selisih</div>
                  <div className="text-2xl font-bold text-red-500 tabular-nums">
                    {stats.differenceItems}
                  </div>
                </Card>
              </div>
              <div className="text-xs text-muted-foreground -mt-2">
                Total Item: <span className="font-medium">{stats.totalItems}</span>
              </div>

              {/* Scan/Search bar — barcode-first workflow */}
              <Card className="p-3">
                <div className="relative">
                  <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                  <Input
                    ref={scanInputRef}
                    placeholder="Scan barcode atau cari nama/SKU lalu tekan Enter..."
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleScan()
                      }
                    }}
                    className="pl-9 pr-10 h-11 text-base"
                    autoFocus
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-9 px-2"
                    onClick={handleScan}
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Enter: pilih item · Esc: tutup editor · Ctrl+Enter: lanjut
                    Review
                  </span>
                </div>
              </Card>

              {/* Focused physical-quantity editor (after scan) */}
              {focusedSnapshot && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  <Card className="p-4 border-primary/40 bg-primary/5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {focusedSnapshot.itemName}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {focusedSnapshot.itemSku || 'Tanpa SKU'} ·{' '}
                          {focusedSnapshot.categoryName || 'Tanpa Kategori'}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => {
                          setFocusedSnapshot(null)
                          setPhysicalValue('')
                          setTimeout(() => scanInputRef.current?.focus(), 50)
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center mb-3">
                      <div className="p-2 rounded-lg bg-background">
                        <div className="text-xs text-muted-foreground">
                          Snapshot
                        </div>
                        <div className="text-base font-bold tabular-nums">
                          {fmtQty(focusedSnapshot.systemQty)}{' '}
                          <span className="text-xs font-normal text-muted-foreground">
                            {focusedSnapshot.itemUnit}
                          </span>
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-background">
                        <div className="text-xs text-muted-foreground">
                          Fisik
                        </div>
                        <div className="text-base font-bold tabular-nums">
                          {physicalValue
                            ? `${fmtQty(parseFloat(physicalValue) || 0)}`
                            : '-'}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-background">
                        <div className="text-xs text-muted-foreground">
                          Selisih
                        </div>
                        <div
                          className={cn(
                            'text-base font-bold tabular-nums',
                            !physicalValue
                              ? 'text-muted-foreground'
                              : (() => {
                                  const diff =
                                    (parseFloat(physicalValue) || 0) -
                                    focusedSnapshot.systemQty
                                  if (Math.abs(diff) < VARIANCE_EPSILON)
                                    return 'text-emerald-500'
                                  return diff > 0
                                    ? 'text-blue-500'
                                    : 'text-red-500'
                                })()
                          )}
                        >
                          {!physicalValue
                            ? '-'
                            : (() => {
                                const diff =
                                  (parseFloat(physicalValue) || 0) -
                                  focusedSnapshot.systemQty
                                const sign = diff > 0 ? '+' : ''
                                return `${sign}${fmtQty(diff)}`
                              })()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Input
                        ref={physicalInputRef}
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="Jumlah fisik"
                        value={physicalValue}
                        onChange={(e) => setPhysicalValue(e.target.value)}
                        onKeyDown={handlePhysicalKeyDown}
                        className="h-11 text-base"
                        autoFocus
                      />
                      <Button
                        size="lg"
                        onClick={() =>
                          savePhysical(
                            focusedSnapshot.id,
                            physicalValue === ''
                              ? null
                              : parseFloat(physicalValue)
                          )
                        }
                      >
                        <Save className="h-4 w-4 mr-1" />
                        Simpan & Lanjut
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              )}

              {/* Filters + sort */}
              <Card className="p-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder="Cari di tabel..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1"
                  />
                  <Select
                    value={filterMode}
                    onValueChange={(v) => setFilterMode(v as CountingFilter)}
                  >
                    <SelectTrigger className="w-full sm:w-[160px]">
                      <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Semua</SelectItem>
                      <SelectItem value="UNCOUNTED">Belum dihitung</SelectItem>
                      <SelectItem value="COUNTED">Sudah dihitung</SelectItem>
                      <SelectItem value="MATCHED">Sesuai</SelectItem>
                      <SelectItem value="DIFFERENCE">Ada selisih</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterCategory} onValueChange={setFilterCategory}>
                    <SelectTrigger className="w-full sm:w-[160px]">
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
                  <Select
                    value={sortMode}
                    onValueChange={(v) => setSortMode(v as SortMode)}
                  >
                    <SelectTrigger className="w-full sm:w-[140px]">
                      <SelectValue placeholder="Urutkan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NAME">Nama</SelectItem>
                      <SelectItem value="SKU">SKU</SelectItem>
                      <SelectItem value="CATEGORY">Kategori</SelectItem>
                      <SelectItem value="LAST_COUNTED">Terakhir dihitung</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Card>

              {/* Snapshots table */}
              <Card>
                <CardContent className="p-0">
                  <div className="max-h-[60vh] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          <TableHead className="w-[40px]">#</TableHead>
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
                            <TableCell
                              colSpan={6}
                              className="text-center py-8 text-muted-foreground"
                            >
                              {searchQuery || filterMode !== 'ALL'
                                ? 'Tidak ada item yang cocok dengan filter'
                                : 'Tidak ada item'}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredSnapshots.map((snap, idx) => {
                            const diff = varianceOf(snap)
                            const matched = isMatched(snap)
                            const difference = isDifference(snap)
                            return (
                              <TableRow
                                key={snap.id}
                                id={`snap-${snap.id}`}
                                className={cn(
                                  'cursor-pointer hover:bg-muted/50',
                                  focusedSnapshot?.id === snap.id && 'bg-primary/5',
                                  snap.isCounted && 'opacity-90'
                                )}
                                onClick={() => {
                                  setFocusedSnapshot(snap)
                                  setPhysicalValue(
                                    snap.physicalQty !== null
                                      ? fmtQty(snap.physicalQty)
                                      : ''
                                  )
                                  setTimeout(
                                    () => physicalInputRef.current?.focus(),
                                    50
                                  )
                                }}
                              >
                                <TableCell className="text-muted-foreground text-sm">
                                  {idx + 1}
                                </TableCell>
                                <TableCell>
                                  <div className="font-medium">{snap.itemName}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {snap.itemSku || '-'}{' '}
                                    {snap.categoryName && `· ${snap.categoryName}`}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {fmtQty(snap.systemQty)}{' '}
                                  <span className="text-xs text-muted-foreground">
                                    {snap.itemUnit}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {snap.physicalQty !== null ? (
                                    <span className="font-semibold">
                                      {fmtQty(snap.physicalQty)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'text-right font-mono text-sm font-semibold',
                                    snap.physicalQty === null
                                      ? 'text-muted-foreground'
                                      : matched
                                        ? 'text-emerald-500'
                                        : diff > 0
                                          ? 'text-blue-500'
                                          : 'text-red-500'
                                  )}
                                >
                                  {snap.physicalQty === null
                                    ? '-'
                                    : matched
                                      ? '0'
                                      : `${diff > 0 ? '+' : ''}${fmtQty(diff)}`}
                                </TableCell>
                                <TableCell>
                                  {snap.physicalQty === null ? (
                                    <Badge
                                      variant="outline"
                                      className="text-xs text-amber-500 border-amber-500/30"
                                    >
                                      Belum dihitung
                                    </Badge>
                                  ) : matched ? (
                                    <Badge className="bg-emerald-500/10 text-emerald-600 border-0 text-xs">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      Sesuai
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-amber-500/10 text-amber-600 border-0 text-xs">
                                      <AlertTriangle className="h-3 w-3 mr-1" />
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
                </CardContent>
              </Card>

              {/* Notes */}
              <Card className="p-4">
                <label className="text-sm font-medium mb-2 block">
                  Catatan (opsional)
                </label>
                <Textarea
                  placeholder="Tambahkan catatan untuk stock opname ini..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </Card>

              {/* Action buttons */}
              <div className="flex gap-2 sticky bottom-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleEnterReview}
                  disabled={stats.countedItems === 0}
                >
                  <Pause className="h-4 w-4 mr-2" />
                  Review ({stats.countedItems})
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowCancelDialog(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
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
              className="space-y-4"
            >
              <Card className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium">Review Stock Opname</div>
                  <AutosaveBadge isOnline={isOnline} lastSavedAt={lastSavedAt} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Periksa selisih sebelum diterapkan ke server.
                </p>
              </Card>

              {/* 4 stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
                  <div className="text-xs text-muted-foreground">Dihitung</div>
                  <div className="text-2xl font-bold text-emerald-500 tabular-nums">
                    {stats.countedItems}
                  </div>
                </Card>
                <Card className="p-3 border-blue-500/30 bg-blue-500/5">
                  <div className="text-xs text-muted-foreground">Sesuai</div>
                  <div className="text-2xl font-bold text-blue-500 tabular-nums">
                    {stats.matchedItems}
                  </div>
                </Card>
                <Card className="p-3 border-amber-500/30 bg-amber-500/5">
                  <div className="text-xs text-muted-foreground">Selisih</div>
                  <div className="text-2xl font-bold text-amber-500 tabular-nums">
                    {stats.differenceItems}
                  </div>
                </Card>
                <Card className="p-3 border-muted-foreground/30 bg-muted/30">
                  <div className="text-xs text-muted-foreground">
                    Belum dihitung
                  </div>
                  <div className="text-2xl font-bold tabular-nums">
                    {stats.uncountedItems}
                  </div>
                </Card>
              </div>

              {/* Partial-completion helper */}
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Hanya item yang sudah dihitung yang akan diproses.{' '}
                  <span className="font-medium">
                    {stats.uncountedItems} item belum dihitung
                  </span>{' '}
                  dan tidak akan diubah.
                </p>
              </div>

              {/* Filter toggle */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={reviewFilter === 'DIFFERENCE' ? 'default' : 'outline'}
                  onClick={() => setReviewFilter('DIFFERENCE')}
                >
                  Hanya Selisih ({stats.differenceItems})
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
              <Card>
                <CardContent className="p-0">
                  <div className="max-h-[55vh] overflow-y-auto">
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
                            <TableCell
                              colSpan={5}
                              className="text-center py-8 text-muted-foreground"
                            >
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
                                  <div className="font-medium">{snap.itemName}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {snap.itemSku || '-'}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {fmtQty(snap.systemQty)}{' '}
                                  <span className="text-xs text-muted-foreground">
                                    {snap.itemUnit}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm font-semibold">
                                  {fmtQty(snap.physicalQty ?? 0)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'text-right font-mono text-sm font-semibold',
                                    matched
                                      ? 'text-emerald-500'
                                      : diff > 0
                                        ? 'text-blue-500'
                                        : 'text-red-500'
                                  )}
                                >
                                  {matched
                                    ? '0'
                                    : `${diff > 0 ? '+' : ''}${fmtQty(diff)}`}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {matched ? (
                                    'Stok sesuai'
                                  ) : diff > 0 ? (
                                    <span className="text-blue-500">
                                      Stok bertambah {fmtQty(diff)}
                                    </span>
                                  ) : (
                                    <span className="text-red-500">
                                      Stok berkurang {fmtQty(Math.abs(diff))}
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Action buttons — partial completion */}
              <div className="flex gap-2 sticky bottom-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStatus('COUNTING')}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Lanjut Hitung
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleOpenCompleteDialog}
                  disabled={loading || stats.countedItems === 0}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Selesaikan {stats.countedItems} Item
                </Button>
              </div>
            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════
           * COMPLETED RESULT PAGE (UI-only final state)
           * ════════════════════════════════════════════════════ */}
          {status === 'COMPLETED' && completionSummary && (
            <motion.div
              key="completed"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto"
            >
              <Card>
                <CardHeader className="text-center">
                  <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  </div>
                  <CardTitle>Stock Opname Selesai</CardTitle>
                  <p className="text-sm text-muted-foreground mt-2">
                    {fmtDateTime(new Date().toISOString())}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Committed counts */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                      <div className="text-xs text-muted-foreground">Dihitung</div>
                      <div className="text-2xl font-bold tabular-nums">
                        {completionSummary.countedItems}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <div className="text-xs text-muted-foreground">
                        Disesuaikan
                      </div>
                      <div className="text-2xl font-bold text-amber-500 tabular-nums">
                        {completionSummary.adjustedItems}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/40 border border-border">
                      <div className="text-xs text-muted-foreground">
                        Tidak diubah
                      </div>
                      <div className="text-2xl font-bold tabular-nums">
                        {completionSummary.uncountedItems}
                      </div>
                    </div>
                  </div>

                  {/* Stock impact */}
                  <div className="p-4 rounded-lg bg-muted/30 border border-border">
                    <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Dampak Stok
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2">
                        <PlusCircle className="h-4 w-4 text-blue-500" />
                        <div>
                          <div className="text-xs text-muted-foreground">
                            Bertambah
                          </div>
                          <div className="text-base font-bold text-blue-500 tabular-nums">
                            {fmtQty(completionSummary.totalPositiveDelta)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <MinusCircle className="h-4 w-4 text-red-500" />
                        <div>
                          <div className="text-xs text-muted-foreground">
                            Berkurang
                          </div>
                          <div className="text-base font-bold text-red-500 tabular-nums">
                            {fmtQty(completionSummary.totalNegativeDelta)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Server-confirmed adjustments (if available) */}
                  {completeResult && (
                    <div className="p-3 rounded-lg bg-muted/30 border border-border">
                      <div className="text-xs text-muted-foreground">
                        Penyesuaian diterapkan di server
                      </div>
                      <div className="text-sm font-medium tabular-nums">
                        {completeResult.summary.adjustmentsMade} item ·{' '}
                        {completeResult.summary.batchUpdates} batch diperbarui
                      </div>
                    </div>
                  )}

                  {/* CTAs */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        const { setPage } = usePageStore.getState()
                        setPage('audit-log')
                      }}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Lihat Audit Log
                    </Button>
                    <Button className="flex-1" onClick={handleNewSession}>
                      <Play className="h-4 w-4 mr-2" />
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
       * DIALOGS
       * ════════════════════════════════════════════════════════ */}

      {/* Start Confirmation Dialog */}
      <ResponsiveDialog open={showStartDialog} onOpenChange={setShowStartDialog}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Mulai Stock Opname?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Aether akan menyimpan snapshot stok untuk{' '}
              <span className="font-semibold text-foreground">
                {preview?.itemCount ?? 0} item
              </span>
              . Hasil hitung fisik disimpan di perangkat ini sampai sesi
              diselesaikan.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="py-2 space-y-3">
            {/* Scoped warning (not a blanket warning forbidding sales) */}
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Penjualan tetap dapat berjalan. Selisih akan diterapkan terhadap
                stok terbaru saat opname selesai.
              </p>
              <p className="text-xs text-amber-600 mt-2 leading-relaxed">
                ⚠️ Hindari pembelian, transfer stok, atau adjustment manual pada
                item yang sedang dihitung agar review lebih mudah.
              </p>
            </div>

            {/* Summary table */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-2 text-sm">
                <div className="p-2 bg-muted/40 text-muted-foreground">Item</div>
                <div className="p-2 font-medium tabular-nums">
                  {preview?.itemCount ?? 0}
                </div>
                <div className="p-2 bg-muted/40 text-muted-foreground">Stok 0</div>
                <div className="p-2 font-medium">
                  {includeZeroStock ? 'Disertakan' : 'Tidak disertakan'}
                </div>
                <div className="p-2 bg-muted/40 text-muted-foreground">Mode</div>
                <div className="p-2 font-medium">
                  {scope === 'ALL_ITEMS'
                    ? 'Semua Inventory'
                    : scope === 'CATEGORY'
                      ? `${selectedCategoryIds.length} kategori`
                      : `${selectedItemIds.length} item terpilih`}
                </div>
                <div className="p-2 bg-muted/40 text-muted-foreground">
                  Penyimpanan
                </div>
                <div className="p-2 font-medium">Perangkat ini</div>
              </div>
            </div>
          </div>

          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setShowStartDialog(false)}>
              Batal
            </Button>
            <Button onClick={handleStartConfirm} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Camera className="h-4 w-4 mr-2" />
              )}
              Ambil Snapshot &amp; Mulai
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Complete Dialog — reads immutable completionSummary from state */}
      <ResponsiveDialog
        open={showCompleteDialog}
        onOpenChange={(open) => {
          // Only allow closing if not currently loading
          if (!loading) setShowCompleteDialog(open)
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Selesaikan Stock Opname?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Penyesuaian akan diterapkan ke server. Stok diupdate berdasarkan
              selisih antara hitungan fisik dan snapshot.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {completionSummary && (
            <div className="py-2 space-y-3">
              {/* Immutable summary — read from React state, NEVER re-derived */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="grid grid-cols-2 text-sm">
                  <div className="p-2 bg-muted/40 text-muted-foreground">
                    Item dihitung
                  </div>
                  <div className="p-2 font-medium tabular-nums">
                    {completionSummary.countedItems}
                  </div>
                  <div className="p-2 bg-muted/40 text-muted-foreground">
                    Item sesuai
                  </div>
                  <div className="p-2 font-medium tabular-nums">
                    {completionSummary.matchedItems}
                  </div>
                  <div className="p-2 bg-muted/40 text-muted-foreground">
                    Item disesuaikan
                  </div>
                  <div className="p-2 font-medium tabular-nums">
                    {completionSummary.adjustedItems}
                  </div>
                  <div className="p-2 bg-muted/40 text-muted-foreground">
                    Belum dihitung
                  </div>
                  <div className="p-2 font-medium tabular-nums">
                    {completionSummary.uncountedItems}
                  </div>
                </div>
              </div>

              {/* Impact */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <div className="text-xs text-muted-foreground">
                    Total penambahan
                  </div>
                  <div className="text-lg font-bold text-blue-500 tabular-nums">
                    +{fmtQty(completionSummary.totalPositiveDelta)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                  <div className="text-xs text-muted-foreground">
                    Total pengurangan
                  </div>
                  <div className="text-lg font-bold text-red-500 tabular-nums">
                    -{fmtQty(completionSummary.totalNegativeDelta)}
                  </div>
                </div>
              </div>

              {/* Partial-completion warning */}
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Hanya item yang sudah dihitung yang akan diproses.{' '}
                  <span className="font-medium">
                    {completionSummary.uncountedItems} item belum dihitung
                  </span>{' '}
                  dan tidak akan diubah.
                </p>
              </div>
            </div>
          )}

          <ResponsiveDialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCompleteDialog(false)}
              disabled={loading}
            >
              Kembali ke Review
            </Button>
            <Button onClick={handleComplete} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Terapkan{' '}
              {completionSummary?.adjustedItems ?? 0} Penyesuaian
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Cancel Dialog */}
      <ResponsiveDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Batalkan Stock Opname?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Semua data hitungan yang tersimpan di perangkat ini akan dihapus.
              Tindakan ini tidak dapat dibatalkan.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
              Lanjutkan
            </Button>
            <Button variant="destructive" onClick={handleCancel}>
              Ya, Batalkan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Sub-components
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
      <Badge
        variant="outline"
        className="gap-1.5 text-amber-500 border-amber-500/30"
      >
        <WifiOff className="h-3 w-3" />
        Offline — tersimpan di perangkat
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="gap-1.5 text-emerald-600 border-emerald-500/30"
    >
      <Wifi className="h-3 w-3" />
      Tersimpan{lastSavedAt ? ` · ${fmtTime(lastSavedAt)}` : ''}
    </Badge>
  )
}

/**
 * Search-and-select item picker for the SELECTED_ITEMS scope.
 * Loads items via previewOpname() and lets the user search + check.
 */
function SelectedItemsPicker({
  selectedIds,
  onChange,
  includeZeroStock,
}: {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  includeZeroStock: boolean
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<
    Array<{
      inventoryItemId: string
      itemName: string
      itemSku: string | null
      categoryName: string | null
      systemQty: number
    }>
  >([])
  // Initialize to `true` so the first render shows the loading state —
  // avoids calling setState synchronously inside the effect body.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/inventory/stock-opname?outletId=current`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        let list = (data.items as any[]).map((i) => ({
          inventoryItemId: i.inventoryItemId,
          itemName: i.itemName,
          itemSku: i.itemSku,
          categoryName: i.categoryName,
          systemQty: i.systemQty,
        }))
        if (!includeZeroStock) {
          list = list.filter((i) => i.systemQty > 0)
        }
        list.sort((a, b) => a.itemName.localeCompare(b.itemName))
        setItems(list)
      })
      .catch((err) => console.error('[SelectedItemsPicker]', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [includeZeroStock])

  const filtered = useMemo(() => {
    if (!query) return items
    const q = query.toLowerCase()
    return items.filter(
      (i) =>
        i.itemName.toLowerCase().includes(q) ||
        i.itemSku?.toLowerCase().includes(q)
    )
  }, [items, query])

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    )
  }

  if (loading) {
    return <Skeleton className="h-48 w-full" />
  }

  return (
    <div className="ml-1 p-3 rounded-lg bg-muted/50 border border-border space-y-2">
      <Input
        placeholder="Cari item..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8"
      />
      <div className="text-xs text-muted-foreground">
        {selectedIds.length} item dipilih dari {items.length} total
      </div>
      <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            Tidak ada item.
          </div>
        ) : (
          filtered.slice(0, 200).map((item) => (
            <label
              key={item.inventoryItemId}
              className="flex items-center gap-2 cursor-pointer text-sm p-1 rounded hover:bg-background"
            >
              <Checkbox
                checked={selectedIds.includes(item.inventoryItemId)}
                onCheckedChange={() => toggle(item.inventoryItemId)}
              />
              <div className="flex-1 min-w-0">
                <div className="truncate">{item.itemName}</div>
                <div className="text-xs text-muted-foreground">
                  {item.itemSku || '-'} · {item.categoryName || 'Tanpa Kategori'} ·{' '}
                  stok {fmtQty(item.systemQty)}
                </div>
              </div>
            </label>
          ))
        )}
        {filtered.length > 200 && (
          <div className="text-xs text-muted-foreground text-center py-2">
            ...dan {filtered.length - 200} lainnya. Gunakan pencarian untuk
            mempersempit.
          </div>
        )}
      </div>
    </div>
  )
}
