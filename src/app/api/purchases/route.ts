import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination } from '@/lib/api/api-helpers'
import { safeJson, safeJsonCreated, safeJsonError, CACHE } from '@/lib/api/safe-response'

// Helper: recalculate HPP for all products affected by the given inventory item IDs
async function recalculateHppForAffectedProducts(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  inventoryItemIds: string[]
) {
  // Find all compositions using these inventory items
  const compositions = await tx.productComposition.findMany({
    where: {
      inventoryItemId: { in: inventoryItemIds },
      product: { hasComposition: true },
    },
    include: {
      product: {
        select: {
          id: true,
          hasVariants: true,
        },
      },
      variant: {
        select: {
          id: true,
        },
      },
      inventoryItem: {
        select: {
          avgCost: true,
        },
      },
    },
  })

  if (compositions.length === 0) return

  // Get the set of affected product IDs
  const affectedProductIds = [...new Set(compositions.map((c) => c.productId))]

  for (const productId of affectedProductIds) {
    const productComps = compositions.filter((c) => c.productId === productId)
    const hasVariants = productComps[0].product.hasVariants

    if (hasVariants) {
      // Per-variant HPP recalculation
      const variantIds = [...new Set(productComps.filter((c) => c.variantId).map((c) => c.variantId!))]
      for (const variantId of variantIds) {
        const variantComps = productComps.filter((c) => c.variantId === variantId)
        const batchCost = variantComps.reduce((sum, c) => sum + c.qty * c.inventoryItem.avgCost, 0)
        const yieldPerBatch = variantComps[0]?.yieldPerBatch || 1
        const newHpp = yieldPerBatch > 1 ? batchCost / yieldPerBatch : batchCost
        await tx.productVariant.update({
          where: { id: variantId },
          data: { hpp: newHpp },
        })
      }
      // Product-level HPP stays 0 for variant products
      await tx.product.update({
        where: { id: productId },
        data: { hpp: 0 },
      })
    } else {
      // Non-variant: recalculate product-level HPP (yield-aware)
      const batchCost = productComps.reduce((sum, c) => sum + c.qty * c.inventoryItem.avgCost, 0)
      const yieldPerBatch = productComps[0]?.yieldPerBatch || 1
      const newHpp = yieldPerBatch > 1 ? batchCost / yieldPerBatch : batchCost
      await tx.product.update({
        where: { id: productId },
        data: { hpp: newHpp },
      })
    }
  }
}

// GET /api/purchases — list purchase orders with pagination
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const { page, limit, skip } = parsePagination(searchParams, { limit: 20 })
    const search = searchParams.get('search') || ''

    const where: Record<string, unknown> = { outletId: user.outletId }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { supplier: { name: { contains: search } } },
        { notes: { contains: search } },
      ]
    }

    const [orders, total, linkedPoItems] = await Promise.all([
      db.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          totalCost: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          supplier: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: { id: true, name: true },
          },
          items: {
            select: { id: true },
          },
        },
      }),
      db.purchaseOrder.count({ where }),
      // Find purchase orders whose inventory items are linked to product compositions
      db.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: { outletId: user.outletId },
          inventoryItem: { compositions: { some: {} } },
        },
        select: { purchaseOrderId: true },
        distinct: ['purchaseOrderId'],
      }),
    ])

    const linkedPoIds = new Set(linkedPoItems.map(p => p.purchaseOrderId))

    const mappedOrders = orders.map((o) => ({
      ...o,
      itemCount: o.items.length,
      supplierName: o.supplier?.name || null,
      createdByName: o.createdBy.name,
      hasLinkedItems: linkedPoIds.has(o.id),
    }))

    return safeJson(
      {
        orders: mappedOrders,
        totalPages: Math.ceil(total / limit),
      },
      200,
      CACHE.MEDIUM
    )
  } catch (error) {
    console.error('Purchases GET error:', error)
    return safeJsonError('Failed to load purchase orders')
  }
}

