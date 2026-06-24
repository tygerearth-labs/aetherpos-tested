import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import {
  parseTzOffset,
  getTodayRangeTz,
  getHourInTimezone,
  resolvePlanType,
} from '@/lib/api-helpers'
import { getOwnerOutlets } from '@/lib/multi-outlet'
import { safeJson, safeJsonError } from '@/lib/safe-response'

interface HourBucket {
  hour: number
  transactionCount: number
  revenue: number
}

interface OutletBreakdownEntry {
  outletId: string
  outletName: string
  todayRevenue: number
  todayTransactions: number
  totalRevenue: number
  totalTransactions: number
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const isOwner = user.role === 'OWNER'
    const { searchParams } = request.nextUrl
    const outletFilter = searchParams.get('outletId') || ''
    const viewMode = searchParams.get('view') || '' // 'all' for combined view

    // ── Resolve effective outlet ID(s) for multi-outlet support ──
    let effectiveOutletId = user.outletId
    let isEnterpriseMulti = false
    let ownerOutletIds: string[] | null = null
    let outletNames: Map<string, string> | null = null
    const isCombinedView = viewMode === 'all'

    if (isOwner && user.email) {
      const outletData = await db.outlet.findUnique({
        where: { id: user.outletId },
        select: { accountType: true },
      })
      const planType = resolvePlanType(outletData?.accountType)

      if (planType === 'enterprise') {
        const multiOutlet = await getOwnerOutlets(db, user.email, user.outletId)
        if (multiOutlet) {
          isEnterpriseMulti = true
          ownerOutletIds = multiOutlet.outletIds
          outletNames = new Map(multiOutlet.outlets.map((o) => [o.id, o.name]))

          if (outletFilter && multiOutlet.outletIds.includes(outletFilter)) {
            effectiveOutletId = outletFilter
          }
          // If isCombinedView, we'll use ownerOutletIds for queries below
        }
      }
    }

    // Determine query mode: combined multi-outlet vs single outlet
    const useMultiOutlet =
      isEnterpriseMulti && isCombinedView && ownerOutletIds && ownerOutletIds.length > 1
    const queryOutletFilter = useMultiOutlet
      ? { outletId: { in: ownerOutletIds } }
      : { outletId: effectiveOutletId }

    // Timezone-aware date ranges from client device
    const tzOffset = parseTzOffset(searchParams)
    const { todayStart, yesterdayStart } = tzOffset !== null
      ? getTodayRangeTz(tzOffset)
      : (() => {
          const now = new Date()
          const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          return { todayStart: ts, yesterdayStart: new Date(ts.getTime() - 86_400_000) }
        })()

    // ── Get voided transaction IDs to exclude from all calculations ──
    let voidedIdArray: string[] = []
    if (useMultiOutlet && ownerOutletIds) {
      // Multi-outlet: query voided logs across all owner outlets
      const voided = await db.auditLog.findMany({
        where: {
          entityType: 'TRANSACTION',
          action: 'VOID',
          outletId: { in: ownerOutletIds },
        },
        select: { entityId: true },
      })
      voidedIdArray = Array.from(new Set(voided.map((v) => v.entityId))).filter(
        (id): id is string => Boolean(id)
      )
    } else {
      // Single outlet: query voided logs for the effective outlet
      const voided = await db.auditLog.findMany({
        where: {
          entityType: 'TRANSACTION',
          action: 'VOID',
          outletId: effectiveOutletId,
        },
        select: { entityId: true },
      })
      voidedIdArray = Array.from(new Set(voided.map((v) => v.entityId))).filter(
        (id): id is string => Boolean(id)
      )
    }

    // Build void exclusion filter
    const voidExclude =
      voidedIdArray.length > 0 ? { id: { notIn: voidedIdArray } } : {}

    // ── All-time totals (excluding voided) ──
    const [revenueResult, totalTxCount, totalProducts] = await Promise.all([
      db.transaction.aggregate({
        where: { ...queryOutletFilter, ...voidExclude },
        _sum: { total: true },
      }),
      db.transaction.count({ where: { ...queryOutletFilter, ...voidExclude } }),
      db.product.count({ where: queryOutletFilter }),
    ])
    const totalRevenue = revenueResult._sum.total ?? 0
    const totalTransactions = totalTxCount

    // ── Low stock products (variant-aware aggregation) ──
    const lowStockProducts = await db.product.findMany({
      where: queryOutletFilter,
      select: {
        id: true,
        name: true,
        stock: true,
        lowStockAlert: true,
        hasVariants: true,
        outletId: true,
        variants: { select: { stock: true } },
      },
    })
    const lowStockList = lowStockProducts
      .map((p) => {
        const aggStock =
          p.hasVariants && p.variants.length > 0
            ? p.variants.reduce((s, v) => s + v.stock, 0)
            : p.stock
        return { ...p, stock: aggStock, aggStock }
      })
      .filter((p) => p.aggStock <= p.lowStockAlert)
      .sort((a, b) => a.aggStock - b.aggStock)

