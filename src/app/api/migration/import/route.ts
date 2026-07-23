import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getFeaturesForOutlet, isUnlimited } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { generateUniqueSKU, generateVariantSKU } from '@/lib/sku-generator'

export const maxDuration = 9000

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
  tx: PrismaClient,
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
    const item = await tx.inventoryItem.findFirst({
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
      const movementTypes = await tx.inventoryMovement.groupBy({
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
      const compositions = await tx.productComposition.findMany({
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
  tx: PrismaClient,
  inventoryItemId: string,
  outletId: string
): Promise<{ movementsDeleted: number; compositionsDeleted: number }> {
  let movementsDeleted = 0
  let compositionsDeleted = 0

  try {
    // Delete MIGRATION-type movements
    const movResult = await tx.inventoryMovement.deleteMany({
      where: {
        inventoryItemId: inventoryItemId,
        referenceType: 'MIGRATION',
        outletId,
      },
    })
    movementsDeleted = movResult.count

    // Delete auto 1:1 compositions linked to this inventory item
    // These are compositions with qty=1 that were created by product_stock mode
    const compResult = await tx.productComposition.deleteMany({
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

const PRODUCT_BATCH_SIZE = 50
const LOOKUP_BATCH_SIZE = 500

type ParsedSheet = {
  name: string
  type: SheetType
  rows: Record<string, unknown>[]
}

type ProductGroup =
  | { kind: 'non_varian'; productName: string; rows: Array<{ row: Record<string, unknown>; rowNum: number }> }
  | { kind: 'varian'; productName: string; rows: Array<{ row: Record<string, unknown>; rowNum: number }> }

type ImportCounters = {
  productsCreated: number
  variantsCreated: number
  productsSkipped: number
  categoriesCreated: number
  barcodeCount: number
  inventoryItemsCreated: number
  inventoryItemsSkipped: number
  inventoryItemsUpdated: number
  migrationDataCleaned: number
  compositionsCreated: number
  totalStock: number
  totalModalValue: number
}

function emptyCounters(): ImportCounters {
  return {
    productsCreated: 0,
    variantsCreated: 0,
    productsSkipped: 0,
    categoriesCreated: 0,
    barcodeCount: 0,
    inventoryItemsCreated: 0,
    inventoryItemsSkipped: 0,
    inventoryItemsUpdated: 0,
    migrationDataCleaned: 0,
    compositionsCreated: 0,
    totalStock: 0,
    totalModalValue: 0,
  }
}

function addCounters(target: ImportCounters, source: ImportCounters) {
  for (const key of Object.keys(target) as Array<keyof ImportCounters>) {
    target[key] += source[key]
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

function normalizeName(value: unknown): string {
  return String(value || '').trim()
}

function extractProductName(row: Record<string, unknown>): string {
  return normalizeName(findColumn(row, [
    'NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name',
    'Product Name', 'Produk',
  ]))
}

async function loadExistingProductNames(outletId: string, names: string[]): Promise<Set<string>> {
  const result = new Set<string>()
  for (const nameBatch of chunk([...new Set(names)], LOOKUP_BATCH_SIZE)) {
    const rows = await db.product.findMany({
      where: { outletId, name: { in: nameBatch } },
      select: { name: true },
    })
    rows.forEach(row => result.add(row.name))
  }
  return result
}

function buildProductGroups(sheets: ParsedSheet[]): ProductGroup[] {
  const groups: ProductGroup[] = []

  for (const sheet of sheets) {
    if (sheet.type === 'non_varian') {
      for (let index = 0; index < sheet.rows.length; index++) {
        const row = sheet.rows[index]
        const productName = extractProductName(row)
        if (!productName) continue
        groups.push({
          kind: 'non_varian',
          productName,
          rows: [{ row, rowNum: index + 2 }],
        })
      }
    }

    if (sheet.type === 'varian') {
      let current: ProductGroup | null = null
      for (let index = 0; index < sheet.rows.length; index++) {
        const row = sheet.rows[index]
        const productName = extractProductName(row)
        if (productName) {
          current = {
            kind: 'varian',
            productName,
            rows: [{ row, rowNum: index + 2 }],
          }
          groups.push(current)
        } else if (current) {
          current.rows.push({ row, rowNum: index + 2 })
        }
      }
    }
  }

  // One finished Product record per unique product name. Keep the first group;
  // duplicate names are handled as skips during processing/retry.
  const unique = new Map<string, ProductGroup>()
  for (const group of groups) {
    if (!unique.has(group.productName)) unique.set(group.productName, group)
  }
  return [...unique.values()]
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya OWNER yang dapat melakukan migrasi data', 403)
    }

    const outletId = user.outletId
    const userId = user.id

    // Webmaster Plan.features JSON is authoritative. Static plan-config values
    // are only fallback values inside getFeaturesForOutlet.
    const outletPlan = await getFeaturesForOutlet(db, outletId)
    if (!outletPlan) return safeJsonError('Outlet tidak ditemukan', 404)
    if (!outletPlan.features.bulkUpload) {
      return safeJsonError('Fitur import migrasi hanya tersedia untuk akun Pro ke atas. Upgrade sekarang!', 403)
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const mode = String(formData.get('mode') || 'product_only')
    if (!file) return safeJsonError('File tidak ditemukan', 400)

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      return safeJsonError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400)
    }
    if (file.size > 5 * 1024 * 1024) {
      return safeJsonError('Ukuran file maksimal 5MB', 400)
    }

    let workbook: XLSX.WorkBook
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch {
      return safeJsonError('File tidak dapat dibaca. Pastikan file Excel valid.', 400)
    }
    if (workbook.SheetNames.length === 0) return safeJsonError('File Excel kosong', 400)

    const sheets: ParsedSheet[] = workbook.SheetNames.map(name => {
      const type = detectSheetType(name)
      const sheet = workbook.Sheets[name]
      const rows = sheet && type !== 'unknown' && type !== 'guide'
        ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
        : []
      return { name, type, rows }
    }).filter(sheet => sheet.type !== 'unknown' && sheet.type !== 'guide')

    const totalInputRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0)
    const productGroups = buildProductGroups(sheets)
    const incomingNames = productGroups.map(group => group.productName)
    const existingProductNames = await loadExistingProductNames(outletId, incomingNames)
    const incomingNewProductNames = incomingNames.filter(name => !existingProductNames.has(name))

    const currentProductCount = await db.product.count({ where: { outletId } })
    const maxProducts = outletPlan.features.maxProducts
    const projectedProductCount = currentProductCount + incomingNewProductNames.length

    // maxProducts is the only Migration Wizard quota. Batch size is a technical
    // Neon safety boundary and is intentionally independent from plan quota.
    if (!isUnlimited(maxProducts) && projectedProductCount > maxProducts) {
      return safeJsonError(
        `Batas produk paket terlampaui. Produk saat ini: ${currentProductCount}, produk baru: ${incomingNewProductNames.length}, batas paket: ${maxProducts}, sisa kapasitas: ${Math.max(0, maxProducts - currentProductCount)}.`,
        403,
      )
    }

    const includeInventory = mode === 'product_inventory'
    const isStockMode = mode === 'product_stock'
    const hasInventory = includeInventory || isStockMode
    const errors: string[] = []
    const warnings: string[] = []
    const totals = emptyCounters()
    const productBatches = chunk(productGroups, PRODUCT_BATCH_SIZE)

    let completedBatches = 0
    let failedBatch: number | null = null
    let technicalError: string | null = null

    // Phase 1: product groups. One transaction per maximum 50 finished products.
    for (let batchIndex = 0; batchIndex < productBatches.length; batchIndex++) {
      const currentBatch = productBatches[batchIndex]
      try {
        const batchResult = await db.$transaction(async tx => {
          const counters = emptyCounters()
          const categoryCache = new Map<string, string | null>()

          async function getOrCreateCategory(name: string): Promise<string | null> {
            if (!name) return null
            if (categoryCache.has(name)) return categoryCache.get(name)!
            const existing = await tx.category.findFirst({ where: { name, outletId } })
            if (existing) {
              categoryCache.set(name, existing.id)
              return existing.id
            }
            const created = await tx.category.create({ data: { name, outletId, color: 'zinc' } })
            counters.categoriesCreated++
            categoryCache.set(name, created.id)
            return created.id
          }

          for (const group of currentBatch) {
            const first = group.rows[0]
            const row = first.row
            const rowNum = first.rowNum
            const name = group.productName

            const existingProduct = await tx.product.findFirst({ where: { name, outletId } })
            if (existingProduct) {
              counters.productsSkipped++
              continue
            }

            const sku = normalizeName(findColumn(row, ['SKU', 'SKU PRODUK', 'sku', 'Kode'])) || null
            const barcode = normalizeName(findColumn(row, ['BARCODE', 'BARCODE PRODUK', 'Barcode', 'barcode'])) || null
            const hpp = sanitizeNumber(findColumn(row, ['HPP / MODAL (Rp)', 'HPP PRODUK (Rp)', 'HPP', 'Harga Pokok', 'Modal']))
            const price = sanitizeNumber(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL PRODUK* (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price']))
            const stock = sanitizeNumber(findColumn(row, ['STOK AWAL', 'STOK', 'QTY / STOK', 'QTY', 'Stok', 'Stock']))
            const unitRaw = normalizeName(findColumn(row, ['SATUAN', 'Satuan', 'Unit']))?.toLowerCase() || 'pcs'
            const categoryRaw = normalizeName(findColumn(row, ['KATEGORI', 'Kategori', 'Category']))
            const lowStockAlert = sanitizeNumber(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'STOK MINIMUM']))
            const inlineComposition = normalizeName(findColumn(row, ['KOMPOSISI INLINE', 'Komposisi Inline', 'KOMPOSISI']))

            if (!name) {
              errors.push(`Baris ${rowNum}: Nama produk wajib diisi`)
              continue
            }
            if (price < 0) {
              errors.push(`Baris ${rowNum}: Harga jual tidak boleh negatif (${name})`)
              continue
            }
            if (hpp < 0 || stock < 0) {
              errors.push(`Baris ${rowNum}: HPP dan stok tidak boleh negatif (${name})`)
              continue
            }

            const unit = VALID_UNITS.includes(unitRaw) ? unitRaw : 'pcs'
            const categoryId = await getOrCreateCategory(categoryRaw)
            const finalSku = sku || await generateUniqueSKU(name, outletId)
            const finalBarcode = barcode || finalSku
            const product = await tx.product.create({
              data: {
                name,
                sku: finalSku,
                barcode: finalBarcode,
                hpp,
                price,
                stock: group.kind === 'varian' ? 0 : stock,
                unit,
                categoryId,
                outletId,
                lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 10,
                hasVariants: group.kind === 'varian',
                hasComposition: (includeInventory && !!inlineComposition) || isStockMode,
              },
            })
            counters.productsCreated++
            if (finalBarcode) counters.barcodeCount++

            if (group.kind === 'varian') {
              for (const entry of group.rows) {
                const variantName = normalizeName(findColumn(entry.row, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Varian']))
                if (!variantName) continue
                const existingVariant = await tx.productVariant.findFirst({ where: { productId: product.id, name: variantName } })
                if (existingVariant) continue
                const variantHpp = sanitizeNumber(findColumn(entry.row, ['HPP VARIAN (Rp)', 'HPP VARIAN', 'HPP Varian']))
                const variantPrice = sanitizeNumber(findColumn(entry.row, ['HARGA JUAL VARIAN* (Rp)', 'HARGA JUAL VARIAN', 'Harga Jual Varian']))
                const variantStock = sanitizeNumber(findColumn(entry.row, ['STOK AWAL VARIAN', 'STOK VARIAN', 'Stok Varian']))
                if (variantHpp < 0 || variantPrice < 0 || variantStock < 0) {
                  errors.push(`Baris ${entry.rowNum}: Nilai varian tidak valid (${name} / ${variantName})`)
                  continue
                }
                const variantSku = normalizeName(findColumn(entry.row, ['SKU VARIAN', 'SKU Varian'])) || await generateVariantSKU(name, variantName, outletId)
                const variantBarcode = normalizeName(findColumn(entry.row, ['BARCODE VARIAN', 'Barcode Varian'])) || variantSku
                const variant = await tx.productVariant.create({
                  data: { productId: product.id, name: variantName, sku: variantSku, barcode: variantBarcode, hpp: variantHpp, price: variantPrice, stock: variantStock, outletId },
                })
                counters.variantsCreated++
                if (variantBarcode) counters.barcodeCount++
                if (variantStock > 0) {
                  await tx.auditLog.create({
                    data: {
                      action: 'RESTOCK', entityType: 'VARIANT', entityId: variant.id, outletId, userId,
                      details: JSON.stringify({ productName: name, variantName, initialStock: variantStock, newStock: variantStock, reason: 'Stok awal migrasi' }),
                    },
                  })
                }
              }
            } else if (stock > 0) {
              await tx.auditLog.create({
                data: {
                  action: 'RESTOCK', entityType: 'PRODUCT', entityId: product.id, outletId, userId,
                  details: JSON.stringify({ productName: name, productSku: finalSku, initialStock: stock, newStock: stock, reason: 'Stok awal migrasi' }),
                },
              })
            }

            // product_stock / product_inventory: keep Product + InventoryItem +
            // opening movement + 1:1 link in the SAME 50-product transaction.
            if (hasInventory && stock > 0 && group.kind === 'non_varian') {
              let inventoryItem = await tx.inventoryItem.findFirst({ where: { name, outletId } })
              if (!inventoryItem) {
                inventoryItem = await tx.inventoryItem.create({
                  data: {
                    name, sku: finalSku, baseUnit: unit, stock, avgCost: hpp > 0 ? hpp : 0,
                    lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 0,
                    status: 'ACTIVE', outletId, categoryId: null,
                  },
                })
                counters.inventoryItemsCreated++
                counters.totalStock += stock
                counters.totalModalValue += hpp * stock
                await tx.inventoryMovement.create({
                  data: {
                    type: 'PURCHASE', quantity: stock, previousStock: 0, newStock: stock,
                    referenceType: 'MIGRATION', notes: `Saldo awal migrasi dari ${file.name}`,
                    outletId, inventoryItemId: inventoryItem.id, userId,
                  },
                })
              } else {
                counters.inventoryItemsSkipped++
              }

              if (isStockMode) {
                const exists = await tx.productComposition.findFirst({
                  where: { productId: product.id, inventoryItemId: inventoryItem.id, variantId: null },
                })
                if (!exists) {
                  await tx.productComposition.create({
                    data: { productId: product.id, inventoryItemId: inventoryItem.id, qty: 1, yieldPerBatch: 1, baseUnit: unit },
                  })
                  counters.compositionsCreated++
                }
              }
            }
          }
          return counters
        }, { timeout: 60000 })

        addCounters(totals, batchResult)
        completedBatches++
      } catch (error) {
        failedBatch = batchIndex + 1
        technicalError = error instanceof Error ? error.message : String(error)
        break
      }
    }

    // Do not process dependent inventory/composition sheets after a technical
    // product-batch failure. Already committed product batches remain safe.
    if (failedBatch === null && includeInventory) {
      const inventoryRows = sheets.filter(s => s.type === 'inventory').flatMap(s => s.rows.map((row, index) => ({ row, rowNum: index + 2 })))
      for (const inventoryBatch of chunk(inventoryRows, PRODUCT_BATCH_SIZE)) {
        try {
          const batchResult = await db.$transaction(async tx => {
            const counters = emptyCounters()
            for (const entry of inventoryBatch) {
              const name = normalizeName(findColumn(entry.row, ['NAMA ITEM*', 'NAMA ITEM', 'NAMA BAHAN*', 'NAMA BAHAN', 'Nama Bahan', 'Bahan', 'Nama']))
              if (!name) { errors.push(`Baris ${entry.rowNum}: Nama item stok wajib diisi`); continue }
              const sku = normalizeName(findColumn(entry.row, ['SKU', 'Kode'])) || null
              const unitRaw = normalizeName(findColumn(entry.row, ['SATUAN DASAR*', 'SATUAN DASAR', 'Satuan Dasar', 'Satuan', 'Unit'])).toLowerCase() || 'pcs'
              const stock = sanitizeNumber(findColumn(entry.row, ['STOK AWAL', 'STOK', 'QTY', 'Stok', 'Stock']))
              const avgCost = sanitizeNumber(findColumn(entry.row, ['HPP RATA-RATA (Rp)', 'HPP RATA-RATA', 'HPP', 'Harga Pokok']))
              const lowStockAlert = sanitizeNumber(findColumn(entry.row, ['LOW STOCK ALERT', 'Low Stock Alert', 'STOK MINIMUM']))
              if (stock < 0 || avgCost < 0) { errors.push(`Baris ${entry.rowNum}: Stok/HPP tidak boleh negatif (${name})`); continue }
              const baseUnit = VALID_UNITS.includes(unitRaw) ? unitRaw : 'pcs'
              const existing = await tx.inventoryItem.findFirst({ where: { name, outletId } })
              if (existing) { counters.inventoryItemsSkipped++; continue }
              const item = await tx.inventoryItem.create({
                data: { name, sku: sku || await generateUniqueSKU(name, outletId), baseUnit, stock, avgCost, lowStockAlert, status: 'ACTIVE', outletId, categoryId: null },
              })
              counters.inventoryItemsCreated++
              counters.totalStock += stock
              counters.totalModalValue += avgCost * stock
              if (stock > 0) {
                await tx.inventoryMovement.create({
                  data: { type: 'PURCHASE', quantity: stock, previousStock: 0, newStock: stock, referenceType: 'MIGRATION', notes: `Saldo awal migrasi dari ${file.name}`, outletId, inventoryItemId: item.id, userId },
                })
              }
            }
            return counters
          }, { timeout: 60000 })
          addCounters(totals, batchResult)
        } catch (error) {
          failedBatch = completedBatches + 1
          technicalError = error instanceof Error ? error.message : String(error)
          break
        }
      }
    }

    if (failedBatch === null && includeInventory) {
      const compositionRows = sheets.filter(s => s.type === 'komposisi').flatMap(s => s.rows.map((row, index) => ({ row, rowNum: index + 2 })))
      for (const compositionBatch of chunk(compositionRows, PRODUCT_BATCH_SIZE)) {
        try {
          const created = await db.$transaction(async tx => {
            let count = 0
            for (const entry of compositionBatch) {
              const productName = normalizeName(findColumn(entry.row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Produk']))
              const variantName = normalizeName(findColumn(entry.row, ['NAMA VARIAN', 'Nama Varian', 'Varian']))
              const bahanName = normalizeName(findColumn(entry.row, ['NAMA BAHAN*', 'NAMA BAHAN', 'Nama Bahan', 'Bahan']))
              const qty = sanitizeNumber(findColumn(entry.row, ['QTY PER BATCH*', 'QTY PER BATCH', 'QTY', 'Jumlah']))
              const unitRaw = normalizeName(findColumn(entry.row, ['SATUAN BAHAN', 'Satuan Bahan', 'Satuan', 'Unit'])).toLowerCase()
              const yieldPerBatch = sanitizeNumber(findColumn(entry.row, ['YIELD PER BATCH', 'YIELD', 'Hasil per Batch'])) || 1
              if (!productName || !bahanName || qty <= 0) { errors.push(`Baris ${entry.rowNum}: Data komposisi tidak lengkap`); continue }
              const product = await tx.product.findFirst({ where: { name: productName, outletId }, select: { id: true } })
              const item = await tx.inventoryItem.findFirst({ where: { name: bahanName, outletId }, select: { id: true } })
              if (!product || !item) { errors.push(`Baris ${entry.rowNum}: Produk/bahan komposisi tidak ditemukan`); continue }
              const variant = variantName ? await tx.productVariant.findFirst({ where: { productId: product.id, name: variantName }, select: { id: true } }) : null
              const duplicate = await tx.productComposition.findFirst({ where: { productId: product.id, variantId: variant?.id || null, inventoryItemId: item.id } })
              if (duplicate) continue
              await tx.productComposition.create({
                data: { productId: product.id, variantId: variant?.id || null, inventoryItemId: item.id, qty, yieldPerBatch: yieldPerBatch > 0 ? yieldPerBatch : 1, baseUnit: VALID_UNITS.includes(unitRaw) ? unitRaw : 'pcs' },
              })
              await tx.product.update({ where: { id: product.id }, data: { hasComposition: true } })
              count++
            }
            return count
          }, { timeout: 60000 })
          totals.compositionsCreated += created
        } catch (error) {
          failedBatch = completedBatches + 1
          technicalError = error instanceof Error ? error.message : String(error)
          break
        }
      }
    }

    const status = failedBatch !== null
      ? (completedBatches > 0 ? 'PARTIAL' : 'FAILED')
      : (errors.length > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED')

    const remainingProducts = failedBatch === null
      ? 0
      : productBatches.slice(failedBatch - 1).reduce((sum, batch) => sum + batch.length, 0)

    await safeAuditLog({
      action: 'CREATE',
      entityType: 'PRODUCT',
      outletId,
      userId,
      details: JSON.stringify({
        migration: true,
        fileName: file.name,
        mode,
        status,
        maxProducts,
        currentProductCount,
        incomingNewProducts: incomingNewProductNames.length,
        productBatchSize: PRODUCT_BATCH_SIZE,
        totalBatches: productBatches.length,
        completedBatches,
        failedBatch,
        technicalError,
        ...totals,
        errors: errors.length,
        warnings: warnings.length,
      }),
    })

    return safeJson({
      status,
      mode,
      totalInputRows,
      maxProducts,
      currentProductCount,
      incomingUniqueProducts: incomingNames.length,
      incomingNewProducts: incomingNewProductNames.length,
      projectedProductCount,
      productBatchSize: PRODUCT_BATCH_SIZE,
      totalBatches: productBatches.length,
      completedBatches,
      failedBatch,
      remainingProducts,
      technicalError,
      ...totals,
      errors,
      warnings,
      totalCategories: await db.category.count({ where: { outletId } }),
    })
  } catch (error) {
    console.error('Migration import error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ status: 'FAILED', error: 'Gagal memproses import', details: message }, 500)
  }
}
