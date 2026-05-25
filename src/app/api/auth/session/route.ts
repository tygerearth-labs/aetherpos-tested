import { authAction } from '@/lib/auth-handler'

export async function GET(request: Request) {
  return authAction(request, ['session'])
}
