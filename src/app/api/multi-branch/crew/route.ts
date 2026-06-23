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
      return safeJsonError('Only owners can access multi-branch crew data', 403)
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

    const { searchParams } = request.nextUrl
    const outletFilter = searchParams.get('outletId') || ''

    const effectiveOutletIds = outletFilter && outletIds.includes(outletFilter)
      ? [outletFilter]
      : outletIds

    // Today start for "today's transactions"
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // Start of current month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Fetch all crew (non-owner users) across all owner outlets
    const crew = await db.user.findMany({
      where: {
        outletId: { in: effectiveOutletIds },
        role: 'CREW',
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        outletId: true,
        createdAt: true,
        crewPermission: {
          select: { pages: true },
        },
        outlet: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Fetch transaction performance for each crew member
    const crewPerformance = await Promise.all(
      crew.map(async (c) => {
        const [allTimeAgg, monthAgg, todayCount] = await Promise.all([
          db.transaction.aggregate({
            where: { userId: c.id, outletId: c.outletId },
            _count: true,
            _sum: { total: true },
          }),
          db.transaction.aggregate({
            where: { userId: c.id, outletId: c.outletId, createdAt: { gte: monthStart } },
            _count: true,
            _sum: { total: true },
          }),
          db.transaction.count({
            where: { userId: c.id, outletId: c.outletId, createdAt: { gte: todayStart } },
          }),
        ])

        return {
          crewId: c.id,
          totalTransactions: allTimeAgg._count,
          totalRevenue: allTimeAgg._sum.total ?? 0,
          monthTransactions: monthAgg._count,
          monthRevenue: monthAgg._sum.total ?? 0,
          todayTransactions: todayCount,
        }
      })
    )

    const perfMap = new Map(crewPerformance.map(p => [p.crewId, p]))

    const mappedCrew = crew.map((c) => {
      const perf = perfMap.get(c.id)
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        role: c.role,
        outletId: c.outletId,
        outletName: c.outlet.name,
        joinDate: c.createdAt,
        permissions: c.crewPermission?.pages ?? 'pos',
        // Performance metrics
        totalTransactions: perf?.totalTransactions ?? 0,
        totalRevenue: perf?.totalRevenue ?? 0,
        monthTransactions: perf?.monthTransactions ?? 0,
        monthRevenue: perf?.monthRevenue ?? 0,
        todayTransactions: perf?.todayTransactions ?? 0,
      }
    })

    // Outlets list for reference
    const outletList = await db.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    // Per-outlet crew summary
    const outletCrewSummary = await Promise.all(
      outletList.map(async (outlet) => {
        const oid = outlet.id
        const [crewCount, outletTxAgg] = await Promise.all([
          db.user.count({ where: { outletId: oid, role: 'CREW' } }),
          db.transaction.aggregate({
            where: { outletId: oid },
            _count: true,
            _sum: { total: true },
          }),
        ])

        return {
          outletId: oid,
          outletName: outlet.name,
          crewCount,
          outletTotalTransactions: outletTxAgg._count,
          outletTotalRevenue: outletTxAgg._sum.total ?? 0,
        }
      })
    )

    return safeJson({
      crew: mappedCrew,
      outlets: outletList,
      outletSummary: outletCrewSummary,
    })
  } catch (error) {
    console.error('[/api/multi-branch/crew] GET error:', error)
    return safeJsonError('Failed to load crew')
  }
}