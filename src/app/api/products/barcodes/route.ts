import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { withInsensitiveMode } from '@/lib/api/api-helpers'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    const categoryId = request.nextUrl.searchParams.get('categoryId') || ''
    const search = request.nextUrl.searchParams.get('search') || ''

    const where: Record<string, unknown> = { outletId }
    if (categoryId) where.categoryId = categoryId
    if (search) {
      where.OR = withInsensitiveMode([
        { name: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } },
      ]) as Record<string, unknown>[]
    }

    const products = await db.product.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        variants: {
          select: { id: true, name: true, sku: true, barcode: true, price: true, stock: true },
          orderBy: { name: 'asc' },
        },
      },
    })

    // AETHER BARCODE CONTRACT: Return barcode exactly as stored in DB.
    // No SKU fallback — if barcode is null, the label simply won't render.
    // This ensures label encodes the exact DB value and scanner reads the same value.
    const mapped = products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      price: p.price,
      category: p.category,
      hasVariants: !!p.hasVariants,
      variants: p.variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        barcode: v.barcode,
        price: v.price,
        stock: v.stock,
      })),
    }))

    return safeJson(mapped)
  } catch (error) {
    console.error('Barcodes GET error:', error)
    return safeJsonError('Failed to load barcodes')
  }
}