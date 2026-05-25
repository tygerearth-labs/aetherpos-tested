import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import * as XLSX from 'xlsx'
import { safeJsonError } from '@/lib/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }

    // Create template workbook
    const wb = XLSX.utils.book_new()

    // === Sheet 1: Data Produk ===
    const productData = [
      ['NAMA PRODUK*', 'SKU', 'HPP (Rp)', 'HARGA JUAL* (Rp)', 'QTY / STOK', 'SATUAN', 'KATEGORI', 'PUNYA VARIAN'],
      ['Nasi Goreng Spesial', 'SKU-001', 10000, 25000, 50, 'porsi', 'Makanan', 'tidak'],
      ['Es Teh Manis', 'SKU-002', 3000, 8000, 100, 'gelas', 'Minuman', 'tidak'],
      ['Ayam Geprek', 'SKU-003', 12000, 20000, 30, 'porsi', 'Makanan', 'tidak'],
      ['Kopi Susu Gula Aren', 'SKU-004', 5000, 15000, 80, 'gelas', 'Minuman', 'ya'],
      ['Mie Goreng', 'SKU-005', 8000, 18000, 40, 'porsi', 'Makanan', 'tidak'],
    ]

    const ws = XLSX.utils.aoa_to_sheet(productData)

    // Set column widths
    ws['!cols'] = [
      { wch: 30 }, // Nama Produk
      { wch: 15 }, // SKU
      { wch: 15 }, // HPP
      { wch: 20 }, // Harga Jual
      { wch: 14 }, // Qty / Stok
      { wch: 12 }, // Satuan
      { wch: 15 }, // Kategori
      { wch: 15 }, // Punya Varian
    ]

    // Add data validation (dropdown) for SATUAN column (F2:F1000)
    const dvSatuan = {
      type: 'list',
      allowBlank: true,
      sqref: 'F2:F1000',
      formulas: ['"pcs,ml,lt,gr,kg,box,pack,botol,gelas,mangkuk,porsi,bungkus,sachet,dus,rim,lembar,meter,cm,ons"'],
    }
    // Add data validation (dropdown) for Punya Varian column (H2:H1000)
    const dvVariant = {
      type: 'list',
      allowBlank: true,
      sqref: 'H2:H1000',
      formulas: ['"ya,tidak"'],
    }
    ws['!dataValidation'] = [dvSatuan, dvVariant]

    XLSX.utils.book_append_sheet(wb, ws, 'Produk')

    // === Sheet 2: Panduan (Instructions) ===
    const guideData = [
      ['PANDUAN IMPORT PRODUK — AETHER POS'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'CONTOH', 'WAJIB?'],
      ['NAMA PRODUK', 'Nama produk yang akan ditambahkan', 'Nasi Goreng Spesial', 'Ya *'],
      ['SKU', 'Kode unik produk (opsional)', 'SKU-001', 'Tidak'],
      ['HPP (Rp)', 'Harga Pokok Penjualan / Modal', '10000', 'Tidak'],
      ['HARGA JUAL (Rp)', 'Harga jual ke customer', '25000', 'Ya *'],
      ['QTY / STOK', 'Jumlah stok awal', '50', 'Tidak'],
      ['SATUAN', 'Unit produk (lihat daftar satuan di bawah)', 'porsi', 'Tidak'],
      ['KATEGORI', 'Nama kategori (auto-create jika belum ada)', 'Makanan', 'Tidak'],
      ['PUNYA VARIAN', 'Isi "ya" jika produk punya varian, lalu isi varian di sheet "Varian Produk"', 'ya', 'Tidak'],
      [''],
      ['DAFTAR SATUAN YANG TERSEDIA:'],
      ['pcs, ml, lt, gr, kg, box, pack, botol, gelas, mangkuk, porsi, bungkus, sachet, dus, rim, lembar, meter, cm, ons'],
      [''],
      ['CARA UPLOAD PRODUK VARIAN:'],
      ['1. Isi produk di sheet "Produk" dengan "Punya Varian" = ya'],
      ['2. Isi varian di sheet "Varian Produk" dengan Nama Produk yang SAMA PERSIS'],
      ['3. Harga Jual & Stok di sheet Produk akan diabaikan untuk produk varian (diambil dari varian)'],
      ['4. Minimal 1 varian per produk'],
      [''],
      ['CATATAN:'],
      ['• Kolom bertanda * wajib diisi'],
      ['• Maksimal 500 baris per upload'],
      ['• Jika Nama Produk sudah ada, baris tersebut akan dilewati (skip)'],
      ['• Kategori baru akan otomatis dibuat jika belum ada di sistem'],
      ['• Harga harus dalam format angka tanpa titik/koma (contoh: 25000, bukan 25.000)'],
      ['• Untuk produk dengan varian, isi kolom "Punya Varian" = "ya", lalu isi varian di sheet "Varian Produk"'],
      ['• Produk yang ditandai "Punya Varian" = ya wajib memiliki minimal 1 baris varian di sheet "Varian Produk"'],
      ['• Nama Produk di sheet "Varian Produk" harus SAMA PERSIS dengan Nama Produk di sheet "Produk" (case-sensitive)'],
      ['• Upload produk utama terlebih dahulu, baru upload varian di sheet terpisah atau gunakan upload ulang file yang sama'],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [
      { wch: 25 },
      { wch: 50 },
      { wch: 25 },
      { wch: 10 },
    ]

    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan')

    // === Sheet 3: Varian Produk ===
    const variantData = [
      ['NAMA PRODUK*', 'NAMA VARIAN*', 'SKU VARIAN', 'HPP (Rp)', 'HARGA JUAL* (Rp)', 'STOK'],
      ['Kopi Susu Gula Aren', 'Small', 'SKU-004-S', 4000, 12000, 30],
      ['Kopi Susu Gula Aren', 'Medium', 'SKU-004-M', 5000, 15000, 50],
      ['Kopi Susu Gula Aren', 'Large', 'SKU-004-L', 6000, 18000, 20],
    ]
    const wsVariants = XLSX.utils.aoa_to_sheet(variantData)
    wsVariants['!cols'] = [
      { wch: 25 }, // Nama Produk
      { wch: 20 }, // Nama Varian
      { wch: 18 }, // SKU Varian
      { wch: 15 }, // HPP (Rp)
      { wch: 22 }, // Harga Jual* (Rp)
      { wch: 10 }, // Stok
    ]
    XLSX.utils.book_append_sheet(wb, wsVariants, 'Varian Produk')

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Return as downloadable file
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="template-produk-aether-pos.xlsx"',
      },
    })
  } catch (error) {
    console.error('Template download error:', error)
    return safeJsonError('Gagal mengunduh template')
  }
}
