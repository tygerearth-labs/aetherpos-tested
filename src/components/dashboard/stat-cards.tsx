'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { motion } from 'framer-motion'
import {
  DollarSign, Receipt, AlertTriangle, TrendingUp,
  ArrowUpRight, ArrowDownRight, Layers,
} from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { DashboardStats } from '@/hooks/use-dashboard'

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1, y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
}

export function StatCards({ stats, isOwner }: { stats: DashboardStats; isOwner: boolean }) {
  const changePercent = stats.revenueChangePercent ?? 0
  const isUp = changePercent >= 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Revenue */}
      <motion.div variants={itemVariants}>
        <Card className="aether-card overflow-hidden relative">
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
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Transaksi */}
      <motion.div variants={itemVariants}>
        <Card className="aether-card">
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
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Profit — OWNER */}
      {isOwner && (
        <motion.div variants={itemVariants}>
          <Card className="bg-nebula border border-amber-500/10 rounded-xl overflow-hidden relative">
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
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Low Stock */}
      <motion.div variants={itemVariants}>
        <Card className={`bg-nebula border rounded-xl overflow-hidden relative ${
          stats.lowStockProducts > 0 ? 'border-red-500/20' : 'border-white/[0.06]'
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
            </div>
            {stats.lowStockVariants > 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <Layers className="h-3 w-3 text-violet-400" />
                <span className="text-[10px] text-violet-400">
                  {stats.lowStockVariants} varian stok rendah
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}