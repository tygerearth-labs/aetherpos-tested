import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { db } from '@/lib/db'
import { validateEmail } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { safeAuditLog } from '@/lib/safe-audit'

/**
 * POST /api/auth/change-email
 *
 * Change the authenticated user's email address.
 * Requires current password verification for security.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()
    const { email, currentPassword } = body as { email?: string; currentPassword?: string }

    if (!email || !currentPassword) {
      return safeJsonError('Email dan password saat ini wajib diisi', 400)
    }

    const emailErr = validateEmail(email)
    if (emailErr) return safeJsonError(emailErr, 400)

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

    // Check if email is same as current
    if (dbUser.email === email) {
      return safeJsonError('Email baru harus berbeda dari email saat ini', 400)
    }

    // Check email uniqueness within outlet
    const existingEmail = await db.user.findFirst({
      where: {
        email,
        outletId: user.outletId,
        id: { not: user.id },
      },
    })

    if (existingEmail) {
      return safeJsonError('Email sudah digunakan oleh user lain di outlet ini', 409)
    }

    // Update email
    const oldEmail = dbUser.email
    await db.user.update({
      where: { id: user.id },
      data: { email },
    })

    // CREW-013 FIX: Audit log the email change (sensitive account-takeover vector).
    // Logs both oldEmail and newEmail so investigators can trace the change.
    // NEVER logs the password — only that it was verified.
    await safeAuditLog({
      action: 'EMAIL_CHANGE',
      entityType: 'USER',
      entityId: user.id,
      details: JSON.stringify({
        oldEmail,
        newEmail: email,
        message: 'User changed their email address (password verified)',
      }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJson({
      success: true,
      message: 'Email berhasil diperbarui',
      newEmail: email,
    })
  } catch (error) {
    console.error('[/api/auth/change-email] Error:', error)
    return safeJsonError('Internal server error')
  }
}