    // ── Low stock variants ──
    const lowStockVariants = await db.productVariant.findMany({
      where: queryOutletFilter,
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
      where: queryOutletFilter,
      orderBy: { totalSpend: 'desc' },
      take: 5,
    })

    // ── Today's metrics (excluding voided) ──
    // In combined view, include outletId for per-outlet breakdown grouping
    const todayTxSelect: Record<string, unknown> = {
      subtotal: true,
      discount: true,
      taxAmount: true,
      total: true,
      createdAt: true,
      outletId: true,
      items: {
        select: { price: true, hpp: true, qty: true },
      },
    }

    const todayTransactions = await db.transaction.findMany({
      where: {
        ...queryOutletFilter,
        createdAt: { gte: todayStart },
        ...voidExclude,
      },
      select: todayTxSelect,
    })

    const todayBrutto = todayTransactions.reduce((s, t) => s + t.subtotal, 0)
    const todayDiscount = todayTransactions.reduce((s, t) => s + t.discount, 0)
    const todayTax = todayTransactions.reduce(
      (s, t) => s + (t.taxAmount || 0),
      0
    )
    const todayRevenue = todayTransactions.reduce((s, t) => s + t.total, 0)
    const todayTxCount = todayTransactions.length

    // ── Yesterday's metrics (excluding voided) ──
    const yesterdayTransactions = await db.transaction.findMany({
      where: {
        ...queryOutletFilter,
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
          transaction: { ...queryOutletFilter, ...voidExclude },
        },
        select: { price: true, hpp: true, qty: true },
      })
      totalProfit = allItems.reduce(
        (s, i) => s + (i.price - i.hpp) * i.qty,
        0
      )

      // Today's profit
      todayProfit = todayTransactions.reduce((s, t) => {
        return (
          s +
          t.items.reduce(
            (itemSum, i) => itemSum + (i.price - i.hpp) * i.qty,
            0
          )
        )
      }, 0)

      // Peak hours — group today's transactions by hour
      const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        transactionCount: 0,
        revenue: 0,
      }))
      for (const t of todayTransactions) {
        const hour =
          tzOffset !== null
            ? getHourInTimezone(t.createdAt, tzOffset)
            : t.createdAt.getHours()
        buckets[hour].transactionCount += 1
        buckets[hour].revenue += t.total
      }
      peakHours = buckets

      // AI Insight placeholder
      aiInsight = 'AI insight requires Z.AI GLM 5 integration'
    }

    // ── Multi-outlet outlet breakdown (combined view only) ──
    let outletBreakdown: OutletBreakdownEntry[] | null = null

    if (useMultiOutlet && ownerOutletIds && outletNames) {
      // Per-outlet all-time totals using groupBy
      const allTimeByOutlet = await db.transaction.groupBy({
        by: ['outletId'],
        where: { outletId: { in: ownerOutletIds }, ...voidExclude },
        _sum: { total: true },
        _count: true,
      })

      // Per-outlet today totals: group the already-fetched todayTransactions in memory
      const todayByOutlet = new Map<
        string,
        { revenue: number; count: number }
      >()
      for (const t of todayTransactions) {
        const oid = t.outletId
        const existing = todayByOutlet.get(oid)
        if (existing) {
          existing.revenue += t.total
          existing.count += 1
        } else {
          todayByOutlet.set(oid, { revenue: t.total, count: 1 })
        }
      }

      outletBreakdown = ownerOutletIds.map((oid) => {
        const allTime = allTimeByOutlet.find((r) => r.outletId === oid)
        const today = todayByOutlet.get(oid)

        return {
          outletId: oid,
          outletName: outletNames.get(oid) || 'Unknown Outlet',
          todayRevenue: today?.revenue ?? 0,
          todayTransactions: today?.count ?? 0,
          totalRevenue: allTime?._sum.total ?? 0,
          totalTransactions: allTime?._count ?? 0,
        }
      })
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

      // Multi-outlet fields (only when enterprise with multiple outlets)
      ...(isEnterpriseMulti && ownerOutletIds && ownerOutletIds.length > 1
        ? {
            outletBreakdown: outletBreakdown ?? [],
            isMultiOutletView: true,
            selectedOutletId: isCombinedView ? null : effectiveOutletId,
          }
        : {}),
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return safeJsonError('Failed to load dashboard stats')
  }
}