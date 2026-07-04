import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'
import { parsePagination } from '@/lib/api/api-helpers'

// GET /api/inventory/movements — paginated inventory movement history
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const type = searchParams.get('type') || ''
    const search = searchParams.get('search') || ''
    const itemId = searchParams.get('itemId') || ''
    const { page, limit, skip } = parsePagination(searchParams)

    // Build where filter scoped to user's outlet
    const where: Record<string, unknown> = { outletId: user.outletId }

    if (type) {
      where.type = type
    }
    if (itemId) {
      where.inventoryItemId = itemId
    }
    if (search) {
      where.inventoryItem = { name: { contains: search } }
    }

    // Run count, sum queries, and data fetch in parallel
    const [totalMovements, aggregations, movements] = await Promise.all([
      db.inventoryMovement.count({ where }),
      db.inventoryMovement.aggregate({
        where,
        _sum: { quantity: true },
      }),
      db.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          inventoryItem: { select: { id: true, name: true, sku: true, baseUnit: true } },
          user: { select: { id: true, name: true } },
        },
      }),
    ])

    const totalStockIn = aggregations._sum.quantity
      ? Math.max(0, aggregations._sum.quantity)
      : 0
    const totalStockOut = aggregations._sum.quantity
      ? Math.abs(Math.min(0, aggregations._sum.quantity))
      : 0

    // Batch reference lookups to avoid N+1
    const transferRefIds = movements
      .filter((m) => m.referenceType === 'TRANSFER' && m.referenceId)
      .map((m) => m.referenceId!)

    const poRefIds = movements
      .filter((m) => m.referenceType === 'PURCHASE_ORDER' && m.referenceId)
      .map((m) => m.referenceId!)

    const transferMap = new Map<string, string>()
    const poMap = new Map<string, string>()

    if (transferRefIds.length > 0) {
      const transfers = await db.outletTransfer.findMany({
        where: { id: { in: transferRefIds } },
        select: { id: true, transferNumber: true },
      })
      for (const t of transfers) transferMap.set(t.id, t.transferNumber)
    }

    if (poRefIds.length > 0) {
      const purchaseOrders = await db.purchaseOrder.findMany({
        where: { id: { in: poRefIds } },
        select: { id: true, orderNumber: true },
      })
      for (const po of purchaseOrders) poMap.set(po.id, po.orderNumber)
    }

    // Enrich movements with referenceLabel
    const enriched = movements.map((m) => {
      let referenceLabel: string | null = null
      if (m.referenceType === 'TRANSFER' && m.referenceId) {
        referenceLabel = transferMap.get(m.referenceId) || null
      } else if (m.referenceType === 'PURCHASE_ORDER' && m.referenceId) {
        referenceLabel = poMap.get(m.referenceId) || null
      }
      return { ...m, referenceLabel }
    })

    const totalPages = Math.ceil(totalMovements / limit)

    return safeJson(
      {
        movements: enriched,
        totalPages,
        totalMovements,
        totalStockIn,
        totalStockOut,
      },
      200,
      CACHE.SHORT
    )
  } catch (error) {
    console.error('Inventory movements GET error:', error)
    return safeJsonError('Failed to load inventory movements')
  }
}