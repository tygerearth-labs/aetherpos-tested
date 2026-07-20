import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'

// ── PUT /api/plans/:id — update a plan (WEBMASTER ONLY) ──
// FIX-PLAN-002: Plan DB rows merge into per-outlet enforcement via
// getPlanFeaturesFromDB — allowing OWNERs to edit them is a cross-tenant
// privilege-escalation vector (e.g. set free plan maxCategories:-1 to
// raise the limit for ALL free-tier outlets). Restricted to webmaster.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // FIX-PLAN-002: Require webmaster (Bearer $COMMAND_SECRET).
  if (!requireWebmaster(request)) {
    return webmasterUnauthorized()
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { name, slug, price, duration, paymentLink, features, active, sortOrder, description } = body

    // If slug is being changed, check uniqueness
    if (slug) {
      const existing = await db.plan.findFirst({ where: { slug, NOT: { id } } })
      if (existing) {
        return NextResponse.json({ error: 'Slug already exists' }, { status: 409 })
      }
    }

    const plan = await db.plan.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
        ...(price !== undefined && { price }),
        ...(duration !== undefined && { duration }),
        ...(paymentLink !== undefined && { paymentLink: paymentLink || null }),
        ...(features !== undefined && {
          features: typeof features === 'string' ? features : JSON.stringify(features),
        }),
        ...(active !== undefined && { active }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(description !== undefined && { description: description || null }),
      },
    })

    return NextResponse.json(plan)
  } catch (error) {
    console.error('[PUT /api/plans/:id]', error)
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 })
  }
}

// ── DELETE /api/plans/:id — delete a plan (WEBMASTER ONLY) ──
// FIX-PLAN-002: Same cross-tenant risk as PUT — restricted to webmaster.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // FIX-PLAN-002: Require webmaster (Bearer $COMMAND_SECRET).
  if (!requireWebmaster(request)) {
    return webmasterUnauthorized()
  }

  try {
    const { id } = await params
    await db.plan.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/plans/:id]', error)
    return NextResponse.json({ error: 'Failed to delete plan' }, { status: 500 })
  }
}
