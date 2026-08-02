import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { emitAuditEvent, buildInventoryCategoryChangeEvent } from '@/lib/audit-v2'

// PUT /api/inventory/categories/[id] — update inventory category
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    const body = await request.json()
    const { name, color } = body

    // Verify ownership
    const existing = await db.inventoryCategory.findFirst({
      where: { id, outletId: user.outletId },
    })
    if (!existing) {
      return safeJsonError('Category not found', 404)
    }

    // Check unique name if changing
    if (name && name.trim() !== existing.name) {
      const duplicate = await db.inventoryCategory.findFirst({
        where: { name: name.trim(), outletId: user.outletId },
      })
      if (duplicate) {
        return safeJsonError('Category name already exists in this outlet', 400)
      }
    }

    const updated = await db.inventoryCategory.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(color && { color }),
      },
    })

    await emitAuditEvent(
      db,
      buildInventoryCategoryChangeEvent({
        categoryId: id,
        categoryName: updated.name,
        color: updated.color,
        changeType: 'updated',
        before: { name: existing.name, color: existing.color },
        after: { name: updated.name, color: updated.color },
        outletId: user.outletId,
        userId: user.id,
      }),
    )

    return safeJson(updated)
  } catch (error) {
    console.error('Inventory category PUT error:', error)
    return safeJsonError('Failed to update inventory category')
  }
}

// DELETE /api/inventory/categories/[id] — delete inventory category
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    // Verify ownership
    const existing = await db.inventoryCategory.findFirst({
      where: { id, outletId: user.outletId },
    })
    if (!existing) {
      return safeJsonError('Category not found', 404)
    }

    // Count items that will be detached, then emit V2 audit before the tx.
    const itemsAffected = await db.inventoryItem.count({ where: { categoryId: id } })
    await emitAuditEvent(
      db,
      buildInventoryCategoryChangeEvent({
        categoryId: id,
        categoryName: existing.name,
        color: existing.color,
        changeType: 'deleted',
        before: { name: existing.name, color: existing.color },
        itemsAffected,
        deleteType: 'HARD_DELETE',
        outletId: user.outletId,
        userId: user.id,
      }),
    )

    // Set items' categoryId to null, then delete category — atomic transaction
    await db.$transaction([
      db.inventoryItem.updateMany({
        where: { categoryId: id },
        data: { categoryId: null, lastBusinessChangeAt: new Date() },
      }),
      db.inventoryCategory.delete({ where: { id } }),
    ])

    return safeJson({ success: true })
  } catch (error) {
    console.error('Inventory category DELETE error:', error)
    return safeJsonError('Failed to delete inventory category')
  }
}