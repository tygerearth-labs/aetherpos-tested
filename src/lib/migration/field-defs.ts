/**
 * AETHER MIGRATION — Canonical Field-Definition Source.
 *
 * SINGLE SOURCE OF TRUTH for every migration Excel template header and parser
 * alias. Consumed by:
 *   - src/app/api/migration/template/route.ts   (writes headers)
 *   - src/app/api/migration/import/route.ts      (reads aliases)
 *
 * CONTRACT — each FieldDef carries:
 *   key         : stable internal identifier used in code
 *   header      : exact Excel header string emitted by the template generator
 *   aliases     : every alternative header the parser will accept (normalized
 *                 via normalizeHeader before comparison)
 *   type        : 'text' | 'number' | 'date'
 *   required    : whether validation rejects empty/missing values
 *   modes       : which template modes include this column
 *                 ('product_only' | 'product_stock' | 'product_inventory')
 *   default     : value used when the cell is empty
 *   example     : example value used in the template's sample rows
 *   validation  : human-readable description of the validation rule
 *   errorCode   : canonical error code emitted when validation fails
 *   correctionHint : default suggestion attached to a failed row
 *
 * RULES (per AETHER BULK TEMPLATE CONTRACT ALIGNMENT):
 *   - Product-only mode creates Product/Variant only.
 *   - Product+inventory mode creates Product/Variant + InventoryItem + opening stock.
 *   - Batch input is OPTIONAL (migration creates one MIGRATION- batch per item
 *     with stock > 0; users do NOT supply batch fields).
 *   - purchaseOrderId must NEVER appear in migration templates. (Verified.)
 *   - Inventory created through migration follows the current batch contract
 *     (purchaseOrderId=null, source tagged via batchNumber prefix).
 *   - Variant rows map to parent product via row grouping (NOT parent SKU).
 *   - Existing SKU/barcode duplicate behavior: SKIP (not update, not fail).
 */

import { VALID_UNITS as EXCEL_VALID_UNITS } from '@/lib/excel-utils'

export type MigrationMode = 'product_only' | 'product_stock' | 'product_inventory'

/**
 * Canonical VALID_UNITS for migration. Re-exported from excel-utils so there
 * is ONE list shared by every flow (template dropdown, parser validation,
 * bulk-engine adapters). The previous drift (template had `sak`, `batang`,
 * `m3` that the parser silently downgraded to `pcs`) is closed: every flow
 * now consults this single list.
 */
export const MIGRATION_VALID_UNITS = [...EXCEL_VALID_UNITS] as string[]

/** Drop-down string for the template's data validation cell. */
export const MIGRATION_UNIT_DROPDOWN = MIGRATION_VALID_UNITS.join(',')

export interface MigrationFieldDef {
  key: string
  header: string
  aliases: string[]
  type: 'text' | 'number' | 'date'
  required: boolean
  modes: MigrationMode[]
  default?: string | number
  example?: string | number
  validation: string
  errorCode: string
  correctionHint: string
}

// ── SHEET 1: Produk Non-Varian ──────────────────────────────────────────────

