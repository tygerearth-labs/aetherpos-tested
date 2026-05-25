import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
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

    // Verify customer belongs to this outlet
    const customer = await db.customer.findFirst({
      where: { id, outletId },
    })
    if (!customer) {
      return safeJsonError('Customer not found', 404)
    }

    const transactions = await db.transaction.findMany({
      where: { customerId: id, outletId },
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
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    const mapped = transactions.map((tx) => ({
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
    }))

    return safeJson({ purchases: mapped })
  } catch (error) {
    console.error('Customer purchases GET error:', error)
    return safeJsonError('Failed to load purchase history', 500)
  }
}
