import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { db } from '@/lib/db'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/safe-response'

// GET /api/settings/promos — list all promos
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') === 'true'

    const where: Record<string, unknown> = { outletId: user.outletId }
    if (activeOnly) where.active = true

    const promos = await db.promo.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return safeJson({ promos })
  } catch (error) {
    console.error('GET /api/settings/promos error:', error)
    return safeJsonError('Internal server error', 500)
  }
}

// POST /api/settings/promos — create promo
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  // Only OWNER can manage promos
  if (user.role !== 'OWNER') {
    return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
  }

  try {
    const body = await request.json()
    const { name, type, value, minPurchase, maxDiscount, active, buyMinQty, discountType, categoryId } = body

    if (!name || !type || value === undefined) {
      return safeJsonError('Nama, tipe, dan nilai diskon wajib diisi', 400)
    }

    const numValue = Number(value)
    if (isNaN(numValue)) {
      return safeJsonError('Nilai diskon harus berupa angka', 400)
    }

    // L4: Create promo with audit log
    const promo = await db.$transaction(async (tx) => {
      const newPromo = await tx.promo.create({
        data: {
          name,
          type,
          value: numValue,
          minPurchase: minPurchase ? Number(minPurchase) || null : null,
          maxDiscount: maxDiscount ? Number(maxDiscount) || null : null,
          active: active !== undefined ? active : true,
          outletId: user.outletId,
          buyMinQty: type === 'BUY_X_GET_DISCOUNT' ? (Number(buyMinQty) || 2) : 0,
          discountType: type === 'BUY_X_GET_DISCOUNT' ? (discountType || 'PERCENTAGE') : 'PERCENTAGE',
          categoryId: categoryId || null,
        },
      })

      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'PROMO',
          entityId: newPromo.id,
          details: JSON.stringify({ promoName: newPromo.name, type: newPromo.type, value: newPromo.value }),
          outletId: user.outletId,
          userId: user.id,
        },
      })

      return newPromo
    })

    return safeJsonCreated(promo)
  } catch (error) {
    console.error('POST /api/settings/promos error:', error)
    return safeJsonError('Internal server error', 500)
  }
}
