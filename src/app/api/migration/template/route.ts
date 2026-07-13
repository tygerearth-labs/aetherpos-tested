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

    // ============================================================
    // SHEET 1: Produk Non-Varian
    // Untuk produk tanpa varian (produk langsung jual)
    // ============================================================
    const nonVariantHeader = [
      'NAMA PRODUK*',
      'SKU',
      'BARCODE',
      'HPP / MODAL (Rp)',
      'HARGA JUAL* (Rp)',
      'STOK AWAL',
      'SATUAN',
      'KATEGORI',
      'LOW STOCK ALERT',
      'KOMPOSISI INLINE (Opsional)',
    ]

    const nonVariantData = [
      // ── F&B (Makanan & Minuman) ──
      ['Nasi Goreng Spesial', 'SKU-001', '8991234001', 10000, 25000, 50, 'porsi', 'Makanan', 10, 'Nasi:200gr,Rogut:1butir,Minyak:15ml,Bawang:10gr'],
      ['Es Teh Manis', 'SKU-002', '8991234002', 3000, 8000, 100, 'gelas', 'Minuman', 20, 'Teh Celup:1pcs,Gula:20gr,Es Batu:100gr'],
      ['Kopi Susu Gula Aren', 'SKU-003', '8991234003', 5000, 15000, 80, 'gelas', 'Minuman', 15, 'Espresso:30ml,Susu:80ml,Gula Aren:25gr'],
      ['Ayam Geprek', 'SKU-004', '8991234004', 12000, 20000, 30, 'porsi', 'Makanan', 5, 'Ayam Dada:150gr,Tepung:50gr,Minyak:30ml'],
      ['Mie Goreng', 'SKU-005', '8991234005', 8000, 18000, 40, 'porsi', 'Makanan', 8, 'Mie:200gr,Telur:1butir,Sawi:30gr'],
      ['Jus Alpukat', 'SKU-006', '8991234006', 6000, 15000, 30, 'gelas', 'Minuman', 5, 'Alpukat:100gr,Susu:100ml,Gula:20gr'],
      ['Bakso Kuah', 'SKU-007', '8991234007', 9000, 18000, 20, 'porsi', 'Makanan', 5, 'Bakso:10pcs,Mie:50gr,Tahu:2pcs'],
      ['Sate Ayam 10 tusuk', 'SKU-008', '8991234008', 11000, 22000, 25, 'porsi', 'Makanan', 5, 'Ayam:200gr,Bambu:10pcs,Kecap:15ml'],

      // ── Beauty / Kecantikan ──
      ['Cream Wajah 30ml', 'BTY-001', '8992001001', 25000, 55000, 48, 'pcs', 'Skincare', 10, ''],
      ['Serum Vitamin C 20ml', 'BTY-002', '8992001002', 35000, 85000, 30, 'pcs', 'Skincare', 10, ''],
      ['Lipstik Matte', 'BTY-003', '8992001003', 15000, 45000, 60, 'pcs', 'Makeup', 10, ''],
      ['Bedak Tabur', 'BTY-004', '8992001004', 20000, 50000, 40, 'pcs', 'Makeup', 10, ''],
      ['Parfum 50ml', 'BTY-005', '8992001005', 45000, 95000, 24, 'pcs', 'Parfum', 5, ''],

      // ── Jasa ──
      ['Jasa Cuci Motor', 'JSA-001', '', 5000, 15000, 999, 'pcs', 'Jasa', 0, ''],
      ['Jasa Potong Rambut', 'JSA-002', '', 0, 25000, 999, 'pcs', 'Jasa', 0, ''],
      ['Jasa Isi Angin Ban', 'JSA-003', '', 0, 5000, 999, 'pcs', 'Jasa', 0, ''],

      // ── Retail / Minimarket ──
      ['Air Mineral 600ml', 'RTL-001', '8993001001', 2500, 4000, 144, 'pcs', 'Minuman', 24, ''],
      ['Minyak Goreng 1L', 'RTL-002', '8993001002', 14000, 18000, 60, 'pcs', 'Sembako', 10, ''],
      ['Gula Pasir 500g', 'RTL-003', '8993001003', 8000, 12000, 40, 'pcs', 'Sembako', 10, ''],
      ['Tisu Paseo 250 Sheet', 'RTL-004', '8993001004', 7500, 11000, 48, 'pcs', 'Kebutuhan Rumah', 10, ''],
      ['Sabun Mandi 100g', 'RTL-005', '8993001005', 7000, 12000, 36, 'pcs', 'Perawatan Tubuh', 10, ''],
      ['Charger HP Android', 'RTL-006', '8993001006', 15000, 25000, 15, 'pcs', 'Elektronik', 5, ''],

      // ── Percetakan ──
      ['Cetak Brosur A5', 'PCT-001', '', 500, 1500, 500, 'lembar', 'Percetakan', 100, 'Kertas A5:1pcs,Tinta:2ml'],
      ['Cetak Kartu Nama', 'PCT-002', '', 200, 800, 1000, 'lembar', 'Percetakan', 200, 'Kertas Art Carton:1pcs,Laminasi:1pcs'],
      ['Cetak Stiker Roll', 'PCT-003', '', 3000, 8000, 50, 'roll', 'Percetakan', 10, 'Bahan Stiker:1roll,Tinta:50ml'],
      ['Cetak Undangan', 'PCT-004', '', 1500, 3500, 200, 'pcs', 'Percetakan', 50, 'Kertas Ivory:1pcs,Plastik:1pcs'],
    ]

    const wsNonVariant = XLSX.utils.aoa_to_sheet([nonVariantHeader, ...nonVariantData])
    wsNonVariant['!cols'] = [
      { wch: 30 }, // Nama Produk
      { wch: 15 }, // SKU
      { wch: 18 }, // Barcode
      { wch: 20 }, // HPP / Modal
      { wch: 22 }, // Harga Jual
      { wch: 14 }, // Stok Awal
      { wch: 12 }, // Satuan
      { wch: 18 }, // Kategori
      { wch: 16 }, // Low Stock Alert
      { wch: 55 }, // Komposisi Inline
    ]

    // Data validation for SATUAN
    wsNonVariant['!dataValidation'] = [{
      type: 'list',
      allowBlank: true,
      sqref: 'G2:G5000',
      formulas: ['"pcs,ml,lt,gr,kg,box,pack,botol,gelas,mangkuk,porsi,bungkus,sachet,dus,rim,lembar,meter,cm,ons,roll,strip,ekor"'],
    }]

    XLSX.utils.book_append_sheet(wb, wsNonVariant, 'Produk Non-Varian')

    // ============================================================
    // SHEET 2: Produk Varian
    // Untuk produk yang punya varian (ukuran, rasa, dll)
    // Format: Baris pertama = produk induk, baris berikutnya = varian
    // ============================================================
    const variantHeader = [
      'NAMA PRODUK*',
      'SKU PRODUK',
      'BARCODE PRODUK',
      'HPP PRODUK (Rp)',
      'HARGA JUAL PRODUK* (Rp)',
      'KATEGORI',
      'NAMA VARIAN*',
      'SKU VARIAN',
      'BARCODE VARIAN',
      'HPP VARIAN (Rp)',
      'HARGA JUAL VARIAN* (Rp)',
      'STOK AWAL VARIAN',
      'KOMPOSISI VARIAN INLINE (Opsional)',
    ]

    const variantData = [
      // ── Kopi Susu (Varian Ukuran) ──
      ['Kopi Susu', 'KPI-001', '', 0, 0, 'Minuman', 'Small 200ml', 'KPI-SM', '', 3500, 12000, 50, 'Espresso:20ml,Susu:60ml,Gula Aren:15gr'],
      ['', '', '', '', '', '', 'Regular 300ml', 'KPI-RG', '', 5000, 16000, 40, 'Espresso:30ml,Susu:90ml,Gula Aren:20gr'],
      ['', '', '', '', '', '', 'Large 400ml', 'KPI-LG', '', 6500, 20000, 30, 'Espresso:40ml,Susu:120ml,Gula Aren:25gr'],

      // ── Teh (Varian Rasa) ──
      ['Teh', 'TEH-001', '', 0, 0, 'Minuman', 'Original', 'TEH-ORG', '', 1500, 5000, 80, 'Teh Celup:1pcs,Gula:15gr,Es Batu:80gr'],
      ['', '', '', '', '', '', 'Lemon', 'TEH-LMN', '', 2000, 7000, 60, 'Teh Celup:1pcs,Gula:15gr,Perasan Lemon:15ml,Es Batu:80gr'],
      ['', '', '', '', '', '', 'Peach', 'TEH-PCH', '', 2500, 8000, 40, 'Teh Celup:1pcs,Gula:15gr,Sirup Peach:15ml,Es Batu:80gr'],

      // ── Ayam Geprek (Varian Level) ──
      ['Ayam Geprek', 'AGP-001', '', 0, 0, 'Makanan', 'Level 0 (Original)', 'AGP-L0', '', 10000, 18000, 30, 'Ayam Dada:150gr,Tepung:50gr,Minyak:30ml'],
      ['', '', '', '', '', '', 'Level 1 (Pedas)', 'AGP-L1', '', 10000, 19000, 25, 'Ayam Dada:150gr,Tepung:50gr,Cabai Rawit:5gr,Minyak:30ml'],
      ['', '', '', '', '', '', 'Level 2 (Extreme)', 'AGP-L2', '', 10000, 20000, 20, 'Ayam Dada:150gr,Tepung:50gr,Cabai Rawit:15gr,Minyak:30ml'],

      // ── Bedak (Varian Shade) ──
      ['Bedak Tabur', 'BDK-001', '', 0, 0, 'Makeup', 'Natural', 'BDK-NAT', '', 15000, 45000, 40, ''],
      ['', '', '', '', '', '', 'Warm', 'BDK-WRM', '', 15000, 45000, 40, ''],
      ['', '', '', '', '', '', 'Cool', 'BDK-COO', '', 15000, 45000, 30, ''],

      // ── Sabun Mandi (Varian Varian) ──
      ['Sabun Mandi', 'SBM-001', '', 0, 0, 'Perawatan Tubuh', 'Lavender 100g', 'SBM-LAV', '', 5000, 12000, 36, ''],
      ['', '', '', '', '', '', 'Charcoal 100g', 'SBM-CHR', '', 6000, 15000, 30, ''],
      ['', '', '', '', '', '', 'Aloe Vera 100g', 'SBM-ALV', '', 5500, 13000, 25, ''],
    ]

    const wsVariant = XLSX.utils.aoa_to_sheet([variantHeader, ...variantData])
    wsVariant['!cols'] = [
      { wch: 25 }, // Nama Produk
      { wch: 15 }, // SKU Produk
      { wch: 18 }, // Barcode Produk
      { wch: 18 }, // HPP Produk
      { wch: 22 }, // Harga Jual Produk
      { wch: 18 }, // Kategori
      { wch: 24 }, // Nama Varian
      { wch: 15 }, // SKU Varian
      { wch: 18 }, // Barcode Varian
      { wch: 18 }, // HPP Varian
      { wch: 22 }, // Harga Jual Varian
      { wch: 18 }, // Stok Awal Varian
      { wch: 55 }, // Komposisi Varian
    ]

    XLSX.utils.book_append_sheet(wb, wsVariant, 'Produk Varian')

    // ============================================================
    // SHEET 3: Inventory (Bahan Baku)
    // Untuk tracking stok bahan baku / raw materials
    // ============================================================
    const inventoryHeader = [
      'NAMA BAHAN*',
      'SKU',
      'SATUAN DASAR*',
      'STOK AWAL',
      'HPP RATA-RATA (Rp)',
      'KATEGORI INVENTORY',
      'LOW STOCK ALERT',
      'DIGUNAKAN DI PRODUK (Opsional — koma-separated)',
    ]

    const inventoryData = [
      // ── Bahan F&B ──
      ['Beras', 'INV-BRS', 'kg', 50, 12000, 'Bahan Pokok', 10, 'Nasi Goreng Spesial,Bakso Kuah'],
      ['Daging Ayam Dada', 'INV-AYM', 'kg', 20, 35000, 'Protein', 5, 'Ayam Geprek,Sate Ayam 10 tusuk'],
      ['Telur Ayam', 'INV-TLU', 'pcs', 200, 2500, 'Protein', 20, 'Mie Goreng'],
      ['Minyak Goreng', 'INV-MYK', 'lt', 10, 18000, 'Bahan Pokok', 3, 'Nasi Goreng Spesial,Ayam Geprek'],
      ['Bawang Merah', 'INV-BWM', 'kg', 5, 30000, 'Bumbu', 2, 'Nasi Goreng Spesial'],
      ['Bawang Putih', 'INV-BWP', 'kg', 3, 35000, 'Bumbu', 2, 'Nasi Goreng Spesial,Ayam Geprek'],
      ['Cabai Rawit', 'INV-CBR', 'kg', 2, 45000, 'Bumbu', 1, 'Ayam Geprek'],
      ['Teh Celup', 'INV-THC', 'pcs', 500, 1500, 'Minuman', 50, 'Es Teh Manis,Teh'],
      ['Gula Pasir', 'INV-GLP', 'kg', 25, 14000, 'Bahan Pokok', 5, 'Es Teh Manis,Jus Alpukat,Teh'],
      ['Es Batu', 'INV-ESB', 'kg', 30, 2000, 'Minuman', 5, 'Es Teh Manis,Jus Alpukat,Teh,Kopi Susu'],
      ['Susu UHT', 'INV-SUS', 'lt', 15, 16000, 'Bahan Susu', 3, 'Kopi Susu,Jus Alpukat'],
      ['Espresso Shot', 'INV-ESP', 'ml', 3000, 80, 'Bahan Kopi', 500, 'Kopi Susu'],
      ['Gula Aren Cair', 'INV-GAC', 'ml', 2000, 25, 'Bahan Kopi', 200, 'Kopi Susu'],
      ['Alpukat', 'INV-ALP', 'kg', 10, 25000, 'Buah', 3, 'Jus Alpukat'],
      ['Sawi Hijau', 'INV-SWI', 'kg', 5, 8000, 'Sayuran', 2, 'Mie Goreng'],
      ['Mie Telur Kuning', 'INV-MIE', 'kg', 10, 15000, 'Bahan Pokok', 3, 'Mie Goreng,Bakso Kuah'],
      ['Bakso Daging', 'INV-BKS', 'pcs', 500, 1500, 'Protein', 50, 'Bakso Kuah'],
      ['Tahu Putih', 'INV-THU', 'pcs', 100, 1000, 'Protein', 20, 'Bakso Kuah'],
      ['Tepung Terigu', 'INV-TPG', 'kg', 10, 12000, 'Bahan Pokok', 3, 'Ayam Geprek'],
      ['Sirup Peach', 'INV-SRP', 'ml', 1000, 35, 'Bahan Sirup', 100, 'Teh'],
      ['Perasan Lemon', 'INV-PLM', 'ml', 500, 50, 'Bahan Minuman', 50, 'Teh'],
      ['Kertas A5', 'INV-KA5', 'pcs', 2000, 300, 'Bahan Cetak', 200, 'Cetak Brosur A5'],
      ['Kertas Art Carton', 'INV-KAC', 'pcs', 1000, 500, 'Bahan Cetak', 100, 'Cetak Kartu Nama'],
      ['Bahan Stiker Roll', 'INV-BSR', 'roll', 100, 5000, 'Bahan Cetak', 10, 'Cetak Stiker Roll'],
      ['Kertas Ivory', 'INV-KIV', 'pcs', 500, 1000, 'Bahan Cetak', 50, 'Cetak Undangan'],
      ['Laminasi Glossy', 'INV-LMG', 'pcs', 500, 200, 'Bahan Cetak', 50, 'Cetak Kartu Nama'],
      ['Tinta Cetak', 'INV-TNT', 'ml', 5000, 15, 'Bahan Cetak', 500, 'Cetak Brosur A5,Cetak Stiker Roll'],
      ['Plastik Undangan', 'INV-PLS', 'pcs', 500, 150, 'Bahan Cetak', 50, 'Cetak Undangan'],
      ['Bambu Sate', 'INV-BMB', 'pcs', 1000, 50, 'Bahan Sate', 100, 'Sate Ayam 10 tusuk'],
      ['Kecap Manis', 'INV-KCP', 'ml', 1000, 15, 'Bumbu', 100, 'Sate Ayam 10 tusuk'],
    ]

    const wsInventory = XLSX.utils.aoa_to_sheet([inventoryHeader, ...inventoryData])
    wsInventory['!cols'] = [
      { wch: 28 }, // Nama Bahan
      { wch: 15 }, // SKU
      { wch: 14 }, // Satuan Dasar
      { wch: 12 }, // Stok Awal
      { wch: 20 }, // HPP Rata-rata
      { wch: 22 }, // Kategori Inventory
      { wch: 16 }, // Low Stock Alert
      { wch: 50 }, // Digunakan Di Produk
    ]

    // Data validation for SATUAN DASAR
    wsInventory['!dataValidation'] = [{
      type: 'list',
      allowBlank: true,
      sqref: 'C2:C5000',
      formulas: ['"pcs,ml,lt,gr,kg,box,pack,botol,gelas,mangkuk,porsi,bungkus,sachet,dus,rim,lembar,meter,cm,ons,roll,strip,ekor"'],
    }]

    XLSX.utils.book_append_sheet(wb, wsInventory, 'Inventory (Bahan Baku)')

    // ============================================================
    // SHEET 4: Komposisi / Resep (Detail BOM)
    // Opsional — untuk resep yang kompleks dengan yield per batch
    // ============================================================
    const compositionHeader = [
      'NAMA PRODUK*',
      'NAMA VARIAN (Kosongkan jika non-varian)',
      'NAMA BAHAN*',
      'SKU BAHAN (Opsional — auto-match)',
      'QTY PER BATCH*',
      'SATUAN BAHAN',
      'YIELD PER BATCH (Hasil per 1 batch)',
      'CATATAN',
    ]

    const compositionData = [
      // ── Kopi Susu Variants ──
      ['Kopi Susu', 'Small 200ml', 'Espresso Shot', 'INV-ESP', 20, 'ml', 1, '1 cup = 20ml espresso'],
      ['Kopi Susu', 'Small 200ml', 'Susu UHT', 'INV-SUS', 60, 'ml', 1, ''],
      ['Kopi Susu', 'Small 200ml', 'Gula Aren Cair', 'INV-GAC', 15, 'ml', 1, ''],
      ['Kopi Susu', 'Regular 300ml', 'Espresso Shot', 'INV-ESP', 30, 'ml', 1, ''],
      ['Kopi Susu', 'Regular 300ml', 'Susu UHT', 'INV-SUS', 90, 'ml', 1, ''],
      ['Kopi Susu', 'Regular 300ml', 'Gula Aren Cair', 'INV-GAC', 20, 'ml', 1, ''],
      ['Kopi Susu', 'Large 400ml', 'Espresso Shot', 'INV-ESP', 40, 'ml', 1, ''],
      ['Kopi Susu', 'Large 400ml', 'Susu UHT', 'INV-SUS', 120, 'ml', 1, ''],
      ['Kopi Susu', 'Large 400ml', 'Gula Aren Cair', 'INV-GAC', 25, 'ml', 1, ''],

      // ── Nasi Goreng (non-varian, kolom Varian kosong) ──
      ['Nasi Goreng Spesial', '', 'Beras', 'INV-BRS', 200, 'gr', 1, '200gr beras per porsi'],
      ['Nasi Goreng Spesial', '', 'Telur Ayam', 'INV-TLU', 1, 'pcs', 1, '1 butir per porsi'],
      ['Nasi Goreng Spesial', '', 'Minyak Goreng', 'INV-MYK', 15, 'ml', 1, ''],
      ['Nasi Goreng Spesial', '', 'Bawang Merah', 'INV-BWM', 10, 'gr', 1, ''],

      // ── Ayam Geprek Level ──
      ['Ayam Geprek', 'Level 0 (Original)', 'Daging Ayam Dada', 'INV-AYM', 150, 'gr', 1, ''],
      ['Ayam Geprek', 'Level 0 (Original)', 'Tepung Terigu', 'INV-TPG', 50, 'gr', 1, ''],
      ['Ayam Geprek', 'Level 0 (Original)', 'Minyak Goreng', 'INV-MYK', 30, 'ml', 1, ''],
      ['Ayam Geprek', 'Level 1 (Pedas)', 'Daging Ayam Dada', 'INV-AYM', 150, 'gr', 1, ''],
      ['Ayam Geprek', 'Level 1 (Pedas)', 'Tepung Terigu', 'INV-TPG', 50, 'gr', 1, ''],
      ['Ayam Geprek', 'Level 1 (Pedas)', 'Cabai Rawit', 'INV-CBR', 5, 'gr', 1, ''],
      ['Ayam Geprek', 'Level 1 (Pedas)', 'Minyak Goreng', 'INV-MYK', 30, 'ml', 1, ''],
      ['Ayam Geprek', 'Level 2 (Extreme)', 'Daging Ayam Dada', 'INV-AYM', 150, 'gr', 1, ''],
      ['Ayam Geprek', 'Level 2 (Extreme)', 'Tepung Terigu', 'INV-TPG', 50, 'gr', 1, ''],
      ['Ayam Geprek', 'Level 2 (Extreme)', 'Cabai Rawit', 'INV-CBR', 15, 'gr', 1, '3x lipat pedasnya'],
      ['Ayam Geprek', 'Level 2 (Extreme)', 'Minyak Goreng', 'INV-MYK', 30, 'ml', 1, ''],

      // ── Contoh Yield per Batch ──
      ['Roti Bakar (contoh)', '', 'Tepung Terigu', 'INV-TPG', 1000, 'gr', 10, '1kg tepung → 10 potong'],
      ['Roti Bakar (contoh)', '', 'Gula Pasir', 'INV-GLP', 100, 'gr', 10, '100gr gula → 10 potong'],
      ['Roti Bakar (contoh)', '', 'Telur Ayam', 'INV-TLU', 5, 'pcs', 10, '5 butir telur → 10 potong'],
    ]

    const wsComposition = XLSX.utils.aoa_to_sheet([compositionHeader, ...compositionData])
    wsComposition['!cols'] = [
      { wch: 28 }, // Nama Produk
      { wch: 30 }, // Nama Varian
      { wch: 24 }, // Nama Bahan
      { wch: 18 }, // SKU Bahan
      { wch: 16 }, // QTY Per Batch
      { wch: 14 }, // Satuan Bahan
      { wch: 26 }, // Yield Per Batch
      { wch: 35 }, // Catatan
    ]

    XLSX.utils.book_append_sheet(wb, wsComposition, 'Komposisi (Resep/BOM)')

    // ============================================================
    // SHEET 5: Panduan Import
    // ============================================================
    const guideData = [
      ['TEMPLATE MIGRASI — AETHER POS (Revisi Lengkap)'],
      [''],
      ['Template ini sudah disesuaikan untuk migrasi baru dengan dukungan:'],
      ['  ✓ Produk Non-Varian (langsung jual)'],
      ['  ✓ Produk Varian (ukuran, rasa, level, shade, dll)'],
      ['  ✓ Inventory / Bahan Baku dengan stok awal'],
      ['  ✓ Komposisi Inline (di sheet Produk) & Komposisi Detail (sheet terpisah)'],
      [''],
      ['═'.repeat(70)],
      ['SHEET 1: PRODUK NON-VARIAN'],
      ['═'.repeat(70)],
      [''],
      ['Untuk produk tanpa varian — langsung siap jual.'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'CONTOH', 'WAJIB?'],
      ['NAMA PRODUK*', 'Nama produk / item', 'Nasi Goreng Spesial', 'Ya'],
      ['SKU', 'Kode unik (auto-generate jika kosong)', 'SKU-001', 'Tidak'],
      ['BARCODE', 'Barcode untuk scan (auto dari SKU)', '8991234001', 'Tidak'],
      ['HPP / MODAL (Rp)', 'Harga pokok per unit', '10000', 'Tidak'],
      ['HARGA JUAL* (Rp)', 'Harga jual ke customer', '25000', 'Ya'],
      ['STOK AWAL', 'Jumlah stok saat ini', '50', 'Tidak'],
      ['SATUAN', 'Unit produk', 'porsi', 'Tidak'],
      ['KATEGORI', 'Nama kategori (auto-create)', 'Makanan', 'Tidak'],
      ['LOW STOCK ALERT', 'Batas peringatan stok rendah', '10', 'Tidak'],
      ['KOMPOSISI INLINE', 'Resep langsung di kolom (opsional)', 'Nasi:200gr,Telur:1pcs', 'Tidak'],
      [''],
      ['FORMAT KOMPOSISI INLINE:'],
      ['  NamaBahan:qtySatuan,NamaBahan:qtySatuan'],
      ['  Contoh: Nasi:200gr,Rogut:1butir,Minyak:15ml'],
      ['  → Otomatis di-parse dan di-link ke Inventory Items'],
      ['  → Nama bahan harus cocok dengan sheet "Inventory (Bahan Baku)"'],
      [''],
      ['═'.repeat(70)],
      ['SHEET 2: PRODUK VARIAN'],
      ['═'.repeat(70)],
      [''],
      ['Untuk produk yang punya varian (ukuran, rasa, level, shade, dll).'],
      ['Baris pertama = produk induk. Baris kosong NAMA PRODUK = varian dari induk terakhir.'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'WAJIB?'],
      ['NAMA PRODUK*', 'Nama produk induk (isi di baris pertama saja)', 'Ya'],
      ['SKU PRODUK', 'SKU produk induk', 'Tidak'],
      ['HARGA JUAL PRODUK*', 'Harga default (tidak dipakai jika ada varian)', 'Ya'],
      ['KATEGORI', 'Kategori (isi di baris pertama saja)', 'Tidak'],
      ['NAMA VARIAN*', 'Nama varian (Small, Regular, Original, dll)', 'Ya'],
      ['SKU VARIAN', 'SKU varian', 'Tidak'],
      ['BARCODE VARIAN', 'Barcode varian', 'Tidak'],
      ['HPP VARIAN (Rp)', 'HPP per varian', 'Tidak'],
      ['HARGA JUAL VARIAN* (Rp)', 'Harga jual per varian', 'Ya'],
      ['STOK AWAL VARIAN', 'Stok per varian', 'Tidak'],
      ['KOMPOSISI VARIAN INLINE', 'Resep per varian (opsional)', 'Tidak'],
      [''],
      ['═'.repeat(70)],
      ['SHEET 3: INVENTORY (BAHAN BAKU)'],
      ['═'.repeat(70)],
      [''],
      ['Untuk tracking stok bahan baku / raw materials.'],
      ['Digunakan bersama mode "Buat Produk + Inventory".'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'WAJIB?'],
      ['NAMA BAHAN*', 'Nama bahan baku', 'Ya'],
      ['SKU', 'Kode SKU', 'Tidak'],
      ['SATUAN DASAR*', 'Unit dasar: gr, kg, ml, lt, pcs, meter', 'Ya'],
      ['STOK AWAL', 'Stok saat ini', 'Tidak'],
      ['HPP RATA-RATA (Rp)', 'Harga pokok rata-rata per unit', 'Tidak'],
      ['KATEGORI INVENTORY', 'Kategori bahan (Bahan Pokok, Protein, dll)', 'Tidak'],
      ['LOW STOCK ALERT', 'Batas peringatan', 'Tidak'],
      ['DIGUNAKAN DI PRODUK', 'List produk yang pakai bahan ini (opsional)', 'Tidak'],
      [''],
      ['═'.repeat(70)],
      ['SHEET 4: KOMPOSISI / RESEP (BOM DETAIL)'],
      ['═'.repeat(70)],
      [''],
      ['Untuk resep yang kompleks — misal 1kg tepung menghasilkan 10 roti.'],
      ['Lebih detail dari komposisi inline di sheet Produk.'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'WAJIB?'],
      ['NAMA PRODUK*', 'Nama produk (harus cocok)', 'Ya'],
      ['NAMA VARIAN', 'Kosongkan jika produk non-varian', 'Tidak'],
      ['NAMA BAHAN*', 'Nama bahan baku (harus cocok)', 'Ya'],
      ['SKU BAHAN', 'SKU bahan (opsional, untuk verifikasi)', 'Tidak'],
      ['QTY PER BATCH*', 'Jumlah bahan per 1 batch', 'Ya'],
      ['SATUAN BAHAN', 'Satuan bahan', 'Ya'],
      ['YIELD PER BATCH', 'Berapa hasil per 1 batch (default: 1)', 'Tidak'],
      ['CATATAN', 'Catatan tambahan', 'Tidak'],
      [''],
      ['CONTOH YIELD:'],
      ['  Roti Bakar: 1000gr Tepung + 100gr Gula + 5pcs Telur → 10 potong'],
      ['  → QTY = 1000 (gr), Yield Per Batch = 10'],
      ['  → Artinya: 1 potong roti mengkonsumsi 100gr tepung'],
      [''],
      ['═'.repeat(70)],
      ['MODE IMPORT'],
      ['═'.repeat(70)],
      [''],
      ['1. BUAT PRODUK SAJA (sheet Produk Non-Varian & Varian saja)'],
      ['   → Product + Varian dibuat, tanpa inventory'],
      ['   → Cocok untuk: Retail, Jasa, F&B tanpa resep'],
      [''],
      ['2. BUAT PRODUK + INVENTORY (semua sheet diproses)'],
      ['   → Product + Varian + InventoryItem + Komposisi + Opening Balance'],
      ['   → Cocok untuk: F&B dengan resep, Manufactur, Percetakan'],
      [''],
      ['═'.repeat(70)],
      ['CATATAN UMUM'],
      ['═'.repeat(70)],
      [''],
      ['• Kolom bertanda * wajib diisi'],
      ['• Maksimal 500 baris per sheet'],
      ['• Produk duplikat (nama sama) akan dilewati (skip)'],
      ['• Kategori baru otomatis dibuat'],
      ['• SKU & Barcode auto-generate jika dikosongkan'],
      ['• Harga format: 25000 atau Rp25.000 atau 25.000'],
      ['• Komposisi inline & detail bisa digunakan bersamaan'],
      ['• Import bisa diulang dengan aman (skip duplikat)'],
      ['• Bahan baku di komposisi harus sudah ada di sheet Inventory ATAU auto-create'],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [
      { wch: 35 },
      { wch: 60 },
      { wch: 40 },
      { wch: 10 },
    ]
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan Import')

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