import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
// Shared Excel utilities (fixes: inconsistent sanitizeNumber, code duplication, negative number handling)
import {
  sanitizeNumber,
  normalizeHeader,
  findColumn,
  isNonEmpty,
  validateUnit,
} from '@/lib/excel-utils'

export const maxDuration = 60

const MAX_ROWS = 500

/**
 * POST /api/inventory/items/bulk-update-excel
 * Bulk update inventory items from uploaded Excel (Pro & Enterprise only).
 */
export async function POST(request: NextRequest) {
  // Result containers
  const result = {
    updated: 0,
    notFound: 0,
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
      return safeJsonError('Fitur edit inventory via Excel hanya tersedia untuk akun Pro ke atas. Upgrade sekarang!', 403)
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

    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return safeJsonError('File Excel kosong', 400)
    
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
      // Cache inventory categories
      const categoryCache = new Map<string, string | null>()

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowNum = i + 2

        const itemId = String(findColumn(row, ['ID*', 'ID', 'id', 'Id']) || '').trim()
        if (!itemId) {
          result.errors.push(`Baris ${rowNum}: ID item wajib diisi`)
          continue
        }

        const existing = await tx.inventoryItem.findFirst({
          where: { id: itemId, outletId },
        })
        if (!existing) {
          result.errors.push(`Baris ${rowNum}: Item dengan ID "${itemId}" tidak ditemukan`)
          result.notFound++
          continue
        }

        const updateData: Record<string, unknown> = {}
        const changes: Record<string, { from: number | string | null; to: number | string }> = {}

        // Name
        const name = String(findColumn(row, ['NAMA ITEM*', 'NAMA ITEM', 'Nama Item', 'Nama', 'NAME', 'name']) || '').trim()
        if (isNonEmpty(name) && name !== existing.name) {
          updateData.name = name
          changes.name = { from: existing.name, to: name }
        }

        // SKU
        const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim()
        if (isNonEmpty(sku)) {
          updateData.sku = sku || null
          if (sku !== (existing.sku || '')) changes.sku = { from: existing.sku || '', to: sku }
        }

        // Base Unit with validation
        const baseUnit = String(findColumn(row, ['SATUAN DASAR', 'Satuan Dasar', 'SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Base Unit']) || '').trim().toLowerCase()
        if (isNonEmpty(baseUnit)) {
          const validatedUnit = validateUnit(baseUnit)
          updateData.baseUnit = validatedUnit
          if (validatedUnit !== existing.baseUnit) changes.baseUnit = { from: existing.baseUnit, to: validatedUnit }
        }

        // Stock with negative validation (Fix Bug #7)
        const stock = sanitizeNumber(findColumn(row, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty']))
        if (isNonEmpty(findColumn(row, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty']))) {
          if (stock < 0) {
            result.errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Item: ${existing.name}, Stok: ${stock})`)
            continue
          }
          updateData.stock = stock
          if (stock !== existing.stock) changes.stock = { from: existing.stock, to: stock }
        }

        // Avg Cost with negative validation
        const avgCost = sanitizeNumber(findColumn(row, ['HPP RATA-RATA (RP)', 'HPP RATA-RATA', 'HPP', 'Avg Cost', 'hpp', 'avgCost', 'Harga Pokok', 'Modal']))
        if (isNonEmpty(findColumn(row, ['HPP RATA-RATA (RP)', 'HPP RATA-RATA', 'HPP', 'Avg Cost', 'hpp', 'avgCost', 'Harga Pokok', 'Modal']))) {
          if (avgCost < 0) {
            result.errors.push(`Baris ${rowNum}: HPP rata-rata tidak boleh negatif (Item: ${existing.name})`)
            continue
          }
          updateData.avgCost = avgCost
          if (avgCost !== existing.avgCost) changes.avgCost = { from: existing.avgCost, to: avgCost }
        }

        // Low Stock Alert
        const lowStockAlert = sanitizeNumber(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'Alert Stok']))
        if (isNonEmpty(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'Alert Stok']))) {
          if (lowStockAlert < 0) {
            result.errors.push(`Baris ${rowNum}: Low Stock Alert tidak boleh negatif (Item: ${existing.name})`)
            continue
          }
          updateData.lowStockAlert = lowStockAlert
          if (lowStockAlert !== existing.lowStockAlert) changes.lowStockAlert = { from: existing.lowStockAlert, to: lowStockAlert }
        }

        // Status
        const status = String(findColumn(row, ['STATUS', 'Status', 'status']) || '').trim().toUpperCase()
        if (isNonEmpty(status) && ['ACTIVE', 'ARCHIVED'].includes(status)) {
          updateData.status = status
          if (status !== existing.status) changes.status = { from: existing.status, to: status }
        }

        // Category
        const categoryRaw = String(findColumn(row, ['KATEGORI INVENTORY', 'KATEGORI', 'Kategori', 'kategori', 'Category', 'category']) || '').trim()
        if (isNonEmpty(categoryRaw)) {
          let categoryId: string | null = null
          if (categoryCache.has(categoryRaw)) {
            categoryId = categoryCache.get(categoryRaw)!
          } else {
            const existingCat = await tx.inventoryCategory.findFirst({
              where: { name: categoryRaw, outletId },
            })
            if (existingCat) {
              categoryId = existingCat.id
              categoryCache.set(categoryRaw, categoryId)
            } else {
              const newCat = await tx.inventoryCategory.create({
                data: { name: categoryRaw, outletId, color: 'zinc' },
              })
              categoryId = newCat.id
              categoryCache.set(categoryRaw, categoryId)
            }
          }
          updateData.categoryId = categoryId
          if (categoryId !== existing.categoryId) {
            changes.categoryId = { from: existing.categoryId || '', to: categoryId }
          }
        }

        if (Object.keys(updateData).length === 0) continue

        await tx.inventoryItem.update({
          where: { id: itemId },
          data: updateData,
        })

        await safeAuditLog({
          action: 'BULK_UPDATE',
          entityType: 'INVENTORY_ITEM',
          entityId: itemId,
          details: JSON.stringify({
            bulkUpdateExcel: true,
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
    await safeAuditLog({
      action: result.updated > 0 ? 'BULK_UPDATE' : 'UPDATE_ATTEMPT',
      entityType: 'INVENTORY_ITEM',
      details: JSON.stringify({
        bulkUpdateExcel: true,
        updated: result.updated,
        notFound: result.notFound,
        errors: result.errors.length,
        fileName: file.name,
        success: result.updated > 0,
      }),
      outletId,
      userId,
    })

    return safeJson({ ...result })
  } catch (error) {
    console.error('Inventory bulk update excel error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses file update', details: message }, 500)
  }
}
