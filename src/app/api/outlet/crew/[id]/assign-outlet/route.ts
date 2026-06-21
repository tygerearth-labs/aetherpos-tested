import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * POST /api/outlet/crew/[id]/assign-outlet — Assign a crew member to an additional outlet (OWNER only)
 *
 * Creates a UserOutlet record linking the crew member to a target outlet.
 * The target outlet must belong to the same owner (enterprise).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat mengassign crew ke outlet lain', 403)
    }

    const { id: crewId } = await params

    // Verify crew exists and belongs to the current outlet
    const crew = await db.user.findUnique({
      where: { id: crewId },
      select: { id: true, name: true, email: true, role: true, outletId: true },
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

    const body = await request.json()
    const { outletId: targetOutletId } = body

    if (!targetOutletId) {
      return safeJsonError('outletId wajib diisi', 400)
    }

    // Target outlet must belong to the same owner
    if (!ownerOutletIds.includes(targetOutletId)) {
      return safeJsonError('Outlet tujuan bukan milik Anda', 403)
    }

    // Cannot assign to the same outlet they're already on
    if (crew.outletId === targetOutletId) {
      return safeJsonError('Crew sudah berada di outlet ini sebagai outlet utama', 400)
    }

    // Check if already assigned
    const existingAssignment = await db.userOutlet.findUnique({
      where: {
        userId_outletId: {
          userId: crewId,
          outletId: targetOutletId,
        },
      },
    })

    if (existingAssignment) {
      return safeJsonError('Crew sudah diassign ke outlet ini', 409)
    }

    // Verify target outlet exists
    const targetOutlet = await db.outlet.findUnique({
      where: { id: targetOutletId },
      select: { id: true, name: true },
    })

    if (!targetOutlet) {
      return safeJsonError('Outlet tujuan tidak ditemukan', 404)
    }

    // Create the UserOutlet assignment
    await db.userOutlet.create({
      data: {
        userId: crewId,
        outletId: targetOutletId,
        role: 'CREW',
      },
    })

    // Audit log
    await safeAuditLog({
      action: 'CREATE',
      entityType: 'CREW_OUTLET',
      entityId: crewId,
      details: JSON.stringify({
        crewName: crew.name,
        crewEmail: crew.email,
        targetOutletId,
        targetOutletName: targetOutlet.name,
      }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJson({
      success: true,
      message: `Crew "${crew.name}" berhasil diassign ke outlet "${targetOutlet.name}"`,
    })
  } catch (error) {
    console.error('[/api/outlet/crew/[id]/assign-outlet] POST error:', error)
    return safeJsonError('Gagal mengassign crew ke outlet')
  }
}
