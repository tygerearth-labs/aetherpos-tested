/**
 * Adapter: product:edit (ROW-MODE).
 *
 * V2 SCOPE RESET — fixes the critical gaps in the previous product-update
 * adapter:
 *  1. Lookup chain: productId → SKU → barcode → unique-name fallback
 *     (previously: id/name/sku only — barcode + unique-name missing).
 *  2. Composition stock capacity enforced via getMaxStockFromComposition
 *     inside the same tx (previously: silently allowed overstock beyond
 *     BOM capacity).
 *  3. stockCapInfo returned in BatchError when capped so the UI can show a
 *     precise "max: N (limited by: X)" hint.
 *  4. Variant product stock edits rejected (parent.stock must equal
 *     SUM(variants.stock) — Excel can't edit per-variant rows here).
 *  5. Audit log via tx.auditLog.createMany (atomic in-tx — no safeAuditLog
 *     phantom-logs if the surrounding tx rolls back).
 *
 * PRODUCT.stock vs INVENTORY_ITEM.stock:
 *  - Product.stock is a denormalized `Int` field (catalog-level).
 *  - InventoryItem.stock is the raw-materials stock tracked via
 *    InventoryMovement + InventoryBatch.
 *  - The existing PUT /api/products/[id] route does NOT create an
 *    InventoryMovement when Product.stock changes (it only does
 *    tx.product.update + tx.auditLog.create). We replicate that exact
 *    behavior here — Product.stock changes go through audit log only.
 *  - Raw-material inventory adjustments (with movements) go through the
 *    separate inventory:edit / /api/inventory/items/[id]/adjust flows.
 *
 * Cell semantics (EDIT mode):
 *  - blank = no change (skip field)
 *  - 0 = valid value (e.g. price 0, stock 0)
 *  - CLEAR = clear supported optional field (barcode, image, category)
 *  - DELETE not supported (use bulk-delete page)
 *
 * NOTE: The Product model does NOT have `status` or `description` fields.
 * Previous versions of this adapter referenced those fields, causing every
 * update to throw a Prisma "Unknown field" error silently (caught in
 * executeBatch's try/catch, pushed to errors). This is the root cause of
 * the "upload edit product tidak ada perubahan sama sekali" bug. Fixed by
 * removing those columns and adding the real editable fields: lowStockAlert
 * and image (Image URL).
 */

import type {
  BatchError,
  BatchResult,
  BatchStats,
  BulkChangeRecord,
  BulkClientAdapter,
  BulkServerAdapter,
  ColumnSpec,
  ExecutionPlan,
  ParsedRow,
  PreloadData,
  RowValidation,
  StockCapInfo,
} from '../types'
import { interpretCell } from '../cell-semantics'
import { sanitizeNumber, validateUnit } from '@/lib/excel-utils'
import { getMaxStockFromComposition } from '@/lib/comp-stock'

// ── Column spec ────────────────────────────────────────────────────────────

const COLUMNS: ColumnSpec[] = [
  { key: 'id', label: 'ID Produk', type: 'text', description: 'ID internal produk (untuk update presisi). Bisa kosong jika pakai SKU/Barcode/Nama.', aliases: ['id', 'id produk', 'product id'] },
  { key: 'name', label: 'Nama Produk', type: 'text', description: 'Nama produk existing (lookup fallback jika ID/SKU/Barcode kosong).', aliases: ['nama', 'nama produk', 'product name', 'name'] },
  { key: 'sku', label: 'SKU', type: 'text', description: 'SKU produk existing (lookup).', aliases: ['sku', 'kode'] },
  { key: 'barcode', label: 'Barcode', type: 'text', description: 'Barcode produk existing (lookup). Bisa di-CLEAR untuk hapus barcode.', aliases: ['barcode', 'code'] },
  { key: 'category', label: 'Kategori', type: 'text', aliases: ['kategori', 'category', 'cat'] },
  { key: 'price', label: 'Harga Jual (Rp)', type: 'number', aliases: ['harga jual', 'harga', 'price', 'price'] },
  { key: 'cost', label: 'HPP/Modal (Rp)', type: 'number', aliases: ['hpp', 'modal', 'cost', 'hpp/modal'] },
  { key: 'stock', label: 'Stok', type: 'number', description: 'Stok produk non-varian. Untuk produk varian, edit stok di UI varian (tidak didukung di sini).', aliases: ['stok', 'stock', 'qty'] },
  { key: 'unit', label: 'Satuan', type: 'text', aliases: ['satuan', 'unit'] },
  { key: 'lowStockAlert', label: 'Alert Stok Minim', type: 'number', aliases: ['low stock alert', 'stok minim', 'min stok', 'alert', 'alert stok minim'] },
  { key: 'imageUrl', label: 'Image URL', type: 'text', description: 'URL gambar produk (http/https). Kosongkan jika tidak mengubah. Isi "CLEAR" untuk hapus gambar.', aliases: ['image url', 'image', 'gambar', 'url gambar', 'foto'] },
]

