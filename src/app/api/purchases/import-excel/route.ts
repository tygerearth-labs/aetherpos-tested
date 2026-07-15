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
 * OPTIMIZED with:
 * - Parallel pre-load of inventory items & suppliers
 * - O(1) lookup maps for name/SKU matching
 * - Comprehensive logging for debugging
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  // Result containers for logging
  let parseStats = {
    totalRows: 0,
    matchedItems: 0,
    newItems: 0,
    errorRows: 0,
    fileParsed: false,
  }

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

    console.log(`[Purchase Import] Starting: file="${file.name}" (${(file.size / 1024).toFixed(1)}KB)`)

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

    parseStats.totalRows = rows.length
    parseStats.fileParsed = true
    
    const preLoadStart = Date.now()

    // ══════════════════════════════════════════════════════════════════
    // OPTIMIZATION #1: PARALLEL PRE-LOAD
    // Load all reference data in parallel for faster processing
    // ══════════════════════════════════════════════════════════════════
    
    const [existingItems] = await Promise.all([
      // Pre-load ALL inventory items for matching
      db.inventoryItem.findMany({
        where: { outletId },
        select: { id: true, name: true, sku: true, baseUnit: true, stock: true, avgCost: true },
      }),
    ])

    // Build O(1) lookup maps (case-insensitive)
    const nameMap = new Map<string, typeof existingItems[number]>()
    const skuMap = new Map<string, typeof existingItems[number]>()
    
    for (const item of existingItems) {
      const nameLower = item.name.toLowerCase()
      if (!nameMap.has(nameLower)) nameMap.set(nameLower, item)
      if (item.sku) skuMap.set(item.sku.toLowerCase(), item)
    }

    // ══════════════════════════════════════════════════════════════════
    // OPTIMIZATION #2: PRE-LOAD EXISTING BATCHES FOR DUPLICATE CHECK
    // Prevent duplicate batchNumber errors during PO creation
    // ══════════════════════════════════════════════════════════════════
    
    const existingBatches = await db.inventoryBatch.findMany({
      where: { outletId },
      select: { batchNumber: true, inventoryItemId: true, expiredDate: true },
    })
    
    const batchSet = new Set<string>() // For DB duplicate check
    for (const b of existingBatches) {
      batchSet.add(b.batchNumber.toLowerCase())
    }
    
    // For INTRA-FILE duplicate tracking (batch seen within this upload)
    const seenBatchesInFile = new Map<string, number>() // batchLower → first row number

    console.log(`[Purchase Import] Pre-loaded ${existingItems.length} items + ${existingBatches.length} batches in ${Date.now() - preLoadStart}ms`)

    // Parse rows with validation (Safety Net preserved)
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
      isExpired?: boolean  // NEW: Track if already expired
      isDuplicateBatch?: boolean  // NEW: Track if batch exists in DB
      error?: string
      warning?: string  // NEW: Warnings (non-blocking)
    }> = []
    
    // Stats tracking
    let itemsWithBatch = 0
    let itemsWithExpiry = 0
    let expiredItemsCount = 0
    let duplicateBatchCount = 0
    let intraFileDuplicateCount = 0

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

      // Parse expired date using shared utility
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

      // ── SAFETY NET: Validation ──
      const errors: string[] = []
      const warnings: string[] = []  // Non-blocking warnings
      if (!name) errors.push('Nama barang wajib diisi')
      
      // Block negative quantity
      if (qty <= 0) errors.push('Jumlah harus lebih dari 0')
      
      // Block negative price
      if (pricePerUnit < 0) errors.push('Harga tidak boleh negatif')

      // ══════════════════════════════════════════════════════════════════
      // BATCH & EXPIRED DATE SAFETY NETS
      // ══════════════════════════════════════════════════════════════════

      let isExpired = false
      let isDuplicateBatch = false

      // ── Batch validation ──
      if (batch) {
        itemsWithBatch++
        
        const batchLower = batch.toLowerCase()
        
        // Check 1: INTRA-FILE duplicate (same batch appears multiple times in THIS file)
        if (seenBatchesInFile.has(batchLower)) {
          const firstSeenRow = seenBatchesInFile.get(batchLower)!
          isDuplicateBatch = true
          intraFileDuplicateCount++
          warnings.push(`Batch "${batch}" duplikat dalam file ini (pertama di baris ${firstSeenRow})`)
        } else {
          // First time seeing this batch in file - track it
          seenBatchesInFile.set(batchLower, rowNum)
        }
        
        // Check 2: DB duplicate (batch already exists in database)
        if (batchSet.has(batchLower)) {
          isDuplicateBatch = true
          duplicateBatchCount++
          warnings.push(`Batch "${batch}" sudah ada di database`)
        }
      }

      // ── Expired date validation (WARNING only, not blocking) ──
      if (expiredDate) {
        itemsWithExpiry++
        const expDate = new Date(expiredDate)
        const today = new Date()
        today.setHours(0, 0, 0, 0) // Start of today
        
        if (expDate < today) {
          isExpired = true
          expiredItemsCount++
          warnings.push(`Tanggal kadaluarsa (${expiredDate}) sudah lewat`)
        }
      }

      // Try to match to existing inventory item (case-insensitive) - O(1) lookup
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
          isExpired,
          isDuplicateBatch,
          error: errors.join('; '),
          warning: warnings.length > 0 ? warnings.join('; ') : undefined,
        })
        parseStats.errorRows++
        continue
      }

      // Track stats
      if (isNew) {
        parseStats.newItems++
      } else {
        parseStats.matchedItems++
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
        isExpired,
        isDuplicateBatch,
        warning: warnings.length > 0 ? warnings.join('; ') : undefined,
      })
    }

    const totalTime = Date.now() - startTime
    
    // ══════════════════════════════════════════════════════════════════
    // COMPREHENSIVE LOGGING
    // Log summary stats for monitoring and debugging
    // ══════════════════════════════════════════════════════════════════
    
    console.log(`[Purchase Import] Done in ${totalTime}ms:`, {
      file: file.name,
      totalRows: parseStats.totalRows,
      matched: parseStats.matchedItems,
      newItems: parseStats.newItems,
      errors: parseStats.errorRows,
      existingDbItems: existingItems.length,
      existingBatches: existingBatches.length,
      // Batch & Expiry stats
      _batchExpiry: {
        itemsWithBatch,
        itemsWithExpiry,
        expiredItems: expiredItemsCount,
        duplicateBatches: duplicateBatchCount,
        intraFileDuplicates: intraFileDuplicateCount,  // NEW
      },
    })

    return safeJson({
      fileName: file.name,
      totalRows: rows.length,
      headers: Object.keys(rows[0]),
      items: parsedItems,
      existingItemCount: existingItems.length,
      // Stats for frontend display
      _stats: {
        matchedItems: parseStats.matchedItems,
        newItems: parseStats.newItems,
        errorRows: parseStats.errorRows,
        processingTimeMs: totalTime,
        // NEW: Batch & Expiry summary for frontend
        batchSummary: {
          itemsWithBatch,
          itemsWithExpiry,
          expiredItems: expiredItemsCount,
          duplicateBatches: duplicateBatchCount,
          intraFileDuplicates: intraFileDuplicateCount,  // NEW
          hasWarnings: expiredItemsCount > 0 || duplicateBatchCount > 0 || intraFileDuplicateCount > 0,
        },
      },
    })
  } catch (error) {
    console.error('[Purchase Import] Error:', {
      error: error instanceof Error ? error.message : error,
      fileParseStats: parseStats,
      totalTimeMs: Date.now() - startTime,
    })
    return safeJsonError('Gagal memproses file import')
  }
}
