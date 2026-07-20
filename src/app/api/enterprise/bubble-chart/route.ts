import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'
import { getVoidedTxIds } from '@/lib/api/api-helpers'

/**
 * GET /api/enterprise/bubble-chart
 *
 * Enterprise-only endpoint.
 * Returns revenue data per outlet for bubble chart visualization.
 * Query params:
 * - month: 1-12 (defaults to current month)
 * - year: e.g. 2025 (defaults to current year)
 * - tzOffset: timezone offset in minutes
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Owner only', 403)

    // Check if enterprise plan
    const outlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { accountType: true, groupId: true },
    })

    if (!outlet) return safeJsonError('Outlet not found', 404)

    const rawPlan = outlet.accountType.startsWith('suspended:')
      ? outlet.accountType.replace('suspended:', '')
      : outlet.accountType

    if (rawPlan !== 'enterprise') {
      return safeJsonError('Enterprise plan required', 403)
    }

    if (!outlet.groupId) {
      return safeJsonError('Outlet tidak tergabung dalam grup', 400)
    }

    // Parse filters
    const { searchParams } = request.nextUrl
    const now = new Date()
    const month = Math.max(1, Math.min(12, Number(searchParams.get('month')) || now.getMonth() + 1))
    const year = Number(searchParams.get('year')) || now.getFullYear()

    // Build date range for the selected month
    const monthStart = new Date(year, month - 1, 1)
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999)

    // Fetch all outlets in the group
    const group = await db.outletGroup.findUnique({
      where: { id: outlet.groupId },
      include: {
        outlets: {
          select: { id: true, name: true, isMain: true },
          orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
        },
      },
    })

    if (!group) return safeJsonError('Grup outlet tidak ditemukan', 404)

    const outletIds = group.outlets.map((o) => o.id)

    // Pre-fetch voided TX IDs per outlet
    const voidedLogs = await db.auditLog.findMany({
      where: {
        entityType: 'TRANSACTION',
        action: 'VOID',
        outletId: { in: outletIds },
      },
      select: { entityId: true, outletId: true },
    })
    const voidedByOutlet = new Map<string, Set<string>>()
    for (const log of voidedLogs) {
      if (!log.entityId || !log.outletId) continue
      if (!voidedByOutlet.has(log.outletId)) voidedByOutlet.set(log.outletId, new Set())
      voidedByOutlet.get(log.outletId)!.add(log.entityId)
    }

    // Fetch revenue data per outlet for the selected month
    const outletData = await Promise.all(
      group.outlets.map(async (outletInfo) => {
        const voidedSet = voidedByOutlet.get(outletInfo.id)
        const voidedArr = voidedSet ? Array.from(voidedSet).filter(Boolean) as string[] : []
        const voidExclude = voidedArr.length > 0 ? { id: { notIn: voidedArr } } : {}

        const [revenueAgg, txCount, profitRows] = await Promise.all([
          // Revenue sum
          db.transaction.aggregate({
            where: {
              outletId: outletInfo.id,
              createdAt: { gte: monthStart, lte: monthEnd },
              ...voidExclude,
            },
            _sum: { total: true, subtotal: true, discount: true, taxAmount: true },
          }),

          // Transaction count
          db.transaction.count({
            where: {
              outletId: outletInfo.id,
              createdAt: { gte: monthStart, lte: monthEnd },
              ...voidExclude,
            },
          }),

          // Profit data via raw SQL — uses SUM(price * qty) - SUM(hpp * qty)
          // to correctly compute EXTENDED revenue and COGS (not unit-level sums).
          // Previous aggregate (_sum: { price, hpp }) summed UNIT values and
          // undercounted profit proportional to average qty per line item.
          voidedArr.length > 0
            ? db.$queryRaw<Array<{ revenue: bigint; cogs: bigint }>>`
                SELECT
                  COALESCE(SUM(ti.price * ti.qty), 0) AS revenue,
                  COALESCE(SUM(ti.hpp  * ti.qty), 0) AS cogs
                FROM "TransactionItem" ti
                JOIN "Transaction" t ON t.id = ti."transactionId"
                WHERE t."outletId" = ${outletInfo.id}
                  AND t."createdAt" >= ${monthStart}
                  AND t."createdAt" <= ${monthEnd}
                  AND t.id NOT IN (${Prisma.join(voidedArr)})
              `
            : db.$queryRaw<Array<{ revenue: bigint; cogs: bigint }>>`
                SELECT
                  COALESCE(SUM(ti.price * ti.qty), 0) AS revenue,
                  COALESCE(SUM(ti.hpp  * ti.qty), 0) AS cogs
                FROM "TransactionItem" ti
                JOIN "Transaction" t ON t.id = ti."transactionId"
                WHERE t."outletId" = ${outletInfo.id}
                  AND t."createdAt" >= ${monthStart}
                  AND t."createdAt" <= ${monthEnd}
              `,
        ])

        const revenue = revenueAgg._sum.total ?? 0
        const aov = txCount > 0 ? revenue / txCount : 0
        // All-time profit = extended revenue - extended COGS
        const profitRow = profitRows[0]
        const profit = Number(profitRow?.revenue ?? 0) - Number(profitRow?.cogs ?? 0)
        const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0

        return {
          id: outletInfo.id,
          name: outletInfo.name,
          isMain: outletInfo.isMain,
          revenue,
          transactions: txCount,
          aov: Math.round(aov),
          profit: Math.round(profit),
          profitMargin: Math.round(profitMargin * 10) / 10,
        }
      })
    )

    // Available months/years for filter dropdown
    const earliestTx = await db.transaction.findFirst({
      where: { outletId: { in: outletIds } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })

    const availableMonths: { year: number; month: number; label: string }[] = []
    if (earliestTx) {
      const start = new Date(earliestTx.createdAt)
      start.setDate(1)
      const end = new Date(now.getFullYear(), now.getMonth(), 1)
      const current = new Date(start)
      while (current <= end) {
        availableMonths.push({
          year: current.getFullYear(),
          month: current.getMonth() + 1,
          label: new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(current),
        })
        current.setMonth(current.getMonth() + 1)
      }
    } else {
      // No transactions yet — just add current month
      availableMonths.push({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        label: new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1)),
      })
    }
    availableMonths.reverse()

    return safeJson(
      {
        month,
        year,
        outlets: outletData,
        availableMonths,
        totalRevenue: outletData.reduce((s, o) => s + o.revenue, 0),
        totalTransactions: outletData.reduce((s, o) => s + o.transactions, 0),
      },
      200,
      CACHE.MEDIUM,
    )
  } catch (error) {
    console.error('[/api/enterprise/bubble-chart] error:', error)
    return safeJsonError('Failed to load bubble chart data')
  }
}