import { NextRequest } from 'next/server'
import { resolvePlanType } from '@/lib/api-helpers'
import { requireAuth } from '@/lib/auth-utils'
import { db } from '@/lib/db'
import { getPlanFeatures, getPlanLabel } from '@/lib/plan-config'
import { safeJsonError } from '@/lib/safe-response'

// Force dynamic — never cache this route (plan changes from Command Center must reflect immediately)
export const dynamic = 'force-dynamic'

/**
 * GET /api/outlet/plan
 *
 * Returns the current outlet's plan info + full feature matrix.
 * Called by the client on mount and periodically to detect
 * plan changes from the Command Center.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request)

    const outlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: {
        id: true,
        name: true,
        accountType: true,
        updatedAt: true,
        setting: {
          select: {
            loyaltyEnabled: true,
            loyaltyPointsPerAmount: true,
            loyaltyPointValue: true,
          },
        },
        _count: {
          select: {
            users: true,
            products: true,
            customers: true,
            categories: true,
            promos: true,
            transactions: true,
          },
        },
      },
    })

    if (!outlet) {
      return safeJsonError('Outlet not found', 404)
    }

    // Derive plan type (handles suspended: prefix)
    const rawPlan = resolvePlanType(outlet.accountType)
    const isSuspended = outlet.accountType?.startsWith('suspended:') ?? false
    const features = getPlanFeatures(rawPlan)

    // Calculate usage vs limits
    const usage = {
      products: outlet._count.products,
      categories: outlet._count.categories,
      customers: outlet._count.customers,
      crew: outlet._count.users - 1, // exclude owner
      promos: outlet._count.promos,
      transactions: outlet._count.transactions,
    }

    const body = JSON.stringify({
      outletId: outlet.id,
      outletName: outlet.name,
      plan: {
        type: rawPlan,
        label: getPlanLabel(rawPlan),
        isSuspended,
      },
      features,
      usage,
      lastUpdated: outlet.updatedAt.toISOString(),
    })

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return safeJsonError('Unauthorized', 401)
    }
    console.error('[/api/outlet/plan] Error:', error)
    return safeJsonError('Internal server error')
  }
}
