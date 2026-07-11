'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Package, Users, AlertTriangle, Layers, Sparkles, RefreshCw, FlaskConical, ShieldAlert, Zap, ArrowRight, Brain, ChevronDown, Eye, TrendingDown } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { usePageStore } from '@/hooks/use-page-store'
import type { DashboardStats, InsightEngineData, InsightItem } from '@/hooks/use-dashboard'
import { useSalesSummary } from '@/hooks/use-dashboard'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { HealthRing } from './dashboard-charts'

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } },
}

function PriorityDot({ priority }: { priority: InsightItem['priority'] }) {
  const map: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '✅' }
  return <span className="shrink-0">{map[priority]}</span>
}

function getPriorityBg(priority: InsightItem['priority']): string {
  switch (priority) {
    case 'critical': return 'bg-red-500/8 border-red-500/15'
    case 'high': return 'bg-orange-500/8 border-orange-500/15'
    case 'medium': return 'bg-amber-500/8 border-amber-500/15'
    case 'low': return 'theme-bg-ultra-light theme-border-light'
  }
}

// ── Sales & Products Unified Card (self-contained with period filter) ──

type Period = 'today' | 'week' | 'month'

const PERIOD_TABS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Hari Ini' },
  { key: 'week', label: 'Minggu Ini' },
  { key: 'month', label: 'Bulan Ini' },
]