export const NON_VARIANT_FIELDS: MigrationFieldDef[] = [
  {
    key: 'name',
    header: 'NAMA PRODUK*',
    aliases: ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk'],
    type: 'text',
    required: true,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 'Kopi Susu',
    validation: 'Tidak boleh kosong. Duplikat nama produk yang sudah ada akan di-skip.',
    errorCode: 'MIG_NAME_REQUIRED',
    correctionHint: 'Isi nama produk pada kolom NAMA PRODUK*.',
  },
  {
    key: 'sku',
    header: 'SKU',
    aliases: ['SKU', 'sku', 'Kode'],
    type: 'text',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 'SKU-KS-001',
    validation: 'Opsional. Jika kosong, auto-generate. Jika bentrok dengan SKU yang sudah ada, baris di-skip.',
    errorCode: 'MIG_SKU_DUPLICATE',
    correctionHint: 'SKU sudah dipakai produk lain. Kosongkan untuk auto-generate atau gunakan SKU unik.',
  },
  {
    key: 'barcode',
    header: 'BARCODE',
    aliases: ['BARCODE', 'Barcode', 'barcode', 'BAR CODE', 'Bar Code'],
    type: 'text',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: '8990001234567',
    validation: 'Opsional. Jika kosong, auto-generate. Jika bentrok, baris di-skip.',
    errorCode: 'MIG_BARCODE_DUPLICATE',
    correctionHint: 'Barcode sudah dipakai produk lain. Kosongkan untuk auto-generate atau gunakan barcode unik.',
  },
  {
    key: 'hpp',
    header: 'HPP / MODAL (Rp)',
    aliases: ['HPP / MODAL (Rp)', 'HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal', 'HPP MODAL Rp'],
    type: 'number',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    default: 0,
    example: 15000,
    validation: 'Angka >= 0. Format: 25000 atau Rp25.000 atau 25.000. Negatif ditolak.',
    errorCode: 'MIG_HPP_INVALID',
    correctionHint: 'HPP harus angka >= 0. Contoh: 15000 atau Rp15.000.',
  },
  {
    key: 'price',
    header: 'HARGA JUAL* (Rp)',
    aliases: ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'],
    type: 'number',
    required: true,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 20000,
    validation: 'Angka > 0. Format: 25000 atau Rp25.000 atau 25.000. Negatif atau nol ditolak.',
    errorCode: 'MIG_PRICE_REQUIRED',
    correctionHint: 'HARGA JUAL* wajib diisi dengan angka > 0. Contoh: 20000 atau Rp20.000.',
  },
  {
    key: 'stock',
    header: 'STOK AWAL',
    aliases: ['STOK AWAL', 'STOK', 'QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah'],
    type: 'number',
    required: false,
    modes: ['product_stock', 'product_inventory'],
    default: 0,
    example: 100,
    validation: 'Angka >= 0. Negatif ditolak. Hanya dipakai pada mode product_stock & product_inventory.',
    errorCode: 'MIG_STOCK_INVALID',
    correctionHint: 'STOK AWAL harus angka >= 0. Contoh: 100.',
  },
  {
    key: 'unit',
    header: 'SATUAN',
    aliases: ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat'],
    type: 'text',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    default: 'pcs',
    example: 'pcs',
    validation: `Salah satu dari: ${MIGRATION_VALID_UNITS.join(', ')}. Nilai tidak dikenal akan diturunkan ke 'pcs'.`,
    errorCode: 'MIG_UNIT_UNKNOWN',
    correctionHint: `Gunakan satuan yang valid: ${MIGRATION_VALID_UNITS.join(', ')}.`,
  },
  {
    key: 'category',
    header: 'KATEGORI',
    aliases: ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat'],
    type: 'text',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 'Minuman',
    validation: 'Opsional. Kategori baru otomatis dibuat jika belum ada.',
    errorCode: 'MIG_CATEGORY_INVALID',
    correctionHint: 'KATEGORI opsional; isi dengan nama kategori yang singkat.',
  },
  {
    key: 'lowStockAlert',
    header: 'LOW STOCK ALERT',
    aliases: ['LOW STOCK ALERT', 'Low Stock Alert', 'low stock alert', 'Low Stock', 'LOW STOCK', 'Stock Alert', 'STOK MINIMUM'],
    type: 'number',
    required: false,
    modes: ['product_stock', 'product_inventory'],
    default: 1,
    example: 5,
    validation: 'Angka >= 0. Default 1 jika kosong.',
    errorCode: 'MIG_LOW_STOCK_INVALID',
    correctionHint: 'LOW STOCK ALERT harus angka >= 0. Contoh: 5.',
  },
  {
    key: 'komposisiInline',
    header: 'KOMPOSISI INLINE (Opsional)',
    aliases: ['KOMPOSISI INLINE', 'KOMPOSISI INLINE (Opsional)', 'Komposisi Inline', 'KOMPOSISI', 'Komposisi', 'komposisi'],
    type: 'text',
    required: false,
    modes: ['product_inventory'],
    example: 'Nasi:200gr,Telur:1pcs,Minyak:15ml',
    validation: 'Format: NamaBahan:qtySatuan,NamaBahan:qtySatuan. Hanya mode product_inventory.',
    errorCode: 'MIG_KOMPOSISI_INVALID',
    correctionHint: 'Format komposisi: NamaBahan:qtySatuan dipisah koma. Contoh: Nasi:200gr,Telur:1pcs.',
  },
]

// ── SHEET 2: Produk Varian ──────────────────────────────────────────────────

