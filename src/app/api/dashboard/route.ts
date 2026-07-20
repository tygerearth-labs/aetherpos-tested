import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parseTzOffset, getTodayRangeTz, getHourInTimezone, getVoidedTxIds } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

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

    // Timezone-aware date ranges from client device (fallback to server tz if offset not provided)
    const tzOffset = parseTzOffset(request.nextUrl.searchParams)
    const { todayStart, yesterdayStart } = tzOffset !== null
      ? getTodayRangeTz(tzOffset)
      : getTodayRangeTz(new Date().getTimezoneOffset())

    // ── Get voided transaction IDs (needed for all calculations) ──
    const voidedTxIds = await getVoidedTxIds(db, outletId)
    const voidedIdArray = Array.from(voidedTxIds).filter(Boolean) as string[]
    const voidExclude = voidedIdArray.length > 0 ? { id: { notIn: voidedIdArray } } : {}

    // ── Batch 1: All independent queries in parallel ──
    const [
      allTimeAgg,
      allTimeCount,
      totalProducts,
      lowStockProducts,
      lowStockVariants,
      topCustomers,
      todayAgg,
      yesterdayAgg,
    ] = await Promise.all([
      // All-time revenue (excluding voided) — aggregate instead of findMany
      db.transaction.aggregate({
        where: { outletId, ...voidExclude },
        _sum: { total: true },
      }),

      db.transaction.count({ where: { outletId, ...voidExclude } }),

      db.product.count({ where: { outletId } }),

      // Low stock products (variant-aware aggregation)
      db.product.findMany({
        where: { outletId },
        select: { id: true, name: true, stock: true, lowStockAlert: true, hasVariants: true, variants: { select: { stock: true } } },
      }),

      // Low stock variants (stock <= 0 only)
      db.productVariant.findMany({
        where: { outletId, stock: { lte: 0 } },
        orderBy: { stock: 'asc' },
        select: {
          id: true,
          name: true,
          stock: true,
          productId: true,
          product: { select: { name: true } },
        },
      }),

      // Top 5 customers
      db.customer.findMany({
        where: { outletId },
        orderBy: { totalSpend: 'desc' },
        take: 5,
      }),

      // Today's aggregated metrics (single aggregate call vs findMany + reduce)
      db.transaction.aggregate({
        where: { outletId, createdAt: { gte: todayStart }, ...voidExclude },
        _sum: { subtotal: true, discount: true, taxAmount: true, total: true },
        _count: true,
      }),

      // Yesterday's aggregated metrics
      db.transaction.aggregate({
        where: { outletId, createdAt: { gte: yesterdayStart, lt: todayStart }, ...voidExclude },
        _sum: { total: true },
        _count: true,
      }),
    ])

    const totalRevenue = allTimeAgg._sum.total ?? 0
    const totalTransactions = allTimeCount
    const todayRevenue = todayAgg._sum.total ?? 0
    const todayBrutto = todayAgg._sum.subtotal ?? 0
    const todayDiscount = todayAgg._sum.discount ?? 0
    const todayTax = todayAgg._sum.taxAmount ?? 0
    const todayTxCount = todayAgg._count
    const yesterdayRevenue = yesterdayAgg._sum.total ?? 0
    const yesterdayTxCount = yesterdayAgg._count

    const revenueChangePercent =
      yesterdayRevenue > 0
        ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
        : todayRevenue > 0 ? 100 : 0

    // Process low stock
    const lowStockList = lowStockProducts
      .map((p) => {
        const aggStock = p.hasVariants && p.variants.length > 0
          ? p.variants.reduce((s, v) => s + v.stock, 0)
          : p.stock
        return { ...p, stock: aggStock, aggStock }
      })
      .filter((p) => p.aggStock <= p.lowStockAlert)
      .sort((a, b) => a.aggStock - b.aggStock)

    // ── Inventory (bahan baku) data ──
    const fourteenDaysAgo = new Date(todayStart.getTime() - 14 * 86_400_000)
    const [
      inventoryItems,
      recentConsumption,
    ] = await Promise.all([
      db.inventoryItem.findMany({
        where: { outletId },
        select: { id: true, name: true, stock: true, lowStockAlert: true, avgCost: true, baseUnit: true },
      }),
      db.inventoryMovement.groupBy({
        by: ['inventoryItemId'],
        where: {
          outletId,
          type: 'CONSUMPTION',
          createdAt: { gte: fourteenDaysAgo },
        },
        _sum: { quantity: true },
      }),
    ])

    // Process inventory data
    const consumptionMap = new Map(recentConsumption.map(c => [c.inventoryItemId, c._sum.quantity ?? 0]))
    const totalInventoryValue = inventoryItems.reduce((s, i) => s + i.stock * i.avgCost, 0)

    const lowInventoryList = inventoryItems
      .filter(i => i.stock <= i.lowStockAlert)
      .map(i => {
        const consumed14d = consumptionMap.get(i.id) ?? 0
        const dailyConsumption = consumed14d / 14
        const daysUntilEmpty = dailyConsumption > 0 ? i.stock / dailyConsumption : null
        return { ...i, daysUntilEmpty, dailyConsumption }
      })
      .sort((a, b) => a.stock - b.stock)

    const inventoryAlerts = inventoryItems
      .map(i => {
        const consumed14d = consumptionMap.get(i.id) ?? 0
        const dailyConsumption = consumed14d / 14
        const daysUntilEmpty = dailyConsumption > 0 ? i.stock / dailyConsumption : null
        const status = daysUntilEmpty !== null
          ? daysUntilEmpty <= 3 ? 'critical' as const
            : daysUntilEmpty <= 7 ? 'warning' as const
            : 'ok' as const
          : 'ok' as const
        return { ...i, dailyConsumption, daysUntilEmpty, status }
      })
      .sort((a, b) => {
        const aVal = a.daysUntilEmpty ?? 9999
        const bVal = b.daysUntilEmpty ?? 9999
        return aVal - bVal
      })

    // ── OWNER-ONLY fields ──
    let totalProfit: number | null = null
    let todayProfit: number | null = null
    let peakHours: HourBucket[] | null = null
    let aiInsight: string | null = null

    if (isOwner) {
      // Batch 2: Owner-specific queries in parallel
      const [profitRows, todayTxs] = await Promise.all([
        // All-time profit via raw SQL — uses SUM(price * qty) - SUM(hpp * qty)
        // to correctly compute EXTENDED revenue and COGS (not unit-level sums).
        // Previous aggregate (_sum: { price, hpp }) summed UNIT values and
        // undercounted profit proportional to average qty per line item.
        // Voided transactions are excluded via NOT IN (Transaction has no status
        // column; voided IDs are derived from AuditLog VOID actions).
        voidedIdArray.length > 0
          ? db.$queryRaw<Array<{ revenue: bigint; cogs: bigint }>>`
              SELECT
                COALESCE(SUM(ti.price * ti.qty), 0) AS revenue,
                COALESCE(SUM(ti.hpp  * ti.qty), 0) AS cogs
              FROM "TransactionItem" ti
              JOIN "Transaction" t ON t.id = ti."transactionId"
              WHERE t."outletId" = ${outletId}
                AND t.id NOT IN (${Prisma.join(voidedIdArray)})
            `
          : db.$queryRaw<Array<{ revenue: bigint; cogs: bigint }>>`
              SELECT
                COALESCE(SUM(ti.price * ti.qty), 0) AS revenue,
                COALESCE(SUM(ti.hpp  * ti.qty), 0) AS cogs
              FROM "TransactionItem" ti
              JOIN "Transaction" t ON t.id = ti."transactionId"
              WHERE t."outletId" = ${outletId}
            `,

        // Today's transactions (needed for profit + peak hours)
        db.transaction.findMany({
          where: { outletId, createdAt: { gte: todayStart }, ...voidExclude },
          select: {
            total: true,
            createdAt: true,
            items: { select: { price: true, hpp: true, qty: true } },
          },
        }),
      ])

      // All-time profit = extended revenue - extended COGS
      const profitRow = profitRows[0]
      totalProfit = Number(profitRow?.revenue ?? 0) - Number(profitRow?.cogs ?? 0)

      // Today's profit
      todayProfit = todayTxs.reduce((s, t) => {
        return s + t.items.reduce((is, i) => is + (i.price - i.hpp) * i.qty, 0)
      }, 0)

      // Peak hours
      const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        transactionCount: 0,
        revenue: 0,
      }))
      for (const t of todayTxs) {
        const hour = tzOffset !== null
          ? getHourInTimezone(t.createdAt, tzOffset)
          : t.createdAt.getHours()
        buckets[hour].transactionCount += 1
        buckets[hour].revenue += t.total
      }
      peakHours = buckets
      aiInsight = 'AI insight requires Z.AI GLM 5 integration'
    }

    return safeJson(
      {
        totalRevenue,
        totalTransactions,
        totalProducts,
        lowStockProducts: lowStockList.length,
        lowStockList,
        lowStockVariants: lowStockVariants.length,
        lowStockVariantList: lowStockVariants.map((v) => ({
          id: v.id,
          name: v.name,
          stock: v.stock,
          productId: v.productId,
          productName: v.product?.name || 'Unknown',
        })),
        topCustomers,
        totalProfit,
        todayRevenue,
        todayBrutto,
        todayDiscount,
        todayTax,
        todayTransactions: todayTxCount,
        todayProfit,
        yesterdayRevenue,
        yesterdayTransactions: yesterdayTxCount,
        revenueChangePercent,
        peakHours,
        aiInsight,
        lowInventoryItems: lowInventoryList.length,
        lowInventoryList,
        totalInventoryValue,
        inventoryAlerts,
      },
      200,
      CACHE.SHORT // 5-second client cache
    )
  } catch (error) {
    console.error('Dashboard error:', error)
    return safeJsonError('Failed to load dashboard stats')
  }
}