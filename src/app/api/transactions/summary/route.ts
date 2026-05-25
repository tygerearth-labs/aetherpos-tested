import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { buildDateFilter, buildDateFilterTz, getVoidedTxIds, getHourInTimezone } from '@/lib/api-helpers'
import { getOutletPlan } from '@/lib/plan-config'
import { safeJson, safeJsonError } from '@/lib/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }

    const outletId = user.outletId

    // Check plan feature gate
    const planData = await getOutletPlan(outletId, db)
    if (!planData || !planData.features.transactionSummary) {
      return safeJsonError('Fitur ringkasan transaksi hanya tersedia untuk akun Pro', 403)
    }

    const { searchParams } = request.nextUrl
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''
    const dateFromMs = searchParams.get('dateFromMs') || ''
    const dateToMs = searchParams.get('dateToMs') || ''
    const tzOffset = searchParams.get('tzOffset') ? Number(searchParams.get('tzOffset')) : null
    // Security: Always use authenticated user's outlet — ignore query param to prevent IDOR
    const filterOutletId = outletId

    // Use timezone-aware filter if tzOffset is provided, else fall back to legacy
    let dateFilter: Record<string, Date>
    if (tzOffset !== null && !isNaN(tzOffset)) {
      dateFilter = buildDateFilterTz(dateFrom || null, dateTo || null, tzOffset)
    } else {
      dateFilter = buildDateFilter(dateFrom || null, dateTo || null, dateFromMs || null, dateToMs || null)
    }

    // Build base where clause
    const baseWhere: Record<string, unknown> = { outletId: filterOutletId }
    if (Object.keys(dateFilter).length > 0) {
      baseWhere.createdAt = dateFilter
    }

    // Get all voided transaction IDs for this outlet
    const voidedIdSet = await getVoidedTxIds(db, filterOutletId)

    // Build where for voided transactions
    const voidWhere: Record<string, unknown> = { ...baseWhere }
    if (voidedIdSet.size > 0) {
      voidWhere.id = { in: Array.from(voidedIdSet) as string[] }
    }

    // Fetch voided transactions for summary
    const voidedTransactions = voidedIdSet.size > 0
      ? await db.transaction.findMany({
          where: voidWhere,
          select: {
            id: true,
            total: true,
            createdAt: true,
          },
        })
      : []

    const voidCount = voidedTransactions.length
    const voidTotal = voidedTransactions.reduce((sum, t) => sum + t.total, 0)

    // Exclude voided transactions
    const activeWhere = { ...baseWhere }
    if (voidedIdSet.size > 0) {
      activeWhere.id = { notIn: Array.from(voidedIdSet) as string[] }
    }

    // Fetch all active transactions for the date range (for aggregation)
    const transactions = await db.transaction.findMany({
      where: activeWhere,
      select: {
        id: true,
        total: true,
        subtotal: true,
        discount: true,
        taxAmount: true,
        paymentMethod: true,
        createdAt: true,
        items: {
          select: {
            productId: true,
            productName: true,
            price: true,
            qty: true,
            subtotal: true,
          },
        },
      },
    })

    // Calculate summary metrics
    const totalRevenue = transactions.reduce((sum, t) => sum + t.total, 0)
    const totalBrutto = transactions.reduce((sum, t) => sum + t.subtotal, 0)
    const totalDiscount = transactions.reduce((sum, t) => sum + t.discount, 0)
    const totalTax = transactions.reduce((sum, t) => sum + (t.taxAmount || 0), 0)
    const totalTransactions = transactions.length
    const avgTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0

    // Total items sold
    const totalItemsSold = transactions.reduce((sum, t) => {
      return sum + t.items.reduce((itemSum, item) => itemSum + item.qty, 0)
    }, 0)

    // Payment method breakdown with brutto/netto per method
    const paymentMap = new Map<string, { count: number; total: number; brutto: number; discount: number }>()
    for (const t of transactions) {
      const method = t.paymentMethod
      const existing = paymentMap.get(method) || { count: 0, total: 0, brutto: 0, discount: 0 }
      existing.count += 1
      existing.total += t.total
      existing.brutto += t.subtotal
      existing.discount += t.discount
      paymentMap.set(method, existing)
    }
    const paymentBreakdown = Array.from(paymentMap.entries()).map(([method, data]) => ({
      method,
      count: data.count,
      total: data.total,
      brutto: data.brutto,
      discount: data.discount,
    }))

    // Top products by revenue
    const productRevenue = new Map<string, { name: string; quantity: number; revenue: number }>()
    for (const t of transactions) {
      for (const item of t.items) {
        const existing = productRevenue.get(item.productId) || {
          name: item.productName,
          quantity: 0,
          revenue: 0,
        }
        existing.quantity += item.qty
        existing.revenue += item.subtotal
        productRevenue.set(item.productId, existing)
      }
    }
    const topProducts = Array.from(productRevenue.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map((p, index) => ({
        rank: index + 1,
        name: p.name,
        quantity: p.quantity,
        revenue: p.revenue,
      }))

    // Hourly breakdown (transaction count per hour)
    const hourlyMap = new Map<number, number>()
    for (let h = 0; h < 24; h++) {
      hourlyMap.set(h, 0)
    }
    for (const t of transactions) {
      const hour = tzOffset !== null && !isNaN(tzOffset)
        ? getHourInTimezone(t.createdAt, tzOffset)
        : new Date(t.createdAt).getHours()
      hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1)
    }
    const hourlyBreakdown = Array.from(hourlyMap.entries()).map(([hour, count]) => ({
      hour,
      count,
    }))

    return safeJson({
      totalRevenue,
      totalBrutto,
      totalDiscount,
      totalTax,
      totalTransactions,
      avgTransaction,
      totalItemsSold,
      paymentBreakdown,
      topProducts,
      hourlyBreakdown,
      voidInfo: {
        count: voidCount,
        total: voidTotal,
      },
    })
  } catch (error) {
    console.error('Transaction summary GET error:', error)
    return safeJsonError('Failed to load transaction summary', 500)
  }
}
