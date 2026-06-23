import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { parsePagination, buildDateFilter, buildDateFilterTz, buildVoidMap, getVoidedTxIds } from '@/lib/api-helpers'
import { getOwnerOutlets, getOwnerOutletIds } from '@/lib/multi-outlet'
import { safeJson, safeJsonError } from '@/lib/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }

    const { searchParams } = request.nextUrl
    const { page, limit, skip } = parsePagination(searchParams, { limit: 20 })
    const search = searchParams.get('search') || ''
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''
    const dateFromMs = searchParams.get('dateFromMs') || ''
    const dateToMs = searchParams.get('dateToMs') || ''
    const tzOffset = searchParams.get('tzOffset') ? Number(searchParams.get('tzOffset')) : null
    const cashierId = searchParams.get('cashierId') || ''
    const paymentMethod = searchParams.get('paymentMethod') || ''
    const voidStatus = searchParams.get('voidStatus') || ''
    const sortField = searchParams.get('sortField') || 'createdAt'
    const sortDir = searchParams.get('sortDir') || 'desc'
    const outletFilter = searchParams.get('outletId') || ''

    // Multi-outlet support for OWNER
    let effectiveOutletIds: string[]
    let outlets: { id: string; name: string }[] = []

    if (user.role === 'OWNER' && user.email) {
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
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { customer: { name: { contains: search } } },
      ]
    }

    // Use timezone-aware filter if tzOffset is provided, else fall back to legacy
    let dateFilter: Record<string, Date>
    if (tzOffset !== null && !isNaN(tzOffset)) {
      dateFilter = buildDateFilterTz(dateFrom || null, dateTo || null, tzOffset)
    } else {
      dateFilter = buildDateFilter(dateFrom || null, dateTo || null, dateFromMs || null, dateToMs || null)
    }
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter
    }

    if (cashierId) {
      where.userId = cashierId
    }
    if (paymentMethod) {
      where.paymentMethod = paymentMethod
    }

    // H3: If voidStatus filter, apply at DB level for accurate pagination
    if (voidStatus === 'void' || voidStatus === 'active') {
      // Need to check across all effective outlets
      const allVoidedIds = new Set<string>()
      for (const oid of effectiveOutletIds) {
        const voidedSet = await getVoidedTxIds(db, oid)
        for (const vid of voidedSet) allVoidedIds.add(vid)
      }
      const voidedArr = Array.from(allVoidedIds)
      if (voidStatus === 'void') {
        where.id = { in: voidedArr }
      } else if (voidedArr.length > 0) {
        where.id = { notIn: voidedArr }
      }
    }

    // Build dynamic orderBy
    const validSortFields = ['createdAt', 'total', 'invoiceNumber', 'paymentMethod'] as const
    const safeSortField = validSortFields.includes(sortField as any) ? sortField : 'createdAt'
    const safeSortDir = sortDir === 'asc' ? 'asc' : 'desc'
    const orderBy: Record<string, string> = { [safeSortField]: safeSortDir }

    // For customer sort, need to use relation
    let customerOrderBy: any = undefined
    if (sortField === 'customerName') {
      customerOrderBy = { customer: { name: sortDir === 'asc' ? 'asc' : 'desc' } }
      delete orderBy.customerName
    }

    const [transactions, total] = await Promise.all([
      db.transaction.findMany({
        where,
        orderBy: customerOrderBy || orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          invoiceNumber: true,
          subtotal: true,
          discount: true,
          taxAmount: true,
          total: true,
          paymentMethod: true,
          paidAmount: true,
          change: true,
          outletId: true,
          customer: {
            select: { name: true },
          },
          user: {
            select: { id: true, name: true },
          },
          outlet: {
            select: { name: true },
          },
          createdAt: true,
          items: {
            select: { id: true },
          },
        },
      }),
      db.transaction.count({ where }),
    ])

    // Fetch void info
    const transactionIds = transactions.map((t) => t.id)
    const voidMap = new Map<string, { reason: string }>()
    for (const oid of effectiveOutletIds) {
      const txVoidMap = await buildVoidMap(db, transactionIds, oid)
      for (const [k, v] of txVoidMap) voidMap.set(k, v)
    }

    const mappedTransactions = transactions.map((t) => {
      const voidInfo = voidMap.get(t.id)
      return {
        id: t.id,
        invoiceNumber: t.invoiceNumber,
        subtotal: t.subtotal,
        discount: t.discount,
        taxAmount: t.taxAmount,
        total: t.total,
        paymentMethod: t.paymentMethod,
        paidAmount: t.paidAmount,
        change: t.change,
        customerName: t.customer?.name ?? null,
        cashierName: t.user?.name ?? null,
        cashierId: t.user?.id ?? null,
        outletName: t.outlet?.name ?? null,
        outletId: t.outletId,
        createdAt: t.createdAt,
        _count: { items: t.items.length },
        voidStatus: voidInfo ? 'void' : 'active',
        voidReason: voidInfo?.reason || null,
        syncStatus: 'synced' as const,
      }
    })

    return safeJson({
      transactions: mappedTransactions,
      totalPages: Math.ceil(total / limit),
      ...(outlets.length > 1 ? { outlets } : {}),
    })
  } catch (error) {
    console.error('Transactions GET error:', error)
    return safeJsonError('Failed to load transactions')
  }
}