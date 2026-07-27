/**
 * Adapter: purchase:add (DELEGATE-MODE).
 *
 * Imports NEW purchase orders from Excel. Each row = one line item. Rows are
 * grouped by the Excel `poNumber` column (grouping key only — the server
 * regenerates the real `orderNumber` as PO-YYYYMMDD-NNNN).
 *
 * The client adapter parses rows for preview + validation (so the user can
 * see what will be imported before clicking Start). The FILE BLOB is then
 * sent per-batch to the delegate endpoint `/api/bulk-engine/delegate/purchase`
 * with `mode=add`. The delegate route re-parses server-side, slices rows by
 * batchIndex, groups by poNumber, and POSTs each group to the existing
 * `/api/purchases` route (reusing 100% of its 3-phase tx: PO + items + stock
 * + FEFO batches + movements + audit + HPP recalc + P2002 race-safety).
 *
 * Why delegate-mode: the existing /api/purchases POST handler is 380 lines of
 * carefully-ordered transactional logic with FEFO + HPP integration. Inline
 * duplication would diverge. Internal fetch with the user's auth cookie keeps
 * the logic in one place.
 *
 * Idempotency: per-PO marker via AuditLog row (action='BULK_BATCH',
 * entityId=`{operationId}-po{poIndex}`). On retry, already-completed POs are
 * skipped. No extra Prisma model is used.
 */

import type {
  BatchResult,
  BulkClientAdapter,
  ColumnSpec,
  ParsedRow,
  RowValidation,
} from '../types'
import { sanitizeNumber, parseExcelDate } from '@/lib/excel-utils'

const COLUMNS: ColumnSpec[] = [
  {
    key: 'poNumber',
    label: 'No. PO (Grouping)',
    type: 'text',
    description: 'Nomor untuk pengelompokan; item dengan nomor sama masuk 1 PO. Server generate orderNumber sebenarnya.',
    aliases: ['no po', 'po number', 'po', 'nomor po'],
  },
  {
    key: 'supplierName',
    label: 'Supplier',
    type: 'text',
    description: 'Nama supplier (optional). Dicari berdasarkan nama; jika tidak ditemukan, PO dibuat tanpa supplier.',
    aliases: ['supplier', 'pemasok', 'supplier name'],
  },
  {
    key: 'itemName',
    label: 'Nama Bahan',
    required: true,
    type: 'text',
    description: 'Nama inventory item. Jika belum ada, akan dibuatkan baru.',
    aliases: ['nama bahan', 'item name', 'nama item', 'nama'],
  },
  {
    key: 'itemSku',
    label: 'SKU Bahan',
    type: 'text',
    description: 'SKU inventory item (optional, untuk lookup).',
    aliases: ['sku', 'kode bahan', 'item sku'],
  },
  {
    key: 'purchaseQty',
    label: 'Qty Beli',
    required: true,
    type: 'number',
    description: 'Jumlah pembelian dalam satuan beli (e.g. 1 Ekor).',
    aliases: ['qty beli', 'purchase qty', 'qty', 'jumlah'],
  },
  {
    key: 'purchaseUnit',
    label: 'Satuan Beli',
    required: true,
    type: 'text',
    description: 'Satuan beli (Ekor, Jerigen, Pcs, dll).',
    aliases: ['satuan beli', 'purchase unit', 'satuan'],
  },
  {
    key: 'baseQty',
    label: 'Qty Dasar (konversi)',
    required: true,
    type: 'number',
    description: 'Jumlah dalam satuan dasar (e.g. 1.85 kg per Ekor).',
    aliases: ['qty dasar', 'base qty', 'konversi'],
  },
  {
    key: 'baseUnit',
    label: 'Satuan Dasar',
    required: true,
    type: 'text',
    description: 'Satuan dasar (kg, gr, ml, liter, dll).',
    aliases: ['satuan dasar', 'base unit'],
  },
  {
    key: 'unitCost',
    label: 'Harga Satuan (Rp)',
    required: true,
    type: 'number',
    description: 'Harga per satuan beli (Rp).',
    aliases: ['harga satuan', 'unit cost', 'harga'],
  },
  {
    key: 'batch',
    label: 'No. Batch',
    type: 'text',
    description: 'Nomor batch/lot (optional). Auto-generated jika kosong.',
    aliases: ['batch', 'no batch', 'batch number'],
  },
  {
    key: 'expiredDate',
    label: 'Tanggal Expired',
    type: 'date',
    description: 'Tanggal kadaluarsa batch (optional).',
    aliases: ['expired', 'tgl expired', 'expired date', 'kadaluarsa'],
  },
]

