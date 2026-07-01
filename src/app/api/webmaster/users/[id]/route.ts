import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'
import { validateEmail } from '@/lib/api/api-helpers'

/**
 * GET /api/webmaster/users/:id — Get single user profile
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { id } = await params
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true, outletId: true,
        createdAt: true, updatedAt: true,
        outlet: {
          select: {
            id: true, name: true, address: true, phone: true,
            accountType: true, planExpiresAt: true, isMain: true, groupId: true,
          },
        },
        crewPermission: { select: { pages: true } },
        _count: { select: { transactions: true } },
      },
    })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    return NextResponse.json(user)
  } catch (error) {
    console.error('[GET /api/webmaster/users/:id]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/webmaster/users/:id — Edit user (name, email, role, outletId)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { id } = await params
    const body = await request.json()
    const { name, email, role, outletId } = body as {
      name?: string; email?: string; role?: string; outletId?: string
    }

    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const updateData: Record<string, unknown> = {}

    if (name !== undefined) {
      if (!name || typeof name !== 'string' || name.trim().length === 0)
        return NextResponse.json({ error: 'Name tidak boleh kosong' }, { status: 400 })
      updateData.name = name.trim()
    }

    if (email !== undefined) {
      const emailErr = validateEmail(email)
      if (emailErr) return NextResponse.json({ error: emailErr }, { status: 400 })
      const targetOutlet = outletId || existing.outletId
      const dup = await db.user.findFirst({ where: { email: email.trim(), outletId: targetOutlet, NOT: { id } } })
      if (dup) return NextResponse.json({ error: 'Email sudah digunakan di outlet ini' }, { status: 409 })
      updateData.email = email.trim()
    }

    if (role !== undefined) {
      if (!['OWNER', 'CREW'].includes(role))
        return NextResponse.json({ error: 'Role harus OWNER atau CREW' }, { status: 400 })
      updateData.role = role
    }

    if (outletId !== undefined) {
      if (!outletId || typeof outletId !== 'string')
        return NextResponse.json({ error: 'outletId tidak valid' }, { status: 400 })
      const target = await db.outlet.findUnique({ where: { id: outletId } })
      if (!target) return NextResponse.json({ error: 'Outlet tujuan tidak ditemukan' }, { status: 404 })
      if (email !== undefined) {
        const dup2 = await db.user.findFirst({ where: { email: email.trim(), outletId, NOT: { id } } })
        if (dup2) return NextResponse.json({ error: 'Email sudah digunakan di outlet tujuan' }, { status: 409 })
      }
      updateData.outletId = outletId
    }

    if (Object.keys(updateData).length === 0)
      return NextResponse.json({ error: 'Tidak ada field yang diubah' }, { status: 400 })

    const updated = await db.user.update({
      where: { id }, data: updateData,
      select: { id: true, name: true, email: true, role: true, outletId: true, updatedAt: true },
    })

    await db.auditLog.create({
      data: {
        action: 'UPDATE', entityType: 'USER', entityId: id,
        details: JSON.stringify({ changedBy: 'webmaster', changes: Object.keys(updateData) }),
        outletId: (outletId || existing.outletId) as string, userId: id,
      },
    })

    console.log(`[WEBMASTER] EDIT_USER: "${id}" updated: ${Object.keys(updateData).join(', ')}`)
    return NextResponse.json(updated)
  } catch (error) {
    console.error('[PUT /api/webmaster/users/:id]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/webmaster/users/:id — Delete user (cannot delete last owner)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { id } = await params
    const user = await db.user.findUnique({ where: { id } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    if (user.role === 'OWNER') {
      const otherOwners = await db.user.count({ where: { outletId: user.outletId, role: 'OWNER', NOT: { id } } })
      if (otherOwners === 0)
        return NextResponse.json({ error: 'Tidak bisa menghapus owner terakhir di outlet' }, { status: 400 })
    }

    await db.crewPermission.deleteMany({ where: { userId: id } })
    await db.user.delete({ where: { id } })

    console.log(`[WEBMASTER] DELETE_USER: "${id}" (${user.email}) deleted`)
    return NextResponse.json({ success: true, deletedUserId: id })
  } catch (error) {
    console.error('[DELETE /api/webmaster/users/:id]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}