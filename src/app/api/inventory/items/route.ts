import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { buildFlexibleSearch } from '@/lib/api/api-helpers'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'

// GET /api/inventory/items — list inventory items for outlet
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const search = searchParams.get('search') || ''
    const categoryId = searchParams.get('categoryId') || ''
    const activeOnly = searchParams.get('activeOnly') !== 'false' // default: true

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
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true, color: true } },
        _count: { select: { compositions: true, purchaseItems: true, batches: true } },
        batches: {
          where: { status: 'AVAILABLE' },
          select: { remainingQty: true },
        },
      },
    })

    return safeJson({
      items: items.map((i) => {
        const batchSum = i.batches.reduce((sum, b) => sum + b.remainingQty, 0)
        const drift = i.stock - batchSum
        return {
          ...i,
          status: i.status,
          _batchSum: batchSum,
          _drift: Math.abs(drift) > 0.001 ? drift : 0,
          _driftStatus: Math.abs(drift) > 0.001
            ? (drift > 0 ? 'LEGACY_DRIFT' : 'PHANTOM_BATCH')
            : 'INVARIANT_VALID',
          batches: undefined, // Don't expose batch details in list
        }
      }),
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