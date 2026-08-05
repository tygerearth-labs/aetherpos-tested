/**
 * AETHER PURCHASE IMPORT — Canonical Field-Definition Source.
 *
 * SINGLE SOURCE OF TRUTH for every purchase import Excel template header and
 * parser alias. Consumed by:
 *   - src/app/api/purchases/import-excel/template/route.ts   (writes headers)
 *   - src/app/api/purchases/import-excel/route.ts             (reads aliases)
 *   - src/lib/bulk-engine/adapters/purchase-import.ts         (mirrors same fields)
 *
 * CONTRACT — each PurchaseFieldDef carries:
 *   key            : stable internal identifier used in code
 *   header         : exact Excel header string emitted by the template generator
 *   aliases        : every alternative header the parser will accept
 *   type           : 'text' | 'number' | 'date'
 *   required       : whether validation rejects empty/missing values
 *   default        : value used when the cell is empty
 *   example        : example value used in the template's sample rows
 *   validation     : human-readable description of the validation rule
 *   errorCode      : canonical error code emitted when validation fails
 *   correctionHint : default suggestion attached to a failed row
 *
 * RULES (per AETHER BULK TEMPLATE CONTRACT ALIGNMENT):
 *   - Use the canonical purchase unit resolver (purchase-unit-resolver.ts).
 *   - Unknown packaging units require explicit mapping (Isi per Satuan + Satuan Dasar).
 *   - Batch fields remain optional.
 *   - Purchase-created batches use the actual PurchaseOrder relation (purchaseOrderId = real PO id).
 *   - Direct posting and Apply-to-Form must use the SAME validation gate (both go through
 *     createPurchaseFromDraft → validateCanonicalPurchaseUnits).
 *   - purchaseOrderId is NEVER a column — it's always derived from the just-created PO.
 */

export interface PurchaseFieldDef {
  key: string
  header: string
  aliases: string[]
  type: 'text' | 'number' | 'date'
  required: boolean
  default?: string | number
  example?: string | number
  validation: string
  errorCode: string
  correctionHint: string
}