export function SalesProductsCard({
  lowStockList,
  lowStockVariantList,
  lowStockVariants,
  fallbackCustomers,
  enabled = true,
}: {
  lowStockList: { id: string; name: string; stock: number; lowStockAlert: number }[]
  lowStockVariantList?: { id: string; name: string; stock: number; productName: string }[]
  lowStockVariants?: number
  fallbackCustomers?: { id: string; name: string; whatsapp: string; totalSpend: number; points: number }[]
  enabled?: boolean
}) {
  const [period, setPeriod] = useState<Period>('today')
  const { data: summary, isLoading } = useSalesSummary(period, enabled)

  const products = summary?.topSelling ?? []
  // Use period-filtered customers from summary, fallback to all-time topCustomers from main dashboard
  const customers = (summary?.topCustomers && summary.topCustomers.length > 0)
    ? summary.topCustomers
    : (fallbackCustomers ?? []).map(c => ({ ...c, txCount: 0 }))
  const revenue = summary?.revenue ?? 0
  const transactions = summary?.transactions ?? 0
  const hasProducts = products.length > 0
  const hasCustomers = customers.length > 0
  const hasLowStock = lowStockList.length > 0 || (lowStockVariantList && lowStockVariantList.length > 0)
  const topProduct = products[0]

  return (
    <motion.div variants={itemVariants}>
      <Card className="aether-card rounded-2xl overflow-hidden">
        <CardContent className="p-4 sm:p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/15 to-fuchsia-500/15 border border-violet-500/15 flex items-center justify-center shrink-0">
                <Package className="h-4 w-4 text-violet-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Penjualan & Produk</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">Produk terlaris, pelanggan & stok</p>
              </div>
            </div>
            {hasProducts && topProduct && (
              <div className="text-right hidden sm:block">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Best Seller</p>
                <p className="text-xs font-semibold text-slate-300">{topProduct.name}</p>
              </div>
            )}
          </div>

          {/* Period filter tabs */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.03] border border-white/[0.04] mb-4">
            {PERIOD_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setPeriod(tab.key)}
                className={cn(
                  'flex-1 text-center text-[11px] font-medium py-1.5 rounded-md transition-all duration-200 cursor-pointer',
                  period === tab.key
                    ? 'bg-white/[0.08] text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]',
                )}
              >
                {tab.label}
              </button>
            ))}
            {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-500 ml-auto" />}
          </div>

          {/* Summary pills */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <span className="text-[10px] text-slate-500">Revenue</span>
              <span className="text-xs font-semibold theme-text">{formatCurrency(revenue)}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <span className="text-[10px] text-slate-500">Transaksi</span>
              <span className="text-xs font-semibold text-slate-200">{formatNumber(transactions)}</span>
            </div>
            {hasProducts && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]">
                <span className="text-[10px] text-slate-500">Unit Terjual</span>
                <span className="text-xs font-semibold text-slate-200">{formatNumber(products.reduce((s, p) => s + p.qty, 0))}</span>
              </div>
            )}
            {hasCustomers && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]">
                <span className="text-[10px] text-slate-500">Pelanggan</span>
                <span className="text-xs font-semibold text-sky-400">{customers.length}</span>
              </div>
            )}
            {hasLowStock && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/[0.06] border border-red-500/15">
                <AlertTriangle className="h-3 w-3 text-red-400" />
                <span className="text-[10px] text-red-400">Stok Rendah</span>
                <span className="text-xs font-semibold text-red-400">{lowStockList.length + (lowStockVariantList?.length ?? 0)}</span>
              </div>
            )}
          </div>

          {/* Three sections: Products | Customers | Low Stock */}
          {!hasProducts && !hasCustomers && !hasLowStock ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Package className="h-7 w-7 text-slate-700 mb-1.5" />
              <p className="text-xs text-slate-500">Belum ada data untuk periode ini</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* ── Top Products Column ── */}
              <div>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Package className="h-3.5 w-3.5 theme-text" />
                  <h3 className="text-xs font-semibold text-slate-300">Produk Terlaris</h3>
                  {hasProducts && (
                    <span className="text-[10px] text-slate-600 ml-auto">{products.length}</span>
                  )}
                </div>
                {hasProducts ? (
                  <div className="space-y-1.5">
                    {products.slice(0, 5).map((p, i) => {
                      const maxRev = products[0]?.revenue ?? 0
                      const pct = maxRev > 0 ? Math.round((p.revenue / maxRev) * 100) : 0
                      return (
                        <div key={i} className="rounded-lg bg-white/[0.02] border border-white/[0.03] p-2.5 hover:bg-white/[0.04] transition-colors">
                          <div className="flex items-center gap-2.5">
                            <span className={`text-[11px] font-bold w-4 text-center shrink-0 ${i === 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                              {i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-xs font-medium text-slate-300 truncate">{p.name}</p>
                                <p className="text-xs font-semibold theme-text shrink-0 ml-2">{formatCurrency(p.revenue)}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                                  <motion.div
                                    className="h-full rounded-full theme-gradient-bar"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${pct}%` }}
                                    transition={{ duration: 0.6, delay: i * 0.08, ease: 'easeOut' }}
                                  />
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-[10px] text-slate-500">{formatNumber(p.qty)}u</span>
                                  <span className="text-[10px] text-slate-600">·</span>
                                  <span className="text-[10px] text-slate-500">{p.txCount}x trx</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-600 py-4 text-center">Belum ada penjualan</p>
                )}
              </div>

              {/* ── Top Customers Column ── */}
              <div>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Users className="h-3.5 w-3.5 text-sky-400" />
                  <h3 className="text-xs font-semibold text-slate-300">Top Customer</h3>
                  {hasCustomers && (
                    <span className="text-[10px] text-slate-600 ml-auto">{customers.length}</span>
                  )}
                </div>
                {hasCustomers ? (
                  <div className="space-y-1.5">
                    {customers.slice(0, 5).map((c, i) => (
                      <div key={c.id} className="rounded-lg bg-white/[0.02] border border-white/[0.03] p-2.5 hover:bg-white/[0.04] transition-colors">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold ${i === 0 ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' : 'bg-white/[0.04] text-slate-500 border border-white/[0.06]'}`}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-300 truncate">{c.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-500">{c.points} poin</span>
                              {i === 0 && <span className="text-[9px] text-amber-400/70">⭐ Loyal</span>}
                            </div>
                          </div>
                          <p className="text-xs font-semibold text-sky-400 shrink-0">{formatCurrency(c.totalSpend)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-600 py-4 text-center">Belum ada data</p>
                )}
              </div>

              {/* ── Low Stock Column ── */}
              <div>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                  <h3 className="text-xs font-semibold text-slate-300">Stok Menipis</h3>
                  {(lowStockVariants ?? 0) > 0 && (
                    <Badge className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[9px] h-4 px-1 gap-0.5 ml-auto">
                      <Layers className="h-2.5 w-2.5" />{lowStockVariants}
                    </Badge>
                  )}
                </div>
                {hasLowStock ? (
                  <div className="space-y-1.5">
                    {lowStockList.slice(0, 4).map((p) => {
                      const isCritical = p.stock === 0
                      const isWarning = p.stock > 0 && p.stock <= p.lowStockAlert / 2
                      return (
                        <div key={p.id} className="rounded-lg bg-white/[0.02] border border-white/[0.03] p-2.5 hover:bg-white/[0.04] transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0 mr-2">
                              <p className="text-xs font-medium text-slate-300 truncate">{p.name}</p>
                              <p className="text-[10px] text-slate-500">Alert: {p.lowStockAlert}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`text-xs font-bold ${isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-yellow-300'}`}>
                                {p.stock}
                              </span>
                              <Badge className={`text-[9px] h-4 px-1 ${isCritical ? 'bg-red-500/10 border-red-500/20 text-red-400' : isWarning ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'}`}>
                                {isCritical ? 'Habis' : isWarning ? 'Kritis' : 'Rendah'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {lowStockVariantList && lowStockVariantList.length > 0 && (
                      lowStockVariantList.slice(0, 2).map((v) => (
                        <div key={v.id} className="rounded-lg bg-violet-500/[0.03] border border-violet-500/10 p-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0 mr-2">
                              <p className="text-xs font-medium text-slate-300 truncate">{v.name}</p>
                              <p className="text-[10px] text-slate-500 truncate">{v.productName}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`text-xs font-bold ${v.stock === 0 ? 'text-red-400' : 'text-violet-400'}`}>{v.stock}</span>
                              <Badge className={`text-[9px] h-4 px-1 ${v.stock === 0 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-violet-500/10 border-violet-500/20 text-violet-400'}`}>
                                {v.stock === 0 ? 'Habis' : 'Rendah'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-4 text-center">
                    <ShieldAlert className="h-5 w-5 text-emerald-700 mb-1" />
                    <p className="text-[11px] text-slate-600">Semua stok aman</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}


// ── Inventory Alerts Section (Endurance) ──
export function InventoryAlertsSection({ stats }: { stats: DashboardStats }) {
  const alerts = stats.inventoryAlerts?.filter(a => a.status !== 'ok') ?? []
  if (alerts.length === 0) return null

  return (
    <motion.div variants={itemVariants}>
      <Card className="aether-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-orange-400" />
              Ketahanan Stok Inventori
            </h2>
            <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 text-[10px]">
              {alerts.filter(a => a.status === 'critical').length} kritis
            </Badge>
          </div>
          
          {/* Mobile */}
          <div className="flex flex-col gap-2 md:hidden max-h-60 overflow-y-auto">
            {alerts.map((item) => (
              <div key={item.id} className={`flex items-center gap-3 rounded-xl border p-3 ${
                item.status === 'critical' ? 'bg-red-500/5 border-red-500/15' : 'bg-amber-500/5 border-amber-500/15'
              }`}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-200 font-medium truncate">{item.name}</p>
                  <p className="text-[10px] text-slate-500">
                    Pakai {item.dailyConsumption.toFixed(1)}/{item.baseUnit}/hari
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold ${item.status === 'critical' ? 'text-red-400' : 'text-amber-400'}`}>
                    {item.daysUntilEmpty !== null ? `~${Math.floor(item.daysUntilEmpty)} hari` : '∞'}
                  </p>
                  <p className="text-[10px] text-slate-500">{formatNumber(item.stock)} {item.baseUnit}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto max-h-60 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent sticky top-0 bg-nebula z-10">
                  <TableHead className="text-slate-500 text-[11px] w-8 py-2.5">#</TableHead>
                  <TableHead className="text-slate-500 text-[11px] py-2.5">Inventori</TableHead>
                  <TableHead className="text-slate-500 text-[11px] text-right py-2.5">Stok</TableHead>
                  <TableHead className="text-slate-500 text-[11px] text-right py-2.5">Pakai/Hari</TableHead>
                  <TableHead className="text-slate-500 text-[11px] text-right py-2.5">Tahan</TableHead>
                  <TableHead className="text-slate-500 text-[11px] text-center py-2.5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((item, idx) => (
                  <TableRow key={item.id} className={`border-white/[0.04] hover:bg-white/[0.03] ${
                    item.status === 'critical' ? 'bg-red-500/[0.02]' : 'bg-amber-500/[0.02]'
                  }`}>
                    <TableCell className="text-[11px] text-slate-500 font-mono py-2.5">{idx + 1}</TableCell>
                    <TableCell className="text-xs text-slate-200 font-medium py-2.5">{item.name}</TableCell>
                    <TableCell className="text-xs text-slate-300 text-right py-2.5">{formatNumber(item.stock)} {item.baseUnit}</TableCell>
                    <TableCell className="text-xs text-slate-400 text-right py-2.5">{item.dailyConsumption.toFixed(1)} {item.baseUnit}</TableCell>
                    <TableCell className={`text-xs text-right font-bold py-2.5 ${item.status === 'critical' ? 'text-red-400' : 'text-amber-400'}`}>
                      {item.daysUntilEmpty !== null ? `~${Math.floor(item.daysUntilEmpty)} hari` : '∞'}
                    </TableCell>
                    <TableCell className="text-center py-2.5">
                      {item.status === 'critical' ? (
                        <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px]">Kritis</Badge>
                      ) : (
                        <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">Perhatian</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── Score Explanation Dialog ──
export function ScoreExplanationDialog({
  open,
  onOpenChange,
  score,
  insights,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  score: number
  insights: InsightItem[]
}) {
  let runningScore = 75
  const breakdown: { label: string; delta: number; detail: string }[] = []

  // Base
  breakdown.push({ label: 'Skor Dasar', delta: 0, detail: 'Titik awal semua outlet' })

  for (const insight of insights) {
    if (insight.id === 'all-good') {
      runningScore = Math.min(100, runningScore + 15)
      breakdown.push({ label: `${insight.emoji} ${insight.title}`, delta: 15, detail: 'Semua metrik sehat' })
    } else if (insight.priority === 'critical') {
      runningScore -= 25
      breakdown.push({ label: `${insight.emoji} ${insight.title}`, delta: -25, detail: insight.why.slice(0, 80) })
    } else if (insight.priority === 'high') {
      runningScore -= 15
      breakdown.push({ label: `${insight.emoji} ${insight.title}`, delta: -15, detail: insight.why.slice(0, 80) })
    } else if (insight.priority === 'medium') {
      runningScore -= 8
      breakdown.push({ label: `${insight.emoji} ${insight.title}`, delta: -8, detail: insight.why.slice(0, 80) })
    } else {
      runningScore -= 3
      breakdown.push({ label: `${insight.emoji} ${insight.title}`, delta: -3, detail: insight.why.slice(0, 80) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-nebula border-white/[0.06] p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-white text-base">Cara Kerja Health Score</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1 -mr-1">
          <p className="text-xs text-slate-400">
            Health Score mengukur kesehatan outlet berdasarkan analisis real-time dari penjualan, stok, dan aktivitas bisnis.
          </p>
          
          <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Skor Dasar</span>
              <span className="text-slate-200 font-medium">75</span>
            </div>
            {breakdown.slice(1).map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex-1 min-w-0 mr-3">
                  <p className="text-slate-300 truncate">{item.label}</p>
                  <p className="text-[10px] text-slate-500 truncate">{item.detail}</p>
                </div>
                <span className={`font-mono font-medium shrink-0 ${item.delta > 0 ? 'theme-text' : item.delta < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {item.delta > 0 ? '+' : ''}{item.delta}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
            <span className="text-sm font-semibold text-slate-200">Skor Akhir</span>
            <span className={`text-lg font-bold ${score >= 75 ? 'theme-text' : score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
              {score}
            </span>
          </div>

          <div className="text-[10px] text-slate-500 space-y-0.5 pt-1">
            <p>• Issue kritis: <span className="text-red-400">-25 poin</span></p>
            <p>• Issue tinggi: <span className="text-orange-400">-15 poin</span></p>
            <p>• Issue sedang: <span className="text-amber-400">-8 poin</span></p>
            <p>• Issue rendah: <span className="text-slate-400">-3 poin</span></p>
            <p>• Semua baik: <span className="theme-text">+15 poin</span></p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── AI Insights Section ──
function PriorityLabel({ priority }: { priority: InsightItem['priority'] }) {
  return (
    <Badge className={cn(
      'text-[9px] h-5 px-1.5 gap-0.5 shrink-0',
      priority === 'critical' ? 'bg-red-500/10 border-red-500/20 text-red-400'
      : priority === 'high' ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
      : priority === 'medium' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
    )}>
      {priority === 'critical' ? 'Kritis' : priority === 'high' ? 'Tinggi' : priority === 'medium' ? 'Sedang' : 'Rendah'}
    </Badge>
  )
}

// ── AI Insights Floating Brain Button ──
export function InsightsSection({
  insightData, isLoading, onRefresh,
}: {
  insightData: InsightEngineData | null
  isLoading: boolean
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const insights = insightData?.insights ?? []
  const hasInsights = insights.length > 0
  const hasCritical = insights.some(i => i.priority === 'critical')
  const hasHigh = insights.some(i => i.priority === 'high')

  // Don't render anything while loading (floating button appears when data is ready)
  if (!insightData && !isLoading) return null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <motion.button
          className={cn(
            'fixed bottom-20 right-6 z-40 w-14 h-14 rounded-full',
            'flex items-center justify-center shadow-2xl',
            'border border-white/[0.1] cursor-pointer',
            'transition-all duration-300 hover:scale-110 active:scale-95',
            hasCritical
              ? 'bg-gradient-to-br from-red-500 via-rose-500 to-pink-500 shadow-red-500/30'
              : hasHigh
                ? 'bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 shadow-orange-500/30'
                : hasInsights
                  ? 'bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 shadow-violet-500/30'
                  : 'bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 shadow-emerald-500/30'
          )}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.5 }}
          onClick={() => setOpen(true)}
          aria-label="AI Insights"
        >
          {/* Pulse ring */}
          {hasInsights && (
            <motion.span
              className="absolute inset-0 rounded-full"
              animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                background: hasCritical
                  ? 'radial-gradient(circle, rgba(239,68,68,0.3), transparent 70%)'
                  : hasHigh
                    ? 'radial-gradient(circle, rgba(245,158,11,0.3), transparent 70%)'
                    : 'radial-gradient(circle, rgba(139,92,246,0.3), transparent 70%)',
              }}
            />
          )}

          <Brain className="h-6 w-6 text-white relative z-10" />

          {/* Priority badge — color matches severity */}
          {hasInsights && (
            <motion.span
              className={cn(
                'absolute -top-1.5 -right-1.5 z-10 min-w-[22px] h-[22px] px-1.5',
                'flex items-center justify-center',
                'rounded-full text-[11px] font-bold text-white',
                hasCritical
                  ? 'bg-red-500 shadow-lg shadow-red-500/50'
                  : hasHigh
                    ? 'bg-orange-500 shadow-lg shadow-orange-500/50'
                    : 'bg-violet-500 shadow-lg shadow-violet-500/50',
              )}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.8 }}
            >
              {insights.length}
            </motion.span>
          )}
        </motion.button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="bg-nebula border-l border-white/[0.06] sm:max-w-md w-full p-0"
      >
        {/* Header */}
        <SheetHeader className="p-5 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <motion.div
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/20 flex items-center justify-center shrink-0"
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Brain className="h-5 w-5 text-violet-400" />
            </motion.div>
            <div className="flex-1">
              <SheetTitle className="text-white text-base">AI Insights</SheetTitle>
              <SheetDescription className="text-slate-500 text-xs mt-0.5">
                Analisis otomatis untuk bisnis kamu
              </SheetDescription>
            </div>
            {insightData && (
              <HealthRing score={insightData.healthScore} size="sm" />
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-2 mt-3">
            <Badge variant="outline" className="text-[10px] bg-white/[0.03] border-white/[0.06] text-slate-400">
              {hasInsights ? `${insights.length} insight` : 'Semua sehat'}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { onRefresh(); }}
              disabled={isLoading}
              className="h-7 w-7 p-0 ml-auto text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            </Button>
          </div>
        </SheetHeader>

        {/* Insight list */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-[calc(100vh-220px)]">
            <div className="p-4 space-y-2.5">
              {isLoading && !insightData ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                      <Skeleton className="h-4 w-3/4 bg-white/[0.04] mb-2" />
                      <Skeleton className="h-3 w-full bg-white/[0.03] mb-1" />
                      <Skeleton className="h-3 w-1/2 bg-white/[0.03]" />
                    </div>
                  ))}
                </div>
              ) : !hasInsights ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <motion.div
                    className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center mb-4"
                    animate={{ scale: [1, 1.06, 1] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Sparkles className="h-7 w-7 text-emerald-400" />
                  </motion.div>
                  <p className="text-sm font-semibold text-emerald-400">Semua metrik sehat</p>
                  <p className="text-xs text-slate-500 mt-1.5 max-w-xs">
                    Tidak ada insight yang perlu perhatian saat ini. Bisnis kamu berjalan dengan baik!
                  </p>
                </div>
              ) : (
                insights.map((insight, idx) => (
                  <motion.div
                    key={insight.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.06, duration: 0.25 }}
                    className={cn(
                      'rounded-xl border p-4 space-y-3',
                      getPriorityBg(insight.priority),
                    )}
                  >
                    {/* Insight header */}
                    <div className="flex items-start gap-2.5">
                      <PriorityDot priority={insight.priority} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-white">{insight.emoji} {insight.title}</h3>
                          <PriorityLabel priority={insight.priority} />
                        </div>
                      </div>
                    </div>

                    {/* Why */}
                    <p className="text-xs text-slate-400 leading-relaxed pl-6">{insight.why}</p>

                    {/* Actions */}
                    {insight.actions.length > 0 && (
                      <ul className="space-y-1.5 pl-6">
                        {insight.actions.map((action, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                            <Zap className="h-3 w-3 text-violet-400 mt-0.5 shrink-0" />
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* CTAs */}
                    {insight.cta.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pl-6 pt-1">
                        {insight.cta.map((cta, i) => (
                          <InsightCtaButton key={i} cta={cta} />
                        ))}
                      </div>
                    )}
                  </motion.div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Small CTA button used inside floating insight sheet */
function InsightCtaButton({ cta }: { cta: InsightItem['cta'][number] }) {
  const { setCurrentPage } = usePageStore()
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-[10px] font-medium bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] text-slate-300 rounded-lg gap-1"
      onClick={() => setCurrentPage(cta.page as Parameters<typeof setCurrentPage>[0])}
    >
      {cta.label}
      <ArrowRight className="h-2.5 w-2.5" />
    </Button>
  )
}

// ════════════════════════════════════════════════════════════
// Inventory Freshness Score Widget
// ════════════════════════════════════════════════════════════

interface FreshnessData {
  score: number
  grade: string
  totalBatchCount: number
  safeCount: number
  warningCount: number
  expiredCount: number
  noExpiryCount: number
  totalValue: number
  expiredValue: number
  warningValue: number
}

function FreshnessRing({ score, grade }: { score: number; grade: string }) {
  const radius = 36
  const svgSize = 88
  const sw = 5
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const colorMap: Record<string, string> = {
    A: 'text-emerald-400', B: 'text-amber-400', C: 'text-rose-400', D: 'text-red-400',
  }
  const ringMap: Record<string, string> = {
    A: 'stroke-emerald-400', B: 'stroke-amber-400', C: 'stroke-rose-400', D: 'stroke-red-400',
  }
  const borderMap: Record<string, string> = {
    A: 'border-emerald-500/20', B: 'border-amber-500/20', C: 'border-rose-500/20', D: 'border-red-500/20',
  }
  const bgMap: Record<string, string> = {
    A: 'bg-emerald-500/5', B: 'bg-amber-500/5', C: 'bg-rose-500/5', D: 'bg-red-500/5',
  }
  const g = grade || 'D'
  return (
    <div className={cn('relative w-22 h-22 border rounded-full flex items-center justify-center', borderMap[g], bgMap[g])}>
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox={`0 0 ${svgSize} ${svgSize}`}>
        <circle cx={svgSize / 2} cy={svgSize / 2} r={radius} fill="none" stroke="currentColor" className="text-slate-700" strokeWidth={sw} />
        <circle cx={svgSize / 2} cy={svgSize / 2} r={radius} fill="none" className={ringMap[g]} strokeWidth={sw} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 1s ease-out' }} />
      </svg>
      <div className="flex flex-col items-center z-10">
        <span className={cn('text-lg font-bold leading-none', colorMap[g])}>{score}</span>
        <span className={cn('text-[10px] font-semibold mt-0.5', colorMap[g])}>{g}</span>
      </div>
    </div>
  )
}

function GradeStars({ grade }: { grade: string }) {
  const stars: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 }
  const colorMap: Record<string, string> = { A: 'text-emerald-400', B: 'text-amber-400', C: 'text-rose-400', D: 'text-red-400' }
  const count = stars[grade] || 1
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <svg key={i} className={cn('w-3 h-3', i < count ? colorMap[grade] : 'text-slate-700')} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

export function InventoryFreshnessWidget() {
  const [data, setData] = useState<FreshnessData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/inventory/batches?type=freshness-score')
      .then(r => r.ok ? r.json() : null)
      .then((json) => { if (!cancelled && json?.data) setData(json.data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const g = data?.grade || 'D'
  const colorMap: Record<string, string> = { A: 'text-emerald-400', B: 'text-amber-400', C: 'text-rose-400', D: 'text-red-400' }
  const safePct = data ? Math.round((data.safeCount / Math.max(data.totalBatchCount, 1)) * 100) : 0
  const warnPct = data ? Math.round((data.warningCount / Math.max(data.totalBatchCount, 1)) * 100) : 0
  const expPct = data ? Math.round((data.expiredCount / Math.max(data.totalBatchCount, 1)) * 100) : 0

  if (loading) {
    return (
      <Card className="aether-card">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="w-[88px] h-[88px] rounded-full bg-white/[0.04]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32 bg-white/[0.04]" />
              <Skeleton className="h-3 w-24 bg-white/[0.03]" />
              <Skeleton className="h-3 w-48 bg-white/[0.03]" />
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <motion.div variants={itemVariants}>
      <Card className="aether-card cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              Freshness Score™
            </h2>
            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 border', colorMap[g])}>
              Grade {g}
            </Badge>
          </div>

          <div className="flex items-center gap-4">
            <FreshnessRing score={data.score} grade={g} />
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <GradeStars grade={g} />
                  <span className={cn('text-xs font-semibold', colorMap[g])}>
                    {g === 'A' ? 'Sangat Segar' : g === 'B' ? 'Cukup Segar' : g === 'C' ? 'Perlu Perhatian' : 'Kritis'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">{data.totalBatchCount} batch total</p>
              </div>

              {/* Breakdown bar */}
              <div className="space-y-1">
                <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-white/[0.04]">
                  {safePct > 0 && <div className="bg-emerald-400 h-full rounded-l-full" style={{ width: `${safePct}%` }} />}
                  {warnPct > 0 && <div className="bg-amber-400 h-full" style={{ width: `${warnPct}%` }} />}
                  {expPct > 0 && <div className="bg-red-400 h-full rounded-r-full" style={{ width: `${expPct}%` }} />}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                  <span className="text-slate-400">✅ {safePct}% Aman</span>
                  <span className="text-slate-400">⚠️ {warnPct}% &lt;30 hari</span>
                  <span className="text-slate-400">🔴 {expPct}% Expired</span>
                </div>
              </div>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-slate-600 shrink-0 transition-transform', expanded && 'rotate-180')} />
          </div>

          {/* Expanded details */}
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-4 pt-3 border-t border-white/[0.04] space-y-2.5"
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500">Total Nilai Stok</p>
                  <p className="text-xs font-semibold text-white mt-0.5">{formatCurrency(data.totalValue)}</p>
                </div>
                <div className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500">Nilai Expired</p>
                  <p className="text-xs font-semibold text-red-400 mt-0.5">{formatCurrency(data.expiredValue)}</p>
                </div>
                <div className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500">Nilai Hampir Expired</p>
                  <p className="text-xs font-semibold text-amber-400 mt-0.5">{formatCurrency(data.warningValue)}</p>
                </div>
                <div className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500">Tanpa Tanggal Expired</p>
                  <p className="text-xs font-semibold text-slate-300 mt-0.5">{data.noExpiryCount} batch</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-emerald-500/5 rounded-lg p-2 border border-emerald-500/10 text-center">
                  <p className="text-lg font-bold text-emerald-400">{data.safeCount}</p>
                  <p className="text-[10px] text-slate-500">Aman</p>
                </div>
                <div className="bg-amber-500/5 rounded-lg p-2 border border-amber-500/10 text-center">
                  <p className="text-lg font-bold text-amber-400">{data.warningCount}</p>
                  <p className="text-[10px] text-slate-500">Peringatan</p>
                </div>
                <div className="bg-red-500/5 rounded-lg p-2 border border-red-500/10 text-center">
                  <p className="text-lg font-bold text-red-400">{data.expiredCount}</p>
                  <p className="text-[10px] text-slate-500">Expired</p>
                </div>
              </div>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ════════════════════════════════════════════════════════════
// Expiry Heatmap Widget
// ════════════════════════════════════════════════════════════

interface HeatmapData {
  expired: Array<{ id: string; batchNumber: string; inventoryItemName: string; remainingQty: number; baseUnit: string; expiredDate: string; totalLoss: number }>
  critical7d: Array<{ id: string; batchNumber: string; inventoryItemName: string; remainingQty: number; baseUnit: string; expiredDate: string; daysUntilExpiry: number }>
  warning30d: Array<{ id: string; batchNumber: string; inventoryItemName: string; remainingQty: number; baseUnit: string; expiredDate: string; daysUntilExpiry: number }>
  safeCount: number
}

export function ExpiryHeatmapWidget() {
  const [data, setData] = useState<HeatmapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/inventory/batches?type=heatmap')
      .then(r => r.ok ? r.json() : null)
      .then((json) => { if (!cancelled && json?.data) setData(json.data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const totalExpiredLoss = data ? data.expired.reduce((s, e) => s + (e.totalLoss || 0), 0) : 0

  if (loading) {
    return (
      <Card className="aether-card">
        <CardContent className="p-4">
          <Skeleton className="h-4 w-36 bg-white/[0.04] mb-3" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <motion.div variants={itemVariants}>
      <Card className="aether-card cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              </div>
              Peta Kadaluarsa
            </h2>
            <ChevronDown className={cn('h-4 w-4 text-slate-600 shrink-0 transition-transform', expanded && 'rotate-180')} />
          </div>

          {/* Compact 4-grid */}
          <div className="grid grid-cols-2 gap-2">
            {/* Expired */}
            <div className="bg-red-500/5 rounded-lg p-2.5 border border-red-500/10">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm">🔴</span>
                <span className="text-[10px] text-red-400 font-medium">Expired</span>
              </div>
              <p className="text-base font-bold text-red-400">{data.expired.length}</p>
              {totalExpiredLoss > 0 && (
                <p className="text-[10px] text-slate-500">Kerugian {formatCurrency(totalExpiredLoss)}</p>
              )}
            </div>
            {/* <7 days */}
            <div className="bg-orange-500/5 rounded-lg p-2.5 border border-orange-500/10">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm">🔥</span>
                <span className="text-[10px] text-orange-400 font-medium">&lt;7 hari</span>
              </div>
              <p className="text-base font-bold text-orange-400">{data.critical7d.length}</p>
            </div>
            {/* <30 days */}
            <div className="bg-amber-500/5 rounded-lg p-2.5 border border-amber-500/10">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm">🟠</span>
                <span className="text-[10px] text-amber-400 font-medium">&lt;30 hari</span>
              </div>
              <p className="text-base font-bold text-amber-400">{data.warning30d.length}</p>
            </div>
            {/* Safe */}
            <div className="bg-emerald-500/5 rounded-lg p-2.5 border border-emerald-500/10">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm">🟢</span>
                <span className="text-[10px] text-emerald-400 font-medium">Aman</span>
              </div>
              <p className="text-base font-bold text-emerald-400">{data.safeCount}</p>
            </div>
          </div>

          {/* Expanded: critical list */}
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-3 pt-3 border-t border-white/[0.04] space-y-3"
            >
              {/* Expired items list */}
              {data.expired.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-red-400 font-medium uppercase tracking-wider">Expired Items</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {data.expired.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 bg-red-500/[0.03] rounded-lg px-2.5 py-2 border border-red-500/[0.06]">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-slate-200 font-medium truncate">{e.inventoryItemName}</p>
                          <p className="text-[10px] text-slate-500">{e.batchNumber} • {formatNumber(e.remainingQty)} {e.baseUnit}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[11px] text-red-400 font-semibold">-{formatCurrency(e.totalLoss)}</p>
                          <p className="text-[9px] text-slate-600">expired</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Critical 7d list */}
              {data.critical7d.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-orange-400 font-medium uppercase tracking-wider">Kritis &lt;7 Hari</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {data.critical7d.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 bg-orange-500/[0.03] rounded-lg px-2.5 py-2 border border-orange-500/[0.06]">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-slate-200 font-medium truncate">{e.inventoryItemName}</p>
                          <p className="text-[10px] text-slate-500">{e.batchNumber} • {formatNumber(e.remainingQty)} {e.baseUnit}</p>
                        </div>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-orange-500/20 text-orange-400 bg-orange-500/[0.06] shrink-0">
                          {e.daysUntilExpiry} hari lagi
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.expired.length === 0 && data.critical7d.length === 0 && (
                <div className="py-4 text-center">
                  <p className="text-xs text-emerald-400">✅ Semua batch dalam kondisi aman!</p>
                </div>
              )}
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ============================================================
// Expiry Alert Banner — compact dashboard alert for expiring batches
// ============================================================

interface ExpiryCheckData {
  newlyExpired: number
  criticalCount: number
  warningCount: number
  totalLoss: number
}

interface ExpiryAlertBannerProps {
  /** Callback to scroll to / focus the ExpiryHeatmapWidget */
  onShowDetail?: () => void
}

export function ExpiryAlertBanner({ onShowDetail }: ExpiryAlertBannerProps) {
  const [data, setData] = useState<ExpiryCheckData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/inventory/batches/expiry-check', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.data) {
          setData(json.data)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Only show if there are expired or critical items
  const show = data && (data.newlyExpired > 0 || data.criticalCount > 0)

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            {/* Alert text */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-rose-500/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4 text-rose-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-rose-300">
                  ⚠️{' '}
                  {data.newlyExpired > 0 && `${data.newlyExpired} batch expired`}
                  {data.newlyExpired > 0 && data.criticalCount > 0 && ', '}
                  {data.criticalCount > 0 &&
                    `${data.criticalCount} batch exp < 7 hari`}
                </p>
                {data.totalLoss > 0 && (
                  <p className="text-[11px] text-rose-400/70 mt-0.5">
                    Potensi kerugian: {formatCurrency(data.totalLoss)}
                  </p>
                )}
              </div>
            </div>

            {/* Action button */}
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onShowDetail?.()
              }}
              className="shrink-0 h-7 px-3 text-xs font-medium gap-1.5 border-rose-500/25 text-rose-300 bg-rose-500/[0.06] hover:bg-rose-500/15 hover:text-rose-200 rounded-lg"
            >
              <Eye className="h-3 w-3" />
              Lihat Detail
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ════════════════════════════════════════════════════════════
// Promo Recommendation Widget
// ════════════════════════════════════════════════════════════

interface PromoRecommendation {
  inventoryItemId: string
  inventoryItemName: string
  baseUnit: string
  remainingQty: number
  expiredDate: string | null
  daysUntilExpiry: number | null
  urgency: 'critical' | 'warning'
  potentialLoss: number
  suggestedProducts: Array<{
    productId: string
    productName: string
    productPrice: number
    categoryId: string | null
  }>
  suggestedPromo: {
    type: 'PERCENTAGE'
    value: number
    reason: string
  }
}

export function PromoRecommendationWidget() {
  const [data, setData] = useState<PromoRecommendation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/inventory/promo-recommendations')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.data) setData(json.data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const top3 = data.slice(0, 3)

  if (loading) {
    return (
      <Card className="aether-card">
        <CardContent className="p-4">
          <Skeleton className="h-4 w-32 bg-white/[0.04] mb-3" />
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-20 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <motion.div variants={itemVariants}>
      <Card className="aether-card">
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Zap className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <h2 className="text-sm font-semibold text-slate-200">Saran Promo</h2>
            {top3.length > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[9px] px-1.5 py-0 shrink-0',
                  top3.some((r) => r.urgency === 'critical')
                    ? 'border-rose-500/20 text-rose-400 bg-rose-500/[0.06]'
                    : 'border-amber-500/20 text-amber-400 bg-amber-500/[0.06]'
                )}
              >
                {top3.length} saran
              </Badge>
            )}
          </div>

          {/* Content */}
          <AnimatePresence mode="wait">
            {top3.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-6 text-center"
              >
                <p className="text-xs text-emerald-400">✅ Semua stok aman</p>
              </motion.div>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                {top3.map((rec, idx) => {
                  const promoProduct = rec.suggestedProducts[0]
                  const promoName = promoProduct?.productName ?? rec.inventoryItemName
                  const isCritical = rec.urgency === 'critical'

                  return (
                    <motion.div
                      key={rec.inventoryItemId + idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.08, duration: 0.3 }}
                      className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3 space-y-1.5"
                    >
                      {/* Product name + promo badge */}
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] text-slate-200 font-medium truncate min-w-0 flex-1">
                          {promoName}
                        </p>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] px-1.5 py-0 shrink-0 font-semibold',
                            isCritical
                              ? 'border-rose-500/20 text-rose-400 bg-rose-500/[0.06]'
                              : 'border-amber-500/20 text-amber-400 bg-amber-500/[0.06]'
                          )}
                        >
                          {isCritical ? '⚡' : '⚠️'} {rec.suggestedPromo.value}%
                        </Badge>
                      </div>

                      {/* Promo action line */}
                      <p className="text-[11px] text-emerald-400 font-medium">
                        Buat promo {promoName} {rec.suggestedPromo.value}%
                      </p>

                      {/* Reason */}
                      <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">
                        {rec.suggestedPromo.reason}
                      </p>

                      {/* Meta row */}
                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                          <span className="flex items-center gap-1">
                            <Package className="h-3 w-3" />
                            {formatNumber(rec.remainingQty)} {rec.baseUnit}
                          </span>
                          {rec.daysUntilExpiry !== null && (
                            <span
                              className={cn(
                                'flex items-center gap-1',
                                rec.daysUntilExpiry <= 3 ? 'text-rose-400' : rec.daysUntilExpiry <= 7 ? 'text-amber-400' : 'text-slate-500'
                              )}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {rec.daysUntilExpiry > 0 ? `${rec.daysUntilExpiry} hari lagi` : 'Hari ini'}
                            </span>
                          )}
                        </div>
                        <span className="flex items-center gap-1 text-[10px] text-rose-400 font-medium shrink-0">
                          <TrendingDown className="h-3 w-3" />
                          {formatCurrency(rec.potentialLoss)}
                        </span>
                      </div>
                    </motion.div>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  )
}