import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'
import {
  POS_PRODUCT_PARENT_SELECT,
  mapPosProductParent,
  posLimit,
  type PosProductParentRaw,
} from '@/lib/pos/pos-product'

/**
 * GET /api/pos/products/featured?limit=24
 *
 * PR 2 — POS working set. Returns 24 featured PARENT products only.
 * NO variant preload — variants are fetched on-demand via
 * /api/pos/products/:id/variants when the user clicks a variant parent.
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

    // Stock filter: keep variant parents (stock unknown until variants loaded)
    // + non-variant products with stock > 0. Stock-0 non-variant products are
    // excluded from the main list so the 24 slots are filled with sellable items.
    const inStockFilter = {
      OR: [{ hasVariants: true }, { stock: { gt: 0 } }],
    }

    // Fetch the Product rows for the top best-sellers (parent-only, no variants)
    let products: PosProductParentRaw[] = []
    if (topIds.length > 0) {
      products = await db.product.findMany({
        where: { id: { in: topIds }, outletId: user.outletId, ...inStockFilter },
        select: POS_PRODUCT_PARENT_SELECT,
      }) as unknown as PosProductParentRaw[]
      // Re-sort to match the best-seller order
      const order = new Map(topIds.map((id, i) => [id, i]))
      products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    }

    // ── 2. Pad with newest in-stock products if best-sellers < limit ──
    if (products.length < limit) {
      const existingIds = new Set(products.map((p) => p.id))
      const pad = await db.product.findMany({
        where: {
          outletId: user.outletId,
          id: { notIn: [...existingIds] },
          ...inStockFilter,
        },
        select: POS_PRODUCT_PARENT_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit - products.length,
      }) as unknown as PosProductParentRaw[]
      products = [...products, ...pad]
    }

    // ── 3. Fetch out-of-stock products for the "Stok Habis" section ──
    // Non-variant products with stock <= 0, limited to 8, best-sellers first.
    const outOfStockIds = topIds.length > 0
      ? await db.product.findMany({
          where: { id: { in: topIds }, outletId: user.outletId, hasVariants: false, stock: { lte: 0 } },
          select: { id: true },
        })
      : []
    const oosOrder = new Map(outOfStockIds.map((p, i) => [p.id, i]))
    let outOfStock: PosProductParentRaw[] = []
    if (outOfStockIds.length > 0) {
      outOfStock = await db.product.findMany({
        where: { id: { in: outOfStockIds.map((p) => p.id) }, outletId: user.outletId },
        select: POS_PRODUCT_PARENT_SELECT,
      }) as unknown as PosProductParentRaw[]
      outOfStock.sort((a, b) => (oosOrder.get(a.id) ?? 999) - (oosOrder.get(b.id) ?? 999))
      outOfStock = outOfStock.slice(0, 8)
    }
    // Pad out-of-stock with newest stock-0 products if best-sellers < 8
    if (outOfStock.length < 8) {
      const oosExisting = new Set(outOfStock.map((p) => p.id))
      const oosPad = await db.product.findMany({
        where: {
          outletId: user.outletId,
          id: { notIn: [...oosExisting] },
          hasVariants: false,
          stock: { lte: 0 },
        },
        select: POS_PRODUCT_PARENT_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 8 - outOfStock.length,
      }) as unknown as PosProductParentRaw[]
      outOfStock = [...outOfStock, ...oosPad]
    }

    const mapped = products.map(mapPosProductParent)
    const oosMapped = outOfStock.map(mapPosProductParent)
    return safeJson({ products: mapped, outOfStockProducts: oosMapped }, 200, CACHE.SHORT)
  } catch (error) {
    console.error('[/api/pos/products/featured] GET error:', error)
    return safeJsonError('Failed to load featured products')
  }
}
