import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import { buildDateFilter, resolvePlanType, parsePagination } from '@/lib/api/api-helpers'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJsonError } from '@/lib/api/safe-response'

export const maxDuration = 60

/**
 * GET /api/purchases/export
 * Export purchase orders to Excel (Pro & Enterprise only).
 * Includes: PO header, items, batch details.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId
    const userId = user.id

    // Plan gate
    const outlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { accountType: true },
    })
    const accountType = resolvePlanType(outlet?.accountType)
    const { getPlanFeatures } = await import('@/lib/config/plan-config')
    const features = getPlanFeatures(accountType)
    if (!features.exportExcel) {
      return safeJsonError('Fitur export Excel hanya tersedia untuk paket Pro ke atas. Upgrade sekarang!', 403)
    }

    const { searchParams } = request.nextUrl
    const dateFrom = searchParams.get('from') || ''
    const dateTo = searchParams.get('to') || ''
    const search = searchParams.get('search') || ''

    // Build where clause
    const where: Record<string, unknown> = { outletId }
    const dateFilter = buildDateFilter(dateFrom, dateTo)
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter
    }
    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { supplier: { name: { contains: search } } },
        { notes: { contains: search } },
      ]
    }

    // Fetch all POs with items (no pagination for export, limit to 10000)
    const orders = await db.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
      include: {
        supplier: { select: { name: true } },
        createdBy: { select: { name: true } },
        items: {
          include: {
            inventoryItem: { select: { name: true, baseUnit: true, sku: true } },
          },
        },
      },
    })

    const wb = XLSX.utils.book_new()

    // === Sheet 1: Purchase Orders (Header) ===
    const poHeader = [
      'No. PO',
      'Tanggal',
      'Supplier',
      'Total Biaya (Rp)',
      'Jumlah Item',
      'Catatan',
      'Dibuat Oleh',
    ]

    const poRows = orders.map((o) => [
      o.orderNumber,
      new Date(o.createdAt).toLocaleString('id-ID'),
      o.supplier?.name || '-',
      o.totalCost,
      o.items.length,
      o.notes || '',
      o.createdBy?.name || '-',
    ])

    const wsPO = XLSX.utils.aoa_to_sheet([poHeader, ...poRows])
    wsPO['!cols'] = [
      { wch: 24 }, // No. PO
      { wch: 22 }, // Tanggal
      { wch: 25 }, // Supplier
      { wch: 18 }, // Total Biaya
      { wch: 14 }, // Jumlah Item
      { wch: 30 }, // Catatan
      { wch: 18 }, // Dibuat Oleh
    ]
    XLSX.utils.book_append_sheet(wb, wsPO, 'Purchase Orders')

    // === Sheet 2: PO Items Detail ===
    const itemHeader = [
      'No. PO',
      'Tanggal',
      'Supplier',
      'Nama Item',
      'SKU Item',
      'Qty Beli',
      'Satuan Beli',
      'Qty Dasar',
      'Satuan Dasar',
      'HPP Satuan (Rp)',
      'Total Biaya (Rp)',
      'Batch Number',
      'Tanggal Expired',
    ]

    const itemRows: (string | number)[][] = []
    for (const o of orders) {
      for (const item of o.items) {
        itemRows.push([
          o.orderNumber,
          new Date(o.createdAt).toLocaleString('id-ID'),
          o.supplier?.name || '-',
          item.name,
          item.inventoryItem?.sku || '',
          item.purchaseQty,
          item.purchaseUnit,
          item.baseQty,
          item.baseUnit,
          item.unitCost,
          item.totalCost,
          item.batch || '',
          item.expiredDate ? new Date(item.expiredDate).toISOString().split('T')[0] : '',
        ])
      }
    }

    const wsItems = XLSX.utils.aoa_to_sheet([itemHeader, ...itemRows])
    wsItems['!cols'] = [
      { wch: 24 }, { wch: 22 }, { wch: 25 }, { wch: 28 },
      { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
      { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 14 },
    ]
    XLSX.utils.book_append_sheet(wb, wsItems, 'Detail Item PO')

    // === Sheet 3: Panduan ===
    const guideData = [
      ['EXPORT PURCHASE ORDERS — AETHER POS (Pro & Enterprise)'],
      [''],
      ['File ini berisi data purchase order dari outlet Anda.'],
      [''],
      ['SHEET:'],
      ['• Purchase Orders — Ringkasan header PO'],
      ['• Detail Item PO — Detail setiap item dalam PO termasuk batch & expiry'],
      [''],
      ['KOLOM DETAIL ITEM PO:', 'DESKRIPSI'],
      ['No. PO', 'Nomor purchase order'],
      ['Tanggal', 'Tanggal pembelian'],
      ['Supplier', 'Nama supplier'],
      ['Nama Item', 'Nama item bahan baku'],
      ['SKU Item', 'Kode SKU item'],
      ['Qty Beli', 'Jumlah beli dalam satuan beli (misal: 1 Ekor)'],
      ['Satuan Beli', 'Satuan pembelian (misal: Ekor, Jerigen, Roll)'],
      ['Qty Dasar', 'Jumlah dikonversi ke satuan dasar (misal: 1.85 kg)'],
      ['Satuan Dasar', 'Satuan dasar item (kg, gr, ml, dll)'],
      ['HPP Satuan (Rp)', 'Harga per satuan dasar'],
      ['Total Biaya (Rp)', 'Total biaya item (Qty Dasar × HPP Satuan)'],
      ['Batch Number', 'Nomor batch / lot'],
      ['Tanggal Expired', 'Tanggal kadaluarsa batch'],
      [''],
      ['FITUR INI KHUSUS AKUN PRO & ENTERPRISE'],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [{ wch: 30 }, { wch: 55 }]
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Audit log
    await safeAuditLog({
      action: 'EXPORT',
      entityType: 'PURCHASE_ORDER',
      details: JSON.stringify({
        exportExcel: true,
        orderCount: orders.length,
        itemCount: itemRows.length,
        dateFrom: dateFrom || 'all',
        dateTo: dateTo || 'all',
      }),
      outletId,
      userId,
    })

    const filename = `purchase-export-${new Date().toISOString().slice(0, 10)}.xlsx`
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch (error) {
    console.error('Purchase export error:', error)
    return safeJsonError('Gagal mengekspor purchase orders')
  }
}