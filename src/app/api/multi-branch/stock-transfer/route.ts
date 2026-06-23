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

// ── GET: List stock transfers ──
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

// ── POST: Create stock transfer request ──
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
    const {
      fromOutletId,
      toOutletId,
      productId,
      variantId,
      productName,
      variantName,
      quantity,
      reason,
    } = body

    // Validate required fields
    if (!fromOutletId || !toOutletId || !productName || !quantity) {
      return safeJsonError('fromOutletId, toOutletId, productName, and quantity are required', 400)
    }

    if (quantity <= 0) {
      return safeJsonError('Quantity must be greater than 0', 400)
    }

    if (fromOutletId === toOutletId) {
      return safeJsonError('Source and destination outlets must be different', 400)
    }

    // Validate both outlets belong to the owner
    if (!outletIds.includes(fromOutletId) || !outletIds.includes(toOutletId)) {
      return safeJsonError('One or both outlets do not belong to your account', 403)
    }

    // Validate sufficient stock at fromOutlet
    if (variantId) {
      const variant = await db.productVariant.findFirst({
        where: { id: variantId, outletId: fromOutletId, productId },
      })
      if (!variant) {
        return safeJsonError('Variant not found in the source outlet', 404)
      }
      if (variant.stock < quantity) {
        return safeJsonError(`Insufficient stock. Available: ${variant.stock}`, 400)
      }
    } else if (productId) {
      const product = await db.product.findFirst({
        where: { id: productId, outletId: fromOutletId },
      })
      if (!product) {
        return safeJsonError('Product not found in the source outlet', 404)
      }
      if (product.stock < quantity) {
        return safeJsonError(`Insufficient stock. Available: ${product.stock}`, 400)
      }
    }

    // Create the stock transfer with status PENDING
    const transfer = await db.stockTransfer.create({
      data: {
        productId: productId || null,
        variantId: variantId || null,
        productName,
        variantName: variantName || null,
        quantity,
        fromOutletId,
        toOutletId,
        status: 'PENDING',
        reason: reason || null,
        outletId: user.outletId,
        userId: user.id,
      },
    })

    // Audit log
    await safeAuditLog({
      action: 'CREATE',
      entityType: 'STOCK_TRANSFER',
      entityId: transfer.id,
      details: JSON.stringify({
        productName,
        variantName,
        quantity,
        fromOutletId,
        toOutletId,
        reason,
      }),
      outletId: user.outletId,
      userId: user.id,
    })

    return safeJsonCreated({ transfer })
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

        // Add to toOutlet variant (find by product name/variant name)
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