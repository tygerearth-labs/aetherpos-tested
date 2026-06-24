'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { usePlan } from '@/hooks/use-plan'
import { usePageStore } from '@/hooks/use-page-store'
import { useTimezone } from '@/hooks/use-timezone'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DollarSign,
  Receipt,
  AlertTriangle,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Crown,
  Zap,
  PlusCircle,
  ShoppingCart,
  FileBarChart,
  Package,
  Users,
  RefreshCw,
  Sparkles,
  Lock,
  TrendingDown,
  Minus,
  Activity,
  Clock,
  Warehouse,
  Target,
  Layers,
  Calendar,
  CreditCard,
  Wallet,
  ArrowRight,
  ChevronRight,
  CircleDollarSign,
  ShoppingBag,
  UsersRound,
  Gauge,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// ── Types ──
interface HourBucket {
  hour: number
  transactionCount: number
  revenue: number
}

interface DayBucket {
  date: string
  revenue: number
  transactionCount: number
  profit: number
}

interface DashboardStats {
  totalRevenue: number
  totalTransactions: number
  totalProducts: number
  lowStockProducts: number
  totalProfit: number | null
  topCustomers: { id: string; name: string; whatsapp: string; totalSpend: number; points: number }[]
  lowStockList: { id: string; name: string; stock: number; lowStockAlert: number }[]
  lowStockVariants: number
  lowStockVariantList: { id: string; name: string; stock: number; productId: string; productName: string }[]
  // Range-based
  range: string
  rangeRevenue: number
  rangeBrutto: number
  rangeDiscount: number
  rangeTax: number
  rangeTransactions: number
  rangeProfit: number | null
  previousRangeRevenue: number
  previousRangeTransactions: number
  revenueChangePercent: number
  // Today (always)
  todayRevenue: number
  todayTransactions: number
  yesterdayRevenue: number
  yesterdayTransactions: number
  // Chart data
  dailyBreakdown: DayBucket[]
  paymentBreakdown: Record<string, { count: number; revenue: number }>
  topSellingProducts: { name: string; qty: number; revenue: number }[]
  // OWNER
  peakHours: HourBucket[] | null
  aiInsight: string | null
}

interface InsightItem {
  id: string
  title: string
  why: string
  actions: string[]
  priority: 'critical' | 'high' | 'medium' | 'low'
  score: number
  cta: { label: string; page: string }[]
  emoji: string
}

interface InsightEngineData {
  insights: InsightItem[]
  topInsight: InsightItem | null
  healthScore: number
  summary: string
  metrics: {
    todayRevenue: number
    todayBrutto: number
    todayDiscount: number
    todayTax: number
    todayTransactions: number
    todayProfit: number | null
    todayAOV: number
    yesterdayRevenue: number
    yesterdayTransactions: number
    totalProducts: number
    lowStockCount: number
    outOfStockCount: number
    totalCustomers: number
    newCustomersThisWeek: number
    topSelling: { name: string; qty: number; revenue: number }[]
    lowStockProducts: { name: string; stock: number; lowStockAlert: number }[]
  }
  generatedAt: string
}

interface ForecastData {
  trend: { date: string; revenue: number; txCount: number }[]
  forecast: { date: string; predictedRevenue: number; isForecast: boolean }[]
  trendDirection: 'up' | 'down' | 'stable'
  stockPredictions: {
    name: string
    stock: number
    lowStockAlert: number
    sold14Days: number
    dailyVelocity: number
    daysUntilEmpty: number
    daysUntilLow: number
    status: 'critical' | 'warning' | 'ok'
  }[]
  dayPerformance: { day: string; dayOfWeek: number; avgRevenue: number; totalTx: number; avgTx: number }[]
  summary: {
    weekOverWeek: number
    avgDailyRevenue: number
    projectedMonthly: number
    projectedWeekly: number
    criticalStock: number
    warningStock: number
  }
  generatedAt: string
}

const POLL_INTERVAL = 30_000

// ── Animation variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] },
  },
}

// ── Helpers ──
function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Selamat Pagi'
  if (h < 15) return 'Selamat Siang'
  if (h < 18) return 'Selamat Sore'
  return 'Selamat Malam'
}

function formatDateNow(): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date())
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function getRangeLabel(range: string): string {
  switch (range) {
    case 'week': return 'Minggu Ini'
    case 'month': return 'Bulan Ini'
    default: return 'Hari Ini'
  }
}

// ── Sub-Components ──

