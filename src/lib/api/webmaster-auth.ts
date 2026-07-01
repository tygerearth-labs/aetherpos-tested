/**
 * webmaster-auth.ts — Webmaster (Command Center) Authentication
 *
 * All /api/webmaster/* routes use this to verify COMMAND_SECRET.
 * The webmaster is an external system, NOT an app user (not OWNER/CREW).
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * Verify the COMMAND_SECRET Bearer token from the request.
 * Returns true if valid, false otherwise.
 */
export function requireWebmaster(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.COMMAND_SECRET

  if (!secret) {
    console.error('[webmaster-auth] COMMAND_SECRET not configured on server')
    return false
  }

  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    return false
  }

  return true
}

/**
 * Returns a standard 401 response for failed webmaster auth.
 */
export function webmasterUnauthorized(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized — invalid or missing command token' },
    { status: 401 }
  )
}