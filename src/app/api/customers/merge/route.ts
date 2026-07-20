import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'OWNER') {
      return safeJsonError('Only the owner can merge customers', 403)
    }
    const outletId = user.outletId
    const userId = user.id

    const body = await request.json()
    const { sourceId, targetId } = body

    // Validate required fields
    if (!sourceId || !targetId) {
      return safeJsonError('Both sourceId and targetId are required', 400)
    }
    if (sourceId === targetId) {
      return safeJsonError('sourceId and targetId must be different', 400)
    }

    // Perform the merge inside a single transaction with 30s timeout
    const result = await db.$transaction(async (tx) => {
      // 1. Fetch both customers with transaction counts and loyalty points
      // CUST-002 FIX: filter `deletedAt: null` so soft-deleted customers
      // cannot be picked as source or target of a merge.
      const [source, target] = await Promise.all([
        tx.customer.findFirst({
          where: { id: sourceId, outletId, deletedAt: null },
        }),
        tx.customer.findFirst({
          where: { id: targetId, outletId, deletedAt: null },
        }),
      ])

      if (!source) {
        throw Object.assign(new Error('Source customer not found'), { status: 404 })
      }
      if (!target) {
        throw Object.assign(new Error('Target customer not found'), { status: 404 })
      }
      if (source.outletId !== target.outletId) {
        throw Object.assign(new Error('Customers are in different outlets and cannot be merged'), { status: 409 })
      }

      // Get transaction count for the merge summary
      const transactionCount = await tx.transaction.count({
        where: { customerId: sourceId },
      })

      // 2. Update ALL transactions: reassign from source to target
      await tx.transaction.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      })

      // 3. Update ALL loyalty logs: reassign from source to target
      await tx.loyaltyLog.updateMany({
        where: { customerId: sourceId },
        data: { customerId: targetId },
      })

      // 4. Update target customer: accumulate spend and points
      await tx.customer.update({
        where: { id: targetId },
        data: {
          totalSpend: { increment: source.totalSpend },
          points: { increment: source.points },
        },
      })

      // 5. Soft-delete source customer (CUST-002 FIX — preserve audit trail).
      //    The source's transactions and loyalty logs have been reassigned to
      //    target (steps 2 and 3), so the source record's only remaining
      //    value is its name/whatsapp (preserved in the MERGE audit log entry
      //    below). Soft-delete keeps the source row for audit-trail queries
      //    but excludes it from active customer lists.
      await tx.customer.update({
        where: { id: sourceId },
        data: { deletedAt: new Date() },
      })

      // 6. Create audit log inside the transaction
      await tx.auditLog.create({
        data: {
          action: 'MERGE',
          entityType: 'CUSTOMER',
          entityId: targetId,
          details: JSON.stringify({
            sourceName: source.name,
            sourceId: source.id,
            targetName: target.name,
            targetId: target.id,
            sourceTransactions: transactionCount,
            sourcePoints: source.points,
            sourceTotalSpend: source.totalSpend,
          }),
          outletId,
          userId,
        },
      })

      return {
        sourceId: source.id,
        targetId: target.id,
        transactionsMoved: transactionCount,
        pointsTransferred: source.points,
        spendTransferred: source.totalSpend,
      }
    }, { timeout: 30000 })

    return safeJson({
      success: true,
      merged: result,
    })
  } catch (error) {
    // Handle known error statuses thrown inside the transaction
    const status = (error as { status?: number })?.status
    const message = error instanceof Error ? error.message : 'Failed to merge customers'

    if (status && status >= 400 && status < 500) {
      return safeJsonError(message, status)
    }

    console.error('Customer merge error:', error)
    return safeJsonError('Failed to merge customers', 500)
  }
}