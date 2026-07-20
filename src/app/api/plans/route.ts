import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'

// ── GET /api/plans — list all active plans (any authenticated user) ──
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  try {
    // Try to query Plan table — gracefully degrades if table doesn't exist
    let plans: unknown[] = []
    try {
      plans = await db.plan.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      })
    } catch {
      // Plan table doesn't exist yet — return empty
      plans = []
    }

    // Get current outlet plan slug
    let currentPlanSlug = 'free'
    try {
      const outlet = await db.outlet.findUnique({
        where: { id: user.outletId },
        select: { accountType: true },
      })
      currentPlanSlug = outlet?.accountType?.startsWith('suspended:')
        ? outlet.accountType.replace('suspended:', '')
        : (outlet?.accountType || 'free')
    } catch {
      // Outlet query failed — use default
    }

    return NextResponse.json({ plans, currentPlan: currentPlanSlug })
  } catch (error) {
    console.error('[GET /api/plans]', error)
    return NextResponse.json({ plans: [], currentPlan: 'free' }, { status: 200 })
  }
}

// ── POST /api/plans — create a new plan (WEBMASTER ONLY) ──
// FIX-PLAN-002: This endpoint was previously OWNER-accessible and allowed any
// authenticated owner to create Plan DB rows. Because getPlanFeaturesFromDB
// merges DB Plan.features OVER static defaults, an attacker could create a
// plan with slug="free" and features={maxCategories:-1, maxCustomers:-1, ...}
// to instantly raise the limits for ALL outlets on the free plan — a
// cross-tenant privilege escalation. Plan definitions are platform-level
// config and must only be editable via the COMMAND_SECRET webmaster tier.
export async function POST(request: NextRequest) {
  // FIX-PLAN-002: Require webmaster (Bearer $COMMAND_SECRET).
  if (!requireWebmaster(request)) {
    return webmasterUnauthorized()
  }

  try {
    const body = await request.json()
    const { name, slug, price, duration, paymentLink, features, active, sortOrder, description } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 })
    }

    // Check slug uniqueness
    const existing = await db.plan.findUnique({ where: { slug } })
    if (existing) {
      return NextResponse.json({ error: 'Slug already exists' }, { status: 409 })
    }

    const plan = await db.plan.create({
      data: {
        name,
        slug,
        price: price ?? 0,
        duration: duration ?? 1,
        paymentLink: paymentLink || null,
        features: typeof features === 'string' ? features : JSON.stringify(features || {}),
        active: active ?? true,
        sortOrder: sortOrder ?? 0,
        description: description || null,
      },
    })

    return NextResponse.json(plan, { status: 201 })
  } catch (error) {
    console.error('[POST /api/plans]', error)
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
  }
}