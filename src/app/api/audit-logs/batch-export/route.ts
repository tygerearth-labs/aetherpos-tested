import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJsonError } from '@/lib/api/safe-response'

export const maxDuration = 60

/**
 * GET /api/audit-logs/batch-export
 * Export batch detail related to a specific entity (e.g., inventory item, purchase order).
 * Query params:
 *   - entityType: INVENTORY_ITEM, PURCHASE_ORDER, etc.
 *   - entityId: the entity ID
 *   - action: optional filter by audit action
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId
    const userId = user.id

    // Permission check: OWNER always allowed; CREW must have 'audit-log' in their assigned pages
    if (user.role !== 'OWNER') {
      const perm = await db.crewPermission.findUnique({
        where: { userId: user.id },
        select: { pages: true },
      })
      const allowedPages = perm?.pages?.split(',').map((p) => p.trim()) || []
      if (!allowedPages.includes('audit-log')) {
        return safeJsonError('Kamu tidak memiliki akses ke Audit Log', 403)
      }
    }

    // Plan gate
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) return safeJsonError('Outlet not found', 404)
    if (!outletPlan.features.exportExcel) {
      return safeJsonError('Fitur export hanya tersedia untuk paket Pro ke atas.', 403)
    }

    const { searchParams } = request.nextUrl
    const entityType = searchParams.get('entityType') || ''
    const entityId = searchParams.get('entityId') || ''
    const action = searchParams.get('action') || ''

    if (!entityType || !entityId) {
      return safeJsonError('entityType dan entityId wajib diisi', 400)
    }

    const wb = XLSX.utils.book_new()

    // === Sheet 1: Audit Logs for this entity ===
    const where: Record<string, unknown> = {
      outletId,
      entityType,
      entityId,
    }
    if (action) where.action = action

    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: {
        user: { select: { name: true, email: true } },
      },
    })

    const logHeader = ['Timestamp', 'User', 'Action', 'Tipe Entity', 'Entity ID', 'Detail']
    const logRows = logs.map((log) => [
      new Date(log.createdAt).toLocaleString('id-ID'),
      log.user?.name || 'System',
      log.action,
      log.entityType,
      log.entityId || '-',
      (() => {
        try {
          const parsed = JSON.parse(log.details || '{}')
          return JSON.stringify(parsed, null, 2)
        } catch {
          return log.details || '-'
        }
      })(),
    ])

    const wsLogs = XLSX.utils.aoa_to_sheet([logHeader, ...logRows])
    wsLogs['!cols'] = [
      { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 30 }, { wch: 80 },
    ]
    XLSX.utils.book_append_sheet(wb, wsLogs, 'Audit Logs')

    // === Sheet 2: Batch Detail (if entity is INVENTORY_ITEM) ===
    if (entityType === 'INVENTORY_ITEM') {
      const batches = await db.inventoryBatch.findMany({
        where: { inventoryItemId: entityId, outletId },
        orderBy: { createdAt: 'desc' },
        include: {
          purchaseOrder: { select: { orderNumber: true } },
        },
      })

      if (batches.length > 0) {
        const batchHeader = [
          'Batch Number',
          'Qty Awal',
          'Qty Sisa',
          'HPP Satuan (Rp)',
          'Nilai Sisa (Rp)',
          'Tanggal Expired',
          'Status',
          'No. PO',
          'Supplier',
          'Tanggal Dibuat',
        ]

        const batchRows = batches.map((b) => [
          b.batchNumber,
          b.initialQty,
          b.remainingQty,
          b.unitCost,
          b.remainingQty * b.unitCost,
          b.expiredDate ? new Date(b.expiredDate).toISOString().split('T')[0] : '-',
          b.status,
          b.purchaseOrder?.orderNumber || '-',
          b.supplierName || '-',
          new Date(b.createdAt).toLocaleString('id-ID'),
        ])

        const wsBatch = XLSX.utils.aoa_to_sheet([batchHeader, ...batchRows])
        wsBatch['!cols'] = [
          { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 },
          { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 22 }, { wch: 22 },
        ]
        XLSX.utils.book_append_sheet(wb, wsBatch, 'Batch Detail')
      }

      // === Sheet 3: Consumption Logs ===
      const consumptionLogs = await db.batchConsumptionLog.findMany({
        where: { inventoryItemId: entityId, outletId },
        orderBy: { createdAt: 'desc' },
        take: 5000,
        include: {
          transaction: { select: { invoiceNumber: true, createdAt: true } },
        },
      })

      if (consumptionLogs.length > 0) {
        const consHeader = [
          'Tanggal',
          'Invoice',
          'Batch Number',
          'Qty Digunakan',
          'Satuan',
          'Expired Date Batch',
          'Detail Sumber',
        ]

        const consRows = consumptionLogs.map((c) => [
          new Date(c.createdAt).toLocaleString('id-ID'),
          c.invoiceNumber,
          c.batchNumber,
          c.quantityConsumed,
          '', // unit - can be looked up from item
          c.expiredDate ? new Date(c.expiredDate).toISOString().split('T')[0] : '-',
          c.sourceDetails || '-',
        ])

        const wsCons = XLSX.utils.aoa_to_sheet([consHeader, ...consRows])
        wsCons['!cols'] = [
          { wch: 22 }, { wch: 24 }, { wch: 20 }, { wch: 16 },
          { wch: 12 }, { wch: 14 }, { wch: 60 },
        ]
        XLSX.utils.book_append_sheet(wb, wsCons, 'Riwayat Konsumsi Batch')
      }
    }

    // === Sheet 4: Inventory Movements (if entity is INVENTORY_ITEM) ===
    if (entityType === 'INVENTORY_ITEM') {
      const movements = await db.inventoryMovement.findMany({
        where: { inventoryItemId: entityId, outletId },
        orderBy: { createdAt: 'desc' },
        take: 5000,
        include: {
          user: { select: { name: true } },
        },
      })

      if (movements.length > 0) {
        const movHeader = [
          'Tanggal',
          'Tipe',
          'Qty',
          'Stok Sebelum',
          'Stok Sesudah',
          'Referensi',
          'Tipe Referensi',
          'Catatan',
          'User',
        ]

        const movRows = movements.map((m) => [
          new Date(m.createdAt).toLocaleString('id-ID'),
          m.type,
          m.quantity,
          m.previousStock,
          m.newStock,
          m.referenceId || '-',
          m.referenceType || '-',
          m.notes || '-',
          m.user?.name || 'System',
        ])

        const wsMov = XLSX.utils.aoa_to_sheet([movHeader, ...movRows])
        wsMov['!cols'] = [
          { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 14 },
          { wch: 14 }, { wch: 28 }, { wch: 18 }, { wch: 40 }, { wch: 18 },
        ]
        XLSX.utils.book_append_sheet(wb, wsMov, 'Pergerakan Stok')
      }
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Audit log
    await safeAuditLog({
      action: 'EXPORT',
      entityType: 'AUDIT_LOG',
      details: JSON.stringify({
        batchExport: true,
        targetEntityType: entityType,
        targetEntityId: entityId,
        logCount: logs.length,
      }),
      outletId,
      userId,
    })

    const filename = `batch-detail-${entityType}-${new Date().toISOString().slice(0, 10)}.xlsx`
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Batch detail export error:', error)
    return safeJsonError('Gagal mengekspor batch detail')
  }
}