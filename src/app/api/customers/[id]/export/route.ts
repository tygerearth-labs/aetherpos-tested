import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { CACHE } from '@/lib/api/safe-response'

/**
 * CUST-007 FIX (P2 partial): GDPR data-export stub for a single customer.
 *
 * Returns all personal data the system holds about a customer, structured
 * for portability (right to data portability under GDPR Article 20):
 *   - Customer profile (name, whatsapp, totalSpend, points, createdAt)
 *   - All transactions (including voided ones — they are financial records)
 *   - All loyalty logs (EARN / REDEEM / ADJUST history)
 *   - All AuditLog entries that reference this customer (entityId = id)
 *
 * OWNER-only — the export contains PII (whatsapp number) and full financial
 * history, so it must not be exposed to non-owner roles.
 *
 * NOTE: This is a stub — it returns the raw JSON. A production implementation
 * would also offer a downloadable format (CSV / ZIP) and would redact PII
 * from AuditLog.details JSON if the customer requested right-to-be-forgotten.
 * Those refinements are tracked as CUST-007 follow-ups.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'OWNER') {
      return safeJsonError('Only OWNER can export customer data', 403)
    }
    const outletId = user.outletId

    const { id } = await params

    // Fetch customer (include soft-deleted — export must work even after deletion
    // so the owner can fulfill a GDPR request post-deletion).
    const customer = await db.customer.findFirst({
      where: { id, outletId },
    })
    if (!customer) {
      return safeJsonError('Customer not found', 404)
    }

    const [transactions, loyaltyLogs, auditLogs] = await Promise.all([
      db.transaction.findMany({
        where: { customerId: id, outletId },
        include: {
          items: {
            select: {
              productName: true,
              variantName: true,
              qty: true,
              price: true,
              subtotal: true,
              itemDiscount: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.loyaltyLog.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
      }),
      db.auditLog.findMany({
        where: { entityType: 'CUSTOMER', entityId: id, outletId },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const exportedAt = new Date().toISOString()

    return safeJson(
      {
        export: {
          exportedAt,
          exportedBy: user.id,
          outletId,
          gdprArticle: 'Article 20 — Right to data portability',
        },
        profile: {
          id: customer.id,
          name: customer.name,
          whatsapp: customer.whatsapp,
          totalSpend: customer.totalSpend,
          points: customer.points,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
          deletedAt: customer.deletedAt,
        },
        transactions: transactions.map((tx) => ({
          id: tx.id,
          invoiceNumber: tx.invoiceNumber,
          date: tx.createdAt,
          subtotal: tx.subtotal,
          discount: tx.discount,
          pointsUsed: tx.pointsUsed,
          taxAmount: tx.taxAmount,
          total: tx.total,
          paymentMethod: tx.paymentMethod,
          paidAmount: tx.paidAmount,
          change: tx.change,
          items: tx.items,
        })),
        loyaltyHistory: loyaltyLogs,
        auditTrail: auditLogs,
        summary: {
          transactionCount: transactions.length,
          loyaltyLogCount: loyaltyLogs.length,
          auditLogCount: auditLogs.length,
        },
      },
      200,
      // Exported data changes rarely — cache for a short window to allow
      // retries / download resumption without re-querying.
      CACHE.SHORT
    )
  } catch (error) {
    console.error('Customer export GET error:', error)
    return safeJsonError('Failed to export customer data', 500)
  }
}
