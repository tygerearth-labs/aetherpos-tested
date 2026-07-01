import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'
import bcrypt from 'bcryptjs'

/**
 * POST /api/webmaster/users/:id/reset-password
 *
 * Reset any user's password directly (no current password required).
 * Webmaster-only (COMMAND_SECRET).
 *
 * Body: { newPassword: string (min 8 chars) }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { id } = await params
    const body = await request.json()
    const { newPassword } = body as { newPassword?: string }

    if (!newPassword || typeof newPassword !== 'string')
      return NextResponse.json({ error: 'newPassword wajib diisi' }, { status: 400 })
    if (newPassword.length < 8)
      return NextResponse.json({ error: 'Password minimal 8 karakter' }, { status: 400 })

    const user = await db.user.findUnique({
      where: { id }, select: { id: true, name: true, email: true, outletId: true },
    })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    await db.user.update({ where: { id }, data: { password: hashedPassword } })

    await db.auditLog.create({
      data: {
        action: 'UPDATE', entityType: 'USER', entityId: id,
        details: JSON.stringify({ changedBy: 'webmaster', action: 'PASSWORD_RESET' }),
        outletId: user.outletId, userId: id,
      },
    })

    console.log(`[WEBMASTER] RESET_PASSWORD: "${id}" (${user.email})`)
    return NextResponse.json({ success: true, message: 'Password berhasil direset', userId: id })
  } catch (error) {
    console.error('[POST /api/webmaster/users/:id/reset-password]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}