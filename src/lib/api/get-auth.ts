import { NextRequest, NextResponse } from 'next/server'
import { jwtDecrypt } from 'jose'
import hkdf from '@panva/hkdf'
import { db } from '@/lib/db'
import { resolvePlanType } from '@/lib/api/api-helpers'
import { isPlanExpired, downgradeExpiredPlan } from '@/lib/plan-expiry'

/**
 * ═══════════════════════════════════════════════════════════════════
 * CSRF MITIGATION — ACCEPTED RISK (CREW-011 / AUDIT-PLATFORM-2)
 * ═══════════════════════════════════════════════════════════════════
 *
 * NextAuth's built-in CSRF protection applies ONLY to /api/auth/* routes
 * (sign-in, sign-out, callbacks). Application API routes under /api/*
 * (purchases, transactions, settings, outlet/crew, etc.) do NOT validate
 * any CSRF token.
 *
 * Current mitigations (defense in depth):
 *   1. Session cookie is set with `SameSite=Lax` (configured in auth.ts)
 *      → blocks the most common CSRF vector (cross-site form POSTs).
 *   2. All mutating endpoints require a valid NextAuth session JWT — an
 *      attacker cannot forge requests without first compromising the
 *      session cookie.
 *   3. Cross-outlet IDOR is prevented by JWT-scoped outletId (every
 *      mutation uses `where: { ..., outletId: user.outletId }`).
 *
 * ACCEPTED RESIDUAL RISK: SameSite=Lax does NOT protect against
 * same-site subdomain attacks, XSS-driven same-origin requests, or
 * any same-origin script injection. A custom double-submit-cookie CSRF
 * token OR Origin/Referer header check on state-changing endpoints
 * would close this gap. This is documented as a known limitation and
 * tracked as future work — out of scope for the current freeze.
 *
 * No code change is required here; this comment documents the decision.
 * ═══════════════════════════════════════════════════════════════════
 */

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

// ── FIX-PLAN-006: Plan-expiry re-check cache ──
//
// `getAuthUser` is called on EVERY authenticated API request. We must not
// run a DB query on every call. This cache holds the timestamp of the last
// expiry check per outlet — if checked within TTL, we skip the DB lookup.
// The cache is process-local (per serverless instance) which is sufficient
// because expiry is best-effort: a few minutes of stale access is acceptable
// and the login-time check in auth.ts remains the authoritative guard.
const PLAN_EXPIRY_CHECK_TTL_MS = 5 * 60 * 1000 // 5 minutes
const planExpiryLastChecked = new Map<string, number>()

/**
 * Best-effort mid-session plan expiry re-check. Runs at most once per
 * outlet per TTL window. If the outlet's plan has expired, triggers the
 * auto-downgrade (which itself writes an audit log via PLAN-005 fix).
 * Never throws — failures are silently logged so they don't break the
 * API request.
 */
async function maybeRefreshExpiredPlan(outletId: string): Promise<void> {
  if (!outletId) return
  const now = Date.now()
  const lastChecked = planExpiryLastChecked.get(outletId) ?? 0
  if (now - lastChecked < PLAN_EXPIRY_CHECK_TTL_MS) return
  planExpiryLastChecked.set(outletId, now)
  try {
    const outlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { accountType: true, planExpiresAt: true },
    })
    if (!outlet) return
    const planType = resolvePlanType(outlet.accountType)
    if (planType === 'free') return // free plans never expire
    if (isPlanExpired(outlet.planExpiresAt)) {
      await downgradeExpiredPlan(outletId)
    }
  } catch (error) {
    // Best-effort — don't break the API request.
    if (process.env.NODE_ENV === 'development') {
      console.error('[get-auth] maybeRefreshExpiredPlan error:', error)
    }
  }
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

    const outletId = (payload.outletId as string) || ''

    // FIX-PLAN-006: Re-check plan expiry mid-session. The login-time check
    // in auth.ts only runs at session creation (JWT maxAge=30 days). Without
    // this, a user whose Pro plan expires today retains full access for up
    // to 30 days. This best-effort, cached call auto-downgrades expired
    // plans so subsequent plan-gated endpoints see the downgraded state.
    if (outletId) {
      await maybeRefreshExpiredPlan(outletId)
    }

    return {
      id: (payload.id as string) || (payload.sub as string) || '',
      name: (payload.name as string) || null,
      email: (payload.email as string) || null,
      role: (payload.role as string) || null,
      outletId,
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