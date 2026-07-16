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
 * 
 * TEMPLATE STRUCTURE:
 * - ✅ EDITABLE fields: Nama, SKU, Satuan Dasar, Low Stock Alert, Status, Kategori
 * - 📊 READ-ONLY info: Stok, HPP Rata-rata (displayed for reference only)
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
    // Headers with emoji indicators: ✅ = editable, 📊 = read-only info
    const header = [
      'ID*',
      '✅ Nama Item*',
      '✅ SKU',
      '✅ Satuan Dasar',
      '📊 Stok (Read-Only)',
      '📊 HPP Rata-rata (Read-Only)',
      '✅ Low Stock Alert',
      '✅ Status',
      '✅ Kategori Inventory',
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
      { wch: 32 }, // Nama Item (slightly wider for emoji)
      { wch: 18 }, // SKU
      { wch: 14 }, // Satuan Dasar
      { wch: 18 }, // Stok (wider for "Read-Only" label)
      { wch: 24 }, // HPP Rata-rata (wider)
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

    // Header styling (row 1 = headers)
    // Color editable columns light green, read-only columns light gray
    for (let col = 0; col < header.length; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: col })
      if (!ws[cellRef]) continue
      
      const isEditable = header[col].includes('✅')
      const isReadOnly = header[col].includes('📊')
      
      ws[cellRef].s = {
        font: { bold: true, color: { rgb: isReadOnly ? '808080' : 'FFFFFF' } },
        fill: { 
          fgColor: { rgb: isReadOnly ? 'E0E0E0' : '2D7D46' },  // Gray for read-only, green for editable
          patternType: 'solid' 
        },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      }
    }

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

    // === Sheet 3: Panduan (Updated with clear field explanation) ===
    const guideData = [
      ['PANDUAN EDIT INVENTORY VIA EXCEL — AETHER POS (Pro & Enterprise)'],
      [''],
      ['⚠️ PENTING: BACA SEBELUM EDIT!'],
      [''],
      ['CARA EDIT INVENTORY:'],
      ['1. Download file ini (data inventory saat ini)'],
      ['2. Edit HANYA kolom dengan tanda ✅ di sheet "Inventory Items"'],
      ['3. Kolom dengan tanda 📊 adalah INFO saja - perubahan akan DIABAIKAN'],
      ['4. Kolom ID tidak boleh diubah — digunakan untuk pencocokan data'],
      ['5. Upload kembali file yang sudah diedit melalui menu "Edit Excel"'],
      [''],
      ['═══════════════════════════════════════════════════════════════'],
      ['KOLOM YANG BISA DIEDIT (✅):', '', ''],
      ['Kolom', 'Deskripsi', 'Contoh Isi'],
      ['✅ Nama Item*', 'Nama item bahan baku', 'Tepung Terigu'],
      ['✅ SKU', 'Kode SKU item', 'BRG-001'],
      ['✅ Satuan Dasar', 'Unit dasar', 'kg, gram, ml, liter, pcs'],
      ['✅ Low Stock Alert', 'Batas stok minimum sebelum warning', '10'],
      ['✅ Status', 'Status item', 'ACTIVE atau ARCHIVED'],
      ['✅ Kategori Inventory', 'Kategori item (auto-create jika baru)', 'Bahan Kering'],
      [''],
      ['═══════════════════════════════════════════════════════════════'],
      ['KOLOM INFO SAJA (📊 TIDAK BISA DIEDIT):', '', ''],
      ['Kolom', 'Alasan Tidak Bisa Edit', 'Cara Ubah'],
      ['📊 Stok', 'Stok dihitung otomatis dari batch/pembelian', 'Gunakan fitur "Stok Opname" atau "Penyesuaian Stok"'],
      ['📊 HPP Rata-rata', 'HPP dihitung otomatis dari harga pembelian', 'Akan berubah otomatis saat ada pembelian baru'],
      [''],
      ['═══════════════════════════════════════════════════════════════'],
      ['ATURAN UMUM:', ''],
      ['• Kolom ID* WAJIB dan tidak boleh diubah/dikosongkan', ''],
      ['• Hanya kolom terisi (tidak kosong) yang akan diperbarui', ''],
      ['• Maksimal baris sesuai plan Anda (Pro: 200, Enterprise: 500)', ''],
      ['• Status harus ACTIVE atau ARCHIVED (huruf kapital semua)', ''],
      ['• Jika ada error pada suatu baris, baris tersebut dilewati', ''],
      ['• Error dan warning ditampilkan setelah upload selesai', ''],
      [''],
      ['UNTUK MENGUBAH STOK:', ''],
      ['→ Gunakan menu "Stok Opname" di halaman Inventory', ''],
      ['→ Atau gunakan fitur "Penyesuaian Stok" pada detail item', ''],
      ['→ Atau buat Pembelian untuk menambah stok dari supplier', ''],
      [''],
      ['FITUR INI KHUSUS AKUN PRO & ENTERPRISE', ''],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [{ wch: 40 }, { wch: 50 }, { wch: 35 }]
    
    // Style the guide header
    const titleCell = 'A1'
    if (wsGuide[titleCell]) {
      wsGuide[titleCell].s = {
        font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '4472C4' }, patternType: 'solid' },
        alignment: { horizontal: 'center' }
      }
    }

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

    const filename = `inventory-data-${new Date().toISOString().slice(0, 10)}.xlsx`
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