export const PURCHASE_FIELDS: PurchaseFieldDef[] = [
  {
    key: 'name',
    header: 'Nama Barang*',
    aliases: [
      'NAMA BARANG', 'Nama Barang', 'NAMA ITEM', 'Nama Item',
      'BARANG', 'ITEM', 'Nama', 'NAME', 'name',
      'Product Name', 'Produk', 'Deskripsi',
    ],
    type: 'text',
    required: true,
    example: 'Tepung Terigu Segitiga Biru 1kg',
    validation: 'Tidak boleh kosong. Di-match ke inventory item existing (case-insensitive) berdasarkan SKU lalu nama; jika tidak ditemukan, item baru dibuat saat PO disubmit.',
    errorCode: 'PUR_NAME_REQUIRED',
    correctionHint: 'Isi nama barang pada kolom Nama Barang*.',
  },
  {
    key: 'sku',
    header: 'SKU',
    aliases: ['SKU', 'sku', 'Kode', 'kode', 'KODE SKU', 'Kode Barang', 'Barcode'],
    type: 'text',
    required: false,
    example: 'SKU-TPG-001',
    validation: 'Opsional. Dipakai untuk lookup inventory item yang sudah ada.',
    errorCode: 'PUR_SKU_INVALID',
    correctionHint: 'SKU opsional; kosongkan jika ingin match berdasarkan nama.',
  },
  {
    key: 'purchaseUnit',
    header: 'Satuan Beli',
    aliases: ['SATUAN BELI', 'Satuan Beli', 'SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'UOM', 'Sat'],
    type: 'text',
    required: false,
    example: 'karung',
    validation: 'Opsional. Jika kosong, diisi dari matchedItem atau = baseUnit. Harus dikenal purchase-unit-resolver (DEFAULT_ALLOWED_PURCHASE_UNITS) jika berbeda dari baseUnit.',
    errorCode: 'PUR_UNIT_UNKNOWN',
    correctionHint: 'Satuan Beli tidak dikenal. Tambahkan mapping di purchase-unit-resolver atau gunakan satuan standar (pcs, kg, dus, karton, lusin, slop, ...).',
  },
  {
    key: 'qty',
    header: 'Jumlah*',
    aliases: ['JUMLAH', 'Jumlah', 'QTY', 'Qty', 'qty', 'Quantity', 'quantity', 'QTY BELI', 'Qty Beli', 'Banyak', 'Total Qty'],
    type: 'number',
    required: true,
    example: 10,
    validation: 'Angka > 0. Jumlah dalam satuan beli (bukan satuan dasar).',
    errorCode: 'PUR_QTY_INVALID',
    correctionHint: 'Jumlah* harus angka > 0. Contoh: 10.',
  },
  {
    key: 'baseQty',
    header: 'Isi per Satuan',
    aliases: ['ISI PER SATUAN', 'Isi per Satuan', 'ISI', 'Isi', 'isi', 'Konversi', 'konversi', 'KONVERSI', 'Base Qty', 'Isi Satuan', 'Isi per Unit', 'Qty per Unit', 'Berat Bersih'],
    type: 'number',
    required: false,
    default: 1,
    example: 1,
    validation: 'Opsional. Default 1 (1 satuan beli = 1 satuan dasar). Untuk konversi: 1 dus berisi 12 pcs → isi 12.',
    errorCode: 'PUR_BASE_QTY_INVALID',
    correctionHint: 'Isi per Satuan harus angka > 0. Default 1 jika kosong. Contoh: 12 untuk 1 dus = 12 pcs.',
  },
  {
    key: 'baseUnit',
    header: 'Satuan Dasar',
    aliases: ['SATUAN DASAR', 'Satuan Dasar', 'Base Unit', 'base unit', 'UNIT DASAR', 'Unit Dasar', 'Sat Dasar'],
    type: 'text',
    required: false,
    example: 'kg',
    validation: 'Opsional. Diisi dari matchedItem jika kosong. Harus dikenal purchase-unit-resolver.',
    errorCode: 'PUR_BASE_UNIT_UNKNOWN',
    correctionHint: 'Satuan Dasar tidak dikenal. Gunakan pcs, kg, gr, ml, liter, butir, dll.',
  },
  {
    key: 'pricePerUnit',
    header: 'Harga Satuan (Rp)*',
    aliases: [
      'HARGA', 'Harga', 'harga', 'PRICE', 'price',
      'HARGA BELI', 'Harga Beli', 'HARGA SATUAN', 'Harga Satuan',
      'Harga per Unit', 'Price per Unit', 'Unit Price',
      'TOTAL', 'Total', 'TOTAL HARGA', 'Total Harga', 'Subtotal', 'subtotal',
      'NOMINAL', 'Nominal', 'BIAYA', 'Biaya',
    ],
    type: 'number',
    required: true,
    example: 12000,
    validation: 'Angka >= 0. Harga per SATUAN BELI (bukan per satuan dasar). Format: 25000 atau Rp25.000 atau 25.000.',
    errorCode: 'PUR_PRICE_INVALID',
    correctionHint: 'Harga Satuan (Rp)* harus angka >= 0. Contoh: 12000 (per karung, bukan per kg).',
  },
  {
    key: 'batch',
    header: 'No. Batch',
    aliases: [
      'BATCH', 'Batch', 'batch', 'NO BATCH', 'No Batch',
      'NO LOT', 'No Lot', 'LOT', 'Lot', 'LOT NUMBER', 'Lot Number',
      'NO LOT NUMBER', 'No Lot Number', 'BATCH NUMBER', 'Batch Number',
      'NOMOR BATCH', 'Nomor Batch', 'NOMOR LOT', 'Nomor Lot',
    ],
    type: 'text',
    required: false,
    example: 'B2025-0701',
    validation: 'Opsional. Jika kosong, auto-generate sebagai AUTO-YYYYMMDD-NNNN. Batch number yang sama dari pembelian sebelumnya akan menambah stok batch existing.',
    errorCode: 'PUR_BATCH_INVALID',
    correctionHint: 'No. Batch opsional; isi dengan nomor lot dari supplier atau kosongkan untuk auto-generate.',
  },
  {
    key: 'expiredDate',
    header: 'Tgl Kadaluarsa',
    aliases: [
      'EXPIRED', 'Expired', 'expired', 'EXP DATE', 'Exp Date',
      'EXPIRY DATE', 'Expiry Date', 'EXPIRY', 'Expiry',
      'TANGGAL EXPIRED', 'Tanggal Expired', 'TGL KADALUARSA', 'Tgl Kadaluarsa',
      'KADALUARSA', 'Kadaluarsa', 'TGL EXPIRED', 'Tgl Expired',
      'TANGGAL KADALUARSA', 'EXP', 'Exp', 'BEST BEFORE', 'USE BY',
      'TANGGAL EXPIRY', 'Tanggal Expiry',
    ],
    type: 'date',
    required: false,
    example: '2026-01-15',
    validation: 'Opsional. Format: YYYY-MM-DD (rekomendasi), DD/MM/YYYY, DD-MM-YYYY, atau Excel date. Kosongkan jika barang tidak punya expiry.',
    errorCode: 'PUR_EXPIRED_INVALID',
    correctionHint: 'Format tanggal: YYYY-MM-DD (contoh: 2026-01-15) atau DD/MM/YYYY.',
  },
]

/** Header row in canonical order (matches the template generator). */
export const PURCHASE_HEADER_ROW: string[] = PURCHASE_FIELDS.map((f) => f.header)

/** Build alias array for a given field key. */
export function getPurchaseAliases(key: string): string[] {
  const def = PURCHASE_FIELDS.find((f) => f.key === key)
  if (!def) throw new Error(`Unknown purchase field key: ${key}`)
  return def.aliases
}

/** Look up a field def by key. */
export function getPurchaseFieldDef(key: string): PurchaseFieldDef | undefined {
  return PURCHASE_FIELDS.find((f) => f.key === key)
}

/**
 * Lookup table: errorCode → correctionHint. Used by the error exporter to
 * attach a Saran Perbaikan to every failed row.
 */
export const PURCHASE_ERROR_HINTS: Record<string, string> = Object.fromEntries(
  PURCHASE_FIELDS.map((f) => [f.errorCode, f.correctionHint]),
)

/** Generic fallback error code when no specific cause is known. */
export const PURCHASE_ROW_ERROR_GENERIC = 'PURCHASE_ROW_ERROR'
