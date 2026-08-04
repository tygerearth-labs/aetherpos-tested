import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination, buildFlexibleSearch } from '@/lib/api/api-helpers'
import { safeJson, safeJsonCreated, safeJsonError, CACHE } from '@/lib/api/safe-response'
import { invalidateOutletExpiry } from '@/lib/cache'
import { createPurchaseFromDraft, PurchaseDraftError } from '@/lib/purchase-draft-service'
import type { PurchaseDraftItem } from '@/lib/purchase-draft'
import { Prisma } from '@prisma/client'

// GET /api/purchases — list purchase orders with pagination
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const { page, limit, skip } = parsePagination(searchParams, { limit: 20 })
    const search = searchParams.get('search') || ''
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') || 'desc'
    const allowedSort = ['createdAt', 'totalCost', 'orderNumber'] as const
    const validSort = allowedSort.includes(sortBy as typeof allowedSort[number]) ? sortBy : 'createdAt'
    const validOrder = sortOrder === 'asc' ? 'asc' as const : 'desc' as const

    const where: Record<string, unknown> = { outletId: user.outletId }

    if (search) {
      // Flexible, case-insensitive, token-aware search across PO number,
      // supplier name, notes, item name/sku, and creator name.
      const searchClause = buildFlexibleSearch(search, (q) => [
        { orderNumber: { contains: q } },
        { supplier: { name: { contains: q } } },
        { notes: { contains: q } },
        { items: { some: { inventoryItem: { name: { contains: q } } } } },
        { items: { some: { inventoryItem: { sku: { contains: q } } } } },
        { items: { some: { batch: { contains: q } } } },
        { createdBy: { name: { contains: q } } },
      ])
      Object.assign(where, searchClause)
    }

    const [orders, total, linkedPoItems, usageCheckItems, transferLinkedPoItems, transactionLinkedPoItems] = await Promise.all([
      db.purchaseOrder.findMany({
        where,
        orderBy: { [validSort]: validOrder },
        skip,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          totalCost: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          supplier: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: { id: true, name: true },
          },
          items: {
            select: {
              id: true,
              inventoryItemId: true,
              baseQty: true,
              batch: true,
              expiredDate: true,
            },
          },
        },
      }),
      db.purchaseOrder.count({ where }),
      // Check 1: PO items linked to products (compositions)
      db.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: { outletId: user.outletId },
          inventoryItem: { compositions: { some: {} } },
        },
        select: { purchaseOrderId: true },
        distinct: ['purchaseOrderId'],
      }),
      // Check 2: PO items with usage history (stock < purchased qty)
      db.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: { outletId: user.outletId },
          inventoryItem: { stock: { lt: 0 } },  // Will filter in code below
        },
        select: {
          purchaseOrderId: true,
          inventoryItemId: true,
          baseQty: true,
        },
      }),
      // Check 3: PO items linked to TRANSFERS
      db.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: { outletId: user.outletId },
          inventoryItem: { inventoryTransferItems: { some: {} } },
        },
        select: { purchaseOrderId: true },
        distinct: ['purchaseOrderId'],
      }),
      // Check 4: PO items linked to TRANSAKSI/PENJUALAN (POS)
      db.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: { outletId: user.outletId },
          inventoryItem: { consumptionSnapshots: { some: {} } },
        },
        select: { purchaseOrderId: true },
        distinct: ['purchaseOrderId'],
      }),
    ])

    // Combine all "linked" flags
    const productLinkedPoIds = new Set(linkedPoItems.map(p => p.purchaseOrderId))
    const transferLinkedPoIds = new Set(transferLinkedPoItems.map(p => p.purchaseOrderId))
    const transactionLinkedPoIds = new Set(transactionLinkedPoItems.map(p => p.purchaseOrderId))

    // hasLinkedItems = linked to products OR transfers OR transactions
    const hasLinkedItems = new Set<string>()
    for (const id of [...productLinkedPoIds, ...transferLinkedPoIds, ...transactionLinkedPoIds]) {
      hasLinkedItems.add(id)
    }

    // Build a map of PO ID -> array of {inventoryItemId, baseQty}
    // Then check each item's current stock to determine if PO has usage
    const poItemMap = new Map<string, Array<{inventoryItemId: string; baseQty: number}>>()
    for (const item of usageCheckItems) {
      const existing = poItemMap.get(item.purchaseOrderId) || []
      existing.push({ inventoryItemId: item.inventoryItemId, baseQty: item.baseQty })
      poItemMap.set(item.purchaseOrderId, existing)
    }

    // Get all unique inventory item IDs from the usage check items
    const invItemIdsToCheck = [...new Set(usageCheckItems.map(i => i.inventoryItemId))]
    const currentStocks = new Map<string, number>()
    if (invItemIdsToCheck.length > 0) {
      const invItems = await db.inventoryItem.findMany({
        where: { id: { in: invItemIdsToCheck }, outletId: user.outletId },
        select: { id: true, stock: true },
      })
      for (const inv of invItems) {
        currentStocks.set(inv.id, inv.stock)
      }
    }

    // Determine which POs have usage history (cannot be safely deleted)
    const poWithUsageHistory = new Set<string>()
    for (const [poId, items] of poItemMap) {
      for (const item of items) {
        const currentStock = currentStocks.get(item.inventoryItemId) ?? 0
        // If current stock is less than what was added by this PO,
        // it means some quantity has been used/sold
        if (currentStock < item.baseQty) {
          poWithUsageHistory.add(poId)
          break
        }
      }
    }

    const mappedOrders = orders.map((o) => {
      const itemsWithBatch = o.items.filter(i => i.batch).length
      const itemsWithExp = o.items.filter(i => i.expiredDate).length
      const expiredItems = o.items.filter(i => i.expiredDate && new Date(i.expiredDate) < new Date()).length
      const sampleBatch = o.items.find(i => i.batch)?.batch || null
      const nearestExp = o.items
        .filter(i => i.expiredDate)
        .sort((a, b) => new Date(a.expiredDate!).getTime() - new Date(b.expiredDate!).getTime())[0]?.expiredDate || null

      // Granular flags for edit/delete control
      const hasProductLinks = productLinkedPoIds.has(o.id) && !transferLinkedPoIds.has(o.id) && !transactionLinkedPoIds.has(o.id)
      const hasTransferLinks = transferLinkedPoIds.has(o.id)
      const hasTransactionLinks = transactionLinkedPoIds.has(o.id)
      // hasRealBusinessHistory = blocks both edit and delete (transfers or sales)
      const hasRealBusinessHistory = hasTransferLinks || hasTransactionLinks

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        totalCost: o.totalCost,
        notes: o.notes,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        supplierName: o.supplier?.name || null,
        createdByName: o.createdBy.name,
        itemCount: o.items.length,
        // Legacy flag for backward compatibility
        hasLinkedItems: hasLinkedItems.has(o.id),
        hasUsageHistory: poWithUsageHistory.has(o.id),
        // New granular flags for precise control
        hasProductLinks,
        hasTransferLinks,
        hasTransactionLinks,
        hasRealBusinessHistory,
        _batchSummary: {
          itemsWithBatch,
          itemsWithExp,
          expiredItems,
          sampleBatch,
          nearestExp,
        },
      }
    })

    return safeJson(
      { orders: mappedOrders, totalPages: Math.ceil(total / limit) },
      200,
      CACHE.MEDIUM
    )
  } catch (error) {
    console.error('Purchases GET error:', error)
    return safeJsonError('Failed to load purchase orders')
  }
}

