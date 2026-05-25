'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useTimezone } from '@/hooks/use-timezone'
import {
  TrendingUp, TrendingDown, Minus, BarChart3, Brain,
  ShoppingCart, Users, Package, AlertTriangle,
  CheckCircle2, Info, AlertCircle, Activity,
  RefreshCw, Clock, Zap,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Types
// ============================================================

interface InsightItem {
  title: string
  description: string
  type: 'positive' | 'warning' | 'info' | 'critical'
  metric?: string
}

interface InsightResult {
  insights: InsightItem[]
  score: number
}

interface HourBucket {
  hour: number
  count: number
  revenue: number
}

interface AnalyzeResponse {
  data: {
    today: { revenue: number; transactions: number; avgOrder: number }
    yesterday: { revenue: number; transactions: number; avgOrder: number }
    thisWeek: { revenue: number; transactions: number }
    thisMonth: { revenue: number; transactions: number }
    products: {
      total: number; outOfStock: number; lowStock: number; categories: number
      topSelling: { name: string; qty: number; revenue: number }[]
      categoryDistribution: { name: string; count: number }[]
      inventoryValue: number; avgPrice: number
    }
    customers: {
      total: number; newThisWeek: number; loyaltyEnabled: boolean
      totalPointsIssued: number; totalPointsRedeemed: number
      avgSpendPerCustomer: number
      topSpenders: { name: string; totalSpend: number; points: number }[]
    }
    transactions: {
      paymentMethods: { method: string; count: number; total: number }[]
      peakHour: number; peakHourRevenue: number; avgDiscount: number
      hourBuckets: HourBucket[]
    }
    outlet: { name: string; totalCrew: number; accountType: string }
    dataQuality: {
      productsWithoutCategory: number; productsWithoutSku: number
      productsWithoutImage: number; totalTransactionItems: number
      deadStockCount: number; deadStockValue: number
    }
  }
  cmo: InsightResult
  cto: InsightResult
  generatedAt: string
}

// ============================================================
// Helpers
// ============================================================

function formatRp(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function getScoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-400'
  if (score >= 50) return 'text-amber-400'
  return 'text-red-400'
}

function getScoreBg(score: number): string {
  if (score >= 75) return 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20'
  if (score >= 50) return 'from-amber-500/20 to-amber-500/5 border-amber-500/20'
  return 'from-red-500/20 to-red-500/5 border-red-500/20'
}

function getScoreRing(score: number): string {
  if (score >= 75) return 'stroke-emerald-400'
  if (score >= 50) return 'stroke-amber-400'
  return 'stroke-red-400'
}

function getInsightIcon(type: string) {
  switch (type) {
    case 'positive': return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
    case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
    case 'critical': return <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
    default: return <Info className="h-4 w-4 text-sky-400 shrink-0" />
  }
}

function getInsightBorder(type: string): string {
  switch (type) {
    case 'positive': return 'border-l-emerald-500'
    case 'warning': return 'border-l-amber-500'
    case 'critical': return 'border-l-red-500'
    default: return 'border-l-sky-500'
  }
}

// ============================================================
// Score Ring Component
// ============================================================

function ScoreRing({ score, label }: { score: number; label: string }) {
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" className="text-zinc-800" strokeWidth="6" />
          <circle
            cx="50" cy="50" r={radius} fill="none"
            className={getScoreRing(score)}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-bold ${getScoreColor(score)}`}>{score}</span>
          <span className="text-[9px] text-zinc-500">/100</span>
        </div>
      </div>
      <span className="text-[11px] font-semibold text-zinc-300">{label}</span>
    </div>
  )
}

// ============================================================
// Insight Card Component
// ============================================================

function InsightCard({ insight, index }: { insight: InsightItem; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className={`rounded-xl border border-zinc-800/60 bg-zinc-900/60 p-4 border-l-[3px] ${getInsightBorder(insight.type)} hover:bg-zinc-900/80 transition-colors`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{getInsightIcon(insight.type)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-xs font-semibold text-zinc-200">{insight.title}</h4>
            {insight.metric && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-700 text-zinc-400 shrink-0">
                {insight.metric}
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">{insight.description}</p>
        </div>
      </div>
    </motion.div>
  )
}

// ============================================================
// Stat Card Component
// ============================================================

function StatCard({
  icon, label, value, sub, trend, color = 'emerald',
}: {
  icon: React.ReactNode; label: string; value: string
  sub?: string; trend?: 'up' | 'down' | 'neutral'; color?: string
}) {
  const colorMap: Record<string, string> = {
    emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/15',
    violet: 'from-violet-500/20 to-violet-500/5 border-violet-500/15',
    amber: 'from-amber-500/20 to-amber-500/5 border-amber-500/15',
    sky: 'from-sky-500/20 to-sky-500/5 border-sky-500/15',
    rose: 'from-rose-500/20 to-rose-500/5 border-rose-500/15',
  }
  const iconColorMap: Record<string, string> = {
    emerald: 'text-emerald-400',
    violet: 'text-violet-400',
    amber: 'text-amber-400',
    sky: 'text-sky-400',
    rose: 'text-rose-400',
  }

  return (
    <div className={`rounded-xl bg-gradient-to-br ${colorMap[color]} border p-3.5`}>
      <div className="flex items-start justify-between mb-2">
        <span className={`p-1.5 rounded-lg bg-zinc-900/60 ${iconColorMap[color]}`}>{icon}</span>
        {trend && (
          <div className={`flex items-center gap-0.5 text-[10px] font-semibold ${
            trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-zinc-500'
          }`}>
            {trend === 'up' ? <TrendingUp className="h-3 w-3" /> : trend === 'down' ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          </div>
        )}
      </div>
      <p className="text-[10px] text-zinc-500 font-medium mb-0.5">{label}</p>
      <p className="text-sm font-bold text-zinc-100">{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  )
}

// ============================================================
// Peak Hours Chart Component
// ============================================================

function PeakHoursChart({ buckets }: { buckets: HourBucket[] }) {
  const activeBuckets = buckets.filter(b => b.count > 0)
  if (activeBuckets.length === 0) {
    return <p className="text-xs text-zinc-500 text-center py-4">Belum ada data transaksi hari ini</p>
  }

  const maxCount = Math.max(...buckets.map(b => b.count))

  return (
    <div className="space-y-1.5">
      {buckets
        .filter(b => b.count > 0 || (b.hour >= 8 && b.hour <= 22))
        .map(b => {
          const isPeak = b.count === maxCount && b.count > 0
          const width = maxCount > 0 ? (b.count / maxCount) * 100 : 0
          return (
            <div key={b.hour} className="flex items-center gap-2">
              <span className={`text-[10px] w-10 text-right shrink-0 ${isPeak ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}`}>
                {String(b.hour).padStart(2, '0')}:00
              </span>
              <div className="flex-1 h-4 bg-zinc-800/50 rounded-sm overflow-hidden">
                <div
                  className={`h-full rounded-sm transition-all duration-500 ${
                    isPeak
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                      : b.count > 0
                        ? 'bg-zinc-700'
                        : 'bg-transparent'
                  }`}
                  style={{ width: `${Math.max(width, b.count > 0 ? 4 : 0)}%` }}
                />
              </div>
              <span className={`text-[10px] w-6 shrink-0 ${isPeak ? 'text-emerald-400 font-semibold' : 'text-zinc-600'}`}>
                {b.count}
              </span>
            </div>
          )
        })}
    </div>
  )
}

// ============================================================
// Main Page
// ============================================================

export default function InsightsPage() {
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'
  const { tzOffset } = useTimezone()
  const [activeTab, setActiveTab] = useState('overview')
  const [data, setData] = useState<AnalyzeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchInsights = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/insights/analyze?tzOffset=${tzOffset}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Gagal memuat insight')
      }
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setLoading(false)
    }
  }, [tzOffset])

  useEffect(() => {
    if (isOwner) fetchInsights()
  }, [isOwner, fetchInsights])

  // ── Non-owner guard ──
  if (!isOwner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
          <Brain className="h-7 w-7 text-zinc-600" />
        </div>
        <div className="text-center">
          <h2 className="text-sm font-semibold text-zinc-300">Hanya untuk Owner</h2>
          <p className="text-xs text-zinc-500 mt-1">Halaman Insight hanya tersedia untuk akun Owner.</p>
        </div>
      </div>
    )
  }

  const d = data?.data

  // Revenue trend
  const revenueTrend = d && d.yesterday.revenue > 0
    ? ((d.today.revenue - d.yesterday.revenue) / d.yesterday.revenue) * 100
    : 0

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-100 tracking-tight">Insight</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Analisis bisnis real-time berdasarkan data outlet</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchInsights}
          disabled={loading}
          className="h-8 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 gap-1.5"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/[0.06] border border-red-500/15 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl bg-zinc-900" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl bg-zinc-900" />
          <Skeleton className="h-48 rounded-xl bg-zinc-900" />
        </div>
      ) : data ? (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-zinc-900 border border-zinc-800/60 h-9 p-0.5 mb-4">
                <TabsTrigger
                  value="overview"
                  className="text-xs h-8 rounded-md data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                >
                  <BarChart3 className="h-3 w-3 mr-1.5" />
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  value="cmo"
                  className="text-xs h-8 rounded-md data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                >
                  <TrendingUp className="h-3 w-3 mr-1.5" />
                  CMO
                </TabsTrigger>
                <TabsTrigger
                  value="cto"
                  className="text-xs h-8 rounded-md data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100"
                >
                  <Activity className="h-3 w-3 mr-1.5" />
                  CTO
                </TabsTrigger>
              </TabsList>

              {/* ── Overview Tab ── */}
              <TabsContent value="overview" className="space-y-4 mt-0">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard
                    icon={<Zap className="h-3.5 w-3.5" />}
                    label="Revenue Hari Ini"
                    value={formatRp(d.today.revenue)}
                    sub={`${d.today.transactions} transaksi`}
                    trend={revenueTrend > 5 ? 'up' : revenueTrend < -5 ? 'down' : 'neutral'}
                    color="emerald"
                  />
                  <StatCard
                    icon={<ShoppingCart className="h-3.5 w-3.5" />}
                    label="AOV (Avg Order)"
                    value={formatRp(d.today.avgOrder)}
                    sub={`Kemarin: ${formatRp(d.yesterday.avgOrder)}`}
                    color="violet"
                  />
                  <StatCard
                    icon={<Package className="h-3.5 w-3.5" />}
                    label="Stok Bermasalah"
                    value={`${d.products.outOfStock + d.products.lowStock}`}
                    sub={`${d.products.outOfStock} habis, ${d.products.lowStock} rendah`}
                    color={d.products.outOfStock > 0 ? 'rose' : 'emerald'}
                  />
                  <StatCard
                    icon={<Users className="h-3.5 w-3.5" />}
                    label="Customer"
                    value={String(d.customers.total)}
                    sub={`+${d.customers.newThisWeek} minggu ini`}
                    color="sky"
                  />
                </div>

                {/* Score Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className={`rounded-xl bg-gradient-to-br ${getScoreBg(data.cmo.score)} border p-4`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <TrendingUp className={`h-4 w-4 ${getScoreColor(data.cmo.score)}`} />
                          <h3 className="text-xs font-semibold text-zinc-200">CMO Score</h3>
                        </div>
                        <p className="text-[10px] text-zinc-400 leading-relaxed mt-1">
                          Performa marketing & penjualan berdasarkan data revenue, customer, dan produk.
                        </p>
                        <div className="flex gap-1.5 mt-2">
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-zinc-700 text-zinc-400">
                            {data.cmo.insights.filter(i => i.type === 'positive').length} positif
                          </Badge>
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-zinc-700 text-zinc-400">
                            {data.cmo.insights.filter(i => i.type === 'warning' || i.type === 'critical').length} perlu atensi
                          </Badge>
                        </div>
                      </div>
                      <ScoreRing score={data.cmo.score} label="Marketing" />
                    </div>
                  </div>

                  <div className={`rounded-xl bg-gradient-to-br ${getScoreBg(data.cto.score)} border p-4`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Activity className={`h-4 w-4 ${getScoreColor(data.cto.score)}`} />
                          <h3 className="text-xs font-semibold text-zinc-200">CTO Score</h3>
                        </div>
                        <p className="text-[10px] text-zinc-400 leading-relaxed mt-1">
                          Kesehatan operasional berdasarkan inventori, data quality, dan efisiensi.
                        </p>
                        <div className="flex gap-1.5 mt-2">
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-zinc-700 text-zinc-400">
                            {data.cto.insights.filter(i => i.type === 'positive').length} positif
                          </Badge>
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-zinc-700 text-zinc-400">
                            {data.cto.insights.filter(i => i.type === 'warning' || i.type === 'critical').length} perlu atensi
                          </Badge>
                        </div>
                      </div>
                      <ScoreRing score={data.cto.score} label="Operasional" />
                    </div>
                  </div>
                </div>

                {/* Quick Metrics Row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/60 p-3">
                    <p className="text-[10px] text-zinc-500 font-medium">Revenue Minggu Ini</p>
                    <p className="text-sm font-bold text-zinc-100 mt-1">{formatRp(d.thisWeek.revenue)}</p>
                    <p className="text-[10px] text-zinc-500">{d.thisWeek.transactions} transaksi</p>
                  </div>
                  <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/60 p-3">
                    <p className="text-[10px] text-zinc-500 font-medium">Revenue Bulan Ini</p>
                    <p className="text-sm font-bold text-zinc-100 mt-1">{formatRp(d.thisMonth.revenue)}</p>
                    <p className="text-[10px] text-zinc-500">{d.thisMonth.transactions} transaksi</p>
                  </div>
                  <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/60 p-3">
                    <p className="text-[10px] text-zinc-500 font-medium">Nilai Inventori</p>
                    <p className="text-sm font-bold text-zinc-100 mt-1">{formatRp(d.products.inventoryValue)}</p>
                    <p className="text-[10px] text-zinc-500">{d.products.total} produk</p>
                  </div>
                  <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/60 p-3">
                    <p className="text-[10px] text-zinc-500 font-medium">Jam Puncak</p>
                    <p className="text-sm font-bold text-zinc-100 mt-1">{String(d.transactions.peakHour).padStart(2, '0')}:00</p>
                    <p className="text-[10px] text-zinc-500">{formatRp(d.transactions.peakHourRevenue)}</p>
                  </div>
                </div>

                {/* Peak Hours + Top Products */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Card className="bg-zinc-900/60 border-zinc-800/60">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Clock className="h-3.5 w-3.5 text-zinc-400" />
                        <h3 className="text-xs font-semibold text-zinc-200">Distribusi Transaksi per Jam</h3>
                      </div>
                      <PeakHoursChart buckets={d.transactions.hourBuckets} />
                    </CardContent>
                  </Card>

                  <Card className="bg-zinc-900/60 border-zinc-800/60">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Package className="h-3.5 w-3.5 text-zinc-400" />
                        <h3 className="text-xs font-semibold text-zinc-200">Produk Terlaris</h3>
                      </div>
                      {d.products.topSelling.length === 0 ? (
                        <p className="text-xs text-zinc-500 text-center py-4">Belum ada data penjualan</p>
                      ) : (
                        <div className="space-y-2">
                          {d.products.topSelling.slice(0, 5).map((p, i) => (
                            <div key={i} className="flex items-center gap-3">
                              <span className="text-[10px] text-zinc-600 w-4 font-bold">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-zinc-200 truncate">{p.name}</p>
                                <p className="text-[10px] text-zinc-500">{p.qty} unit · {formatRp(p.revenue)}</p>
                              </div>
                              <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden shrink-0">
                                <div
                                  className="h-full bg-emerald-500/60 rounded-full"
                                  style={{ width: `${d.products.topSelling[0].qty > 0 ? (p.qty / d.products.topSelling[0].qty) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Payment Methods + Data Quality */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <Card className="bg-zinc-900/60 border-zinc-800/60">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <ShoppingCart className="h-3.5 w-3.5 text-zinc-400" />
                        <h3 className="text-xs font-semibold text-zinc-200">Metode Pembayaran</h3>
                      </div>
                      {d.transactions.paymentMethods.length === 0 ? (
                        <p className="text-xs text-zinc-500 text-center py-4">Belum ada data</p>
                      ) : (
                        <div className="space-y-2">
                          {d.transactions.paymentMethods.map((pm) => {
                            const totalTx = d.transactions.paymentMethods.reduce((s, p) => s + p.count, 0)
                            const pct = totalTx > 0 ? (pm.count / totalTx) * 100 : 0
                            return (
                              <div key={pm.method} className="flex items-center gap-3">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] px-2 py-0 shrink-0 ${
                                    pm.method === 'CASH' ? 'border-emerald-500/20 text-emerald-400 bg-emerald-500/5' :
                                    pm.method === 'QRIS' ? 'border-violet-500/20 text-violet-400 bg-violet-500/5' :
                                    'border-sky-500/20 text-sky-400 bg-sky-500/5'
                                  }`}
                                >
                                  {pm.method}
                                </Badge>
                                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-zinc-600 rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-zinc-400 w-8 text-right">{pct.toFixed(0)}%</span>
                                <span className="text-[10px] text-zinc-500 w-16 text-right">{formatRp(pm.total)}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="bg-zinc-900/60 border-zinc-800/60">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="h-3.5 w-3.5 text-zinc-400" />
                        <h3 className="text-xs font-semibold text-zinc-200">Kualitas Data</h3>
                      </div>
                      <div className="space-y-2.5">
                        <DataQualityRow label="Tanpa Kategori" count={d.dataQuality.productsWithoutCategory} total={d.products.total} />
                        <DataQualityRow label="Tanpa SKU" count={d.dataQuality.productsWithoutSku} total={d.products.total} />
                        <DataQualityRow label="Tanpa Foto" count={d.dataQuality.productsWithoutImage} total={d.products.total} />
                        <DataQualityRow label="Potensi Dead Stock" count={d.dataQuality.deadStockCount} total={d.products.total} color={d.dataQuality.deadStockCount > d.products.total * 0.3 ? 'rose' : undefined} />
                      </div>
                      {d.dataQuality.deadStockValue > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-zinc-800/60">
                          <p className="text-[10px] text-zinc-500">Nilai Dead Stock</p>
                          <p className="text-xs font-semibold text-amber-400">{formatRp(d.dataQuality.deadStockValue)}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <p className="text-[10px] text-zinc-600 text-center">
                  Diperbarui: {new Date(data.generatedAt).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </TabsContent>

              {/* ── CMO Tab ── */}
              <TabsContent value="cmo" className="space-y-4 mt-0">
                <div className="flex items-center gap-3">
                  <ScoreRing score={data.cmo.score} label="CMO Score" />
                  <div className="flex-1">
                    <h2 className="text-sm font-bold text-zinc-100">Chief Marketing Officer Insights</h2>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Analisis performa marketing & penjualan — revenue, customer acquisition, produk terlaris, dan rekomendasi strategi promosi.
                    </p>
                    <div className="flex gap-3 mt-2">
                      <div className="text-center">
                        <p className="text-[10px] text-zinc-500">Positif</p>
                        <p className="text-sm font-bold text-emerald-400">{data.cmo.insights.filter(i => i.type === 'positive').length}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-zinc-500">Peringatan</p>
                        <p className="text-sm font-bold text-amber-400">{data.cmo.insights.filter(i => i.type === 'warning').length}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-zinc-500">Info</p>
                        <p className="text-sm font-bold text-sky-400">{data.cmo.insights.filter(i => i.type === 'info').length}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-zinc-500">Kritis</p>
                        <p className="text-sm font-bold text-red-400">{data.cmo.insights.filter(i => i.type === 'critical').length}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {data.cmo.insights.map((insight, i) => (
                    <InsightCard key={i} insight={insight} index={i} />
                  ))}
                </div>

                {/* CMO Data Reference */}
                <Card className="bg-zinc-900/40 border-zinc-800/40">
                  <CardContent className="p-4">
                    <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">Data Referensi CMO</h4>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-zinc-500 text-[10px]">Revenue Hari Ini</p>
                        <p className="text-zinc-200 font-semibold">{formatRp(d.today.revenue)}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 text-[10px]">Revenue Kemarin</p>
                        <p className="text-zinc-200 font-semibold">{formatRp(d.yesterday.revenue)}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 text-[10px]">Total Customer</p>
                        <p className="text-zinc-200 font-semibold">{d.customers.total}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 text-[10px]">Avg Spend/Customer</p>
                        <p className="text-zinc-200 font-semibold">{formatRp(d.customers.avgSpendPerCustomer)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ── CTO Tab ── */}
              <TabsContent value="cto" className="space-y-4 mt-0">
                <div className="flex items-center gap-3">
                  <ScoreRing score={data.cto.score} label="CTO Score" />
                  <div className="flex-1">
                    <h2 className="text-sm font-bold text-zinc-100">Chief Technology Officer Insights</h2>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Analisis kesehatan operasional — inventori, kualitas data, efisiensi staffing, dan rekomendasi optimasi sistem.
                    </p>
                    <div className="flex gap-3 mt-2">
                      <div className="text-center">
                        <p className="text-[10px] text-zinc-500">Positif</p>
                        <p className="text-sm font-bold text-emerald-400">{data.cto.insights.filter(i => i.type === 'positive').length}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-zinc-500">Peringatan</p>
                        <p className="text-sm font-bold text-amber-400">{data.cto.insights.filter(i => i.type === 'warning').length}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-zinc-500">Info</p>
                        <p className="text-sm font-bold text-sky-400">{data.cto.insights.filter(i => i.type === 'info').length}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-zinc-500">Kritis</p>
                        <p className="text-sm font-bold text-red-400">{data.cto.insights.filter(i => i.type === 'critical').length}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {data.cto.insights.map((insight, i) => (
                    <InsightCard key={i} insight={insight} index={i} />
                  ))}
                </div>

                {/* CTO Data Reference */}
                <Card className="bg-zinc-900/40 border-zinc-800/40">
                  <CardContent className="p-4">
                    <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">Data Referensi CTO</h4>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-zinc-500 text-[10px]">Stok Habis</p>
                        <p className={`font-semibold ${d.products.outOfStock > 0 ? 'text-red-400' : 'text-zinc-200'}`}>{d.products.outOfStock} produk</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 text-[10px]">Stok Rendah</p>
                        <p className={`font-semibold ${d.products.lowStock > 0 ? 'text-amber-400' : 'text-zinc-200'}`}>{d.products.lowStock} produk</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 text-[10px]">Dead Stock</p>
                        <p className={`font-semibold ${d.dataQuality.deadStockCount > 0 ? 'text-amber-400' : 'text-zinc-200'}`}>{d.dataQuality.deadStockCount} ({formatRp(d.dataQuality.deadStockValue)})</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 text-[10px]">Diskon Rata-rata</p>
                        <p className="text-zinc-200 font-semibold">{formatRp(d.transactions.avgDiscount)}/trx</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        </AnimatePresence>
      ) : null}
    </div>
  )
}

// ============================================================
// Sub-component: Data Quality Row
// ============================================================

function DataQualityRow({ label, count, total, color }: { label: string; count: number; total: number; color?: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  const isBad = pct > 30

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-zinc-400 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            color === 'rose' || isBad ? 'bg-rose-500/60' : count > 0 ? 'bg-amber-500/40' : 'bg-emerald-500/60'
          }`}
          style={{ width: count > 0 ? `${Math.max(pct, 3)}%` : '0%' }}
        />
      </div>
      <span className={`text-[10px] w-6 text-right font-medium ${
        color === 'rose' || isBad ? 'text-rose-400' : count > 0 ? 'text-amber-400' : 'text-emerald-400'
      }`}>
        {count}
      </span>
    </div>
  )
}
