import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { evaluatePurchaseMutationSafety } from '@/lib/purchase-mutation-safety'

/**
 * GET /api/purchases/[id]/safety
 *
 * Returns the canonical mutation-safety evaluation for a PurchaseOrder.
 * This is the single source of truth the frontend should consult before
 * showing/enabling Edit or Delete actions on a purchase.
 *
 * The result includes:
 *   - canEdit / canDelete / canReverse booleans
 *   - reasons[] : human-readable Indonesian blockers
 *   - blockers  : structured per-category counts for UI grouping
 *
 * Outlet-scoped: returns 404 if the PO doesn't belong to the caller's
 * outlet (prevents cross-outlet data leakage).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    // Outlet scoping: confirm the PO belongs to the caller's outlet before
    // running the (heavier) safety evaluator. This prevents a user from
    // probing another outlet's PO safety state.
    const owned = await db.purchaseOrder.findFirst({
      where: { id, outletId: user.outletId },
      select: { id: true },
    })
    if (!owned) {
      return safeJsonError('Purchase order not found', 404)
    }

    const result = await evaluatePurchaseMutationSafety(id)
    if (!result) {
      // Belt-and-suspenders: the owned-check above already guarantees the
      // PO exists, but if it was deleted between the two reads we still
      // return a clean 404.
      return safeJsonError('Purchase order not found', 404)
    }

    return safeJson(result)
  } catch (error) {
    console.error('Purchase safety GET error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Failed to evaluate purchase safety: ${msg}`)
  }
}
