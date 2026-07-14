'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber, formatDate } from '@/lib/format'
import { usePlan, useFeatureGate } from '@/hooks/use-plan'
import { usePageStore } from '@/hooks/use-page-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Pagination } from '@/components/shared/pagination'
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
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  Loader2,
  Coins,
  Crown,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  History,
  Lock,
  Sparkles,
  MinusCircle,
  PlusCircle,
  Users,
  UserPlus,
  Trophy,
  BarChart3,
  TrendingUp,
} from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import CustomerFormDialog from './customer-form-dialog'

// ============================================================
// Types
// ============================================================

interface Customer {
  id: string
  name: string
  whatsapp: string
  totalSpend: number
  points: number
}

interface CustomerStats {
  total: number
  totalPoints: number
  avgSpend: number
  newThisMonth: number
}

interface CustomerListResponse {
  customers: Customer[]
  totalPages: number
  stats: CustomerStats
}

interface LoyaltyLog {
  id: string
  type: string
  points: number
  description: string
  createdAt: string
}

interface PurchaseItem {
  productName: string
  qty: number
  price: number
  subtotal: number
}

interface Purchase {
  id: string
  invoiceNumber: string
  date: string
  itemCount: number
  total: number
  paymentMethod: string
  items: PurchaseItem[]
}

// ============================================================
// Tier calculation (client-side)
// ============================================================

type CustomerTier = 'New' | 'Regular' | 'VIP'

function getTier(totalSpend: number): CustomerTier {
  if (totalSpend === 0) return 'New'
  if (totalSpend < 500000) return 'Regular'
  return 'VIP'
}

function getTierBadgeClass(tier: CustomerTier): string {
  switch (tier) {
    case 'New':
      return 'bg-slate-500/10 border-slate-500/20 text-slate-400'
    case 'Regular':
      return 'bg-blue-500/10 border-blue-500/20 text-blue-400'
    case 'VIP':
      return 'bg-amber-500/10 border-amber-500/20 text-amber-400'
  }
}

function getNextTierInfo(tier: CustomerTier, totalSpend: number): { label: string; target: number; progress: number } | null {
  if (tier === 'VIP') return null // Already max tier
  if (tier === 'New') {
    return { label: 'Regular', target: 1, progress: 0 }
  }
  // Regular → VIP (500K)
  return { label: 'VIP', target: 500000, progress: Math.min(100, (totalSpend / 500000) * 100) }
}

