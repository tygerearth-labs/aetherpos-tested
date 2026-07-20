import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { db } from '@/lib/db'
import { getFeaturesForOutlet, isUnlimited } from '@/lib/config/plan-config'
import { assertOutletWithinLimits } from '@/lib/api/plan-enforcement'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'

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

  // FIX-PLAN-007: Block mutations when the outlet is over-limit.
  const overLimitResponse = await assertOutletWithinLimits(user.outletId)
  if (overLimitResponse) return overLimitResponse

  try {
    const body = await request.json()
    const { name, type, value, minPurchase, maxDiscount, active, buyMinQty, discountType, categoryId } = body

    if (!name || !type || value === undefined) {
      return safeJsonError('Nama, tipe, dan nilai diskon wajib diisi', 400)
    }

    const planData = await getFeaturesForOutlet(db, user.outletId)
    if (planData?.features) {
      const { maxPromos, promoTypes } = planData.features
      if (!isUnlimited(maxPromos)) {
        const count = await db.promo.count({ where: { outletId: user.outletId } })
        if (count >= maxPromos) {
          return safeJsonError(`Batas promo (${maxPromos}) sudah tercapai. Upgrade plan untuk menambah promo.`, 403)
        }
      }
      if (promoTypes && promoTypes.length > 0) {
        const allowedTypes = promoTypes as string[]
        if (!allowedTypes.includes(type)) {
          return safeJsonError(`Tipe promo "${type}" tidak tersedia di plan Anda. Tipe yang tersedia: ${allowedTypes.join(', ')}`, 403)
        }
      }
    }

    const numValue = Number(value)
    if (isNaN(numValue) || !Number.isFinite(numValue)) {
      return safeJsonError('Nilai diskon harus berupa angka', 400)
    }
    // SET-013 FIX: Enforce value bounds. A negative value would silently ADD
    // to the subtotal (per audit SET-013). A percentage > 100 would produce a
    // negative total (caught downstream at checkout line 188, but better to
    // reject here with a clearer message).
    if (numValue < 0) {
      return safeJsonError('Nilai diskon tidak boleh negatif', 400)
    }
    // For PERCENTAGE type (and BUY_X_GET_DISCOUNT with discountType=PERCENTAGE),
    // the value is a percentage and must be 0-100.
    const isPercentageLike = type === 'PERCENTAGE'
      || (type === 'BUY_X_GET_DISCOUNT' && (discountType || 'PERCENTAGE') === 'PERCENTAGE')
    if (isPercentageLike && numValue > 100) {
      return safeJsonError('Nilai diskon persentase tidak boleh lebih dari 100', 400)
    }
    // Validate minPurchase / maxDiscount bounds if provided.
    const numMinPurchase = minPurchase != null && minPurchase !== '' ? Number(minPurchase) : null
    const numMaxDiscount = maxDiscount != null && maxDiscount !== '' ? Number(maxDiscount) : null
    if (numMinPurchase != null && (!Number.isFinite(numMinPurchase) || numMinPurchase < 0)) {
      return safeJsonError('minPurchase harus berupa angka >= 0', 400)
    }
    if (numMaxDiscount != null && (!Number.isFinite(numMaxDiscount) || numMaxDiscount < 0)) {
      return safeJsonError('maxDiscount harus berupa angka >= 0', 400)
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
