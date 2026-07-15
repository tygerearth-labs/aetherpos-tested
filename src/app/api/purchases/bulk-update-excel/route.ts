import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
// Shared Excel utilities (fixes: inconsistent sanitizeNumber, code duplication, date parsing)
import {
  sanitizeNumber,
  normalizeHeader,
  findColumn,
  parseExcelDate,
} from '@/lib/excel-utils'

export const maxDuration = 60

const MAX_ROWS = 500

/**
 * POST /api/purchases/bulk-update-excel
 * Bulk update purchase order items from uploaded Excel (Pro & Enterprise only).
 * Only allows updating: Tanggal Expired (per item).
 * 
 * Fix Bug #5: Now supports matching by:
 * - NO PO + Nama Item (original, but warns if duplicates exist)
 * - NO PO + Row Number (recommended for POs with duplicate items)
 */
export async function POST(request: NextRequest) {
  // Result containers
  const result = {
    updated: 0,
    notFound: 0,
    warnings: [] as string[],
    errors: [] as string[],
  }

  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId
    const userId = user.id

    // Plan gate
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) return safeJsonError('Outlet not found', 404)
    if (!outletPlan.features.bulkUpload) {
      return safeJsonError('Fitur edit pembelian via Excel hanya tersedia untuk akun Pro ke atas. Upgrade sekarang!', 403)
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return safeJsonError('File tidak ditemukan', 400)

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      return safeJsonError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400)
    }
    if (file.size > 5 * 1024 * 1024) {
      return safeJsonError('Ukuran file maksimal 5MB', 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let workbook: XLSX.WorkBook
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch {
      return safeJsonError('File tidak dapat dibaca. Pastikan format Excel valid.', 400)
    }

    // Find the "Detail Item PO" sheet
    const sheetName = workbook.SheetNames.find(
      (s) => normalizeHeader(s).includes('detail item po') || normalizeHeader(s).includes('detail item')
    )
    if (!sheetName) return safeJsonError('Sheet "Detail Item PO" tidak ditemukan dalam file', 400)
    
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    if (rows.length === 0) return safeJsonError('File Excel tidak memiliki data baris', 400)
    if (rows.length > MAX_ROWS) {
      return safeJsonError(`Maksimal ${MAX_ROWS} baris per upload. File Anda memiliki ${rows.length} baris.`, 400)
    }

    // ══════════════════════════════════════════════════════════════════
    // WRAP IN TRANSACTION for atomicity (Fix Bug #1)
    // ══════════════════════════════════════════════════════════════════
    await db.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowNum = i + 2

        // Find the PO number and item name to locate the correct PurchaseOrderItem
        const poNumber = String(findColumn(row, ['NO PO', 'No PO', 'No. PO', 'no po', 'po number', 'PO Number', 'orderNumber']) || '').trim()
        const itemName = String(findColumn(row, ['NAMA ITEM', 'Nama Item', 'nama item', 'Item', 'item', 'name']) || '').trim()
        
        // Optional: Row sequence number for disambiguation (Fix Bug #5)
        const rowSequence = sanitizeNumber(findColumn(row, ['NO', 'No', 'No.', 'ROW', 'Row', 'BARIS', 'Baris']))

        if (!poNumber) {
          result.errors.push(`Baris ${rowNum}: No. PO wajib diisi`)
          continue
        }
        if (!itemName) {
          result.errors.push(`Baris ${rowNum}: Nama Item wajib diisi`)
          continue
        }

        // Find the PurchaseOrder by orderNumber using transaction client
        const purchaseOrder = await tx.purchaseOrder.findFirst({
          where: { orderNumber: poNumber, outletId },
        })
        if (!purchaseOrder) {
          result.errors.push(`Baris ${rowNum}: PO "${poNumber}" tidak ditemukan`)
          result.notFound++
          continue
        }

        // Find ALL matching items (Fix Bug #5: Handle duplicate names properly)
        const matchingItems = await tx.purchaseOrderItem.findMany({
          where: {
            purchaseOrderId: purchaseOrder.id,
            name: itemName,
            outletId,
          },
          orderBy: { createdAt: 'asc' }, // Consistent ordering
        })

        if (matchingItems.length === 0) {
          result.errors.push(`Baris ${rowNum}: Item "${itemName}" tidak ditemukan di PO "${poNumber}"`)
          result.notFound++
          continue
        }

        // If multiple items with same name, use row sequence to pick the right one
        let targetItem: typeof matchingItems[0]
        if (matchingItems.length > 1) {
          if (rowSequence > 0 && rowSequence <= matchingItems.length) {
            // User provided row/sequence number — use it to pick the right item
            targetItem = matchingItems[rowSequence - 1] // 1-indexed
            result.warnings.push(`Baris ${rowNum}: Item "${itemName}" di PO "${poNumber}" ada ${matchingItems.length} duplikat. Menggunakan urutan ke-${rowSequence}`)
          } else {
            // No sequence number — warn and use first match
            targetItem = matchingItems[0]
            result.warnings.push(`Baris ${rowNum}: Item "${itemName}" di PO "${poNumber}" ada ${matchingItems.length} duplikat. Menggunakan yang pertama. Tambahkan kolom "NO" untuk memilih yang tepat.`)
          }
        } else {
          targetItem = matchingItems[0]
        }

        // Parse Tanggal Expired using shared utility (Fix Bug #9: Consistent date parsing)
        const expiredDateRaw = findColumn(row, ['TANGGAL EXPIRED', 'Tanggal Expired', 'tanggal expired', 'expired date', 'Expired Date', 'expired'])
        const expiredDateStr = parseExcelDate(expiredDateRaw)

        const updateData: Record<string, unknown> = {}
        const changes: Record<string, { from: string | null; to: string | null }> = {}

        if (expiredDateStr) {
          const prev = targetItem.expiredDate ? new Date(targetItem.expiredDate).toISOString().split('T')[0] : null
          if (prev !== expiredDateStr) {
            updateData.expiredDate = new Date(expiredDateStr)
            changes.expiredDate = { from: prev, to: expiredDateStr }
          }
        }

        if (Object.keys(updateData).length === 0) continue

        await tx.purchaseOrderItem.update({
          where: { id: targetItem.id },
          data: updateData,
        })

        await safeAuditLog({
          action: 'BULK_UPDATE',
          entityType: 'PURCHASE_ORDER_ITEM',
          entityId: targetItem.id,
          details: JSON.stringify({
            bulkUpdateExcel: true,
            poNumber,
            itemName,
            changes,
            fileName: file.name,
          }),
          outletId,
          userId,
        })

        result.updated++
      }
    }) // End of transaction

    // Audit log summary (Fix Bug #14)
    if (result.updated > 0 || result.notFound > 0) {
      await safeAuditLog({
        action: 'BULK_UPDATE',
        entityType: 'PURCHASE_ORDER_ITEM',
        details: JSON.stringify({
          bulkUpdateExcel: true,
          updated: result.updated,
          notFound: result.notFound,
          warnings: result.warnings.length,
          errors: result.errors.length,
          fileName: file.name,
        }),
        outletId,
        userId,
      })
    }

    return safeJson({ ...result })
  } catch (error) {
    console.error('Purchase bulk update excel error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses file update', details: message }, 500)
  }
}
