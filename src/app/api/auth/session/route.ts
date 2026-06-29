import { authAction } from '@/lib/auth/auth-handler'
import { checkPlanExpiration } from '@/lib/plan-expiration'
import { getAuthUser } from '@/lib/api/get-auth'

/**
 * GET /api/auth/session
 *
 * Returns the current session. If the user's outlet has an expired plan
 * and they are a branch outlet, the session is invalidated (logged out).
 */
export async function GET(request: Request) {
  const response = await authAction(request, ['session'])

  // Only check plan expiration for authenticated sessions
  try {
    // @ts-expect-error - NextRequest compatibility
    const user = await getAuthUser(request as any)
    if (user?.outletId) {
      const planCheck = await checkPlanExpiration(user.outletId)
      if (planCheck.isBranchBlocked) {
        // Branch outlet with expired plan — return empty session to force logout
        return new Response(
          JSON.stringify({}),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }
    }
  } catch {
    // If we can't read the user, just return the original session response
  }

  return response
}
