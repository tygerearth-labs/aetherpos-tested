'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { formatDate, formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Separator } from '@/components/ui/separator'
import { Pagination } from '@/components/shared/pagination'
import { DateFilter } from '@/components/shared/date-filter'
import {
  Search,
  Download,
  X,
  Plus,
  Package,
  ShoppingCart,
  SlidersHorizontal,
  Pencil,
  Ban,
  RotateCcw,
} from 'lucide-react'

// ==================== TYPES ====================
interface AuditLog {
  id: string
  action: string
  entityType: string
  entityId?: string | null
  details?: string | null
  createdAt: string
  user?: {
    name: string
    email: string
  }
}

interface AuditLogListResponse {
  logs: AuditLog[]
  totalPages: number
}

// ==================== ACTION TYPE CONFIG ====================
const ACTION_CONFIG: Record<string, {
  label: string
  icon: React.ElementType
  color: string       // text color
  bgColor: string     // badge background
  borderColor: string  // badge border
  iconBg: string      // icon background
  leftBorder: string  // left border color for cards
  dotColor: string    // dot indicator
}> = {
  CREATE: {
    label: 'Dibuat',
    icon: Plus,
    color: 'theme-text',
    bgColor: 'theme-bg-very-light',
    borderColor: 'theme-border-light',
    iconBg: 'theme-bg-very-light',
    leftBorder: 'theme-border',
    dotColor: 'theme-bg',
  },
  SALE: {
    label: 'Penjualan',
    icon: ShoppingCart,
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/20',
    iconBg: 'bg-sky-500/10',
    leftBorder: 'border-l-sky-500',
    dotColor: 'bg-sky-500',
  },
  RESTOCK: {
    label: 'Restock',
    icon: Package,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    iconBg: 'bg-amber-500/10',
    leftBorder: 'border-l-amber-500',
    dotColor: 'bg-amber-500',
  },
  ADJUSTMENT: {
    label: 'Penyesuaian',
    icon: SlidersHorizontal,
    color: 'text-zinc-300',
    bgColor: 'bg-zinc-500/10',
    borderColor: 'border-zinc-500/20',
    iconBg: 'bg-zinc-500/10',
    leftBorder: 'border-l-zinc-400',
    dotColor: 'bg-zinc-400',
  },
  UPDATE: {
    label: 'Diperbarui',
    icon: Pencil,
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/20',
    iconBg: 'bg-violet-500/10',
    leftBorder: 'border-l-violet-500',
    dotColor: 'bg-violet-500',
  },
  BULK_UPDATE: {
    label: 'Mass Edit',
    icon: SlidersHorizontal,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    iconBg: 'bg-orange-500/10',
    leftBorder: 'border-l-orange-500',
    dotColor: 'bg-orange-500',
  },
  DELETE: {
    label: 'Dihapus',
    icon: Ban,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    iconBg: 'bg-red-500/10',
    leftBorder: 'border-l-red-500',
    dotColor: 'bg-red-500',
  },
  VARIANT: {
    label: 'Varian',
    icon: Pencil,
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/20',
    iconBg: 'bg-violet-500/10',
    leftBorder: 'border-l-violet-500',
    dotColor: 'bg-violet-500',
  },
}

const DEFAULT_ACTION = {
  label: 'Lainnya',
  icon: RotateCcw,
  color: 'text-zinc-400',
  bgColor: 'bg-zinc-500/10',
  borderColor: 'border-zinc-500/20',
  iconBg: 'bg-zinc-500/10',
  leftBorder: 'border-l-zinc-600',
  dotColor: 'bg-zinc-600',
}

function getActionConfig(action: string) {
  return ACTION_CONFIG[action] || DEFAULT_ACTION
}

// ==================== ENTITY TYPE CONFIG ====================
const ENTITY_LABELS: Record<string, string> = {
  PRODUCT: 'Produk',
  CATEGORY: 'Kategori',
  CUSTOMER: 'Customer',
  TRANSACTION: 'Transaksi',
  USER: 'User/Crew',
  PROMO: 'Promo',
  OUTLET: 'Outlet',
  SETTINGS: 'Pengaturan',
  STOCK: 'Stok',
  VARIANT: 'Varian',
}