export const VARIANT_FIELDS: MigrationFieldDef[] = [
  {
    key: 'parentName',
    header: 'NAMA PRODUK*',
    aliases: ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk'],
    type: 'text',
    required: true,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 'Kopi Susu',
    validation: 'Nama produk induk. Baris varian dengan kolom ini kosong mewarisi nilai dari baris di atasnya.',
    errorCode: 'MIG_VARIANT_PARENT_REQUIRED',
    correctionHint: 'Isi NAMA PRODUK* pada baris pertama kelompok varian.',
  },
  {
    key: 'parentSku',
    header: 'SKU PRODUK',
    aliases: ['SKU PRODUK', 'SKU Produk', 'sku produk'],
    type: 'text',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 'SKU-KS-001',
    validation: 'Opsional. Auto-generate jika kosong.',
    errorCode: 'MIG_VARIANT_PARENT_SKU_INVALID',
    correctionHint: 'SKU PRODUK opsional; kosongkan untuk auto-generate.',
  },
  {
    key: 'parentBarcode',
    header: 'BARCODE PRODUK',
    aliases: ['BARCODE PRODUK', 'Barcode Produk', 'barcode produk'],
    type: 'text',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: '8990001234567',
    validation: 'Opsional. Auto-generate jika kosong.',
    errorCode: 'MIG_VARIANT_PARENT_BARCODE_INVALID',
    correctionHint: 'BARCODE PRODUK opsional; kosongkan untuk auto-generate.',
  },
  {
    key: 'parentHpp',
    header: 'HPP PRODUK (Rp)',
    aliases: ['HPP PRODUK (Rp)', 'HPP PRODUK', 'HPP Produk', 'hpp produk'],
    type: 'number',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    default: 0,
    example: 15000,
    validation: 'Angka >= 0. Default 0 jika kosong.',
    errorCode: 'MIG_VARIANT_PARENT_HPP_INVALID',
    correctionHint: 'HPP PRODUK harus angka >= 0. Contoh: 15000.',
  },
  {
    key: 'parentPrice',
    header: 'HARGA JUAL PRODUK* (Rp)',
    aliases: ['HARGA JUAL PRODUK* (Rp)', 'HARGA JUAL PRODUK', 'HARGA JUAL PRODUK (Rp)', 'harga jual produk'],
    type: 'number',
    required: true,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 20000,
    validation: 'Angka > 0. Header bertanda * (wajib). Default 0 ditolak — gunakan angka > 0.',
    errorCode: 'MIG_VARIANT_PARENT_PRICE_REQUIRED',
    correctionHint: 'HARGA JUAL PRODUK* wajib diisi angka > 0 pada baris pertama kelompok varian.',
  },
  {
    key: 'category',
    header: 'KATEGORI',
    aliases: ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat'],
    type: 'text',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 'Minuman',
    validation: 'Opsional. Kategori baru otomatis dibuat jika belum ada.',
    errorCode: 'MIG_CATEGORY_INVALID',
    correctionHint: 'KATEGORI opsional; isi dengan nama kategori yang singkat.',
  },
  {
    key: 'variantName',
    header: 'NAMA VARIAN*',
    aliases: ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Nama Variant', 'nama varian', 'Varian', 'VARIAN'],
    type: 'text',
    required: true,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 'Regular 300ml',
    validation: 'Tidak boleh kosong. Kombinasi parentName||variantName harus unik per file dan per DB.',
    errorCode: 'MIG_VARIANT_NAME_REQUIRED',
    correctionHint: 'Isi NAMA VARIAN* dengan nama unik per produk induk.',
  },
  {
    key: 'variantSku',
    header: 'SKU VARIAN',
    aliases: ['SKU VARIAN', 'SKU Varian', 'sku varian'],
    type: 'text',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 'SKU-KS-REG',
    validation: 'Opsional. Auto-generate jika kosong.',
    errorCode: 'MIG_VARIANT_SKU_INVALID',
    correctionHint: 'SKU VARIAN opsional; kosongkan untuk auto-generate.',
  },
  {
    key: 'variantBarcode',
    header: 'BARCODE VARIAN',
    aliases: ['BARCODE VARIAN', 'Barcode Varian', 'barcode varian'],
    type: 'text',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: '8990001234570',
    validation: 'Opsional. Auto-generate jika kosong.',
    errorCode: 'MIG_VARIANT_BARCODE_INVALID',
    correctionHint: 'BARCODE VARIAN opsional; kosongkan untuk auto-generate.',
  },
  {
    key: 'variantHpp',
    header: 'HPP VARIAN (Rp)',
    aliases: ['HPP VARIAN (Rp)', 'HPP VARIAN', 'HPP Varian', 'hpp varian'],
    type: 'number',
    required: false,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    default: 0,
    example: 12000,
    validation: 'Angka >= 0. Default 0 jika kosong.',
    errorCode: 'MIG_VARIANT_HPP_INVALID',
    correctionHint: 'HPP VARIAN harus angka >= 0. Contoh: 12000.',
  },
  {
    key: 'variantPrice',
    header: 'HARGA JUAL VARIAN* (Rp)',
    aliases: ['HARGA JUAL VARIAN* (Rp)', 'HARGA JUAL VARIAN', 'HARGA JUAL VARIAN (Rp)', 'harga jual varian'],
    type: 'number',
    required: true,
    modes: ['product_only', 'product_stock', 'product_inventory'],
    example: 18000,
    validation: 'Angka > 0. Header bertanda * (wajib).',
    errorCode: 'MIG_VARIANT_PRICE_REQUIRED',
    correctionHint: 'HARGA JUAL VARIAN* wajib diisi angka > 0.',
  },
  {
    key: 'variantStock',
    header: 'STOK AWAL VARIAN',
    aliases: ['STOK AWAL VARIAN', 'STOK VARIAN', 'Stok Varian', 'stok varian', 'stok awal varian'],
    type: 'number',
    required: false,
    modes: ['product_stock', 'product_inventory'],
    default: 0,
    example: 50,
    validation: 'Angka >= 0. Hanya mode product_stock & product_inventory.',
    errorCode: 'MIG_VARIANT_STOCK_INVALID',
    correctionHint: 'STOK AWAL VARIAN harus angka >= 0. Contoh: 50.',
  },
  {
    key: 'komposisiVariantInline',
    header: 'KOMPOSISI VARIAN INLINE (Opsional)',
    aliases: ['KOMPOSISI VARIAN INLINE', 'KOMPOSISI VARIAN INLINE (Opsional)', 'Komposisi Varian', 'komposisi varian', 'KOMPOSISI INLINE'],
    type: 'text',
    required: false,
    modes: ['product_inventory'],
    example: 'Nasi:150gr,Telur:1pcs',
    validation: 'Format: NamaBahan:qtySatuan,... Hanya mode product_inventory.',
    errorCode: 'MIG_VARIANT_KOMPOSISI_INVALID',
    correctionHint: 'Format komposisi varian: NamaBahan:qtySatuan dipisah koma.',
  },
]

