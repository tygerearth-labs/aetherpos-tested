'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatDate, formatNumber } from '@/lib/format'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pagination } from '@/components/shared/pagination'
import {
  Search,
  ArrowDown,
  ArrowUp,
  PackagePlus,
  SlidersHorizontal,
  ShoppingCart,
  Truck,
  RotateCcw,
  X,
  Activity,
  ArrowRightLeft,
  TrendingDown,
  TrendingUp,
  FileText,
  Eye,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from '@/components/ui/responsive-dialog'

// ==================== TYPES ====================
interface InventoryMovement {
  id: string
  inventoryItemId: string
  type: string
  quantity: number
  previousStock: number
  newStock: number
  referenceId: string | null
  referenceType: string | null
  referenceLabel: string | null
  notes: string | null
  createdAt: string
  itemName: string
  itemSku: string | null
  baseUnit: string
  category: { id: string; name: string; color: string } | null
  userName: string | null
}

interface MovementResponse {
  movements: InventoryMovement[]
  totalPages: number
  summary: {
    totalMovements: number
    totalStockIn: number
    totalStockOut: number
  }
}

// ==================== MOVEMENT TYPE CONFIG ====================
const MOVEMENT_CONFIG: Record<string, {
  label: string
  icon: React.ElementType
  color: string
  bgColor: string
  borderColor: string
  dotColor: string
  description: string
}> = {
  PURCHASE: {
    label: 'Restock',
    icon: PackagePlus,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    dotColor: 'bg-emerald-500',
    description: 'Stok masuk dari Purchase Order',
  },
  RESTOCK: {
    label: 'Restock Manual',
    icon: RotateCcw,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    dotColor: 'bg-amber-500',
    description: 'Restock stok secara manual',
  },
  ADJUSTMENT: {
    label: 'Penyesuaian',
    icon: SlidersHorizontal,
    color: 'text-zinc-300',
    bgColor: 'bg-zinc-500/10',
    borderColor: 'border-zinc-500/20',
    dotColor: 'bg-zinc-400',
    description: 'Penyesuaian stok manual',
  },
  CONSUMPTION: {
    label: 'Konsumsi',
    icon: ShoppingCart,
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/20',
    dotColor: 'bg-sky-500',
    description: 'Bahan baku terpakai dari penjualan',
  },
  TRANSFER_OUT: {
    label: 'Transfer Keluar',
    icon: Truck,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    dotColor: 'bg-orange-500',
    description: 'Bahan baku dikirim ke cabang lain',
  },
  TRANSFER_IN: {
    label: 'Transfer Masuk',
    icon: Truck,
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/20',
    dotColor: 'bg-violet-500',
    description: 'Bahan baku diterima dari cabang lain',
  },
}

function getMovementConfig(type: string) {
  return MOVEMENT_CONFIG[type] || {
    label: type,
    icon: Activity,
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/10',
    borderColor: 'border-slate-500/20',
    dotColor: 'bg-slate-500',
    description: type,
  }
}

// ==================== MAIN COMPONENT ====================
export default function InventoryMovementPage() {
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [summary, setSummary] = useState({ totalMovements: 0, totalStockIn: 0, totalStockOut: 0 })
  const [selectedMovement, setSelectedMovement] = useState<InventoryMovement | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const fetchMovements = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('search', search)
      if (typeFilter) params.set('type', typeFilter)
      const res = await fetch(`/api/inventory/movements?${params}`)
      if (res.ok) {
        const data: MovementResponse = await res.json()
        setMovements(data.movements || [])
        setTotalPages(data.totalPages || 1)
        setSummary(data.summary || { totalMovements: 0, totalStockIn: 0, totalStockOut: 0 })
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [page, search, typeFilter])

  useEffect(() => {
    fetchMovements()
  }, [fetchMovements])

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const handleTypeChange = (value: string) => {
    setTypeFilter(value === '__all__' ? '' : value)
    setPage(1)
  }

  const openDetail = (m: InventoryMovement) => {
    setSelectedMovement(m)
    setDetailOpen(true)
  }

  // ─── Animation variants ───
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.04 },
    },
  }
  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] } },
  }

  return (
    <div className="space-y-4">
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100 tracking-tight">Log Stok Bahan Baku</h1>
          <p className="text-xs text-slate-500 mt-0.5">Riwayat semua pergerakan stok bahan baku (inventory)</p>
        </div>
      </div>

      {/* ─── Summary Cards ─── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        <Card className="bg-white/[0.02] border-white/[0.06]">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-lg bg-slate-500/10 flex items-center justify-center">
                <Activity className="h-3 w-3 text-slate-400" />
              </div>
              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Total</span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-slate-100">{formatNumber(summary.totalMovements)}</p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/[0.06]">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp className="h-3 w-3 text-emerald-400" />
              </div>
              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Stok Masuk</span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-emerald-400">{formatNumber(summary.totalStockIn)}</p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/[0.06]">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <TrendingDown className="h-3 w-3 text-orange-400" />
              </div>
              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Stok Keluar</span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-orange-400">{formatNumber(summary.totalStockOut)}</p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.02] border-white/[0.06]">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <ArrowRightLeft className="h-3 w-3 text-cyan-400" />
              </div>
              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Selisih</span>
            </div>
            <p className={cn(
              "text-lg sm:text-xl font-bold",
              (summary.totalStockIn - summary.totalStockOut) >= 0 ? "text-emerald-400" : "text-red-400"
            )}>
              {formatNumber(summary.totalStockIn - summary.totalStockOut)}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── Filters ─── */}
      <Card className="bg-white/[0.02] border-white/[0.06]">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <Input
                placeholder="Cari nama bahan baku..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="pl-9 h-9 text-xs bg-white/[0.03] border-white/[0.06] text-slate-200 placeholder:text-slate-600"
              />
              {searchInput && (
                <button
                  onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3 w-3 text-slate-500 hover:text-slate-300" />
                </button>
              )}
            </div>
            <Select value={typeFilter || '__all__'} onValueChange={handleTypeChange}>
              <SelectTrigger className="w-full sm:w-44 h-9 text-xs bg-white/[0.03] border-white/[0.06] text-slate-200">
                <SelectValue placeholder="Semua tipe" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-white/[0.06]">
                <SelectItem value="__all__" className="text-slate-200 text-xs">Semua Tipe</SelectItem>
                <SelectItem value="PURCHASE" className="text-slate-200 text-xs">🟢 Restock (PO)</SelectItem>
                <SelectItem value="RESTOCK" className="text-slate-200 text-xs">🟡 Restock Manual</SelectItem>
                <SelectItem value="ADJUSTMENT" className="text-slate-200 text-xs">⚪ Penyesuaian</SelectItem>
                <SelectItem value="CONSUMPTION" className="text-slate-200 text-xs">🔵 Konsumsi Penjualan</SelectItem>
                <SelectItem value="TRANSFER_OUT" className="text-slate-200 text-xs">🟠 Transfer Keluar</SelectItem>
                <SelectItem value="TRANSFER_IN" className="text-slate-200 text-xs">🟣 Transfer Masuk</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSearch}
              className="h-9 text-xs bg-white/[0.03] border-white/[0.06] text-slate-300 hover:bg-white/[0.06]"
            >
              Cari
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Table (Desktop) ─── */}
      <div className="hidden sm:block">
        <Card className="bg-white/[0.02] border-white/[0.06] overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.04] hover:bg-transparent">
                  <TableHead className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider h-10 px-4">Tanggal</TableHead>
                  <TableHead className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider h-10 px-4">Bahan Baku</TableHead>
                  <TableHead className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider h-10 px-4">Tipe</TableHead>
                  <TableHead className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider h-10 px-4 text-right">Qty</TableHead>
                  <TableHead className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider h-10 px-4 text-right">Stok Sebelum</TableHead>
                  <TableHead className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider h-10 px-4 text-right">Stok Sesudah</TableHead>
                  <TableHead className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider h-10 px-4">Referensi</TableHead>
                  <TableHead className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider h-10 px-4">Oleh</TableHead>
                  <TableHead className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider h-10 w-10 px-2"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-white/[0.03] hover:bg-white/[0.01]">
                      <TableCell colSpan={9} className="py-2 px-4">
                        <Skeleton className="h-4 w-full bg-white/[0.03]" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : movements.length === 0 ? (
                  <TableRow className="border-white/[0.03] hover:bg-transparent">
                    <TableCell colSpan={9} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Activity className="h-8 w-8 text-slate-700" />
                        <p className="text-xs text-slate-500">Belum ada log pergerakan stok</p>
                        <p className="text-[10px] text-slate-600">Log akan muncul saat ada restock, penjualan, atau transfer bahan baku</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  movements.map((m) => {
                    const cfg = getMovementConfig(m.type)
                    const isIn = m.quantity > 0
                    return (
                      <TableRow
                        key={m.id}
                        className="border-white/[0.03] hover:bg-white/[0.02] cursor-pointer group"
                        onClick={() => openDetail(m)}
                      >
                        <TableCell className="py-2.5 px-4">
                          <div className="text-xs text-slate-300">{formatDate(m.createdAt)}</div>
                        </TableCell>
                        <TableCell className="py-2.5 px-4">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-slate-200">{m.itemName}</span>
                            {m.itemSku && (
                              <span className="text-[10px] text-slate-500 font-mono">{m.itemSku}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 px-4">
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] px-2 py-0 border", cfg.bgColor, cfg.color, cfg.borderColor)}
                          >
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-right">
                          <div className={cn(
                            "flex items-center justify-end gap-1 text-xs font-semibold",
                            isIn ? "text-emerald-400" : "text-orange-400"
                          )}>
                            {isIn ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )}
                            {formatNumber(Math.abs(m.quantity))} {m.baseUnit}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-right">
                          <span className="text-xs text-slate-400">{formatNumber(m.previousStock)}</span>
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-right">
                          <span className={cn(
                            "text-xs font-medium",
                            m.newStock > m.previousStock ? "text-emerald-400" : m.newStock < m.previousStock ? "text-orange-400" : "text-slate-300"
                          )}>
                            {formatNumber(m.newStock)}
                          </span>
                        </TableCell>
                        <TableCell className="py-2.5 px-4">
                          {m.referenceLabel ? (
                            <span className="text-[10px] text-slate-400 font-mono">{m.referenceLabel}</span>
                          ) : (
                            <span className="text-[10px] text-slate-600">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 px-4">
                          <span className="text-[10px] text-slate-400">{m.userName || 'System'}</span>
                        </TableCell>
                        <TableCell className="py-2.5 px-2">
                          <Eye className="h-3.5 w-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ─── Cards (Mobile) ─── */}
      <div className="sm:hidden space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="bg-white/[0.02] border-white/[0.06]">
              <CardContent className="p-3">
                <Skeleton className="h-4 w-3/4 bg-white/[0.03] mb-2" />
                <Skeleton className="h-3 w-1/2 bg-white/[0.03]" />
              </CardContent>
            </Card>
          ))
        ) : movements.length === 0 ? (
          <Card className="bg-white/[0.02] border-white/[0.06]">
            <CardContent className="py-12 flex flex-col items-center gap-2">
              <Activity className="h-8 w-8 text-slate-700" />
              <p className="text-xs text-slate-500">Belum ada log pergerakan stok</p>
            </CardContent>
          </Card>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-2"
          >
            {movements.map((m) => {
              const cfg = getMovementConfig(m.type)
              const isIn = m.quantity > 0
              const IconComp = cfg.icon
              return (
                <motion.div key={m.id} variants={itemVariants}>
                  <Card
                    className="bg-white/[0.02] border-white/[0.06] cursor-pointer hover:bg-white/[0.03] transition-colors"
                    onClick={() => openDetail(m)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5", cfg.bgColor)}>
                          <IconComp className={cn("h-4 w-4", cfg.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-200 truncate">{m.itemName}</span>
                            <div className={cn(
                              "flex items-center gap-0.5 text-xs font-bold shrink-0",
                              isIn ? "text-emerald-400" : "text-orange-400"
                            )}>
                              {isIn ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                              {formatNumber(Math.abs(m.quantity))} {m.baseUnit}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 border", cfg.bgColor, cfg.color, cfg.borderColor)}>
                              {cfg.label}
                            </Badge>
                            <span className="text-[10px] text-slate-500">
                              {formatNumber(m.previousStock)} → {formatNumber(m.newStock)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[10px] text-slate-500">{formatDate(m.createdAt)}</span>
                            {m.referenceLabel && (
                              <span className="text-[10px] text-slate-400 font-mono">{m.referenceLabel}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </div>

      {/* ─── Pagination ─── */}
      {totalPages > 1 && (
        <div className="flex justify-center pt-2">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* ─── Detail Dialog ─── */}
      <ResponsiveDialog open={detailOpen} onOpenChange={setDetailOpen}>
        <ResponsiveDialogContent className="bg-slate-900 border-white/[0.06] max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-slate-100 text-sm">Detail Pergerakan</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Informasi lengkap log pergerakan stok bahan baku
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {selectedMovement && (
            <div className="space-y-4 mt-2">
              {(() => {
                const cfg = getMovementConfig(selectedMovement.type)
                const isIn = selectedMovement.quantity > 0
                const IconComp = cfg.icon
                return (
                  <>
                    {/* Type indicator */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", cfg.bgColor)}>
                        <IconComp className={cn("h-5 w-5", cfg.color)} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{cfg.label}</p>
                        <p className="text-[10px] text-slate-500">{cfg.description}</p>
                      </div>
                    </div>

                    {/* Item info */}
                    <div className="space-y-2">
                      <h4 className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Bahan Baku</h4>
                      <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                        <p className="text-sm font-medium text-slate-200">{selectedMovement.itemName}</p>
                        {selectedMovement.itemSku && (
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">SKU: {selectedMovement.itemSku}</p>
                        )}
                        {selectedMovement.category && (
                          <Badge variant="outline" className="text-[9px] mt-1.5 px-1.5 py-0 bg-slate-800 border-white/[0.06] text-slate-400">
                            {selectedMovement.category.name}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Stock change */}
                    <div className="space-y-2">
                      <h4 className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Perubahan Stok</h4>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
                          <p className="text-[10px] text-slate-500 mb-1">Sebelum</p>
                          <p className="text-sm font-bold text-slate-300">{formatNumber(selectedMovement.previousStock)}</p>
                        </div>
                        <div className={cn(
                          "p-3 rounded-lg border text-center",
                          isIn ? "bg-emerald-500/5 border-emerald-500/10" : "bg-orange-500/5 border-orange-500/10"
                        )}>
                          <p className="text-[10px] text-slate-500 mb-1">{isIn ? 'Masuk' : 'Keluar'}</p>
                          <p className={cn("text-sm font-bold flex items-center justify-center gap-1", isIn ? "text-emerald-400" : "text-orange-400")}>
                            {isIn ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                            {formatNumber(Math.abs(selectedMovement.quantity))}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-center">
                          <p className="text-[10px] text-slate-500 mb-1">Sesudah</p>
                          <p className={cn("text-sm font-bold", selectedMovement.newStock > selectedMovement.previousStock ? "text-emerald-400" : "text-orange-400")}>
                            {formatNumber(selectedMovement.newStock)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="space-y-2">
                      <h4 className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Informasi</h4>
                      <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] space-y-2">
                        <div className="flex justify-between">
                          <span className="text-[10px] text-slate-500">Waktu</span>
                          <span className="text-[10px] text-slate-300">{formatDate(selectedMovement.createdAt)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-slate-500">Oleh</span>
                          <span className="text-[10px] text-slate-300">{selectedMovement.userName || 'System'}</span>
                        </div>
                        {selectedMovement.referenceLabel && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-slate-500">Referensi</span>
                            <span className="text-[10px] text-slate-300 font-mono">{selectedMovement.referenceLabel}</span>
                          </div>
                        )}
                        {selectedMovement.notes && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-slate-500">Catatan</span>
                            <span className="text-[10px] text-slate-300 text-right max-w-[60%]">{selectedMovement.notes}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-[10px] text-slate-500">ID</span>
                          <span className="text-[9px] text-slate-600 font-mono">{selectedMovement.id.slice(0, 12)}...</span>
                        </div>
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}