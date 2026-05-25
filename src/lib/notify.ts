/**
 * notify.ts — Notification Dispatcher
 *
 * Fire-and-forget notification system.
 * Checks outlet settings (telegramChatId, notify toggles, botToken)
 * before sending. Never blocks the main request.
 *
 * Spam Prevention (Insights):
 *   - In-memory rate limiter per outlet
 *   - Cooldown per insight ID: won't re-send same insight within cooldown period
 *   - Max insights per hour: 3 per outlet
 *   - Only critical/high priority insights sent via Telegram
 *
 * Usage:
 *   import { notifyNewTransaction, notifyInsight } from '@/lib/notify'
 *   await notifyNewTransaction(outletId, { ... })
 */

import { db } from '@/lib/db'
import {
  sendTelegramMessage,
  formatTransactionMessage,
  formatCustomerMessage,
  formatDailyReportMessage,
  formatWeeklyReportMessage,
  formatMonthlyReportMessage,
  formatDailySummaryMessage,
  formatInsightBatchMessage,
  type TransactionNotifyData,
  type RevenueData,
  type InsightNotifyData,
} from '@/lib/telegram'

// ============================================================
// Internal: Get outlet's Telegram config
// ============================================================

interface TelegramConfig {
  chatId: string | null
  botToken: string | null
  notifyOnTransaction: boolean
  notifyOnCustomer: boolean
  notifyDailyReport: boolean
  notifyWeeklyReport: boolean
  notifyMonthlyReport: boolean
  notifyOnInsight: boolean
  outletName: string
}

async function getTelegramConfig(outletId: string): Promise<TelegramConfig | null> {
  try {
    const setting = await db.outletSetting.findUnique({
      where: { outletId },
      select: {
        telegramChatId: true,
        telegramBotToken: true,
        notifyOnTransaction: true,
        notifyOnCustomer: true,
        notifyDailyReport: true,
        notifyWeeklyReport: true,
        notifyMonthlyReport: true,
        notifyOnInsight: true,
        outlet: { select: { name: true } },
      },
    })

    if (!setting) {
      console.warn(`[notify-config] No OutletSetting found for outlet ${outletId}`)
      return null
    }

    if (!setting.telegramChatId) {
      console.log(`[notify-config] telegramChatId is null for outlet ${outletId}`)
      return null
    }

    console.log(`[notify-config] Found config for outlet ${outletId}: chatId=${setting.telegramChatId}, botToken=${setting.telegramBotToken ? '***set***' : 'NOT SET (will use env)'}, notifyTxn=${setting.notifyOnTransaction}`)

    return {
      chatId: setting.telegramChatId,
      botToken: setting.telegramBotToken || null,
      notifyOnTransaction: setting.notifyOnTransaction,
      notifyOnCustomer: setting.notifyOnCustomer,
      notifyDailyReport: setting.notifyDailyReport,
      notifyWeeklyReport: setting.notifyWeeklyReport,
      notifyMonthlyReport: setting.notifyMonthlyReport,
      notifyOnInsight: setting.notifyOnInsight,
      outletName: setting.outlet?.name || 'Outlet',
    }
  } catch (err) {
    console.error(`[notify-config] DB error for outlet ${outletId}:`, err)
    return null
  }
}

// ============================================================
// Insight Spam Prevention (In-Memory Rate Limiter)
// ============================================================

interface InsightRateLimit {
  lastSentPerId: Map<string, number>   // insightId -> timestamp
  sentCountThisHour: number
  hourStart: number
}

const insightRateLimits = new Map<string, InsightRateLimit>()

// Cooldown: same insight ID won't be re-sent within this many ms (default: 2 hours)
const INSIGHT_COOLDOWN_MS = 2 * 60 * 60 * 1000
// Max insights per outlet per hour
const MAX_INSIGHTS_PER_HOUR = 3
// Minimum priority to send via Telegram ('low' and 'all-good' are suppressed)
const MIN_INSIGHT_PRIORITY = new Set(['critical', 'high'])

function getInsightRateLimit(outletId: string): InsightRateLimit {
  let limit = insightRateLimits.get(outletId)
  const now = Date.now()

  if (!limit || (now - limit.hourStart) > 60 * 60 * 1000) {
    limit = {
      lastSentPerId: new Map(),
      sentCountThisHour: 0,
      hourStart: now,
    }
    insightRateLimits.set(outletId, limit)
  }

  return limit
}

/**
 * Check if an insight should be sent (spam prevention).
 * Returns true if the insight passes all rate limit checks.
 */
