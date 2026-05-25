import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'

// PUT /api/categories/[id] — update a category
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
    const existing = await db.category.findFirst({
      where: { id, outletId: user.outletId },
    })
    if (!existing) {
      return safeJsonError('Category not found', 404)
    }

    // Check unique name if changing
    if (name && name.trim() !== existing.name) {
      const duplicate = await db.category.findFirst({
        where: { name: name.trim(), outletId: user.outletId },
      })
      if (duplicate) {
        return safeJsonError('Category name already exists', 400)
      }
    }

    const updated = await db.category.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(color && { color }),
      },
    })

    return safeJson(updated)
  } catch (error) {
    console.error('Categories PUT error:', error)
    return safeJsonError('Failed to update category', 500)
  }
}

// DELETE /api/categories/[id] — delete a category
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menghapus kategori', 403)
    }
    const { id } = await params

    // Verify ownership
    const existing = await db.category.findFirst({
      where: { id, outletId: user.outletId },
    })
    if (!existing) {
      return safeJsonError('Category not found', 404)
    }

    // Set products in this category to uncategorized (null categoryId) — atomic with delete
    await db.$transaction([
      db.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      }),
      db.category.delete({ where: { id } }),
    ])

    return safeJson({ success: true })
  } catch (error) {
    console.error('Categories DELETE error:', error)
    return safeJsonError('Failed to delete category', 500)
  }
}
