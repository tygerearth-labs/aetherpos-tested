import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { FEFOEngine } from '@/lib/fefo-engine'

/**
 * POST /api/inventory/batches/expiry-check
 *
 * Runs the expiry check engine:
 *   1. Marks newly expired batches
 *   2. Returns current expiry heatmap summary
 *
 * Called by cron job or manually (e.g., dashboard banner on load).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const outletId = user.outletId

    // Run markExpiredBatches + getExpiryHeatmap in a single transaction
    const { newlyExpired, heatmap } = await db.$transaction(async (tx) => {
      const newlyExpired = await FEFOEngine.markExpiredBatches(tx, outletId)
      const heatmap = await FEFOEngine.getExpiryHeatmap(tx, outletId)
      return { newlyExpired, heatmap }
    })

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