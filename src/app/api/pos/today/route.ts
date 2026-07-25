import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getVoidedTxIds } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

/**
 * GET /api/pos/today
 *
 * Lightweight endpoint for the POS header strip.
 * Returns today's active (non-voided) transaction count + total revenue,
 * plus the outlet's display name. Used by the POS header info bar.
 *
 * Timezone: uses the request's tzOffset query param (minutes) to define
 * "today" in the user's local timezone. Falls back to UTC if absent.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const outletId = user.outletId

    // ── Resolve "today" boundaries in the user's timezone ──
    const tzOffsetMin = Number(request.nextUrl.searchParams.get('tzOffset'))
    const offsetMin = Number.isFinite(tzOffsetMin) ? tzOffsetMin : 0

    // Local "now" = UTC now - offset (so that local midnight aligns correctly)
    const now = new Date()
    const localNow = new Date(now.getTime() - offsetMin * 60_000)
    const startOfLocalDay = new Date(
      Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), 0, 0, 0, 0)
    )
    const endOfLocalDay = new Date(startOfLocalDay.getTime() + 24 * 60 * 60_000)

    // ── Fetch voided IDs to exclude ──
    const voidedIdSet = await getVoidedTxIds(db, outletId)

    // ── Aggregate today's active transactions (single query, minimal select) ──
    const where: Record<string, unknown> = {
      outletId,
      createdAt: { gte: startOfLocalDay, lt: endOfLocalDay },
    }
    if (voidedIdSet.size > 0) {
      where.id = { notIn: Array.from(voidedIdSet) as string[] }
    }

    const [agg, outlet] = await Promise.all([
      db.transaction.aggregate({
        where,
        _count: { _all: true },
        _sum: { total: true },
      }),
      db.outlet.findUnique({
        where: { id: outletId },
        select: { name: true },
      }),
    ])

    return safeJson({
      count: agg._count._all,
      total: agg._sum.total ?? 0,
      outletName: outlet?.name ?? null,
      cashierName: user.name,
      date: now.toISOString(),
    })
  } catch (error) {
    console.error('GET /api/pos/today error:', error)
    return safeJsonError('Gagal memuat ringkasan hari ini', 500)
  }
}
