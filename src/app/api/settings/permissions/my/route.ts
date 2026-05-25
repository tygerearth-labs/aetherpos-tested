import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { db } from '@/lib/db'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * GET /api/settings/permissions/my
 *
 * Returns the current user's own crew permissions.
 * OWNER always gets all pages. CREW gets their specific permission record.
 * This endpoint is accessible to all authenticated users (not just OWNER).
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  try {
    // OWNER always has access to everything
    if (user.role === 'OWNER') {
      return safeJson({
        role: 'OWNER',
        pages: 'dashboard,products,customers,pos,transactions,audit-log,crew,settings',
      })
    }

    // CREW: fetch their permission record
    const crewPerm = await db.crewPermission.findUnique({
      where: { userId: user.id },
    })

    return safeJson({
      role: 'CREW',
      pages: crewPerm?.pages || 'pos',
    })
  } catch (error) {
    console.error('GET /api/settings/permissions/my error:', error)
    return safeJsonError('Internal server error')
  }
}