function HealthRing({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
  const radius = size === 'sm' ? 18 : 32
  const svgSize = size === 'sm' ? 44 : 72
  const sw = size === 'sm' ? 3 : 4
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color =
    score >= 75 ? 'theme-text' : score >= 50 ? 'text-amber-400' : 'text-red-400'
  const ringColor =
    score >= 75 ? 'theme-text' : score >= 50 ? 'stroke-amber-400' : 'stroke-red-400'
  const bgColor =
    score >= 75
      ? 'theme-border-light'
      : score >= 50
        ? 'border-amber-500/20'
        : 'border-red-500/20'

  return (
    <div className={`relative ${size === 'sm' ? 'w-11 h-11' : 'w-16 h-16'} border ${bgColor} rounded-full flex items-center justify-center bg-nebula/80`}>
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox={`0 0 ${svgSize} ${svgSize}`}>
        <circle
          cx={svgSize / 2}
          cy={svgSize / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-slate-700"
          strokeWidth={sw}
        />
        <circle
          cx={svgSize / 2}
          cy={svgSize / 2}
          r={radius}
          fill="none"
          className={ringColor}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <span className={`font-bold leading-none z-10 ${size === 'sm' ? 'text-xs' : 'text-sm'} ${color}`}>
        {score}
      </span>
    </div>
  )
}

function PriorityDot({ priority }: { priority: InsightItem['priority'] }) {
  const map: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '✅' }
  return <span className="shrink-0">{map[priority]}</span>
}

function getPriorityColor(priority: InsightItem['priority']): string {
  switch (priority) {
    case 'critical': return 'text-red-400'
    case 'high': return 'text-orange-400'
    case 'medium': return 'text-amber-400'
    case 'low': return 'theme-text'
  }
}

function getPriorityBg(priority: InsightItem['priority']): string {
  switch (priority) {
    case 'critical': return 'bg-red-500/8 border-red-500/15'
    case 'high': return 'bg-orange-500/8 border-orange-500/15'
    case 'medium': return 'bg-amber-500/8 border-amber-500/15'
    case 'low': return 'theme-bg-ultra-light theme-border-light'
  }
}

function ProLock({ label = 'PRO' }: { label?: string }) {
  return (
    <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px] gap-1 shrink-0">
      <Crown className="h-3 w-3" />
      {label}
    </Badge>
  )
}

function TrendIcon({ direction }: { direction: 'up' | 'down' | 'stable' }) {
  if (direction === 'up') return <TrendingUp className="h-3.5 w-3.5 theme-text" />
  if (direction === 'down') return <TrendingDown className="h-3.5 w-3.5 text-red-400" />
  return <Minus className="h-3.5 w-3.5 text-slate-400" />
}

// ── Custom Tooltip for Recharts ──
function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-nebula/95 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-[10px] text-slate-500 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-xs font-semibold" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' && p.name.toLowerCase().includes('revenue') || p.name.toLowerCase().includes('profit')
            ? formatCurrency(p.value)
            : p.name.toLowerCase().includes('count') || p.name.toLowerCase().includes('trx')
              ? formatNumber(p.value)
              : formatCurrency(p.value)}
        </p>
      ))}
    </div>
  )
}

