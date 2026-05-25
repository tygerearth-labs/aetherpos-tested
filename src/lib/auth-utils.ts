import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getAuthUser } from '@/lib/get-auth'
import type { UserRole } from './types'

interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  outletId: string
}

/**
 * Get the current authenticated user.
 *
 * Two overloads:
 * 1. API routes: pass a NextRequest to read cookies from it
 * 2. Server actions: call without args — reads cookies via next/headers
 */
export async function getCurrentUser(request?: NextRequest): Promise<AuthUser> {
  let user: Awaited<ReturnType<typeof getAuthUser>> | null = null

  if (request) {
    // API route — read cookies from the request
    user = await getAuthUser(request)
  } else {
    // Server action — read cookies via next/headers
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get('next-auth.session-token')?.value
      || cookieStore.get('__Secure-next-auth.session-token')?.value

    if (sessionToken) {
      // Build a minimal request-like object with the cookie
      const headers = new Headers()
      headers.set('cookie', `${sessionToken ? 'next-auth.session-token=' + sessionToken : ''}`)
      const minimalReq = { cookies: { get: (name: string) => cookieStore.get(name) } } as NextRequest
      user = await getAuthUser(minimalReq)
    }
  }

  if (!user) {
    throw new Error('Unauthorized — please log in')
  }

  return {
    id: user.id,
    name: user.name ?? '',
    email: user.email ?? '',
    role: user.role as UserRole,
    outletId: user.outletId,
  }
}

export async function requireAuth(request?: NextRequest): Promise<AuthUser> {
  return getCurrentUser(request)
}

export async function requireOwner(request?: NextRequest): Promise<AuthUser> {
  const user = await getCurrentUser(request)
  if (user.role !== 'OWNER') {
    throw new Error('Forbidden — owner access required')
  }
  return user
}
