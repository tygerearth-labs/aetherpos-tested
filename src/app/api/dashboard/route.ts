import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getVoidedTxIds, parseTzOffset, getTodayRangeTz, getHourInTimezone } from '@/lib/api-helpers'
import { safeJson, safeJsonError } from '@/lib/safe-response'

interface HourBucket {
  hour: number
  transactionCount: number
  revenue: number
}

interface DayBucket {
  date: string
  revenue: number
  transactionCount: number
  profit: number
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const isOwner = user.role === 'OWNER'

    // Parse range parameter: 'day' | 'week' | 'month' (default: 'day')
    const range = request.nextUrl.searchParams.get('range') || 'day'

    // Timezone-aware date ranges from client device
    const tzOffset = parseTzOffset(request.nextUrl.searchParams)
    const { todayStart, yesterdayStart, weekStart, monthStart, weekAgo } = tzOffset !== null
      ? getTodayRangeTz(tzOffset)
      : (() => {
          const now = new Date()
          const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          const dow = ts.getDay()
          const mondayOffset = dow === 0 ? 6 : dow - 1
          return {
            todayStart: ts,
            yesterdayStart: new Date(ts.getTime() - 86_400_000),
            weekStart: new Date(ts.getTime() - mondayOffset * 86_400_000),
            monthStart: new Date(ts.getFullYear(), ts.getMonth(), 1),
            weekAgo: new Date(ts.getTime() - 7 * 86_400_000),
          }
        })()

    // Determine range start based on selected range
    const rangeStart = range === 'month' ? monthStart : range === 'week' ? weekStart : todayStart
    const previousRangeStart = range === 'month'
      ? new Date(monthStart.getTime() - (todayStart.getTime() - monthStart.getTime()))
      : range === 'week'
        ? weekAgo
        : yesterdayStart
    const previousRangeEnd = range === 'month'
      ? monthStart
      : range === 'week'
        ? weekStart
        : todayStart

    // Get voided transaction IDs to exclude from all calculations
    const voidedTxIds = await getVoidedTxIds(db, outletId)
    const voidedIdArray = Array.from(voidedTxIds).filter(Boolean) as string[]

    // Build void exclusion filter
    const voidExclude = voidedIdArray.length > 0 ? { id: { notIn: voidedIdArray } } : {}

    // ── All-time totals (excluding voided) ──
    const [revenueResult, totalTxCount, totalProducts] = await Promise.all([
      db.transaction.aggregate({
        where: { outletId, ...voidExclude },
        _sum: { total: true },
      }),
      db.transaction.count({ where: { outletId, ...voidExclude } }),
      db.product.count({ where: { outletId } }),
    ])
    const totalRevenue = revenueResult._sum.total ?? 0
    const totalTransactions = totalTxCount

    // ── Low stock products (variant-aware aggregation) ──
    const lowStockProducts = await db.product.findMany({
      where: { outletId },
      select: { id: true, name: true, stock: true, lowStockAlert: true, hasVariants: true, variants: { select: { stock: true } } },
    })
    const lowStockList = lowStockProducts
      .map((p) => {
        const aggStock = p.hasVariants && p.variants.length > 0
          ? p.variants.reduce((s, v) => s + v.stock, 0)
          : p.stock
        return { ...p, stock: aggStock, aggStock }
      })
      .filter((p) => p.aggStock <= p.lowStockAlert)
      .sort((a, b) => a.aggStock - b.aggStock)

    // ── Low stock variants ──
    const lowStockVariants = await db.productVariant.findMany({
      where: { outletId },
      orderBy: { stock: 'asc' },
      select: {
        id: true,
        name: true,
        stock: true,
        productId: true,
        product: { select: { name: true } },
      },
    })
    const lowStockVariantList = lowStockVariants.filter((v) => v.stock <= 0)

