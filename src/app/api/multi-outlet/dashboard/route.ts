import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { buildDateFilterTz, parseTzOffset, getTodayRangeTz } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

/**
 * GET /api/multi-outlet/dashboard — Multi-outlet terminal dashboard
 *
 * Aggregated data for ALL outlets in the group.
 * Only accessible if the current outlet has a group.
 *
 * Query params:
 * - dateFrom, dateTo: date range (default today)
 * - tzOffset: timezone offset in minutes
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl

    // Check current outlet has a group
    const currentOutlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { id: true, groupId: true },
    })

    if (!currentOutlet?.groupId) {
      return safeJsonError('Outlet belum tergabung dalam grup', 400)
    }

    // Fetch all outlets in the group
    const group = await db.outletGroup.findUnique({
      where: { id: currentOutlet.groupId },
      include: {
        outlets: {
          select: { id: true, name: true, isMain: true, accountType: true },
          orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
        },
      },
    })

    if (!group) {
      return safeJsonError('Grup outlet tidak ditemukan', 404)
    }

    // Build date filter (default: today)
    const tzOffset = parseTzOffset(searchParams)
    const period = searchParams.get('period') || 'today'
    const dateFromParam = searchParams.get('dateFrom') || ''
    const dateToParam = searchParams.get('dateTo') || ''

    // Resolve period to date range
    const now = new Date()
    let dateFilter: Record<string, Date>

    if (dateFromParam || dateToParam) {
      // Explicit date range takes priority
      dateFilter = tzOffset !== null
        ? buildDateFilterTz(dateFromParam || null, dateToParam || null, tzOffset)
        : (() => {
            const filter: Record<string, Date> = {}
            if (dateFromParam) {
              const d = new Date(dateFromParam)
              if (!isNaN(d.getTime())) { d.setHours(0, 0, 0, 0); filter.gte = d }
            }
            if (dateToParam) {
              const d = new Date(dateToParam)
              if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); filter.lte = d }
            }
            return filter
          })()
    } else if (period === '7d') {
      const start = new Date(now)
      start.setDate(start.getDate() - 7)
      start.setHours(0, 0, 0, 0)
      dateFilter = { gte: start, lte: now }
    } else if (period === '30d') {
      const start = new Date(now)
      start.setDate(start.getDate() - 30)
      start.setHours(0, 0, 0, 0)
      dateFilter = { gte: start, lte: now }
    } else if (tzOffset !== null) {
      const { todayStart } = getTodayRangeTz(tzOffset)
      const tomorrowStart = new Date(todayStart.getTime() + 86_400_000)
      dateFilter = { gte: todayStart, lt: tomorrowStart }
    } else {
      // Default: today in server local time
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const tomorrowStart = new Date(todayStart.getTime() + 86_400_000)
      dateFilter = { gte: todayStart, lt: tomorrowStart }
    }

    // For each outlet, fetch: revenue, transaction count, total products, total stock
    const outletIds = group.outlets.map((o) => o.id)

    // Parallel queries per outlet
    const outletData = await Promise.all(
      group.outlets.map(async (outlet) => {
        const [revenueAgg, txCount, productStats, stockAgg] = await Promise.all([
          // Sum of transaction totals in date range
          db.transaction.aggregate({
            where: {
              outletId: outlet.id,
              createdAt: dateFilter,
            },
            _sum: { total: true },
          }),

          // Transaction count in date range
          db.transaction.count({
            where: {
              outletId: outlet.id,
              createdAt: dateFilter,
            },
          }),

          // Total products in outlet
          db.product.count({
            where: { outletId: outlet.id },
          }),

          // Sum of stock across all products (variant-aware not needed for simple total)
          db.product.aggregate({
            where: { outletId: outlet.id },
            _sum: { stock: true },
          }),
        ])

        return {
          id: outlet.id,
          name: outlet.name,
          isMain: outlet.isMain,
          accountType: outlet.accountType,
          totalRevenue: revenueAgg._sum.total ?? 0,
          totalTransactions: txCount,
          totalProducts: productStats,
          totalStock: stockAgg._sum.stock ?? 0,
        }
      }),
    )

    // Group totals
    const groupTotals = outletData.reduce(
      (acc, o) => ({
        totalRevenue: acc.totalRevenue + o.totalRevenue,
        totalTransactions: acc.totalTransactions + o.totalTransactions,
        totalProducts: acc.totalProducts + o.totalProducts,
        totalStock: acc.totalStock + o.totalStock,
      }),
      {
        totalRevenue: 0,
        totalTransactions: 0,
        totalProducts: 0,
        totalStock: 0,
      },
    )

    return safeJson(
      {
        groupId: group.id,
        groupName: group.name,
        dateFilter: Object.keys(dateFilter).length > 0 ? dateFilter : 'today',
        outlets: outletData,
        totals: groupTotals,
      },
      200,
      CACHE.SHORT,
    )
  } catch (error) {
    console.error('[/api/multi-outlet/dashboard] GET error:', error)
    return safeJsonError('Failed to load multi-outlet dashboard')
  }
}