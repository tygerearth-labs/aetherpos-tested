import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination, buildDateFilter, withInsensitiveMode } from '@/lib/api/api-helpers'
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
    const eventType = searchParams.get('eventType') || ''
    const dateFrom = searchParams.get('from') || ''
    const dateTo = searchParams.get('to') || ''
    const search = searchParams.get('search') || ''

    const where: Record<string, unknown> = { outletId }

    // AUDIT-V2 TECHNICAL MARKER FILTER:
    // SYNC_DEDUP and STOCK_OPNAME_DEDUP are TECHNICAL idempotency markers
    // stored as AuditLog rows (they back the partial-unique-index dedup pattern
    // for offline transaction sync and stock opname). They are NOT business
    // audit events and must NEVER appear in the visible audit feed — otherwise
    // every synced transaction would show a "SYNC_DEDUP · SYNC_EVENT" spam row
    // alongside its single SALE V2 event.
    //
    // The rows remain in the DB (the unique index needs them); we only hide
    // them from the API response. Historical legacy rows (action=SALE · PRODUCT
    // etc. from pre-V2) are NOT filtered — they stay visible in the Legacy tab.
    where.action = { notIn: ['SYNC_DEDUP', 'STOCK_OPNAME_DEDUP'] }

    // V2: filter by eventType (preferred). Keep V1 action/entityType filters
    // for backward compatibility with existing UI tabs.
    if (eventType && eventType !== 'ALL') {
      where.eventType = eventType
    } else {
      if (action && action !== 'ALL') {
        // Caller explicitly wants a specific action — drop the technical-marker
        // exclusion so they can still query SYNC_DEDUP if they really need to.
        where.action = action
      }
      if (entityType && entityType !== 'ALL') {
        where.entityType = entityType
      }
    }
    const dateFilter = buildDateFilter(dateFrom, dateTo)
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter
    }
    if (search) {
      where.OR = withInsensitiveMode([
        { title: { contains: search } },
        { summary: { contains: search } },
        { details: { contains: search } },
        { user: { name: { contains: search } } },
        { entityType: { contains: search } },
        { action: { contains: search } },
      ]) as Record<string, unknown>[]
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
      // V1 (kept for backward compat)
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      details: log.details,
      // V2 event-oriented
      eventType: log.eventType,
      title: log.title,
      summary: log.summary,
      sections: log.sections,
      metadata: log.metadata,
      operationId: log.operationId,
      sourceEntityType: log.sourceEntityType,
      sourceEntityId: log.sourceEntityId,
      createdAt: log.createdAt,
      user: log.user
        ? { name: log.user.name, email: log.user.email }
        : { name: 'System', email: '-' },
    }))

    return safeJson({
      logs,
      total,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error('Audit logs GET error:', error)
    return safeJsonError('Failed to load audit logs')
  }
}
