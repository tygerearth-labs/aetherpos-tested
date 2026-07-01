import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'

/**
 * GET /api/webmaster/plans/:id
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { id } = await params
    const plan = await db.plan.findUnique({ where: { id } })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    return NextResponse.json(plan)
  } catch (error) {
    console.error('[GET /api/webmaster/plans/:id]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/webmaster/plans/:id — Update plan
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { id } = await params
    const body = await request.json()
    const { name, slug, price, duration, paymentLink, features, active, sortOrder, description } = body

    const existing = await db.plan.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    if (slug && slug !== existing.slug) {
      const dup = await db.plan.findFirst({ where: { slug, NOT: { id } } })
      if (dup) return NextResponse.json({ error: 'Slug sudah digunakan' }, { status: 409 })
    }

    const plan = await db.plan.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
        ...(price !== undefined && { price }),
        ...(duration !== undefined && { duration }),
        ...(paymentLink !== undefined && { paymentLink: paymentLink || null }),
        ...(features !== undefined && { features: typeof features === 'string' ? features : JSON.stringify(features) }),
        ...(active !== undefined && { active }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(description !== undefined && { description: description || null }),
      },
    })

    console.log(`[WEBMASTER] UPDATE_PLAN: "${plan.name}" (${plan.slug})`)
    return NextResponse.json(plan)
  } catch (error) {
    console.error('[PUT /api/webmaster/plans/:id]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/webmaster/plans/:id
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { id } = await params
    const existing = await db.plan.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    await db.plan.delete({ where: { id } })
    console.log(`[WEBMASTER] DELETE_PLAN: "${existing.name}" (${existing.slug})`)
    return NextResponse.json({ success: true, deletedPlanId: id })
  } catch (error) {
    console.error('[DELETE /api/webmaster/plans/:id]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}