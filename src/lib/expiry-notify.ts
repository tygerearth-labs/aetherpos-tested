/**
 * expiry-notify.ts — Expiry Alert Notification Service
 *
 * Sends Telegram notifications for expired and soon-to-expire batches.
 * Follows the same fire-and-forget pattern as notify.ts.
 *
 * Usage:
 *   import { sendExpiryAlert } from '@/lib/expiry-notify'
 *   await sendExpiryAlert(outletId)
 */

import { db } from '@/lib/db'
import { FEFOEngine } from '@/lib/fefo-engine'
import { sendTelegramMessage } from '@/lib/telegram'

// ============================================================
// Rate Limiting (In-Memory)
// ============================================================

const EXPIRY_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes between alerts per outlet
const lastSentMap = new Map<string, number>()

function shouldSendExpiry(outletId: string): boolean {
  const lastSent = lastSentMap.get(outletId)
  if (lastSent && Date.now() - lastSent < EXPIRY_COOLDOWN_MS) {
    return false
  }
  return true
}

function markExpirySent(outletId: string): void {
  lastSentMap.set(outletId, Date.now())
}

// ============================================================
// Helpers
// ============================================================

/** Format currency as IDR */
function formatRp(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`
}

/** Format date in short Indonesian style: "20 Aug" */
function formatShortDate(date: Date): string {
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
  })
}

// ============================================================
// Public Function
// ============================================================

/**
 * Send Telegram expiry alert for an outlet.
 *
 * 1. Runs markExpiredBatches + getExpiryHeatmap
 * 2. If there are expired or critical items, formats & sends Telegram message
 * 3. Rate-limited: won't send more than once per 30 minutes per outlet
 *
 * @returns { sent: boolean; skipped: boolean; reason?: string }
 */
export async function sendExpiryAlert(
  outletId: string
): Promise<{ sent: boolean; skipped: boolean; reason?: string }> {
  // Rate limit check
  if (!shouldSendExpiry(outletId)) {
    return { sent: false, skipped: true, reason: 'Rate limited (cooldown 30 menit)' }
  }

  try {
    // Get Telegram config
    const setting = await db.outletSetting.findUnique({
      where: { outletId },
      select: {
        telegramChatId: true,
        telegramBotToken: true,
        outlet: { select: { name: true } },
      },
    })

    if (!setting?.telegramChatId) {
      return { sent: false, skipped: true, reason: 'Telegram belum dikonfigurasi' }
    }

    // Run expiry check
    const { heatmap, newlyExpired } = await db.$transaction(async (tx) => {
      const newlyExpired = await FEFOEngine.markExpiredBatches(tx, outletId)
      const heatmap = await FEFOEngine.getExpiryHeatmap(tx, outletId)
      return { newlyExpired, heatmap }
    })

    const hasExpired = heatmap.expired.length > 0
    const hasCritical = heatmap.critical7d.length > 0

    // Nothing to alert
    if (!hasExpired && !hasCritical) {
      return { sent: false, skipped: true, reason: 'Tidak ada batch expired/kritis' }
    }

    // Build Telegram message
    const lines: string[] = [
      `⚠️ <b>AETHER POS — Peringatan Kadaluarsa</b>`,
      `📅 ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      `🏪 ${setting.outlet?.name || 'Outlet'}`,
      ``,
    ]

    // Expired section
    if (hasExpired) {
      lines.push(`🔴 <b>${heatmap.expired.length} Batch sudah expired:</b>`)
      for (const item of heatmap.expired.slice(0, 10)) {
        const dateStr = item.expiredDate
          ? formatShortDate(new Date(item.expiredDate))
          : 'tanpa tanggal'
        lines.push(
          `  • ${item.itemName} (${item.batchNumber}) — ${item.remainingQty} ${item.baseUnit} — Exp: ${dateStr}`
        )
      }
      if (heatmap.expired.length > 10) {
        lines.push(`  ...dan ${heatmap.expired.length - 10} batch lainnya`)
      }
      lines.push('')
    }

    // Critical section (< 7 days)
    if (hasCritical) {
      lines.push(`🔥 <b>${heatmap.critical7d.length} Batch expired < 7 hari:</b>`)
      for (const item of heatmap.critical7d.slice(0, 10)) {
        const dateStr = item.expiredDate
          ? formatShortDate(new Date(item.expiredDate))
          : 'tanpa tanggal'
        lines.push(
          `  • ${item.itemName} (${item.batchNumber}) — ${item.remainingQty} ${item.baseUnit} — Exp: ${dateStr} (${item.daysUntilExpiry} hari)`
        )
      }
      if (heatmap.critical7d.length > 10) {
        lines.push(`  ...dan ${heatmap.critical7d.length - 10} batch lainnya`)
      }
      lines.push('')
    }

    // Total potential loss
    const totalLoss = heatmap.expired.reduce(
      (sum, e) => sum + (e.totalLoss || 0),
      0
    )
    if (totalLoss > 0) {
      lines.push(`💡 Total potensi kerugian: <b>${formatRp(totalLoss)}</b>`)
    }

    if (newlyExpired > 0) {
      lines.push(`🔄 ${newlyExpired} batch baru saja ditandai expired`)
    }

    const message = lines.join('\n')

    const result = await sendTelegramMessage(setting.telegramChatId, message, {
      botToken: setting.telegramBotToken || undefined,
    })

    if (result.ok) {
      markExpirySent(outletId)
      console.log(`[expiry-notify] ✅ Expiry alert sent for outlet ${outletId} (${setting.telegramChatId})`)
    } else {
      console.error(`[expiry-notify] ❌ Failed to send: ${result.error}`)
    }

    return { sent: result.ok, skipped: false, reason: result.error }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[expiry-notify] Error for outlet ${outletId}:`, msg)
    return { sent: false, skipped: false, reason: msg }
  }
}