// POST /api/purchases — create purchase order
//
// Accepts a unified draft shape (`items[]` where each item carries either
// `inventoryItemId` for existing inventory OR `newKey` for items to be created
// inside the purchase tx). For backward compatibility, also accepts the legacy
// split shape (`items[]` + `newItems[]` with a `key` field).
//
// Both shapes are normalized into `PurchaseDraftItem[]` and persisted via the
// canonical `createPurchaseFromDraft()` service — a SINGLE $transaction that
// creates inventory items, PO, batches, stock updates, movements, audit, HPP
// recalc, and linked-product stock recalc atomically. No orphan rows on
// failure; no pre-creation of InventoryItems outside the tx.
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()

    // ── Normalize body into canonical PurchaseDraftItem[] ──
    // Supports two input shapes (both map to the same draft):
    //
    //   1. Unified: { items: [{ inventoryItemId?: string, newKey?: string, ... }] }
    //      — Each item carries EITHER inventoryItemId (existing) OR newKey (new).
    //      — The canonical shape produced by normalizeImportToPurchaseDraft().
    //
    //   2. Legacy split: { items: [{ inventoryItemId, ... }], newItems: [{ key, name, ... }] }
    //      — Existing items in `items[]`, new items in `newItems[]`.
    //      — Used by the bulk-engine delegate route and older callers.
    const draftItems: PurchaseDraftItem[] = []

    const bodyItems = (body.items || []) as Array<Record<string, unknown>>
    for (const item of bodyItems) {
      const inventoryItemId = (item.inventoryItemId as string) || null
      const newKey = (item.newKey as string) || null
      const purchaseQty = Number(item.purchaseQty) || 0
      const baseQty = Number(item.baseQty) || 0
      // conversionFactor: trust the client when present (> 0). Otherwise derive
      // from baseQty/purchaseQty so legacy callers (which only send baseQty)
      // still pass the canonical consistency check.
      const rawFactor = Number(item.conversionFactor)
      const conversionFactor =
        Number.isFinite(rawFactor) && rawFactor > 0
          ? rawFactor
          : purchaseQty > 0
            ? baseQty / purchaseQty
            : 0
      draftItems.push({
        inventoryItemId,
        newKey,
        name: (item.name as string) || '',
        sku: (item.sku as string | null) ?? null,
        baseUnit: (item.baseUnit as string) || '',
        purchaseQty,
        purchaseUnit: (item.purchaseUnit as string) || '',
        conversionFactor,
        baseQty,
        unitCost: Number(item.unitCost) || 0,
        totalCost: Number(item.totalCost) || 0,
        batch: ((item.batch as string) || '').trim() || null,
        expiredDate: (item.expiredDate as string) || null,
      })
    }

    const bodyNewItems = (body.newItems || []) as Array<Record<string, unknown>>
    for (const item of bodyNewItems) {
      const purchaseQty = Number(item.purchaseQty) || 0
      const baseQty = Number(item.baseQty) || 0
      const rawFactor = Number(item.conversionFactor)
      const conversionFactor =
        Number.isFinite(rawFactor) && rawFactor > 0
          ? rawFactor
          : purchaseQty > 0
            ? baseQty / purchaseQty
            : 0
      draftItems.push({
        inventoryItemId: null,
        newKey: (item.key as string) || '',
        name: (item.name as string) || '',
        sku: (item.sku as string | null) ?? null,
        baseUnit: (item.baseUnit as string) || 'pcs',
        purchaseQty,
        purchaseUnit: (item.purchaseUnit as string) || '',
        conversionFactor,
        baseQty,
        unitCost: Number(item.unitCost) || 0,
        totalCost: Number(item.totalCost) || 0,
        batch: ((item.batch as string) || '').trim() || null,
        expiredDate: (item.expiredDate as string) || null,
      })
    }

    const result = await createPurchaseFromDraft({
      outletId: user.outletId,
      userId: user.id,
      supplierId: (body.supplierId as string) || null,
      notes: (body.notes as string) || null,
      items: draftItems,
    })

    // Post-commit cache invalidation (not a DB write — safe outside the tx).
    invalidateOutletExpiry(user.outletId)

    return safeJsonCreated({
      ...result.purchaseOrder,
      _importStats: result.importStats,
    })
  } catch (error) {
    // ── Structured error mapping ──
    if (error instanceof PurchaseDraftError) {
      return safeJsonError(error.message, error.status)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target)
          ? (error.meta!.target as string[]).join(',')
          : ''
        if (target.includes('orderNumber')) {
          return safeJsonError('Gagal membuat PO: nomor order sudah ada. Silakan coba lagi.', 409)
        }
        if (target.includes('batchNumber')) {
          return safeJsonError('Gagal: nomor batch sudah ada. Cek kolom Batch di Excel.', 409)
        }
        return safeJsonError('Gagal membuat pembelian: data sudah ada (konflik unik).', 409)
      }
    }
    console.error('Purchases POST error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Gagal membuat pembelian: ${msg}`)
  }
}
