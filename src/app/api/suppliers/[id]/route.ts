import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLog } from '@/lib/safe-audit'

// GET /api/suppliers/[id] — get single supplier
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    const supplier = await db.supplier.findFirst({
      where: { id, outletId: user.outletId },
      include: {
        _count: { select: { purchases: true } },
      },
    })

    if (!supplier) {
      return safeJsonError('Supplier not found', 404)
    }

    return safeJson(supplier)
  } catch (error) {
    console.error('Supplier GET error:', error)
    return safeJsonError('Failed to load supplier')
  }
}

// PUT /api/suppliers/[id] — update supplier
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    const existing = await db.supplier.findFirst({
      where: { id, outletId: user.outletId },
    })
    if (!existing) {
      return safeJsonError('Supplier not found', 404)
    }

    const body = await request.json()
    const { name, phone, address, notes } = body

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (phone !== undefined) updateData.phone = phone?.trim() || null
    if (address !== undefined) updateData.address = address?.trim() || null
    if (notes !== undefined) updateData.notes = notes?.trim() || null

    const updated = await db.supplier.update({
      where: { id },
      data: updateData,
    })

    return safeJson(updated)
  } catch (error) {
    console.error('Supplier PUT error:', error)
    return safeJsonError('Failed to update supplier')
  }
}

// DELETE /api/suppliers/[id] — delete supplier
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    const existing = await db.supplier.findFirst({
      where: { id, outletId: user.outletId },
    })
    if (!existing) {
      return safeJsonError('Supplier not found', 404)
    }

    // Create audit log before deleting (non-blocking)
    await safeAuditLog({
      action: 'DELETE',
      entityType: 'SUPPLIER',
      entityId: id,
      details: JSON.stringify({
        supplierName: existing.name,
        phone: existing.phone,
        address: existing.address,
      }),
      outletId: user.outletId,
      userId: user.id,
    })

    // Supplier has purchases — set supplierId to null on those POs, then delete
    await db.$transaction([
      db.purchaseOrder.updateMany({
        where: { supplierId: id },
        data: { supplierId: null },
      }),
      db.supplier.delete({ where: { id } }),
    ])

    return safeJson({ success: true })
  } catch (error) {
    console.error('Supplier DELETE error:', error)
    return safeJsonError('Failed to delete supplier')
  }
}