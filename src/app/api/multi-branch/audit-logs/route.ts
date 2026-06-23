import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { parsePagination, buildDateFilter } from '@/lib/api-helpers'
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
      return safeJsonError('Only owners can access multi-branch audit logs', 403)
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
    const { limit, skip } = parsePagination(searchParams)
    const outletFilter = searchParams.get('outletId') || ''
    const action = searchParams.get('action') || ''
    const entityType = searchParams.get('entityType') || ''
    const search = searchParams.get('search') || ''
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''

    // Determine which outlet IDs to query
    let targetOutletIds = outletIds
    if (outletFilter) {
      if (!outletIds.includes(outletFilter)) {
        return safeJsonError('Outlet not found or not owned by you', 403)
      }
      targetOutletIds = [outletFilter]
    }

    // Build where clause
    const where: Record<string, unknown> = {
      outletId: { in: targetOutletIds },
    }

    if (action && action !== 'ALL') {
      where.action = action
    }
    if (entityType && entityType !== 'ALL') {
      where.entityType = entityType
    }

    const dateFilter = buildDateFilter(dateFrom || null, dateTo || null)
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter
    }

    if (search) {
      where.OR = [
        { details: { contains: search } },
        { user: { name: { contains: search } } },
        { entityType: { contains: search } },
        { action: { contains: search } },
      ]
    }

    const [data, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: { select: { name: true, email: true } },
          outlet: { select: { name: true, id: true } },
        },
      }),
      db.auditLog.count({ where }),
    ])

    const logs = data.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      details: log.details,
      createdAt: log.createdAt,
      outletName: log.outlet?.name ?? 'Unknown',
      outletId: log.outletId,
      userName: log.user?.name ?? 'System',
    }))

    // Outlets list for filter dropdown
    const outletList = await db.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    return safeJson({
      logs,
      totalPages: Math.ceil(total / limit),
      outlets: outletList,
    })
  } catch (error) {
    console.error('[/api/multi-branch/audit-logs] GET error:', error)
    return safeJsonError('Failed to load audit logs')
  }
}