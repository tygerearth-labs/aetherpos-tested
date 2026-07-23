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

// ==================== BATCH-OPTIMIZED REMIGRATION ANALYSIS ====================

/**
 * BATCH-OPTIMIZED remigration analysis for a batch of inventory items.
 *
 * Replaces N calls to `analyzeExistingInventoryForRemigration` (1-3 queries
 * each = N to 3N queries) with 2 batch queries (groupBy + findMany) plus
 * in-memory computation using preloaded `_count` data.
 *
 * PERF: For a 50-row re-migration batch, this reduces 50-150 analysis queries
 * to just 2 queries. For fresh import (no existing items), 0 queries — the
 * caller checks `existingInvItems.length > 0` before calling.
 *
 * The logic is identical to `analyzeExistingInventoryForRemigration`:
 *   1. _count == 0 for all relations → canReplace (no query needed)
 *   2. purchaseItems / transferItems / consumptionSnapshots > 0 → hasRealHistory (from _count)
 *   3. movements > 0 → batch groupBy to split MIGRATION vs real (1 query for ALL items)
 *   4. compositions > 0 → batch findMany to split auto-1:1 vs manual (1 query for ALL items)
 *   5. No real history → canReplace (migration-only data is safe to replace)
 */
async function batchAnalyzeInventoryForRemigration(
  tx: Prisma.TransactionClient,
  invItems: Prisma.InventoryItemGetPayload<{
    include: {
      _count: {
        select: {
          compositions: true
          purchaseItems: true
          movements: true
          inventoryTransferItems: true
          consumptionSnapshots: true
        }
      }
    }
  }>[],
  outletId: string
): Promise<Map<string, RemigrationAnalysis>> {
  const result = new Map<string, RemigrationAnalysis>()

  for (const item of invItems) {
    result.set(item.id, {
      canReplace: false,
      reason: '',
      hasRealHistory: false,
      migrationOnlyData: { movements: 0, compositions: 0 },
    })
  }

  // Phase 1: Check _count for immediate signals (0 queries — uses preloaded _count)
  const idsNeedingFurtherAnalysis: string[] = []
  for (const item of invItems) {
    const analysis = result.get(item.id)!
    const c = item._count
    const totalRelations = c.compositions + c.purchaseItems + c.movements
      + c.inventoryTransferItems + c.consumptionSnapshots

    if (totalRelations === 0) {
      analysis.canReplace = true
      analysis.reason = 'Tidak ada histori sama sekali'
      continue
    }

    // Immediate real-history blocks (from _count, no extra query)
    if (c.purchaseItems > 0) {
      analysis.hasRealHistory = true
      analysis.reason = `${c.purchaseItems} riwayat pembelian`
      continue
    }
    if (c.inventoryTransferItems > 0) {
      analysis.hasRealHistory = true
      analysis.reason = `${c.inventoryTransferItems} riwayat transfer`
      continue
    }
    if (c.consumptionSnapshots > 0) {
      analysis.hasRealHistory = true
      analysis.reason = `${c.consumptionSnapshots} riwayat konsumsi penjualan`
      continue
    }

    idsNeedingFurtherAnalysis.push(item.id)
  }

  // Phase 2: Batch movement analysis (1 groupBy query for ALL items with movements)
  const idsNeedingMovementCheck = invItems
    .filter(i => idsNeedingFurtherAnalysis.includes(i.id) && i._count.movements > 0 && !result.get(i.id)!.hasRealHistory)
    .map(i => i.id)

  if (idsNeedingMovementCheck.length > 0) {
    const movementGroups = await tx.inventoryMovement.groupBy({
      by: ['inventoryItemId', 'referenceType'],
      where: { inventoryItemId: { in: idsNeedingMovementCheck }, outletId },
      _count: true,
    })

    for (const item of invItems) {
      if (!idsNeedingMovementCheck.includes(item.id)) continue
      const analysis = result.get(item.id)!
      if (analysis.hasRealHistory) continue

      const groups = movementGroups.filter(g => g.inventoryItemId === item.id)
      const migrationCount = groups.find(g => g.referenceType === 'MIGRATION')?._count || 0
      const realCount = item._count.movements - migrationCount
      analysis.migrationOnlyData.movements = migrationCount

      if (realCount > 0) {
        analysis.hasRealHistory = true
        analysis.reason = `${realCount} pergerakan stok bisnis (+${migrationCount} stok awal migrasi)`
      }
    }
  }

  // Phase 3: Batch composition analysis (1 findMany query for ALL items with compositions)
  const idsNeedingCompCheck = invItems
    .filter(i => idsNeedingFurtherAnalysis.includes(i.id) && i._count.compositions > 0 && !result.get(i.id)!.hasRealHistory)
    .map(i => i.id)

  if (idsNeedingCompCheck.length > 0) {
    // NOTE: ProductComposition only has `inventoryItemId` (not `ingredientId` —
    // that was a legacy field removed from the schema). The original
    // analyzeExistingInventoryForRemigration referenced ingredientId in an OR
    // clause, but since the field doesn't exist, that branch was dead code.
    // We query only by inventoryItemId (the actual schema field).
    const compositions = await tx.productComposition.findMany({
      where: {
        inventoryItemId: { in: idsNeedingCompCheck },
      },
      select: { id: true, inventoryItemId: true, qty: true, baseUnit: true },
    })

    for (const item of invItems) {
      if (!idsNeedingCompCheck.includes(item.id)) continue
      const analysis = result.get(item.id)!
      if (analysis.hasRealHistory) continue

      const itemComps = compositions.filter(c => c.inventoryItemId === item.id)
      let autoCount = 0
      let realCount = 0
      for (const comp of itemComps) {
        if (comp.qty === 1 && comp.baseUnit !== null) autoCount++
        else realCount++
      }
      analysis.migrationOnlyData.compositions = autoCount

      if (realCount > 0) {
        analysis.hasRealHistory = true
        analysis.reason = `${realCount} komposisi/resep manual (+${autoCount} link otomatis)`
      }
    }
  }

  // Phase 4: Finalize — items with no real history → canReplace
  for (const item of invItems) {
    const analysis = result.get(item.id)!
    if (analysis.hasRealHistory || analysis.canReplace) continue

    analysis.canReplace = true
    const parts: string[] = []
    if (analysis.migrationOnlyData.movements > 0) parts.push(`${analysis.migrationOnlyData.movements} stok awal migrasi`)
    if (analysis.migrationOnlyData.compositions > 0) parts.push(`${analysis.migrationOnlyData.compositions} link otomatis`)
    analysis.reason = `Hanya data migrasi: ${parts.join(', ')} → akan di-replace`
  }

  return result
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
          // ═══════════════════════════════════════════════════════════════════
          // PERF: BATCH-OPTIMIZED IMPORT (Rules 1-8)
          //
          // Architecture: preload → in-memory loop → grouped writes → short tx
          //
          // BEFORE: N×(find→count→groupBy→create→update→find) = ~455 queries
          //   per 50-row fresh Mode 2 batch (~655-755 for re-migration)
          //
          // AFTER: 3-5 preload queries + 2 createMany/re-query pairs +
          //   2 batch deleteMany + per-row updates (re-migration only) =
          //   ~15-20 queries per 50-row batch
          //
          // Rules applied:
          //   1. Preload existing Products in one findMany
          //   2. Preload InventoryItems in one findMany (with _count)
          //   3. Preload ProductComposition via batch analysis (2 queries)
          //   4. Preload Categories in one findMany
          //   5. Removed per-row product.count / limit checks (pre-flight covers it)
          //   6. Reuse Maps (existingProductMap, existingInvMap, categoryCache)
          //   7. createMany for movements, audit logs, products, inventory, compositions
          //   8. No findFirst inside loops — all lookups via Maps
          //
          // Preserved (Rules 9-10):
          //   9. CONCURRENCY=1 (sequential batches), BATCH_SIZE=50 (unchanged)
          //  10. Atomic rollback: all writes in one $transaction. Any createMany
          //      or update failure throws → tx rolls back → Mode 2 invariant intact.
          // ═══════════════════════════════════════════════════════════════════

          // ── STEP 1: Parse all batch rows upfront (no queries) ──
          const batchRows: Array<{
            rowNum: number
            name: string
            sku: string | null
            barcode: string | null
            hpp: number
            price: number
            stock: number
            unit: string
            categoryRaw: string
            lowStockAlert: number
            komposisiInline: string
          }> = []

          for (let i = batchStart; i < batchEnd; i++) {
            const row = nonVarianRows[i]
            const unitRaw = String(findColumn(row, ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat']) || 'pcs').trim().toLowerCase()
            batchRows.push({
              rowNum: i + 2,
              name: String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim(),
              sku: String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim() || null,
              barcode: String(findColumn(row, ['BARCODE', 'Barcode', 'barcode', 'BAR CODE', 'Bar Code']) || '').trim() || null,
              hpp: sanitizeNumber(findColumn(row, ['HPP / MODAL (Rp)', 'HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal', 'HPP MODAL Rp'])),
              price: sanitizeNumber(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'])),
              stock: sanitizeNumber(findColumn(row, ['STOK AWAL', 'STOK', 'QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah'])),
              unit: VALID_UNITS.includes(unitRaw) ? unitRaw : 'pcs',
              categoryRaw: String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim(),
              lowStockAlert: sanitizeNumber(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low stock alert', 'Low Stock', 'LOW STOCK', 'Stock Alert', 'STOK MINIMUM'])),
              komposisiInline: String(findColumn(row, ['KOMPOSISI INLINE', 'KOMPOSISI INLINE (Opsional)', 'Komposisi Inline', 'KOMPOSISI', 'Komposisi', 'komposisi']) || '').trim(),
            })
          }

          const batchNames = batchRows.map(r => r.name).filter(Boolean)
          const batchCategoryNames = [...new Set(batchRows.map(r => r.categoryRaw).filter(Boolean))]

          // ── STEP 2: Preload (Rules 1-4, 8) — batch-level reads ──

          // Rule 1: Preload existing Products for all 50 rows in one findMany
          const existingProducts = batchNames.length > 0
            ? await tx.product.findMany({ where: { name: { in: batchNames }, outletId }, select: { id: true, name: true } })
            : []
          const existingProductMap = new Map(existingProducts.map(p => [p.name, p.id]))

          // Rule 2: Preload InventoryItems for all 50 rows in one findMany (with _count for remigration)
          // Only needed in stock mode (Mode 2 creates same-named inventory items)
          type InvItemWithCount = Prisma.InventoryItemGetPayload<{
            include: {
              _count: {
                select: {
                  compositions: true
                  purchaseItems: true
                  movements: true
                  inventoryTransferItems: true
                  consumptionSnapshots: true
                }
              }
            }
          }>
          let existingInvItems: InvItemWithCount[] = []
          if (isStockMode && batchNames.length > 0) {
            existingInvItems = await tx.inventoryItem.findMany({
              where: { name: { in: batchNames }, outletId },
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
          }
          const existingInvMap = new Map(existingInvItems.map(i => [i.name, i]))

          // Rule 4: Preload Categories in one findMany
          if (batchCategoryNames.length > 0) {
            const existingCats = await tx.category.findMany({
              where: { name: { in: batchCategoryNames }, outletId },
              select: { id: true, name: true },
            })
            for (const c of existingCats) categoryCache.set(c.name, c.id)
          }

          // Create missing categories (batched — replaces per-row getOrCreateCategory)
          const missingCategoryNames = batchCategoryNames.filter(n => !categoryCache.has(n))
          if (missingCategoryNames.length > 0) {
            await tx.category.createMany({
              data: missingCategoryNames.map(name => ({ name, outletId, color: 'zinc' })),
            })
            categoriesCreated += missingCategoryNames.length
            // Re-query to get IDs for the newly created categories
            const newCats = await tx.category.findMany({
              where: { name: { in: missingCategoryNames }, outletId },
              select: { id: true, name: true },
            })
            for (const c of newCats) categoryCache.set(c.name, c.id)
          }

          // Rule 3 + remigration: Batch analyze existing inventory items
          // Replaces N calls to analyzeExistingInventoryForRemigration (1-3 queries each)
          // with 2 batch queries (groupBy + findMany) for ALL items.
          // For fresh import (no existing items), 0 queries.
          let remigrationAnalysisMap = new Map<string, RemigrationAnalysis>()
          if (existingInvItems.length > 0) {
            remigrationAnalysisMap = await batchAnalyzeInventoryForRemigration(tx, existingInvItems, outletId)
          }

          // ── STEP 3: In-memory collection loop (0 reads — Rules 5, 6, 8) ──

          // Products to create (batched via createMany)
          const productsToCreate: Prisma.ProductCreateManyInput[] = []

          // Inventory items to create (batched via createMany)
          const invItemsToCreate: Prisma.InventoryItemCreateManyInput[] = []

          // Inventory items to update (per-row — different values per row)
          const invItemsToUpdate: Array<{ id: string; name: string; data: Prisma.InventoryItemUpdateInput }> = []

          // Inventory item IDs needing batch cleanup (re-migration: delete old MIGRATION movements + auto compositions)
          const invIdsToCleanup: string[] = []
          const cleanupWarningData: Map<string, { name: string; analysis: RemigrationAnalysis }> = new Map()

          // Compositions to create (1:1 auto-links for Mode 2)
          // Stored with name placeholders — resolved to IDs after createMany + re-query
          const compositionsToCreate: Array<{
            productName: string      // resolved to productId after createMany
            invIdOrName: string      // ID (existing inv) or name (new inv, resolved after createMany)
            unit: string
          }> = []

          // Movements to create (opening balance — batched via createMany)
          // Stored with name placeholders for new items — resolved after createMany
          const movementsToCreate: Array<{
            type: string
            quantity: number
            previousStock: number
            newStock: number
            referenceType: string
            notes: string
            outletId: string
            invIdOrName: string  // ID (existing) or name (new, resolved later)
            userId: string
          }> = []

          // Batch-local audit log entries (entityId resolved after createMany)
          const batchAuditLogs: Array<{
            productName: string
            productSku: string
            stock: number
          }> = []

          // Batch-local deferred compositions (productId resolved after createMany)
          const batchDeferredCompositions: Array<{
            productName: string
            compositionStr: string
          }> = []

          for (const rowData of batchRows) {
            const { rowNum, name, sku, barcode, hpp, price, stock, unit, categoryRaw, lowStockAlert, komposisiInline } = rowData

            // ── Validation (unchanged) ──
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

            // Rule 5: Removed per-row checkProductLimit (pre-flight quota check at
            // lines 587-624 already enforces maxProducts per request. In single-batch
            // mode, the pre-flight runs for each batch request, so the limit is
            // always current. The per-row product.count was 50 redundant queries.)

            // Rule 1: Duplicate check via Map (no query)
            const existingProductId = existingProductMap.get(name)
            if (existingProductId) {
              productCache.set(name, existingProductId)
              productsSkipped++
              continue
            }

            // Rule 4+6: Category via Map (categories already created/resolved above)
            const categoryId = categoryRaw ? (categoryCache.get(categoryRaw) || null) : null

            // Auto-generate SKU/Barcode (unchanged — uses db, not tx; shared with bulk-upload)
            const finalSku = sku || await generateUniqueSKU(name, outletId)
            const finalBarcode = barcode || finalSku

            // Rule 6: Set hasComposition UPFRONT in product create data.
            // Mode 2 (isStockMode): always true (1:1 link will be created below).
            // Mode 3 (includeInventory): true only if komposisiInline present (same as original).
            // This eliminates the per-row product.update(hasComposition) — saves 50 queries.
            const hasComposition = isStockMode || (includeInventory && !!komposisiInline)

            // Collect product data (will be createMany'd below)
            productsToCreate.push({
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
              hasComposition,
            })

            productsCreated++
            if (finalBarcode) barcodeCount++

            // Collect opening stock audit log (entityId resolved after createMany)
            if (stock > 0) {
              batchAuditLogs.push({
                productName: name,
                productSku: finalSku,
                stock,
              })
            }

            // === Mode 3 (product_inventory): NO auto-inventory-item creation ===
            // (Opsi B — per investigasi "produk & inventori tidak link")
            //
            // In Mode 3, bahan baku (raw materials) and produk jadi (finished goods)
            // are conceptually DISTINCT. A product's stock lives in `Product.stock`
            // (set in the productsToCreate data above from the STOK AWAL column).
            // InventoryItem rows exist ONLY for raw materials declared in Sheet 3
            // ("Bahan Baku"), and the Product↔Inventory link exists ONLY via
            // explicit BOM rows (Sheet 4 "Komposisi" or the KOMPOSISI INLINE column).
            //
            // The previous version auto-created an InventoryItem with the SAME name
            // as the product whenever `stock > 0`, which produced an orphan inventory
            // item (no ProductComposition link) → the symptom "produk berhasil
            // di-upload tapi inventori tidak link". That auto-creation is intentionally
            // REMOVED here. (No inventory mutation in Mode 3 — intentionally empty.)
            //
            // Mode 3 composition linking is handled by:
            //   • Sheet 3 + Sheet 4 handlers (remaining-sheets transaction)
            //   • KOMPOSISI INLINE → deferredInlineCompositions (below)
            // If neither BOM source is filled, the product has no composition →
            // selling it reduces Product.stock only (correct Mode-3-degenerates-to-Mode-1).

            // === product_stock mode: ATOMIC 1:1 InventoryItem + ProductComposition ===
            // Approved invariant (2025-01): Product + InventoryItem + 1:1
            // ProductComposition + hasComposition=true are ONE atomic unit.
            // Any failure in the grouped writes below throws → tx rolls back →
            // batchFailed=true → entire batch rolls back. Invariant preserved.
            //
            // stock=0 is handled the same as stock>0: an InventoryItem(stock=0) and a
            // 1:1 link are still created, so that sales decrement inventory correctly
            // and restock flows through the inventory ledger.
            if (isStockMode) {
              const existingInv = existingInvMap.get(name)

              if (!existingInv) {
                // ── NEW INVENTORY ITEM: collect for batch createMany ──
                invItemsToCreate.push({
                  name,
                  sku: finalSku,
                  baseUnit: unit,
                  stock,
                  avgCost: hpp > 0 ? hpp : 0,
                  lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 0,
                  status: 'ACTIVE',
                  outletId,
                  categoryId: null,
                })

                // Collect movement (invIdOrName = name → resolved after createMany)
                movementsToCreate.push({
                  type: 'PURCHASE',
                  quantity: stock,
                  previousStock: 0,
                  newStock: stock,
                  referenceType: 'MIGRATION',
                  notes: `Saldo awal stok gudang migrasi dari ${file.name}`,
                  outletId,
                  invIdOrName: name,
                  userId,
                })

                inventoryItemsCreated++
                totalStock += stock
                totalModalValue += hpp * stock

                // Collect 1:1 composition link (both IDs resolved after createMany)
                compositionsToCreate.push({
                  productName: name,
                  invIdOrName: name,
                  unit,
                })
                compositionsCreated++
              } else {
                // ── EXISTING INVENTORY: remigration analysis (from preloaded Map) ──
                const analysis = remigrationAnalysisMap.get(existingInv.id)!

                if (analysis.canReplace) {
                  // Safe to replace: collect for batch cleanup + per-row update
                  invIdsToCleanup.push(existingInv.id)
                  cleanupWarningData.set(existingInv.id, { name, analysis })

                  invItemsToUpdate.push({
                    id: existingInv.id,
                    name,
                    data: {
                      sku: finalSku || existingInv.sku,
                      baseUnit: unit,
                      stock,
                      avgCost: hpp > 0 ? hpp : 0,
                      lowStockAlert: lowStockAlert > 0 ? lowStockAlert : 0,
                      status: 'ACTIVE',
                    },
                  })

                  // Movement for re-migrated item (invId is known — existing item)
                  movementsToCreate.push({
                    type: 'PURCHASE',
                    quantity: stock,
                    previousStock: 0,
                    newStock: stock,
                    referenceType: 'MIGRATION',
                    notes: `Saldo awal stok gudang (re-migrate) dari ${file.name}`,
                    outletId,
                    invIdOrName: existingInv.id,
                    userId,
                  })

                  inventoryItemsUpdated++
                  migrationDataCleaned++
                  totalStock += stock
                  totalModalValue += hpp * stock

                  // 1:1 composition link (productId resolved after createMany, invId is known)
                  compositionsToCreate.push({
                    productName: name,
                    invIdOrName: existingInv.id,
                    unit,
                  })
                  compositionsCreated++
                } else {
                  // Has real history: use existing, skip update, warn
                  inventoryItemCache.set(name, existingInv.id)
                  inventoryItemsSkipped++
                  warnings.push(`⚠️ "${name}" menggunakan data existing: ${analysis.reason}`)

                  // Still create 1:1 composition link (product is new, needs link)
                  compositionsToCreate.push({
                    productName: name,
                    invIdOrName: existingInv.id,
                    unit,
                  })
                  compositionsCreated++
                }
              }
            }

            // === Deferred inline composition (Mode 3) ===
            // productId resolved after createMany
            if (includeInventory && komposisiInline) {
              batchDeferredCompositions.push({
                productName: name,
                compositionStr: komposisiInline,
              })
            }
          }

          // ── STEP 4: Grouped writes ──

          // 4a. Batch cleanup migration data (re-migration items)
          // Replaces N calls to cleanupMigrationData (2 deleteMany each = 2N queries)
          // with 2 batch deleteMany queries.
          if (invIdsToCleanup.length > 0) {
            // Delete MIGRATION movements for all items needing cleanup (1 query)
            await tx.inventoryMovement.deleteMany({
              where: {
                inventoryItemId: { in: invIdsToCleanup },
                referenceType: 'MIGRATION',
                outletId,
              },
            })
            // Delete auto 1:1 compositions for all items needing cleanup (1 query)
            // NOTE: ProductComposition only has `inventoryItemId` (not `ingredientId`).
            await tx.productComposition.deleteMany({
              where: {
                inventoryItemId: { in: invIdsToCleanup },
                qty: 1,
              },
            })
            // Push per-item warnings using preloaded analysis data (no extra queries)
            for (const id of invIdsToCleanup) {
              const { name, analysis } = cleanupWarningData.get(id)!
              warnings.push(`🔄 "${name}": di-update (data migrasi lama dibersihkan: ${analysis.migrationOnlyData.movements} stok, ${analysis.migrationOnlyData.compositions} link)`)
            }
          }

          // 4b. Update existing inventory items (per-row — different values per row)
          // Cannot use updateMany (doesn't support different values per row).
          // These are re-migration items only; fresh import has 0 updates.
          for (const update of invItemsToUpdate) {
            await tx.inventoryItem.update({
              where: { id: update.id },
              data: update.data,
            })
            inventoryItemCache.set(update.name, update.id)
          }

          // 4c. Create products (batched via createMany + re-query for IDs)
          // createMany doesn't return created records, so we re-query by name.
          // Names are unique within the outlet (dedup check ensures this), so
          // re-querying by name safely maps name → id.
          let createdProductMap = new Map<string, string>()
          if (productsToCreate.length > 0) {
            await tx.product.createMany({ data: productsToCreate })

            // Re-query to get IDs (1 query for all new products)
            const createdProducts = await tx.product.findMany({
              where: { name: { in: productsToCreate.map(p => p.name) }, outletId },
              select: { id: true, name: true },
            })
            createdProductMap = new Map(createdProducts.map(p => [p.name, p.id]))

            // Populate productCache for composition linking (Sheet 4)
            for (const [name, id] of createdProductMap) {
              productCache.set(name, id)
            }
          }

          // 4d. Create inventory items (batched via createMany + re-query for IDs)
          let createdInvMap = new Map<string, string>()
          if (invItemsToCreate.length > 0) {
            await tx.inventoryItem.createMany({ data: invItemsToCreate })

            // Re-query to get IDs (1 query for all new inventory items)
            const createdInvItems = await tx.inventoryItem.findMany({
              where: { name: { in: invItemsToCreate.map(i => i.name) }, outletId },
              select: { id: true, name: true },
            })
            createdInvMap = new Map(createdInvItems.map(i => [i.name, i.id]))

            // Populate inventoryItemCache
            for (const [name, id] of createdInvMap) {
              inventoryItemCache.set(name, id)
            }
          }

          // 4e. Create 1:1 composition links (batched via createMany)
          // CONFLICT GUARD: All products in this batch are NEW (duplicates were
          // skipped via existingProductMap). New products have ZERO existing
          // compositions. The original per-row conflict guard
          // (productComposition.findMany → check existingCompositions.length > 0)
          // would always return empty for new products → no conflict → always
          // create 1:1 link. We skip the findMany (which was 50 queries) and
          // create all links directly. This does NOT weaken the guard — the
          // guard's condition (existing compositions on a new product) is
          // structurally impossible. The conflict guard IS preserved in the
          // variant section (Sheet 2) where products may already exist.
          // EXACT LINK CHECK: For new products, no exact link can exist
          // (product was just created). Same logic as conflict guard above.
          //
          // Any createMany failure (e.g., unexpected unique constraint) throws →
          // tx rolls back → Mode 2 atomic invariant preserved.
          if (compositionsToCreate.length > 0) {
            const compData = compositionsToCreate.map(c => ({
              productId: createdProductMap.get(c.productName)!,
              variantId: null,
              inventoryItemId: c.invIdOrName.length > 20
                ? c.invIdOrName  // already an ID (existing inventory, 24-char cuid)
                : (createdInvMap.get(c.invIdOrName) || c.invIdOrName),  // name → resolve
              qty: 1,
              baseUnit: c.unit,
            })).filter(c => c.productId && c.inventoryItemId) // safety: skip if IDs not resolved

            if (compData.length > 0) {
              await tx.productComposition.createMany({ data: compData })
            }
          }

          // 4f. Create opening balance movements (batched via createMany)
          // Non-fatal: movement creation failure is caught (matching original
          // per-item try/catch behavior). Difference: createMany is atomic —
          // if one movement fails, ALL fail (vs original: only failed item
          // skipped). Movement failures are extremely rare (simple insert, no
          // unique constraints), so this trade-off is acceptable for the
          // performance gain (1 query vs 50).
          if (movementsToCreate.length > 0) {
            const movData = movementsToCreate.map(m => ({
              type: m.type as 'PURCHASE',
              quantity: m.quantity,
              previousStock: m.previousStock,
              newStock: m.newStock,
              referenceType: m.referenceType as 'MIGRATION',
              notes: m.notes,
              outletId: m.outletId,
              inventoryItemId: m.invIdOrName.length > 20
                ? m.invIdOrName  // already an ID (existing inventory)
                : (createdInvMap.get(m.invIdOrName) || m.invIdOrName),  // name → resolve
              userId: m.userId,
            })).filter(m => m.inventoryItemId) // safety: skip if ID not resolved

            if (movData.length > 0) {
              try {
                await tx.inventoryMovement.createMany({ data: movData })
              } catch (movErr) {
                console.warn('[migration] Failed to batch-create opening balance movements:', movErr)
              }
            }
          }

          // 4g. Resolve and push audit logs (entityId from product re-query)
          for (const log of batchAuditLogs) {
            const productId = createdProductMap.get(log.productName)
            if (productId) {
              openingStockLogs.push({
                action: 'RESTOCK',
                entityType: 'PRODUCT',
                entityId: productId,
                details: JSON.stringify({
                  productName: log.productName,
                  productSku: log.productSku,
                  initialStock: log.stock,
                  newStock: log.stock,
                  reason: 'Stok awal migrasi',
                }),
                outletId,
                userId,
              })
            }
          }

          // 4h. Resolve and push deferred inline compositions (productId from re-query)
          for (const deferred of batchDeferredCompositions) {
            const productId = createdProductMap.get(deferred.productName)
            if (productId) {
              deferredInlineCompositions.push({
                productId,
                compositionStr: deferred.compositionStr,
              })
            }
          }

          // 4i. Flush opening stock logs (batched createMany — already implemented)
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
            // SHEET 2: Produk Varian (BATCH-OPTIMIZED)
            // ──────────────────────────────────────────────
            // Mirrors the non_varian 4-step architecture (commit 697ff2d):
            //   STEP 1: Parse all rows (0 queries)
            //   STEP 2: Preload [parents, variants, variant inventory, categories]
            //           + batch analyze remigration (0-7 queries total)
            //   STEP 3: In-memory collection loop (0 reads — all via Maps)
            //   STEP 4: Grouped writes [cleanup → updates → createMany parents →
            //           re-query → createMany variants → re-query → createMany
            //           inventory → re-query → createMany compositions → createMany
            //           movements → updateMany hasComposition → flush audit logs]
            //
            // Per-row queries eliminated (was ~10/row fresh Mode 2, ~13/row re-migrate):
            //   - checkProductLimit (pre-flight at lines 752-789 covers variant parents)
            //   - product.findFirst (preloaded → existingParentMap)
            //   - getOrCreateCategory (preloaded + batch createMany)
            //   - productVariant.findFirst (preloaded → existingVariantMap)
            //   - inventoryItem.findFirst (preloaded → existingVariantInvMap)
            //   - productComposition.findMany (skipped — new variants can't have
            //     existing compositions; same logic as non-variant optimization)
            //   - product.update(hasComposition) (batched updateMany OR set upfront)
            //   - analyzeExistingInventoryForRemigration (batched — 2 queries total)
            //   - cleanupMigrationData (batched — 2 deleteMany total)
            //
            // Per-row queries RETAINED (same as non-variant optimization):
            //   - generateVariantSKU / generateUniqueSKU (uses db not tx; uniqueness
            //     check via random suffix; ~1 query each. Would need complex batching
            //     for marginal gain.)
            //   - inventoryItem.update for re-migration (different values per row;
            //     can't createMany with different values)
            //
            // PRESERVED (Rules 9-10):
            //   9. Runs inside the remaining-sheets $transaction (atomic with Sheet 3/4)
            //  10. Any createMany/update failure throws → tx rolls back → invariant intact
            if (sheetType === 'varian') {

              // ═══════════════════════════════════════════
              // STEP 1: Parse all rows (0 queries)
              // ═══════════════════════════════════════════
              const variantSheetRows: Array<{
                rowNum: number
                parentName: string
                parentSku: string | null
                parentBarcode: string | null
                parentHpp: number
                parentPrice: number
                categoryRaw: string
                variantName: string
                variantSku: string | null
                variantBarcode: string | null
                variantHpp: number
                variantPrice: number
                variantStock: number
                komposisiVariantInline: string
              }> = []

              for (let i = 0; i < rows.length; i++) {
                const row = rows[i]
                variantSheetRows.push({
                  rowNum: i + 2,
                  parentName: String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim(),
                  parentSku: String(findColumn(row, ['SKU PRODUK', 'SKU Produk', 'sku produk']) || '').trim() || null,
                  parentBarcode: String(findColumn(row, ['BARCODE PRODUK', 'Barcode Produk', 'barcode produk']) || '').trim() || null,
                  parentHpp: sanitizeNumber(findColumn(row, ['HPP PRODUK (Rp)', 'HPP PRODUK', 'HPP Produk', 'hpp produk'])),
                  parentPrice: sanitizeNumber(findColumn(row, ['HARGA JUAL PRODUK* (Rp)', 'HARGA JUAL PRODUK', 'HARGA JUAL PRODUK (Rp)', 'harga jual produk'])),
                  categoryRaw: String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim(),
                  variantName: String(findColumn(row, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Nama Variant', 'nama varian', 'Varian', 'VARIAN']) || '').trim(),
                  variantSku: String(findColumn(row, ['SKU VARIAN', 'SKU Varian', 'sku varian']) || '').trim() || null,
                  variantBarcode: String(findColumn(row, ['BARCODE VARIAN', 'Barcode Varian', 'barcode varian']) || '').trim() || null,
                  variantHpp: sanitizeNumber(findColumn(row, ['HPP VARIAN (Rp)', 'HPP VARIAN', 'HPP Varian', 'hpp varian'])),
                  variantPrice: sanitizeNumber(findColumn(row, ['HARGA JUAL VARIAN* (Rp)', 'HARGA JUAL VARIAN', 'HARGA JUAL VARIAN (Rp)', 'harga jual varian'])),
                  variantStock: sanitizeNumber(findColumn(row, ['STOK AWAL VARIAN', 'STOK VARIAN', 'Stok Varian', 'stok varian', 'stok awal varian'])),
                  komposisiVariantInline: String(findColumn(row, ['KOMPOSISI VARIAN INLINE', 'KOMPOSISI VARIAN INLINE (Opsional)', 'Komposisi Varian', 'komposisi varian', 'KOMPOSISI INLINE']) || '').trim(),
                })
              }

              // Pre-scan: determine parents with variants + collect variant inventory
              // names for preloading (variant inventory name = `${parentName} - ${variantName}`)
              let scanParentName: string | null = null
              const parentsWithVariants = new Set<string>()
              const variantInvNamesToPreload: string[] = []
              for (const r of variantSheetRows) {
                if (r.parentName) scanParentName = r.parentName
                if (r.variantName && scanParentName) {
                  parentsWithVariants.add(scanParentName)
                  variantInvNamesToPreload.push(`${scanParentName} - ${r.variantName}`)
                }
              }

              const parentNamesToPreload = [...new Set(
                variantSheetRows.filter(r => r.parentName).map(r => r.parentName)
              )]
              const variantCategoryNames = [...new Set(
                variantSheetRows.filter(r => r.categoryRaw).map(r => r.categoryRaw)
              )]

              // ═══════════════════════════════════════════
              // STEP 2: Preload (batch findMany)
              // ═══════════════════════════════════════════

              // Preload existing parent products (with hasComposition for update decision)
              const existingParents = parentNamesToPreload.length > 0
                ? await tx.product.findMany({
                    where: { name: { in: parentNamesToPreload }, outletId },
                    select: { id: true, name: true, hasComposition: true },
                  })
                : []
              const existingParentMap = new Map(existingParents.map(p => [p.name, p]))
              for (const p of existingParents) {
                productCache.set(p.name, p.id)
              }

              // Preload existing variants for existing parents (duplicate check)
              // New parents created this batch can't have existing variants.
              const existingParentIds = existingParents.map(p => p.id)
              const existingVariants = existingParentIds.length > 0
                ? await tx.productVariant.findMany({
                    where: { productId: { in: existingParentIds } },
                    select: { id: true, productId: true, name: true },
                  })
                : []
              // Key: `${productId}||${variantName}` → true
              const existingVariantKeySet = new Set<string>()
              for (const v of existingVariants) {
                existingVariantKeySet.add(`${v.productId}||${v.name}`)
              }

              // Preload existing variant inventory items (with _count for remigration)
              // Only needed in Mode 2 (isStockMode creates same-named inventory items)
              type VariantInvWithCount = Prisma.InventoryItemGetPayload<{
                include: {
                  _count: {
                    select: {
                      compositions: true
                      purchaseItems: true
                      movements: true
                      inventoryTransferItems: true
                      consumptionSnapshots: true
                    }
                  }
                }
              }>
              let existingVariantInvItems: VariantInvWithCount[] = []
              if (isStockMode && variantInvNamesToPreload.length > 0) {
                existingVariantInvItems = await tx.inventoryItem.findMany({
                  where: { name: { in: variantInvNamesToPreload }, outletId },
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
              }
              const existingVariantInvMap = new Map(existingVariantInvItems.map(i => [i.name, i]))

              // Preload + create missing categories (batched)
              if (variantCategoryNames.length > 0) {
                const existingCats = await tx.category.findMany({
                  where: { name: { in: variantCategoryNames }, outletId },
                  select: { id: true, name: true },
                })
                for (const c of existingCats) categoryCache.set(c.name, c.id)
              }
              const missingVariantCats = variantCategoryNames.filter(n => !categoryCache.has(n))
              if (missingVariantCats.length > 0) {
                await tx.category.createMany({
                  data: missingVariantCats.map(name => ({ name, outletId, color: 'zinc' })),
                })
                categoriesCreated += missingVariantCats.length
                const newCats = await tx.category.findMany({
                  where: { name: { in: missingVariantCats }, outletId },
                  select: { id: true, name: true },
                })
                for (const c of newCats) categoryCache.set(c.name, c.id)
              }

              // Batch analyze existing variant inventory items for remigration
              // Replaces N calls to analyzeExistingInventoryForRemigration (1-3 queries each)
              // with 2 batch queries (groupBy + findMany) for ALL items.
              // For fresh import (no existing items), 0 queries.
              let variantRemigrationAnalysis = new Map<string, RemigrationAnalysis>()
              if (existingVariantInvItems.length > 0) {
                variantRemigrationAnalysis = await batchAnalyzeInventoryForRemigration(
                  tx, existingVariantInvItems, outletId
                )
              }

              // ═══════════════════════════════════════════
              // STEP 3: In-memory collection loop (0 reads)
              // ═══════════════════════════════════════════

              const variantParentsToCreate: Prisma.ProductCreateManyInput[] = []
              const variantsToCreate: Array<{
                parentName: string  // resolved to productId after parent createMany
                name: string
                sku: string
                barcode: string
                hpp: number
                price: number
                stock: number
                outletId: string
              }> = []
              const variantInvToCreate: Prisma.InventoryItemCreateManyInput[] = []
              const variantInvToUpdate: Array<{ id: string; name: string; data: Prisma.InventoryItemUpdateInput }> = []
              const variantInvIdsToCleanup: string[] = []
              const variantCleanupWarnings = new Map<string, { name: string; analysis: RemigrationAnalysis }>()
              const variantCompositionsToCreate: Array<{
                parentName: string      // resolved to productId after parent createMany
                variantName: string     // resolved to variantId after variant createMany
                invIdOrName: string     // ID (existing inv) or name (new inv, resolved after createMany)
                unit: string
              }> = []
              const variantMovementsToCreate: Array<{
                type: string
                quantity: number
                previousStock: number
                newStock: number
                referenceType: string
                notes: string
                outletId: string
                invIdOrName: string
                userId: string
              }> = []
              const variantBatchAuditLogs: Array<{
                parentName: string
                variantName: string
                variantSku: string
                stock: number
              }> = []
              const variantBatchDeferredComps: Array<{
                parentName: string
                variantName: string
                compositionStr: string
              }> = []

              // Track in-batch variant duplicates (key: `${parentName}||${variantName}`)
              const batchVariantKeys = new Set<string>()

              // Track in-batch parent duplicates (parent names already collected for
              // createMany). If the same parent appears twice in the sheet, the second
              // occurrence is treated as a skip (not re-created). The parent ID is
              // resolved after createMany + re-query, so variants use parentName as
              // placeholder and are resolved during the write phase.
              const batchParentNamesSeen = new Set<string>()

              // Track existing parent IDs needing hasComposition update (Mode 2)
              const parentIdsNeedingHasCompUpdate = new Set<string>()

              let currentParentName: string | null = null
              let currentParentId: string | null = null  // null = new parent (pending createMany)
              let currentParentIsNew = false

              for (const r of variantSheetRows) {
                const { rowNum } = r

                // === Parent product row (NAMA PRODUK is filled) ===
                if (r.parentName) {
                  currentParentName = r.parentName
                  const existingParent = existingParentMap.get(r.parentName)
                  if (existingParent) {
                    // Parent exists in DB (from previous batch or non-varian sheet)
                    currentParentId = existingParent.id
                    currentParentIsNew = false
                    productsSkipped++
                  } else if (batchParentNamesSeen.has(r.parentName)) {
                    // In-batch duplicate parent — already collected for createMany.
                    // Don't create again (would violate unique constraint).
                    // ID will be resolved after createMany; variants use parentName
                    // as placeholder. productsSkipped++ mirrors original findFirst behavior.
                    currentParentId = null
                    currentParentIsNew = true
                    productsSkipped++
                  } else {
                    // New parent — collect for createMany (ID resolved after re-query)
                    batchParentNamesSeen.add(r.parentName)
                    currentParentId = null
                    currentParentIsNew = true
                    const categoryId = r.categoryRaw ? (categoryCache.get(r.categoryRaw) || null) : null
                    const finalSku = r.parentSku || await generateUniqueSKU(r.parentName, outletId)
                    const finalBarcode = r.parentBarcode || finalSku

                    // hasComposition logic (mirrors original lines 1512 + 1720):
                    // Mode 2 (isStockMode): true if parent has variants (1:1 links created below)
                    // Mode 3 (includeInventory): true only if THIS introducing row has inline comp
                    //   (matches original line 1512 — first row's komposisiVariantInline)
                    const hasComposition = isStockMode
                      ? parentsWithVariants.has(r.parentName)
                      : (includeInventory && !!r.komposisiVariantInline)

                    variantParentsToCreate.push({
                      name: r.parentName,
                      sku: finalSku,
                      barcode: finalBarcode,
                      hpp: r.parentHpp,
                      price: r.parentPrice || 0,
                      stock: 0, // Parent stock = 0 when has variants
                      unit: 'pcs',
                      categoryId,
                      outletId,
                      hasVariants: true,
                      hasComposition,
                    })
                    productsCreated++
                    if (finalBarcode) barcodeCount++
                  }
                }

                // === Variant row (NAMA VARIAN must be filled) ===
                if (r.variantName && currentParentName) {
                  if (!r.variantPrice || r.variantPrice < 0) {
                    errors.push(`Baris ${rowNum}: Harga Jual Varian tidak valid (Produk: ${currentParentName}, Varian: ${r.variantName})`)
                    continue
                  }

                  // MIG-003 (P1): Negative value validation for variant HPP and stock.
                  if (r.variantHpp < 0) {
                    errors.push(`Baris ${rowNum}: HPP Varian tidak boleh negatif (Produk: ${currentParentName}, Varian: ${r.variantName})`)
                    continue
                  }
                  if (r.variantStock < 0) {
                    errors.push(`Baris ${rowNum}: Stok Varian tidak boleh negatif (Produk: ${currentParentName}, Varian: ${r.variantName})`)
                    continue
                  }

                  // Duplicate variant check (in-batch + existing)
                  const variantKey = `${currentParentName}||${r.variantName}`
                  if (batchVariantKeys.has(variantKey)) {
                    errors.push(`Baris ${rowNum}: Varian "${r.variantName}" sudah ada untuk produk "${currentParentName}"`)
                    continue
                  }
                  // Check existing variants (for existing parents only)
                  if (currentParentId && existingVariantKeySet.has(`${currentParentId}||${r.variantName}`)) {
                    errors.push(`Baris ${rowNum}: Varian "${r.variantName}" sudah ada untuk produk "${currentParentName}"`)
                    continue
                  }
                  batchVariantKeys.add(variantKey)

                  const finalVariantSku = r.variantSku || await generateVariantSKU(currentParentName, r.variantName, outletId)
                  const finalVariantBarcode = r.variantBarcode || finalVariantSku

                  // Collect variant for createMany (productId resolved after parent createMany)
                  variantsToCreate.push({
                    parentName: currentParentName,
                    name: r.variantName,
                    sku: finalVariantSku,
                    barcode: finalVariantBarcode,
                    hpp: r.variantHpp,
                    price: r.variantPrice,
                    stock: r.variantStock,
                    outletId,
                  })

                  variantsCreated++
                  if (finalVariantBarcode) barcodeCount++

                  // Collect opening stock audit log (entityId resolved after variant createMany)
                  if (r.variantStock > 0) {
                    variantBatchAuditLogs.push({
                      parentName: currentParentName,
                      variantName: r.variantName,
                      variantSku: finalVariantSku,
                      stock: r.variantStock,
                    })
                  }

                  // === Mode 2 (product_stock): per-variant 1:1 InventoryItem + ProductComposition ===
                  // Atomic invariant (mirrors non-variant Mode 2): variant + InventoryItem
                  // + 1:1 ProductComposition(variantId) + parent.hasComposition=true.
                  // Any failure in grouped writes below throws → tx rolls back.
                  // stock=0 still creates the item + link (same rationale as non-variant).
                  if (isStockMode) {
                    const variantInvName = `${currentParentName} - ${r.variantName}`
                    const variantInvUnit = 'pcs'

                    const existingVariantInv = existingVariantInvMap.get(variantInvName)

                    if (!existingVariantInv) {
                      // ── NEW VARIANT INVENTORY: collect for batch createMany ──
                      variantInvToCreate.push({
                        name: variantInvName,
                        sku: finalVariantSku,
                        baseUnit: variantInvUnit,
                        stock: r.variantStock,
                        avgCost: r.variantHpp > 0 ? r.variantHpp : 0,
                        lowStockAlert: 0,
                        status: 'ACTIVE',
                        outletId,
                        categoryId: null,
                      })

                      // Collect movement (invIdOrName = name → resolved after createMany)
                      variantMovementsToCreate.push({
                        type: 'PURCHASE',
                        quantity: r.variantStock,
                        previousStock: 0,
                        newStock: r.variantStock,
                        referenceType: 'MIGRATION',
                        notes: `Saldo awal stok gudang varian migrasi dari ${file.name}`,
                        outletId,
                        invIdOrName: variantInvName,
                        userId,
                      })

                      inventoryItemsCreated++
                      totalStock += r.variantStock
                      totalModalValue += r.variantHpp * r.variantStock

                      // Collect 1:1 composition link (both IDs resolved after createMany)
                      variantCompositionsToCreate.push({
                        parentName: currentParentName,
                        variantName: r.variantName,
                        invIdOrName: variantInvName,
                        unit: variantInvUnit,
                      })
                      compositionsCreated++
                    } else {
                      // ── EXISTING VARIANT INVENTORY: remigration analysis (from preloaded Map) ──
                      const variantAnalysis = variantRemigrationAnalysis.get(existingVariantInv.id)!

                      if (variantAnalysis.canReplace) {
                        // Safe to replace: collect for batch cleanup + per-row update
                        variantInvIdsToCleanup.push(existingVariantInv.id)
                        variantCleanupWarnings.set(existingVariantInv.id, { name: variantInvName, analysis: variantAnalysis })

                        variantInvToUpdate.push({
                          id: existingVariantInv.id,
                          name: variantInvName,
                          data: {
                            sku: finalVariantSku || existingVariantInv.sku,
                            baseUnit: variantInvUnit,
                            stock: r.variantStock,
                            avgCost: r.variantHpp > 0 ? r.variantHpp : 0,
                            lowStockAlert: 0,
                            status: 'ACTIVE',
                          },
                        })

                        // Movement for re-migrated item (invId is known — existing item)
                        variantMovementsToCreate.push({
                          type: 'PURCHASE',
                          quantity: r.variantStock,
                          previousStock: 0,
                          newStock: r.variantStock,
                          referenceType: 'MIGRATION',
                          notes: `Saldo awal stok gudang varian (re-migrate) dari ${file.name}`,
                          outletId,
                          invIdOrName: existingVariantInv.id,
                          userId,
                        })

                        inventoryItemsUpdated++
                        migrationDataCleaned++
                        totalStock += r.variantStock
                        totalModalValue += r.variantHpp * r.variantStock

                        // 1:1 composition link (productId resolved after parent createMany,
                        // variantId resolved after variant createMany, invId is known)
                        variantCompositionsToCreate.push({
                          parentName: currentParentName,
                          variantName: r.variantName,
                          invIdOrName: existingVariantInv.id,
                          unit: variantInvUnit,
                        })
                        compositionsCreated++
                      } else {
                        // Has real history: use existing, skip update, warn
                        inventoryItemCache.set(variantInvName, existingVariantInv.id)
                        inventoryItemsSkipped++
                        warnings.push(`⚠️ "${variantInvName}" menggunakan data existing: ${variantAnalysis.reason}`)

                        // Still create 1:1 composition link (variant is new, needs link)
                        variantCompositionsToCreate.push({
                          parentName: currentParentName,
                          variantName: r.variantName,
                          invIdOrName: existingVariantInv.id,
                          unit: variantInvUnit,
                        })
                        compositionsCreated++
                      }
                    }

                    // Track existing parents needing hasComposition update.
                    // New parents already have it set upfront (parentsWithVariants).
                    if (!currentParentIsNew && currentParentId) {
                      const existingParent = existingParentMap.get(currentParentName)
                      if (existingParent && !existingParent.hasComposition) {
                        parentIdsNeedingHasCompUpdate.add(currentParentId)
                      }
                    }
                  }

                  // Process inline composition for variant (ALWAYS defer — productId/variantId
                  // resolved after createMany)
                  if (includeInventory && r.komposisiVariantInline) {
                    variantBatchDeferredComps.push({
                      parentName: currentParentName,
                      variantName: r.variantName,
                      compositionStr: r.komposisiVariantInline,
                    })
                  }
                } else if (r.variantName && !currentParentName) {
                  errors.push(`Baris ${rowNum}: Varian "${r.variantName}" tidak memiliki produk induk`)
                }
              }

              // ═══════════════════════════════════════════
              // STEP 4: Grouped writes
              // ═══════════════════════════════════════════

              // 4a. Batch cleanup migration data (re-migration variant inventory items)
              // Replaces N calls to cleanupMigrationData (2 deleteMany each = 2N queries)
              // with 2 batch deleteMany queries.
              if (variantInvIdsToCleanup.length > 0) {
                // Delete MIGRATION movements for all items needing cleanup (1 query)
                await tx.inventoryMovement.deleteMany({
                  where: {
                    inventoryItemId: { in: variantInvIdsToCleanup },
                    referenceType: 'MIGRATION',
                    outletId,
                  },
                })
                // Delete auto 1:1 compositions for all items needing cleanup (1 query)
                await tx.productComposition.deleteMany({
                  where: {
                    inventoryItemId: { in: variantInvIdsToCleanup },
                    qty: 1,
                  },
                })
                // Push per-item warnings using preloaded analysis data (no extra queries)
                for (const id of variantInvIdsToCleanup) {
                  const { name, analysis } = variantCleanupWarnings.get(id)!
                  warnings.push(`🔄 "${name}": di-update (data migrasi lama dibersihkan: ${analysis.migrationOnlyData.movements} stok, ${analysis.migrationOnlyData.compositions} link)`)
                }
              }

              // 4b. Update existing variant inventory items (per-row — different values per row)
              // Cannot use updateMany (doesn't support different values per row).
              // These are re-migration items only; fresh import has 0 updates.
              for (const update of variantInvToUpdate) {
                await tx.inventoryItem.update({
                  where: { id: update.id },
                  data: update.data,
                })
                inventoryItemCache.set(update.name, update.id)
              }

              // 4c. Create new parent products (batched via createMany + re-query for IDs)
              let createdVariantParentMap = new Map<string, string>()
              if (variantParentsToCreate.length > 0) {
                await tx.product.createMany({ data: variantParentsToCreate })

                // Re-query to get IDs (1 query for all new parents)
                const createdParents = await tx.product.findMany({
                  where: { name: { in: variantParentsToCreate.map(p => p.name) }, outletId },
                  select: { id: true, name: true },
                })
                createdVariantParentMap = new Map(createdParents.map(p => [p.name, p.id]))

                // Populate productCache for Sheet 4 composition linking
                for (const [name, id] of createdVariantParentMap) {
                  productCache.set(name, id)
                }
              }

              // Merge existing + created parent maps for variant productId resolution
              const allParentIdMap = new Map<string, string>()
              for (const [name, p] of existingParentMap) allParentIdMap.set(name, p.id)
              for (const [name, id] of createdVariantParentMap) allParentIdMap.set(name, id)

              // 4d. Create new variants (batched via createMany + re-query for IDs)
              let createdVariantMap = new Map<string, string>()  // `${parentName}||${variantName}` → id
              if (variantsToCreate.length > 0) {
                const variantCreateData = variantsToCreate.map(v => ({
                  productId: allParentIdMap.get(v.parentName)!,
                  name: v.name,
                  sku: v.sku,
                  barcode: v.barcode,
                  hpp: v.hpp,
                  price: v.price,
                  stock: v.stock,
                  outletId: v.outletId,
                })).filter(v => v.productId)  // safety: skip if parentId not resolved

                if (variantCreateData.length > 0) {
                  await tx.productVariant.createMany({ data: variantCreateData })

                  // Re-query to get IDs (1 query for all new variants)
                  // Use productId + name composite (unique constraint @@unique([name, productId]))
                  const variantIdQueries = variantsToCreate.map(v => ({
                    productId: allParentIdMap.get(v.parentName)!,
                    name: v.name,
                  })).filter(v => v.productId)

                  // Fetch all newly created variants by their productId
                  const newVariantParentIds = [...new Set(variantIdQueries.map(v => v.productId))]
                  const createdVariants = await tx.productVariant.findMany({
                    where: { productId: { in: newVariantParentIds } },
                    select: { id: true, productId: true, name: true },
                  })

                  // Build map: need parentName to resolve. Reconstruct from variantIdQueries.
                  // Since we just created these variants, they all exist. Map by productId||name.
                  const productIdToName = new Map<string, string>()
                  for (const [parentName, parentId] of allParentIdMap) {
                    productIdToName.set(parentId, parentName)
                  }
                  for (const cv of createdVariants) {
                    const parentName = productIdToName.get(cv.productId)
                    if (parentName) {
                      createdVariantMap.set(`${parentName}||${cv.name}`, cv.id)
                      // Populate variantCache for Sheet 4 composition linking
                      variantCache.set(`${parentName}||${cv.name}`, cv.id)
                    }
                  }
                }
              }

              // 4e. Create new variant inventory items (batched via createMany + re-query)
              let createdVariantInvMap = new Map<string, string>()
              if (variantInvToCreate.length > 0) {
                await tx.inventoryItem.createMany({ data: variantInvToCreate })

                // Re-query to get IDs (1 query for all new variant inventory items)
                const createdVariantInvItems = await tx.inventoryItem.findMany({
                  where: { name: { in: variantInvToCreate.map(i => i.name) }, outletId },
                  select: { id: true, name: true },
                })
                createdVariantInvMap = new Map(createdVariantInvItems.map(i => [i.name, i.id]))

                // Populate inventoryItemCache
                for (const [name, id] of createdVariantInvMap) {
                  inventoryItemCache.set(name, id)
                }
              }

              // 4f. Create 1:1 composition links for variants (batched via createMany)
              // CONFLICT GUARD: All variants in this batch are NEW (duplicates were
              // skipped via existingVariantKeySet + batchVariantKeys). New variants
              // have ZERO existing compositions. The original per-row conflict guard
              // (productComposition.findMany → check existingCompositions.length > 0)
              // would always return empty for new variants → no conflict → always
              // create 1:1 link. We skip the findMany (which was 50 queries) and
              // create all links directly. This does NOT weaken the guard — the
              // guard's condition (existing compositions on a new variant) is
              // structurally impossible.
              // EXACT LINK CHECK: For new variants, no exact link can exist
              // (variant was just created). Same logic as conflict guard above.
              //
              // Any createMany failure (e.g., unexpected unique constraint) throws →
              // tx rolls back → Mode 2 atomic invariant preserved.
              if (variantCompositionsToCreate.length > 0) {
                const compData = variantCompositionsToCreate.map(c => ({
                  productId: allParentIdMap.get(c.parentName)!,
                  variantId: createdVariantMap.get(`${c.parentName}||${c.variantName}`)!,
                  inventoryItemId: c.invIdOrName.length > 20
                    ? c.invIdOrName  // already an ID (existing inventory, 24-char cuid)
                    : (createdVariantInvMap.get(c.invIdOrName) || c.invIdOrName),  // name → resolve
                  qty: 1,
                  baseUnit: c.unit,
                })).filter(c => c.productId && c.variantId && c.inventoryItemId)  // safety

                if (compData.length > 0) {
                  await tx.productComposition.createMany({ data: compData })
                }
              }

              // 4g. Create opening balance movements for variants (batched via createMany)
              // Non-fatal: movement creation failure is caught (matching original
              // per-item try/catch behavior).
              if (variantMovementsToCreate.length > 0) {
                const movData = variantMovementsToCreate.map(m => ({
                  type: m.type as 'PURCHASE',
                  quantity: m.quantity,
                  previousStock: m.previousStock,
                  newStock: m.newStock,
                  referenceType: m.referenceType as 'MIGRATION',
                  notes: m.notes,
                  outletId: m.outletId,
                  inventoryItemId: m.invIdOrName.length > 20
                    ? m.invIdOrName  // already an ID (existing inventory)
                    : (createdVariantInvMap.get(m.invIdOrName) || m.invIdOrName),  // name → resolve
                  userId: m.userId,
                })).filter(m => m.inventoryItemId)  // safety

                if (movData.length > 0) {
                  try {
                    await tx.inventoryMovement.createMany({ data: movData })
                  } catch (movErr) {
                    console.warn('[migration] Failed to batch-create variant opening balance movements:', movErr)
                  }
                }
              }

              // 4h. Update existing parents' hasComposition flag (batched via updateMany)
              // New parents already have it set upfront in createMany (parentsWithVariants).
              // Existing parents that got new variants need the update.
              if (parentIdsNeedingHasCompUpdate.size > 0) {
                await tx.product.updateMany({
                  where: { id: { in: [...parentIdsNeedingHasCompUpdate] } },
                  data: { hasComposition: true },
                })
              }

              // 4i. Resolve and push opening stock audit logs (entityId from variant re-query)
              for (const log of variantBatchAuditLogs) {
                const variantId = createdVariantMap.get(`${log.parentName}||${log.variantName}`)
                if (variantId) {
                  openingStockLogs.push({
                    action: 'RESTOCK',
                    entityType: 'VARIANT',
                    entityId: variantId,
                    details: JSON.stringify({
                      productName: log.parentName,
                      variantName: log.variantName,
                      variantSku: log.variantSku,
                      initialStock: log.stock,
                      newStock: log.stock,
                      reason: 'Stok awal migrasi',
                    }),
                    outletId,
                    userId,
                  })
                }
              }

              // 4j. Resolve and push deferred inline compositions (productId/variantId from re-query)
              for (const deferred of variantBatchDeferredComps) {
                const productId = allParentIdMap.get(deferred.parentName)
                const variantId = createdVariantMap.get(`${deferred.parentName}||${deferred.variantName}`)
                if (productId && variantId) {
                  deferredInlineCompositions.push({
                    productId,
                    variantId,
                    compositionStr: deferred.compositionStr,
                  })
                }
              }

              // 4k. Flush opening stock logs (batched createMany)
              await flushOpeningStockLogs(tx)
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
