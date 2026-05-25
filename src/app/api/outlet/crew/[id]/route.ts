import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * PUT /api/outlet/crew/[id] — Update crew member info
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat mengubah data crew', 403)
    }

    const { id } = await params

    // Verify crew exists and belongs to same outlet
    const crew = await db.user.findUnique({
      where: { id },
    })
    if (!crew || crew.outletId !== user.outletId || crew.role !== 'CREW') {
      return safeJsonError('Crew tidak ditemukan', 404)
    }

    const body = await request.json()
    const { name, email, password } = body

    // Build update data
    const updateData: Record<string, string> = {}
    if (name !== undefined) updateData.name = name
    if (email !== undefined) {
      // Check email uniqueness within outlet (excluding current crew)
      if (email !== crew.email) {
        const existingUser = await db.user.findFirst({
          where: { email, outletId: user.outletId, id: { not: id } },
        })
        if (existingUser) {
          return safeJsonError('Email sudah terdaftar', 409)
        }
        updateData.email = email
      }
    }

    if (password !== undefined) {
      if (password.length < 8) {
        return safeJsonError('Password minimal 8 karakter', 400)
      }
      const hashedPassword = await bcrypt.hash(password, 10)
      updateData.password = hashedPassword
    }

    if (Object.keys(updateData).length === 0) {
      return safeJsonError('Tidak ada data yang diubah', 400)
    }

    const updatedCrew = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    })

    // Audit log
    await safeAuditLog({
      action: 'UPDATE',
      entityType: 'CREW',
      entityId: id,
      details: JSON.stringify({ changes: Object.keys(updateData) }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJson({ crew: updatedCrew })
  } catch (error) {
    console.error('[/api/outlet/crew/[id]] PUT error:', error)
    return safeJsonError('Internal server error')
  }
}

/**
 * DELETE /api/outlet/crew/[id] — Delete a crew member
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menghapus crew', 403)
    }

    const { id } = await params

    // Verify crew exists and belongs to same outlet
    const crew = await db.user.findUnique({
      where: { id },
    })
    if (!crew || crew.outletId !== user.outletId || crew.role !== 'CREW') {
      return safeJsonError('Crew tidak ditemukan', 404)
    }

    // Delete crew permission and user atomically
    await db.$transaction([
      db.crewPermission.deleteMany({ where: { userId: id } }),
      db.user.delete({ where: { id } }),
    ])

    // Audit log
    await safeAuditLog({
      action: 'DELETE',
      entityType: 'CREW',
      entityId: id,
      details: JSON.stringify({ name: crew.name, email: crew.email }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJson({ success: true })
  } catch (error) {
    console.error('[/api/outlet/crew/[id]] DELETE error:', error)
    return safeJsonError('Internal server error')
  }
}
