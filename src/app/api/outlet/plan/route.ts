import { NextRequest } from 'next/server'
import { resolvePlanType } from '@/lib/api/api-helpers'
import { requireAuth } from '@/lib/auth/auth-utils'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'
import { db } from '@/lib/db'
import { VALID_ACCOUNT_TYPES, getPlanFeaturesFromDB, getPlanLabel } from '@/lib/config/plan-config'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { isPlanExpired, getDaysRemaining, calculateExpiryDate } from '@/lib/plan-expiry'
import { safeAuditLog } from '@/lib/safe-audit'

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
 * FIX-PLAN-001: This endpoint was previously OWNER-accessible and allowed any
 * authenticated owner to self-upgrade to any plan, any duration, without
 * payment verification. Self-service plan upgrades MUST go through the
 * external payment gateway → /api/webmaster/outlets/:id/plan flow.
 *
 * The endpoint is now WEBMASTER-ONLY (Bearer $COMMAND_SECRET). The only
 * legitimate use-case is the Command Center setting a plan after verifying
 * payment. Owner self-DOWNGRADE-to-free is allowed via this endpoint ONLY
 * when caller passes planType='free' (no expiry manipulation). For paid
 * upgrades, callers MUST go through /api/webmaster/outlets/:id/plan.
 *
 * Body:
 * - planType: 'free' | 'pro' | 'enterprise' (required)
 * - months: number (optional) — duration in months, calculates planExpiresAt
 * - planExpiresAt: string (optional) — ISO date string for explicit expiry
 * - applyToGroup: boolean (optional) — apply to all outlets in group
 * - outletId: string (required) — target outlet id (must be set by webmaster)
 */
export async function PATCH(request: NextRequest) {
  try {
    // FIX-PLAN-001: Webmaster-only auth — COMMAND_SECRET Bearer token.
    if (!requireWebmaster(request)) {
      return webmasterUnauthorized()
    }

    const body = await request.json()
    const {
      planType,
      months,
      planExpiresAt: explicitExpiry,
      applyToGroup,
      outletId: targetOutletId,
    } = body as {
      planType?: string
      months?: number
      planExpiresAt?: string
      applyToGroup?: boolean
      outletId?: string
    }

    if (!targetOutletId) {
      return safeJsonError('outletId wajib (webmaster endpoint)', 400)
    }

    if (!planType || !VALID_ACCOUNT_TYPES.includes(planType as typeof VALID_ACCOUNT_TYPES[number])) {
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

    // Get target outlet (and its owner for audit log attribution)
    const outlet = await db.outlet.findUnique({
      where: { id: targetOutletId },
      select: {
        id: true,
        name: true,
        groupId: true,
        accountType: true,
        planExpiresAt: true,
        users: { where: { role: 'OWNER' }, select: { id: true }, take: 1 },
      },
    })

    if (!outlet) {
      return safeJsonError('Outlet tidak ditemukan', 404)
    }

    const previousPlan = outlet.accountType
    const previousExpiry = outlet.planExpiresAt
    const data = {
      accountType: planType,
      planExpiresAt: expiryDate,
    }

    let updatedCount = 0
    const shouldApplyToGroup = applyToGroup && outlet.groupId

    if (shouldApplyToGroup) {
      // Update all outlets in the group
      const result = await db.outlet.updateMany({
        where: { groupId: outlet.groupId },
        data,
      })
      updatedCount = result.count
    } else {
      // Update only this outlet
      await db.outlet.update({
        where: { id: targetOutletId },
        data,
      })
      updatedCount = 1
    }

    // FIX-PLAN-005: Audit-log the plan change. Attribute to the outlet's owner
    // (webmaster has no User row in the DB). safeAuditLog swallows FK errors so
    // a missing owner does NOT break the plan change.
    const ownerId = outlet.users[0]?.id ?? 'unknown'
    await safeAuditLog({
      action: 'PLAN_CHANGE',
      entityType: 'OUTLET',
      entityId: targetOutletId,
      details: JSON.stringify({
        previousPlan,
        newPlan: planType,
        previousExpiry: previousExpiry?.toISOString() ?? null,
        newExpiry: expiryDate?.toISOString() ?? null,
        applyToGroup: !!shouldApplyToGroup,
        updatedCount,
        triggeredBy: 'webmaster',
        endpoint: 'PATCH /api/outlet/plan',
        timestamp: new Date().toISOString(),
      }),
      outletId: targetOutletId,
      userId: ownerId,
    })

    return safeJson({
      success: true,
      updatedCount,
      outletId: targetOutletId,
      previousPlan,
      newPlan: planType,
      planExpiresAt: expiryDate?.toISOString() ?? null,
    })
  } catch (error) {
    console.error('[/api/outlet/plan] PATCH error:', error)
    return safeJsonError('Internal server error')
  }
}
