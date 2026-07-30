'use client'

/**
 * StockOpnamePage.tsx
 * 
 * Physical stock count (Stock Opname) page.
 * Uses Dexie as transient workspace - server is source of truth.
 * 
 * Workflow:
 *   DRAFT → COUNTING → REVIEW → COMPLETED
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  Zap,
  ArrowRight,
  Loader2,
  FileText,
  Trash2,
  RefreshCw,
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
  type OpnameStatus,
  type SnapshotItem,
  type OpnameSession,
  type CompleteResult,
} from '@/lib/stock-opname/service'

// ==================== STATUS CONFIG ====================
const STATUS_CONFIG: Record<OpnameStatus, {
  label: string
  color: string
  bgColor: string
  icon: React.ReactNode
  description: string
}> = {
  DRAFT: {
    label: 'Draft',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    icon: <ClipboardList className="h-4 w-4" />,
    description: 'Siap memulai stock opname',
  },
  COUNTING: {
    label: 'Sedang Menghitung',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    icon: <Search className="h-4 w-4 animate-pulse" />,
    description: 'Hitung stok fisik untuk setiap item',
  },
  REVIEW: {
    label: 'Review',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    icon: <AlertTriangle className="h-4 w-4" />,
    description: 'Periksa selisih sebelum menyimpan',
  },
  COMPLETING: {
    label: 'Menyimpan...',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    description: 'Menerapkan penyesuaian ke server',
  },
}

export default function StockOpnamePage() {
  // ════════════════════════════════════════════════════════════
  // State
  // ════════════════════════════════════════════════════════════
  
  const [status, setStatus] = useState<OpnameStatus | null>(null)
  const [session, setSession] = useState<OpnameSession | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [scanInput, setScanInput] = useState('')
  const scanInputRef = useRef<HTMLInputElement>(null)
  
  // Filter states
  const [filterVariance, setFilterVariance] = useState<'all' | 'variance' | 'uncounted'>('all')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  
  // Dialogs
  const [showStartDialog, setShowStartDialog] = useState(false)
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showResultDialog, setShowResultDialog] = useState(false)
  const [completeResult, setCompleteResult] = useState<CompleteResult | null>(null)
  
  // Notes
  const [notes, setNotes] = useState('')
  
  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  
  // Stats
  const [stats, setStats] = useState({
    total: 0,
    counted: 0,
    uncounted: 0,
    variance: 0,
  })

  // ════════════════════════════════════════════════════════════
  // Initialize / Resume
  // ════════════════════════════════════════════════════════════
  
  useEffect(() => {
    checkExistingSession()
  }, [])

  const checkExistingSession = async () => {
    try {
      const existing = await resumeOpname()
      if (existing) {
        setStatus(existing.status)
        setSession(existing)
        const snaps = await getAllSnapshots()
        setSnapshots(snaps)
        recalculateStats(snaps)
      }
    } catch (error) {
      console.error('[StockOpname] Resume error:', error)
    }
  }

  // ════════════════════════════════════════════════════════════
  // Actions
  // ════════════════════════════════════════════════════════════

  const handleStart = async (options?: { includeZeroStock: boolean }) => {
    setLoading(true)
    try {
      const result = await startOpname('current', {
        includeZeroStock: !options?.includeZeroStock,
      })
      
      setStatus('COUNTING')
      setSession(await getOpnameSession())
      const snaps = await getAllSnapshots()
      setSnapshots(snaps)
      recalculateStats(snaps)
      
      toast.success(`Stock opname dimulai! ${result.totalItems} item siap dihitung`)
      setShowStartDialog(false)
    } catch (error) {
      toast.error('Gagal memulai stock opname')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleScan = async () => {
    if (!scanInput.trim()) return
    
    const found = await findByScan(scanInput.trim())
    
    if (found) {
      // Auto-focus to edit this item's quantity
      setEditingId(found.id)
      setEditValue('')
      
      // Scroll to item
      const element = document.getElementById(`snap-${found.id}`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      
      toast.success(`Ditemukan: ${found.itemName}`, {
        description: `System: ${found.systemQty} ${found.itemUnit}`,
      })
    } else {
      toast.error('Item tidak ditemukan', {
        description: `"${scanInput}" tidak cocok dengan nama/SKU/batch`,
      })
    }
    
    setScanInput('')
    scanInputRef.current?.focus()
  }

  const handleUpdateCount = async (snapshotId: string, qty: number) => {
    try {
      await updateCount(snapshotId, qty)
      
      setSnapshots(prev => prev.map(s => 
        s.id === snapshotId 
          ? { ...s, physicalQty: qty, isCounted: true, updatedAt: new Date().toISOString() }
          : s
      ))
      
      setEditingId(null)
      recalculateStats(snapshots.map(s => s.id === snapshotId ? { ...s, physicalQty: qty, isCounted: true } : s))
    } catch (error) {
      toast.error('Gagal menyimpan count')
    }
  }

  const handleSetReview = async () => {
    const { setReviewing } = await import('@/lib/stock-opname/service')
    await setReviewing(notes)
    setStatus('REVIEW')
    setSession(prev => prev ? { ...prev, status: 'REVIEW', notes: notes || null } : null)
    toast.success('Masuk ke mode Review')
  }

  const handleComplete = async () => {
    setLoading(true)
    try {
      const result = await completeOpname()
      setCompleteResult(result)
      setShowCompleteDialog(false)
      setShowResultDialog(true)
      setStatus(null)
      setSession(null)
      setSnapshots([])
      
      toast.success('Stock opname berhasil diselesaikan!', {
        description: `${result.summary.adjustmentsMade} penyesuaian diterapkan`,
      })
    } catch (error) {
      toast.error('Gagal menyelesaikan stock opname')
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
      setShowCancelDialog(false)
      toast.info('Stock opname dibatalkan')
    } catch (error) {
      toast.error('Gagal membatalkan')
    }
  }

  // ════════════════════════════════════════════════════════════
  // Helpers
  // ════════════════════════════════════════════════════════════

  const recalculateStats = (snaps: SnapshotItem[]) => {
    const total = snaps.filter(s => s.batchId === null).length // Item-level only
    const counted = snaps.filter(s => s.physicalQty !== null && s.batchId === null).length
    const uncounted = total - counted
    const variance = snaps.filter(s => 
      s.physicalQty !== null && 
      s.batchId === null &&
      Math.abs((s.physicalQty ?? 0) - s.systemQty) > 0.001
    ).length
    
    setStats({ total, counted, uncounted, variance })
  }

  const getFilteredSnapshots = (): SnapshotItem[] => {
    let filtered = snapshots.filter(s => s.batchId === null) // Show item-level only
    
    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(s =>
        s.itemName.toLowerCase().includes(q) ||
        s.itemSku?.toLowerCase().includes(q)
      )
    }
    
    // Variance filter
    if (filterVariance === 'variance') {
      filtered = filtered.filter(s =>
        s.physicalQty !== null && Math.abs((s.physicalQty ?? 0) - s.systemQty) > 0.001
      )
    } else if (filterVariance === 'uncounted') {
      filtered = filtered.filter(s => s.physicalQty === null)
    }
    
    return filtered
  }

  const getVarianceColor = (snapshot: SnapshotItem): string => {
    if (snapshot.physicalQty === null) return 'text-gray-400'
    const diff = snapshot.physicalQty - snapshot.systemQty
    if (Math.abs(diff) < 0.001) return 'text-emerald-400'
    return diff > 0 ? 'text-blue-400' : 'text-red-400'
  }

  const formatVariance = (snapshot: SnapshotItem): string => {
    if (snapshot.physicalQty === null) return '-'
    const diff = snapshot.physicalQty - snapshot.systemQty
    if (Math.abs(diff) < 0.001) return '0'
    return (diff > 0 ? '+' : '') + diff.toFixed(2)
  }

  // ════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════

  const filteredSnapshots = getFilteredSnapshots()
  const statusConfig = status ? STATUS_CONFIG[status] : null

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Stock Opname
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Hitung stok fisik & sesuaikan dengan sistem
              </p>
            </div>
            
            {/* Status Badge */}
            {statusConfig && (
              <Badge className={cn('gap-1.5 px-3 py-1', statusConfig.bgColor, statusConfig.color)}>
                {statusConfig.icon}
                {statusConfig.label}
              </Badge>
            )}
          </div>
          
          {/* Status Description */}
          {statusConfig && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn('mt-3 p-2 rounded-md text-sm', statusConfig.bgColor)}
            >
              {statusConfig.description}
            </motion.div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {!status ? (
          /* ════════════════════════════════════════════════
           * IDLE STATE - Start new opname
           * ════════════════════════════════════════════════ */
          <div className="flex items-center justify-center min-h-[60vh]">
            <Card className="w-full max-w-lg">
              <CardHeader className="text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <ClipboardCheck className="h-8 w-8 text-primary" />
                </div>
                <CardTitle>Mulai Stock Opname</CardTitle>
                <p className="text-sm text-muted-foreground mt-2">
                  Hitung stok fisik dan buat penyesuaian jika ada selisih
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 rounded-lg bg-muted">
                    <Package className="h-4 w-4 text-muted-foreground mb-1" />
                    <div className="font-medium">Snapshot</div>
                    <div className="text-xs text-muted-foreground">Stok dibekukan saat mulai</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <Zap className="h-4 w-4 text-muted-foreground mb-1" />
                    <div className="font-medium">Cepat</div>
                    <div className="text-xs text-muted-foreground">Support barcode scanner</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground mb-1" />
                    <div className="font-medium">Aman</div>
                    <div className="text-xs text-muted-foreground">Transaksi selama opname aman</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <FileText className="h-4 w-4 text-muted-foreground mb-1" />
                    <div className="font-medium">Audit Trail</div>
                    <div className="text-xs text-muted-foreground">Semua perubahan terekam</div>
                  </div>
                </div>
                
                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={() => setShowStartDialog(true)}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Mulai Stock Opname Baru
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* ════════════════════════════════════════════════
           * ACTIVE STATE - Counting / Review
           * ════════════════════════════════════════════════ */
          <div className="space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="p-3">
                <div className="text-xs text-muted-foreground">Total Item</div>
                <div className="text-2xl font-bold">{stats.total}</div>
              </Card>
              <Card className={cn("p-3", stats.counted > 0 && "border-emerald-500/30 bg-emerald-500/5")}>
                <div className="text-xs text-muted-foreground">Sudah Dihitung</div>
                <div className="text-2xl font-bold text-emerald-400">{stats.counted}</div>
              </Card>
              <Card className={cn("p-3", stats.uncounted > 0 && "border-amber-500/30 bg-amber-500/5")}>
                <div className="text-xs text-muted-foreground">Belum Dihitung</div>
                <div className="text-2xl font-bold text-amber-400">{stats.uncounted}</div>
              </Card>
              <Card className={cn("p-3", stats.variance > 0 && "border-red-500/30 bg-red-500/5")}>
                <div className="text-xs text-muted-foreground">Ada Selisih</div>
                <div className="text-2xl font-bold text-red-400">{stats.variance}</div>
              </Card>
            </div>

            {/* Toolbar */}
            <Card className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Search/Scanner */}
                <div className="flex-1 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      ref={scanInputRef}
                      placeholder="Scan barcode atau ketik nama/SKU..."
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                      className="pl-9 pr-10"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 px-2"
                      onClick={handleScan}
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Filters */}
                <Select value={filterVariance} onValueChange={(v: any) => setFilterVariance(v)}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua</SelectItem>
                    <SelectItem value="uncounted">Belum Dihitung</SelectItem>
                    <SelectItem value="variance">Ada Selisih</SelectItem>
                  </SelectContent>
                </Select>

                {/* Actions */}
                <div className="flex gap-2">
                  {(status === 'COUNTING') && (
                    <>
                      <Button 
                        variant="outline" 
                        onClick={handleSetReview}
                        disabled={stats.counted === 0}
                      >
                        <Pause className="h-4 w-4 mr-1" />
                        Review
                      </Button>
                      <Button 
                        variant="destructive" 
                        onClick={() => setShowCancelDialog(true)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Batal
                      </Button>
                    </>
                  )}
                  
                  {status === 'REVIEW' && (
                    <>
                      <Button 
                        variant="outline" 
                        onClick={() => setStatus('COUNTING')}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Lanjut Hitung
                      </Button>
                      <Button 
                        onClick={() => setShowCompleteDialog(true)}
                        disabled={loading}
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-1" />
                        )}
                        Selesaikan
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>

            {/* Snapshots Table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">#</TableHead>
                      <TableHead>Nama Item</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">System Qty</TableHead>
                      <TableHead className="text-right">Physical Qty</TableHead>
                      <TableHead className="text-right">Selisih</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSnapshots.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          {searchQuery ? 'Tidak ditemukan' : 'Tidak ada data'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredSnapshots.map((snap, idx) => (
                        <TableRow 
                          key={snap.id}
                          id={`snap-${snap.id}`}
                          className={cn(
                            editingId === snap.id && "bg-primary/5",
                            snap.isCounted && "opacity-90"
                          )}
                          onClick={() => {
                            if (editingId !== snap.id) {
                              setEditingId(snap.id)
                              setEditValue(snap.physicalQty?.toString() || '')
                            }
                          }}
                        >
                          <TableCell className="text-muted-foreground text-sm">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="font-medium">
                            {snap.itemName}
                            {snap.batchNumber && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                {snap.batchNumber}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {snap.itemSku || '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {snap.systemQty.toFixed(2)}
                            <span className="text-xs text-muted-foreground ml-1">
                              {snap.itemUnit}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {editingId === snap.id ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => {
                                  const val = parseFloat(editValue)
                                  if (!isNaN(val) && val >= 0) {
                                    handleUpdateCount(snap.id, val)
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const val = parseFloat(editValue)
                                    if (!isNaN(val) && val >= 0) {
                                      handleUpdateCount(snap.id, val)
                                    }
                                  }
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                                className="w-24 h-8 text-right"
                                autoFocus
                              />
                            ) : (
                              <span className={cn(
                                "font-mono",
                                snap.physicalQty !== null ? "font-semibold" : "text-muted-foreground"
                              )}>
                                {snap.physicalQty !== null 
                                  ? snap.physicalQty.toFixed(2)
                                  : '-'
                                }
                              </span>
                            )}
                          </TableCell>
                          <TableCell className={cn(
                            "text-right font-mono font-semibold",
                            getVarianceColor(snap)
                          )}>
                            {formatVariance(snap)}
                          </TableCell>
                          <TableCell>
                            {snap.physicalQty === null ? (
                              <Badge variant="outline" className="text-xs">
                                Belum
                              </Badge>
                            ) : Math.abs((snap.physicalQty ?? 0) - snap.systemQty) < 0.001 ? (
                              <Badge className="bg-emerald-500/10 text-emerald-400 border-0 text-xs">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Sesuai
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-500/10 text-amber-400 border-0 text-xs">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Selisih
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Notes (optional) */}
            <Card className="p-4">
              <label className="text-sm font-medium mb-2 block">Catatan (opsional)</label>
              <Textarea
                placeholder="Tambahkan catatan untuk stock opname ini..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </Card>
          </div>
        )}
      </main>

      {/* ════════════════════════════════════════════════════════════
       * DIALOGS
       * ════════════════════════════════════════════════════════════ */}

      {/* Start Dialog */}
      <ResponsiveDialog open={showStartDialog} onOpenChange={setShowStartDialog}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Mulai Stock Opname Baru?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Stok saat ini akan dibekukan (snapshot). Transaksi yang terjadi selama proses opname tetap aman.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-400">
                ⚠️ Pastikan tidak ada transaksi penjualan/pembelian yang sedang berlangsung saat melakukan stock opname untuk hasil yang akurat.
              </p>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Opsi:</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked className="rounded" />
                <span className="text-sm">Sertakan item dengan stok 0</span>
              </label>
            </div>
          </div>
          
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setShowStartDialog(false)}>
              Batal
            </Button>
            <Button onClick={() => handleStart()} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Mulai Sekarang
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Complete Dialog */}
      <ResponsiveDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Selesaikan Stock Opname?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Penyesuaian akan diterapkan ke server. Stok akan diupdate berdasarkan selisih dari snapshot.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          
          <div className="py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-2 rounded bg-muted">
                <div className="text-muted-foreground">Total Item</div>
                <div className="font-bold text-lg">{session?.countedItems || 0}</div>
              </div>
              <div className="p-2 rounded bg-muted">
                <div className="text-muted-foreground">Ada Selisih</div>
                <div className="font-bold text-lg text-amber-400">{session?.varianceItems || 0}</div>
              </div>
            </div>
            
            {session && session.varianceItems > 0 && (
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <p className="text-sm text-blue-400">
                  ℹ️ Delta dihitung: <strong>physicalQty - systemQty (snapshot)</strong><br/>
                   Server akan menambahkan delta ke stok terbaru, sehingga transaksi selama counting tetap aman.
                </p>
              </div>
            )}
          </div>
          
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setShowCompleteDialog(false)}>
              Kembali ke Review
            </Button>
            <Button onClick={handleComplete} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Ya, Selesaikan
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
              Semua data counting yang belum disimpan akan hilang. Tindakan ini tidak dapat dibatalkan.
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

      {/* Result Dialog */}
      <ResponsiveDialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <ResponsiveDialogContent className="max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              Stock Opname Berhasil!
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Semua penyesuaian telah diterapkan ke server
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          
          {completeResult && (
            <div className="py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-lg bg-emerald-500/10">
                  <div className="text-muted-foreground">Penyesuaian</div>
                  <div className="font-bold text-xl text-emerald-400">{completeResult.summary.adjustmentsMade}</div>
                </div>
                <div className="p-3 rounded-lg bg-blue-500/10">
                  <div className="text-muted-foreground">Batch Update</div>
                  <div className="font-bold text-xl text-blue-400">{completeResult.summary.batchUpdates}</div>
                </div>
                <div className="p-3 rounded-lg bg-amber-500/10">
                  <div className="text-muted-foreground">Item Selisih</div>
                  <div className="font-bold text-xl text-amber-400">{completeResult.summary.varianceItems}</div>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-muted-foreground">Nilai Variance</div>
                  <div className="font-bold text-xl">Rp {completeResult.summary.totalVarianceValue.toLocaleString('id-ID')}</div>
                </div>
              </div>
              
              {/* Adjustment Details */}
              {completeResult.adjustments.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">System</TableHead>
                        <TableHead className="text-right">Fisik</TableHead>
                        <TableHead className="text-right">Delta</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {completeResult.adjustments.slice(0, 10).map((adj, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">{adj.itemName}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{adj.systemQty}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{adj.physicalQty}</TableCell>
                          <TableCell className={cn(
                            "text-right font-mono text-sm font-semibold",
                            adj.delta > 0 ? "text-blue-400" : adj.delta < 0 ? "text-red-400" : ""
                          )}>
                            {adj.delta > 0 ? '+' : ''}{adj.delta}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {completeResult.adjustments.length > 10 && (
                    <div className="p-2 text-center text-xs text-muted-foreground">
                      ...dan {completeResult.adjustments.length - 10} lainnya
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          <ResponsiveDialogFooter>
            <Button onClick={() => setShowResultDialog(false)}>
              Tutup
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
