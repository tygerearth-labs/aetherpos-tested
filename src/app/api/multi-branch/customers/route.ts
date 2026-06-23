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
      return safeJsonError('Only owners can access multi-branch customer data', 403)
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
    const search = searchParams.get('search') || ''

    const effectiveOutletIds = outletFilter && outletIds.includes(outletFilter)
      ? [outletFilter]
      : outletIds

    // Start of current month for "new this month"
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Fetch outlet names
    const outletList = await db.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    })

    const outletMap = new Map(outletList.map(o => [o.id, o.name]))

    // Per-outlet summary stats
    const outletStats = await Promise.all(
      outletList.map(async (outlet) => {
        const oid = outlet.id
        const [countAgg, spendAgg, newCount] = await Promise.all([
          db.customer.count({ where: { outletId: oid } }),
          db.customer.aggregate({
            where: { outletId: oid },
            _sum: { totalSpend: true },
          }),
          db.customer.count({
            where: { outletId: oid, createdAt: { gte: monthStart } },
          }),
        ])

        return {
          outletId: oid,
          outletName: outlet.name,
          totalCustomers: countAgg,
          totalSpend: spendAgg._sum.totalSpend ?? 0,
          newThisMonth: newCount,
        }
      })
    )

    // Fetch customer list with pagination
    const page = parseInt(searchParams.get('page') || '1')
    const limit = 20
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {
      outletId: { in: effectiveOutletIds },
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { whatsapp: { contains: search } },
      ]
    }

    const [customers, total] = await Promise.all([
      db.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          whatsapp: true,
          totalSpend: true,
          points: true,
          outletId: true,
          createdAt: true,
          _count: {
            select: { transactions: true },
          },
        },
      }),
      db.customer.count({ where }),
    ])

    const mappedCustomers = customers.map(c => ({
      id: c.id,
      name: c.name,
      whatsapp: c.whatsapp,
      totalSpend: c.totalSpend,
      points: c.points,
      outletId: c.outletId,
      outletName: outletMap.get(c.outletId) ?? 'Unknown',
      transactionCount: c._count.transactions,
      createdAt: c.createdAt,
    }))

    // Top customers per outlet (for canvassing highlight)
    const topCustomers = await db.customer.findMany({
      where: { outletId: { in: outletIds } },
      orderBy: { totalSpend: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        totalSpend: true,
        outletId: true,
        _count: { select: { transactions: true } },
      },
    })

    const mappedTop = topCustomers.map(c => ({
      id: c.id,
      name: c.name,
      totalSpend: c.totalSpend,
      outletId: c.outletId,
      outletName: outletMap.get(c.outletId) ?? 'Unknown',
      transactionCount: c._count.transactions,
    }))

    // Combined stats
    const combined = {
      totalCustomers: outletStats.reduce((s, o) => s + o.totalCustomers, 0),
      totalSpend: outletStats.reduce((s, o) => s + o.totalSpend, 0),
      newThisMonth: outletStats.reduce((s, o) => s + o.newThisMonth, 0),
    }

    return safeJson({
      customers: mappedCustomers,
      totalPages: Math.ceil(total / limit) || 1,
      outletStats,
      topCustomers: mappedTop,
      combined,
      outlets: outletList,
    })
  } catch (error) {
    console.error('[/api/multi-branch/customers] GET error:', error)
    return safeJsonError('Failed to load customer data')
  }
}