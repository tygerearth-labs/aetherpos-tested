import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { parsePagination } from '@/lib/api-helpers'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { notifyNewCustomer } from '@/lib/notify'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId

    const { searchParams } = request.nextUrl
    const { skip, limit } = parsePagination(searchParams)
    const search = searchParams.get('search') || ''

    const where: Record<string, unknown> = { outletId }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { whatsapp: { contains: search } },
      ]
    }

    const [customers, total, totalPointsResult, avgSpendResult, newThisMonthCount] = await Promise.all([
      db.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.customer.count({ where }),
      db.customer.aggregate({
        where: { outletId },
        _sum: { points: true },
      }),
      db.customer.aggregate({
        where: { outletId },
        _avg: { totalSpend: true },
      }),
      db.customer.count({
        where: {
          outletId,
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
    ])

    return safeJson({
      customers,
      totalPages: Math.ceil(total / limit) || 1,
      stats: {
        total,
        totalPoints: totalPointsResult._sum.points || 0,
        avgSpend: Math.round((avgSpendResult._avg.totalSpend || 0) / 100) * 100,
        newThisMonth: newThisMonthCount,
      },
    })
  } catch (error) {
    console.error('Customers GET error:', error)
    return safeJsonError('Failed to load customers', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId

    const body = await request.json()
    const { name, whatsapp } = body

    if (!name || !whatsapp) {
      return safeJsonError('Name and WhatsApp number are required', 400)
    }

    // Check unique whatsapp per outlet
    const existing = await db.customer.findFirst({
      where: { whatsapp, outletId },
    })
    if (existing) {
      return safeJsonError('WhatsApp number already registered in this outlet', 400)
    }

    const customer = await db.$transaction(async (tx) => {
      const newCustomer = await tx.customer.create({
        data: {
          name,
          whatsapp,
          outletId,
        },
      })

      // L3: Audit log for customer creation
      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'CUSTOMER',
          entityId: newCustomer.id,
          details: JSON.stringify({
            customerName: newCustomer.name,
            whatsapp: newCustomer.whatsapp,
          }),
          outletId,
          userId: user.id,
        },
      })

      return newCustomer
    })

    // Send Telegram notification — properly awaited to ensure delivery
    // Wrapped in try/catch so notification failure doesn't fail the customer creation
    try {
      console.log(`[customers] Sending Telegram notification for new customer ${name} (outlet: ${outletId})`)
      await notifyNewCustomer(outletId, { name, whatsapp })
      console.log(`[customers] ✅ Telegram notification completed for customer ${name}`)
    } catch (notifyError) {
      console.error('[customers] Telegram notification error (non-fatal):', notifyError)
    }

    return safeJsonCreated(customer)
  } catch (error) {
    console.error('Customers POST error:', error)
    return safeJsonError('Failed to create customer', 500)
  }
}
