import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { sendTelegramMessage, formatStockAlertMessage, type StockAlertItem } from '@/lib/telegram'
import { notifyDailyReport, notifyWeeklyReport, notifyMonthlyReport, notifyInsight } from '@/lib/notify'
import { runInsightEngine, type AIInsight } from '@/lib/insight-engine'
import { safeJson, safeJsonError } from '@/lib/safe-response'

const TELEGRAM_API = 'https://api.telegram.org'

/**
 * POST /api/telegram/notify
 *
 * Send notifications to outlets via Telegram.
 * Used by cron jobs (no auth required — uses internal secret).
 *
 * Body:
 *   - type: "stock" | "daily" | "weekly" | "monthly" | "insight"
 *   - outletId?: string (optional — if omitted, sends to ALL configured outlets)
 *   - secret: string (internal cron secret)
 */
export async function POST(request: NextRequest) {
  try {
    // Validate internal secret for cron access
    const body = await request.json()
    const { type, outletId, secret } = body as {
      type?: string
      outletId?: string
      secret?: string
    }

    // Simple secret check — prevents unauthorized calls
    const cronSecret = process.env.CRON_SECRET || 'aether-pos-cron-2024'
    if (secret !== cronSecret) {
      return safeJsonError('Unauthorized', 401)
    }

    if (!type) {
      return safeJsonError('Missing notification type', 400)
    }

    // For daily/weekly/monthly reports, use the notify dispatcher directly
    if (type === 'daily' || type === 'weekly' || type === 'monthly') {
      return handleReportNotify(type, outletId)
    }

    // For insight, use the insight engine
    if (type === 'insight') {
      return handleInsightNotify(outletId)
    }

    // Stock alert — original implementation
    if (type !== 'stock') {
      return safeJsonError(`Unknown type: ${type}. Supported: stock, daily, weekly, monthly, insight`, 400)
    }

    // Find all outlets with Telegram configured
    const whereClause: Record<string, unknown> = {
      telegramChatId: { not: null as unknown },
    }
    if (outletId) {
      whereClause.outletId = outletId
    }

    const configuredSettings = await db.outletSetting.findMany({
      where: whereClause,
      include: {
        outlet: {
          select: { id: true, name: true },
        },
      },
    })

    if (configuredSettings.length === 0) {
      console.log('[telegram/notify] No outlets with Telegram configured')
      return safeJson({ success: true, sent: 0, message: 'No outlets configured' })
    }

    let sentCount = 0
    let errorCount = 0
    const results: Array<{ outletId: string; outletName: string; ok: boolean; error?: string }> = []

    for (const setting of configuredSettings) {
      const chatId = setting.telegramChatId!
      const botToken = setting.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN

      if (!botToken || !chatId) {
        results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: false, error: 'No bot token or chat ID' })
        errorCount++
        continue
      }

      try {
        const sendResult = await sendStockAlert(setting.outletId, setting.outlet.name, chatId, botToken)
        if (sendResult.ok) {
          sentCount++
          results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: true })
        } else {
          errorCount++
          results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: false, error: sendResult.error })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[telegram/notify] Error for outlet ${setting.outletId}:`, msg)
        results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: false, error: msg })
        errorCount++
      }
    }

    return safeJson({
      success: errorCount === 0,
      sent: sentCount,
      errors: errorCount,
      results,
    })
  } catch (error) {
    console.error('[telegram/notify] Error:', error)
    return safeJsonError('Internal server error')
  }
}

// ============================================================
// Report Notification Handler (daily/weekly/monthly)
// ============================================================

async function handleReportNotify(type: 'daily' | 'weekly' | 'monthly', outletId?: string) {
  // Find target outlets
  const whereClause: Record<string, unknown> = {
    telegramChatId: { not: null as unknown },
  }
  if (outletId) {
    whereClause.outletId = outletId
  }

  const configuredSettings = await db.outletSetting.findMany({
    where: whereClause,
    select: { outletId: true, outlet: { select: { name: true } } },
  })

  if (configuredSettings.length === 0) {
    return safeJson({ success: true, sent: 0, message: 'No outlets configured' })
  }

  let sentCount = 0
  let errorCount = 0
  const results: Array<{ outletId: string; outletName: string; ok: boolean; error?: string }> = []

  for (const setting of configuredSettings) {
    try {
      let result: { sent: boolean; error?: string }
      if (type === 'daily') {
        result = await notifyDailyReport(setting.outletId)
      } else if (type === 'weekly') {
        result = await notifyWeeklyReport(setting.outletId)
      } else {
        result = await notifyMonthlyReport(setting.outletId)
      }

      if (result.sent) {
        sentCount++
        results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: true })
      } else {
        errorCount++
        results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: false, error: result.error })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errorCount++
      results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: false, error: msg })
    }
  }

  return safeJson({ success: errorCount === 0, sent: sentCount, errors: errorCount, results })
}

// ============================================================
// Insight Notification Handler
// ============================================================

async function handleInsightNotify(outletId?: string) {
  // Find target outlets with insight notifications enabled
  const whereClause: Record<string, unknown> = {
    telegramChatId: { not: null as unknown },
    notifyOnInsight: true,
  }
  if (outletId) {
    whereClause.outletId = outletId
  }

  const configuredSettings = await db.outletSetting.findMany({
    where: whereClause,
    select: { outletId: true, outlet: { select: { name: true } } },
  })

  if (configuredSettings.length === 0) {
    return safeJson({ success: true, sent: 0, message: 'No outlets with insight notifications configured' })
  }

  let sentCount = 0
  const results: Array<{ outletId: string; outletName: string; ok: boolean; sentCount: number; skipped: string[] }> = []

  for (const setting of configuredSettings) {
    try {
      // Run insight engine for this outlet
      const insights = await generateInsightsForOutlet(setting.outletId)

      if (insights.length === 0) {
        results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: false, sentCount: 0, skipped: [] })
        continue
      }

      // Send via notify dispatcher (with spam prevention)
      const result = await notifyInsight(
        setting.outletId,
        insights.map(i => ({
          id: i.id,
          title: i.title,
          why: i.why,
          actions: i.actions,
          priority: i.priority,
          emoji: i.emoji,
          outletName: setting.outlet.name,
          healthScore: 75, // will be calculated by engine in future
        }))
      )

      if (result.sent) {
        sentCount += result.sentCount
        results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: true, sentCount: result.sentCount, skipped: result.skipped })
      } else {
        results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: false, sentCount: 0, skipped: result.skipped })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[telegram/notify] Insight error for outlet ${setting.outletId}:`, msg)
      results.push({ outletId: setting.outletId, outletName: setting.outlet.name, ok: false, sentCount: 0, skipped: [] })
    }
  }

  return safeJson({ success: sentCount > 0, sent: sentCount, results })
}

