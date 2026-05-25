import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'
import { parsePagination } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { NextRequest } from 'next/server'

// GET: List all owners across all outlets
export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (!auth || auth.role !== 'WEBMASTER') {
    return unauthorized()
  }

  try {
    const { searchParams } = new URL(request.url)
    const pagination = parsePagination(searchParams)
    const search = searchParams.get('search') || ''

    const where = search
      ? {
          role: 'OWNER',
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : { role: 'OWNER' }

    const [owners, total] = await Promise.all([
      db.user.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          outletId: true,
          outlet: {
            select: {
              id: true,
              name: true,
              accountType: true,
            },
          },
        },
      }),
      db.user.count({ where }),
    ])

    return safeJson({
      data: owners,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    })
  } catch (error) {
    console.error('Webmaster owners list error:', error)
    return safeJsonError('Terjadi kesalahan internal')
  }
}
