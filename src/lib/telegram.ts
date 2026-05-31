/**
 * telegram.ts — Telegram Bot API Service
 *
 * Sends formatted messages to outlet owners via Telegram.
 * Uses the Bot API directly (no webhook) — fire-and-forget pattern.
 *
 * Env: TELEGRAM_BOT_TOKEN (from @BotFather)
 */

const TELEGRAM_API = 'https://api.telegram.org'

// ============================================================
// Core Send Function
// ============================================================

interface SendResult {
  ok: boolean
  messageId?: number
  error?: string
}

/**
 * Send a message via Telegram Bot API.
 * Returns success/failure — never throws (fire-and-forget).
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2'
    disableNotification?: boolean
    replyMarkup?: Record<string, unknown>
    /** Override bot token (e.g. per-outlet custom bot) */
    botToken?: string
  }
): Promise<SendResult> {
  // Use per-outlet custom token if provided, otherwise fall back to global env
  const token = options?.botToken || process.env.TELEGRAM_BOT_TOKEN

  if (!token) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN not set — skipping notification')
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }
  }

  if (!chatId) {
    return { ok: false, error: 'No chatId provided' }
  }

  try {
    const url = `${TELEGRAM_API}/bot${token}/sendMessage`

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode || 'HTML',
      disable_web_page_preview: true,
    }

    if (options?.disableNotification) {
      body.disable_notification = true
    }
    if (options?.replyMarkup) {
      body.reply_markup = options.replyMarkup
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string }

    if (!data.ok) {
      console.error(`[telegram] API error: ${data.description}`)
      return { ok: false, error: data.description }
    }

    return { ok: true, messageId: data.result?.message_id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[telegram] Send failed: ${msg}`)
    return { ok: false, error: msg }
  }
}

// ============================================================
// Helpers
// ============================================================

/** Format currency as IDR */
function formatRp(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`
}

