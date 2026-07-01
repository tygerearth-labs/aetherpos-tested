import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'
import { parsePagination } from '@/lib/api/api-helpers'

/**
 * GET /api/webmaster/users
 *
 * List all users across all outlets with search & pagination.
 * Webmaster-only (COMMAND_SECRET).
 *
 * Query params:
 *   - search: search by name or email
 *   - outletId: filter by outlet
 *   - role: filter by role (OWNER, CREW)
 *   - page, limit: pagination
 */
export async function GET(request: NextRequest) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const outletId = searchParams.get('outletId') || ''
    const role = searchParams.get('role') || ''
    const { page, limit, skip } = parsePagination(searchParams, { limit: 50 })

    const where: Record<string, unknown> = {}
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
      ]
    }
    if (outletId) where.outletId = outletId
    if (role) where.role = role

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          outletId: true,
          createdAt: true,
          updatedAt: true,
          outlet: {
            select: { id: true, name: true, accountType: true },
          },
          crewPermission: {
            select: { pages: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.user.count({ where }),
    ])

    return NextResponse.json({
      users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (error) {
    console.error('[GET /api/webmaster/users]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}