// ============================================================
// Component
// ============================================================

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Loyalty history sheet
  const [loyaltyOpen, setLoyaltyOpen] = useState(false)
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<Customer | null>(null)
  const [loyaltyLogs, setLoyaltyLogs] = useState<LoyaltyLog[]>([])
  const [loyaltyLoading, setLoyaltyLoading] = useState(false)

  // Purchase history sheet
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [purchaseCustomer, setPurchaseCustomer] = useState<Customer | null>(null)
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [expandedTx, setExpandedTx] = useState<string | null>(null)

  // Manual points adjust dialog
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustCustomer, setAdjustCustomer] = useState<Customer | null>(null)
  const [adjustType, setAdjustType] = useState<'ADD' | 'DEDUCT'>('ADD')
  const [adjustPoints, setAdjustPoints] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  // Plan gating
  const { setCurrentPage } = usePageStore()
  const { plan, features } = usePlan()
  const isPro = plan?.type === 'pro' || plan?.type === 'enterprise'

  // Stats from API
  const [stats, setStats] = useState<CustomerStats>({ total: 0, totalPoints: 0, avgSpend: 0, newThisMonth: 0 })

  // Analytics collapsible
  const [analyticsOpen, setAnalyticsOpen] = useState(false)

  // Computed analytics from customer list
  const analytics = useMemo(() => {
    const totalCustomers = customers.length
    const newThisMonth = customers.filter((c) => {
      // We don't have createdAt in Customer interface, so this is approximated
      // Using tier=New as proxy for new customers
      return getTier(c.totalSpend) === 'New'
    }).length
    const totalPoints = customers.reduce((sum, c) => sum + c.points, 0)
    const topSpenders = [...customers]
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 3)
    const tierDistribution = {
      New: customers.filter((c) => getTier(c.totalSpend) === 'New').length,
      Regular: customers.filter((c) => getTier(c.totalSpend) === 'Regular').length,
      VIP: customers.filter((c) => getTier(c.totalSpend) === 'VIP').length,
    }
    return { totalCustomers, newThisMonth, totalPoints, topSpenders, tierDistribution }
  }, [customers])

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/customers?${params}`)
      if (res.ok) {
        const data: CustomerListResponse = await res.json()
        setCustomers(data.customers)
        setTotalPages(data.totalPages)
        if (data.stats) setStats(data.stats)
      } else {
        toast.error('Failed to load customers')
      }
    } catch {
      toast.error('Failed to load customers')
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
     
    void fetchCustomers()
  }, [fetchCustomers])

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const handleEdit = (customer: Customer) => {
    setEditCustomer(customer)
    setFormOpen(true)
  }

  const handleAdd = () => {
    setEditCustomer(null)
    setFormOpen(true)
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/customers/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Customer deleted')
        fetchCustomers()
      } else {
        toast.error('Failed to delete customer')
      }
    } catch {
      toast.error('Failed to delete customer')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const handleViewLoyalty = async (customer: Customer) => {
    setLoyaltyCustomer(customer)
    setLoyaltyOpen(true)
    setLoyaltyLoading(true)
    try {
      const res = await fetch(`/api/customers/${customer.id}/loyalty`)
      if (res.ok) {
        const data = await res.json()
        setLoyaltyLogs(data.logs || [])
      }
    } catch {
      toast.error('Failed to load loyalty history')
    } finally {
      setLoyaltyLoading(false)
    }
  }

  const handleViewPurchases = async (customer: Customer) => {
    if (!isPro) {
      setPurchaseCustomer(customer)
      setPurchaseOpen(true)
      setPurchases([])
      return
    }
    setPurchaseCustomer(customer)
    setPurchaseOpen(true)
    setPurchaseLoading(true)
    setExpandedTx(null)
    try {
      const res = await fetch(`/api/customers/${customer.id}/purchases`)
      if (res.ok) {
        const data = await res.json()
        setPurchases(data.purchases || [])
      }
    } catch {
      toast.error('Failed to load purchase history')
    } finally {
      setPurchaseLoading(false)
    }
  }

  const handleAdjustPoints = (customer: Customer) => {
    setAdjustCustomer(customer)
    setAdjustType('ADD')
    setAdjustPoints('')
    setAdjustReason('')
    setAdjustOpen(true)
  }

  const submitAdjustPoints = async () => {
    if (!adjustCustomer) return
    const pts = parseInt(adjustPoints)
    if (!pts || pts <= 0) {
      toast.error('Points must be greater than 0')
      return
    }
    if (!adjustReason.trim()) {
      toast.error('Reason is required')
      return
    }

    setAdjusting(true)
    try {
      const res = await fetch(`/api/customers/${adjustCustomer.id}/loyalty/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: adjustType,
          points: pts,
          reason: adjustReason.trim(),
        }),
      })
      if (res.ok) {
        toast.success(`Points ${adjustType === 'ADD' ? 'added' : 'deducted'} successfully`)
        setAdjustOpen(false)
        // Refresh loyalty logs if open
        if (loyaltyOpen && adjustCustomer.id === loyaltyCustomer?.id) {
          handleViewLoyalty(adjustCustomer)
        }
        // Refresh customer list
        fetchCustomers()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to adjust points')
      }
    } catch {
      toast.error('Failed to adjust points')
    } finally {
      setAdjusting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Total Customers */}
          <div className="rounded-lg border border-white/[0.06] bg-nebula p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg theme-bg-very-light border theme-border-light flex items-center justify-center shrink-0">
                <Users className="h-4 w-4 theme-text" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 truncate">Total Pelanggan</p>
                <p className="text-lg font-bold text-white leading-tight">{formatNumber(stats.total)}</p>
              </div>
            </div>
          </div>

          {/* Total Loyalty Points */}
          <div className="rounded-lg border border-white/[0.06] bg-nebula p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <Coins className="h-4 w-4 text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 truncate">Total Poin Loyalti</p>
                <p className="text-lg font-bold text-white leading-tight">{formatNumber(stats.totalPoints)}</p>
              </div>
            </div>
          </div>

          {/* Average Spend */}
          <div className="rounded-lg border border-white/[0.06] bg-nebula p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                <TrendingUp className="h-4 w-4 text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 truncate">Rata-rata Belanja</p>
                <p className="text-lg font-bold text-white leading-tight">{formatCurrency(stats.avgSpend)}</p>
              </div>
            </div>
          </div>

          {/* New This Month */}
          <div className="rounded-lg border border-white/[0.06] bg-nebula p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                <UserPlus className="h-4 w-4 text-violet-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 truncate">Pelanggan Baru</p>
                <p className="text-lg font-bold text-white leading-tight">{formatNumber(stats.newThisMonth)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Section */}
      {!loading && customers.length > 0 && (
        <Collapsible open={analyticsOpen} onOpenChange={setAnalyticsOpen}>
          <div className="rounded-lg border border-white/[0.06] bg-nebula/50 overflow-hidden">
            <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] transition-colors">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-3.5 w-3.5 theme-text" />
                <span className="text-xs font-semibold text-slate-200">Analitik</span>
                <Badge className="theme-bg-very-light theme-border-light theme-text text-[10px] px-1.5 py-0">
                  {analytics.totalCustomers} customer
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-3">
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <UserPlus className="h-3 w-3" />
                    <span>{analytics.newThisMonth} baru</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <Coins className="h-3 w-3 text-amber-400" />
                    <span>{formatNumber(analytics.totalPoints)} pts</span>
                  </div>
                </div>
                {analyticsOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                )}
              </div>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="px-4 pb-3">
                {/* Mobile mini stats */}
                <div className="sm:hidden flex items-center gap-3 mb-3">
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <UserPlus className="h-3 w-3" />
                    <span>{analytics.newThisMonth} baru</span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <Coins className="h-3 w-3 text-amber-400" />
                    <span>{formatNumber(analytics.totalPoints)} pts</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Top Spenders */}
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                    <h3 className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                      <Trophy className="h-3 w-3 text-amber-400" />
                      Top Spenders
                    </h3>
                    <div className="space-y-1.5">
                      {analytics.topSpenders.length === 0 ? (
                        <p className="text-[11px] text-slate-500">Belum ada data</p>
                      ) : (
                        analytics.topSpenders.map((c, i) => (
                          <div key={c.id} className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`text-[10px] font-bold w-4 text-center ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : 'text-orange-400'}`}>#{i + 1}</span>
                              <span className="text-xs text-slate-200 truncate">{c.name}</span>
                            </div>
                            <span className="text-xs font-medium text-slate-300 ml-2 shrink-0">{formatCurrency(c.totalSpend)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Tier Distribution */}
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                    <h3 className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                      <Users className="h-3 w-3 theme-text" />
                      Distribusi Tier
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge className={`${getTierBadgeClass('New')} text-[10px] font-medium border px-2 py-0.5`}>
                        New: {analytics.tierDistribution.New}
                      </Badge>
                      <Badge className={`${getTierBadgeClass('Regular')} text-[10px] font-medium border px-2 py-0.5`}>
                        Regular: {analytics.tierDistribution.Regular}
                      </Badge>
                      <Badge className={`${getTierBadgeClass('VIP')} text-[10px] font-medium border px-2 py-0.5`}>
                        <Crown className="mr-0.5 h-2.5 w-2.5" />
                        VIP: {analytics.tierDistribution.VIP}
                      </Badge>
                    </div>
                  </div>

                  {/* Total Loyalty Points */}
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                    <h3 className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                      <Coins className="h-3 w-3 text-amber-400" />
                      Total Poin Loyalti
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-amber-400">{formatNumber(analytics.totalPoints)}</span>
                      <span className="text-[11px] text-slate-500">poin tersebar di {analytics.totalCustomers} customer</span>
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* Header & Instructions */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Pelanggan</h1>
            <p className="text-xs text-slate-500 mt-0.5">Kelola database pelanggan & program loyalti</p>
          </div>
          <Button onClick={handleAdd} className="theme-bg hover:theme-hover text-white h-8 text-xs">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Tambah Pelanggan
          </Button>
        </div>

        {/* Rich Text Instructions */}
        <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2.5">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <Users className="h-4 w-4 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xs font-semibold text-slate-200 mb-1">Database Pelanggan & Loyalti</h3>
              <div className="text-[11px] text-slate-400 leading-relaxed space-y-1.5">
                <p>
                  Kelola data pelanggan Anda di satu tempat. Setiap transaksi yang terhubung ke pelanggan otomatis menambah <span className="text-amber-400 font-medium">poin loyalti</span> dan meningkatkan <span className="text-slate-200 font-medium">tier membership</span>.
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <div className="h-5 w-5 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-emerald-400">1</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed"><span className="text-slate-200 font-medium">Tambah pelanggan</span> — Isi nama & nomor WhatsApp. Pelanggan otomatis naik tier berdasarkan total belanja.</p>
            </div>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <div className="h-5 w-5 rounded-md bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-amber-400">2</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed"><span className="text-slate-200 font-medium">Transaksi terhubung</span> — Pilih pelanggan saat checkout di POS untuk akumulasi poin & riwayat belanja.</p>
            </div>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <div className="h-5 w-5 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-violet-400">3</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed"><span className="text-slate-200 font-medium">Loyalti & tier</span> — Lihat riwayat poin, naikkan tier (New → Regular → VIP), dan pantau pembelian.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <Crown className="h-3 w-3 text-amber-400 shrink-0" />
            <p className="text-[10px] text-slate-500">
              <span className="text-slate-400 font-medium">Tier otomatis:</span>
              {' '}New (Rp0) → Regular (Rp1–500K) → VIP (Rp500K+). Poin bisa ditukar diskon di POS.
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
        <Input
          placeholder="Cari nama atau WhatsApp..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 sm:h-10 text-xs bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 bg-nebula rounded" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-nebula/50 p-8 sm:p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
            <Users className="h-7 w-7 text-slate-600" />
          </div>
          <h3 className="text-sm font-bold text-white mb-1">Belum Ada Pelanggan</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed mb-4">
            Mulai tambahkan pelanggan untuk mengaktifkan program loyalti, tracking pembelian, dan analitik pelanggan.
          </p>
          <Button onClick={handleAdd} variant="outline" className="theme-bg hover:theme-hover text-white border-transparent h-8 text-xs gap-1.5">
            <UserPlus className="h-3.5 w-3.5" />
            Tambah Pelanggan Pertama
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Mobile card view */}
          <div className="md:hidden space-y-2">
            {customers.map((customer) => {
              const tier = getTier(customer.totalSpend)
              return (
                <div
                  key={customer.id}
                  className="rounded-xl bg-nebula border border-white/[0.06] p-3 cursor-pointer"
                  onClick={() => handleViewPurchases(customer)}
                >
                  {/* Top row: Name + Tier badge */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-200 font-semibold truncate mr-2">{customer.name}</span>
                    <Badge className={`${getTierBadgeClass(tier)} text-[10px] font-medium border px-1.5 py-0 shrink-0`}>
                      {tier === 'VIP' && <Crown className="mr-0.5 h-2.5 w-2.5" />}
                      {tier}
                    </Badge>
                  </div>
                  {/* Middle row: WhatsApp + Total spend */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">{customer.whatsapp}</span>
                    <span className="text-xs text-slate-200 font-medium">{formatCurrency(customer.totalSpend)}</span>
                  </div>
                  {/* Bottom row: Points badge + Action buttons */}
                  <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                    <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">
                      <Coins className="mr-0.5 h-2.5 w-2.5" />
                      {formatNumber(customer.points)} pts
                    </Badge>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                        onClick={() => handleViewPurchases(customer)}
                        title="Riwayat"
                      >
                        <History className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                        onClick={() => handleViewLoyalty(customer)}
                        title="Loyalty"
                      >
                        <Coins className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                        onClick={() => handleEdit(customer)}
                        title="Edit"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                        onClick={() => setDeleteId(customer.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block rounded-lg border border-white/[0.06] overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent">
                  <TableHead className="text-slate-500 text-[11px] font-medium">Name</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium hidden sm:table-cell">WhatsApp</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium">Tier</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-right">Total Spend</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-center">Points</TableHead>
                  <TableHead className="text-slate-500 text-[11px] font-medium text-right w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => {
                  const tier = getTier(customer.totalSpend)
                  return (
                    <TableRow
                      key={customer.id}
                      className="border-white/[0.06] hover:bg-white/[0.03] cursor-pointer"
                      onClick={() => handleViewPurchases(customer)}
                    >
                      <TableCell className="text-xs text-slate-200 font-medium py-2.5 px-3">{customer.name}</TableCell>
                      <TableCell className="text-xs text-slate-400 py-2.5 px-3 hidden sm:table-cell">{customer.whatsapp}</TableCell>
                      <TableCell className="py-2.5 px-3">
                        <Badge className={`${getTierBadgeClass(tier)} text-[10px] font-medium border px-1.5 py-0`}>
                          {tier === 'VIP' && <Crown className="mr-0.5 h-2.5 w-2.5" />}
                          {tier}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-200 text-right py-2.5 px-3">{formatCurrency(customer.totalSpend)}</TableCell>
                      <TableCell className="text-center py-2.5 px-3">
                        <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">
                          <Coins className="mr-0.5 h-2.5 w-2.5" />
                          {formatNumber(customer.points)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                            onClick={() => handleViewPurchases(customer)}
                            title="Riwayat"
                          >
                            <History className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                            onClick={() => handleViewLoyalty(customer)}
                            title="Loyalty"
                          >
                            <Coins className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                            onClick={() => handleEdit(customer)}
                            title="Edit"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                            onClick={() => setDeleteId(customer.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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

      {/* Customer Form Dialog */}
      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        customer={editCustomer}
        onSaved={fetchCustomers}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-sm font-semibold">Delete Customer</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              Are you sure? This will permanently delete this customer and their loyalty history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] h-8 text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs"
            >
              {deleting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Loyalty History Sheet */}
      <Sheet open={loyaltyOpen} onOpenChange={setLoyaltyOpen}>
        <SheetContent className="bg-nebula border-white/[0.06] w-full sm:max-w-md p-0">
          <SheetHeader className="p-4 pb-3">
            <SheetTitle className="text-white text-sm font-semibold flex items-center gap-2">
              <Coins className="h-4 w-4 text-amber-400" />
              Loyalty — {loyaltyCustomer?.name}
            </SheetTitle>
          </SheetHeader>
          {loyaltyCustomer && (
            <div className="px-4 pb-4 space-y-3">
              {/* Customer summary */}
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Tier</span>
                  <Badge className={`${getTierBadgeClass(getTier(loyaltyCustomer.totalSpend))} text-[10px] font-medium border px-1.5 py-0`}>
                    {getTier(loyaltyCustomer.totalSpend) === 'VIP' && <Crown className="mr-0.5 h-2.5 w-2.5" />}
                    {getTier(loyaltyCustomer.totalSpend)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Total Spend</span>
                  <span className="text-xs font-semibold text-slate-200">{formatCurrency(loyaltyCustomer.totalSpend)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Current Points</span>
                  <Badge className="bg-amber-500/20 border-amber-500/30 text-amber-400 text-[10px]">
                    {formatNumber(loyaltyCustomer.points)} pts
                  </Badge>
                </div>

                {/* Loyalty progress bar — points to next tier */}
                {(() => {
                  const tier = getTier(loyaltyCustomer.totalSpend)
                  const nextTier = getNextTierInfo(tier, loyaltyCustomer.totalSpend)
                  if (!nextTier) {
                    return (
                      <div className="pt-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-slate-500">Loyalty Progress</span>
                          <span className="text-[11px] text-amber-400 font-medium">Max tier reached! 🎉</span>
                        </div>
                        <Progress value={100} className="h-1.5 bg-white/[0.06] [&>div]:bg-amber-400" />
                      </div>
                    )
                  }
                  if (tier === 'New') {
                    return (
                      <div className="pt-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-slate-500">Loyalty Progress</span>
                          <span className="text-[11px] text-blue-400 font-medium">First purchase to unlock Regular</span>
                        </div>
                        <Progress value={0} className="h-1.5 bg-white/[0.06] [&>div]:bg-blue-400" />
                      </div>
                    )
                  }
                  return (
                    <div className="pt-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-slate-500">Loyalty Progress</span>
                        <span className="text-[11px] text-blue-400 font-medium">
                          {formatCurrency(loyaltyCustomer.totalSpend)} / {formatCurrency(nextTier.target)} ke {nextTier.label}
                        </span>
                      </div>
                      <Progress value={nextTier.progress} className="h-1.5 bg-white/[0.06] [&>div]:bg-blue-400" />
                    </div>
                  )
                })()}
              </div>

              {/* Manual adjust button — OWNER only */}
              {plan?.type && (
                <Button
                  variant="outline"
                  className="w-full border-white/[0.08] text-slate-300 hover:bg-white/[0.04] hover:text-white h-8 text-xs"
                  onClick={() => handleAdjustPoints(loyaltyCustomer)}
                >
                  <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                  Adjust Points (Manual)
                </Button>
              )}

              <Separator className="bg-white/[0.04]" />

              {/* Loyalty logs */}
              <div>
                <h3 className="text-xs font-semibold text-slate-300 mb-2">Points History</h3>
                {loyaltyLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 bg-white/[0.04] rounded" />
                    ))}
                  </div>
                ) : loyaltyLogs.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">No loyalty history</p>
                ) : (
                  <div className="space-y-1.5 max-h-96 overflow-y-auto">
                    {loyaltyLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <Badge
                            className={`text-[10px] ${
                              log.type === 'EARN'
                                ? 'theme-bg-very-light theme-border-light theme-text'
                                : log.type === 'ADJUST'
                                ? 'bg-violet-500/10 border-violet-500/20 text-violet-400'
                                : 'bg-red-500/10 border-red-500/20 text-red-400'
                            }`}
                          >
                            {log.type}
                          </Badge>
                          <span className={`text-xs font-semibold ${log.points > 0 ? 'theme-text' : 'text-red-400'}`}>
                            {log.points > 0 ? '+' : ''}{log.points} pts
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{log.description}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(log.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Purchase History Sheet */}
      <Sheet open={purchaseOpen} onOpenChange={setPurchaseOpen}>
        <SheetContent className="bg-nebula border-white/[0.06] w-full sm:max-w-md p-0">
          <SheetHeader className="p-4 pb-3">
            <SheetTitle className="text-white text-sm font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-blue-400" />
              Riwayat — {purchaseCustomer?.name}
            </SheetTitle>
          </SheetHeader>
          {purchaseCustomer && (
            <div className="px-4 pb-4 space-y-3">
              {/* Customer info header */}
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Tier</span>
                  <Badge className={`${getTierBadgeClass(getTier(purchaseCustomer.totalSpend))} text-[10px] font-medium border px-1.5 py-0`}>
                    {getTier(purchaseCustomer.totalSpend) === 'VIP' && <Crown className="mr-0.5 h-2.5 w-2.5" />}
                    {getTier(purchaseCustomer.totalSpend)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Total Spend</span>
                  <span className="text-xs font-semibold text-slate-200">{formatCurrency(purchaseCustomer.totalSpend)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Points</span>
                  <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">
                    {formatNumber(purchaseCustomer.points)} pts
                  </Badge>
                </div>
              </div>

              {/* Pro-gated content */}
              {!isPro ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-3 text-center">
                  <div className="h-12 w-12 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                    <Lock className="h-5 w-5 text-violet-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Fitur Pro</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Riwayat pembelian customer tersedia untuk akun Pro dan Enterprise.
                    </p>
                  </div>
                  <Button
                    className="bg-violet-500 hover:bg-violet-600 text-white h-8 text-xs"
                    onClick={() => setCurrentPage('plan')}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Upgrade ke Pro
                  </Button>
                </div>
              ) : (
                <>
                  <Separator className="bg-white/[0.04]" />

                  <div>
                    <h3 className="text-xs font-semibold text-slate-300 mb-2">Riwayat Transaksi</h3>
                    {purchaseLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-16 bg-white/[0.04] rounded" />
                        ))}
                      </div>
                    ) : purchases.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-6">Belum ada transaksi</p>
                    ) : (
                      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                        {purchases.map((purchase) => {
                          const isExpanded = expandedTx === purchase.id
                          return (
                            <div
                              key={purchase.id}
                              className="rounded-lg bg-white/[0.03] border border-white/[0.06] overflow-hidden"
                            >
                              {/* Transaction header — clickable to expand */}
                              <button
                                className="w-full p-2.5 flex items-center justify-between hover:bg-white/[0.04] transition-colors"
                                onClick={() => setExpandedTx(isExpanded ? null : purchase.id)}
                              >
                                <div className="flex-1 text-left min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <span className="text-xs font-medium text-slate-200 truncate">
                                      {purchase.invoiceNumber}
                                    </span>
                                    <Badge className="bg-white/[0.06] border-white/[0.08] text-slate-400 text-[10px] shrink-0 px-1 py-0">
                                      {purchase.paymentMethod}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                    <span>{formatDate(purchase.date)}</span>
                                    <span>{purchase.itemCount} item</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                  <span className="text-xs font-semibold text-slate-200">
                                    {formatCurrency(purchase.total)}
                                  </span>
                                  {isExpanded ? (
                                    <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                                  )}
                                </div>
                              </button>

                              {/* Expanded items */}
                              {isExpanded && (
                                <div className="px-2.5 pb-2.5 border-t border-white/[0.06]">
                                  <div className="pt-1.5 space-y-1">
                                    {purchase.items.map((item, idx) => (
                                      <div key={idx} className="flex items-center justify-between py-0.5">
                                        <div className="flex-1 min-w-0">
                                          <span className="text-[11px] text-slate-300 truncate block">{item.productName}</span>
                                          <span className="text-[10px] text-slate-500">
                                            {formatNumber(item.qty)} × {formatCurrency(item.price)}
                                          </span>
                                        </div>
                                        <span className="text-[11px] text-slate-400 shrink-0 ml-2">
                                          {formatCurrency(item.subtotal)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {/* Summary */}
                        <div className="pt-1.5 pb-0.5">
                          <p className="text-[11px] text-slate-500 text-center">
                            Total transaksi: {purchases.length}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Manual Adjust Points Dialog */}
      <ResponsiveDialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06] p-4" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold flex items-center gap-2">
              <Coins className="h-4 w-4 text-amber-400" />
              Adjust Points — {adjustCustomer?.name}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Tipe</Label>
              <Select value={adjustType} onValueChange={(v: 'ADD' | 'DEDUCT') => setAdjustType(v)}>
                <SelectTrigger className="h-8 text-xs bg-white/[0.04] border-white/[0.08] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white/[0.04] border-white/[0.08]">
                  <SelectItem value="ADD" className="text-white focus:bg-white/[0.06] focus:text-white text-xs">
                    <div className="flex items-center gap-2">
                      <PlusCircle className="h-3.5 w-3.5 theme-text" />
                      Tambah Poin (ADD)
                    </div>
                  </SelectItem>
                  <SelectItem value="DEDUCT" className="text-white focus:bg-white/[0.06] focus:text-white text-xs">
                    <div className="flex items-center gap-2">
                      <MinusCircle className="h-3.5 w-3.5 text-red-400" />
                      Kurangi Poin (DEDUCT)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Jumlah Poin</Label>
              <Input
                type="number"
                min="1"
                value={adjustPoints}
                onChange={(e) => setAdjustPoints(e.target.value)}
                placeholder="Masukkan jumlah poin"
                className="h-8 text-xs bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500"
              />
              {adjustCustomer && adjustType === 'DEDUCT' && (
                <p className="text-[11px] text-slate-500">
                  Poin tersedia: {formatNumber(adjustCustomer.points)} pts
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Alasan</Label>
              <Textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Contoh: Bonus ulang tahun, Kompensasi komplain, dll."
                rows={3}
                className="text-xs bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500"
              />
            </div>

            {/* Preview */}
            {adjustPoints && parseInt(adjustPoints) > 0 && (
              <div className={`p-2.5 rounded-lg border ${
                adjustType === 'ADD'
                  ? 'theme-bg-very-light theme-border-light'
                  : 'bg-red-500/10 border-red-500/20'
              }`}>
                <p className={`text-xs font-medium ${adjustType === 'ADD' ? 'theme-text' : 'text-red-400'}`}>
                  {adjustType === 'ADD' ? '+' : '-'}{formatNumber(parseInt(adjustPoints))} poin
                </p>
                {adjustCustomer && (
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Poin setelah: {formatNumber(
                      adjustType === 'ADD'
                        ? adjustCustomer.points + parseInt(adjustPoints)
                        : Math.max(0, adjustCustomer.points - parseInt(adjustPoints))
                    )} pts
                  </p>
                )}
              </div>
            )}
          </div>
          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAdjustOpen(false)}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={submitAdjustPoints}
              disabled={adjusting || !adjustPoints || !adjustReason.trim()}
              className={`${
                adjustType === 'ADD'
                  ? 'theme-bg hover:theme-hover'
                  : 'bg-red-500 hover:bg-red-600'
              } text-white h-8 text-xs`}
            >
              {adjusting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {adjustType === 'ADD' ? 'Tambah' : 'Kurangi'} Poin
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