/** Format date as Indonesian locale */
function formatDateID(date: Date): string {
  return date.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Format time */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ============================================================
// Message Formatters
// ============================================================

export interface TransactionNotifyData {
  invoiceNumber: string
  items: Array<{ productName: string; variantName?: string; qty: number; price: number; subtotal: number }>
  subtotal: number
  discount: number
  taxAmount?: number
  total: number
  paymentMethod: string
  paidAmount: number
  change: number
  customerName?: string
  cashierName: string
  outletName: string
}

/**
 * Format new transaction notification
 */
export function formatTransactionMessage(data: TransactionNotifyData): string {
  const now = new Date()
  const itemLines = data.items
    .map(
      (item) =>
        `  • ${item.variantName ? `${item.productName} (${item.variantName})` : item.productName} × ${item.qty} = ${formatRp(item.subtotal)}`
    )
    .join('\n')

  return [
    `🛒 <b>Transaksi Baru</b>`,
    `📦 <code>${data.invoiceNumber}</code>`,
    `🕐 ${formatDateID(now)} • ${formatTime(now)}`,
    ``,
    `<b>Item:</b>`,
    itemLines,
    ``,
    `💰 Subtotal: ${formatRp(data.subtotal)}`,
    data.discount > 0
      ? `🏷️ Diskon: -${formatRp(data.discount)}`
      : null,
    data.taxAmount && data.taxAmount > 0
      ? `🧾 PPN: ${formatRp(data.taxAmount)}`
      : null,
    `✅ <b>Total: ${formatRp(data.total)}</b>`,
    `💳 ${data.paymentMethod} ${data.paidAmount > 0 ? `• Bayar: ${formatRp(data.paidAmount)} • Kembali: ${formatRp(data.change)}` : ''}`,
    data.customerName ? `👤 Customer: ${data.customerName}` : null,
    `🧑‍💼 Kasir: ${data.cashierName}`,
    `🏪 ${data.outletName}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Format new customer notification
 */
export function formatCustomerMessage(data: {
  name: string
  whatsapp: string
  outletName: string
}): string {
  const now = new Date()
  return [
    `👤 <b>Customer Baru</b>`,
    `🕐 ${formatDateID(now)} • ${formatTime(now)}`,
    ``,
    `📛 Nama: <b>${data.name}</b>`,
    `📱 WhatsApp: <code>${data.whatsapp}</code>`,
    `🏪 ${data.outletName}`,
  ].join('\n')
}

export interface RevenueData {
  brutto: number       // Total sales (subtotal)
  discount: number     // Total discounts given
  netto: number        // Actual revenue (total paid)
  transactionCount: number
  averageTransaction: number
  topProduct?: string  // Best seller name
  topProductQty?: number
}

/**
 * Format daily revenue report
 */
export function formatDailyReportMessage(data: RevenueData & {
  outletName: string
  date: Date
}): string {
  return [
    `📊 <b>Laporan Harian</b>`,
    `📅 ${formatDateID(data.date)}`,
    `🏪 ${data.outletName}`,
    ``,
    `💰 <b>Brutto:</b> ${formatRp(data.brutto)}`,
    `🏷️ <b>Diskon:</b> -${formatRp(data.discount)}`,
    `✅ <b>Netto:</b> <b>${formatRp(data.netto)}</b>`,
    ``,
    `🧾 Transaksi: ${data.transactionCount}`,
    `📈 Rata-rata: ${formatRp(data.averageTransaction)}`,
    data.topProduct
      ? `🏆 Terlaris: ${data.topProduct} (${data.topProductQty}x)`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Format weekly report
 */
export function formatWeeklyReportMessage(data: {
  outletName: string
  weekStart: Date
  weekEnd: Date
  days: Array<{
    date: string
    brutto: number
    netto: number
    count: number
  }>
  totals: RevenueData
}): string {
  const dayLines = data.days
    .map(
      (d) =>
        `  ${d.date}: ${formatRp(d.netto)} (${d.count} trx)`
    )
    .join('\n')

  // Find best & worst day
  const bestDay = [...data.days].sort((a, b) => b.netto - a.netto)[0]
  const worstDay = [...data.days].sort((a, b) => a.netto - b.netto)[0]

  return [
    `📈 <b>Laporan Mingguan</b>`,
    `📅 ${formatDateID(data.weekStart)} — ${formatDateID(data.weekEnd)}`,
    `🏪 ${data.outletName}`,
    ``,
    `📊 <b>Ringkasan 7 Hari:</b>`,
    dayLines,
    ``,
    `💰 <b>Total Brutto:</b> ${formatRp(data.totals.brutto)}`,
    `🏷️ <b>Total Diskon:</b> -${formatRp(data.totals.discount)}`,
    `✅ <b>Total Netto:</b> <b>${formatRp(data.totals.netto)}</b>`,
    `🧾 Total Transaksi: ${data.totals.transactionCount}`,
    `📈 Rata-rata/Hari: ${formatRp(data.totals.netto / Math.max(1, data.days.length))}`,
    ``,
    `🟢 Hari Terbaik: ${bestDay?.date || '-'} (${formatRp(bestDay?.netto || 0)})`,
    `🔴 Hari Terendah: ${worstDay?.date || '-'} (${formatRp(worstDay?.netto || 0)})`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Format monthly report
 */
export function formatMonthlyReportMessage(data: {
  outletName: string
  month: number  // 0-11
  year: number
  totalNetto: number
  totalBrutto: number
  totalDiscount: number
  transactionCount: number
  newCustomers: number
  topProducts: Array<{ name: string; qty: number; revenue: number }>
}): string {
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ]
  const monthName = monthNames[data.month]

  const productLines = data.topProducts
    .slice(0, 5)
    .map(
      (p, i) =>
        `  ${i + 1}. ${p.name} — ${p.qty}x = ${formatRp(p.revenue)}`
    )
    .join('\n')

  return [
    `📊 <b>Laporan Bulanan</b>`,
    `📅 ${monthName} ${data.year}`,
    `🏪 ${data.outletName}`,
    ``,
    `💰 <b>Total Brutto:</b> ${formatRp(data.totalBrutto)}`,
    `🏷️ <b>Total Diskon:</b> -${formatRp(data.totalDiscount)}`,
    `✅ <b>Total Netto:</b> <b>${formatRp(data.totalNetto)}</b>`,
    `🧾 Total Transaksi: ${data.transactionCount}`,
    `📈 Rata-rata/Trx: ${formatRp(data.totalNetto / Math.max(1, data.transactionCount))}`,
    `👤 Customer Baru: ${data.newCustomers}`,
    ``,
    data.topProducts.length > 0
      ? `🏆 <b>Top 5 Produk:</b>\n${productLines}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Quick daily summary (sent at end of day with just the key numbers)
 */
export function formatDailySummaryMessage(data: RevenueData & {
  outletName: string
  newCustomers: number
  lowStockCount: number
}): string {
  return [
    `🌙 <b>Ringkasan Hari Ini</b>`,
    `📅 ${formatDateID(new Date())}`,
    `🏪 ${data.outletName}`,
    ``,
    `💰 Netto: <b>${formatRp(data.netto)}</b>`,
    `🧾 ${data.transactionCount} transaksi`,
    `👤 ${data.newCustomers} customer baru`,
    data.lowStockCount > 0
      ? `⚠️ ${data.lowStockCount} produk stok rendah`
      : `✅ Semua stok aman`,
  ].join('\n')
}
// ============================================================
// Stock Alert Formatter
// ============================================================

export interface StockAlertItem {
  name: string
  stock: number
  lowStockAlert: number
  unit: string
  price: number
  categoryName?: string | null
  /** Estimated days until stock runs out based on recent sales velocity (null if no data) */
  daysUntilEmpty?: number | null
}

/**
 * Format stock alert notification for Telegram.
 * Separates out-of-stock and low-stock items clearly.
 */
export function formatStockAlertMessage(data: {
  outletName: string
  items: StockAlertItem[]
}): string {
  const outOfStock = data.items.filter((i) => i.stock <= 0)
  const lowStock = data.items.filter((i) => i.stock > 0 && i.stock <= i.lowStockAlert)

  // Sort low-stock by urgency (lowest stock first)
  lowStock.sort((a, b) => a.stock - b.stock)

  const lines: string[] = [
    `🚨 <b>Peringatan Stok</b>`,
    `📅 ${formatDateID(new Date())}`,
    `🏪 ${data.outletName}`,
    ``,
  ]

  if (outOfStock.length > 0) {
    lines.push(`🔴 <b>HABIS (${outOfStock.length} produk):</b>`)
    for (const item of outOfStock.slice(0, 15)) {
      lines.push(`  ❌ ${item.name} — <b>0 ${item.unit}</b>${item.categoryName ? ` [${item.categoryName}]` : ''}`)
    }
    if (outOfStock.length > 15) {
      lines.push(`  ...dan ${outOfStock.length - 15} produk lainnya`)
    }
    lines.push('')
  }

  if (lowStock.length > 0) {
    lines.push(`🟡 <b>STOK RENDAH (${lowStock.length} produk):</b>`)
    for (const item of lowStock.slice(0, 15)) {
      const urgency = item.stock <= item.lowStockAlert * 0.3 ? '‼️' : '⚠️'
      const forecast = item.daysUntilEmpty != null && item.daysUntilEmpty > 0
        ? ` • ~${item.daysUntilEmpty} hari lagi`
        : ''
      lines.push(
        `  ${urgency} ${item.name} — <b>${item.stock}/${item.lowStockAlert} ${item.unit}</b>${forecast}${item.categoryName ? ` [${item.categoryName}]` : ''}`
      )
    }
    if (lowStock.length > 15) {
      lines.push(`  ...dan ${lowStock.length - 15} produk lainnya`)
    }
    lines.push('')
  }

  if (outOfStock.length === 0 && lowStock.length === 0) {
    lines.push(`✅ Semua stok aman! Tidak ada produk yang perlu perhatian.`)
  } else {
    const total = outOfStock.length + lowStock.length
    lines.push(`💡 <b>${total}</b> produk butuh restock segera.`)
    lines.push(`🔗 Kelola stok di dashboard Aether POS`)
  }

  return lines.join('\n')
}

// ============================================================
// Insight Notification Formatter
// ============================================================

export interface InsightNotifyData {
  id: string
  title: string
  why: string
  actions: string[]
  priority: 'critical' | 'high' | 'medium' | 'low'
  emoji: string
  outletName: string
  healthScore: number
}

const PRIORITY_LABELS: Record<string, string> = {
  critical: '🔴 KRITIS',
  high: '🟠 TINGGI',
  medium: '🟡 SEDANG',
  low: '🟢 RENDAH',
}

/**
 * Format insight notification for Telegram.
 * Only sends actionable insights (not 'all-good' or low priority).
 */
export function formatInsightMessage(data: InsightNotifyData): string {
  const priorityLabel = PRIORITY_LABELS[data.priority] || '🟢 INFO'
  const actionLines = data.actions.slice(0, 3).map((a, i) => `  ${i + 1}. ${a}`).join('\n')

  return [
    `💡 <b>Insight Bisnis</b>`,
    `🕐 ${formatDateID(new Date())} • ${formatTime(new Date())}`,
    `🏪 ${data.outletName}`,
    ``,
    `${data.emoji} <b>${data.title}</b>`,
    `📂 Prioritas: ${priorityLabel}`,
    `❓ <i>${data.why}</i>`,
    ``,
    `🎯 <b>Aksi yang Disarankan:</b>`,
    actionLines,
    ``,
    `📊 Health Score: ${data.healthScore}/100`,
  ].join('\n')
}

/**
 * Format batch insight notification (multiple insights in one message).
 * Use this to avoid spamming — combine up to 3 insights per message.
 */
export function formatInsightBatchMessage(data: {
  insights: InsightNotifyData[]
  outletName: string
  healthScore: number
}): string {
  const lines: string[] = [
    `💡 <b>Insight Bisnis</b>`,
    `🕐 ${formatDateID(new Date())} • ${formatTime(new Date())}`,
    `🏪 ${data.outletName}`,
    `📊 Health Score: ${data.healthScore}/100`,
    ``,
  ]

  for (const insight of data.insights.slice(0, 5)) {
    const priorityLabel = PRIORITY_LABELS[insight.priority] || '🟢 INFO'
    const actionLine = insight.actions[0] || ''
    lines.push(`${insight.emoji} <b>${insight.title}</b> [${priorityLabel}]`)
    lines.push(`  └ ${actionLine}`)
    lines.push('')
  }

  lines.push('🔗 Lihat detail di dashboard Aether POS')
  return lines.join('\n')
}
