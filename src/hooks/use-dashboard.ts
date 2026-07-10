'use client'

import { useQuery } from '@tanstack/react-query'
import { useTimezone } from '@/hooks/use-timezone'

// ── Types (extracted from dashboard-page) ──
export interface HourBucket {
  hour: number
  transactionCount: number
  revenue: number
}

export interface DashboardStats {
  totalRevenue: number
  totalTransactions: number
  totalProducts: number
  lowStockProducts: number
  totalProfit: number | null
  topCustomers: { id: string; name: string; whatsapp: string; totalSpend: number; points: number }[]
  lowStockList: { id: string; name: string; stock: number; lowStockAlert: number; aggStock: number }[]
  lowStockVariants: number
  lowStockVariantList: { id: string; name: string; stock: number; productId: string; productName: string }[]
  todayRevenue: number
  todayBrutto: number
  todayDiscount: number
  todayTax: number
  todayTransactions: number
  todayProfit: number | null
  yesterdayRevenue: number
  yesterdayTransactions: number
  revenueChangePercent: number
  peakHours: HourBucket[] | null
  aiInsight: string | null
  lowInventoryItems: number
  lowInventoryList: { id: string; name: string; stock: number; lowStockAlert: number; avgCost: number; baseUnit: string; daysUntilEmpty: number | null; dailyConsumption: number }[]
  totalInventoryValue: number
  inventoryAlerts: { id: string; name: string; stock: number; avgCost: number; baseUnit: string; dailyConsumption: number; daysUntilEmpty: number | null; status: 'critical' | 'warning' | 'ok' }[]
}

export interface InsightItem {
  id: string
  title: string
  why: string
  actions: string[]
  priority: 'critical' | 'high' | 'medium' | 'low'
  score: number
  cta: { label: string; page: string }[]
  emoji: string
}

export interface InsightEngineData {
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
    lowInventoryCount: number
    outOfInventoryCount: number
    inventoryAlerts: { name: string; stock: number; dailyConsumption: number; daysUntilEmpty: number | null; avgCost: number; baseUnit: string }[]
    totalInventoryValue: number
    pendingTransfers: number
    pendingPurchaseItems: number
    pendingPurchases: number
    pendingPurchaseValue: number
    topVariantSelling: { productName: string; variantName: string; qty: number; revenue: number }[]
  }
  generatedAt: string
}

export interface ForecastData {
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

// ── Dashboard Stats Hook ──
export function useDashboard() {
  const { tzOffset } = useTimezone()

  return useQuery<DashboardStats>({
    queryKey: ['dashboard', tzOffset],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard?tzOffset=${tzOffset}`)
      if (!res.ok) throw new Error('Failed to load dashboard')
      return res.json()
    },
    refetchInterval: 30_000, // 30-second auto-refresh
    staleTime: 15_000, // Consider data fresh for 15s
  })
}

// ── Insights Engine Hook ──
export function useInsights(enabled: boolean) {
  const { tzOffset } = useTimezone()

  return useQuery<InsightEngineData>({
    queryKey: ['insights', tzOffset],
    queryFn: async () => {
      const res = await fetch(`/api/insights/engine?tzOffset=${tzOffset}`)
      if (!res.ok) throw new Error('Failed to load insights')
      return res.json()
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

// ── Forecast Hook ──
export function useForecast(enabled: boolean) {
  const { tzOffset } = useTimezone()

  return useQuery<ForecastData>({
    queryKey: ['forecast', tzOffset],
    queryFn: async () => {
      const res = await fetch(`/api/insights/forecast?tzOffset=${tzOffset}`)
      if (!res.ok) throw new Error('Failed to load forecast')
      return res.json()
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

// ── Sales Summary (filtered by period) ──
export interface SalesSummaryData {
  period: string
  topSelling: { name: string; qty: number; revenue: number; txCount: number }[]
  topCustomers: { id: string; name: string; whatsapp: string; totalSpend: number; points: number; txCount: number }[]
  revenue: number
  transactions: number
}

export function useSalesSummary(period: 'today' | 'week' | 'month', enabled: boolean) {
  const { tzOffset } = useTimezone()

  return useQuery<SalesSummaryData>({
    queryKey: ['sales-summary', period, tzOffset],
    queryFn: async () => {
      const params = new URLSearchParams({ period })
      if (tzOffset !== null) params.set('tzOffset', String(tzOffset))
      const res = await fetch(`/api/dashboard/summary?${params}`)
      if (!res.ok) throw new Error('Failed to load summary')
      return res.json()
    },
    enabled,
    staleTime: 30_000,
  })
}