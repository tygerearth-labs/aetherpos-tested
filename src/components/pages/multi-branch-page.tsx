'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  ClipboardList,
  FileText,
  UserCog,
  Plus,
  Search,
  Check,
  X,
  PackageCheck,
  Store,
  TrendingUp,
  AlertTriangle,
  Shield,
  Calendar,
  Clock,
  Eye,
  RefreshCw,
  ArrowRight,
  Building2,
  Loader2,
  Ban,
  Hash,
  CreditCard,
  ShoppingCart,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  User,
  Banknote,
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

interface Transaction {
  id: string
  invoiceNumber: string
  createdAt: string
  outletName: string
  cashierName: string
  paymentMethod: string
  total: number
  voidStatus?: string
}

interface TransactionListResponse {
  transactions: Transaction[]
  totalPages: number
  outlets: { id: string; name: string }[]
}

interface AuditLog {
  id: string
  action: string
  entityType: string
  entityName?: string | null
  details?: string | null
  outletName: string
  userName: string
  createdAt: string
}

interface AuditLogListResponse {
  logs: AuditLog[]
  totalPages: number
  outlets: { id: string; name: string }[]
}

interface CrewMember {
  id: string
  name: string
  email: string
  role: string
  outletName: string
  joinDate: string
  permissions?: string[]
}

interface CrewListResponse {
  crew: CrewMember[]
  outlets: { id: string; name: string }[]
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

const ACTION_TYPES = [
  'CREATE',
  'SALE',
  'RESTOCK',
  'UPDATE',
  'DELETE',
  'TRANSFER',
  'ADJUSTMENT',
  'VOID',
]

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Dibuat',
  SALE: 'Penjualan',
  RESTOCK: 'Restock',
  UPDATE: 'Diperbarui',
  DELETE: 'Dihapus',
  TRANSFER: 'Transfer',
  ADJUSTMENT: 'Penyesuaian',
  VOID: 'Pembatalan',
}

const ENTITY_TYPES = [
  'PRODUCT',
  'TRANSACTION',
  'STOCK_TRANSFER',
  'USER',
  'OUTLET',
  'CATEGORY',
  'CUSTOMER',
  'PROMO',
  'SETTINGS',
]

const ENTITY_LABELS: Record<string, string> = {
  PRODUCT: 'Produk',
  TRANSACTION: 'Transaksi',
  STOCK_TRANSFER: 'Transfer Stok',
  USER: 'User/Crew',
  OUTLET: 'Outlet',
  CATEGORY: 'Kategori',
  CUSTOMER: 'Customer',
  PROMO: 'Promo',
  SETTINGS: 'Pengaturan',
}

const PAYMENT_METHOD_ICONS: Record<string, React.ElementType> = {
  CASH: Banknote,
  QRIS: Hash,
  TRANSFER: CreditCard,
  CARD: CreditCard,
}

function getPaymentIcon(method: string): React.ElementType {
  return PAYMENT_METHOD_ICONS[method.toUpperCase()] || Receipt
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Tunai',
  QRIS: 'QRIS',
  TRANSFER: 'Transfer',
  CARD: 'Kartu',
  DEBIT: 'Debit',
  CREDIT: 'Kredit',
}

function getPaymentLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method.toUpperCase()] || method
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

function RoleBadge({ role }: { role: string }) {
  if (role === 'OWNER') {
    return (
      <Badge className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] px-1.5 py-0">
        <Shield className="h-2.5 w-2.5 mr-0.5" />
        Owner
      </Badge>
    )
  }
  return (
    <Badge className="bg-slate-500/10 border border-slate-500/20 text-slate-400 text-[10px] px-1.5 py-0">
      <User className="h-2.5 w-2.5 mr-0.5" />
      Crew
    </Badge>
  )
}

