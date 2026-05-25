import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'
import { db } from '@/lib/db'
import { NextRequest } from 'next/server'

// GET: Get global stats
export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (!auth || auth.role !== 'WEBMASTER') {
    return unauthorized()
  }

  try {
    const [
      totalOutlets,
      totalOwners,
      totalTransactions,
      revenueResult,
      totalProducts,
      totalCustomers,
      totalCrew,
    ] = await Promise.all([
      db.outlet.count(),
      db.user.count({ where: { role: 'OWNER' } }),
      db.transaction.count(),
      db.transaction.aggregate({ _sum: { total: true } }),
      db.product.count(),
      db.customer.count(),
      db.user.count({ where: { role: 'CREW' } }),
    ])

    // Outlet breakdown by plan type
    const planBreakdown = await db.outlet.groupBy({
      by: ['accountType'],
      _count: true,
    })

    const planCounts: Record<string, number> = {}
    for (const item of planBreakdown) {
      const planType = item.accountType.startsWith('suspended:')
        ? item.accountType.replace('suspended:', '')
        : item.accountType
      planCounts[planType] = (planCounts[planType] || 0) + item._count
    }

    // Recent outlets
    const recentOutlets = await db.outlet.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          where: { role: 'OWNER' },
          select: { name: true, email: true },
          take: 1,
        },
        _count: {
          select: { transactions: true, users: true },
        },
      },
    })

    return safeJson({
      totalOutlets,
      totalOwners,
      totalCrew,
      totalTransactions,
      totalProducts,
      totalCustomers,
      totalRevenue: revenueResult._sum.total || 0,
      planBreakdown: planCounts,
      recentOutlets: recentOutlets.map((o) => ({
        id: o.id,
        name: o.name,
        accountType: o.accountType,
        createdAt: o.createdAt,
        owner: o.users[0] || null,
        transactionCount: o._count.transactions,
        userCount: o._count.users,
      })),
    })
  } catch (error) {
    console.error('Webmaster stats error:', error)
    return safeJsonError('Terjadi kesalahan internal')
  }
}
