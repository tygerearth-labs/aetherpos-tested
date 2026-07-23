import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'
import { buildFlexibleSearch } from '@/lib/api/api-helpers'
import {
  POS_PRODUCT_SELECT,
  mapPosProduct,
  posLimit,
  posPage,
  type PosProductRaw,
} from '@/lib/pos/pos-product'

/**
 * GET /api/pos/products/search?q=...&limit=20&page=1&categoryId=...
 *
 * PR 1 — backend on-demand search for the POS. Replaces the legacy in-memory
 * filter over the full cached catalog (localDB.products.toArray() + .filter).
 *
 * The POS debounces the search input (250-300ms) and calls this endpoint.
 * Results are capped at MAX_POS_LIMIT (30) per request — governance lock.
 *
 * Governance:
 *   - outlet-scoped via getAuthUser
 *   - limit clamped to [1, 30] (MAX_POS_LIMIT)
 *   - CACHE.SHORT (5s)
 *   - flexible token-aware search (name, sku, barcode, unit, category, variants)
 *   - supports optional categoryId filter
 *
 * Query:
 *   - q        (search term — required for search; if empty, returns newest)
 *   - limit    (default 20, max 30)
 *   - page     (default 1)
 *   - categoryId (optional filter)
 *
 * Response: { products: PosProduct[], total: number, totalPages: number }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const q = (searchParams.get('q') || '').trim()
    const limit = posLimit(searchParams.get('limit'), 20)
    const page = posPage(searchParams.get('page'))
    const categoryId = (searchParams.get('categoryId') || '').trim() || null
    const skip = (page - 1) * limit

    // Build where clause
    const where: Record<string, unknown> = { outletId: user.outletId }
    if (categoryId) {
      where.categoryId = categoryId
    }
    if (q) {
      // Flexible, case-insensitive, token-aware search across product +
      // variant fields. Mirrors /api/products/search but with POS-compact select.
      Object.assign(
        where,
        buildFlexibleSearch(q, (token) => [
          { name: { contains: token } },
          { sku: { contains: token } },
          { barcode: { contains: token } },
          { unit: { contains: token } },
          { category: { name: { contains: token } } },
          { variants: { some: { name: { contains: token } } } },
          { variants: { some: { sku: { contains: token } } } },
          { variants: { some: { barcode: { contains: token } } } },
        ]),
      )
    }

    // Parallel: paged results + total count (for pagination UI)
    const [rows, total] = await Promise.all([
      db.product.findMany({
        where,
        select: POS_PRODUCT_SELECT,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }) as unknown as Promise<PosProductRaw[]>,
      db.product.count({ where }),
    ])

    const totalPages = Math.max(1, Math.ceil(total / limit))
    const mapped = rows.map(mapPosProduct)

    return safeJson({ products: mapped, total, totalPages }, 200, CACHE.SHORT)
  } catch (error) {
    console.error('[/api/pos/products/search] GET error:', error)
    return safeJsonError('Failed to search products')
  }
}
