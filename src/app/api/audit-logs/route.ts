import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { parsePagination, buildDateFilter } from '@/lib/api-helpers'
import { getOwnerOutlets } from '@/lib/multi-outlet'
import { safeJson, safeJsonError } from '@/lib/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    // Security: Only OWNER can view full audit logs
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat melihat audit log', 403)
    }

    const { searchParams } = request.nextUrl
    const { limit, skip } = parsePagination(searchParams)
    const action = searchParams.get('action') || ''
    const entityType = searchParams.get('entityType') || ''
    const dateFrom = searchParams.get('from') || ''
    const dateTo = searchParams.get('to') || ''
    const search = searchParams.get('search') || ''
    const outletFilter = searchParams.get('outletId') || ''

    // Multi-outlet support
    let effectiveOutletIds: string[]
    let outlets: { id: string; name: string }[] = []

    if (user.email) {
      const multiOutlet = await getOwnerOutlets(db, user.email, user.outletId)
      if (multiOutlet) {
        outlets = multiOutlet.outlets
        if (outletFilter && multiOutlet.outletIds.includes(outletFilter)) {
          effectiveOutletIds = [outletFilter]
        } else {
          effectiveOutletIds = multiOutlet.outletIds
        }
      } else {
        effectiveOutletIds = [user.outletId]
        outlets = [{ id: user.outletId, name: 'Outlet Saat Ini' }]
      }
    } else {
      effectiveOutletIds = [user.outletId]
    }

    const where: Record<string, unknown> = { outletId: { in: effectiveOutletIds } }

    if (action && action !== 'ALL') {
      where.action = action
    }
    if (entityType && entityType !== 'ALL') {
      where.entityType = entityType
    }
    const dateFilter = buildDateFilter(dateFrom, dateTo)
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
          user: {
            select: { name: true, email: true },
          },
          outlet: {
            select: { name: true },
          },
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
      outletName: log.outlet?.name ?? null,
      createdAt: log.createdAt,
      user: log.user
        ? { name: log.user.name, email: log.user.email }
        : { name: 'System', email: '-' },
    }))

    return safeJson({
      logs,
      totalPages: Math.ceil(total / limit),
      ...(outlets.length > 1 ? { outlets } : {}),
    })
  } catch (error) {
    console.error('Audit logs GET error:', error)
    return safeJsonError('Failed to load audit logs')
  }
}