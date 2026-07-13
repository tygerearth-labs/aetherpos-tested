import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { safeJsonError } from '@/lib/api/safe-response'

export async function GET(request: NextRequest) {
  try {
    const wb = XLSX.utils.book_new()

    // ============================================================
    // SHEET 1: Produk Non-Varian
    // Contoh seimbang dari 10 lini industri bisnis
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
      // ── F&B (Restoran, Kafe, Warung) ──
      ['Nasi Goreng Spesial', 'FNB-001', '8991001001', 10000, 25000, 50, 'porsi', 'Makanan', 10, ''],
      ['Es Teh Manis', 'FNB-002', '8991001002', 3000, 8000, 100, 'gelas', 'Minuman', 20, ''],
      ['Ayam Geprek', 'FNB-003', '8991001003', 12000, 20000, 30, 'porsi', 'Makanan', 5, ''],

      // ── Retail / Minimarket ──
      ['Air Mineral 600ml', 'RTL-001', '8992001001', 2500, 4000, 144, 'pcs', 'Minuman', 24, ''],
      ['Minyak Goreng 1L', 'RTL-002', '8992001002', 14000, 18000, 60, 'pcs', 'Sembako', 10, ''],
      ['Tisu Paseo 250 Sheet', 'RTL-003', '8992001003', 7500, 11000, 48, 'pcs', 'Kebutuhan Rumah', 10, ''],

      // ── Beauty / Kecantikan ──
      ['Cream Wajah 30ml', 'BTY-001', '8993001001', 25000, 55000, 48, 'pcs', 'Skincare', 10, ''],
      ['Serum Vitamin C 20ml', 'BTY-002', '8993001002', 35000, 85000, 30, 'pcs', 'Skincare', 10, ''],
      ['Lipstik Matte', 'BTY-003', '8993001003', 15000, 45000, 60, 'pcs', 'Makeup', 10, ''],

      // ── Jasa / Layanan ──
      ['Jasa Cuci Motor', 'JSA-001', '', 5000, 15000, 999, 'pcs', 'Jasa', 0, ''],
      ['Jasa Potong Rambut', 'JSA-002', '', 0, 25000, 999, 'pcs', 'Jasa', 0, ''],
      ['Jasa Laundry Kiloan', 'JSA-003', '', 3000, 8000, 999, 'kg', 'Jasa', 0, ''],

      // ── Percetakan ──
      ['Cetak Brosur A5', 'PCT-001', '', 500, 1500, 500, 'lembar', 'Percetakan', 100, ''],
      ['Cetak Kartu Nama', 'PCT-002', '', 200, 800, 1000, 'pcs', 'Percetakan', 200, ''],
      ['Cetak Stiker Roll', 'PCT-003', '', 3000, 8000, 50, 'roll', 'Percetakan', 10, ''],

      // ── Fashion / Pakaian ──
      ['Kaos Polos Cotton 30s', 'FSH-001', '8994001001', 35000, 65000, 100, 'pcs', 'Atasan', 15, ''],
      ['Celana Jeans Slim', 'FSH-002', '8994001002', 80000, 150000, 50, 'pcs', 'Bawahan', 10, ''],
      ['Hijab Segi Empat', 'FSH-003', '8994001003', 15000, 35000, 200, 'pcs', 'Hijab', 20, ''],

      // ── Farmasi / Kesehatan ──
      ['Paracetamol 500mg', 'FRM-001', '8995001001', 3500, 7000, 200, 'strip', 'Obat Bebas', 50, ''],
      ['Minyak Kayu Putih 60ml', 'FRM-002', '8995001002', 12000, 22000, 80, 'botol', 'Obat Herbal', 15, ''],
      ['Masker Medis 3ply', 'FRM-003', '8995001003', 800, 2000, 500, 'pcs', 'Alat Kesehatan', 100, ''],

      // ── Elektronik / Gadget ──
      ['Charger HP 20W', 'ELK-001', '8996001001', 15000, 35000, 30, 'pcs', 'Aksesoris HP', 5, ''],
      ['Kabel Data USB-C', 'ELK-002', '8996001002', 8000, 18000, 50, 'pcs', 'Aksesoris HP', 10, ''],
      ['Earphone Bluetooth', 'ELK-003', '8996001003', 25000, 55000, 25, 'pcs', 'Audio', 5, ''],

      // ── Bangunan / Material ──
      ['Semen 50kg', 'BNG-001', '8997001001', 55000, 65000, 100, 'sak', 'Semen', 20, ''],
      ['Cat Tembok 5L', 'BNG-002', '8997001002', 75000, 95000, 30, 'pcs', 'Cat', 5, ''],
      ['Besi Beton 10mm', 'BNG-003', '8997001003', 18000, 25000, 200, 'batang', 'Besi', 20, ''],

      // ── Pertanian / Agrobisnis ──
      ['Pupuk NPK 1kg', 'AGB-001', '8998001001', 8000, 15000, 100, 'kg', 'Pupuk', 20, ''],
      ['Benih Padi 1kg', 'AGB-002', '8998001002', 25000, 45000, 50, 'kg', 'Benih', 10, ''],
      ['Pestisida 100ml', 'AGB-003', '8998001003', 15000, 28000, 40, 'botol', 'Pestisida', 10, ''],
    ]

    const wsNonVariant = XLSX.utils.aoa_to_sheet([nonVariantHeader, ...nonVariantData])
    wsNonVariant['!cols'] = [
      { wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 20 },
      { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 22 },
      { wch: 16 }, { wch: 55 },
    ]

    wsNonVariant['!dataValidation'] = [{
      type: 'list',
      allowBlank: true,
      sqref: 'G2:G5000',
      formulas: ['"pcs,ml,lt,gr,kg,box,pack,botol,gelas,mangkuk,porsi,bungkus,sachet,dus,rim,lembar,meter,cm,ons,roll,strip,ekor,sak,batang"'],
    }]

    XLSX.utils.book_append_sheet(wb, wsNonVariant, 'Produk Non-Varian')

    // ============================================================
    // SHEET 2: Produk Varian
    // Contoh seimbang dari berbagai industri
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
      // ── F&B: Kopi (Varian Ukuran) ──
      ['Kopi Susu', 'VAR-FNB-001', '', 0, 0, 'Minuman', 'Small 200ml', 'VAR-FNB-001-S', '', 3500, 12000, 50, ''],
      ['', '', '', '', '', '', 'Regular 300ml', 'VAR-FNB-001-R', '', 5000, 16000, 40, ''],
      ['', '', '', '', '', '', 'Large 400ml', 'VAR-FNB-001-L', '', 6500, 20000, 30, ''],

      // ── Fashion: Kaos (Varian Ukuran) ──
      ['Kaos Polos Premium', 'VAR-FSH-001', '', 0, 0, 'Atasan', 'S', 'VAR-FSH-001-S', '', 35000, 65000, 40, ''],
      ['', '', '', '', '', '', 'M', 'VAR-FSH-001-M', '', 38000, 68000, 50, ''],
      ['', '', '', '', '', '', 'L', 'VAR-FSH-001-L', '', 40000, 70000, 40, ''],
      ['', '', '', '', '', '', 'XL', 'VAR-FSH-001-XL', '', 43000, 75000, 25, ''],

      // ── Beauty: Bedak (Varian Shade) ──
      ['Bedak Tabur', 'VAR-BTY-001', '', 0, 0, 'Makeup', 'Natural', 'VAR-BTY-001-N', '', 15000, 45000, 40, ''],
      ['', '', '', '', '', '', 'Warm', 'VAR-BTY-001-W', '', 15000, 45000, 40, ''],
      ['', '', '', '', '', '', 'Cool', 'VAR-BTY-001-C', '', 15000, 45000, 30, ''],

      // ── Elektronik: Casing HP (Varian Tipe) ──
      ['Casing HP Silicone', 'VAR-ELK-001', '', 0, 0, 'Aksesoris HP', 'iPhone 15', 'VAR-ELK-001-IP', '', 8000, 25000, 60, ''],
      ['', '', '', '', '', '', 'Samsung S24', 'VAR-ELK-001-SS', '', 8000, 25000, 50, ''],
      ['', '', '', '', '', '', 'Xiaomi 14', 'VAR-ELK-001-XM', '', 8000, 25000, 40, ''],

      // ── Percetakan: Undangan (Varian Paket) ──
      ['Undangan Pernikahan', 'VAR-PCT-001', '', 0, 0, 'Percetakan', 'Bronze (100 pcs)', 'VAR-PCT-001-B', '', 150000, 250000, 20, ''],
      ['', '', '', '', '', '', 'Silver (100 pcs)', 'VAR-PCT-001-S', '', 200000, 350000, 15, ''],
      ['', '', '', '', '', '', 'Gold (100 pcs)', 'VAR-PCT-001-G', '', 300000, 500000, 10, ''],

      // ── F&B: Mie Ayam (Varian Toping) ──
      ['Mie Ayam', 'VAR-FNB-002', '', 0, 0, 'Makanan', 'Biasa', 'VAR-FNB-002-B', '', 7000, 15000, 50, ''],
      ['', '', '', '', '', '', 'Mie Ayam Bakso', 'VAR-FNB-002-BK', '', 9000, 18000, 40, ''],
      ['', '', '', '', '', '', 'Mie Ayam Pangsit', 'VAR-FNB-002-PG', '', 10000, 20000, 30, ''],
    ]

    const wsVariant = XLSX.utils.aoa_to_sheet([variantHeader, ...variantData])
    wsVariant['!cols'] = [
      { wch: 25 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
      { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 20 },
      { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 18 },
      { wch: 55 },
    ]

    XLSX.utils.book_append_sheet(wb, wsVariant, 'Produk Varian')

    // ============================================================
    // SHEET 3: Inventory (Bahan Baku)
    // Contoh seimbang dari berbagai industri
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
      // ── F&B: Bahan Makanan & Minuman ──
      ['Beras', 'INV-FNB-001', 'kg', 50, 12000, 'Bahan Pokok', 10, 'Nasi Goreng Spesial,Mie Ayam'],
      ['Daging Ayam Dada', 'INV-FNB-002', 'kg', 20, 35000, 'Protein', 5, 'Ayam Geprek'],
      ['Telur Ayam', 'INV-FNB-003', 'pcs', 200, 2500, 'Protein', 20, 'Mie Ayam'],
      ['Minyak Goreng', 'INV-FNB-004', 'lt', 10, 18000, 'Bahan Pokok', 3, 'Nasi Goreng Spesial,Ayam Geprek'],
      ['Teh Celup', 'INV-FNB-005', 'pcs', 500, 1500, 'Minuman', 50, 'Es Teh Manis'],
      ['Gula Pasir', 'INV-FNB-006', 'kg', 25, 14000, 'Bahan Pokok', 5, 'Es Teh Manis'],

      // ── Percetakan: Bahan Cetak ──
      ['Kertas HVS A5', 'INV-PCT-001', 'pcs', 2000, 300, 'Bahan Cetak', 200, 'Cetak Brosur A5'],
      ['Kertas Art Carton', 'INV-PCT-002', 'pcs', 1000, 500, 'Bahan Cetak', 100, 'Cetak Kartu Nama'],
      ['Bahan Stiker Roll', 'INV-PCT-003', 'roll', 100, 5000, 'Bahan Cetak', 10, 'Cetak Stiker Roll'],
      ['Tinta Cetak', 'INV-PCT-004', 'ml', 5000, 15, 'Bahan Cetak', 500, 'Cetak Brosur A5,Cetak Stiker Roll'],
      ['Plastik Undangan', 'INV-PCT-005', 'pcs', 500, 150, 'Bahan Cetak', 50, 'Undangan Pernikahan'],
      ['Amplop Undangan', 'INV-PCT-006', 'pcs', 500, 200, 'Bahan Cetak', 50, 'Undangan Pernikahan'],

      // ── Fashion: Bahan Garmen ──
      ['Kain Katun Combed 30s', 'INV-FSH-001', 'meter', 200, 25000, 'Bahan Kain', 20, 'Kaos Polos Cotton 30s,Kaos Polos Premium'],
      ['Benang Jahit Poly', 'INV-FSH-002', 'roll', 100, 8000, 'Bahan Jahit', 15, 'Kaos Polos Cotton 30s,Kaos Polos Premium'],
      ['Resleting YKK 20cm', 'INV-FSH-003', 'pcs', 500, 3500, 'Kelengkapan', 30, 'Celana Jeans Slim'],
      ['Kain Denim 12oz', 'INV-FSH-004', 'meter', 100, 55000, 'Bahan Kain', 10, 'Celana Jeans Slim'],
      ['Kain Voal Premium', 'INV-FSH-005', 'meter', 150, 30000, 'Bahan Kain', 15, 'Hijab Segi Empat'],
      ['Label Woven', 'INV-FSH-006', 'pcs', 2000, 500, 'Kelengkapan', 200, 'Kaos Polos Cotton 30s,Celana Jeans Slim'],
      ['Polycotton 1m', 'INV-FSH-007', 'meter', 80, 22000, 'Bahan Kain', 10, 'Hijab Segi Empat'],

      // ── Bangunan: Material Konstruksi ──
      ['Semen Portland 50kg', 'INV-BNG-001', 'sak', 200, 58000, 'Semen', 30, 'Semen 50kg'],
      ['Pasir Cor', 'INV-BNG-002', 'm3', 10, 350000, 'Pasir', 2, ''],
      ['Kerikil / Split', 'INV-BNG-003', 'm3', 8, 450000, 'Kerikil', 2, ''],
      ['Besi Beton 10mm', 'INV-BNG-004', 'batang', 300, 22000, 'Besi', 30, 'Besi Beton 10mm'],
      ['Cat Tembok 5L Interior', 'INV-BNG-005', 'pcs', 50, 78000, 'Cat', 5, 'Cat Tembok 5L'],
      ['Paku 2 inch', 'INV-BNG-006', 'kg', 20, 25000, 'Hardware', 3, ''],
      ['Semen Mortar', 'INV-BNG-007', 'sak', 50, 35000, 'Semen', 10, ''],

      // ── Pertanian: Input Pertanian ──
      ['Pupuk NPK Granul', 'INV-AGB-001', 'kg', 200, 9000, 'Pupuk', 30, 'Pupuk NPK 1kg'],
      ['Benih Padi Unggul', 'INV-AGB-002', 'kg', 100, 28000, 'Benih', 15, 'Benih Padi 1kg'],
      ['Pestisida Organik', 'INV-AGB-003', 'lt', 20, 45000, 'Pestisida', 3, 'Pestisida 100ml'],
      ['Herbisida', 'INV-AGB-004', 'lt', 10, 85000, 'Herbisida', 2, ''],
      ['Mulsa Plastik', 'INV-AGB-005', 'roll', 30, 120000, 'Perlengkapan', 3, ''],
    ]

    const wsInventory = XLSX.utils.aoa_to_sheet([inventoryHeader, ...inventoryData])
    wsInventory['!cols'] = [
      { wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 12 },
      { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 50 },
    ]

    wsInventory['!dataValidation'] = [{
      type: 'list',
      allowBlank: true,
      sqref: 'C2:C5000',
      formulas: ['"pcs,ml,lt,gr,kg,box,pack,botol,gelas,mangkuk,porsi,bungkus,sachet,dus,rim,lembar,meter,cm,ons,roll,strip,ekor,sak,batang,m3"'],
    }]

    XLSX.utils.book_append_sheet(wb, wsInventory, 'Inventory (Bahan Baku)')

    // ============================================================
    // SHEET 4: Komposisi / Resep (Detail BOM)
    // Contoh seimbang dari berbagai industri
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
      // ── F&B: Nasi Goreng (non-varian) ──
      ['Nasi Goreng Spesial', '', 'Beras', 'INV-FNB-001', 200, 'gr', 1, 'Per porsi'],
      ['Nasi Goreng Spesial', '', 'Telur Ayam', 'INV-FNB-003', 1, 'pcs', 1, 'Per porsi'],
      ['Nasi Goreng Spesial', '', 'Minyak Goreng', 'INV-FNB-004', 15, 'ml', 1, 'Per porsi'],

      // ── F&B: Mie Ayam Bakso (varian) ──
      ['Mie Ayam', 'Mie Ayam Bakso', 'Telur Ayam', 'INV-FNB-003', 1, 'pcs', 1, ''],
      ['Mie Ayam', 'Mie Ayam Bakso', 'Beras', 'INV-FNB-001', 50, 'gr', 1, 'Pangsit isi'],

      // ── Percetakan: Brosur A5 (yield per batch) ──
      ['Cetak Brosur A5', '', 'Kertas HVS A5', 'INV-PCT-001', 100, 'pcs', 100, '1 rim → 100 lembar jadi'],
      ['Cetak Brosur A5', '', 'Tinta Cetak', 'INV-PCT-004', 20, 'ml', 100, '100 lembar butuh ~20ml tinta'],

      // ── Percetakan: Undangan (varian Bronze) ──
      ['Undangan Pernikahan', 'Bronze (100 pcs)', 'Kertas Art Carton', 'INV-PCT-002', 100, 'pcs', 100, ''],
      ['Undangan Pernikahan', 'Bronze (100 pcs)', 'Plastik Undangan', 'INV-PCT-005', 100, 'pcs', 100, ''],
      ['Undangan Pernikahan', 'Bronze (100 pcs)', 'Amplop Undangan', 'INV-PCT-006', 100, 'pcs', 100, ''],

      // ── Fashion: Kaos Polos (yield per batch) ──
      ['Kaos Polos Cotton 30s', '', 'Kain Katun Combed 30s', 'INV-FSH-001', 2, 'meter', 10, '2m kain → 10 kaos'],
      ['Kaos Polos Cotton 30s', '', 'Benang Jahit Poly', 'INV-FSH-002', 1, 'roll', 10, '1 roll → 10 kaos'],
      ['Kaos Polos Cotton 30s', '', 'Label Woven', 'INV-FSH-006', 10, 'pcs', 10, '10 label → 10 kaos'],

      // ── Bangunan: Campuran Cor (yield per batch) ──
      ['Campuran Cor 1 Sak Semen', '', 'Semen Portland 50kg', 'INV-BNG-001', 1, 'sak', 0.15, '1 sak → 0.15 m3 cor'],
      ['Campuran Cor 1 Sak Semen', '', 'Pasir Cor', 'INV-BNG-002', 0.06, 'm3', 0.15, ''],
      ['Campuran Cor 1 Sak Semen', '', 'Kerikil / Split', 'INV-BNG-003', 0.08, 'm3', 0.15, ''],

      // ── Pertanian: Pupuk NPK Repackaging (yield per batch) ──
      ['Pupuk NPK 1kg', '', 'Pupuk NPK Granul', 'INV-AGB-001', 1, 'kg', 1, 'Repack dari karung 50kg'],
    ]

    const wsComposition = XLSX.utils.aoa_to_sheet([compositionHeader, ...compositionData])
    wsComposition['!cols'] = [
      { wch: 30 }, { wch: 30 }, { wch: 28 }, { wch: 20 },
      { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 35 },
    ]

    XLSX.utils.book_append_sheet(wb, wsComposition, 'Komposisi (Resep BOM)')

    // ============================================================
    // SHEET 5: Panduan Import — Universal
    // ============================================================
    const guideData = [
      ['TEMPLATE MIGRASI — AETHER POS'],
      [''],
      ['Template ini dirancang universal untuk semua lini bisnis:'],
      [''],
      ['  F&B & Kuliner          │  Retail & Minimarket    │  Beauty & Kecantikan'],
      ['  Fashion & Pakaian      │  Jasa & Layanan        │  Percetakan & Desain'],
      ['  Farmasi & Kesehatan    │  Elektronik & Gadget   │  Bangunan & Material'],
      ['  Pertanian & Agrobisnis│  Manufactur & Produksi │  Dan industri lainnya'],
      [''],
      ['Fitur template:'],
      ['  ✓ Produk Non-Varian (langsung jual)'],
      ['  ✓ Produk Varian (ukuran, rasa, shade, tipe, level, dll)'],
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
      ['NAMA PRODUK*', 'Nama produk / item', 'Nasi Goreng / Charger HP / Semen 50kg', 'Ya'],
      ['SKU', 'Kode unik (auto-generate jika kosong)', 'SKU-001', 'Tidak'],
      ['BARCODE', 'Barcode untuk scan (auto dari SKU)', '8991001001', 'Tidak'],
      ['HPP / MODAL (Rp)', 'Harga pokok per unit', '10000', 'Tidak'],
      ['HARGA JUAL* (Rp)', 'Harga jual ke customer', '25000', 'Ya'],
      ['STOK AWAL', 'Jumlah stok saat ini', '50', 'Tidak'],
      ['SATUAN', 'Unit produk (sesuai industri)', 'pcs / porsi / kg / sak / botol', 'Tidak'],
      ['KATEGORI', 'Nama kategori (auto-create)', 'Makanan / Aksesoris HP / Semen', 'Tidak'],
      ['LOW STOCK ALERT', 'Batas peringatan stok rendah', '10', 'Tidak'],
      ['KOMPOSISI INLINE', 'Resep/bahan langsung di kolom', 'Kain:2m,Benang:1roll', 'Tidak'],
      [''],
      ['FORMAT KOMPOSISI INLINE:'],
      ['  NamaBahan:qtySatuan,NamaBahan:qtySatuan'],
      ['  Contoh F&B:      Nasi:200gr,Telur:1pcs,Minyak:15ml'],
      ['  Contoh Percetakan: Kertas A5:1pcs,Tinta:2ml'],
      ['  Contoh Fashion:   Kain Katun:2m,Benang:1roll,Label:1pcs'],
      ['  Contoh Bangunan:  Semen:1sak,Pasir:0.06m3,Kerikil:0.08m3'],
      [''],
      ['═'.repeat(70)],
      ['SHEET 2: PRODUK VARIAN'],
      ['═'.repeat(70)],
      [''],
      ['Untuk produk yang punya varian. Baris pertama = produk induk.'],
      ['Baris dengan NAMA PRODUK kosong = varian dari induk terakhir.'],
      [''],
      ['CONTOH VARIAN PER INDUSTRI:'],
      ['  F&B:        Kopi Susu → Small 200ml / Regular 300ml / Large 400ml'],
      ['  Fashion:    Kaos Polos → S / M / L / XL'],
      ['  Beauty:     Bedak Tabur → Natural / Warm / Cool'],
      ['  Elektronik: Casing HP → iPhone 15 / Samsung S24 / Xiaomi 14'],
      ['  Percetakan: Undangan → Bronze (100 pcs) / Silver (100 pcs) / Gold (100 pcs)'],
      ['  F&B:        Mie Ayam → Biasa / Bakso / Pangsit'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'WAJIB?'],
      ['NAMA PRODUK*', 'Produk induk (isi baris pertama saja)', 'Ya'],
      ['SKU PRODUK', 'SKU produk induk', 'Tidak'],
      ['HARGA JUAL PRODUK*', 'Harga default', 'Ya'],
      ['KATEGORI', 'Kategori (isi baris pertama saja)', 'Tidak'],
      ['NAMA VARIAN*', 'Nama varian', 'Ya'],
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
      ['CONTOH BAHAN BAKU PER INDUSTRI:'],
      ['  F&B:        Beras, Daging Ayam, Telur, Minyak Goreng, Gula Pasir'],
      ['  Percetakan: Kertas HVS, Art Carton, Bahan Stiker, Tinta Cetak'],
      ['  Fashion:    Kain Katun, Benang Jahit, Resleting YKK, Kain Denim'],
      ['  Bangunan:   Semen Portland, Pasir Cor, Kerikil, Besi Beton'],
      ['  Pertanian:  Pupuk NPK, Benih Padi, Pestisida, Mulsa Plastik'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'WAJIB?'],
      ['NAMA BAHAN*', 'Nama bahan baku', 'Ya'],
      ['SKU', 'Kode SKU', 'Tidak'],
      ['SATUAN DASAR*', 'Unit dasar', 'Ya'],
      ['STOK AWAL', 'Stok saat ini', 'Tidak'],
      ['HPP RATA-RATA (Rp)', 'Harga pokok rata-rata per unit', 'Tidak'],
      ['KATEGORI INVENTORY', 'Kategori bahan', 'Tidak'],
      ['LOW STOCK ALERT', 'Batas peringatan', 'Tidak'],
      ['DIGUNAKAN DI PRODUK', 'List produk (opsional)', 'Tidak'],
      [''],
      ['═'.repeat(70)],
      ['SHEET 4: KOMPOSISI / RESEP (BOM DETAIL)'],
      ['═'.repeat(70)],
      [''],
      ['Untuk resep/BOM yang kompleks — misal 1 sak semen menghasilkan 0.15m3 cor,'],
      ['atau 2 meter kain menghasilkan 10 kaos.'],
      [''],
      ['CONTOH BOM PER INDUSTRI:'],
      ['  F&B:        Nasi Goreng → Beras 200gr + Telur 1pcs + Minyak 15ml (yield 1 porsi)'],
      ['  Percetakan: Brosur A5 → Kertas 100pcs + Tinta 20ml (yield 100 lembar)'],
      ['  Fashion:    Kaos → Kain 2m + Benang 1roll + Label 10pcs (yield 10 kaos)'],
      ['  Bangunan:   Cor → Semen 1sak + Pasir 0.06m3 + Kerikil 0.08m3 (yield 0.15m3)'],
      ['  Pertanian:  Pupuk Repack → NPK Granul 1kg (yield 1 paket)'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'WAJIB?'],
      ['NAMA PRODUK*', 'Nama produk (harus cocok)', 'Ya'],
      ['NAMA VARIAN', 'Kosongkan jika non-varian', 'Tidak'],
      ['NAMA BAHAN*', 'Nama bahan (harus cocok)', 'Ya'],
      ['SKU BAHAN', 'SKU bahan (opsional)', 'Tidak'],
      ['QTY PER BATCH*', 'Jumlah bahan per batch', 'Ya'],
      ['SATUAN BAHAN', 'Satuan bahan', 'Ya'],
      ['YIELD PER BATCH', 'Hasil per batch (default: 1)', 'Tidak'],
      ['CATATAN', 'Catatan tambahan', 'Tidak'],
      [''],
      ['CARA KERJA YIELD:'],
      ['  Fashion:  2m kain + 1 roll benih + 10 label → 10 kaos'],
      ['  → QTY kain = 2 (meter), Yield = 10 → 1 kaos butuh 0.2m kain'],
      [''],
      ['═'.repeat(70)],
      ['MODE IMPORT'],
      ['═'.repeat(70)],
      [''],
      ['1. BUAT PRODUK SAJA (sheet Produk Non-Varian & Varian saja)'],
      ['   → Product + Varian dibuat, tanpa inventory'],
      ['   → Cocok untuk:'],
      ['     • Retail / Minimarket — jual langsung tanpa perlu tracking bahan'],
      ['     • Jasa / Layanan — cuci motor, potong rambut, laundry, dll'],
      ['     • Farmasi / Kesehatan — jual obat-obatan jadi'],
      ['     • Elektronik / Gadget — jual HP, charger, aksesoris'],
      ['     • Fashion tanpa produksi sendiri — jual barang jadi dari supplier'],
      ['     • F&B tanpa tracking resep — menu tanpa perlu hitung HPP detail'],
      [''],
      ['2. BUAT PRODUK + INVENTORY (semua sheet diproses)'],
      ['   → Product + Varian + InventoryItem + Komposisi + Opening Balance'],
      ['   → Cocok untuk:'],
      ['     • F&B dengan resep — kafe, restoran, catering yang perlu hitung HPP'],
      ['     • Percetakan — perlu track kertas, tinta, bahan cetak'],
      ['     • Fashion produksi sendiri — konveksi, butik yang jahit sendiri'],
      ['     • Bangunan / Konstruksi — track material bangunan'],
      ['     • Pertanian — track pupuk, benih, pestisida'],
      ['     • Manufactur / Produksi — industri yang mengolah bahan jadi produk'],
      [''],
      ['═'.repeat(70)],
      ['TIPS PER INDUSTRI'],
      ['═'.repeat(70)],
      [''],
      ['F&B & KULINER:'],
      ['  • Isi komposisi untuk tracking bahan baku & perhitungan HPP otomatis'],
      ['  • Gunakan satuan: porsi, gelas, mangkuk, cup, botol'],
      ['  • Untuk menu dengan varian rasa/ukuran, gunakan sheet "Produk Varian"'],
      [''],
      ['RETAIL / MINIMARKET:'],
      ['  • Mode "Produk Saja" sudah cukup, tidak perlu inventory bahan baku'],
      ['  • Gunakan barcode untuk scan cepat di kasir'],
      ['  • Satuan umum: pcs, pack, dus, box, liter'],
      [''],
      ['BEAUTY / KECANTIKAN:'],
      ['  • Varian shade (Natural, Warm, Cool) atau ukuran (15ml, 30ml, 50ml)'],
      ['  • Jika produksi sendiri, gunakan mode "Produk + Inventory"'],
      ['  • Jika jual barang jadi, mode "Produk Saja" cukup'],
      [''],
      ['JASA / LAYANAN:'],
      ['  • Stok awal isi 999 (tidak terbatas) atau sesuai kapasitas harian'],
      ['  • HPP isi biaya operasional (misal: shampo cuci motor Rp5.000)'],
      ['  • Barcode bisa dikosongkan (jasa tidak di-scan)'],
      [''],
      ['PERCETAKAN & DESAIN:'],
      ['  • Gunakan mode "Produk + Inventory" untuk track kertas & tinta'],
      ['  • Varian bisa berupa paket (Bronze, Silver, Gold) atau ukuran cetak'],
      ['  • Manfaatkan Yield Per Batch untuk efisiensi material'],
      [''],
      ['FASHION / PAKAIAN:'],
      ['  • Varian ukuran: S, M, L, XL, XXL'],
      ['  • Jika konveksi, gunakan mode "Produk + Inventory" untuk track kain'],
      ['  • Jika jual barang jadi, mode "Produk Saja" sudah cukup'],
      [''],
      ['FARMASI & KESEHATAN:'],
      ['  • Gunakan satuan: strip, tablet, botol, tube, box'],
      ['  • Isi barcode untuk scan obat di apotek'],
      ['  • Low stock alert penting untuk obat-obatan vital'],
      [''],
      ['ELEKTRONIK & GADGET:'],
      ['  • Varian tipe: iPhone, Samsung, Xiaomi (untuk aksesoris)'],
      ['  • Barcode wajib diisi untuk scan di kasir'],
      ['  • Gunakan kategori yang spesifik: Aksesoris HP, Audio, Charger, dll'],
      [''],
      ['BANGUNAN & MATERIAL:'],
      ['  • Gunakan mode "Produk + Inventory" untuk track material proyek'],
      ['  • Satuan khusus: sak (semen), batang (besi), m3 (pasir/kerikil)'],
      ['  • Manfaatkan komposisi untuk campuran (cor, adukan) dengan yield'],
      [''],
      ['PERTANIAN & AGROBISNIS:'],
      ['  • Gunakan mode "Produk + Inventory" untuk track input pertanian'],
      ['  • Satuan umum: kg, liter, botol, roll (mulsa)'],
      ['  • Repackaging (karung → kemasan kecil) bisa pakai komposisi + yield'],
      [''],
      ['═'.repeat(70)],
      ['CATATAN UMUM'],
      ['═'.repeat(70)],
      [''],
      ['• Kolom bertanda * wajib diisi'],
      ['• Maksimal 5000 baris per sheet'],
      ['• Produk duplikat (nama sama) akan dilewati (skip)'],
      ['• Kategori baru otomatis dibuat'],
      ['• SKU & Barcode auto-generate jika dikosongkan'],
      ['• Harga format: 25000 atau Rp25.000 atau 25.000'],
      ['• Komposisi inline & detail bisa digunakan bersamaan'],
      ['• Import bisa diulang dengan aman (skip duplikat)'],
      ['• Bahan baku di komposisi harus sudah ada di sheet Inventory ATAU auto-create'],
      ['• Ganti/hapus contoh data dengan data asli Anda sebelum import'],
    ]

    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [
      { wch: 35 },
      { wch: 70 },
      { wch: 45 },
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
    return safeJsonError('Gagal mengunduh template', 500)
  }
}