/**
 * plan-expiry.ts — Plan Expiry Helper Functions
 *
 * Handles checking, calculating, and processing plan expiry for outlets.
 * Main outlet is the source of truth: when it expires, all branches in the
 * same group also expire.
 *
 * Behaviour:
 * - Main outlet expired → auto-downgrade to free (can still login)
 * - Branch outlet expired → block login entirely (PLAN_EXPIRED_BRANCH)
 */

import { db } from '@/lib/db'
import { resolvePlanType } from '@/lib/api/api-helpers'
import { safeAuditLog } from '@/lib/safe-audit'

/**
 * Check if a plan is expired.
 * Returns true if planExpiresAt is set and is in the past.
 * Free plans (no planExpiresAt) never expire.
 */
export function isPlanExpired(planExpiresAt: Date | string | null): boolean {
  if (!planExpiresAt) return false
  const expiry = new Date(planExpiresAt)
  return expiry.getTime() < Date.now()
}

/**
 * Calculate days remaining until plan expiry.
 * Returns -1 if no expiry set (free plan), negative if already expired.
 */
export function getDaysRemaining(planExpiresAt: Date | string | null): number {
  if (!planExpiresAt) return -1
  const expiry = new Date(planExpiresAt)
  const diffMs = expiry.getTime() - Date.now()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Calculate an expiry date based on plan duration in months.
 * Adds the specified number of months to the current date.
 */
export function calculateExpiryDate(months: number): Date {
  const now = new Date()
  now.setMonth(now.getMonth() + months)
  // Set to end of day (23:59:59) in local time
  now.setHours(23, 59, 59, 999)
  return now
}

/**
 * Downgrade an expired main outlet and all its branches to free plan.
 * Clears planExpiresAt on all affected outlets.
 *
 * Returns the number of outlets downgraded.
 */
export async function downgradeExpiredPlan(outletId: string): Promise<number> {
  const outlet = await db.outlet.findUnique({
    where: { id: outletId },
    select: {
      id: true,
      name: true,
      groupId: true,
      isMain: true,
      accountType: true,
      planExpiresAt: true,
      // FIX-PLAN-005: Fetch owner for audit-log attribution.
      users: { where: { role: 'OWNER' }, select: { id: true }, take: 1 },
    },
  })

  if (!outlet) return 0

  // Only downgrade paid plans that have expired
  const planType = resolvePlanType(outlet.accountType)
  if (planType === 'free') return 0
  if (!isPlanExpired(outlet.planExpiresAt)) return 0

  const previousPlan = outlet.accountType
  const previousExpiry = outlet.planExpiresAt

  if (outlet.groupId) {
    // Downgrade all outlets in the group
    const result = await db.outlet.updateMany({
      where: { groupId: outlet.groupId },
      data: { accountType: 'free', planExpiresAt: null },
    })

    // FIX-PLAN-005: Audit-log the system-triggered auto-downgrade.
    await safeAuditLog({
      action: 'PLAN_CHANGE',
      entityType: 'OUTLET',
      entityId: outletId,
      details: JSON.stringify({
        previousPlan,
        newPlan: 'free',
        previousExpiry: previousExpiry?.toISOString() ?? null,
        newExpiry: null,
        applyToGroup: true,
        updatedCount: result.count,
        triggeredBy: 'system',
        reason: 'plan_expired',
        endpoint: 'downgradeExpiredPlan',
        outletName: outlet.name,
        timestamp: new Date().toISOString(),
      }),
      outletId,
      userId: outlet.users[0]?.id ?? 'unknown',
    })

    return result.count
  }

  // Standalone outlet
  await db.outlet.update({
    where: { id: outletId },
    data: { accountType: 'free', planExpiresAt: null },
  })

  // FIX-PLAN-005: Audit-log the system-triggered auto-downgrade (standalone).
  await safeAuditLog({
    action: 'PLAN_CHANGE',
    entityType: 'OUTLET',
    entityId: outletId,
    details: JSON.stringify({
      previousPlan,
      newPlan: 'free',
      previousExpiry: previousExpiry?.toISOString() ?? null,
      newExpiry: null,
      applyToGroup: false,
      updatedCount: 1,
      triggeredBy: 'system',
      reason: 'plan_expired',
      endpoint: 'downgradeExpiredPlan',
      outletName: outlet.name,
      timestamp: new Date().toISOString(),
    }),
    outletId,
    userId: outlet.users[0]?.id ?? 'unknown',
  })

  return 1
}

/**
 * Check plan expiry status for a user's outlet.
 * Used in auth flow to decide whether to allow login.
 *
 * Returns:
 * - 'ok' — no expiry issue
 * - 'expired_main' — main outlet expired (will be auto-downgraded)
 * - 'expired_branch' — branch outlet expired (login blocked)
 */
export async function checkPlanExpiry(outletId: string): Promise<{
  status: 'ok' | 'expired_main' | 'expired_branch'
  outletName: string
  daysRemaining: number
}> {
  const outlet = await db.outlet.findUnique({
    where: { id: outletId },
    select: {
      id: true,
      name: true,
      accountType: true,
      planExpiresAt: true,
      isMain: true,
      groupId: true,
    },
  })

  if (!outlet) return { status: 'ok', outletName: '', daysRemaining: -1 }

  const planType = resolvePlanType(outlet.accountType)

  // Free plans don't expire
  if (planType === 'free') return { status: 'ok', outletName: outlet.name, daysRemaining: -1 }

  // No expiry date set — treat as no expiry
  if (!outlet.planExpiresAt) return { status: 'ok', outletName: outlet.name, daysRemaining: -1 }

  const days = getDaysRemaining(outlet.planExpiresAt)

  // Not expired yet
  if (days > 0) return { status: 'ok', outletName: outlet.name, daysRemaining: days }

  // Expired — check if main or branch
  if (outlet.isMain || !outlet.groupId) {
    return { status: 'expired_main', outletName: outlet.name, daysRemaining: days }
  }

  // For branches, check the main outlet's expiry
  const mainOutlet = await db.outlet.findFirst({
    where: { groupId: outlet.groupId, isMain: true },
    select: { id: true, name: true, planExpiresAt: true, accountType: true },
  })

  if (mainOutlet && isPlanExpired(mainOutlet.planExpiresAt)) {
    // Main outlet expired — branch follows
    return { status: 'expired_branch', outletName: outlet.name, daysRemaining: days }
  }

  // Branch has its own expiry (shouldn't normally happen, but handle it)
  return { status: 'expired_branch', outletName: outlet.name, daysRemaining: days }
}
