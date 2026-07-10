'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { motion } from 'framer-motion'
import {
  DollarSign, Receipt, AlertTriangle, TrendingUp,
  ArrowUpRight, ArrowDownRight, Layers, FlaskConical,
  Info, Calculator, ShoppingCart, Clock, PackageX, Zap,
} from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { DashboardStats } from '@/hooks/use-dashboard'

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
} as const

// ════════════════════════════════════════════════════════════
// Revenue Card Popover
// ════════════════════════════════════════════════════════════

function RevenuePopover({ stats }: { stats: DashboardStats }) {
  const changePercent = stats.revenueChangePercent ?? 0
  const isUp = changePercent >= 0
  const discountPct = stats.todayBrutto > 0
    ? ((stats.todayDiscount / stats.todayBrutto) * 100).toFixed(1)
    : '0'

  return (
    <div className="w-72 sm:w-80 max-w-[calc(100vw-2.5rem)] space-y-3.5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-lg theme-bg-very-light flex items-center justify-center theme-text">
            <DollarSign className="h-3 w-3" />
          </div>
          <h4 className="text-sm font-bold text-white">Detail Revenue</h4>
        </div>
        <p className="text-[10px] text-slate-500 ml-8">Ringkasan pendapatan hari ini</p>
      </div>

      {/* Today's Revenue */}
      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
        <p className="text-[9px] text-slate-500 uppercase tracking-wider font-medium mb-1">Revenue Hari Ini</p>
        <p className="text-lg font-bold text-white">{formatCurrency(stats.todayRevenue)}</p>
        <div className="flex items-center gap-1.5 mt-1.5">
          {isUp ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full theme-bg-very-light theme-text">
              <ArrowUpRight className="h-2.5 w-2.5" />
              {Math.abs(changePercent).toFixed(1)}%
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">
              <ArrowDownRight className="h-2.5 w-2.5" />
              {Math.abs(changePercent).toFixed(1)}%
            </span>
          )}
          <span className="text-[10px] text-slate-500">vs kemarin</span>
        </div>
      </div>

      {/* Breakdown Grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Calculator className="h-3 w-3 text-slate-500" />
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">Brutto</span>
          </div>
          <p className="text-xs font-bold text-white">{formatCurrency(stats.todayBrutto)}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">Sebelum diskon & pajak</p>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Layers className="h-3 w-3 text-orange-400" />
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">Diskon</span>
          </div>
          <p className="text-xs font-bold text-orange-400">-{formatCurrency(stats.todayDiscount)}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">{discountPct}% dari brutto</p>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Receipt className="h-3 w-3 text-violet-400" />
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">PPN</span>
          </div>
          <p className="text-xs font-bold text-white">{formatCurrency(stats.todayTax)}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">Pajak yang dikenakan</p>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3 w-3 text-slate-500" />
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">Kemarin</span>
          </div>
          <p className="text-xs font-bold text-slate-300">{formatCurrency(stats.yesterdayRevenue)}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">{formatNumber(stats.yesterdayTransactions)} transaksi</p>
        </div>
      </div>

      {/* Insight */}
      <div className="rounded-lg bg-violet-500/[0.06] border border-violet-500/15 p-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Zap className="h-3 w-3 text-violet-400" />
          <span className="text-[9px] text-violet-400 uppercase tracking-wider font-semibold">Insight</span>
        </div>
        <p className="text-[10px] text-slate-300 leading-relaxed">
          {changePercent >= 10
            ? 'Revenue hari ini naik signifikan! Pertahankan strategi penjualan yang sedang berjalan.'
            : changePercent >= 0
              ? 'Revenue stabil dibanding kemarin. Coba tingkatkan upselling untuk pertumbuhan lebih tinggi.'
              : 'Revenue menurun dibanding kemarin. Periksa produk yang kurang laris dan pertimbangkan promo.'}
        </p>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Transaction Card Popover
// ════════════════════════════════════════════════════════════

function TransactionPopover({ stats }: { stats: DashboardStats }) {
  const txChange = stats.yesterdayTransactions > 0
    ? (((stats.todayTransactions - stats.yesterdayTransactions) / stats.yesterdayTransactions) * 100).toFixed(1)
    : null
  const aov = stats.todayTransactions > 0 ? stats.todayRevenue / stats.todayTransactions : 0
  const now = new Date()
  const hoursOpen = Math.max(now.getHours(), 1)
  const avgPerHour = (stats.todayTransactions / hoursOpen).toFixed(1)

  return (
    <div className="w-72 sm:w-80 max-w-[calc(100vw-2.5rem)] space-y-3.5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-lg bg-white/[0.04] flex items-center justify-center text-slate-300">
            <Receipt className="h-3 w-3" />
          </div>
          <h4 className="text-sm font-bold text-white">Detail Transaksi</h4>
        </div>
        <p className="text-[10px] text-slate-500 ml-8">Analisis transaksi hari ini</p>
      </div>

      {/* Today vs Yesterday */}
      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider font-medium">Hari Ini</p>
            <p className="text-lg font-bold text-white">{formatNumber(stats.todayTransactions)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-slate-500 uppercase tracking-wider font-medium">Kemarin</p>
            <p className="text-lg font-bold text-slate-400">{formatNumber(stats.yesterdayTransactions)}</p>
          </div>
        </div>
        {txChange !== null && (
          <div className="flex items-center gap-1.5 pt-2 border-t border-white/[0.04]">
            {Number(txChange) >= 0 ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                <ArrowUpRight className="h-2.5 w-2.5" />
                {Math.abs(Number(txChange)).toFixed(1)}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">
                <ArrowDownRight className="h-2.5 w-2.5" />
                {Math.abs(Number(txChange)).toFixed(1)}%
              </span>
            )}
            <span className="text-[10px] text-slate-500">perubahan jumlah transaksi</span>
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <ShoppingCart className="h-3 w-3 text-cyan-400" />
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">AOV</span>
          </div>
          <p className="text-xs font-bold text-white">{formatCurrency(aov)}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">Rata-rata per transaksi</p>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3 w-3 text-amber-400" />
            <span className="text-[9px] text-slate-500 uppercase tracking-wider">Per Jam</span>
          </div>
          <p className="text-xs font-bold text-white">{avgPerHour}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">Rata-rata per jam buka</p>
        </div>
      </div>

      {/* Insight */}
      <div className="rounded-lg bg-violet-500/[0.06] border border-violet-500/15 p-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Zap className="h-3 w-3 text-violet-400" />
          <span className="text-[9px] text-violet-400 uppercase tracking-wider font-semibold">Insight</span>
        </div>
        <p className="text-[10px] text-slate-300 leading-relaxed">
          {Number(avgPerHour) >= 5
            ? `Tingkat transaksi cukup padat dengan rata-rata ${avgPerHour} transaksi per jam. Pastikan stok dan SDM memadai.`
            : `Rata-rata ${avgPerHour} transaksi per jam. Pertimbangkan promosi jam sibuk untuk meningkatkan traffic.`}
        </p>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Profit Card Popover
// ════════════════════════════════════════════════════════════

function ProfitPopover({ stats }: { stats: DashboardStats }) {
  const todayMargin = stats.todayRevenue > 0 && stats.todayProfit !== null
    ? ((stats.todayProfit / stats.todayRevenue) * 100).toFixed(1)
    : '0'
  const totalMargin = stats.totalProfit !== null && stats.totalRevenue > 0
    ? ((stats.totalProfit / stats.totalRevenue) * 100).toFixed(1)
    : '0'

  return (
    <div className="w-72 sm:w-80 max-w-[calc(100vw-2.5rem)] space-y-3.5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
            <TrendingUp className="h-3 w-3" />
          </div>
          <h4 className="text-sm font-bold text-white">Detail Profit</h4>
        </div>
        <p className="text-[10px] text-slate-500 ml-8">Analisis laba bersih</p>
      </div>

      {/* Today's Profit */}
      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
        <p className="text-[9px] text-slate-500 uppercase tracking-wider font-medium mb-1">Profit Hari Ini</p>
        <p className="text-lg font-bold text-amber-400">{stats.todayProfit !== null ? formatCurrency(stats.todayProfit) : '-'}</p>
        <p className="text-[10px] text-slate-500 mt-1">
          Margin: <span className="text-amber-400 font-medium">{todayMargin}%</span> dari revenue
        </p>
      </div>

      {/* Total */}
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <TrendingUp className="h-3 w-3 text-emerald-400" />
          <span className="text-[9px] text-slate-500 uppercase tracking-wider">Total Profit</span>
        </div>
        <p className="text-sm font-bold text-white">{stats.totalProfit !== null ? formatCurrency(stats.totalProfit) : '-'}</p>
        <p className="text-[9px] text-slate-600 mt-0.5">
          Margin keseluruhan: <span className="text-slate-300 font-medium">{totalMargin}%</span>
        </p>
      </div>

      {/* Insight */}
      <div className="rounded-lg bg-violet-500/[0.06] border border-violet-500/15 p-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Zap className="h-3 w-3 text-violet-400" />
          <span className="text-[9px] text-violet-400 uppercase tracking-wider font-semibold">Insight</span>
        </div>
        <p className="text-[10px] text-slate-300 leading-relaxed">
          {Number(todayMargin) >= 25
            ? 'Margin profit sangat sehat di atas 25%. Terus pantau HPP dan harga jual untuk mempertahankan.'
            : Number(todayMargin) >= 15
              ? 'Margin profit cukup baik. Evaluasi produk dengan margin rendah untuk optimasi.'
              : 'Margin profit perlu perhatian. Cek HPP produk dan pertimbangkan penyesuaian harga.'}
        </p>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Low Stock Card Popover
// ════════════════════════════════════════════════════════════

function LowStockPopover({ stats }: { stats: DashboardStats }) {
  const lowProducts = stats.lowStockList ?? []
  const lowVariants = stats.lowStockVariantList ?? []
  const lowInventory = stats.lowInventoryList ?? []

  return (
    <div className="w-72 sm:w-80 max-w-[calc(100vw-2.5rem)] space-y-3.5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400">
            <AlertTriangle className="h-3 w-3" />
          </div>
          <h4 className="text-sm font-bold text-white">Detail Stok Menipis</h4>
        </div>
        <p className="text-[10px] text-slate-500 ml-8">Produk & inventori yang perlu restok</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="rounded-lg bg-red-500/[0.06] border border-red-500/15 p-2 text-center">
          <p className="text-base font-bold text-red-400">{stats.lowStockProducts}</p>
          <p className="text-[8px] text-slate-500 mt-0.5">Produk</p>
        </div>
        <div className="rounded-lg bg-violet-500/[0.06] border border-violet-500/15 p-2 text-center">
          <p className="text-base font-bold text-violet-400">{stats.lowStockVariants || 0}</p>
          <p className="text-[8px] text-slate-500 mt-0.5">Varian</p>
        </div>
        <div className="rounded-lg bg-orange-500/[0.06] border border-orange-500/15 p-2 text-center">
          <p className="text-base font-bold text-orange-400">{stats.lowInventoryItems || 0}</p>
          <p className="text-[8px] text-slate-500 mt-0.5">Inventori</p>
        </div>
      </div>

      {/* Low Stock Products List */}
      {lowProducts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] text-slate-500 uppercase tracking-wider font-medium">Produk Stok Rendah</p>
          <div className="max-h-36 overflow-y-auto space-y-1 pr-1 theme-scrollbar">
            {lowProducts.slice(0, 8).map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/[0.04] px-2.5 py-1.5">
                <span className="text-[10px] text-slate-300 truncate flex-1 mr-2">{item.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-bold text-red-400">{item.stock}</span>
                  <span className="text-[9px] text-slate-600">/ {item.lowStockAlert}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low Inventory Items List */}
      {lowInventory.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] text-slate-500 uppercase tracking-wider font-medium">Inventori Menipis</p>
          <div className="max-h-36 overflow-y-auto space-y-1 pr-1 theme-scrollbar">
            {lowInventory.slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-2.5 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-300 truncate flex-1 mr-2">{item.name}</span>
                  <span className={cn(
                    'text-[10px] font-bold shrink-0',
                    item.daysUntilEmpty !== null && item.daysUntilEmpty <= 3 ? 'text-red-400' : 'text-amber-400'
                  )}>
                    {item.stock} {item.baseUnit}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[9px] text-slate-600">
                    {item.daysUntilEmpty !== null
                      ? `${item.daysUntilEmpty} hari lagi`
                      : `Konsumsi: ${item.dailyConsumption.toFixed(1)}/hari`}
                  </span>
                  <span className="text-[9px] text-slate-600">
                    Rp{formatNumber(item.avgCost)}/{item.baseUnit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No items message */}
      {lowProducts.length === 0 && lowInventory.length === 0 && (
        <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15 p-3 text-center">
          <PackageX className="h-5 w-5 text-emerald-400 mx-auto mb-1.5" />
          <p className="text-[10px] text-emerald-400 font-medium">Semua stok aman!</p>
          <p className="text-[9px] text-slate-500 mt-0.5">Tidak ada produk atau inventori yang perlu di-restok</p>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Helper
// ════════════════════════════════════════════════════════════

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(' ')
}

// ════════════════════════════════════════════════════════════
// Main Stat Cards Component
// ════════════════════════════════════════════════════════════

export function StatCards({ stats, isOwner }: { stats: DashboardStats; isOwner: boolean }) {
  const changePercent = stats.revenueChangePercent ?? 0
  const isUp = changePercent >= 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Revenue */}
      <motion.div variants={itemVariants}>
        <Popover>
          <PopoverTrigger asChild>
            <Card className="aether-card overflow-hidden relative cursor-pointer group transition-all duration-200 hover:border-white/[0.12]">
              <div className="absolute inset-0 bg-gradient-to-br theme-gradient-subtle" />
              <CardContent className="p-3.5 relative">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Revenue</p>
                  <div className="w-7 h-7 rounded-lg theme-bg-very-light flex items-center justify-center theme-text">
                    <DollarSign className="h-3.5 w-3.5" />
                  </div>
                </div>
                <p className="text-xl font-bold text-white tracking-tight">
                  {formatCurrency(stats.todayRevenue)}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {stats.yesterdayRevenue > 0 ? (
                    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      isUp ? 'theme-bg-very-light theme-text' : 'bg-red-500/10 text-red-400'
                    }`}>
                      {isUp ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                      {Math.abs(changePercent).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-600">vs kemarin</span>
                  )}
                  <Info className="h-3 w-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                </div>
              </CardContent>
            </Card>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            sideOffset={8}
            align="start"
            collisionPadding={16}
            className="w-auto bg-nebula border-white/[0.08] p-4 shadow-2xl shadow-black/50"
          >
            <RevenuePopover stats={stats} />
          </PopoverContent>
        </Popover>
      </motion.div>

      {/* Transaksi */}
      <motion.div variants={itemVariants}>
        <Popover>
          <PopoverTrigger asChild>
            <Card className="aether-card cursor-pointer group transition-all duration-200 hover:border-white/[0.12]">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Transaksi</p>
                  <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center text-slate-300">
                    <Receipt className="h-3.5 w-3.5" />
                  </div>
                </div>
                <p className="text-xl font-bold text-white tracking-tight">
                  {formatNumber(stats.todayTransactions)}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-slate-600">kemarin </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {formatNumber(stats.yesterdayTransactions)}
                  </span>
                  <Info className="h-3 w-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                </div>
              </CardContent>
            </Card>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            sideOffset={8}
            align="start"
            collisionPadding={16}
            className="w-auto bg-nebula border-white/[0.08] p-4 shadow-2xl shadow-black/50"
          >
            <TransactionPopover stats={stats} />
          </PopoverContent>
        </Popover>
      </motion.div>

      {/* Profit — OWNER */}
      {isOwner && (
        <motion.div variants={itemVariants}>
          <Popover>
            <PopoverTrigger asChild>
              <Card className="bg-nebula border border-amber-500/10 rounded-xl overflow-hidden relative cursor-pointer group transition-all duration-200 hover:border-amber-500/25">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/[0.04] to-transparent" />
                <CardContent className="p-3.5 relative">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Profit</p>
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
                      <TrendingUp className="h-3.5 w-3.5" />
                    </div>
                  </div>
                  <p className="text-xl font-bold text-amber-400 tracking-tight">
                    {stats.todayProfit !== null ? formatCurrency(stats.todayProfit) : '-'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] text-slate-600">total </span>
                    <span className="text-[10px] text-amber-400/70 font-medium">
                      {stats.totalProfit !== null ? formatCurrency(stats.totalProfit) : '-'}
                    </span>
                    <Info className="h-3 w-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                  </div>
                </CardContent>
              </Card>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              sideOffset={8}
              align="start"
              collisionPadding={16}
              className="w-auto bg-nebula border-white/[0.08] p-4 shadow-2xl shadow-black/50"
            >
              <ProfitPopover stats={stats} />
            </PopoverContent>
          </Popover>
        </motion.div>
      )}

      {/* Low Stock */}
      <motion.div variants={itemVariants}>
        <Popover>
          <PopoverTrigger asChild>
            <Card className={`bg-nebula border rounded-xl overflow-hidden relative cursor-pointer group transition-all duration-200 hover:border-white/[0.12] ${
              (stats.lowStockProducts > 0 || stats.lowInventoryItems > 0) ? 'border-red-500/20' : 'border-white/[0.06]'
            }`}>
              <div className={`absolute inset-0 ${stats.lowStockProducts > 0 ? 'bg-gradient-to-br from-red-500/[0.04] to-transparent' : 'bg-gradient-to-br from-slate-500/[0.02] to-transparent'}`} />
              <CardContent className="p-3.5 relative">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Stok Menipis</p>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    stats.lowStockProducts > 0 ? 'bg-red-500/10 text-red-400' : 'bg-white/[0.04] text-slate-400'
                  }`}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </div>
                </div>
                <p className={`text-xl font-bold tracking-tight ${
                  stats.lowStockProducts > 0 ? 'text-red-400' : 'text-white'
                }`}>
                  {formatNumber(stats.lowStockProducts)}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  {stats.lowStockProducts > 0 ? (
                    <span className="text-[10px] text-red-400/70 font-medium">perlu restok</span>
                  ) : (
                    <span className="text-[10px] text-slate-600">semua aman</span>
                  )}
                  {stats.lowStockProducts > 0 && (
                    <motion.span
                      className="relative flex h-2 w-2"
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-40" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                    </motion.span>
                  )}
                  <Info className="h-3 w-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                </div>
                {stats.lowStockVariants > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Layers className="h-3 w-3 text-violet-400" />
                    <span className="text-[10px] text-violet-400">
                      {stats.lowStockVariants} varian stok rendah
                    </span>
                  </div>
                )}
                {stats.lowInventoryItems > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <FlaskConical className="h-3 w-3 text-orange-400" />
                    <span className="text-[10px] text-orange-400">
                      {stats.lowInventoryItems} inventori menipis
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            sideOffset={8}
            align="start"
            collisionPadding={16}
            className="w-auto bg-nebula border-white/[0.08] p-4 shadow-2xl shadow-black/50"
          >
            <LowStockPopover stats={stats} />
          </PopoverContent>
        </Popover>
      </motion.div>
    </div>
  )
}