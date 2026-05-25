import { authAction } from '@/lib/auth-handler'

/**
 * GET /api/auth/signin - NextAuth sign-in page.
 * With custom pages.signIn set to '/', this redirects to the custom login page.
 */
export async function GET(request: Request) {
  return authAction(request, ['signin'])
}

export async function POST(request: Request) {
  return authAction(request, ['signin'])
}
