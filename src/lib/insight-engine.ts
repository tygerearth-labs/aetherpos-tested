/**
 * insight-engine.ts — AI Insight Engine
 *
 * Pure logic engine that analyzes outlet data and generates
 * actionable insights with IF/THEN rules, priority scoring,
 * and smart combining of related insights.
 *
 * No LLM/AI used — all logic is rule-based from real data.
 */

// ── Types ──

export type InsightPriority = 'critical' | 'high' | 'medium' | 'low'

export interface InsightCTA {
  label: string
  page: string  // page name for navigation
}

export interface AIInsight {
  id: string
  title: string
  why: string       // Why this is happening (data-backed)
  actions: string[] // Recommended actions
  priority: InsightPriority
  score: number     // 0-100 priority score
  cta: InsightCTA[]
  emoji: string
}

export interface InsightEngineResult {
  insights: AIInsight[]
  topInsight: AIInsight | null
  healthScore: number  // 0-100 overall health
  summary: string      // 1-line combined summary
}

export interface InsightEngineInput {
  todayRevenue: number
  yesterdayRevenue: number
  todayTransactions: number
  yesterdayTransactions: number
  todayAOV: number
  yesterdayAOV: number
  totalProducts: number
  lowStockCount: number
  outOfStockCount: number
  topSelling: Array<{ name: string; qty: number; revenue: number; stock: number; lowStockAlert: number }>
  totalCustomers: number
  repeatCustomersThisWeek: number
  newCustomersThisWeek: number
  avgProductPrice: number
  todayProfit: number | null
  todayBrutto: number
  todayDiscount: number
  todayTax: number
  // Inventory data
  lowInventoryCount: number
  outOfInventoryCount: number
  inventoryAlerts: { name: string; stock: number; dailyConsumption: number; daysUntilEmpty: number | null; avgCost: number; baseUnit: string }[]
  totalInventoryValue: number
  // Transfer & Purchase data
  pendingTransfers: number
  pendingTransferItems: number
  pendingPurchases: number
  pendingPurchaseValue: number
  // Variant sales data
  topVariantSelling: { productName: string; variantName: string; qty: number; revenue: number }[]
}

// ── Priority Scores ──

const SCORES: Record<InsightPriority, number> = {
  critical: 100,
  high: 80,
  medium: 60,
  low: 40,
}

// ── Helpers ──

function rp(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
}

function num(n: number): string {
  return n.toLocaleString('id-ID')
}

// ── Engine ──