// ── Client adapter ─────────────────────────────────────────────────────────

export const productUpdateClient: BulkClientAdapter = {
  kind: 'product:edit',
  label: 'Edit Produk (Excel)',
  description: 'Update harga, stok, kategori, dan field produk lainnya. Lookup by ID → SKU → Barcode → Nama.',
  icon: 'PackageEdit',
  batchSize: 50,
  concurrency: 1,
  supportsClear: true,
  supportsDelete: false,
  templateColumns: COLUMNS,
  // V2: Edit-mode downloads EXISTING data formatted per COLUMNS (not blank
  // template). The export-existing endpoint emits current products with
  // ID, name, SKU, barcode, category, price, hpp, stock, unit, lowStockAlert,
  // image URL — all editable fields on the Product model.
  templateEndpoint: '/api/bulk-engine/export-existing?kind=product:edit',

  async parseFile(file: File) {
    const { parseWorkbookAsync } = await import('../sheet-parse')
    const res = await parseWorkbookAsync(file, {
      columns: COLUMNS,
      headerRow: 0,
    })
    return { rows: res.rows, sheetName: res.sheetName, warnings: res.warnings }
  },

  validateRow(row: ParsedRow): RowValidation {
    const errors: string[] = []
    const warnings: string[] = []
    const id = String(row.data.id || '').trim()
    const name = String(row.data.name || '').trim()
    const sku = String(row.data.sku || '').trim()
    const barcode = String(row.data.barcode || '').trim()
    if (!id && !name && !sku && !barcode) {
      errors.push('Salah satu dari ID / Nama / SKU / Barcode wajib diisi (untuk identifikasi).')
    }
    const price = row.data.price
    if (price !== undefined && price !== '' && price !== null) {
      const n = sanitizeNumber(price)
      if (n < 0) errors.push('Harga jual tidak boleh negatif.')
    }
    const stock = row.data.stock
    if (stock !== undefined && stock !== '' && stock !== null) {
      const n = sanitizeNumber(stock)
      if (n < 0) warnings.push('Stok negatif akan disimpan apa adanya.')
    }
    const lowStockAlert = row.data.lowStockAlert
    if (lowStockAlert !== undefined && lowStockAlert !== '' && lowStockAlert !== null) {
      const n = sanitizeNumber(lowStockAlert)
      if (n < 0) errors.push('Alert stok minim tidak boleh negatif.')
    }
    const imageUrl = String(row.data.imageUrl || '').trim()
    if (imageUrl && imageUrl.toUpperCase() !== 'CLEAR') {
      if (!/^https?:\/\/.+/i.test(imageUrl)) {
        warnings.push('Image URL sebaiknya diawali http:// atau https://')
      }
    }
    return { valid: errors.length === 0, errors, warnings }
  },

  executionMode: 'rows',
}

// ── Server adapter ─────────────────────────────────────────────────────────

interface ProductPreloadEntry {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  hasVariants: boolean
  hasComposition: boolean
  stock: number
  image: string | null
}

interface ProductPreload extends PreloadData {
  byId: Map<string, ProductPreloadEntry>
  bySku: Map<string, string> // sku → id
  byBarcode: Map<string, string> // barcode → id
  byNameLower: Map<string, string[]> // lowercase name → id[] (unique-name fallback)
  categoriesByName: Map<string, string> // lowercase name → id
  categoriesById: Map<string, string> // id → name (for audit diff readability)
}

interface UpdateOp {
  rowIndex: number
  productId: string
  /** Non-stock fields to update (price, hpp, unit, barcode, lowStockAlert, image, categoryId). */
  fields: Record<string, unknown>
  /** Stock change plan; absent when stock cell is blank or when stock is rejected pre-execute. */
  stockChange?: {
    oldStock: number
    newStock: number
    /** True if product.hasComposition — executeBatch must validate capacity. */
    requiresCompStockValidation: boolean
  }
  rowSnapshot: Record<string, unknown>
}