// POST /api/purchases — create purchase order (CRITICAL: inventory + HPP logic)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const userId = user.id
    const outletId = user.outletId

    const body = await request.json()
    const { supplierId, notes, items } = body as {
      supplierId?: string
      notes?: string
      items?: Array<{
        inventoryItemId: string
        purchaseQty: number
        purchaseUnit: string
        baseQty: number
        baseUnit: string
        unitCost: number
        totalCost: number
      }>
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return safeJsonError('Purchase order must have at least 1 item', 400)
    }

    // Normalize items: baseQty 0 means direct (no conversion) → treat as 1
    const normalizedItems = items.map(item => ({
      ...item,
      baseQty: item.baseQty || 1,
    }))

    // Validate each item has required fields
    for (const item of normalizedItems) {
      if (!item.inventoryItemId) {
        return safeJsonError('Setiap item harus memiliki inventoryItemId', 400)
      }
      if (!item.purchaseQty || item.purchaseQty <= 0) {
        return safeJsonError('Jumlah pembelian harus lebih dari 0', 400)
      }
      if (item.unitCost === undefined || item.unitCost < 0) {
        return safeJsonError('Harga satuan tidak boleh negatif', 400)
      }
      if (!item.totalCost || item.totalCost <= 0) {
        return safeJsonError('Total biaya item harus lebih dari 0', 400)
      }
    }

    // Validate supplierId if provided
    if (supplierId) {
      const supplier = await db.supplier.findFirst({
        where: { id: supplierId, outletId },
      })
      if (!supplier) {
        return safeJsonError('Supplier not found', 400)
      }
    }

    // Validate all inventory items belong to this outlet
    const itemIds = normalizedItems.map((i) => i.inventoryItemId)
    const inventoryItems = await db.inventoryItem.findMany({
      where: { id: { in: itemIds }, outletId },
    })
    if (inventoryItems.length !== itemIds.length) {
      return safeJsonError('One or more inventory items not found', 400)
    }

    // Generate order number: PO-YYYYMMDD-XXXX
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const todayStart = new Date(yyyy, now.getMonth(), now.getDate())
    const count = await db.purchaseOrder.count({
      where: {
        outletId,
        createdAt: { gte: todayStart },
      },
    })
    const orderNumber = `PO-${yyyy}${mm}${dd}-${String(count + 1).padStart(4, '0')}`

    // Calculate total cost
    const totalCost = normalizedItems.reduce((sum, item) => sum + (item.totalCost || 0), 0)

    // Execute everything in a single transaction (30s timeout for HPP recalc)
    const result = await db.$transaction(async (tx) => {
      // Create purchase order
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          orderNumber,
          supplierId: supplierId || null,
          totalCost,
          notes: notes?.trim() || null,
          outletId,
          userId,
          items: {
            create: normalizedItems.map((item) => {
              const invItem = inventoryItems.find((ii) => ii.id === item.inventoryItemId)!
              return {
                inventoryItemId: item.inventoryItemId,
                name: invItem.name,
                purchaseQty: item.purchaseQty,
                purchaseUnit: item.purchaseUnit,
                baseQty: item.baseQty,
                baseUnit: item.baseUnit,
                unitCost: item.unitCost,
                totalCost: item.totalCost || (item.baseQty * item.unitCost),
                outletId,
              }
            }),
          },
        },
        include: {
          items: true,
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      })

      // Update inventory items: weighted average cost and stock
      const affectedInventoryItemIds: string[] = []
      for (const item of normalizedItems) {
        const invItem = inventoryItems.find((ii) => ii.id === item.inventoryItemId)!
        const existingStock = invItem.stock
        const existingAvgCost = invItem.avgCost
        const baseQty = item.baseQty
        const unitCost = item.unitCost

        // Weighted average: (existing.stock * existing.avgCost + baseQty * unitCost) / (existing.stock + baseQty)
        const newStock = existingStock + baseQty
        let newAvgCost = 0
        if (newStock > 0) {
          newAvgCost = (existingStock * existingAvgCost + baseQty * unitCost) / newStock
        }

        await tx.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            stock: newStock,
            avgCost: newAvgCost,
          },
        })

        // Audit log for inventory restock
        await tx.auditLog.create({
          data: {
            action: 'PURCHASE',
            entityType: 'INVENTORY_ITEM',
            entityId: item.inventoryItemId,
            details: JSON.stringify({
              itemName: invItem.name,
              purchaseOrderNumber: orderNumber,
              baseQtyAdded: baseQty,
              unitCost,
              previousStock: existingStock,
              newStock,
              previousAvgCost: existingAvgCost,
              newAvgCost,
            }),
            outletId,
            userId,
          },
        })

        // Create inventory movement for purchase
        await tx.inventoryMovement.create({
          data: {
            type: 'PURCHASE',
            inventoryItemId: item.inventoryItemId,
            quantity: baseQty,
            previousStock: existingStock,
            newStock,
            referenceId: purchaseOrder.id,
            referenceType: 'PURCHASE_ORDER',
            notes: `Pembelian: ${invItem.name} (${orderNumber})`,
            outletId,
            userId,
          },
        })

        affectedInventoryItemIds.push(item.inventoryItemId)
      }

      // Recalculate HPP for all products that use these inventory items
      await recalculateHppForAffectedProducts(tx, affectedInventoryItemIds)

      return purchaseOrder
    }, { timeout: 30000 })

    return safeJsonCreated(result)
  } catch (error) {
    console.error('Purchases POST error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    // Detect Prisma unique constraint violation (P2002) for orderNumber race condition
    if (msg.includes('P2002') || msg.includes('Unique constraint')) {
      return safeJsonError('Gagal membuat PO: nomor order sudah ada. Silakan coba lagi.', 409)
    }
    return safeJsonError(`Gagal membuat pembelian: ${msg}`)
  }
}