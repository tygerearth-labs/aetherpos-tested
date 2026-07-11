import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

// GET /api/inventory/batches/pos-preview
// Returns FEFO-picked batch info for each inventory item in a product's composition
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    const { searchParams } = request.nextUrl
    const productId = searchParams.get('productId')
    const variantId = searchParams.get('variantId') || null

    if (!productId) {
      return safeJsonError('productId is required', 400)
    }

    // 1. Find compositions for this product/variant
    const compositions = await db.productComposition.findMany({
      where: {
        productId,
        ...(variantId ? { variantId } : { variantId: null }),
      },
      include: {
        inventoryItem: {
          select: { id: true, name: true, baseUnit: true },
        },
      },
    })

    // No compositions → no batch info
    if (compositions.length === 0) {
      return safeJson({ hasBatches: false, items: [] }, 200, CACHE.SHORT)
    }

    // 2. For each composition, find the FEFO-picked batch (closest to expiry, AVAILABLE, remainingQty > 0)
    const items = []
    for (const comp of compositions) {
      // FEFO: sort by expiredDate ASC (nulls last = no expiry goes last = safe), then createdAt ASC
      const batch = await db.inventoryBatch.findFirst({
        where: {
          inventoryItemId: comp.inventoryItemId,
          outletId,
          status: 'AVAILABLE',
          remainingQty: { gt: 0 },
        },
        orderBy: [
          { expiredDate: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
        ],
      })

      let daysUntilExpiry: number | null = null
      if (batch?.expiredDate) {
        const now = new Date()
        const exp = new Date(batch.expiredDate)
        daysUntilExpiry = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      }

      items.push({
        inventoryItemId: comp.inventoryItemId,
        inventoryItemName: comp.inventoryItem.name,
        baseUnit: comp.inventoryItem.baseUnit,
        batchNumber: batch?.batchNumber ?? null,
        expiredDate: batch?.expiredDate?.toISOString() ?? null,
        remainingQty: batch?.remainingQty ?? 0,
        daysUntilExpiry,
      })
    }

    return safeJson({ hasBatches: true, items }, 200, CACHE.SHORT)
  } catch (error) {
    console.error('POS batch preview error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Failed to load batch preview: ${msg}`)
  }
}