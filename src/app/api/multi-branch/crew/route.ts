import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getOutletPlan } from '@/lib/plan-config'
import { safeJson, safeJsonError } from '@/lib/safe-response'

// Helper to get all outlet IDs for the current owner
async function getOwnerOutletIds(email: string): Promise<string[]> {
  const owners = await db.user.findMany({
    where: { email, role: 'OWNER' },
    select: { outletId: true },
  })
  return owners.map(o => o.outletId)
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Only owners can access multi-branch crew data', 403)
    }

    // Enterprise plan check
    const planData = await getOutletPlan(user.outletId, db)
    if (!planData || planData.plan !== 'enterprise') {
      return safeJsonError('Multi-branch management requires an enterprise plan', 403)
    }

    const outletIds = await getOwnerOutletIds(user.email!)
    if (outletIds.length === 0) {
      return safeJsonError('No outlets found', 404)
    }

    // Fetch all crew (non-owner users) across all owner outlets
    const crew = await db.user.findMany({
      where: {
        outletId: { in: outletIds },
        role: 'CREW',
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        outletId: true,
        createdAt: true,
        crewPermission: {
          select: { pages: true },
        },
        outlet: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    const mappedCrew = crew.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      role: c.role,
      outletId: c.outletId,
      outletName: c.outlet.name,
      createdAt: c.createdAt,
      permissions: c.crewPermission?.pages ?? 'pos',
    }))

    // Outlets list for reference
    const outletList = await db.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    return safeJson({
      crew: mappedCrew,
      outlets: outletList,
    })
  } catch (error) {
    console.error('[/api/multi-branch/crew] GET error:', error)
    return safeJsonError('Failed to load crew')
  }
}