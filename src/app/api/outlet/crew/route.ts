import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getOutletPlan } from '@/lib/plan-config'
import { validateEmail, validatePassword } from '@/lib/api-helpers'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/safe-response'

/**
 * GET /api/outlet/crew — List all crew (non-owner users) for the outlet
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
    }

    const crew = await db.user.findMany({
      where: {
        outletId: user.outletId,
        role: 'CREW',
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        crewPermission: {
          select: { pages: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return safeJson({ crew })
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

    // Check plan limits
    const planData = await getOutletPlan(user.outletId, db)
    if (!planData || planData.features.maxCrew !== -1) {
      const currentCount = await db.user.count({
        where: { outletId: user.outletId, role: 'CREW' },
      })
      if (planData && currentCount >= planData.features.maxCrew) {
        return safeJsonError(`Batas crew (${planData.features.maxCrew}) sudah tercapai. Upgrade ke Pro untuk unlimited crew.`, 403)
      }
    }

    const body = await request.json()
    const { name, email, password } = body

    if (!name || !email || !password) {
      return safeJsonError('Nama, email, dan password wajib diisi', 400)
    }

    const emailErr = validateEmail(email)
    if (emailErr) return safeJsonError(emailErr, 400)

    const passwordErr = validatePassword(password)
    if (passwordErr) return safeJsonError(passwordErr, 400)

    // Check email uniqueness within outlet (email is part of compound unique [email, outletId])
    const existingUser = await db.user.findFirst({ where: { email, outletId: user.outletId } })
    if (existingUser) {
      return safeJsonError('Email sudah terdaftar', 409)
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const newCrew = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: 'CREW',
        outletId: user.outletId,
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
      details: JSON.stringify({ name, email }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJsonCreated({ crew: newCrew })
  } catch (error) {
    console.error('[/api/outlet/crew] POST error:', error)
    return safeJsonError('Internal server error', 500)
  }
}
