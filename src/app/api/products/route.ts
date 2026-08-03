import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination, resolvePlanType, buildFlexibleSearch } from '@/lib/api/api-helpers'
import { getPlanFeatures, isUnlimited } from '@/lib/config/plan-config'
import { assertOutletWithinLimits } from '@/lib/api/plan-enforcement'
import { safeJson, safeJsonCreated, safeJsonError, CACHE } from '@/lib/api/safe-response'
import { generateUniqueSKU, generateVariantSKU, generateUniqueBarcode, generateVariantBarcode } from '@/lib/sku-generator'
import { emitAuditEvent, buildProductChangeEvent } from '@/lib/audit-v2'

type SortOption = 'newest' | 'best-selling' | 'low-stock' | 'most-stock'

// New whitelisted column-sort API (preferred over the legacy `sort` enum).
// `sortBy` + `sortOrder` override `sort` when present. Sorting is GLOBAL —
// the API fetches all matching products (no skip/take at the DB level), sorts
// in memory (because variant aggregation is required), then slices for the
// requested page. This guarantees sort correctness across pagination.
type ColumnSortBy = 'name' | 'category' | 'sku' | 'hpp' | 'price' | 'stock' | 'lastChangedAt'
const ALLOWED_COLUMN_SORT: ColumnSortBy[] = ['name', 'category', 'sku', 'hpp', 'price', 'stock', 'lastChangedAt']

interface VariantPayload {
  name: string
  sku?: string
  hpp?: number
  price: number
  stock?: number
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId

    const { searchParams } = request.nextUrl
    const { page, limit, skip } = parsePagination(searchParams)
    const search = searchParams.get('search') || ''
    const sort: SortOption = (searchParams.get('sort') as SortOption) || 'newest'
    const categoryId = searchParams.get('categoryId') || ''

    // New column-sort API (overrides legacy `sort` when present).
    const requestedColumnSort = searchParams.get('sortBy') as ColumnSortBy | null
    const columnSortBy: ColumnSortBy | null =
      requestedColumnSort && ALLOWED_COLUMN_SORT.includes(requestedColumnSort) ? requestedColumnSort : null
    const requestedColumnOrder = searchParams.get('sortOrder')
    const columnSortOrder: 'asc' | 'desc' = requestedColumnOrder === 'asc' ? 'asc' : 'desc'
    // When sortBy=lastChangedAt (the new default for the Products table), default to desc.
    const effectiveColumnSort: ColumnSortBy = columnSortBy ?? 'lastChangedAt'
    const effectiveColumnOrder: 'asc' | 'desc' =
      columnSortBy ? columnSortOrder : 'desc'

    const where: Record<string, unknown> = { outletId }
    if (search) {
      // Flexible, case-insensitive, token-aware search.
      // "anti septic" matches "Anti Septic" (case + spacing + word order tolerant).
      const searchClause = buildFlexibleSearch(search, (q) => [
        { name: { contains: q } },
        { sku: { contains: q } },
        { barcode: { contains: q } },
        { unit: { contains: q } },
        { category: { name: { contains: q } } },
        { variants: { some: { name: { contains: q } } } },
        { variants: { some: { sku: { contains: q } } } },
        { variants: { some: { barcode: { contains: q } } } },
      ])
      Object.assign(where, searchClause)
    }
    if (categoryId) {
      where.categoryId = categoryId
    }

    let products: unknown[]
    let total: number