function shouldSendInsight(outletId: string, insight: InsightNotifyData): boolean {
  // 1. Skip low priority / all-good insights
  if (!MIN_INSIGHT_PRIORITY.has(insight.priority)) {
    return false
  }

  // 2. Check cooldown per insight ID
  const limit = getInsightRateLimit(outletId)
  const lastSent = limit.lastSentPerId.get(insight.id)
  if (lastSent && (Date.now() - lastSent) < INSIGHT_COOLDOWN_MS) {
    return false
  }

  // 3. Check max per hour
  if (limit.sentCountThisHour >= MAX_INSIGHTS_PER_HOUR) {
    return false
  }

  return true
}

function markInsightSent(outletId: string, insightIds: string[]): void {
  const limit = getInsightRateLimit(outletId)
  const now = Date.now()
  for (const id of insightIds) {
    limit.lastSentPerId.set(id, now)
  }
  limit.sentCountThisHour += insightIds.length
}

// ============================================================
// Public Notification Functions
// ============================================================

/**
 * Notify owner about a new transaction.
 * Call this AFTER the transaction is committed.
 * Must be properly awaited or scheduled via after().
 */
export async function notifyNewTransaction(
  outletId: string,
  data: TransactionNotifyData
): Promise<void> {
  try {
    const config = await getTelegramConfig(outletId)

    if (!config?.chatId) {
      console.log(`[notify] Transaction skipped: no chatId for outlet ${outletId}`)
      return
    }
    if (!config.notifyOnTransaction) {
      console.log(`[notify] Transaction skipped: notifyOnTransaction is OFF for outlet ${outletId}`)
      return
    }

    const message = formatTransactionMessage({
      ...data,
      outletName: config.outletName,
    })

    console.log(`[notify] Sending transaction notification to Telegram chat ${config.chatId} (outlet: ${outletId})`)

    const result = await sendTelegramMessage(config.chatId, message, {
      botToken: config.botToken || undefined,
    })

    if (result.ok) {
      console.log(`[notify] ✅ Transaction notification sent successfully (chatId: ${config.chatId})`)
    } else {
      console.error(`[notify] ❌ Transaction notification failed: ${result.error} (chatId: ${config.chatId})`)
    }
  } catch (err) {
    console.error(`[notify] ❌ Failed to get Telegram config for outlet ${outletId}:`, err)
  }
}

/**
 * Notify owner about a new customer registration.
 * Must be properly awaited or scheduled via after().
 */
export async function notifyNewCustomer(
  outletId: string,
  data: { name: string; whatsapp: string }
): Promise<void> {
  try {
    const config = await getTelegramConfig(outletId)

    if (!config?.chatId) {
      console.log(`[notify] Customer skipped: no chatId for outlet ${outletId}`)
      return
    }
    if (!config.notifyOnCustomer) {
      console.log(`[notify] Customer skipped: notifyOnCustomer is OFF for outlet ${outletId}`)
      return
    }

    const message = formatCustomerMessage({
      ...data,
      outletName: config.outletName,
    })

    console.log(`[notify] Sending customer notification to Telegram chat ${config.chatId} (outlet: ${outletId})`)

    const result = await sendTelegramMessage(config.chatId, message, {
      botToken: config.botToken || undefined,
    })

    if (result.ok) {
      console.log(`[notify] ✅ Customer notification sent (chatId: ${config.chatId})`)
    } else {
      console.error(`[notify] ❌ Customer notification failed: ${result.error} (chatId: ${config.chatId})`)
    }
  } catch (err) {
    console.error(`[notify] ❌ Failed to get Telegram config for outlet ${outletId}:`, err)
  }
}

/**
 * Send daily revenue report to owner.
 * Can be called manually or via cron job.
 */
export async function notifyDailyReport(
  outletId: string
): Promise<{ sent: boolean; error?: string }> {
  const config = await getTelegramConfig(outletId)
  if (!config?.chatId || !config.notifyDailyReport) {
    return { sent: false, error: 'Telegram not configured or daily report disabled' }
  }

  const today = new Date()
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)

  // Fetch today's transaction data
  const transactions = await db.transaction.findMany({
    where: {
      outletId,
      createdAt: { gte: startOfDay, lt: endOfDay },
    },
    select: {
      subtotal: true,
      discount: true,
      total: true,
      items: { select: { productName: true, qty: true } },
    },
  })

  // Calculate revenue
  let brutto = 0
  let discount = 0
  let netto = 0
  const productMap = new Map<string, number>()

  for (const txn of transactions) {
    brutto += txn.subtotal
    discount += txn.discount
    netto += txn.total

    for (const item of txn.items) {
      productMap.set(
        item.productName,
        (productMap.get(item.productName) || 0) + item.qty
      )
    }
  }

  // Find top product
  let topProduct: string | undefined
  let topProductQty = 0
  for (const [name, qty] of productMap) {
    if (qty > topProductQty) {
      topProduct = name
      topProductQty = qty
    }
  }

  const revenueData: RevenueData = {
    brutto,
    discount,
    netto,
    transactionCount: transactions.length,
    averageTransaction: transactions.length > 0 ? netto / transactions.length : 0,
    topProduct,
    topProductQty,
  }

  const message = formatDailyReportMessage({
    ...revenueData,
    outletName: config.outletName,
    date: today,
  })

  const result = await sendTelegramMessage(config.chatId, message, {
    botToken: config.botToken || undefined,
  })
  return { sent: result.ok, error: result.error }
}

