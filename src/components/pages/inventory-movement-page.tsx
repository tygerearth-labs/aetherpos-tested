'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { formatNumber, formatDate } from '@/lib/format'
import { motion, AnimatePresence } from 'framer-motion'
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
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from '@/components/ui/responsive-dialog'
import { Pagination } from '@/components/shared/pagination'
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Search,
  Package,
  Info,
  X,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ==================== TYPES ====================
interface InventoryMovementItem {
  id: string
  type: string
  quantity: number
  previousStock: number
  newStock: number
  referenceId: string | null
  referenceType: string | null
  notes: string | null
  createdAt: string
  inventoryItem: {
    id: string
    name: string
    sku: string | null
    baseUnit: string
  }
  user: { id: string; name: string } | null
  referenceLabel: string | null
}

interface MovementListResponse {
  movements: InventoryMovementItem[]
  totalPages: number
  totalMovements: number
  totalStockIn: number
  totalStockOut: number
}

// ==================== MOVEMENT TYPE CONFIG ====================
const MOVEMENT_TYPE_CONFIG: Record<
  string,
  {
    label: string
    color: string
    bgColor: string
    borderColor: string
    leftBorder: string
    dotColor: string
  }
> = {
  RESTOCK: {
    label: 'Restock',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    leftBorder: 'border-l-emerald-500',
    dotColor: 'bg-emerald-500',
  },
  PURCHASE: {
    label: 'Pembelian',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    leftBorder: 'border-l-emerald-500',
    dotColor: 'bg-emerald-500',
  },
  ADJUSTMENT: {
    label: 'Penyesuaian',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    leftBorder: 'border-l-amber-500',
    dotColor: 'bg-amber-500',
  },
  CONSUMPTION: {
    label: 'Konsumsi',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    leftBorder: 'border-l-orange-500',
    dotColor: 'bg-orange-500',
  },
  TRANSFER_OUT: {
    label: 'Transfer Keluar',
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/20',
    leftBorder: 'border-l-rose-500',
    dotColor: 'bg-rose-500',
  },
  TRANSFER_IN: {
    label: 'Transfer Masuk',
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/20',
    leftBorder: 'border-l-sky-500',
    dotColor: 'bg-sky-500',
  },
}

const DEFAULT_TYPE_CONFIG = {
  label: 'Lainnya',
  color: 'text-zinc-400',
  bgColor: 'bg-zinc-500/10',
  borderColor: 'border-zinc-500/20',
  leftBorder: 'border-l-zinc-600',
  dotColor: 'bg-zinc-600',
}

function getTypeConfig(type: string) {
  return MOVEMENT_TYPE_CONFIG[type] || DEFAULT_TYPE_CONFIG
}

// ==================== REFERENCE TYPE LABELS ====================
const REFERENCE_TYPE_LABELS: Record<string, string> = {
  TRANSFER: 'Transfer',
  PURCHASE_ORDER: 'Pembelian',
  MANUAL: 'Manual',
  MIGRATION: 'Migrasi Data',
}

function getReferenceTypeLabel(type: string | null): string {
  if (!type) return '-'
  return REFERENCE_TYPE_LABELS[type] || type
}

// ==================== ANIMATION VARIANTS ====================
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] },
  },
}

// ==================== MOVEMENT TYPE BADGE ====================
function MovementTypeBadge({ type }: { type: string }) {
  const config = getTypeConfig(type)
  return (
    <Badge
      className={cn(
        config.bgColor,
        config.borderColor,
        config.color,
        'text-[10px] gap-1 px-1.5 py-0 border'
      )}
    >
      {config.label}
    </Badge>
  )
}

// ==================== QUANTITY DISPLAY ====================
function QuantityDisplay({
  quantity,
  unit,
}: {
  quantity: number
  unit: string
}) {
  const isPositive = quantity >= 0
  return (
    <span
      className={cn(
        'text-xs font-medium tabular-nums',
        isPositive ? 'text-emerald-400' : 'text-rose-400'
      )}
    >
      {isPositive ? '+' : ''}
      {formatNumber(quantity)} {unit}
    </span>
  )
}

