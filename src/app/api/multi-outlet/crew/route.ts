import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import { validateEmail, validatePassword, parsePagination } from '@/lib/api/api-helpers'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'

/**
 * GET /api/multi-outlet/crew?outletId=xxx&search=&page=1&limit=20
 *
 * List crew members for a specific outlet in the same group.
 * OWNER-only (must be in same group).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Hanya owner yang dapat mengakses', 403)

    const { searchParams } = request.nextUrl
    const targetOutletId = searchParams.get('outletId')
    if (!targetOutletId) return safeJsonError('outletId wajib diisi', 400)

    // Verify: both outlets in same group
    const [currentUserOutlet, targetOutlet] = await Promise.all([
      db.outlet.findUnique({
        where: { id: user.outletId },
        select: { id: true, groupId: true, isMain: true },
      }),
      db.outlet.findUnique({
        where: { id: targetOutletId },
        select: { id: true, groupId: true, name: true },
      }),
    ])

    if (!currentUserOutlet?.groupId) return safeJsonError('Outlet Anda belum tergabung dalam grup', 400)
    if (!targetOutlet) return safeJsonError('Outlet target tidak ditemukan', 404)
    if (currentUserOutlet.groupId !== targetOutlet.groupId) return safeJsonError('Tidak dalam grup yang sama', 403)

    const { page, limit, skip } = parsePagination(searchParams)
    const search = searchParams.get('search') || ''

    const whereClause: Record<string, unknown> = {
      outletId: targetOutletId,
      role: 'CREW',
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
      ]
    }

    const [crew, total] = await Promise.all([
      db.user.findMany({
        where: whereClause as never,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          crewPermission: {
            select: { pages: true, id: true },
          },
          _count: {
            select: { transactions: true },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      db.user.count({ where: whereClause as never }),
    ])

    // Also get owner info for this outlet
    const owner = await db.user.findFirst({
      where: { outletId: targetOutletId, role: 'OWNER' },
      select: { id: true, name: true, email: true, createdAt: true },
    })

    return safeJson({
      outlet: { id: targetOutlet.id, name: targetOutlet.name },
      owner,
      crew,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('[/api/multi-outlet/crew] GET error:', error)
    return safeJsonError('Failed to load crew data')
  }
}

/**
 * POST /api/multi-outlet/crew — Add crew to a specific outlet in the group.
 *
 * Body: { outletId, name, email, password }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Hanya owner yang dapat menambah crew', 403)

    const body = await request.json()
    const { outletId: targetOutletId, name, email, password } = body

    if (!targetOutletId || !name || !email || !password) {
      return safeJsonError('outletId, nama, email, dan password wajib diisi', 400)
    }

    // Verify: both outlets in same group
    const [currentUserOutlet, targetOutlet] = await Promise.all([
      db.outlet.findUnique({
        where: { id: user.outletId },
        select: { id: true, groupId: true },
      }),
      db.outlet.findUnique({
        where: { id: targetOutletId },
        select: { id: true, groupId: true, name: true },
      }),
    ])

    if (!currentUserOutlet?.groupId) return safeJsonError('Outlet Anda belum tergabung dalam grup', 400)
    if (!targetOutlet) return safeJsonError('Outlet target tidak ditemukan', 404)
    if (currentUserOutlet.groupId !== targetOutlet.groupId) return safeJsonError('Tidak dalam grup yang sama', 403)

    // Check plan limits (use the group's main outlet plan)
    const planData = await getOutletPlan(targetOutletId, db)
    if (!planData || planData.features.maxCrew !== -1) {
      const currentCount = await db.user.count({
        where: { outletId: targetOutletId, role: 'CREW' },
      })
      if (planData && currentCount >= planData.features.maxCrew) {
        return safeJsonError(
          `Batas crew outlet "${targetOutlet.name}" (${planData.features.maxCrew}) sudah tercapai. Upgrade ke Pro untuk unlimited crew.`,
          403
        )
      }
    }

    // Validate
    const emailErr = validateEmail(email)
    if (emailErr) return safeJsonError(emailErr, 400)
    const passwordErr = validatePassword(password)
    if (passwordErr) return safeJsonError(passwordErr, 400)

    // Check email uniqueness within target outlet
    const existingUser = await db.user.findFirst({
      where: { email, outletId: targetOutletId },
    })
    if (existingUser) {
      return safeJsonError('Email sudah terdaftar di outlet ini', 409)
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const newCrew = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: 'CREW',
        outletId: targetOutletId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    })

    // Audit log — at target outlet
    await safeAuditLog({
      action: 'CREATE',
      entityType: 'CREW',
      entityId: newCrew.id,
      details: JSON.stringify({ name, email, addedBy: user.name, fromOutlet: user.outletId }),
      outletId: targetOutletId,
      userId: user.id,
    })

    return safeJsonCreated({ crew: newCrew })
  } catch (error) {
    console.error('[/api/multi-outlet/crew] POST error:', error)
    return safeJsonError('Internal server error', 500)
  }
}