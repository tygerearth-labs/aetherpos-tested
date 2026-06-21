import { NextRequest } from 'next/server'
import { jwtEncrypt } from 'jose'
import hkdf from '@panva/hkdf'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * Derive a 32-byte encryption key from NEXTAUTH_SECRET using HKDF,
 * exactly as NextAuth v4 does internally.
 */
async function getDerivedEncryptionKey(secret: string, salt: string = '') {
  return hkdf(
    'sha256',
    new TextEncoder().encode(secret),
    salt,
    `NextAuth.js Generated Encryption Key${salt ? ` (${salt})` : ''}`,
    32
  )
}

/**
 * POST /api/auth/switch-outlet — Switch the authenticated user's active outlet
 *
 * Validates the user has access to the target outlet, updates the DB record,
 * and issues a new JWT session token with the updated outletId.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()
    const { outletId: targetOutletId } = body

    if (!targetOutletId) {
      return safeJsonError('outletId wajib diisi', 400)
    }

    // Validate user has access to this outlet
    const outletIds = user.outletIds.length > 0 ? user.outletIds : [user.outletId]
    if (!outletIds.includes(targetOutletId)) {
      return safeJsonError('Anda tidak memiliki akses ke outlet ini', 403)
    }

    // Verify the target outlet exists
    const targetOutlet = await db.outlet.findUnique({
      where: { id: targetOutletId },
      select: { id: true, name: true },
    })

    if (!targetOutlet) {
      return safeJsonError('Outlet tidak ditemukan', 404)
    }

    // Update the user's active outletId in the database
    if (user.role === 'OWNER') {
      // For OWNER: find the owner record for this outlet and update it
      const ownerRecord = await db.user.findFirst({
        where: {
          email: user.email ?? '',
          role: 'OWNER',
          outletId: targetOutletId,
        },
      })

      if (ownerRecord) {
        // The owner has a record for this outlet — update our current session reference
        // We store the active outlet on the current user record
        await db.user.update({
          where: { id: user.id },
          data: { outletId: targetOutletId },
        })
      } else {
        return safeJsonError('Outlet tidak valid', 403)
      }
    } else {
      // For CREW: update their primary outlet
      await db.user.update({
        where: { id: user.id },
        data: { outletId: targetOutletId },
      })
    }

    // Build the complete outletIds list for the new token
    let allOutletIds: string[] = [targetOutletId]

    if (user.role === 'OWNER') {
      const ownerRecords = await db.user.findMany({
        where: { email: user.email ?? '', role: 'OWNER' },
        select: { outletId: true },
      })
      for (const rec of ownerRecords) {
        if (!allOutletIds.includes(rec.outletId)) {
          allOutletIds.push(rec.outletId)
        }
      }
    } else {
      const crewOutlets = await db.userOutlet.findMany({
        where: { userId: user.id },
        select: { outletId: true },
      })
      for (const rec of crewOutlets) {
        if (!allOutletIds.includes(rec.outletId)) {
          allOutletIds.push(rec.outletId)
        }
      }
    }

    // Derive encryption key (same as NextAuth v4)
    const secret = process.env.NEXTAUTH_SECRET!
    const encryptionKey = await getDerivedEncryptionKey(secret)

    // Encode a new JWT session token
    const newToken = await jwtEncrypt(
      {
        sub: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        outletId: targetOutletId,
        outletIds: allOutletIds,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      },
      encryptionKey,
      { alg: 'dir', enc: 'A256GCM' }
    )

    // Determine cookie name based on NEXTAUTH_URL
    const isSecure = !!process.env.NEXTAUTH_URL?.startsWith('https')
    const cookieName = isSecure
      ? '__Secure-next-auth.session-token'
      : 'next-auth.session-token'

    // Build Set-Cookie header
    const cookieValue = newToken
    const maxAge = 30 * 24 * 60 * 60
    const cookieParts = [
      `${cookieName}=${cookieValue}`,
      `Path=/`,
      `Max-Age=${maxAge}`,
      `SameSite=Lax`,
    ]
    if (isSecure) {
      cookieParts.push('Secure')
    }
    cookieParts.push('HttpOnly')

    const setCookieHeader = cookieParts.join('; ')

    return new Response(
      JSON.stringify({
        success: true,
        outletId: targetOutletId,
        outletName: targetOutlet.name,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': setCookieHeader,
        },
      }
    )
  } catch (error) {
    console.error('[/api/auth/switch-outlet] POST error:', error)
    return safeJsonError('Gagal mengganti outlet')
  }
}
