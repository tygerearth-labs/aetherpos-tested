import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

/**
 * GET /api/enterprise/inventory-prediction
 *
 * Enterprise-only endpoint.
 * Returns inventory prediction data for all outlets in the group:
 * - Each inventory item's current stock
 * - Daily consumption rate (based on last 14/30 days)
 * - Predicted days until stock runs out
 * - Transaction intensity (tx/day for the outlet)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Owner only', 403)

    // Check enterprise plan
    const outlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { accountType: true, groupId: true },
    })

    if (!outlet) return safeJsonError('Outlet not found', 404)

    const rawPlan = outlet.accountType.startsWith('suspended:')
      ? outlet.accountType.replace('suspended:', '')
      : outlet.accountType

    if (rawPlan !== 'enterprise') {
      return safeJsonError('Enterprise plan required', 403)
    }

    if (!outlet.groupId) {
      return safeJsonError('Outlet tidak tergabung dalam grup', 400)
    }

    // Fetch all outlets in the group
    const group = await db.outletGroup.findUnique({
      where: { id: outlet.groupId },
      include: {
        outlets: {
          select: { id: true, name: true, isMain: true },
          orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
        },
      },
    })

    if (!group) return safeJsonError('Grup outlet tidak ditemukan', 404)

    // Fetch inventory predictions per outlet
    const outletPredictions = await Promise.all(
      group.outlets.map(async (outletInfo) => {
        const outletId = outletInfo.id
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)

        const [inventoryItems, consumptionData, txData] = await Promise.all([
          // All inventory items for this outlet
          db.inventoryItem.findMany({
            where: { outletId },
            select: {
              id: true,
              name: true,
              stock: true,
              lowStockAlert: true,
              avgCost: true,
              baseUnit: true,
              category: { select: { name: true, color: true } },
            },
          }),

          // Consumption (CONSUMPTION movements) in last 30 days
          db.inventoryMovement.groupBy({
            by: ['inventoryItemId'],
            where: {
              outletId,
              type: 'CONSUMPTION',
              createdAt: { gte: thirtyDaysAgo },
            },
            _sum: { quantity: true },
            _count: true,
          }),

          // Transaction count in last 30 days for intensity
          db.transaction.count({
            where: {
              outletId,
              createdAt: { gte: thirtyDaysAgo },
            },
          }),
        ])

        const consumptionMap = new Map(
          consumptionData.map((c) => [c.inventoryItemId, { total: c._sum.quantity ?? 0, count: c._count }])
        )

        const txIntensity = txData / 30 // average transactions per day

        const predictions = inventoryItems
          .map((item) => {
            const consumption = consumptionMap.get(item.id)
            const consumed30d = Math.abs(consumption?.total ?? 0)
            const dailyConsumption = consumed30d / 30
            const daysUntilEmpty = dailyConsumption > 0 ? item.stock / dailyConsumption : null

            let status: 'critical' | 'warning' | 'healthy' | 'idle' = 'idle'
            if (daysUntilEmpty !== null) {
              if (daysUntilEmpty <= 3) status = 'critical'
              else if (daysUntilEmpty <= 7) status = 'warning'
              else status = 'healthy'
            }

            return {
              id: item.id,
              name: item.name,
              stock: item.stock,
              lowStockAlert: item.lowStockAlert,
              avgCost: item.avgCost,
              baseUnit: item.baseUnit,
              category: item.category?.name ?? null,
              categoryColor: item.category?.color ?? 'zinc',
              consumed30d: Math.round(consumed30d * 100) / 100,
              dailyConsumption: Math.round(dailyConsumption * 100) / 100,
              daysUntilEmpty: daysUntilEmpty !== null ? Math.round(daysUntilEmpty * 10) / 10 : null,
              status,
              stockValue: Math.round(item.stock * item.avgCost),
            }
          })
          .sort((a, b) => {
            // Sort: critical first, then by days until empty
            const statusOrder = { critical: 0, warning: 1, healthy: 2, idle: 3 }
            const aOrder = statusOrder[a.status]
            const bOrder = statusOrder[b.status]
            if (aOrder !== bOrder) return aOrder - bOrder
            return (a.daysUntilEmpty ?? 9999) - (b.daysUntilEmpty ?? 9999)
          })

        const criticalCount = predictions.filter((p) => p.status === 'critical').length
        const warningCount = predictions.filter((p) => p.status === 'warning').length
        const totalStockValue = predictions.reduce((s, p) => s + p.stockValue, 0)

        return {
          id: outletInfo.id,
          name: outletInfo.name,
          isMain: outletInfo.isMain,
          txIntensity: Math.round(txIntensity * 10) / 10,
          totalItems: predictions.length,
          criticalCount,
          warningCount,
          totalStockValue,
          predictions,
        }
      })
    )

    // Aggregate totals
    const totalCritical = outletPredictions.reduce((s, o) => s + o.criticalCount, 0)
    const totalWarning = outletPredictions.reduce((s, o) => s + o.warningCount, 0)
    const totalStockValue = outletPredictions.reduce((s, o) => s + o.totalStockValue, 0)

    return safeJson(
      {
        outlets: outletPredictions,
        totalCritical,
        totalWarning,
        totalStockValue,
      },
      200,
      CACHE.MEDIUM,
    )
  } catch (error) {
    console.error('[/api/enterprise/inventory-prediction] error:', error)
    return safeJsonError('Failed to load inventory predictions')
  }
}