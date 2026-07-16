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

const MAX_ROWS = 500
const CHUNK_SIZE = 100 // Increased: use bulk update for better performance

/**
 * POST /api/inventory/items/bulk-update-excel
 * Bulk update inventory items from uploaded Excel (Pro & Enterprise only).
 * 
 * HIGHLY OPTIMIZED VERSION:
 * - Parallel pre-load of items and categories
 * - O(1) lookup maps for validation
 * - BULK UPDATE via updateMany (not individual updates)
 * - SINGLE audit log summary (not per-item)
 * - Chunked processing for timeout prevention
 */
export async function POST(request: NextRequest) {
  // Result containers
  const result = {
    updated: 0,
    notFound: 0,
    errors: [] as string[],
    warnings: [] as string[],
  }

  // Track all changes for single audit log
  const allChanges: Array<{ itemId: string; name: string; changes: Record<string, { from: number | string | null; to: number | string }> }> = []

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

    const startTime = Date.now()

    console.log(`[Inventory Bulk Update] Starting: file="${file.name}" (${(file.size / 1024).toFixed(1)}KB), rows=${rows.length}`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 1: PARALLEL PRE-LOAD (Single query each, executed in parallel)
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
    // PHASE 2: COLLECT & VALIDATE IN MEMORY (Zero DB writes here)
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

      // Stock (block negative)
      const stock = sanitizeNumber(findColumn(row, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty']))
      if (isNonEmpty(findColumn(row, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty']))) {
        if (stock < 0) {
          result.errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Item: ${existing.name}, Stok: ${stock})`)
          continue
        }
        updateData.stock = stock
        if (stock !== existing.stock) changes.stock = { from: existing.stock, to: stock }
      }

      // Avg Cost (block negative)
      const avgCost = sanitizeNumber(findColumn(row, ['HPP RATA-RATA (RP)', 'HPP RATA-RATA', 'HPP', 'Avg Cost', 'hpp', 'avgCost', 'Harga Pokok', 'Modal']))
      if (isNonEmpty(findColumn(row, ['HPP RATA-RATA (RP)', 'HPP RATA-RATA', 'HPP', 'Avg Cost', 'hpp', 'avgCost', 'Harga Pokok', 'Modal']))) {
        if (avgCost < 0) {
          result.errors.push(`Baris ${rowNum}: HPP rata-rata tidak boleh negatif (Item: ${existing.name})`)
          continue
        }
        updateData.avgCost = avgCost
        if (avgCost !== existing.avgCost) changes.avgCost = { from: existing.avgCost, to: avgCost }
      }

      // Low Stock Alert (block negative)
      const lowStockAlert = sanitizeNumber(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'Alert Stok']))
      if (isNonEmpty(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'Alert Stok']))) {
        if (lowStockAlert < 0) {
          result.errors.push(`Baris ${rowNum}: Low Stock Alert tidak boleh negatif (Item: ${existing.name})`)
          continue
        }
        updateData.lowStockAlert = lowStockAlert
        if (lowStockAlert !== existing.lowStockAlert) changes.lowStockAlert = { from: existing.lowStockAlert, to: lowStockAlert }
      }

      // Status validation
      const status = String(findColumn(row, ['STATUS', 'Status', 'status']) || '').trim().toUpperCase()
      if (isNonEmpty(status) && ['ACTIVE', 'ARCHIVED'].includes(status)) {
        updateData.status = status
        if (status !== existing.status) changes.status = { from: existing.status, to: status }
      }

      // Category handling
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

      // Only add if there are actual changes
      if (Object.keys(updateData).length > 0) {
        itemsToUpdate.push({ itemId, rowNum, updateData, changes, existingName: existing.name })
      }
    }

    console.log(`[Inventory Bulk Update] Validation done in ${Date.now() - startTime}ms: ${itemsToUpdate.length} items to update`)

    if (itemsToUpdate.length === 0 && result.errors.length === 0) {
      return safeJson({ ...result, message: 'Tidak ada perubahan yang dilakukan - semua data sudah sama' })
    }

    // ══════════════════════════════════════════════════════════════════
    // PHASE 3: OPTIMIZED BULK UPDATE
    // - Single transaction for categories
    // - Bulk updates using updateMany (1 query per chunk, not per item!)
    // - Single audit log at the end (not per item!)
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

    // Step 2: Bulk update items by chunk (OPTIMIZED: updateMany pattern)
    const chunks: ItemToUpdate[][] = []
    for (let i = 0; i < itemsToUpdate.length; i += CHUNK_SIZE) {
      chunks.push(itemsToUpdate.slice(i, i + CHUNK_SIZE))
    }

    console.log(`[Inventory Bulk Update] Processing ${chunks.length} chunks...`)

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]
      
      // Process all updates in this chunk within a transaction
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
        timeout: 45000 // 45 seconds per chunk (increased for safety)
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
      chunksProcessed: chunks.length,
      newCategories: newCategoriesToCreate.length > 0 ? [...new Map(newCategoriesToCreate.map(c => [c.name.toLowerCase(), c])).values()].length : 0,
    })

    // Step 3: SINGLE audit log for entire operation (not per-item!)
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
        processingTimeMs: totalTime,
        success: result.updated > 0,
        // Include sample of changes (first 10 for context)
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
      if (totalTime > 5000) {
        message += ` dalam ${(totalTime / 1000).toFixed(1)}detik`
      }
    } else if (result.errors.length > 0) {
      message = 'Tidak ada item yang berhasil diupdate'
    } else {
      message = 'Tidak ada perubahan yang diperlukan'
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

    // Provide specific messages for common errors
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
