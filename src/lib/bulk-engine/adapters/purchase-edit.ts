/**
 * Adapter: purchase:edit (DELEGATE-MODE).
 *
 * Edits EXISTING purchase orders from Excel. Each row = one line item. Rows
 * are grouped by the Excel `poNumber` column, which MUST match an existing
 * PurchaseOrder.orderNumber. The delegate route looks up the PO by
 * orderNumber, then PUTs the rebuilt items list to `/api/purchases/[id]`.
 *
 * The existing PUT route handles:
 *  - Reversal of old items (stock -= oldBaseQty, with sufficiency check)
 *  - Delete old PurchaseOrderItems
 *  - Create new PurchaseOrderItems
 *  - Reapply stock + new weighted-average cost
 *  - FEFOEngine.deleteBatchesForPurchase + createBatchesFromPurchase
 *    (throws if any old batch was partially consumed — protects FEFO integrity)
 *  - HPP recalculation for affected composition products
 *  - Audit + movement logs
 *
 * The client adapter is structurally identical to purchase:add (same parse +
 * validate + delegate wiring) — only the column set differs (adds `notes`,
 * and `poNumber` means an existing orderNumber) and `delegateFields.mode='edit'`.
 *
 * Idempotency: per-PO marker via AuditLog row (action='BULK_BATCH',
 * entityId=`{operationId}-po{poIndex}`). On retry, already-edited POs are
 * skipped. No extra Prisma model is used.
 *
 * LIMITATION: editing a PO whose batches were partially consumed (sold/used)
 * will FAIL — the PUT route throws when `remainingQty < initialQty` on any
 * batch. This is intentional: protects consumption-log integrity. The error
 * is surfaced per-PO in the BatchResult.errors list.
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
    label: 'No. PO (existing)',
    required: true,
    type: 'text',
    description: 'orderNumber PO yang sudah ada (e.g. PO-20250115-0001). Wajib.',
    aliases: ['no po', 'po number', 'po', 'nomor po', 'order number', 'ordernumber'],
  },
  {
    key: 'supplierName',
    label: 'Supplier Baru',
    type: 'text',
    description: 'Kosongkan jika tidak mengubah supplier. Jika diisi, dicari by nama.',
    aliases: ['supplier', 'pemasok', 'supplier name'],
  },
  {
    key: 'notes',
    label: 'Catatan Baru',
    type: 'text',
    description: 'Kosongkan jika tidak mengubah catatan. Jika diisi, menggantikan notes PO.',
    aliases: ['catatan', 'notes', 'keterangan'],
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
 * Same shape as purchase:add (the delegate route emits a uniform contract).
 */
function mapPurchaseEditDelegateResponse(data: Record<string, unknown>): BatchResult {
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

export const purchaseEditClient: BulkClientAdapter = {
  kind: 'purchase:edit',
  label: 'Edit Pembelian (Excel)',
  description: 'Edit Purchase Order existing dari Excel. Match by No. PO (orderNumber). Reuses /api/purchases/[id] (reversal + reapply + FEFO + HPP).',
  icon: 'ShoppingCart',
  batchSize: 50,
  concurrency: 1,
  supportsClear: false,
  supportsDelete: false,
  templateColumns: COLUMNS,
  // V2: Edit-mode downloads EXISTING data formatted per COLUMNS (not blank
  // template). The export-existing endpoint emits current PO line items
  // with poNumber + item data pre-filled; "Supplier Baru" and "Catatan
  // Baru" columns left blank — user fills only if changing.
  templateEndpoint: '/api/bulk-engine/export-existing?kind=purchase:edit',

  /**
   * Parse the file client-side for preview + validation (same pattern as
   * purchase:add — the file Blob is stored in Dexie and re-sent per batch).
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
      errors.push('No. PO wajib diisi (orderNumber PO yang sudah ada).')
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
  delegateFields: { mode: 'edit' },
  mapDelegateResponse: mapPurchaseEditDelegateResponse,
}
