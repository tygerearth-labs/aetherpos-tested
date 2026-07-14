import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination, buildDateFilter } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    // Permission check: OWNER always allowed; CREW must have 'audit-log' in their assigned pages
    if (user.role !== 'OWNER') {
      const perm = await db.crewPermission.findUnique({
        where: { userId: user.id },
        select: { pages: true },
      })
      const allowedPages = perm?.pages?.split(',').map((p) => p.trim()) || []
      if (!allowedPages.includes('audit-log')) {
        return safeJsonError('Kamu tidak memiliki akses ke Audit Log', 403)
      }
    }
    const outletId = user.outletId

    const { searchParams } = request.nextUrl
    const { limit, skip } = parsePagination(searchParams)
    const action = searchParams.get('action') || ''
    const entityType = searchParams.get('entityType') || ''
    const dateFrom = searchParams.get('from') || ''
    const dateTo = searchParams.get('to') || ''
    const search = searchParams.get('search') || ''

    const where: Record<string, unknown> = { outletId }

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
      user: log.user
        ? { name: log.user.name, email: log.user.email }
        : { name: 'System', email: '-' },
    }))

    return safeJson({
      logs,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error('Audit logs GET error:', error)
    return safeJsonError('Failed to load audit logs')
  }
}
