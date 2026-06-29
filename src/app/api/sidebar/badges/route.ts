import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth/auth-utils'
import { db } from '@/lib/db'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request)

    const pendingInbound = await db.outletTransfer.count({
      where: {
        toOutletId: user.outletId,
        status: 'IN_TRANSIT',
      },
    })

    return safeJson({ pendingInbound })
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return safeJsonError(error.message, 401)
    }
    return safeJsonError('Failed to fetch sidebar badges')
  }
}