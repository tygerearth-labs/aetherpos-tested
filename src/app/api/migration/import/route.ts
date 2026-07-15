import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan, isUnlimited } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { generateUniqueSKU, generateVariantSKU } from '@/lib/sku-generator'

export const maxDuration = 300

const MAX_ROWS = 5000

const VALID_UNITS = ['pcs', 'ml', 'lt', 'gr', 'kg', 'box', 'pack', 'botol', 'gelas', 'mangkuk', 'porsi', 'bungkus', 'sachet', 'dus', 'rim', 'lembar', 'meter', 'cm', 'ons', 'roll', 'strip', 'ekor']

// ==================== NUMBER PARSING ====================

function sanitizeNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (val === null || val === undefined) return 0
  const str = String(val).trim()
  if (!str) return 0

  let isNegative = false
  let trimmed = str
  if (trimmed.startsWith('-') || trimmed.startsWith('\u2212')) {
    isNegative = true
    trimmed = trimmed.slice(1)
  }

  let cleaned = trimmed.replace(/[Rp\s$€¥£.,]/g, (match) => {
    if (match === '.' || match === ',') return match
    return ''
  }).trim()

  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')

  if (lastDot > -1 && lastComma > -1) {
    if (lastDot > lastComma) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (lastDot > -1 && lastComma === -1) {
    const parts = cleaned.split('.')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      cleaned = cleaned.replace(/\./g, '')
    }
  } else if (lastComma > -1 && lastDot === -1) {
    const parts = cleaned.split(',')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      cleaned = cleaned.replace(/,/g, '')
    } else {
      cleaned = cleaned.replace(',', '.')
    }
  }

  const num = Number(cleaned)
  return isNaN(num) ? 0 : (isNegative ? -Math.abs(num) : num)
}

// ==================== COLUMN HELPERS ====================

function normalizeHeader(key: string): string {
  return key.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase()
}

function findColumn(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalizedMap = new Map<string, string>()
  for (const key of Object.keys(row)) {
    const norm = normalizeHeader(key)
    normalizedMap.set(norm, key)
  }

  for (const alias of aliases) {
    const norm = normalizeHeader(alias)
    if (normalizedMap.has(norm)) {
      return row[normalizedMap.get(norm)!]
    }
    for (const [normKey, actualKey] of normalizedMap) {
      if (normKey.includes(norm) || norm.includes(normKey)) {
        return row[actualKey]
      }
    }
  }
  return undefined
}

// ==================== INLINE COMPOSITION PARSER ====================

/**
 * Parse inline composition string format:
 * `NamaBahan:qtySatuan,NamaBahan:qtySatuan`
 * Example: `Nasi:200gr,Telur:1pcs,Minyak:15ml`
 */
function parseInlineComposition(compositionStr: string): { name: string; qty: number; unit: string }[] {
  if (!compositionStr || !compositionStr.trim()) return []
  const parts = compositionStr.split(',')
  return parts.map(part => {
    const trimmed = part.trim()
    const lastColon = trimmed.lastIndexOf(':')
    if (lastColon === -1) return { name: trimmed, qty: 0, unit: '' }
    const name = trimmed.slice(0, lastColon).trim()
    const qtyStr = trimmed.slice(lastColon + 1).trim()
    // Parse qty and unit: "200gr" → qty=200, unit="gr"; "1pcs" → qty=1, unit="pcs"
    const match = qtyStr.match(/^([\d.]+)\s*(.+)$/)
    if (match) return { name, qty: parseFloat(match[1]) || 0, unit: match[2].trim().toLowerCase() }
    return { name, qty: parseFloat(qtyStr) || 0, unit: '' }
  }).filter(c => c.name && c.qty > 0)
}

// ==================== SHEET TYPE DETECTION ====================

type SheetType = 'non_varian' | 'varian' | 'inventory' | 'komposisi' | 'guide' | 'unknown'

function detectSheetType(sheetName: string): SheetType {
  const lower = sheetName.toLowerCase()
  if (lower.includes('non-varian') || lower.includes('non varian')) return 'non_varian'
  if (lower.includes('varian') && !lower.includes('non')) return 'varian'
  if (lower.includes('inventory') || lower.includes('bahan') || lower.includes('stok gudang')) return 'inventory'
  if (lower.includes('komposisi') || lower.includes('resep') || lower.includes('bom')) return 'komposisi'
  if (lower.includes('panduan') || lower.includes('guide') || lower.includes('petunjuk')) return 'guide'
  return 'unknown'
}

// ==================== SMART RE-MIGRATION HELPERS ====================

/**
 * Result of analyzing an existing inventory item for re-migration
 */
interface RemigrationAnalysis {
  canReplace: boolean        // Safe to replace (only has migration data)
  reason: string             // Human-readable explanation
  hasRealHistory: boolean    // Has actual business transactions
  migrationOnlyData: {
    movements: number        // Count of MIGRATION-type movements
    compositions: number     // Count of auto 1:1 compositions
  }
}

/**
 * Analyze if an existing inventory item can be safely replaced during re-migration
 * 
 * CAN REPLACE (migration-only data):
 * - Only MIGRATION type movements (initial stock from previous upload)
 * - Auto 1:1 product compositions (from product_stock mode)
 * - No real purchases, sales, transfers, or manual adjustments
 * 
 * CANNOT REPLACE (real business data):
 * - PurchaseOrderItem records
 * - Non-MIGRATION movements (RESTOCK, ADJUSTMENT, CONSUMPTION, TRANSFER)
 * - InventoryTransferItem records  
 * - TransactionConsumptionSnapshot records
 * - Manual BOM compositions (qty != 1)
 */