function getEntityLabel(type: string): string {
  return ENTITY_LABELS[type] || type
}

// ==================== DETAIL KEY LABELS ====================
const DETAIL_LABELS: Record<string, string> = {
  name: 'Nama',
  productName: 'Produk',
  customerName: 'Nama Customer',
  price: 'Harga',
  stock: 'Stok',
  previousStock: 'Stok Sebelum',
  newStock: 'Stok Baru',
  quantityAdded: 'Jumlah Ditambah',
  quantityDecreased: 'Jumlah Berkurang',
  invoiceNumber: 'Invoice',
  total: 'Total',
  reason: 'Alasan',
  voidedBy: 'Dibatalkan oleh',
  voidedAt: 'Waktu Void',
  whatsapp: 'WhatsApp',
  sku: 'SKU',
  hpp: 'HPP',
  itemsRestored: 'Item Dikembalikan',
  description: 'Deskripsi',
  outletName: 'Nama Outlet',
  outletAddress: 'Alamat',
  outletPhone: 'Telepon',
  variantName: 'Nama Varian',
  variantId: 'ID Varian',
  hasVariants: 'Punya Varian',
  bulkUpload: 'Upload Massal',
  created: 'Dibuat',
  skipped: 'Dilewati',
  fileName: 'Nama File',
  variantCount: 'Jumlah Varian',
  ppnEnabled: 'PPN Aktif',
  ppnRate: 'Tarif PPN',
  batchOperation: 'Operasi Batch',
  changes: 'Perubahan',
  quantitySold: 'Jumlah Terjual',
}

function getDetailLabel(key: string): string {
  return DETAIL_LABELS[key] || key
}

// ==================== DETAIL PARSING ====================
function parseDetails(details: string | null): Record<string, unknown> | string | null {
  if (!details) return null
  try {
    return JSON.parse(details)
  } catch {
    return details
  }
}

function formatDetailValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') {
    // Currency-like values
    if (['price', 'total', 'hpp', 'discount', 'subtotal', 'paidAmount', 'change', 'taxAmount'].includes(key)) {
      return formatCurrency(value)
    }
    if (['stock', 'previousStock', 'newStock', 'quantityAdded', 'quantityDecreased', 'qty', 'quantitySold'].includes(key)) {
      return `${value} unit`
    }
    if (key === 'points') {
      return `${value} poin`
    }
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak'
  if (Array.isArray(value)) {
    // For itemsRestored array
    if (key === 'itemsRestored') {
      return value
        .map((item: Record<string, unknown>) => {
          const name = typeof item.productName === 'string' ? item.productName : '?'
          const qty = typeof item.qty === 'number' ? item.qty : '?'
          return `${name} (x${qty})`
        })
        .join(', ')
    }
    return JSON.stringify(value)
  }
  return String(value)
}

