import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * DELETE /api/outlet/crew/[id]/unassign-outlet — Remove a crew member from an outlet (OWNER only)
 *
 * Deletes the UserOutlet record. Cannot unassign from the crew's primary outlet.
 * Accepts `{ outletId }` in the request body.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menghapus assign outlet crew', 403)
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

    // Read outletId from body or query param
    let targetOutletId: string | undefined

    try {
      const body = await request.json()
      targetOutletId = body.outletId
    } catch {
      // If body parsing fails, try query param
      targetOutletId = request.nextUrl.searchParams.get('outletId') || undefined
    }

    if (!targetOutletId) {
      return safeJsonError('outletId wajib diisi', 400)
    }

    // Cannot unassign from primary outlet
    if (crew.outletId === targetOutletId) {
      return safeJsonError('Tidak dapat menghapus assign dari outlet utama crew. Ubah outlet utama crew terlebih dahulu.', 400)
    }

    // Check if the assignment exists
    const existingAssignment = await db.userOutlet.findUnique({
      where: {
        userId_outletId: {
          userId: crewId,
          outletId: targetOutletId,
        },
      },
      include: {
        outlet: {
          select: { name: true },
        },
      },
    })

    if (!existingAssignment) {
      return safeJsonError('Assign outlet tidak ditemukan', 404)
    }

    // Delete the UserOutlet record
    await db.userOutlet.delete({
      where: {
        userId_outletId: {
          userId: crewId,
          outletId: targetOutletId,
        },
      },
    })

    // Audit log
    await safeAuditLog({
      action: 'DELETE',
      entityType: 'CREW_OUTLET',
      entityId: crewId,
      details: JSON.stringify({
        crewName: crew.name,
        crewEmail: crew.email,
        removedOutletId: targetOutletId,
        removedOutletName: existingAssignment.outlet.name,
      }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJson({
      success: true,
      message: `Crew "${crew.name}" berhasil dihapus dari outlet "${existingAssignment.outlet.name}"`,
    })
  } catch (error) {
    console.error('[/api/outlet/crew/[id]/unassign-outlet] DELETE error:', error)
    return safeJsonError('Gagal menghapus assign outlet crew')
  }
}
