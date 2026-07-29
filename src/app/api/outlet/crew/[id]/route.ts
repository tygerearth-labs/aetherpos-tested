import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeEmitAuditEvent, buildCrewChangeEvent } from '@/lib/audit-v2'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

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

    // Audit log (V2). Redact password value if it was changed.
    const auditAfter: Record<string, unknown> = { ...updateData }
    if (updateData.password) {
      auditAfter.password = '[REDACTED]'
    }
    await safeEmitAuditEvent(
      buildCrewChangeEvent({
        crewId: id,
        crewName: updatedCrew.name,
        email: updatedCrew.email,
        changeType: 'updated',
        before: { name: crew.name, email: crew.email },
        after: auditAfter,
        changedFields: Object.keys(updateData),
        outletId: user.outletId,
        userId: user.id,
      }),
    )

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

    // Delete crew — handle FK constraints (transactions, audit logs, purchase orders)
    await db.$transaction(async (tx) => {
      // 1. Delete crew permissions
      await tx.crewPermission.deleteMany({ where: { userId: id } })

      // 2. Delete inventory movements created by this crew
      await tx.inventoryMovement.deleteMany({ where: { userId: id } })

      // 3. Delete loyalty logs created for transactions by this crew
      // (LoyaltyLog references Transaction, not User directly — so we find via transactions)
      const crewTransactionIds = await tx.transaction.findMany({
        where: { userId: id },
        select: { id: true },
      })
      if (crewTransactionIds.length > 0) {
        await tx.loyaltyLog.deleteMany({
          where: { transactionId: { in: crewTransactionIds.map(t => t.id) } },
        })
      }

      // 4. Delete the user (transactions cascade won't work — but we keep them for history)
      //    Nullify userId on transactions, audit logs, and purchase orders before deleting user
      await tx.transaction.updateMany({
        where: { userId: id },
        data: { userId: '' },
      })
      await tx.auditLog.updateMany({
        where: { userId: id },
        data: { userId: '' },
      })
      await tx.purchaseOrder.updateMany({
        where: { userId: id },
        data: { userId: '' },
      })

      // 5. Finally delete the user
      await tx.user.delete({ where: { id } })
    }, { timeout: 30000 })

    // Audit log (V2, non-blocking — emitted AFTER tx commits).
    await safeEmitAuditEvent(
      buildCrewChangeEvent({
        crewId: id,
        crewName: crew.name,
        email: crew.email,
        changeType: 'deleted',
        before: { name: crew.name, email: crew.email },
        outletId: user.outletId,
        userId: user.id,
      }),
    )

    return safeJson({ success: true })
  } catch (error) {
    console.error('[/api/outlet/crew/[id]] DELETE error:', error)
    return safeJsonError('Internal server error')
  }
}
