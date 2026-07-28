import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import {
  safeEmitAuditEvent,
  buildPurchaseChangeEvent,
} from '@/lib/audit-v2'
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
 *
 * Audit V2: emits ONE PURCHASE event PER purchase document (not one big
 * BULK_BATCH). Each PO that had ≥1 item updated gets its own auditable row
 * so the audit feed stays readable when a single Excel batch edits many POs.
 */
export async function POST(request: NextRequest) {
  // Result containers
  const result = {
    updated: 0,
    notFound: 0,
    warnings: [] as string[],
    errors: [] as string[],
  }

  // V2: per-PO change groups. Keyed by purchaseOrderId so we emit exactly
  // one PURCHASE audit event per purchase document touched by this batch.
  const poChangeGroups = new Map<
    string,
    {
      purchaseOrderId: string
      orderNumber: string
      supplierName: string | null
      itemChanges: Array<{
        label: string // disambiguated item identifier for the Changes table
        before: string | null
        after: string | null
      }>
    }
  >()

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

        // Find the PurchaseOrder by orderNumber (include supplier name for the audit event)
        const purchaseOrder = await tx.purchaseOrder.findFirst({
          where: { orderNumber: poNumber, outletId },
          select: {
            id: true,
            orderNumber: true,
            supplier: { select: { name: true } },
          },
        })
        if (!purchaseOrder) {
          result.errors.push(`Baris ${rowNum}: PO "${poNumber}" tidak ditemukan`)
          result.notFound++
          continue
        }

        // Find ALL matching items (Fix Bug #5: Handle duplicate names properly)
        // NOTE: PurchaseOrderItem has no `createdAt` field — order by `id`
        // (cuid is monotonically sortable, preserving insertion order).
        const matchingItems = await tx.purchaseOrderItem.findMany({
          where: {
            purchaseOrderId: purchaseOrder.id,
            name: itemName,
            outletId,
          },
          orderBy: { id: 'asc' }, // cuid sorts in insertion order
        })

        if (matchingItems.length === 0) {
          result.errors.push(`Baris ${rowNum}: Item "${itemName}" tidak ditemukan di PO "${poNumber}"`)
          result.notFound++
          continue
        }

        // If multiple items with same name, use row sequence to pick the right one
        let targetItem: typeof matchingItems[0]
        let disambiguator = ''
        if (matchingItems.length > 1) {
          if (rowSequence > 0 && rowSequence <= matchingItems.length) {
            // User provided row/sequence number — use it to pick the right item
            targetItem = matchingItems[rowSequence - 1] // 1-indexed
            disambiguator = ` #${rowSequence}`
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
        let prevExpired: string | null = null
        let newExpired: string | null = null

        if (expiredDateStr) {
          prevExpired = targetItem.expiredDate ? new Date(targetItem.expiredDate).toISOString().split('T')[0] : null
          if (prevExpired !== expiredDateStr) {
            updateData.expiredDate = new Date(expiredDateStr)
            newExpired = expiredDateStr
          }
        }

        if (Object.keys(updateData).length === 0) continue

        await tx.purchaseOrderItem.update({
          where: { id: targetItem.id },
          data: updateData,
        })

        // V2: group the change under this PO so we emit exactly ONE PURCHASE
        // audit event per purchase document after the tx commits.
        const groupKey = purchaseOrder.id
        let group = poChangeGroups.get(groupKey)
        if (!group) {
          group = {
            purchaseOrderId: purchaseOrder.id,
            orderNumber: purchaseOrder.orderNumber,
            supplierName: purchaseOrder.supplier?.name ?? null,
            itemChanges: [],
          }
          poChangeGroups.set(groupKey, group)
        }
        // Disambiguated label so duplicate item names in the same PO don't
        // overwrite each other in the Changes table.
        group.itemChanges.push({
          label: `${itemName}${disambiguator} (row ${rowNum})`,
          before: prevExpired,
          after: newExpired,
        })

        result.updated++
      }
    }, {
      timeout: 55_000,  // V15.1 FIX: 55s — default 5s too short for 500 rows
      maxWait: 5_000,
    }) // End of transaction

    // V2: emit ONE PURCHASE event PER purchase document touched by this batch.
    // Each PO gets its own auditable row with a Changes table covering every
    // item whose expiredDate changed. This keeps the audit feed readable when
    // a single Excel batch edits many POs (instead of one unreadable BULK_BATCH).
    for (const group of poChangeGroups.values()) {
      // Build flat before/after records keyed by the disambiguated item label
      // so buildPurchaseChangeEvent renders them naturally as field/before/after rows.
      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      for (const ic of group.itemChanges) {
        before[ic.label] = ic.before ?? 'none'
        after[ic.label] = ic.after ?? 'none'
      }
      await safeEmitAuditEvent(
        buildPurchaseChangeEvent({
          purchaseOrderId: group.purchaseOrderId,
          orderNumber: group.orderNumber,
          supplierName: group.supplierName,
          changeType: 'updated',
          before,
          after,
          note: `Bulk Excel edit · ${group.itemChanges.length} item(s) · ${file.name}`,
          outletId,
          userId,
        }),
      )
    }

    return safeJson({ ...result })
  } catch (error) {
    console.error('Purchase bulk update excel error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses file update', details: message }, 500)
  }
}
