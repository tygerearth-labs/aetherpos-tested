/**
 * Adapter: inventory:edit (ROW-MODE).
 *
 * Updates EXISTING InventoryItem metadata only. Does NOT edit stock or avgCost
 * (both are denormalized — stock = SUM(AVAILABLE InventoryBatch.remainingQty),
 * avgCost = weighted average from purchases). Direct edits would desync the
 * batch invariant. Stock changes go through /api/inventory/items/[id]/adjust
 * or stock opname (separate flows).
 *
 * EDITABLE fields: name, sku, baseUnit, lowStockAlert, status, categoryId
 * READ-ONLY (displayed but rejected with error if changed): stock, avgCost
 *
 * Lookup: itemId → name → sku (no auto-create — missing item = row error)
 *
 * Engine approach: preload all items by id/name/sku + InventoryCategories into
 * Maps, pure-function buildPlan, short 30s tx with grouped updates +
 * tx.auditLog.createMany (atomic, per-row traceable).
 */

import type {
  BatchError,
  BatchResult,
  BatchStats,
  BulkClientAdapter,
  BulkServerAdapter,
  ColumnSpec,
  ExecutionPlan,
  ParsedRow,
  PreloadData,
  RowValidation,
} from '../types'
import { interpretCell } from '../cell-semantics'
import { sanitizeNumber, validateUnit } from '@/lib/excel-utils'

const COLUMNS: ColumnSpec[] = [
  { key: 'id', label: 'ID Bahan', type: 'text', description: 'ID internal bahan baku. Bisa kosong jika pakai Nama.', aliases: ['id', 'id bahan', 'inventory item id'] },
  { key: 'name', label: 'Nama Bahan', required: true, type: 'text', aliases: ['nama', 'nama bahan', 'name', 'item name'] },
  { key: 'sku', label: 'SKU', type: 'text', aliases: ['sku', 'kode'] },
  { key: 'category', label: 'Kategori Bahan', type: 'text', aliases: ['kategori', 'category', 'kategori bahan'] },
  { key: 'unit', label: 'Satuan Dasar', type: 'text', description: 'gr, ml, kg, liter, meter, pcs', aliases: ['satuan', 'unit', 'base unit', 'satuan dasar'] },
  { key: 'lowStockAlert', label: 'Alert Stok Minim', type: 'number', aliases: ['low stock alert', 'stok minim', 'min stok', 'alert'] },
  { key: 'status', label: 'Status', type: 'text', description: 'ACTIVE atau INACTIVE', aliases: ['status'] },
]

export const inventoryAdjustmentClient: BulkClientAdapter = {
  kind: 'inventory:edit',
  label: 'Edit Bahan Baku (Excel)',
  description: 'Update metadata bahan baku (nama, SKU, kategori, satuan, alert). Stok & avgCost read-only (pakai Stock Opname/Adjust).',
  icon: 'Boxes',
  batchSize: 50,
  concurrency: 1,
  supportsClear: true,
  supportsDelete: false,
  templateColumns: COLUMNS,

  async parseFile(file: File) {
    const { parseWorkbookAsync } = await import('../sheet-parse')
    const res = await parseWorkbookAsync(file, { columns: COLUMNS, headerRow: 0 })
    return { rows: res.rows, sheetName: res.sheetName, warnings: res.warnings }
  },

  validateRow(row: ParsedRow): RowValidation {
    const errors: string[] = []
    const warnings: string[] = []
    if (!row.data.id && !row.data.name) {
      errors.push('ID atau Nama Bahan wajib diisi (untuk lookup).')
    }
    // Warn if user tries to edit stock/avgCost (read-only).
    if (row.data.stock !== undefined && row.data.stock !== '' && row.data.stock !== null) {
      warnings.push('Stok tidak bisa diedit via Excel (read-only). Gunakan Stock Opname atau Adjust.')
    }
    if (row.data.avgCost !== undefined && row.data.avgCost !== '' && row.data.avgCost !== null) {
      warnings.push('AvgCost tidak bisa diedit via Excel (read-only, dihitung dari pembelian).')
    }
    return { valid: errors.length === 0, errors, warnings }
  },

  executionMode: 'rows',
}