/**
 * Send weekly report to owner.
 */
export async function notifyWeeklyReport(
  outletId: string
): Promise<{ sent: boolean; error?: string }> {
  const config = await getTelegramConfig(outletId)
  if (!config?.chatId || !config.notifyWeeklyReport) {
    return { sent: false, error: 'Telegram not configured or weekly report disabled' }
  }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Get Monday of current week
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() + mondayOffset)
  weekStart.setHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  // Fetch transactions for the week
  const transactions = await db.transaction.findMany({
    where: {
      outletId,
      createdAt: { gte: weekStart, lt: weekEnd },
    },
    select: {
      subtotal: true,
      discount: true,
      total: true,
      createdAt: true,
      items: { select: { productName: true, qty: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Group by day
  const dayMap = new Map<string, { brutto: number; netto: number; count: number }>()
  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

  let totalBrutto = 0
  let totalDiscount = 0
  let totalNetto = 0

  for (const txn of transactions) {
    totalBrutto += txn.subtotal
    totalDiscount += txn.discount
    totalNetto += txn.total

    const dayKey = txn.createdAt.toLocaleDateString('id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    const existing = dayMap.get(dayKey) || { brutto: 0, netto: 0, count: 0 }
    existing.brutto += txn.subtotal
    existing.netto += txn.total
    existing.count++
    dayMap.set(dayKey, existing)
  }

  // Fill all 7 days (even if no transactions)
  const days: Array<{ date: string; brutto: number; netto: number; count: number }> = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    const key = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })
    const data = dayMap.get(key) || { brutto: 0, netto: 0, count: 0 }
    days.push({ date: `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`, ...data })
  }

  const message = formatWeeklyReportMessage({
    outletName: config.outletName,
    weekStart,
    weekEnd: new Date(weekEnd.getTime() - 1),
    days,
    totals: {
      brutto: totalBrutto,
      discount: totalDiscount,
      netto: totalNetto,
      transactionCount: transactions.length,
      averageTransaction: transactions.length > 0 ? totalNetto / transactions.length : 0,
    },
  })

  const result = await sendTelegramMessage(config.chatId, message, {
    botToken: config.botToken || undefined,
  })
  return { sent: result.ok, error: result.error }
}

/**
 * Send monthly report to owner.
 */
export async function notifyMonthlyReport(
  outletId: string,
  month?: number,  // 0-11, default: last month
  year?: number
): Promise<{ sent: boolean; error?: string }> {
  const config = await getTelegramConfig(outletId)
  if (!config?.chatId || !config.notifyMonthlyReport) {
    return { sent: false, error: 'Telegram not configured or monthly report disabled' }
  }

  const now = new Date()
  const reportMonth = month ?? now.getMonth() - 1  // Default: last month
  const reportYear = year ?? now.getFullYear()

  // Handle January → December of previous year
  const actualMonth = reportMonth < 0 ? 11 : reportMonth
  const actualYear = reportMonth < 0 ? reportYear - 1 : reportYear

  const startDate = new Date(actualYear, actualMonth, 1)
  const endDate = new Date(actualYear, actualMonth + 1, 1)

  // Fetch transactions
  const transactions = await db.transaction.findMany({
    where: {
      outletId,
      createdAt: { gte: startDate, lt: endDate },
    },
    select: {
      subtotal: true,
      discount: true,
      total: true,
      items: { select: { productName: true, qty: true, price: true } },
    },
  })

  // Aggregate
  let totalBrutto = 0
  let totalDiscount = 0
  let totalNetto = 0
  const productMap = new Map<string, { qty: number; revenue: number }>()

  for (const txn of transactions) {
    totalBrutto += txn.subtotal
    totalDiscount += txn.discount
    totalNetto += txn.total

    for (const item of txn.items) {
      const existing = productMap.get(item.productName) || { qty: 0, revenue: 0 }
      existing.qty += item.qty
      existing.revenue += item.price * item.qty
      productMap.set(item.productName, existing)
    }
  }

  // Top 5 products
  const topProducts = [...productMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5)
    .map(([name, data]) => ({ name, ...data }))

  // New customers this month
  const newCustomers = await db.customer.count({
    where: {
      outletId,
      createdAt: { gte: startDate, lt: endDate },
    },
  })

  const message = formatMonthlyReportMessage({
    outletName: config.outletName,
    month: actualMonth,
    year: actualYear,
    totalNetto,
    totalBrutto,
    totalDiscount,
    transactionCount: transactions.length,
    newCustomers,
    topProducts,
  })

  const result = await sendTelegramMessage(config.chatId, message, {
    botToken: config.botToken || undefined,
  })
  return { sent: result.ok, error: result.error }
}

/**
 * Send daily summary (end-of-day quick numbers).
 * Includes low stock alert.
 */
export async function notifyDailySummary(
  outletId: string
): Promise<{ sent: boolean; error?: string }> {
  const config = await getTelegramConfig(outletId)
  if (!config?.chatId || !config.notifyDailyReport) {
    return { sent: false, error: 'Telegram not configured or daily report disabled' }
  }

  const today = new Date()
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  const [transactions, newCustomersCount, lowStockCount] = await Promise.all([
    db.transaction.findMany({
      where: { outletId, createdAt: { gte: startOfDay } },
      select: { subtotal: true, discount: true, total: true, items: { select: { productName: true, qty: true } } },
    }),
    db.customer.count({
      where: { outletId, createdAt: { gte: startOfDay } },
    }),
    db.product.count({
      where: { outletId },
    }).then(async (total) => {
      const products = await db.product.findMany({
        where: { outletId },
        select: { stock: true, lowStockAlert: true },
      })
      return products.filter((p) => p.stock <= p.lowStockAlert).length
    }),
  ])

  let brutto = 0
  let discount = 0
  let netto = 0
  for (const txn of transactions) {
    brutto += txn.subtotal
    discount += txn.discount
    netto += txn.total
  }

  const message = formatDailySummaryMessage({
    brutto,
    discount,
    netto,
    transactionCount: transactions.length,
    averageTransaction: transactions.length > 0 ? netto / transactions.length : 0,
    outletName: config.outletName,
    newCustomers: newCustomersCount,
    lowStockCount,
  })

  const result = await sendTelegramMessage(config.chatId, message, {
    botToken: config.botToken || undefined,
  })
  return { sent: result.ok, error: result.error }
}

// ============================================================
// Insight Notification with Spam Prevention
// ============================================================

/**
 * Send insight notifications to Telegram.
 *
 * Features:
 *   - Priority filtering: only critical/high priority insights sent
 *   - Cooldown: same insight ID not re-sent within 2 hours
 *   - Rate limit: max 3 insights per outlet per hour
 *   - Batch mode: combines multiple insights into one message
 *
 * Call this after checkout or via cron (e.g., every 30 minutes).
 */
export async function notifyInsight(
  outletId: string,
  insights: InsightNotifyData[],
  healthScore: number = 75
): Promise<{ sent: boolean; sentCount: number; skipped: string[] }> {
  const config = await getTelegramConfig(outletId)
  if (!config?.chatId || !config.notifyOnInsight) {
    return { sent: false, sentCount: 0, skipped: insights.map(i => i.id) }
  }

  // Filter: only send insights that pass spam checks
  const eligible: InsightNotifyData[] = []
  const skipped: string[] = []

  for (const insight of insights) {
    if (shouldSendInsight(outletId, insight)) {
      eligible.push({
        ...insight,
        outletName: config.outletName,
      })
    } else {
      skipped.push(insight.id)
    }
  }

  if (eligible.length === 0) {
    return { sent: false, sentCount: 0, skipped }
  }

  // Sort by priority score (critical first)
  eligible.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3)
  })

  // Take top eligible insights (respect remaining hourly quota)
  const limit = getInsightRateLimit(outletId)
  const remaining = MAX_INSIGHTS_PER_HOUR - limit.sentCountThisHour
  const toSend = eligible.slice(0, Math.max(0, remaining))

  if (toSend.length === 0) {
    return { sent: false, sentCount: 0, skipped: [...skipped, ...eligible.map(i => i.id)] }
  }

  // Format as batch message (reduces spam — one message for multiple insights)
  const message = formatInsightBatchMessage({
    insights: toSend,
    outletName: config.outletName,
    healthScore,
  })

  const result = await sendTelegramMessage(config.chatId, message, {
    botToken: config.botToken || undefined,
  })

  // Mark sent insights as dispatched
  markInsightSent(outletId, toSend.map(i => i.id))

  return {
    sent: result.ok,
    sentCount: toSend.length,
    skipped: [...skipped, ...eligible.slice(toSend.length).map(i => i.id)],
  }
}