// ============================================================
// Generate Insights from Outlet Data
// ============================================================

async function generateInsightsForOutlet(outletId: string): Promise<AIInsight[]> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  // Fetch today's and yesterday's data
  const [todayTxns, yesterdayTxns, products, customers] = await Promise.all([
    db.transaction.findMany({
      where: { outletId, createdAt: { gte: today } },
      select: { subtotal: true, total: true, discount: true, items: { select: { productName: true, qty: true, price: true } } },
    }),
    db.transaction.findMany({
      where: { outletId, createdAt: { gte: yesterday, lt: today } },
      select: { subtotal: true, total: true, discount: true, items: { select: { productName: true, qty: true, price: true } } },
    }),
    db.product.findMany({
      where: { outletId },
      select: { id: true, name: true, stock: true, lowStockAlert: true, price: true },
    }),
    db.customer.findMany({
      where: { outletId },
      select: { id: true, createdAt: true },
    }),
  ])

  // Calculate aggregates
  const calcAgg = (txns: typeof todayTxns) => {
    let brutto = 0, netto = 0, discount = 0
    const productMap = new Map<string, { qty: number; revenue: number }>()
    for (const txn of txns) {
      brutto += txn.subtotal
      netto += txn.total
      discount += txn.discount
      for (const item of txn.items) {
        const existing = productMap.get(item.productName) || { qty: 0, revenue: 0 }
        existing.qty += item.qty
        existing.revenue += item.price * item.qty
        productMap.set(item.productName, existing)
      }
    }
    return { brutto, netto, discount, productMap, count: txns.length }
  }

  const todayAgg = calcAgg(todayTxns)
  const yesterdayAgg = calcAgg(yesterdayTxns)

  // Top selling products (by qty)
  const topSelling = [...todayAgg.productMap.entries()]
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5)
    .map(([name, data]) => {
      const product = products.find(p => p.name === name)
      return {
        name,
        qty: data.qty,
        revenue: data.revenue,
        stock: product?.stock || 0,
        lowStockAlert: product?.lowStockAlert || 5,
      }
    })

  // Out of stock / low stock
  const outOfStockCount = products.filter(p => p.stock <= 0).length
  const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= p.lowStockAlert).length

  // Customer metrics
  const totalCustomers = customers.length
  const weekAgo = new Date(now)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const repeatCustomersThisWeek = new Set(
    customers.filter(c => {
      // Count customers who have transactions this week (approximate)
      return c.createdAt < weekAgo
    }).map(c => c.id)
  ).size

  const newCustomersThisWeek = customers.filter(c => c.createdAt >= weekAgo).length

  // Avg product price
  const avgProductPrice = products.length > 0
    ? products.reduce((sum, p) => sum + p.price, 0) / products.length
    : 0

  // Run insight engine
  const result = runInsightEngine({
    todayRevenue: todayAgg.netto,
    yesterdayRevenue: yesterdayAgg.netto,
    todayTransactions: todayAgg.count,
    yesterdayTransactions: yesterdayAgg.count,
    todayAOV: todayAgg.count > 0 ? todayAgg.netto / todayAgg.count : 0,
    yesterdayAOV: yesterdayAgg.count > 0 ? yesterdayAgg.netto / yesterdayAgg.count : 0,
    totalProducts: products.length,
    lowStockCount,
    outOfStockCount,
    topSelling,
    totalCustomers,
    repeatCustomersThisWeek,
    newCustomersThisWeek,
    avgProductPrice,
    todayProfit: null,
    todayBrutto: todayAgg.brutto,
    todayDiscount: todayAgg.discount,
    todayTax: 0,
  })

  // Only return actionable insights (not 'all-good')
  return result.insights.filter(i => i.id !== 'all-good')
}

