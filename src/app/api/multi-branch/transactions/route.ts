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
      return safeJsonError('Only owners can access multi-branch data', 403)
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
    const { limit, skip } = parsePagination(searchParams, { limit: 20 })
    const outletFilter = searchParams.get('outletId') || ''
    const search = searchParams.get('search') || ''
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''
    const paymentMethod = searchParams.get('paymentMethod') || ''
    const sortField = searchParams.get('sortField') || 'createdAt'
    const sortDir = searchParams.get('sortDir') || 'desc'

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

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { customer: { name: { contains: search } } },
      ]
    }

    const dateFilter = buildDateFilter(dateFrom || null, dateTo || null)
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter
    }

    if (paymentMethod) {
      where.paymentMethod = paymentMethod
    }

    // Build sort
    const validSortFields = ['createdAt', 'total', 'invoiceNumber', 'paymentMethod'] as const
    const safeSortField = validSortFields.includes(sortField as any) ? sortField : 'createdAt'
    const safeSortDir = sortDir === 'asc' ? 'asc' : 'desc'
    const orderBy: Record<string, string> = { [safeSortField]: safeSortDir }

    const [transactions, total] = await Promise.all([
      db.transaction.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          invoiceNumber: true,
          subtotal: true,
          total: true,
          paymentMethod: true,
          customer: { select: { name: true } },
          user: { select: { name: true } },
          outlet: { select: { name: true, id: true } },
          createdAt: true,
        },
      }),
      db.transaction.count({ where }),
    ])

    const mappedTransactions = transactions.map((t) => ({
      id: t.id,
      invoiceNumber: t.invoiceNumber,
      subtotal: t.subtotal,
      total: t.total,
      paymentMethod: t.paymentMethod,
      customerName: t.customer?.name ?? null,
      cashierName: t.user?.name ?? null,
      outletName: t.outlet.name,
      outletId: t.outlet.id,
      createdAt: t.createdAt,
    }))

    // Outlets list for filter dropdown
    const outletList = await db.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    return safeJson({
      transactions: mappedTransactions,
      totalPages: Math.ceil(total / limit),
      outlets: outletList,
    })
  } catch (error) {
    console.error('[/api/multi-branch/transactions] GET error:', error)
    return safeJsonError('Failed to load transactions')
  }
}