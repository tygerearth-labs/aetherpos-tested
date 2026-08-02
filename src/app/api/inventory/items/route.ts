import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { buildFlexibleSearch } from '@/lib/api/api-helpers'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'
import { emitAuditEvent, buildInventoryItemChangeEvent } from '@/lib/audit-v2'

// GET /api/inventory/items — list inventory items for outlet
// Query params:
//   search, categoryId, activeOnly (default true)
//   sortBy: 'name' | 'category' | 'stock' | 'unitCost' | 'value' | 'usage' | 'lastChangedAt'  (default 'lastChangedAt')
//   sortOrder: 'asc' | 'desc'  (default 'desc')
// Sorting is GLOBAL — applies before pagination on the entire filtered set,
// never just on the current page slice.
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const search = searchParams.get('search') || ''
    const categoryId = searchParams.get('categoryId') || ''
    const activeOnly = searchParams.get('activeOnly') !== 'false' // default: true

    // Sort whitelist — never interpolate raw user input into orderBy.
    type SortBy = 'name' | 'category' | 'stock' | 'unitCost' | 'value' | 'usage' | 'lastChangedAt'
    const ALLOWED_SORT: SortBy[] = ['name', 'category', 'stock', 'unitCost', 'value', 'usage', 'lastChangedAt']
    const requestedSort = searchParams.get('sortBy') as SortBy | null
    const sortBy: SortBy = requestedSort && ALLOWED_SORT.includes(requestedSort) ? requestedSort : 'lastChangedAt'
    const requestedOrder = searchParams.get('sortOrder')
    const sortOrder: 'asc' | 'desc' = requestedOrder === 'asc' ? 'asc' : 'desc'

    const where: Record<string, unknown> = { outletId: user.outletId }

    if (activeOnly) {
      where.status = 'ACTIVE'
    }

    if (search) {
      // Flexible, case-insensitive, token-aware search.
      const searchClause = buildFlexibleSearch(search, (q) => [
        { name: { contains: q } },
        { sku: { contains: q } },
        { baseUnit: { contains: q } },
        { category: { name: { contains: q } } },
      ])
      Object.assign(where, searchClause)
    }
    if (categoryId) {
      where.categoryId = categoryId
    }

    const items = await db.inventoryItem.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, color: true } },
        _count: { select: { compositions: true, purchaseItems: true, batches: true } },
        batches: {
          where: { status: 'AVAILABLE' },
          select: { remainingQty: true },
        },
      },
    })

    // ---- Global sort (applied to entire filtered set, not just current page) ----
    // Tie-breakers per spec: lastChangedAt → createdAt desc → name asc.
    // For other columns: primary sort, then lastChangedAt desc, then name asc.
    // Nulls/empty always sort to the bottom regardless of direction.
    const valOf = (i: typeof items[number]) => {
      switch (sortBy) {
        case 'name':
          return (i.name || '').toLowerCase()
        case 'category':
          return (i.category?.name || '').toLowerCase()
        case 'stock':
          return i.stock
        case 'unitCost':
          return i.avgCost
        case 'value':
          return i.stock * i.avgCost
        case 'usage':
          return i._count?.compositions ?? 0
        case 'lastChangedAt':
        default:
          // Prefer lastBusinessChangeAt (immune to POS-sale FEFO re-sync),
          // fall back to updatedAt for safety on legacy rows.
          return new Date(i.lastBusinessChangeAt ?? i.updatedAt).getTime()
      }
    }

    const dirMul = sortOrder === 'desc' ? -1 : 1
    items.sort((a, b) => {
      const va = valOf(a)
      const vb = valOf(b)
      // Null/empty to bottom regardless of direction (per spec point F).
      const aEmpty = va === '' || va === null || va === undefined
      const bEmpty = vb === '' || vb === null || vb === undefined
      if (aEmpty && !bEmpty) return 1
      if (!aEmpty && bEmpty) return -1
      if (aEmpty && bEmpty) {
        // both empty: fall through to tie-breaker
      } else if (va < vb) return -1 * dirMul
      else if (va > vb) return 1 * dirMul

      // Tie-breaker: when sortBy !== lastChangedAt, prefer recent business change next.
      if (sortBy !== 'lastChangedAt') {
        const ta = new Date(a.lastBusinessChangeAt ?? a.updatedAt).getTime()
        const tb = new Date(b.lastBusinessChangeAt ?? b.updatedAt).getTime()
        if (ta !== tb) return tb - ta // always desc
      } else {
        // When sorting by lastChangedAt, tie-break by createdAt desc, then name asc.
        const ca = new Date(a.createdAt).getTime()
        const cb = new Date(b.createdAt).getTime()
        if (ca !== cb) return cb - ca
        return a.name.localeCompare(b.name)
      }
      // Final tie-breaker: name asc
      return a.name.localeCompare(b.name)
    })

    return safeJson({
      items: items.map((i) => {
        const batchSum = i.batches.reduce((sum, b) => sum + b.remainingQty, 0)
        const drift = i.stock - batchSum
        return {
          ...i,
          status: i.status,
          // Surface both timestamps so the client can render "Terakhir Diubah"
          // and same-day highlight from the business-meaningful field.
          lastBusinessChangeAt: i.lastBusinessChangeAt,
          updatedAt: i.updatedAt,
          createdAt: i.createdAt,
          _batchSum: batchSum,
          _drift: Math.abs(drift) > 0.001 ? drift : 0,
          _driftStatus: Math.abs(drift) > 0.001
            ? (drift > 0 ? 'LEGACY_DRIFT' : 'PHANTOM_BATCH')
            : 'INVARIANT_VALID',
          batches: undefined, // Don't expose batch details in list
        }
      }),
      _sort: { sortBy, sortOrder },
    })
  } catch (error) {
    console.error('Inventory items GET error:', error)
    return safeJsonError('Failed to load inventory items')
  }
}

