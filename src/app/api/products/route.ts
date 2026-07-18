import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination, resolvePlanType, buildFlexibleSearch } from '@/lib/api/api-helpers'
import { getPlanFeatures, isUnlimited } from '@/lib/config/plan-config'
import { safeJson, safeJsonCreated, safeJsonError, CACHE } from '@/lib/api/safe-response'
import { generateUniqueSKU, generateVariantSKU } from '@/lib/sku-generator'

type SortOption = 'newest' | 'best-selling' | 'low-stock' | 'most-stock'

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

    if (sort === 'best-selling') {
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
            variants: { select: { id: true, name: true, sku: true, price: true, hpp: true, stock: true } },
          },
        }),
        db.product.count({ where }),
      ])

      // Sort by totalSold descending
      allProducts.sort((a, b) => (soldMap.get(b.id) ?? 0) - (soldMap.get(a.id) ?? 0))

      total = count
      products = allProducts.slice(skip, skip + limit).map((p) => {
        // When hasVariants, aggregate stock & price from variants
        const vList = p.variants || []
        const aggStock = p.hasVariants && vList.length > 0
          ? vList.reduce((s: number, v: { stock: number }) => s + v.stock, 0)
          : p.stock
        const aggPrice = p.hasVariants && vList.length > 0
          ? Math.min(...vList.map((v: { price: number }) => v.price))
          : p.price
        const maxPrice = p.hasVariants && vList.length > 0
          ? Math.max(...vList.map((v: { price: number }) => v.price))
          : p.price
        // Aggregate HPP: for variant products, average from variants; otherwise use product.hpp
        const aggHpp = p.hasVariants && vList.length > 0
          ? Math.round(vList.reduce((s: number, v: { hpp: number }) => s + v.hpp, 0) / vList.length)
          : p.hpp
        return {
          ...p,
          _totalSold: soldMap.get(p.id) ?? 0,
          hasVariants: !!p.hasVariants,
          _variantCount: p._count.variants,
          variants: p.variants,
          // Aggregated display values
          stock: aggStock,
          price: aggPrice,
          _maxPrice: maxPrice,
          hpp: aggHpp,
        }
      })
    } else if (sort === 'low-stock' || sort === 'most-stock') {
      // For stock-based sorting, fetch all products (no skip/take) to aggregate variant stock in-memory
      const [allProducts, count] = await Promise.all([
        db.product.findMany({
          where,
          include: {
            category: { select: { id: true, name: true, color: true } },
            _count: { select: { variants: true } },
            variants: { select: { id: true, name: true, sku: true, price: true, hpp: true, stock: true } },
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
      products = allProducts.slice(skip, skip + limit).map((p) => {
        const vList = p.variants || []
        const aggStock = p.hasVariants && vList.length > 0
          ? vList.reduce((s: number, v: { stock: number }) => s + v.stock, 0)
          : p.stock
        const aggPrice = p.hasVariants && vList.length > 0
          ? Math.min(...vList.map((v: { price: number }) => v.price))
          : p.price
        const maxPrice = p.hasVariants && vList.length > 0
          ? Math.max(...vList.map((v: { price: number }) => v.price))
          : p.price
        const aggHpp = p.hasVariants && vList.length > 0
          ? Math.round(vList.reduce((s: number, v: { hpp: number }) => s + v.hpp, 0) / vList.length)
          : p.hpp
        return {
          ...p,
          hasVariants: !!p.hasVariants,
          _variantCount: p._count.variants,
          variants: p.variants,
          stock: aggStock,
          price: aggPrice,
          _maxPrice: maxPrice,
          hpp: aggHpp,
        }
      })
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
            variants: { select: { id: true, name: true, sku: true, price: true, hpp: true, stock: true } },
          },
        }),
        db.product.count({ where }),
      ])

      products = result.map((p) => {
        const vList = p.variants || []
        const aggStock = p.hasVariants && vList.length > 0
          ? vList.reduce((s: number, v: { stock: number }) => s + v.stock, 0)
          : p.stock
        const aggPrice = p.hasVariants && vList.length > 0
          ? Math.min(...vList.map((v: { price: number }) => v.price))
          : p.price
        const maxPrice = p.hasVariants && vList.length > 0
          ? Math.max(...vList.map((v: { price: number }) => v.price))
          : p.price
        const aggHpp = p.hasVariants && vList.length > 0
          ? Math.round(vList.reduce((s: number, v: { hpp: number }) => s + v.hpp, 0) / vList.length)
          : p.hpp
        return {
          ...p,
          hasVariants: !!p.hasVariants,
          _variantCount: p._count.variants,
          variants: p.variants,
          stock: aggStock,
          price: aggPrice,
          _maxPrice: maxPrice,
          hpp: aggHpp,
        }
      })
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
    }, 200, CACHE.MEDIUM)
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
    // Auto-generate barcode from SKU if not provided
    const finalBarcode = barcode?.trim() || finalSku

    // Auto-generate SKUs for variants that don't have one
    const variantsWithSku = await Promise.all(
      parsedVariants.map(async (v) => {
        const vSku = v.sku?.trim() || await generateVariantSKU(name, v.name, outletId)
        return {
          ...v,
          sku: vSku,
          barcode: vSku, // barcode = sku for variants
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

      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'PRODUCT',
          entityId: newProduct.id,
          details: JSON.stringify({
            name: newProduct.name,
            sku: newProduct.sku || null,
            price: newProduct.price,
            stock: newProduct.stock,
            hasVariants: !!hasVariants,
            variantCount: parsedVariants.length,
          }),
          outletId,
          userId,
        },
      })

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
