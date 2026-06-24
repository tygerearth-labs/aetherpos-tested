import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { parsePagination, buildDateFilter, buildDateFilterTz, buildVoidMap, getVoidedTxIds } from '@/lib/api-helpers'
import { safeJson, safeJsonError } from '@/lib/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId

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
    const voidStatus = searchParams.get('voidStatus') || '' // 'void' or 'active'
    const sortField = searchParams.get('sortField') || 'createdAt'
    const sortDir = searchParams.get('sortDir') || 'desc'

    const where: Record<string, unknown> = { outletId }
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
      const voidedIdSet = await getVoidedTxIds(db, outletId)
      if (voidStatus === 'void') {
        where.id = { in: Array.from(voidedIdSet) as string[] }
      } else if (voidedIdSet.size > 0) {
        where.id = { notIn: Array.from(voidedIdSet) as string[] }
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

    // Get outlet name for display
    const outlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { name: true },
    })
    const outletName = outlet?.name || 'Outlet Saat Ini'

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
          customer: {
            select: { name: true },
          },
          user: {
            select: { id: true, name: true },
          },
          createdAt: true,
          items: {
            select: { id: true },
          },
        },
      }),
      db.transaction.count({ where }),
    ])

    // Fetch void info for these transactions in bulk
    const transactionIds = transactions.map((t) => t.id)
    const voidMap = await buildVoidMap(db, transactionIds, outletId)

    // H3: Map transactions with void info (no client-side filter needed now)
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
        outletName,
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
    })
  } catch (error) {
    console.error('Transactions GET error:', error)
    return safeJsonError('Failed to load transactions')
  }
}
