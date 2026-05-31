import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import {
  getVoidedTxIds,
  parseTzOffset,
  getTodayRangeTz,
} from '@/lib/api-helpers'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * GET /api/insights/forecast
 *
 * Forecasting & Prediction engine — PRO & Enterprise only.
 * Returns:
 * - 14-day revenue trend (daily totals)
 * - Projected revenue for next 7 days (linear regression)
 * - Stock depletion predictions (days until out of stock)
 * - Sales velocity per top product
 * - Day-of-week performance heatmap
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Owner only', 403)

    const tzOffset = parseTzOffset(request.nextUrl.searchParams)
    const { todayStart } = tzOffset !== null
      ? getTodayRangeTz(tzOffset)
      : (() => {
          const now = new Date()
          return { todayStart: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }
        })()

    const outletId = user.outletId

    // Void exclusion
    const voidedTxIds = await getVoidedTxIds(db, outletId)
    const voidedIdArray = Array.from(voidedTxIds).filter(Boolean) as string[]
    const voidExclude = voidedIdArray.length > 0 ? { id: { notIn: voidedIdArray } } : {}

    // ── 14-day revenue trend ──
    const fourteenDaysAgo = new Date(todayStart.getTime() - 14 * 86_400_000)
    const recentTxs = await db.transaction.findMany({
      where: {
        outletId,
        createdAt: { gte: fourteenDaysAgo },
        ...voidExclude,
      },
      select: { createdAt: true, total: true, id: true },
      orderBy: { createdAt: 'asc' },
    })

    // Group by day
    const dailyMap = new Map<string, { date: string; revenue: number; txCount: number }>()
    for (let i = 0; i < 14; i++) {
      const d = new Date(todayStart.getTime() - (13 - i) * 86_400_000)
      const key = d.toISOString().slice(0, 10)
      dailyMap.set(key, { date: key, revenue: 0, txCount: 0 })
    }

    for (const tx of recentTxs) {
      const key = tx.createdAt.toISOString().slice(0, 10)
      const bucket = dailyMap.get(key)
      if (bucket) {
        bucket.revenue += tx.total
        bucket.txCount++
      }
    }

    const trendData = Array.from(dailyMap.values())

    // ── Linear regression for 7-day forecast ──
    const n = trendData.length
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
    for (let i = 0; i < n; i++) {
      sumX += i
      sumY += trendData[i].revenue
      sumXY += i * trendData[i].revenue
      sumXX += i * i
    }
    const denom = n * sumXX - sumX * sumX
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0
    const intercept = denom !== 0 ? (sumY - slope * sumX) / n : sumY / n

    const forecast: { date: string; predictedRevenue: number; isForecast: boolean }[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(todayStart.getTime() + i * 86_400_000)
      const key = d.toISOString().slice(0, 10)
      const predicted = Math.max(0, Math.round(intercept + slope * (n + i)))
      forecast.push({ date: key, predictedRevenue: predicted, isForecast: true })
    }

    // Trend direction
    const trendDirection: 'up' | 'down' | 'stable' = slope > 0
      ? slope > trendData.reduce((s, d) => s + d.revenue, 0) / n * 0.05
        ? 'up' : 'stable'
      : slope < -(trendData.reduce((s, d) => s + d.revenue, 0) / n * 0.05)
        ? 'down' : 'stable'

    // ── Stock depletion prediction ──
    const allProductsRaw = await db.product.findMany({
      where: { outletId },
      select: { id: true, name: true, stock: true, lowStockAlert: true, hasVariants: true, variants: { select: { price: true, stock: true } } },
    })

    const getAggStock = (p: typeof allProductsRaw[number]) =>
      p.hasVariants && p.variants?.length > 0 ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock

    const allProducts = allProductsRaw.filter(p => getAggStock(p) > 0)

    // Get sales velocity per product (items sold in last 14 days)
    const salesByProduct = await db.transactionItem.groupBy({
      by: ['productName'],
      where: {
        transaction: { outletId, createdAt: { gte: fourteenDaysAgo }, ...voidExclude },
      },
      _sum: { qty: true },
    })

    const salesMap = new Map(salesByProduct.map((s) => [s.productName, s._sum.qty ?? 0]))

    const stockPredictions = allProducts
      .map((p) => {
        const aggStock = getAggStock(p)
        const sold14 = salesMap.get(p.name) ?? 0
        const dailyVelocity = sold14 / 14
        const daysUntilEmpty = dailyVelocity > 0 ? Math.floor(aggStock / dailyVelocity) : Infinity
        const daysUntilLow = dailyVelocity > 0
          ? Math.max(0, Math.floor((aggStock - p.lowStockAlert) / dailyVelocity))
          : Infinity
        return {
          name: p.name,
          stock: aggStock,
          lowStockAlert: p.lowStockAlert,
          sold14Days: sold14,
          dailyVelocity: Math.round(dailyVelocity * 100) / 100,
          daysUntilEmpty,
          daysUntilLow,
          status: aggStock <= p.lowStockAlert
            ? 'critical' as const
            : daysUntilEmpty <= 3
              ? 'warning' as const
              : 'ok' as const,
        }
      })
      .filter((p) => p.dailyVelocity > 0)
      .sort((a, b) => a.daysUntilEmpty - b.daysUntilEmpty)
      .slice(0, 10)

    // ── Day-of-week performance ──
    const thirtyDaysAgo = new Date(todayStart.getTime() - 30 * 86_400_000)
    const monthTxs = await db.transaction.findMany({
      where: {
        outletId,
        createdAt: { gte: thirtyDaysAgo },
        ...voidExclude,
      },
      select: { createdAt: true, total: true },
    })

    const dayOfWeekMap: Record<number, { totalRevenue: number; txCount: number; days: Set<string> }> = {}
    for (let d = 0; d < 7; d++) {
      dayOfWeekMap[d] = { totalRevenue: 0, txCount: 0, days: new Set() }
    }

    for (const tx of monthTxs) {
      const dow = tx.createdAt.getDay()
      const dayKey = tx.createdAt.toISOString().slice(0, 10)
      dayOfWeekMap[dow].totalRevenue += tx.total
      dayOfWeekMap[dow].txCount++
      dayOfWeekMap[dow].days.add(dayKey)
    }

    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
    const dayPerformance = Object.entries(dayOfWeekMap).map(([dow, data]) => {
      const days = data.days.size || 1
      return {
        day: dayNames[Number(dow)],
        dayOfWeek: Number(dow),
        avgRevenue: Math.round(data.totalRevenue / days),
        totalTx: data.txCount,
        avgTx: Math.round(data.txCount / days),
      }
    })

    // ── Summary metrics ──
    const weekRevenue = trendData.slice(-7).reduce((s, d) => s + d.revenue, 0)
    const prevWeekRevenue = trendData.slice(0, 7).reduce((s, d) => s + d.revenue, 0)
    const weekOverWeek = prevWeekRevenue > 0
      ? ((weekRevenue - prevWeekRevenue) / prevWeekRevenue) * 100
      : 0

    const avgDailyRevenue = trendData.reduce((s, d) => s + d.revenue, 0) / 14
    const projectedMonthly = avgDailyRevenue * 30
    const projectedWeekly = avgDailyRevenue * 7

    const criticalStock = stockPredictions.filter((p) => p.status === 'critical').length
    const warningStock = stockPredictions.filter((p) => p.status === 'warning').length

    return safeJson({
      trend: trendData,
      forecast,
      trendDirection,
      stockPredictions,
      dayPerformance,
      summary: {
        weekOverWeek: Math.round(weekOverWeek * 10) / 10,
        avgDailyRevenue: Math.round(avgDailyRevenue),
        projectedMonthly: Math.round(projectedMonthly),
        projectedWeekly: Math.round(projectedWeekly),
        criticalStock,
        warningStock,
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[insights/forecast] Error:', error)
    return safeJsonError('Failed to generate forecast')
  }
}