export function runInsightEngine(input: InsightEngineInput): InsightEngineResult {
  const insights: AIInsight[] = []

  // ═══════════════════════════════════════════════════════════
  // Rule 1: No Activity Today
  // ═══════════════════════════════════════════════════════════
  if (input.todayTransactions === 0 && input.todayRevenue === 0) {
    if (input.yesterdayRevenue > 0) {
      insights.push({
        id: 'no-activity',
        title: 'Penjualan berhenti hari ini',
        why: `Kemarin ada revenue ${rp(input.yesterdayRevenue)} dari ${input.yesterdayTransactions} transaksi, tapi hari ini belum ada aktivitas sama sekali.`,
        actions: [
          'Kirim promo flash sale ke customer',
          'Cek apakah toko buka dan kasir aktif',
          'Broadcast WhatsApp ke customer lama',
        ],
        priority: 'critical',
        score: SCORES.critical,
        cta: [{ label: 'Buka Kasir', page: 'pos' }],
        emoji: '🔴',
      })
    } else {
      insights.push({
        id: 'no-activity-new',
        title: 'Belum ada transaksi',
        why: 'Outlet belum mencatatkan transaksi apapun.',
        actions: [
          'Mulai input transaksi pertama',
          'Tambah produk ke catalog',
        ],
        priority: 'low',
        score: SCORES.low,
        cta: [{ label: 'Buka Kasir', page: 'pos' }],
        emoji: '🟡',
      })
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 2: Transaction Drop >50%
  // ═══════════════════════════════════════════════════════════
  if (input.yesterdayTransactions >= 3 && input.todayTransactions > 0) {
    const ratio = input.todayTransactions / input.yesterdayTransactions
    if (ratio < 0.5) {
      const dropPct = Math.round((1 - ratio) * 100)
      insights.push({
        id: 'trx-drop',
        title: `Transaksi turun ${dropPct}%`,
        why: `Hari ini ${input.todayTransactions} transaksi vs kemarin ${input.yesterdayTransactions}. Penurunan drastis perlu perhatian.`,
        actions: [
          'Aktifkan diskon cepat / flash sale',
          'Highlight best seller di etalase',
          'Push notifikasi promo ke customer',
        ],
        priority: 'high',
        score: SCORES.high,
        cta: [
          { label: 'Buat Promo', page: 'settings' },
          { label: 'Lihat Produk', page: 'products' },
        ],
        emoji: '🔴',
      })
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 3: Out of Stock Products
  // ═══════════════════════════════════════════════════════════
  if (input.outOfStockCount > 0) {
    const isHigh = input.outOfStockCount > 3 || input.outOfStockCount / Math.max(1, input.totalProducts) > 0.2
    insights.push({
      id: 'out-of-stock',
      title: `${input.outOfStockCount} produk habis stok`,
      why: `Produk yang habis tidak bisa dijual — potensi lost sales tinggi.${input.outOfStockCount > 5 ? ` Ini ${input.outOfStockCount} dari ${input.totalProducts} total produk.` : ''}`,
      actions: [
        'Restock segera produk yang habis',
        'Sembunyikan produk habis dari display POS',
        'Cek supplier lead time',
      ],
      priority: isHigh ? 'high' : 'medium',
      score: isHigh ? SCORES.high : SCORES.medium,
      cta: [{ label: 'Kelola Stok', page: 'products' }],
      emoji: isHigh ? '🔴' : '🟠',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 4: Low Stock (>10 products)
  // ═══════════════════════════════════════════════════════════
  const lowStockOnly = input.lowStockCount - input.outOfStockCount
  if (lowStockOnly > 10) {
    insights.push({
      id: 'low-stock-many',
      title: `${lowStockOnly} produk stok menipis`,
      why: 'Banyak produk mendekati batas minimum — potensi lost sales meningkat.',
      actions: [
        'Restock top 5 produk terlaris dulu',
        'Cek supplier lead time',
        'Naikkan harga sementara untuk slow movers',
      ],
      priority: 'medium',
      score: SCORES.medium,
      cta: [{ label: 'Kelola Stok', page: 'products' }],
      emoji: '🟠',
    })
  } else if (lowStockOnly > 0 && input.outOfStockCount === 0) {
    insights.push({
      id: 'low-stock',
      title: `${lowStockOnly} produk stok menipis`,
      why: 'Sebagian produk mendekati batas minimum.',
      actions: [
        'Cek produk yang stok rendah',
        'Jadwalkan restock',
      ],
      priority: 'medium',
      score: SCORES.medium - 10,
      cta: [{ label: 'Kelola Stok', page: 'products' }],
      emoji: '🟠',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 5: Hot Product + Low Stock (HIGH PRIORITY)
  // ═══════════════════════════════════════════════════════════
  const hotLowStock = input.topSelling.filter(
    (p) => p.stock > 0 && p.stock <= p.lowStockAlert
  )
  if (hotLowStock.length > 0) {
    const names = hotLowStock.slice(0, 3).map((p) => p.name)
    const extras = hotLowStock.length > 3 ? ` +${hotLowStock.length - 3} lainnya` : ''
    insights.push({
      id: 'hot-low-stock',
      title: `🔥 ${hotLowStock[0].name} laris tapi stok tipis`,
      why: `Produk terlaris (${names.join(', ')}${extras}) stoknya di bawah batas aman. Kalau habis, revenue langsung turun.`,
      actions: [
        'Restock segera produk terlaris',
        'Bisa naikkan harga 5-10% sementara (demand tinggi)',
        'Cari supplier backup',
      ],
      priority: 'high',
      score: SCORES.high,
      cta: [{ label: 'Restock', page: 'products' }],
      emoji: '🔥',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 6: Customer Low Retention
  // ═══════════════════════════════════════════════════════════
  if (input.totalCustomers > 5 && input.repeatCustomersThisWeek === 0 && input.todayTransactions >= 3) {
    insights.push({
      id: 'no-repeat',
      title: 'Tidak ada customer repeat minggu ini',
      why: `${input.totalCustomers} customer terdaftar tapi tidak ada yang beli ulang minggu ini. Retention perlu ditingkatkan.`,
      actions: [
        'Kirim promo ke customer lama via WhatsApp',
        'Buat diskon khusus repeat order',
        'Aktifkan program loyalitas / poin',
      ],
      priority: 'medium',
      score: SCORES.medium - 5,
      cta: [{ label: 'Lihat Customer', page: 'customers' }],
      emoji: '🟠',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 7: Low AOV
  // ═══════════════════════════════════════════════════════════
  const targetAOV = input.avgProductPrice * 2
  if (input.todayAOV > 0 && targetAOV > 0 && input.todayAOV < targetAOV && input.totalProducts > 1 && input.todayTransactions >= 3) {
    insights.push({
      id: 'low-aov',
      title: 'Rata-rata belanja rendah',
      why: `AOV hari ini ${rp(input.todayAOV)} — target minimal ${rp(targetAOV)} (2x harga rata-rata produk).`,
      actions: [
        'Bikin bundling produk (beli 2 lebih murah)',
        'Upsell di kasir — tawarkan produk tambahan',
        'Buat promo minimum purchase',
      ],
      priority: 'low',
      score: SCORES.low,
      cta: [{ label: 'Buat Promo', page: 'settings' }],
      emoji: '🟡',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 8: Inventory Running Out (CTO perspective)
  // ═══════════════════════════════════════════════════════════
  const criticalInventory = input.inventoryAlerts.filter(a => a.daysUntilEmpty !== null && a.daysUntilEmpty <= 3)
  const warningInventory = input.inventoryAlerts.filter(a => a.daysUntilEmpty !== null && a.daysUntilEmpty > 3 && a.daysUntilEmpty <= 7)
  if (criticalInventory.length > 0) {
    const item = criticalInventory[0]
    insights.push({
      id: 'inventory-critical',
      title: `📦 ${item.name} habis dalam ${Math.round(item.daysUntilEmpty!)} hari`,
      why: `Stok ${item.name} tinggal ${num(item.stock)} ${item.baseUnit}, terpakai rata-rata ${item.dailyConsumption.toFixed(1)} ${item.baseUnit}/hari. Dalam ${Math.round(item.daysUntilEmpty!)} hari akan habis.`,
      actions: [
        `Beli ${item.name} segera ke supplier`,
        'Cek apakah bisa substitusi dengan bahan lain',
        'Kurangi menu yang menggunakan bahan ini sementara',
      ],
      priority: 'critical',
      score: SCORES.critical,
      cta: [{ label: 'Beli Bahan', page: 'purchase' }],
      emoji: '🔴',
    })
  } else if (warningInventory.length > 0) {
    const item = warningInventory[0]
    insights.push({
      id: 'inventory-warning',
      title: `📦 ${item.name} stok menipis — ${Math.round(item.daysUntilEmpty!)} hari lagi`,
      why: `Stok ${item.name} terpakai ${item.dailyConsumption.toFixed(1)} ${item.baseUnit}/hari. Sisa ${Math.round(item.daysUntilEmpty!)} hari sebelum habis.`,
      actions: [
        `Jadwalkan pembelian ${item.name}`,
        'Cek stok di outlet lain untuk transfer',
      ],
      priority: 'high',
      score: SCORES.high,
      cta: [{ label: 'Beli Bahan', page: 'purchase' }],
      emoji: '🟠',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 9: High Inventory Value Idle (CTO perspective)
  // ═══════════════════════════════════════════════════════════
  if (input.totalInventoryValue > 0 && input.inventoryAlerts.length > 0) {
    const slowMoving = input.inventoryAlerts.filter(a => a.daysUntilEmpty !== null && a.daysUntilEmpty > 30)
    if (slowMoving.length > 0) {
      const idleValue = slowMoving.reduce((s, a) => s + a.stock * a.avgCost, 0)
      insights.push({
        id: 'inventory-idle',
        title: `📦 ${rp(idleValue)} modal tertahan di bahan lambat`,
        why: `${slowMoving.length} inventori bisa bertahan >30 hari. Total nilai ${rp(idleValue)} modal tidak berputar.`,
        actions: [
          'Kurangi porsi pembelian bahan yang berputar lambat',
          'Cek apakah ada menu yang bisa memakai bahan ini lebih banyak',
          'Pertimbangkan untuk menjual bahan ke outlet lain',
        ],
      priority: 'medium',
      score: SCORES.medium,
      cta: [{ label: 'Lihat Inventaris', page: 'purchase' }],
      emoji: '🟡',
    })
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 10: Pending Transfers Not Received (CTO perspective)
  // ═══════════════════════════════════════════════════════════
  if (input.pendingTransfers > 0) {
    const isHigh = input.pendingTransfers > 3
    insights.push({
      id: 'pending-transfers',
      title: `${input.pendingTransfers} transfer belum selesai`,
      why: `${input.pendingTransfers} pengiriman stok dengan ${input.pendingTransferItems} item belum diterima. Stok di outlet tujuan mungkin terganggu.`,
      actions: [
        'Hubungi outlet penerima untuk konfirmasi',
        'Cek status pengiriman di halaman transfer',
        'Follow up melalui WhatsApp ke outlet tujuan',
      ],
      priority: isHigh ? 'high' : 'medium',
      score: isHigh ? SCORES.high : SCORES.medium,
      cta: [{ label: 'Lihat Transfer', page: 'transfer' }],
      emoji: isHigh ? '🔴' : '🟠',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 11: Pending Purchase Orders (CEO perspective)
  // ═══════════════════════════════════════════════════════════
  if (input.pendingPurchases > 0) {
    const valueVsRevenue = input.todayRevenue > 0
      ? input.pendingPurchaseValue / input.todayRevenue
      : 0
    const isHigh = valueVsRevenue > 0.5 || input.pendingPurchaseValue > 5_000_000
    insights.push({
      id: 'pending-purchases',
      title: `${input.pendingPurchases} pembelian bahan senilai ${rp(input.pendingPurchaseValue)}`,
      why: `Ada ${input.pendingPurchases} order pembelian inventori dengan total ${rp(input.pendingPurchaseValue)} yang belum selesai diproses.`,
      actions: [
        'Proses order pembelian yang tertunda',
        'Hubungi supplier untuk konfirmasi pengiriman',
        'Cek apakah ada pembelian yang bisa dibatalkan',
      ],
      priority: isHigh ? 'high' : 'medium',
      score: isHigh ? SCORES.high : SCORES.medium,
      cta: [{ label: 'Lihat Pembelian', page: 'purchase' }],
      emoji: '🟠',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 12: Variant Sales Imbalance (CMO perspective)
  // ═══════════════════════════════════════════════════════════
  if (input.topVariantSelling.length >= 2) {
    const totalVariantQty = input.topVariantSelling.reduce((s, v) => s + v.qty, 0)
    if (totalVariantQty > 0) {
      const topVariant = input.topVariantSelling[0]
      const topRatio = topVariant.qty / totalVariantQty
      if (topRatio > 0.5) {
        const bottomVariant = input.topVariantSelling[input.topVariantSelling.length - 1]
        insights.push({
          id: 'variant-imbalance',
          title: `Varian ${topVariant.variantName} mendominasi penjualan`,
          why: `Dari ${num(totalVariantQty)} unit terjual, ${topVariant.variantName} (${topVariant.productName}) menyumbang ${Math.round(topRatio * 100)}%. ${bottomVariant.variantName} hanya ${bottomVariant.qty} unit.`,
          actions: [
            `Promosikan varian ${bottomVariant.variantName} lebih gencar`,
            'Buat combo promo varian kurang laris dengan varian populer',
            'Tampilkan varian kurang laris di posisi lebih strategis di POS',
          ],
          priority: 'low',
          score: SCORES.low,
          cta: [{ label: 'Kelola Produk', page: 'products' }],
          emoji: '🟡',
        })
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 13: Product Mix Insight (CMO perspective)
  // ═══════════════════════════════════════════════════════════
  if (input.todayTransactions >= 5 && input.yesterdayAOV > 0 && input.todayAOV < input.yesterdayAOV * 0.8) {
    const dropPct = Math.round((1 - input.todayAOV / input.yesterdayAOV) * 100)
    insights.push({
      id: 'aov-drop-mix',
      title: `Nilai transaksi turun ${dropPct}% dibanding kemarin`,
      why: `AOV hari ini ${rp(input.todayAOV)} vs kemarin ${rp(input.yesterdayAOV)}. Customer cenderung beli lebih sedikit per kunjungan.`,
      actions: [
        'Tawarkan upsell di kasir ("mau tambah ini?")',
        'Buat paket bundling 2-3 produk dengan harga spesial',
        'Berikan diskon untuk minimum pembelian tertentu',
      ],
      priority: 'medium',
      score: SCORES.medium,
      cta: [
        { label: 'Buat Promo', page: 'settings' },
        { label: 'Lihat Produk', page: 'products' },
      ],
      emoji: '🟠',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Rule 14: Inventory Health Overall (CTO perspective)
  // ═══════════════════════════════════════════════════════════
  if (input.outOfInventoryCount > 0 && input.todayTransactions > 0) {
    const isCritical = input.outOfInventoryCount > 2
    insights.push({
      id: 'inventory-out-overall',
      title: `${input.outOfInventoryCount} inventori habis — produk komposisi terganggu`,
      why: `Dengan ${input.outOfInventoryCount} inventori yang habis, beberapa produk komposisi tidak bisa dibuat. Ini menghambat operasional.`,
      actions: [
        'Beli inventori yang habis segera',
        'Tandai produk yang menggunakan bahan ini sebagai "tidak tersedia"',
        'Cek apakah bisa transfer dari outlet lain',
      ],
      priority: isCritical ? 'critical' : 'high',
      score: isCritical ? SCORES.critical : SCORES.high,
      cta: [{ label: 'Beli Bahan', page: 'purchase' }],
      emoji: isCritical ? '🔴' : '🟠',
    })
  }

  // ═══════════════════════════════════════════════════════════
  // Positive: Everything is good
  // ═══════════════════════════════════════════════════════════
  if (insights.length === 0 && input.todayTransactions > 0) {
    const isUp = input.todayRevenue > input.yesterdayRevenue
    insights.push({
      id: 'all-good',
      title: isUp ? 'Bisnis berjalan baik! 🎉' : 'Bisnis stabil hari ini',
      why: isUp
        ? `Revenue ${rp(input.todayRevenue)} naik dari kemarin ${rp(input.yesterdayRevenue)}. ${input.todayTransactions} transaksi tercatat.`
        : `Revenue ${rp(input.todayRevenue)} dari ${input.todayTransactions} transaksi. Semua metrik dalam batas normal.`,
      actions: isUp
        ? ['Pertahankan performa!', 'Fokus ke upselling untuk tingkatkan AOV']
        : ['Coba promo untuk boost revenue', 'Fokus ke produk terlaris'],
      priority: 'low',
      score: 0,
      cta: [{ label: 'Buka Kasir', page: 'pos' }],
      emoji: '✅',
    })
  }

  // ── Sort by score descending ──
  insights.sort((a, b) => b.score - a.score)

  // ── Combine related insights ──
  const combined = combineInsights(insights)

  // ── Calculate health score ──
  const healthScore = calcHealthScore(insights, input)

  // ── Generate summary ──
  const summary = genSummary(combined, input)

  return {
    insights: combined,
    topInsight: combined[0] || null,
    healthScore,
    summary,
  }
}

// ── Combine related insights ──

function combineInsights(insights: AIInsight[]): AIInsight[] {
  if (insights.length <= 1) return insights

  const combined: AIInsight[] = []
  const used = new Set<string>()

  // Combine: no-activity + out-of-stock → "Penjualan berhenti + stok habis"
  const noActivity = insights.find((i) => i.id === 'no-activity')
  const outOfStock = insights.find((i) => i.id === 'out-of-stock')
  if (noActivity && outOfStock) {
    combined.push({
      id: 'no-activity-stock',
      title: 'Penjualan berhenti + stok banyak habis',
      why: `${noActivity.why}\n${outOfStock.why}`,
      actions: [...new Set([...noActivity.actions, ...outOfStock.actions])],
      priority: 'critical',
      score: 110, // higher than individual
      cta: [
        { label: 'Kelola Stok', page: 'products' },
        { label: 'Buka Kasir', page: 'pos' },
      ],
      emoji: '🔴',
    })
    used.add('no-activity')
    used.add('out-of-stock')
  }

  // Combine: trx-drop + low-aov → "Transaksi turun + nilai order rendah"
  const trxDrop = insights.find((i) => i.id === 'trx-drop')
  const lowAov = insights.find((i) => i.id === 'low-aov')
  if (trxDrop && lowAov) {
    combined.push({
      id: 'trx-drop-aov',
      title: 'Transaksi turun + nilai order rendah',
      why: `${trxDrop.why}\n${lowAov.why}`,
      actions: [...new Set([...trxDrop.actions, ...lowAov.actions])],
      priority: 'high',
      score: 90,
      cta: trxDrop.cta,
      emoji: '🔴',
    })
    used.add('trx-drop')
    used.add('low-aov')
  }

  // Combine: hot-low-stock + low-stock-many → "Produk terlaris stok tipis + banyak stok menipis"
  const hotLow = insights.find((i) => i.id === 'hot-low-stock')
  const lowMany = insights.find((i) => i.id === 'low-stock-many')
  if (hotLow && lowMany) {
    combined.push({
      id: 'stock-crisis',
      title: 'Krisis stok — produk terlaris menipis',
      why: `${hotLow.why}\n${lowMany.why}`,
      actions: [...new Set([...hotLow.actions, ...lowMany.actions])],
      priority: 'high',
      score: 95,
      cta: [{ label: 'Kelola Stok', page: 'products' }],
      emoji: '🔥',
    })
    used.add('hot-low-stock')
    used.add('low-stock-many')
  }

  // Combine: inventory-critical + inventory-out-overall → "Krisis bahan baku"
  const invCritical = insights.find((i) => i.id === 'inventory-critical')
  const invOutOverall = insights.find((i) => i.id === 'inventory-out-overall')
  if (invCritical && invOutOverall) {
    combined.push({
      id: 'inventory-crisis',
      title: 'Krisis inventori — stok kritis + ada yang sudah habis',
      why: `${invCritical.why}\n${invOutOverall.why}`,
      actions: [...new Set([...invCritical.actions, ...invOutOverall.actions])],
      priority: 'critical',
      score: 115,
      cta: [{ label: 'Beli Bahan', page: 'purchase' }],
      emoji: '🔴',
    })
    used.add('inventory-critical')
    used.add('inventory-out-overall')
  }

  // Combine: pending-transfers + pending-purchases → "Operasional tertunda"
  const pendTransfers = insights.find((i) => i.id === 'pending-transfers')
  const pendPurchases = insights.find((i) => i.id === 'pending-purchases')
  if (pendTransfers && pendPurchases) {
    combined.push({
      id: 'pending-ops',
      title: 'Operasional tertunda — transfer & pembelian belum selesai',
      why: `${pendTransfers.why}\n${pendPurchases.why}`,
      actions: [...new Set([...pendTransfers.actions, ...pendPurchases.actions])],
      priority: 'high',
      score: 90,
      cta: [
        { label: 'Lihat Transfer', page: 'transfer' },
        { label: 'Lihat Pembelian', page: 'purchase' },
      ],
      emoji: '🟠',
    })
    used.add('pending-transfers')
    used.add('pending-purchases')
  }

  // Add remaining insights not yet combined
  for (const insight of insights) {
    if (!used.has(insight.id)) {
      combined.push(insight)
    }
  }

  // Re-sort after combining
  combined.sort((a, b) => b.score - a.score)

  return combined.slice(0, 5) // Max 5 insights
}

// ── Health Score ──

function calcHealthScore(insights: AIInsight[], input: InsightEngineInput): number {
  let score = 75 // start at 75 (good baseline)

  for (const insight of insights) {
    if (insight.id === 'all-good') {
      score = Math.min(100, score + 15)
    } else if (insight.priority === 'critical') {
      score -= 25
    } else if (insight.priority === 'high') {
      score -= 15
    } else if (insight.priority === 'medium') {
      score -= 8
    } else {
      score -= 3
    }
  }

  // Bonus: if transactions are up
  if (input.yesterdayRevenue > 0 && input.todayRevenue > input.yesterdayRevenue * 1.1) {
    score += 10
  }

  // Bonus: if stock is healthy
  if (input.lowStockCount === 0 && input.outOfStockCount === 0 && input.totalProducts > 0) {
    score += 5
  }

  // Inventory critical penalty
  const hasCriticalInventory = input.inventoryAlerts.some(a => a.daysUntilEmpty !== null && a.daysUntilEmpty <= 3)
  if (hasCriticalInventory) {
    score -= 10
  }

  // Many low inventory items penalty
  if (input.lowInventoryCount > 3) {
    score -= 5
  }

  // Inventory health bonus
  if (input.totalInventoryValue > 0 && input.inventoryAlerts.length > 0) {
    const allHealthy = input.inventoryAlerts.every(a => a.daysUntilEmpty === null || a.daysUntilEmpty > 14)
    if (allHealthy) {
      score += 5
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

// ── Summary ──

function genSummary(insights: AIInsight[], input: InsightEngineInput): string {
  // Inventory health snippet for summary
  const criticalInv = input.inventoryAlerts.filter(a => a.daysUntilEmpty !== null && a.daysUntilEmpty <= 3)
  const inventorySnippet = criticalInv.length > 0
    ? ` — ${criticalInv.length} inventori kritis`
    : input.outOfInventoryCount > 0
      ? ` — ${input.outOfInventoryCount} inventori habis`
      : ''

  if (insights.length === 0 || insights[0]?.id === 'all-good') {
    return input.todayTransactions > 0
      ? `Revenue ${rp(input.todayRevenue)} dari ${input.todayTransactions} transaksi — semua berjalan baik${inventorySnippet}`
      : 'Belum ada aktivitas hari ini'
  }

  const top = insights[0]
  const count = insights.filter((i) => i.priority === 'critical' || i.priority === 'high').length

  if (count > 1) {
    return `${count} isu penting — ${top.title.toLowerCase()}`
  }

  return top.title
}