    // ---- Shared mapper: aggregates variant stock/price/hpp and computes _lastChangedAt ----
    // _lastChangedAt = max(product.updatedAt, latest variant.updatedAt).
    // For variant products, an edit to ANY variant bubbles the parent row to the top.
    // (POS sale uses raw SQL — never bumps updatedAt — so this is a safe business proxy.)
    type RawProduct = {
      id: string
      name: string
      sku: string | null
      hpp: number
      price: number
      stock: number
      lowStockAlert: number
      hasVariants: boolean
      createdAt: Date
      updatedAt: Date
      category?: { id: string; name: string; color: string } | null
      _count: { variants: number }
      variants?: Array<{ id: string; name: string; sku: string | null; price: number; hpp: number; stock: number; updatedAt?: Date }>
    }
    const mapProduct = (p: RawProduct) => {
      const vList = p.variants || []
      const aggStock = p.hasVariants && vList.length > 0
        ? vList.reduce((s, v) => s + v.stock, 0)
        : p.stock
      const aggPrice = p.hasVariants && vList.length > 0
        ? Math.min(...vList.map((v) => v.price))
        : p.price
      const maxPrice = p.hasVariants && vList.length > 0
        ? Math.max(...vList.map((v) => v.price))
        : p.price
      const aggHpp = p.hasVariants && vList.length > 0
        ? Math.round(vList.reduce((s, v) => s + v.hpp, 0) / vList.length)
        : p.hpp
      // _lastChangedAt = max(product.updatedAt, latest variant.updatedAt).
      const variantUpdates = vList.map((v) => v.updatedAt ? v.updatedAt.getTime() : 0)
      const lastChangedAt = Math.max(
        p.updatedAt.getTime(),
        ...variantUpdates,
      )
      return {
        ...p,
        hasVariants: !!p.hasVariants,
        _variantCount: p._count.variants,
        variants: p.variants,
        stock: aggStock,
        price: aggPrice,
        _maxPrice: maxPrice,
        hpp: aggHpp,
        _lastChangedAt: new Date(lastChangedAt).toISOString(),
      }
    }

