import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJsonError } from '@/lib/api/safe-response'

// Vercel serverless function timeout: 60s
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const userId = user.id

    // Check plan: bulkUpload feature required
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) {
      return safeJsonError('Outlet not found', 404)
    }

    if (!outletPlan.features.bulkUpload) {
      return safeJsonError('Fitur export hanya tersedia untuk akun Pro. Upgrade untuk mengakses fitur ini.', 403)
    }

    // Fetch all products with categories for this outlet
    const products = await db.product.findMany({
      where: { outletId },
      include: {
        category: {
          select: { name: true },
        },
        variants: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            hpp: true,
            price: true,
            stock: true,
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Create workbook
    const wb = XLSX.utils.book_new()

    // === Sheet 1: Produk ===
    const productHeader = [
      'ID', 'Nama Produk', 'SKU', 'BARCODE', 'HPP', 'Harga Jual', 'Stok', 'Satuan', 'Kategori', 'Punya Varian', 'Low Stock Alert',
    ]
    const productRows = products.map((p) => [
      p.id,
      p.name,
      p.sku || '',
      p.barcode || '',
      p.hpp,
      p.price,
      p.stock,
      p.unit,
      p.category?.name || '',
      p.hasVariants ? 'ya' : 'tidak',
      p.lowStockAlert,
    ])

    const ws = XLSX.utils.aoa_to_sheet([productHeader, ...productRows])
    ws['!cols'] = [
      { wch: 28 }, // ID
      { wch: 30 }, // Nama Produk
      { wch: 15 }, // SKU
      { wch: 18 }, // BARCODE
      { wch: 15 }, // HPP
      { wch: 15 }, // Harga Jual
      { wch: 10 }, // Stok
      { wch: 10 }, // Satuan
      { wch: 18 }, // Kategori
      { wch: 14 }, // Punya Varian
      { wch: 16 }, // Low Stock Alert
    ]
    XLSX.utils.book_append_sheet(wb, ws, 'Produk')

    // === Sheet 2: Varian Produk ===
    const variantHeader = [
      'ID Produk', 'Nama Produk', 'ID Varian', 'Nama Varian', 'SKU', 'BARCODE', 'HPP', 'Harga Jual', 'Stok',
    ]
    const variantRows: (string | number)[][] = []
    for (const p of products) {
      if (p.hasVariants && p.variants.length > 0) {
        for (const v of p.variants) {
          variantRows.push([
            p.id,
            p.name,
            v.id,
            v.name,
            v.sku || '',
            v.barcode || '',
            v.hpp,
            v.price,
            v.stock,
          ])
        }
      }
    }

    const wsVariants = XLSX.utils.aoa_to_sheet([
      variantHeader,
      ...variantRows,
    ])
    wsVariants['!cols'] = [
      { wch: 28 }, // ID Produk
      { wch: 30 }, // Nama Produk
      { wch: 28 }, // ID Varian
      { wch: 20 }, // Nama Varian
      { wch: 15 }, // SKU
      { wch: 18 }, // BARCODE
      { wch: 15 }, // HPP
      { wch: 15 }, // Harga Jual
      { wch: 10 }, // Stok
    ]
    XLSX.utils.book_append_sheet(wb, wsVariants, 'Varian Produk')

    // === Sheet 3: Panduan ===
    const guideData = [
      ['PANDUAN EDIT PRODUK VIA EXCEL — AETHER POS'],
      [''],
      ['CARA EDIT PRODUK:'],
      ['1. Download file ini (data produk saat ini)'],
      ['2. Edit kolom yang ingin diubah di sheet "Produk"'],
      ['3. Kolom ID tidak boleh diubah — digunakan untuk pencocokan'],
      ['4. Upload kembali file yang sudah diedit melalui menu "Edit Excel"'],
      [''],
      ['KOLOM SHEET PRODUK:', 'DESKRIPSI', 'WAJIB?'],
      ['ID', 'ID produk (jangan diubah)', 'Ya'],
      ['Nama Produk', 'Nama produk', 'Tidak'],
      ['SKU', 'Kode unik produk', 'Tidak'],
      ['HPP', 'Harga Pokok Penjualan / Modal', 'Tidak'],
      ['Harga Jual', 'Harga jual ke customer', 'Tidak'],
      ['Stok', 'Jumlah stok', 'Tidak'],
      ['Satuan', 'Unit produk', 'Tidak'],
      ['Kategori', 'Nama kategori (auto-create jika belum ada)', 'Tidak'],
      ['Punya Varian', 'Isi "ya" jika punya varian', 'Tidak'],
      ['Low Stock Alert', 'Batas peringatan stok rendah', 'Tidak'],
      [''],
      ['KOLOM SHEET VARIAN PRODUK:', 'DESKRIPSI', 'WAJIB?'],
      ['ID Produk', 'ID produk induk (jangan diubah)', 'Ya'],
      ['Nama Produk', 'Nama produk induk (untuk referensi)', 'Ya'],
      ['ID Varian', 'ID varian (jangan diubah)', 'Ya'],
      ['Nama Varian', 'Nama varian', 'Tidak'],
      ['SKU', 'Kode SKU varian', 'Tidak'],
      ['HPP', 'Harga Pokok varian', 'Tidak'],
      ['Harga Jual', 'Harga jual varian', 'Tidak'],
      ['Stok', 'Stok varian', 'Tidak'],
      [''],
      ['CATATAN:'],
      ['• Hanya kolom yang diisi (tidak kosong) yang akan diperbarui'],
      ['• Kolom ID wajib dan tidak boleh diubah'],
      ['• Maksimal 500 baris per upload'],
      ['• Kategori baru akan otomatis dibuat jika belum ada'],
      ['• Harga harus dalam format angka tanpa titik/koma (contoh: 25000)'],
      ['• Jika terjadi error pada suatu baris, baris tersebut akan dilewati'],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [
      { wch: 30 },
      { wch: 50 },
      { wch: 10 },
    ]
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan')

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Audit log
    await safeAuditLog({
      action: 'EXPORT',
      entityType: 'PRODUCT',
      details: JSON.stringify({
        exportExcel: true,
        productCount: products.length,
        variantCount: variantRows.length,
      }),
      outletId,
      userId,
    })

    // Return as downloadable file
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="produk-export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('Export products error:', error)
    return safeJsonError('Gagal mengekspor produk')
  }
}
