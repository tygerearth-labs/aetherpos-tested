'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber } from '@/lib/format'
import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  Building2,
  TrendingUp,
  Receipt,
  Package,
  Store,
  Banknote,
  ShoppingCart,
  UserCircle,
  CalendarDays,
  Layers,
  AlertCircle,
  ArrowUpRight,
  Hash,
  Box,
} from 'lucide-react'

// ── Types ──
interface OutletSummary {
  id: string
  name: string
  isMain: boolean
  todayRevenue: number
  todayTransactions: number
  totalProducts: number
  totalStock: number
  managerName: string
}

interface AggregatedStats {
  totalRevenue: number
  totalTransactions: number
  totalProducts: number
  totalOutlets: number
}

type DateFilter = 'today' | '7days' | '30days'

const dateFilterConfig: Record<DateFilter, { label: string; param: string }> = {
  today: { label: 'Hari ini', param: 'today' },
  '7days': { label: '7 Hari', param: '7days' },
  '30days': { label: '30 Hari', param: '30days' },
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

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════
export default function MultiOutletTerminalPage() {
  // ── State ──
  const [hasGroup, setHasGroup] = useState<boolean | null>(null)
  const [stats, setStats] = useState<AggregatedStats | null>(null)
  const [outlets, setOutlets] = useState<OutletSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState<DateFilter>('today')

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
      } else {
        setHasGroup(false)
      }

      if (terminalRes.ok) {
        const data = await terminalRes.json()
        setStats(data.stats || null)
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

  // ── Loading skeleton ──
  if (loading && hasGroup === null) {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-52 bg-white/[0.04]" />
          <Skeleton className="h-3.5 w-64 bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 bg-nebula rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 bg-nebula rounded-xl" />
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
          <h1 className="text-xl font-bold text-white tracking-tight">Multi Outlet</h1>
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

      {/* Summary Cards */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Banknote className="h-4 w-4 text-emerald-400" />}
          label="Total Pendapatan"
          value={formatCurrency(stats?.totalRevenue ?? 0)}
          color="bg-emerald-500/10"
        />
        <StatCard
          icon={<Receipt className="h-4 w-4 text-sky-400" />}
          label="Total Transaksi"
          value={formatNumber(stats?.totalTransactions ?? 0)}
          sub={dateFilterConfig[dateFilter].label}
          color="bg-sky-500/10"
        />
        <StatCard
          icon={<Package className="h-4 w-4 text-violet-400" />}
          label="Total Produk"
          value={formatNumber(stats?.totalProducts ?? 0)}
          color="bg-violet-500/10"
        />
        <StatCard
          icon={<Store className="h-4 w-4 text-amber-400" />}
          label="Total Outlet"
          value={formatNumber(stats?.totalOutlets ?? 0)}
          color="bg-amber-500/10"
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
                <Card className="bg-nebula border-white/[0.06] hover:border-white/[0.1] transition-colors">
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
                      <div className="flex items-center gap-1 text-emerald-400 shrink-0">
                        <TrendingUp className="h-3 w-3" />
                      </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Banknote className="h-3 w-3 text-slate-500" />
                          <span className="text-[9px] text-slate-500 uppercase tracking-wider">Pendapatan</span>
                        </div>
                        <p className="text-xs font-bold text-white">{formatCurrency(outlet.todayRevenue)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1.5 mb-1">
                          <ShoppingCart className="h-3 w-3 text-slate-500" />
                          <span className="text-[9px] text-slate-500 uppercase tracking-wider">Transaksi</span>
                        </div>
                        <p className="text-xs font-bold text-white">{formatNumber(outlet.todayTransactions)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Hash className="h-3 w-3 text-slate-500" />
                          <span className="text-[9px] text-slate-500 uppercase tracking-wider">Produk</span>
                        </div>
                        <p className="text-xs font-bold text-white">{formatNumber(outlet.totalProducts)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Box className="h-3 w-3 text-slate-500" />
                          <span className="text-[9px] text-slate-500 uppercase tracking-wider">Total Stok</span>
                        </div>
                        <p className="text-xs font-bold text-white">{formatNumber(outlet.totalStock)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}