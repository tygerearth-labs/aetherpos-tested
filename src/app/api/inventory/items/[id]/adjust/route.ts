import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { invalidateOutletExpiry } from '@/lib/cache'
import { buildInventoryAdjustmentEvent, emitAuditEvent } from '@/lib/audit-v2'
import { recalculateAffectedProductStock } from '@/lib/comp-stock'

// POST /api/inventory/items/[id]/adjust — manual stock adjustment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    // CREW-002 FIX: Only OWNER can perform manual stock adjustments (bypasses purchase flow)
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya OWNER yang dapat melakukan aksi ini', 403)
    }
    const userId = user.id
    const outletId = user.outletId
    const { id } = await params

    const body = await request.json()
    const { newStock, reason } = body

    if (newStock === undefined || newStock === null || newStock < 0) {
      return safeJsonError('Stock tidak boleh negatif', 400)
    }

    const existing = await db.inventoryItem.findFirst({
      where: { id, outletId },
      select: { id: true, name: true, stock: true, avgCost: true, baseUnit: true },
    })
    if (!existing) {
      return safeJsonError('Inventory item not found', 404)
    }

    const item = await db.$transaction(async (tx) => {
      const difference = newStock - existing.stock

      const updated = await tx.inventoryItem.update({
        where: { id },
        data: { stock: newStock, lastBusinessChangeAt: new Date() },
      })

      // INV-RECONCILE-002: Maintain batch invariant during manual adjustment
      // Core invariant: stock == Σ(AVAILABLE batch.remainingQty)
      if (difference > 0) {
        // Stock increase: create ADJUSTMENT batch for the added quantity
        await tx.inventoryBatch.create({
          data: {
            batchNumber: `ADJUST-${id.slice(-6)}-${Date.now()}`,
            inventoryItemId: id,
            initialQty: difference,
            remainingQty: difference,
            unitCost: existing.avgCost || 0,
            expiredDate: null,
            purchaseOrderId: null,
            supplierId: null,
            supplierName: null,
            status: 'AVAILABLE',
            outletId,
            purchaseOrderItemId: null,
          },
        })
        console.log(
          `[Adjust] Created ADJUSTMENT batch for "${existing.name}": +${difference} ` +
          `(stock: ${existing.stock} → ${newStock})`
        )
      } else if (difference < 0) {
        // Stock decrease: deduct from AVAILABLE batches using FEFO order
        // (nearest expiry first, nulls last — matching FEFOEngine convention)
        const availableBatches = await tx.inventoryBatch.findMany({
          where: {
            inventoryItemId: id,
            status: 'AVAILABLE',
            remainingQty: { gt: 0 },
          },
          orderBy: [
            { expiredDate: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
          ],
        })

        let toDeduct = Math.abs(difference)
        for (const batch of availableBatches) {
          if (toDeduct <= 0) break
          const deductFromBatch = Math.min(batch.remainingQty, toDeduct)
          await tx.inventoryBatch.update({
            where: { id: batch.id },
            data: { remainingQty: batch.remainingQty - deductFromBatch },
          })
          toDeduct -= deductFromBatch
        }

        // If we couldn't deduct all from available batches (data drift case),
        // try to handle remaining by adjusting any batch with remainingQty > 0
        if (toDeduct > 0) {
          const anyBatches = await tx.inventoryBatch.findMany({
            where: { inventoryItemId: id, remainingQty: { gt: 0 } },
            orderBy: [{ createdAt: 'desc' }],
          })
          for (const batch of anyBatches) {
            if (toDeduct <= 0) break
            const deductFromBatch = Math.min(batch.remainingQty, toDeduct)
            await tx.inventoryBatch.update({
              where: { id: batch.id },
              data: { remainingQty: batch.remainingQty - deductFromBatch },
            })
            toDeduct -= deductFromBatch
          }
        }

        if (toDeduct > 0) {
          console.warn(
            `[Adjust] INVENTORY_ANOMALY: Could not fully deduct from batches for "${existing.name}" (${id}). ` +
            `Remaining: ${toDeduct}. Possible data drift — no batches had enough remainingQty.`
          )
        } else {
          console.log(
            `[Adjust] Deducted from batches for "${existing.name}": ${Math.abs(difference)} ` +
            `(stock: ${existing.stock} → ${newStock})`
          )
        }
      }

      // V2 event-oriented audit (transactional — commits with the stock
      // update + batch changes + InventoryMovement ledger).
      // ONE INVENTORY_ADJUSTMENT event with ONE line covers the manual adjust.
      // operationId is generated client-side-per-call for traceability in the
      // audit drawer; the InventoryMovement ledger row remains the technical
      // double-entry record (NOT replaced).
      const operationId = `ADJUST-${id.slice(-6)}-${Date.now()}`
      await emitAuditEvent(
        tx,
        buildInventoryAdjustmentEvent({
          lines: [
            {
              itemName: existing.name,
              beforeStock: existing.stock,
              afterStock: newStock,
              delta: difference,
              unit: existing.baseUnit,
              reason: reason || undefined,
            },
          ],
          reason: reason || 'Penyesuaian stok manual',
          source: 'manual',
          outletId,
          userId,
          operationId,
        }),
      )

      // Create inventory movement for adjustment
      await tx.inventoryMovement.create({
        data: {
          type: 'ADJUSTMENT',
          inventoryItemId: id,
          quantity: difference,
          previousStock: existing.stock,
          newStock,
          referenceType: 'ADJUSTMENT',
          notes: reason || `Penyesuaian stok manual`,
          outletId,
          userId,
        },
      })

      // Product stock auto-sync — InventoryItem is the source of truth.
      // Recompute sellable capacity of every linked Product/Variant inside
      // the same transaction so Product.stock never drifts after a manual
      // inventory adjustment (Task 8 Restock/Adjustment dialog uses this).
      await recalculateAffectedProductStock(tx, outletId, [id])

      return updated
    }, { timeout: 15000 })

    // Stock changed → invalidate cached expiry/heatmap so dashboard refreshes
    invalidateOutletExpiry(outletId)

    return safeJson(item)
  } catch (error) {
    console.error('Inventory item adjust POST error:', error)
    return safeJsonError('Failed to adjust inventory stock')
  }
}