    // ── Top 5 customers ──
    const topCustomers = await db.customer.findMany({
      where: { outletId },
      orderBy: { totalSpend: 'desc' },
      take: 5,
    })

    // ── Range-based metrics (excluding voided) ──
    const rangeTransactions = await db.transaction.findMany({
      where: {
        outletId,
        createdAt: { gte: rangeStart },
        ...voidExclude,
      },
      select: {
        subtotal: true,
        discount: true,
        taxAmount: true,
        total: true,
        createdAt: true,
        paymentMethod: true,
        items: {
          select: { price: true, hpp: true, qty: true, productName: true },
        },
      },
    })

    const rangeBrutto = rangeTransactions.reduce((s, t) => s + t.subtotal, 0)
    const rangeDiscount = rangeTransactions.reduce((s, t) => s + t.discount, 0)
    const rangeTax = rangeTransactions.reduce((s, t) => s + (t.taxAmount || 0), 0)
    const rangeRevenue = rangeTransactions.reduce((s, t) => s + t.total, 0)
    const rangeTxCount = rangeTransactions.length

    // ── Previous range metrics for comparison ──
    const previousRangeTransactions = await db.transaction.findMany({
      where: {
        outletId,
        createdAt: { gte: previousRangeStart, lt: previousRangeEnd },
        ...voidExclude,
      },
      select: {
        total: true,
      },
    })
    const previousRangeRevenue = previousRangeTransactions.reduce((s, t) => s + t.total, 0)
    const previousRangeTxCount = previousRangeTransactions.length

    const revenueChangePercent =
      previousRangeRevenue > 0
        ? ((rangeRevenue - previousRangeRevenue) / previousRangeRevenue) * 100
        : rangeRevenue > 0
          ? 100
          : 0

    // ── Daily breakdown for chart data ──
    const dailyBreakdown: DayBucket[] = []
    const daysInRange = range === 'month'
      ? Math.ceil((todayStart.getTime() - monthStart.getTime()) / 86_400_000) + 1
      : range === 'week'
        ? Math.ceil((todayStart.getTime() - weekStart.getTime()) / 86_400_000) + 1
        : 1

