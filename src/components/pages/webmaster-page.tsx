'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { formatCurrency, formatNumber } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Globe,
  Store,
  Users,
  Receipt,
  DollarSign,
  Search,
  Plus,
  Eye,
  Pencil,
  Trash2,
  KeyRound,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Shield,
  UserCheck,
  TrendingUp,
  ArrowRight,
  X,
} from 'lucide-react'

// ── Types ──

interface OutletItem {
  id: string
  name: string
  address: string | null
  phone: string | null
  accountType: string
  createdAt: string
  updatedAt: string
  owner: { id: string; name: string; email: string } | null
  userCount: number
  transactionCount: number
  productCount: number
  customerCount: number
}

interface OutletDetail extends OutletItem {
  stats: {
    userCount: number
    transactionCount: number
    productCount: number
    customerCount: number
    categoryCount: number
    totalRevenue: number
  }
  recentTransactions: {
    id: string
    invoiceNumber: string
    total: number
    paymentMethod: string
    createdAt: string
  }[]
}

interface OwnerItem {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
  updatedAt: string
  outletId: string
  outlet: { id: string; name: string; accountType: string }
}

interface GlobalStats {
  totalOutlets: number
  totalOwners: number
  totalCrew: number
  totalTransactions: number
  totalProducts: number
  totalCustomers: number
  totalRevenue: number
  planBreakdown: Record<string, number>
  recentOutlets: OutletItem[]
}

// ── Animation variants ──

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
}

// ── Helpers ──

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function getPlanBadgeClass(accountType: string): string {
  const plan = accountType.startsWith('suspended:')
    ? accountType.replace('suspended:', '')
    : accountType
  switch (plan) {
    case 'pro': return 'bg-violet-500/10 border-violet-500/20 text-violet-400'
    case 'enterprise': return 'bg-amber-500/10 border-amber-500/20 text-amber-400'
    default: return 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'
  }
}

function getPlanLabel(accountType: string): string {
  const plan = accountType.startsWith('suspended:')
    ? accountType.replace('suspended:', '')
    : accountType
  switch (plan) {
    case 'pro': return 'Pro'
    case 'enterprise': return 'Enterprise'
    default: return 'Free'
  }
}

// ── Stat Card Component ──

function StatCard({ label, value, icon, color }: {
  label: string
  value: string | number
  icon: React.ReactNode
  color?: string
}) {
  return (
    <Card className="bg-zinc-900 border border-zinc-800/60 rounded-xl overflow-hidden relative">
      <div className={`absolute inset-0 bg-gradient-to-br ${color || 'from-emerald-500/[0.06] to-transparent'}`} />
      <CardContent className="p-3.5 relative">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
          <div className={`w-7 h-7 rounded-lg ${color ? color.replace('from-', 'bg-').split('/')[0].replace('[', '/').split(' ')[0] : 'bg-emerald-500/10'} flex items-center justify-center ${color ? 'text-violet-400' : 'text-emerald-400'}`}>
            {icon}
          </div>
        </div>
        <p className="text-xl font-bold text-zinc-100 tracking-tight">{value}</p>
      </CardContent>
    </Card>
  )
}

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════

