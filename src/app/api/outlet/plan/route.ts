import { NextRequest } from 'next/server'
import { resolvePlanType } from '@/lib/api/api-helpers'
import { requireAuth } from '@/lib/auth/auth-utils'
import { db } from '@/lib/db'
import { getPlanFeaturesFromDB, getPlanLabel } from '@/lib/config/plan-config'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { isPlanExpired, getDaysRemaining, calculateExpiryDate } from '@/lib/plan-expiry'

/**
 * GET /api/outlet/plan
 *
 * Returns the current outlet's plan info + expiry + full feature matrix.
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
        planExpiresAt: true,
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
    const features = await getPlanFeaturesFromDB(db, rawPlan)

    // Plan expiry info
    const daysRemaining = getDaysRemaining(outlet.planExpiresAt)
    const isExpired = isPlanExpired(outlet.planExpiresAt)
    const isExpiringSoon = daysRemaining >= 0 && daysRemaining <= 7

    // Calculate usage vs limits
    const usage = {
      products: outlet._count.products,
      categories: outlet._count.categories,
      customers: outlet._count.customers,
      crew: outlet._count.users - 1, // exclude owner
      promos: outlet._count.promos,
      transactions: outlet._count.transactions,
    }

    return safeJson({
      outletId: outlet.id,
      outletName: outlet.name,
      plan: {
        type: rawPlan,
        label: getPlanLabel(rawPlan),
        isSuspended,
        isExpired,
        isExpiringSoon,
        planExpiresAt: outlet.planExpiresAt?.toISOString() ?? null,
        daysRemaining,
      },
      features,
      usage,
      lastUpdated: outlet.updatedAt.toISOString(),
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return safeJsonError('Unauthorized', 401)
    }
    console.error('[/api/outlet/plan] Error:', error)
    return safeJsonError('Internal server error')
  }
}

/**
 * PATCH /api/outlet/plan
 *
 * Owner-only: set or extend plan expiry.
 * Supports `applyToGroup` to update all outlets in the same group.
 *
 * Body:
 * - planType: string (required) — the plan to set (free, pro, enterprise)
 * - months: number (optional) — duration in months, calculates planExpiresAt
 * - planExpiresAt: string (optional) — ISO date string for explicit expiry
 * - applyToGroup: boolean (optional) — apply to all outlets in group
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request)

    // Only OWNER can manage plan
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya owner yang dapat mengubah plan', 403)
    }

    const body = await request.json()
    const { planType, months, planExpiresAt: explicitExpiry, applyToGroup } = body as {
      planType?: string
      months?: number
      planExpiresAt?: string
      applyToGroup?: boolean
    }

    if (!planType || !['free', 'pro', 'enterprise'].includes(planType)) {
      return safeJsonError('Plan type tidak valid (free, pro, enterprise)', 400)
    }

    // Calculate expiry date
    let expiryDate: Date | null = null
    if (planType !== 'free') {
      if (explicitExpiry) {
        const d = new Date(explicitExpiry)
        if (isNaN(d.getTime())) {
          return safeJsonError('Format planExpiresAt tidak valid', 400)
        }
        expiryDate = d
      } else if (months && months > 0) {
        expiryDate = calculateExpiryDate(months)
      } else {
        return safeJsonError('months atau planExpiresAt wajib diisi untuk plan berbayar', 400)
      }
    }

    // Get current outlet
    const outlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { id: true, groupId: true },
    })

    if (!outlet) {
      return safeJsonError('Outlet tidak ditemukan', 404)
    }

    const data = {
      accountType: planType,
      planExpiresAt: expiryDate,
    }

    let updatedCount = 0

    if (applyToGroup && outlet.groupId) {
      // Update all outlets in the group
      const result = await db.outlet.updateMany({
        where: { groupId: outlet.groupId },
        data,
      })
      updatedCount = result.count
    } else {
      // Update only this outlet
      await db.outlet.update({
        where: { id: user.outletId },
        data,
      })
      updatedCount = 1
    }

    return safeJson({
      success: true,
      updatedCount,
      planType,
      planExpiresAt: expiryDate?.toISOString() ?? null,
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return safeJsonError('Unauthorized', 401)
    }
    console.error('[/api/outlet/plan] PATCH error:', error)
    return safeJsonError('Internal server error')
  }
}