export const productUpdateServer: BulkServerAdapter = {
  kind: 'product:edit',
  txTimeoutMs: 30_000, // composition validation may add queries per row

  async preloadBatch(rows, context): Promise<ProductPreload> {
    const { db } = await import('@/lib/db')
    const ids: string[] = []
    const names: string[] = []
    const skus: string[] = []
    const barcodes: string[] = []
    for (const r of rows) {
      const id = String(r.data.id || '').trim()
      const name = String(r.data.name || '').trim()
      const sku = String(r.data.sku || '').trim()
      const barcode = String(r.data.barcode || '').trim()
      if (id) ids.push(id)
      // NOTE: do NOT lowercase before the DB query. On SQLite, `name IN (...)`
      // is case-insensitive by default; on PostgreSQL it is case-sensitive.
      // Lowercasing here would make the query miss DB rows whose name case
      // differs from the Excel input on PostgreSQL. The byNameLower Map
      // (built from query results) handles JS-side case-insensitive lookup.
      if (name) names.push(name)
      if (sku) skus.push(sku)
      if (barcode) barcodes.push(barcode)
    }
    const uniqueIds = [...new Set(ids)]
    const uniqueNames = [...new Set(names)]
    const uniqueSkus = [...new Set(skus)]
    const uniqueBarcodes = [...new Set(barcodes)]

    const [products, categories] = await Promise.all([
      db.product.findMany({
        where: {
          outletId: context.outletId,
          OR: [
            ...(uniqueIds.length ? [{ id: { in: uniqueIds } }] : []),
            ...(uniqueNames.length ? [{ name: { in: uniqueNames } }] : []),
            ...(uniqueSkus.length ? [{ sku: { in: uniqueSkus } }] : []),
            ...(uniqueBarcodes.length ? [{ barcode: { in: uniqueBarcodes } }] : []),
          ],
        },
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          hasVariants: true,
          hasComposition: true,
          stock: true,
          image: true,
        },
      }),
      db.category.findMany({
        where: { outletId: context.outletId },
        select: { id: true, name: true },
      }),
    ])

    const byId = new Map<string, ProductPreloadEntry>()
    const bySku = new Map<string, string>()
    const byBarcode = new Map<string, string>()
    const byNameLower = new Map<string, string[]>()

    for (const p of products) {
      const entry: ProductPreloadEntry = {
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        hasVariants: p.hasVariants,
        hasComposition: p.hasComposition,
        stock: p.stock,
        image: p.image,
      }
      byId.set(p.id, entry)
      if (p.sku) bySku.set(p.sku, p.id)
      if (p.barcode) byBarcode.set(p.barcode, p.id)
      const lower = p.name.toLowerCase()
      const arr = byNameLower.get(lower)
      if (arr) arr.push(p.id)
      else byNameLower.set(lower, [p.id])
    }

    const categoriesByName = new Map<string, string>()
    const categoriesById = new Map<string, string>()
    for (const c of categories) {
      categoriesByName.set(c.name.toLowerCase(), c.id)
      categoriesById.set(c.id, c.name)
    }

    return { byId, bySku, byBarcode, byNameLower, categoriesByName, categoriesById }
  },

  buildPlan(rows, preload, _context): ExecutionPlan {
    const p = preload as ProductPreload
    const ops: UpdateOp[] = []
    const errors: BatchError[] = []
    let skipped = 0
    let processed = 0

    for (const row of rows) {
      processed++
      const id = String(row.data.id || '').trim()
      const name = String(row.data.name || '').trim()
      const sku = String(row.data.sku || '').trim()
      const barcode = String(row.data.barcode || '').trim()

      // Lookup chain: id → sku → barcode → name (unique fallback).
      let product: ProductPreloadEntry | undefined
      if (id) product = p.byId.get(id)
      if (!product && sku) {
        const bySkuId = p.bySku.get(sku)
        if (bySkuId) product = p.byId.get(bySkuId)
      }
      if (!product && barcode) {
        const byBarcodeId = p.byBarcode.get(barcode)
        if (byBarcodeId) product = p.byId.get(byBarcodeId)
      }
      if (!product && name) {
        const matches = p.byNameLower.get(name.toLowerCase())
        if (matches && matches.length === 1) {
          product = p.byId.get(matches[0])
        } else if (matches && matches.length > 1) {
          errors.push({
            rowIndex: row.rowIndex,
            rowSnapshot: row.raw,
            code: 'AMBIGUOUS_NAME',
            message: `Nama "${name}" cocok dengan ${matches.length} produk. Gunakan ID/SKU/Barcode untuk presisi.`,
          })
          continue
        }
      }

      if (!product) {
        errors.push({
          rowIndex: row.rowIndex,
          rowSnapshot: row.raw,
          code: 'PRODUCT_NOT_FOUND',
          message: `Produk tidak ditemukan (id="${id}" sku="${sku}" barcode="${barcode}" name="${name}").`,
        })
        continue
      }

      // ── Interpret non-stock cells ──
      const fields: Record<string, unknown> = {}

      const interpPrice = interpretCell(row.data.price, { supportsClear: false })
      if (interpPrice.kind === 'value') fields.price = sanitizeNumber(interpPrice.value)

      const interpCost = interpretCell(row.data.cost, { supportsClear: false })
      if (interpCost.kind === 'value') fields.hpp = sanitizeNumber(interpCost.value)

      const interpUnit = interpretCell(row.data.unit, { supportsClear: false })
      if (interpUnit.kind === 'value') fields.unit = validateUnit(String(interpUnit.value))

      // barcode is BOTH a lookup key AND an editable field. When the user
      // provides a barcode that doesn't match the existing product's
      // barcode (i.e. they're trying to change it), we still set it as a
      // field update — the lookup above already resolved the product via
      // id/sku/name in that case.
      const interpBarcode = interpretCell(row.data.barcode, { supportsClear: true })
      if (interpBarcode.kind === 'value') {
        const newBarcode = String(interpBarcode.value).trim()
        if (newBarcode !== (product.barcode || '')) fields.barcode = newBarcode
      } else if (interpBarcode.kind === 'clear') {
        fields.barcode = null
      }

      const interpLowStock = interpretCell(row.data.lowStockAlert, { supportsClear: false })
      if (interpLowStock.kind === 'value') {
        const n = sanitizeNumber(interpLowStock.value)
        if (n >= 0) fields.lowStockAlert = Math.round(n)
      }

      const interpImage = interpretCell(row.data.imageUrl, { supportsClear: true })
      if (interpImage.kind === 'value') {
        const newImage = String(interpImage.value).trim()
        if (newImage !== (product.image || '')) fields.image = newImage
      } else if (interpImage.kind === 'clear') {
        fields.image = null
      }

      const interpCat = interpretCell(row.data.category, { supportsClear: true })
      if (interpCat.kind === 'value') {
        const catId = p.categoriesByName.get(String(interpCat.value).toLowerCase())
        if (catId) fields.categoryId = catId
      } else if (interpCat.kind === 'clear') {
        fields.categoryId = null
      }

      // ── Interpret stock cell ──
      const interpStock = interpretCell(row.data.stock, { supportsClear: false })
      let stockChange: UpdateOp['stockChange'] | undefined
      if (interpStock.kind === 'value') {
        const newStock = Math.round(sanitizeNumber(interpStock.value))
        if (newStock < 0) {
          errors.push({
            rowIndex: row.rowIndex,
            rowSnapshot: row.raw,
            field: 'stock',
            code: 'INVALID_STOCK',
            message: `Stok tidak boleh negatif (produk: "${product.name}").`,
          })
          continue
        }
        // Variant products: parent.stock is derived from SUM(variants.stock)
        // and cannot be set directly via Excel. Other fields can still be
        // updated on the parent (price, category, etc.).
        if (product.hasVariants) {
          errors.push({
            rowIndex: row.rowIndex,
            rowSnapshot: row.raw,
            field: 'stock',
            code: 'VARIANT_STOCK_NOT_SUPPORTED',
            message: `Produk varian "${product.name}" tidak bisa edit stok via Excel — gunakan UI varian. Field lain tetap diproses.`,
          })
          // Don't `continue` — still apply other fields (price, category, etc.).
        } else if (newStock !== product.stock) {
          stockChange = {
            oldStock: product.stock,
            newStock,
            requiresCompStockValidation: product.hasComposition,
          }
        }
      }

      if (Object.keys(fields).length === 0 && !stockChange) {
        // No changes — skip.
        skipped++
        continue
      }

      ops.push({
        rowIndex: row.rowIndex,
        productId: product.id,
        fields,
        stockChange,
        rowSnapshot: row.raw,
      })
    }

    return { operations: { ops, errors, skipped, processed } as unknown as unknown[] }
  },

  async executeBatch(plan, tx, context, operationId): Promise<BatchResult> {
    const { ops, errors: planErrors, skipped, processed } = plan.operations as unknown as {
      ops: UpdateOp[]
      errors: BatchError[]
      skipped: number
      processed: number
    }
    const allErrors: BatchError[] = [...planErrors]
    let updated = 0
    // AuditLog V2: collect per-entity change records; the /execute route folds
    // them into ONE BULK_BATCH audit event (no per-row AuditLog spam).
    const changes: BulkChangeRecord[] = []

    for (const op of ops) {
      try {
        // Determine final fields for this update (may drop stock if capped).
        const finalFields: Record<string, unknown> = { ...op.fields }
        let stockCapped = false

        if (op.stockChange) {
          if (op.stockChange.requiresCompStockValidation) {
            // Validate composition capacity inside the tx so the check sees
            // any in-tx writes (defensive — adapter doesn't mutate composition
            // here, but consistent with the V14.1 comp-stock contract).
            const { maxStock, limitingItem } = await getMaxStockFromComposition(
              op.productId,
              context.outletId,
              tx,
            )
            if (maxStock !== Infinity && op.stockChange.newStock > maxStock) {
              // Capped — build the same message format as validateCompositionStock
              // (Indonesian, yield-aware) so behavior matches PUT /api/products/[id].
              const capInfo: StockCapInfo = {
                stockCapped: true,
                oldStock: op.stockChange.oldStock,
                newStock: op.stockChange.newStock,
                maxStock,
                limitingItemName: limitingItem?.name ?? null,
              }
              const message = limitingItem
                ? `Stok melebihi kapasitas komposisi. "${limitingItem.name}" hanya tersedia ${limitingItem.available} (butuh ${limitingItem.required} per batch). Maksimal: ${maxStock} unit.`
                : `Stok melebihi kapasitas komposisi. Maksimal: ${maxStock} unit.`
              allErrors.push({
                rowIndex: op.rowIndex,
                rowSnapshot: op.rowSnapshot,
                field: 'stock',
                code: 'COMPOSITION_STOCK_CAP_EXCEEDED',
                message,
                stockCapInfo: capInfo,
              })
              stockCapped = true
              // Don't apply stock — but still apply other fields below.
            } else {
              finalFields.stock = op.stockChange.newStock
            }
          } else {
            // Non-composition product — apply stock directly.
            finalFields.stock = op.stockChange.newStock
          }
        }

        // If the only intended change was stock and it got capped, there's
        // nothing to write. Skip the product.update call entirely (avoids a
        // no-op write + phantom audit log).
        if (Object.keys(finalFields).length === 0) {
          continue
        }

        await tx.product.update({
          where: { id: op.productId },
          data: finalFields,
        })
        updated++

        const auditFields: Record<string, unknown> = { ...finalFields }
        let note: string | undefined
        if (stockCapped) {
          auditFields.__stockCapped = true
          auditFields.__attemptedStock = op.stockChange!.newStock
          auditFields.__maxStock = allErrors[allErrors.length - 1]?.stockCapInfo?.maxStock ?? null
          note = `stock capped (max ${auditFields.__maxStock ?? '?'})`
        }
        changes.push({
          entity: 'PRODUCT',
          identifier: (op.rowSnapshot?.name as string) || op.productId,
          action: 'updated',
          after: auditFields,
          note,
        })
      } catch (err) {
        allErrors.push({
          rowIndex: op.rowIndex,
          rowSnapshot: op.rowSnapshot,
          code: 'UPDATE_FAILED',
          message: err instanceof Error ? err.message : 'Gagal update produk.',
        })
      }
    }

    const stats: BatchStats = {
      processed,
      created: 0,
      updated,
      skipped,
      failed: allErrors.length,
      deleted: 0,
    }
    return { status: 'completed', stats, errors: allErrors, changes }
  },

  formatError(error, row) {
    return {
      rowIndex: row?.rowIndex || 0,
      rowSnapshot: row?.raw,
      code: 'PRODUCT_EDIT_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }
  },

  summarize(stats, errorCount, batches) {
    const details: string[] = []
    if (stats.updated > 0) details.push(`${stats.updated} produk diperbarui`)
    if (stats.skipped > 0) details.push(`${stats.skipped} tanpa perubahan`)
    if (errorCount > 0) details.push(`${errorCount} error`)
    const totalMs = batches.reduce((s, b) => s + b.durationMs, 0)
    details.push(`Total ${batches.length} batch · ${(totalMs / 1000).toFixed(1)}s`)
    return {
      label: stats.updated > 0 ? 'Edit produk selesai' : 'Tidak ada perubahan',
      details,
    }
  },
}

export type { ProductPreload, ProductPreloadEntry, UpdateOp }
