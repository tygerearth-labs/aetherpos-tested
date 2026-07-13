import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJsonError } from '@/lib/api/safe-response'

export const maxDuration = 60

/**
 * GET /api/inventory/items/export
 * Export all inventory items to Excel (Pro & Enterprise only).
 * Includes: items, categories, batch summary, composition links.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId
    const userId = user.id

    // Plan gate: exportExcel feature (Pro & Enterprise)
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) return safeJsonError('Outlet not found', 404)
    if (!outletPlan.features.exportExcel) {
      return safeJsonError('Fitur export inventory via Excel hanya tersedia untuk akun Pro ke atas. Upgrade sekarang!', 403)
    }

    // Fetch all inventory items with relations
    const items = await db.inventoryItem.findMany({
      where: { outletId },
      include: {
        category: { select: { name: true } },
        _count: { select: { compositions: true, batches: true, purchaseItems: true } },
        batches: {
          select: {
            id: true,
            batchNumber: true,
            initialQty: true,
            remainingQty: true,
            unitCost: true,
            expiredDate: true,
            status: true,
            supplierName: true,
          },
          orderBy: { expiredDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })

    const wb = XLSX.utils.book_new()

    // === Sheet 1: Inventory Items ===
    const header = [
      'ID*',
      'Nama Item*',
      'SKU',
      'Satuan Dasar',
      'Stok',
      'HPP Rata-rata (Rp)',
      'Low Stock Alert',
      'Status',
      'Kategori Inventory',
    ]

    const rows = items.map((item) => [
      item.id,
      item.name,
      item.sku || '',
      item.baseUnit,
      item.stock,
      item.avgCost,
      item.lowStockAlert,
      item.status,
      item.category?.name || '',
    ])

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    ws['!cols'] = [
      { wch: 28 }, // ID
      { wch: 30 }, // Nama Item
      { wch: 18 }, // SKU
      { wch: 14 }, // Satuan Dasar
      { wch: 10 }, // Stok
      { wch: 20 }, // HPP Rata-rata
      { wch: 16 }, // Low Stock Alert
      { wch: 12 }, // Status
      { wch: 22 }, // Kategori
    ]

    // Data validation for status
    ws['!dataValidation'] = [{
      type: 'list',
      allowBlank: true,
      sqref: 'H2:H5000',
      formulas: ['"ACTIVE,ARCHIVED"'],
    }]

    XLSX.utils.book_append_sheet(wb, ws, 'Inventory Items')

    // === Sheet 2: Batch Detail ===
    const batchHeader = [
      'ID Item',
      'Nama Item',
      'SKU Item',
      'Batch Number',
      'Qty Awal',
      'Qty Sisa',
      'HPP Satuan (Rp)',
      'Tanggal Expired',
      'Status',
      'Supplier',
    ]

    const batchRows: (string | number)[][] = []
    for (const item of items) {
      for (const b of item.batches) {
        batchRows.push([
          item.id,
          item.name,
          item.sku || '',
          b.batchNumber,
          b.initialQty,
          b.remainingQty,
          b.unitCost,
          b.expiredDate ? new Date(b.expiredDate).toISOString().split('T')[0] : '',
          b.status,
          b.supplierName || '',
        ])
      }
    }

    const wsBatch = XLSX.utils.aoa_to_sheet([
      batchHeader,
      ...batchRows,
    ])
    wsBatch['!cols'] = [
      { wch: 28 }, { wch: 28 }, { wch: 18 }, { wch: 18 },
      { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
      { wch: 12 }, { wch: 22 },
    ]
    XLSX.utils.book_append_sheet(wb, wsBatch, 'Batch Detail')

    // === Sheet 3: Panduan ===
    const guideData = [
      ['PANDUAN EDIT INVENTORY VIA EXCEL — AETHER POS (Pro & Enterprise)'],
      [''],
      ['CARA EDIT INVENTORY:'],
      ['1. Download file ini (data inventory saat ini)'],
      ['2. Edit kolom yang ingin diubah di sheet "Inventory Items"'],
      ['3. Kolom ID tidak boleh diubah — digunakan untuk pencocokan'],
      ['4. Upload kembali file yang sudah diedit melalui menu "Edit Excel" di halaman Inventory'],
      [''],
      ['KOLOM SHEET INVENTORY ITEMS:', 'DESKRIPSI', 'WAJIB?'],
      ['ID*', 'ID inventory item (jangan diubah)', 'Ya'],
      ['Nama Item*', 'Nama item bahan baku', 'Tidak'],
      ['SKU', 'Kode SKU item', 'Tidak'],
      ['Satuan Dasar', 'Unit dasar: gr, kg, ml, lt, pcs, meter', 'Tidak'],
      ['Stok', 'Jumlah stok saat ini (akan overwrite!)', 'Tidak'],
      ['HPP Rata-rata (Rp)', 'Harga pokok rata-rata per unit', 'Tidak'],
      ['Low Stock Alert', 'Batas peringatan stok rendah', 'Tidak'],
      ['Status', 'ACTIVE atau ARCHIVED', 'Tidak'],
      ['Kategori Inventory', 'Nama kategori (auto-create jika belum ada)', 'Tidak'],
      [''],
      ['CATATAN:'],
      ['• Hanya kolom yang diisi (tidak kosong) yang akan diperbarui'],
      ['• Kolom ID wajib dan tidak boleh diubah'],
      ['• Maksimal 500 baris per upload'],
      ['• Stok diisi dalam satuan dasar (base unit)'],
      ['• Harga harus dalam format angka (contoh: 25000)'],
      ['• Status harus ACTIVE atau ARCHIVED'],
      [''],
      ['FITUR INI KHUSUS AKUN PRO & ENTERPRISE'],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [{ wch: 35 }, { wch: 55 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Audit log
    await safeAuditLog({
      action: 'EXPORT',
      entityType: 'INVENTORY_ITEM',
      details: JSON.stringify({
        exportExcel: true,
        itemCount: items.length,
        batchCount: batchRows.length,
      }),
      outletId,
      userId,
    })

    const filename = `inventory-export-${new Date().toISOString().slice(0, 10)}.xlsx`
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Inventory export error:', error)
    return safeJsonError('Gagal mengekspor inventory')
  }
}