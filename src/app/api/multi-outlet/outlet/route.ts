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
    const period = searchParams.get('period') || ''
    const dateFromParam = searchParams.get('dateFrom') || ''
    const dateToParam = searchParams.get('dateTo') || ''
    const tab = searchParams.get('tab') || 'transactions'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20))
    const search = searchParams.get('search') || ''

    const now = new Date()
    let dateFilter: Record<string, Date> | undefined

    if (dateFromParam || dateToParam) {
      dateFilter = tzOffset !== null
        ? buildDateFilterTz(dateFromParam || null, dateToParam || null, tzOffset)
        : (() => {
            const filter: Record<string, Date> = {}
            if (dateFromParam) { const d = new Date(dateFromParam); if (!isNaN(d.getTime())) { d.setHours(0,0,0,0); filter.gte = d } }
            if (dateToParam) { const d = new Date(dateToParam); if (!isNaN(d.getTime())) { d.setHours(23,59,59,999); filter.lte = d } }
            return filter
          })()
      // If the filter ended up empty, treat as no filter
      if (dateFilter && Object.keys(dateFilter).length === 0) dateFilter = undefined
    } else if (!period) {
      dateFilter = undefined // No date filter — show all
    } else if (period === '7days' || period === '7d') {
      const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0)
      dateFilter = { gte: start, lte: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59,999) }
    } else if (period === '30days' || period === '30d') {
      const start = new Date(now); start.setDate(start.getDate() - 29); start.setHours(0,0,0,0)
      dateFilter = { gte: start, lte: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59,999) }
    } else if (tzOffset !== null) {
      const { todayStart } = getTodayRangeTz(tzOffset)
      dateFilter = { gte: todayStart, lt: new Date(todayStart.getTime() + 86_400_000) }
    } else {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      dateFilter = { gte: todayStart, lt: new Date(todayStart.getTime() + 86_400_000) }
    }

    // Helper: build where clause with optional date filter
    const buildWhere = (base: Record<string, unknown>) => ({
      ...base,
      ...(dateFilter && Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
    })

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

    try {
      ;[summaryRevenue, summaryTx, summaryCustomers, summaryProducts, summaryStock] = await Promise.all([
        db.transaction.aggregate({ where: buildWhere({ outletId: targetOutletId, ...voidExclude }), _sum: { total: true } }),
        db.transaction.count({ where: buildWhere({ outletId: targetOutletId, ...voidExclude }) }),
        db.customer.count({ where: { outletId: targetOutletId } }),
        db.product.count({ where: { outletId: targetOutletId } }),
        db.product.aggregate({ where: { outletId: targetOutletId }, _sum: { stock: true } }),
      ])
    } catch (summaryErr) {
      console.error('[/api/multi-outlet/outlet] Summary query error:', summaryErr)
    }

    const outletSummary = {
      ...targetOutlet,
      revenue: summaryRevenue._sum.total ?? 0,
      transactions: summaryTx,
      customers: summaryCustomers,
      products: summaryProducts,
      totalStock: summaryStock._sum.stock ?? 0,
    }

    // Tab data
    let tabData: unknown = null
    let totalRecords = 0

    if (tab === 'transactions') {
      try {
        const txWhere = buildWhere({
          outletId: targetOutletId,
          ...voidExclude,
          ...(search ? { invoiceNumber: { contains: search } } : {}),
        })

        const txRows = await db.transaction.findMany({
          where: txWhere,
          select: {
            id: true,
            invoiceNumber: true,
            subtotal: true,
            discount: true,
            total: true,
            paymentMethod: true,
            createdAt: true,
            customer: { select: { name: true } },
            user: { select: { name: true } },
            _count: { select: { items: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        })
        const txCount = await db.transaction.count({ where: txWhere })
        tabData = txRows
        totalRecords = txCount
      } catch (tabErr) {
        console.error('[/api/multi-outlet/outlet] Transactions tab error:', tabErr)
        tabData = []
        totalRecords = 0
      }
    } else if (tab === 'customers') {
      try {
        const custWhere: Record<string, unknown> = { outletId: targetOutletId }
        if (search) {
          custWhere.OR = [
            { name: { contains: search } },
            { whatsapp: { contains: search } },
          ]
        }

        const custRows = await db.customer.findMany({
          where: custWhere as never,
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
        })
        const custCount = await db.customer.count({ where: custWhere as never })
        tabData = custRows
        totalRecords = custCount
      } catch (tabErr) {
        console.error('[/api/multi-outlet/outlet] Customers tab error:', tabErr)
        tabData = []
        totalRecords = 0
      }
    } else if (tab === 'products') {
      try {
        const prodWhere: Record<string, unknown> = { outletId: targetOutletId }
        if (search) {
          prodWhere.OR = [
            { name: { contains: search } },
            { sku: { contains: search } },
            { barcode: { contains: search } },
          ]
        }

        const prodRows = await db.product.findMany({
          where: prodWhere as never,
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
        })
        const prodCount = await db.product.count({ where: prodWhere as never })
        tabData = prodRows
        totalRecords = prodCount
      } catch (tabErr) {
        console.error('[/api/multi-outlet/outlet] Products tab error:', tabErr)
        tabData = []
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
      data: tabData ?? [],
    }, 200)
  } catch (error) {
    console.error('[/api/multi-outlet/outlet] GET error:', error)
    return safeJsonError('Failed to load outlet detail')
  }
}
