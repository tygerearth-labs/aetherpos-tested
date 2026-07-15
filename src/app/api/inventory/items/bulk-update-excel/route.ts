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
const CHUNK_SIZE = 50 // Process in chunks for reliability

/**
 * POST /api/inventory/items/bulk-update-excel
 * Bulk update inventory items from uploaded Excel (Pro & Enterprise only).
 * 
 * OPTIMIZED VERSION with:
 * - Parallel pre-load of items and categories
 * - Chunked processing for timeout prevention
 * - All safety nets preserved
 */
export async function POST(request: NextRequest) {
  // Result containers
  const result = {
    updated: 0,
    notFound: 0,
    errors: [] as string[],
    warnings: [] as string[],
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

    const startTime = Date.now()

    console.log(`[Inventory Bulk Update] Starting: file="${file.name}" (${(file.size / 1024).toFixed(1)}KB)`)

    // ══════════════════════════════════════════════════════════════════
    // OPTIMIZATION #1: PARALLEL PRE-LOAD
    // Load ALL reference data ONCE before any writes
    // This eliminates N+1 queries inside transaction loop
    // ══════════════════════════════════════════════════════════════════
    
    const [existingItems, existingCategories] = await Promise.all([
      // Pre-load ALL inventory items for this outlet
      db.inventoryItem.findMany({
        where: { outletId },
        select: { 
          id: true, name: true, sku: true, baseUnit: true, stock: true, 
          avgCost: true, lowStockAlert: true, status: true, categoryId: true,
        },
      }),
      // Pre-load inventory categories for lookup/create
      db.inventoryCategory.findMany({
        where: { outletId },
        select: { id: true, name: true },
      }),
    ])

    // Build O(1) lookup maps
    const itemMap = new Map<string, typeof existingItems[number]>() // ID → item
    const categoryCache = new Map<string, string>() // name → ID
    
    for (const item of existingItems) {
      itemMap.set(item.id, item)
    }
    
    for (const cat of existingCategories) {
      categoryCache.set(cat.name.toLowerCase(), cat.id)
    }

    console.log(`[Inventory Bulk Update] Pre-loaded ${existingItems.length} items, ${existingCategories.length} categories in ${Date.now() - startTime}ms`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 2: COLLECT & VALIDATE DATA IN MEMORY
    // All validation happens here BEFORE any DB writes
    // Safety nets are enforced during collection
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
      
      // ── SAFETY NET: ID is required ──
      if (!itemId) {
        result.errors.push(`Baris ${rowNum}: ID item wajib diisi`)
        continue
      }

      // ── SAFETY NET: Item must exist (O(1) lookup) ──
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

      // ── SAFETY NET: Block negative stock ──
      const stock = sanitizeNumber(findColumn(row, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty']))
      if (isNonEmpty(findColumn(row, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty']))) {
        if (stock < 0) {
          result.errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Item: ${existing.name}, Stok: ${stock})`)
          continue
        }
        updateData.stock = stock
        if (stock !== existing.stock) changes.stock = { from: existing.stock, to: stock }
      }

      // ── SAFETY NET: Block negative avgCost ──
      const avgCost = sanitizeNumber(findColumn(row, ['HPP RATA-RATA (RP)', 'HPP RATA-RATA', 'HPP', 'Avg Cost', 'hpp', 'avgCost', 'Harga Pokok', 'Modal']))
      if (isNonEmpty(findColumn(row, ['HPP RATA-RATA (RP)', 'HPP RATA-RATA', 'HPP', 'Avg Cost', 'hpp', 'avgCost', 'Harga Pokok', 'Modal']))) {
        if (avgCost < 0) {
          result.errors.push(`Baris ${rowNum}: HPP rata-rata tidak boleh negatif (Item: ${existing.name})`)
          continue
        }
        updateData.avgCost = avgCost
        if (avgCost !== existing.avgCost) changes.avgCost = { from: existing.avgCost, to: avgCost }
      }

      // ── SAFETY NET: Block negative lowStockAlert ──
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

      // Category handling (collect for batch creation)
      const categoryRaw = String(findColumn(row, ['KATEGORI INVENTORY', 'KATEGORI', 'Kategori', 'kategori', 'Category', 'category']) || '').trim()
      if (isNonEmpty(categoryRaw)) {
        const catKey = categoryRaw.toLowerCase()
        
        if (categoryCache.has(catKey)) {
          // Existing category - use cached ID
          const categoryId = categoryCache.get(catKey)!
          updateData.categoryId = categoryId
          if (categoryId !== existing.categoryId) {
            changes.categoryId = { from: existing.categoryId || '', to: categoryId }
          }
        } else {
          // New category - mark for creation
          newCategoriesToCreate.push({ name: categoryRaw, outletId })
          updateData.categoryId = `new-${catKey}` // Temporary marker
          changes.categoryId = { from: existing.categoryId || '', to: `[NEW] ${categoryRaw}` }
        }
      }

      // Only add if there are actual changes
      if (Object.keys(updateData).length > 0) {
        itemsToUpdate.push({
          itemId,
          rowNum,
          updateData,
          changes,
          existingName: existing.name,
        })
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // PHASE 3: CHUNKED PROCESSING WITH TRANSACTIONS
    // Process updates in chunks to avoid timeouts
    // ══════════════════════════════════════════════════════════════════

    // Split into chunks
    const chunks: ItemToUpdate[][] = []
    for (let i = 0; i < itemsToUpdate.length; i += CHUNK_SIZE) {
      chunks.push(itemsToUpdate.slice(i, i + CHUNK_SIZE))
    }

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]

      await db.$transaction(async (tx) => {
        // ── Create new categories (only in first chunk, deduplicated) ──
        if (chunkIndex === 0 && newCategoriesToCreate.length > 0) {
          const uniqueCategories = [...new Map(newCategoriesToCreate.map(c => [c.name.toLowerCase(), c])).values()]
          
          for (const cat of uniqueCategories) {
            const catKey = cat.name.toLowerCase()
            
            // Double-check not created between preload and now
            if (categoryCache.has(catKey)) continue
            
            const newCat = await tx.inventoryCategory.create({
              data: { name: cat.name, outletId, color: 'zinc' },
            })
            
            categoryCache.set(catKey, newCat.id)
          }
        }

        // Resolve temporary category IDs for this chunk
        for (const item of chunk) {
          if (typeof item.updateData.categoryId === 'string' && item.updateData.categoryId.toString().startsWith('new-')) {
            const catKey = item.updateData.categoryId.replace('new-', '')
            const realCatId = categoryCache.get(catKey)
            if (realCatId) {
              item.updateData.categoryId = realCatId
            } else {
              delete item.updateData.categoryId
            }
          }
        }

        // Process each item update
        for (const item of chunk) {
          await tx.inventoryItem.update({
            where: { id: item.itemId },
            data: item.updateData,
          })

          await safeAuditLog({
            action: 'BULK_UPDATE',
            entityType: 'INVENTORY_ITEM',
            entityId: item.itemId,
            details: JSON.stringify({
              bulkUpdateExcel: true,
              changes: item.changes,
              fileName: file.name,
            }),
            outletId,
            userId,
          })

          result.updated++
        }
      }, {
        timeout: 30000 // 30 seconds per chunk
      })
    }

    const totalTime = Date.now() - startTime
    console.log(`[Inventory Bulk Update] Done in ${totalTime}ms:`, {
      file: file.name,
      updated: result.updated,
      notFound: result.notFound,
      errors: result.errors.length,
      warnings: result.warnings.length,
      newCategories: newCategoriesToCreate.length > 0 ? [...new Map(newCategoriesToCreate.map(c => [c.name.toLowerCase(), c])).values()].length : 0,
    })

    // Audit log summary
    await safeAuditLog({
      action: result.updated > 0 ? 'BULK_UPDATE' : 'UPDATE_ATTEMPT',
      entityType: 'INVENTORY_ITEM',
      details: JSON.stringify({
        bulkUpdateExcel: true,
        updated: result.updated,
        notFound: result.notFound,
        errors: result.errors.length,
        fileName: file.name,
        processingTimeMs: totalTime,
        success: result.updated > 0,
      }),
      outletId,
      userId,
    })

    return safeJson({ ...result })
  } catch (error) {
    console.error('[Inventory Bulk Update] Error:', {
      error: error instanceof Error ? error.message : error,
      totalTimeMs: Date.now() - startTime,
    })
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses file update', details: message }, 500)
  }
}
