'use client'

import { useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  BarChart3, Crown, Zap, Clock, Activity, Warehouse,
  Target, ArrowUpRight, ArrowDownRight, Minus, TrendingUp, TrendingDown, Lock,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { formatCurrency } from '@/lib/format'
import { usePageStore } from '@/hooks/use-page-store'
import type { DashboardStats, ForecastData, HourBucket } from '@/hooks/use-dashboard'
import { Sparkline, MiniBar, formatShortDate } from './dashboard-charts'

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } },
}

function TrendIcon({ direction }: { direction: 'up' | 'down' | 'stable' }) {
  if (direction === 'up') return <TrendingUp className="h-3.5 w-3.5 theme-text" />
  if (direction === 'down') return <TrendingDown className="h-3.5 w-3.5 text-red-400" />
  return <Minus className="h-3.5 w-3.5 text-slate-400" />
}

function RevenueLineChart({ trend, forecast }: {
  trend: { date: string; revenue: number }[]
  forecast: { date: string; predictedRevenue: number; isForecast: boolean }[]
}) {
  const chartW = 600, chartH = 160
  const pad = { top: 8, right: 8, bottom: 24, left: 8 }
  const innerW = chartW - pad.left - pad.right
  const innerH = chartH - pad.top - pad.bottom
  const allValues = [...trend.map((d) => d.revenue), ...forecast.map((d) => d.predictedRevenue)]
  const maxVal = Math.max(...allValues, 1)
  const minVal = Math.min(...allValues, 0)
  const range = maxVal - minVal || 1
  const allPoints = [...trend.map((d) => ({ x: d.date, y: d.revenue })), ...forecast.map((d) => ({ x: d.date, y: d.predictedRevenue }))]
  const totalPts = allPoints.length
  const toX = (i: number) => pad.left + (i / (totalPts - 1)) * innerW
  const toY = (v: number) => pad.top + innerH - ((v - minVal) / range) * innerH

  const actualPath = trend.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(d.revenue).toFixed(1)}`).join(' ')
  const forecastPath = forecast.map((d, i) => {
    const idx = trend.length + i
    if (i === 0) return `M${toX(trend.length - 1).toFixed(1)},${toY(trend[trend.length - 1].revenue).toFixed(1)} L${toX(idx).toFixed(1)},${toY(d.predictedRevenue).toFixed(1)}`
    return `L${toX(idx).toFixed(1)},${toY(d.predictedRevenue).toFixed(1)}`
  }).join(' ')
  const actualArea = `${actualPath} L${toX(trend.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${toX(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`
  const forecastArea = (() => {
    const lastTrendX = toX(trend.length - 1).toFixed(1)
    const lastForecastX = toX(totalPts - 1).toFixed(1)
    const baseY = (pad.top + innerH).toFixed(1)
    const pts = forecast.map((d, i) => `${toX(trend.length + i).toFixed(1)},${toY(d.predictedRevenue).toFixed(1)}`).join(' ')
    return `M${lastTrendX},${baseY} L${lastTrendX},${toY(trend[trend.length - 1].revenue).toFixed(1)} L${pts} L${lastForecastX},${baseY} Z`
  })()

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <path d={actualArea} fill="url(#actualGrad)" />
        <path d={forecastArea} fill="url(#forecastGrad)" />
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
          <line key={pct} x1={pad.left} y1={pad.top + innerH * (1 - pct)} x2={chartW - pad.right} y2={pad.top + innerH * (1 - pct)} stroke="rgb(63 63 70)" strokeWidth={0.5} />
        ))}
        <motion.path d={actualPath} fill="none" stroke="rgb(52 211 153)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: 'easeOut' }} />
        <motion.path d={forecastPath} fill="none" stroke="rgb(167 139 250)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.6, ease: 'easeOut' }} />
        {trend.map((d, i) => (
          <motion.circle key={`a-${i}`} cx={toX(i)} cy={toY(d.revenue)} r={i % 3 === 0 ? 3 : 0} fill="rgb(52 211 153)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 + i * 0.03 }} />
        ))}
        {forecast.map((d, i) => (
          <motion.circle key={`f-${i}`} cx={toX(trend.length + i)} cy={toY(d.predictedRevenue)} r={i % 2 === 0 ? 3 : 0} fill="rgb(167 139 250)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 + i * 0.03 }} />
        ))}
        {allPoints.filter((_, i) => i % 3 === 0).map((p, i) => (
          <text key={i} x={toX(i * 3)} y={chartH - 4} textAnchor="middle" className="fill-slate-600" style={{ fontSize: '9px' }}>{formatShortDate(p.x)}</text>
        ))}
        <defs>
          <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(167 139 250)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="rgb(167 139 250)" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

function DayHeatBar({ day, avgRevenue, maxRevenue, avgTx }: { day: string; avgRevenue: number; maxRevenue: number; avgTx: number }) {
  const pct = maxRevenue > 0 ? Math.min((avgRevenue / maxRevenue) * 100, 100) : 0
  const today = new Date().getDay()
  const dayIndex = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].indexOf(day)
  const isToday = dayIndex === today
  const intensity = pct > 80 ? 'theme-gradient-light' : pct > 50 ? 'theme-gradient-subtle' : 'from-slate-600/20 to-slate-500/10'

  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`text-[11px] w-8 shrink-0 font-medium ${isToday ? 'theme-text' : 'text-slate-500'}`}>{day}</span>
      <div className={`flex-1 h-5 rounded-md bg-gradient-to-r ${intensity} border ${isToday ? 'theme-border-medium' : 'border-white/[0.03]'} relative overflow-hidden`}>
        <motion.div className={`absolute inset-y-0 left-0 rounded-md ${isToday ? 'theme-bg-subtle' : 'bg-zinc-500/10'}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
        <div className="absolute inset-0 flex items-center justify-between px-2">
          <span className="text-[9px] text-slate-400 font-medium">{formatCurrency(avgRevenue)}</span>
          <span className="text-[9px] text-slate-500">{avgTx} trx</span>
        </div>
      </div>
    </div>
  )
}

// ── Main Analytics Tabs Component ──
export function AnalyticsTabs({
  stats, forecastData, forecastLoading, hasForecasting, isOwner, isPro,
}: {
  stats: DashboardStats
  forecastData: ForecastData | null
  forecastLoading: boolean
  hasForecasting: boolean
  isOwner: boolean
  isPro: boolean
}) {
  const { setCurrentPage } = usePageStore()
  const busiestHour = stats.peakHours?.reduce((max, b) => (b.transactionCount > max.transactionCount ? b : max), { hour: 0, transactionCount: 0, revenue: 0 })
  const maxTxCount = stats.peakHours ? Math.max(...stats.peakHours.map((b) => b.transactionCount), 1) : 1
  const trendValues = forecastData?.trend.map((d) => d.revenue) ?? []

  if (!isOwner) return null

  return (
    <motion.div variants={itemVariants}>
      <Tabs defaultValue="forecast" className="space-y-3">
        <TabsList className="bg-nebula border border-white/[0.06] rounded-xl h-9 p-1">
          <TabsTrigger value="forecast" className="text-xs gap-1.5 rounded-lg data-[state=active]:bg-white/[0.04] data-[state=active]:text-white">
            {!hasForecasting && <Lock className="h-3 w-3" />}
            <Activity className="h-3 w-3" />
            Forecasting
          </TabsTrigger>
          <TabsTrigger value="pnl" className="text-xs gap-1.5 rounded-lg data-[state=active]:bg-white/[0.04] data-[state=active]:text-white">
            <BarChart3 className="h-3 w-3" />
            Laba & Rugi
          </TabsTrigger>
          <TabsTrigger value="peak" className="text-xs gap-1.5 rounded-lg data-[state=active]:bg-white/[0.04] data-[state=active]:text-white">
            {!isPro && <Lock className="h-3 w-3" />}
            <Clock className="h-3 w-3" />
            Jam Ramai
          </TabsTrigger>
        </TabsList>

        {/* Forecast Tab */}
        <TabsContent value="forecast" className="mt-0">
          {!hasForecasting ? (
            <UpgradeCard icon={<Activity className="h-6 w-6 text-violet-400/60" />} title="Forecasting & Prediksi" desc="Prediksi revenue, analisa stok otomatis, dan rekomendasi berbasis data AI" />
          ) : forecastLoading && !forecastData ? (
            <Card className="aether-card rounded-2xl"><CardContent className="p-5 space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 bg-white/[0.04] rounded-xl" />)}</div>
              <Skeleton className="h-40 bg-white/[0.04] rounded-xl" />
            </CardContent></Card>
          ) : forecastData ? (
            <ForecastContent forecastData={forecastData} trendValues={trendValues} />
          ) : null}
        </TabsContent>

        {/* P&L Tab */}
        <TabsContent value="pnl" className="mt-0">
          <Card className="aether-card rounded-2xl"><CardContent className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-slate-200">Laba & Rugi Hari Ini</h2>
            </div>
            <PnLGrid stats={stats} />
          </CardContent></Card>
        </TabsContent>

        {/* Peak Hours Tab */}
        <TabsContent value="peak" className="mt-0">
          {!isPro ? (
            <UpgradeCard icon={<Clock className="h-6 w-6 text-violet-400/60" />} title="Analisa Jam Ramai" desc="Lihat jam tersibuk untuk optimasi shift karyawan dan operasional" />
          ) : (
            <PeakHoursContent stats={stats} busiestHour={busiestHour} maxTxCount={maxTxCount} />
          )}
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}

function UpgradeCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  const { setCurrentPage } = usePageStore()
  return (
    <Card className="aether-card rounded-2xl"><CardContent className="py-10 flex flex-col items-center justify-center text-center">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/10 to-sky-500/10 border border-white/[0.06] flex items-center justify-center mb-3">{icon}</div>
      <h3 className="text-sm font-semibold text-slate-300 mb-1">{title}</h3>
      <p className="text-xs text-slate-500 max-w-xs mb-4">{desc}</p>
      <Button size="sm" className="theme-bg hover:theme-hover-light text-white text-xs font-medium h-8 px-4 rounded-lg gap-1.5" onClick={() => setCurrentPage('settings')}>
        <Crown className="h-3 w-3" />Upgrade ke PRO
      </Button>
    </CardContent></Card>
  )
}

