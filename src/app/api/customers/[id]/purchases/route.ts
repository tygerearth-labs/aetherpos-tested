import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getVoidedTxIds, parsePagination } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId

    const { id } = await params

    // Verify customer belongs to this outlet (and is not soft-deleted)
    const customer = await db.customer.findFirst({
      where: { id, outletId, deletedAt: null },
    })
    if (!customer) {
      return safeJsonError('Customer not found', 404)
    }

    // CUST-005 FIX: Proper pagination using parsePagination helper
    // (was previously hard-coded `take: 20` with no `skip`, so customers
    // with >20 transactions could not view older history).
    const { searchParams } = request.nextUrl
    const { skip, limit } = parsePagination(searchParams)

    // CUST-004 FIX: Exclude voided transactions from the customer's purchase
    // history. The /api/transactions list endpoint already filters voided txs
    // via getVoidedTxIds — this brings the per-customer endpoint in line.
    const voidedTxIds = await getVoidedTxIds(db, outletId)

    const [transactions, total] = await Promise.all([
      db.transaction.findMany({
        where: {
          customerId: id,
          outletId,
          id: { notIn: Array.from(voidedTxIds).filter((v): v is string => v !== null) },
        },
        include: {
          items: {
            select: {
              productName: true,
              variantName: true,
              qty: true,
              price: true,
              subtotal: true,
            },
          },
          // CUST-009 FIX: Include loyalty logs so the per-transaction
          // loyalty point delta can be shown in the purchase history.
          loyaltyLogs: {
            select: { type: true, points: true, description: true },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.transaction.count({
        where: {
          customerId: id,
          outletId,
          id: { notIn: Array.from(voidedTxIds).filter((v): v is string => v !== null) },
        },
      }),
    ])

    const mapped = transactions.map((tx) => {
      // CUST-009 FIX: Compute net loyalty point delta for this transaction
      // by summing LoyaltyLog.points (EARN is positive, REDEEM is negative).
      const loyaltyDelta = tx.loyaltyLogs.reduce((sum, log) => sum + log.points, 0)
      return {
        id: tx.id,
        invoiceNumber: tx.invoiceNumber,
        date: tx.createdAt,
        itemCount: tx.items.length,
        total: tx.total,
        paymentMethod: tx.paymentMethod,
        items: tx.items.map((item) => ({
          productName: item.variantName ? `${item.productName} - ${item.variantName}` : item.productName,
          qty: item.qty,
          price: item.price,
          subtotal: item.subtotal,
        })),
        // CUST-009 FIX: expose loyalty activity per transaction (may be empty
        // if the customer had no earn/redeem on this tx — e.g. loyalty disabled).
        loyalty: {
          delta: loyaltyDelta,
          logs: tx.loyaltyLogs.map((log) => ({
            type: log.type,
            points: log.points,
            description: log.description,
          })),
        },
      }
    })

    return safeJson({
      purchases: mapped,
      totalPages: Math.ceil(total / limit) || 1,
      total,
    })
  } catch (error) {
    console.error('Customer purchases GET error:', error)
    return safeJsonError('Failed to load purchase history', 500)
  }
}
