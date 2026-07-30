'use client'

import { useState, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { usePlan } from '@/hooks/use-plan'
import { usePageStore } from '@/hooks/use-page-store'
import { useDashboard, useInsights, useForecast } from '@/hooks/use-dashboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { motion } from 'framer-motion'
import { Sparkles, Crown } from 'lucide-react'
import { HealthRing } from '@/components/dashboard/dashboard-charts'
import { StatCards } from '@/components/dashboard/stat-cards'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { AnalyticsTabs } from '@/components/dashboard/analytics-tabs'
import { SalesProductsCard, InsightsSection, InventoryAlertsSection, ScoreExplanationDialog, InventoryFreshnessWidget, ExpiryHeatmapWidget, ExpiryAlertBanner } from '@/components/dashboard/dashboard-sections'
import { EnterpriseBubbleChart, PendingTransfersSection, InventoryPredictionSection } from '@/components/dashboard/enterprise-sections'
import { MigrationBanner } from '@/components/migration/migration-banner'

// ── Animation variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
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

/** Section label used as a subtle divider between groups */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <div className="h-px flex-1 bg-white/[0.04]" />
      <span className="text-[10px] font-medium text-slate-600 uppercase tracking-widest shrink-0">
        {children}
      </span>
      <div className="h-px flex-1 bg-white/[0.04]" />
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { data: session } = useSession()
  const { setCurrentPage } = usePageStore()
  const { plan, features, isLoading: planLoading } = usePlan()
  const isOwner = session?.user?.role === 'OWNER'
  const isPro = plan?.type === 'pro' || plan?.type === 'enterprise'
  const isEnterprise = plan?.type === 'enterprise'
  const hasForecasting = features?.forecasting === true
  const hasAiInsights = features?.aiInsights === true
  const hasMultiOutlet = features?.multiOutlet === true
  const showEnterprise = isOwner && isEnterprise && hasMultiOutlet

  // ── TanStack Query data ──
  const { data: stats, isLoading } = useDashboard()
  const { data: insightData, isLoading: insightLoading, refetch: refetchInsights } = useInsights(!!isOwner && !!hasAiInsights)
  const { data: forecastData, isLoading: forecastLoading } = useForecast(!!isOwner && !!hasForecasting)
  const [scoreDialogOpen, setScoreDialogOpen] = useState(false)
  const expiryHeatmapRef = useRef<HTMLDivElement>(null)

  // ── Migration Banner: show only for OWNER when 0 products ──
  // IMPORTANT: Always render <MigrationBanner /> so its internal dialog state
  // survives dashboard refetches (refetchInterval / refetchOnWindowFocus).
  // The component itself decides when to show the banner card vs dialogs.
  const showMigrationBanner = isOwner && (stats?.totalProducts ?? 0) === 0

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

      {/* ═══════════════════════════════════════════════════
          SECTION 1 — Header & Health
          (welcome + health ring + migration + upgrade + quick actions)
          ═══════════════════════════════════════════════════ */}
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
            <HealthRing score={insightData.healthScore} onClick={() => setScoreDialogOpen(true)} />
          </div>
        )}
      </motion.div>

      {/* Migration Banner (New User: 0 Products) */}
      <motion.div variants={itemVariants}>
        <MigrationBanner showBanner={showMigrationBanner} />
      </motion.div>

      {/* Upgrade Banner (FREE only) */}
      {!planLoading && plan?.type === 'free' && (
        <motion.div variants={itemVariants}>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-500/[0.06] theme-gradient-subtle border border-white/[0.04]">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
              <p className="text-xs text-slate-400">
                Buka fitur <span className="font-medium text-slate-200">Forecasting & Prediksi</span> — upgrade ke Pro atau Enterprise
              </p>
            </div>
            <Button size="sm" className="shrink-0 theme-bg hover:theme-hover-light text-white text-xs font-medium h-7 px-3 rounded-lg gap-1.5" onClick={() => setCurrentPage('plan')}>
              <Crown className="h-3 w-3" />Upgrade
            </Button>
          </div>
        </motion.div>
      )}

      {/* Quick Actions — promoted into header utility row */}
      <motion.div variants={itemVariants}>
        <QuickActions />
      </motion.div>

      {/* ═══════════════════════════════════════════════════
          SECTION 2 — Ringkasan (KPIs)
          ═══════════════════════════════════════════════════ */}
      <SectionLabel>Ringkasan</SectionLabel>
      <motion.div variants={itemVariants}>
        <StatCards stats={stats} isOwner={isOwner} />
      </motion.div>

      {/* ═══════════════════════════════════════════════════
          SECTION 3 — Penjualan & Produk (moved UP — primary activity)
          ═══════════════════════════════════════════════════ */}
      <SectionLabel>Penjualan &amp; Produk</SectionLabel>
      <motion.div variants={itemVariants}>
        <SalesProductsCard
          lowStockList={stats.lowStockList}
          lowStockVariantList={stats.lowStockVariantList}
          lowStockVariants={stats.lowStockVariants}
          fallbackCustomers={stats.topCustomers}
        />
      </motion.div>

      {/* ═══════════════════════════════════════════════════
          SECTION 4 — Analitik & Prediksi (owner only)
          ═══════════════════════════════════════════════════ */}
      {isOwner && (
        <>
          <SectionLabel>Analitik &amp; Prediksi</SectionLabel>
          <motion.div variants={itemVariants}>
            <AnalyticsTabs
              stats={stats}
              forecastData={forecastData ?? null}
              forecastLoading={forecastLoading}
              hasForecasting={!!hasForecasting}
              isOwner={isOwner}
              isPro={isPro}
            />
          </motion.div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════
          SECTION 5 — Inteligensi Inventori (MERGED)
          Expiry banner + Freshness + Heatmap + Stock alerts
          ═══════════════════════════════════════════════════ */}
      <SectionLabel>Inteligensi Inventori</SectionLabel>

      {/* Expiry alert banner — auto-hides if no alerts */}
      <motion.div variants={itemVariants}>
        <ExpiryAlertBanner
          onShowDetail={() => {
            expiryHeatmapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }}
        />
      </motion.div>

      {/* Freshness Score + Expiry Heatmap (2-col) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <motion.div variants={itemVariants}>
          <InventoryFreshnessWidget />
        </motion.div>
        <motion.div variants={itemVariants} ref={expiryHeatmapRef}>
          <ExpiryHeatmapWidget />
        </motion.div>
      </div>

      {/* Stock endurance alerts — auto-hides if no critical/warning */}
      <motion.div variants={itemVariants}>
        <InventoryAlertsSection stats={stats} />
      </motion.div>

      {/* ═══════════════════════════════════════════════════
          SECTION 6 — Multi-Outlet Intelligence (Enterprise — moved to BOTTOM)
          ═══════════════════════════════════════════════════ */}
      {showEnterprise && (
        <>
          <SectionLabel>Multi-Outlet Intelligence</SectionLabel>

          {/* Row: Bubble Chart (7) + Pending Transfers (5) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <motion.div variants={itemVariants} className="lg:col-span-7">
              <EnterpriseBubbleChart />
            </motion.div>
            <motion.div variants={itemVariants} className="lg:col-span-5">
              <PendingTransfersSection />
            </motion.div>
          </div>

          {/* Row: Inventory Prediction (full width) */}
          <motion.div variants={itemVariants}>
            <InventoryPredictionSection />
          </motion.div>
        </>
      )}

      {/* Score Explanation Dialog */}
      {isOwner && insightData && (
        <ScoreExplanationDialog
          open={scoreDialogOpen}
          onOpenChange={setScoreDialogOpen}
          score={insightData.healthScore}
          insights={insightData.insights}
        />
      )}

      {/* ═══════════════════════════════════════════════════
          FLOATING — AI Brain Button
          ═══════════════════════════════════════════════════ */}
      {isOwner && hasAiInsights && (
        <InsightsSection insightData={insightData ?? null} isLoading={insightLoading} onRefresh={() => refetchInsights()} />
      )}
    </motion.div>
  )
}