    // ---- Column-sort branch (new API) ----
    // When the client sends sortBy + sortOrder, we override the legacy `sort`
    // enum and sort the entire filtered set in memory (variant aggregation
    // requires it). Then we slice for the requested page. This guarantees
    // sort correctness across pagination per spec point F.
    if (columnSortBy) {
      const [allProducts, count] = await Promise.all([
        db.product.findMany({
          where,
          include: {
            category: { select: { id: true, name: true, color: true } },
            _count: { select: { variants: true } },
            // Include updatedAt so we can compute _lastChangedAt = max(updatedAt, latestVariantUpdatedAt)
            variants: { select: { id: true, name: true, sku: true, price: true, hpp: true, stock: true, updatedAt: true } },
          },
        }),
        db.product.count({ where }),
      ])

      const dirMul = effectiveColumnOrder === 'desc' ? -1 : 1
      allProducts.sort((a, b) => {
        // Compute aggregate values per row for sortable columns.
        const vaOf = (p: typeof allProducts[number]) => {
          const vList = p.variants || []
          switch (effectiveColumnSort) {
            case 'name':
              return (p.name || '').toLowerCase()
            case 'category':
              return (p.category?.name || '').toLowerCase()
            case 'sku':
              return (p.sku || '').toLowerCase()
            case 'hpp':
              return p.hasVariants && vList.length > 0
                ? vList.reduce((s, v) => s + v.hpp, 0) / vList.length
                : p.hpp
            case 'price':
              return p.hasVariants && vList.length > 0
                ? Math.min(...vList.map((v) => v.price))
                : p.price
            case 'stock':
              return p.hasVariants && vList.length > 0
                ? vList.reduce((s, v) => s + v.stock, 0)
                : p.stock
            case 'lastChangedAt':
            default: {
              const vUpdates = vList.map((v) => v.updatedAt ? v.updatedAt.getTime() : 0)
              return Math.max(p.updatedAt.getTime(), ...vUpdates)
            }
          }
        }
        const va = vaOf(a)
        const vb = vaOf(b)
        // Nulls/empty to bottom regardless of direction (spec point F).
        const aEmpty = va === '' || va === null || va === undefined
        const bEmpty = vb === '' || vb === null || vb === undefined
        if (aEmpty && !bEmpty) return 1
        if (!aEmpty && bEmpty) return -1
        if (aEmpty && bEmpty) {
          // both empty — fall through to tie-breaker
        } else if (va < vb) return -1 * dirMul
        else if (va > vb) return 1 * dirMul

        // Tie-breaker: lastChangedAt desc (most recent first), then createdAt desc, then name asc.
        const vaLast = Math.max(
          a.updatedAt.getTime(),
          ...(a.variants || []).map((v) => v.updatedAt ? v.updatedAt.getTime() : 0),
        )
        const vbLast = Math.max(
          b.updatedAt.getTime(),
          ...(b.variants || []).map((v) => v.updatedAt ? v.updatedAt.getTime() : 0),
        )
        if (vaLast !== vbLast) return vbLast - vaLast
        if (a.createdAt.getTime() !== b.createdAt.getTime()) return b.createdAt.getTime() - a.createdAt.getTime()
        return a.name.localeCompare(b.name)
      })

      total = count
      products = allProducts.slice(skip, skip + limit).map(mapProduct)
    } else if (sort === 'best-selling') {
      // Use aggregation instead of loading all transaction items
      const soldAgg = await db.transactionItem.groupBy({
        by: ['productId'],
        where: { transaction: { outletId } },
        _sum: { qty: true },
        _count: true,
      })

      const soldMap = new Map(
        soldAgg.map((s) => [s.productId, (s._sum.qty ?? 0)])
      )

      const [allProducts, count] = await Promise.all([
        db.product.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: {
            category: { select: { id: true, name: true, color: true } },
            _count: { select: { variants: true } },
            variants: { select: { id: true, name: true, sku: true, price: true, hpp: true, stock: true, updatedAt: true } },
          },
        }),
        db.product.count({ where }),
      ])

      // Sort by totalSold descending
      allProducts.sort((a, b) => (soldMap.get(b.id) ?? 0) - (soldMap.get(a.id) ?? 0))

      total = count
      products = allProducts.slice(skip, skip + limit).map((p) => {
        const base = mapProduct(p as unknown as RawProduct)
        return { ...base, _totalSold: soldMap.get(p.id) ?? 0 }
      })
    } else if (sort === 'low-stock' || sort === 'most-stock') {
      // For stock-based sorting, fetch all products (no skip/take) to aggregate variant stock in-memory
      const [allProducts, count] = await Promise.all([
        db.product.findMany({
          where,
          include: {
            category: { select: { id: true, name: true, color: true } },
            _count: { select: { variants: true } },
            variants: { select: { id: true, name: true, sku: true, price: true, hpp: true, stock: true, updatedAt: true } },
          },
        }),
        db.product.count({ where }),
      ])

      // Helper to compute aggregated stock per product
      const getAggStock = (p: typeof allProducts[number]) => {
        const vList = p.variants || []
        return p.hasVariants && vList.length > 0
          ? vList.reduce((s: number, v: { stock: number }) => s + v.stock, 0)
          : p.stock
      }

      // Sort in-memory by aggregated stock
      if (sort === 'low-stock') {
        allProducts.sort((a, b) => getAggStock(a) - getAggStock(b))
      } else {
        allProducts.sort((a, b) => getAggStock(b) - getAggStock(a))
      }

      total = count
      products = allProducts.slice(skip, skip + limit).map((p) => mapProduct(p as unknown as RawProduct))
    } else {
      // Default sort (newest / createdAt desc)
      const [result, count] = await Promise.all([
        db.product.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            category: { select: { id: true, name: true, color: true } },
            _count: { select: { variants: true } },
            variants: { select: { id: true, name: true, sku: true, price: true, hpp: true, stock: true, updatedAt: true } },
          },
        }),
        db.product.count({ where }),
      ])

      products = result.map((p) => mapProduct(p as unknown as RawProduct))
      total = count
    }

    // Analytics stats (computed on all products in outlet, not filtered)
    const [totalCount, categoryCount, statsProducts] = await Promise.all([
      db.product.count({ where: { outletId } }),
      db.category.count({ where: { outletId } }),
      db.product.findMany({
        where: { outletId },
        select: {
          price: true,
          stock: true,
          lowStockAlert: true,
          hasVariants: true,
          variants: { select: { price: true, stock: true } },
        },
      }),
    ])

    const lowStockCount = statsProducts.filter((p) => {
      const aggStock = p.hasVariants && p.variants.length > 0
        ? p.variants.reduce((s, v) => s + v.stock, 0)
        : p.stock
      return aggStock <= p.lowStockAlert && aggStock >= 0
    }).length

    const totalInventoryValue = statsProducts.reduce((sum, p) => {
      const aggStock = p.hasVariants && p.variants.length > 0
        ? p.variants.reduce((s, v) => s + v.stock, 0)
        : p.stock
      const price = p.hasVariants && p.variants.length > 0
        ? p.variants.reduce((s, v) => s + v.price, 0) / p.variants.length
        : Number(p.price)
      return sum + (price * aggStock)
    }, 0)

    const totalQty = statsProducts.reduce((sum, p) => {
      const aggStock = p.hasVariants && p.variants.length > 0
        ? p.variants.reduce((s, v) => s + v.stock, 0)
        : p.stock
      return sum + aggStock
    }, 0)

    // FIX-102 (P0): Changed from CACHE.MEDIUM (30s) to CACHE.SHORT (5s).
    // Products list is mutation-heavy (restock, sale, adjust, bulk update). With 30s cache
    // + 60s stale-while-revalidate, UI showed stale stock values for up to 90 seconds
    // after any mutation — causing the "stock jumping" bug reported by users.
    // 5s is enough for same-page pagination burst; post-mutation refreshes use cache-bust param.
    return safeJson({
      products,
      totalPages: Math.ceil(total / limit),
      stats: {
        total: totalCount,
        totalQty,
        categories: categoryCount,
        lowStock: lowStockCount,
        inventoryValue: totalInventoryValue,
      },
    }, 200, CACHE.SHORT)
  } catch (error) {
    console.error('Products GET error:', error)
    return safeJsonError('Failed to load products')
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const userId = user.id
    const outletId = user.outletId

    // FIX-PLAN-007: Block ALL mutations when the outlet is over-limit after
    // a downgrade. The per-resource maxProducts check below only blocks NEW
    // product creation — this gate also blocks edits/deletes on existing
    // over-limit data, per the platform downgrade policy.
    const overLimitResponse = await assertOutletWithinLimits(outletId)
    if (overLimitResponse) return overLimitResponse

    const body = await request.json()
    const { name, sku, barcode, hpp, price, stock, lowStockAlert, image, categoryId, unit, hasVariants, variants } = body

    if (!name || price === undefined || price === null) {
      return safeJsonError('Product name and price are required', 400)
    }

    // Dynamic product limit based on plan
    const outlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { accountType: true },
    })
    const accountType = resolvePlanType(outlet?.accountType)
    const features = getPlanFeatures(accountType)

    if (!isUnlimited(features.maxProducts)) {
      const count = await db.product.count({ where: { outletId } })
      if (count >= features.maxProducts) {
        return safeJsonError(`Batas produk untuk paket ${accountType} sudah tercapai (${features.maxProducts}). Upgrade ke Pro untuk produk unlimited!`, 400)
      }
    }

    // Check productImage feature
    if (image && !features.productImage) {
      return safeJsonError('Upload gambar produk hanya tersedia di plan Pro ke atas', 403)
    }

    // Check unique name per outlet
    const existing = await db.product.findFirst({
      where: { name, outletId },
    })
    if (existing) {
      return safeJsonError('Product name already exists in this outlet', 400)
    }

    // FIX-B (P0-1 AUDIT-4): Validate user-provided SKU uniqueness per outlet.
    // Schema has NO @@unique on sku — without this check, two products can share
    // the same SKU → POS lookup by SKU returns ambiguous results.
    const trimmedSku = sku?.trim() || ''
    if (trimmedSku) {
      const skuCollision = await db.product.findFirst({
        where: { sku: trimmedSku, outletId },
      })
      if (skuCollision) {
        return safeJsonError(`SKU "${trimmedSku}" sudah digunakan oleh produk lain di outlet ini`, 400)
      }
      // Also check ProductVariant SKUs (variants of other products can collide)
      const variantSkuCollision = await db.productVariant.findFirst({
        where: { sku: trimmedSku, outletId },
      })
      if (variantSkuCollision) {
        return safeJsonError(`SKU "${trimmedSku}" sudah digunakan oleh varian produk lain`, 400)
      }
    }

    // FIX-B (P0-1 AUDIT-4): Validate user-provided barcode uniqueness per outlet.
    const trimmedBarcode = barcode?.trim() || ''
    if (trimmedBarcode) {
      const barcodeCollision = await db.product.findFirst({
        where: { barcode: trimmedBarcode, outletId },
      })
      if (barcodeCollision) {
        return safeJsonError(`Barcode "${trimmedBarcode}" sudah digunakan oleh produk lain di outlet ini`, 400)
      }
    }

    // Validate categoryId if provided
    if (categoryId) {
      const category = await db.category.findFirst({
        where: { id: categoryId, outletId },
      })
      if (!category) {
        return safeJsonError('Category not found', 400)
      }
    }

    // Validate variants if hasVariants is true
    const parsedVariants: VariantPayload[] = Array.isArray(variants) ? variants : []
    if (hasVariants && parsedVariants.length === 0) {
      return safeJsonError('Setidaknya satu varian diperlukan saat hasVariants bernilai true', 400)
    }

    // Check for duplicate variant names
    if (parsedVariants.length > 0) {
      const variantNames = parsedVariants.map((v) => v.name?.trim().toLowerCase()).filter(Boolean)
      const uniqueNames = new Set(variantNames)
      if (uniqueNames.size !== variantNames.length) {
        return safeJsonError('Nama varian tidak boleh duplikat', 400)
      }
    }

    // Auto-generate SKU if not provided
    const finalSku = sku?.trim() ? sku.trim() : await generateUniqueSKU(name, outletId)
    // AETHER BARCODE CONTRACT: Manual barcode saved exactly as-is.
    // If barcode is empty, generate unique AET- format barcode (NOT SKU fallback).
    const finalBarcode = barcode?.trim() || await generateUniqueBarcode(name, outletId)

    // Auto-generate SKUs and barcodes for variants that don't have them
    // AETHER BARCODE CONTRACT: Variant barcode respects user input;
    // only auto-generates if barcode field is empty.
    const variantsWithSku = await Promise.all(
      parsedVariants.map(async (v) => {
        const vSku = v.sku?.trim() || await generateVariantSKU(name, v.name, outletId)
        const vBarcode = v.barcode?.trim() || await generateVariantBarcode(name, v.name, outletId)
        return {
          ...v,
          sku: vSku,
          barcode: vBarcode,
        }
      })
    )

    const product = await db.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: {
          name,
          sku: finalSku,
          barcode: finalBarcode,
          hpp: hpp || 0,
          price,
          stock: stock || 0,
          lowStockAlert: lowStockAlert || 10,
          image: image || null,
          categoryId: categoryId || null,
          unit: unit || 'pcs',
          outletId,
          hasVariants: !!hasVariants,
        },
      })

      // Create variants if provided
      if (variantsWithSku.length > 0) {
        await tx.productVariant.createMany({
          data: variantsWithSku.map((v) => ({
            productId: newProduct.id,
            name: v.name,
            sku: v.sku,
            barcode: v.barcode,
            hpp: v.hpp || 0,
            price: v.price,
            stock: v.stock || 0,
            outletId,
          })),
        })
      }

      await emitAuditEvent(
        tx,
        buildProductChangeEvent({
          productId: newProduct.id,
          productName: newProduct.name,
          sku: newProduct.sku,
          changeType: 'created',
          after: {
            name: newProduct.name,
            sku: newProduct.sku,
            barcode: newProduct.barcode,
            hpp: newProduct.hpp,
            price: newProduct.price,
            stock: newProduct.stock,
            lowStockAlert: newProduct.lowStockAlert,
            unit: newProduct.unit,
            categoryId: newProduct.categoryId,
            hasVariants: !!hasVariants,
            variantCount: parsedVariants.length,
          },
          source: 'manual',
          outletId,
          userId,
        }),
      )

      return newProduct
    })

    // Fetch the created product with variants
    let productResult
    if (variantsWithSku.length > 0) {
      productResult = await db.product.findUnique({
        where: { id: product.id },
        include: {
          _count: { select: { variants: true } },
          variants: { select: { id: true, name: true, sku: true, price: true, hpp: true, stock: true } },
        },
      })
    } else {
      productResult = await db.product.findUnique({
        where: { id: product.id },
        include: {
          _count: { select: { variants: true } },
        },
      })
    }

    return safeJsonCreated({
      ...product,
      hasVariants: !!product.hasVariants,
      _variantCount: productResult?._count?.variants ?? 0,
      variants: productResult?.variants ?? [],
    })
  } catch (error) {
    console.error('Products POST error:', error)
    return safeJsonError('Failed to create product')
  }
}
