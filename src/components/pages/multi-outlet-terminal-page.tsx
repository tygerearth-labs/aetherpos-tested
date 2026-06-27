'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber } from '@/lib/format'
import { motion, AnimatePresence } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  Building2,
  TrendingUp,
  TrendingDown,
  Receipt,
  Package,
  Store,
  Banknote,
  ShoppingCart,
  UserCircle,
  Layers,
  Users,
  Hash,
  Box,
  Search,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  Phone,
  MapPin,
  X,
} from 'lucide-react'

// ── Types ──
interface OutletSummary {
  id: string
  name: string
  isMain: boolean
  address?: string
  phone?: string
  accountType: string
  managerName: string
  revenue: number
  brutto: number
  discount: number
  tax: number
  transactions: number
  yesterdayRevenue: number
  revenueChangePercent: number
  totalProducts: number
  totalStock: number
  totalCustomers: number
}

interface GroupTotals {
  totalRevenue: number
  totalTransactions: number
  totalProducts: number
  totalStock: number
  totalCustomers: number
  totalBrutto: number
  totalDiscount: number
  totalTax: number
}

interface DrillDownOutlet {
  id: string
  name: string
  isMain: boolean
  address?: string
  phone?: string
  revenue: number
  transactions: number
  customers: number
  products: number
  totalStock: number
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

type DateFilter = 'today' | '7days' | '30days'
type DetailTab = 'transactions' | 'customers' | 'products'

const dateFilterConfig: Record<DateFilter, { label: string; param: string }> = {
  today: { label: 'Hari ini', param: 'today' },
  '7days': { label: '7 Hari', param: '7days' },
  '30days': { label: '30 Hari', param: '30days' },
}

const tabConfig: Record<DetailTab, { label: string; icon: React.ReactNode }> = {
  transactions: { label: 'Transaksi', icon: <Receipt className="h-3.5 w-3.5" /> },
  customers: { label: 'Customer', icon: <Users className="h-3.5 w-3.5" /> },
  products: { label: 'Produk', icon: <Package className="h-3.5 w-3.5" /> },
}

// ── Animation variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
}
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] } },
}
const dialogVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, scale: 0.96, y: 20, transition: { duration: 0.15 } },
}

