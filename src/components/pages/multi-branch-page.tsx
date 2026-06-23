'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Pagination } from '@/components/shared/pagination'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogDescription,
} from '@/components/ui/responsive-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DollarSign,
  Receipt,
  Package,
  Users,
  ArrowRightLeft,
  Plus,
  Search,
  Check,
  X,
  PackageCheck,
  Store,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Building2,
  Loader2,
  Ban,
  Minus,
  MapPin,
  FileText,
  ChevronUp,
} from 'lucide-react'

// ============================== TYPES ==============================

interface Outlet {
  id: string
  name: string
  isPrimary: boolean
  todayRevenue: number
  todayTransactionCount: number
  totalRevenue: number
  totalTransactionCount: number
  productCount: number
  crewCount: number
  address?: string
}

interface CombinedMetrics {
  totalRevenue: number
  totalTransactions: number
  totalProducts: number
  totalCrew: number
}

interface LowStockAlert {
  id: string
  productName: string
  outletName: string
  currentStock: number
}

interface DashboardData {
  outlets: Outlet[]
  combined: CombinedMetrics
  lowStockAlerts: LowStockAlert[]
}

interface StockTransfer {
  id: string
  productName: string
  quantity: number
  fromOutletName: string
  toOutletName: string
  fromOutletId: string
  toOutletId: string
  status: 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED'
  reason?: string | null
  createdAt: string
  updatedAt?: string | null
}

interface StockTransferListResponse {
  transfers: StockTransfer[]
  totalPages: number
}

interface MBCustomer {
  id: string
  name: string
  whatsapp: string
  totalSpend: number
  points: number
  outletId: string
  outletName: string
  transactionCount: number
  createdAt: string
}

interface MBCustomerOutletStat {
  outletId: string
  outletName: string
  totalCustomers: number
  totalSpend: number
  newThisMonth: number
}

interface MBCustomerResponse {
  customers: MBCustomer[]
  totalPages: number
  outletStats: MBCustomerOutletStat[]
  topCustomers: { id: string; name: string; totalSpend: number; outletId: string; outletName: string; transactionCount: number }[]
  combined: { totalCustomers: number; totalSpend: number; newThisMonth: number }
  outlets: { id: string; name: string }[]
}

interface TransferProduct {
  id: string
  name: string
  sku: string
  barcode: string
  stock: number
  price: number
  category?: { name: string } | null
  toStock?: number
}

interface SelectedItem {
  productId: string
  productName: string
  quantity: number
  maxStock: number
}

// ============================== CONSTANTS ==============================

