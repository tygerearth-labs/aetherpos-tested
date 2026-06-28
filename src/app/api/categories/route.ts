import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getFeaturesForOutlet, isUnlimited } from '@/lib/config/plan-config'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'

// GET /api/categories — list all categories for the outlet
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const categories = await db.category.findMany({
      where: { outletId: user.outletId },
      orderBy: [{ name: 'asc' }],
      include: {
        _count: { select: { products: true } },
      },
    })

    return safeJson({ categories })
  } catch (error) {
    console.error('Categories GET error:', error)
    return safeJsonError('Failed to load categories')
  }
}

// POST /api/categories — create a new category
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const planData = await getFeaturesForOutlet(db, user.outletId)
    if (planData?.features) {
      const { maxCategories } = planData.features
      if (!isUnlimited(maxCategories)) {
        const count = await db.category.count({ where: { outletId: user.outletId } })
        if (count >= maxCategories) {
          return safeJsonError(`Batas kategori (${maxCategories}) sudah tercapai. Upgrade plan untuk menambah kategori.`, 403)
        }
      }
    }

    const body = await request.json()
    const { name, color } = body

    if (!name || !name.trim()) {
      return safeJsonError('Category name is required', 400)
    }

    // Check unique name per outlet
    const existing = await db.category.findFirst({
      where: { name: name.trim(), outletId: user.outletId },
    })
    if (existing) {
      return safeJsonError('Category name already exists', 400)
    }

    const category = await db.category.create({
      data: {
        name: name.trim(),
        color: color || 'zinc',
        outletId: user.outletId,
      },
    })

    return safeJsonCreated(category)
  } catch (error) {
    console.error('Categories POST error:', error)
    return safeJsonError('Failed to create category')
  }
}
