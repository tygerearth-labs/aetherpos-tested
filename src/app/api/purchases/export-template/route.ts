import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJsonError } from '@/lib/api/safe-response'

/**
 * GET /api/purchases/export-template
 *
 * Generates a template Excel file for bulk updating purchase order items.
 * Exports current PO items with editable "Tanggal Expired" column.
 * Used by the "Edit Excel" feature on the purchase page.
 *
 * Sheet: "Detail Item PO" — columns: NO PO, Nama Item, Tanggal Expired
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId
    const userId = user.id

    // Plan gate: bulkUpload feature (Pro & Enterprise)
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) return safeJsonError('Outlet not found', 404)
    if (!outletPlan.features.bulkUpload) {
      return safeJsonError('Fitur edit pembelian via Excel hanya tersedia untuk akun Pro ke atas. Upgrade sekarang!', 403)
    }

    // Fetch all PO items for this outlet
    const poItems = await db.purchaseOrderItem.findMany({
      where: { outletId },
      include: {
        purchaseOrder: { select: { orderNumber: true, supplier: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })

    const wb = XLSX.utils.book_new()

    // === Sheet 1: Detail Item PO ===
    const header = ['NO PO*', 'Nama Item*', 'Tanggal Expired']

    const rows = poItems.map((item) => [
      item.purchaseOrder.orderNumber,
      item.name,
      item.expiredDate ? new Date(item.expiredDate).toISOString().split('T')[0] : '',
    ])

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    ws['!cols'] = [
      { wch: 22 }, // NO PO
      { wch: 40 }, // Nama Item
      { wch: 20 }, // Tanggal Expired
    ]

    // Highlight header row
    if (ws['A1']) ws['A1'].s = { font: { bold: true } }
    if (ws['B1']) ws['B1'].s = { font: { bold: true } }
    if (ws['C1']) ws['C1'].s = { font: { bold: true } }

    XLSX.utils.book_append_sheet(wb, ws, 'Detail Item PO')

    // === Sheet 2: Panduan ===
    const guideData = [
      ['PANDUAN EDIT PEMBELIAN VIA EXCEL — AETHER POS (Pro & Enterprise)'],
      [''],
      ['CARA EDIT:'],
      ['1. Download file ini (berisi data item PO saat ini)'],
      ['2. Edit kolom "Tanggal Expired" sesuai kebutuhan'],
      ['3. Upload kembali file yang sudah diedit melalui menu "Edit Excel" di halaman Pembelian'],
      [''],
      ['KOLOM:', 'DESKRIPSI', 'WAJIB?'],
      ['NO PO*', 'Nomor PO (jangan diubah — untuk pencocokan)', 'Ya'],
      ['Nama Item*', 'Nama item pembelian (jangan diubah — untuk pencocokan)', 'Ya'],
      ['Tanggal Expired', 'Tanggal kadaluarsa baru (format: YYYY-MM-DD)', 'Tidak'],
      [''],
      ['FORMAT TANGGAL:'],
      ['• YYYY-MM-DD → 2026-01-15 (rekomendasi, paling aman)'],
      ['• DD/MM/YYYY → 15/01/2026'],
      ['• DD-MM-YYYY → 15-01-2026'],
      ['• Jika diisi langsung di Excel dengan format sel "Date", sistem akan membaca otomatis'],
      [''],
      ['CATATAN:'],
      ['• Kolom NO PO dan Nama Item digunakan untuk mencocokkan item yang akan diupdate'],
      ['• Hanya item yang NO PO + Nama Item-nya cocok yang akan diproses'],
      ['• Item yang tidak ditemukan akan ditampilkan sebagai "tidak ditemukan" di hasil'],
      ['• Maksimal 500 baris per upload'],
      [''],
      ['FITUR INI KHUSUS AKUN PRO & ENTERPRISE'],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [{ wch: 30 }, { wch: 55 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan')

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Audit log
    await safeAuditLog({
      action: 'EXPORT',
      entityType: 'PURCHASE_ORDER_ITEM',
      details: JSON.stringify({
        exportTemplate: true,
        itemCount: poItems.length,
      }),
      outletId,
      userId,
    })

    const filename = `purchase-edit-template-${new Date().toISOString().slice(0, 10)}.xlsx`
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Purchase export template error:', error)
    return safeJsonError('Gagal mengunduh template')
  }
}