// ============================================================
// Stock Alert Handler
// ============================================================

async function sendStockAlert(
  outletId: string,
  outletName: string,
  chatId: string,
  botToken?: string
): Promise<{ ok: boolean; error?: string }> {
  // 1. Get low-stock and out-of-stock products
  const products = await db.product.findMany({
    where: {
      outletId,
      OR: [
        { stock: { lte: 0 } },
        { AND: [{ stock: { gt: 0 } }, { stock: { lte: 1000 } }] }, // broad filter, we refine in code
      ],
    },
    select: {
      id: true,
      name: true,
      stock: true,
      lowStockAlert: true,
      unit: true,
      price: true,
      category: { select: { name: true } },
    },
    orderBy: { stock: 'asc' },
  })

  // Filter: only items that are actually low stock or out of stock
  const alertItems: StockAlertItem[] = products
    .filter((p) => p.stock <= p.lowStockAlert)
    .map((p) => ({
      name: p.name,
      stock: p.stock,
      lowStockAlert: p.lowStockAlert,
      unit: p.unit,
      price: p.price,
      categoryName: p.category?.name,
    }))

  // 2. Calculate sales velocity for forecasting (last 14 days)
  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  // Get product sales quantities in the last 14 days
  const salesData = await db.transactionItem.groupBy({
    by: ['productId'],
    where: {
      transaction: {
        outletId,
        createdAt: { gte: fourteenDaysAgo },
      },
      productId: { not: null },
    },
    _sum: { qty: true },
  })

  // Build a map: productId -> total qty sold in 14 days
  const salesMap = new Map<string, number>()
  for (const row of salesData) {
    if (row.productId && row._sum.qty) {
      salesMap.set(row.productId, row._sum.qty)
    }
  }

  // Calculate days until empty for each alert item
  for (const item of alertItems) {
    const matchingProduct = products.find((p) => p.name === item.name)
    if (!matchingProduct || item.stock <= 0) {
      item.daysUntilEmpty = 0
      continue
    }

    const sold14d = salesMap.get(matchingProduct.id) || 0
    const dailyVelocity = sold14d / 14

    if (dailyVelocity > 0) {
      item.daysUntilEmpty = Math.floor(item.stock / dailyVelocity)
    } else {
      item.daysUntilEmpty = null
    }
  }

  // 3. If no items need attention, skip
  if (alertItems.length === 0) {
    console.log(`[telegram/notify] Outlet ${outletName}: All stock OK, skipping alert`)
    return { ok: true }
  }

  // 4. Format and send
  const message = formatStockAlertMessage({
    outletName,
    items: alertItems,
  })

  const token = botToken || process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return { ok: false, error: 'No bot token available' }
  }

  const url = `${TELEGRAM_API}/bot${token}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })

  const data = await res.json() as { ok: boolean; description?: string }
  if (!data.ok) {
    console.error(`[telegram/notify] Send failed for ${outletName}: ${data.description}`)
    return { ok: false, error: data.description }
  }

  console.log(`[telegram/notify] Stock alert sent to ${outletName} (${alertItems.length} items)`)
  return { ok: true }
}
