import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { db } from '@/lib/db'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * POST /api/auth/change-password
 *
 * Change the authenticated user's password.
 * Requires current password verification.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()
    const { currentPassword, newPassword } = body as { currentPassword?: string; newPassword?: string }

    if (!currentPassword || !newPassword) {
      return safeJsonError('Password saat ini dan password baru wajib diisi', 400)
    }

    // Validate new password length
    if (newPassword.length < 6) {
      return safeJsonError('Password baru minimal 6 karakter', 400)
    }

    // Fetch user with password
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
    })

    if (!dbUser) {
      return safeJsonError('User tidak ditemukan', 404)
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, dbUser.password)
    if (!isPasswordValid) {
      return safeJsonError('Password saat ini salah', 401)
    }

    // Check new password is not same as current
    const isSamePassword = await bcrypt.compare(newPassword, dbUser.password)
    if (isSamePassword) {
      return safeJsonError('Password baru harus berbeda dari password saat ini', 400)
    }

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 10)
    await db.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    })

    return safeJson({
      success: true,
      message: 'Password berhasil diperbarui',
    })
  } catch (error) {
    console.error('[/api/auth/change-password] Error:', error)
    return safeJsonError('Internal server error')
  }
}