function ActionBadge({ action }: { action: string }) {
  const colorMap: Record<string, { color: string; bg: string; border: string; icon: React.ElementType }> = {
    CREATE: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: Plus },
    SALE: { color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20', icon: ShoppingCart },
    RESTOCK: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Package },
    UPDATE: { color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', icon: Pencil },
    DELETE: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: Ban },
    TRANSFER: { color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', icon: ArrowRightLeft },
    ADJUSTMENT: { color: 'text-zinc-300', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20', icon: SlidersHorizontal },
    VOID: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: Ban },
  }
  const config = colorMap[action] || {
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    icon: RotateCcw,
  }
  const Icon = config.icon
  return (
    <Badge className={`${config.bg} border ${config.border} ${config.color} text-[10px] gap-1 px-1.5 py-0`}>
      <Icon className="h-2.5 w-2.5" />
      {ACTION_LABELS[action] || action}
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

function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 bg-nebula rounded-xl" />
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

function TransferStokTab({ outlets }: { outlets: { id: string; name: string }[] }) {
  const [transfers, setTransfers] = useState<StockTransfer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')

  // Create transfer dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    fromOutletId: '',
    toOutletId: '',
    productName: '',
    quantity: '',
    reason: '',
  })

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{
    id: string
    status: 'APPROVED' | 'REJECTED' | 'COMPLETED'
    label: string
    description: string
  } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

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

  const resetForm = useCallback(() => {
    setForm({ fromOutletId: '', toOutletId: '', productName: '', quantity: '', reason: '' })
  }, [])

  const handleCreateTransfer = async () => {
    if (!form.fromOutletId || !form.toOutletId || !form.productName || !form.quantity) {
      toast.error('Lengkapi semua field yang wajib diisi')
      return
    }
    if (form.fromOutletId === form.toOutletId) {
      toast.error('Outlet asal dan tujuan tidak boleh sama')
      return
    }
    if (Number(form.quantity) <= 0) {
      toast.error('Jumlah harus lebih dari 0')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/multi-branch/stock-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromOutletId: form.fromOutletId,
          toOutletId: form.toOutletId,
          productName: form.productName,
          quantity: Number(form.quantity),
          reason: form.reason || undefined,
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

  const toOutletOptions = outlets.filter((o) => o.id !== form.fromOutletId)

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
      <ResponsiveDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">
              Buat Transfer Stok
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Pindahkan stok produk dari satu outlet ke outlet lain
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Dari Outlet <span className="text-red-400">*</span></Label>
              <Select
                value={form.fromOutletId}
                onValueChange={(v) => setForm((f) => ({ ...f, fromOutletId: v, toOutletId: '' }))}
              >
                <SelectTrigger className="bg-white/[0.04] border-white/[0.08] text-white h-9 text-xs">
                  <SelectValue placeholder="Pilih outlet asal" />
                </SelectTrigger>
                <SelectContent className="bg-[#0F172A] border-white/[0.08]">
                  {outlets.map((outlet) => (
                    <SelectItem key={outlet.id} value={outlet.id} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                      {outlet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Ke Outlet <span className="text-red-400">*</span></Label>
              <Select
                value={form.toOutletId}
                onValueChange={(v) => setForm((f) => ({ ...f, toOutletId: v }))}
                disabled={!form.fromOutletId}
              >
                <SelectTrigger className="bg-white/[0.04] border-white/[0.08] text-white h-9 text-xs">
                  <SelectValue placeholder={form.fromOutletId ? 'Pilih outlet tujuan' : 'Pilih outlet asal dahulu'} />
                </SelectTrigger>
                <SelectContent className="bg-[#0F172A] border-white/[0.08]">
                  {toOutletOptions.map((outlet) => (
                    <SelectItem key={outlet.id} value={outlet.id} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                      {outlet.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Nama Produk <span className="text-red-400">*</span></Label>
              <Input
                value={form.productName}
                onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
                placeholder="Masukkan nama produk"
                className="bg-white/[0.04] border-white/[0.08] text-white h-9 text-xs placeholder:text-slate-500"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Jumlah <span className="text-red-400">*</span></Label>
              <Input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                placeholder="Masukkan jumlah"
                className="bg-white/[0.04] border-white/[0.08] text-white h-9 text-xs placeholder:text-slate-500"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">
                Alasan <span className="text-slate-500 font-normal">(opsional)</span>
              </Label>
              <Textarea
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Alasan transfer (opsional)"
                rows={3}
                className="bg-white/[0.04] border-white/[0.08] text-white text-xs placeholder:text-slate-500 resize-none"
              />
            </div>
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => { setCreateDialogOpen(false); resetForm() }}
              className="text-slate-400 hover:text-white hover:bg-white/[0.06] text-xs h-9"
            >
              Batal
            </Button>
            <Button
              onClick={handleCreateTransfer}
              disabled={submitting}
              className="theme-btn-primary text-xs h-9 gap-1.5"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Buat Transfer
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

function TransaksiTab({ outlets }: { outlets: { id: string; name: string }[] }) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [outletFilter, setOutletFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (outletFilter !== 'ALL') params.set('outletId', outletFilter)
      if (search) params.set('search', search)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      const res = await fetch(`/api/multi-branch/transactions?${params}`)
      if (res.ok) {
        const json: TransactionListResponse = await res.json()
        setTransactions(json.transactions)
        setTotalPages(json.totalPages)
      } else {
        setError(true)
        toast.error('Gagal memuat data transaksi')
      }
    } catch {
      setError(true)
      toast.error('Gagal memuat data transaksi')
    } finally {
      setLoading(false)
    }
  }, [page, outletFilter, search, dateFrom, dateTo])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

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
    if (e.key === 'Enter') handleSearch()
  }

  const handleClearAllFilters = () => {
    setOutletFilter('ALL')
    setSearchInput('')
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const hasActiveFilters = search || outletFilter !== 'ALL' || dateFrom || dateTo

  if (error) {
    return <ErrorState onRetry={fetchTransactions} />
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
          <Input
            type="text"
            placeholder="Cari invoice, nama customer..."
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

        <Select value={outletFilter} onValueChange={(v) => { setOutletFilter(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-44 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs">
            <SelectValue placeholder="Semua Cabang" />
          </SelectTrigger>
          <SelectContent className="bg-white/[0.04] border-white/[0.08]">
            <SelectItem value="ALL" className="text-slate-200 focus:bg-white/[0.06] text-xs">
              Semua Cabang
            </SelectItem>
            {outlets.map((outlet) => (
              <SelectItem key={outlet.id} value={outlet.id} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                {outlet.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500 pointer-events-none" />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className="pl-7 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs w-[130px] sm:w-auto"
            />
          </div>
          <span className="text-slate-600 text-xs">—</span>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500 pointer-events-none" />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className="pl-7 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs w-[130px] sm:w-auto"
            />
          </div>
        </div>

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
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer"
              onClick={handleClearSearch}
            >
              Cari: &quot;{search}&quot;
              <X className="h-2.5 w-2.5 ml-0.5" />
            </Badge>
          )}
          {outletFilter !== 'ALL' && (
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer"
              onClick={() => { setOutletFilter('ALL'); setPage(1) }}
            >
              <Store className="h-2.5 w-2.5" />
              {outlets.find((o) => o.id === outletFilter)?.name || outletFilter}
              <X className="h-2.5 w-2.5 ml-0.5" />
            </Badge>
          )}
          {dateFrom && (
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer"
              onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
            >
              {dateFrom}{dateTo && dateTo !== dateFrom ? ` – ${dateTo}` : ''}
              <X className="h-2.5 w-2.5 ml-0.5" />
            </Badge>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <TableRowsSkeleton rows={6} />
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Belum ada transaksi"
          description={hasActiveFilters ? 'Tidak ada transaksi yang cocok dengan filter' : 'Transaksi akan muncul setelah ada penjualan'}
          action={
            hasActiveFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAllFilters}
                className="text-slate-500 hover:text-slate-300 text-xs h-7"
              >
                Reset semua filter
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {/* Mobile Card View */}
          <div className="md:hidden space-y-2">
            {transactions.map((tx) => {
              const PayIcon = getPaymentIcon(tx.paymentMethod)
              return (
                <Card key={tx.id} className="bg-nebula border-white/[0.06] rounded-xl p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <Receipt className="h-3.5 w-3.5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">{tx.invoiceNumber}</p>
                        <p className="text-[10px] text-slate-500">{formatDate(tx.createdAt)}</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-white shrink-0">
                      {formatCurrency(tx.total)}
                    </p>
                  </div>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Outlet</span>
                      <span className="text-slate-300 truncate max-w-[160px]">{tx.outletName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Kasir</span>
                      <span className="text-slate-300 truncate max-w-[160px]">{tx.cashierName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Metode</span>
                      <span className="text-slate-300 flex items-center gap-1">
                        <PayIcon className="h-3 w-3" />
                        {getPaymentLabel(tx.paymentMethod)}
                      </span>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block rounded-xl border border-white/[0.06] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent bg-nebula/50">
                  <TableHead className="text-slate-500 text-[11px] font-medium">Invoice</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Tanggal</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Outlet</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Kasir</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-center">Metode</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const PayIcon = getPaymentIcon(tx.paymentMethod)
                  return (
                    <TableRow
                      key={tx.id}
                      className="border-white/[0.06] hover:bg-white/[0.02] transition-colors"
                    >
                      <TableCell className="text-xs text-white font-medium py-3 px-4 whitespace-nowrap">
                        {tx.invoiceNumber}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 py-3 px-4 whitespace-nowrap">
                        {formatDate(tx.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-300 py-3 px-4">
                        <span className="flex items-center gap-1.5">
                          <Store className="h-3 w-3 text-slate-500" />
                          {tx.outletName}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 py-3 px-4">
                        {tx.cashierName}
                      </TableCell>
                      <TableCell className="text-center py-3 px-4">
                        <Badge className="bg-white/[0.04] border border-white/[0.08] text-slate-300 text-[10px] gap-1 px-1.5 py-0">
                          <PayIcon className="h-2.5 w-2.5" />
                          {getPaymentLabel(tx.paymentMethod)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-white font-semibold py-3 px-4 text-right">
                        {formatCurrency(tx.total)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}

// ============================== TAB 4: AUDIT LOG ==============================

function AuditLogTab({ outlets }: { outlets: { id: string; name: string }[] }) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [outletFilter, setOutletFilter] = useState<string>('ALL')
  const [actionFilter, setActionFilter] = useState<string>('ALL')
  const [entityFilter, setEntityFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (outletFilter !== 'ALL') params.set('outletId', outletFilter)
      if (actionFilter !== 'ALL') params.set('action', actionFilter)
      if (entityFilter !== 'ALL') params.set('entityType', entityFilter)
      if (search) params.set('search', search)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      const res = await fetch(`/api/multi-branch/audit-logs?${params}`)
      if (res.ok) {
        const json: AuditLogListResponse = await res.json()
        setLogs(json.logs)
        setTotalPages(json.totalPages)
      } else {
        setError(true)
        toast.error('Gagal memuat audit log')
      }
    } catch {
      setError(true)
      toast.error('Gagal memuat audit log')
    } finally {
      setLoading(false)
    }
  }, [page, outletFilter, actionFilter, entityFilter, search, dateFrom, dateTo])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

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
    if (e.key === 'Enter') handleSearch()
  }

  const handleClearAllFilters = () => {
    setOutletFilter('ALL')
    setActionFilter('ALL')
    setEntityFilter('ALL')
    setSearchInput('')
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const hasActiveFilters =
    search || outletFilter !== 'ALL' || actionFilter !== 'ALL' || entityFilter !== 'ALL' || dateFrom || dateTo

  // Parse details for display
  const parseDetails = (details: string | null): string => {
    if (!details) return '-'
    try {
      const parsed = JSON.parse(details)
      if (typeof parsed === 'string') return parsed
      // Show first few key-value pairs
      const entries = Object.entries(parsed).slice(0, 3)
      if (entries.length === 0) return '-'
      return entries
        .map(([key, value]) => {
          const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
          const displayValue = typeof value === 'number' && key.toLowerCase().includes('price') || key.toLowerCase().includes('total') || key.toLowerCase().includes('hpp')
            ? formatCurrency(value as number)
            : String(value)
          return `${label}: ${displayValue}`
        })
        .join(' • ')
    } catch {
      return details
    }
  }

  if (error) {
    return <ErrorState onRetry={fetchLogs} />
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
          <Input
            type="text"
            placeholder="Cari nama, aksi, entitas..."
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

        <Select value={outletFilter} onValueChange={(v) => { setOutletFilter(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-40 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs">
            <SelectValue placeholder="Semua Cabang" />
          </SelectTrigger>
          <SelectContent className="bg-white/[0.04] border-white/[0.08]">
            <SelectItem value="ALL" className="text-slate-200 focus:bg-white/[0.06] text-xs">
              Semua Cabang
            </SelectItem>
            {outlets.map((outlet) => (
              <SelectItem key={outlet.id} value={outlet.id} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                {outlet.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-36 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs">
            <SelectValue placeholder="Semua Aksi" />
          </SelectTrigger>
          <SelectContent className="bg-white/[0.04] border-white/[0.08]">
            <SelectItem value="ALL" className="text-slate-200 focus:bg-white/[0.06] text-xs">
              Semua Aksi
            </SelectItem>
            {ACTION_TYPES.map((action) => (
              <SelectItem key={action} value={action} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                {ACTION_LABELS[action] || action}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-36 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs">
            <SelectValue placeholder="Semua Entitas" />
          </SelectTrigger>
          <SelectContent className="bg-white/[0.04] border-white/[0.08]">
            <SelectItem value="ALL" className="text-slate-200 focus:bg-white/[0.06] text-xs">
              Semua Entitas
            </SelectItem>
            {ENTITY_TYPES.map((entity) => (
              <SelectItem key={entity} value={entity} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                {ENTITY_LABELS[entity] || entity}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer"
              onClick={handleClearSearch}
            >
              Cari: &quot;{search}&quot;
              <X className="h-2.5 w-2.5 ml-0.5" />
            </Badge>
          )}
          {outletFilter !== 'ALL' && (
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer"
              onClick={() => { setOutletFilter('ALL'); setPage(1) }}
            >
              <Store className="h-2.5 w-2.5" />
              {outlets.find((o) => o.id === outletFilter)?.name || outletFilter}
              <X className="h-2.5 w-2.5 ml-0.5" />
            </Badge>
          )}
          {actionFilter !== 'ALL' && (
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer"
              onClick={() => { setActionFilter('ALL'); setPage(1) }}
            >
              {ACTION_LABELS[actionFilter] || actionFilter}
              <X className="h-2.5 w-2.5 ml-0.5" />
            </Badge>
          )}
          {entityFilter !== 'ALL' && (
            <Badge
              variant="outline"
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 text-[11px] gap-1 px-2 py-0.5 cursor-pointer"
              onClick={() => { setEntityFilter('ALL'); setPage(1) }}
            >
              {ENTITY_LABELS[entityFilter] || entityFilter}
              <X className="h-2.5 w-2.5 ml-0.5" />
            </Badge>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <TableRowsSkeleton rows={6} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Belum ada audit log"
          description={hasActiveFilters ? 'Tidak ada audit log yang cocok dengan filter' : 'Aktivitas akan tercatat di sini'}
          action={
            hasActiveFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAllFilters}
                className="text-slate-500 hover:text-slate-300 text-xs h-7"
              >
                Reset semua filter
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {/* Mobile Card View */}
          <div className="md:hidden space-y-2">
            {logs.map((log) => {
              const actionConfig = getActionColorConfig(log.action)
              return (
                <div
                  key={log.id}
                  className={`rounded-xl border-l-4 ${actionConfig.leftBorder} border border-white/[0.06] bg-nebula p-3.5 transition-colors`}
                >
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={`w-7 h-7 rounded-lg ${actionConfig.iconBg} flex items-center justify-center shrink-0`}>
                      <actionConfig.icon className={`h-3.5 w-3.5 ${actionConfig.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <ActionBadge action={log.action} />
                        <Badge variant="outline" className="bg-white/[0.04] border-white/[0.08] text-slate-400 text-[10px] px-1.5 py-0">
                          {ENTITY_LABELS[log.entityType] || log.entityType}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(log.createdAt)}</p>
                    </div>
                  </div>
                  {log.entityName && (
                    <p className="text-xs text-slate-300 mb-1 truncate">
                      <span className="text-slate-500">Entitas: </span>
                      {log.entityName}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-500">Oleh</span>
                    <span className="text-slate-300">{log.userName}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Outlet</span>
                    <span className="text-slate-300 truncate max-w-[160px]">{log.outletName}</span>
                  </div>
                  {log.details && (
                    <div className="mt-2 pt-2 border-t border-white/[0.04]">
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        {parseDetails(log.details)}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block rounded-xl border border-white/[0.06] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent bg-nebula/50">
                  <TableHead className="text-slate-500 text-[11px] font-medium w-10"></TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Waktu</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">User</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Outlet</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-center">Aksi</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Entitas</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const actionConfig = getActionColorConfig(log.action)
                  return (
                    <TableRow
                      key={log.id}
                      className={`border-white/[0.06] transition-colors border-l-2 ${actionConfig.leftBorder}`}
                    >
                      <TableCell className="py-3 px-3">
                        <div className={`w-2 h-2 rounded-full ${actionConfig.dotColor}`} />
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 py-3 px-3 whitespace-nowrap">
                        {formatDate(log.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-300 py-3 px-3">
                        {log.userName}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 py-3 px-3">
                        <span className="flex items-center gap-1">
                          <Store className="h-3 w-3 text-slate-600" />
                          {log.outletName}
                        </span>
                      </TableCell>
                      <TableCell className="text-center py-3 px-3">
                        <ActionBadge action={log.action} />
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 py-3 px-3">
                        <Badge variant="outline" className="bg-white/[0.04] border-white/[0.08] text-slate-400 text-[10px] px-1.5 py-0">
                          {ENTITY_LABELS[log.entityType] || log.entityType}
                          {log.entityName && `: ${log.entityName}`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 py-3 px-3 max-w-xs">
                        <p className="text-[11px] text-slate-500 truncate">{parseDetails(log.details)}</p>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}

// Audit log action color config helper
function getActionColorConfig(action: string) {
  const configs: Record<string, {
    icon: React.ElementType
    color: string
    iconBg: string
    leftBorder: string
    dotColor: string
  }> = {
    CREATE: { icon: Plus, color: 'text-emerald-400', iconBg: 'bg-emerald-500/10', leftBorder: 'border-l-emerald-500', dotColor: 'bg-emerald-500' },
    SALE: { icon: ShoppingCart, color: 'text-sky-400', iconBg: 'bg-sky-500/10', leftBorder: 'border-l-sky-500', dotColor: 'bg-sky-500' },
    RESTOCK: { icon: Package, color: 'text-amber-400', iconBg: 'bg-amber-500/10', leftBorder: 'border-l-amber-500', dotColor: 'bg-amber-500' },
    UPDATE: { icon: Pencil, color: 'text-violet-400', iconBg: 'bg-violet-500/10', leftBorder: 'border-l-violet-500', dotColor: 'bg-violet-500' },
    DELETE: { icon: Ban, color: 'text-red-400', iconBg: 'bg-red-500/10', leftBorder: 'border-l-red-500', dotColor: 'bg-red-500' },
    TRANSFER: { icon: ArrowRightLeft, color: 'text-cyan-400', iconBg: 'bg-cyan-500/10', leftBorder: 'border-l-cyan-500', dotColor: 'bg-cyan-500' },
    ADJUSTMENT: { icon: SlidersHorizontal, color: 'text-zinc-300', iconBg: 'bg-zinc-500/10', leftBorder: 'border-l-zinc-400', dotColor: 'bg-zinc-400' },
    VOID: { icon: Ban, color: 'text-red-400', iconBg: 'bg-red-500/10', leftBorder: 'border-l-red-500', dotColor: 'bg-red-500' },
  }
  return configs[action] || {
    icon: RotateCcw,
    color: 'text-zinc-400',
    iconBg: 'bg-zinc-500/10',
    leftBorder: 'border-l-zinc-600',
    dotColor: 'bg-zinc-600',
  }
}

// ============================== TAB 5: CREW ==============================

function CrewTab({ outlets }: { outlets: { id: string; name: string }[] }) {
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [outletFilter, setOutletFilter] = useState<string>('ALL')

  const fetchCrew = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams()
      if (outletFilter !== 'ALL') params.set('outletId', outletFilter)
      const res = await fetch(`/api/multi-branch/crew?${params}`)
      if (res.ok) {
        const json: CrewListResponse = await res.json()
        setCrew(json.crew)
      } else {
        setError(true)
        toast.error('Gagal memuat data crew')
      }
    } catch {
      setError(true)
      toast.error('Gagal memuat data crew')
    } finally {
      setLoading(false)
    }
  }, [outletFilter])

  useEffect(() => {
    fetchCrew()
  }, [fetchCrew])

  if (error) {
    return <ErrorState onRetry={fetchCrew} />
  }

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center gap-2">
        <Select value={outletFilter} onValueChange={setOutletFilter}>
          <SelectTrigger className="w-full sm:w-44 bg-white/[0.04] border-white/[0.08] text-white h-8 text-xs">
            <SelectValue placeholder="Semua Cabang" />
          </SelectTrigger>
          <SelectContent className="bg-white/[0.04] border-white/[0.08]">
            <SelectItem value="ALL" className="text-slate-200 focus:bg-white/[0.06] text-xs">
              Semua Cabang
            </SelectItem>
            {outlets.map((outlet) => (
              <SelectItem key={outlet.id} value={outlet.id} className="text-slate-200 focus:bg-white/[0.06] text-xs">
                {outlet.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!loading && crew.length > 0 && (
          <Badge className="bg-white/[0.04] border border-white/[0.08] text-slate-400 text-[10px] px-1.5 py-0">
            {crew.length} crew
          </Badge>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <CardGridSkeleton count={6} />
      ) : crew.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="Belum ada crew"
          description={outletFilter !== 'ALL' ? 'Tidak ada crew di cabang ini' : 'Tambahkan crew ke outlet Anda'}
        />
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        >
          {crew.map((member) => (
            <motion.div key={member.id} variants={itemVariants}>
              <Card className="bg-nebula border-white/[0.06] rounded-xl hover:border-white/[0.12] transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500/20 via-purple-500/20 to-cyan-500/20 flex items-center justify-center shrink-0 border border-white/[0.06]">
                        <span className="text-xs font-semibold text-slate-300">
                          {member.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{member.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">{member.email}</p>
                      </div>
                    </div>
                    <RoleBadge role={member.role} />
                  </div>

                  <Separator className="bg-white/[0.04] mb-3" />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <Store className="h-3 w-3" />
                        Outlet
                      </span>
                      <span className="text-slate-300 truncate max-w-[160px]">{member.outletName}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <Calendar className="h-3 w-3" />
                        Bergabung
                      </span>
                      <span className="text-slate-300">{formatDate(member.joinDate)}</span>
                    </div>
                  </div>

                  {/* Permissions */}
                  {member.permissions && member.permissions.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/[0.04]">
                      <p className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1">
                        <Shield className="h-2.5 w-2.5" />
                        Hak Akses
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {member.permissions.map((perm) => (
                          <Badge
                            key={perm}
                            variant="outline"
                            className="bg-white/[0.03] border-white/[0.06] text-slate-400 text-[9px] px-1.5 py-0"
                          >
                            {perm}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
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
    { value: 'transaksi', label: 'Transaksi', icon: FileText },
    { value: 'audit', label: 'Audit Log', icon: ClipboardList },
    { value: 'crew', label: 'Crew', icon: UserCog },
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

          <TabsContent value="transaksi" className="mt-0">
            <TransaksiTab outlets={outlets} />
          </TabsContent>

          <TabsContent value="audit" className="mt-0">
            <AuditLogTab outlets={outlets} />
          </TabsContent>

          <TabsContent value="crew" className="mt-0">
            <CrewTab outlets={outlets} />
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  )
}