import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getVoidedTxIds, parseTzOffset, getTodayRangeTz } from '@/lib/api-helpers'
import { runInsightEngine, type InsightEngineInput } from '@/lib/insight-engine'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * GET /api/insights/engine
 *
 * AI Insight Engine — analyzes outlet data with rule-based logic,
 * scores insights by priority, combines related issues, and returns
 * the top actionable insights for the dashboard.
 *
 * OWNER only.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Owner only', 403)

    const outletId = user.outletId

    // Timezone-aware date ranges from client device
    const tzOffset = parseTzOffset(request.nextUrl.searchParams)
    const { todayStart, yesterdayStart, weekAgo } = tzOffset !== null
      ? getTodayRangeTz(tzOffset)
      : (() => {
          const now = new Date()
          const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          return {
            todayStart: ts,
            yesterdayStart: new Date(ts.getTime() - 86_400_000),
            weekAgo: new Date(ts.getTime() - 7 * 86_400_000),
          }
        })()

    // Void exclusion
    const voidedTxIds = await getVoidedTxIds(db, outletId)
    const voidedIdArray = Array.from(voidedTxIds).filter(Boolean) as string[]
    const voidExclude = voidedIdArray.length > 0 ? { id: { notIn: voidedIdArray } } : {}

    // Parallel queries
    const [
      todayTxs,
      yesterdayTxs,
      allProducts,
      totalCustomers,
      repeatCustomerCount,
      newThisWeekCount,
    ] = await Promise.all([
      // Today transactions
      db.transaction.findMany({
        where: { outletId, createdAt: { gte: todayStart }, ...voidExclude },
        select: { total: true, subtotal: true, discount: true, taxAmount: true },
      }),
      // Yesterday transactions
      db.transaction.findMany({
        where: { outletId, createdAt: { gte: yesterdayStart, lt: todayStart }, ...voidExclude },
        select: { total: true },
      }),
      // All products with stock info (variant-aware)
      db.product.findMany({
        where: { outletId },
        select: { id: true, name: true, stock: true, lowStockAlert: true, price: true, hasVariants: true, variants: { select: { price: true, stock: true } } },
      }),
      // Customer counts
      db.customer.count({ where: { outletId } }),
      // Repeat customers this week (customers with >1 transaction, at least 1 this week)
      (() => {
        // Get customer IDs that have transactions this week
        return db.transaction.groupBy({
          by: ['customerId'],
          where: {
            outletId,
            customerId: { not: null },
            createdAt: { gte: weekAgo },
            ...voidExclude,
          },
          _count: { id: true },
        }).then((rows) => {
          return rows.filter((r) => r._count.id > 1).length
        })
      })(),
      // New customers this week
      db.customer.count({ where: { outletId, createdAt: { gte: weekAgo } } }),
    ])

    // Calculate metrics
    const todayRevenue = todayTxs.reduce((s, t) => s + t.total, 0)
    const todayBrutto = todayTxs.reduce((s, t) => s + t.subtotal, 0)
    const todayDiscount = todayTxs.reduce((s, t) => s + t.discount, 0)
    const todayTax = todayTxs.reduce((s, t) => s + (t.taxAmount || 0), 0)
    const todayTxCount = todayTxs.length
    const yesterdayRevenue = yesterdayTxs.reduce((s, t) => s + t.total, 0)
    const yesterdayTxCount = yesterdayTxs.length
    const todayAOV = todayTxCount > 0 ? todayRevenue / todayTxCount : 0
    const yesterdayAOV = yesterdayTxCount > 0 ? yesterdayRevenue / yesterdayTxCount : 0

    // Helpers for variant-aware aggregation
    const getAggStock = (p: typeof allProducts[number]) => {
      if (p.hasVariants && p.variants.length > 0) {
        return p.variants.reduce((s, v) => s + v.stock, 0)
      }
      return p.stock
    }
    const getAggPrice = (p: typeof allProducts[number]) => {
      if (p.hasVariants && p.variants.length > 0) {
        return p.variants.reduce((s, v) => s + v.price, 0) / p.variants.length
      }
      return p.price
    }

    // Product stats
    const totalProducts = allProducts.length
    const outOfStockCount = allProducts.filter((p) => getAggStock(p) <= 0).length
    const lowStockCount = allProducts.filter((p) => getAggStock(p) <= p.lowStockAlert).length
    const avgProductPrice = totalProducts > 0
      ? allProducts.reduce((s, p) => s + getAggPrice(p), 0) / totalProducts
      : 0

    // Top selling products (all time, with stock info)
    const topSellingItems = await db.transactionItem.groupBy({
      by: ['productName'],
      where: { transaction: { outletId, ...voidExclude } },
      _sum: { qty: true, subtotal: true },
      orderBy: { _sum: { qty: 'desc' } },
      take: 10,
    })

    // Merge stock info into top selling
    const productStockMap = new Map(allProducts.map((p) => [p.name, p]))
    const topSelling = topSellingItems.map((item) => {
      const product = productStockMap.get(item.productName)
      return {
        name: item.productName,
        qty: item._sum.qty ?? 0,
        revenue: item._sum.subtotal ?? 0,
        stock: product ? getAggStock(product) : -1,
        lowStockAlert: product?.lowStockAlert ?? 10,
      }
    })

    // Today profit (if possible)
    const todayItems = todayTxCount > 0
      ? await db.transactionItem.findMany({
          where: {
            transaction: { outletId, createdAt: { gte: todayStart }, ...voidExclude },
          },
          select: { price: true, hpp: true, qty: true },
        })
      : []
    const todayProfit = todayItems.reduce((s, i) => s + (i.price - i.hpp) * i.qty, 0)

    // Run engine
    const engineInput: InsightEngineInput = {
      todayRevenue,
      yesterdayRevenue,
      todayTransactions: todayTxCount,
      yesterdayTransactions: yesterdayTxCount,
      todayAOV,
      yesterdayAOV,
      totalProducts,
      lowStockCount,
      outOfStockCount,
      topSelling,
      totalCustomers,
      repeatCustomersThisWeek: repeatCustomerCount,
      newCustomersThisWeek: newThisWeekCount,
      avgProductPrice,
      todayProfit: todayProfit || null,
      todayBrutto,
      todayDiscount,
      todayTax,
    }

    const result = runInsightEngine(engineInput)

    return safeJson({
      ...result,
      // Extra metrics for the stat cards
      metrics: {
        todayRevenue,
        todayBrutto,
        todayDiscount,
        todayTax,
        todayTransactions: todayTxCount,
        todayProfit: todayProfit || null,
        todayAOV,
        yesterdayRevenue,
        yesterdayTransactions: yesterdayTxCount,
        totalProducts,
        lowStockCount,
        outOfStockCount,
        totalCustomers,
        newCustomersThisWeek: newThisWeekCount,
        topSelling: topSelling.slice(0, 5),
        lowStockProducts: allProducts
          .map((p) => ({ name: p.name, stock: getAggStock(p), lowStockAlert: p.lowStockAlert }))
          .filter((p) => p.stock <= p.lowStockAlert)
          .sort((a, b) => a.stock - b.stock)
          .slice(0, 5),
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[insights/engine] Error:', error)
    return safeJsonError('Failed to generate insights')
  }
}
