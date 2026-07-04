import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

// GET /api/inventory/movements/[id] — get single inventory movement details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { id } = await params

    const movement = await db.inventoryMovement.findFirst({
      where: { id, outletId: user.outletId },
      include: {
        inventoryItem: {
          include: {
            category: { select: { id: true, name: true, color: true } },
          },
        },
      },
    })

    if (!movement) {
      return safeJsonError('Movement not found', 404)
    }

    // Lookup user name
    let userName: string | null = null
    if (movement.userId) {
      const u = await db.user.findUnique({
        where: { id: movement.userId },
        select: { name: true },
      })
      userName = u?.name || null
    }

    // Lookup full reference info
    let referenceInfo: Record<string, unknown> | null = null
    if (movement.referenceId && movement.referenceType) {
      if (movement.referenceType === 'PURCHASE_ORDER') {
        const po = await db.purchaseOrder.findUnique({
          where: { id: movement.referenceId },
          select: {
            id: true,
            orderNumber: true,
            supplier: { select: { name: true } },
            totalCost: true,
            createdAt: true,
          },
        })
        if (po) {
          referenceInfo = {
            ...po,
            label: po.orderNumber,
            supplierName: po.supplier?.name || null,
          }
        }
      } else if (movement.referenceType === 'TRANSFER') {
        const trf = await db.outletTransfer.findUnique({
          where: { id: movement.referenceId },
          select: {
            id: true,
            transferNumber: true,
            status: true,
            fromOutlet: { select: { name: true } },
            toOutlet: { select: { name: true } },
            createdAt: true,
          },
        })
        if (trf) {
          referenceInfo = {
            ...trf,
            label: `${trf.transferNumber} (${trf.status})`,
            fromOutletName: trf.fromOutlet?.name || null,
            toOutletName: trf.toOutlet?.name || null,
          }
        }
      } else if (movement.referenceType === 'TRANSACTION') {
        const tx = await db.transaction.findUnique({
          where: { id: movement.referenceId },
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            paymentMethod: true,
            createdAt: true,
          },
        })
        if (tx) {
          referenceInfo = {
            ...tx,
            label: tx.invoiceNumber,
          }
        }
      } else if (movement.referenceType === 'ADJUSTMENT') {
        referenceInfo = {
          id: movement.referenceId,
          label: `ADJ-${movement.referenceId.slice(0, 8)}`,
        }
      }
    }

    return safeJson({
      id: movement.id,
      inventoryItemId: movement.inventoryItemId,
      inventoryItem: {
        id: movement.inventoryItem.id,
        name: movement.inventoryItem.name,
        sku: movement.inventoryItem.sku,
        baseUnit: movement.inventoryItem.baseUnit,
        stock: movement.inventoryItem.stock,
        category: movement.inventoryItem.category
          ? { id: movement.inventoryItem.category.id, name: movement.inventoryItem.category.name, color: movement.inventoryItem.category.color }
          : null,
      },
      type: movement.type,
      quantity: movement.quantity,
      previousStock: movement.previousStock,
      newStock: movement.newStock,
      referenceId: movement.referenceId,
      referenceType: movement.referenceType,
      referenceInfo,
      notes: movement.notes,
      userId: movement.userId,
      userName,
      createdAt: movement.createdAt,
    })
  } catch (error) {
    console.error('Inventory movement detail GET error:', error)
    return safeJsonError('Failed to load movement details')
  }
}