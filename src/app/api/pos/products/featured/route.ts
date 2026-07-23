import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'
import {
  POS_PRODUCT_SELECT,
  mapPosProduct,
  posLimit,
  type PosProductRaw,
} from '@/lib/pos/pos-product'

/**
 * GET /api/pos/products/featured?limit=24
 *
 * PR 1 — POS working set. Returns the top best-selling products (last 30 days,
 * outlet-scoped), padded with newest products if sales data is sparse.
 *
 * Replaces the legacy `syncAllData()` full-catalog download (2,739+ products)
 * with a fixed 24-item working set. The POS grid renders this immediately on
 * mount; search + barcode lookup hit the other POS endpoints on-demand.
 *
 * Governance:
 *   - outlet-scoped via getAuthUser
 *   - limit clamped to [1, 30] (MAX_POS_LIMIT)
 *   - CACHE.SHORT (5s)
 *   - NO full-catalog fetch — at most `limit` Product rows + 1 groupBy
 *
 * Query:
 *   - limit (default 24, max 30)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const limit = posLimit(searchParams.get('limit'), 24)

    // ── 1. Top best-sellers (last 30 days, outlet-scoped) ──
    // groupBy on TransactionItem.productId, joined to Transaction for outlet +
    // time window. `take: limit` caps the aggregation. Products without sales
    // in the window are excluded (they'll be padded in step 2 if needed).
    const since = new Date(Date.now() - 30 * 86_400_000)
    const topItems = await db.transactionItem.groupBy({
      by: ['productId'],
      where: {
        transaction: { outletId: user.outletId, createdAt: { gte: since } },
        NOT: { productId: null },
      },
      _sum: { qty: true },
      orderBy: { _sum: { qty: 'desc' } },
      take: limit,
    })
    const topIds = topItems
      .map((t) => t.productId)
      .filter((id): id is string => id !== null)

    // Fetch the Product rows for the top best-sellers (1 query)
    let products: PosProductRaw[] = []
    if (topIds.length > 0) {
      products = await db.product.findMany({
        where: { id: { in: topIds }, outletId: user.outletId },
        select: POS_PRODUCT_SELECT,
      }) as unknown as PosProductRaw[]
      // Re-sort to match the best-seller order (findMany doesn't preserve IN order)
      const order = new Map(topIds.map((id, i) => [id, i]))
      products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    }

    // ── 2. Pad with newest products if best-sellers < limit ──
    // Covers fresh outlets (no transactions yet) + outlets where few products
    // have sold. New products are sorted by createdAt desc.
    if (products.length < limit) {
      const existingIds = new Set(products.map((p) => p.id))
      const pad = await db.product.findMany({
        where: {
          outletId: user.outletId,
          id: { notIn: [...existingIds] },
        },
        select: POS_PRODUCT_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit - products.length,
      }) as unknown as PosProductRaw[]
      products = [...products, ...pad]
    }

    const mapped = products.map(mapPosProduct)
    return safeJson({ products: mapped }, 200, CACHE.SHORT)
  } catch (error) {
    console.error('[/api/pos/products/featured] GET error:', error)
    return safeJsonError('Failed to load featured products')
  }
}
