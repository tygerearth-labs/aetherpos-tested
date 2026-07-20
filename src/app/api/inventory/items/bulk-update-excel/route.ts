import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
// Shared Excel utilities
import {
  sanitizeNumber,
  normalizeHeader,
  findColumn,
  isNonEmpty,
  validateUnit,
} from '@/lib/excel-utils'

export const maxDuration = 60

const GLOBAL_MAX_ROWS = 500       // Absolute maximum (safety net)
const DEFAULT_CHUNK_SIZE = 100    // Items per transaction chunk

// Plan-based limits
const PLAN_LIMITS: Record<string, number> = {
  free: 0,     // Blocked by bulkUpload flag anyway
  pro: 200,    // Pro plan limit
  enterprise: 500, // Enterprise limit
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * FIELD EDITABILITY MATRIX
 * ═══════════════════════════════════════════════════════════════════
 * 
 * ✅ EDITABLE (safe to change via Excel):
 *    - Nama Item        → Just a label change
 *    - SKU              → Just a code change  
 *    - Satuan Dasar     → Unit label (note: existing batches use original unit)
 *    - Low Stock Alert  → Threshold configuration
 *    - Status           → ACTIVE / ARCHIVED toggle
 *    - Kategori         → Category assignment
 * 
 * ⚠️  READ-ONLY (displayed in export but CANNOT edit via Excel):
 *    - Stok             → DENORMALIZED: calculated from batch remainingQty
 *                         Direct edit would desync with batches!
 *    - HPP Rata-rata   → CALCULATED: weighted average from purchase prices
 *                         Direct edit would be overwritten on next purchase!
 * 
 * To adjust stock properly, use:
 *    - Stock Opname (inventory count)
 *    - Purchase Order (receive goods)
 *    - Manual Adjustment (creates audit trail)
 * ═══════════════════════════════════════════════════════════════════
 */

// Fields that CAN be edited via Excel
const EDITABLE_FIELDS = ['name', 'sku', 'baseUnit', 'lowStockAlert', 'status', 'categoryId']

// Read-only info fields (shown in export but changes ignored with warning)
const READ_ONLY_FIELDS = ['stock', 'avgCost']

/**
 * POST /api/inventory/items/bulk-update-excel
 * Bulk update inventory items from uploaded Excel (Pro & Enterprise only).
 * 
 * HIGHLY OPTIMIZED VERSION with CORRECT field handling:
 * - Only editable fields are processed
 * - Read-only fields (Stok, HPP) show warnings but don't block
 * - Parallel pre-load of items and categories
 * - BULK UPDATE via Promise.all (not sequential)
 * - SINGLE audit log summary
 */
export async function POST(request: NextRequest) {
  // Result containers
  const result = {
    updated: 0,
    notFound: 0,
    errors: [] as string[],
    warnings: [] as string[],
    skippedReadOnly: [] as string[], // Track read-only field edits that were skipped
  }

  // Track all changes for single audit log
  const allChanges: Array<{ itemId: string; name: string; changes: Record<string, { from: number | string | null; to: number | string }> }> = []

  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    // CREW-010 FIX: Only OWNER can bulk-update inventory items via Excel (mass-modifies item state)
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya OWNER yang dapat melakukan aksi ini', 403)
    }
    const outletId = user.outletId
    const userId = user.id

    // Plan gate with tier-based limits
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) return safeJsonError('Outlet not found', 404)
    
    if (!outletPlan.features.bulkUpload) {
      return safeJsonError('Fitur edit inventory via Excel hanya tersedia untuk akun Pro ke atas. Upgrade sekarang!', 403)
    }
    
    // Determine max rows for this plan
    const planMaxRows = outletPlan.features.maxBulkUploadRows > 0 
      ? outletPlan.features.maxBulkUploadRows 
      : PLAN_LIMITS[outletPlan.accountType] || 200
    const effectiveMaxRows = Math.min(planMaxRows, GLOBAL_MAX_ROWS)

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
    
    // Plan-based row limit check
    if (rows.length > effectiveMaxRows) {
      const planName = outletPlan.accountType === 'pro' ? 'Pro' : outletPlan.accountType === 'enterprise' ? 'Enterprise' : 'Anda'
      return safeJsonError(
        `Batas upload untuk plan ${planName}: ${effectiveMaxRows} baris per file. ` +
        `File Anda memiliki ${rows.length} baris. ` +
        (outletPlan.accountType === 'pro' ? 'Upgrade ke Enterprise untuk batas 500 baris.' : ''),
        400
      )
    }

    const startTime = Date.now()

    console.log(`[Inventory Bulk Update] Starting: file="${file.name}" (${(file.size / 1024).toFixed(1)}KB), rows=${rows.length}`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 1: PARALLEL PRE-LOAD
    // ══════════════════════════════════════════════════════════════════
    
    const [existingItems, existingCategories] = await Promise.all([
      db.inventoryItem.findMany({
        where: { outletId },
        select: { 
          id: true, name: true, sku: true, baseUnit: true, stock: true, 
          avgCost: true, lowStockAlert: true, status: true, categoryId: true,
        },
      }),
      db.inventoryCategory.findMany({
        where: { outletId },
        select: { id: true, name: true },
      }),
    ])

    // Build O(1) lookup maps
    const itemMap = new Map<string, typeof existingItems[number]>()
    const categoryCache = new Map<string, string>()
    
    for (const item of existingItems) itemMap.set(item.id, item)
    for (const cat of existingCategories) categoryCache.set(cat.name.toLowerCase(), cat.id)

    console.log(`[Inventory Bulk Update] Pre-loaded ${existingItems.length} items, ${existingCategories.length} categories in ${Date.now() - startTime}ms`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 2: COLLECT & VALIDATE IN MEMORY
    // ══════════════════════════════════════════════════════════════════

    interface ItemToUpdate {
      itemId: string
      rowNum: number
      updateData: Record<string, unknown>
      changes: Record<string, { from: number | string | null; to: number | string }>
      existingName: string
    }

    const itemsToUpdate: ItemToUpdate[] = []
    const newCategoriesToCreate: Array<{ name: string; outletId: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2

      const itemId = String(findColumn(row, ['ID*', 'ID', 'id', 'Id']) || '').trim()
      
      if (!itemId) {
        result.errors.push(`Baris ${rowNum}: ID item wajib diisi`)
        continue
      }

      const existing = itemMap.get(itemId)
      if (!existing) {
        result.errors.push(`Baris ${rowNum}: Item dengan ID "${itemId}" tidak ditemukan`)
        result.notFound++
        continue
      }

      const updateData: Record<string, unknown> = {}
      const changes: Record<string, { from: number | string | null; to: number | string }> = {}

      // ── ✅ EDITABLE: Name ──
      const name = String(findColumn(row, ['NAMA ITEM*', 'NAMA ITEM', 'Nama Item', 'Nama', 'NAME', 'name']) || '').trim()
      if (isNonEmpty(name) && name !== existing.name) {
        updateData.name = name
        changes.name = { from: existing.name, to: name }
      }

      // ── ✅ EDITABLE: SKU ──
      const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim()
      if (isNonEmpty(sku)) {
        updateData.sku = sku || null
        if (sku !== (existing.sku || '')) changes.sku = { from: existing.sku || '', to: sku }
      }

      // ── ✅ EDITABLE: Base Unit ──
      const baseUnit = String(findColumn(row, ['SATUAN DASAR', 'Satuan Dasar', 'SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Base Unit']) || '').trim().toLowerCase()
      if (isNonEmpty(baseUnit)) {
        const validatedUnit = validateUnit(baseUnit)
        updateData.baseUnit = validatedUnit
        if (validatedUnit !== existing.baseUnit) changes.baseUnit = { from: existing.baseUnit, to: validatedUnit }
      }

      // ── ⚠️ READ-ONLY: Stock (show warning, skip update) ──
      const stockValue = findColumn(row, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty'])
      if (isNonEmpty(stockValue)) {
        const stock = sanitizeNumber(stockValue)
        if (stock !== existing.stock) {
          result.warnings.push(
            `Baris ${rowNum} (${existing.name}): Stok diabaikan. Stok adalah nilai otomatis dari batch. ` +
            `Gunakan "Stok Opname" atau "Penyesuaian Stok" untuk mengubah stok.`
          )
          result.skippedReadOnly.push(`${existing.name}:Stok`)
        }
        // Do NOT add to updateData - stock is read-only!
      }

      // ── ⚠️ READ-ONLY: Avg Cost (show warning, skip update) ──
      const avgCostValue = findColumn(row, ['HPP RATA-RATA (RP)', 'HPP RATA-RATA', 'HPP', 'Avg Cost', 'hpp', 'avgCost', 'Harga Pokok', 'Modal'])
      if (isNonEmpty(avgCostValue)) {
        const avgCost = sanitizeNumber(avgCostValue)
        if (avgCost !== existing.avgCost) {
          result.warnings.push(
            `Baris ${rowNum} (${existing.name}): HPP diabaikan. HPP rata-rata dihitung otomatis dari pembelian. ` +
            `Nilai akan berubah saat ada pembelian baru.`
          )
          result.skippedReadOnly.push(`${existing.name}:HPP`)
        }
        // Do NOT add to updateData - avgCost is read-only!
      }

      // ── ✅ EDITABLE: Low Stock Alert ──
      const lowStockAlert = sanitizeNumber(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'Alert Stok']))
      if (isNonEmpty(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'Alert Stok']))) {
        if (lowStockAlert < 0) {
          result.errors.push(`Baris ${rowNum}: Low Stock Alert tidak boleh negatif (Item: ${existing.name})`)
          continue
        }
        updateData.lowStockAlert = lowStockAlert
        if (lowStockAlert !== existing.lowStockAlert) changes.lowStockAlert = { from: existing.lowStockAlert, to: lowStockAlert }
      }

      // ── ✅ EDITABLE: Status ──
      const status = String(findColumn(row, ['STATUS', 'Status', 'status']) || '').trim().toUpperCase()
      if (isNonEmpty(status) && ['ACTIVE', 'ARCHIVED'].includes(status)) {
        updateData.status = status
        if (status !== existing.status) changes.status = { from: existing.status, to: status }
      }

      // ── ✅ EDITABLE: Category ──
      const categoryRaw = String(findColumn(row, ['KATEGORI INVENTORY', 'KATEGORI', 'Kategori', 'kategori', 'Category', 'category']) || '').trim()
      if (isNonEmpty(categoryRaw)) {
        const catKey = categoryRaw.toLowerCase()
        
        if (categoryCache.has(catKey)) {
          const categoryId = categoryCache.get(catKey)!
          updateData.categoryId = categoryId
          if (categoryId !== existing.categoryId) {
            changes.categoryId = { from: existing.categoryId || '', to: categoryId }
          }
        } else {
          newCategoriesToCreate.push({ name: categoryRaw, outletId })
          updateData.categoryId = `new-${catKey}`
          changes.categoryId = { from: existing.categoryId || '', to: `[NEW] ${categoryRaw}` }
        }
      }

      // Only add if there are actual changes to editable fields
      if (Object.keys(updateData).length > 0) {
        itemsToUpdate.push({ itemId, rowNum, updateData, changes, existingName: existing.name })
      }
    }

    console.log(`[Inventory Bulk Update] Validation done in ${Date.now() - startTime}ms: ${itemsToUpdate.length} items to update, ${result.warnings.length} read-only warnings`)

    if (itemsToUpdate.length === 0 && result.errors.length === 0 && result.warnings.length === 0) {
      return safeJson({ ...result, message: 'Tidak ada perubahan yang dilakukan - semua data sudah sama' })
    }

    // If only read-only fields were changed, return early with warnings
    if (itemsToUpdate.length === 0 && result.warnings.length > 0) {
      return safeJson({ 
        ...result, 
        updated: 0,
        message: 'Tidak ada perubahan yang disimpan. Kolom Stok dan HPP bersifat read-only (lihat warning).',
      })
    }

    // ══════════════════════════════════════════════════════════════════
    // PHASE 3: OPTIMIZED BULK UPDATE
    // ══════════════════════════════════════════════════════════════════

    // Step 1: Create new categories (single transaction)
    if (newCategoriesToCreate.length > 0) {
      const uniqueCategories = [...new Map(newCategoriesToCreate.map(c => [c.name.toLowerCase(), c])).values()]
      
      await db.$transaction(async (tx) => {
        for (const cat of uniqueCategories) {
          const catKey = cat.name.toLowerCase()
          if (categoryCache.has(catKey)) continue
          
          const newCat = await tx.inventoryCategory.create({
            data: { name: cat.name, outletId, color: 'zinc' },
          })
          categoryCache.set(catKey, newCat.id)
        }
      })

      // Resolve temporary category IDs
      for (const item of itemsToUpdate) {
        if (typeof item.updateData.categoryId === 'string' && item.updateData.categoryId.startsWith('new-')) {
          const catKey = item.updateData.categoryId.replace('new-', '')
          const realCatId = categoryCache.get(catKey)
          if (realCatId) {
            item.updateData.categoryId = realCatId
          } else {
            delete item.updateData.categoryId
          }
        }
      }
    }

    // Step 2: Bulk update items by chunk
    const chunkSize = Math.min(DEFAULT_CHUNK_SIZE, effectiveMaxRows)
    const chunks: ItemToUpdate[][] = []
    for (let i = 0; i < itemsToUpdate.length; i += chunkSize) {
      chunks.push(itemsToUpdate.slice(i, i + chunkSize))
    }

    console.log(`[Inventory Bulk Update] Processing ${chunks.length} chunks (chunkSize=${chunkSize}, plan=${outletPlan.accountType}, maxRows=${effectiveMaxRows})...`)

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]
      
      await db.$transaction(async (tx) => {
        // Use Promise.all for parallel updates within chunk
        await Promise.all(
          chunk.map(item =>
            tx.inventoryItem.update({
              where: { id: item.itemId },
              data: item.updateData,
            })
          )
        )

        // Count updated and track changes for audit log
        for (const item of chunk) {
          result.updated++
          allChanges.push({
            itemId: item.itemId,
            name: item.existingName,
            changes: item.changes,
          })
        }
      }, {
        timeout: 45000
      })

      console.log(`[Inventory Bulk Update] Chunk ${chunkIndex + 1}/${chunks.length} done (${chunk.length} items)`)
    }

    const totalTime = Date.now() - startTime
    
    console.log(`[Inventory Bulk Update] ✅ Done in ${totalTime}ms:`, {
      file: file.name,
      totalRows: rows.length,
      updated: result.updated,
      notFound: result.notFound,
      errors: result.errors.length,
      warnings: result.warnings.length,
      skippedReadOnly: result.skippedReadOnly.length,
      chunksProcessed: chunks.length,
    })

    // Single audit log for entire operation
    await safeAuditLog({
      action: result.updated > 0 ? 'BULK_UPDATE' : 'UPDATE_ATTEMPT',
      entityType: 'INVENTORY_ITEM',
      details: JSON.stringify({
        bulkUpdateExcel: true,
        fileName: file.name,
        totalRows: rows.length,
        updated: result.updated,
        notFound: result.notFound,
        errors: result.errors.length,
        warnings: result.warnings.length,
        skippedReadOnly: result.skippedReadOnly.length,
        processingTimeMs: totalTime,
        success: result.updated > 0,
        sampleChanges: allChanges.slice(0, 10).map(c => ({
          id: c.itemId,
          name: c.name,
          fields: Object.keys(c.changes),
        })),
      }),
      outletId,
      userId,
    })

    // Build response message
    let message = ''
    if (result.updated > 0) {
      message = `${result.updated} item berhasil diupdate`
      if (result.warnings.length > 0) {
        message += `, ${result.warnings.length} kolom read-only diabaikan`
      }
    } else {
      message = 'Tidak ada item yang berhasil diupdate'
    }

    return safeJson({ 
      ...result, 
      message,
      processingTimeMs: totalTime,
    })
  } catch (error) {
    const totalTime = Date.now() - (typeof startTime !== 'undefined' ? startTime : Date.now())
    
    console.error('[Inventory Bulk Update] ❌ Error:', {
      error: error instanceof Error ? error.message : error,
      totalTimeMs: totalTime,
    })

    const message = error instanceof Error ? error.message : 'Unknown error'
    
    if (message.includes('timeout') || message.includes('Timeout')) {
      return safeJsonError('Proses terlalu lama. Coba dengan file lebih kecil (maks 200 baris) atau kurangi jumlah kolom yang diubah.', 408)
    }
    
    if (message.includes('connection') || message.includes('ECONNREFUSED')) {
      return safeJsonError('Koneksi database terputus. Silakan coba lagi.', 503)
    }

    return safeJsonError({ error: 'Gagal memproses file update', details: message }, 500)
  }
}
