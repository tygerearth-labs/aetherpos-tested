import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getOutletPlan } from '@/lib/plan-config'
import { safeJson, safeJsonError } from '@/lib/safe-response'

// Helper to get all outlet IDs for the current owner
async function getOwnerOutletIds(email: string): Promise<string[]> {
  const owners = await db.user.findMany({
    where: { email, role: 'OWNER' },
    select: { outletId: true },
  })
  return owners.map(o => o.outletId)
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Only owners can access multi-branch dashboard', 403)
    }

    // Enterprise plan check
    const planData = await getOutletPlan(user.outletId, db)
    if (!planData || planData.plan !== 'enterprise') {
      return safeJsonError('Multi-branch management requires an enterprise plan', 403)
    }

    const outletIds = await getOwnerOutletIds(user.email!)
    if (outletIds.length === 0) {
      return safeJsonError('No outlets found', 404)
    }

    // Today start (UTC)
    const now = new Date()
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))

    // Fetch all outlets belonging to this owner
    const outlets = await db.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, name: true },
    })

    // For each outlet, compute stats in parallel
    const outletStats = await Promise.all(
      outlets.map(async (outlet) => {
        const outletId = outlet.id

        // All-time stats
        const [revenueAgg, txCount, productCount, crewCount] = await Promise.all([
          db.transaction.aggregate({
            where: { outletId },
            _sum: { total: true },
          }),
          db.transaction.count({ where: { outletId } }),
          db.product.count({ where: { outletId } }),
          db.user.count({ where: { outletId, role: 'CREW' } }),
        ])

        // Today's stats
        const todayTxs = await db.transaction.findMany({
          where: {
            outletId,
            createdAt: { gte: todayStart },
          },
          select: { total: true, id: true },
        })

        const todayRevenue = todayTxs.reduce((sum, t) => sum + t.total, 0)
        const todayTransactions = todayTxs.length

        return {
          id: outlet.id,
          name: outlet.name,
          todayRevenue,
          todayTransactions,
          totalRevenue: revenueAgg._sum.total ?? 0,
          totalTransactions: txCount,
          productCount,
          crewCount,
        }
      })
    )

    // Count low-stock products across all outlets
    const allLowStockProducts = await db.product.findMany({
      where: {
        outletId: { in: outletIds },
      },
      select: { id: true, lowStockAlert: true, stock: true, hasVariants: true, outletId: true, variants: { select: { stock: true } } },
    })

    let lowStockAlerts = 0
    for (const p of allLowStockProducts) {
      const aggStock = p.hasVariants && p.variants.length > 0
        ? p.variants.reduce((s, v) => s + v.stock, 0)
        : p.stock
      if (aggStock <= p.lowStockAlert) {
        lowStockAlerts++
      }
    }

    // Combined stats
    const combined = {
      totalRevenue: outletStats.reduce((s, o) => s + o.totalRevenue, 0),
      totalTransactions: outletStats.reduce((s, o) => s + o.totalTransactions, 0),
      totalProducts: outletStats.reduce((s, o) => s + o.productCount, 0),
      totalCrew: outletStats.reduce((s, o) => s + o.crewCount, 0),
      todayRevenue: outletStats.reduce((s, o) => s + o.todayRevenue, 0),
      todayTransactions: outletStats.reduce((s, o) => s + o.todayTransactions, 0),
    }

    return safeJson({
      outlets: outletStats,
      combined,
      lowStockAlerts,
    })
  } catch (error) {
    console.error('[/api/multi-branch/dashboard] GET error:', error)
    return safeJsonError('Failed to load multi-branch dashboard')
  }
}