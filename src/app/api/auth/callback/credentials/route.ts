import { authAction } from '@/lib/auth-handler'

/**
 * POST /api/auth/callback/credentials - OAuth callback for credentials provider.
 * NextAuth may use this internally for the credentials flow.
 */
export async function POST(request: Request) {
  return authAction(request, ['callback', 'credentials'])
}

export async function GET(request: Request) {
  return authAction(request, ['callback', 'credentials'])
}
