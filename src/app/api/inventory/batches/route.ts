import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination, buildFlexibleSearch } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'
import { FEFOEngine } from '@/lib/fefo-engine'

// GET /api/inventory/batches — Batch data with multiple query types
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    const { searchParams } = request.nextUrl
    const type = searchParams.get('type')

    // All read operations that depend on batch status should mark expired first
    if (type && type !== 'check-duplicate' && type !== 'search') {
      await db.$transaction(async (tx) => {
        await FEFOEngine.markExpiredBatches(tx, outletId)
      })
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
async function handleHeatmap(outletId: string) {
  const result = await db.$transaction(async (tx) => {
    return FEFOEngine.getExpiryHeatmap(tx, outletId)
  })

  return safeJson(result, 200, CACHE.MEDIUM)
}

// ── Freshness Score ──
async function handleFreshnessScore(outletId: string) {
  // markExpiredBatches already called above for type=freshness-score
  const result = await db.$transaction(async (tx) => {
    return FEFOEngine.calculateFreshnessScore(tx, outletId)
  })

  return safeJson(result, 200, CACHE.MEDIUM)
}

// ── Waste Report ──
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

  const result = await db.$transaction(async (tx) => {
    return FEFOEngine.getWasteReport(tx, {
      outletId,
      startDate,
      endDate,
    })
  })

  return safeJson(result, 200, CACHE.MEDIUM)
}

// ── Purchase Recommendations ──
async function handleRecommendations(outletId: string) {
  const result = await db.$transaction(async (tx) => {
    return FEFOEngine.getPurchaseRecommendations(tx, outletId)
  })

  return safeJson(result, 200, CACHE.MEDIUM)
}

// ── Batch Timeline for an Inventory Item ──
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

  const result = await db.$transaction(async (tx) => {
    return FEFOEngine.getBatchTimeline(tx, {
      inventoryItemId,
      outletId,
    })
  })

  return safeJson(result, 200, CACHE.SHORT)
}

// ── Search Batch by Number ──
async function handleSearch(outletId: string, searchParams: URLSearchParams) {
  const batchNumber = searchParams.get('batchNumber')

  if (!batchNumber?.trim()) {
    return safeJsonError('batchNumber is required for search', 400)
  }

  const result = await db.$transaction(async (tx) => {
    return FEFOEngine.searchBatch(tx, {
      batchNumber: batchNumber.trim(),
      outletId,
    })
  })

  if (!result) {
    return safeJsonError('Batch not found', 404)
  }

  return safeJson(result, 200, CACHE.SHORT)
}

// ── Check Duplicate Batch ──
async function handleCheckDuplicate(outletId: string, searchParams: URLSearchParams) {
  const batchNumber = searchParams.get('batchNumber')

  if (!batchNumber?.trim()) {
    return safeJsonError('batchNumber is required', 400)
  }

  const result = await db.$transaction(async (tx) => {
    return FEFOEngine.checkDuplicateBatch(tx, {
      batchNumber: batchNumber.trim(),
      outletId,
    })
  })

  // Return shape matches the UI's DuplicateWarning interface:
  // { warning: boolean, duplicate: {...} | null }
  return safeJson({
    warning: !!result,
    duplicate: result,
  })
}

// ── Paginated List of All Batches ──
async function handlePaginatedList(outletId: string, searchParams: URLSearchParams) {
  const { page, limit, skip } = parsePagination(searchParams, { limit: 20 })
  const statusFilter = searchParams.get('status')
  const inventoryItemId = searchParams.get('inventoryItemId')
  const search = searchParams.get('search') || ''

  const where: Record<string, unknown> = { outletId }

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