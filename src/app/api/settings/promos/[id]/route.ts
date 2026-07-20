import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { db } from '@/lib/db'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

// PUT /api/settings/promos/[id] — update promo
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  // Only OWNER can manage promos
  if (user.role !== 'OWNER') {
    return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
  }

  try {
    const { id } = await params

    // Verify promo belongs to outlet
    const existing = await db.promo.findUnique({ where: { id } })
    if (!existing || existing.outletId !== user.outletId) {
      return safeJsonError('Promo tidak ditemukan', 404)
    }

    const body = await request.json()
    const { name, type, value, minPurchase, maxDiscount, active, buyMinQty, discountType, categoryId } = body

    // Validate numeric fields
    if (value !== undefined) {
      const numValue = Number(value)
      if (isNaN(numValue) || !Number.isFinite(numValue)) {
        return safeJsonError('Nilai diskon harus berupa angka', 400)
      }
      // SET-013 (parity with POST): enforce non-negative value, and <= 100 for
      // percentage-like types. Without this, a PUT could bypass the bounds the
      // POST route enforces.
      if (numValue < 0) {
        return safeJsonError('Nilai diskon tidak boleh negatif', 400)
      }
      const effectiveType = type ?? existing.type
      const effectiveDiscountType = (type === 'BUY_X_GET_DISCOUNT' ? (discountType ?? 'PERCENTAGE') : existing.discountType) || 'PERCENTAGE'
      const isPercentageLike = effectiveType === 'PERCENTAGE'
        || (effectiveType === 'BUY_X_GET_DISCOUNT' && effectiveDiscountType === 'PERCENTAGE')
      if (isPercentageLike && numValue > 100) {
        return safeJsonError('Nilai diskon persentase tidak boleh lebih dari 100', 400)
      }
    }
    // Validate minPurchase / maxDiscount bounds if provided.
    if (minPurchase !== undefined && minPurchase !== null && minPurchase !== '') {
      const n = Number(minPurchase)
      if (!Number.isFinite(n) || n < 0) {
        return safeJsonError('minPurchase harus berupa angka >= 0', 400)
      }
    }
    if (maxDiscount !== undefined && maxDiscount !== null && maxDiscount !== '') {
      const n = Number(maxDiscount)
      if (!Number.isFinite(n) || n < 0) {
        return safeJsonError('maxDiscount harus berupa angka >= 0', 400)
      }
    }

    // L4: Track changes for audit
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    if (name !== undefined && name !== existing.name) changes.name = { from: existing.name, to: name }
    if (type !== undefined && type !== existing.type) changes.type = { from: existing.type, to: type }
    if (value !== undefined && !isNaN(Number(value)) && Number(value) !== existing.value) changes.value = { from: existing.value, to: Number(value) }
    if (active !== undefined && active !== existing.active) changes.active = { from: existing.active, to: active }
    if (buyMinQty !== undefined && !isNaN(Number(buyMinQty)) && Number(buyMinQty) !== existing.buyMinQty) changes.buyMinQty = { from: existing.buyMinQty, to: Number(buyMinQty) }
    if (discountType !== undefined && discountType !== existing.discountType) changes.discountType = { from: existing.discountType, to: discountType }
    if (categoryId !== undefined && categoryId !== existing.categoryId) changes.categoryId = { from: existing.categoryId, to: categoryId }
    // SET-015 FIX: Track minPurchase and maxDiscount changes. Previously these
    // were applied to the DB (lines below) but never recorded in the audit log
    // — owners could not audit-trail changes to a promo's min-purchase threshold
    // or max-discount cap. Coerce to Number|null to match DB storage shape.
    if (minPurchase !== undefined) {
      const newVal = minPurchase === null || minPurchase === '' ? null : (Number(minPurchase) || null)
      if (newVal !== existing.minPurchase) changes.minPurchase = { from: existing.minPurchase, to: newVal }
    }
    if (maxDiscount !== undefined) {
      const newVal = maxDiscount === null || maxDiscount === '' ? null : (Number(maxDiscount) || null)
      if (newVal !== existing.maxDiscount) changes.maxDiscount = { from: existing.maxDiscount, to: newVal }
    }

    const promo = await db.$transaction(async (tx) => {
      const updated = await tx.promo.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(type !== undefined && { type }),
          ...(value !== undefined && { value: Number(value) }),
          ...(minPurchase !== undefined && { minPurchase: minPurchase ? (Number(minPurchase) || null) : null }),
          ...(maxDiscount !== undefined && { maxDiscount: maxDiscount ? (Number(maxDiscount) || null) : null }),
          ...(active !== undefined && { active }),
          ...(buyMinQty !== undefined && { buyMinQty: Number(buyMinQty) || 0 }),
          ...(discountType !== undefined && { discountType }),
          ...(categoryId !== undefined && { categoryId: categoryId || null }),
        },
      })

      if (Object.keys(changes).length > 0) {
        await tx.auditLog.create({
          data: {
            action: 'UPDATE',
            entityType: 'PROMO',
            entityId: id,
            details: JSON.stringify({ promoName: updated.name, changes }),
            outletId: user.outletId,
            userId: user.id,
          },
        })
      }

      return updated
    })

    return safeJson(promo)
  } catch (error) {
    console.error('PUT /api/settings/promos/[id] error:', error)
    return safeJsonError('Internal server error', 500)
  }
}

// DELETE /api/settings/promos/[id] — delete promo
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  // Only OWNER can manage promos
  if (user.role !== 'OWNER') {
    return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
  }

  try {
    const { id } = await params

    // Verify promo belongs to outlet
    const existing = await db.promo.findUnique({ where: { id } })
    if (!existing || existing.outletId !== user.outletId) {
      return safeJsonError('Promo tidak ditemukan', 404)
    }

    // L4: Audit log before delete
    await safeAuditLog({
      action: 'DELETE',
      entityType: 'PROMO',
      entityId: id,
      details: JSON.stringify({ promoName: existing.name, type: existing.type, value: existing.value }),
      outletId: user.outletId,
      userId: user.id,
    })

    await db.promo.delete({ where: { id } })

    return safeJson({ success: true })
  } catch (error) {
    console.error('DELETE /api/settings/promos/[id] error:', error)
    return safeJsonError('Internal server error', 500)
  }
}
