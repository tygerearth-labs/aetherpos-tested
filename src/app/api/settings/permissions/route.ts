import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { db } from '@/lib/db'
import { safeJson, safeJsonError } from '@/lib/safe-response'

// GET /api/settings/permissions — list crew permissions
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  // Only OWNER can manage permissions
  if (user.role !== 'OWNER') {
    return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
  }

  try {
    const crewWithPermissions = await db.user.findMany({
      where: {
        outletId: user.outletId,
        role: 'CREW',
      },
      include: {
        crewPermission: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    const permissions = crewWithPermissions.map((crew) => ({
      userId: crew.id,
      userName: crew.name,
      userEmail: crew.email,
      role: crew.role,
      pages: crew.crewPermission?.pages || 'pos',
    }))

    return safeJson({ permissions })
  } catch (error) {
    console.error('GET /api/settings/permissions error:', error)
    return safeJsonError('Internal server error', 500)
  }
}
