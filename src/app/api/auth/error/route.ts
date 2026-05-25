import { authAction } from '@/lib/auth-handler'

/**
 * GET /api/auth/error - NextAuth error page.
 * Displays authentication errors (invalid credentials, etc.)
 */
export async function GET(request: Request) {
  return authAction(request, ['error'])
}
