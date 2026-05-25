import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'
import { db } from '@/lib/db'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'

// POST: Reset owner password for an outlet
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser(request)
  if (!auth || auth.role !== 'WEBMASTER') {
    return unauthorized()
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { newPassword } = body

    if (!newPassword || newPassword.length < 8) {
      return safeJsonError('Password minimal 8 karakter', 400)
    }

    // Find the owner of this outlet
    const owner = await db.user.findFirst({
      where: { outletId: id, role: 'OWNER' },
    })

    if (!owner) {
      return safeJsonError('Owner outlet tidak ditemukan', 404)
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)

    await db.user.update({
      where: { id: owner.id },
      data: { password: hashedPassword },
    })

    return safeJson({ message: 'Password owner berhasil direset' })
  } catch (error) {
    console.error('Webmaster reset password error:', error)
    return safeJsonError('Terjadi kesalahan internal')
  }
}
