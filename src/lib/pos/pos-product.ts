/**
 * pos-product.ts — Shared shape + helpers for POS product endpoints (PR 1).
 *
 * AETHER BULK ENGINE V1 — POS working-set layer.
 *
 * Governance (PR 1 locks):
 *   - MAX_POS_LIMIT = 30  (no endpoint may return more than 30 products)
 *   - All queries are outlet-scoped via getAuthUser().outletId
 *   - All responses use CACHE.SHORT (5s) — POS polls, no long cache
 *   - Compact shape: only fields the POS grid + cart need (no analytics, no
 *     heavy includes). Variants are included inline for PR 1; PR 2 will make
 *     variant loading on-demand.
 *
 * This module is the SINGLE source of truth for the POS product JSON shape.
 * The three endpoints (featured / search / lookup) all call mapPosProduct()
 * so the frontend receives a consistent Product object regardless of which
 * endpoint served it.
 */
import { safeJson, CACHE } from '@/lib/api/safe-response'

/** Governance: maximum number of products any POS endpoint may return. */
export const MAX_POS_LIMIT = 30

/**
 * Parse + clamp a `limit` query param to [1, MAX_POS_LIMIT].
 * Default 20 (search) or 24 (featured) — callers pass the default.
 */
export function posLimit(raw: string | null, fallback: number): number {
  const n = parseInt(raw || String(fallback), 10)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(MAX_POS_LIMIT, n)
}

/** Parse + clamp a `page` query param to >= 1 (default 1). */
export function posPage(raw: string | null): number {
  const n = parseInt(raw || '1', 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return n
}

// ── Prisma select (shared by featured / search / lookup) ─────────────────────
// Compact: only fields the POS needs. `category.name` is denormalized into
// `categoryName` by mapPosProduct() so the frontend can display/filter without
// a second query. Variants are inline (PR 1); PR 2 strips these from
// featured/search and loads them via /api/pos/products/:id/variants on demand.
export const POS_PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  barcode: true,
  price: true,
  hpp: true,
  stock: true,
  unit: true,
  image: true,
  categoryId: true,
  hasVariants: true,
  category: { select: { name: true } },
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
    orderBy: { name: 'asc' as const },
  },
} as const

/** Structural type of the Prisma select result (for the mapper input). */
export interface PosProductRaw {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  price: number
  hpp: number
  stock: number
  unit: string
  image: string | null
  categoryId: string | null
  hasVariants: boolean
  category: { name: string } | null
  variants: Array<{
    id: string
    name: string
    sku: string | null
    barcode: string | null
    price: number
    hpp: number
    stock: number
  }>
}

/**
 * The POS Product JSON shape — matches the frontend `Product` interface
 * (pos-page.tsx lines 76-89) plus `unit` + `categoryName` for compatibility
 * with the legacy CachedProduct shape (so any residual localDB reads still
 * work during the PR 1 → PR 2 transition).
 */
export interface PosProduct {
  id: string
  name: string
  price: number
  stock: number
  hpp: number
  sku: string | null
  barcode: string | null
  categoryId: string | null
  image: string | null
  unit: string
  categoryName: string | null
  hasVariants: boolean
  _variantCount: number
  variants: Array<{
    id: string
    name: string
    sku: string | null
    barcode: string | null
    price: number
    hpp: number
    stock: number
  }>
}

/**
 * Map a raw Prisma product (with variants + category) to the compact POS shape.
 *
 * For variant products:
 *   - `price`   = min variant price (cheapest option, for grid display)
 *   - `stock`   = sum of variant stock (total available)
 *   - `hpp`     = average variant hpp (rounded)
 *   - `variants` = full inline list (PR 1; PR 2 will fetch on-demand)
 *
 * For non-variant products: passes through parent fields, empty variants array.
 */
export function mapPosProduct(p: PosProductRaw): PosProduct {
  const variants = p.variants || []
  const categoryName = p.category?.name || null

  if (p.hasVariants && variants.length > 0) {
    const totalStock = variants.reduce((s, v) => s + (v.stock || 0), 0)
    const prices = variants.map((v) => v.price || 0).filter(Boolean)
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0
    const hpps = variants.map((v) => v.hpp || 0).filter(Boolean)
    const avgHpp = hpps.length > 0 ? hpps.reduce((s, h) => s + h, 0) / hpps.length : 0
    return {
      id: p.id,
      name: p.name,
      price: minPrice,
      stock: totalStock,
      hpp: Math.round(avgHpp),
      sku: p.sku,
      barcode: p.barcode,
      categoryId: p.categoryId,
      image: p.image,
      unit: p.unit,
      categoryName,
      hasVariants: true,
      _variantCount: variants.length,
      variants,
    }
  }

  return {
    id: p.id,
    name: p.name,
    price: p.price,
    stock: p.stock,
    hpp: p.hpp || 0,
    sku: p.sku,
    barcode: p.barcode,
    categoryId: p.categoryId,
    image: p.image,
    unit: p.unit,
    categoryName,
    hasVariants: false,
    _variantCount: 0,
    variants: [],
  }
}

/** Convenience: wrap a PosProduct[] (or single) in a CACHE.SHORT JSON response. */
export function posJson(products: PosProduct[], extra?: Record<string, unknown>) {
  return safeJson({ products, ...extra }, 200, CACHE.SHORT)
}
