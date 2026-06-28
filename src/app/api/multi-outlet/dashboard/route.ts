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
 * - period: today, 7days, 30days
 * - dateFrom, dateTo: explicit date range (overrides period)
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
      // Return empty dashboard instead of 400 — frontend guards already, but this
      // prevents console noise if there's a race condition or stale session.
      return safeJson({
        groupId: null,
        groupName: null,
        dateFilter: 'today',
        outlets: [],
        totals: {
          totalRevenue: 0, totalTransactions: 0, totalProducts: 0,
          totalStock: 0, totalCustomers: 0, totalBrutto: 0,
          totalDiscount: 0, totalTax: 0,
        },
      })
    }

    // Fetch all outlets in the group with manager info
    const group = await db.outletGroup.findUnique({
      where: { id: currentOutlet.groupId },
      include: {
        outlets: {
          select: { id: true, name: true, isMain: true, accountType: true, address: true, phone: true },
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
    } else if (period === '7days' || period === '7d') {
      const start = new Date(now)
      start.setDate(start.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      dateFilter = { gte: start, lte: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) }
    } else if (period === '30days' || period === '30d') {
      const start = new Date(now)
      start.setDate(start.getDate() - 29)
      start.setHours(0, 0, 0, 0)
      dateFilter = { gte: start, lte: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) }
    } else if (tzOffset !== null) {
      const { todayStart } = getTodayRangeTz(tzOffset)
      const tomorrowStart = new Date(todayStart.getTime() + 86_400_000)
      dateFilter = { gte: todayStart, lt: tomorrowStart }
    } else {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const tomorrowStart = new Date(todayStart.getTime() + 86_400_000)
      dateFilter = { gte: todayStart, lt: tomorrowStart }
    }

    const outletIds = group.outlets.map((o) => o.id)

    // Pre-fetch voided TX IDs per outlet for exclusion
    const voidedLogs = await db.auditLog.findMany({
      where: {
        entityType: 'TRANSACTION',
        action: 'VOID',
        outletId: { in: outletIds },
      },
      select: { entityId: true, outletId: true },
    })

    // Build per-outlet voided TX set
    const voidedByOutlet = new Map<string, Set<string>>()
    for (const log of voidedLogs) {
      if (!log.entityId || !log.outletId) continue
      if (!voidedByOutlet.has(log.outletId)) voidedByOutlet.set(log.outletId, new Set())
      voidedByOutlet.get(log.outletId)!.add(log.entityId)
    }

    // Fetch manager name per outlet
    const managers = await db.user.findMany({
      where: { outletId: { in: outletIds }, role: 'OWNER' },
      select: { name: true, outletId: true },
    })
    const managerMap = new Map<string, string>()
    for (const m of managers) managerMap.set(m.outletId, m.name)

    // Parallel queries per outlet
    const outletData = await Promise.all(
      group.outlets.map(async (outlet) => {
        const voidedSet = voidedByOutlet.get(outlet.id)
        const voidedArr = voidedSet ? Array.from(voidedSet).filter(Boolean) as string[] : []
        const voidExclude = voidedArr.length > 0 ? { id: { notIn: voidedArr } } : {}

        const [revenueAgg, txCount, productStats, stockAgg, customerCount, yesterdayRevenue] = await Promise.all([
          // Revenue in date range (excl. voids)
          db.transaction.aggregate({
            where: { outletId: outlet.id, createdAt: dateFilter, ...voidExclude },
            _sum: { total: true, subtotal: true, discount: true, taxAmount: true },
          }),

          // Transaction count in date range (excl. voids)
          db.transaction.count({
            where: { outletId: outlet.id, createdAt: dateFilter, ...voidExclude },
          }),

          // Total products in outlet
          db.product.count({ where: { outletId: outlet.id } }),

          // Sum of stock across all products
          db.product.aggregate({
            where: { outletId: outlet.id },
            _sum: { stock: true },
          }),

          // Total customers in outlet
          db.customer.count({ where: { outletId: outlet.id } }),

          // Yesterday revenue for comparison (excl. voids)
          (() => {
            const yStart = new Date(dateFilter.gte!.getTime() - 86_400_000)
            const yEnd = new Date(dateFilter.gte!.getTime())
            return db.transaction.aggregate({
              where: { outletId: outlet.id, createdAt: { gte: yStart, lt: yEnd }, ...voidExclude },
              _sum: { total: true },
            })
          })(),
        ])

        const todayRevenue = revenueAgg._sum.total ?? 0
        const yestRevenue = yesterdayRevenue._sum.total ?? 0
        const changePercent = yestRevenue > 0 ? ((todayRevenue - yestRevenue) / yestRevenue) * 100 : todayRevenue > 0 ? 100 : 0

        return {
          id: outlet.id,
          name: outlet.name,
          isMain: outlet.isMain,
          accountType: outlet.accountType,
          address: outlet.address,
          phone: outlet.phone,
          managerName: managerMap.get(outlet.id) || '-',
          // Revenue & transactions in date range
          revenue: todayRevenue,
          brutto: revenueAgg._sum.subtotal ?? 0,
          discount: revenueAgg._sum.discount ?? 0,
          tax: revenueAgg._sum.taxAmount ?? 0,
          transactions: txCount,
          // Comparison
          yesterdayRevenue: yestRevenue,
          revenueChangePercent: Math.round(changePercent * 10) / 10,
          // Inventory
          totalProducts: productStats,
          totalStock: stockAgg._sum.stock ?? 0,
          // Customer
          totalCustomers: customerCount,
        }
      }),
    )

    // Group totals
    const groupTotals = outletData.reduce(
      (acc, o) => ({
        totalRevenue: acc.totalRevenue + o.revenue,
        totalTransactions: acc.totalTransactions + o.transactions,
        totalProducts: acc.totalProducts + o.totalProducts,
        totalStock: acc.totalStock + o.totalStock,
        totalCustomers: acc.totalCustomers + o.totalCustomers,
        totalBrutto: acc.totalBrutto + o.brutto,
        totalDiscount: acc.totalDiscount + o.discount,
        totalTax: acc.totalTax + o.tax,
      }),
      {
        totalRevenue: 0,
        totalTransactions: 0,
        totalProducts: 0,
        totalStock: 0,
        totalCustomers: 0,
        totalBrutto: 0,
        totalDiscount: 0,
        totalTax: 0,
      },
    )

    return safeJson(
      {
        groupId: group.id,
        groupName: group.name,
        dateFilter: period,
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
