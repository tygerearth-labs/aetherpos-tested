import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { safeJsonError } from '@/lib/api/safe-response'

type TemplateMode = 'product_only' | 'product_stock' | 'product_inventory'

export async function GET(request: NextRequest) {
  try {
    const mode = (request.nextUrl.searchParams.get('mode') || 'product_stock') as TemplateMode
    
    // Validate mode parameter
    const validModes: TemplateMode[] = ['product_only', 'product_stock', 'product_inventory']
    if (!validModes.includes(mode)) {
      console.error('[Migration Template] Invalid mode:', mode)
      return safeJsonError('Mode tidak valid. Gunakan product_only, product_stock, atau product_inventory', 400)
    }
    
    console.log('[Migration Template] Generating template for mode:', mode)
    
    const wb = XLSX.utils.book_new()

    const showStock = mode === 'product_stock' || mode === 'product_inventory'
    const showComposition = mode === 'product_inventory'

    // ============================================================
    // SHEET 1: Produk Non-Varian
    // ============================================================
    const nonVariantHeader = [
      'NAMA PRODUK*',
      'SKU',
      'BARCODE',
      'HPP / MODAL (Rp)',
      'HARGA JUAL* (Rp)',
      ...(showStock ? ['STOK AWAL'] : []),
      'SATUAN',
      'KATEGORI',
      ...(showStock ? ['LOW STOCK ALERT'] : []),
      ...(showComposition ? ['KOMPOSISI INLINE (Opsional)'] : []),
    ]

    const nonVariantData: (string | number)[][] = [
      // ════════════════════════════════════════════════════════
      // MODE 2: PRODUK + STOK GUDANG (1:1)
      // Untuk: Ritel, Fashion, Beauty, Kelontong, Elektronik, dll
      // Stok = Produk yang dijual (Auto-linked 1:1)
      // ════════════════════════════════════════════════════════

      // ── TOKO KELONTONG / MINIMARKET ──
      ['Aqua 600ml', 'KL-001', '8992775100219', 2000, 3500, ...(showStock ? [240] : []), 'pcs', 'Minuman', ...(showStock ? [48] : []), ...(showComposition ? [''] : [])],
      ['Indomie Goreng Special', 'KL-002', '8996001100103', 1450, 3000, ...(showStock ? [500] : []), 'pcs', 'Mie Instan', ...(showStock ? [100] : []), ...(showComposition ? [''] : [])],
      ['Minyak Goreng Bimoli 2L', 'KL-003', '8999999010123', 22000, 28000, ...(showStock ? [72] : []), 'pcs', 'Sembako', ...(showStock ? [15] : []), ...(showComposition ? [''] : [])],
      ['Beras Premium 5kg', 'KL-004', '', 65000, 75000, ...(showStock ? [40] : []), 'karung', 'Sembako', ...(showStock ? [8] : []), ...(showComposition ? [''] : [])],
      ['Gula Pasir 1kg', 'KL-005', '', 14000, 16500, ...(showStock ? [100] : []), 'pcs', 'Sembako', ...(showStock ? [25] : []), ...(showComposition ? [''] : [])],
      ['Kecap Manis Bango 275ml', 'KL-006', '8999999022345', 8500, 12000, ...(showStock ? [80] : []), 'botol', 'Bumbu Dapur', ...(showStock ? [20] : []), ...(showComposition ? [''] : [])],
      ['Tisu Supreme 250gr', 'KL-007', '8991100111223', 5500, 8500, ...(showStock ? [60] : []), 'pcs', 'Kebersihan', ...(showStock ? [15] : []), ...(showComposition ? [''] : [])],
      ['Sabun Mandi Lifebuoy 250ml', 'KL-008', '8999999034567', 4500, 7000, ...(showStock ? [120] : []), 'pcs', 'Kebersihan', ...(showStock ? [30] : []), ...(showComposition ? [''] : [])],

      // ── FASHION & PAKAIAN ──
      ['Kaos Polos Cotton Combed 30s', 'FSH-001', '', 35000, 55000, ...(showStock ? [80] : []), 'pcs', 'Atasan', ...(showStock ? [16] : []), ...(showComposition ? [''] : [])],
      ['Kemeja Flanel Unisex', 'FSH-002', '', 85000, 135000, ...(showStock ? [35] : []), 'pcs', 'Atasan', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],
      ['Celana Jeans Slim Fit', 'FSH-003', '', 125000, 195000, ...(showStock ? [25] : []), 'pcs', 'Bawahan', ...(showStock ? [8] : []), ...(showComposition ? [''] : [])],
      ['Hijab Segi Empat 45x115cm', 'FSH-004', '', 18000, 32000, ...(showStock ? [150] : []), 'pcs', 'Hijab', ...(showStock ? [30] : []), ...(showComposition ? [''] : [])],
      ['Pashmina Voal Motif', 'FSH-005', '', 45000, 75000, ...(showStock ? [45] : []), 'pcs', 'Hijab', ...(showStock ? [12] : []), ...(showComposition ? [''] : [])],
      ['Gamis Katun Jepang', 'FSH-006', '', 185000, 285000, ...(showStock ? [18] : []), 'pcs', 'Dress/Gamis', ...(showStock ? [5] : []), ...(showComposition ? [''] : [])],
      ['Jaket Bomber Waterproof', 'FSH-007', '', 165000, 255000, ...(showStock ? [22] : []), 'pcs', 'Outerwear', ...(showStock ? [6] : []), ...(showComposition ? [''] : [])],
      ['Tas Selempang Canvas', 'FSH-008', '', 75000, 125000, ...(showStock ? [40] : []), 'pcs', 'Tas/Aksesoris', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],
      ['Dompet Kulit Pria', 'FSH-009', '', 55000, 95000, ...(showStock ? [30] : []), 'pcs', 'Tas/Aksesoris', ...(showStock ? [8] : []), ...(showComposition ? [''] : [])],

      // ── BEAUTY & SKINCARE ──
      ['Wardah Lightening Day Cream', 'BTY-001', '8999999011001', 42000, 68000, ...(showStock ? [55] : []), 'pcs', 'Skincare Wajah', ...(showStock ? [14] : []), ...(showComposition ? [''] : [])],
      ['Serum Niacinamide 30ml', 'BTY-002', '', 85000, 145000, ...(showStock ? [38] : []), 'pcs', 'Serum', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],
      ['Sunscreen SPF50 PA++++ 50ml', 'BTY-003', '', 65000, 105000, ...(showStock ? [42] : []), 'pcs', 'Sun Care', ...(showStock ? [12] : []), ...(showComposition ? [''] : [])],
      ['Lip Matte Creamy', 'BTY-004', '', 48000, 78000, ...(showStock ? [65] : []), 'pcs', 'Makeup Bibir', ...(showStock ? [16] : []), ...(showComposition ? [''] : [])],
      ['Cushion Foundation Natural', 'BTY-005', '', 155000, 225000, ...(showStock ? [28] : []), 'pcs', 'Makeup Base', ...(showStock ? [8] : []), ...(showComposition ? [''] : [])],
      ['Bedak Tabur Two Way Cake', 'BTY-006', '', 72000, 115000, ...(showStock ? [48] : []), 'pcs', 'Makeup Wajah', ...(showStock ? [12] : []), ...(showComposition ? [''] : [])],
      ['Parfum Eau De Parfum 100ml', 'BTY-007', '', 185000, 295000, ...(showStock ? [32] : []), 'botol', 'Parfum', ...(showStock ? [8] : []), ...(showComposition ? [''] : [])],
      ['Eyeshadow Palette Nude', 'BTY-008', '', 125000, 195000, ...(showStock ? [24] : []), 'pcs', 'Makeup Mata', ...(showStock ? [6] : []), ...(showComposition ? [''] : [])],

      // ── ELEKTRONIK & GADGET ──
      ['Charger Fast Charging 20W', 'ELK-001', '', 18000, 35000, ...(showStock ? [65] : []), 'pcs', 'Charger', ...(showStock ? [13] : []), ...(showComposition ? [''] : [])],
      ['Kabel Data USB-C 1.2m', 'ELK-002', '', 12000, 23000, ...(showStock ? [95] : []), 'pcs', 'Kabel', ...(showStock ? [19] : []), ...(showComposition ? [''] : [])],
      ['Powerbank 10000mAh', 'ELK-003', '', 95000, 165000, ...(showStock ? [42] : []), 'pcs', 'Powerbank', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],
      ['Earphone Bluetooth TWS', 'ELK-004', '', 145000, 245000, ...(showStock ? [35] : []), 'pcs', 'Audio', ...(showStock ? [8] : []), ...(showComposition ? [''] : [])],
      ['Casing HP iPhone 15 Pro', 'ELK-005', '', 25000, 45000, ...(showStock ? [55] : []), 'pcs', 'Casing HP', ...(showStock ? [11] : []), ...(showComposition ? [''] : [])],
      ['Casing HP Samsung S24 Ultra', 'ELK-006', '', 25000, 45000, ...(showStock ? [48] : []), 'pcs', 'Casing HP', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],
      ['Ring Stand Phone Holder', 'ELK-007', '', 8000, 18000, ...(showStock ? [78] : []), 'pcs', 'Aksesoris HP', ...(showStock ? [16] : []), ...(showComposition ? [''] : [])],
      ['Screen Protector Tempered Glass', 'ELK-008', '', 5000, 12000, ...(showStock ? [120] : []), 'pcs', 'Screen Guard', ...(showStock ? [24] : []), ...(showComposition ? [''] : [])],

      // ── FARMASI & KESEHATAN ──
      ['Paracetamol 500mg 10 kaplet', 'FRM-001', '', 1200, 3000, ...(showStock ? [300] : []), 'strip', 'Obat Sakit Kepala', ...(showStock ? [75] : []), ...(showComposition ? [''] : [])],
      ['Vitamin C 1000mg 10 tablet', 'FRM-002', '', 3500, 8000, ...(showStock ? [180] : []), 'strip', 'Vitamin', ...(showStock ? [36] : []), ...(showComposition ? [''] : [])],
      ['Masker Medis 3ply 1 box', 'FRM-003', '', 25000, 45000, ...(showStock ? [60] : []), 'box', 'Alat Kesehatan', ...(showStock ? [12] : []), ...(showComposition ? [''] : [])],
      ['Hand Sanitizer 500ml', 'FRM-004', '', 18000, 28000, ...(showStock ? [85] : []), 'botol', 'Sanitizer', ...(showStock ? [17] : []), ...(showComposition ? [''] : [])],
      ['OBH Combat 120ml', 'FRM-005', '', 22000, 35000, ...(showStock ? [70] : []), 'botol', 'Obat Batuk', ...(showStock ? [14] : []), ...(showComposition ? [''] : [])],
      ['Antiseptic Betadine 100ml', 'FRM-006', '', 38000, 52000, ...(showStock ? [45] : []), 'botol', 'Luka', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],

      // ── F&B JUAL LANGSUNG (Cafe/Warung) ──
      ['Kopi Susu Gula Aren', 'FNB-001', '', 6500, 18000, ...(showStock ? [0] : []), 'gelas', 'Minuman', ...(showStock ? [0] : []), ...(showComposition ? [''] : [])],
      ['Es Teh Tarik', 'FNB-002', '', 4000, 10000, ...(showStock ? [0] : []), 'gelas', 'Minuman', ...(showStock ? [0] : []), ...(showComposition ? [''] : [])],
      ['Nasi Goreng Spesial', 'FNB-003', '', 10000, 22000, ...(showStock ? [0] : []), 'porsi', 'Makanan', ...(showStock ? [0] : []), ...(showComposition ? [''] : [])],
      ['Mie Ayam Bakso', 'FNB-004', '', 12000, 20000, ...(showStock ? [0] : []), 'porsi', 'Makanan', ...(showStock ? [0] : []), ...(showComposition ? [''] : [])],
      ['Roti Bakar Coklat Keju', 'FNB-005', '', 8000, 16000, ...(showStock ? [0] : []), 'pcs', 'Snack', ...(showStock ? [0] : []), ...(showComposition ? [''] : [])],

      // ── Mode 3 examples (with composition) ──
      ...(showComposition ? [
        ['Nasi Goreng Spesial', 'FNB-R-001', '8991001101', 10000, 25000, 50, 'porsi', 'Makanan', 10, 'Beras:200gr,Telur:1pcs,Minyak:15ml'],
        ['Ayam Geprek', 'FNB-R-002', '8991001102', 12000, 20000, 30, 'porsi', 'Makanan', 5, 'Daging Ayam:150gr,Tepung:50gr,Minyak:20ml'],
        ['Semen 50kg', 'BNG-001', '8997001001', 55000, 65000, 100, 'sak', 'Semen', 20, ''],
        ['Cat Tembok 5L', 'BNG-002', '8997001002', 75000, 95000, 30, 'pcs', 'Cat', 5, ''],
      ] : []),
    ]

    const wsNonVariant = XLSX.utils.aoa_to_sheet([nonVariantHeader, ...nonVariantData])
    wsNonVariant['!cols'] = [
      { wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 20 },
      { wch: 22 },
      ...(showStock ? [{ wch: 14 }] : []),
      { wch: 12 }, { wch: 22 },
      ...(showStock ? [{ wch: 16 }] : []),
      ...(showComposition ? [{ wch: 55 }] : []),
    ]

    const satuanCol = showStock ? 'G' : 'F'

    wsNonVariant['!dataValidation'] = [{
      type: 'list',
      allowBlank: true,
      sqref: `${satuanCol}2:${satuanCol}5000`,
      formulas: ['"pcs,ml,lt,gr,kg,box,pack,botol,gelas,mangkuk,porsi,bungkus,sachet,dus,rim,lembar,meter,cm,ons,roll,strip,ekor,sak,batang"'],
    }]

    XLSX.utils.book_append_sheet(wb, wsNonVariant, 'Produk Non-Varian')

    // ============================================================
    // SHEET 2: Produk Varian
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
      ...(showStock ? ['STOK AWAL VARIAN'] : []),
      ...(showComposition ? ['KOMPOSISI VARIAN INLINE (Opsional)'] : []),
    ]

    const variantData: (string | number)[][] = [
      // ════════════════════════════════════════════════════════
      // CONTOH VARIAN UNTUK BISNIS RITEL 1:1
      // Setiap varian punya stok sendiri (auto-linked ke gudang)
      // ════════════════════════════════════════════════════════

      // ── FASHION: Kaos dengan Ukuran S/M/L/XL ──
      ['Kaos Polos Cotton Combed', 'VAR-FSH-001', '', 0, 55000, 'Atasan', 'Size S', 'VAR-FSH-001-S', '', 35000, 55000, ...(showStock ? [20] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Size M', 'VAR-FSH-001-M', '', 35000, 55000, ...(showStock ? [25] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Size L', 'VAR-FSH-001-L', '', 35000, 55000, ...(showStock ? [22] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Size XL', 'VAR-FSH-001-XL', '', 38000, 58000, ...(showStock ? [15] : []), ...(showComposition ? [''] : [])],

      // ── FASHION: Celana Jeans dengan Ukuran & Warna ──
      ['Celana Jeans Slim Fit Pria', 'VAR-FSH-002', '', 0, 195000, 'Bawahan', '28 Hitam', 'VAR-FSH-002-28H', '', 125000, 195000, ...(showStock ? [12] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '30 Biru Tua', 'VAR-FSH-002-30B', '', 125000, 195000, ...(showStock ? [15] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '32 Biru Muda', 'VAR-FSH-002-32BM', '', 125000, 195000, ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '34 Hitam', 'VAR-FSH-002-34H', '', 130000, 200000, ...(showStock ? [8] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '36 Biru Tua', 'VAR-FSH-002-36B', '', 130000, 200000, ...(showStock ? [6] : []), ...(showComposition ? [''] : [])],

      // ── BEAUTY: Bedak/Foundation dengan Shade ──
      ['Cushion Foundation', 'VAR-BTY-001', '', 0, 225000, 'Makeup Base', 'Shade 10 Light', 'VAR-BTY-001-10', '', 155000, 225000, ...(showStock ? [18] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Shade 20 Warm', 'VAR-BTY-001-20', '', 155000, 225000, ...(showStock ? [15] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Shade 30 Natural', 'VAR-BTY-001-30', '', 155000, 225000, ...(showStock ? [12] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Shade 40 Sand', 'VAR-BTY-001-40', '', 155000, 225000, ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],

      // ── BEAUTY: Lip Cream dengan Warna ──
      ['Lip Matte Creamy', 'VAR-BTY-002', '', 0, 78000, 'Makeup Bibir', 'Cherry Red', 'VAR-BTY-002-CR', '', 48000, 78000, ...(showStock ? [25] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Coral Pink', 'VAR-BTY-002-CP', '', 48000, 78000, ...(showStock ? [30] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Nude Brown', 'VAR-BTY-002-NB', '', 48000, 78000, ...(showStock ? [28] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Mauve Dusty', 'VAR-BTY-002-MD', '', 48000, 78000, ...(showStock ? [22] : []), ...(showComposition ? [''] : [])],

      // ── ELEKTRONIK: Casing HP per Model ──
      ['Casing Silicone Premium', 'VAR-ELK-001', '', 0, 45000, 'Casing HP', 'iPhone 15 Pro', 'VAR-ELK-001-I15P', '', 25000, 45000, ...(showStock ? [35] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'iPhone 14 Pro', 'VAR-ELK-001-I14P', '', 25000, 45000, ...(showStock ? [28] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Samsung S24 Ultra', 'VAR-ELK-001-S24U', '', 25000, 45000, ...(showStock ? [32] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Samsung A54', 'VAR-ELK-001-A54', '', 25000, 45000, ...(showStock ? [25] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Xiaomi 14', 'VAR-ELK-001-X14', '', 25000, 45000, ...(showStock ? [20] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'OPPO Find X5', 'VAR-ELK-001-OFX5', '', 25000, 45000, ...(showStock ? [18] : []), ...(showComposition ? [''] : [])],

      // ── ELEKTRONIK: Charger dengan Kapasitas ──
      ['Fast Charging Adapter', 'VAR-ELK-002', '', 0, 35000, 'Charger', '20W Single Port', 'VAR-ELK-002-20W', '', 18000, 35000, ...(showStock ? [40] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '30W Dual Port', 'VAR-ELK-002-30W', '', 28000, 48000, ...(showStock ? [32] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '65W GaN', 'VAR-ELK-002-65W', '', 65000, 95000, ...(showStock ? [18] : []), ...(showComposition ? [''] : [])],

      // ── FARMASI: Vitamin dengan Varian ──
      ['Vitamin C Supplement', 'VAR-FRM-001', '', 0, 8000, 'Vitamin', '500mg Tablet', 'VAR-FRM-001-T', '', 3500, 8000, ...(showStock ? [100] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '1000mg Tablet', 'VAR-FRM-001-T1', '', 5500, 12000, ...(showStock ? [80] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '1000mg Effervescent', 'VAR-FRM-001-E', '', 7500, 15000, ...(showStock ? [60] : []), ...(showComposition ? [''] : [])],

      // ── KELONTONG: Minyak Goreng dengan Ukuran ──
      ['Minyak Goreng Bimoli', 'VAR-KL-001', '', 0, 28000, 'Sembako', '1 Liter', 'VAR-KL-001-1L', '', 22000, 28000, ...(showStock ? [50] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '2 Liter', 'VAR-KL-001-2L', '', 42000, 52000, ...(showStock ? [35] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', '5 Liter', 'VAR-KL-001-5L', '', 95000, 115000, ...(showStock ? [18] : []), ...(showComposition ? [''] : [])],
    ]

    const wsVariant = XLSX.utils.aoa_to_sheet([variantHeader, ...variantData])
    wsVariant['!cols'] = [
      { wch: 25 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
      { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 20 },
      { wch: 18 }, { wch: 18 }, { wch: 22 },
      ...(showStock ? [{ wch: 18 }] : []),
      ...(showComposition ? [{ wch: 55 }] : []),
    ]

    XLSX.utils.book_append_sheet(wb, wsVariant, 'Produk Varian')

    // ============================================================
    // SHEET 3: Bahan Baku (HANYA Mode 3)
    // ============================================================
    if (showComposition) {
      const inventoryHeader = [
        'NAMA ITEM*',
        'SKU',
        'SATUAN DASAR*',
        'STOK AWAL',
        'HPP RATA-RATA (Rp)',
        'KATEGORI',
        'LOW STOCK ALERT',
        'TERHUBUNG DENGAN PRODUK (Opsional — koma-separated)',
      ]

      const inventoryData = [
        ['Beras', 'INV-FNB-001', 'kg', 50, 12000, 'Bahan Pokok', 10, 'Nasi Goreng Spesial,Mie Ayam'],
        ['Daging Ayam Dada', 'INV-FNB-002', 'kg', 20, 35000, 'Protein', 5, 'Ayam Geprek'],
        ['Telur Ayam', 'INV-FNB-003', 'pcs', 200, 2500, 'Protein', 20, 'Mie Ayam'],
        ['Minyak Goreng', 'INV-FNB-004', 'lt', 10, 18000, 'Bahan Pokok', 3, 'Nasi Goreng Spesial,Ayam Geprek'],
        ['Teh Celup', 'INV-FNB-005', 'pcs', 500, 1500, 'Minuman', 50, 'Es Teh Manis'],
        ['Gula Pasir', 'INV-FNB-006', 'kg', 25, 14000, 'Bahan Pokok', 5, 'Es Teh Manis'],
        ['Tepung Terigu', 'INV-FNB-007', 'kg', 30, 10000, 'Bahan Pokok', 5, 'Ayam Geprek'],
        ['Kertas HVS A5', 'INV-PCT-001', 'pcs', 2000, 300, 'Bahan Cetak', 200, 'Cetak Brosur A5'],
        ['Tinta Cetak', 'INV-PCT-003', 'ml', 5000, 15, 'Bahan Cetak', 500, 'Cetak Brosur A5'],
        ['Kain Katun Combed 30s', 'INV-FSH-001', 'meter', 200, 25000, 'Bahan Kain', 20, 'Kaos Polos Cotton 30s'],
        ['Benang Jahit Poly', 'INV-FSH-002', 'roll', 100, 8000, 'Bahan Jahit', 15, 'Kaos Polos Cotton 30s'],
        ['Kain Denim 12oz', 'INV-FSH-004', 'meter', 100, 55000, 'Bahan Kain', 10, 'Celana Jeans Slim'],
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
      XLSX.utils.book_append_sheet(wb, wsInventory, 'Bahan Baku')
    }

    // ============================================================
    // SHEET 4: Komposisi / Resep BOM (HANYA Mode 3)
    // ============================================================
    if (showComposition) {
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
        ['Nasi Goreng Spesial', '', 'Beras', 'INV-FNB-001', 200, 'gr', 1, 'Per porsi'],
        ['Nasi Goreng Spesial', '', 'Telur Ayam', 'INV-FNB-003', 1, 'pcs', 1, 'Per porsi'],
        ['Nasi Goreng Spesial', '', 'Minyak Goreng', 'INV-FNB-004', 15, 'ml', 1, 'Per porsi'],
        ['Ayam Geprek', '', 'Daging Ayam Dada', 'INV-FNB-002', 150, 'gr', 1, 'Per porsi'],
        ['Ayam Geprek', '', 'Tepung Terigu', 'INV-FNB-007', 50, 'gr', 1, 'Per porsi'],
        ['Ayam Geprek', '', 'Minyak Goreng', 'INV-FNB-004', 20, 'ml', 1, 'Per porsi'],
        ['Cetak Brosur A5', '', 'Kertas HVS A5', 'INV-PCT-001', 100, 'pcs', 100, '1 rim → 100 lembar jadi'],
        ['Cetak Brosur A5', '', 'Tinta Cetak', 'INV-PCT-003', 20, 'ml', 100, '100 lembar butuh ~20ml tinta'],
        ['Kaos Polos Cotton 30s', '', 'Kain Katun Combed 30s', 'INV-FSH-001', 2, 'meter', 10, '2m kain → 10 kaos'],
        ['Kaos Polos Cotton 30s', '', 'Benang Jahit Poly', 'INV-FSH-002', 1, 'roll', 10, '1 roll → 10 kaos'],
      ]

      const wsComposition = XLSX.utils.aoa_to_sheet([compositionHeader, ...compositionData])
      wsComposition['!cols'] = [
        { wch: 30 }, { wch: 30 }, { wch: 28 }, { wch: 20 },
        { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 35 },
      ]
      XLSX.utils.book_append_sheet(wb, wsComposition, 'Komposisi (Resep BOM)')
    }

    // ============================================================
    // SHEET: Panduan Import (sesuai mode)
    // ============================================================
    const guideData = getGuideData(mode)
    const wsGuide = XLSX.utils.aoa_to_sheet(guideData)
    wsGuide['!cols'] = [{ wch: 35 }, { wch: 70 }, { wch: 45 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, wsGuide, 'Panduan Import')

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const modeLabel = mode === 'product_only' ? 'produk-saja' : mode === 'product_stock' ? 'produk-stok-gudang' : 'produk-bahan-baku-resep'

    console.log('[Migration Template] Template generated successfully for mode:', mode, 'size:', buffer.length)

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="template-migrasi-${modeLabel}.xlsx"`,
      },
    })
  } catch (error) {
    console.error('[Migration Template] Error generating template:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Gagal mengunduh template: ${message}`, 500)
  }
}

// ============================================================
// GUIDE CONTENT PER MODE
// ============================================================

function getGuideData(mode: TemplateMode): (string)[][] {
  const modeInfo = {
    product_only: { label: 'PRODUK SAJA', color: 'Mode 1', desc: 'Tanpa tracking stok' },
    product_stock: { label: 'PRODUK + STOK GUDANG', color: 'Mode 2', desc: 'Stok = produk yang dijual (Paling Umum)' },
    product_inventory: { label: 'PRODUK + KOMPOSISI', color: 'Mode 3', desc: 'Manufaktur / produksi dari bahan' },
  }[mode]

  const lines: string[][] = [
    [`TEMPLATE MIGRASI — AETHER POS`],
    [''],
    [`Mode Anda: ${modeInfo.label}`],
    [`${modeInfo.desc}`],
    [''],
    ['═'.repeat(70)],
    [`CARA ISI TEMPLATE INI (${modeInfo.color})`],
    ['═'.repeat(70)],
    [''],
  ]

  if (mode === 'product_only') {
    lines.push(
      ['Mode ini untuk bisnis yang TIDAK PERLU tracking stok.'],
      ['Produk langsung siap jual tanpa perlu mengisi stok.'],
      [''],
      ['CONTOH BISNIS:'],
      ['  • Jasa: Cuci motor, potong rambut, laundry, konsultasi'],
      ['  • F&B sederhana: Tanpa perlu hitung sisa stok'],
      [''],
      ['CARA ISI:'],
      ['  1. Sheet "Produk Non-Varian" — isi produk Anda'],
      ['  2. Sheet "Produk Varian" — jika ada varian (ukuran, rasa, dll)'],
      ['  3. Ganti contoh data dengan data asli Anda'],
      ['  4. Upload file ini di aplikasi'],
      [''],
    )
  }

  if (mode === 'product_stock') {
    lines.push(
      ['═══════════════════════════════════════════════════'],
      ['MODE 2: PRODUK + STOK GUDANG (1:1)'],
      ['Untuk Bisnis RITEL — Stok = Produk yang Dijual'],
      ['═══════════════════════════════════════════════════'],
      [''],
      ['Mode ini untuk bisnis RITEL di mana stok = produk yang dijual.'],
      ['Setiap produk OTOMATIS terhubung ke stok gudang (hubungan 1:1).'],
      ['Stok berkurang otomatis saat produk terjual di kasir/POS.'],
      ['Tidak perlu mengisi bahan baku atau resep — cukup produk + stok!'],
      [''],
      ['✦ CONTOH BISNIS YANG COCOK:'],
      [''],
      ['  🏪 TOKO KELONTONG / MINIMARKET'],
      ['     Aqua, Indomie, Minyak Goreng, Beras, Gula, Kecap, Tisu, Sabun'],
      [''],
      ['  👗 FASHION & PAKAIAN (Offline/Online Shop)'],
      ['     Kaos, Kemeja, Celana Jeans, Hijab/Pashmina, Gamis, Jaket, Tas, Dompet'],
      [''],
      ['  💄 BEAUTY & SKINCARE (Cosmetic Shop)'],
      ['     Cream Wajah, Serum, Sunscreen, Lip Matte, Foundation, Parfum, Eyeshadow'],
      [''],
      ['  📱 ELEKTRONIK & GADGET STORE'],
      ['     Charger, Kabel Data, Powerbank, Earphone TWS, Casing HP, Screen Protector'],
      [''],
      ['  💊 FARMASI / APOTEK / TOKO OBAT'],
      ['     Paracetamol, Vitamin C, Masker Medis, Hand Sanitizer, OBH, Betadine'],
      [''],
      ['  ☕ CAFE / WARUNG (Jual Langsung)'],
      ['     Kopi Susu, Es Teh, Nasi Goreng, Mie Ayam, Roti Bakar (stok=0 untuk jasa)'],
      [''],
      ['─────────────────────────────────────────────────'],
      ['CARA ISI TEMPLATE:'],
      ['─────────────────────────────────────────────────'],
      [''],
      ['  1️⃣  SHEET "Produk Non-Varian"'],
      ['      • Isi semua produk tanpa varian (ukuran/warna tetap)'],
      ['      • Kolom WAJIB: NAMA PRODUK*, HARGA JUAL*, STOK AWAL'],
      ['      • Kolom opsional: SKU, Barcode, HPP, Satuan, Kategori, Low Stock Alert'],
      ['      • STOK AWAL = jumlah stok fisik saat ini di gudang/rak'],
      [''],
      ['  2️⃣  SHEET "Produk Varian" (jika ada produk dengan ukuran/warna)'],
      ['      • Baris pertama = Nama Produk Induk (hanya isi sekali)'],
      ['      • Baris berikutnya = Varian (Size S/M/L/XL, Shade, Model HP, dll)'],
      ['      • Setiap varian punya HPP dan harga jual sendiri'],
      ['      • Setiap varian punya STOK AWAL VARIAN sendiri'],
      [''],
      ['  3️⃣  GANTI CONTOH DATA dengan data asli Anda'],
      ['      • Hapus baris contoh yang tidak perlu'],
      ['      • Sesuaikan format dengan data Anda'],
      [''],
      ['  4️⃣  UPLOAD file ini di aplikasi → Migration Wizard'],
      [''],
      ['─────────────────────────────────────────────────'],
      ['PENTING DIINGAT:'],
      ['─────────────────────────────────────────────────'],
      [''],
      ['  ✅ Isi kolom STOK AWAL dengan jumlah stok SAAT INI'],
      ['  ✅ Stok gudang OTOMATIS dibuat (tidak manual)'],
      ['  ✅ Setiap produk TERHUBUNG ke inventory (1:1)'],
      ['  ✅ Stok otomatis BERKURANG saat terjual di POS'],
      ['  ❌ Tidak perlu Sheet "Bahan Baku" atau "Komposisi"'],
      ['  ❌ Tidak perlu resep/bahan mentah (gunakan Mode 3 jika perlu)'],
      [''],
    )
  }

  if (mode === 'product_inventory') {
    lines.push(
      ['Mode ini untuk bisnis yang MENGOLAH BAHAN menjadi PRODUK JADI.'],
      ['Bahan baku terpisah dari produk, terhubung melalui resep/komposisi.'],
      ['Stok bahan baku berkurang otomatis saat produk terjual.'],
      [''],
      ['CONTOH BISNIS:'],
      ['  • F&B dengan resep — Restoran, kafe (beras → nasi goreng)'],
      ['  • Percetakan — Kertas + tinta → brosur, kartu nama'],
      ['  • Konveksi — Kain + benang → kaos, celana'],
      ['  • Bangunan — Semen + pasir → campuran cor'],
      [''],
      ['CARA ISI:'],
      ['  1. Sheet "Produk Non-Varian" — produk jadi + STOK AWAL'],
      ['  2. Sheet "Produk Varian" — jika ada varian'],
      ['  3. Sheet "Bahan Baku" — DAFTAR SEMUA BAHAN MENTAH Anda'],
      ['  4. Sheet "Komposisi (Resep BOM)" — resep/bahan per produk'],
      ['  5. Ganti contoh data dengan data asli Anda'],
      ['  6. Upload file ini di aplikasi'],
      [''],
      ['PENTING:'],
      ['  • Bahan baku (Sheet 3) BERBEDA dengan produk jadi (Sheet 1/2)'],
      ['  • Bahan baku = material mentah, Produk = hasil jualan'],
      ['  • Komposisi menentukan berapa bahan yang dipakai per produk'],
      ['  • HPP produk dihitung otomatis dari resep'],
      [''],
    )
  }

  // ── Common guide sections ──

  lines.push(
    ['═'.repeat(70)],
    ['SHEET: PRODUK NON-VARIAN'],
    ['═'.repeat(70)],
    [''],
    ['Untuk produk tanpa varian — langsung siap jual.'],
    [''],
    ['KOLOM', 'DESKRIPSI', 'CONTOH', 'WAJIB?'],
    ['NAMA PRODUK*', 'Nama produk / item', 'Air Mineral 600ml / Cuci Motor', 'Ya'],
    ['SKU', 'Kode unik (auto-generate jika kosong)', 'RTL-001', 'Tidak'],
    ['BARCODE', 'Barcode untuk scan (auto dari SKU)', '8992001001', 'Tidak'],
    ['HPP / MODAL (Rp)', 'Harga pokok per unit', '2500', 'Tidak'],
    ['HARGA JUAL* (Rp)', 'Harga jual ke customer', '4000', 'Ya'],
  )

  if (mode === 'product_stock' || mode === 'product_inventory') {
    lines.push(
      ['STOK AWAL', 'Jumlah stok saat ini', '144', 'Ya'],
    )
  }

  lines.push(
    ['SATUAN', 'Unit produk', 'pcs / porsi / kg / botol', 'Tidak'],
    ['KATEGORI', 'Nama kategori (auto-create)', 'Minuman / Jasa Cuci / Skincare', 'Tidak'],
  )

  if (mode === 'product_stock' || mode === 'product_inventory') {
    lines.push(
      ['LOW STOCK ALERT', 'Batas peringatan stok rendah', '10', 'Tidak'],
    )
  }

  if (mode === 'product_inventory') {
    lines.push(
      ['KOMPOSISI INLINE', 'Resep/bahan langsung di kolom', 'Kain:2m,Benang:1roll', 'Tidak'],
    )
  }

  lines.push(
    [''],
    ['═'.repeat(70)],
    ['SHEET: PRODUK VARIAN'],
    ['═'.repeat(70)],
    [''],
    ['Untuk produk dengan varian (ukuran, rasa, shade, tipe, dll).'],
    ['Baris pertama = produk induk. Baris kosong = varian.'],
    [''],
    ['KOLOM', 'DESKRIPSI', 'WAJIB?'],
    ['NAMA PRODUK*', 'Produk induk (isi baris pertama saja)', 'Ya'],
    ['HARGA JUAL PRODUK*', 'Harga default', 'Ya'],
    ['KATEGORI', 'Kategori (isi baris pertama saja)', 'Tidak'],
    ['NAMA VARIAN*', 'Nama varian', 'Ya'],
    ['SKU VARIAN', 'SKU varian', 'Tidak'],
    ['BARCODE VARIAN', 'Barcode varian', 'Tidak'],
    ['HPP VARIAN (Rp)', 'HPP per varian', 'Tidak'],
    ['HARGA JUAL VARIAN* (Rp)', 'Harga jual per varian', 'Ya'],
  )

  if (mode === 'product_stock' || mode === 'product_inventory') {
    lines.push(
      ['STOK AWAL VARIAN', 'Stok per varian', 'Ya'],
    )
  }

  if (mode === 'product_inventory') {
    lines.push(
      ['KOMPOSISI VARIAN INLINE', 'Resep per varian', 'Tidak'],
    )
  }

  lines.push(
    [''],
    ['CONTOH VARIAN:'],
    ['  F&B:        Kopi Susu → Small 200ml / Regular 300ml / Large 400ml'],
    ['  Fashion:    Kaos Polos → S / M / L / XL'],
    ['  Beauty:     Bedak Tabur → Natural / Warm / Cool'],
    ['  Elektronik: Casing HP → iPhone 15 / Samsung S24 / Xiaomi 14'],
    [''],
  )

  if (mode === 'product_inventory') {
    lines.push(
      ['═'.repeat(70)],
      ['SHEET: BAHAN BAKU'],
      ['═'.repeat(70)],
      [''],
      ['Daftar semua bahan mentah / raw materials yang Anda gunakan.'],
      ['Bahan baku BERBEDA dari produk jadi.'],
      ['  Contoh: Kain Katun ≠ Kaos Polos (kain diolah jadi kaos)'],
      [''],
      ['KOLOM', 'DESKRIPSI', 'WAJIB?'],
      ['NAMA ITEM*', 'Nama bahan baku', 'Ya'],
      ['SKU', 'Kode SKU', 'Tidak'],
      ['SATUAN DASAR*', 'Unit dasar', 'Ya'],
      ['STOK AWAL', 'Stok saat ini', 'Tidak'],
      ['HPP RATA-RATA (Rp)', 'Harga pokok rata-rata per unit', 'Tidak'],
      ['KATEGORI', 'Kategori bahan', 'Tidak'],
      ['LOW STOCK ALERT', 'Batas peringatan', 'Tidak'],
      ['TERHUBUNG DENGAN PRODUK', 'List produk (opsional)', 'Tidak'],
      [''],
      ['═'.repeat(70)],
      ['SHEET: KOMPOSISI / RESEP (BOM DETAIL)'],
      ['═'.repeat(70)],
      [''],
      ['Resep/BOM untuk menghubungkan bahan baku ke produk jadi.'],
      ['Digunakan untuk resep yang kompleks dengan yield per batch.'],
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
      ['  Fashion:  2m kain + 1 roll benang → 10 kaos'],
      ['  → QTY kain = 2 (meter), Yield = 10 → 1 kaos butuh 0.2m kain'],
      [''],
    )
  }

  lines.push(
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
    ['• Import bisa diulang dengan aman (skip duplikat)'],
    ['• Ganti/hapus contoh data dengan data asli Anda sebelum import'],
    [''],
  )

  return lines
}