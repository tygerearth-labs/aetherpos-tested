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

    // Create template workbook
    const wb = XLSX.utils.book_new()

    // === Sheet 1: Data Produk (3 kategori: F&B, Ritel/Minimarket, Lainnya) ===
    const productData = [
      ['NAMA PRODUK*', 'SKU', 'BARCODE', 'HPP (Rp)', 'HARGA JUAL* (Rp)', 'QTY / STOK', 'SATUAN', 'KATEGORI', 'PUNYA VARIAN', 'PUNYA KOMPOSISI'],
      // ── F&B: Makanan & Minuman ──
      ['Nasi Goreng Spesial', 'SKU-001', 'SKU-001', 10000, 25000, 50, 'porsi', 'Makanan', 'tidak', 'ya'],
      ['Es Teh Manis', 'SKU-002', 'SKU-002', 3000, 8000, 100, 'gelas', 'Minuman', 'tidak', 'tidak'],
      ['Ayam Geprek', 'SKU-003', 'SKU-003', 12000, 20000, 30, 'porsi', 'Makanan', 'tidak', 'tidak'],
      ['Kopi Susu Gula Aren', 'SKU-004', 'SKU-004', 5000, 15000, 80, 'gelas', 'Minuman', 'ya', 'tidak'],
      ['Mie Goreng', 'SKU-005', 'SKU-005', 8000, 18000, 40, 'porsi', 'Makanan', 'tidak', 'tidak'],
      ['Sate Ayam Madura 10 tusuk', 'SKU-006', 'SKU-006', 11000, 22000, 25, 'porsi', 'Makanan', 'tidak', 'ya'],
      ['Jus Alpukat', 'SKU-007', 'SKU-007', 6000, 15000, 30, 'gelas', 'Minuman', 'tidak', 'tidak'],
      ['Bakso Kuah', 'SKU-008', 'SKU-008', 9000, 18000, 20, 'porsi', 'Makanan', 'tidak', 'tidak'],
      // ── Ritel / Minimarket ──
      ['Pulsa Elektrik Rp10.000', 'SKU-TEL-10', 'SKU-TEL-10', 9800, 12000, 999, 'pcs', 'Pulsa & Voucher', 'tidak', 'tidak'],
      ['Pulsa Elektrik Rp25.000', 'SKU-TEL-25', 'SKU-TEL-25', 24600, 27000, 999, 'pcs', 'Pulsa & Voucher', 'tidak', 'tidak'],
      ['Voucher Google Play Rp50.000', 'SKU-GP-50', 'SKU-GP-50', 49000, 53000, 50, 'pcs', 'Pulsa & Voucher', 'tidak', 'tidak'],
      ['Sampo Pantene 130ml', 'SKU-SMP-130', 'SKU-SMP-130', 9000, 15000, 24, 'pcs', 'Perawatan Tubuh', 'tidak', 'tidak'],
      ['Sabun Mandi Lifebuoy 100g', 'SKU-SBN-100', 'SKU-SBN-100', 7000, 12000, 36, 'pcs', 'Perawatan Tubuh', 'tidak', 'tidak'],
      ['Tisu Paseo 250 Sheet', 'SKU-TSU-250', 'SKU-TSU-250', 7500, 11000, 48, 'pcs', 'Kebutuhan Rumah', 'tidak', 'tidak'],
      ['Rokok Sampoerna Mild', '', '', 0, 0, 0, 'bungkus', 'Rokok', 'ya', 'tidak'],
      ['Obat Panadol 10 Tablet', 'SKU-OBT-10', 'SKU-OBT-10', 8000, 12000, 30, 'strip', 'Obat-obatan', 'tidak', 'tidak'],
      ['Minyak Goreng Bimoli 1L', 'SKU-MYK-1L', 'SKU-MYK-1L', 14000, 18000, 60, 'pcs', 'Sembako', 'tidak', 'tidak'],
      ['Gula Pasir 500g', 'SKU-GLP-500', 'SKU-GLP-500', 8000, 12000, 40, 'pcs', 'Sembako', 'tidak', 'tidak'],
      ['Beras Premium 5kg', 'SKU-BRS-5K', 'SKU-BRS-5K', 52000, 65000, 20, 'pcs', 'Sembako', 'tidak', 'tidak'],
      ['Telur Ayam 1kg', 'SKU-TLR-1K', 'SKU-TLR-1K', 24000, 30000, 25, 'pcs', 'Sembako', 'tidak', 'tidak'],
      ['Air Mineral Aqua 600ml', 'SKU-AQUA-600', 'SKU-AQUA-600', 2500, 4000, 144, 'pcs', 'Minuman', 'tidak', 'tidak'],
      ['Baterai AA Energizer 4pcs', 'SKU-BTR-4', 'SKU-BTR-4', 25000, 35000, 18, 'pcs', 'Elektronik', 'tidak', 'tidak'],
      ['Kantong Plastik Sedang', 'SKU-PLS-S', 'SKU-PLS-S', 150, 500, 500, 'pcs', 'Kebutuhan Rumah', 'tidak', 'tidak'],
      ['Charger HP Android', 'SKU-CHR-AND', 'SKU-CHR-AND', 15000, 25000, 15, 'pcs', 'Elektronik', 'tidak', 'tidak'],
      // ── Lainnya ──
      ['Jasa Cuci Motor', 'SKU-JCM-01', 'SKU-JCM-01', 5000, 15000, 999, 'pcs', 'Jasa', 'tidak', 'tidak'],
      ['Jasa Isi Angin Ban', 'SKU-JAB-01', 'SKU-JAB-01', 0, 5000, 999, 'pcs', 'Jasa', 'tidak', 'tidak'],
      ['Pulsa Listrik Token Rp50.000', 'SKU-PLN-50', 'SKU-PLN-50', 49500, 52500, 999, 'pcs', 'Token Listrik', 'tidak', 'tidak'],
    ]

    const ws = XLSX.utils.aoa_to_sheet(productData)

    // Set column widths
    ws['!cols'] = [
      { wch: 30 }, // Nama Produk
      { wch: 15 }, // SKU
      { wch: 18 }, // Barcode
      { wch: 15 }, // HPP
      { wch: 20 }, // Harga Jual
      { wch: 14 }, // Qty / Stok
      { wch: 12 }, // Satuan
      { wch: 15 }, // Kategori
      { wch: 15 }, // Punya Varian
      { wch: 18 }, // Punya Komposisi
    ]

    // Add data validation (dropdown) for SATUAN column (G2:G1000)
    const dvSatuan = {
      type: 'list',
      allowBlank: true,
      sqref: 'G2:G1000',
      formulas: ['"pcs,ml,lt,gr,kg,box,pack,botol,gelas,mangkuk,porsi,bungkus,sachet,dus,rim,lembar,meter,cm,ons"'],
    }
    // Add data validation (dropdown) for Punya Varian column (I2:I1000)
    const dvVariant = {
      type: 'list',
      allowBlank: true,
      sqref: 'I2:I1000',
      formulas: ['"ya,tidak"'],
    }
    // Add data validation (dropdown) for Punya Komposisi column (J2:J1000)
    const dvComposition = {
      type: 'list',
      allowBlank: true,
      sqref: 'J2:J1000',
      formulas: ['"ya,tidak"'],
    }
    ws['!dataValidation'] = [dvSatuan, dvVariant, dvComposition]

    XLSX.utils.book_append_sheet(wb, ws, 'Produk')

    // === Sheet 2: Panduan (Instructions) ===
    const guideData = [
      ['PANDUAN IMPORT PRODUK — AETHER POS'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'CONTOH', 'WAJIB?'],
      ['NAMA PRODUK', 'Nama produk yang akan ditambahkan', 'Nasi Goreng Spesial', 'Ya *'],
      ['SKU', 'Kode unik produk (opsional, auto-generate jika kosong)', 'SKU-001', 'Tidak'],
      ['BARCODE', 'Kode barcode produk (opsional, auto-generate dari SKU jika kosong)', 'SKU-001', 'Tidak'],
      ['HPP (Rp)', 'Harga Pokok Penjualan / Modal', '10000', 'Tidak'],
      ['HARGA JUAL (Rp)', 'Harga jual ke customer', '25000', 'Ya *'],
      ['QTY / STOK', 'Jumlah stok awal', '50', 'Tidak'],
      ['SATUAN', 'Unit produk (lihat daftar satuan di bawah)', 'porsi', 'Tidak'],
      ['KATEGORI', 'Nama kategori (auto-create jika belum ada)', 'Makanan', 'Tidak'],
      ['PUNYA VARIAN', 'Isi "ya" jika produk punya varian, lalu isi varian di sheet "Varian Produk"', 'ya', 'Tidak'],
      ['PUNYA KOMPOSISI', 'Isi "ya" jika produk punya komposisi item, lalu isi di sheet "Komposisi"', 'ya', 'Tidak'],
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
      ['CARA UPLOAD KOMPOSISI:'],
      ['1. Isi produk di sheet "Produk" dengan "Punya Komposisi" = ya'],
      ['2. Isi komposisi di sheet "Komposisi" dengan Nama Produk yang SAMA PERSIS'],
      ['3. Kolom NAMA VARIAN opsional — isi jika komposisi khusus untuk varian tertentu'],
      ['4. Kolom NAMA BAHAN harus sesuai dengan nama Item yang sudah ada di sistem'],
      ['5. Kolom QTY adalah jumlah bahan yang digunakan per 1 unit produk (dalam satuan dasar bahan)'],
      ['6. Untuk produk varian, setiap varian bisa punya komposisi berbeda'],
      [''],
      ['CATATAN:'],
      ['• Kolom bertanda * wajib diisi'],
      ['• Maksimal 500 baris per upload'],
      ['• Jika Nama Produk sudah ada, baris tersebut akan dilewati (skip)'],
      ['• Re-upload aman — varian & komposisi yang sudah ada akan dilewati (skip)'],
      ['• Produk dengan varian: isi "Punya Varian" = "ya", Harga Jual boleh 0'],
      ['• Kategori baru akan otomatis dibuat jika belum ada di sistem'],
      ['• Harga harus dalam format angka tanpa titik/koma (contoh: 25000, bukan 25.000)'],
      ['• SKU & BARCODE akan otomatis di-generate jika dikosongkan (max 22 karakter)'],
      ['• Jika BARCODE dikosongkan, maka nilai BARCODE = SKU'],
      ['• Barcode yang di-generate dapat di-scan di halaman POS'],
      ['• Untuk produk dengan varian, isi kolom "Punya Varian" = "ya", lalu isi varian di sheet "Varian Produk"'],
      ['• Produk yang ditandai "Punya Varian" = ya wajib memiliki minimal 1 baris varian di sheet "Varian Produk"'],
      ['• Nama Produk di sheet "Varian Produk" harus SAMA PERSIS dengan Nama Produk di sheet "Produk" (case-sensitive)'],
      ['• Nama Produk & Nama Bahan di sheet "Komposisi" harus SAMA PERSIS (case-sensitive)'],
      ['• Item harus sudah terdaftar di sistem sebelum mengimport komposisi'],
      ['• Upload produk utama terlebih dahulu, baru upload varian & komposisi di sheet terpisah'],
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
      ['NAMA PRODUK*', 'NAMA VARIAN*', 'SKU VARIAN', 'BARCODE VARIAN', 'HPP (Rp)', 'HARGA JUAL* (Rp)', 'STOK'],
      // ── Kopi Susu Gula Aren ──
      ['Kopi Susu Gula Aren', 'Small', 'SKU-004-S', 'SKU-004-S', 4000, 12000, 30],
      ['Kopi Susu Gula Aren', 'Medium', 'SKU-004-M', 'SKU-004-M', 5000, 15000, 50],
      ['Kopi Susu Gula Aren', 'Large', 'SKU-004-L', 'SKU-004-L', 6000, 18000, 20],
      // ── Rokok Sampoerna Mild (contoh varian produk ritel) ──
      ['Rokok Sampoerna Mild', '16 Batang', 'SKU-SM-16', 'SKU-SM-16', 19500, 22000, 100],
      ['Rokok Sampoerna Mild', '12 Batang', 'SKU-SM-12', 'SKU-SM-12', 14500, 17000, 80],
    ]
    const wsVariants = XLSX.utils.aoa_to_sheet(variantData)
    wsVariants['!cols'] = [
      { wch: 25 }, // Nama Produk
      { wch: 20 }, // Nama Varian
      { wch: 18 }, // SKU Varian
      { wch: 18 }, // Barcode Varian
      { wch: 15 }, // HPP (Rp)
      { wch: 22 }, // Harga Jual* (Rp)
      { wch: 10 }, // Stok
    ]
    XLSX.utils.book_append_sheet(wb, wsVariants, 'Varian Produk')

    // === Sheet 4: Komposisi Produk ===
    const compData = [
      ['NAMA PRODUK*', 'NAMA VARIAN', 'NAMA BAHAN*', 'QTY*'],
      // ── Nasi Goreng Spesial ──
      ['Nasi Goreng Spesial', '', 'Nasi', 200],
      ['Nasi Goreng Spesial', '', 'Telur', 2],
      ['Nasi Goreng Spesial', '', 'Kecap Manis', 15],
      ['Nasi Goreng Spesial', '', 'Minyak Goreng', 30],
      ['Nasi Goreng Spesial', '', 'Bawang Merah', 10],
      ['Nasi Goreng Spesial', '', 'Cabai Rawit', 5],
      // ── Sate Ayam Madura ──
      ['Sate Ayam Madura 10 tusuk', '', 'Daging Ayam', 250],
      ['Sate Ayam Madura 10 tusuk', '', 'Kecap Manis', 20],
      ['Sate Ayam Madura 10 tusuk', '', 'Bawang Putih', 5],
      ['Sate Ayam Madura 10 tusuk', '', 'Kacang Tanah', 30],
    ]
    const wsComp = XLSX.utils.aoa_to_sheet(compData)
    wsComp['!cols'] = [
      { wch: 28 }, // Nama Produk
      { wch: 20 }, // Nama Varian (kosongkan untuk komposisi produk utama)
      { wch: 25 }, // Nama Bahan
      { wch: 12 }, // QTY
    ]
    XLSX.utils.book_append_sheet(wb, wsComp, 'Komposisi')

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
