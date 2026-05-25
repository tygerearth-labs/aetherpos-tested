import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson } from '@/lib/safe-response'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (!auth || auth.role !== 'WEBMASTER') {
    return unauthorized()
  }

  return safeJson({
    id: auth.id,
    name: auth.name,
    email: auth.email,
    role: auth.role,
  })
}
