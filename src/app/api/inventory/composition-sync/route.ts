import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

/**
 * GET /api/inventory/composition-sync
 * Check for unsynced composition snapshots and return a summary.
 *
 * POST /api/inventory/composition-sync
 * Process unsynced snapshots: verify the transaction exists, then
 * deduct inventory and mark as synced.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    const [unsynced, totalSnapshots] = await Promise.all([
      db.compositionUsageSnapshot.findMany({
        where: { outletId, synced: false },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      db.compositionUsageSnapshot.count({
        where: { outletId },
      }),
    ])

    const syncedCount = totalSnapshots - unsynced.length

    return safeJson({
      outletId,
      totalSnapshots,
      syncedCount,
      unsyncedCount: unsynced.length,
      unsyncedItems: unsynced.map(s => ({
        id: s.id,
        transactionId: s.transactionId,
        inventoryItemName: s.inventoryItemName,
        totalDeducted: s.totalDeducted,
        baseUnit: s.baseUnit,
        createdAt: s.createdAt,
        syncError: s.syncError,
      })),
    })
  } catch (error) {
    console.error('Composition sync GET error:', error)
    return safeJsonError('Failed to check composition sync status')
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    // Fetch all unsynced snapshots for this outlet
    const unsynced = await db.compositionUsageSnapshot.findMany({
      where: { outletId, synced: false },
      orderBy: { createdAt: 'asc' },
    })

    if (unsynced.length === 0) {
      return safeJson({ message: 'Tidak ada snapshot yang perlu di-sync', processed: 0 })
    }

    // Group by transactionId to verify transaction exists
    const txIds = [...new Set(unsynced.map(s => s.transactionId))]
    const transactions = await db.transaction.findMany({
      where: { id: { in: txIds } },
      select: { id: true, invoiceNumber: true },
    })
    const validTxIds = new Set(transactions.map(t => t.id))

    // Group deductions by inventoryItemId
    const deductions = new Map<string, { totalDeducted: number; snapshots: typeof unsynced }>()
    const invalidSnapshotIds: string[] = []

    for (const snapshot of unsynced) {
      // Verify transaction exists
      if (!validTxIds.has(snapshot.transactionId)) {
        invalidSnapshotIds.push(snapshot.id)
        continue
      }

      const existing = deductions.get(snapshot.inventoryItemId)
      if (existing) {
        existing.totalDeducted += snapshot.totalDeducted
        existing.snapshots.push(snapshot)
      } else {
        deductions.set(snapshot.inventoryItemId, {
          totalDeducted: snapshot.totalDeducted,
          snapshots: [snapshot],
        })
      }
    }

    // Delete snapshots for non-existent transactions
    if (invalidSnapshotIds.length > 0) {
      await db.compositionUsageSnapshot.deleteMany({
        where: { id: { in: invalidSnapshotIds } },
      })
    }

    // Process deductions in a transaction
    const result = await db.$transaction(async (tx) => {
      let processed = 0
      const errors: Array<{ snapshotId: string; error: string }> = []

      for (const [invItemId, { totalDeducted, snapshots }] of deductions) {
        try {
          // Fetch current stock
          const invItem = await tx.inventoryItem.findFirst({
            where: { id: invItemId, outletId },
            select: { id: true, stock: true, name: true },
          })
          if (!invItem) {
            // Inventory item no longer exists — mark snapshots with error
            for (const s of snapshots) {
              await tx.compositionUsageSnapshot.update({
                where: { id: s.id },
                data: {
                  syncAttemptedAt: new Date(),
                  syncError: `Inventory item ${invItemId} not found`,
                },
              })
              errors.push({ snapshotId: s.id, error: 'Inventory item not found' })
            }
            continue
          }

          const previousStock = invItem.stock
          const newStock = previousStock - totalDeducted

          // Deduct stock
          await tx.inventoryItem.update({
            where: { id: invItemId },
            data: { stock: newStock },
          })

          // Create inventory movement
          const txInfo = transactions.find(t => t.id === snapshots[0].transactionId)
          await tx.inventoryMovement.create({
            data: {
              type: 'CONSUMPTION',
              inventoryItemId: invItemId,
              quantity: -totalDeducted,
              previousStock,
              newStock,
              referenceId: snapshots[0].transactionId,
              referenceType: 'COMPOSITION_SYNC',
              notes: `[SYNC] Komposisi dari ${snapshots.length} snapshot (${txInfo?.invoiceNumber || snapshots[0].transactionId})`,
              outletId,
              userId: user.id,
            },
          })

          // Mark all related snapshots as synced
          const snapshotIds = snapshots.map(s => s.id)
          await tx.compositionUsageSnapshot.updateMany({
            where: { id: { in: snapshotIds } },
            data: { synced: true, syncAttemptedAt: new Date() },
          })

          processed += snapshots.length
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error'
          for (const s of snapshots) {
            try {
              await tx.compositionUsageSnapshot.update({
                where: { id: s.id },
                data: { syncAttemptedAt: new Date(), syncError: errMsg },
              })
            } catch { /* ignore */ }
            errors.push({ snapshotId: s.id, error: errMsg })
          }
        }
      }

      return { processed, errors, deleted: invalidSnapshotIds.length }
    })

    return safeJson({
      message: `Sync selesai: ${result.processed} snapshot diproses, ${result.deleted} snapshot dihapus (transaksi tidak ditemukan)`,
      ...result,
    })
  } catch (error) {
    console.error('Composition sync POST error:', error)
    return safeJsonError('Gagal sync composition snapshot')
  }
}