import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

/**
 * GET /api/products/search?q=...&limit=20
 *
 * Lightweight product search for transfer page and POS.
 * Only returns fields needed for product selection — no analytics, no categories, no heavy includes.
 * Returns aggregated stock/price for variant products.
 *
 * Resilient: falls back to minimal field set if full query fails (e.g. missing DB columns).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20))

    // Build where clause
    const where: Record<string, unknown> = { outletId: user.outletId }
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { sku: { contains: q } },
        { barcode: { contains: q } },
        { unit: { contains: q } },
        { category: { name: { contains: q } } },
        { variants: { some: { name: { contains: q } } } },
        { variants: { some: { sku: { contains: q } } } },
        { variants: { some: { barcode: { contains: q } } } },
      ]
    }

    // Try full query first (with hpp, barcode, hasVariants, variants)
    let products: Array<Record<string, unknown>> = []
    let useFull = true

    try {
      const fullProducts = await db.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          price: true,
          hpp: true,
          stock: true,
          hasVariants: true,
          variants: {
            select: {
              id: true,
              name: true,
              sku: true,
              barcode: true,
              price: true,
              hpp: true,
              stock: true,
            },
            take: 50,
          },
        },
        orderBy: { name: 'asc' },
        take: limit,
      })
      products = fullProducts as unknown as Array<Record<string, unknown>>
    } catch (fullErr) {
      // Full query failed — likely missing columns in DB. Fall back to minimal query.
      console.warn('[/api/products/search] Full query failed, falling back to minimal:', fullErr)
      useFull = false

      try {
        // Build minimal where without barcode (in case it doesn't exist)
        const minWhere: Record<string, unknown> = { outletId: user.outletId }
        if (q) {
          minWhere.OR = [
            { name: { contains: q } },
            { sku: { contains: q } },
          ]
        }

        const minProducts = await db.product.findMany({
          where: minWhere,
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            stock: true,
          },
          orderBy: { name: 'asc' },
          take: limit,
        })
        products = minProducts as unknown as Array<Record<string, unknown>>
      } catch (minErr) {
        console.error('[/api/products/search] Minimal query also failed:', minErr)
        // Return empty results gracefully
        return safeJson({ products: [] }, 200, CACHE.SHORT)
      }
    }

    // Map: aggregate variant data for variant products
    const mapped = products.map((p) => {
      if (useFull) {
        const vList = (p.variants as Array<Record<string, unknown>>) || []
        if (p.hasVariants && vList.length > 0) {
          const totalStock = vList.reduce((s: number, v: Record<string, unknown>) => s + ((v.stock as number) || 0), 0)
          const prices = vList.map((v: Record<string, unknown>) => (v.price as number) || 0).filter(Boolean)
          const minPrice = prices.length > 0 ? Math.min(...prices) : 0
          const hpps = vList.map((v: Record<string, unknown>) => (v.hpp as number) || 0).filter(Boolean)
          const avgHpp = hpps.length > 0 ? hpps.reduce((s: number, h: number) => s + h, 0) / hpps.length : 0
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            price: minPrice,
            hpp: Math.round(avgHpp),
            stock: totalStock,
            hasVariants: true,
            variantCount: vList.length,
            variants: vList,
          }
        }
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          price: p.price,
          hpp: p.hpp || 0,
          stock: p.stock,
          hasVariants: false,
          variantCount: 0,
          variants: [],
        }
      }

      // Minimal fallback shape
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: null,
        price: p.price,
        hpp: 0,
        stock: p.stock,
        hasVariants: false,
        variantCount: 0,
        variants: [],
      }
    })

    return safeJson({ products: mapped }, 200, CACHE.SHORT)
  } catch (error) {
    console.error('[/api/products/search] GET error:', error)
    return safeJsonError('Failed to search products')
  }
}