import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { parseVoidDetails } from '@/lib/api-helpers'
import { safeJson, safeJsonError } from '@/lib/safe-response'

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

    const transaction = await db.transaction.findFirst({
      where: { id, outletId },
      include: {
        items: true,
        customer: {
          select: { id: true, name: true, whatsapp: true },
        },
        user: {
          select: { id: true, name: true },
        },
      },
    })

    if (!transaction) {
      return safeJsonError('Transaction not found', 404)
    }

    // Check void status
    const voidLog = await db.auditLog.findFirst({
      where: {
        entityType: 'TRANSACTION',
        entityId: id,
        action: 'VOID',
        outletId,
      },
    })
    const voidInfo = parseVoidDetails(voidLog?.details ?? null)

    // Get outlet info for receipt
    const outlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { name: true, address: true, phone: true },
    })

    // Get receipt settings (logo, business name)
    const outletSettings = await db.outletSetting.findUnique({
      where: { outletId },
      select: { receiptLogo: true, receiptBusinessName: true },
    })

    return safeJson({
      id: transaction.id,
      invoiceNumber: transaction.invoiceNumber,
      subtotal: transaction.subtotal,
      discount: transaction.discount,
      pointsUsed: transaction.pointsUsed,
      taxAmount: transaction.taxAmount,
      total: transaction.total,
      paymentMethod: transaction.paymentMethod,
      paidAmount: transaction.paidAmount,
      change: transaction.change,
      note: transaction.note,
      customerId: transaction.customerId,
      createdAt: transaction.createdAt,
      items: transaction.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        variantName: item.variantName,
        price: item.price,
        qty: item.qty,
        subtotal: item.subtotal,
        hpp: item.hpp,
      })),
      customer: transaction.customer,
      user: transaction.user,
      voidStatus: voidInfo ? 'void' : 'active',
      voidInfo,
      syncStatus: 'synced' as const,
      outlet: outlet || { name: 'Aether POS', address: '', phone: '' },
      receiptLogo: outletSettings?.receiptLogo || '',
      receiptBusinessName: outletSettings?.receiptBusinessName || outlet?.name || 'Aether POS',
    })
  } catch (error) {
    console.error('Transaction detail GET error:', error)
    return safeJsonError('Failed to load transaction detail', 500)
  }
}