async function analyzeExistingInventoryForRemigration(
  inventoryItemId: string,
  outletId: string
): Promise<RemigrationAnalysis> {
  const result: RemigrationAnalysis = {
    canReplace: false,
    reason: '',
    hasRealHistory: false,
    migrationOnlyData: { movements: 0, compositions: 0 },
  }

  try {
    // Get counts of all relations
    const item = await db.inventoryItem.findFirst({
      where: { id: inventoryItemId, outletId },
      include: {
        _count: {
          select: {
            compositions: true,
            purchaseItems: true,
            movements: true,
            inventoryTransferItems: true,
            consumptionSnapshots: true,
          },
        },
      },
    })

    if (!item) {
      result.canReplace = true  // Item doesn't exist anymore (edge case)
      result.reason = 'Item tidak ditemukan (mungkin sudah dihapus)'
      return result
    }

    const c = item._count
    const totalRelations = c.compositions + c.purchaseItems + c.movements 
      + c.inventoryTransferItems + c.consumptionSnapshots

    // No relations at all → safe to replace
    if (totalRelations === 0) {
      result.canReplace = true
      result.reason = 'Tidak ada histori sama sekali'
      return result
    }

    // Check for REAL business history (blocks replacement)
    // 1. Purchase items always indicate real history
    if (c.purchaseItems > 0) {
      result.hasRealHistory = true
      result.reason = `${c.purchaseItems} riwayat pembelian`
      return result
    }

    // 2. Transfer items always indicate real history
    if (c.inventoryTransferItems > 0) {
      result.hasRealHistory = true
      result.reason = `${c.inventoryTransferItems} riwayat transfer`
      return result
    }

    // 3. Consumption snapshots always indicate real history
    if (c.consumptionSnapshots > 0) {
      result.hasRealHistory = true
      result.reason = `${c.consumptionSnapshots} riwayat konsumsi penjualan`
      return result
    }

    // 4. Movements - need to check types
    if (c.movements > 0) {
      const movementTypes = await db.inventoryMovement.groupBy({
        by: ['referenceType'],
        where: { inventoryItemId: inventoryItemId, outletId },
        _count: true,
      })

      const migrationMovements = movementTypes.find(m => m.referenceType === 'MIGRATION')?._count || 0
      const realMovements = c.movements - migrationMovements

      result.migrationOnlyData.movements = migrationMovements

      if (realMovements > 0) {
        result.hasRealHistory = true
        result.reason = `${realMovements} pergerakan stok bisnis (+${migrationMovements} stok awal migrasi)`
        return result
      }
    }

    // 5. Compositions - check if all are auto 1:1 links
    if (c.compositions > 0) {
      const compositions = await db.productComposition.findMany({
        where: {
          OR: [
            { inventoryItemId: inventoryItemId },
            { ingredientId: inventoryItemId },
          ],
        },
        select: { id: true, qty: true, baseUnit: true },
      })

      let autoCount = 0
      let realCount = 0

      for (const comp of compositions) {
        // Auto 1:1 links have qty=1 and valid baseUnit
        if (comp.qty === 1 && comp.baseUnit !== null) {
          autoCount++
        } else {
          realCount++
        }
      }

      result.migrationOnlyData.compositions = autoCount

      if (realCount > 0) {
        result.hasRealHistory = true
        result.reason = `${realCount} komposisi/resep manual (+${autoCount} link otomatis)`
        return result
      }
    }

    // All data is migration-only → SAFE TO REPLACE
    result.canReplace = true
    const parts: string[] = []
    if (result.migrationOnlyData.movements > 0) parts.push(`${result.migrationOnlyData.movements} stok awal migrasi`)
    if (result.migrationOnlyData.compositions > 0) parts.push(`${result.migrationOnlyData.compositions} link otomatis`)
    result.reason = `Hanya data migrasi: ${parts.join(', ')} → akan di-replace`

  } catch (error) {
    console.warn('[migration] Error analyzing existing inventory:', error)
    // On error, default to NOT replacing to be safe
    result.hasRealHistory = true
    result.reason = 'Gagal menganalisis (default: skip untuk keamanan)'
  }

  return result
}

/**
 * Clean up migration-only data from an inventory item before re-migrating
 * This removes old MIGRATION movements and auto compositions so fresh data can be written
 */
async function cleanupMigrationData(
  inventoryItemId: string,
  outletId: string
): Promise<{ movementsDeleted: number; compositionsDeleted: number }> {
  let movementsDeleted = 0
  let compositionsDeleted = 0

  try {
    // Delete MIGRATION-type movements
    const movResult = await db.inventoryMovement.deleteMany({
      where: {
        inventoryItemId: inventoryItemId,
        referenceType: 'MIGRATION',
        outletId,
      },
    })
    movementsDeleted = movResult.count

    // Delete auto 1:1 compositions linked to this inventory item
    // These are compositions with qty=1 that were created by product_stock mode
    const compResult = await db.productComposition.deleteMany({
      where: {
        OR: [
          { inventoryItemId: inventoryItemId, qty: 1 },
          { ingredientId: inventoryItemId, qty: 1 },
        ],
      },
    })
    compositionsDeleted = compResult.count

    console.log(`[migration] Cleaned up migration data for item ${inventoryItemId}: ${movementsDeleted} movements, ${compositionsDeleted} compositions`)
  } catch (error) {
    console.error('[migration] Error cleaning up migration data:', error)
  }

  return { movementsDeleted, compositionsDeleted }
}

