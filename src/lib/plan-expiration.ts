/**
 * plan-expiration.ts — Plan Expiration Service
 *
 * Handles plan expiration logic for outlets:
 * - Free plans never expire (planExpiresAt is null or accountType is "free")
 * - Owner (main outlet): When plan expires, can still login but plan drops to "free"
 * - Branch outlet (enterprise): When main outlet's plan expires, cannot login
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
}

/**
 * Check plan expiration for an outlet.
 *
 * Logic:
 * - Free plans never expire (planExpiresAt is null or accountType is "free")
 * - Owner (main outlet): When plan expires, can still login but plan drops to "free"
 * - Branch outlet (enterprise): When main outlet's plan expires, cannot login
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
  if (outlet.isMain) {
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

  // Branch outlet - check main outlet's plan
  if (outlet.groupId) {
    const mainOutlet = await db.outlet.findFirst({
      where: { groupId: outlet.groupId, isMain: true },
      select: { id: true, name: true, accountType: true, planExpiresAt: true },
    })

    if (mainOutlet) {
      const mainExpired =
        mainOutlet.planExpiresAt &&
        mainOutlet.planExpiresAt < now &&
        mainOutlet.accountType !== 'free'

      if (mainExpired) {
        // Downgrade the main outlet's plan first
        await db.outlet.update({
          where: { id: mainOutlet.id },
          data: { accountType: 'free', planExpiresAt: null },
        })

        // Main outlet's plan is expired - block branch login
        return {
          effectivePlan: 'free',
          isExpired: true,
          isBranchBlocked: true,
          mainOutletName: mainOutlet.name,
          expiresAt: mainOutlet.planExpiresAt,
        }
      }
    }
  }

  // Branch with active main outlet or standalone non-main outlet
  return {
    effectivePlan: outlet.accountType,
    isExpired: false,
    isBranchBlocked: false,
    expiresAt: outlet.planExpiresAt,
  }
}
