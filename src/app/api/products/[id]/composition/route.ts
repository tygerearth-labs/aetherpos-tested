import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

// GET /api/products/[id]/composition — get composition items for a product
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    // Verify product exists and belongs to outlet
    const product = await db.product.findFirst({
      where: { id, outletId: user.outletId },
      select: { id: true, name: true, hasComposition: true },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    const compositions = await db.productComposition.findMany({
      where: { productId: id },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            sku: true,
            baseUnit: true,
            avgCost: true,
            stock: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Calculate autoHpp: sum of (qty * avgCost) for each composition item
    let autoHpp = 0
    const items = compositions.map((c) => {
      const lineTotal = c.qty * c.inventoryItem.avgCost
      autoHpp += lineTotal
      return {
        id: c.id,
        inventoryItemId: c.inventoryItemId,
        inventoryItemName: c.inventoryItem.name,
        inventoryItemSku: c.inventoryItem.sku,
        qty: c.qty,
        baseUnit: c.baseUnit,
        avgCost: c.inventoryItem.avgCost,
        stock: c.inventoryItem.stock,
        lineTotal,
      }
    })

    return safeJson({
      hasComposition: product.hasComposition,
      autoHpp,
      items,
    })
  } catch (error) {
    console.error('Product composition GET error:', error)
    return safeJsonError('Failed to load product composition')
  }
}

// PUT /api/products/[id]/composition — set composition for a product
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId
    const { id } = await params

    const body = await request.json()
    const { hasComposition, compositions } = body as {
      hasComposition?: boolean
      compositions?: Array<{
        inventoryItemId: string
        qty: number
        baseUnit: string
      }>
    }

    // Verify product exists and belongs to outlet
    const product = await db.product.findFirst({
      where: { id, outletId },
      select: { id: true, name: true, hasVariants: true, hasComposition: true },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    // Validate compositions if provided
    if (compositions && compositions.length > 0) {
      for (const comp of compositions) {
        if (!comp.inventoryItemId) {
          return safeJsonError('Each composition must have an inventoryItemId', 400)
        }
        if (!comp.qty || comp.qty <= 0) {
          return safeJsonError('Each composition must have qty > 0', 400)
        }
        if (!comp.baseUnit) {
          return safeJsonError('Each composition must have a baseUnit', 400)
        }
      }

      // Verify all inventory items belong to this outlet
      const invItemIds = compositions.map((c) => c.inventoryItemId)
      const invItems = await db.inventoryItem.findMany({
        where: { id: { in: invItemIds }, outletId },
        select: { id: true, name: true, avgCost: true },
      })
      if (invItems.length !== invItemIds.length) {
        return safeJsonError('One or more inventory items not found', 400)
      }
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Delete all existing compositions for this product
      await tx.productComposition.deleteMany({
        where: { productId: id },
      })

      // 2. Create new compositions
      let autoHpp = 0
      if (compositions && compositions.length > 0) {
        // Fetch inventory items with avgCost for HPP calculation
        const invItemIds = compositions.map((c) => c.inventoryItemId)
        const invItems = await tx.inventoryItem.findMany({
          where: { id: { in: invItemIds } },
          select: { id: true, avgCost: true },
        })
        const invItemCostMap = new Map(invItems.map((ii) => [ii.id, ii.avgCost]))

        await tx.productComposition.createMany({
          data: compositions.map((c) => ({
            productId: id,
            inventoryItemId: c.inventoryItemId,
            qty: c.qty,
            baseUnit: c.baseUnit,
          })),
        })

        // 3. Calculate autoHpp
        autoHpp = compositions.reduce((sum, c) => {
          const avgCost = invItemCostMap.get(c.inventoryItemId) || 0
          return sum + c.qty * avgCost
        }, 0)
      }

      // 4. Update product hasComposition and hpp
      await tx.product.update({
        where: { id },
        data: {
          hasComposition: !!hasComposition,
          hpp: autoHpp,
        },
      })

      // 5. If product has variants, update all variant hpp
      if (product.hasVariants) {
        await tx.productVariant.updateMany({
          where: { productId: id },
          data: { hpp: autoHpp },
        })
      }

      return { autoHpp }
    })

    return safeJson({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('Product composition PUT error:', error)
    return safeJsonError('Failed to update product composition')
  }
}