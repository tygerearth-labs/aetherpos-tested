import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

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
      where: { id, outletId, deletedAt: null },
    })
    if (!existing) {
      return safeJsonError('Customer not found', 404)
    }

    const body = await request.json()
    const { name, whatsapp } = body

    // If whatsapp is being changed, check uniqueness within outlet
    // (only among non-deleted customers — soft-deleted records don't block reuse)
    if (whatsapp && whatsapp !== existing.whatsapp) {
      const whatsappExists = await db.customer.findFirst({
        where: { whatsapp, outletId, id: { not: id }, deletedAt: null },
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
      where: { id, outletId, deletedAt: null },
    })
    if (!existing) {
      return safeJsonError('Customer not found', 404)
    }

    // CUST-002 FIX: Soft-delete instead of hard-delete.
    // Previously this endpoint nullified Transaction.customerId, deleted all
    // LoyaltyLog records, then hard-deleted the Customer row — destroying the
    // entire loyalty audit trail. Soft-delete preserves:
    //   - Customer record (with deletedAt set)
    //   - All LoyaltyLog records (EARN/REDEEM/ADJUST history)
    //   - Transaction.customerId FK (transactions still reference the customer)
    // All customer list/detail queries filter `deletedAt IS NULL`, so the
    // soft-deleted customer is hidden from active UI but remains queryable
    // for audit / investigation purposes. Mirrors the offline Dexie schema.
    const deletedAt = new Date()
    await db.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: { deletedAt },
      })

      // CUST-008 FIX: Create the DELETE audit log INSIDE the same transaction
      // (previously it was created OUTSIDE the tx via safeAuditLog, which is
      // non-atomic — if the delete failed, the audit log would falsely claim
      // success). Using tx.auditLog.create keeps it atomic with the soft-delete.
      await tx.auditLog.create({
        data: {
          action: 'DELETE',
          entityType: 'CUSTOMER',
          entityId: id,
          details: JSON.stringify({
            customerName: existing.name,
            whatsapp: existing.whatsapp,
            softDelete: true,
            deletedAt: deletedAt.toISOString(),
          }),
          outletId,
          userId,
        },
      })
    }, { timeout: 30000 })

    return safeJson({ success: true })
  } catch (error) {
    console.error('Customer DELETE error:', error)
    return safeJsonError('Failed to delete customer', 500)
  }
}
