'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  Building2, ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight,
  Package, AlertTriangle, ShieldAlert, Activity, TrendingDown,
  CircleDot, Zap,
} from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

interface BubbleChartOutlet {
  id: string
  name: string
  isMain: boolean
  revenue: number
  transactions: number
  aov: number
  profit: number
  profitMargin: number
}

interface BubbleChartData {
  month: number
  year: number
  outlets: BubbleChartOutlet[]
  availableMonths: { year: number; month: number; label: string }[]
  totalRevenue: number
  totalTransactions: number
}

interface TransferBrief {
  id: string
  transferNumber: string
  toOutlet?: string
  fromOutlet?: string
  status: string
  itemType: string
  itemCount: number
  totalQty: number
  createdAt: string
  notes?: string | null
}

interface PendingOutletSummary {
  id: string
  name: string
  isMain: boolean
  pendingOutbound: number
  pendingOutboundItems: number
  pendingInbound: number
  pendingInboundItems: number
  outboundTransfers: TransferBrief[]
  inboundTransfers: TransferBrief[]
}

interface PendingTransfersData {
  outlets: PendingOutletSummary[]
  totalPendingOutbound: number
  totalPendingInbound: number
  totalPending: number
}

interface InventoryPredictionItem {
  id: string
  name: string
  stock: number
  lowStockAlert: number
  avgCost: number
  baseUnit: string
  category: string | null
  categoryColor: string
  consumed30d: number
  dailyConsumption: number
  daysUntilEmpty: number | null
  status: 'critical' | 'warning' | 'healthy' | 'idle'
  stockValue: number
}

interface OutletPrediction {
  id: string
  name: string
  isMain: boolean
  txIntensity: number
  totalItems: number
  criticalCount: number
  warningCount: number
  totalStockValue: number
  predictions: InventoryPredictionItem[]
}

interface InventoryPredictionData {
  outlets: OutletPrediction[]
  totalCritical: number
  totalWarning: number
  totalStockValue: number
}

// ════════════════════════════════════════════════════════════
// 1. ENTERPRISE BUBBLE CHART
// ════════════════════════════════════════════════════════════

