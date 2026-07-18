import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination, buildFlexibleSearch } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'
import { FEFOEngine } from '@/lib/fefo-engine'
import {
  swr,
  isMarkExpiredInCooldown,
  setMarkExpiredTriggered,
} from '@/lib/cache'

// ────────────────────────────────────────────────────────────
// Lazy, throttled background trigger for markExpiredBatches.
//
// Old code did `await db.$transaction(... markExpired ...)` on EVERY read
// request — that blocked the response and easily hit the 5s transaction
// timeout (especially on cold compile).
//
// New behaviour:
//   - Fire-and-forget (no await)
//   - Throttled to once per 5 minutes per outlet (via cache flag)
//   - On failure, retry after 30s (shorter cooldown)
//   - Status EXPIRED is also computed on-the-fly by the read functions
//     (`batch.expiredDate < now`), so UI accuracy is unaffected even if
//     this background job hasn't run yet.
// ────────────────────────────────────────────────────────────
function triggerMarkExpiredLazy(outletId: string): void {
  if (isMarkExpiredInCooldown(outletId)) return

  // Reserve the slot immediately so concurrent requests don't pile up
  setMarkExpiredTriggered(outletId)

  // Fire-and-forget — DO NOT await
  db.$transaction(async (tx) => {
    await FEFOEngine.markExpiredBatches(tx, outletId)
  })
    .then((count) => {
      if (count > 0) {
        // Newly-expired batches detected → invalidate heatmap cache so the
        // next read picks up the change (otherwise up to 5 min stale).
        // Importing here avoids a circular import at module load.
        import('@/lib/cache').then(({ invalidate }) => {
          invalidate(`heatmap:${outletId}`)
          invalidate(`freshness:${outletId}`)
          invalidate(`expirycheck:${outletId}`)
        })
      }
    })
    .catch((err) => {
      console.error('[markExpired] background failed:', err)
      // Use shorter retry cooldown on failure
      setMarkExpiredTriggered(outletId, true)
    })
}

// GET /api/inventory/batches — Batch data with multiple query types
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    const { searchParams } = request.nextUrl
    const type = searchParams.get('type')

    // Trigger markExpired in the background (non-blocking, throttled to
    // once per 5 min per outlet). Skip for user-input-driven endpoints
    // (search / check-duplicate) where fresh DB state matters more.
    if (type && type !== 'check-duplicate' && type !== 'search') {
      triggerMarkExpiredLazy(outletId)
    }

    switch (type) {
      case 'heatmap':
        return await handleHeatmap(outletId)
      case 'freshness-score':
        return await handleFreshnessScore(outletId)
      case 'waste-report':
        return await handleWasteReport(outletId, searchParams)
      case 'recommendations':
        return await handleRecommendations(outletId)
      case 'timeline':
        return await handleTimeline(outletId, searchParams)
      case 'search':
        return await handleSearch(outletId, searchParams)
      case 'check-duplicate':
        return await handleCheckDuplicate(outletId, searchParams)
      default:
        return await handlePaginatedList(outletId, searchParams)
    }
  } catch (error) {
    console.error('Batches GET error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Failed to load batch data: ${msg}`)
  }
}

// ── Heatmap ──
// Read-only — no $transaction wrapper (avoids 5s Prisma timeout).
// Cached 5 min via SWR (stale-while-revalidate): first request after TTL
// returns stale + refreshes in background.
async function handleHeatmap(outletId: string) {
  const result = await swr(
    `heatmap:${outletId}`,
    5 * 60 * 1000, // 5 minutes
    () => FEFOEngine.getExpiryHeatmap(db, outletId)
  )
  return safeJson(result, 200, CACHE.MEDIUM)
}

// ── Freshness Score ──
// Read-only, cached 5 min.
async function handleFreshnessScore(outletId: string) {
  const result = await swr(
    `freshness:${outletId}`,
    5 * 60 * 1000,
    () => FEFOEngine.calculateFreshnessScore(db, outletId)
  )
  return safeJson(result, 200, CACHE.MEDIUM)
}

// ── Waste Report ──
// Read-only, cached 5 min per date-range.
async function handleWasteReport(outletId: string, searchParams: URLSearchParams) {
  const startDateStr = searchParams.get('startDate')
  const endDateStr = searchParams.get('endDate')

  if (!startDateStr || !endDateStr) {
    return safeJsonError('startDate and endDate are required for waste report', 400)
  }

  const startDate = new Date(startDateStr)
  const endDate = new Date(endDateStr)

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return safeJsonError('Invalid date format. Use ISO date strings.', 400)
  }

  const cacheKey = `waste:${outletId}:${startDateStr}:${endDateStr}`
  const result = await swr(cacheKey, 5 * 60 * 1000, () =>
    FEFOEngine.getWasteReport(db, { outletId, startDate, endDate })
  )

  return safeJson(result, 200, CACHE.MEDIUM)
}

