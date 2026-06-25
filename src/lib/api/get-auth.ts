import { NextRequest, NextResponse } from 'next/server'
import { jwtDecrypt } from 'jose'
import hkdf from '@panva/hkdf'

/**
 * Derive a 32-byte encryption key from NEXTAUTH_SECRET using HKDF,
 * exactly as NextAuth v4 does internally in next-auth/jwt.
 *
 * This is required because NextAuth v4 encrypts JWTs as JWE using
 * a derived key (not the raw secret), so we must replicate the same
 * derivation to decrypt them in our API routes.
 */

// ── Cached encryption key (derived once, reused across requests) ──
let cachedEncryptionKey: Uint8Array | null = null
let cachedSecret: string | null = null

async function getDerivedEncryptionKey(secret: string, salt: string = '') {
  // Return cached key if the secret hasn't changed
  if (cachedEncryptionKey && cachedSecret === secret && salt === '') {
    return cachedEncryptionKey
  }
  const key = await hkdf(
    'sha256',
    new TextEncoder().encode(secret),
    salt,
    `NextAuth.js Generated Encryption Key${salt ? ` (${salt})` : ''}`,
    32
  )
  // Only cache for the default salt
  if (salt === '') {
    cachedEncryptionKey = key
    cachedSecret = secret
  }
  return key
}

interface AuthUser {
  id: string
  name: string | null
  email: string | null
  role: string
  outletId: string
}

export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  try {
    const tokenCookie =
      request.cookies.get('next-auth.session-token') ||
      request.cookies.get('__Secure-next-auth.session-token')

    if (!tokenCookie?.value) {
      return null
    }

    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      console.error('NEXTAUTH_SECRET is not set')
      return null
    }

    // Derive the encryption key (cached after first call)
    const encryptionKey = await getDerivedEncryptionKey(secret)

    // Decrypt the JWE token
    const { payload } = await jwtDecrypt(tokenCookie.value, encryptionKey, {
      clockTolerance: 900, // 15 minutes — important for offline→online time drift
    })

    if (!payload?.email || !payload?.role) {
      return null
    }

    return {
      id: (payload.id as string) || (payload.sub as string) || '',
      name: (payload.name as string) || null,
      email: (payload.email as string) || null,
      role: (payload.role as string) || null,
      outletId: (payload.outletId as string) || '',
    }
  } catch (error) {
    // Log only in development to avoid noise in production
    if (process.env.NODE_ENV === 'development') {
      console.error('getAuthUser error:', error)
    }
    return null
  }
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}