// ==================== MAIN PAGE ====================
export default function InventoryMovementPage() {
  const [movements, setMovements] = useState<InventoryMovementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalMovements, setTotalMovements] = useState(0)
  const [totalStockIn, setTotalStockIn] = useState(0)
  const [totalStockOut, setTotalStockOut] = useState(0)
  const [typeFilter, setTypeFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedMovement, setSelectedMovement] =
    useState<InventoryMovementItem | null>(null)

  const fetchMovements = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      })
      if (typeFilter !== 'ALL') params.set('type', typeFilter)
      if (search) params.set('search', search)

      const res = await fetch(`/api/inventory/movements?${params}`)
      if (res.ok) {
        const data: MovementListResponse = await res.json()
        setMovements(data.movements)
        setTotalPages(data.totalPages)
        setTotalMovements(data.totalMovements)
        setTotalStockIn(data.totalStockIn)
        setTotalStockOut(data.totalStockOut)
      } else {
        toast.error('Gagal memuat log stok item')
      }
    } catch {
      toast.error('Gagal memuat log stok item')
    } finally {
      setLoading(false)
    }
  }, [page, typeFilter, search])

  useEffect(() => {
    void fetchMovements()
  }, [fetchMovements])

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const handleClearSearch = () => {
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleClearAllFilters = () => {
    setTypeFilter('ALL')
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const hasActiveFilters = search || typeFilter !== 'ALL'

  // ==================== LOADING SKELETON ====================
  const LoadingSkeleton = () => (
    <div className="space-y-4">
      {/* Summary cards skeleton */}
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-20 bg-zinc-900/50 rounded-xl"
          />
        ))}
      </div>
      {/* Filter skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1 bg-zinc-900/50 rounded-lg" />
        <Skeleton className="h-9 w-40 bg-zinc-900/50 rounded-lg" />
      </div>
      {/* Table skeleton */}
      <div className="hidden md:block">
        <Skeleton className="h-80 bg-zinc-900/50 rounded-xl" />
      </div>
      <div className="md:hidden space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-28 bg-zinc-900/50 rounded-xl"
          />
        ))}
      </div>
    </div>
  )

  return (
    <motion.div
      className="space-y-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* ── Page Header ── */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2"
      >
        <div>
          <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-400" />
            Log Stok Item
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Riwayat pergerakan stok item
          </p>
        </div>
      </motion.div>

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* ── Summary Cards ── */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-3 gap-3"
          >
            {/* Total Pergerakan */}
            <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Activity className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                  Pergerakan
                </span>
              </div>
              <p className="text-lg font-bold text-zinc-100 tabular-nums">
                {formatNumber(totalMovements)}
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5">total pergerakan</p>
            </div>

            {/* Stok Masuk */}
            <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center">
                  <ArrowDownToLine className="h-3.5 w-3.5 text-sky-400" />
                </div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                  Masuk
                </span>
              </div>
              <p className="text-lg font-bold text-emerald-400 tabular-nums">
                +{formatNumber(totalStockIn)}
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5">total stok masuk</p>
            </div>

            {/* Stok Keluar */}
            <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center">
                  <ArrowUpFromLine className="h-3.5 w-3.5 text-rose-400" />
                </div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                  Keluar
                </span>
              </div>
              <p className="text-lg font-bold text-rose-400 tabular-nums">
                -{formatNumber(totalStockOut)}
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5">total stok keluar</p>
            </div>
          </motion.div>

          {/* ── Filters Row ── */}
          <motion.div
            variants={itemVariants}
            className="flex flex-col sm:flex-row gap-2"
          >
            {/* Search input */}
            <div className="relative flex-1 min-w-0 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
              <Input
                type="text"
                placeholder="Cari nama item..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-8 pr-8 bg-white/[0.04] border-white/[0.08] text-zinc-100 h-9 text-xs placeholder:text-zinc-500"
              />
              {searchInput && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Movement type filter */}
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full sm:w-40 bg-white/[0.04] border-white/[0.08] text-zinc-100 h-9 text-xs">
                <SelectValue placeholder="Semua Tipe" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800/60">
                <SelectItem
                  value="ALL"
                  className="text-zinc-200 focus:bg-zinc-800 text-xs"
                >
                  Semua Tipe
                </SelectItem>
                {Object.entries(MOVEMENT_TYPE_CONFIG).map(
                  ([key, config]) => (
                    <SelectItem
                      key={key}
                      value={key}
                      className="text-zinc-200 focus:bg-zinc-800 text-xs"
                    >
                      {config.label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            {/* Clear all filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                className="h-9 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] shrink-0"
                onClick={handleClearAllFilters}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Reset
              </Button>
            )}
          </motion.div>

          {/* ── Active filter badges ── */}
          {hasActiveFilters && (
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap gap-1.5"
            >
              {search && (
                <Badge
                  variant="outline"
                  className="bg-white/[0.04] border-white/[0.08] text-zinc-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer"
                >
                  Cari: &quot;{search}&quot;
                  <button
                    onClick={() => {
                      setSearchInput('')
                      setSearch('')
                      setPage(1)
                    }}
                  >
                    <X className="h-2.5 w-2.5 ml-0.5" />
                  </button>
                </Badge>
              )}
              {typeFilter !== 'ALL' && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[11px] gap-1 px-2 py-0.5 cursor-pointer',
                    getTypeConfig(typeFilter).bgColor,
                    getTypeConfig(typeFilter).borderColor,
                    getTypeConfig(typeFilter).color
                  )}
                >
                  {getTypeConfig(typeFilter).label}
                  <button
                    onClick={() => {
                      setTypeFilter('ALL')
                      setPage(1)
                    }}
                  >
                    <X className="h-2.5 w-2.5 ml-0.5" />
                  </button>
                </Badge>
              )}
            </motion.div>
          )}

          {/* ── Content Area ── */}
          {movements.length === 0 ? (
            <motion.div
              variants={itemVariants}
              className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-8 text-center"
            >
              <Package className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-xs text-zinc-500">
                {hasActiveFilters
                  ? 'Tidak ada pergerakan yang cocok dengan filter'
                  : 'Belum ada pergerakan stok'}
              </p>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAllFilters}
                  className="mt-3 text-zinc-500 hover:text-zinc-300 text-xs h-7"
                >
                  Reset semua filter
                </Button>
              )}
            </motion.div>
          ) : (
            <motion.div variants={itemVariants}>
              {/* ── Desktop Table ── */}
              <div className="hidden md:block bg-zinc-900/30 border border-zinc-800/60 rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800/60 hover:bg-transparent bg-zinc-900/50">
                      <TableHead className="text-zinc-500 text-[11px] font-medium w-10" />
                      <TableHead className="text-zinc-500 text-[11px] font-medium">
                        Tanggal
                      </TableHead>
                      <TableHead className="text-zinc-500 text-[11px] font-medium">
                        Item
                      </TableHead>
                      <TableHead className="text-zinc-500 text-[11px] font-medium text-center">
                        Tipe
                      </TableHead>
                      <TableHead className="text-zinc-500 text-[11px] font-medium text-right">
                        Qty
                      </TableHead>
                      <TableHead className="text-zinc-500 text-[11px] font-medium text-right">
                        Stok Sebelum
                      </TableHead>
                      <TableHead className="text-zinc-500 text-[11px] font-medium text-right">
                        Stok Sesudah
                      </TableHead>
                      <TableHead className="text-zinc-500 text-[11px] font-medium">
                        Referensi
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <AnimatePresence mode="popLayout">
                      {movements.map((movement) => {
                        const config = getTypeConfig(movement.type)
                        return (
                          <motion.tr
                            key={movement.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.2 }}
                            className={cn(
                              'border-zinc-800/40 transition-colors border-l-2',
                              config.leftBorder,
                              'cursor-pointer hover:bg-white/[0.02]'
                            )}
                            onClick={() => setSelectedMovement(movement)}
                          >
                            {/* Dot indicator */}
                            <TableCell className="py-3 px-3">
                              <div
                                className={cn(
                                  'w-2 h-2 rounded-full',
                                  config.dotColor
                                )}
                              />
                            </TableCell>
                            {/* Tanggal */}
                            <TableCell className="text-xs text-zinc-400 py-3 px-3 whitespace-nowrap">
                              {formatDate(movement.createdAt)}
                            </TableCell>
                            {/* Item */}
                            <TableCell className="text-xs py-3 px-3">
                              <span className="text-zinc-100 font-medium">
                                {movement.inventoryItem.name}
                              </span>
                              <span className="text-zinc-500 ml-1.5 text-[10px]">
                                {movement.inventoryItem.baseUnit}
                              </span>
                            </TableCell>
                            {/* Tipe */}
                            <TableCell className="text-center py-3 px-3">
                              <MovementTypeBadge type={movement.type} />
                            </TableCell>
                            {/* Qty */}
                            <TableCell className="text-right py-3 px-3">
                              <QuantityDisplay
                                quantity={movement.quantity}
                                unit={movement.inventoryItem.baseUnit}
                              />
                            </TableCell>
                            {/* Stok Sebelum */}
                            <TableCell className="text-right text-xs text-zinc-500 py-3 px-3 tabular-nums">
                              {formatNumber(movement.previousStock)}
                            </TableCell>
                            {/* Stok Sesudah */}
                            <TableCell className="text-right text-xs text-zinc-300 py-3 px-3 tabular-nums">
                              {formatNumber(movement.newStock)}
                            </TableCell>
                            {/* Referensi */}
                            <TableCell className="text-xs text-zinc-500 py-3 px-3">
                              {movement.referenceLabel || '-'}
                            </TableCell>
                          </motion.tr>
                        )
                      })}
                    </AnimatePresence>
                  </TableBody>
                </Table>
              </div>

              {/* ── Mobile Cards ── */}
              <div className="md:hidden space-y-2">
                <AnimatePresence mode="popLayout">
                  {movements.map((movement) => {
                    const config = getTypeConfig(movement.type)
                    return (
                      <motion.div
                        key={movement.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.2 }}
                        className={cn(
                          'rounded-xl border-l-4',
                          config.leftBorder,
                          'border border-zinc-800/60 bg-zinc-900/50 p-3.5 transition-colors cursor-pointer hover:bg-zinc-900/80'
                        )}
                        onClick={() => setSelectedMovement(movement)}
                      >
                        {/* Top row: item name + unit badge */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-100 truncate">
                              {movement.inventoryItem.name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Badge
                                variant="outline"
                                className="bg-white/[0.04] border-white/[0.08] text-zinc-500 text-[10px] px-1.5 py-0"
                              >
                                {movement.inventoryItem.baseUnit}
                              </Badge>
                              {movement.inventoryItem.sku && (
                                <span className="text-[10px] text-zinc-600 font-mono">
                                  {movement.inventoryItem.sku}
                                </span>
                              )}
                            </div>
                          </div>
                          <MovementTypeBadge type={movement.type} />
                        </div>

                        {/* Date */}
                        <p className="text-[10px] text-zinc-500 mb-2">
                          {formatDate(movement.createdAt)}
                        </p>

                        {/* Quantity change (prominent) */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] text-zinc-500">
                            Perubahan
                          </span>
                          <QuantityDisplay
                            quantity={movement.quantity}
                            unit={movement.inventoryItem.baseUnit}
                          />
                        </div>

                        {/* Stock transition */}
                        <div className="flex items-center justify-center gap-2 py-1.5 rounded-lg bg-zinc-800/30 mb-2">
                          <span className="text-xs text-zinc-500 tabular-nums">
                            {formatNumber(movement.previousStock)}
                          </span>
                          <span className="text-zinc-600 text-xs">→</span>
                          <span className="text-xs text-zinc-100 font-medium tabular-nums">
                            {formatNumber(movement.newStock)}
                          </span>
                        </div>

                        {/* Reference */}
                        {movement.referenceLabel && (
                          <p className="text-[10px] text-zinc-500">
                            <span className="text-zinc-600">Ref:</span>{' '}
                            {movement.referenceLabel}
                          </p>
                        )}
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* ── Pagination ── */}
          <motion.div variants={itemVariants}>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </motion.div>
        </>
      )}

      {/* ── Detail Dialog ── */}
      <ResponsiveDialog
        open={!!selectedMovement}
        onOpenChange={(open) => {
          if (!open) setSelectedMovement(null)
        }}
      >
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800/60 max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-zinc-100 text-sm font-semibold">
              Detail Pergerakan Stok
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-zinc-500 text-xs">
              Informasi lengkap pergerakan item
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {selectedMovement && (
            <div className="space-y-4 mt-2">
              {/* Item info */}
              <div className="bg-zinc-800/30 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-100 truncate">
                      {selectedMovement.inventoryItem.name}
                    </p>
                    {selectedMovement.inventoryItem.sku && (
                      <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                        SKU: {selectedMovement.inventoryItem.sku}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className="bg-white/[0.04] border-white/[0.08] text-zinc-400 text-[10px] px-1.5 py-0 shrink-0"
                  >
                    {selectedMovement.inventoryItem.baseUnit}
                  </Badge>
                </div>
              </div>

              {/* Movement type & date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1">Tipe</p>
                  <MovementTypeBadge type={selectedMovement.type} />
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1">Tanggal</p>
                  <p className="text-xs text-zinc-300">
                    {formatDate(selectedMovement.createdAt)}
                  </p>
                </div>
              </div>

              {/* Quantity change (big, prominent) */}
              <div className="flex items-center justify-center py-3 rounded-lg bg-zinc-800/30">
                <span
                  className={cn(
                    'text-xl font-bold tabular-nums',
                    selectedMovement.quantity >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  )}
                >
                  {selectedMovement.quantity >= 0 ? '+' : ''}
                  {formatNumber(selectedMovement.quantity)}
                </span>
                <span className="text-sm text-zinc-400 ml-1.5">
                  {selectedMovement.inventoryItem.baseUnit}
                </span>
              </div>

              {/* Stock transition */}
              <div className="grid grid-cols-3 gap-2 items-center text-center">
                <div>
                  <p className="text-[10px] text-zinc-500 mb-0.5">
                    Stok Sebelum
                  </p>
                  <p className="text-sm text-zinc-400 tabular-nums">
                    {formatNumber(selectedMovement.previousStock)}
                  </p>
                </div>
                <div className="flex justify-center">
                  <div className="w-6 h-6 rounded-full bg-zinc-800/60 flex items-center justify-center">
                    <span className="text-zinc-500 text-xs">→</span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 mb-0.5">
                    Stok Sesudah
                  </p>
                  <p className="text-sm font-medium text-zinc-100 tabular-nums">
                    {formatNumber(selectedMovement.newStock)}
                  </p>
                </div>
              </div>

              {/* Reference info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1">
                    Tipe Referensi
                  </p>
                  <p className="text-xs text-zinc-300">
                    {getReferenceTypeLabel(
                      selectedMovement.referenceType
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1">
                    Label Referensi
                  </p>
                  <p className="text-xs text-zinc-300">
                    {selectedMovement.referenceLabel || '-'}
                  </p>
                </div>
              </div>

              {/* Notes */}
              {selectedMovement.notes && (
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1">Catatan</p>
                  <p className="text-xs text-zinc-300">
                    {selectedMovement.notes}
                  </p>
                </div>
              )}

              {/* User */}
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">
                  Dilakukan oleh
                </p>
                <p className="text-xs text-zinc-300">
                  {selectedMovement.user?.name || 'System'}
                </p>
              </div>
            </div>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </motion.div>
  )
}