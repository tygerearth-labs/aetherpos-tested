import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getVoidedTxIds, parseTzOffset, getTodayRangeTz } from '@/lib/api/api-helpers'
import { runInsightEngine, type InsightEngineInput } from '@/lib/insight-engine'
import { getOutletPlan } from '@/lib/config/plan-config'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

/**
 * GET /api/insights/engine
 *
 * AI Insight Engine — analyzes outlet data with rule-based logic,
 * scores insights by priority, combines related issues, and returns
 * the top actionable insights for the dashboard.
 *
 * OWNER only. Requires aiInsights plan feature (Pro/Enterprise).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Owner only', 403)

    // FIX-PLAN-003: Enforce aiInsights plan feature server-side.
    const outletPlan = await getOutletPlan(user.outletId, db)
    if (!outletPlan) return safeJsonError('Outlet tidak ditemukan', 404)
    if (!outletPlan.features.aiInsights) {
      return safeJsonError('Fitur ini hanya tersedia pada paket Pro/Enterprise', 403)
    }

    const outletId = user.outletId

    // Timezone-aware date ranges from client device (fallback to server tz if offset not provided)
    const tzOffset = parseTzOffset(request.nextUrl.searchParams)
    const { todayStart, yesterdayStart, weekAgo } = tzOffset !== null
      ? getTodayRangeTz(tzOffset)
      : getTodayRangeTz(new Date().getTimezoneOffset())

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

    // ── Additional data for enhanced insights ──
    const fourteenDaysAgo = new Date(todayStart.getTime() - 14 * 86_400_000)
    const [
      inventoryItems,
      inventoryConsumption,
      pendingTransfers,
      pendingTransferItems,
      pendingPurchases,
      pendingPurchaseAgg,
      topVariantSellingRaw,
    ] = await Promise.all([
      // Fetch inventory items
      db.inventoryItem.findMany({
        where: { outletId },
        select: { id: true, name: true, stock: true, lowStockAlert: true, avgCost: true, baseUnit: true },
      }),

      // Fetch inventory consumption (14 days)
      db.inventoryMovement.groupBy({
        by: ['inventoryItemId'],
        where: { outletId, type: 'CONSUMPTION', createdAt: { gte: fourteenDaysAgo } },
        _sum: { quantity: true },
      }),

      // Fetch pending transfers (outbound from this outlet, not yet received)
      db.outletTransfer.count({
        where: { outletId, fromOutletId: outletId, status: { in: ['DRAFT', 'IN_TRANSIT'] } },
      }),

      // Fetch pending transfer item count
      db.transferItem.count({
        where: {
          outletId,
          transfer: { fromOutletId: outletId, status: { in: ['DRAFT', 'IN_TRANSIT'] } },
        },
      }),

      // Fetch pending purchases (all — no status field on PurchaseOrder)
      db.purchaseOrder.count({
        where: { outletId },
      }),

      // Fetch pending purchase value
      db.purchaseOrder.aggregate({
        where: { outletId },
        _sum: { totalCost: true },
      }),

      // Top variant selling today
      db.transactionItem.groupBy({
        by: ['productName', 'variantName'],
        where: {
          transaction: { outletId, createdAt: { gte: todayStart }, ...voidExclude },
          variantName: { not: null },
        },
        _sum: { qty: true, subtotal: true },
        orderBy: { _sum: { qty: 'desc' } },
        take: 5,
      }),
    ])

    // Process inventory data
    const consumptionMap = new Map(inventoryConsumption.map(c => [c.inventoryItemId, c._sum.quantity ?? 0]))
    const inventoryAlerts = inventoryItems.map(item => {
      const consumed14d = consumptionMap.get(item.id) ?? 0
      const dailyConsumption = consumed14d / 14
      const daysUntilEmpty = dailyConsumption > 0 ? item.stock / dailyConsumption : null
      return { name: item.name, stock: item.stock, dailyConsumption, daysUntilEmpty, avgCost: item.avgCost, baseUnit: item.baseUnit }
    }).sort((a, b) => (a.daysUntilEmpty ?? 9999) - (b.daysUntilEmpty ?? 9999))

    const totalInventoryValue = inventoryItems.reduce((s, i) => s + i.stock * i.avgCost, 0)
    const lowInventoryCount = inventoryItems.filter(i => i.stock <= i.lowStockAlert).length
    const outOfInventoryCount = inventoryItems.filter(i => i.stock <= 0).length

    const topVariantSelling = topVariantSellingRaw.map(r => ({
      productName: r.productName,
      variantName: r.variantName!,
      qty: r._sum.qty ?? 0,
      revenue: r._sum.subtotal ?? 0,
    }))

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
      // Inventory data
      lowInventoryCount,
      outOfInventoryCount,
      inventoryAlerts,
      totalInventoryValue,
      // Transfer & Purchase data
      pendingTransfers,
      pendingTransferItems,
      pendingPurchases,
      pendingPurchaseValue: pendingPurchaseAgg._sum.totalCost ?? 0,
      // Variant sales data
      topVariantSelling,
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
        lowInventoryCount,
        outOfInventoryCount,
        inventoryAlerts,
        totalInventoryValue,
        pendingTransfers,
        pendingPurchaseItems: pendingTransferItems,
        pendingPurchases,
        pendingPurchaseValue: pendingPurchaseAgg._sum.totalCost ?? 0,
        topVariantSelling,
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[insights/engine] Error:', error)
    return safeJsonError('Failed to generate insights')
  }
}
