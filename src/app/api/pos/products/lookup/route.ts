import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'
import {
  POS_PRODUCT_SELECT,
  mapPosProduct,
  type PosProductRaw,
} from '@/lib/pos/pos-product'

/**
 * GET /api/pos/products/lookup?code=XXX
 *
 * PR 1 — exact barcode/SKU lookup for the POS. No debounce, no fuzzy match.
 * Called by the POS Enter-key handler and the barcode-scanner auto-add path.
 *
 * Match priority (first hit wins):
 *   1. Product.barcode === code   (product-level barcode)
 *   2. Product.sku === code       (product-level SKU)
 *   3. ProductVariant.barcode === code  → return parent + matchedVariantId
 *   4. ProductVariant.sku === code      → return parent + matchedVariantId
 *
 * `matchedVariantId` lets the POS auto-add the specific variant directly
 * (mirrors the legacy handleSearchKeyDown behavior) instead of just opening
 * the variant picker.
 *
 * Governance:
 *   - outlet-scoped via getAuthUser
 *   - returns at most ONE product (exact match only)
 *   - CACHE.SHORT (5s)
 *   - NO full-catalog scan — at most 2 indexed findFirst queries
 *
 * Query:
 *   - code  (the barcode or SKU string — required; if empty, returns null)
 *
 * Response: { product: PosProduct | null, matchedVariantId: string | null }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    // Accept `code` (preferred) or `barcode` or `q` for compatibility.
    const code = (
      searchParams.get('code') ||
      searchParams.get('barcode') ||
      searchParams.get('q') ||
      ''
    ).trim()

    if (!code) {
      return safeJson({ product: null, matchedVariantId: null }, 200, CACHE.SHORT)
    }

    // ── 1. Product-level exact match (barcode OR sku) ──
    let product = (await db.product.findFirst({
      where: {
        outletId: user.outletId,
        OR: [{ barcode: code }, { sku: code }],
      },
      select: POS_PRODUCT_SELECT,
    })) as unknown as PosProductRaw | null

    if (product) {
      return safeJson(
        { product: mapPosProduct(product), matchedVariantId: null },
        200,
        CACHE.SHORT,
      )
    }

    // ── 2. Variant-level exact match (barcode OR sku) → return parent ──
    // The variant's productId points to the parent; we fetch the parent with
    // all its variants so the POS can either auto-add (matchedVariantId) or
    // open the variant picker.
    const variant = await db.productVariant.findFirst({
      where: {
        outletId: user.outletId,
        OR: [{ barcode: code }, { sku: code }],
      },
      select: { id: true, productId: true },
    })

    if (variant) {
      product = (await db.product.findFirst({
        where: { id: variant.productId, outletId: user.outletId },
        select: POS_PRODUCT_SELECT,
      })) as unknown as PosProductRaw | null

      if (product) {
        return safeJson(
          { product: mapPosProduct(product), matchedVariantId: variant.id },
          200,
          CACHE.SHORT,
        )
      }
    }

    // ── 3. No match ──
    return safeJson({ product: null, matchedVariantId: null }, 200, CACHE.SHORT)
  } catch (error) {
    console.error('[/api/pos/products/lookup] GET error:', error)
    return safeJsonError('Failed to lookup product')
  }
}
