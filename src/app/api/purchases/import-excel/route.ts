import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
// Shared Excel utilities (fixes: inconsistent sanitizeNumber, code duplication, date parsing)
import {
  sanitizeNumber,
  normalizeHeader,
  findColumn,
  parseExcelDate,
} from '@/lib/excel-utils'

export const maxDuration = 30
const MAX_ROWS = 200

/**
 * POST /api/purchases/import-excel
 *
 * Parses an Excel/CSV file and returns preview data (does NOT create the purchase).
 * The frontend maps items to inventory IDs and sends a normal POST /api/purchases.
 *
 * Expected columns (flexible matching):
 *   - Nama Barang / Item / Barang / Nama
 *   - SKU / Kode
 *   - Satuan Beli / Unit / Satuan
 *   - Jumlah / Qty / Quantity
 *   - Isi per Satuan / Isi / Konversi / Base Qty
 *   - Satuan Dasar / Base Unit / Unit Dasar
 *   - Harga / Price / Total / Harga Satuan
 *   - Batch / No Batch / No Lot / Lot Number
 *   - Expired / Exp Date / Tanggal Expired / Tgl Kadaluarsa / Kadaluarsa
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    // Check plan: bulkUpload required for Excel import
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) return safeJsonError('Outlet not found', 404)
    if (!outletPlan.features.bulkUpload) {
      return safeJsonError('Fitur import pembelian via Excel hanya tersedia untuk akun Pro ke atas. Upgrade sekarang!', 403)
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

    if (rows.length === 0) return safeJsonError('File tidak memiliki data', 400)
    if (rows.length > MAX_ROWS) {
      return safeJsonError(`Maksimal ${MAX_ROWS} baris. File memiliki ${rows.length} baris.`, 400)
    }

    console.log(`[Purchase Import] Headers: ${Object.keys(rows[0]).join(', ')}`)

    // Load existing inventory items for auto-matching
    const existingItems = await db.inventoryItem.findMany({
      where: { outletId },
      select: { id: true, name: true, sku: true, baseUnit: true, stock: true, avgCost: true },
    })

    // Build lookup maps (case-insensitive)
    const nameMap = new Map<string, typeof existingItems[number]>()
    const skuMap = new Map<string, typeof existingItems[number]>()
    for (const item of existingItems) {
      const nameLower = item.name.toLowerCase()
      if (!nameMap.has(nameLower)) nameMap.set(nameLower, item)
      if (item.sku) skuMap.set(item.sku.toLowerCase(), item)
    }

    // Parse rows
    const parsedItems: Array<{
      row: number
      name: string
      sku: string | null
      purchaseUnit: string
      qty: number
      baseQty: number
      baseUnit: string
      pricePerUnit: number
      batch: string | null
      expiredDate: string | null
      matchedItemId: string | null
      matchedItemName: string | null
      matchedItemSku: string | null
      matchedItemUnit: string | null
      isNew: boolean
      error?: string
    }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2

      // Extract fields with flexible column matching
      const name = String(findColumn(row, [
        'NAMA BARANG', 'Nama Barang', 'NAMA ITEM', 'Nama Item',
        'BARANG', 'ITEM', 'Nama', 'NAME', 'name',
        'Product Name', 'Produk', 'Deskripsi',
      ]) || '').trim()

      const sku = String(findColumn(row, [
        'SKU', 'sku', 'Kode', 'kode', 'KODE SKU', 'Kode Barang', 'Barcode',
      ]) || '').trim() || null

      const purchaseUnit = String(findColumn(row, [
        'SATUAN BELI', 'Satuan Beli', 'SATUAN', 'Satuan', 'satuan',
        'Unit', 'unit', 'UOM', 'Sat',
      ]) || '').trim()

      const qty = sanitizeNumber(findColumn(row, [
        'JUMLAH', 'Jumlah', 'QTY', 'Qty', 'qty', 'Quantity', 'quantity',
        'QTY BELI', 'Qty Beli', 'Banyak', 'Total Qty',
      ]))

      let baseQty = sanitizeNumber(findColumn(row, [
        'ISI PER SATUAN', 'Isi per Satuan', 'ISI', 'Isi', 'isi',
        'Konversi', 'konversi', 'KONVERSI', 'Base Qty', 'Isi Satuan',
        'Isi per Unit', 'Qty per Unit', 'Berat Bersih',
      ]))

      let baseUnit = String(findColumn(row, [
        'SATUAN DASAR', 'Satuan Dasar', 'Base Unit', 'base unit',
        'UNIT DASAR', 'Unit Dasar', 'Sat Dasar',
        'KG', 'kg', 'GR', 'gr', 'ML', 'ml', 'PCS', 'pcs',
        'LITER', 'liter', 'METER', 'LUSIN', 'EKOR',
      ]) || '').trim()

      let pricePerUnit = sanitizeNumber(findColumn(row, [
        'HARGA', 'Harga', 'harga', 'PRICE', 'price',
        'HARGA BELI', 'Harga Beli', 'HARGA SATUAN', 'Harga Satuan',
        'Harga per Unit', 'Price per Unit', 'Unit Price',
        'TOTAL', 'Total', 'TOTAL HARGA', 'Total Harga', 'Subtotal', 'subtotal',
        'NOMINAL', 'Nominal', 'BIAYA', 'Biaya',
      ]))

      // Parse batch / lot number (optional)
      const batchRaw = findColumn(row, [
        'BATCH', 'Batch', 'batch', 'NO BATCH', 'No Batch',
        'NO LOT', 'No Lot', 'LOT', 'Lot', 'LOT NUMBER', 'Lot Number',
        'NO LOT NUMBER', 'No Lot Number', 'BATCH NUMBER', 'Batch Number',
        'NOMOR BATCH', 'Nomor Batch', 'NOMOR LOT', 'Nomor Lot',
      ])
      const batch = batchRaw ? String(batchRaw).trim() || null : null

      // Parse expired date using shared utility (Fix Bug #9: Consistent date parsing)
      const expiredRaw = findColumn(row, [
        'EXPIRED', 'Expired', 'expired', 'EXP DATE', 'Exp Date',
        'EXPIRY DATE', 'Expiry Date', 'EXPIRY', 'Expiry',
        'TANGGAL EXPIRED', 'Tanggal Expired', 'TGL KADALUARSA', 'Tgl Kadaluarsa',
        'KADALUARSA', 'Kadaluarsa', 'TGL EXPIRED', 'Tgl Expired',
        'TANGGAL KADALUARSA', 'EXP', 'Exp', 'BEST BEFORE', 'USE BY',
        'TANGGAL EXPIRY', 'Tanggal Expiry',
      ])
      const expiredDate = parseExcelDate(expiredRaw)

      // Auto-infer baseQty/baseUnit when not specified (1:1 conversion)
      if (baseQty <= 0 && !baseUnit) {
        baseQty = 1
        baseUnit = purchaseUnit || ''
      } else if (baseQty <= 0 && baseUnit) {
        baseQty = 1
      }

      // Validation
      const errors: string[] = []
      if (!name) errors.push('Nama barang wajib diisi')
      if (qty <= 0) errors.push('Jumlah harus lebih dari 0')
      if (pricePerUnit < 0) errors.push('Harga tidak boleh negatif')

      // Try to match to existing inventory item (case-insensitive)
      let matchedItem: typeof existingItems[number] | null = null
      if (name && !sku) {
        matchedItem = nameMap.get(name.toLowerCase()) || null
      } else if (sku) {
        matchedItem = skuMap.get(sku.toLowerCase()) || null
        if (!matchedItem && name) {
          matchedItem = nameMap.get(name.toLowerCase()) || null
        }
      }

      const isNew = !matchedItem

      // Auto-fill from matched item if available
      const finalBaseUnit = baseUnit || matchedItem?.baseUnit || ''
      const finalPurchaseUnit = purchaseUnit || ''

      if (errors.length > 0) {
        parsedItems.push({
          row: rowNum,
          name: name || '(kosong)',
          sku,
          purchaseUnit: finalPurchaseUnit,
          qty,
          baseQty,
          baseUnit: finalBaseUnit,
          pricePerUnit,
          batch,
          expiredDate,
          matchedItemId: null,
          matchedItemName: null,
          matchedItemSku: null,
          matchedItemUnit: null,
          isNew: false,
          error: errors.join('; '),
        })
        continue
      }

      parsedItems.push({
        row: rowNum,
        name,
        sku,
        purchaseUnit: finalPurchaseUnit,
        qty: qty || 0,
        baseQty: baseQty || 0,
        baseUnit: finalBaseUnit,
        pricePerUnit,
        batch,
        expiredDate,
        matchedItemId: matchedItem?.id || null,
        matchedItemName: matchedItem?.name || null,
        matchedItemSku: matchedItem?.sku || null,
        matchedItemUnit: matchedItem?.baseUnit || null,
        isNew,
      })
    }

    return safeJson({
      fileName: file.name,
      totalRows: rows.length,
      headers: Object.keys(rows[0]),
      items: parsedItems,
      existingItemCount: existingItems.length,
    })
  } catch (error) {
    console.error('[Purchase Import] Error:', error)
    return safeJsonError('Gagal memproses file import')
  }
}
