import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { db } from '@/lib/db'
import { safeJson, safeJsonError } from '@/lib/safe-response'

// PUT /api/settings/permissions/[userId] — update crew permissions
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  // Only OWNER can manage permissions
  if (user.role !== 'OWNER') {
    return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
  }

  try {
    const { userId } = await params

    // Verify crew belongs to same outlet
    const crew = await db.user.findUnique({
      where: { id: userId },
    })
    if (!crew || crew.outletId !== user.outletId || crew.role !== 'CREW') {
      return safeJsonError('Crew tidak ditemukan', 404)
    }

    const body = await request.json()
    const { pages } = body

    if (!pages || typeof pages !== 'string') {
      return safeJsonError('Pages wajib diisi', 400)
    }

    // Upsert crew permission
    const permission = await db.crewPermission.upsert({
      where: { userId },
      create: {
        userId,
        pages,
        outletId: user.outletId,
      },
      update: {
        pages,
      },
    })

    return safeJson({
      userId: permission.userId,
      pages: permission.pages,
    })
  } catch (error) {
    console.error('PUT /api/settings/permissions/[userId] error:', error)
    return safeJsonError('Internal server error', 500)
  }
}
