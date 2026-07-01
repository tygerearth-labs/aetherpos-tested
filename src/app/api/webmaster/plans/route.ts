import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWebmaster, webmasterUnauthorized } from '@/lib/api/webmaster-auth'

/**
 * GET /api/webmaster/plans — List all plans (default active only)
 */
export async function GET(request: NextRequest) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') !== 'false'
    const plans = await db.plan.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: { sortOrder: 'asc' },
    })
    return NextResponse.json({ plans })
  } catch (error) {
    console.error('[GET /api/webmaster/plans]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/webmaster/plans — Create a new plan
 *
 * Body: { name, slug, price?, duration?, paymentLink?, features?, active?, sortOrder?, description? }
 */
export async function POST(request: NextRequest) {
  if (!requireWebmaster(request)) return webmasterUnauthorized()

  try {
    const body = await request.json()
    const { name, slug, price, duration, paymentLink, features, active, sortOrder, description } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0)
      return NextResponse.json({ error: 'Name wajib diisi' }, { status: 400 })
    if (!slug || typeof slug !== 'string' || slug.trim().length === 0)
      return NextResponse.json({ error: 'Slug wajib diisi' }, { status: 400 })

    const dup = await db.plan.findUnique({ where: { slug: slug.trim() } })
    if (dup) return NextResponse.json({ error: 'Slug sudah digunakan' }, { status: 409 })

    const plan = await db.plan.create({
      data: {
        name: name.trim(), slug: slug.trim(),
        price: price ?? 0, duration: duration ?? 1,
        paymentLink: paymentLink || null,
        features: typeof features === 'string' ? features : JSON.stringify(features || {}),
        active: active ?? true, sortOrder: sortOrder ?? 0,
        description: description || null,
      },
    })

    console.log(`[WEBMASTER] CREATE_PLAN: "${plan.name}" (${plan.slug})`)
    return NextResponse.json(plan, { status: 201 })
  } catch (error) {
    console.error('[POST /api/webmaster/plans]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}