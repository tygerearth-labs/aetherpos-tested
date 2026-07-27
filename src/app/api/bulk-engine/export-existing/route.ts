import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import * as XLSX from 'xlsx'
import { safeJsonError } from '@/lib/api/safe-response'

/**
 * GET /api/bulk-engine/export-existing?kind=<adapter-kind>
 *
 * V2 BULK ENGINE — "Edit-mode" data export.
 *
 * For Edit adapters (purchase:edit, inventory:edit, product:edit,
 * customer:edit), the "Download template" button in BulkUploadDialog should
 * NOT download a blank template — it should download the EXISTING data
 * formatted per the adapter's COLUMNS, so the user can see what's there and
 * edit incrementally (blank cell = no change in EDIT mode).
 *
 * This endpoint fetches the existing rows from DB and emits an .xlsx with:
 *  - Header row = adapter COLUMNS labels
 *  - One row per existing record, mapped to those columns
 *
 * Used by:
 *  - product:edit       → /api/bulk-engine/export-existing?kind=product:edit
 *  - inventory:edit     → /api/bulk-engine/export-existing?kind=inventory:edit
 *  - customer:edit      → /api/bulk-engine/export-existing?kind=customer:edit
 *  - purchase:edit      → /api/bulk-engine/export-existing?kind=purchase:edit
 *
 * Add-mode adapters (product:add, customer:add, purchase:add) keep using
 * their original templateEndpoint (blank template with example rows).
 */
export const maxDuration = 60

