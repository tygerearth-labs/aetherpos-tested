import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { FEFOEngine } from '@/lib/fefo-engine'
import { swr, invalidate } from '@/lib/cache'

/**
 * POST /api/inventory/batches/expiry-check
 *
 * Runs the expiry check engine:
 *   1. Marks newly expired batches (WRITE — kept in its own short transaction)
 *   2. Returns current expiry heatmap summary (READ — no transaction, cached)
 *
 * Called by cron job or manually (e.g., dashboard banner on load).
 *
 * ── Optimisation notes ──
 * Old code combined WRITE+READ in ONE transaction → easily hit Prisma's 5s
 * default timeout on cold compile. New code splits them:
 *   - WRITE: short transaction (1 updateMany), 50-80ms typical
 *   - READ:  cached 5 min via SWR, no transaction wrapper
 * When `markExpiredBatches` reports newly-expired batches, we invalidate the
 * cache so the next read picks up the change immediately.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const outletId = user.outletId

    // 1. WRITE: mark expired batches (atomic, short transaction)
    const newlyExpired = await db.$transaction(async (tx) => {
      return FEFOEngine.markExpiredBatches(tx, outletId)
    })

    // If we just marked new batches as expired, invalidate cached reads
    // so the heatmap we're about to return reflects the change.
    if (newlyExpired > 0) {
      invalidate(`heatmap:${outletId}`)
      invalidate(`freshness:${outletId}`)
      invalidate(`expirycheck:${outletId}`)
    }

    // 2. READ: heatmap (no transaction, SWR-cached 5 min)
    const heatmap = await swr(
      `expirycheck:${outletId}`,
      5 * 60 * 1000, // 5 minutes
      () => FEFOEngine.getExpiryHeatmap(db, outletId)
    )

    const criticalCount = heatmap.critical7d.length
    const warningCount = heatmap.warning30d.length

    // Calculate total potential loss
    const totalLoss = heatmap.expired.reduce(
      (sum, e) => sum + (e.totalLoss || 0),
      0
    )

    return safeJson({
      newlyExpired,
      criticalCount,
      warningCount,
      totalLoss,
      expiredItems: heatmap.expired.map((e) => ({
        itemName: e.itemName,
        batchNumber: e.batchNumber,
        remainingQty: e.remainingQty,
        expiredDate: e.expiredDate ? new Date(e.expiredDate).toISOString() : null,
        baseUnit: e.baseUnit,
        totalLoss: e.totalLoss,
      })),
      criticalItems: heatmap.critical7d.map((c) => ({
        itemName: c.itemName,
        batchNumber: c.batchNumber,
        remainingQty: c.remainingQty,
        daysUntilExpiry: c.daysUntilExpiry,
        baseUnit: c.baseUnit,
        expiredDate: c.expiredDate ? new Date(c.expiredDate).toISOString() : null,
      })),
    })
  } catch (error) {
    console.error('Expiry check error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Expiry check failed: ${msg}`)
  }
}