// ==================== MAIN ROUTE ====================

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const userId = user.id

    // Check plan
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) {
      return safeJsonError('Outlet not found', 404)
    }

    // Plan gate: bulkUpload required for migration import (Pro & Enterprise only)
    if (!outletPlan.features.bulkUpload) {
      return safeJsonError('Fitur import migrasi hanya tersedia untuk akun Pro ke atas. Upgrade sekarang!', 403)
    }

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const mode = String(formData.get('mode') || 'product_only') // 'product_only' | 'product_stock' | 'product_inventory'

    if (!file) {
      return safeJsonError('File tidak ditemukan', 400)
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      return safeJsonError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400)
    }

    if (file.size > 10 * 1024 * 1024) {
      return safeJsonError('Ukuran file maksimal 10MB', 400)
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    let workbook: XLSX.WorkBook
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch {
      return safeJsonError('File tidak dapat dibaca. Pastikan file adalah format Excel yang valid.', 400)
    }

    if (workbook.SheetNames.length === 0) {
      return safeJsonError('File Excel kosong', 400)
    }

    const includeInventory = mode === 'product_inventory'
    const isStockMode = mode === 'product_stock'
    const hasInventory = includeInventory || isStockMode

    // ==================== STATS ====================
    let productsCreated = 0
    let variantsCreated = 0
    let productsSkipped = 0
    let categoriesCreated = 0
    let barcodeCount = 0
    let inventoryItemsCreated = 0
    let inventoryItemsSkipped = 0
    let inventoryItemsUpdated = 0       // Re-migration: items replaced with new data
    let migrationDataCleaned = 0        // Count of items where old migration data was cleaned
    let compositionsCreated = 0
    let totalStock = 0
    let totalModalValue = 0
    const errors: string[] = []
    const warnings: string[] = []        // Warnings for re-migration events

    // ==================== CACHES ====================
    const categoryCache = new Map<string, string | null>()
    const inventoryCategoryCache = new Map<string, string | null>()
    // Cache inventory items by name for composition linking
    const inventoryItemCache = new Map<string, string>() // name → id
    // Cache products by name for composition linking
    const productCache = new Map<string, string>() // name → id
    // Cache product variants by (productName, variantName) for composition linking
    const variantCache = new Map<string, string>() // "productName||variantName" → id
    // Store inline compositions for deferred processing (after all items exist)
    const deferredInlineCompositions: {
      productId: string
      variantId?: string
      compositionStr: string
    }[] = []

    // Batch audit logs for opening stock (flushed after each sheet to avoid N+1)
    const openingStockLogs: Array<{
      action: string
      entityType: string
      entityId: string
      details: string
      outletId: string
      userId: string
    }> = []
    const OPENING_STOCK_BATCH_SIZE = 200

    async function flushOpeningStockLogs() {
      if (openingStockLogs.length === 0) return
      try {
        await db.auditLog.createMany({ data: openingStockLogs })
      } catch (e) {
        console.warn('[migration] Failed to batch-create opening stock audit logs:', e)
      }
      openingStockLogs.length = 0
    }

    // ==================== HELPER: GET OR CREATE CATEGORY ====================
    async function getOrCreateCategory(name: string): Promise<string | null> {
      if (categoryCache.has(name)) {
        return categoryCache.get(name)!
      }
      const existing = await db.category.findFirst({ where: { name, outletId } })
      if (existing) {
        categoryCache.set(name, existing.id)
        return existing.id
      }
      const created = await db.category.create({
        data: { name, outletId, color: 'zinc' },
      })
      categoriesCreated++
      categoryCache.set(name, created.id)
      return created.id
    }

    // ==================== HELPER: GET OR CREATE INVENTORY CATEGORY ====================
    async function getOrCreateInventoryCategory(name: string): Promise<string | null> {
      if (inventoryCategoryCache.has(name)) {
        return inventoryCategoryCache.get(name)!
      }
      const existing = await db.inventoryCategory.findFirst({ where: { name, outletId } })
      if (existing) {
        inventoryCategoryCache.set(name, existing.id)
        return existing.id
      }
      const created = await db.inventoryCategory.create({
        data: { name, outletId, color: 'zinc' },
      })
      categoriesCreated++
      inventoryCategoryCache.set(name, created.id)
      return created.id
    }

    // ==================== HELPER: CHECK PRODUCT LIMIT ====================
    async function checkProductLimit(): Promise<boolean> {
      if (isUnlimited(outletPlan.features.maxProducts)) return true
      const currentCount = await db.product.count({ where: { outletId } })
      return currentCount < outletPlan.features.maxProducts
    }

    // ==================== HELPER: FIND INVENTORY ITEM BY NAME (with fuzzy) ====================
    async function findInventoryItemByName(name: string): Promise<string | null> {
      // Check cache first
      if (inventoryItemCache.has(name)) return inventoryItemCache.get(name)!
      // Check DB
      const item = await db.inventoryItem.findFirst({ where: { name, outletId }, select: { id: true } })
      if (item) {
        inventoryItemCache.set(name, item.id)
        return item.id
      }
      return null
    }

    // ==================== HELPER: PROCESS INLINE COMPOSITION ====================
    async function processInlineComposition(
      productId: string,
      variantId: string | undefined,
      compositionStr: string
    ): Promise<number> {
      const parsed = parseInlineComposition(compositionStr)
      if (parsed.length === 0) return 0

      let created = 0
      for (const comp of parsed) {
        const invItemId = await findInventoryItemByName(comp.name)
        if (!invItemId) {
          errors.push(`Komposisi inline: bahan "${comp.name}" tidak ditemukan di inventory`)
          continue
        }
        try {
          await db.productComposition.create({
            data: {
              productId,
              variantId: variantId || null,
              inventoryItemId: invItemId,
              qty: comp.qty,
              yieldPerBatch: 1,
              baseUnit: comp.unit || 'pcs',
            },
          })
          created++
        } catch {
          // Duplicate composition — skip silently
        }
      }
      return created
    }

    // ==================== PROCESS SHEETS ====================

    for (const sheetName of workbook.SheetNames) {
      const sheetType = detectSheetType(sheetName)

      // Skip unknown / guide sheets
      if (sheetType === 'unknown' || sheetType === 'guide') continue

      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

      if (rows.length === 0) continue
      if (rows.length > MAX_ROWS) {
        errors.push(`Sheet "${sheetName}": Melebihi ${MAX_ROWS} baris (${rows.length}), dipotong.`)
        rows.splice(MAX_ROWS)
      }

      // ──────────────────────────────────────────────
      // SHEET 1: Produk Non-Varian
      // ──────────────────────────────────────────────
      if (sheetType === 'non_varian') {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          const rowNum = i + 2

          const name = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
          const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim() || null
          const barcode = String(findColumn(row, ['BARCODE', 'Barcode', 'barcode', 'BAR CODE', 'Bar Code']) || '').trim() || null
          const hpp = sanitizeNumber(findColumn(row, ['HPP / MODAL (Rp)', 'HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal', 'HPP MODAL Rp']))
          const price = sanitizeNumber(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
          const stock = sanitizeNumber(findColumn(row, ['STOK AWAL', 'STOK', 'QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))
          const unitRaw = String(findColumn(row, ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat']) || 'pcs').trim().toLowerCase()
          const categoryRaw = String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim()
          const lowStockAlert = sanitizeNumber(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low stock alert', 'Low Stock', 'LOW STOCK', 'Stock Alert', 'STOK MINIMUM']))
          const komposisiInline = String(findColumn(row, ['KOMPOSISI INLINE', 'KOMPOSISI INLINE (Opsional)', 'Komposisi Inline', 'KOMPOSISI', 'Komposisi', 'komposisi']) || '').trim()

          if (!name) {
            errors.push(`Baris ${rowNum}: Nama produk wajib diisi`)
            continue
          }

          if (!price || price < 0) {
            errors.push(`Baris ${rowNum}: Harga Jual tidak valid (Nama: ${name})`)
            continue
          }

          const unit = VALID_UNITS.includes(unitRaw) ? unitRaw : 'pcs'

          // Check product limit
          if (!(await checkProductLimit())) {
            errors.push(`Baris ${rowNum}: Batas produk tercapai`)
            break
          }

          // Skip duplicates
          const existing = await db.product.findFirst({
            where: { name, outletId },
          })
          if (existing) {
            // Still cache the product for composition linking
            productCache.set(name, existing.id)
            productsSkipped++
            continue
          }

          // Category
          const categoryId = categoryRaw ? await getOrCreateCategory(categoryRaw) : null

          // Auto-generate SKU/Barcode
          const finalSku = sku || await generateUniqueSKU(name, outletId)
          const finalBarcode = barcode || finalSku

          // Create Product
          const product = await db.product.create({
            data: {
              name,
              sku: finalSku,
              barcode: finalBarcode,
              hpp,
              price,
              stock,
              unit,
              categoryId,
              outletId,
              lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 10,
              hasComposition: includeInventory && !!komposisiInline,
            },
          })

          productsCreated++
          if (finalBarcode) barcodeCount++
          productCache.set(name, product.id)

          // === Opening stock audit log per product (batched) ===
          if (stock > 0) {
            openingStockLogs.push({
              action: 'RESTOCK',
              entityType: 'PRODUCT',
              entityId: product.id,
              details: JSON.stringify({
                productName: name,
                productSku: finalSku,
                initialStock: stock,
                newStock: stock,
                reason: 'Stok awal migrasi',
              }),
              outletId,
              userId,
            })
            if (openingStockLogs.length >= OPENING_STOCK_BATCH_SIZE) {
              await flushOpeningStockLogs()
            }
          }

          // === If inventory/bahan mode + stock > 0: create InventoryItem + Opening Balance ===
          if (includeInventory && stock > 0) {
            try {
              const existingInv = await db.inventoryItem.findFirst({
                where: { name, outletId },
              })

              if (!existingInv) {
                // ── NEW ITEM: Create fresh ──
                const invItem = await db.inventoryItem.create({
                  data: {
                    name,
                    sku: finalSku,
                    baseUnit: unit,
                    stock: stock,
                    avgCost: hpp > 0 ? hpp : 0,
                    lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 0,
                    status: 'ACTIVE',
                    outletId,
                    categoryId: null,
                  },
                })

                inventoryItemsCreated++
                totalStock += stock
                totalModalValue += hpp * stock
                inventoryItemCache.set(name, invItem.id)

                // Create opening balance movement
                try {
                  await db.inventoryMovement.create({
                    data: {
                      type: 'PURCHASE',
                      quantity: stock,
                      previousStock: 0,
                      newStock: stock,
                      referenceType: 'MIGRATION',
                      notes: `Saldo awal migrasi dari ${file.name}`,
                      outletId,
                      inventoryItemId: invItem.id,
                      userId,
                    },
                  })
                } catch (movErr) {
                  console.warn(`[migration] Failed to create opening balance movement for ${name}:`, movErr)
                  errors.push(`Warning: Gagal catat pergerakan stok untuk "${name}"`)
                }
              } else {
                // ── EXISTING ITEM: Smart re-migration handling ──
                console.log(`[migration] includeInventory: Found existing item "${name}" (id=${existingInv.id}), analyzing...`)
                
                const analysis = await analyzeExistingInventoryForRemigration(existingInv.id, outletId)
                
                if (analysis.canReplace) {
                  // Safe to replace: clean up old migration data and update
                  console.log(`[migration] includeInventory: REplacing "${name}" - ${analysis.reason}`)
                  
                  const cleaned = await cleanupMigrationData(existingInv.id, outletId)
                  
                  // Update the inventory item with new values
                  await db.inventoryItem.update({
                    where: { id: existingInv.id },
                    data: {
                      sku: finalSku || existingInv.sku,
                      baseUnit: unit,
                      stock: stock,
                      avgCost: hpp > 0 ? hpp : 0,
                      lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 0,
                      status: 'ACTIVE',
                    },
                  })
                  
                  // Create new opening balance movement
                  try {
                    await db.inventoryMovement.create({
                      data: {
                        type: 'PURCHASE',
                        quantity: stock,
                        previousStock: 0,
                        newStock: stock,
                        referenceType: 'MIGRATION',
                        notes: `Saldo awal migrasi (re-migrate) dari ${file.name}`,
                        outletId,
                        inventoryItemId: existingInv.id,
                        userId,
                      },
                    })
                  } catch (movErr) {
                    console.warn(`[migration] Failed to create re-migration movement for ${name}:`, movErr)
                  }
                  
                  inventoryItemsUpdated++
                  migrationDataCleaned++
                  totalStock += stock
                  totalModalValue += hpp * stock
                  
                  warnings.push(`🔄 "${name}": di-update (data migrasi lama dibersihkan: ${cleaned.movementsDeleted} stok, ${cleaned.compositionsDeleted} link)`)
                } else {
                  // Has real history: skip with warning
                  console.log(`[migration] includeInventory: SKIP "${name}" - ${analysis.reason}`)
                  inventoryItemsSkipped++
                  warnings.push(`⚠️ "${name}" dilewati: ${analysis.reason}`)
                }
                
                inventoryItemCache.set(name, existingInv.id)
              }
            } catch (invErr) {
              console.error(`[migration] CRITICAL: Failed to create inventory item for ${name}:`, invErr)
              const errMsg = invErr instanceof Error ? invErr.message : String(invErr)
              errors.push(`Gagal buat inventory "${name}": ${errMsg}`)
            }
          }

          // === product_stock mode: create 1:1 InventoryItem + Composition (product↔stock) ===
          if (isStockMode && stock > 0) {
            console.log(`[migration] product_stock: Processing "${name}" with stock=${stock}, unit=${unit}`)
            try {
              const existingInv = await db.inventoryItem.findFirst({
                where: { name, outletId },
              })

              let invItemId: string
              if (!existingInv) {
                // ── NEW ITEM: Create fresh ──
                console.log(`[migration] product_stock: Creating NEW inventory for "${name}"`)
                // Create InventoryItem with proper error handling
                const invItem = await db.inventoryItem.create({
                  data: {
                    name,
                    sku: finalSku,
                    baseUnit: unit,
                    stock: stock,
                    avgCost: hpp > 0 ? hpp : 0,
                    lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 0,
                    status: 'ACTIVE',
                    outletId,
                    categoryId: null,
                  },
                })

                invItemId = invItem.id
                inventoryItemsCreated++
                totalStock += stock
                totalModalValue += hpp * stock
                inventoryItemCache.set(name, invItem.id)

                // Create opening balance movement
                try {
                  await db.inventoryMovement.create({
                    data: {
                      type: 'PURCHASE',
                      quantity: stock,
                      previousStock: 0,
                      newStock: stock,
                      referenceType: 'MIGRATION',
                      notes: `Saldo awal stok gudang migrasi dari ${file.name}`,
                      outletId,
                      inventoryItemId: invItem.id,
                      userId,
                    },
                  })
                }catch (movErr) {
                  console.warn(`[migration] Failed to create opening balance movement for ${name}:`, movErr)
                  errors.push(`Warning: Gagal catat pergerakan stok untuk "${name}" (stok tetap tersimpan)`)
                }
              } else {
                // ── EXISTING ITEM: Smart re-migration handling ──
                console.log(`[migration] product_stock: Found existing inventory "${name}" (id=${existingInv.id}), analyzing...`)
                
                const analysis = await analyzeExistingInventoryForRemigration(existingInv.id, outletId)
                
                if (analysis.canReplace) {
                  // Safe to replace: clean up old migration data and update
                  console.log(`[migration] product_stock: REplacing "${name}" - ${analysis.reason}`)
                  
                  const cleaned = await cleanupMigrationData(existingInv.id, outletId)
                  
                  // Update the inventory item with new values
                  await db.inventoryItem.update({
                    where: { id: existingInv.id },
                    data: {
                      sku: finalSku || existingInv.sku,
                      baseUnit: unit,
                      stock: stock,
                      avgCost: hpp > 0 ? hpp : 0,
                      lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 0,
                      status: 'ACTIVE',
                    },
                  })
                  
                  // Create new opening balance movement
                  try {
                    await db.inventoryMovement.create({
                      data: {
                        type: 'PURCHASE',
                        quantity: stock,
                        previousStock: 0,
                        newStock: stock,
                        referenceType: 'MIGRATION',
                        notes: `Saldo awal stok gudang (re-migrate) dari ${file.name}`,
                        outletId,
                        inventoryItemId: existingInv.id,
                        userId,
                      },
                    })
                  } catch (movErr) {
                    console.warn(`[migration] Failed to create re-migration movement for ${name}:`, movErr)
                  }
                  
                  invItemId = existingInv.id
                  inventoryItemsUpdated++
                  migrationDataCleaned++
                  totalStock += stock
                  totalModalValue += hpp * stock
                  
                  warnings.push(`🔄 "${name}": di-update (data migrasi lama dibersihkan: ${cleaned.movementsDeleted} stok, ${cleaned.compositionsDeleted} link)`)
                } else {
                  // Has real history: use existing but warn
                  console.log(`[migration] product_stock: Using EXISTING "${name}" (not replaced - ${analysis.reason})`)
                  invItemId = existingInv.id
                  inventoryItemsSkipped++
                  warnings.push(`⚠️ "${name}" menggunakan data existing: ${analysis.reason}`)
                }
                
                inventoryItemCache.set(name, existingInv.id)
              }

              // Create 1:1 composition: 1 unit of product uses 1 unit of inventory
              try {
                await db.productComposition.create({
                  data: {
                    productId: product.id,
                    inventoryItemId: invItemId,
                    qty: 1,
                    baseUnit: unit,
                  },
                })
                compositionsCreated++
                console.log(`[migration] product_stock: Composition created for "${name}" → inv=${invItemId}`)
              } catch (compErr) {
                console.warn(`[migration] Failed to create 1:1 composition for ${name}:`, compErr)
                errors.push(`Gagal hubungkan produk↔stok untuk "${name}" (inventory tetap dibuat)`)
              }
            } catch (invErr) {
              console.error(`[migration] CRITICAL: Failed to create inventory item for ${name}:`, invErr)
              const errMsg = invErr instanceof Error ? invErr.message : String(invErr)
              errors.push(`Gagal buat inventory "${name}": ${errMsg}`)
            }
          } else if (isStockMode && stock <= 0) {
            console.log(`[migration] product_stock: SKIPPED "${name}" - stock=${stock} (must be > 0)`)
          }

          // === Process inline composition (ALWAYS defer — inventory sheet may not be processed yet) ===
          if (includeInventory && komposisiInline) {
            deferredInlineCompositions.push({
              productId: product.id,
              compositionStr: komposisiInline,
            })
          }
        }
      }

      // Flush opening stock logs after non-variant sheet
      await flushOpeningStockLogs()

      // ──────────────────────────────────────────────
      // SHEET 2: Produk Varian
      // ──────────────────────────────────────────────
      if (sheetType === 'varian') {
        let currentParentProduct: { id: string; name: string } | null = null

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          const rowNum = i + 2

          const parentName = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
          const parentSku = String(findColumn(row, ['SKU PRODUK', 'SKU Produk', 'sku produk']) || '').trim() || null
          const parentBarcode = String(findColumn(row, ['BARCODE PRODUK', 'Barcode Produk', 'barcode produk']) || '').trim() || null
          const parentHpp = sanitizeNumber(findColumn(row, ['HPP PRODUK (Rp)', 'HPP PRODUK', 'HPP Produk', 'hpp produk']))
          const parentPrice = sanitizeNumber(findColumn(row, ['HARGA JUAL PRODUK* (Rp)', 'HARGA JUAL PRODUK', 'HARGA JUAL PRODUK (Rp)', 'harga jual produk']))
          const categoryRaw = String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim()

          const variantName = String(findColumn(row, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Nama Variant', 'nama varian', 'Varian', 'VARIAN']) || '').trim()
          const variantSku = String(findColumn(row, ['SKU VARIAN', 'SKU Varian', 'sku varian']) || '').trim() || null
          const variantBarcode = String(findColumn(row, ['BARCODE VARIAN', 'Barcode Varian', 'barcode varian']) || '').trim() || null
          const variantHpp = sanitizeNumber(findColumn(row, ['HPP VARIAN (Rp)', 'HPP VARIAN', 'HPP Varian', 'hpp varian']))
          const variantPrice = sanitizeNumber(findColumn(row, ['HARGA JUAL VARIAN* (Rp)', 'HARGA JUAL VARIAN', 'HARGA JUAL VARIAN (Rp)', 'harga jual varian']))
          const variantStock = sanitizeNumber(findColumn(row, ['STOK AWAL VARIAN', 'STOK VARIAN', 'Stok Varian', 'stok varian', 'stok awal varian']))
          const komposisiVariantInline = String(findColumn(row, ['KOMPOSISI VARIAN INLINE', 'KOMPOSISI VARIAN INLINE (Opsional)', 'Komposisi Varian', 'komposisi varian', 'KOMPOSISI INLINE']) || '').trim()

          // === Parent product row (NAMA PRODUK is filled) ===
          if (parentName) {
            // Check product limit
            if (!(await checkProductLimit())) {
              errors.push(`Baris ${rowNum}: Batas produk tercapai`)
              break
            }

            // Skip duplicates
            const existing = await db.product.findFirst({ where: { name: parentName, outletId } })
            if (existing) {
              productCache.set(parentName, existing.id)
              currentParentProduct = { id: existing.id, name: parentName }
              productsSkipped++
            } else {
              const categoryId = categoryRaw ? await getOrCreateCategory(categoryRaw) : null
              const finalSku = parentSku || await generateUniqueSKU(parentName, outletId)
              const finalBarcode = parentBarcode || finalSku

              const product = await db.product.create({
                data: {
                  name: parentName,
                  sku: finalSku,
                  barcode: finalBarcode,
                  hpp: parentHpp,
                  price: parentPrice || 0,
                  stock: 0, // Parent stock = 0 when has variants
                  unit: 'pcs',
                  categoryId,
                  outletId,
                  hasVariants: true,
                  hasComposition: includeInventory && !!komposisiVariantInline,
                },
              })
              productsCreated++
              if (finalBarcode) barcodeCount++
              productCache.set(parentName, product.id)
              currentParentProduct = { id: product.id, name: parentName }
            }
          }

          // === Variant row (NAMA VARIAN must be filled) ===
          if (variantName && currentParentProduct) {
            if (!variantPrice || variantPrice < 0) {
              errors.push(`Baris ${rowNum}: Harga Jual Varian tidak valid (Produk: ${currentParentProduct.name}, Varian: ${variantName})`)
              continue
            }

            const finalVariantSku = variantSku || await generateVariantSKU(currentParentProduct.name, variantName, outletId)
            const finalVariantBarcode = variantBarcode || finalVariantSku

            // Check for duplicate variant name
            const existingVariant = await db.productVariant.findFirst({
              where: { name: variantName, productId: currentParentProduct.id },
            })
            if (existingVariant) {
              errors.push(`Baris ${rowNum}: Varian "${variantName}" sudah ada untuk produk "${currentParentProduct.name}"`)
              continue
            }

            const variant = await db.productVariant.create({
              data: {
                productId: currentParentProduct.id,
                name: variantName,
                sku: finalVariantSku,
                barcode: finalVariantBarcode,
                hpp: variantHpp,
                price: variantPrice,
                stock: variantStock,
                outletId,
              },
            })

            variantsCreated++
            if (finalVariantBarcode) barcodeCount++

            // === Opening stock audit log per variant (batched) ===
            if (variantStock > 0) {
              openingStockLogs.push({
                action: 'RESTOCK',
                entityType: 'VARIANT',
                entityId: variant.id,
                details: JSON.stringify({
                  productName: currentParentProduct.name,
                  variantName,
                  variantSku: finalVariantSku,
                  initialStock: variantStock,
                  newStock: variantStock,
                  reason: 'Stok awal migrasi',
                }),
                outletId,
                userId,
              })
              if (openingStockLogs.length >= OPENING_STOCK_BATCH_SIZE) {
                await flushOpeningStockLogs()
              }
            }

            // Cache variant for composition linking
            variantCache.set(`${currentParentProduct.name}||${variantName}`, variant.id)

            // Process inline composition for variant (ALWAYS defer)
            if (includeInventory && komposisiVariantInline) {
              deferredInlineCompositions.push({
                productId: currentParentProduct.id,
                variantId: variant.id,
                compositionStr: komposisiVariantInline,
              })
            }
          } else if (variantName && !currentParentProduct) {
            errors.push(`Baris ${rowNum}: Varian "${variantName}" tidak memiliki produk induk`)
          }
        }
      }

      // Flush opening stock logs after variant sheet
      await flushOpeningStockLogs()

      // ──────────────────────────────────────────────
      // SHEET 3: Inventory (Bahan Baku)
      // ──────────────────────────────────────────────
      if (sheetType === 'inventory') {
        if (!includeInventory) {
          // Skip inventory sheet in product_only mode
          continue
        }

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          const rowNum = i + 2

          const name = String(findColumn(row, ['NAMA ITEM*', 'NAMA ITEM', 'NAMA BAHAN*', 'NAMA BAHAN', 'Nama Bahan', 'nama bahan', 'Bahan', 'BAHAN', 'name', 'Nama']) || '').trim()
          const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim() || null
          const baseUnitRaw = String(findColumn(row, ['SATUAN DASAR*', 'SATUAN DASAR', 'Satuan Dasar', 'satuan dasar', 'Satuan', 'satuan', 'Unit', 'unit']) || 'pcs').trim().toLowerCase()
          const stock = sanitizeNumber(findColumn(row, ['STOK AWAL', 'STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Jumlah']))
          const avgCost = sanitizeNumber(findColumn(row, ['HPP RATA-RATA (Rp)', 'HPP RATA-RATA', 'HPP', 'hpp', 'Harga Pokok', 'Avg Cost', 'avg cost']))
          const categoryRaw = String(findColumn(row, ['KATEGORI INVENTORY', 'KATEGORI', 'Kategori Inventory', 'kategori inventory', 'Kategori', 'kategori']) || '').trim()
          const lowStockAlert = sanitizeNumber(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low stock alert', 'Low Stock', 'LOW STOCK', 'Stock Alert', 'STOK MINIMUM']))

          if (!name) {
            errors.push(`Baris ${rowNum}: Nama item stok wajib diisi`)
            continue
          }

          const baseUnit = VALID_UNITS.includes(baseUnitRaw) ? baseUnitRaw : 'pcs'

          // Smart handling for existing inventory items (re-migration support)
          const existing = await db.inventoryItem.findFirst({
            where: { name, outletId },
          })
          
          if (existing) {
            // ── EXISTING ITEM: Smart re-migration handling ──
            console.log(`[migration] sheet3_inventory: Found existing item "${name}" (id=${existing.id}), analyzing...`)
            
            const analysis = await analyzeExistingInventoryForRemigration(existing.id, outletId)
            
            if (analysis.canReplace) {
              // Safe to replace: clean up old migration data and update
              console.log(`[migration] sheet3_inventory: REplacing "${name}" - ${analysis.reason}`)
              
              const cleaned = await cleanupMigrationData(existing.id, outletId)
              
              // Inventory category
              const invCategoryId = categoryRaw ? await getOrCreateInventoryCategory(categoryRaw) : null
              
              // Update the inventory item with new values
              await db.inventoryItem.update({
                where: { id: existing.id },
                data: {
                  sku: sku || existing.sku,
                  baseUnit,
                  stock,
                  avgCost,
                  lowStockAlert,
                  status: 'ACTIVE',
                  categoryId: invCategoryId,
                },
              })
              
              // Create new opening balance movement if stock > 0
              if (stock > 0) {
                try {
                  await db.inventoryMovement.create({
                    data: {
                      type: 'PURCHASE',
                      quantity: stock,
                      previousStock: 0,
                      newStock: stock,
                      referenceType: 'MIGRATION',
                      notes: `Saldo awal migrasi (re-migrate) dari ${file.name}`,
                      outletId,
                      inventoryItemId: existing.id,
                      userId,
                    },
                  })
                } catch (movErr) {
                  console.warn(`[migration] Failed to create re-migration movement for ${name}:`, movErr)
                }
              }
              
              inventoryItemsUpdated++
              migrationDataCleaned++
              totalStock += stock
              totalModalValue += avgCost * stock
              
              warnings.push(`🔄 "${name}": di-update (data migrasi lama dibersihkan: ${cleaned.movementsDeleted} stok, ${cleaned.compositionsDeleted} link)`)
            } else {
              // Has real history: skip with warning
              console.log(`[migration] sheet3_inventory: SKIP "${name}" - ${analysis.reason}`)
              inventoryItemsSkipped++
              warnings.push(`⚠️ "${name}" dilewati: ${analysis.reason}`)
            }
            
            inventoryItemCache.set(name, existing.id)
            continue
          }

          // Inventory category
          const invCategoryId = categoryRaw ? await getOrCreateInventoryCategory(categoryRaw) : null

          // Create InventoryItem (new item)
          const invItem = await db.inventoryItem.create({
            data: {
              name,
              sku: sku || await generateUniqueSKU(name, outletId),
              baseUnit,
              stock,
              avgCost,
              lowStockAlert,
              status: 'ACTIVE',
              outletId,
              categoryId: invCategoryId,
            },
          })

          inventoryItemsCreated++
          totalStock += stock
          totalModalValue += avgCost * stock
          inventoryItemCache.set(name, invItem.id)

          // Create opening balance movement if stock > 0
          if (stock > 0) {
            await db.inventoryMovement.create({
              data: {
                type: 'PURCHASE',
                quantity: stock,
                previousStock: 0,
                newStock: stock,
                referenceType: 'MIGRATION',
                notes: `Saldo awal migrasi dari ${file.name}`,
                outletId,
                inventoryItemId: invItem.id,
                userId,
              },
            })
          }
        }
      }

      // ──────────────────────────────────────────────
      // SHEET 4: Komposisi (Resep/BOM)
      // ──────────────────────────────────────────────
      if (sheetType === 'komposisi') {
        if (!includeInventory) {
          // Skip composition sheet in product_only mode
          continue
        }

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]
          const rowNum = i + 2

          const productName = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'name', 'Produk', 'Product']) || '').trim()
          const variantName = String(findColumn(row, ['NAMA VARIAN', 'Nama Varian', 'nama varian', 'Varian', 'Variant', 'VARIAN', 'Nama Variant']) || '').trim()
          const bahanName = String(findColumn(row, ['NAMA BAHAN*', 'NAMA BAHAN', 'Nama Bahan', 'nama bahan', 'Bahan', 'BAHAN', 'Material']) || '').trim()
          const bahanSku = String(findColumn(row, ['SKU BAHAN', 'SKU Bahan', 'sku bahan']) || '').trim() || null
          const qty = sanitizeNumber(findColumn(row, ['QTY PER BATCH*', 'QTY PER BATCH', 'QTY', 'qty', 'Qty', 'Quantity', 'Jumlah']))
          const satuanBahan = String(findColumn(row, ['SATUAN BAHAN', 'Satuan Bahan', 'satuan bahan', 'Satuan', 'satuan', 'Unit']) || '').trim().toLowerCase()
          const yieldPerBatch = sanitizeNumber(findColumn(row, ['YIELD PER BATCH', 'YIELD', 'Yield', 'yield', 'Yield Per Batch', 'Hasil per Batch', 'yield per batch'])) || 1
          const catatan = String(findColumn(row, ['CATATAN', 'Catatan', 'catatan', 'Note', 'note', 'Notes', 'Notes']) || '').trim()

          if (!productName) {
            errors.push(`Baris ${rowNum}: Nama produk wajib diisi`)
            continue
          }

          if (!bahanName) {
            errors.push(`Baris ${rowNum}: Nama bahan wajib diisi (Produk: ${productName})`)
            continue
          }

          if (!qty || qty <= 0) {
            errors.push(`Baris ${rowNum}: QTY per batch harus > 0 (Produk: ${productName}, Bahan: ${bahanName})`)
            continue
          }

          // Find product
          let productId = productCache.get(productName)
          if (!productId) {
            const product = await db.product.findFirst({ where: { name: productName, outletId }, select: { id: true } })
            if (!product) {
              errors.push(`Baris ${rowNum}: Produk "${productName}" tidak ditemukan`)
              continue
            }
            productId = product.id
            productCache.set(productName, productId)
          }

          // Find variant (if specified)
          let variantId: string | undefined
          if (variantName) {
            variantId = variantCache.get(`${productName}||${variantName}`)
            if (!variantId) {
              const variant = await db.productVariant.findFirst({
                where: { name: variantName, productId },
                select: { id: true },
              })
              if (variant) {
                variantId = variant.id
                variantCache.set(`${productName}||${variantName}`, variantId)
              } else {
                errors.push(`Baris ${rowNum}: Varian "${variantName}" tidak ditemukan untuk produk "${productName}"`)
                continue
              }
            }
          }

          // Find inventory item
          let inventoryItemId = inventoryItemCache.get(bahanName)
          if (!inventoryItemId) {
            const item = await db.inventoryItem.findFirst({
              where: { name: bahanName, outletId },
              select: { id: true },
            })
            if (!item) {
              errors.push(`Baris ${rowNum}: Bahan "${bahanName}" tidak ditemukan di inventory`)
              continue
            }
            inventoryItemId = item.id
            inventoryItemCache.set(bahanName, inventoryItemId)
          }

          // Optional: verify SKU match
          if (bahanSku) {
            const itemCheck = await db.inventoryItem.findFirst({
              where: { id: inventoryItemId, sku: bahanSku },
              select: { id: true },
            })
            if (!itemCheck) {
              errors.push(`Baris ${rowNum}: SKU bahan "${bahanSku}" tidak cocok dengan "${bahanName}"`)
            }
          }

          // Create composition link
          const unit = VALID_UNITS.includes(satuanBahan) ? satuanBahan : 'pcs'
          const effectiveYield = yieldPerBatch > 0 ? yieldPerBatch : 1

          try {
            await db.productComposition.create({
              data: {
                productId,
                variantId: variantId || null,
                inventoryItemId,
                qty,
                yieldPerBatch: effectiveYield,
                baseUnit: unit,
              },
            })
            compositionsCreated++

            // Update product hasComposition flag
            await db.product.update({
              where: { id: productId },
              data: { hasComposition: true },
            })
          } catch {
            // Duplicate — skip silently
          }
        }
      }
    }

    // ==================== PROCESS DEFERRED INLINE COMPOSITIONS ====================
    if (includeInventory && deferredInlineCompositions.length > 0) {
      // Ensure inventory items are cached
      const allInventoryItems = await db.inventoryItem.findMany({
        where: { outletId },
        select: { id: true, name: true },
      })
      for (const item of allInventoryItems) {
        inventoryItemCache.set(item.name, item.id)
      }

      for (const deferred of deferredInlineCompositions) {
        try {
          const compCount = await processInlineComposition(
            deferred.productId,
            deferred.variantId,
            deferred.compositionStr
          )
          compositionsCreated += compCount
        } catch (compErr) {
          console.error(`[migration] Failed to process deferred composition for product ${deferred.productId}:`, compErr)
          const errMsg = compErr instanceof Error ? compErr.message : String(compErr)
          errors.push(`Gagal proses komposisi inline: ${errMsg}`)
        }
      }
    }

    // ==================== COUNT TOTAL CATEGORIES ====================
    const totalCategories = await db.category.count({ where: { outletId } })

    // ==================== FLUSH REMAINING OPENING STOCK LOGS ====================
    await flushOpeningStockLogs()

    // ==================== AUDIT LOG ====================
    if (productsCreated > 0 || inventoryItemsCreated > 0 || compositionsCreated > 0) {
      await safeAuditLog({
        action: 'CREATE',
        entityType: 'PRODUCT',
        details: JSON.stringify({
          migration: true,
          mode,
          productsCreated,
          variantsCreated,
          productsSkipped,
          categoriesCreated,
          barcodeCount,
          inventoryItemsCreated: hasInventory ? inventoryItemsCreated : 0,
          inventoryItemsSkipped: hasInventory ? inventoryItemsSkipped : 0,
          inventoryItemsUpdated: hasInventory ? inventoryItemsUpdated : 0,
          migrationDataCleaned: hasInventory ? migrationDataCleaned : 0,
          compositionsCreated: includeInventory ? compositionsCreated : 0,
          totalStock: hasInventory ? totalStock : 0,
          totalModalValue: hasInventory ? totalModalValue : 0,
          errors: errors.length,
          warnings: warnings.length,
          fileName: file.name,
        }),
        outletId,
        userId,
      })
    }

    return safeJson({
      productsCreated,
      variantsCreated,
      productsSkipped,
      categoriesCreated,
      barcodeCount,
      inventoryItemsCreated,
      inventoryItemsSkipped,
      inventoryItemsUpdated,
      migrationDataCleaned,
      compositionsCreated,
      totalStock,
      totalModalValue,
      errors,
      warnings,
      mode,
      totalCategories: await db.category.count({ where: { outletId } }),
    })
  } catch (error) {
    console.error('Migration import error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses import', details: message }, 500)
  }
}
