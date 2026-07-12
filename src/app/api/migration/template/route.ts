import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import * as XLSX from 'xlsx'
import { safeJsonError } from '@/lib/api/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }

    const wb = XLSX.utils.book_new()

    // === Sheet 1: Data Produk (Migration Template) ===
    // SATU template untuk SEMUA jenis bisnis
    // Kolom yang sama dipakai untuk Product, dan (opsional) InventoryItem + Opening Balance
    const headerRow = [
      'NAMA PRODUK*',
      'SKU',
      'BARCODE',
      'HPP / MODAL (Rp)',
      'HARGA JUAL* (Rp)',
      'STOK AWAL',
      'SATUAN',
      'KATEGORI',
    ]

    // Sample data across different business types
    const sampleData = [
      // ── F&B (Makanan & Minuman) ──
      ['Nasi Goreng Spesial', 'SKU-001', '8991234001', 10000, 25000, 50, 'porsi', 'Makanan'],
      ['Es Teh Manis', 'SKU-002', '8991234002', 3000, 8000, 100, 'gelas', 'Minuman'],
      ['Kopi Susu Gula Aren', 'SKU-003', '8991234003', 5000, 15000, 80, 'gelas', 'Minuman'],
      ['Ayam Geprek', 'SKU-004', '8991234004', 12000, 20000, 30, 'porsi', 'Makanan'],
      ['Mie Goreng', 'SKU-005', '8991234005', 8000, 18000, 40, 'porsi', 'Makanan'],
      ['Jus Alpukat', 'SKU-006', '8991234006', 6000, 15000, 30, 'gelas', 'Minuman'],
      ['Bakso Kuah', 'SKU-007', '8991234007', 9000, 18000, 20, 'porsi', 'Makanan'],
      ['Sate Ayam 10 tusuk', 'SKU-008', '8991234008', 11000, 22000, 25, 'porsi', 'Makanan'],

      // ── Beauty / Kecantikan ──
      ['Cream Wajah 30ml', 'BTY-001', '8992001001', 25000, 55000, 48, 'pcs', 'Skincare'],
      ['Serum Vitamin C 20ml', 'BTY-002', '8992001002', 35000, 85000, 30, 'pcs', 'Skincare'],
      ['Lipstik Matte', 'BTY-003', '8992001003', 15000, 45000, 60, 'pcs', 'Makeup'],
      ['Bedak Tabur', 'BTY-004', '8992001004', 20000, 50000, 40, 'pcs', 'Makeup'],
      ['Parfum 50ml', 'BTY-005', '8992001005', 45000, 95000, 24, 'pcs', 'Parfum'],

      // ── Jasa ──
      ['Jasa Cuci Motor', 'JSA-001', '', 5000, 15000, 999, 'pcs', 'Jasa'],
      ['Jasa Potong Rambut', 'JSA-002', '', 0, 25000, 999, 'pcs', 'Jasa'],
      ['Jasa Isi Angin Ban', 'JSA-003', '', 0, 5000, 999, 'pcs', 'Jasa'],

      // ── Retail / Minimarket ──
      ['Air Mineral 600ml', 'RTL-001', '8993001001', 2500, 4000, 144, 'pcs', 'Minuman'],
      ['Minyak Goreng 1L', 'RTL-002', '8993001002', 14000, 18000, 60, 'pcs', 'Sembako'],
      ['Gula Pasir 500g', 'RTL-003', '8993001003', 8000, 12000, 40, 'pcs', 'Sembako'],
      ['Tisu Paseo 250 Sheet', 'RTL-004', '8993001004', 7500, 11000, 48, 'pcs', 'Kebutuhan Rumah'],
      ['Sabun Mandi 100g', 'RTL-005', '8993001005', 7000, 12000, 36, 'pcs', 'Perawatan Tubuh'],
      ['Charger HP Android', 'RTL-006', '8993001006', 15000, 25000, 15, 'pcs', 'Elektronik'],

      // ── Percetakan ──
      ['Cetak Brosur A5', 'PCT-001', '', 500, 1500, 500, 'lembar', 'Percetakan'],
      ['Cetak Kartu Nama', 'PCT-002', '', 200, 800, 1000, 'lembar', 'Percetakan'],
      ['Cetak Stiker Roll', 'PCT-003', '', 3000, 8000, 50, 'roll', 'Percetakan'],
      ['Cetak Undangan', 'PCT-004', '', 1500, 3500, 200, 'pcs', 'Percetakan'],
    ]

    const productData = [headerRow, ...sampleData]
    const ws = XLSX.utils.aoa_to_sheet(productData)

    ws['!cols'] = [
      { wch: 30 }, // Nama Produk
      { wch: 15 }, // SKU
      { wch: 18 }, // Barcode
      { wch: 20 }, // HPP / Modal
      { wch: 22 }, // Harga Jual
      { wch: 14 }, // Stok Awal
      { wch: 12 }, // Satuan
      { wch: 18 }, // Kategori
    ]

    // Data validation for SATUAN
    ws['!dataValidation'] = [{
      type: 'list',
      allowBlank: true,
      sqref: 'G2:G5000',
      formulas: ['"pcs,ml,lt,gr,kg,box,pack,botol,gelas,mangkuk,porsi,bungkus,sachet,dus,rim,lembar,meter,cm,ons,roll,strip,ekor"'],
    }]

    XLSX.utils.book_append_sheet(wb, ws, 'Produk')

    // === Sheet 2: Panduan Import ===
    const guideData = [
      ['TEMPLATE MIGRASI — AETHER POS'],
      [''],
      ['Satu template untuk semua jenis bisnis.'],
      ['Kolom yang sama dipakai untuk Produk, dan (opsional) Inventory + Saldo Awal.'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'CONTOH', 'WAJIB?'],
      ['NAMA PRODUK', 'Nama produk / item', 'Nasi Goreng Spesial', 'Ya *'],
      ['SKU', 'Kode unik produk (auto-generate jika kosong)', 'SKU-001', 'Tidak'],
      ['BARCODE', 'Kode barcode (auto-generate dari SKU jika kosong)', '8991234001', 'Tidak'],
      ['HPP / MODAL (Rp)', 'Harga pokok / modal per unit', '10000', 'Tidak'],
      ['HARGA JUAL (Rp)', 'Harga jual ke customer', '25000', 'Ya *'],
      ['STOK AWAL', 'Jumlah stok saat ini', '50', 'Tidak'],
      ['SATUAN', 'Unit produk', 'porsi', 'Tidak'],
      ['KATEGORI', 'Nama kategori (auto-create jika belum ada)', 'Makanan', 'Tidak'],
      [''],
      ['═' .repeat(60)],
      ['MODE IMPORT'],
      ['═' .repeat(60)],
      [''],
      ['1. BUAT PRODUK SAJA (Langsung Siap Jual)'],
      ['   Kolom di atas → membentuk: Product, SKU, Barcode, Harga Jual, Kategori'],
      ['   Cocok untuk: F&B, Jasa, Retail tanpa tracking bahan baku'],
      [''],
      ['2. BUAT PRODUK + INVENTORY (Kelola Inventory)'],
      ['   Kolom yang SAMA → membentuk: Product + InventoryItem + Opening Balance'],
      ['   Cocok untuk: F&B dengan resep, Beauty, Percetakan, Manufactur'],
      ['   - Stok Awal menjadi saldo awal InventoryItem'],
      ['   - HPP / Modal menjadi avgCost di InventoryItem'],
      ['   - Movement type: PURCHASE (opening balance)'],
      [''],
      ['═' .repeat(60)],
      ['PANDUAN PER JENIS BISNIS'],
      ['═' .repeat(60)],
      [''],
      ['FOOD & BEVERAGE (F&B)'],
      ['• Kategori: Makanan, Minuman, Snack, Dessert'],
      ['• Satuan: porsi, gelas, mangkuk, bungkus, cup'],
      ['• Jika butuh tracking bahan baku → pilih "Kelola Inventory"'],
      ['• Contoh: Nasi Goreng (porsi), Es Teh (gelas), Kopi (cup)'],
      [''],
      ['BEAUTY / KECANTIKAN'],
      ['• Kategori: Skincare, Makeup, Parfum, Body Care, Hair Care'],
      ['• Satuan: pcs, ml, botol'],
      ['• SKU/Barcode penting untuk tracking expiry dan batch'],
      ['• Pilih "Kelola Inventory" jika butuh tracking stok bahan baku'],
      [''],
      ['JASA'],
      ['• Kategori: Jasa, Konsultasi, Layanan'],
      ['• Stok bisa diisi 999 (unlimited) atau kosongkan'],
      ['• HPP bisa 0 (jasa murni)'],
      ['• Pilih "Buat Produk Saja"'],
      [''],
      ['RETAIL / MINIMARKET'],
      ['• Kategori: Sembako, Minuman, Elektronik, Kebutuhan Rumah'],
      ['• Barcode WAJIB diisi untuk scan di kasir'],
      ['• Satuan: pcs, dus, pack'],
      ['• Pilih "Buat Produk Saja" atau "Kelola Inventory"'],
      [''],
      ['PERCETAKAN'],
      ['• Kategori: Percetakan, Packaging, Merchandise'],
      ['• Satuan: lembar, pcs, roll, meter'],
      ['• HPP penting untuk perhitungan profit margin'],
      ['• Pilih "Kelola Inventory" jika butuh tracking bahan (kertas, tinta)'],
      [''],
      ['═' .repeat(60)],
      ['CATATAN UMUM'],
      ['═' .repeat(60)],
      [''],
      ['• Kolom bertanda * wajib diisi'],
      ['• Maksimal 500 baris per upload'],
      ['• Produk yang sudah ada (nama sama) akan dilewati (skip)'],
      ['• Kategori baru otomatis dibuat'],
      ['• SKU & Barcode auto-generate jika dikosongkan'],
      ['• Harga bisa format angka: 25000 atau Rp25.000'],
      ['• Import bisa diulang dengan aman (skip duplikat)'],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [
      { wch: 35 },
      { wch: 60 },
      { wch: 30 },
      { wch: 10 },
    ]
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan')

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="template-migrasi-aether-pos.xlsx"',
      },
    })
  } catch (error) {
    console.error('Migration template error:', error)
    return safeJsonError('Gagal mengunduh template')
  }
}