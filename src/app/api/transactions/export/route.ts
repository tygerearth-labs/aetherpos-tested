import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { buildDateFilter, resolvePlanType } from '@/lib/api-helpers'
import { getPlanFeatures } from '@/lib/plan-config'
import * as XLSX from 'xlsx'
import { safeJsonError } from '@/lib/safe-response'

function formatInTz(date: Date, tzOffset: number | null, options: Intl.DateTimeFormatOptions): string {
  if (tzOffset === null) {
    return date.toLocaleString('id-ID', options)
  }
  const utc = date.getTime() + date.getTimezoneOffset() * 60000
  const clientTime = new Date(utc - tzOffset * 60000)
  return clientTime.toLocaleString('id-ID', options)
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId

    const outlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { accountType: true },
    })
    const accountType = resolvePlanType(outlet?.accountType)
    const features = getPlanFeatures(accountType)
    if (!features.exportExcel) {
      return safeJsonError('Fitur export Excel hanya tersedia untuk paket Pro ke atas. Upgrade sekarang!', 403)
    }

    const { searchParams } = request.nextUrl
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''
    const dateFromMs = searchParams.get('dateFromMs') || ''
    const dateToMs = searchParams.get('dateToMs') || ''
    const cashierId = searchParams.get('cashierId') || ''
    const paymentMethod = searchParams.get('paymentMethod') || ''
    const tzOffsetRaw = searchParams.get('tzOffset')
    const tzOffset = tzOffsetRaw !== null ? parseInt(tzOffsetRaw, 10) : null

    const where: Record<string, unknown> = { outletId }

    const dateFilter = buildDateFilter(dateFrom || null, dateTo || null, dateFromMs || null, dateToMs || null)
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter
    }

    if (cashierId) where.userId = cashierId
    if (paymentMethod) where.paymentMethod = paymentMethod

    const transactions = await db.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        subtotal: true,
        discount: true,
        taxAmount: true,
        total: true,
        paymentMethod: true,
        paidAmount: true,
        change: true,
        customer: { select: { name: true } },
        user: { select: { name: true } },
        items: {
          select: {
            productName: true,
            variantName: true,
            price: true,
            qty: true,
            subtotal: true,
            product: { select: { sku: true } },
            variant: { select: { sku: true } },
          },
        },
        createdAt: true,
      },
    })

    const transactionIds = transactions.map((t) => t.id)
    const voidLogs = transactionIds.length > 0
      ? await db.auditLog.findMany({
          where: { entityType: 'TRANSACTION', entityId: { in: transactionIds }, action: 'VOID', outletId },
          select: { entityId: true },
        })
      : []
    const voidSet = new Set(voidLogs.map((l) => l.entityId))

    // Sheet 1: Detail Transaksi
    const detailRows: Record<string, unknown>[] = []
    for (const t of transactions) {
      for (const item of t.items) {
        detailRows.push({
          'No': detailRows.length + 1,
          'Invoice #': t.invoiceNumber,
          'Tanggal': formatInTz(t.createdAt, tzOffset, { day: '2-digit', month: '2-digit', year: 'numeric' }),
          'Jam': formatInTz(t.createdAt, tzOffset, { hour: '2-digit', minute: '2-digit' }),
          'Kasir': t.user?.name || '-',
          'Customer': t.customer?.name || 'Walk-in',
          'Nama Produk': item.variantName ? `${item.productName} - ${item.variantName}` : item.productName,
          'SKU': item.variant?.sku || item.product?.sku || '-',
          'QTY': item.qty,
          'Harga Satuan': item.price,
          'Subtotal Item': item.subtotal,
          'Metode Pembayaran': t.paymentMethod,
          'PPN': t.taxAmount,
          'Total Transaksi': t.total,
          'Status': voidSet.has(t.id) ? 'VOID' : 'Aktif',
        })
      }
    }

    const detailSheet = XLSX.utils.json_to_sheet(detailRows)
    detailSheet['!cols'] = Object.keys(detailRows[0] || {}).map((key) => ({
      wch: Math.max(key.length + 2, ...detailRows.map((r) => String(r[key as keyof typeof r] || '').length)),
    }))

    // Sheet 2: Ringkasan
    const rows = transactions.map((t) => ({
      'No': transactions.indexOf(t) + 1,
      'Invoice #': t.invoiceNumber,
      'Tanggal': formatInTz(t.createdAt, tzOffset, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      'Jam': formatInTz(t.createdAt, tzOffset, { hour: '2-digit', minute: '2-digit' }),
      'Kasir': t.user?.name || '-',
      'Customer': t.customer?.name || 'Walk-in',
      'Jumlah Item': t.items.reduce((s, i) => s + i.qty, 0),
      'Metode Pembayaran': t.paymentMethod,
      'Subtotal': t.subtotal,
      'Diskon': t.discount,
      'PPN': t.taxAmount,
      'Total': t.total,
      'Dibayar': t.paidAmount,
      'Kembalian': t.change,
      'Status': voidSet.has(t.id) ? 'VOID' : 'Aktif',
    }))

    const summarySheet = XLSX.utils.json_to_sheet(rows)
    summarySheet['!cols'] = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.max(key.length + 2, ...rows.map((r) => String(r[key as keyof typeof r] || '').length)),
    }))

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detail Transaksi')
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ringkasan')

    const dateRange = dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : 'all'
    const sanitizedRange = dateRange.replace(/[^\w.-]/g, '_')
    const filename = `transactions_${sanitizedRange}.xlsx`

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Transactions export error:', error)
    return safeJsonError('Failed to export transactions', 500)
  }
}