// ── Purchase Recommendations ──
// Read-only, cached 10 min (recomms change slowly).
async function handleRecommendations(outletId: string) {
  const result = await swr(
    `recs:${outletId}`,
    10 * 60 * 1000, // 10 minutes
    () => FEFOEngine.getPurchaseRecommendations(db, outletId)
  )
  return safeJson(result, 200, CACHE.MEDIUM)
}

// ── Batch Timeline for an Inventory Item ──
// Read-only, cached 2 min (more dynamic — consumption logs change often).
async function handleTimeline(outletId: string, searchParams: URLSearchParams) {
  const inventoryItemId = searchParams.get('inventoryItemId')

  if (!inventoryItemId) {
    return safeJsonError('inventoryItemId is required for timeline', 400)
  }

  // Verify the inventory item belongs to this outlet
  const item = await db.inventoryItem.findFirst({
    where: { id: inventoryItemId, outletId },
    select: { id: true },
  })

  if (!item) {
    return safeJsonError('Inventory item not found', 404)
  }

  const cacheKey = `timeline:${outletId}:${inventoryItemId}`
  const result = await swr(cacheKey, 2 * 60 * 1000, () =>
    FEFOEngine.getBatchTimeline(db, { inventoryItemId, outletId })
  )

  return safeJson(result, 200, CACHE.SHORT)
}

// ── Search Batch by Number ──
// User-input driven → NO cache (must reflect latest DB state).
// Read-only → no $transaction.
async function handleSearch(outletId: string, searchParams: URLSearchParams) {
  const batchNumber = searchParams.get('batchNumber')

  if (!batchNumber?.trim()) {
    return safeJsonError('batchNumber is required for search', 400)
  }

  const result = await FEFOEngine.searchBatch(db, {
    batchNumber: batchNumber.trim(),
    outletId,
  })

  if (!result) {
    return safeJsonError('Batch not found', 404)
  }

  return safeJson(result, 200, CACHE.SHORT)
}

// ── Check Duplicate Batch ──
// User-input driven → NO cache. Read-only → no $transaction.
async function handleCheckDuplicate(outletId: string, searchParams: URLSearchParams) {
  const batchNumber = searchParams.get('batchNumber')

  if (!batchNumber?.trim()) {
    return safeJsonError('batchNumber is required', 400)
  }

  const result = await FEFOEngine.checkDuplicateBatch(db, {
    batchNumber: batchNumber.trim(),
    outletId,
  })

  // Return shape matches the UI's DuplicateWarning interface:
  // { warning: boolean, duplicate: {...} | null }
  return safeJson({
    warning: !!result,
    duplicate: result,
  })
}

// ── Paginated List of All Batches ──
// Read-only, no cache (pagination + search params make cache key explosion risky).
// No $transaction — just two parallel findMany + count.
async function handlePaginatedList(outletId: string, searchParams: URLSearchParams) {
  const { page, limit, skip } = parsePagination(searchParams, { limit: 20 })
  const statusFilter = searchParams.get('status')
  const inventoryItemId = searchParams.get('inventoryItemId')
  const search = searchParams.get('search') || ''

  const where: Record<string, unknown> = outletId ? { outletId } : {}

  if (statusFilter) {
    where.status = statusFilter
  }
  if (inventoryItemId) {
    where.inventoryItemId = inventoryItemId
  }
  if (search) {
    // Flexible, case-insensitive, token-aware batch search across batch number,
    // inventory item name/sku, supplier name, and PO order number.
    const searchClause = buildFlexibleSearch(search, (q) => [
      { batchNumber: { contains: q } },
      { inventoryItem: { name: { contains: q } } },
      { inventoryItem: { sku: { contains: q } } },
      { supplierName: { contains: q } },
      { purchaseOrder: { orderNumber: { contains: q } } },
    ])
    Object.assign(where, searchClause)
  }

  const [batches, total] = await Promise.all([
    db.inventoryBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        inventoryItem: {
          select: { id: true, name: true, baseUnit: true },
        },
        purchaseOrder: {
          select: { id: true, orderNumber: true },
        },
      },
    }),
    db.inventoryBatch.count({ where }),
  ])

  const now = new Date()
  const mapped = batches.map(b => ({
    id: b.id,
    batchNumber: b.batchNumber,
    inventoryItemId: b.inventoryItemId,
    inventoryItemName: b.inventoryItem.name,
    baseUnit: b.inventoryItem.baseUnit,
    initialQty: b.initialQty,
    remainingQty: b.remainingQty,
    unitCost: b.unitCost,
    totalValue: b.remainingQty * b.unitCost,
    expiredDate: b.expiredDate,
    daysUntilExpiry: b.expiredDate
      ? Math.ceil((b.expiredDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      : null,
    status: b.status,
    supplierName: b.supplierName,
    purchaseOrderNumber: b.purchaseOrder?.orderNumber || null,
    createdAt: b.createdAt,
  }))

  return safeJson({
    batches: mapped,
    totalPages: Math.ceil(total / limit),
    total,
  }, 200, CACHE.SHORT)
}
