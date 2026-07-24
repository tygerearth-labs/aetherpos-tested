import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

/**
 * GET /api/pos/products/:id/variants
 *
 * PR 2 — Variant On-Demand. Returns the variants for a parent product,
 * fetched only when the user clicks a variant parent in the POS grid.
 *
 * Governance (PR 2):
 *   - outlet-scoped via getAuthUser
 *   - NO variant preload — featured/search return parents only; this endpoint
 *     is the single source of variant detail for the POS.
 *   - stock 0 = disabled in the UI (returned as-is; UI decides)
 *   - only active products/variants (product must belong to outlet)
 *   - CACHE.SHORT (5s)
 *
 * Response: { variants: Array<{ id, name, sku, barcode, price, hpp, stock }> }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { id } = await params

    // Verify the parent product belongs to the user's outlet and has variants.
    const product = await db.product.findFirst({
      where: { id, outletId: user.outletId },
      select: { id: true, hasVariants: true, name: true },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }
    if (!product.hasVariants) {
      // Non-variant product — return empty list (UI adds directly to cart).
      return safeJson({ variants: [] }, 200, CACHE.SHORT)
    }

    const variants = await db.productVariant.findMany({
      where: { productId: id, outletId: user.outletId },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        price: true,
        hpp: true,
        stock: true,
      },
      orderBy: { name: 'asc' },
    })

    return safeJson({ variants }, 200, CACHE.SHORT)
  } catch (error) {
    console.error('[/api/pos/products/[id]/variants] GET error:', error)
    return safeJsonError('Failed to load variants')
  }
}
