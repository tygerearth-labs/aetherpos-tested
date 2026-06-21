import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * GET /api/outlet/crew/[id]/outlets — Get all outlet assignments for a crew member (OWNER only)
 *
 * Returns all UserOutlet records for a specific crew member with outlet details.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat melihat assign outlet crew', 403)
    }

    const { id: crewId } = await params

    // Verify crew exists and belongs to one of the owner's outlets
    const crew = await db.user.findUnique({
      where: { id: crewId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        outletId: true,
      },
    })

    if (!crew || crew.role !== 'CREW') {
      return safeJsonError('Crew tidak ditemukan', 404)
    }

    // Verify the crew belongs to one of the owner's outlets
    const ownerOutlets = await db.user.findMany({
      where: { email: user.email ?? '', role: 'OWNER' },
      select: { outletId: true },
    })
    const ownerOutletIds = ownerOutlets.map((o) => o.outletId)

    if (!ownerOutletIds.includes(crew.outletId)) {
      return safeJsonError('Crew bukan milik outlet Anda', 403)
    }

    // Get all UserOutlet records for this crew member
    const assignments = await db.userOutlet.findMany({
      where: { userId: crewId },
      include: {
        outlet: {
          select: { id: true, name: true, address: true, phone: true },
        },
      },
      orderBy: { id: 'asc' },
    })

    const outletList = assignments.map((a) => ({
      id: a.outlet.id,
      name: a.outlet.name,
      address: a.outlet.address,
      phone: a.outlet.phone,
      role: a.role,
      isPrimary: a.outletId === crew.outletId,
    }))

    // Always include the primary outlet in the list if not already present
    const primaryOutlet = await db.outlet.findUnique({
      where: { id: crew.outletId },
      select: { id: true, name: true, address: true, phone: true },
    })

    const result: typeof outletList = []

    if (primaryOutlet) {
      const alreadyIncluded = outletList.some((o) => o.id === primaryOutlet.id)
      if (!alreadyIncluded) {
        result.push({
          id: primaryOutlet.id,
          name: primaryOutlet.name,
          address: primaryOutlet.address,
          phone: primaryOutlet.phone,
          role: 'CREW',
          isPrimary: true,
        })
      }
    }

    // Add non-primary outlets
    for (const o of outletList) {
      if (!o.isPrimary) {
        result.push(o)
      } else {
        // If the primary is in the list from assignments, ensure it's at the top
        const existingIdx = result.findIndex((r) => r.id === o.id)
        if (existingIdx === -1) {
          result.unshift(o)
        }
      }
    }

    // Sort: primary first, then alphabetical
    result.sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1
      if (!a.isPrimary && b.isPrimary) return 1
      return a.name.localeCompare(b.name)
    })

    return safeJson({
      crew: {
        id: crew.id,
        name: crew.name,
        email: crew.email,
      },
      outlets: result,
    })
  } catch (error) {
    console.error('[/api/outlet/crew/[id]/outlets] GET error:', error)
    return safeJsonError('Gagal memuat assign outlet crew')
  }
}