    const dayMap = new Map<string, { revenue: number; transactionCount: number; profit: number }>()
    for (const t of rangeTransactions) {
      const localMs = tzOffset !== null ? t.createdAt.getTime() - tzOffset * 60000 : t.createdAt.getTime()
      const localDate = new Date(localMs)
      const dateKey = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, '0')}-${String(localDate.getUTCDate()).padStart(2, '0')}`
      const profit = t.items.reduce((s, i) => s + (i.price - i.hpp) * i.qty, 0)
      const existing = dayMap.get(dateKey) || { revenue: 0, transactionCount: 0, profit: 0 }
      existing.revenue += t.total
      existing.transactionCount += 1
      existing.profit += profit
      dayMap.set(dateKey, existing)
    }

    // Fill in all days in the range (even empty ones)
    for (let i = 0; i < daysInRange; i++) {
      const dayDate = new Date(rangeStart.getTime() + i * 86_400_000)
      const localMs = tzOffset !== null ? dayDate.getTime() - tzOffset * 60000 : dayDate.getTime()
      const localDate = new Date(localMs)
      const dateKey = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, '0')}-${String(localDate.getUTCDate()).padStart(2, '0')}`
      const data = dayMap.get(dateKey) || { revenue: 0, transactionCount: 0, profit: 0 }
      dailyBreakdown.push({ date: dateKey, ...data })
    }

    // ── Payment method breakdown ──
    const paymentBreakdown: Record<string, { count: number; revenue: number }> = {}
    for (const t of rangeTransactions) {
      const method = t.paymentMethod || 'OTHER'
      if (!paymentBreakdown[method]) paymentBreakdown[method] = { count: 0, revenue: 0 }
      paymentBreakdown[method].count += 1
      paymentBreakdown[method].revenue += t.total
    }

    // ── Top selling products for range ──
    const productSalesMap = new Map<string, { name: string; qty: number; revenue: number }>()
    for (const t of rangeTransactions) {
      for (const item of t.items) {
        const key = item.productName
        const existing = productSalesMap.get(key) || { name: key, qty: 0, revenue: 0 }
        existing.qty += item.qty
        existing.revenue += item.price * item.qty
        productSalesMap.set(key, existing)
      }
    }
    const topSellingProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    // ── OWNER-ONLY fields ──
    let totalProfit = 0
    let rangeProfit = 0
    let peakHours: HourBucket[] = []
    let aiInsight: string | null = null

    if (isOwner) {
      // All-time profit (excluding voided)
      const allItems = await db.transactionItem.findMany({
        where: {
          transaction: { outletId, ...voidExclude },
        },
        select: { price: true, hpp: true, qty: true },
      })
      totalProfit = allItems.reduce((s, i) => s + (i.price - i.hpp) * i.qty, 0)

      // Range profit
      rangeProfit = rangeTransactions.reduce((s, t) => {
        return (
          s +
          t.items.reduce((itemSum, i) => itemSum + (i.price - i.hpp) * i.qty, 0)
        )
      }, 0)

      // Peak hours — group range transactions by hour
      const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        transactionCount: 0,
        revenue: 0,
      }))
      for (const t of rangeTransactions) {
        const hour = tzOffset !== null
          ? getHourInTimezone(t.createdAt, tzOffset)
          : t.createdAt.getHours()
        buckets[hour].transactionCount += 1
        buckets[hour].revenue += t.total
      }
      peakHours = buckets

      // AI Insight placeholder
      aiInsight = 'AI insight requires Z.AI GLM 5 integration'
    }

    // ── Today's metrics (always available for quick view) ──
    const todayTransactions = await db.transaction.findMany({
      where: {
        outletId,
        createdAt: { gte: todayStart },
        ...voidExclude,
      },
      select: {
        total: true,
        items: { select: { price: true, hpp: true, qty: true } },
      },
    })
    const todayRevenue = todayTransactions.reduce((s, t) => s + t.total, 0)
    const todayTxCount = todayTransactions.length

    const yesterdayTransactions = await db.transaction.findMany({
      where: {
        outletId,
        createdAt: { gte: yesterdayStart, lt: todayStart },
        ...voidExclude,
      },
      select: { total: true },
    })
    const yesterdayRevenue = yesterdayTransactions.reduce((s, t) => s + t.total, 0)
    const yesterdayTxCount = yesterdayTransactions.length

    return safeJson({
      // All-time
      totalRevenue,
      totalTransactions,
      totalProducts,
      lowStockProducts: lowStockList.length,
      lowStockList,
      lowStockVariants: lowStockVariantList.length,
      lowStockVariantList: lowStockVariantList.map((v) => ({
        id: v.id,
        name: v.name,
        stock: v.stock,
        productId: v.productId,
        productName: v.product?.name || 'Unknown',
      })),
      topCustomers,
      totalProfit: isOwner ? totalProfit : null,

      // Range-based metrics
      range,
      rangeRevenue,
      rangeBrutto,
      rangeDiscount,
      rangeTax,
      rangeTransactions: rangeTxCount,
      rangeProfit: isOwner ? rangeProfit : null,
      previousRangeRevenue,
      previousRangeTransactions: previousRangeTxCount,
      revenueChangePercent,

      // Today (always available)
      todayRevenue,
      todayTransactions: todayTxCount,
      yesterdayRevenue,
      yesterdayTransactions: yesterdayTxCount,

      // Chart data
      dailyBreakdown,
      paymentBreakdown,
      topSellingProducts,

      // OWNER-ONLY Pro features
      peakHours: isOwner ? peakHours : null,
      aiInsight: isOwner ? aiInsight : null,
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return safeJsonError('Failed to load dashboard stats')
  }
}
