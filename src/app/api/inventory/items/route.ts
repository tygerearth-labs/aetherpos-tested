import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'

// GET /api/inventory/items — list inventory items for outlet
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const search = searchParams.get('search') || ''
    const categoryId = searchParams.get('categoryId') || ''
    const activeOnly = searchParams.get('activeOnly') !== 'false' // default: true

    const where: Record<string, unknown> = { outletId: user.outletId }

    if (activeOnly) {
      where.status = 'ACTIVE'
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { baseUnit: { contains: search } },
        { category: { name: { contains: search } } },
      ]
    }
    if (categoryId) {
      where.categoryId = categoryId
    }

    const items = await db.inventoryItem.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true, color: true } },
        _count: { select: { compositions: true, purchaseItems: true } },
      },
    })

    return safeJson({ items: items.map((i) => ({ ...i, status: i.status })) })
  } catch (error) {
    console.error('Inventory items GET error:', error)
    return safeJsonError('Failed to load inventory items')
  }
}

// POST /api/inventory/items — create new inventory item
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()
    const { name, sku, baseUnit, lowStockAlert, categoryId, stock, avgCost } = body

    if (!name || !name.trim()) {
      return safeJsonError('Item name is required', 400)
    }
    if (!baseUnit || !baseUnit.trim()) {
      return safeJsonError('Base unit is required', 400)
    }

    // Validate categoryId if provided
    if (categoryId) {
      const category = await db.inventoryCategory.findFirst({
        where: { id: categoryId, outletId: user.outletId },
      })
      if (!category) {
        return safeJsonError('Category not found', 400)
      }
    }

    // Check for duplicate name within same outlet
    const existingItem = await db.inventoryItem.findFirst({
      where: { name: name.trim(), outletId: user.outletId },
    })
    if (existingItem) {
      return safeJsonError(`Item "${name.trim()}" sudah ada di outlet ini`, 409)
    }

    try {
      const item = await db.inventoryItem.create({
        data: {
          name: name.trim(),
          sku: sku?.trim() || null,
          baseUnit: baseUnit.trim(),
          stock: stock || 0,
          avgCost: avgCost || 0,
          lowStockAlert: lowStockAlert || 0,
          outletId: user.outletId,
          categoryId: categoryId || null,
        },
      })

      return safeJsonCreated(item)
    } catch (error: unknown) {
      const prismaError = error as { code?: string }
      if (prismaError.code === 'P2002') {
        return safeJsonError(`Item "${name.trim()}" sudah ada di outlet ini`, 409)
      }
      console.error('Inventory items POST error:', error)
      return safeJsonError('Failed to create inventory item')
    }
  } catch (error) {
    console.error('Inventory items POST error:', error)
    return safeJsonError('Failed to create inventory item')
  }
}