// ── SHEET 3: Bahan Baku (Mode 3 only) ───────────────────────────────────────

export const INVENTORY_FIELDS: MigrationFieldDef[] = [
  {
    key: 'name',
    header: 'NAMA ITEM*',
    aliases: ['NAMA ITEM*', 'NAMA ITEM', 'NAMA BAHAN*', 'NAMA BAHAN', 'Nama Bahan', 'nama bahan', 'Bahan', 'BAHAN', 'name', 'Nama'],
    type: 'text',
    required: true,
    modes: ['product_inventory'],
    example: 'Beras Pandan Wangi',
    validation: 'Tidak boleh kosong. Duplikat yang sudah ada dianalisis untuk re-migration aman.',
    errorCode: 'MIG_INV_NAME_REQUIRED',
    correctionHint: 'Isi nama bahan baku pada kolom NAMA ITEM*.',
  },
  {
    key: 'sku',
    header: 'SKU',
    aliases: ['SKU', 'sku', 'Kode'],
    type: 'text',
    required: false,
    modes: ['product_inventory'],
    example: 'SKU-BRS-001',
    validation: 'Opsional.',
    errorCode: 'MIG_INV_SKU_INVALID',
    correctionHint: 'SKU opsional untuk bahan baku.',
  },
  {
    key: 'baseUnit',
    header: 'SATUAN DASAR*',
    aliases: ['SATUAN DASAR*', 'SATUAN DASAR', 'Satuan Dasar', 'satuan dasar', 'Satuan', 'satuan', 'Unit', 'unit'],
    type: 'text',
    required: true,
    modes: ['product_inventory'],
    default: 'pcs',
    example: 'kg',
    validation: `Salah satu dari: ${MIGRATION_VALID_UNITS.join(', ')}. Tidak dikenal → 'pcs'.`,
    errorCode: 'MIG_INV_UNIT_UNKNOWN',
    correctionHint: `Gunakan satuan yang valid: ${MIGRATION_VALID_UNITS.join(', ')}.`,
  },
  {
    key: 'stock',
    header: 'STOK AWAL',
    aliases: ['STOK AWAL', 'STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Jumlah'],
    type: 'number',
    required: false,
    modes: ['product_inventory'],
    default: 0,
    example: 50,
    validation: 'Angka >= 0. Default 0.',
    errorCode: 'MIG_INV_STOCK_INVALID',
    correctionHint: 'STOK AWAL harus angka >= 0.',
  },
  {
    key: 'avgCost',
    header: 'HPP RATA-RATA (Rp)',
    aliases: ['HPP RATA-RATA (Rp)', 'HPP RATA-RATA', 'HPP', 'hpp', 'Harga Pokok', 'Avg Cost', 'avg cost'],
    type: 'number',
    required: false,
    modes: ['product_inventory'],
    default: 0,
    example: 12000,
    validation: 'Angka >= 0. Default 0.',
    errorCode: 'MIG_INV_AVGCOST_INVALID',
    correctionHint: 'HPP RATA-RATA harus angka >= 0.',
  },
  {
    key: 'category',
    header: 'KATEGORI',
    aliases: ['KATEGORI INVENTORY', 'KATEGORI', 'Kategori Inventory', 'kategori inventory', 'Kategori', 'kategori'],
    type: 'text',
    required: false,
    modes: ['product_inventory'],
    example: 'Bahan Kering',
    validation: 'Opsional. Kategori inventory baru otomatis dibuat.',
    errorCode: 'MIG_INV_CATEGORY_INVALID',
    correctionHint: 'KATEGORI opsional.',
  },
  {
    key: 'lowStockAlert',
    header: 'LOW STOCK ALERT',
    aliases: ['LOW STOCK ALERT', 'Low Stock Alert', 'low stock alert', 'Low Stock', 'LOW STOCK', 'Stock Alert', 'STOK MINIMUM'],
    type: 'number',
    required: false,
    modes: ['product_inventory'],
    default: 1,
    example: 5,
    validation: 'Angka >= 0. Default 1.',
    errorCode: 'MIG_INV_LOW_STOCK_INVALID',
    correctionHint: 'LOW STOCK ALERT harus angka >= 0.',
  },
  {
    key: 'linkedProducts',
    header: 'TERHUBUNG DENGAN PRODUK (Opsional — koma-separated)',
    aliases: ['TERHUBUNG DENGAN PRODUK', 'Terhubung Dengan Produk', 'Linked Products', 'linked products', 'PRODUK TERHUBUNG'],
    type: 'text',
    required: false,
    modes: ['product_inventory'],
    example: 'Nasi Goreng, Nasi Kuning',
    validation: 'Daftar nama produk dipisah koma. Produk harus ada di sheet Produk.',
    errorCode: 'MIG_INV_LINKED_INVALID',
    correctionHint: 'Format: Produk1, Produk2 (dipisah koma).',
  },
]

