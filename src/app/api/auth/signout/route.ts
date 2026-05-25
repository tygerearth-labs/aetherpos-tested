import { NextResponse } from 'next/server'

/**
 * POST /api/auth/signout — Sign out the current user
 *
 * Instead of relying on NextAuth's internal signout handler (which can fail
 * with our custom route setup), we directly clear all next-auth cookies
 * and return a JSON response telling the client to redirect.
 */
export async function POST(request: Request) {
  const response = NextResponse.json({ url: '/' }, { status: 200 })

  // Clear all next-auth related cookies
  const cookiesToClear = [
    'next-auth.session-token',
    'next-auth.csrf-token',
    'next-auth.callback-url',
    'next-auth.pkce.code_verifier',
    '__Secure-next-auth.session-token',
    '__Secure-next-auth.csrf-token',
    '__Secure-next-auth.callback-url',
  ]

  for (const name of cookiesToClear) {
    response.cookies.set(name, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: new Date(0),
    })
  }

  // Also clear any cookies from the request
  const cookieHeader = request.headers.get('cookie') || ''
  for (const cookie of cookieHeader.split(';')) {
    const trimmed = cookie.trim()
    const name = trimmed.split('=')[0]
    if (name.startsWith('next-auth') || name.startsWith('__Secure-next-auth')) {
      response.cookies.set(name, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: new Date(0),
      })
    }
  }

  return response
}
