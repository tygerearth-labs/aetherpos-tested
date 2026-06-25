'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { motion } from 'framer-motion'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Package, Users, AlertTriangle, Layers, Sparkles, RefreshCw } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { usePageStore } from '@/hooks/use-page-store'
import type { DashboardStats, InsightEngineData, InsightItem } from '@/hooks/use-dashboard'
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

// ── Top Products ──
export function TopProducts({ products }: { products: { name: string; qty: number; revenue: number }[] }) {
  return (
    <motion.div variants={itemVariants}>
      <Card className="aether-card rounded-2xl"><CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Package className="h-4 w-4 theme-text" />
          <h2 className="text-sm font-semibold text-slate-200">Produk Terlaris</h2>
        </div>
        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center"><Package className="h-7 w-7 text-slate-700 mb-1.5" /><p className="text-xs text-slate-500">Belum ada data hari ini</p></div>
        ) : (
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {products.slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.03]">
                <span className={`text-[11px] font-bold w-4 text-center shrink-0 ${i === 0 ? 'text-amber-400' : 'text-slate-600'}`}>{i + 1}</span>
                <div className="flex-1 min-w-0"><p className="text-xs font-medium text-slate-300 truncate">{p.name}</p><p className="text-[10px] text-slate-500">{formatNumber(p.qty)} unit</p></div>
                <p className="text-xs font-semibold theme-text shrink-0">{formatCurrency(p.revenue)}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>
    </motion.div>
  )
}

// ── Top Customers ──
export function TopCustomers({ customers }: { customers: DashboardStats['topCustomers'] }) {
  if (!customers || customers.length === 0) return null
  return (
    <motion.div variants={itemVariants}>
      <Card className="aether-card rounded-2xl"><CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-200">Top Customer</h2>
        </div>
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
          {customers.map((c, i) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.03]">
              <span className={`text-[11px] font-bold w-4 text-center shrink-0 ${i === 0 ? 'text-amber-400' : 'text-slate-600'}`}>{i + 1}</span>
              <div className="flex-1 min-w-0"><p className="text-xs font-medium text-slate-300 truncate">{c.name}</p><p className="text-[10px] text-slate-500">{c.points} poin</p></div>
              <p className="text-xs font-semibold text-sky-400 shrink-0">{formatCurrency(c.totalSpend)}</p>
            </div>
          ))}
        </div>
      </CardContent></Card>
    </motion.div>
  )
}