export default function WebmasterPage() {
  const { data: session } = useSession()

  // Overview state
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  // Outlets state
  const [outlets, setOutlets] = useState<OutletItem[]>([])
  const [outletsLoading, setOutletsLoading] = useState(true)
  const [outletsPage, setOutletsPage] = useState(1)
  const [outletsTotalPages, setOutletsTotalPages] = useState(1)
  const [outletsSearch, setOutletsSearch] = useState('')

  // Owners state
  const [owners, setOwners] = useState<OwnerItem[]>([])
  const [ownersLoading, setOwnersLoading] = useState(true)
  const [ownersPage, setOwnersPage] = useState(1)
  const [ownersTotalPages, setOwnersTotalPages] = useState(1)
  const [ownersSearch, setOwnersSearch] = useState('')

  // Dialog states
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedOutlet, setSelectedOutlet] = useState<OutletDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Create outlet dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: '', address: '', phone: '', ownerName: '', ownerEmail: '', ownerPassword: '', accountType: 'free',
  })
  const [createLoading, setCreateLoading] = useState(false)

  // Edit outlet dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', address: '', phone: '', accountType: '' })
  const [editId, setEditId] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  // Reset password dialog
  const [resetOpen, setResetOpen] = useState(false)
  const [resetOutletId, setResetOutletId] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  // ── Fetchers ──

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/webmaster/stats')
      if (res.ok) setStats(await res.json())
    } catch { /* silent */ }
    finally { setStatsLoading(false) }
  }, [])

  const fetchOutlets = useCallback(async (page: number, search: string) => {
    setOutletsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/webmaster/outlets?${params}`)
      if (res.ok) {
        const data = await res.json()
        setOutlets(data.data)
        setOutletsTotalPages(data.pagination.totalPages)
      }
    } catch { /* silent */ }
    finally { setOutletsLoading(false) }
  }, [])

  const fetchOwners = useCallback(async (page: number, search: string) => {
    setOwnersLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/webmaster/owners?${params}`)
      if (res.ok) {
        const data = await res.json()
        setOwners(data.data)
        setOwnersTotalPages(data.pagination.totalPages)
      }
    } catch { /* silent */ }
    finally { setOwnersLoading(false) }
  }, [])

  const fetchOutletDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/webmaster/outlets/${id}`)
      if (res.ok) {
        setSelectedOutlet(await res.json())
        setDetailOpen(true)
      } else {
        toast.error('Gagal memuat detail outlet')
      }
    } catch {
      toast.error('Gagal memuat detail outlet')
    }
    finally { setDetailLoading(false) }
  }, [])

  // ── Effects ──

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { fetchOutlets(outletsPage, outletsSearch) }, [fetchOutlets, outletsPage, outletsSearch])
  useEffect(() => { fetchOwners(ownersPage, ownersSearch) }, [fetchOwners, ownersPage, ownersSearch])

  // ── Handlers ──

  const handleCreateOutlet = async () => {
    setCreateLoading(true)
    try {
      const res = await fetch('/api/webmaster/outlets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Outlet berhasil dibuat')
        setCreateOpen(false)
        setCreateForm({ name: '', address: '', phone: '', ownerName: '', ownerEmail: '', ownerPassword: '', accountType: 'free' })
        fetchOutlets(1, outletsSearch)
        fetchStats()
      } else {
        toast.error(data.error || 'Gagal membuat outlet')
      }
    } catch {
      toast.error('Gagal membuat outlet')
    }
    finally { setCreateLoading(false) }
  }

  const handleEditOutlet = async () => {
    setEditLoading(true)
    try {
      const res = await fetch(`/api/webmaster/outlets/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Outlet berhasil diperbarui')
        setEditOpen(false)
        fetchOutlets(outletsPage, outletsSearch)
        fetchStats()
        if (selectedOutlet?.id === editId) fetchOutletDetail(editId)
      } else {
        toast.error(data.error || 'Gagal memperbarui outlet')
      }
    } catch {
      toast.error('Gagal memperbarui outlet')
    }
    finally { setEditLoading(false) }
  }

  const handleDeleteOutlet = async (id: string) => {
    if (!confirm('Yakin ingin menghapus outlet ini? Semua data akan dihapus permanen.')) return
    try {
      const res = await fetch(`/api/webmaster/outlets/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        toast.success('Outlet berhasil dihapus')
        fetchOutlets(outletsPage, outletsSearch)
        fetchStats()
        if (detailOpen) setDetailOpen(false)
      } else {
        toast.error(data.error || 'Gagal menghapus outlet')
      }
    } catch {
      toast.error('Gagal menghapus outlet')
    }
  }

  const handleResetPassword = async () => {
    if (!resetPassword || resetPassword.length < 8) {
      toast.error('Password minimal 8 karakter')
      return
    }
    setResetLoading(true)
    try {
      const res = await fetch(`/api/webmaster/outlets/${resetOutletId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPassword }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Password owner berhasil direset')
        setResetOpen(false)
        setResetPassword('')
      } else {
        toast.error(data.error || 'Gagal reset password')
      }
    } catch {
      toast.error('Gagal reset password')
    }
    finally { setResetLoading(false) }
  }

  const openEdit = (outlet: OutletItem) => {
    setEditId(outlet.id)
    setEditForm({
      name: outlet.name,
      address: outlet.address || '',
      phone: outlet.phone || '',
      accountType: outlet.accountType.startsWith('suspended:')
        ? outlet.accountType.replace('suspended:', '')
        : outlet.accountType,
    })
    setEditOpen(true)
  }

  const openReset = (outletId: string) => {
    setResetOutletId(outletId)
    setResetPassword('')
    setResetOpen(true)
  }

  // ── Loading Skeleton ──

  if (statsLoading) {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-52 bg-zinc-800" />
          <Skeleton className="h-3.5 w-64 bg-zinc-800" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 bg-zinc-900 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 bg-zinc-900 rounded-2xl" />
      </div>
    )
  }

  return (
    <motion.div className="space-y-4" variants={containerVariants} initial="hidden" animate="visible">
      {/* ── Header ── */}
      <motion.div variants={itemVariants}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-violet-400" />
              <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Webmaster Panel</h1>
              <Badge className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px]">
                <Shield className="h-3 w-3 mr-1" />
                WEBMASTER
              </Badge>
            </div>
            <p className="text-sm text-zinc-500">Kelola semua outlet dan owner di seluruh sistem</p>
          </div>
          <Button
            className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium h-8 px-3 rounded-lg gap-1.5 shrink-0"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah Outlet
          </Button>
        </div>
      </motion.div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="overview" className="space-y-4">
        <motion.div variants={itemVariants}>
          <TabsList className="bg-zinc-900 border border-zinc-800/60 rounded-xl h-9 p-1">
            <TabsTrigger value="overview" className="text-xs gap-1.5 rounded-lg data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100">
              <TrendingUp className="h-3 w-3" />
              Ringkasan
            </TabsTrigger>
            <TabsTrigger value="outlets" className="text-xs gap-1.5 rounded-lg data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100">
              <Store className="h-3 w-3" />
              Outlet
            </TabsTrigger>
            <TabsTrigger value="owners" className="text-xs gap-1.5 rounded-lg data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100">
              <UserCheck className="h-3 w-3" />
              Owner
            </TabsTrigger>
          </TabsList>
        </motion.div>

        {/* ═══════════════════════════════════════════════════
            OVERVIEW TAB
        ═══════════════════════════════════════════════════ */}
        <TabsContent value="overview" className="mt-0 space-y-4">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <motion.div variants={itemVariants}>
              <StatCard
                label="Total Outlet"
                value={stats?.totalOutlets ?? 0}
                icon={<Store className="h-3.5 w-3.5 text-emerald-400" />}
              />
            </motion.div>
            <motion.div variants={itemVariants}>
              <StatCard
                label="Total Owner"
                value={stats?.totalOwners ?? 0}
                icon={<UserCheck className="h-3.5 w-3.5 text-violet-400" />}
                color="from-violet-500/[0.06] to-transparent"
              />
            </motion.div>
            <motion.div variants={itemVariants}>
              <StatCard
                label="Total Transaksi"
                value={formatNumber(stats?.totalTransactions ?? 0)}
                icon={<Receipt className="h-3.5 w-3.5 text-sky-400" />}
                color="from-sky-500/[0.06] to-transparent"
              />
            </motion.div>
            <motion.div variants={itemVariants}>
              <StatCard
                label="Total Revenue"
                value={formatCurrency(stats?.totalRevenue ?? 0)}
                icon={<DollarSign className="h-3.5 w-3.5 text-amber-400" />}
                color="from-amber-500/[0.06] to-transparent"
              />
            </motion.div>
          </div>

          {/* Plan Breakdown & Quick Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Plan Distribution */}
            <motion.div variants={itemVariants}>
              <Card className="bg-zinc-900 border border-zinc-800/60 rounded-xl">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-zinc-200 mb-3">Distribusi Plan</h3>
                  <div className="space-y-2">
                    {[
                      { label: 'Free', count: stats?.planBreakdown?.free ?? 0, color: 'bg-zinc-400' },
                      { label: 'Pro', count: stats?.planBreakdown?.pro ?? 0, color: 'bg-violet-400' },
                      { label: 'Enterprise', count: stats?.planBreakdown?.enterprise ?? 0, color: 'bg-amber-400' },
                    ].map((plan) => {
                      const total = (stats?.totalOutlets ?? 1) || 1
                      const pct = Math.round((plan.count / total) * 100)
                      return (
                        <div key={plan.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-400">{plan.label}</span>
                            <span className="text-zinc-300 font-medium">{plan.count} ({pct}%)</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                            <motion.div
                              className={`h-full rounded-full ${plan.color}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.8, ease: 'easeOut' }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800/60 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Total Crew</span>
                      <span className="text-zinc-300 font-medium">{formatNumber(stats?.totalCrew ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Total Produk</span>
                      <span className="text-zinc-300 font-medium">{formatNumber(stats?.totalProducts ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Total Customer</span>
                      <span className="text-zinc-300 font-medium">{formatNumber(stats?.totalCustomers ?? 0)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Recent Outlets */}
            <motion.div variants={itemVariants}>
              <Card className="bg-zinc-900 border border-zinc-800/60 rounded-xl">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-zinc-200">Outlet Terbaru</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-emerald-400 text-xs h-6 px-2"
                      onClick={() => {
                        const tabsList = document.querySelector('[data-state]') as HTMLElement
                        // Switch to outlets tab
                        const trigger = document.querySelector('[value="outlets"]') as HTMLElement
                        trigger?.click()
                      }}
                    >
                      Lihat Semua
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                  {stats?.recentOutlets && stats.recentOutlets.length > 0 ? (
                    <div className="space-y-2">
                      {stats.recentOutlets.map((outlet) => (
                        <div
                          key={outlet.id}
                          className="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/60 transition-colors cursor-pointer"
                          onClick={() => fetchOutletDetail(outlet.id)}
                        >
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                            <Store className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-zinc-200 truncate">{outlet.name}</p>
                            <p className="text-[10px] text-zinc-500">{outlet.owner?.name || 'No owner'}</p>
                          </div>
                          <Badge variant="outline" className={`text-[9px] px-1.5 py-0 leading-none border shrink-0 ${getPlanBadgeClass(outlet.accountType)}`}>
                            {getPlanLabel(outlet.accountType)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-xs text-zinc-500">Belum ada outlet</div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════
            OUTLETS TAB
        ═══════════════════════════════════════════════════ */}
        <TabsContent value="outlets" className="mt-0 space-y-3">
          {/* Search */}
          <motion.div variants={itemVariants} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input
              placeholder="Cari outlet atau owner..."
              value={outletsSearch}
              onChange={(e) => {
                setOutletsSearch(e.target.value)
                setOutletsPage(1)
              }}
              className="bg-zinc-900 border-zinc-800/60 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm rounded-lg pl-9"
            />
          </motion.div>

          {/* Table */}
          <motion.div variants={itemVariants}>
            <Card className="bg-zinc-900 border border-zinc-800/60 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800/60 hover:bg-transparent">
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9">Outlet</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9">Owner</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9">Plan</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9 text-right">User</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9 text-right">Transaksi</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9">Tanggal</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9 text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outletsLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i} className="border-zinc-800/40">
                          <TableCell colSpan={7}><Skeleton className="h-8 bg-zinc-800" /></TableCell>
                        </TableRow>
                      ))
                    ) : outlets.length === 0 ? (
                      <TableRow className="border-zinc-800/40">
                        <TableCell colSpan={7} className="h-24 text-center text-xs text-zinc-500">
                          Tidak ada outlet ditemukan
                        </TableCell>
                      </TableRow>
                    ) : (
                      outlets.map((outlet) => (
                        <TableRow key={outlet.id} className="border-zinc-800/40 hover:bg-zinc-800/30">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                                <Store className="h-3.5 w-3.5" />
                              </div>
                              <div>
                                <p className="text-xs font-medium text-zinc-200">{outlet.name}</p>
                                {outlet.phone && (
                                  <p className="text-[10px] text-zinc-500">{outlet.phone}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-xs text-zinc-300">{outlet.owner?.name || '-'}</p>
                            <p className="text-[10px] text-zinc-500">{outlet.owner?.email || ''}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 leading-none border ${getPlanBadgeClass(outlet.accountType)}`}>
                              {getPlanLabel(outlet.accountType)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs text-zinc-400">{outlet.userCount}</TableCell>
                          <TableCell className="text-right text-xs text-zinc-400">{formatNumber(outlet.transactionCount)}</TableCell>
                          <TableCell className="text-xs text-zinc-500">{formatDate(outlet.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-zinc-400 hover:text-emerald-400"
                                onClick={() => fetchOutletDetail(outlet.id)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-zinc-400 hover:text-sky-400"
                                onClick={() => openEdit(outlet)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-zinc-400 hover:text-amber-400"
                                onClick={() => openReset(outlet.id)}
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-zinc-400 hover:text-red-400"
                                onClick={() => handleDeleteOutlet(outlet.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800/40">
                <p className="text-[10px] text-zinc-500">
                  Halaman {outletsPage} dari {outletsTotalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={outletsPage <= 1}
                    onClick={() => setOutletsPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={outletsPage >= outletsTotalPages}
                    onClick={() => setOutletsPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════
            OWNERS TAB
        ═══════════════════════════════════════════════════ */}
        <TabsContent value="owners" className="mt-0 space-y-3">
          {/* Search */}
          <motion.div variants={itemVariants} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input
              placeholder="Cari owner..."
              value={ownersSearch}
              onChange={(e) => {
                setOwnersSearch(e.target.value)
                setOwnersPage(1)
              }}
              className="bg-zinc-900 border-zinc-800/60 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm rounded-lg pl-9"
            />
          </motion.div>

          {/* Table */}
          <motion.div variants={itemVariants}>
            <Card className="bg-zinc-900 border border-zinc-800/60 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800/60 hover:bg-transparent">
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9">Owner</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9">Email</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9">Outlet</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9">Plan</TableHead>
                      <TableHead className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider h-9">Tanggal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ownersLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i} className="border-zinc-800/40">
                          <TableCell colSpan={5}><Skeleton className="h-8 bg-zinc-800" /></TableCell>
                        </TableRow>
                      ))
                    ) : owners.length === 0 ? (
                      <TableRow className="border-zinc-800/40">
                        <TableCell colSpan={5} className="h-24 text-center text-xs text-zinc-500">
                          Tidak ada owner ditemukan
                        </TableCell>
                      </TableRow>
                    ) : (
                      owners.map((owner) => (
                        <TableRow key={owner.id} className="border-zinc-800/40 hover:bg-zinc-800/30">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 shrink-0">
                                <Users className="h-3.5 w-3.5" />
                              </div>
                              <p className="text-xs font-medium text-zinc-200">{owner.name}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-zinc-400">{owner.email}</TableCell>
                          <TableCell>
                            <button
                              className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                              onClick={() => fetchOutletDetail(owner.outletId)}
                            >
                              {owner.outlet.name}
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 leading-none border ${getPlanBadgeClass(owner.outlet.accountType)}`}>
                              {getPlanLabel(owner.outlet.accountType)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-zinc-500">{formatDate(owner.createdAt)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800/40">
                <p className="text-[10px] text-zinc-500">
                  Halaman {ownersPage} dari {ownersTotalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={ownersPage <= 1}
                    onClick={() => setOwnersPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={ownersPage >= ownersTotalPages}
                    onClick={() => setOwnersPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </TabsContent>
      </Tabs>

      {/* ═══════════════════════════════════════════════════
          OUTLET DETAIL SHEET
      ═══════════════════════════════════════════════════ */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="bg-zinc-950 border-zinc-800/60 w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="sr-only">
            <SheetTitle>Detail Outlet</SheetTitle>
            <SheetDescription>Informasi lengkap outlet</SheetDescription>
          </SheetHeader>

          {detailLoading ? (
            <div className="py-8 space-y-4">
              <Skeleton className="h-8 bg-zinc-800 w-3/4" />
              <Skeleton className="h-20 bg-zinc-800" />
              <Skeleton className="h-40 bg-zinc-800" />
            </div>
          ) : selectedOutlet ? (
            <div className="space-y-6 pt-2">
              {/* Header */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                    <Store className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-zinc-100 truncate">{selectedOutlet.name}</h2>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 leading-none border ${getPlanBadgeClass(selectedOutlet.accountType)}`}>
                      {getPlanLabel(selectedOutlet.accountType)}
                    </Badge>
                  </div>
                </div>

                {selectedOutlet.address && (
                  <p className="text-xs text-zinc-500">{selectedOutlet.address}</p>
                )}
                {selectedOutlet.phone && (
                  <p className="text-xs text-zinc-500">{selectedOutlet.phone}</p>
                )}
              </div>

              {/* Owner */}
              <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/40">
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Owner</p>
                {selectedOutlet.owner ? (
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-violet-500/10 flex items-center justify-center text-violet-400 text-[10px] font-bold">
                      {selectedOutlet.owner.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-zinc-200">{selectedOutlet.owner.name}</p>
                      <p className="text-[10px] text-zinc-500">{selectedOutlet.owner.email}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">Tidak ada owner</p>
                )}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'User', value: selectedOutlet.stats.userCount },
                  { label: 'Produk', value: selectedOutlet.stats.productCount },
                  { label: 'Customer', value: selectedOutlet.stats.customerCount },
                  { label: 'Kategori', value: selectedOutlet.stats.categoryCount },
                  { label: 'Transaksi', value: formatNumber(selectedOutlet.stats.transactionCount) },
                  { label: 'Revenue', value: formatCurrency(selectedOutlet.stats.totalRevenue) },
                ].map((s) => (
                  <div key={s.label} className="p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
                    <p className="text-[10px] text-zinc-500">{s.label}</p>
                    <p className="text-sm font-bold text-zinc-200 mt-0.5">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Recent Transactions */}
              <div>
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Transaksi Terakhir</p>
                {selectedOutlet.recentTransactions.length > 0 ? (
                  <div className="space-y-1.5">
                    {selectedOutlet.recentTransactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/40 border border-zinc-800/30">
                        <div>
                          <p className="text-xs font-medium text-zinc-300">{tx.invoiceNumber}</p>
                          <p className="text-[10px] text-zinc-500">{formatDate(tx.createdAt)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-zinc-200">{formatCurrency(tx.total)}</p>
                          <p className="text-[10px] text-zinc-500">{tx.paymentMethod}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 py-4 text-center">Belum ada transaksi</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-zinc-800/40">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs h-8 rounded-lg border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => {
                    setDetailOpen(false)
                    openEdit(selectedOutlet)
                  }}
                >
                  <Pencil className="h-3 w-3 mr-1.5" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs h-8 rounded-lg border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => {
                    setDetailOpen(false)
                    openReset(selectedOutlet.id)
                  }}
                >
                  <KeyRound className="h-3 w-3 mr-1.5" />
                  Reset Password
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-8 rounded-lg border-red-500/20 text-red-400 hover:bg-red-500/10"
                  onClick={() => handleDeleteOutlet(selectedOutlet.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ═══════════════════════════════════════════════════
          CREATE OUTLET DIALOG
      ═══════════════════════════════════════════════════ */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800/80 rounded-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Tambah Outlet Baru</DialogTitle>
            <DialogDescription className="text-zinc-500">Buat outlet baru beserta akun owner</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Nama Outlet *</Label>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
                placeholder="Contoh: Toko Sejahtera"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Alamat</Label>
              <Input
                value={createForm.address}
                onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
                placeholder="Jl. Contoh No. 123"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Telepon</Label>
              <Input
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
                placeholder="08xxxxxxxxxx"
              />
            </div>

            <div className="pt-2 border-t border-zinc-800/60">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Data Owner</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Nama Owner *</Label>
              <Input
                value={createForm.ownerName}
                onChange={(e) => setCreateForm((f) => ({ ...f, ownerName: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
                placeholder="Nama lengkap pemilik"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Email Owner *</Label>
              <Input
                type="email"
                value={createForm.ownerEmail}
                onChange={(e) => setCreateForm((f) => ({ ...f, ownerEmail: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
                placeholder="owner@email.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Password Owner *</Label>
              <Input
                type="password"
                value={createForm.ownerPassword}
                onChange={(e) => setCreateForm((f) => ({ ...f, ownerPassword: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
                placeholder="Minimal 8 karakter"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Tipe Akun</Label>
              <Select
                value={createForm.accountType}
                onValueChange={(val) => setCreateForm((f) => ({ ...f, accountType: val }))}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="ghost"
              className="text-zinc-400 text-xs h-8"
              onClick={() => setCreateOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs h-8"
              onClick={handleCreateOutlet}
              disabled={createLoading}
            >
              {createLoading ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Plus className="h-3 w-3 mr-1.5" />}
              Buat Outlet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════
          EDIT OUTLET DIALOG
      ═══════════════════════════════════════════════════ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800/80 rounded-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Edit Outlet</DialogTitle>
            <DialogDescription className="text-zinc-500">Perbarui informasi outlet</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Nama Outlet</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Alamat</Label>
              <Input
                value={editForm.address}
                onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Telepon</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Tipe Akun</Label>
              <Select
                value={editForm.accountType}
                onValueChange={(val) => setEditForm((f) => ({ ...f, accountType: val }))}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="ghost"
              className="text-zinc-400 text-xs h-8"
              onClick={() => setEditOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs h-8"
              onClick={handleEditOutlet}
              disabled={editLoading}
            >
              {editLoading ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Pencil className="h-3 w-3 mr-1.5" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════
          RESET PASSWORD DIALOG
      ═══════════════════════════════════════════════════ */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800/80 rounded-xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Reset Password Owner</DialogTitle>
            <DialogDescription className="text-zinc-500">Masukkan password baru untuk owner outlet</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Password Baru *</Label>
              <Input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-9 text-sm rounded-lg"
                placeholder="Minimal 8 karakter"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="ghost"
              className="text-zinc-400 text-xs h-8"
              onClick={() => setResetOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-white text-xs h-8"
              onClick={handleResetPassword}
              disabled={resetLoading}
            >
              {resetLoading ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <KeyRound className="h-3 w-3 mr-1.5" />}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
