import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

export const maxDuration = 60

const MAX_ROWS = 500

function sanitizeNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (val === null || val === undefined) return 0
  const str = String(val).trim()
  if (!str) return 0
  let cleaned = str.replace(/[Rp\s$€¥£.,\-]/g, (match) => {
    if (match === '.' || match === ',') return match
    return ''
  }).trim()
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  if (lastDot > -1 && lastComma > -1) {
    if (lastDot > lastComma) cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    else cleaned = cleaned.replace(/,/g, '')
  } else if (lastDot > -1) {
    const parts = cleaned.split('.')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) cleaned = cleaned.replace(/\./g, '')
  } else if (lastComma > -1) {
    const parts = cleaned.split(',')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) cleaned = cleaned.replace(/,/g, '')
    else cleaned = cleaned.replace(',', '.')
  }
  return isNaN(Number(cleaned)) ? 0 : Number(cleaned)
}

function normalizeHeader(key: string): string {
  return key.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase()
}

function findColumn(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalizedMap = new Map<string, string>()
  for (const key of Object.keys(row)) {
    normalizedMap.set(normalizeHeader(key), key)
  }
  for (const alias of aliases) {
    const norm = normalizeHeader(alias)
    if (normalizedMap.has(norm)) return row[normalizedMap.get(norm)!]
    for (const [normKey, actualKey] of normalizedMap) {
      if (normKey.includes(norm) || norm.includes(normKey)) return row[actualKey]
    }
  }
  return undefined
}

/**
 * POST /api/purchases/bulk-update-excel
 * Bulk update purchase order items from uploaded Excel (Pro & Enterprise only).
 * Only allows updating: Tanggal Expired (per item).
 */
export async function POST(request: NextRequest) {
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

    let updated = 0
    let notFound = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2

      // Find the PO number and item name to locate the correct PurchaseOrderItem
      const poNumber = String(findColumn(row, ['NO PO', 'No PO', 'No. PO', 'no po', 'po number', 'PO Number', 'orderNumber']) || '').trim()
      const itemName = String(findColumn(row, ['NAMA ITEM', 'Nama Item', 'nama item', 'Item', 'item', 'name']) || '').trim()

      if (!poNumber) {
        errors.push(`Baris ${rowNum}: No. PO wajib diisi`)
        continue
      }
      if (!itemName) {
        errors.push(`Baris ${rowNum}: Nama Item wajib diisi`)
        continue
      }

      // Find the PurchaseOrder by orderNumber
      const purchaseOrder = await db.purchaseOrder.findFirst({
        where: { orderNumber: poNumber, outletId },
      })
      if (!purchaseOrder) {
        errors.push(`Baris ${rowNum}: PO "${poNumber}" tidak ditemukan`)
        notFound++
        continue
      }

      // Find the PurchaseOrderItem by PO id and item name
      const item = await db.purchaseOrderItem.findFirst({
        where: {
          purchaseOrderId: purchaseOrder.id,
          name: itemName,
          outletId,
        },
      })
      if (!item) {
        errors.push(`Baris ${rowNum}: Item "${itemName}" tidak ditemukan di PO "${poNumber}"`)
        notFound++
        continue
      }

      // Parse Tanggal Expired
      const expiredDateRaw = findColumn(row, ['TANGGAL EXPIRED', 'Tanggal Expired', 'tanggal expired', 'expired date', 'Expired Date', 'expired'])
      let expiredDate: Date | null = null
      if (expiredDateRaw !== undefined && expiredDateRaw !== null && expiredDateRaw !== '') {
        if (typeof expiredDateRaw === 'number') {
          // Excel serial date
          const date = XLSX.SSF.parse_date_code(expiredDateRaw)
          if (date) {
            expiredDate = new Date(date.y, date.m - 1, date.d)
          }
        } else {
          const parsed = new Date(String(expiredDateRaw))
          if (!isNaN(parsed.getTime())) {
            expiredDate = parsed
          }
        }
      }

      const updateData: Record<string, unknown> = {}
      const changes: Record<string, { from: string | null; to: string | null }> = {}

      if (expiredDate) {
        const prev = item.expiredDate ? item.expiredDate.toISOString().split('T')[0] : null
        const next = expiredDate.toISOString().split('T')[0]
        if (prev !== next) {
          updateData.expiredDate = expiredDate
          changes.expiredDate = { from: prev, to: next }
        }
      }

      if (Object.keys(updateData).length === 0) continue

      await db.purchaseOrderItem.update({
        where: { id: item.id },
        data: updateData,
      })

      await safeAuditLog({
        action: 'BULK_UPDATE',
        entityType: 'PURCHASE_ORDER_ITEM',
        entityId: item.id,
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

      updated++
    }

    if (updated > 0) {
      await safeAuditLog({
        action: 'BULK_UPDATE',
        entityType: 'PURCHASE_ORDER_ITEM',
        details: JSON.stringify({
          bulkUpdateExcel: true,
          updated,
          notFound,
          errors: errors.length,
          fileName: file.name,
        }),
        outletId,
        userId,
      })
    }

    return safeJson({ updated, notFound, errors })
  } catch (error) {
    console.error('Purchase bulk update excel error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses file update', details: message }, 500)
  }
}