/**
 * Map the delegate route's JSON response → engine BatchResult.
 * The delegate route returns:
 *   { status, stats, errors, warnings, totalBatches?, totalRows?, isLastBatch? }
 */
function mapPurchaseDelegateResponse(data: Record<string, unknown>): BatchResult {
  const status = (data.status as string) === 'failed' ? 'failed' : 'completed'
  const stats = (data.stats as BatchResult['stats']) || {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    deleted: 0,
  }
  const errors = (data.errors as BatchResult['errors']) || []
  const warnings = (data.warnings as string[]) || undefined
  return {
    status,
    stats,
    errors,
    warnings,
    totalBatches: (data.totalBatches as number) || undefined,
    totalRows: (data.totalRows as number) || undefined,
    isLastBatch: Boolean(data.isLastBatch),
  }
}

export const purchaseImportClient: BulkClientAdapter = {
  kind: 'purchase:add',
  label: 'Tambah Pembelian (Excel)',
  description: 'Import Purchase Order baru dari Excel. Group by No PO. Reuses /api/purchases (FEFO + HPP + audit).',
  icon: 'ShoppingCart',
  batchSize: 50,
  concurrency: 1,
  supportsClear: false,
  supportsDelete: false,
  templateColumns: COLUMNS,
  // No templateEndpoint → bulk-upload-dialog generates template from COLUMNS.

  /**
   * Parse the file client-side for preview + validation.
   *
   * IMPORTANT: unlike migration-products (which returns empty rows because
   * the migration route pre-counts via a separate helper), this adapter MUST
   * return real parsed rows. The bulk-worker-provider uses rows.length to
   * compute totalBatches = ceil(rows / batchSize) and the bulk-upload-dialog
   * shows the first 10 rows as preview + runs validateRow per row.
   *
   * The file Blob is stored separately in Dexie (by startJob) and re-sent
   * per batch — the delegate route re-parses server-side (server is the
   * source of truth for grouping + slicing).
   */
  async parseFile(file: File) {
    const { parseWorkbookAsync } = await import('../sheet-parse')
    const res = await parseWorkbookAsync(file, { columns: COLUMNS, headerRow: 0 })
    return { rows: res.rows, sheetName: res.sheetName, warnings: res.warnings }
  },

  validateRow(row: ParsedRow): RowValidation {
    const errors: string[] = []
    const warnings: string[] = []
    const poNumber = String(row.data.poNumber || '').trim()
    const itemName = String(row.data.itemName || '').trim()
    const qty = sanitizeNumber(row.data.purchaseQty)
    const baseQty = sanitizeNumber(row.data.baseQty)
    const cost = sanitizeNumber(row.data.unitCost)
    if (!poNumber) {
      errors.push('No. PO wajib diisi (untuk pengelompokan).')
    }
    if (!itemName) errors.push('Nama bahan wajib diisi.')
    if (qty <= 0) errors.push('Qty beli harus > 0.')
    if (baseQty <= 0) errors.push('Qty dasar harus > 0.')
    if (cost < 0) errors.push('Harga satuan tidak boleh negatif.')
    if (!String(row.data.purchaseUnit || '').trim()) {
      errors.push('Satuan beli wajib diisi.')
    }
    if (!String(row.data.baseUnit || '').trim()) {
      errors.push('Satuan dasar wajib diisi.')
    }
    const exp = parseExcelDate(row.data.expiredDate)
    if (row.data.expiredDate != null && String(row.data.expiredDate).trim() !== '' && !exp) {
      warnings.push('Tanggal expired tidak valid (akan diabaikan).')
    }
    return { valid: errors.length === 0, errors, warnings }
  },

  executionMode: 'file-delegate',
  delegateEndpoint: '/api/bulk-engine/delegate/purchase',
  delegateFields: { mode: 'add' },
  mapDelegateResponse: mapPurchaseDelegateResponse,
}
