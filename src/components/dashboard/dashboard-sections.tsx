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
import { Package, Users, AlertTriangle, Layers, Sparkles, RefreshCw, FlaskConical, ShieldAlert, Zap, ArrowRight, Brain } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { usePageStore } from '@/hooks/use-page-store'
import type { DashboardStats, InsightEngineData, InsightItem } from '@/hooks/use-dashboard'
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

// ── Sales & Products Unified Card ──
export function SalesProductsCard({
  products,
  customers,
  totalRevenue,
  totalTransactions,
}: {
  products: { name: string; qty: number; revenue: number }[]
  customers: { id: string; name: string; whatsapp: string; totalSpend: number; points: number }[] | null
  totalRevenue: number
  totalTransactions: number
}) {
  const hasProducts = products.length > 0
  const hasCustomers = customers && customers.length > 0
  const topProduct = products[0]

  return (
    <motion.div variants={itemVariants}>
      <Card className="aether-card rounded-2xl overflow-hidden">
        <CardContent className="p-4 sm:p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/15 to-fuchsia-500/15 border border-violet-500/15 flex items-center justify-center shrink-0">
                <Package className="h-4 w-4 text-violet-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Penjualan & Produk</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">Produk terlaris & pelanggan setia hari ini</p>
              </div>
            </div>
            {hasProducts && topProduct && (
              <div className="text-right hidden sm:block">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Best Seller</p>
                <p className="text-xs font-semibold text-slate-300">{topProduct.name}</p>
              </div>
            )}
          </div>

          {/* Summary pills */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <span className="text-[10px] text-slate-500">Revenue</span>
              <span className="text-xs font-semibold theme-text">{formatCurrency(totalRevenue)}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.04]">
              <span className="text-[10px] text-slate-500">Transaksi</span>
              <span className="text-xs font-semibold text-slate-200">{formatNumber(totalTransactions)}</span>
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
          </div>

          {/* Two columns: Products | Customers */}
          {!hasProducts && !hasCustomers ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Package className="h-7 w-7 text-slate-700 mb-1.5" />
              <p className="text-xs text-slate-500">Belum ada data hari ini</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* ── Top Products Column ── */}
              <div>
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Package className="h-3.5 w-3.5 theme-text" />
                  <h3 className="text-xs font-semibold text-slate-300">Produk Terlaris</h3>
                  {hasProducts && (
                    <span className="text-[10px] text-slate-600 ml-auto">{products.length} produk</span>
                  )}
                </div>
                {hasProducts ? (
                  <div className="space-y-1.5">
                    {products.slice(0, 5).map((p, i) => {
                      const maxRev = products[0]?.revenue ?? 1
                      const pct = Math.round((p.revenue / maxRev) * 100)
                      return (
                        <div key={i} className="group/p rounded-lg bg-white/[0.02] border border-white/[0.03] p-2.5 hover:bg-white/[0.04] transition-colors">
                          <div className="flex items-center gap-2.5">
                            <span className={`text-[11px] font-bold w-4 text-center shrink-0 ${i === 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                              {i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-xs font-medium text-slate-300 truncate">{p.name}</p>
                                <p className="text-xs font-semibold theme-text shrink-0 ml-2">{formatCurrency(p.revenue)}</p>
                              </div>
                              {/* Revenue bar */}
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                                  <motion.div
                                    className="h-full rounded-full theme-gradient-bar"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${pct}%` }}
                                    transition={{ duration: 0.6, delay: i * 0.08, ease: 'easeOut' }}
                                  />
                                </div>
                                <span className="text-[10px] text-slate-500 shrink-0 w-12 text-right">{formatNumber(p.qty)} unit</span>
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
              {hasCustomers && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Users className="h-3.5 w-3.5 text-sky-400" />
                    <h3 className="text-xs font-semibold text-slate-300">Top Customer</h3>
                    <span className="text-[10px] text-slate-600 ml-auto">{customers.length} pelanggan</span>
                  </div>
                  <div className="space-y-1.5">
                    {customers.slice(0, 5).map((c, i) => (
                      <div key={c.id} className="group/c rounded-lg bg-white/[0.02] border border-white/[0.03] p-2.5 hover:bg-white/[0.04] transition-colors">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold ${i === 0 ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' : 'bg-white/[0.04] text-slate-500 border border-white/[0.06]'}`}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-300 truncate">{c.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-500">{c.points} poin</span>
                              {i === 0 && <span className="text-[9px] text-amber-400/70">⭐ Most Loyal</span>}
                            </div>
                          </div>
                          <p className="text-xs font-semibold text-sky-400 shrink-0">{formatCurrency(c.totalSpend)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── Top Products (kept for backward compat, unused) ──
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
          {stats.lowInventoryItems > 0 && stats.lowInventoryList && stats.lowInventoryList.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 pt-2 pb-1">
                <FlaskConical className="h-3 w-3 text-orange-400" />
                <span className="text-[11px] font-medium text-orange-400">Inventori Menipis</span>
              </div>
              {stats.lowInventoryList.slice(0, 5).map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 rounded-xl bg-orange-500/5 border border-orange-500/15 p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-200 font-medium truncate">{inv.name}</p>
                    <p className="text-[10px] text-slate-500">
                      {formatCurrency(inv.avgCost)}/{inv.baseUnit}
                      {inv.daysUntilEmpty !== null && inv.daysUntilEmpty > 0 && (
                        <span className="ml-1.5 text-orange-400">~{Math.floor(inv.daysUntilEmpty)} hari lagi</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-2">
                    <span className={`text-sm font-bold ${inv.stock === 0 ? 'text-red-400' : 'text-orange-400'}`}>
                      {formatNumber(inv.stock)}
                    </span>
                    <Badge className={`text-[10px] ${inv.stock === 0 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-orange-500/10 border-orange-500/20 text-orange-400'}`}>
                      {inv.stock === 0 ? 'Habis' : 'Rendah'}
                    </Badge>
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
              {stats.lowInventoryItems > 0 && stats.lowInventoryList && stats.lowInventoryList.length > 0 && (
                <>
                  <TableRow className="border-white/[0.06] hover:bg-transparent"><TableCell colSpan={5} className="py-2 px-0"><div className="flex items-center gap-1.5 px-3"><FlaskConical className="h-3 w-3 text-orange-400" /><span className="text-[11px] font-medium text-orange-400">Inventori Menipis</span></div></TableCell></TableRow>
                  {stats.lowInventoryList.slice(0, 5).map((inv) => (
                    <TableRow key={inv.id} className="border-orange-500/10 hover:bg-orange-500/5">
                      <TableCell className="text-[11px] text-orange-400/50 font-mono py-2.5"><FlaskConical className="h-3 w-3 text-orange-400/50" /></TableCell>
                      <TableCell className="py-2.5">
                        <p className="text-xs text-slate-200 font-medium">{inv.name}</p>
                        <p className="text-[10px] text-slate-500">{formatCurrency(inv.avgCost)}/{inv.baseUnit}
                          {inv.daysUntilEmpty !== null && inv.daysUntilEmpty > 0 && (
                            <span className="ml-1.5 text-orange-400">~{Math.floor(inv.daysUntilEmpty)} hari lagi</span>
                          )}
                        </p>
                      </TableCell>
                      <TableCell className={`text-xs text-right font-bold py-2.5 ${inv.stock === 0 ? 'text-red-400' : 'text-orange-400'}`}>{formatNumber(inv.stock)}</TableCell>
                      <TableCell className="text-xs text-slate-500 text-right py-2.5">{inv.baseUnit}</TableCell>
                      <TableCell className="text-center py-2.5">
                        <Badge className={`text-[10px] ${inv.stock === 0 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-orange-500/10 border-orange-500/20 text-orange-400'}`}>
                          {inv.stock === 0 ? 'Habis' : 'Rendah'}
                        </Badge>
                      </TableCell>
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
// ── Insight Detail Popover ──
function InsightDetailPopover({ insight }: { insight: InsightItem }) {
  const { setCurrentPage } = usePageStore()
  return (
    <div className="w-80 space-y-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <PriorityDot priority={insight.priority} />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold text-white">{insight.emoji} {insight.title}</h4>
          <Badge className={cn(
            'mt-1 text-[9px] h-4 px-1.5',
            insight.priority === 'critical' ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : insight.priority === 'high' ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
            : insight.priority === 'medium' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
          )}>
            {insight.priority === 'critical' ? 'Kritis' : insight.priority === 'high' ? 'Tinggi' : insight.priority === 'medium' ? 'Sedang' : 'Rendah'}
          </Badge>
        </div>
      </div>

      {/* Why */}
      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1.5">Analisis</p>
        <p className="text-xs text-slate-300 leading-relaxed">{insight.why}</p>
      </div>

      {/* Actions */}
      {insight.actions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Rekomendasi</p>
          <ul className="space-y-1">{insight.actions.map((action, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
              <Zap className="h-3 w-3 text-violet-400 mt-0.5 shrink-0" />
              <span>{action}</span>
            </li>
          ))}</ul>
        </div>
      )}

      {/* CTAs */}
      {insight.cta.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {insight.cta.map((cta, i) => (
            <Button
              key={i}
              size="sm"
              variant="outline"
              className="h-7 text-[10px] font-medium bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] text-slate-300 rounded-lg gap-1"
              onClick={() => setCurrentPage(cta.page as Parameters<typeof setCurrentPage>[0])}
            >
              {cta.label}
              <ArrowRight className="h-2.5 w-2.5" />
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Priority label helper ──
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