// ── Low Stock Section ──
export function LowStockSection({ stats }: { stats: DashboardStats }) {
  const hasLowStock = stats.lowStockList.length > 0 || (stats.lowStockVariantList && stats.lowStockVariantList.length > 0)
  if (!hasLowStock) return null

  return (
    <motion.div variants={itemVariants}>
      <Card className="aether-card"><CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            Produk Stok Menipis
          </h2>
          {stats.lowStockVariants > 0 && (
            <Badge className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px] gap-1">
              <Layers className="h-3 w-3" />{stats.lowStockVariants} varian
            </Badge>
          )}
        </div>

        {/* Mobile */}
        <div className="flex flex-col gap-2 md:hidden max-h-60 overflow-y-auto">
          {stats.lowStockList.map((p) => {
            const isCritical = p.stock === 0
            const isWarning = p.stock > 0 && p.stock <= p.lowStockAlert / 2
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.03] p-3">
                <div className="flex-1 min-w-0"><p className="text-xs text-slate-200 font-medium truncate">{p.name}</p><p className="text-[10px] text-slate-500">Stok: {p.lowStockAlert} alert</p></div>
                <div className="text-right shrink-0 flex items-center gap-2">
                  <span className={`text-sm font-bold ${isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-yellow-300'}`}>{p.stock}</span>
                  {isCritical ? <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px]">Habis</Badge> : isWarning ? <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">Kritis</Badge> : <Badge className="bg-yellow-500/10 border-yellow-500/20 text-yellow-400 text-[10px]">Rendah</Badge>}
                </div>
              </div>
            )
          })}
          {stats.lowStockVariantList && stats.lowStockVariantList.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 pt-2 pb-1"><Layers className="h-3 w-3 text-violet-400" /><span className="text-[11px] font-medium text-violet-400">Varian Stok Rendah</span></div>
              {stats.lowStockVariantList.map((v) => (
                <div key={v.id} className="flex items-center gap-3 rounded-xl bg-violet-500/5 border border-violet-500/15 p-3">
                  <div className="flex-1 min-w-0"><p className="text-xs text-slate-200 font-medium truncate">{v.name}</p><p className="text-[10px] text-slate-500 truncate">{v.productName}</p></div>
                  <div className="text-right shrink-0 flex items-center gap-2">
                    <span className={`text-sm font-bold ${v.stock === 0 ? 'text-red-400' : 'text-violet-400'}`}>{v.stock}</span>
                    <Badge className={`text-[10px] ${v.stock === 0 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-violet-500/10 border-violet-500/20 text-violet-400'}`}>{v.stock === 0 ? 'Habis' : 'Rendah'}</Badge>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto max-h-60 overflow-y-auto">
          <Table>
            <TableHeader><TableRow className="border-white/[0.06] hover:bg-transparent sticky top-0 bg-nebula z-10">
              <TableHead className="text-slate-500 text-[11px] w-8 py-2.5">#</TableHead>
              <TableHead className="text-slate-500 text-[11px] py-2.5">Produk</TableHead>
              <TableHead className="text-slate-500 text-[11px] text-right py-2.5">Stok</TableHead>
              <TableHead className="text-slate-500 text-[11px] text-right py-2.5">Alert</TableHead>
              <TableHead className="text-slate-500 text-[11px] text-center py-2.5">Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {stats.lowStockList.map((p, idx) => {
                const isCritical = p.stock === 0
                const isWarning = p.stock > 0 && p.stock <= p.lowStockAlert / 2
                return (
                  <TableRow key={p.id} className="border-white/[0.04] hover:bg-white/[0.03]">
                    <TableCell className="text-[11px] text-slate-500 font-mono py-2.5">{idx + 1}</TableCell>
                    <TableCell className="text-xs text-slate-200 font-medium py-2.5">{p.name}</TableCell>
                    <TableCell className={`text-xs text-right font-bold py-2.5 ${isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-yellow-300'}`}>{p.stock}</TableCell>
                    <TableCell className="text-xs text-slate-500 text-right py-2.5">{p.lowStockAlert}</TableCell>
                    <TableCell className="text-center py-2.5">
                      {isCritical ? <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px]">Habis</Badge> : isWarning ? <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">Kritis</Badge> : <Badge className="bg-yellow-500/10 border-yellow-500/20 text-yellow-400 text-[10px]">Rendah</Badge>}
                    </TableCell>
                  </TableRow>
                )
              })}
              {stats.lowStockVariantList && stats.lowStockVariantList.length > 0 && (
                <>
                  <TableRow className="border-white/[0.06] hover:bg-transparent"><TableCell colSpan={5} className="py-2 px-0"><div className="flex items-center gap-1.5 px-3"><Layers className="h-3 w-3 text-violet-400" /><span className="text-[11px] font-medium text-violet-400">Varian Stok Rendah</span></div></TableCell></TableRow>
                  {stats.lowStockVariantList.map((v) => (
                    <TableRow key={v.id} className="border-violet-500/10 hover:bg-violet-500/5">
                      <TableCell className="text-[11px] text-violet-400/50 font-mono py-2.5"><Layers className="h-3 w-3 text-violet-400/50" /></TableCell>
                      <TableCell className="py-2.5"><p className="text-xs text-slate-200 font-medium">{v.name}</p><p className="text-[10px] text-slate-500">{v.productName}</p></TableCell>
                      <TableCell className={`text-xs text-right font-bold py-2.5 ${v.stock === 0 ? 'text-red-400' : 'text-violet-400'}`}>{v.stock}</TableCell>
                      <TableCell className="text-xs text-slate-500 text-right py-2.5">-</TableCell>
                      <TableCell className="text-center py-2.5"><Badge className={`text-[10px] ${v.stock === 0 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-violet-500/10 border-violet-500/20 text-violet-400'}`}>{v.stock === 0 ? 'Habis' : 'Rendah'}</Badge></TableCell>
                    </TableRow>
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent></Card>
    </motion.div>
  )
}

// ── AI Insights Section ──
export function InsightsSection({
  insightData, isLoading, onRefresh,
}: {
  insightData: InsightEngineData | null
  isLoading: boolean
  onRefresh: () => void
}) {
  const { setCurrentPage } = usePageStore()
  const [selectedInsight, setSelectedInsight] = useState<InsightItem | null>(null)
  const topInsight = selectedInsight || insightData?.topInsight || null
  const otherInsights = insightData?.insights.filter((i) => i.id !== insightData?.topInsight?.id) ?? []

  if (!insightData && !isLoading) return null

  if (isLoading && !insightData) {
    return (
      <motion.div variants={itemVariants}>
        <Card className="aether-card rounded-2xl"><CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2"><Skeleton className="h-4 w-4 rounded bg-white/[0.04]" /><Skeleton className="h-4 w-32 bg-white/[0.04]" /></div>
          <Skeleton className="h-4 w-72 bg-white/[0.04]" /><Skeleton className="h-3 w-full bg-white/[0.04]" />
        </CardContent></Card>
      </motion.div>
    )
  }

  return (
    <motion.div variants={itemVariants}>
      <Card className={`bg-nebula border rounded-2xl overflow-hidden relative ${insightData!.healthScore >= 75 ? 'theme-border-light' : insightData!.healthScore >= 50 ? 'border-amber-500/15' : 'border-red-500/15'}`}>
        <div className={`absolute inset-0 pointer-events-none ${insightData!.healthScore >= 75 ? 'bg-gradient-to-br theme-gradient-subtle' : insightData!.healthScore >= 50 ? 'bg-gradient-to-br from-amber-500/[0.03] to-transparent' : 'bg-gradient-to-br from-red-500/[0.03] to-transparent'}`} />
        <CardContent className="p-5 relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-slate-200">AI Insight Hari Ini</h2>
            </div>
            <div className="flex items-center gap-2">
              <HealthRing score={insightData!.healthScore} size="sm" />
              <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isLoading} className="h-7 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] gap-1">
                <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          {topInsight ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <PriorityDot priority={topInsight.priority} />
                <h3 className="text-sm font-semibold text-white">{topInsight.emoji} {topInsight.title}</h3>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">{topInsight.why}</p>
              {topInsight.actions.length > 0 && (
                <ul className="space-y-1">{topInsight.actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-400"><span className="text-violet-400 mt-0.5 shrink-0">•</span>{action}</li>
                ))}</ul>
              )}
              {topInsight.cta.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">{topInsight.cta.map((cta, i) => (
                  <Button key={i} size="sm" variant="outline" className="h-8 text-xs font-medium bg-white/[0.04] border-white/[0.03] hover:bg-white/[0.04] hover:border-white/[0.06] text-slate-300 rounded-lg gap-1.5" onClick={() => setCurrentPage(cta.page as Parameters<typeof setCurrentPage>[0])}>
                    {cta.label}
                  </Button>
                ))}</div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 py-2">Semua berjalan baik! Tidak ada insight penting saat ini.</p>
          )}
          {otherInsights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-white/[0.06]">
              {otherInsights.slice(0, 5).map((insight) => (
                <button key={insight.id} onClick={() => setSelectedInsight(insight)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border cursor-pointer transition-colors hover:bg-white/[0.04] ${getPriorityBg(insight.priority)}`}>
                  <PriorityDot priority={insight.priority} />
                  <span className="max-w-[140px] truncate text-slate-400">{insight.emoji} {insight.title}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}