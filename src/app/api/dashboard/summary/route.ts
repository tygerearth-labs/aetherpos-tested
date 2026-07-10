import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getVoidedTxIds, parseTzOffset, getTodayRangeTz } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

/**
 * GET /api/dashboard/summary?period=today|week|month&tzOffset=...
 *
 * Returns topSelling products and topCustomers for the given period.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const outletId = user.outletId
    const isOwner = user.role === 'OWNER'
    const { searchParams } = request.nextUrl
    const period = searchParams.get('period') || 'today' // today | week | month

    // Timezone-aware date ranges (fallback to server tz if offset not provided)
    const tzOffset = parseTzOffset(searchParams)
    const { todayStart, weekStart, monthStart } = tzOffset !== null
      ? getTodayRangeTz(tzOffset)
      : getTodayRangeTz(new Date().getTimezoneOffset())

    const startDate = period === 'month'
      ? monthStart
      : period === 'week'
        ? weekStart
        : todayStart

    // Voided transactions
    const voidedTxIds = await getVoidedTxIds(db, outletId)
    const voidedIdArray = Array.from(voidedTxIds).filter(Boolean) as string[]
    const voidExclude = voidedIdArray.length > 0 ? { id: { notIn: voidedIdArray } } : {}

    // Parallel queries
    const [topSellingAgg, periodTxAgg, customersAgg] = await Promise.all([
      // Top selling products
      db.transactionItem.groupBy({
        by: ['productName'],
        where: {
          transaction: { outletId, createdAt: { gte: startDate }, ...voidExclude },
        },
        _sum: { qty: true, subtotal: true },
        _count: true,
        orderBy: { _sum: { qty: 'desc' } },
        take: 5,
      }),

      // Period totals
      db.transaction.aggregate({
        where: { outletId, createdAt: { gte: startDate }, ...voidExclude },
        _sum: { total: true },
        _count: true,
      }),

      // Top customers (only for owners)
      isOwner
        ? db.transaction.groupBy({
            by: ['customerId'],
            where: { outletId, createdAt: { gte: startDate }, ...voidExclude, customerId: { not: null } },
            _sum: { total: true },
            _count: true,
            orderBy: { _sum: { total: 'desc' } },
            take: 5,
          }).then(async (groups) => {
            if (groups.length === 0) return []
            const ids = groups.map((g) => g.customerId).filter(Boolean) as string[]
            const customers = await db.customer.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true, points: true },
            })
            const cMap = new Map(customers.map((c) => [c.id, c]))
            return groups.map((g) => {
              const c = cMap.get(g.customerId!)
              return {
                id: g.customerId!,
                name: c?.name || 'Unknown',
                whatsapp: '',
                totalSpend: g._sum.total ?? 0,
                points: c?.points ?? 0,
                txCount: g._count,
              }
            })
          })
        : Promise.resolve([]),
    ])

    const topSelling = topSellingAgg.map((item) => ({
      name: item.productName,
      qty: item._sum.qty ?? 0,
      revenue: item._sum.subtotal ?? 0,
      txCount: item._count ?? 0,
    }))

    return safeJson(
      {
        period,
        topSelling,
        topCustomers: customersAgg,
        revenue: periodTxAgg._sum.total ?? 0,
        transactions: periodTxAgg._count,
      },
      200,
      CACHE.SHORT,
    )
  } catch (error) {
    console.error('Dashboard summary error:', error)
    return safeJsonError('Failed to load summary')
  }
}