// ── SHEET 4: Komposisi (Mode 3 only) ────────────────────────────────────────

export const COMPOSITION_FIELDS: MigrationFieldDef[] = [
  {
    key: 'productName',
    header: 'NAMA PRODUK*',
    aliases: ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'name', 'Produk', 'Product'],
    type: 'text',
    required: true,
    modes: ['product_inventory'],
    example: 'Nasi Goreng',
    validation: 'Nama produk (harus cocok dengan sheet Produk Non-Varian / Varian).',
    errorCode: 'MIG_COMP_PRODUCT_REQUIRED',
    correctionHint: 'Isi NAMA PRODUK* dengan nama yang sudah ada di sheet Produk.',
  },
  {
    key: 'variantName',
    header: 'NAMA VARIAN (Kosongkan jika non-varian)',
    aliases: ['NAMA VARIAN', 'Nama Varian', 'nama varian', 'Varian', 'Variant', 'VARIAN', 'Nama Variant'],
    type: 'text',
    required: false,
    modes: ['product_inventory'],
    example: 'Regular',
    validation: 'Kosongkan jika produk non-varian.',
    errorCode: 'MIG_COMP_VARIANT_INVALID',
    correctionHint: 'NAMA VARIAN opsional; kosongkan untuk produk non-varian.',
  },
  {
    key: 'bahanName',
    header: 'NAMA BAHAN*',
    aliases: ['NAMA BAHAN*', 'NAMA BAHAN', 'Nama Bahan', 'nama bahan', 'Bahan', 'BAHAN', 'Material'],
    type: 'text',
    required: true,
    modes: ['product_inventory'],
    example: 'Beras',
    validation: 'Nama bahan (harus cocok dengan sheet Bahan Baku).',
    errorCode: 'MIG_COMP_BAHAN_REQUIRED',
    correctionHint: 'Isi NAMA BAHAN* dengan nama yang sudah ada di sheet Bahan Baku.',
  },
  {
    key: 'bahanSku',
    header: 'SKU BAHAN (Opsional — auto-match)',
    aliases: ['SKU BAHAN', 'SKU Bahan', 'sku bahan'],
    type: 'text',
    required: false,
    modes: ['product_inventory'],
    example: 'SKU-BRS-001',
    validation: 'Opsional. Jika kosong, di-match berdasarkan nama.',
    errorCode: 'MIG_COMP_BAHAN_SKU_INVALID',
    correctionHint: 'SKU BAHAN opsional.',
  },
  {
    key: 'qty',
    header: 'QTY PER BATCH*',
    aliases: ['QTY PER BATCH*', 'QTY PER BATCH', 'QTY', 'qty', 'Qty', 'Quantity', 'Jumlah'],
    type: 'number',
    required: true,
    modes: ['product_inventory'],
    example: 200,
    validation: 'Angka > 0.',
    errorCode: 'MIG_COMP_QTY_INVALID',
    correctionHint: 'QTY PER BATCH* harus angka > 0.',
  },
  {
    key: 'satuanBahan',
    header: 'SATUAN BAHAN',
    aliases: ['SATUAN BAHAN', 'Satuan Bahan', 'satuan bahan', 'Satuan', 'satuan', 'Unit'],
    type: 'text',
    required: false,
    modes: ['product_inventory'],
    example: 'gr',
    validation: `Salah satu dari: ${MIGRATION_VALID_UNITS.join(', ')}.`,
    errorCode: 'MIG_COMP_UNIT_UNKNOWN',
    correctionHint: `Gunakan satuan yang valid: ${MIGRATION_VALID_UNITS.join(', ')}.`,
  },
  {
    key: 'yieldPerBatch',
    header: 'YIELD PER BATCH (Hasil per 1 batch)',
    aliases: ['YIELD PER BATCH', 'YIELD', 'Yield', 'yield', 'Yield Per Batch', 'Hasil per Batch', 'yield per batch'],
    type: 'number',
    required: false,
    modes: ['product_inventory'],
    default: 1,
    example: 10,
    validation: 'Angka > 0. Default 1 jika kosong.',
    errorCode: 'MIG_COMP_YIELD_INVALID',
    correctionHint: 'YIELD PER BATCH harus angka > 0. Contoh: 10 (untuk 10 porsi per batch).',
  },
  {
    key: 'catatan',
    header: 'CATATAN',
    aliases: ['CATATAN', 'Catatan', 'catatan', 'Note', 'note', 'Notes'],
    type: 'text',
    required: false,
    modes: ['product_inventory'],
    example: 'Resep dasar',
    validation: 'Opsional.',
    errorCode: 'MIG_COMP_NOTE_INVALID',
    correctionHint: 'CATATAN opsional.',
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build the header row for a given sheet and mode (in canonical order). */
export function buildHeaderRow(
  fields: MigrationFieldDef[],
  mode: MigrationMode,
): string[] {
  return fields.filter((f) => f.modes.includes(mode)).map((f) => f.header)
}

/** Build the alias array for a given field key. */
export function getAliases(fields: MigrationFieldDef[], key: string): string[] {
  const def = fields.find((f) => f.key === key)
  if (!def) throw new Error(`Unknown migration field key: ${key}`)
  return def.aliases
}

/** Look up a field def by key. */
export function getFieldDef(
  fields: MigrationFieldDef[],
  key: string,
): MigrationFieldDef | undefined {
  return fields.find((f) => f.key === key)
}

/**
 * Lookup table: errorCode → correctionHint. Used by the error exporter to
 * attach a Saran Perbaikan to every failed row.
 */
export const MIGRATION_ERROR_HINTS: Record<string, string> = Object.fromEntries(
  [
    ...NON_VARIANT_FIELDS,
    ...VARIANT_FIELDS,
    ...INVENTORY_FIELDS,
    ...COMPOSITION_FIELDS,
  ].map((f) => [f.errorCode, f.correctionHint]),
)

/** Generic fallback error code when no specific cause is known. */
export const MIGRATION_ROW_ERROR_GENERIC = 'MIGRATION_ROW_ERROR'