function ForecastContent({ forecastData, trendValues }: { forecastData: ForecastData; trendValues: number[] }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="aether-card"><CardContent className="p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Tren Revenue 14 Hari</p>
            <TrendIcon direction={forecastData.trendDirection} />
          </div>
          <p className={`text-sm font-bold ${forecastData.trendDirection === 'up' ? 'theme-text' : forecastData.trendDirection === 'down' ? 'text-red-400' : 'text-slate-200'}`}>
            {forecastData.trendDirection === 'up' ? 'Naik' : forecastData.trendDirection === 'down' ? 'Turun' : 'Stabil'}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">Total pendapatan harian</p>
          <div className="mt-1.5"><Sparkline data={trendValues} color={forecastData.trendDirection === 'up' ? 'theme-text' : forecastData.trendDirection === 'down' ? 'text-red-400' : 'text-slate-400'} height={24} /></div>
        </CardContent></Card>

        <Card className="aether-card"><CardContent className="p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Proyeksi Bulan</p>
            <Target className="h-3.5 w-3.5 text-violet-400" />
          </div>
          <p className="text-sm font-bold text-violet-400">{formatCurrency(forecastData.summary.projectedMonthly)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">~{formatCurrency(forecastData.summary.avgDailyRevenue)}/hari</p>
        </CardContent></Card>

        <Card className="aether-card"><CardContent className="p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Week vs Week</p>
            {forecastData.summary.weekOverWeek > 0 ? <ArrowUpRight className="h-3.5 w-3.5 theme-text" /> : forecastData.summary.weekOverWeek < 0 ? <ArrowDownRight className="h-3.5 w-3.5 text-red-400" /> : <Minus className="h-3.5 w-3.5 text-slate-400" />}
          </div>
          <p className={`text-sm font-bold ${forecastData.summary.weekOverWeek > 0 ? 'theme-text' : forecastData.summary.weekOverWeek < 0 ? 'text-red-400' : 'text-slate-200'}`}>
            {forecastData.summary.weekOverWeek > 0 ? '+' : ''}{forecastData.summary.weekOverWeek}%
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">vs minggu lalu</p>
        </CardContent></Card>

        <Card className={`bg-nebula border rounded-xl ${forecastData.summary.criticalStock > 0 ? 'border-red-500/20' : forecastData.summary.warningStock > 0 ? 'border-amber-500/20' : 'border-white/[0.06]'}`}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Stok Kritis</p>
              <Warehouse className={`h-3.5 w-3.5 ${forecastData.summary.criticalStock > 0 ? 'text-red-400' : forecastData.summary.warningStock > 0 ? 'text-amber-400' : 'theme-text'}`} />
            </div>
            <p className={`text-sm font-bold ${forecastData.summary.criticalStock > 0 ? 'text-red-400' : forecastData.summary.warningStock > 0 ? 'text-amber-400' : 'theme-text'}`}>
              {forecastData.summary.criticalStock > 0 ? `${forecastData.summary.criticalStock} kritis` : forecastData.summary.warningStock > 0 ? `${forecastData.summary.warningStock} peringatan` : 'Aman'}
            </p>
            <p className={`text-[10px] mt-0.5 ${forecastData.summary.criticalStock > 0 ? 'text-red-400/60' : forecastData.summary.warningStock > 0 ? 'text-amber-400/60' : 'text-slate-500'}`}>
              {forecastData.summary.criticalStock > 0 ? `⚡ ${forecastData.summary.criticalStock} produk habis dalam 3 hari` : forecastData.summary.warningStock > 0 ? `⚠️ ${forecastData.summary.warningStock} produk menipis (velocity 14 hari)` : '✓ Semua stok aman berdasarkan penjualan'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="aether-card rounded-2xl"><CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-slate-200">Revenue Trend & Forecast</h2>
            </div>
            <div className="hidden sm:flex items-center gap-3">
              <div className="flex items-center gap-1.5"><div className="w-6 h-[2px] rounded-full theme-bg-light" /><span className="text-[10px] text-slate-500">Aktual 14 hari</span></div>
              <div className="flex items-center gap-1.5"><div className="w-6 h-[2px] rounded-full bg-violet-400 border-dashed" /><span className="text-[10px] text-slate-500">Prediksi 7 hari</span></div>
            </div>
          </div>
          <div className="sm:hidden mb-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.03]">
            <p className="text-[10px] text-slate-400">📊 <span className="theme-text font-medium">Hijau</span>: aktual • <span className="text-violet-400 font-medium">Ungu</span>: prediksi</p>
          </div>
          <RevenueLineChart trend={forecastData.trend} forecast={forecastData.forecast} />
          <div className="mt-3 flex items-center justify-between px-1">
            <div className="flex items-center gap-4">
              <div><p className="text-[10px] text-slate-500">Rata-rata/hari</p><p className="text-xs font-semibold text-slate-200">{formatCurrency(forecastData.summary.avgDailyRevenue)}</p></div>
              <div><p className="text-[10px] text-slate-500">Proyeksi minggu depan</p><p className="text-xs font-semibold text-violet-400">{formatCurrency(forecastData.summary.projectedWeekly)}</p></div>
            </div>
          </div>
        </CardContent></Card>

        <Card className="aether-card rounded-2xl"><CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-200">Performa per Hari</h2>
          </div>
          {forecastData.dayPerformance.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center"><Clock className="h-7 w-7 text-slate-700 mb-1.5" /><p className="text-xs text-slate-500">Belum cukup data</p></div>
          ) : (
            <div className="space-y-1">
              {[...forecastData.dayPerformance.slice(1), forecastData.dayPerformance[0]].map((d) => (
                <DayHeatBar key={d.day} day={d.day} avgRevenue={d.avgRevenue} maxRevenue={Math.max(...forecastData.dayPerformance.map((dp) => dp.avgRevenue), 1)} avgTx={d.avgTx} />
              ))}
            </div>
          )}
        </CardContent></Card>
      </div>

      {forecastData.stockPredictions.length > 0 && (
        <Card className="aether-card rounded-2xl"><CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Warehouse className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-slate-200">Prediksi Stok</h2>
            <Badge className="text-[9px] bg-white/[0.04] border-white/[0.03] text-slate-400 ml-auto">{forecastData.stockPredictions.length} produk</Badge>
          </div>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {forecastData.stockPredictions.map((p, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${p.status === 'critical' ? 'bg-red-500/[0.04] border-red-500/15' : p.status === 'warning' ? 'bg-amber-500/[0.04] border-amber-500/15' : 'bg-white/[0.03] border-white/[0.03]'}`}>
                <span className="text-[10px] font-bold text-slate-600 w-4 text-center shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0"><p className="text-xs font-medium text-slate-300 truncate">{p.name}</p><p className="text-[10px] text-slate-500">sisa {p.stock} • {p.dailyVelocity}/hari</p></div>
                <div className="text-right shrink-0"><p className={`text-xs font-bold ${p.status === 'critical' ? 'text-red-400' : p.status === 'warning' ? 'text-amber-400' : 'text-slate-300'}`}>{p.daysUntilEmpty === Infinity ? '∞' : `${p.daysUntilEmpty}h`}</p><p className="text-[9px] text-slate-600">habis</p></div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}
    </div>
  )
}

function PnLGrid({ stats }: { stats: DashboardStats }) {
  const items = [
    { label: 'Brutto', value: stats.todayBrutto, color: 'text-slate-200', barColor: 'bg-zinc-400' },
    { label: 'Diskon', value: -stats.todayDiscount, color: 'text-red-400', barColor: 'bg-red-400' },
    { label: 'Netto', value: stats.todayRevenue, color: 'theme-text', barColor: 'theme-bg-light' },
    { label: 'PPN', value: stats.todayTax, color: 'text-sky-400', barColor: 'bg-sky-400' },
    { label: 'Profit', value: stats.todayProfit ?? 0, color: 'text-amber-400', barColor: 'bg-amber-400' },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl bg-white/[0.03] border border-white/[0.03] p-3 space-y-2">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{item.label}</p>
          <p className={`text-sm font-bold ${item.color}`}>{item.value < 0 ? '-' : ''}{formatCurrency(Math.abs(item.value))}</p>
          <MiniBar value={Math.abs(item.value)} max={stats.todayBrutto || 1} color={item.barColor} />
        </div>
      ))}
    </div>
  )
}

function PeakHoursContent({ stats, busiestHour, maxTxCount }: { stats: DashboardStats; busiestHour: { hour: number; transactionCount: number; revenue: number }; maxTxCount: number }) {
  return (
    <div className="space-y-3">
      <Card className="aether-card rounded-2xl"><CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-slate-200">Jam Ramai Hari Ini</h2>
            {busiestHour.transactionCount > 0 && <Badge className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px]">Puncak: {String(busiestHour.hour).padStart(2, '0')}:00</Badge>}
          </div>
          {stats.todayTransactions > 0 && (
            <div className="flex items-center gap-3 text-[10px]">
              <span className="text-slate-500">Total hari ini:</span>
              <span className="font-semibold text-slate-200">{stats.todayTransactions} trx</span>
              <span className="text-slate-600">•</span>
              <span className="font-semibold theme-text">{formatCurrency(stats.todayRevenue)}</span>
            </div>
          )}
        </div>
        <div className="relative h-40 sm:h-48">
          <div className="absolute left-0 top-0 bottom-6 w-7 flex flex-col justify-between text-[10px] text-slate-600">
            <span>{maxTxCount}</span><span>{Math.round(maxTxCount / 2)}</span><span>0</span>
          </div>
          <div className="ml-9 h-full relative">
            {[0, 0.5, 1].map((pct) => <div key={pct} className="absolute left-0 right-0 border-t border-white/[0.04]" style={{ top: `${(1 - pct) * 100}%` }} />)}
            <svg viewBox="0 0 600 160" className="w-full h-full" preserveAspectRatio="none">
              <defs><linearGradient id="peakGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.2" /><stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" /></linearGradient></defs>
              {(() => {
                const points = (stats.peakHours || []).map((b, i) => { const x = (i / 23) * 600; const y = maxTxCount > 0 ? 155 - (b.transactionCount / maxTxCount) * 140 : 155; return `${x},${y}` })
                if (points.length < 2) return null
                return <polygon points={`${points.join(' ')} 600,155 0,155`} fill="url(#peakGrad)" />
              })()}
              <motion.polyline fill="none" stroke="rgb(52 211 153)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                points={(stats.peakHours || []).map((b, i) => { const x = (i / 23) * 600; const y = maxTxCount > 0 ? 155 - (b.transactionCount / maxTxCount) * 140 : 155; return `${x},${y}` }).join(' ')}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: 'easeOut' }} />
              {(stats.peakHours || []).map((b, i) => {
                const x = (i / 23) * 600; const y = maxTxCount > 0 ? 155 - (b.transactionCount / maxTxCount) * 140 : 155
                const isPeak = busiestHour?.hour === b.hour && b.transactionCount > 0
                return <motion.circle key={i} cx={x} cy={y} r={isPeak ? 5 : b.transactionCount > 0 ? 2.5 : 0} fill={isPeak ? 'rgb(167 139 250)' : b.transactionCount > 0 ? 'rgb(52 211 153)' : 'transparent'} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 + i * 0.02 }} />
              })}
            </svg>
            <div className="flex justify-between mt-1 px-0">{[0, 3, 6, 9, 12, 15, 18, 21, 23].map((h) => <span key={h} className="text-[9px] text-slate-600">{String(h).padStart(2, '0')}</span>)}</div>
          </div>
        </div>
      </CardContent></Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="aether-card"><CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2"><div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center"><Zap className="h-3.5 w-3.5 text-violet-400" /></div><p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Jam Puncak</p></div>
          {busiestHour.transactionCount > 0 ? (<><p className="text-lg font-bold text-violet-400">{String(busiestHour.hour).padStart(2, '0')}:00</p><p className="text-[10px] text-slate-500 mt-0.5">{busiestHour.transactionCount} trx • {formatCurrency(busiestHour.revenue)}</p></>) : (<p className="text-xs text-slate-500">Belum ada transaksi</p>)}
        </CardContent></Card>
        <Card className="aether-card"><CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2"><div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center"><Clock className="h-3.5 w-3.5 text-slate-400" /></div><p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Jam Sepi</p></div>
          {(() => {
            const quietHours = stats.peakHours?.filter(b => b.transactionCount === 0)
            const quietRange = quietHours && quietHours.length > 0 ? (() => { const hours = quietHours.map(h => h.hour).sort((a, b) => a - b); let bestStart = hours[0], bestEnd = hours[0], curStart = hours[0], curEnd = hours[0]; for (let i = 1; i < hours.length; i++) { if (hours[i] === curEnd + 1) { curEnd = hours[i] } else { if (curEnd - curStart > bestEnd - bestStart) { bestStart = curStart; bestEnd = curEnd } curStart = hours[i]; curEnd = hours[i] } } if (curEnd - curStart > bestEnd - bestStart) { bestStart = curStart; bestEnd = curEnd } return { start: bestStart, end: bestEnd, count: quietHours.length } })() : null
            return quietRange ? (<><p className="text-lg font-bold text-slate-300">{String(quietRange.start).padStart(2, '0')}:00–{String(quietRange.end).padStart(2, '0')}:00</p><p className="text-[10px] text-slate-500 mt-0.5">{quietRange.count} jam tanpa transaksi</p></>) : (<p className="text-xs text-slate-500">Semua jam aktif</p>)
          })()}
        </CardContent></Card>
        <Card className="aether-card"><CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2"><div className="w-7 h-7 rounded-lg theme-bg-very-light flex items-center justify-center"><Activity className="h-3.5 w-3.5 theme-text" /></div><p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Rata-rata/Jam</p></div>
          {(() => { const activeHours = stats.peakHours?.filter(b => b.transactionCount > 0).length ?? 0; const avgPerHour = activeHours > 0 ? stats.todayTransactions / activeHours : 0; const avgRevenuePerHour = activeHours > 0 ? stats.todayRevenue / activeHours : 0; return activeHours > 0 ? (<><p className="text-lg font-bold theme-text">{avgPerHour.toFixed(1)} trx</p><p className="text-[10px] text-slate-500 mt-0.5">~{formatCurrency(Math.round(avgRevenuePerHour))}/jam • {activeHours} jam aktif</p></>) : (<p className="text-xs text-slate-500">Belum ada data</p>) })()}
        </CardContent></Card>
      </div>
    </div>
  )
}