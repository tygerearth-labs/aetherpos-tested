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

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const isOwner = user.role === 'OWNER'

    // Timezone-aware date ranges from client device
    const tzOffset = parseTzOffset(request.nextUrl.searchParams)
    const { todayStart, yesterdayStart } = tzOffset !== null
      ? getTodayRangeTz(tzOffset)
      : (() => {
          const now = new Date()
          const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          return { todayStart: ts, yesterdayStart: new Date(ts.getTime() - 86_400_000) }
        })()

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

    // ── Today's metrics (excluding voided) ──
    const todayTransactions = await db.transaction.findMany({
      where: {
        outletId,
        createdAt: { gte: todayStart },
        ...voidExclude,
      },
      select: {
        subtotal: true,
        discount: true,
        taxAmount: true,
        total: true,
        createdAt: true,
        items: {
          select: { price: true, hpp: true, qty: true },
        },
      },
    })

    const todayBrutto = todayTransactions.reduce((s, t) => s + t.subtotal, 0)
    const todayDiscount = todayTransactions.reduce((s, t) => s + t.discount, 0)
    const todayTax = todayTransactions.reduce((s, t) => s + (t.taxAmount || 0), 0)
    const todayRevenue = todayTransactions.reduce((s, t) => s + t.total, 0)
    const todayTxCount = todayTransactions.length

    // ── Yesterday's metrics (excluding voided) ──
    const yesterdayTransactions = await db.transaction.findMany({
      where: {
        outletId,
        createdAt: { gte: yesterdayStart, lt: todayStart },
        ...voidExclude,
      },
      select: {
        total: true,
      },
    })
    const yesterdayRevenue = yesterdayTransactions.reduce((s, t) => s + t.total, 0)
    const yesterdayTxCount = yesterdayTransactions.length

    const revenueChangePercent =
      yesterdayRevenue > 0
        ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
        : todayRevenue > 0
          ? 100
          : 0

    // ── OWNER-ONLY fields ──
    let totalProfit = 0
    let todayProfit = 0
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

      // Today's profit
      todayProfit = todayTransactions.reduce((s, t) => {
        return (
          s +
          t.items.reduce((itemSum, i) => itemSum + (i.price - i.hpp) * i.qty, 0)
        )
      }, 0)

      // Peak hours — group today's transactions by hour
      const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        transactionCount: 0,
        revenue: 0,
      }))
      for (const t of todayTransactions) {
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

      // Today
      todayRevenue,
      todayBrutto,
      todayDiscount,
      todayTax,
      todayTransactions: todayTxCount,
      todayProfit: isOwner ? todayProfit : null,

      // Yesterday comparison
      yesterdayRevenue,
      yesterdayTransactions: yesterdayTxCount,
      revenueChangePercent,

      // OWNER-ONLY Pro features
      peakHours: isOwner ? peakHours : null,
      aiInsight: isOwner ? aiInsight : null,
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return safeJsonError('Failed to load dashboard stats')
  }
}