// POST /api/inventory/items — create new inventory item
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()
    const { name, sku, baseUnit, lowStockAlert, categoryId, stock, avgCost } = body

    if (!name || !name.trim()) {
      return safeJsonError('Item name is required', 400)
    }
    if (!baseUnit || !baseUnit.trim()) {
      return safeJsonError('Base unit is required', 400)
    }

    // Validate categoryId if provided
    if (categoryId) {
      const category = await db.inventoryCategory.findFirst({
        where: { id: categoryId, outletId: user.outletId },
      })
      if (!category) {
        return safeJsonError('Category not found', 400)
      }
    }

    // Check for duplicate name within same outlet
    const existingItem = await db.inventoryItem.findFirst({
      where: { name: name.trim(), outletId: user.outletId },
    })
    if (existingItem) {
      return safeJsonError(`Item "${name.trim()}" sudah ada di outlet ini`, 409)
    }

    try {
      const item = await db.$transaction(async (tx) => {
        const created = await tx.inventoryItem.create({
          data: {
            name: name.trim(),
            sku: sku?.trim() || null,
            baseUnit: baseUnit.trim(),
            stock: stock || 0,
            avgCost: avgCost || 0,
            lowStockAlert: lowStockAlert || 0,
            outletId: user.outletId,
            categoryId: categoryId || null,
          },
        })

        // INV-RECONCILE-001: Create RECONCILE batch for initial stock
        // This preserves the core invariant: stock == Σ(AVAILABLE batch.remainingQty)
        // Without this, any subsequent purchase POST would detect drift and
        // create a RECONCILE batch anyway — but this proactively prevents the
        // drift from ever existing, making the item immediately compatible
        // with FEFO-based consumption from the moment of creation.
        const initialStock = stock || 0
        if (initialStock > 0) {
          await tx.inventoryBatch.create({
            data: {
              batchNumber: `RECONCILE-INIT-${created.id.slice(-6)}-${Date.now()}`,
              inventoryItemId: created.id,
              initialQty: initialStock,
              remainingQty: initialStock,
              unitCost: avgCost || 0,
              expiredDate: null,
              purchaseOrderId: null,
              supplierId: null,
              supplierName: null,
              status: 'AVAILABLE',
              outletId: user.outletId,
              purchaseOrderItemId: null,
            },
          })

          // Create opening balance movement for audit trail
          await tx.inventoryMovement.create({
            data: {
              type: 'PURCHASE',
              inventoryItemId: created.id,
              quantity: initialStock,
              previousStock: 0,
              newStock: initialStock,
              referenceType: 'MIGRATION',
              notes: `Stok awal item: ${name.trim()}`,
              outletId: user.outletId,
              userId: user.id,
            },
          })

          console.log(
            `[InventoryItem POST] Created RECONCILE-INIT batch for "${name.trim()}" ` +
            `stock=${initialStock}, avgCost=${avgCost || 0}`
          )
        }

        // AuditLog V2 — single event for manual inventory item creation.
        // Atomic with the inventoryItem + batch + movement writes.
        await emitAuditEvent(
          tx,
          buildInventoryItemChangeEvent({
            inventoryItemId: created.id,
            itemName: created.name,
            sku: created.sku,
            changeType: 'created',
            after: {
              name: created.name,
              sku: created.sku ?? '',
              baseUnit: created.baseUnit,
              stock: created.stock,
              avgCost: created.avgCost,
              lowStockAlert: created.lowStockAlert,
              categoryId: created.categoryId ?? '',
            },
            source: 'manual',
            outletId: user.outletId,
            userId: user.id,
            operationId: `INV-CREATE-${created.id.slice(-6)}-${Date.now()}`,
          }),
        )

        return created
      }, { timeout: 15000 })

      return safeJsonCreated(item)
    } catch (error: unknown) {
      const prismaError = error as { code?: string }
      if (prismaError.code === 'P2002') {
        return safeJsonError(`Item "${name.trim()}" sudah ada di outlet ini`, 409)
      }
      console.error('Inventory items POST error:', error)
      return safeJsonError('Failed to create inventory item')
    }
  } catch (error) {
    console.error('Inventory items POST error:', error)
    return safeJsonError('Failed to create inventory item')
  }
}