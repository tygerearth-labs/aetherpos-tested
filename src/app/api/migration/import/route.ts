import { NextRequest } from 'next/server'
import { PrismaClient, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getFeaturesForOutlet, isUnlimited } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { generateUniqueSKU, generateVariantSKU } from '@/lib/sku-generator'

export const maxDuration = 300

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

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }

    // MIG-002 (P1) / CREW-004: OWNER-only role check.
    // Front-end UI restricts the migration banner to OWNER with 0 products
    // (dashboard-page.tsx:86 `isOwner && totalProducts === 0`), but the API
    // endpoint must enforce this independently to prevent Cashier/Crew from
    // bypassing the UI restriction via direct curl/fetch.
    // Mirrors products/bulk-update/route.ts:12-14 and products/bulk-delete/route.ts:17-19.
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya OWNER yang dapat melakukan migrasi data', 403)
    }

    const outletId = user.outletId
    const userId = user.id

    // Check plan — DB-aware resolution (Webmaster Plan DB is authoritative).
    // getFeaturesForOutlet merges Plan table features over static PLANS defaults,
    // so webmaster-configured maxBulkUploadRows (-1 = unlimited) is honored.
    const outletPlan = await getFeaturesForOutlet(db, outletId)
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
    // MIG-BATCH: resume support — startBatch skips already-completed batches.
    // Dedup is name-based (tx.product.findFirst by name), so resuming is
    // inherently safe: already-created products become "skipped duplicates".
    const startBatchParam = Math.max(0, parseInt(String(formData.get('startBatch') || '0')) || 0)
    // MIG-BATCH-V2: one-request-per-batch mode. When batchNumber is provided,
    // the route processes ONLY that batch and returns per-batch stats. The
    // frontend loops through batches 0..N-1 for real-time progress.
    const batchNumberParamRaw = parseInt(String(formData.get('batchNumber') || ''))
    const singleBatchMode = !isNaN(batchNumberParamRaw)

    if (!file) {
      return safeJsonError('File tidak ditemukan', 400)
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      return safeJsonError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400)
    }

    // MIG-006 (P1): Align back-end file size limit to 5MB.
    // Front-end migration-wizard.tsx:80 caps at 5MB; previously the back-end
    // accepted 10MB, allowing direct API callers to bypass the front-end cap.
    // Mirrors bulk-upload, bulk-update-excel, inventory/items/bulk-update-excel,
    // purchases/import-excel (all 5MB both sides).
    if (file.size > 5 * 1024 * 1024) {
      return safeJsonError('Ukuran file maksimal 5MB', 400)
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

    // MIG-BATCH-V3: Quota uses ONLY DB-aware features.maxProducts (enforced
    // below). maxBulkUploadRows is intentionally NOT enforced here per founder
    // rule ("Jangan gunakan maxBulkUploadRows"). The bulkUpload boolean gate
    // above still rejects Free plan; Pro/Enterprise are gated by maxProducts.
    let totalSheetRows = 0
    for (const sheetName of workbook.SheetNames) {
      const sheetType = detectSheetType(sheetName)
      if (sheetType === 'unknown' || sheetType === 'guide') continue
      const sheetToCount = workbook.Sheets[sheetName]
      if (!sheetToCount) continue
      const rowsToCount = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheetToCount, { defval: '' })
      totalSheetRows += rowsToCount.length
    }
    const planMaxRows = outletPlan.features.maxBulkUploadRows

    const includeInventory = mode === 'product_inventory'
    const isStockMode = mode === 'product_stock'
    const hasInventory = includeInventory || isStockMode

    // ==================== STATS (outside tx — shared across batch txs) ====================
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

    // ==================== CACHES (outside tx — shared across batch txs) ====================
    const categoryCache = new Map<string, string | null>()
    const inventoryCategoryCache = new Map<string, string | null>()
    const inventoryItemCache = new Map<string, string>() // name → id
    const productCache = new Map<string, string>() // name → id
    const variantCache = new Map<string, string>() // "productName||variantName" → id
    const deferredInlineCompositions: {
      productId: string
      variantId?: string
      compositionStr: string
    }[] = []

    // Batch audit logs for opening stock (flushed after each batch to avoid N+1)
    const openingStockLogs: Array<{
      action: string
      entityType: string
      entityId: string
      details: string
      outletId: string
      userId: string
    }> = []
    const OPENING_STOCK_BATCH_SIZE = 200

    // ==================== HELPERS (accept tx parameter) ====================

    async function flushOpeningStockLogs(tx: Prisma.TransactionClient) {
      if (openingStockLogs.length === 0) return
      try {
        await tx.auditLog.createMany({ data: openingStockLogs })
      } catch (e) {
        console.warn('[migration] Failed to batch-create opening stock audit logs:', e)
      }
      openingStockLogs.length = 0
    }

    async function getOrCreateCategory(tx: Prisma.TransactionClient, name: string): Promise<string | null> {
      if (categoryCache.has(name)) {
        return categoryCache.get(name)!
      }
      const existing = await tx.category.findFirst({ where: { name, outletId } })
      if (existing) {
        categoryCache.set(name, existing.id)
        return existing.id
      }
      const created = await tx.category.create({
        data: { name, outletId, color: 'zinc' },
      })
      categoriesCreated++
      categoryCache.set(name, created.id)
      return created.id
    }

    async function getOrCreateInventoryCategory(tx: Prisma.TransactionClient, name: string): Promise<string | null> {
      if (inventoryCategoryCache.has(name)) {
        return inventoryCategoryCache.get(name)!
      }
      const existing = await tx.inventoryCategory.findFirst({ where: { name, outletId } })
      if (existing) {
        inventoryCategoryCache.set(name, existing.id)
        return existing.id
      }
      const created = await tx.inventoryCategory.create({
        data: { name, outletId, color: 'zinc' },
      })
      categoriesCreated++
      inventoryCategoryCache.set(name, created.id)
      return created.id
    }

    async function checkProductLimit(tx: Prisma.TransactionClient): Promise<boolean> {
      if (isUnlimited(outletPlan!.features.maxProducts)) return true
      const currentCount = await tx.product.count({ where: { outletId } })
      return currentCount < outletPlan!.features.maxProducts
    }

    async function findInventoryItemByName(tx: Prisma.TransactionClient, name: string): Promise<string | null> {
      // Check cache first
      if (inventoryItemCache.has(name)) return inventoryItemCache.get(name)!
      // Check DB
      const item = await tx.inventoryItem.findFirst({ where: { name, outletId }, select: { id: true } })
      if (item) {
        inventoryItemCache.set(name, item.id)
        return item.id
      }
      return null
    }

    async function processInlineComposition(
      tx: Prisma.TransactionClient,
      productId: string,
      variantId: string | undefined,
      compositionStr: string
    ): Promise<number> {
      const parsed = parseInlineComposition(compositionStr)
      if (parsed.length === 0) return 0

      let created = 0
      for (const comp of parsed) {
        const invItemId = await findInventoryItemByName(tx, comp.name)
        if (!invItemId) {
          errors.push(`Komposisi inline: bahan "${comp.name}" tidak ditemukan di inventory`)
          continue
        }
        try {
          await tx.productComposition.create({
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

    // ==================== COLLECT SHEETS UPFRONT ====================
    const sheetsToProcess: Array<{ sheetName: string; sheetType: SheetType; rows: Record<string, unknown>[] }> = []
    for (const sheetName of workbook.SheetNames) {
      const sheetType = detectSheetType(sheetName)
      if (sheetType === 'unknown' || sheetType === 'guide') continue
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (rows.length === 0) continue
      sheetsToProcess.push({ sheetName, sheetType, rows })
    }

    // ==================== PRE-FLIGHT QUOTA CHECK ====================
    // Founder rule: existing active products + unique new Product records
    // that will actually be created must not exceed features.maxProducts.
    // Exclude duplicates that will be skipped. Reject before any write.
    const maxProducts = outletPlan!.features.maxProducts
    if (!isUnlimited(maxProducts)) {
      const currentProductCount = await db.product.count({ where: { outletId } })
      // Collect existing product names for dedup
      const existingProductNames = new Set<string>(
        (await db.product.findMany({ where: { outletId }, select: { name: true } })).map(p => p.name)
      )
      // Count unique new product names from non_varian + varian sheets
      const newProductNames = new Set<string>()
      for (const s of sheetsToProcess) {
        if (s.sheetType === 'non_varian') {
          for (const row of s.rows) {
            const name = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
            if (name && !existingProductNames.has(name) && !newProductNames.has(name)) {
              newProductNames.add(name)
            }
          }
        } else if (s.sheetType === 'varian') {
          for (const row of s.rows) {
            const parentName = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
            if (parentName && !existingProductNames.has(parentName) && !newProductNames.has(parentName)) {
              newProductNames.add(parentName)
            }
          }
        }
      }
      const projectedTotal = currentProductCount + newProductNames.size
      if (projectedTotal > maxProducts) {
        return safeJsonError(
          `Batas produk tercapai. Produk saat ini: ${currentProductCount} + produk baru unik: ${newProductNames.size} = ${projectedTotal}, melebihi batas paket (${maxProducts}). Silakan upgrade paket.`,
          403
        )
      }
    }

    // ==================== BATCH PROCESSING (non_varian) ====================
    // MIG-BATCH: Process non_varian products sequentially in batches of 50.
    // Each batch runs in its own safe transaction. This prevents Neon Free
    // from receiving one giant write/transaction. The business quota
    // (maxProducts) is enforced above; BATCH_SIZE=50 is the DB safety limit.
    const BATCH_SIZE = 50
    const nonVarianSheet = sheetsToProcess.find(s => s.sheetType === 'non_varian')
    const nonVarianRows = nonVarianSheet?.rows || []
    const totalProducts = nonVarianRows.length
    const totalBatches = totalProducts > 0 ? Math.ceil(totalProducts / BATCH_SIZE) : 0

    // MIG-BATCH-V2: validate batchNumber for single-batch mode
    if (singleBatchMode) {
      if (batchNumberParamRaw < 0 || batchNumberParamRaw >= totalBatches) {
        return safeJsonError(
          `Batch tidak valid: ${batchNumberParamRaw}. Total batch: ${totalBatches}${totalBatches === 0 ? ' (file kosong atau tidak ada sheet non-varian)' : ''}.`,
          400
        )
      }
    }

    const targetBatch = singleBatchMode ? batchNumberParamRaw : startBatchParam
    let completedBatches = targetBatch
    let currentBatch = targetBatch
    let batchFailed = false
    let batchError: string | null = null
    let batchDurationMs = 0

    // MIG-BATCH-V2: In single-batch mode, process only targetBatch. In old
    // mode (backward compat), process all batches from startBatchParam to end.
    const targetBatches = singleBatchMode
      ? [targetBatch]
      : Array.from({ length: totalBatches - startBatchParam }, (_, i) => i + startBatchParam)

    for (const b of targetBatches) {
      currentBatch = b
      const batchStart = b * BATCH_SIZE
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalProducts)
      const batchStartTime = Date.now()

      try {
        // MIG-BATCH-TEST: Forced failure hook for PARTIAL scenario verification.
        // Set env MIG_FORCE_FAIL_BATCH=N to force batch N (0-indexed) to throw.
        // Test-only; remove after verification.
        const forceFailBatch = parseInt(process.env.MIG_FORCE_FAIL_BATCH || '') 
        if (!isNaN(forceFailBatch) && b === forceFailBatch) {
          throw new Error(`FORCED_FAIL: batch ${b + 1} (test hook)`)
        }
        await db.$transaction(async (tx) => {
          // ──────────────────────────────────────────────
          // SHEET 1: Produk Non-Varian (batched)
          // ──────────────────────────────────────────────
          for (let i = batchStart; i < batchEnd; i++) {
            const row = nonVarianRows[i]
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

            // MIG-003 (P1): Negative value validation.
            if (hpp < 0) {
              errors.push(`Baris ${rowNum}: HPP tidak boleh negatif (Nama: ${name})`)
              continue
            }
            if (stock < 0) {
              errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Nama: ${name})`)
              continue
            }

            const unit = VALID_UNITS.includes(unitRaw) ? unitRaw : 'pcs'

            // Check product limit (defense-in-depth inside each batch)
            if (!(await checkProductLimit(tx))) {
              errors.push(`Baris ${rowNum}: Batas produk tercapai`)
              break
            }

            // Skip duplicates
            const existing = await tx.product.findFirst({
              where: { name, outletId },
            })
            if (existing) {
              // Still cache the product for composition linking
              productCache.set(name, existing.id)
              productsSkipped++
              continue
            }

            // Category
            const categoryId = categoryRaw ? await getOrCreateCategory(tx, categoryRaw) : null

            // Auto-generate SKU/Barcode
            const finalSku = sku || await generateUniqueSKU(name, outletId)
            const finalBarcode = barcode || finalSku

            // Create Product
            const product = await tx.product.create({
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
                await flushOpeningStockLogs(tx)
              }
            }

            // === Mode 3 (product_inventory): NO auto-inventory-item creation ===
            // (Opsi B — per investigasi "produk & inventori tidak link")
            //
            // In Mode 3, bahan baku (raw materials) and produk jadi (finished goods)
            // are conceptually DISTINCT. A product's stock lives in `Product.stock`
            // (set above at line 747 from the STOK AWAL column). InventoryItem rows
            // exist ONLY for raw materials declared in Sheet 3 ("Bahan Baku"), and
            // the Product↔Inventory link exists ONLY via explicit BOM rows
            // (Sheet 4 "Komposisi" or the KOMPOSISI INLINE column).
            //
            // The previous version of this branch auto-created an InventoryItem with
            // the SAME name as the product whenever `stock > 0`, which produced an
            // orphan inventory item (no ProductComposition link) → the symptom
            // "produk berhasil di-upload tapi inventori tidak link". That auto-creation
            // is intentionally REMOVED here.
            //
            // Effect:
            //   • Product.stock is still set from STOK AWAL (line 747).
            //   • Sheet 3 + Sheet 4 still create InventoryItems + ProductComposition
            //     (handlers below) — that is the ONLY way products get linked to
            //     inventory in Mode 3.
            //   • KOMPOSISI INLINE still creates ProductComposition via the deferred
            //     block (below), linking to existing / Sheet-3 items.
            //   • If neither BOM source is filled, the product has no composition →
            //     selling it reduces Product.stock only (no raw-material consumption).
            //     This is the correct Mode-3-degenerates-to-Mode-1 behaviour.
            //
            // (No inventory mutation here — intentionally empty.)

            // === product_stock mode: ATOMIC 1:1 InventoryItem + ProductComposition + hasComposition ===
            // Approved invariant (2025-01): Product + InventoryItem + 1:1 ProductComposition
            // + hasComposition=true are ONE atomic unit. Any failure throws and rolls
            // back the batch transaction (caught at the batch try/catch below).
            //
            // stock=0 is handled the same as stock>0: an InventoryItem(stock=0) and a
            // 1:1 link are still created, so that sales decrement inventory correctly
            // (going negative triggers the low-stock / insufficient-stock path) and
            // restock flows through the inventory ledger.
            if (isStockMode) {
              console.log(`[migration] product_stock: Processing "${name}" with stock=${stock}, unit=${unit}`)

              // ── Resolve or create InventoryItem (named after the product) ──
              const existingInv = await tx.inventoryItem.findFirst({
                where: { name, outletId },
              })

              let invItemId: string
              if (!existingInv) {
                // ── NEW ITEM: Create fresh ──
                console.log(`[migration] product_stock: Creating NEW inventory for "${name}"`)
                const invItem = await tx.inventoryItem.create({
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

                // Opening balance movement — audit-only (failure is non-fatal to the invariant)
                try {
                  await tx.inventoryMovement.create({
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
                } catch (movErr) {
                  console.warn(`[migration] Failed to create opening balance movement for ${name}:`, movErr)
                }
              } else {
                // ── EXISTING ITEM: Smart re-migration handling ──
                console.log(`[migration] product_stock: Found existing inventory "${name}" (id=${existingInv.id}), analyzing...`)

                const analysis = await analyzeExistingInventoryForRemigration(tx, existingInv.id, outletId)

                if (analysis.canReplace) {
                  // Safe to replace: clean up old migration data and update
                  console.log(`[migration] product_stock: REplacing "${name}" - ${analysis.reason}`)

                  const cleaned = await cleanupMigrationData(tx, existingInv.id, outletId)

                  await tx.inventoryItem.update({
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

                  try {
                    await tx.inventoryMovement.create({
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

              // ── ATOMIC 1:1 link: ProductComposition + hasComposition ──
              // Founder-approved guards (2025-01):
              //   1. EXACT link check: productId + variantId=null + inventoryItemId + qty=1.
              //      If it already exists → no duplicate (ProductComposition has no @@unique).
              //      This is the re-migration safety path.
              //   2. CONFLICT guard: if ANY other composition already exists for this
              //      product (different inventoryItemId, qty != 1, etc.) → DO NOT append
              //      an automatic 1:1 link. Push explicit error + skip link create.
              //      The product already has a manual BOM; auto-1:1 would create two
              //      ledgers. hasComposition is already true (set by the manual BOM).
              //   3. If no composition exists → create auto 1:1 + set hasComposition=true.
              // Any unexpected create/update throw propagates to the batch try/catch →
              // batchFailed=true → entire batch rolls back. Invariant preserved.
              const existingCompositions = await tx.productComposition.findMany({
                where: { productId: product.id, variantId: null },
                select: { id: true, inventoryItemId: true, qty: true },
              })
              const exactLinkExists = existingCompositions.some(
                (c) => c.inventoryItemId === invItemId && c.qty === 1
              )

              if (existingCompositions.length > 0 && !exactLinkExists) {
                // Manual / non-1:1 BOM already exists → explicit conflict
                errors.push(
                  `"${name}": produk sudah memiliki komposisi manual/BOM (${existingCompositions.length} baris). ` +
                  `Auto-link 1:1 dilewati (konflik). Hapus komposisi existing di Master Produk untuk mengaktifkan auto-link.`
                )
                console.warn(`[migration] product_stock: CONFLICT — "${name}" has ${existingCompositions.length} manual composition(s); auto 1:1 skipped`)
              } else if (!exactLinkExists) {
                // No composition at all → create auto 1:1 atomically
                await tx.productComposition.create({
                  data: {
                    productId: product.id,
                    variantId: null,
                    inventoryItemId: invItemId,
                    qty: 1,
                    baseUnit: unit,
                  },
                })
                compositionsCreated++
                console.log(`[migration] product_stock: Composition created for "${name}" → inv=${invItemId}`)
              }

              // MIG-004 (P1): hasComposition=true (idempotent update; safe whether we
              // just created the link, the exact link already existed, or a manual BOM
              // already set the flag).
              await tx.product.update({
                where: { id: product.id },
                data: { hasComposition: true },
              })
            }

            // === Process inline composition (ALWAYS defer — inventory sheet may not be processed yet) ===
            if (includeInventory && komposisiInline) {
              deferredInlineCompositions.push({
                productId: product.id,
                compositionStr: komposisiInline,
              })
            }
          }

          // Flush opening stock logs after each batch
          await flushOpeningStockLogs(tx)
        }, {
          // 2 min per batch of 50 — well within the 300s route maxDuration.
          timeout: 120000,
        })
        completedBatches = b + 1
        batchDurationMs = Date.now() - batchStartTime
      } catch (batchErr) {
        console.error(`[migration] Batch ${b + 1}/${totalBatches} failed:`, batchErr)
        batchFailed = true
        batchError = batchErr instanceof Error ? batchErr.message : String(batchErr)
        batchDurationMs = Date.now() - batchStartTime
        // STOP — do not process later batches. Completed batches stay committed.
        break
      }
    }

    // ==================== REMAINING SHEETS (varian, inventory, komposisi) + deferred compositions ====================
    // Only process if non_varian batches didn't fail. These sheets run in a
    // single transaction (they don't have the Neon Free giant-write risk
    // because varian/inventory/komposisi are typically small in migration).
    // MIG-BATCH-V2: In single-batch mode, only process remaining sheets on
    // the LAST batch (so they run exactly once, after all products exist).
    const isLastBatchTarget = singleBatchMode && targetBatch === totalBatches - 1
    const shouldProcessRemainingSheets = !batchFailed && (!singleBatchMode || isLastBatchTarget)
    if (shouldProcessRemainingSheets) {
      try {
        await db.$transaction(async (tx) => {
          for (const s of sheetsToProcess) {
            const { sheetName, sheetType, rows } = s

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
                  if (!(await checkProductLimit(tx))) {
                    errors.push(`Baris ${rowNum}: Batas produk tercapai`)
                    break
                  }

                  // Skip duplicates
                  const existing = await tx.product.findFirst({ where: { name: parentName, outletId } })
                  if (existing) {
                    productCache.set(parentName, existing.id)
                    currentParentProduct = { id: existing.id, name: parentName }
                    productsSkipped++
                  } else {
                    const categoryId = categoryRaw ? await getOrCreateCategory(tx, categoryRaw) : null
                    const finalSku = parentSku || await generateUniqueSKU(parentName, outletId)
                    const finalBarcode = parentBarcode || finalSku

                    const product = await tx.product.create({
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

                  // MIG-003 (P1): Negative value validation for variant HPP and stock.
                  if (variantHpp < 0) {
                    errors.push(`Baris ${rowNum}: HPP Varian tidak boleh negatif (Produk: ${currentParentProduct.name}, Varian: ${variantName})`)
                    continue
                  }
                  if (variantStock < 0) {
                    errors.push(`Baris ${rowNum}: Stok Varian tidak boleh negatif (Produk: ${currentParentProduct.name}, Varian: ${variantName})`)
                    continue
                  }

                  const finalVariantSku = variantSku || await generateVariantSKU(currentParentProduct.name, variantName, outletId)
                  const finalVariantBarcode = variantBarcode || finalVariantSku

                  // Check for duplicate variant name
                  const existingVariant = await tx.productVariant.findFirst({
                    where: { name: variantName, productId: currentParentProduct.id },
                  })
                  if (existingVariant) {
                    errors.push(`Baris ${rowNum}: Varian "${variantName}" sudah ada untuk produk "${currentParentProduct.name}"`)
                    continue
                  }

                  const variant = await tx.productVariant.create({
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
                      await flushOpeningStockLogs(tx)
                    }
                  }

                  // === Mode 2 (product_stock): per-variant 1:1 InventoryItem + ProductComposition(variantId) ===
                  // Atomic invariant (mirrors non-variant Mode 2): variant + InventoryItem
                  // + 1:1 ProductComposition(variantId) + parent.hasComposition=true.
                  // Any failure throws and rolls back the remaining-sheets transaction.
                  // stock=0 still creates the item + link (same rationale as non-variant).
                  if (isStockMode) {
                    const variantInvName = `${currentParentProduct.name} - ${variantName}`
                    const variantInvUnit = 'pcs'

                    let variantInvItemId: string
                    const existingVariantInv = await tx.inventoryItem.findFirst({
                      where: { name: variantInvName, outletId },
                    })

                    if (!existingVariantInv) {
                      const variantInv = await tx.inventoryItem.create({
                        data: {
                          name: variantInvName,
                          sku: finalVariantSku,
                          baseUnit: variantInvUnit,
                          stock: variantStock,
                          avgCost: variantHpp > 0 ? variantHpp : 0,
                          lowStockAlert: 0,
                          status: 'ACTIVE',
                          outletId,
                          categoryId: null,
                        },
                      })
                      variantInvItemId = variantInv.id
                      inventoryItemsCreated++
                      totalStock += variantStock
                      totalModalValue += variantHpp * variantStock
                      inventoryItemCache.set(variantInvName, variantInv.id)

                      try {
                        await tx.inventoryMovement.create({
                          data: {
                            type: 'PURCHASE',
                            quantity: variantStock,
                            previousStock: 0,
                            newStock: variantStock,
                            referenceType: 'MIGRATION',
                            notes: `Saldo awal stok gudang varian migrasi dari ${file.name}`,
                            outletId,
                            inventoryItemId: variantInv.id,
                            userId,
                          },
                        })
                      } catch (movErr) {
                        console.warn(`[migration] Failed to create variant opening balance movement for ${variantInvName}:`, movErr)
                      }
                    } else {
                      const variantAnalysis = await analyzeExistingInventoryForRemigration(tx, existingVariantInv.id, outletId)
                      if (variantAnalysis.canReplace) {
                        const cleaned = await cleanupMigrationData(tx, existingVariantInv.id, outletId)
                        await tx.inventoryItem.update({
                          where: { id: existingVariantInv.id },
                          data: {
                            sku: finalVariantSku || existingVariantInv.sku,
                            baseUnit: variantInvUnit,
                            stock: variantStock,
                            avgCost: variantHpp > 0 ? variantHpp : 0,
                            lowStockAlert: 0,
                            status: 'ACTIVE',
                          },
                        })
                        try {
                          await tx.inventoryMovement.create({
                            data: {
                              type: 'PURCHASE',
                              quantity: variantStock,
                              previousStock: 0,
                              newStock: variantStock,
                              referenceType: 'MIGRATION',
                              notes: `Saldo awal stok gudang varian (re-migrate) dari ${file.name}`,
                              outletId,
                              inventoryItemId: existingVariantInv.id,
                              userId,
                            },
                          })
                        } catch (movErr) {
                          console.warn(`[migration] Failed to create variant re-migration movement for ${variantInvName}:`, movErr)
                        }
                        variantInvItemId = existingVariantInv.id
                        inventoryItemsUpdated++
                        migrationDataCleaned++
                        totalStock += variantStock
                        totalModalValue += variantHpp * variantStock
                        warnings.push(`🔄 "${variantInvName}": di-update (data migrasi lama dibersihkan: ${cleaned.movementsDeleted} stok, ${cleaned.compositionsDeleted} link)`)
                      } else {
                        variantInvItemId = existingVariantInv.id
                        inventoryItemsSkipped++
                        warnings.push(`⚠️ "${variantInvName}" menggunakan data existing: ${variantAnalysis.reason}`)
                      }
                      inventoryItemCache.set(variantInvName, existingVariantInv.id)
                    }

                    // Atomic 1:1 link with variantId + conflict guard (mirrors non-variant).
                    // Founder-approved guards (2025-01):
                    //   1. EXACT link check: productId + variantId + inventoryItemId + qty=1.
                    //      If it already exists → no duplicate (re-migration safety).
                    //   2. CONFLICT guard: if ANY other composition already exists for this
                    //      productId+variantId → DO NOT append auto 1:1. Push explicit error.
                    //   3. No composition → create auto 1:1 atomically + set hasComposition.
                    const existingVariantCompositions = await tx.productComposition.findMany({
                      where: { productId: currentParentProduct.id, variantId: variant.id },
                      select: { id: true, inventoryItemId: true, qty: true },
                    })
                    const exactVariantLinkExists = existingVariantCompositions.some(
                      (c) => c.inventoryItemId === variantInvItemId && c.qty === 1
                    )

                    if (existingVariantCompositions.length > 0 && !exactVariantLinkExists) {
                      errors.push(
                        `"${currentParentProduct.name}" varian "${variantName}": sudah memiliki komposisi manual/BOM (${existingVariantCompositions.length} baris). ` +
                        `Auto-link 1:1 dilewati (konflik). Hapus komposisi existing di Master Produk untuk mengaktifkan auto-link.`
                      )
                      console.warn(`[migration] product_stock: CONFLICT — variant "${currentParentProduct.name} - ${variantName}" has ${existingVariantCompositions.length} manual composition(s); auto 1:1 skipped`)
                    } else if (!exactVariantLinkExists) {
                      await tx.productComposition.create({
                        data: {
                          productId: currentParentProduct.id,
                          variantId: variant.id,
                          inventoryItemId: variantInvItemId,
                          qty: 1,
                          baseUnit: variantInvUnit,
                        },
                      })
                      compositionsCreated++
                    }
                    // Ensure parent product hasComposition flag (idempotent; safe in all 3 branches)
                    await tx.product.update({
                      where: { id: currentParentProduct.id },
                      data: { hasComposition: true },
                    })
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
            await flushOpeningStockLogs(tx)

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

                // MIG-003 (P1): Negative value validation for inventory stock and avgCost.
                if (stock < 0) {
                  errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Nama: ${name})`)
                  continue
                }
                if (avgCost < 0) {
                  errors.push(`Baris ${rowNum}: HPP Rata-rata tidak boleh negatif (Nama: ${name})`)
                  continue
                }

                const baseUnit = VALID_UNITS.includes(baseUnitRaw) ? baseUnitRaw : 'pcs'

                // Smart handling for existing inventory items (re-migration support)
                const existing = await tx.inventoryItem.findFirst({
                  where: { name, outletId },
                })

                if (existing) {
                  // ── EXISTING ITEM: Smart re-migration handling ──
                  console.log(`[migration] sheet3_inventory: Found existing item "${name}" (id=${existing.id}), analyzing...`)

                  const analysis = await analyzeExistingInventoryForRemigration(tx, existing.id, outletId)

                  if (analysis.canReplace) {
                    // Safe to replace: clean up old migration data and update
                    console.log(`[migration] sheet3_inventory: REplacing "${name}" - ${analysis.reason}`)

                    const cleaned = await cleanupMigrationData(tx, existing.id, outletId)

                    // Inventory category
                    const invCategoryId = categoryRaw ? await getOrCreateInventoryCategory(tx, categoryRaw) : null

                    // Update the inventory item with new values
                    await tx.inventoryItem.update({
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
                        await tx.inventoryMovement.create({
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
                const invCategoryId = categoryRaw ? await getOrCreateInventoryCategory(tx, categoryRaw) : null

                // Create InventoryItem (new item)
                const invItem = await tx.inventoryItem.create({
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
                  await tx.inventoryMovement.create({
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
                  const product = await tx.product.findFirst({ where: { name: productName, outletId }, select: { id: true } })
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
                    const variant = await tx.productVariant.findFirst({
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
                  const item = await tx.inventoryItem.findFirst({
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
                  const itemCheck = await tx.inventoryItem.findFirst({
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
                  await tx.productComposition.create({
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
                  await tx.product.update({
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
            const allInventoryItems = await tx.inventoryItem.findMany({
              where: { outletId },
              select: { id: true, name: true },
            })
            for (const item of allInventoryItems) {
              inventoryItemCache.set(item.name, item.id)
            }

            for (const deferred of deferredInlineCompositions) {
              try {
                const compCount = await processInlineComposition(
                  tx,
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

          // ==================== MODE 3: BOM CAPACITY WARNING (informational) ====================
          // After all sheets + deferred compositions are processed, for each product
          // (or variant) that has a ProductComposition, estimate BOM capacity =
          // min over composition rows of (InventoryItem.stock * yieldPerBatch / qty).
          // If Product.stock (or Variant.stock) exceeds the estimate, emit a warning.
          //
          // This is INFORMATIONAL ONLY because:
          //   1. Ingredients may be shared across multiple products (the estimate
          //      assumes exclusive use → can overstate capacity).
          //   2. Runtime validation in InventoryConsumptionService remains
          //      authoritative — a sale that exceeds actual inventory will throw
          //      "Stok item X tidak cukup" at checkout time.
          //   3. Product.stock is NOT clamped (per approved decision: Mode 3 keeps
          //      Option B, no auto-link, no clamp).
          if (includeInventory) {
            try {
              const productsWithComp = await tx.product.findMany({
                where: { outletId, hasComposition: true },
                select: {
                  id: true, name: true, stock: true,
                  compositions: {
                    select: {
                      qty: true, yieldPerBatch: true,
                      inventoryItem: { select: { stock: true } },
                    },
                  },
                  variants: {
                    select: {
                      id: true, name: true, stock: true,
                      compositions: {
                        select: {
                          qty: true, yieldPerBatch: true,
                          inventoryItem: { select: { stock: true } },
                        },
                      },
                    },
                  },
                },
              })

              for (const product of productsWithComp) {
                // Product-level compositions (non-variant)
                if (product.compositions.length > 0) {
                  let capacity = Infinity
                  for (const comp of product.compositions) {
                    const qty = comp.qty > 0 ? comp.qty : 1
                    const ypb = comp.yieldPerBatch > 0 ? comp.yieldPerBatch : 1
                    const invStock = comp.inventoryItem?.stock ?? 0
                    const rowCap = (invStock * ypb) / qty
                    if (rowCap < capacity) capacity = rowCap
                  }
                  if (capacity !== Infinity && product.stock > capacity) {
                    warnings.push(
                      `ℹ️ "${product.name}": stok produk ${product.stock} melebihi estimasi kapasitas BOM ${Math.floor(capacity)} unit. ` +
                      `Bahan mungkin dipakai bersama produk lain; validasi runtime saat penjualan bersifat otoritatif.`
                    )
                  }
                }
                // Variant-level compositions
                for (const variant of product.variants) {
                  if (variant.compositions.length === 0) continue
                  let capacity = Infinity
                  for (const comp of variant.compositions) {
                    const qty = comp.qty > 0 ? comp.qty : 1
                    const ypb = comp.yieldPerBatch > 0 ? comp.yieldPerBatch : 1
                    const invStock = comp.inventoryItem?.stock ?? 0
                    const rowCap = (invStock * ypb) / qty
                    if (rowCap < capacity) capacity = rowCap
                  }
                  if (capacity !== Infinity && variant.stock > capacity) {
                    warnings.push(
                      `ℹ️ "${product.name}" varian "${variant.name}": stok varian ${variant.stock} melebihi estimasi kapasitas BOM ${Math.floor(capacity)} unit. ` +
                      `Bahan mungkin dipakai bersama produk lain; validasi runtime saat penjualan bersifat otoritatif.`
                    )
                  }
                }
              }
            } catch (capErr) {
              console.warn('[migration] BOM capacity warning computation failed:', capErr)
              // Non-fatal — warnings are informational only
            }
          }

          // ==================== FLUSH REMAINING OPENING STOCK LOGS ====================
          await flushOpeningStockLogs(tx)
        }, {
          // MIG-011 mitigation: extended timeout for remaining sheets.
          // Enterprise (webmaster DB maxBulkUploadRows = -1) is unlimited, so
          // imports can exceed the old 500-row cap. Default Prisma transaction
          // timeout is 5s; we extend to 270s (just under the route maxDuration
          // of 300s) to accommodate large varian/inventory/komposisi imports.
          timeout: 270000,
        })
      } catch (remainingErr) {
        console.error('[migration] Remaining sheets failed:', remainingErr)
        batchFailed = true
        batchError = remainingErr instanceof Error ? remainingErr.message : String(remainingErr)
      }
    }

    // ==================== STATUS DETERMINATION ====================
    type MigrationStatus = 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'PARTIAL' | 'FAILED'
    let status: MigrationStatus
    if (batchFailed) {
      status = (completedBatches > 0 || productsCreated > 0) ? 'PARTIAL' : 'FAILED'
    } else if (errors.length > 0) {
      status = 'COMPLETED_WITH_ERRORS'
    } else {
      status = 'COMPLETED'
    }

    const remainingProducts = batchFailed
      ? Math.max(0, totalProducts - (completedBatches * BATCH_SIZE))
      : 0

    // ==================== AUDIT LOG (outside tx — safeAuditLog uses db) ====================
    // Only log if at least one record was created. Audit log is non-critical
    // (safeAuditLog wraps in try/catch) and uses `db` directly, so it must
    // run AFTER the transaction commits to record the final state.
    // MIG-BATCH-V2: In single-batch mode, only audit-log on the LAST batch
    // or on failure (to avoid N audit entries for one migration).
    const shouldAuditLog = (productsCreated > 0 || inventoryItemsCreated > 0 || compositionsCreated > 0)
      && (!singleBatchMode || isLastBatchTarget || batchFailed)
    if (shouldAuditLog) {
      await safeAuditLog({
        action: 'CREATE',
        entityType: 'PRODUCT',
        details: JSON.stringify({
          migration: true,
          mode,
          status,
          totalBatches,
          completedBatches,
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
          batchError,
          ...(singleBatchMode ? { singleBatchMode, batchNumber: targetBatch } : {}),
        }),
        outletId,
        userId,
      })
    }

    // MIG-BATCH-V2: Per-batch response (single-batch mode).
    // Frontend loops through batches 0..N-1, accumulating stats locally.
    // Each response returns THIS batch's stats + global context.
    if (singleBatchMode) {
      const failedRowsThisBatch = errors.filter(e => e.startsWith('Baris')).length
      const batchProcessed = productsCreated + productsSkipped + failedRowsThisBatch
      const remainingProductsAfter = Math.max(0, totalProducts - ((targetBatch + 1) * BATCH_SIZE))
      const batchStatus = batchFailed
        ? 'BATCH_FAILED'
        : isLastBatchTarget
          ? 'BATCH_LAST_OK'
          : 'BATCH_OK'

      return safeJson({
        batchNumber: targetBatch,
        totalBatches,
        totalProducts,
        batchCreated: productsCreated,
        batchSkipped: productsSkipped,
        batchFailed: failedRowsThisBatch,
        batchProcessed,
        batchDurationMs,
        remainingProducts: remainingProductsAfter,
        isLastBatch: isLastBatchTarget,
        status: batchStatus,
        batchError,
        errors,
        categoriesCreated,
        barcodeCount,
        // Include remaining-sheets stats only on last batch (when they were processed)
        ...(isLastBatchTarget ? {
          variantsCreated,
          inventoryItemsCreated,
          inventoryItemsSkipped,
          inventoryItemsUpdated,
          migrationDataCleaned,
          compositionsCreated,
          totalStock,
          totalModalValue,
          totalCategories: await db.category.count({ where: { outletId } }),
          warnings,
          mode,
        } : {}),
      })
    }

    return safeJson({
      status,
      totalProducts,
      totalBatches,
      completedBatches,
      currentBatch,
      productsCreated,
      variantsCreated,
      productsSkipped,
      failedRows: errors.filter(e => e.startsWith('Baris')).length,
      remainingProducts,
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
      totalInputRows: totalSheetRows,
      effectiveMaxBulkUploadRows: planMaxRows,
      effectiveMaxProducts: maxProducts,
      startBatch: startBatchParam,
      batchError,
      totalCategories: await db.category.count({ where: { outletId } }),
    })
  } catch (error) {
    console.error('Migration import error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses import', details: message }, 500)
  }
}
