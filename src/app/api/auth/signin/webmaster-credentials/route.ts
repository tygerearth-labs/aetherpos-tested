import { authAction } from '@/lib/auth-handler'

export async function GET(request: Request) {
  return authAction(request, ['signin', 'webmaster-credentials'])
}

export async function POST(request: Request) {
  return authAction(request, ['signin', 'webmaster-credentials'])
}
