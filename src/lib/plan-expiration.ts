/**
 * plan-expiration.ts — Plan Expiration & Inheritance Service
 *
 * Handles plan logic for outlets:
 * - Free plans never expire (planExpiresAt is null or accountType is "free")
 * - Owner (main outlet): When plan expires, can still login but plan drops to "free"
 * - Branch outlet: ALWAYS inherits the main outlet's plan (accountType + planExpiresAt)
 *   - When main outlet's plan expires, branch users cannot login
 */

import { db } from '@/lib/db'

export interface PlanExpirationResult {
  /** The plan that should be active after checking expiration */
  effectivePlan: string
  /** Whether the plan has expired */
  isExpired: boolean
  /** Whether this is a branch outlet that should be blocked */
  isBranchBlocked: boolean
  /** Name of the main outlet (for notification) */
  mainOutletName?: string
  /** When the plan expires */
  expiresAt?: Date | null
  /** Whether this is a branch outlet inheriting from a main outlet */
  isInherited?: boolean
}

/**
 * Check plan expiration for an outlet.
 *
 * Logic:
 * - Free plans never expire (planExpiresAt is null or accountType is "free")
 * - Owner (main outlet): When plan expires, can still login but plan drops to "free"
 * - Branch outlet: ALWAYS inherits the main outlet's plan — branch's own
 *   accountType is ignored in favor of the main outlet's.
 *   When main outlet's plan expires, branch users cannot login.
 */
export async function checkPlanExpiration(outletId: string): Promise<PlanExpirationResult> {
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

  if (!outlet) {
    return { effectivePlan: 'free', isExpired: false, isBranchBlocked: false }
  }

  const now = new Date()

  // ── Branch outlet: always inherit main outlet's plan ──
  if (!outlet.isMain && outlet.groupId) {
    const mainOutlet = await db.outlet.findFirst({
      where: { groupId: outlet.groupId, isMain: true },
      select: { id: true, name: true, accountType: true, planExpiresAt: true },
    })

    if (mainOutlet) {
      // Main outlet is free or has no expiration — inherited plan is always active
      if (mainOutlet.accountType === 'free' || !mainOutlet.planExpiresAt) {
        return {
          effectivePlan: mainOutlet.accountType || 'free',
          isExpired: false,
          isBranchBlocked: false,
          mainOutletName: mainOutlet.name,
          expiresAt: mainOutlet.planExpiresAt,
          isInherited: true,
        }
      }

      const mainExpired = mainOutlet.planExpiresAt < now

      if (mainExpired) {
        // Downgrade the main outlet's plan first
        await db.outlet.update({
          where: { id: mainOutlet.id },
          data: { accountType: 'free', planExpiresAt: null },
        })

        // Main outlet's plan is expired — block branch
        return {
          effectivePlan: 'free',
          isExpired: true,
          isBranchBlocked: true,
          mainOutletName: mainOutlet.name,
          expiresAt: mainOutlet.planExpiresAt,
          isInherited: true,
        }
      }

      // Main outlet plan is active — branch inherits it
      return {
        effectivePlan: mainOutlet.accountType,
        isExpired: false,
        isBranchBlocked: false,
        mainOutletName: mainOutlet.name,
        expiresAt: mainOutlet.planExpiresAt,
        isInherited: true,
      }
    }

    // No main outlet found in group — fall through to standalone logic
  }

  // ── Main outlet or standalone outlet ──

  // Free plan never expires
  if (outlet.accountType === 'free' || !outlet.planExpiresAt) {
    return {
      effectivePlan: outlet.accountType || 'free',
      isExpired: false,
      isBranchBlocked: false,
      expiresAt: outlet.planExpiresAt,
    }
  }

  const isExpired = outlet.planExpiresAt < now

  // Main outlet (owner) - can still login, plan drops to free
  if (isExpired) {
    // Downgrade plan to free
    await db.outlet.update({
      where: { id: outletId },
      data: { accountType: 'free', planExpiresAt: null },
    })
    return {
      effectivePlan: 'free',
      isExpired: true,
      isBranchBlocked: false,
      expiresAt: outlet.planExpiresAt,
    }
  }

  return {
    effectivePlan: outlet.accountType,
    isExpired: false,
    isBranchBlocked: false,
    expiresAt: outlet.planExpiresAt,
  }
}
