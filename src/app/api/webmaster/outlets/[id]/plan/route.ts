import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'
import { VALID_ACCOUNT_TYPES } from '@/lib/config/plan-config'
import { calculateExpiryDate } from '@/lib/plan-expiry'

/**
 * GET /api/webmaster/outlets/:id/plan — View outlet's current plan
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { id } = await params
    const outlet = await db.outlet.findUnique({
      where: { id },
      select: {
        id: true, name: true, accountType: true, planExpiresAt: true,
        isMain: true, groupId: true,
        group: { select: { name: true } },
        _count: { select: { users: true, products: true, customers: true, transactions: true } },
      },
    })
    if (!outlet) return NextResponse.json({ error: 'Outlet not found' }, { status: 404 })

    let planSource: { id: string; name: string; accountType: string; planExpiresAt: Date | null } | null = null
    if (outlet.groupId && !outlet.isMain) {
      const main = await db.outlet.findFirst({
        where: { groupId: outlet.groupId, isMain: true },
        select: { id: true, name: true, accountType: true, planExpiresAt: true },
      })
      if (main) planSource = main
    }

    return NextResponse.json({ outlet, planSource })
  } catch (error) {
    console.error('[GET /api/webmaster/outlets/:id/plan]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/webmaster/outlets/:id/plan — Set/change plan + expiry
 *
 * Body:
 *   - planType: 'free' | 'pro' | 'enterprise' (required)
 *   - months: number (optional — auto-calculates expiry)
 *   - planExpiresAt: string (optional — ISO date for explicit expiry)
 *   - applyToGroup: boolean (optional — apply to all outlets in group)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { id } = await params
    const body = await request.json()
    const { planType, months, planExpiresAt: explicitExpiry, applyToGroup } = body as {
      planType?: string; months?: number; planExpiresAt?: string; applyToGroup?: boolean
    }

    if (!planType || !VALID_ACCOUNT_TYPES.includes(planType as typeof VALID_ACCOUNT_TYPES[number]))
      return NextResponse.json(
        { error: `planType wajib. Valid: ${VALID_ACCOUNT_TYPES.join(', ')}` }, { status: 400 }
      )

    let expiryDate: Date | null = null
    if (planType !== 'free') {
      if (explicitExpiry) {
        const d = new Date(explicitExpiry)
        if (isNaN(d.getTime()))
          return NextResponse.json({ error: 'Format planExpiresAt tidak valid' }, { status: 400 })
        expiryDate = d
      } else if (months && months > 0) {
        expiryDate = calculateExpiryDate(months)
      } else {
        return NextResponse.json(
          { error: 'months atau planExpiresAt wajib diisi untuk plan berbayar' }, { status: 400 }
        )
      }
    }

    const outlet = await db.outlet.findUnique({
      where: { id }, select: { id: true, name: true, accountType: true, groupId: true, isMain: true },
    })
    if (!outlet) return NextResponse.json({ error: 'Outlet tidak ditemukan' }, { status: 404 })

    const previousPlan = outlet.accountType
    const data = { accountType: planType, planExpiresAt: expiryDate }
    const shouldApplyToGroup = outlet.groupId && (applyToGroup || outlet.isMain)

    let updatedCount = 0
    if (shouldApplyToGroup) {
      updatedCount = (await db.outlet.updateMany({ where: { groupId: outlet.groupId }, data })).count
    } else {
      await db.outlet.update({ where: { id }, data })
      updatedCount = 1
    }

    console.log(
      `[WEBMASTER] SET_PLAN: "${id}" (${outlet.name}) ${previousPlan} → ${planType}` +
      (shouldApplyToGroup ? ` [GROUP x${updatedCount}]` : '') +
      (expiryDate ? ` expires: ${expiryDate.toISOString()}` : '')
    )

    return NextResponse.json({
      success: true, outletId: id, outletName: outlet.name,
      previousPlan, newPlan: planType,
      planExpiresAt: expiryDate?.toISOString() ?? null,
      appliedToGroup: shouldApplyToGroup, updatedCount,
    })
  } catch (error) {
    console.error('[PUT /api/webmaster/outlets/:id/plan]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}