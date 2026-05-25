import { authAction } from '@/lib/auth-handler'

export async function POST(request: Request) {
  return authAction(request, ['_log'])
}
