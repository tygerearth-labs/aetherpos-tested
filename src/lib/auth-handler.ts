import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * NextAuth route handler singleton.
 *
 * Instead of using [...nextauth] catch-all route (which causes issues
 * with some Git tools), we call this handler directly from individual
 * route files, passing the action as a param.
 */
const authHandler = NextAuth(authOptions)

/**
 * Call the NextAuth handler with a specific action.
 *
 * NextAuth internally reads `params.nextauth` to determine what action
 * to perform (session, csrf, signin, signout, providers, etc.).
 *
 * @param request - The incoming Request object
 * @param action - The NextAuth action array, e.g. ['session'] or ['signin', 'credentials']
 */
export async function authAction(request: Request, action: string[]) {
  // @ts-expect-error - NextAuth App Router handler expects params.nextauth
  return authHandler(request, { params: { nextauth: action } })
}
