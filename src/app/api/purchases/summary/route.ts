import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getTodayRangeTz } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

// GET /api/purchases/summary — purchase ratio vs revenue summary
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    // Total purchase amount (all time)
    const purchaseAgg = await db.purchaseOrder.aggregate({
      where: { outletId },
      _sum: { totalCost: true },
      _count: true,
    })
    const totalPurchaseNominal = purchaseAgg._sum.totalCost || 0
    const totalPurchaseCount = purchaseAgg._count

    // Total inventory value (stock × avgCost)
    const inventoryItems = await db.inventoryItem.findMany({
      where: { outletId },
      select: { stock: true, avgCost: true },
    })
    const totalInventoryNominal = inventoryItems.reduce((sum, i) => sum + (i.stock * i.avgCost), 0)
    const totalInventoryItems = inventoryItems.length

    // Total sales revenue (all completed/voided transactions for reference)
    const salesAgg = await db.transaction.aggregate({
      where: { outletId },
      _sum: { total: true },
      _count: true,
    })
    const totalRevenue = salesAgg._sum.total || 0
    const totalTxCount = salesAgg._count

    // This month's purchase (timezone-aware)
    const { monthStart } = getTodayRangeTz(new Date().getTimezoneOffset())
    const monthPurchaseAgg = await db.purchaseOrder.aggregate({
      where: { outletId, createdAt: { gte: monthStart } },
      _sum: { totalCost: true },
      _count: true,
    })
    const monthPurchaseNominal = monthPurchaseAgg._sum.totalCost || 0
    const monthPurchaseCount = monthPurchaseAgg._count

    // This month's revenue
    const monthSalesAgg = await db.transaction.aggregate({
      where: { outletId, createdAt: { gte: monthStart } },
      _sum: { total: true },
      _count: true,
    })
    const monthRevenue = monthSalesAgg._sum.total || 0
    const monthTxCount = monthSalesAgg._count

    // Calculate ratios
    const overallRatio = totalRevenue > 0 ? ((totalPurchaseNominal / totalRevenue) * 100) : 0
    const monthRatio = monthRevenue > 0 ? ((monthPurchaseNominal / monthRevenue) * 100) : 0

    return safeJson({
      totalPurchaseNominal,
      totalPurchaseCount,
      totalInventoryNominal,
      totalInventoryItems,
      totalRevenue,
      totalTxCount,
      monthPurchaseNominal,
      monthPurchaseCount,
      monthRevenue,
      monthTxCount,
      overallRatio: Math.round(overallRatio * 100) / 100,
      monthRatio: Math.round(monthRatio * 100) / 100,
    }, 200, CACHE.SHORT)
  } catch (error) {
    console.error('Purchase summary error:', error)
    return safeJsonError('Failed to load purchase summary')
  }
}