// ==================== DETAIL DISPLAY COMPONENT ====================
function DetailsDisplay({ action, details }: { action: string; details: string | null }) {
  const parsed = parseDetails(details)
  if (!parsed) return <span className="text-slate-500 italic">-</span>

  if (typeof parsed === 'string') {
    return <span className="text-slate-400">{parsed}</span>
  }

  const entries = Object.entries(parsed) as [string, unknown][]

  // Sort detail keys for better display based on action type
  const priorityKeys: Record<string, string[]> = {
    SALE: ['invoiceNumber', 'productName', 'variantName', 'quantitySold', 'previousStock', 'newStock'],
    RESTOCK: ['reason', 'productName', 'quantityAdded', 'newStock'],
    VOID: ['invoiceNumber', 'total', 'reason', 'voidedBy', 'itemsRestored'],
    ADJUSTMENT: ['productName', 'previousStock', 'newStock', 'reason'],
    CREATE: ['name', 'productName', 'variantName', 'customerName', 'outletName', 'price', 'stock', 'bulkUpload', 'created', 'skipped'],
    UPDATE: ['name', 'productName', 'variantName', 'outletName', 'outletAddress', 'outletPhone', 'price', 'stock', 'ppnEnabled', 'ppnRate', 'hasVariants', 'variantCount'],
    BULK_UPDATE: ['productName', 'changes', 'batchOperation'],
    DELETE: ['productName', 'variantName', 'price', 'stock', 'variantCount'],
    VARIANT: ['productName', 'variantName', 'name', 'price', 'stock', 'changes'],
  }

  const sortedKeys = priorityKeys[action]
    ? [...priorityKeys[action], ...entries.filter(([k]) => !(priorityKeys[action] || []).includes(k)).map(([k]) => k)]
    : entries.map(([k]) => k)

  // Deduplicate
  const uniqueKeys = [...new Set(sortedKeys)]

  return (
    <div className="space-y-1">
      {uniqueKeys.slice(0, 5).map((key) => {
        const value = parsed[key]
        if (value === undefined || value === null) return null
        const formatted = formatDetailValue(key, value)

        // For itemsRestored, show as a separate block
        if (key === 'itemsRestored' && Array.isArray(value) && value.length > 0) {
          return (
            <div key={key} className="space-y-0.5">
              <span className="text-slate-500 text-[10px]">{getDetailLabel(key)}:</span>
              <div className="text-slate-400 text-[11px]">{formatted}</div>
            </div>
          )
        }

        return (
          <div key={key} className="flex items-center gap-1.5 leading-tight">
            <span className="text-slate-500 text-[10px] shrink-0">{getDetailLabel(key)}:</span>
            <span className="text-slate-300 text-[11px] truncate">{formatted}</span>
          </div>
        )
      })}
      {uniqueKeys.length > 5 && (
        <span className="text-slate-500 text-[10px]">+{uniqueKeys.length - 5} lainnya</span>
      )}
    </div>
  )
}

