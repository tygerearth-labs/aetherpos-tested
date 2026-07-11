import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { FEFOEngine } from '@/lib/fefo-engine'

// GET /api/inventory/batches/check?batchNumber=xxx — Smart purchase warning
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    const { searchParams } = request.nextUrl
    const batchNumber = searchParams.get('batchNumber')
    const expiredDateStr = searchParams.get('expiredDate')

    if (!batchNumber?.trim()) {
      return safeJsonError('batchNumber is required', 400)
    }

    // Check if the provided expiredDate is already in the past
    if (expiredDateStr) {
      const expiredDate = new Date(expiredDateStr)
      if (!isNaN(expiredDate.getTime()) && expiredDate < new Date()) {
        return safeJson({
          error: 'EXPIRED_DATE_PASSED',
          message: 'Tanggal kadaluarsa sudah lewat. Pastikan tanggal yang benar.',
        }, 400)
      }
    }

    // Check for duplicate batch number
    const duplicate = await db.$transaction(async (tx) => {
      return FEFOEngine.checkDuplicateBatch(tx, {
        batchNumber: batchNumber.trim(),
        outletId,
      })
    })

    if (duplicate) {
      return safeJson({
        warning: true,
        duplicate: {
          id: duplicate.id,
          batchNumber: duplicate.batchNumber,
          inventoryItemName: duplicate.inventoryItemName,
          remainingQty: duplicate.remainingQty,
          expiredDate: duplicate.expiredDate,
          purchaseOrderNumber: duplicate.purchaseOrderNumber,
          createdAt: duplicate.createdAt,
        },
        message: `Batch "${batchNumber}" sudah ada (${duplicate.inventoryItemName}, sisa ${duplicate.remainingQty} unit dari PO ${duplicate.purchaseOrderNumber}). Pastikan ini bukan duplikat.`,
      })
    }

    return safeJson({ warning: false, duplicate: null })
  } catch (error) {
    console.error('Batch check GET error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Batch check failed: ${msg}`)
  }
}