import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { parsePagination } from '@/lib/api-helpers'
import { getOutletPlan } from '@/lib/plan-config'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/safe-response'
import { safeAuditLog } from '@/lib/safe-audit'

// Helper to get all outlet IDs for the current owner
async function getOwnerOutletIds(email: string): Promise<string[]> {
  const owners = await db.user.findMany({
    where: { email, role: 'OWNER' },
    select: { outletId: true },
  })
  return owners.map(o => o.outletId)
}

// ── GET: List stock transfers OR fetch products by outlet ──
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Only owners can access stock transfers', 403)
    }

    // Enterprise plan check
    const planData = await getOutletPlan(user.outletId, db)
    if (!planData || planData.plan !== 'enterprise') {
      return safeJsonError('Multi-branch management requires an enterprise plan', 403)
    }

    const outletIds = await getOwnerOutletIds(user.email!)
    if (outletIds.length === 0) {
      return safeJsonError('No outlets found', 404)
    }

    const { searchParams } = request.nextUrl

    // ── Mode: fetch products for a specific outlet ──
    const mode = searchParams.get('mode')
    if (mode === 'products') {
      const targetOutletId = searchParams.get('outletId')
      if (!targetOutletId) return safeJsonError('outletId is required', 400)
      if (!outletIds.includes(targetOutletId)) return safeJsonError('Outlet not found', 403)

      const search = searchParams.get('search') || ''
      const toOutletId = searchParams.get('toOutletId') || ''
      const where: Record<string, unknown> = { outletId: targetOutletId, stock: { gt: 0 } }
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { sku: { contains: search } },
          { barcode: { contains: search } },
        ]
      }

      const products = await db.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          stock: true,
          price: true,
          category: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
        take: 100,
      })

      // If a toOutletId is provided, also fetch destination stock for comparison
      let toStockMap: Map<string, number> | null = null
      if (toOutletId && outletIds.includes(toOutletId)) {
        const toProducts = await db.product.findMany({
          where: { outletId: toOutletId },
          select: { name: true, stock: true },
        })
        toStockMap = new Map(toProducts.map(p => [p.name, p.stock]))
      }

      const mappedProducts = products.map(p => ({
        ...p,
        toStock: toStockMap?.get(p.name) ?? 0,
      }))

      return safeJson({ products: mappedProducts })
    }

    // ── Default mode: list transfers ──
    const { limit, skip } = parsePagination(searchParams)
    const statusFilter = searchParams.get('status') || ''

    const where: Record<string, unknown> = {
      outletId: { in: outletIds },
    }

    if (statusFilter) {
      where.status = statusFilter
    }

    const [transfers, total] = await Promise.all([
      db.stockTransfer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          fromOutlet: { select: { name: true } },
          toOutlet: { select: { name: true } },
          user: { select: { name: true } },
        },
      }),
      db.stockTransfer.count({ where }),
    ])

    const mappedTransfers = transfers.map((t) => ({
      id: t.id,
      productId: t.productId,
      variantId: t.variantId,
      productName: t.productName,
      variantName: t.variantName,
      quantity: t.quantity,
      fromOutletId: t.fromOutletId,
      toOutletId: t.toOutletId,
      fromOutletName: t.fromOutlet?.name ?? 'Unknown',
      toOutletName: t.toOutlet?.name ?? 'Unknown',
      status: t.status,
      reason: t.reason,
      approvedBy: t.approvedBy,
      approvedAt: t.approvedAt,
      completedAt: t.completedAt,
      createdBy: t.user?.name ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))

    return safeJson({
      transfers: mappedTransfers,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error('[/api/multi-branch/stock-transfer] GET error:', error)
    return safeJsonError('Failed to load stock transfers')
  }
}

// ── POST: Create stock transfer(s) ──
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Only owners can create stock transfers', 403)
    }

    // Enterprise plan check
    const planData = await getOutletPlan(user.outletId, db)
    if (!planData || planData.plan !== 'enterprise') {
      return safeJsonError('Multi-branch management requires an enterprise plan', 403)
    }

    const outletIds = await getOwnerOutletIds(user.email!)
    if (outletIds.length === 0) {
      return safeJsonError('No outlets found', 404)
    }

    const body = await request.json()

    // Support both single item (legacy) and items array
    const items = body.items
      ? body.items as Array<{
          productId: string
          productName: string
          quantity: number
        }>
      : [{
          productId: body.productId || '',
          productName: body.productName,
          quantity: body.quantity,
          variantId: body.variantId,
          variantName: body.variantName,
        }]

    const { fromOutletId, toOutletId, reason } = body

    if (!fromOutletId || !toOutletId || items.length === 0) {
      return safeJsonError('fromOutletId, toOutletId, and at least one item are required', 400)
    }

    for (const item of items) {
      if (!item.productName || !item.quantity || item.quantity <= 0) {
        return safeJsonError(`Invalid item: ${item.productName || 'unknown'} — name and quantity (>0) required`, 400)
      }
    }

    if (fromOutletId === toOutletId) {
      return safeJsonError('Source and destination outlets must be different', 400)
    }

    if (!outletIds.includes(fromOutletId) || !outletIds.includes(toOutletId)) {
      return safeJsonError('One or both outlets do not belong to your account', 403)
    }

    // Validate stock for all items
    for (const item of items) {
      if (item.variantId) {
        const variant = await db.productVariant.findFirst({
          where: { id: item.variantId, outletId: fromOutletId, productId: item.productId },
        })
        if (!variant) return safeJsonError(`Variant "${item.productName}" not found in source outlet`, 404)
        if (variant.stock < item.quantity) return safeJsonError(`Insufficient stock for "${item.productName}". Available: ${variant.stock}`, 400)
      } else if (item.productId) {
        const product = await db.product.findFirst({
          where: { id: item.productId, outletId: fromOutletId },
        })
        if (!product) return safeJsonError(`Product "${item.productName}" not found in source outlet`, 404)
        if (product.stock < item.quantity) return safeJsonError(`Insufficient stock for "${item.productName}". Available: ${product.stock}`, 400)
      }
    }

    // Create transfers for all items
    const transfers = await db.$transaction(
      items.map((item) =>
        db.stockTransfer.create({
          data: {
            productId: item.productId || null,
            variantId: (item as { variantId?: string }).variantId || null,
            productName: item.productName,
            variantName: (item as { variantName?: string }).variantName || null,
            quantity: item.quantity,
            fromOutletId,
            toOutletId,
            status: 'PENDING',
            reason: reason || null,
            outletId: user.outletId,
            userId: user.id,
          },
        })
      )
    )

    // Audit log (one entry for the batch)
    await safeAuditLog({
      action: 'CREATE',
      entityType: 'STOCK_TRANSFER',
      entityId: transfers[0].id,
      details: JSON.stringify({
        itemCount: items.length,
        items: items.map((i) => ({ productName: i.productName, quantity: i.quantity })),
        fromOutletId,
        toOutletId,
        reason,
      }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJsonCreated({ transfers, count: transfers.length })
  } catch (error) {
    console.error('[/api/multi-branch/stock-transfer] POST error:', error)
    return safeJsonError('Failed to create stock transfer')
  }
}

// ── PUT: Approve/reject/complete a transfer ──
export async function PUT(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Only owners can update stock transfers', 403)
    }

    // Enterprise plan check
    const planData = await getOutletPlan(user.outletId, db)
    if (!planData || planData.plan !== 'enterprise') {
      return safeJsonError('Multi-branch management requires an enterprise plan', 403)
    }

    const outletIds = await getOwnerOutletIds(user.email!)
    if (outletIds.length === 0) {
      return safeJsonError('No outlets found', 404)
    }

    const body = await request.json()
    const { id, status } = body

    if (!id || !status) {
      return safeJsonError('Transfer ID and status are required', 400)
    }

    const validStatuses = ['APPROVED', 'REJECTED', 'COMPLETED']
    if (!validStatuses.includes(status)) {
      return safeJsonError('Invalid status. Must be APPROVED, REJECTED, or COMPLETED', 400)
    }

    // Fetch the existing transfer
    const existing = await db.stockTransfer.findUnique({
      where: { id },
    })

    if (!existing) {
      return safeJsonError('Stock transfer not found', 404)
    }

    // Validate ownership
    if (!outletIds.includes(existing.fromOutletId) || !outletIds.includes(existing.toOutletId)) {
      return safeJsonError('Transfer does not belong to your outlets', 403)
    }

    // Validate state transitions
    if (existing.status === 'COMPLETED' || existing.status === 'REJECTED') {
      return safeJsonError('Cannot modify a completed or rejected transfer', 400)
    }
    if (existing.status === 'PENDING' && status === 'COMPLETED') {
      return safeJsonError('Transfer must be approved before completion', 400)
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      status,
      approvedBy: user.id,
    }

    if (status === 'APPROVED') {
      updateData.approvedAt = new Date()
    } else if (status === 'COMPLETED') {
      updateData.completedAt = new Date()
    }

    // For COMPLETED: actually move the stock
    if (status === 'COMPLETED') {
      // Deduct from fromOutlet
      if (existing.variantId) {
        const variant = await db.productVariant.findFirst({
          where: { id: existing.variantId, outletId: existing.fromOutletId },
        })
        if (!variant || variant.stock < existing.quantity) {
          return safeJsonError('Insufficient stock at source outlet for completion', 400)
        }
        await db.productVariant.update({
          where: { id: existing.variantId },
          data: { stock: { decrement: existing.quantity } },
        })

        // Add to toOutlet variant
        const toVariant = await db.productVariant.findFirst({
          where: {
            outletId: existing.toOutletId,
            productId: existing.productId,
            name: existing.variantName ?? '',
          },
        })
        if (toVariant) {
          await db.productVariant.update({
            where: { id: toVariant.id },
            data: { stock: { increment: existing.quantity } },
          })
        }
      } else if (existing.productId) {
        const product = await db.product.findFirst({
          where: { id: existing.productId, outletId: existing.fromOutletId },
        })
        if (!product || product.stock < existing.quantity) {
          return safeJsonError('Insufficient stock at source outlet for completion', 400)
        }
        await db.product.update({
          where: { id: existing.productId },
          data: { stock: { decrement: existing.quantity } },
        })

        // Add to toOutlet product
        const toProduct = await db.product.findFirst({
          where: { outletId: existing.toOutletId, name: existing.productName },
        })
        if (toProduct) {
          await db.product.update({
            where: { id: toProduct.id },
            data: { stock: { increment: existing.quantity } },
          })
        }
      }
    }

    // Update the transfer
    const transfer = await db.stockTransfer.update({
      where: { id },
      data: updateData,
    })

    // Audit log
    await safeAuditLog({
      action: `STOCK_TRANSFER_${status}`,
      entityType: 'STOCK_TRANSFER',
      entityId: transfer.id,
      details: JSON.stringify({
        productName: existing.productName,
        variantName: existing.variantName,
        quantity: existing.quantity,
        fromOutletId: existing.fromOutletId,
        toOutletId: existing.toOutletId,
        previousStatus: existing.status,
        newStatus: status,
      }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJson({ transfer })
  } catch (error) {
    console.error('[/api/multi-branch/stock-transfer] PUT error:', error)
    return safeJsonError('Failed to update stock transfer')
  }
}