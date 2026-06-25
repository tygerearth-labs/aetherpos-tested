import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

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
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } },
      ]
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

    // Fallback barcode = sku for old products
    const mapped = products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode || p.sku || null,
      price: p.price,
      category: p.category,
      hasVariants: !!p.hasVariants,
      variants: p.variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku,
        barcode: v.barcode || v.sku || null,
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