// ── Day Performance Heat Bar ──
function DayHeatBar({ day, avgRevenue, maxRevenue, avgTx }: { day: string; avgRevenue: number; maxRevenue: number; avgTx: number }) {
  const pct = maxRevenue > 0 ? Math.min((avgRevenue / maxRevenue) * 100, 100) : 0
  const today = new Date().getDay()
  const dayIndex = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].indexOf(day)
  const isToday = dayIndex === today
  const intensity = pct > 80 ? 'theme-gradient-light' : pct > 50 ? 'theme-gradient-subtle' : 'from-slate-600/20 to-slate-500/10'

  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`text-[11px] w-8 shrink-0 font-medium ${isToday ? 'theme-text' : 'text-slate-500'}`}>
        {day}
      </span>
      <div className={`flex-1 h-5 rounded-md bg-gradient-to-r ${intensity} border ${isToday ? 'theme-border-medium' : 'border-white/[0.03]'} relative overflow-hidden`}>
        <motion.div
          className={`absolute inset-y-0 left-0 rounded-md ${isToday ? 'theme-bg-subtle' : 'bg-zinc-500/10'}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-2">
          <span className="text-[9px] text-slate-400 font-medium">{formatCurrency(avgRevenue)}</span>
          <span className="text-[9px] text-slate-500">{avgTx} trx</span>
        </div>
      </div>
    </div>
  )
}

// ── Sparkline ──
function Sparkline({ data, color = 'theme-text', height = 40 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const w = data.length * 8
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={w} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={color}
      />
    </svg>
  )
}

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { data: session } = useSession()
  const { plan, features, isLoading: planLoading } = usePlan()
  const { setCurrentPage } = usePageStore()
  const { tzOffset } = useTimezone()
  const isOwner = session?.user?.role === 'OWNER'
  const isPro = plan?.type === 'pro' || plan?.type === 'enterprise'
  const hasForecasting = features?.forecasting === true
  const hasAiInsights = features?.aiInsights === true

  const [range, setRange] = useState<'day' | 'week' | 'month'>('day')
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Insight Engine state
  const [insightData, setInsightData] = useState<InsightEngineData | null>(null)
  const [insightLoading, setInsightLoading] = useState(false)

  // Forecast state (PRO+)
  const [forecastData, setForecastData] = useState<ForecastData | null>(null)
  const [forecastLoading, setForecastLoading] = useState(false)

  // ── Fetchers ──
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard?tzOffset=${tzOffset}&range=${range}`)
      if (res.ok) setStats(await res.json())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [tzOffset, range])

  const fetchInsights = useCallback(async () => {
    setInsightLoading(true)
    try {
      const res = await fetch(`/api/insights/engine?tzOffset=${tzOffset}`)
      if (res.ok) setInsightData(await res.json())
    } catch { /* silent */ }
    finally { setInsightLoading(false) }
  }, [tzOffset])

  const fetchForecast = useCallback(async () => {
    setForecastLoading(true)
    try {
      const res = await fetch(`/api/insights/forecast?tzOffset=${tzOffset}`)
      if (res.ok) setForecastData(await res.json())
    } catch { /* silent */ }
    finally { setForecastLoading(false) }
  }, [tzOffset])

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => { if (isOwner && hasAiInsights) fetchInsights() }, [isOwner, hasAiInsights, fetchInsights])
  useEffect(() => { if (isOwner && hasForecasting) fetchForecast() }, [isOwner, hasForecasting, fetchForecast])

  useEffect(() => {
    intervalRef.current = setInterval(fetchStats, POLL_INTERVAL)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchStats])

  // ── Derived ──
  const changePercent = stats?.revenueChangePercent ?? 0
  const isUp = changePercent >= 0
  const busiestHour = stats?.peakHours?.reduce(
    (max, b) => (b.transactionCount > max.transactionCount ? b : max),
    { hour: 0, transactionCount: 0, revenue: 0 }
  )
  const maxTxCount = stats?.peakHours
    ? Math.max(...stats.peakHours.map((b) => b.transactionCount), 1)
    : 1

  const topSelling = stats?.topSellingProducts ?? insightData?.metrics.topSelling ?? []
  const otherInsights = insightData?.insights.filter(
    (i) => i.id !== insightData.topInsight?.id
  ) ?? []

  const trendValues = forecastData?.trend.map((d) => d.revenue) ?? []

  // Chart data for daily revenue
  const revenueChartData = (stats?.dailyBreakdown ?? []).map((d) => ({
    date: formatShortDate(d.date),
    revenue: d.revenue,
    profit: d.profit,
    trx: d.transactionCount,
  }))

  // Peak hours chart data
  const peakHoursChartData = (stats?.peakHours ?? [])
    .filter((b) => b.transactionCount > 0)
    .map((b) => ({
      hour: formatHour(b.hour),
      trx: b.transactionCount,
      revenue: b.revenue,
    }))

  // Payment method data
  const paymentData = Object.entries(stats?.paymentBreakdown ?? {}).map(([method, data]) => ({
    method,
    ...data,
  }))

  const aov = stats && stats.rangeTransactions > 0
    ? Math.round(stats.rangeRevenue / stats.rangeTransactions)
    : 0

  // ── Loading Skeleton ──
  if (loading) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-52 bg-white/[0.04]" />
          <Skeleton className="h-3.5 w-64 bg-white/[0.04]" />
        </div>
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-24 bg-white/[0.04] rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 bg-nebula rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 bg-nebula rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-52 bg-nebula rounded-2xl" />
          <Skeleton className="h-52 bg-nebula rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <motion.div className="space-y-4 max-w-5xl mx-auto" variants={containerVariants} initial="hidden" animate="visible">
      {/* ═══════════════════════════════════════════════════
          1. Welcome Header + Range Selector
      ═══════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Gauge className="h-5 w-5 theme-text" />
            {getGreeting()}, {session?.user?.name?.split(' ')[0] ?? 'User'}
          </h1>
          <p className="text-sm text-slate-500">{formatDateNow()}</p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && insightData && (
            <div className="flex items-center gap-2 mr-2">
              <div className="text-right hidden sm:block">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Health</p>
                <p className={`text-xs font-semibold ${insightData.healthScore >= 75 ? 'theme-text' : insightData.healthScore >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {insightData.healthScore >= 75 ? 'Sehat' : insightData.healthScore >= 50 ? 'Perhatian' : 'Kritis'}
                </p>
              </div>
              <HealthRing score={insightData.healthScore} />
            </div>
          )}
          {/* Range selector */}
          <div className="flex items-center bg-nebula border border-white/[0.06] rounded-xl p-1 gap-0.5">
            {(['day', 'week', 'month'] as const).map((r) => (
              <button
                key={r}
                onClick={() => { setRange(r); setLoading(true) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  range === r
                    ? 'theme-bg text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                {r === 'day' ? 'Hari' : r === 'week' ? 'Minggu' : 'Bulan'}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════
          2. Upgrade Banner (FREE only)
      ═══════════════════════════════════════════════════ */}
      {!planLoading && plan?.type === 'free' && (
        <motion.div variants={itemVariants}>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-500/[0.06] theme-gradient-subtle border border-white/[0.04]">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
              <p className="text-xs text-slate-400">
                Buka fitur <span className="font-medium text-slate-200">Forecasting & Prediksi</span> — upgrade ke Pro atau Enterprise
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0 theme-bg hover:theme-hover-light text-white text-xs font-medium h-7 px-3 rounded-lg gap-1.5"
              onClick={() => setCurrentPage('settings')}
            >
              <Crown className="h-3 w-3" />
              Upgrade
            </Button>
          </div>
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════
          3. Primary KPI Cards — Modern Terminal Style
      ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Revenue Card */}
        <motion.div variants={itemVariants}>
          <Card className="aether-card overflow-hidden relative group">
            <div className="absolute inset-0 bg-gradient-to-br theme-gradient-subtle opacity-60 group-hover:opacity-100 transition-opacity" />
            <CardContent className="p-4 relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-7 h-7 rounded-lg theme-bg-very-light flex items-center justify-center">
                    <CircleDollarSign className="h-3.5 w-3.5 theme-text" />
                  </div>
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Revenue</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-white tracking-tight">
                {stats ? formatCurrency(stats.rangeRevenue) : '-'}
              </p>
              <div className="flex items-center gap-2 mt-2">
                {stats && stats.previousRangeRevenue > 0 ? (
                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    isUp ? 'theme-bg-very-light theme-text' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {isUp ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                    {Math.abs(changePercent).toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-600">vs periode lalu</span>
                )}
                <span className="text-[10px] text-slate-600">
                  {getRangeLabel(range)}
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Transaksi Card */}
        <motion.div variants={itemVariants}>
          <Card className="aether-card overflow-hidden relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/[0.03] to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />
            <CardContent className="p-4 relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <Receipt className="h-3.5 w-3.5 text-violet-400" />
                  </div>
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Transaksi</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-white tracking-tight">
                {stats ? formatNumber(stats.rangeTransactions) : '-'}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] text-slate-600">periode lalu </span>
                <span className="text-[10px] text-slate-400 font-medium">
                  {stats ? formatNumber(stats.previousRangeTransactions) : '-'}
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Profit Card — OWNER */}
        {isOwner && (
          <motion.div variants={itemVariants}>
            <Card className="bg-nebula border border-amber-500/10 rounded-xl overflow-hidden relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/[0.04] to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />
              <CardContent className="p-4 relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      <TrendingUp className="h-3.5 w-3.5 text-amber-400" />
                    </div>
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Profit</p>
                  </div>
                </div>
                <p className="text-2xl font-bold text-amber-400 tracking-tight">
                  {stats && stats.rangeProfit !== null ? formatCurrency(stats.rangeProfit) : '-'}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] text-slate-600">margin </span>
                  <span className="text-[10px] text-amber-400/70 font-medium">
                    {stats && stats.rangeProfit !== null && stats.rangeRevenue > 0
                      ? ((stats.rangeProfit / stats.rangeRevenue) * 100).toFixed(1) + '%'
                      : '-'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* AOV Card */}
        <motion.div variants={itemVariants}>
          <Card className="aether-card overflow-hidden relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-sky-500/[0.03] to-transparent opacity-60 group-hover:opacity-100 transition-opacity" />
            <CardContent className="p-4 relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center">
                    <ShoppingBag className="h-3.5 w-3.5 text-sky-400" />
                  </div>
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Avg. Order</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-sky-400 tracking-tight">
                {stats ? formatCurrency(aov) : '-'}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] text-slate-600">rata-rata per transaksi</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ═══════════════════════════════════════════════════
          3b. Secondary KPI — Compact Summary Strip
      ═══════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants}>
        <div className="bg-nebula border border-white/[0.04] rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider font-medium">Brutto</span>
            <span className="text-sm font-bold text-slate-200">{stats ? formatCurrency(stats.rangeBrutto) : '-'}</span>
          </div>
          <div className="w-px h-4 bg-white/[0.06] hidden sm:block" />
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider font-medium">Diskon</span>
            <span className="text-sm font-bold text-orange-400">-{stats ? formatCurrency(stats.rangeDiscount) : '-'}</span>
          </div>
          <div className="w-px h-4 bg-white/[0.06] hidden sm:block" />
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider font-medium">PPN</span>
            <span className="text-sm font-bold text-slate-300">+{stats ? formatCurrency(stats.rangeTax) : '-'}</span>
          </div>
          <div className="w-px h-4 bg-white/[0.06] hidden sm:block" />
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider font-medium">Produk</span>
            <span className="text-sm font-bold text-slate-200">{stats ? formatNumber(stats.totalProducts) : '-'}</span>
          </div>
          <div className="w-px h-4 bg-white/[0.06] hidden sm:block" />
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-600 uppercase tracking-wider font-medium">Stok Rendah</span>
            <span className={`text-sm font-bold ${stats && stats.lowStockProducts > 0 ? 'text-red-400' : 'text-slate-200'}`}>
              {stats ? stats.lowStockProducts : '-'}
            </span>
          </div>
          {isOwner && (
            <>
              <div className="w-px h-4 bg-white/[0.06] hidden sm:block" />
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-600 uppercase tracking-wider font-medium">Total Profit</span>
                <span className="text-sm font-bold text-amber-400/70">{stats && stats.totalProfit !== null ? formatCurrency(stats.totalProfit) : '-'}</span>
              </div>
            </>
          )}
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════
          4. Quick Actions
      ═══════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { icon: <PlusCircle className="h-4 w-4 theme-text" />, label: 'Tambah Produk', page: 'products' as const },
            { icon: <ShoppingCart className="h-4 w-4 text-violet-400" />, label: 'Transaksi Baru', page: 'pos' as const },
            { icon: <FileBarChart className="h-4 w-4 text-sky-400" />, label: 'Laporan', page: 'transactions' as const },
          ].map((item) => (
            <Button
              key={item.page}
              variant="outline"
              className="h-auto py-2.5 px-2 bg-nebula border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.06] text-slate-300 hover:text-white transition-all rounded-xl gap-2 justify-center"
              onClick={() => setCurrentPage(item.page)}
            >
              {item.icon}
              <span className="text-[11px] font-medium">{item.label}</span>
            </Button>
          ))}
        </div>
      </motion.div>

      {/* ═══════════════════════════════════════════════════
          5. Revenue Chart — Modern Recharts Area
      ═══════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants}>
        <Card className="aether-card rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 theme-text" />
                <h2 className="text-sm font-semibold text-slate-200">
                  Revenue & Profit — {getRangeLabel(range)}
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-slate-500">Revenue</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-1.5 rounded-full bg-amber-400" />
                  <span className="text-[10px] text-slate-500">Profit</span>
                </div>
              </div>
            </div>
            {revenueChartData.length > 0 ? (
              <div className="h-56 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke="#34d399"
                      strokeWidth={2}
                      fill="url(#revenueGrad)"
                      dot={range !== 'day' ? { r: 2, fill: '#34d399' } : false}
                      activeDot={{ r: 4, fill: '#34d399', stroke: '#0f172a', strokeWidth: 2 }}
                    />
                    {isOwner && (
                      <Area
                        type="monotone"
                        dataKey="profit"
                        name="Profit"
                        stroke="#fbbf24"
                        strokeWidth={1.5}
                        fill="url(#profitGrad)"
                        dot={false}
                        activeDot={{ r: 3, fill: '#fbbf24', stroke: '#0f172a', strokeWidth: 2 }}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-56 flex flex-col items-center justify-center text-center">
                <BarChart3 className="h-8 w-8 text-slate-700 mb-2" />
                <p className="text-xs text-slate-500">Belum ada data untuk periode ini</p>
              </div>
            )}
            {/* Summary stats below chart */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-white/[0.04]">
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Revenue</p>
                <p className="text-sm font-bold text-emerald-400">{stats ? formatCurrency(stats.rangeRevenue) : '-'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Trx</p>
                <p className="text-sm font-bold text-slate-200">{stats ? formatNumber(stats.rangeTransactions) : '-'}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Rata-rata/Hari</p>
                <p className="text-sm font-bold text-slate-200">
                  {stats && stats.dailyBreakdown.length > 0
                    ? formatCurrency(stats.rangeRevenue / stats.dailyBreakdown.length)
                    : '-'}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Perubahan</p>
                <p className={`text-sm font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {changePercent !== 0 ? `${isUp ? '+' : ''}${changePercent.toFixed(1)}%` : '-'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══════════════════════════════════════════════════
          6. Peak Hours & Payment Method Row
      ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Peak Hours Chart — OWNER */}
        {isOwner && (
          <motion.div variants={itemVariants}>
            <Card className="aether-card rounded-2xl">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-violet-400" />
                    <h2 className="text-sm font-semibold text-slate-200">Jam Ramai</h2>
                  </div>
                  <span className="text-[10px] text-slate-500">{getRangeLabel(range)}</span>
                </div>
                {peakHoursChartData.length > 0 ? (
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={peakHoursChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis
                          dataKey="hour"
                          tick={{ fontSize: 9, fill: '#64748b' }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                          tickLine={false}
                          interval={1}
                        />
                        <YAxis
                          tick={{ fontSize: 9, fill: '#64748b' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="trx" name="Transaksi" radius={[3, 3, 0, 0]} maxBarSize={20}>
                          {peakHoursChartData.map((entry, i) => {
                            const isPeak = busiestHour && formatHour(busiestHour.hour) === entry.hour
                            return <Cell key={i} fill={isPeak ? '#8b5cf6' : '#34d399'} fillOpacity={isPeak ? 1 : 0.7} />
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-44 flex flex-col items-center justify-center text-center">
                    <Clock className="h-7 w-7 text-slate-700 mb-1.5" />
                    <p className="text-xs text-slate-500">Belum ada data transaksi</p>
                  </div>
                )}
                {busiestHour && busiestHour.transactionCount > 0 && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/10 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">Jam tersibuk</span>
                    <span className="text-[11px] font-semibold text-violet-400">
                      {formatHour(busiestHour.hour)} — {busiestHour.transactionCount} trx
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Payment Method Breakdown */}
        <motion.div variants={itemVariants}>
          <Card className="aether-card rounded-2xl">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-sky-400" />
                  <h2 className="text-sm font-semibold text-slate-200">Metode Pembayaran</h2>
                </div>
                <span className="text-[10px] text-slate-500">{getRangeLabel(range)}</span>
              </div>
              {paymentData.length > 0 ? (
                <div className="space-y-2.5">
                  {paymentData
                    .sort((a, b) => b.revenue - a.revenue)
                    .map((p) => {
                      const pct = stats && stats.rangeRevenue > 0 ? (p.revenue / stats.rangeRevenue) * 100 : 0
                      const methodLabel = p.method === 'CASH' ? 'Tunai' : p.method === 'QRIS' ? 'QRIS' : p.method === 'DEBIT' ? 'Debit' : p.method === 'TRANSFER' ? 'Transfer' : p.method
                      const methodIcon = p.method === 'CASH' ? <Wallet className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />
                      const methodColor = p.method === 'CASH' ? 'text-emerald-400' : p.method === 'QRIS' ? 'text-violet-400' : p.method === 'DEBIT' ? 'text-sky-400' : 'text-amber-400'
                      return (
                        <div key={p.method} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={methodColor}>{methodIcon}</span>
                              <span className="text-xs font-medium text-slate-300">{methodLabel}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500">{p.count} trx</span>
                              <span className="text-xs font-semibold text-slate-200">{formatCurrency(p.revenue)}</span>
                            </div>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-white/[0.04] overflow-hidden">
                            <motion.div
                              className={`h-full rounded-full ${p.method === 'CASH' ? 'bg-emerald-400' : p.method === 'QRIS' ? 'bg-violet-400' : p.method === 'DEBIT' ? 'bg-sky-400' : 'bg-amber-400'}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.6, ease: 'easeOut' }}
                            />
                          </div>
                        </div>
                      )
                    })}
                </div>
              ) : (
                <div className="h-44 flex flex-col items-center justify-center text-center">
                  <CreditCard className="h-7 w-7 text-slate-700 mb-1.5" />
                  <p className="text-xs text-slate-500">Belum ada data pembayaran</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ═══════════════════════════════════════════════════
          7. Forecast & Day Performance (PRO+)
      ═══════════════════════════════════════════════════ */}
      {isOwner && (
        <motion.div variants={itemVariants}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Forecast Summary Cards */}
            {hasForecasting && forecastData ? (
              <>
                <Card className="aether-card rounded-2xl">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Activity className="h-4 w-4 text-violet-400" />
                      <h2 className="text-sm font-semibold text-slate-200">Forecast & Trend</h2>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Trend direction */}
                      <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.03]">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Tren 14 Hari</p>
                        <div className="flex items-center gap-1.5">
                          <TrendIcon direction={forecastData.trendDirection} />
                          <p className={`text-sm font-bold ${
                            forecastData.trendDirection === 'up' ? 'theme-text' :
                            forecastData.trendDirection === 'down' ? 'text-red-400' : 'text-slate-200'
                          }`}>
                            {forecastData.trendDirection === 'up' ? 'Naik' :
                             forecastData.trendDirection === 'down' ? 'Turun' : 'Stabil'}
                          </p>
                        </div>
                        <div className="mt-1.5">
                          <Sparkline data={trendValues} color={
                            forecastData.trendDirection === 'up' ? 'theme-text' :
                            forecastData.trendDirection === 'down' ? 'text-red-400' : 'text-slate-400'
                          } height={24} />
                        </div>
                      </div>
                      {/* Projected Monthly */}
                      <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.03]">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Proyeksi Bulan</p>
                        <p className="text-sm font-bold text-violet-400">
                          {formatCurrency(forecastData.summary.projectedMonthly)}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          ~{formatCurrency(forecastData.summary.avgDailyRevenue)}/hari
                        </p>
                      </div>
                      {/* Week over week */}
                      <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.03]">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Week vs Week</p>
                        <p className={`text-sm font-bold ${
                          forecastData.summary.weekOverWeek > 0 ? 'theme-text' :
                          forecastData.summary.weekOverWeek < 0 ? 'text-red-400' : 'text-slate-200'
                        }`}>
                          {forecastData.summary.weekOverWeek > 0 ? '+' : ''}{forecastData.summary.weekOverWeek}%
                        </p>
                      </div>
                      {/* Stock alerts */}
                      <div className={`bg-white/[0.03] rounded-xl p-3 border ${
                        forecastData.summary.criticalStock > 0 ? 'border-red-500/20' :
                        forecastData.summary.warningStock > 0 ? 'border-amber-500/20' : 'border-white/[0.03]'
                      }`}>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Stok Kritis</p>
                        <p className={`text-sm font-bold ${
                          forecastData.summary.criticalStock > 0 ? 'text-red-400' :
                          forecastData.summary.warningStock > 0 ? 'text-amber-400' : 'theme-text'
                        }`}>
                          {forecastData.summary.criticalStock > 0
                            ? `${forecastData.summary.criticalStock} kritis`
                            : forecastData.summary.warningStock > 0
                              ? `${forecastData.summary.warningStock} peringatan`
                              : 'Aman'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Day of Week Performance */}
                <Card className="aether-card rounded-2xl">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Clock className="h-4 w-4 text-sky-400" />
                      <h2 className="text-sm font-semibold text-slate-200">Performa per Hari</h2>
                    </div>
                    {forecastData.dayPerformance.length === 0 ? (
                      <div className="flex flex-col items-center py-6 text-center">
                        <Clock className="h-7 w-7 text-slate-700 mb-1.5" />
                        <p className="text-xs text-slate-500">Belum cukup data</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {[...forecastData.dayPerformance.slice(1), forecastData.dayPerformance[0]].map((d) => (
                          <DayHeatBar
                            key={d.day}
                            day={d.day}
                            avgRevenue={d.avgRevenue}
                            maxRevenue={Math.max(...forecastData.dayPerformance.map((dp) => dp.avgRevenue), 1)}
                            avgTx={d.avgTx}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : !hasForecasting ? (
              <Card className="aether-card rounded-2xl lg:col-span-2">
                <CardContent className="py-10 flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/10 theme-gradient-subtle border border-white/[0.06] flex items-center justify-center mb-3">
                    <Activity className="h-6 w-6 text-violet-400/60" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-300 mb-1">Forecasting & Prediksi</h3>
                  <p className="text-xs text-slate-500 max-w-xs mb-4">
                    Prediksi revenue, analisa stok otomatis, dan rekomendasi berbasis data AI
                  </p>
                  <Button
                    size="sm"
                    className="theme-bg hover:theme-hover-light text-white text-xs font-medium h-8 px-4 rounded-lg gap-1.5"
                    onClick={() => setCurrentPage('settings')}
                  >
                    <Crown className="h-3 w-3" />
                    Upgrade ke PRO
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════
          8. AI Insight Card
      ═══════════════════════════════════════════════════ */}
      {isOwner && hasAiInsights && (
        <motion.div variants={itemVariants}>
          {insightData ? (
            <Card className="aether-card rounded-2xl">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-400" />
                    <h2 className="text-sm font-semibold text-slate-200">AI Insight — {getRangeLabel(range)}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <HealthRing score={insightData.healthScore} size="sm" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={fetchInsights}
                      disabled={insightLoading}
                      className="h-7 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] gap-1"
                    >
                      <RefreshCw className={`h-3 w-3 ${insightLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
                {insightData.topInsight ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <PriorityDot priority={insightData.topInsight.priority} />
                      <h3 className="text-sm font-semibold text-white">
                        {insightData.topInsight.emoji} {insightData.topInsight.title}
                      </h3>
                    </div>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      {insightData.topInsight.why}
                    </p>
                    {insightData.topInsight.actions.length > 0 && (
                      <ul className="space-y-1">
                        {insightData.topInsight.actions.map((action, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                            <span className="text-violet-400 mt-0.5 shrink-0">•</span>
                            {action}
                          </li>
                        ))}
                      </ul>
                    )}
                    {insightData.topInsight.cta.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {insightData.topInsight.cta.map((cta, i) => (
                          <Button
                            key={i}
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs font-medium bg-white/[0.04] border-white/[0.03] hover:bg-white/[0.04] hover:border-white/[0.06] text-slate-300 rounded-lg gap-1.5"
                            onClick={() => setCurrentPage(cta.page as 'pos' | 'products' | 'transactions' | 'customers' | 'settings' | 'crew' | 'dashboard' | 'audit-log')}
                          >
                            {cta.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 py-2">Semua berjalan baik! Tidak ada insight penting saat ini.</p>
                )}
                {otherInsights.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-white/[0.06]">
                    {otherInsights.slice(0, 5).map((insight) => (
                      <button
                        key={insight.id}
                        onClick={() => setInsightData((prev) => prev ? { ...prev, topInsight: insight } : null)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border cursor-pointer transition-colors hover:bg-white/[0.04] ${getPriorityBg(insight.priority)}`}
                      >
                        <PriorityDot priority={insight.priority} />
                        <span className="max-w-[140px] truncate text-slate-400">{insight.emoji} {insight.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </motion.div>
      )}

      {/* ═══════════════════════════════════════════════════
          9. Bottom Row — Top Products & Top Customers
      ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Top Products */}
        <motion.div variants={itemVariants}>
          <Card className="aether-card rounded-2xl">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 theme-text" />
                  <h2 className="text-sm font-semibold text-slate-200">Produk Terlaris</h2>
                </div>
                <span className="text-[10px] text-slate-500">{getRangeLabel(range)}</span>
              </div>
              {topSelling.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Package className="h-7 w-7 text-slate-700 mb-1.5" />
                  <p className="text-xs text-slate-500">Belum ada data untuk periode ini</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {topSelling.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.03]">
                      <span className={`text-[11px] font-bold w-4 text-center shrink-0 ${i === 0 ? 'text-amber-400' : 'text-slate-600'}`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-300 truncate">{p.name}</p>
                        <p className="text-[10px] text-slate-500">{formatNumber(p.qty)} unit</p>
                      </div>
                      <p className="text-xs font-semibold theme-text shrink-0">{formatCurrency(p.revenue)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Top Customers — OWNER */}
        {isOwner && (
          <motion.div variants={itemVariants}>
            <Card className="aether-card rounded-2xl">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <UsersRound className="h-4 w-4 text-sky-400" />
                    <h2 className="text-sm font-semibold text-slate-200">Top Customer</h2>
                  </div>
                  <span className="text-[10px] text-slate-500">All-time</span>
                </div>
                {(!stats?.topCustomers || stats.topCustomers.length === 0) ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <UsersRound className="h-7 w-7 text-slate-700 mb-1.5" />
                    <p className="text-xs text-slate-500">Belum ada data customer</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {stats.topCustomers.map((c, i) => (
                      <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.03]">
                        <span className={`text-[11px] font-bold w-4 text-center shrink-0 ${i === 0 ? 'text-amber-400' : 'text-slate-600'}`}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-300 truncate">{c.name}</p>
                          <p className="text-[10px] text-slate-500">{c.points} poin</p>
                        </div>
                        <p className="text-xs font-semibold text-sky-400 shrink-0">{formatCurrency(c.totalSpend)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════
          10. Low Stock Detail (Products & Variants)
      ═══════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants}>
        <Card className="aether-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                Produk Stok Menipis
              </h2>
              <div className="flex items-center gap-2">
                {stats && stats.lowStockVariants > 0 && (
                  <Badge className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px] gap-1">
                    <Layers className="h-3 w-3" />
                    {stats.lowStockVariants} varian
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentPage('products')}
                  className="h-7 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] gap-1"
                >
                  Lihat Semua
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {(!stats?.lowStockList || stats.lowStockList.length === 0) && (!stats?.lowStockVariantList || stats.lowStockVariantList.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Package className="h-8 w-8 theme-text-medium/30 mb-2" />
                <p className="text-xs text-slate-500">Semua stok aman</p>
              </div>
            ) : (
              <>
                {/* Mobile: compact card list */}
                <div className="flex flex-col gap-2 md:hidden max-h-60 overflow-y-auto">
                  {stats.lowStockList.map((p) => {
                    const isCritical = p.stock === 0
                    const isWarning = p.stock > 0 && p.stock <= p.lowStockAlert / 2
                    return (
                      <div key={p.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.03] p-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-200 font-medium truncate">{p.name}</p>
                          <p className="text-[10px] text-slate-500">Stok: {p.lowStockAlert} alert</p>
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          <span className={`text-sm font-bold ${isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-yellow-300'}`}>
                            {p.stock}
                          </span>
                          {isCritical ? (
                            <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px]">Habis</Badge>
                          ) : isWarning ? (
                            <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">Kritis</Badge>
                          ) : (
                            <Badge className="bg-yellow-500/10 border-yellow-500/20 text-yellow-400 text-[10px]">Rendah</Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {stats.lowStockVariantList && stats.lowStockVariantList.length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 pt-2 pb-1">
                        <Layers className="h-3 w-3 text-violet-400" />
                        <span className="text-[11px] font-medium text-violet-400">Varian Stok Rendah</span>
                      </div>
                      {stats.lowStockVariantList.map((v) => (
                        <div key={v.id} className="flex items-center gap-3 rounded-xl bg-violet-500/5 border border-violet-500/15 p-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-200 font-medium truncate">{v.name}</p>
                            <p className="text-[10px] text-slate-500 truncate">{v.productName}</p>
                          </div>
                          <div className="text-right shrink-0 flex items-center gap-2">
                            <span className={`text-sm font-bold ${v.stock === 0 ? 'text-red-400' : 'text-violet-400'}`}>
                              {v.stock}
                            </span>
                            <Badge className={`text-[10px] ${v.stock === 0 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-violet-500/10 border-violet-500/20 text-violet-400'}`}>
                              {v.stock === 0 ? 'Habis' : 'Rendah'}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {/* Desktop: full table */}
                <div className="hidden md:block overflow-x-auto max-h-60 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/[0.06] hover:bg-transparent sticky top-0 bg-nebula z-10">
                        <TableHead className="text-slate-500 text-[11px] w-8 py-2.5">#</TableHead>
                        <TableHead className="text-slate-500 text-[11px] py-2.5">Produk</TableHead>
                        <TableHead className="text-slate-500 text-[11px] text-right py-2.5">Stok</TableHead>
                        <TableHead className="text-slate-500 text-[11px] text-right py-2.5">Alert</TableHead>
                        <TableHead className="text-slate-500 text-[11px] text-center py-2.5">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.lowStockList.map((p, idx) => {
                        const isCritical = p.stock === 0
                        const isWarning = p.stock > 0 && p.stock <= p.lowStockAlert / 2
                        return (
                          <TableRow key={p.id} className="border-white/[0.04] hover:bg-white/[0.03]">
                            <TableCell className="text-[11px] text-slate-500 font-mono py-2.5">{idx + 1}</TableCell>
                            <TableCell className="text-xs text-slate-200 font-medium py-2.5">{p.name}</TableCell>
                            <TableCell className={`text-xs text-right font-bold py-2.5 ${isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-yellow-300'}`}>
                              {p.stock}
                            </TableCell>
                            <TableCell className="text-xs text-slate-500 text-right py-2.5">{p.lowStockAlert}</TableCell>
                            <TableCell className="text-center py-2.5">
                              {isCritical ? (
                                <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px]">Habis</Badge>
                              ) : isWarning ? (
                                <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">Kritis</Badge>
                              ) : (
                                <Badge className="bg-yellow-500/10 border-yellow-500/20 text-yellow-400 text-[10px]">Rendah</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      {stats.lowStockVariantList && stats.lowStockVariantList.length > 0 && (
                        <>
                          <TableRow className="border-white/[0.06] hover:bg-transparent">
                            <TableCell colSpan={5} className="py-2 px-0">
                              <div className="flex items-center gap-1.5 px-3">
                                <Layers className="h-3 w-3 text-violet-400" />
                                <span className="text-[11px] font-medium text-violet-400">Varian Stok Rendah</span>
                              </div>
                            </TableCell>
                          </TableRow>
                          {stats.lowStockVariantList.map((v) => (
                            <TableRow key={v.id} className="border-violet-500/10 hover:bg-violet-500/5">
                              <TableCell className="text-[11px] text-violet-400/50 font-mono py-2.5">
                                <Layers className="h-3 w-3 text-violet-400/50" />
                              </TableCell>
                              <TableCell className="py-2.5">
                                <p className="text-xs text-slate-200 font-medium">{v.name}</p>
                                <p className="text-[10px] text-slate-500">{v.productName}</p>
                              </TableCell>
                              <TableCell className={`text-xs text-right font-bold py-2.5 ${v.stock === 0 ? 'text-red-400' : 'text-violet-400'}`}>
                                {v.stock}
                              </TableCell>
                              <TableCell className="text-xs text-slate-500 text-right py-2.5">-</TableCell>
                              <TableCell className="text-center py-2.5">
                                <Badge className={`text-[10px] ${v.stock === 0 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-violet-500/10 border-violet-500/20 text-violet-400'}`}>
                                  {v.stock === 0 ? 'Habis' : 'Rendah'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
