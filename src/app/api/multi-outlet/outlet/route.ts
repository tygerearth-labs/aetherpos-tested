import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parseTzOffset, buildDateFilterTz, getTodayRangeTz, getVoidedTxIds } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

/**
 * GET /api/multi-outlet/outlet?outletId=xxx&tab=transactions|customers|products
 *
 * Drill-down into a specific outlet's data from the multi-outlet terminal.
 * Only accessible by OWNER of the main outlet in the same group.
 *
 * Query params:
 * - outletId (required): the target outlet to inspect
 * - tab: transactions | customers | products (default: transactions)
 * - period: today, 7days, 30days
 * - dateFrom, dateTo: explicit date range
 * - tzOffset: timezone offset in minutes
 * - page: pagination page (default 1)
 * - limit: items per page (default 20, max 50)
 * - search: search query for products/customers
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Hanya owner yang dapat mengakses', 403)

    const { searchParams } = request.nextUrl
    const targetOutletId = searchParams.get('outletId')
    if (!targetOutletId) return safeJsonError('outletId wajib diisi', 400)

    // Verify: current user's outlet has a group, and target outlet is in the SAME group
    const [currentUserOutlet, targetOutlet] = await Promise.all([
      db.outlet.findUnique({
        where: { id: user.outletId },
        select: { id: true, groupId: true, isMain: true },
      }),
      db.outlet.findUnique({
        where: { id: targetOutletId },
        select: { id: true, groupId: true, name: true, isMain: true, address: true, phone: true },
      }),
    ])

    if (!currentUserOutlet?.groupId) return safeJsonError('Outlet Anda belum tergabung dalam grup', 400)
    if (!targetOutlet) return safeJsonError('Outlet target tidak ditemukan', 404)
    if (currentUserOutlet.groupId !== targetOutlet.groupId) return safeJsonError('Tidak dalam grup yang sama', 403)

    // Build date filter
    const tzOffset = parseTzOffset(searchParams)
    const period = searchParams.get('period') || 'today'
    const dateFromParam = searchParams.get('dateFrom') || ''
    const dateToParam = searchParams.get('dateTo') || ''
    const tab = searchParams.get('tab') || 'transactions'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20))
    const search = searchParams.get('search') || ''

    const serverTz = new Date().getTimezoneOffset()
    const effectiveTz = tzOffset ?? serverTz
    let dateFilter: Record<string, Date>

    if (dateFromParam || dateToParam) {
      dateFilter = buildDateFilterTz(dateFromParam || null, dateToParam || null, effectiveTz)
    } else if (period === '7days' || period === '7d') {
      const { todayStart } = getTodayRangeTz(effectiveTz)
      dateFilter = { gte: new Date(todayStart.getTime() - 6 * 86_400_000), lt: new Date(todayStart.getTime() + 86_400_000) }
    } else if (period === '30days' || period === '30d') {
      const { todayStart } = getTodayRangeTz(effectiveTz)
      dateFilter = { gte: new Date(todayStart.getTime() - 29 * 86_400_000), lt: new Date(todayStart.getTime() + 86_400_000) }
    } else {
      const { todayStart } = getTodayRangeTz(effectiveTz)
      dateFilter = { gte: todayStart, lt: new Date(todayStart.getTime() + 86_400_000) }
    }

    // Void exclusion (graceful — if AuditLog table missing, skip void filtering)
    let voidExclude: Record<string, unknown> = {}
    try {
      const voidedSet = await getVoidedTxIds(db, targetOutletId)
      const voidedArr = Array.from(voidedSet).filter(Boolean) as string[]
      voidExclude = voidedArr.length > 0 ? { id: { notIn: voidedArr } } : {}
    } catch {
      console.warn('[/api/multi-outlet/outlet] Void exclusion skipped (table may not exist)')
    }
    const skip = (page - 1) * limit

    // Outlet summary (always returned) — each query wrapped for resilience
    let summaryRevenue = { _sum: { total: null as number | null } }
    let summaryTx = 0
    let summaryCustomers = 0
    let summaryProducts = 0
    let summaryStock = { _sum: { stock: null as number | null } }
    let managerName = '-'

    try {
      ;[summaryRevenue, summaryTx, summaryCustomers, summaryProducts, summaryStock] = await Promise.all([
        db.transaction.aggregate({ where: { outletId: targetOutletId, createdAt: dateFilter, ...voidExclude }, _sum: { total: true } }),
        db.transaction.count({ where: { outletId: targetOutletId, createdAt: dateFilter, ...voidExclude } }),
        db.customer.count({ where: { outletId: targetOutletId } }),
        db.product.count({ where: { outletId: targetOutletId } }),
        db.product.aggregate({ where: { outletId: targetOutletId }, _sum: { stock: true } }),
      ])
    } catch (summaryErr) {
      console.error('[/api/multi-outlet/outlet] Summary query error:', summaryErr)
    }

    // Fetch manager name for the outlet
    try {
      const owner = await db.user.findFirst({
        where: { outletId: targetOutletId, role: 'OWNER' },
        select: { name: true },
      })
      if (owner) managerName = owner.name
    } catch {
      // ignore
    }

    const outletSummary = {
      id: targetOutlet.id,
      name: targetOutlet.name,
      isMain: targetOutlet.isMain,
      address: targetOutlet.address,
      phone: targetOutlet.phone,
      managerName,
      revenue: summaryRevenue._sum.total ?? 0,
      transactions: summaryTx,
      customers: summaryCustomers,
      products: summaryProducts,
      totalStock: summaryStock._sum.stock ?? 0,
    }

    // Tab data
    let data: unknown = null
    let totalRecords = 0

    if (tab === 'transactions') {
      try {
        const whereClause = {
          outletId: targetOutletId,
          createdAt: dateFilter,
          ...voidExclude,
          ...(search ? { invoiceNumber: { contains: search } } : {}),
        }

        [data, totalRecords] = await Promise.all([
          db.transaction.findMany({
            where: whereClause,
            select: {
              id: true,
              invoiceNumber: true,
              total: true,
              paymentMethod: true,
              createdAt: true,
              customer: { select: { name: true } },
              user: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
          db.transaction.count({ where: whereClause }),
        ])
      } catch (tabErr) {
        console.error('[/api/multi-outlet/outlet] Transactions tab error:', tabErr)
        data = []
        totalRecords = 0
      }
    } else if (tab === 'customers') {
      try {
        const whereClause: Record<string, unknown> = { outletId: targetOutletId }
        if (search) {
          whereClause.OR = [
            { name: { contains: search } },
            { whatsapp: { contains: search } },
          ]
        }

        [data, totalRecords] = await Promise.all([
          db.customer.findMany({
            where: whereClause as never,
            select: {
              id: true,
              name: true,
              whatsapp: true,
              totalSpend: true,
              points: true,
              createdAt: true,
              _count: { select: { transactions: true } },
            },
            orderBy: { totalSpend: 'desc' },
            skip,
            take: limit,
          }),
          db.customer.count({ where: whereClause as never }),
        ])
      } catch (tabErr) {
        console.error('[/api/multi-outlet/outlet] Customers tab error:', tabErr)
        data = []
        totalRecords = 0
      }
    } else if (tab === 'products') {
      try {
        const whereClause: Record<string, unknown> = { outletId: targetOutletId }
        if (search) {
          whereClause.OR = [
            { name: { contains: search } },
            { sku: { contains: search } },
            { barcode: { contains: search } },
          ]
        }

        [data, totalRecords] = await Promise.all([
          db.product.findMany({
            where: whereClause as never,
            select: {
              id: true,
              name: true,
              sku: true,
              price: true,
              hpp: true,
              stock: true,
              hasVariants: true,
              category: { select: { name: true, color: true } },
              _count: { select: { variants: true } },
            },
            orderBy: { name: 'asc' },
            skip,
            take: limit,
          }),
          db.product.count({ where: whereClause as never }),
        ])
      } catch (tabErr) {
        console.error('[/api/multi-outlet/outlet] Products tab error:', tabErr)
        data = []
        totalRecords = 0
      }
    }

    return safeJson({
      outlet: outletSummary,
      tab,
      pagination: {
        page,
        limit,
        total: totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
      },
      data: data ?? [],
    }, 200)
  } catch (error) {
    console.error('[/api/multi-outlet/outlet] GET error:', error)
    return safeJsonError('Failed to load outlet detail')
  }
}