const VALID_KINDS = new Set([
  'product:edit',
  'inventory:edit',
  'customer:edit',
  'purchase:edit',
])

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    const kind = request.nextUrl.searchParams.get('kind') || ''
    if (!VALID_KINDS.has(kind)) {
      return safeJsonError(
        `Kind tidak valid. Harus salah satu: ${[...VALID_KINDS].join(', ')}`,
        400,
      )
    }

    const wb = XLSX.utils.book_new()

    // ───────────────────────────────────────────────────────────────────────
    // product:edit — columns: ID Produk, Nama Produk, SKU, Barcode, Kategori,
    //   Harga Jual, HPP/Modal, Stok, Satuan, Alert Stok Minim, Image URL
    //   (matches the Product model fields — NO status/description fields
    //   since the Product model doesn't have them)
    // ───────────────────────────────────────────────────────────────────────
    if (kind === 'product:edit') {
      const products = await db.product.findMany({
        where: { outletId },
        include: { category: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
        take: 5000,
      })
      const header = [
        'ID Produk',
        'Nama Produk',
        'SKU',
        'Barcode',
        'Kategori',
        'Harga Jual (Rp)',
        'HPP/Modal (Rp)',
        'Stok',
        'Satuan',
        'Alert Stok Minim',
        'Image URL',
      ]
      const rows = products.map((p) => [
        p.id,
        p.name,
        p.sku || '',
        p.barcode || '',
        p.category?.name || '',
        p.price,
        p.hpp,
        p.stock,
        p.unit,
        p.lowStockAlert,
        p.image || '',
      ])
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
      ws['!cols'] = [
        { wch: 28 }, // ID
        { wch: 30 }, // Nama
        { wch: 15 }, // SKU
        { wch: 18 }, // Barcode
        { wch: 18 }, // Kategori
        { wch: 15 }, // Harga Jual
        { wch: 15 }, // HPP
        { wch: 10 }, // Stok
        { wch: 10 }, // Satuan
        { wch: 16 }, // Alert Stok Minim
        { wch: 40 }, // Image URL
      ]
      XLSX.utils.book_append_sheet(wb, ws, 'Produk')
    }

    // ───────────────────────────────────────────────────────────────────────
    // inventory:edit — columns: ID Bahan, Nama Bahan, SKU, Kategori Bahan,
    //   Satuan Dasar, Alert Stok Minim, Status
    //   (Stok & avgCost are read-only — NOT included per adapter COLUMNS)
    // ───────────────────────────────────────────────────────────────────────
    if (kind === 'inventory:edit') {
      const items = await db.inventoryItem.findMany({
        where: { outletId },
        include: { category: { select: { name: true } } },
        orderBy: { name: 'asc' },
        take: 5000,
      })
      const header = [
        'ID Bahan',
        'Nama Bahan',
        'SKU',
        'Kategori Bahan',
        'Satuan Dasar',
        'Alert Stok Minim',
        'Status',
      ]
      const rows = items.map((it) => [
        it.id,
        it.name,
        it.sku || '',
        it.category?.name || '',
        it.baseUnit,
        it.lowStockAlert,
        it.status,
      ])
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
      ws['!cols'] = [
        { wch: 28 }, // ID
        { wch: 30 }, // Nama
        { wch: 15 }, // SKU
        { wch: 18 }, // Kategori
        { wch: 14 }, // Satuan
        { wch: 16 }, // Low Stock Alert
        { wch: 12 }, // Status
      ]
      XLSX.utils.book_append_sheet(wb, ws, 'Bahan Baku')
    }

    // ───────────────────────────────────────────────────────────────────────
    // customer:edit — columns: ID Pelanggan, WhatsApp (lookup), Nama Baru,
    //   WhatsApp Baru
    //   (existing name/whatsapp pre-filled in lookup columns; "Baru" cols
    //   left blank so user fills only what they want to change)
    // ───────────────────────────────────────────────────────────────────────
    if (kind === 'customer:edit') {
      const customers = await db.customer.findMany({
        where: { outletId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 5000,
      })
      const header = [
        'ID Pelanggan',
        'WhatsApp (lookup)',
        'Nama Baru',
        'WhatsApp Baru',
      ]
      const rows = customers.map((c) => [
        c.id,
        c.whatsapp,
        '', // Nama Baru — blank, user fills only if changing
        '', // WhatsApp Baru — blank, user fills only if changing
      ])
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
      ws['!cols'] = [
        { wch: 28 }, // ID
        { wch: 20 }, // WhatsApp (lookup)
        { wch: 25 }, // Nama Baru
        { wch: 20 }, // WhatsApp Baru
      ]
      XLSX.utils.book_append_sheet(wb, ws, 'Pelanggan')
    }

    // ───────────────────────────────────────────────────────────────────────
    // purchase:edit — one row per PO line item, columns:
    //   No. PO (existing), Supplier Baru, Catatan Baru, Nama Bahan, SKU Bahan,
    //   Qty Beli, Satuan Beli, Qty Dasar, Satuan Dasar, Harga Satuan, No. Batch,
    //   Tanggal Expired
    //   (Supplier Baru & Catatan Baru left blank — user fills only if changing;
    //    other columns pre-filled with current PO item data)
    // ───────────────────────────────────────────────────────────────────────
    if (kind === 'purchase:edit') {
      // NOTE: PurchaseOrderItem has no `createdAt` field. Sort by
      // purchaseOrder.createdAt desc (most recent PO first), then by id for
      // stable secondary ordering.
      const poItems = await db.purchaseOrderItem.findMany({
        where: { outletId },
        include: {
          purchaseOrder: {
            select: {
              orderNumber: true,
              notes: true,
              createdAt: true,
              supplier: { select: { name: true } },
            },
          },
        },
        orderBy: [{ purchaseOrder: { createdAt: 'desc' } }, { id: 'asc' }],
        take: 5000,
      })
      const header = [
        'No. PO (existing)',
        'Supplier Baru',
        'Catatan Baru',
        'Nama Bahan',
        'SKU Bahan',
        'Qty Beli',
        'Satuan Beli',
        'Qty Dasar (konversi)',
        'Satuan Dasar',
        'Harga Satuan (Rp)',
        'No. Batch',
        'Tanggal Expired',
      ]
      const rows = poItems.map((it) => [
        it.purchaseOrder.orderNumber,
        '', // Supplier Baru — blank, fill only if changing
        '', // Catatan Baru — blank, fill only if changing
        it.name,
        '', // SKU Bahan — lookup by name; not stored on POItem directly
        it.purchaseQty,
        it.purchaseUnit,
        it.baseQty,
        it.baseUnit,
        it.unitCost,
        it.batchNumber || '',
        it.expiredDate
          ? new Date(it.expiredDate).toISOString().split('T')[0]
          : '',
      ])
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
      ws['!cols'] = [
        { wch: 22 }, // No. PO
        { wch: 20 }, // Supplier Baru
        { wch: 20 }, // Catatan Baru
        { wch: 30 }, // Nama Bahan
        { wch: 15 }, // SKU Bahan
        { wch: 10 }, // Qty Beli
        { wch: 12 }, // Satuan Beli
        { wch: 14 }, // Qty Dasar
        { wch: 12 }, // Satuan Dasar
        { wch: 15 }, // Harga Satuan
        { wch: 16 }, // No. Batch
        { wch: 16 }, // Tanggal Expired
      ]
      XLSX.utils.book_append_sheet(wb, ws, 'Detail Item PO')
    }

    // ───────────────────────────────────────────────────────────────────────
    // Guide sheet (Indonesian) — explains blank-cell-means-no-change semantics
    // ───────────────────────────────────────────────────────────────────────
    const guideData = [
      ['PANDUAN EDIT VIA EXCEL — AETHER BULK ENGINE V2'],
      [''],
      ['CARA EDIT:'],
      ['1. File ini berisi DATA SAAT INI dari database (bukan template kosong)'],
      ['2. Edit kolom yang ingin diubah. Kolom yang dikosongkan = TIDAK berubah'],
      ['3. Untuk hapus nilai optional (barcode, image, kategori): isi "CLEAR"'],
      ['4. Upload kembali file yang sudah diedit melalui dialog Edit Excel'],
      [''],
      ['ATURAN UMUM:'],
      ['• Cell kosong = tidak ada perubahan (EDIT mode)'],
      ['• Angka 0 = nilai valid (bukan "kosong")'],
      ['• Maksimal 5000 baris per export'],
      ['• Lookup: ID > SKU > Barcode > Nama (produk), ID > Nama > SKU (bahan), ID > WhatsApp (pelanggan), No. PO (pembelian)'],
      ['• Image URL harus diawali http:// atau https://'],
      [''],
      [`Adapter: ${kind}`],
      [`Generated: ${new Date().toISOString()}`],
    ]
    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [{ wch: 80 }]
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const safeKind = kind.replace(/[^a-zA-Z0-9-_]/g, '-')
    const dateStr = new Date().toISOString().slice(0, 10)

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="edit-${safeKind}-${dateStr}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('[bulk-engine/export-existing] error:', error)
    return safeJsonError('Gagal mengekspor data existing')
  }
}