// ── Server adapter ─────────────────────────────────────────────────────────

interface InvPreload extends PreloadData {
  byId: Map<string, { id: string; name: string }>
  byNameLower: Map<string, string>
  bySku: Map<string, string>
  categoriesByName: Map<string, string>
}
interface UpdateOp {
  rowIndex: number
  itemId: string
  fields: Record<string, unknown>
  rowSnapshot: Record<string, unknown>
}

export const inventoryAdjustmentServer: BulkServerAdapter = {
  kind: 'inventory:edit',
  txTimeoutMs: 30_000,

  async preloadBatch(rows, context): Promise<InvPreload> {
    const { db } = await import('@/lib/db')
    const ids: string[] = []
    const names: string[] = []
    const skus: string[] = []
    for (const r of rows) {
      const id = String(r.data.id || '').trim()
      const name = String(r.data.name || '').trim()
      const sku = String(r.data.sku || '').trim()
      if (id) ids.push(id)
      if (name) names.push(name.toLowerCase())
      if (sku) skus.push(sku)
    }
    // NOTE: InventoryItem uses InventoryCategory (NOT Category which is for products).
    const [items, categories] = await Promise.all([
      db.inventoryItem.findMany({
        where: {
          outletId: context.outletId,
          OR: [
            ...(ids.length ? [{ id: { in: [...new Set(ids)] } }] : []),
            ...(names.length ? [{ name: { in: [...new Set(names)] } }] : []),
            ...(skus.length ? [{ sku: { in: [...new Set(skus)] } }] : []),
          ],
        },
        select: { id: true, name: true, sku: true },
      }),
      db.inventoryCategory.findMany({
        where: { outletId: context.outletId },
        select: { id: true, name: true },
      }),
    ])
    const byId = new Map<string, { id: string; name: string }>()
    const byNameLower = new Map<string, string>()
    const bySku = new Map<string, string>()
    for (const it of items) {
      byId.set(it.id, { id: it.id, name: it.name })
      byNameLower.set(it.name.toLowerCase(), it.id)
      if (it.sku) bySku.set(it.sku, it.id)
    }
    const categoriesByName = new Map<string, string>()
    for (const c of categories) categoriesByName.set(c.name.toLowerCase(), c.id)
    return { byId, byNameLower, bySku, categoriesByName }
  },

  buildPlan(rows, preload, _context): ExecutionPlan {
    const p = preload as InvPreload
    const ops: UpdateOp[] = []
    const errors: BatchError[] = []
    let skipped = 0
    const seenIds = new Set<string>()

    for (const row of rows) {
      const id = String(row.data.id || '').trim()
      const name = String(row.data.name || '').trim()
      const sku = String(row.data.sku || '').trim()
      let itemId: string | undefined
      if (id) itemId = p.byId.get(id)?.id
      if (!itemId && name) itemId = p.byNameLower.get(name.toLowerCase())
      if (!itemId && sku) itemId = p.bySku.get(sku)

      if (!itemId) {
        // Missing item = row error (no auto-create per spec).
        errors.push({
          rowIndex: row.rowIndex,
          rowSnapshot: row.raw,
          code: 'ITEM_NOT_FOUND',
          message: `Bahan baku tidak ditemukan (id="${id}" name="${name}" sku="${sku}"). Tidak ada auto-create.`,
        })
        continue
      }

      if (seenIds.has(itemId)) {
        errors.push({
          rowIndex: row.rowIndex,
          rowSnapshot: row.raw,
          code: 'DUPLICATE_LOOKUP',
          message: `Bahan baku muncul lebih dari sekali di batch ini.`,
        })
        continue
      }
      seenIds.add(itemId)

      const fields: Record<string, unknown> = {}
      const interpName = interpretCell(row.data.name, { supportsClear: false })
      if (interpName.kind === 'value') fields.name = String(interpName.value)
      const interpSku = interpretCell(row.data.sku, { supportsClear: true })
      if (interpSku.kind === 'value') fields.sku = String(interpSku.value)
      else if (interpSku.kind === 'clear') fields.sku = null
      const interpUnit = interpretCell(row.data.unit, { supportsClear: false })
      if (interpUnit.kind === 'value') fields.baseUnit = validateUnit(String(interpUnit.value))
      const interpAlert = interpretCell(row.data.lowStockAlert, { supportsClear: false })
      if (interpAlert.kind === 'value') fields.lowStockAlert = sanitizeNumber(interpAlert.value)
      const interpStatus = interpretCell(row.data.status, { supportsClear: false })
      if (interpStatus.kind === 'value') {
        const s = String(interpStatus.value).toUpperCase()
        if (s === 'ACTIVE' || s === 'INACTIVE' || s === 'ARCHIVED') fields.status = s
      }
      const interpCat = interpretCell(row.data.category, { supportsClear: true })
      if (interpCat.kind === 'value') {
        const catId = p.categoriesByName.get(String(interpCat.value).toLowerCase())
        if (catId) fields.categoryId = catId
      } else if (interpCat.kind === 'clear') {
        fields.categoryId = null
      }

      // Explicitly reject stock/avgCost edits (read-only, denormalized).
      if (
        (row.data.stock !== undefined && row.data.stock !== '' && row.data.stock !== null) ||
        (row.data.avgCost !== undefined && row.data.avgCost !== '' && row.data.avgCost !== null)
      ) {
        errors.push({
          rowIndex: row.rowIndex,
          rowSnapshot: row.raw,
          code: 'READONLY_FIELD',
          message: 'Stok dan avgCost tidak bisa diedit via Excel (read-only, denormalized). Gunakan Stock Opname atau Adjust.',
        })
        continue
      }

      if (Object.keys(fields).length === 0) {
        skipped++
        continue
      }
      ops.push({ rowIndex: row.rowIndex, itemId: itemId!, fields, rowSnapshot: row.raw })
    }
    return { operations: { ops, errors, skipped } }
  },

  async executeBatch(plan, tx, context, operationId): Promise<BatchResult> {
    const { ops, errors, skipped } = plan.operations as { ops: UpdateOp[]; errors: BatchError[]; skipped: number }
    const allErrors = [...errors]
    let updated = 0
    const auditData: Array<Record<string, unknown>> = []
    for (const op of ops) {
      try {
        await tx.inventoryItem.update({ where: { id: op.itemId }, data: op.fields })
        updated++
        auditData.push({
          action: 'UPDATE',
          entityType: 'INVENTORY_ITEM',
          entityId: op.itemId,
          details: JSON.stringify({ fields: op.fields, bulkOperationId: operationId }),
          outletId: context.outletId,
          userId: context.userId,
        })
      } catch (err) {
        allErrors.push({
          rowIndex: op.rowIndex,
          rowSnapshot: op.rowSnapshot,
          code: 'UPDATE_FAILED',
          message: err instanceof Error ? err.message : 'Gagal update bahan baku.',
        })
      }
    }
    // Batched audit logs (createMany) — atomic in-tx, per-row traceable.
    if (auditData.length > 0) {
      const CHUNK = 100
      for (let i = 0; i < auditData.length; i += CHUNK) {
        await tx.auditLog.createMany({ data: auditData.slice(i, i + CHUNK) as never })
      }
    }
    const stats: BatchStats = {
      processed: ops.length + skipped,
      created: 0,
      updated,
      skipped,
      failed: allErrors.length,
      deleted: 0,
    }
    return { status: 'completed', stats, errors: allErrors }
  },

  formatError(error, row) {
    return {
      rowIndex: row?.rowIndex || 0,
      rowSnapshot: row?.raw,
      code: 'INVENTORY_EDIT_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }
  },

  summarize(stats, errorCount, batches) {
    const details: string[] = []
    details.push(`${stats.updated} bahan baku diperbarui`)
    if (stats.skipped > 0) details.push(`${stats.skipped} tanpa perubahan`)
    if (errorCount > 0) details.push(`${errorCount} error`)
    const totalMs = batches.reduce((s, b) => s + b.durationMs, 0)
    details.push(`Total ${batches.length} batch · ${(totalMs / 1000).toFixed(1)}s`)
    return { label: stats.updated > 0 ? 'Edit bahan baku selesai' : 'Tidak ada perubahan', details }
  },
}
