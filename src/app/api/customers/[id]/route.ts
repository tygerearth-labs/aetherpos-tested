import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/safe-response'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const userId = user.id

    const { id } = await params

    const existing = await db.customer.findFirst({
      where: { id, outletId },
    })
    if (!existing) {
      return safeJsonError('Customer not found', 404)
    }

    const body = await request.json()
    const { name, whatsapp } = body

    // If whatsapp is being changed, check uniqueness within outlet
    if (whatsapp && whatsapp !== existing.whatsapp) {
      const whatsappExists = await db.customer.findFirst({
        where: { whatsapp, outletId, id: { not: id } },
      })
      if (whatsappExists) {
        return safeJsonError('WhatsApp number already registered', 400)
      }
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (whatsapp !== undefined) updateData.whatsapp = whatsapp

    // L3: Track changes for audit log
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    if (name !== undefined && name !== existing.name) changes.name = { from: existing.name, to: name }
    if (whatsapp !== undefined && whatsapp !== existing.whatsapp) changes.whatsapp = { from: existing.whatsapp, to: whatsapp }

    const customer = await db.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: updateData,
      })

      if (Object.keys(changes).length > 0) {
        await tx.auditLog.create({
          data: {
            action: 'UPDATE',
            entityType: 'CUSTOMER',
            entityId: id,
            details: JSON.stringify({ customerName: updated.name, changes }),
            outletId,
            userId,
          },
        })
      }

      return updated
    })

    return safeJson(customer)
  } catch (error) {
    console.error('Customer PUT error:', error)
    return safeJsonError('Failed to update customer', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menghapus customer', 403)
    }
    const outletId = user.outletId
    const userId = user.id

    const { id } = await params

    const existing = await db.customer.findFirst({
      where: { id, outletId },
    })
    if (!existing) {
      return safeJsonError('Customer not found', 404)
    }

    // L3: Audit log before delete
    await safeAuditLog({
      action: 'DELETE',
      entityType: 'CUSTOMER',
      entityId: id,
      details: JSON.stringify({
        customerName: existing.name,
        whatsapp: existing.whatsapp,
      }),
      outletId,
      userId,
    })

    await db.customer.delete({
      where: { id },
    })

    return safeJson({ success: true })
  } catch (error) {
    console.error('Customer DELETE error:', error)
    return safeJsonError('Failed to delete customer', 500)
  }
}
