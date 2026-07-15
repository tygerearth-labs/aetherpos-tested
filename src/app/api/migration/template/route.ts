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
      // ── Retail / Minimarket ──
      ['Air Mineral 600ml', 'RTL-001', '8992001001', 2500, 4000, ...(showStock ? [144] : []), 'pcs', 'Minuman', ...(showStock ? [24] : []), ...(showComposition ? [''] : [])],
      ['Minyak Goreng 1L', 'RTL-002', '8992001002', 14000, 18000, ...(showStock ? [60] : []), 'pcs', 'Sembako', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],
      ['Tisu Paseo 250 Sheet', 'RTL-003', '8992001003', 7500, 11000, ...(showStock ? [48] : []), 'pcs', 'Kebutuhan Rumah', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],

      // ── Beauty / Kecantikan ──
      ['Cream Wajah 30ml', 'BTY-001', '8993001001', 25000, 55000, ...(showStock ? [48] : []), 'pcs', 'Skincare', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],
      ['Serum Vitamin C 20ml', 'BTY-002', '8993001002', 35000, 85000, ...(showStock ? [30] : []), 'pcs', 'Skincare', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],

      // ── Elektronik / Gadget ──
      ['Charger HP 20W', 'ELK-001', '8996001001', 15000, 35000, ...(showStock ? [30] : []), 'pcs', 'Aksesoris HP', ...(showStock ? [5] : []), ...(showComposition ? [''] : [])],
      ['Kabel Data USB-C', 'ELK-002', '8996001002', 8000, 18000, ...(showStock ? [50] : []), 'pcs', 'Aksesoris HP', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],

      // ── Farmasi / Kesehatan ──
      ['Paracetamol 500mg', 'FRM-001', '8995001001', 3500, 7000, ...(showStock ? [200] : []), 'strip', 'Obat Bebas', ...(showStock ? [50] : []), ...(showComposition ? [''] : [])],
      ['Masker Medis 3ply', 'FRM-003', '8995001003', 800, 2000, ...(showStock ? [500] : []), 'pcs', 'Alat Kesehatan', ...(showStock ? [100] : []), ...(showComposition ? [''] : [])],

      // ── Fashion / Reseller ──
      ['Kaos Polos Cotton 30s', 'FSH-001', '8994001001', 35000, 65000, ...(showStock ? [100] : []), 'pcs', 'Atasan', ...(showStock ? [15] : []), ...(showComposition ? [''] : [])],
      ['Hijab Segi Empat', 'FSH-003', '8994001003', 15000, 35000, ...(showStock ? [200] : []), 'pcs', 'Hijab', ...(showStock ? [20] : []), ...(showComposition ? [''] : [])],

      // ── F&B ──
      ['Kopi Susu Gula Aren', 'FNB-001', '8991001001', 8000, 18000, ...(showStock ? [100] : []), 'gelas', 'Minuman', ...(showStock ? [20] : []), ...(showComposition ? [''] : [])],
      ['Roti Bakar Coklat', 'FNB-002', '8991001002', 5000, 12000, ...(showStock ? [60] : []), 'pcs', 'Makanan', ...(showStock ? [10] : []), ...(showComposition ? [''] : [])],

      // ── Jasa ──
      ['Cuci Motor', 'JSA-001', '', 5000, 15000, ...(showStock ? [0] : []), 'pcs', 'Jasa Cuci', ...(showStock ? [0] : []), ...(showComposition ? [''] : [])],
      ['Potong Rambut Pria', 'JSA-002', '', 3000, 25000, ...(showStock ? [0] : []), 'pcs', 'Jasa Salon', ...(showStock ? [0] : []), ...(showComposition ? [''] : [])],
      ['Setrika Kaos / pcs', 'JSA-003', '', 1000, 3000, ...(showStock ? [0] : []), 'pcs', 'Laundry', ...(showStock ? [0] : []), ...(showComposition ? [''] : [])],

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
      ['Kopi Susu', 'VAR-FNB-001', '', 0, 0, 'Minuman', 'Small 200ml', 'VAR-FNB-001-S', '', 3500, 12000, ...(showStock ? [50] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Regular 300ml', 'VAR-FNB-001-R', '', 5000, 16000, ...(showStock ? [40] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Large 400ml', 'VAR-FNB-001-L', '', 6500, 20000, ...(showStock ? [30] : []), ...(showComposition ? [''] : [])],

      ['Kaos Polos Premium', 'VAR-FSH-001', '', 0, 0, 'Atasan', 'S', 'VAR-FSH-001-S', '', 35000, 65000, ...(showStock ? [40] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'M', 'VAR-FSH-001-M', '', 38000, 68000, ...(showStock ? [50] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'L', 'VAR-FSH-001-L', '', 40000, 70000, ...(showStock ? [40] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'XL', 'VAR-FSH-001-XL', '', 43000, 75000, ...(showStock ? [25] : []), ...(showComposition ? [''] : [])],

      ['Bedak Tabur', 'VAR-BTY-001', '', 0, 0, 'Makeup', 'Natural', 'VAR-BTY-001-N', '', 15000, 45000, ...(showStock ? [40] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Warm', 'VAR-BTY-001-W', '', 15000, 45000, ...(showStock ? [40] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Cool', 'VAR-BTY-001-C', '', 15000, 45000, ...(showStock ? [30] : []), ...(showComposition ? [''] : [])],

      ['Casing HP Silicone', 'VAR-ELK-001', '', 0, 0, 'Aksesoris HP', 'iPhone 15', 'VAR-ELK-001-IP', '', 8000, 25000, ...(showStock ? [60] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Samsung S24', 'VAR-ELK-001-SS', '', 8000, 25000, ...(showStock ? [50] : []), ...(showComposition ? [''] : [])],
      ['', '', '', '', '', '', 'Xiaomi 14', 'VAR-ELK-001-XM', '', 8000, 25000, ...(showStock ? [40] : []), ...(showComposition ? [''] : [])],
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
      ['Mode ini untuk bisnis RITEL di mana stok = produk yang dijual.'],
      ['Setiap produk OTOMATIS terhubung ke stok gudang (1:1).'],
      ['Stok berkurang otomatis saat produk terjual di kasir.'],
      [''],
      ['CONTOH BISNIS:'],
      ['  • Retail / Minimarket — Air Mineral, Minyak Goreng, Indomie'],
      ['  • Elektronik — Charger, Kabel, Earphone, Casing HP'],
      ['  • Farmasi — Paracetamol, Masker, Vitamin'],
      ['  • Fashion Reseller — Kaos, Celana, Hijab'],
      ['  • Beauty — Cream, Serum, Lipstik'],
      ['  • F&B jual langsung — Kopi Susu, Roti Bakar'],
      [''],
      ['CARA ISI:'],
      ['  1. Sheet "Produk Non-Varian" — isi produk + kolom STOK AWAL'],
      ['  2. Sheet "Produk Varian" — jika ada varian + STOK AWAL VARIAN'],
      ['  3. Ganti contoh data dengan data asli Anda'],
      ['  4. Upload file ini di aplikasi'],
      [''],
      ['PENTING:'],
      ['  • Isi kolom STOK AWAL dengan jumlah stok saat ini'],
      ['  • Stok gudang akan OTOMATIS dibuat dari data ini'],
      ['  • Tidak perlu mengisi bahan baku / resep terpisah'],
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

  if (showStock || mode === 'product_stock' || mode === 'product_inventory') {
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