// ── Summary Stat Card ──
function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  color: string
}) {
  return (
    <Card className="bg-nebula border-white/[0.06]">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', color)}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] sm:text-[11px] text-slate-500 uppercase tracking-wider font-medium truncate">{label}</p>
            <p className="text-sm sm:text-base font-bold text-white truncate">{value}</p>
            {sub && <p className="text-[10px] text-slate-500 truncate">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Change Badge ──
function ChangeBadge({ percent }: { percent: number }) {
  if (percent === 0) return null
  const isUp = percent > 0
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-px rounded',
      isUp ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
    )}>
      {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {Math.abs(percent)}%
    </span>
  )
}

// ── Outlet Detail Dialog ──
function OutletDetailDialog({
  outlet,
  period,
  open,
  onClose,
}: {
  outlet: OutletSummary
  period: DateFilter
  open: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('transactions')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<unknown[]>([])
  const [outletInfo, setOutletInfo] = useState<DrillDownOutlet | null>(null)
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: 20, total: 0, totalPages: 0 })

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        outletId: outlet.id,
        tab,
        period: dateFilterConfig[period].param,
        page: String(page),
        limit: '15',
      })
      if (search) params.set('search', search)

      const res = await fetch(`/api/multi-outlet/outlet?${params}`)
      if (!res.ok) throw new Error()
      const json = await res.json()
      setOutletInfo(json.outlet)
      setData(json.data || [])
      setPagination(json.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 })
    } catch {
      toast.error('Gagal memuat detail outlet')
    } finally {
      setLoading(false)
    }
  }, [outlet.id, tab, period, page, search])

  // Reset when dialog opens/tab changes
  useEffect(() => {
    if (open) {
      setTab('transactions')
      setSearch('')
      setPage(1)
    }
  }, [open, outlet.id])

  useEffect(() => {
    if (open) void fetchData()
  }, [fetchData, open])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="bg-[#0c0d12] border-white/[0.06] max-w-2xl w-[95vw] max-h-[85vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-white/[0.06] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <DialogTitle className="text-base font-bold text-white truncate">{outlet.name}</DialogTitle>
                {outlet.isMain && (
                  <Badge className="text-[9px] px-1.5 py-0 bg-amber-500/10 border-amber-500/20 text-amber-400 border hover:bg-amber-500/10">
                    Utama
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                {outletInfo && (
                  <>
                    <span className="flex items-center gap-1"><UserCircle className="h-3 w-3" />{outletInfo.managerName || '-'}</span>
                    {outletInfo.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{outletInfo.phone}</span>}
                    {outletInfo.address && <span className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3" />{outletInfo.address}</span>}
                  </>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white shrink-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Quick stats */}
          {outletInfo && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[
                { label: 'Omset', value: formatCurrency(outletInfo.revenue), icon: <Banknote className="h-3 w-3 text-emerald-400" /> },
                { label: 'Transaksi', value: formatNumber(outletInfo.transactions), icon: <Receipt className="h-3 w-3 text-sky-400" /> },
                { label: 'Customer', value: formatNumber(outletInfo.customers), icon: <Users className="h-3 w-3 text-violet-400" /> },
                { label: 'Produk', value: formatNumber(outletInfo.products), icon: <Package className="h-3 w-3 text-amber-400" /> },
              ].map((s) => (
                <div key={s.label} className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                  <div className="flex items-center gap-1 mb-0.5">
                    {s.icon}
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider">{s.label}</span>
                  </div>
                  <p className="text-xs font-bold text-white truncate">{s.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabs + Search */}
        <div className="px-5 pt-3 pb-2 border-b border-white/[0.04] shrink-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
              {(Object.entries(tabConfig) as [DetailTab, typeof tabConfig[DetailTab]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => { setTab(key); setPage(1); setSearch('') }}
                  className={cn(
                    'text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1.5',
                    tab === key ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300'
                  )}
                >
                  {cfg.icon}
                  {cfg.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder={tab === 'transactions' ? 'Cari invoice...' : tab === 'customers' ? 'Cari nama/WA...' : 'Cari produk...'}
                className="h-7 pl-7 pr-2 text-[11px] bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600 w-40 sm:w-48"
              />
            </div>
          </div>
        </div>

        {/* Data */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="p-5 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 bg-white/[0.04] rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="p-3">
              {data.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-xs text-slate-500">Tidak ada data</p>
                </div>
              ) : tab === 'transactions' ? (
                <TransactionsList data={data as TransactionRow[]} />
              ) : tab === 'customers' ? (
                <CustomersList data={data as CustomerRow[]} />
              ) : (
                <ProductsList data={data as ProductRow[]} />
              )}
            </div>
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-5 py-2.5 border-t border-white/[0.06] flex items-center justify-between shrink-0">
            <p className="text-[10px] text-slate-500">
              {pagination.page} / {pagination.totalPages} halaman ({pagination.total} data)
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Transaction List ──
interface TransactionRow {
  id: string
  invoiceNumber: string
  total: number
  paymentMethod: string
  createdAt: string
  customer?: { name: string } | null
  user?: { name: string } | null
}

function TransactionsList({ data }: { data: TransactionRow[] }) {
  return (
    <div className="space-y-1.5">
      {data.map((tx) => (
        <div key={tx.id} className="flex items-center justify-between gap-3 bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.04]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-[11px] font-mono font-semibold text-white">{tx.invoiceNumber}</p>
              <Badge className="text-[8px] px-1 py-0 bg-white/[0.06] text-slate-400 border-0 hover:bg-white/[0.06]">{tx.paymentMethod}</Badge>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <span>{tx.user?.name || '-'}</span>
              {tx.customer && <span>• {tx.customer.name}</span>}
              <span>• {new Date(tx.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          <p className="text-xs font-bold text-emerald-400 shrink-0">{formatCurrency(tx.total)}</p>
        </div>
      ))}
    </div>
  )
}

// ── Customer List ──
interface CustomerRow {
  id: string
  name: string
  whatsapp: string
  totalSpend: number
  points: number
  createdAt: string
  _count: { transactions: number }
}

function CustomersList({ data }: { data: CustomerRow[] }) {
  return (
    <div className="space-y-1.5">
      {data.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.04]">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-white truncate">{c.name}</p>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <span>{c.whatsapp}</span>
              <span>• {c._count.transactions} transaksi</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-bold text-white">{formatCurrency(c.totalSpend)}</p>
            <p className="text-[9px] text-amber-400">{c.points} pts</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Product List ──
interface ProductRow {
  id: string
  name: string
  sku?: string
  price: number
  hpp: number
  stock: number
  hasVariants: boolean
  category?: { name: string; color: string } | null
  _count: { variants: number }
}

function ProductsList({ data }: { data: ProductRow[] }) {
  return (
    <div className="space-y-1.5">
      {data.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3 bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.04]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <p className="text-[11px] font-semibold text-white truncate">{p.name}</p>
              {p.hasVariants && (
                <Badge className="text-[8px] px-1 py-0 bg-violet-500/10 text-violet-400 border-0 hover:bg-violet-500/10">
                  {p._count.variants} var
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              {p.category && <span>{p.category.name}</span>}
              {p.sku && <span>• SKU: {p.sku}</span>}
              <span>• Rp {formatNumber(p.price)}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className={cn('text-xs font-bold', p.stock <= 0 ? 'text-red-400' : p.stock <= 10 ? 'text-amber-400' : 'text-white')}>
              {formatNumber(p.stock)}
            </p>
            <p className="text-[9px] text-slate-500">stok</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════
export default function MultiOutletTerminalPage() {
  // ── State ──
  const [hasGroup, setHasGroup] = useState<boolean | null>(null)
  const [groupName, setGroupName] = useState('')
  const [totals, setTotals] = useState<GroupTotals | null>(null)
  const [outlets, setOutlets] = useState<OutletSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState<DateFilter>('today')
  const [detailOutlet, setDetailOutlet] = useState<OutletSummary | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // ── Fetch group + data ──
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [groupRes, terminalRes] = await Promise.all([
        fetch('/api/outlet-group'),
        fetch(`/api/multi-outlet/dashboard?period=${dateFilterConfig[dateFilter].param}`),
      ])

      if (groupRes.ok) {
        const groupData = await groupRes.json()
        setHasGroup(!!groupData.group)
        setGroupName(groupData.group?.name || '')
      } else {
        setHasGroup(false)
      }

      if (terminalRes.ok) {
        const data = await terminalRes.json()
        setTotals(data.totals || null)
        setOutlets(data.outlets || [])
      }
    } catch {
      toast.error('Gagal memuat data')
      setHasGroup(false)
    } finally {
      setLoading(false)
    }
  }, [dateFilter])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const openDetail = (outlet: OutletSummary) => {
    setDetailOutlet(outlet)
    setDetailOpen(true)
  }

  // ── Loading skeleton ──
  if (loading && hasGroup === null) {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-52 bg-white/[0.04]" />
          <Skeleton className="h-3.5 w-64 bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 bg-nebula rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 bg-nebula rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ── No group ──
  if (!hasGroup) {
    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-4"
      >
        <motion.div variants={itemVariants} className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">Multi Outlet</h1>
          <p className="text-sm text-slate-500">Dashboard agregasi seluruh outlet</p>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card className="bg-nebula border-white/[0.06]">
            <CardContent className="py-16 text-center">
              <Building2 className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-sm text-slate-400 font-medium">Belum ada grup outlet</p>
              <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
                Hubungkan outlet Anda ke sebuah grup untuk melihat data agregasi dari seluruh outlet dalam satu dashboard.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    )
  }

  return (
    <motion.div className="space-y-4" variants={containerVariants} initial="hidden" animate="visible">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">Multi Outlet</h1>
            {groupName && (
              <Badge className="text-[9px] px-1.5 py-0 bg-white/[0.06] text-slate-400 border-0 hover:bg-white/[0.06]">
                {groupName}
              </Badge>
            )}
          </div>
          <p className="text-sm text-slate-500">Dashboard agregasi seluruh outlet</p>
        </div>
        {/* Date Filter */}
        <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-lg p-0.5">
          {(Object.keys(dateFilterConfig) as DateFilter[]).map((key) => (
            <button
              key={key}
              onClick={() => setDateFilter(key)}
              className={cn(
                'text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors',
                dateFilter === key
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {dateFilterConfig[key].label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Summary Cards - 5 cards */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          icon={<Banknote className="h-4 w-4 text-emerald-400" />}
          label="Total Pendapatan"
          value={formatCurrency(totals?.totalRevenue ?? 0)}
          sub={dateFilterConfig[dateFilter].label}
          color="bg-emerald-500/10"
        />
        <StatCard
          icon={<Receipt className="h-4 w-4 text-sky-400" />}
          label="Total Transaksi"
          value={formatNumber(totals?.totalTransactions ?? 0)}
          color="bg-sky-500/10"
        />
        <StatCard
          icon={<Users className="h-4 w-4 text-violet-400" />}
          label="Total Customer"
          value={formatNumber(totals?.totalCustomers ?? 0)}
          sub="Akumulasi semua outlet"
          color="bg-violet-500/10"
        />
        <StatCard
          icon={<Package className="h-4 w-4 text-amber-400" />}
          label="Total Produk"
          value={formatNumber(totals?.totalProducts ?? 0)}
          color="bg-amber-500/10"
        />
        <StatCard
          icon={<Store className="h-4 w-4 text-rose-400" />}
          label="Total Outlet"
          value={formatNumber(outlets.length)}
          color="bg-rose-500/10"
        />
      </motion.div>

      {/* Per-outlet cards */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center gap-2 mb-3">
          <Layers className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-300">Outlet</h2>
          <span className="text-[10px] text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded-md font-medium">
            {outlets.length}
          </span>
        </div>

        {outlets.length === 0 ? (
          <Card className="bg-nebula border-white/[0.06]">
            <CardContent className="py-12 text-center">
              <Store className="h-8 w-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Tidak ada data outlet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {outlets.map((outlet, idx) => (
              <motion.div
                key={outlet.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05, duration: 0.3 }}
              >
                <Card
                  className="bg-nebula border-white/[0.06] hover:border-white/[0.12] transition-all cursor-pointer group"
                  onClick={() => openDetail(outlet)}
                >
                  <CardContent className="p-3.5 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                          <Store className="h-4 w-4 text-slate-400" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold text-white truncate">{outlet.name}</p>
                            {outlet.isMain && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 leading-none border bg-amber-500/10 border-amber-500/20 text-amber-400 shrink-0"
                              >
                                Utama
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <UserCircle className="h-3 w-3 text-slate-600" />
                            <p className="text-[10px] text-slate-500 truncate">{outlet.managerName}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <ChangeBadge percent={outlet.revenueChangePercent} />
                        <Eye className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                      </div>
                    </div>

                    {/* Stats Grid - 2x3 */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Banknote className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Omset</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatCurrency(outlet.revenue)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <ShoppingCart className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Transaksi</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatNumber(outlet.transactions)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Users className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Customer</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatNumber(outlet.totalCustomers)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Hash className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Produk</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatNumber(outlet.totalProducts)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Box className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Stok</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatNumber(outlet.totalStock)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <ArrowUpRight className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Brutto</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatCurrency(outlet.brutto)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Outlet Detail Dialog */}
      <AnimatePresence>
        {detailOutlet && detailOpen && (
          <OutletDetailDialog
            outlet={detailOutlet}
            period={dateFilter}
            open={detailOpen}
            onClose={() => setDetailOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}