const TRANSFER_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string; borderColor: string; dotColor: string }
> = {
  PENDING: {
    label: 'Menunggu',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    dotColor: 'bg-amber-500',
  },
  APPROVED: {
    label: 'Disetujui',
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/20',
    dotColor: 'bg-sky-500',
  },
  COMPLETED: {
    label: 'Selesai',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    dotColor: 'bg-emerald-500',
  },
  REJECTED: {
    label: 'Ditolak',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    dotColor: 'bg-red-500',
  },
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

// ============================== HELPER COMPONENTS ==============================

function TransferStatusBadge({ status }: { status: string }) {
  const config = TRANSFER_STATUS_CONFIG[status]
  if (!config) {
    return (
      <Badge className="bg-zinc-500/10 border border-zinc-500/20 text-zinc-400 text-[10px] px-1.5 py-0">
        {status}
      </Badge>
    )
  }
  return (
    <Badge
      className={`${config.bgColor} border ${config.borderColor} ${config.color} text-[10px] gap-1 px-1.5 py-0`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`} />
      {config.label}
    </Badge>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-nebula p-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center mx-auto mb-3">
        <Icon className="h-6 w-6 text-slate-600" />
      </div>
      <p className="text-sm text-slate-400 font-medium">{title}</p>
      {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/10 bg-nebula p-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto mb-3">
        <AlertTriangle className="h-6 w-6 text-red-400" />
      </div>
      <p className="text-sm text-slate-400 font-medium">Gagal memuat data</p>
      <p className="text-xs text-slate-500 mt-1">Terjadi kesalahan saat mengambil data dari server</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRetry}
        className="mt-3 text-slate-400 hover:text-white hover:bg-white/[0.06] text-xs h-8 gap-1.5"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Coba Lagi
      </Button>
    </div>
  )
}

// ============================== SKELETON COMPONENTS ==============================

function StatCardSkeleton() {
  return (
    <Card className="bg-nebula border-white/[0.06] rounded-xl">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-4 w-20 bg-white/[0.04]" />
          <Skeleton className="h-8 w-8 rounded-lg bg-white/[0.04]" />
        </div>
        <Skeleton className="h-6 w-28 bg-white/[0.04] mb-1.5" />
        <Skeleton className="h-3 w-16 bg-white/[0.04]" />
      </CardContent>
    </Card>
  )
}

function OutletCardSkeleton() {
  return (
    <Card className="bg-nebula border-white/[0.06] rounded-xl">
      <CardHeader className="pb-3 p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded bg-white/[0.04]" />
          <Skeleton className="h-4 w-32 bg-white/[0.04]" />
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-16 bg-white/[0.04] mb-1" />
              <Skeleton className="h-4 w-20 bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <OutletCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

function TableRowsSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <Skeleton key={rowIdx} className="h-12 bg-nebula rounded-lg" />
      ))}
    </div>
  )
}

// ============================== TAB 1: RINGKASAN ==============================

function RingkasanTab() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/multi-branch/dashboard')
      if (res.ok) {
        const json = await res.json()
        setData(json)
      } else {
        setError(true)
        toast.error('Gagal memuat data dashboard')
      }
    } catch {
      setError(true)
      toast.error('Gagal memuat data dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  const statCards = [
    {
      label: 'Total Pendapatan',
      value: data ? formatCurrency(data.combined.totalRevenue) : 'Rp 0',
      sub: 'Semua cabang',
      icon: DollarSign,
      gradient: 'from-pink-500 to-rose-500',
      iconBg: 'bg-pink-500/10',
      iconColor: 'text-pink-400',
    },
    {
      label: 'Total Transaksi',
      value: data ? formatNumber(data.combined.totalTransactions) : '0',
      sub: 'Semua cabang',
      icon: Receipt,
      gradient: 'from-purple-500 to-violet-500',
      iconBg: 'bg-purple-500/10',
      iconColor: 'text-purple-400',
    },
    {
      label: 'Total Produk',
      value: data ? formatNumber(data.combined.totalProducts) : '0',
      sub: 'Seluruh katalog',
      icon: Package,
      gradient: 'from-cyan-500 to-teal-500',
      iconBg: 'bg-cyan-500/10',
      iconColor: 'text-cyan-400',
    },
    {
      label: 'Total Crew',
      value: data ? formatNumber(data.combined.totalCrew) : '0',
      sub: 'Aktif di semua cabang',
      icon: Users,
      gradient: 'from-amber-500 to-orange-500',
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-400',
    },
  ]

  if (error) {
    return <ErrorState onRetry={fetchDashboard} />
  }

  if (loading) {
    return <DashboardSkeleton />
  }

  if (!data || data.outlets.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Belum ada cabang"
        description="Tambahkan outlet cabang baru untuk mulai mengelola multi-cabang"
      />
    )
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((stat, idx) => {
          const Icon = stat.icon
          return (
            <motion.div key={idx} variants={itemVariants}>
              <Card className="bg-nebula border-white/[0.06] rounded-xl hover:border-white/[0.12] transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] text-slate-500 font-medium">{stat.label}</span>
                    <div className={`w-8 h-8 rounded-lg ${stat.iconBg} flex items-center justify-center`}>
                      <Icon className={`h-4 w-4 ${stat.iconColor}`} />
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-white tracking-tight">{stat.value}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{stat.sub}</p>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {/* Low Stock Alerts */}
      {data.lowStockAlerts && data.lowStockAlerts.length > 0 && (
        <motion.div variants={itemVariants}>
          <Card className="bg-amber-500/[0.04] border-amber-500/10 rounded-xl">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-amber-300">Peringatan Stok Rendah</p>
                  <p className="text-[10px] text-amber-400/60">
                    {data.lowStockAlerts.length} produk dengan stok menipis
                  </p>
                </div>
              </div>
              <ScrollArea className="max-h-32">
                <div className="space-y-1.5">
                  {data.lowStockAlerts.slice(0, 10).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-white/[0.02]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Package className="h-3 w-3 text-amber-400/60 shrink-0" />
                        <span className="text-slate-300 truncate">{alert.productName}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-slate-500">{alert.outletName}</span>
                        <Badge className="bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] px-1 py-0">
                          {alert.currentStock}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Outlet Cards Header */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center gap-2 mb-1">
          <Store className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-medium text-slate-300">Per Outlet</h3>
          <Badge className="bg-white/[0.04] border border-white/[0.08] text-slate-400 text-[10px] px-1.5 py-0 ml-1">
            {data.outlets.length} cabang
          </Badge>
        </div>
      </motion.div>

      {/* Outlet Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.outlets.map((outlet) => (
          <motion.div key={outlet.id} variants={itemVariants}>
            <Card className="bg-nebula border-white/[0.06] rounded-xl hover:border-white/[0.12] transition-colors">
              <CardHeader className="pb-3 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500/20 via-purple-500/20 to-cyan-500/20 flex items-center justify-center shrink-0 border border-white/[0.06]">
                      <Store className="h-4 w-4 text-slate-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{outlet.name}</p>
                      {outlet.address && (
                        <p className="text-[10px] text-slate-500 truncate">{outlet.address}</p>
                      )}
                    </div>
                  </div>
                  {outlet.isPrimary && (
                    <Badge className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] px-1.5 py-0 shrink-0">
                      Utama
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-4 pb-4">
                <Separator className="bg-white/[0.04] mb-3" />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">Pendapatan Hari Ini</p>
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="h-3 w-3 text-emerald-400" />
                      <p className="text-xs font-medium text-white">
                        {formatCurrency(outlet.todayRevenue)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">Transaksi Hari Ini</p>
                    <div className="flex items-center gap-1.5">
                      <Receipt className="h-3 w-3 text-sky-400" />
                      <p className="text-xs font-medium text-white">
                        {formatNumber(outlet.todayTransactionCount)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">Total Pendapatan</p>
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="h-3 w-3 text-pink-400" />
                      <p className="text-xs font-medium text-white">
                        {formatCurrency(outlet.totalRevenue)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">Total Transaksi</p>
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-purple-400" />
                      <p className="text-xs font-medium text-white">
                        {formatNumber(outlet.totalTransactionCount)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">Total Produk</p>
                    <div className="flex items-center gap-1.5">
                      <Package className="h-3 w-3 text-cyan-400" />
                      <p className="text-xs font-medium text-white">
                        {formatNumber(outlet.productCount)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-0.5">Total Crew</p>
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3 w-3 text-amber-400" />
                      <p className="text-xs font-medium text-white">
                        {formatNumber(outlet.crewCount)}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

// ============================== TAB 2: TRANSFER STOK ==============================

function TransferStokTab({ outlets }: { outlets: { id: string; name: string; isPrimary?: boolean }[] }) {
  const [transfers, setTransfers] = useState<StockTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')

  // Create transfer dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [fromOutletId, setFromOutletId] = useState('')
  const [toOutletId, setToOutletId] = useState('')
  const [reason, setReason] = useState('')

  // Product list state
  const [products, setProducts] = useState<TransferProduct[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{
    id: string
    status: 'APPROVED' | 'REJECTED' | 'COMPLETED'
    label: string
    description: string
  } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Race condition guard: only the latest fetch updates state
  const fetchIdRef = useRef(0)

  // Ref to pass toOutletId to the debounced search effect without triggering it
  const toOutletIdRef = useRef(toOutletId)
  useEffect(() => { toOutletIdRef.current = toOutletId }, [toOutletId])

  const fetchTransfers = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      const res = await fetch(`/api/multi-branch/stock-transfer?${params}`)
      if (res.ok) {
        const json: StockTransferListResponse = await res.json()
        setTransfers(json.transfers)
        setTotalPages(json.totalPages)
      } else {
        setError(true)
        toast.error('Gagal memuat data transfer')
      }
    } catch {
      setError(true)
      toast.error('Gagal memuat data transfer')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter])

  useEffect(() => {
    fetchTransfers()
  }, [fetchTransfers])

  // Fetch products when fromOutletId or productSearch changes
  const fetchProducts = useCallback(async (outletId: string, search: string, toId?: string) => {
    if (!outletId) {
      setProducts([])
      return
    }
    const currentFetchId = ++fetchIdRef.current
    setProductsLoading(true)
    try {
      const params = new URLSearchParams({ mode: 'products', outletId })
      if (search) params.set('search', search)
      if (toId) params.set('toOutletId', toId)
      const res = await fetch(`/api/multi-branch/stock-transfer?${params}`)
      if (currentFetchId !== fetchIdRef.current) return // stale fetch — discard
      if (res.ok) {
        const json = await res.json()
        setProducts(json.products || [])
      } else {
        toast.error('Gagal memuat produk')
      }
    } catch {
      if (currentFetchId !== fetchIdRef.current) return
      toast.error('Gagal memuat produk')
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setProductsLoading(false)
      }
    }
  }, [])

  // Fetch products immediately when source or destination outlet changes
  useEffect(() => {
    if (fromOutletId) {
      fetchProducts(fromOutletId, productSearch, toOutletId)
    } else {
      setProducts([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromOutletId, toOutletId, fetchProducts])

  // Debounced search for products (only triggers on search input, not outlet changes)
  useEffect(() => {
    if (!fromOutletId) return
    const timer = setTimeout(() => {
      fetchProducts(fromOutletId, productSearch, toOutletIdRef.current)
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSearch, fromOutletId, fetchProducts])

  const resetForm = useCallback(() => {
    setFromOutletId('')
    setToOutletId('')
    setReason('')
    setProducts([])
    setProductSearch('')
    setSelectedIds(new Set())
    setSelectedItems([])
  }, [])

  // Helper: outlet badge
  const outletBadge = (outletId: string) => {
    const outlet = outlets.find((o) => o.id === outletId)
    if (!outlet) return null
    if (outlet.isPrimary) {
      return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] px-1.5 py-0 h-4">Utama</Badge>
    }
    return <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[10px] px-1.5 py-0 h-4">Cabang</Badge>
  }

  // Toggle product checkbox
  const toggleProduct = (product: TransferProduct) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(product.id)) {
        next.delete(product.id)
        setSelectedItems((items) => items.filter((i) => i.productId !== product.id))
      } else {
        next.add(product.id)
        setSelectedItems((items) => [...items, {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          maxStock: product.stock,
        }])
      }
      return next
    })
  }

  // Update quantity for a selected item
  const updateQuantity = (productId: string, delta: number) => {
    setSelectedItems((items) =>
      items.map((item) => {
        if (item.productId !== productId) return item
        const newQty = Math.max(1, Math.min(item.maxStock, item.quantity + delta))
        return { ...item, quantity: newQty }
      })
    )
  }

  // Remove a selected item
  const removeSelectedItem = (productId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(productId)
      return next
    })
    setSelectedItems((items) => items.filter((i) => i.productId !== productId))
  }

  const handleCreateTransfer = async () => {
    if (!fromOutletId || !toOutletId) {
      toast.error('Pilih outlet asal dan tujuan')
      return
    }
    if (fromOutletId === toOutletId) {
      toast.error('Outlet asal dan tujuan tidak boleh sama')
      return
    }
    if (selectedItems.length === 0) {
      toast.error('Pilih minimal satu produk untuk ditransfer')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/multi-branch/stock-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromOutletId,
          toOutletId,
          reason: reason || undefined,
          items: selectedItems.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
          })),
        }),
      })
      if (res.ok) {
        toast.success('Transfer stok berhasil dibuat')
        setCreateDialogOpen(false)
        resetForm()
        fetchTransfers()
      } else {
        const json = await res.json()
        toast.error(json.error || 'Gagal membuat transfer stok')
      }
    } catch {
      toast.error('Gagal membuat transfer stok')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStatusUpdate = async () => {
    if (!confirmAction) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/multi-branch/stock-transfer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: confirmAction.id, status: confirmAction.status }),
      })
      if (res.ok) {
        toast.success(`Transfer berhasil ${confirmAction.label.toLowerCase()}`)
        setConfirmAction(null)
        fetchTransfers()
      } else {
        const json = await res.json()
        toast.error(json.error || 'Gagal memperbarui status transfer')
      }
    } catch {
      toast.error('Gagal memperbarui status transfer')
    } finally {
      setActionLoading(false)
    }
  }

  const toOutletOptions = outlets.filter((o) => o.id !== fromOutletId)

  const fromOutlet = outlets.find((o) => o.id === fromOutletId)
  const toOutlet = outlets.find((o) => o.id === toOutletId)

  return (
    <div className="space-y-4">
      {/* Header with create button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
            <SelectTrigger className="w-full sm:w-36 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs">
              <SelectValue placeholder="Semua Status" />
            </SelectTrigger>
            <SelectContent className="bg-white/[0.04] border-white/[0.08]">
              <SelectItem value="ALL" className="text-slate-200 focus:bg-white/[0.06] text-xs">
                Semua Status
              </SelectItem>
              {Object.entries(TRANSFER_STATUS_CONFIG).map(([key, config]) => (
                <SelectItem key={key} value={key} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => setCreateDialogOpen(true)}
          className="theme-btn-primary h-8 text-xs gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Buat Transfer
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <TableRowsSkeleton rows={6} />
      ) : error ? (
        <ErrorState onRetry={fetchTransfers} />
      ) : transfers.length === 0 ? (
        <EmptyState
          icon={ArrowRightLeft}
          title="Belum ada transfer stok"
          description="Buat transfer stok pertama antar cabang"
          action={
            <Button
              onClick={() => setCreateDialogOpen(true)}
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-white hover:bg-white/[0.06] text-xs h-8 gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Buat Transfer
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {/* Mobile Card View */}
          <div className="md:hidden space-y-2">
            {transfers.map((transfer) => (
              <Card key={transfer.id} className="bg-nebula border-white/[0.06] rounded-xl p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                      <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-400" />
                    </div>
                    <span className="text-xs font-medium text-white truncate">
                      {transfer.productName}
                    </span>
                  </div>
                  <TransferStatusBadge status={transfer.status} />
                </div>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Rute</span>
                    <span className="text-slate-300 flex items-center gap-1">
                      <span className="truncate max-w-[100px]">{transfer.fromOutletName}</span>
                      <ArrowRight className="h-3 w-3 text-slate-600" />
                      <span className="truncate max-w-[100px]">{transfer.toOutletName}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Jumlah</span>
                    <span className="text-slate-300">{formatNumber(transfer.quantity)} unit</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Tanggal</span>
                    <span className="text-slate-400">{formatDate(transfer.createdAt)}</span>
                  </div>
                  {transfer.reason && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Alasan</span>
                      <span className="text-slate-400 truncate max-w-[160px]">{transfer.reason}</span>
                    </div>
                  )}
                </div>
                {/* Action buttons for mobile */}
                {(transfer.status === 'PENDING' || transfer.status === 'APPROVED') && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.04]">
                    {transfer.status === 'PENDING' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-7 text-[11px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 gap-1"
                          onClick={() =>
                            setConfirmAction({
                              id: transfer.id,
                              status: 'APPROVED',
                              label: 'Setujui',
                              description: `Apakah Anda yakin ingin menyetujui transfer "${transfer.productName}" dari ${transfer.fromOutletName} ke ${transfer.toOutletName}?`,
                            })
                          }
                        >
                          <Check className="h-3 w-3" />
                          Setujui
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-7 text-[11px] bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 gap-1"
                          onClick={() =>
                            setConfirmAction({
                              id: transfer.id,
                              status: 'REJECTED',
                              label: 'Tolak',
                              description: `Apakah Anda yakin ingin menolak transfer "${transfer.productName}" dari ${transfer.fromOutletName} ke ${transfer.toOutletName}?`,
                            })
                          }
                        >
                          <X className="h-3 w-3" />
                          Tolak
                        </Button>
                      </>
                    )}
                    {transfer.status === 'APPROVED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-[11px] bg-sky-500/10 border-sky-500/20 text-sky-400 hover:bg-sky-500/20 gap-1"
                        onClick={() =>
                          setConfirmAction({
                            id: transfer.id,
                            status: 'COMPLETED',
                            label: 'Selesaikan',
                            description: `Tandai transfer "${transfer.productName}" sebagai selesai? Stok akan diperbarui di outlet tujuan.`,
                          })
                        }
                      >
                        <PackageCheck className="h-3 w-3" />
                        Selesaikan
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block rounded-xl border border-white/[0.06] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent bg-nebula/50">
                  <TableHead className="text-slate-500 text-[11px] font-medium">Tanggal</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Produk</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Dari → Ke</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-right">Jumlah</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-center">Status</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((transfer) => (
                  <TableRow
                    key={transfer.id}
                    className="border-white/[0.06] hover:bg-white/[0.02] transition-colors"
                  >
                    <TableCell className="text-xs text-slate-400 py-3 px-4 whitespace-nowrap">
                      {formatDate(transfer.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-white font-medium py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                          <Package className="h-3.5 w-3.5 text-cyan-400" />
                        </div>
                        <div>
                          <p className="text-xs text-white font-medium">{transfer.productName}</p>
                          {transfer.reason && (
                            <p className="text-[10px] text-slate-500 truncate max-w-[200px]">
                              {transfer.reason}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-300 py-3 px-4">
                      <span className="flex items-center gap-1.5">
                        <span className="text-slate-400">{transfer.fromOutletName}</span>
                        <ArrowRight className="h-3 w-3 text-slate-600" />
                        <span className="text-slate-400">{transfer.toOutletName}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-white font-medium py-3 px-4 text-right">
                      {formatNumber(transfer.quantity)} unit
                    </TableCell>
                    <TableCell className="text-center py-3 px-4">
                      <TransferStatusBadge status={transfer.status} />
                    </TableCell>
                    <TableCell className="text-right py-3 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {transfer.status === 'PENDING' && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                              onClick={() =>
                                setConfirmAction({
                                  id: transfer.id,
                                  status: 'APPROVED',
                                  label: 'Setujui',
                                  description: `Apakah Anda yakin ingin menyetujui transfer "${transfer.productName}" dari ${transfer.fromOutletName} ke ${transfer.toOutletName}?`,
                                })
                              }
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              onClick={() =>
                                setConfirmAction({
                                  id: transfer.id,
                                  status: 'REJECTED',
                                  label: 'Tolak',
                                  description: `Apakah Anda yakin ingin menolak transfer "${transfer.productName}" dari ${transfer.fromOutletName} ke ${transfer.toOutletName}?`,
                                })
                              }
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {transfer.status === 'APPROVED' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 text-[11px] gap-1"
                            onClick={() =>
                              setConfirmAction({
                                id: transfer.id,
                                status: 'COMPLETED',
                                label: 'Selesaikan',
                                description: `Tandai transfer "${transfer.productName}" sebagai selesai? Stok akan diperbarui di outlet tujuan.`,
                              })
                            }
                          >
                            <PackageCheck className="h-3.5 w-3.5" />
                            Selesai
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Create Transfer Dialog */}
      <ResponsiveDialog open={createDialogOpen} onOpenChange={(open) => { if (!open) { resetForm() }; setCreateDialogOpen(open) }}>
        <ResponsiveDialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">
              Buat Transfer Stok
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Pindahkan stok produk dari satu outlet ke outlet lain
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
            {/* From Outlet */}
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Dari Outlet <span className="text-red-400">*</span></Label>
              <Select
                value={fromOutletId}
                onValueChange={(v) => { setFromOutletId(v); setToOutletId(''); setSelectedIds(new Set()); setSelectedItems([]) }}
              >
                <SelectTrigger className="bg-white/[0.04] border-white/[0.08] text-white h-9 text-xs">
                  <SelectValue placeholder="Pilih outlet asal" />
                </SelectTrigger>
                <SelectContent className="bg-[#0F172A] border-white/[0.08]">
                  {outlets.map((outlet) => (
                    <SelectItem key={outlet.id} value={outlet.id} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                      <span className="mr-1.5">{outlet.isPrimary ? '🏷️' : '🏢'}</span>
                      {outlet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* To Outlet */}
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Ke Outlet <span className="text-red-400">*</span></Label>
              <Select
                value={toOutletId}
                onValueChange={(v) => setToOutletId(v)}
                disabled={!fromOutletId}
              >
                <SelectTrigger className="bg-white/[0.04] border-white/[0.08] text-white h-9 text-xs">
                  <SelectValue placeholder={fromOutletId ? 'Pilih outlet tujuan' : 'Pilih outlet asal dahulu'} />
                </SelectTrigger>
                <SelectContent className="bg-[#0F172A] border-white/[0.08]">
                  {toOutletOptions.map((outlet) => (
                    <SelectItem key={outlet.id} value={outlet.id} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                      <span className="mr-1.5">{outlet.isPrimary ? '🏷️' : '🏢'}</span>
                      {outlet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Direction indicator */}
            {fromOutletId && toOutletId && (
              <div className="flex items-center justify-center gap-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{fromOutlet?.isPrimary ? '🏷️' : '🏢'}</span>
                  <span className="text-xs text-slate-300">{fromOutlet?.name}</span>
                  {outletBadge(fromOutletId)}
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500" />
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{toOutlet?.isPrimary ? '🏷️' : '🏢'}</span>
                  <span className="text-xs text-slate-300">{toOutlet?.name}</span>
                  {outletBadge(toOutletId)}
                </div>
              </div>
            )}

            {/* Product search */}
            {fromOutletId && (
              <div className="space-y-2">
                <Label className="text-xs text-slate-300">Cari Produk</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Cari nama atau SKU produk..."
                    className="bg-white/[0.04] border-white/[0.08] text-white h-9 text-xs placeholder:text-slate-500 pl-8"
                  />
                </div>
              </div>
            )}

            {/* Product list with checkboxes */}
            {fromOutletId && (
              <div className="space-y-2">
                <Label className="text-xs text-slate-300">
                  Daftar Produk
                  <span className="text-slate-500 font-normal ml-1">
                    ({products.length} produk)
                  </span>
                </Label>
                {toOutletId && (
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 px-1">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500/40" />
                      Stok {fromOutlet?.name || 'Asal'}
                    </span>
                    <ArrowRight className="h-2.5 w-2.5" />
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-sky-500/40" />
                      Stok {toOutlet?.name || 'Tujuan'}
                    </span>
                  </div>
                )}
                <ScrollArea className="h-48 rounded-md border border-white/[0.06]">
                  {productsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    </div>
                  ) : products.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-xs text-slate-500">Tidak ada produk ditemukan</p>
                    </div>
                  ) : (
                    <div className="p-1 space-y-0.5">
                      {products.map((product) => (
                        <label
                          key={product.id}
                          className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-white/[0.04] cursor-pointer transition-colors"
                        >
                          <Checkbox
                            checked={selectedIds.has(product.id)}
                            onCheckedChange={() => toggleProduct(product)}
                            className="border-white/[0.15] data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500 h-3.5 w-3.5"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-white font-medium truncate">{product.name}</p>
                            <p className="text-[10px] text-slate-500">
                              {product.sku}{product.category ? ` · ${product.category.name}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <div className="text-right">
                              <span className={`text-[11px] font-medium ${product.stock > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {formatNumber(product.stock)}
                              </span>
                              <p className="text-[9px] text-slate-600">asal</p>
                            </div>
                            {toOutletId && (
                              <>
                                <Separator orientation="vertical" className="h-6 bg-white/[0.06]" />
                                <div className="text-right">
                                  <span className={`text-[11px] font-medium ${product.toStock && product.toStock > 0 ? 'text-sky-400' : 'text-red-400/60'}`}>
                                    {formatNumber(product.toStock ?? 0)}
                                  </span>
                                  <p className="text-[9px] text-slate-600">tujuan</p>
                                </div>
                              </>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}

            {/* Selected items */}
            {selectedItems.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-slate-300">
                  Produk Dipilih
                  <span className="text-cyan-400 font-medium ml-1">({selectedItems.length})</span>
                </Label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {selectedItems.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-white/[0.03] border border-white/[0.06]"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white font-medium truncate">{item.productName}</p>
                        <p className="text-[10px] text-slate-500">Max: {formatNumber(item.maxStock)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 w-6 p-0 border-white/[0.1] text-slate-400 hover:text-white hover:bg-white/[0.08]"
                          onClick={() => updateQuantity(item.productId, -1)}
                          disabled={item.quantity <= 1}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="text-xs text-white font-medium w-8 text-center tabular-nums">
                          {item.quantity}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 w-6 p-0 border-white/[0.1] text-slate-400 hover:text-white hover:bg-white/[0.08]"
                          onClick={() => updateQuantity(item.productId, 1)}
                          disabled={item.quantity >= item.maxStock}
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 ml-0.5"
                          onClick={() => removeSelectedItem(item.productId)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">
                Alasan <span className="text-slate-500 font-normal">(opsional)</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Alasan transfer (opsional)"
                rows={2}
                className="bg-white/[0.04] border-white/[0.08] text-white text-xs placeholder:text-slate-500 resize-none"
              />
            </div>
          </div>

          <ResponsiveDialogFooter className="gap-2 mt-2">
            <Button
              variant="ghost"
              onClick={() => { setCreateDialogOpen(false); resetForm() }}
              className="text-slate-400 hover:text-white hover:bg-white/[0.06] text-xs h-9"
            >
              Batal
            </Button>
            <Button
              onClick={handleCreateTransfer}
              disabled={submitting || selectedItems.length === 0}
              className="theme-btn-primary text-xs h-9 gap-1.5"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Buat Transfer ({selectedItems.length} produk)
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Confirm Action Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent className="bg-nebula border-white/[0.06] rounded-xl max-w-[calc(100%-1rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-sm">
              Konfirmasi {confirmAction?.label}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              {confirmAction?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-white/[0.06] text-xs h-9 border-white/[0.08]">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStatusUpdate}
              disabled={actionLoading}
              className={
                confirmAction?.status === 'REJECTED'
                  ? 'bg-red-500 hover:bg-red-600 text-white text-xs h-9'
                  : 'theme-btn-primary text-xs h-9'
              }
            >
              {actionLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              {confirmAction?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================== TAB 3: TRANSAKSI ==============================

// ============================== TAB: PELANGGAN ==============================

function PelangganTab({ outlets }: { outlets: { id: string; name: string }[] }) {
  const [data, setData] = useState<MBCustomerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [outletFilter, setOutletFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (outletFilter !== 'ALL') params.set('outletId', outletFilter)
      if (search) params.set('search', search)
      const res = await fetch(`/api/multi-branch/customers?${params}`)
      if (res.ok) {
        const json: MBCustomerResponse = await res.json()
        setData(json)
      } else {
        setError(true)
        toast.error('Gagal memuat data pelanggan')
      }
    } catch {
      setError(true)
      toast.error('Gagal memuat data pelanggan')
    } finally {
      setLoading(false)
    }
  }, [outletFilter, search, page])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    const timer = setTimeout(() => setPage(1), 300)
    return () => clearTimeout(timer)
  }, [search, outletFilter])

  if (error) {
    return <ErrorState onRetry={fetchData} />
  }

  // Overview stat cards
  const statCards = [
    {
      label: 'Total Pelanggan',
      value: data ? formatNumber(data.combined.totalCustomers) : '0',
      sub: 'Semua cabang',
      icon: Users,
      iconBg: 'bg-pink-500/10',
      iconColor: 'text-pink-400',
    },
    {
      label: 'Total Belanja',
      value: data ? formatCurrency(data.combined.totalSpend) : 'Rp 0',
      sub: 'Akumulasi semua pelanggan',
      icon: DollarSign,
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-400',
    },
    {
      label: 'Pelanggan Baru',
      value: data ? formatNumber(data.combined.newThisMonth) : '0',
      sub: 'Bulan ini',
      icon: TrendingUp,
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-400',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {statCards.map((stat, idx) => {
          const Icon = stat.icon
          return (
            <motion.div key={idx} variants={itemVariants} initial="hidden" animate="visible">
              <Card className="bg-nebula border-white/[0.06] rounded-xl hover:border-white/[0.12] transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] text-slate-500 font-medium">{stat.label}</span>
                    <div className={`w-8 h-8 rounded-lg ${stat.iconBg} flex items-center justify-center`}>
                      <Icon className={`h-4 w-4 ${stat.iconColor}`} />
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-white tracking-tight">{stat.value}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{stat.sub}</p>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {/* Per-outlet canvassing performance */}
      {!loading && data && data.outletStats.length > 0 && (
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-3">
          <h3 className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            Performa Canvasing per Cabang
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.outletStats.map((stat) => {
              const ratio = stat.totalCustomers > 0
                ? Math.round((stat.newThisMonth / stat.totalCustomers) * 100)
                : 0
              return (
                <motion.div key={stat.outletId} variants={itemVariants}>
                  <Card className="bg-nebula border-white/[0.06] rounded-xl hover:border-white/[0.12] transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-medium text-white truncate max-w-[180px]">{stat.outletName}</p>
                        <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[10px] px-1.5 py-0 h-4 shrink-0">
                          {ratio}% baru
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-[10px] text-slate-500">Pelanggan</p>
                          <p className="text-sm font-semibold text-white">{formatNumber(stat.totalCustomers)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">Total Belanja</p>
                          <p className="text-sm font-semibold text-emerald-400">{formatCurrency(stat.totalSpend)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">Baru</p>
                          <p className="text-sm font-semibold text-amber-400">{formatNumber(stat.newThisMonth)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Customer list section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h3 className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Daftar Pelanggan
            {!loading && data && (
              <Badge className="bg-white/[0.04] border border-white/[0.08] text-slate-400 text-[10px] px-1.5 py-0">
                {data.customers.length}
              </Badge>
            )}
          </h3>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Select value={outletFilter} onValueChange={setOutletFilter}>
              <SelectTrigger className="w-full sm:w-40 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs">
                <SelectValue placeholder="Semua Cabang" />
              </SelectTrigger>
              <SelectContent className="bg-[#0F172A] border-white/[0.08]">
                <SelectItem value="ALL" className="text-slate-200 focus:bg-white/[0.06] text-xs">
                  Semua Cabang
                </SelectItem>
                {outlets.map((o) => (
                  <SelectItem key={o.id} value={o.id} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1 sm:w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama atau WA..."
                className="bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs placeholder:text-slate-500 pl-8"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <TableRowsSkeleton rows={6} />
        ) : !data || data.customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Belum ada pelanggan"
            description="Pelanggan akan muncul setelah ditambahkan di masing-masing cabang"
          />
        ) : (
          <>
            {/* Mobile Card View */}
            <div className="md:hidden space-y-2">
              {data.customers.map((customer) => (
                <Card key={customer.id} className="bg-nebula border-white/[0.06] rounded-xl p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-pink-500/10 flex items-center justify-center shrink-0 border border-white/[0.06]">
                        <span className="text-[11px] font-semibold text-pink-400">
                          {customer.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">{customer.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{customer.outletName}</p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-emerald-400 shrink-0">
                      {formatCurrency(customer.totalSpend)}
                    </span>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">WhatsApp</span>
                      <span className="text-slate-300">{customer.whatsapp}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Transaksi</span>
                      <span className="text-slate-300">{formatNumber(customer.transactionCount)}x</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Poin</span>
                      <span className="text-amber-400">{formatNumber(customer.points)}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block rounded-xl border border-white/[0.06] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent bg-nebula/50">
                    <TableHead className="text-slate-500 text-[11px] font-medium">Pelanggan</TableHead>
                    <TableHead className="text-slate-500 text-[11px] font-medium">Cabang</TableHead>
                    <TableHead className="text-slate-500 text-[11px] font-medium">WhatsApp</TableHead>
                    <TableHead className="text-slate-500 text-[11px] font-medium text-right">Total Belanja</TableHead>
                    <TableHead className="text-slate-500 text-[11px] font-medium text-center">Transaksi</TableHead>
                    <TableHead className="text-slate-500 text-[11px] font-medium text-right">Poin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.customers.map((customer) => (
                    <TableRow key={customer.id} className="border-white/[0.06] hover:bg-white/[0.02] transition-colors">
                      <TableCell className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-pink-500/10 flex items-center justify-center shrink-0 border border-white/[0.06]">
                            <span className="text-[10px] font-semibold text-pink-400">
                              {customer.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="text-xs text-white font-medium truncate max-w-[160px]">{customer.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[10px] px-1.5 py-0">
                          {customer.outletName}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 py-3 px-4">{customer.whatsapp}</TableCell>
                      <TableCell className="text-xs text-emerald-400 font-medium py-3 px-4 text-right">
                        {formatCurrency(customer.totalSpend)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-300 py-3 px-4 text-center">
                        {formatNumber(customer.transactionCount)}x
                      </TableCell>
                      <TableCell className="text-xs text-amber-400 font-medium py-3 px-4 text-right">
                        {formatNumber(customer.points)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Pagination currentPage={page} totalPages={data.totalPages} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  )
}


// ============================== MAIN PAGE ==============================

export default function MultiBranchPage() {
  const { data: session, status: authStatus } = useSession()
  const [activeTab, setActiveTab] = useState('ringkasan')

  // Outlet list from dashboard (shared across tabs)
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])
  const [dashLoading, setDashLoading] = useState(true)

  const fetchOutlets = useCallback(async () => {
    try {
      const res = await fetch('/api/multi-branch/dashboard')
      if (res.ok) {
        const json: DashboardData = await res.json()
        setOutlets(json.outlets.map((o) => ({ id: o.id, name: o.name })))
      }
    } catch {
      // Silently fail, tabs will handle their own outlet fetching
    } finally {
      setDashLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOutlets()
  }, [fetchOutlets])

  // Auth check
  if (authStatus === 'loading' || dashLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-7 w-64 bg-white/[0.04] mb-2" />
          <Skeleton className="h-4 w-80 bg-white/[0.04]" />
        </div>
        <Skeleton className="h-10 w-full max-w-md bg-white/[0.04] rounded-lg" />
        <DashboardSkeleton />
      </div>
    )
  }

  // Only OWNER can access multi-branch management
  if (!session?.user || session.user.role !== 'OWNER') {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
          <Ban className="h-8 w-8 text-red-400" />
        </div>
        <h2 className="text-lg font-semibold text-white mb-1">Akses Ditolak</h2>
        <p className="text-sm text-slate-400 text-center max-w-sm">
          Hanya pemilik bisnis (Owner) yang dapat mengakses halaman manajemen multi-cabang.
        </p>
      </div>
    )
  }

  const tabs = [
    { value: 'ringkasan', label: 'Ringkasan', icon: Building2 },
    { value: 'transfer', label: 'Transfer Stok', icon: ArrowRightLeft },
    { value: 'pelanggan', label: 'Pelanggan', icon: Users },
  ]

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500/20 via-purple-500/20 to-cyan-500/20 flex items-center justify-center border border-white/[0.06]">
            <Building2 className="h-5 w-5 text-slate-200" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Manajemen Multi-Cabang
            </h1>
            <p className="text-xs text-slate-500">
              Pantau dan kelola semua outlet cabang Anda
            </p>
          </div>
        </div>
        {/* Aether gradient line */}
        <div className="h-[2px] mt-3 rounded-full bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 opacity-40" />
      </motion.div>

      {/* Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white/[0.03] border border-white/[0.06] rounded-xl h-10 p-1 w-full sm:w-auto overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="text-xs gap-1.5 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 rounded-lg px-3 h-8 transition-all"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              )
            })}
          </TabsList>

          <TabsContent value="ringkasan" className="mt-0">
            <RingkasanTab />
          </TabsContent>

          <TabsContent value="transfer" className="mt-0">
            <TransferStokTab outlets={outlets} />
          </TabsContent>

          <TabsContent value="pelanggan" className="mt-0">
            <PelangganTab outlets={outlets} />
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  )
}