import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

// Stock-in movement types (quantity > 0)
const STOCK_IN_TYPES = ['RESTOCK', 'TRANSFER_IN', 'PURCHASE', 'ADJUSTMENT']
// Stock-out movement types (quantity < 0)
const STOCK_OUT_TYPES = ['CONSUMPTION', 'TRANSFER_OUT']

// GET /api/inventory/movements — list inventory movements for the current outlet
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const { page, limit, skip } = parsePagination(searchParams, { limit: 20 })
    const type = searchParams.get('type') || ''
    const inventoryItemId = searchParams.get('inventoryItemId') || ''
    const search = searchParams.get('search') || ''

    // Build where clause
    const where: Record<string, unknown> = { outletId: user.outletId }

    if (type) {
      where.type = type
    }

    if (inventoryItemId) {
      where.inventoryItemId = inventoryItemId
    }

    if (search) {
      where.inventoryItem = { name: { contains: search } }
    }

    const [movements, total, statsResult] = await Promise.all([
      db.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          inventoryItem: {
            include: {
              category: { select: { id: true, name: true, color: true } },
            },
          },
        },
      }),
      db.inventoryMovement.count({ where }),
      // Summary stats for the filtered (or unfiltered) set
      db.inventoryMovement.aggregate({
        where: { outletId: user.outletId, ...(type ? { type } : {}), ...(inventoryItemId ? { inventoryItemId } : {}), ...(search ? { inventoryItem: { name: { contains: search } } } : {}) },
        _count: true,
        _sum: { quantity: true },
      }),
    ])

    // ---- Summary stats ----
    const stockInResult = await db.inventoryMovement.aggregate({
      where: {
        outletId: user.outletId,
        type: { in: STOCK_IN_TYPES },
        quantity: { gt: 0 },
        ...(inventoryItemId ? { inventoryItemId } : {}),
        ...(search ? { inventoryItem: { name: { contains: search } } } : {}),
      },
      _sum: { quantity: true },
    })

    const stockOutResult = await db.inventoryMovement.aggregate({
      where: {
        outletId: user.outletId,
        type: { in: STOCK_OUT_TYPES },
        quantity: { lt: 0 },
        ...(inventoryItemId ? { inventoryItemId } : {}),
        ...(search ? { inventoryItem: { name: { contains: search } } } : {}),
      },
      _sum: { quantity: true },
    })

    const summary = {
      totalMovements: statsResult._count,
      totalStockIn: stockInResult._sum.quantity || 0,
      totalStockOut: Math.abs(stockOutResult._sum.quantity || 0),
    }

    // ---- Batch lookup: user names ----
    const userIds = [...new Set(movements.map((m) => m.userId).filter(Boolean))] as string[]
    const userMap = new Map<string, string>()
    if (userIds.length > 0) {
      const users = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
      for (const u of users) {
        userMap.set(u.id, u.name)
      }
    }

    // ---- Batch lookup: reference info ----
    // Group reference lookups by type
    const refsByType: Record<string, string[]> = { PURCHASE_ORDER: [], TRANSFER: [], TRANSACTION: [] }
    for (const m of movements) {
      if (m.referenceId && m.referenceType && refsByType[m.referenceType]) {
        refsByType[m.referenceType].push(m.referenceId)
      }
    }
    // Deduplicate
    for (const key of Object.keys(refsByType)) {
      refsByType[key] = [...new Set(refsByType[key])]
    }

    // Lookup PurchaseOrder orderNumbers
    const poMap = new Map<string, string>()
    if (refsByType.PURCHASE_ORDER.length > 0) {
      const pos = await db.purchaseOrder.findMany({
        where: { id: { in: refsByType.PURCHASE_ORDER } },
        select: { id: true, orderNumber: true },
      })
      for (const po of pos) {
        poMap.set(po.id, po.orderNumber)
      }
    }

    // Lookup OutletTransfer transferNumbers
    const trfMap = new Map<string, string>()
    if (refsByType.TRANSFER.length > 0) {
      const trfs = await db.outletTransfer.findMany({
        where: { id: { in: refsByType.TRANSFER } },
        select: { id: true, transferNumber: true, status: true },
      })
      for (const t of trfs) {
        trfMap.set(t.id, `${t.transferNumber} (${t.status})`)
      }
    }

    // Lookup Transaction invoiceNumbers
    const txMap = new Map<string, string>()
    if (refsByType.TRANSACTION.length > 0) {
      const txs = await db.transaction.findMany({
        where: { id: { in: refsByType.TRANSACTION } },
        select: { id: true, invoiceNumber: true },
      })
      for (const tx of txs) {
        txMap.set(tx.id, tx.invoiceNumber)
      }
    }

    // ---- Enrich movements ----
    const mappedMovements = movements.map((m) => {
      // Build reference label
      let referenceLabel: string | null = null
      if (m.referenceId && m.referenceType) {
        if (m.referenceType === 'PURCHASE_ORDER') {
          referenceLabel = poMap.get(m.referenceId) || null
        } else if (m.referenceType === 'TRANSFER') {
          referenceLabel = trfMap.get(m.referenceId) || null
        } else if (m.referenceType === 'TRANSACTION') {
          referenceLabel = txMap.get(m.referenceId) || null
        } else if (m.referenceType === 'ADJUSTMENT') {
          referenceLabel = `ADJ-${m.referenceId.slice(0, 8)}`
        }
      }

      return {
        id: m.id,
        inventoryItemId: m.inventoryItemId,
        itemName: m.inventoryItem.name,
        itemSku: m.inventoryItem.sku,
        baseUnit: m.inventoryItem.baseUnit,
        category: m.inventoryItem.category
          ? { id: m.inventoryItem.category.id, name: m.inventoryItem.category.name, color: m.inventoryItem.category.color }
          : null,
        type: m.type,
        quantity: m.quantity,
        previousStock: m.previousStock,
        newStock: m.newStock,
        referenceId: m.referenceId,
        referenceType: m.referenceType,
        referenceLabel,
        notes: m.notes,
        userId: m.userId,
        userName: m.userId ? userMap.get(m.userId) || null : null,
        createdAt: m.createdAt,
      }
    })

    return safeJson(
      {
        movements: mappedMovements,
        summary,
        totalPages: Math.ceil(total / limit),
      },
      200,
      CACHE.SHORT,
    )
  } catch (error) {
    console.error('Inventory movements GET error:', error)
    return safeJsonError('Failed to load inventory movements')
  }
}