// ==================== MAIN PAGE ====================
export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [actionFilter, setActionFilter] = useState<string>('ALL')
  const [entityFilter, setEntityFilter] = useState<string>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (actionFilter !== 'ALL') params.set('action', actionFilter)
      if (entityFilter !== 'ALL') params.set('entityType', entityFilter)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)
      if (search) params.set('search', search)
      const res = await fetch(`/api/audit-logs?${params}`)
      if (res.ok) {
        const data: AuditLogListResponse = await res.json()
        setLogs(data.logs)
        setTotalPages(data.totalPages)
      } else {
        toast.error('Gagal memuat audit log')
      }
    } catch {
      toast.error('Gagal memuat audit log')
    } finally {
      setLoading(false)
    }
  }, [page, actionFilter, entityFilter, dateFrom, dateTo, search])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchLogs()
  }, [fetchLogs])

  const handleFilter = () => {
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
      handleFilter()
    }
  }

  const handleClearAllFilters = () => {
    setActionFilter('ALL')
    setEntityFilter('ALL')
    setDateFrom('')
    setDateTo('')
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const handleExport = () => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (actionFilter !== 'ALL') params.set('action', actionFilter)
    if (entityFilter !== 'ALL') params.set('entityType', entityFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    window.open(`/api/audit-logs/export?${params}`, '_blank')
  }

  const hasActiveFilters = search || actionFilter !== 'ALL' || entityFilter !== 'ALL' || dateFrom || dateTo

  // ==================== ACTION BADGE ====================
  const ActionBadge = ({ action }: { action: string }) => {
    const config = getActionConfig(action)
    const Icon = config.icon
    return (
      <Badge className={`${config.bgColor} ${config.borderColor} ${config.color} text-[10px] gap-1 px-1.5 py-0`}>
        <Icon className="h-2.5 w-2.5" />
        {config.label}
      </Badge>
    )
  }

  // ==================== ACTION ICON ====================
  const ActionIcon = ({ action }: { action: string }) => {
    const config = getActionConfig(action)
    const Icon = config.icon
    return (
      <div className={`w-7 h-7 rounded-lg ${config.iconBg} flex items-center justify-center shrink-0`}>
        <Icon className={`h-3.5 w-3.5 ${config.color}`} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-white">Audit Log</h1>
          <p className="text-xs text-slate-500 mt-0.5">Lacak semua aktivitas dan perubahan sistem</p>
        </div>
        <Button
          onClick={handleExport}
          variant="outline"
          className="h-9 sm:h-8 text-xs bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-0 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
          <Input
            type="text"
            placeholder="Cari nama, invoice, SKU..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-8 pr-8 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs placeholder:text-slate-500"
          />
          {searchInput && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Action type filter */}
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-40 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs">
            <SelectValue placeholder="Semua Aksi" />
          </SelectTrigger>
          <SelectContent className="bg-white/[0.04] border-white/[0.08]">
            <SelectItem value="ALL" className="text-slate-200 focus:bg-white/[0.06] text-xs">Semua Aksi</SelectItem>
            {Object.entries(ACTION_CONFIG).map(([key, config]) => (
              <SelectItem key={key} value={key} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Entity type filter */}
        <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-36 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs">
            <SelectValue placeholder="Semua Entitas" />
          </SelectTrigger>
          <SelectContent className="bg-white/[0.04] border-white/[0.08]">
            <SelectItem value="ALL" className="text-slate-200 focus:bg-white/[0.06] text-xs">Semua Entitas</SelectItem>
            {Object.entries(ENTITY_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date range */}
        <DateFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); setPage(1) }}
        />

        {/* Clear all */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            className="h-8 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] shrink-0"
            onClick={handleClearAllFilters}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Reset
          </Button>
        )}
      </div>

      {/* Active filter badges */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5">
          {search && (
            <Badge variant="outline" className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer">
              Cari: &quot;{search}&quot;
              <button onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }}>
                <X className="h-2.5 w-2.5 ml-0.5" />
              </button>
            </Badge>
          )}
          {actionFilter !== 'ALL' && (
            <Badge variant="outline" className={`${ACTION_CONFIG[actionFilter]?.bgColor || ''} ${ACTION_CONFIG[actionFilter]?.borderColor || ''} ${ACTION_CONFIG[actionFilter]?.color || ''} text-[11px] gap-1 px-2 py-0.5 cursor-pointer`}>
              {getActionConfig(actionFilter).label}
              <button onClick={() => { setActionFilter('ALL'); setPage(1) }}>
                <X className="h-2.5 w-2.5 ml-0.5" />
              </button>
            </Badge>
          )}
          {entityFilter !== 'ALL' && (
            <Badge variant="outline" className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer">
              {getEntityLabel(entityFilter)}
              <button onClick={() => { setEntityFilter('ALL'); setPage(1) }}>
                <X className="h-2.5 w-2.5 ml-0.5" />
              </button>
            </Badge>
          )}
          {dateFrom && (
            <Badge variant="outline" className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer">
              📅 {dateFrom}{dateTo && dateTo !== dateFrom ? ` – ${dateTo}` : ''}
              <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}>
                <X className="h-2.5 w-2.5 ml-0.5" />
              </button>
            </Badge>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 bg-nebula rounded-xl" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-nebula p-8 text-center">
          <Search className="h-8 w-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-xs text-slate-500">
            {hasActiveFilters ? 'Tidak ada audit log yang cocok dengan filter' : 'Belum ada audit log'}
          </p>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAllFilters}
              className="mt-3 text-slate-500 hover:text-slate-300 text-xs h-7"
            >
              Reset semua filter
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Mobile card view */}
          <div className="md:hidden space-y-2">
            {logs.map((log) => {
              const config = getActionConfig(log.action)
              return (
                <div
                  key={log.id}
                  className={`rounded-xl border-l-4 ${config.leftBorder} border border-white/[0.06] bg-nebula p-3.5 transition-colors cursor-pointer hover:bg-white/[0.03]`}
                  onClick={() => setDetailLog(log)}
                >
                  {/* Top row: icon + action + entity + time */}
                  <div className="flex items-center gap-2.5 mb-2">
                    <ActionIcon action={log.action} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <ActionBadge action={log.action} />
                        <Badge variant="outline" className="bg-white/[0.04] border-white/[0.08] text-slate-400 text-[10px] px-1.5 py-0">
                          {getEntityLabel(log.entityType)}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(log.createdAt)}</p>
                    </div>
                  </div>

                  {/* User */}
                  <p className="text-xs text-slate-300 mb-1.5">
                    <span className="text-slate-500">oleh</span>{' '}
                    {log.user?.name || 'System'}
                  </p>

                  {/* Details */}
                  <div className="pl-0">
                    <DetailsDisplay action={log.action} details={log.details} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block rounded-xl border border-white/[0.06] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent bg-nebula/50">
                  <TableHead className="text-slate-500 text-[11px] font-medium w-10"></TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Waktu</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">User</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-center">Aksi</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Entitas</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const config = getActionConfig(log.action)
                  return (
                    <TableRow
                      key={log.id}
                      className={`border-white/[0.06] transition-colors border-l-2 ${config.leftBorder} cursor-pointer hover:bg-white/[0.02]`}
                      onClick={() => setDetailLog(log)}
                    >
                      {/* Action indicator dot */}
                      <TableCell className="py-3 px-3">
                        <div className={`w-2 h-2 rounded-full ${config.dotColor}`} />
                      </TableCell>
                      {/* Timestamp */}
                      <TableCell className="text-xs text-slate-400 py-3 px-3 whitespace-nowrap">
                        {formatDate(log.createdAt)}
                      </TableCell>
                      {/* User */}
                      <TableCell className="text-xs text-slate-300 py-3 px-3">
                        {log.user?.name || 'System'}
                      </TableCell>
                      {/* Action badge */}
                      <TableCell className="text-center py-3 px-3">
                        <ActionBadge action={log.action} />
                      </TableCell>
                      {/* Entity type */}
                      <TableCell className="text-xs text-slate-400 py-3 px-3">
                        <Badge variant="outline" className="bg-white/[0.04] border-white/[0.08] text-slate-400 text-[10px] px-1.5 py-0">
                          {getEntityLabel(log.entityType)}
                        </Badge>
                      </TableCell>
                      {/* Details */}
                      <TableCell className="text-xs text-slate-400 py-3 px-3 max-w-xs">
                        <DetailsDisplay action={log.action} details={log.details} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      <ResponsiveDialog open={!!detailLog} onOpenChange={(open) => { if (!open) setDetailLog(null) }}>
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">Detail Audit Log</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {detailLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-slate-500">Waktu</p>
                  <p className="text-xs text-slate-300">{formatDate(detailLog.createdAt)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">User</p>
                  <p className="text-xs text-slate-300">{detailLog.user?.name || 'System'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Aksi</p>
                  <div className="mt-0.5"><ActionBadge action={detailLog.action} /></div>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Entitas</p>
                  <Badge variant="outline" className="bg-white/[0.04] border-white/[0.08] text-slate-400 text-[10px] px-1.5 py-0 mt-0.5">
                    {getEntityLabel(detailLog.entityType)}
                  </Badge>
                </div>
                {detailLog.entityId && (
                  <div className="col-span-2">
                    <p className="text-[10px] text-slate-500">Entity ID</p>
                    <p className="text-[10px] text-slate-400 font-mono break-all">{detailLog.entityId}</p>
                  </div>
                )}
              </div>
              <Separator className="bg-white/[0.06]" />
              <div>
                <p className="text-xs text-slate-400 mb-2 font-medium">Detail Lengkap</p>
                {(() => {
                  const parsed = parseDetails(detailLog.details)
                  if (!parsed) return <p className="text-xs text-slate-500 italic">Tidak ada detail</p>
                  if (typeof parsed === 'string') return <p className="text-xs text-slate-300">{parsed}</p>
                  const entries = Object.entries(parsed) as [string, unknown][]
                  return (
                    <div className="space-y-2">
                      {entries.map(([key, value]) => (
                        <div key={key} className="flex items-start gap-2">
                          <span className="text-[10px] text-slate-500 min-w-[100px] shrink-0 pt-0.5">{getDetailLabel(key)}</span>
                          <span className="text-xs text-slate-300 break-all">
                            {key === 'itemsRestored' && Array.isArray(value)
                              ? (value as Record<string, unknown>[]).map((item, i) => {
                                  const name = typeof item.productName === 'string' ? item.productName : '?'
                                  const qty = typeof item.qty === 'number' ? item.qty : '?'
                                  return <span key={i}>{name} (x{qty}){i < (value as unknown[]).length - 1 ? ', ' : ''}</span>
                                })
                              : formatDetailValue(key, value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}
