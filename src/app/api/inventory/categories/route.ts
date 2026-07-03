import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'

// GET /api/inventory/categories — list all inventory categories for outlet
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const categories = await db.inventoryCategory.findMany({
      where: { outletId: user.outletId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { items: true } },
      },
    })

    return safeJson({ categories })
  } catch (error) {
    console.error('Inventory categories GET error:', error)
    return safeJsonError('Failed to load inventory categories')
  }
}

// POST /api/inventory/categories — create new inventory category
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()
    const { name, color } = body

    if (!name || !name.trim()) {
      return safeJsonError('Category name is required', 400)
    }

    const trimmedName = name.trim()

    // Check unique [name, outletId]
    const existing = await db.inventoryCategory.findFirst({
      where: { name: trimmedName, outletId: user.outletId },
    })
    if (existing) {
      return safeJsonError('Category name already exists in this outlet', 400)
    }

    const category = await db.inventoryCategory.create({
      data: {
        name: trimmedName,
        color: color || 'zinc',
        outletId: user.outletId,
      },
    })

    return safeJsonCreated(category)
  } catch (error) {
    console.error('Inventory categories POST error:', error)
    return safeJsonError('Failed to create inventory category')
  }
}