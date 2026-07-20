import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'OWNER') {
      return safeJsonError('Only OWNER can adjust loyalty points', 403)
    }

    const outletId = user.outletId
    const { id } = await params

    const customer = await db.customer.findFirst({
      where: { id, outletId, deletedAt: null },
    })
    if (!customer) {
      return safeJsonError('Customer not found', 404)
    }

    const body = await request.json()
    const { type, points, reason } = body

    if (!type || !['ADD', 'DEDUCT'].includes(type)) {
      return safeJsonError('Type must be ADD or DEDUCT', 400)
    }

    if (!points || typeof points !== 'number' || points <= 0) {
      return safeJsonError('Points must be a positive number', 400)
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return safeJsonError('Reason is required', 400)
    }

    // If deducting, check customer has enough points
    if (type === 'DEDUCT' && customer.points < points) {
      return safeJsonError(`Customer only has ${customer.points} points`, 400)
    }

    const pointsChange = type === 'ADD' ? points : -points

    // Create loyalty log and update customer points
    // CUST-003 FIX: Also create an AuditLog entry inside the same transaction
    // so manual loyalty adjustments appear in the unified audit-log stream
    // (every other customer mutation — CREATE/UPDATE/DELETE/MERGE — already
    // creates an AuditLog entry; this closes the gap).
    const updated = await db.$transaction(async (tx) => {
      await tx.loyaltyLog.create({
        data: {
          type: 'ADJUST',
          points: pointsChange,
          description: `${type === 'ADD' ? '+' : '-'}${points} poin — ${reason.trim()}`,
          customerId: id,
        },
      })

      const updatedCustomer = await tx.customer.update({
        where: { id },
        data: { points: { increment: pointsChange } },
      })

      await tx.auditLog.create({
        data: {
          action: 'LOYALTY_ADJUSTMENT',
          entityType: 'CUSTOMER',
          entityId: id,
          details: JSON.stringify({
            customerId: id,
            customerName: customer.name,
            delta: pointsChange,
            reason: reason.trim(),
            newBalance: updatedCustomer.points,
          }),
          outletId,
          userId: user.id,
        },
      })

      return updatedCustomer
    })

    return safeJson(updated)
  } catch (error) {
    console.error('Loyalty adjust POST error:', error)
    return safeJsonError('Failed to adjust loyalty points', 500)
  }
}
