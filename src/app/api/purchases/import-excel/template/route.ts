import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import * as XLSX from 'xlsx'
import { safeJsonError } from '@/lib/api/safe-response'

/**
 * GET /api/purchases/import-excel/template
 *
 * Generates and downloads a template Excel file for purchase import.
 * The column headers match the flexible matching aliases used in the import parser.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }

    // Create template workbook
    const wb = XLSX.utils.book_new()

    // === Sheet 1: Template Pembelian (3 sections: F&B Bahan, Ritel/Minimarket, Peralatan) ===
    const purchaseData = [
      ['Nama Barang*', 'SKU', 'Satuan Beli', 'Jumlah*', 'Isi per Satuan', 'Satuan Dasar', 'Harga Satuan (Rp)*'],
      // ── F&B: Bahan Baku & Bumbu ──
      ['Tepung Terigu Segitiga Biru 1kg', 'SKU-TPG-001', 'karung', 10, 1, 'kg', 12000],
      ['Gula Pasir Putih 500gr', 'SKU-GLP-001', 'karung', 5, 0.5, 'kg', 16000],
      ['Minyak Goreng Bimoli 2L', 'SKU-MYK-001', 'dus', 4, 2, 'liter', 32000],
      ['Telur Ayam Negeri', 'SKU-TLR-001', 'krat', 3, 30, 'butir', 28000],
      ['Kecap Manis ABC 600ml', 'SKU-KCP-001', 'karton', 2, 6, 'botol', 11500],
      ['Bawang Merah', '', 'kg', 20, 1, 'kg', 35000],
      ['Bawang Putih', '', 'kg', 10, 1, 'kg', 42000],
      ['Cabai Merah Keriting', '', 'kg', 5, 1, 'kg', 55000],
      ['Daging Ayam Paha', '', 'kg', 15, 1, 'kg', 36000],
      ['Susu UHT Frisian Flag 1L', 'SKU-SUS-001', 'karton', 6, 12, 'pcs', 128000],
      ['Kopi Kapal Api Special 165g', 'SKU-KPI-001', 'dus', 3, 10, 'sachet', 65000],
      ['Teh Celup Sariwangi 25s', 'SKU-TEH-001', 'karton', 4, 24, 'box', 82000],
      ['Mie Goreng Indomie', 'SKU-MIE-001', 'karton', 10, 40, 'pcs', 110000],
      ['Air Mineral Aqua 600ml', 'SKU-AIR-001', 'krat', 8, 24, 'botol', 55000],
      // ── Ritel / Minimarket ──
      ['Pulsa Elektrik Rp10.000', '', 'voucher', 50, 1, 'pcs', 9800],
      ['Voucher Google Play Rp50.000', '', 'lembar', 20, 1, 'pcs', 49000],
      ['Sampo Pantene 130ml', 'SKU-SMP-001', 'lusin', 5, 12, 'pcs', 108000],
      ['Sabun Mandi Lifebuoy 100g', 'SKU-SBN-001', 'lusin', 4, 12, 'pcs', 84000],
      ['Tisu Paseo 250s', 'SKU-TSU-001', 'dus', 6, 24, 'pcs', 92000],
      ['Rokok Sampoerna Mild 16s', 'SKU-RKK-001', 'slop', 10, 10, 'bungkus', 195000],
      ['Obat Panadol 10 Tablet', 'SKU-OBT-001', 'strip', 15, 1, 'strip', 12000],
      ['Baterai AA Energizer 4s', 'SKU-BTR-001', 'lusin', 3, 12, 'pcs', 75000],
      ['Kantong Plastik Kresek Sedang', '', 'rol', 10, 100, 'pcs', 15000],
      ['Plastik Wrap Kecil', 'SKU-PLS-001', 'dus', 3, 24, 'pcs', 45000],
      // ── Peralatan & Kebutuhan Operasional ──
      ['Rice Cooker Miyako 1.8L', 'SKU-RC-001', 'unit', 2, 1, 'unit', 285000],
      ['Tisu Meja Palsu 250s', '', 'dus', 5, 24, 'pcs', 88000],
      ['Lampu LED Philips 12W', 'SKU-LMP-001', 'lusin', 2, 12, 'pcs', 96000],
      ['Sabun Cuci Piring Sunlight 800ml', 'SKU-SCP-001', 'karton', 3, 12, 'pcs', 72000],
    ]

    const ws = XLSX.utils.aoa_to_sheet(purchaseData)

    // Set column widths
    ws['!cols'] = [
      { wch: 35 }, // Nama Barang
      { wch: 18 }, // SKU
      { wch: 15 }, // Satuan Beli
      { wch: 10 }, // Jumlah
      { wch: 16 }, // Isi per Satuan
      { wch: 16 }, // Satuan Dasar
      { wch: 22 }, // Harga Satuan
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Pembelian')

    // === Sheet 2: Panduan ===
    const guideData = [
      ['PANDUAN IMPORT PEMBELIAN — AETHER POS'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'CONTOH', 'WAJIB?'],
      ['Nama Barang*', 'Nama item/bahan yang dibeli', 'Tepung Terigu Segitiga Biru 1kg', 'Ya'],
      ['SKU', 'Kode SKU item (untuk matching otomatis)', 'SKU-TPG-001', 'Tidak'],
      ['Satuan Beli', 'Satuan pembelian dari supplier', 'karung, dus, kraton, kg', 'Tidak'],
      ['Jumlah*', 'Jumlah yang dibeli dalam satuan beli', '10', 'Ya'],
      ['Isi per Satuan', 'Konversi: berapa satuan dasar dalam 1 satuan beli', '1 karung = 1 kg → isi 1', 'Tidak'],
      ['Satuan Dasar', 'Satuan terkecil yang dipakai sistem', 'kg, liter, butir, pcs, ml, gr', 'Tidak'],
      ['Harga Satuan (Rp)*', 'Harga per SATUAN BELI (bukan per satuan dasar)', '12000 (per karung)', 'Ya'],
      [''],
      ['INFORMASI PENTING:'],
      ['• Kolom bertanda * wajib diisi'],
      ['• Harga Satuan = harga per SATUAN BELI (bukan per satuan dasar)'],
      ['• Contoh: Beli Tepung 1 karung @ Rp12.000 → "Satuan Beli" = karung, "Jumlah" = 10, "Harga" = 12000'],
      ['• Jika "Isi per Satuan" dikosongkan, sistem akan menganggap 1 satuan beli = 1 satuan dasar'],
      ['• Item yang namanya/SKU-nya sudah ada di sistem akan otomatis di-matching'],
      ['• Item baru (tidak ditemukan) akan otomatis dibuat saat purchase disubmit'],
      ['• Maksimal 200 baris per upload, ukuran file maks 5MB'],
      ['• Format file: .xlsx, .xls, atau .csv'],
      [''],
      ['HEADER YANG DITERIMA (FLEXIBLE — boleh pakai nama lain yang mirip):'],
      ['Nama Barang → NAMA BARANG, Nama Barang, NAMA ITEM, Nama Item, BARANG, ITEM, Nama, NAME, Produk'],
      ['SKU → SKU, Kode, Kode Barang, Barcode'],
      ['Satuan Beli → SATUAN BELI, Satuan Beli, SATUAN, Satuan, Unit, UOM'],
      ['Jumlah → JUMLAH, Jumlah, QTY, Qty, Quantity, Banyak'],
      ['Isi per Satuan → ISI PER SATUAN, Isi per Satuan, ISI, Isi, Konversi, Base Qty, Qty per Unit'],
      ['Satuan Dasar → SATUAN DASAR, Satuan Dasar, Base Unit, Unit Dasar'],
      ['Harga Satuan → HARGA, Harga, PRICE, HARGA BELI, HARGA SATUAN, Unit Price, Total, Subtotal'],
      [''],
      ['FORMAT ANGKA:'],
      ['• Bisa pakai format Indonesia: 25.000 atau Rp25.000 atau Rp 25.000'],
      ['• Bisa pakai format standar: 25000'],
      ['• Desimal pakai koma atau titik: 0,5 atau 0.5'],
      [''],
      ['TIPS:'],
      ['• Copy-paste dari Excel ke input "Smart Input" juga bisa (tab-separated)'],
      ['• Matching otomatis berdasarkan nama (case-insensitive) lalu SKU'],
      ['• Preview akan ditampilkan sebelum data diaplikasikan'],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [
      { wch: 25 },
      { wch: 55 },
      { wch: 35 },
      { wch: 10 },
    ]

    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan')

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    // Return as downloadable file
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="template-pembelian-aether-pos.xlsx"',
      },
    })
  } catch (error) {
    console.error('Purchase template download error:', error)
    return safeJsonError('Gagal mengunduh template')
  }
}
