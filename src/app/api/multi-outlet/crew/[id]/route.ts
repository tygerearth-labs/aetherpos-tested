import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

/**
 * PUT /api/multi-outlet/crew/[id] — Update crew at any outlet in the group.
 *
 * Body: { name?, email?, password? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Hanya owner yang dapat mengubah data crew', 403)

    const { id: crewId } = await params

    // Find crew and verify they belong to an outlet in the same group
    const crew = await db.user.findUnique({
      where: { id: crewId },
      include: { outlet: { select: { id: true, groupId: true, name: true } } },
    })
    if (!crew || crew.role !== 'CREW') {
      return safeJsonError('Crew tidak ditemukan', 404)
    }

    // Verify same group
    const currentUserOutlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { id: true, groupId: true },
    })
    if (!currentUserOutlet?.groupId) return safeJsonError('Outlet Anda belum tergabung dalam grup', 400)
    if (currentUserOutlet.groupId !== crew.outlet.groupId) return safeJsonError('Tidak dalam grup yang sama', 403)

    const body = await request.json()
    const { name, email, password } = body

    const updateData: Record<string, string> = {}
    if (name !== undefined) updateData.name = name
    if (email !== undefined) {
      if (email !== crew.email) {
        const existingUser = await db.user.findFirst({
          where: { email, outletId: crew.outletId, id: { not: crewId } },
        })
        if (existingUser) {
          return safeJsonError('Email sudah terdaftar di outlet ini', 409)
        }
        updateData.email = email
      }
    }
    if (password !== undefined) {
      if (password.length < 8) {
        return safeJsonError('Password minimal 8 karakter', 400)
      }
      updateData.password = await bcrypt.hash(password, 10)
    }

    if (Object.keys(updateData).length === 0) {
      return safeJsonError('Tidak ada data yang diubah', 400)
    }

    const updatedCrew = await db.user.update({
      where: { id: crewId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    })

    await safeAuditLog({
      action: 'UPDATE',
      entityType: 'CREW',
      entityId: crewId,
      details: JSON.stringify({
        changes: Object.keys(updateData),
        outletName: crew.outlet.name,
        updatedBy: user.name,
      }),
      outletId: crew.outletId,
      userId: user.id,
    })

    return safeJson({ crew: updatedCrew })
  } catch (error) {
    console.error('[/api/multi-outlet/crew/[id]] PUT error:', error)
    return safeJsonError('Internal server error')
  }
}

/**
 * DELETE /api/multi-outlet/crew/[id] — Remove crew from any outlet in the group.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Hanya owner yang dapat menghapus crew', 403)

    const { id: crewId } = await params

    const crew = await db.user.findUnique({
      where: { id: crewId },
      include: { outlet: { select: { id: true, groupId: true, name: true } } },
    })
    if (!crew || crew.role !== 'CREW') {
      return safeJsonError('Crew tidak ditemukan', 404)
    }

    const currentUserOutlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { id: true, groupId: true },
    })
    if (!currentUserOutlet?.groupId) return safeJsonError('Outlet Anda belum tergabung dalam grup', 400)
    if (currentUserOutlet.groupId !== crew.outlet.groupId) return safeJsonError('Tidak dalam grup yang sama', 403)

    await db.$transaction([
      db.crewPermission.deleteMany({ where: { userId: crewId } }),
      db.user.delete({ where: { id: crewId } }),
    ])

    await safeAuditLog({
      action: 'DELETE',
      entityType: 'CREW',
      entityId: crewId,
      details: JSON.stringify({
        name: crew.name,
        email: crew.email,
        outletName: crew.outlet.name,
        deletedBy: user.name,
      }),
      outletId: crew.outletId,
      userId: user.id,
    })

    return safeJson({ success: true })
  } catch (error) {
    console.error('[/api/multi-outlet/crew/[id]] DELETE error:', error)
    return safeJsonError('Internal server error')
  }
}