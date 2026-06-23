import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getOutletPlan } from '@/lib/plan-config'
import { validateEmail, validatePassword } from '@/lib/api-helpers'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/safe-response'
import { getOwnerOutlets } from '@/lib/multi-outlet'

/**
 * GET /api/outlet/crew — List crew with multi-outlet support & performance metrics
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
    }

    const { searchParams } = request.nextUrl
    const outletFilter = searchParams.get('outletId') || ''

    // Multi-outlet support
    let effectiveOutletIds: string[]
    let outlets: { id: string; name: string }[] = []

    if (user.email) {
      const multiOutlet = await getOwnerOutlets(db, user.email, user.outletId)
      if (multiOutlet) {
        outlets = multiOutlet.outlets
        if (outletFilter && multiOutlet.outletIds.includes(outletFilter)) {
          effectiveOutletIds = [outletFilter]
        } else {
          effectiveOutletIds = multiOutlet.outletIds
        }
      } else {
        effectiveOutletIds = [user.outletId]
        outlets = [{ id: user.outletId, name: 'Outlet Saat Ini' }]
      }
    } else {
      effectiveOutletIds = [user.outletId]
    }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const crew = await db.user.findMany({
      where: {
        outletId: { in: effectiveOutletIds },
        role: 'CREW',
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        outletId: true,
        createdAt: true,
        crewPermission: {
          select: { pages: true },
        },
        outlet: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Fetch performance metrics
    const perfData = await Promise.all(
      crew.map(async (c) => {
        const [allTime, thisMonth, today] = await Promise.all([
          db.transaction.aggregate({
            where: { userId: c.id, outletId: c.outletId },
            _count: true,
            _sum: { total: true },
          }),
          db.transaction.aggregate({
            where: { userId: c.id, outletId: c.outletId, createdAt: { gte: monthStart } },
            _count: true,
            _sum: { total: true },
          }),
          db.transaction.count({
            where: { userId: c.id, outletId: c.outletId, createdAt: { gte: todayStart } },
          }),
        ])
        return {
          crewId: c.id,
          totalTransactions: allTime._count,
          totalRevenue: allTime._sum.total ?? 0,
          monthTransactions: thisMonth._count,
          monthRevenue: thisMonth._sum.total ?? 0,
          todayTransactions: today,
        }
      })
    )
    const perfMap = new Map(perfData.map(p => [p.crewId, p]))

    const mappedCrew = crew.map((c) => {
      const perf = perfMap.get(c.id)
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        role: c.role,
        outletId: c.outletId,
        outletName: c.outlet?.name ?? null,
        createdAt: c.createdAt,
        crewPermission: c.crewPermission,
        // Performance
        totalTransactions: perf?.totalTransactions ?? 0,
        totalRevenue: perf?.totalRevenue ?? 0,
        monthTransactions: perf?.monthTransactions ?? 0,
        monthRevenue: perf?.monthRevenue ?? 0,
        todayTransactions: perf?.todayTransactions ?? 0,
      }
    })

    return safeJson({
      crew: mappedCrew,
      ...(outlets.length > 1 ? { outlets } : {}),
    })
  } catch (error) {
    console.error('[/api/outlet/crew] GET error:', error)
    return safeJsonError('Failed to load crew', 500)
  }
}

/**
 * POST /api/outlet/crew — Add a new crew member
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menambah crew', 403)
    }

    const body = await request.json()
    const { name, email, password, outletId: requestedOutletId } = body

    if (!name || !email || !password) {
      return safeJsonError('Nama, email, dan password wajib diisi', 400)
    }

    const emailErr = validateEmail(email)
    if (emailErr) return safeJsonError(emailErr, 400)

    const passwordErr = validatePassword(password)
    if (passwordErr) return safeJsonError(passwordErr, 400)

    // Resolve target outlet: use requested outlet (multi-outlet) or session outlet (single)
    let targetOutletId = user.outletId
    if (requestedOutletId && user.email) {
      const multiOutlet = await getOwnerOutlets(db, user.email, user.outletId)
      if (multiOutlet && multiOutlet.outletIds.includes(requestedOutletId)) {
        targetOutletId = requestedOutletId
      } else if (requestedOutletId !== user.outletId) {
        return safeJsonError('Outlet tidak valid', 403)
      }
    }

    // Check plan limits
    const planData = await getOutletPlan(targetOutletId, db)
    if (!planData || planData.features.maxCrew !== -1) {
      const currentCount = await db.user.count({
        where: { outletId: targetOutletId, role: 'CREW' },
      })
      if (planData && currentCount >= planData.features.maxCrew) {
        return safeJsonError(`Batas crew (${planData.features.maxCrew}) sudah tercapai. Upgrade ke Pro untuk unlimited crew.`, 403)
      }
    }

    // Check email uniqueness within target outlet
    const existingUser = await db.user.findFirst({ where: { email, outletId: targetOutletId } })
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

    // Audit log
    await safeAuditLog({
      action: 'CREATE',
      entityType: 'CREW',
      entityId: newCrew.id,
      details: JSON.stringify({ name, email, outletId: targetOutletId }),
      outletId: targetOutletId,
      userId: user.id,
    })

    return safeJsonCreated({ crew: newCrew })
  } catch (error) {
    console.error('[/api/outlet/crew] POST error:', error)
    return safeJsonError('Internal server error', 500)
  }
}
