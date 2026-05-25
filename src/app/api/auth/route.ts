// Auth route handlers are in individual subdirectories (session, csrf, signin, etc.)
// This file provides a basic info endpoint at /api/auth
import { safeJson } from '@/lib/safe-response'

export async function GET() {
  return safeJson({ message: 'Auth endpoints: /api/auth/signin, /api/auth/register' })
}
