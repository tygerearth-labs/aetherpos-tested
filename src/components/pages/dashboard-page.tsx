'use client'

import { useSession } from 'next-auth/react'
import { usePlan } from '@/hooks/use-plan'
import { useDashboard, useInsights, useForecast } from '@/hooks/use-dashboard'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { motion } from 'framer-motion'
import { Sparkles, Crown } from 'lucide-react'
import { HealthRing } from '@/components/dashboard/dashboard-charts'
import { StatCards } from '@/components/dashboard/stat-cards'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { AnalyticsTabs } from '@/components/dashboard/analytics-tabs'
import { TopProducts, TopCustomers, LowStockSection, InsightsSection } from '@/components/dashboard/dashboard-sections'

// ── Animation variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } },
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
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date())
}

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { data: session } = useSession()
  const { plan, features, isLoading: planLoading } = usePlan()
  const isOwner = session?.user?.role === 'OWNER'
  const isPro = plan?.type === 'pro' || plan?.type === 'enterprise'
  const hasForecasting = features?.forecasting === true
  const hasAiInsights = features?.aiInsights === true

  // ── TanStack Query data ──
  const { data: stats, isLoading } = useDashboard()
  const { data: insightData, isLoading: insightLoading, refetch: refetchInsights } = useInsights(!!isOwner && !!hasAiInsights)
  const { data: forecastData, isLoading: forecastLoading } = useForecast(!!isOwner && !!hasForecasting)

  const topSelling = insightData?.metrics.topSelling ?? []

  // ── Loading Skeleton ──
  if (isLoading || !stats) {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-52 bg-white/[0.04]" />
          <Skeleton className="h-3.5 w-64 bg-white/[0.04]" />
        </div>
        <Skeleton className="h-56 bg-nebula rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 bg-nebula rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-52 bg-nebula rounded-2xl" />
          <Skeleton className="h-52 bg-nebula rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <motion.div className="space-y-4" variants={containerVariants} initial="hidden" animate="visible">
      {/* 1. Welcome Header */}
      <motion.div variants={itemVariants} className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">
            {getGreeting()}, {session?.user?.name?.split(' ')[0] ?? 'User'}
          </h1>
          <p className="text-sm text-slate-500">{formatDateNow()}</p>
        </div>
        {isOwner && insightData && (
          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Health Score</p>
              <p className={`text-xs font-semibold ${insightData.healthScore >= 75 ? 'theme-text' : insightData.healthScore >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                {insightData.healthScore >= 75 ? 'Sehat' : insightData.healthScore >= 50 ? 'Perhatian' : 'Kritis'}
              </p>
            </div>
            <HealthRing score={insightData.healthScore} />
          </div>
        )}
      </motion.div>

      {/* 2. Upgrade Banner (FREE only) */}
      {!planLoading && plan?.type === 'free' && (
        <motion.div variants={itemVariants}>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-500/[0.06] theme-gradient-subtle border border-white/[0.04]">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
              <p className="text-xs text-slate-400">
                Buka fitur <span className="font-medium text-slate-200">Forecasting & Prediksi</span> — upgrade ke Pro atau Enterprise
              </p>
            </div>
            <Button size="sm" className="shrink-0 theme-bg hover:theme-hover-light text-white text-xs font-medium h-7 px-3 rounded-lg gap-1.5">
              <Crown className="h-3 w-3" />Upgrade
            </Button>
          </div>
        </motion.div>
      )}

      {/* 3. Stat Cards */}
      <StatCards stats={stats} isOwner={isOwner} />

      {/* 4. Quick Actions */}
      <QuickActions />

      {/* 5. Analytics Tabs (Forecast, P&L, Peak Hours) — OWNER only */}
      <AnalyticsTabs
        stats={stats}
        forecastData={forecastData ?? null}
        forecastLoading={forecastLoading}
        hasForecasting={!!hasForecasting}
        isOwner={isOwner}
        isPro={isPro}
      />

      {/* 6. AI Insight Card (OWNER) */}
      {isOwner && hasAiInsights && (
        <InsightsSection insightData={insightData ?? null} isLoading={insightLoading} onRefresh={() => refetchInsights()} />
      )}

      {/* 7. Bottom Row — Top Products & Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TopProducts products={topSelling} />
        {isOwner && <TopCustomers customers={stats.topCustomers} />}
      </div>

      {/* 8. Low Stock Detail */}
      <LowStockSection stats={stats} />
    </motion.div>
  )
}