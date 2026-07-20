/**
 * plan-enforcement.ts — Plan-limit enforcement helpers
 *
 * FIX-PLAN-007: After a downgrade (e.g. Pro→Free via expiry or webmaster
 * action), existing data may exceed the new plan's limits. The platform
 * policy is:
 *   - Do NOT delete over-limit data (business data is sacred).
 *   - Do NOT auto-disable individual records (would require schema change).
 *   - DO block ALL mutation endpoints on the outlet with a 403, prompting
 *     the owner to either upgrade or reduce their data footprint. Read-only
 *     access (GET endpoints) remains allowed so the owner can still see
 *     their data, run reports, and decide what to delete.
 *
 * Usage in mutation endpoints:
 *
 *   import { assertOutletWithinLimits } from '@/lib/api/plan-enforcement'
 *   const blocked = await assertOutletWithinLimits(user.outletId, db)
 *   if (blocked) return blocked   // 403 response
 *
 * The check is intentionally cheap: a single batched Prisma query for
 * counts (outlets-in-group, crew, products). Caching is delegated to the
 * caller — most mutation endpoints already do a `db.outlet.findUnique`
 * before this check, so the overhead is one extra round-trip.
 */

import { db } from '@/lib/db'
import { getOutletPlan, isUnlimited } from '@/lib/config/plan-config'
import { safeJsonError } from '@/lib/api/safe-response'

export const OUTLET_OVER_LIMIT_MESSAGE =
  'Outlet ini melebihi batas paket Anda. Silakan upgrade atau nonaktifkan outlet lain.'

/**
 * Returns true if the outlet's current data exceeds the plan limits
 * for outlets-in-group, crew, or products.
 *
 * Note: maxOutlets is checked against the number of outlets in the outlet's
 * group (or 1 for standalone). maxCrew counts CREW users (excluding OWNER).
 * maxProducts counts all products in the outlet.
 */
export async function isOutletOverLimit(
  outletId: string,
  prismaDb: typeof db = db,
): Promise<{ overLimit: boolean; reason?: string }> {
  const outletPlan = await getOutletPlan(outletId, prismaDb)
  if (!outletPlan) return { overLimit: false }
  const { features } = outletPlan

  // Fetch outlet + counts in one round-trip.
  const outlet = await prismaDb.outlet.findUnique({
    where: { id: outletId },
    select: {
      groupId: true,
      _count: {
        select: {
          // Crew = users minus owner. We can't filter role in _count, so we
          // approximate by counting all users and subtracting 1 (the owner).
          // For groups with multiple owners this under-counts, but is
          // intentionally permissive (only blocks when clearly over).
          users: true,
          products: true,
        },
      },
    },
  })
  if (!outlet) return { overLimit: false }

  // 1. maxOutlets — count outlets in group (or 1 for standalone)
  if (!isUnlimited(features.maxOutlets)) {
    let outletsInGroup = 1
    if (outlet.groupId) {
      outletsInGroup = await prismaDb.outlet.count({
        where: { groupId: outlet.groupId },
      })
    }
    if (outletsInGroup > features.maxOutlets) {
      return {
        overLimit: true,
        reason: `outlets: ${outletsInGroup} > ${features.maxOutlets}`,
      }
    }
  }

  // 2. maxCrew — count users minus owner (1). See note above.
  if (!isUnlimited(features.maxCrew)) {
    const totalUsers = outlet._count.users
    const crewCount = Math.max(0, totalUsers - 1)
    if (crewCount > features.maxCrew) {
      return {
        overLimit: true,
        reason: `crew: ${crewCount} > ${features.maxCrew}`,
      }
    }
  }

  // 3. maxProducts
  if (!isUnlimited(features.maxProducts)) {
    if (outlet._count.products > features.maxProducts) {
      return {
        overLimit: true,
        reason: `products: ${outlet._count.products} > ${features.maxProducts}`,
      }
    }
  }

  return { overLimit: false }
}

/**
 * Convenience helper for mutation endpoints. Returns a 403 Response if the
 * outlet is over-limit, or null if the request may proceed.
 *
 * Usage:
 *   const blocked = await assertOutletWithinLimits(user.outletId)
 *   if (blocked) return blocked
 */
export async function assertOutletWithinLimits(
  outletId: string,
  prismaDb: typeof db = db,
): Promise<Response | null> {
  const { overLimit } = await isOutletOverLimit(outletId, prismaDb)
  if (!overLimit) return null
  return safeJsonError(OUTLET_OVER_LIMIT_MESSAGE, 403)
}