export function EnterpriseBubbleChart() {
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState<string>(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  )

  const { data, isLoading } = useQuery<BubbleChartData>({
    queryKey: ['enterprise-bubble', selectedMonth],
    queryFn: async () => {
      const [year, month] = selectedMonth.split('-').map(Number)
      const res = await fetch(`/api/enterprise/bubble-chart?month=${month}&year=${year}`)
      if (!res.ok) throw new Error('Failed to load bubble chart')
      return res.json()
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const chartData = useMemo(() => {
    if (!data?.outlets) return []
    const maxRevenue = Math.max(...data.outlets.map((o) => o.revenue), 1)
    return data.outlets.map((o) => ({
      x: o.transactions,
      y: o.aov,
      z: Math.max(o.revenue / maxRevenue * 700, 50),
      revenue: o.revenue,
      name: o.name,
      isMain: o.isMain,
      profitMargin: o.profitMargin,
      _revenue: o.revenue,
    }))
  }, [data])

  return (
    <Card className="aether-card overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg aether-gradient-subtle flex items-center justify-center">
            <Building2 className="h-3.5 w-3.5 text-pink-400" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-white">Outlet Revenue Map</h3>
            <p className="text-[10px] text-slate-500">Bubble size = Revenue</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {data && (
            <div className="hidden lg:flex items-center gap-3 mr-2 text-[10px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-pink-500/60" /> Utama
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-cyan-500/60" /> Cabang
              </span>
            </div>
          )}
          {data?.availableMonths && data.availableMonths.length > 0 && (
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="h-7 w-[160px] bg-nebula border-white/[0.06] text-xs text-slate-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-nebula border-white/[0.06]">
                {data.availableMonths.map((m) => (
                  <SelectItem
                    key={`${m.year}-${m.month}`}
                    value={`${m.year}-${String(m.month).padStart(2, '0')}`}
                    className="text-xs text-slate-300 focus:bg-white/[0.04] focus:text-white"
                  >
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Chart body — flex-1 to fill available height */}
      <CardContent className="px-4 pb-4 flex-1 flex flex-col min-h-0">
        {isLoading ? (
          <Skeleton className="flex-1 min-h-[260px] bg-white/[0.03] rounded-xl w-full" />
        ) : chartData.length === 0 ? (
          <div className="flex-1 min-h-[260px] flex flex-col items-center justify-center gap-2 text-slate-500">
            <Building2 className="h-8 w-8 opacity-30" />
            <p className="text-xs">Belum ada data transaksi</p>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Chart */}
            <div className="flex-1 min-h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 8 }}>
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Transaksi"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                    label={{
                      value: 'Jumlah Transaksi',
                      position: 'bottom',
                      offset: 8,
                      style: { fontSize: 10, fill: '#475569' },
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="AOV"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
                    label={{
                      value: 'AOV',
                      angle: -90,
                      position: 'insideLeft',
                      offset: 5,
                      style: { fontSize: 10, fill: '#475569' },
                    }}
                  />
                  <ZAxis type="number" dataKey="z" range={[30, 200]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10,
                      fontSize: 11,
                      color: '#e2e8f0',
                      boxShadow: '0 4px 24px -4px rgba(0,0,0,0.5)',
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === 'Transaksi') return [formatNumber(value), 'Transaksi']
                      if (name === 'AOV') return [formatCurrency(value), 'AOV']
                      return [value, name]
                    }}
                    labelFormatter={(_, payload) => {
                      if (payload?.[0]?.payload?.name) return payload[0].payload.name
                      return ''
                    }}
                  />
                  <Scatter data={chartData} animationDuration={800}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={index}
                        fill={entry.isMain ? 'rgba(236, 72, 153, 0.55)' : 'rgba(6, 182, 212, 0.45)'}
                        stroke={entry.isMain ? 'rgba(236, 72, 153, 0.8)' : 'rgba(6, 182, 212, 0.7)'}
                        strokeWidth={1.5}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            {/* Mobile legend */}
            <div className="lg:hidden flex items-center justify-center gap-4 text-[10px] text-slate-500 mb-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-pink-500/60" /> Utama
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-cyan-500/60" /> Cabang
              </span>
            </div>

            {/* Outlet summary row */}
            {data?.outlets && (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mt-1">
                  {data.outlets.map((o) => (
                    <div
                      key={o.id}
                      className={cn(
                        'rounded-lg px-2.5 py-2 border',
                        o.isMain
                          ? 'bg-pink-500/[0.04] border-pink-500/15'
                          : 'bg-white/[0.02] border-white/[0.06]'
                      )}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        <CircleDot className={cn('h-2.5 w-2.5', o.isMain ? 'text-pink-400' : 'text-cyan-400')} />
                        <span className="text-[10px] font-medium text-slate-300 truncate">{o.name}</span>
                      </div>
                      <p className="text-[11px] font-bold text-white leading-tight">{formatCurrency(o.revenue)}</p>
                      <p className="text-[9px] text-slate-500">{formatNumber(o.transactions)} tx</p>
                    </div>
                  ))}
                </div>

                {/* Total bar */}
                <div className="flex items-center justify-between px-3 py-2 mt-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-[10px] text-slate-500">Total Revenue</p>
                      <p className="text-xs font-bold theme-text">{formatCurrency(data.totalRevenue)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Total Transaksi</p>
                      <p className="text-xs font-bold text-white">{formatNumber(data.totalTransactions)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500">Outlet</p>
                    <p className="text-xs font-bold text-white">{data.outlets.length}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ════════════════════════════════════════════════════════════
// 2. PENDING INBOUND/OUTBOUND
// ════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: string }) {
  if (status === 'IN_TRANSIT') {
    return (
      <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px] h-5 px-1.5 gap-0.5 shrink-0">
        <Activity className="h-2.5 w-2.5" />Dikirim
      </Badge>
    )
  }
  return (
    <Badge className="bg-slate-500/10 border-slate-500/20 text-slate-400 text-[10px] h-5 px-1.5 shrink-0">
      Draft
    </Badge>
  )
}

function TransferRow({ transfer, direction }: { transfer: TransferBrief; direction: 'inbound' | 'outbound' }) {
  const date = new Date(transfer.createdAt)
  const dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })

  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        {direction === 'inbound'
          ? <ArrowDownToLine className="h-3 w-3 text-emerald-400 shrink-0" />
          : <ArrowUpFromLine className="h-3 w-3 text-orange-400 shrink-0" />
        }
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-slate-200 truncate">
            {direction === 'inbound' ? transfer.fromOutlet : transfer.toOutlet}
          </p>
          <p className="text-[10px] text-slate-500 truncate">
            {transfer.transferNumber} &middot; {dateStr}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span className="text-[10px] text-slate-400 hidden sm:inline">
          {transfer.totalQty} pcs
        </span>
        <StatusBadge status={transfer.status} />
      </div>
    </div>
  )
}

export function PendingTransfersSection() {
  const [expandedOutlet, setExpandedOutlet] = useState<string | null>(null)

  const { data, isLoading } = useQuery<PendingTransfersData>({
    queryKey: ['enterprise-pending-transfers'],
    queryFn: async () => {
      const res = await fetch('/api/enterprise/pending-transfers')
      if (!res.ok) throw new Error('Failed to load pending transfers')
      return res.json()
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  return (
    <Card className="aether-card overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <ArrowDownToLine className="h-3.5 w-3.5 text-violet-400" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-white">Transfer Pending</h3>
              <p className="text-[10px] text-slate-500">Inbound & Outbound</p>
            </div>
          </div>
          {data && data.totalPending > 0 && (
            <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px] h-5 px-2">
              {data.totalPending}
            </Badge>
          )}
        </div>

        {/* Summary row */}
        {data && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg p-2.5 bg-orange-500/[0.04] border border-orange-500/10">
              <div className="flex items-center gap-1.5 mb-0.5">
                <ArrowUpFromLine className="h-3 w-3 text-orange-400" />
                <span className="text-[10px] text-slate-400">Outbound</span>
              </div>
              <p className="text-sm font-bold text-orange-400">{data.totalPendingOutbound}</p>
            </div>
            <div className="rounded-lg p-2.5 bg-emerald-500/[0.04] border border-emerald-500/10">
              <div className="flex items-center gap-1.5 mb-0.5">
                <ArrowDownToLine className="h-3 w-3 text-emerald-400" />
                <span className="text-[10px] text-slate-400">Inbound</span>
              </div>
              <p className="text-sm font-bold text-emerald-400">{data.totalPendingInbound}</p>
            </div>
          </div>
        )}
      </div>

      {/* List body — scrollable, flex-1 */}
      <div className="px-4 pb-4 flex-1 min-h-0">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : !data || data.totalPending === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500">
            <Package className="h-6 w-6 opacity-30 mb-2" />
            <p className="text-xs">Tidak ada transfer pending</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[380px] overflow-y-auto scrollbar-hide">
            {data.outlets.map((o) => {
              const hasPending = o.pendingOutbound > 0 || o.pendingInbound > 0
              if (!hasPending) return null
              const isExpanded = expandedOutlet === o.id

              return (
                <div key={o.id} className="rounded-lg border border-white/[0.06] bg-white/[0.01] overflow-hidden">
                  <button
                    onClick={() => setExpandedOutlet(isExpanded ? null : o.id)}
                    className="w-full flex items-center justify-between p-2.5 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className={cn('h-3 w-3 shrink-0', o.isMain ? 'text-pink-400' : 'text-slate-400')} />
                      <span className="text-[11px] font-medium text-slate-200 truncate">{o.name}</span>
                      {o.isMain && (
                        <Badge className="bg-pink-500/10 border-pink-500/20 text-pink-400 text-[9px] h-4 px-1 shrink-0">Utama</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-2 text-[10px]">
                        {o.pendingOutbound > 0 && <span className="text-orange-400">{o.pendingOutbound} out</span>}
                        {o.pendingInbound > 0 && <span className="text-emerald-400">{o.pendingInbound} in</span>}
                      </div>
                      {isExpanded
                        ? <ChevronDown className="h-3 w-3 text-slate-500" />
                        : <ChevronRight className="h-3 w-3 text-slate-500" />
                      }
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-2.5 pb-2.5">
                      {o.inboundTransfers.length > 0 && (
                        <div className="mb-1.5">
                          <p className="text-[10px] text-emerald-400 font-medium mb-1 flex items-center gap-1 px-1">
                            <ArrowDownToLine className="h-2.5 w-2.5" /> Inbound
                          </p>
                          {o.inboundTransfers.map((t) => (
                            <TransferRow key={t.id} transfer={t} direction="inbound" />
                          ))}
                        </div>
                      )}
                      {o.outboundTransfers.length > 0 && (
                        <div>
                          <p className="text-[10px] text-orange-400 font-medium mb-1 flex items-center gap-1 px-1">
                            <ArrowUpFromLine className="h-2.5 w-2.5" /> Outbound
                          </p>
                          {o.outboundTransfers.map((t) => (
                            <TransferRow key={t.id} transfer={t} direction="outbound" />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

// ════════════════════════════════════════════════════════════
// 3. INVENTORY PREDICTION
// ════════════════════════════════════════════════════════════

function StatusIndicator({ status, days }: { status: string; days: number | null }) {
  if (status === 'critical') {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <ShieldAlert className="h-3 w-3 text-red-400" />
        <span className="text-[10px] font-semibold text-red-400 whitespace-nowrap">
          {days !== null ? `${days}h` : 'Kritis'}
        </span>
      </div>
    )
  }
  if (status === 'warning') {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <AlertTriangle className="h-3 w-3 text-amber-400" />
        <span className="text-[10px] font-semibold text-amber-400 whitespace-nowrap">
          {days !== null ? `${days}h` : 'Perhatian'}
        </span>
      </div>
    )
  }
  if (status === 'healthy') {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Zap className="h-3 w-3 text-emerald-400" />
        <span className="text-[10px] font-medium text-emerald-400 whitespace-nowrap">
          {days !== null ? `${days}h` : 'Aman'}
        </span>
      </div>
    )
  }
  return <span className="text-[10px] text-slate-500">Idle</span>
}

function DaysBar({ days, maxDays }: { days: number | null; maxDays: number }) {
  if (days === null) return <div className="h-1 w-full rounded-full bg-white/[0.04]" />
  const pct = Math.min((days / maxDays) * 100, 100)
  const color = days <= 3 ? 'bg-red-500' : days <= 7 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-1 w-full rounded-full bg-white/[0.04] overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function InventoryPredictionSection() {
  const [selectedOutlet, setSelectedOutlet] = useState<string>('__all__')
  const [expandedOutlet, setExpandedOutlet] = useState<string | null>(null)

  const { data, isLoading } = useQuery<InventoryPredictionData>({
    queryKey: ['enterprise-inventory-prediction'],
    queryFn: async () => {
      const res = await fetch('/api/enterprise/inventory-prediction')
      if (!res.ok) throw new Error('Failed to load inventory prediction')
      return res.json()
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const filteredOutlets = useMemo(() => {
    if (!data?.outlets) return []
    if (selectedOutlet === '__all__') return data.outlets
    return data.outlets.filter((o) => o.id === selectedOutlet)
  }, [data, selectedOutlet])

  const maxDays = useMemo(() => {
    const allItems = filteredOutlets.flatMap((o) => o.predictions)
    return Math.max(...allItems.map((i) => i.daysUntilEmpty ?? 0), 30)
  }, [filteredOutlets])

  // Top 5 critical/warning items across all outlets for a compact header preview
  const topAlerts = useMemo(() => {
    return data?.outlets
      .flatMap((o) =>
        o.predictions
          .filter((p) => p.status === 'critical' || p.status === 'warning')
          .map((p) => ({ ...p, outletName: o.name }))
      )
      .sort((a, b) => (a.daysUntilEmpty ?? 9999) - (b.daysUntilEmpty ?? 9999))
      .slice(0, 5) ?? []
  }, [data])

  return (
    <Card className="aether-card overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <TrendingDown className="h-3.5 w-3.5 text-orange-400" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-white">Prediksi Inventori</h3>
              <p className="text-[10px] text-slate-500">Ketahanan stok berdasarkan intensitas transaksi</p>
            </div>
          </div>

          {data?.outlets && data.outlets.length > 1 && (
            <Select value={selectedOutlet} onValueChange={setSelectedOutlet}>
              <SelectTrigger className="h-7 w-[150px] bg-nebula border-white/[0.06] text-xs text-slate-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-nebula border-white/[0.06]">
                <SelectItem value="__all__" className="text-xs text-slate-300 focus:bg-white/[0.04] focus:text-white">
                  Semua Outlet
                </SelectItem>
                {data.outlets.map((o) => (
                  <SelectItem key={o.id} value={o.id} className="text-xs text-slate-300 focus:bg-white/[0.04] focus:text-white">
                    {o.isMain ? '⭐ ' : ''}{o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Summary cards row */}
        {data && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-lg p-2.5 bg-red-500/[0.04] border border-red-500/10">
              <p className="text-[10px] text-slate-500 mb-0.5">Kritis</p>
              <p className="text-lg font-bold text-red-400 leading-tight">{data.totalCritical}</p>
              <p className="text-[9px] text-red-400/60">&lt; 3 hari</p>
            </div>
            <div className="rounded-lg p-2.5 bg-amber-500/[0.04] border border-amber-500/10">
              <p className="text-[10px] text-slate-500 mb-0.5">Perhatian</p>
              <p className="text-lg font-bold text-amber-400 leading-tight">{data.totalWarning}</p>
              <p className="text-[9px] text-amber-400/60">&lt; 7 hari</p>
            </div>
            <div className="rounded-lg p-2.5 bg-white/[0.02] border border-white/[0.06]">
              <p className="text-[10px] text-slate-500 mb-0.5">Nilai Stok</p>
              <p className="text-base font-bold text-white leading-tight">{formatCurrency(data.totalStockValue)}</p>
              <p className="text-[9px] text-slate-500">total inventory</p>
            </div>
          </div>
        )}

        {/* Critical preview strip — top 5 most urgent items */}
        {topAlerts.length > 0 && selectedOutlet === '__all__' && (
          <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
            {topAlerts.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'shrink-0 rounded-lg border px-2.5 py-1.5 min-w-[140px]',
                  item.status === 'critical'
                    ? 'bg-red-500/[0.04] border-red-500/10'
                    : 'bg-amber-500/[0.04] border-amber-500/10'
                )}
              >
                <p className="text-[10px] text-slate-300 truncate max-w-[120px]">{item.name}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[9px] text-slate-500">{item.outletName}</span>
                  <StatusIndicator status={item.status} days={item.daysUntilEmpty} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-outlet expandable list */}
      <div className="px-4 pb-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 bg-white/[0.03] rounded-lg" />
            <Skeleton className="h-20 bg-white/[0.03] rounded-lg" />
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[360px] overflow-y-auto scrollbar-hide">
            {filteredOutlets.map((outlet) => {
              const isExpanded = expandedOutlet === outlet.id

              return (
                <div key={outlet.id} className="rounded-lg border border-white/[0.06] bg-white/[0.01] overflow-hidden">
                  <button
                    onClick={() => setExpandedOutlet(isExpanded ? null : outlet.id)}
                    className="w-full flex items-center justify-between p-2.5 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className={cn('h-3 w-3 shrink-0', outlet.isMain ? 'text-pink-400' : 'text-slate-400')} />
                      <span className="text-[11px] font-medium text-slate-200 truncate">{outlet.name}</span>
                      {outlet.isMain && (
                        <Badge className="bg-pink-500/10 border-pink-500/20 text-pink-400 text-[9px] h-4 px-1 shrink-0">Utama</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-slate-500">{outlet.txIntensity} tx/hari</span>
                        {outlet.criticalCount > 0 && (
                          <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[9px] h-4 px-1">
                            {outlet.criticalCount} kritis
                          </Badge>
                        )}
                      </div>
                      {isExpanded
                        ? <ChevronDown className="h-3 w-3 text-slate-500" />
                        : <ChevronRight className="h-3 w-3 text-slate-500" />
                      }
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-2.5 pb-2.5">
                      {[...outlet.predictions]
                        .sort((a, b) => {
                          const so: Record<string, number> = { critical: 0, warning: 1, healthy: 2, idle: 3 }
                          return (so[a.status] ?? 3) - (so[b.status] ?? 3)
                        })
                        .slice(0, 15)
                        .map((item) => (
                          <div key={item.id} className="py-2 border-b border-white/[0.03] last:border-0">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[11px] text-slate-200 truncate">{item.name}</span>
                                {item.category && (
                                  <span className="text-[9px] text-slate-500 shrink-0">({item.category})</span>
                                )}
                              </div>
                              <StatusIndicator status={item.status} days={item.daysUntilEmpty} />
                            </div>
                            <DaysBar days={item.daysUntilEmpty} maxDays={maxDays} />
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-[10px] text-slate-500">
                                Stok: <span className="text-slate-400">{formatNumber(item.stock)} {item.baseUnit}</span>
                                {item.dailyConsumption > 0 && (
                                  <span className="ml-2">&middot; {item.dailyConsumption} {item.baseUnit}/hari</span>
                                )}
                              </span>
                              <span className="text-[10px] text-slate-500">{formatCurrency(item.stockValue)}</span>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}