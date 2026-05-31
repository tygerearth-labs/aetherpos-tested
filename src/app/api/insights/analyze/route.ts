import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getVoidedTxIds, parseTzOffset, getTodayRangeTz, getHourInTimezone } from '@/lib/api-helpers'
import { safeJson, safeJsonError } from '@/lib/safe-response'

export const maxDuration = 30

// ============================================================
// Pure Code Insight Engine — CMO & CTO Logic
// No AI/LLM used. All insights generated from database queries.
// ============================================================

interface InsightData {
  today: { revenue: number; transactions: number; avgOrder: number }
  yesterday: { revenue: number; transactions: number; avgOrder: number }
  thisWeek: { revenue: number; transactions: number }
  thisMonth: { revenue: number; transactions: number }
  products: {
    total: number; outOfStock: number; lowStock: number; categories: number
    topSelling: { name: string; qty: number; revenue: number }[]
    categoryDistribution: { name: string; count: number }[]
    inventoryValue: number; avgPrice: number
  }
  customers: {
    total: number; newThisWeek: number; loyaltyEnabled: boolean
    totalPointsIssued: number; totalPointsRedeemed: number
    avgSpendPerCustomer: number
    topSpenders: { name: string; totalSpend: number; points: number }[]
  }
  transactions: {
    paymentMethods: { method: string; count: number; total: number }[]
    peakHour: number; peakHourRevenue: number; avgDiscount: number
    hourBuckets: { hour: number; count: number; revenue: number }[]
  }
  outlet: { name: string; totalCrew: number; accountType: string }
  dataQuality: {
    productsWithoutCategory: number
    productsWithoutSku: number
    productsWithoutImage: number
    totalTransactionItems: number
    deadStockCount: number
    deadStockValue: number
  }
}

async function aggregateData(outletId: string, tzOffset: number | null): Promise<InsightData> {
  const { todayStart, yesterdayStart, dayOfWeek, weekStart, monthStart, weekAgo } = tzOffset !== null
    ? getTodayRangeTz(tzOffset)
    : (() => {
        const now = new Date()
        const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const dow = now.getDay()
        const mondayOff = dow === 0 ? 6 : dow - 1
        return {
          todayStart: ts,
          yesterdayStart: new Date(ts.getTime() - 86_400_000),
          dayOfWeek: dow,
          weekStart: new Date(ts.getTime() - mondayOff * 86_400_000),
          monthStart: new Date(now.getFullYear(), now.getMonth(), 1),
          weekAgo: new Date(ts.getTime() - 7 * 86_400_000),
        }
      })()

  const voidedTxIds = await getVoidedTxIds(db, outletId)
  const voidedIdArray = Array.from(voidedTxIds).filter(Boolean) as string[]
  const voidExclude = voidedIdArray.length > 0 ? { id: { notIn: voidedIdArray } } : {}

  const [todayTxs, yesterdayTxs, weekTxs, monthTxs] = await Promise.all([
    db.transaction.findMany({ where: { outletId, createdAt: { gte: todayStart }, ...voidExclude }, select: { total: true, discount: true } }),
    db.transaction.findMany({ where: { outletId, createdAt: { gte: yesterdayStart, lt: todayStart }, ...voidExclude }, select: { total: true } }),
    db.transaction.findMany({ where: { outletId, createdAt: { gte: weekStart }, ...voidExclude }, select: { total: true } }),
    db.transaction.findMany({ where: { outletId, createdAt: { gte: monthStart }, ...voidExclude }, select: { total: true } }),
  ])

  const todayRevenue = todayTxs.reduce((s, t) => s + t.total, 0)
  const todayDiscount = todayTxs.reduce((s, t) => s + t.discount, 0)
  const yesterdayRevenue = yesterdayTxs.reduce((s, t) => s + t.total, 0)
  const weekRevenue = weekTxs.reduce((s, t) => s + t.total, 0)
  const monthRevenue = monthTxs.reduce((s, t) => s + t.total, 0)
  const todayAvgOrder = todayTxs.length > 0 ? todayRevenue / todayTxs.length : 0
  const yesterdayAvgOrder = yesterdayTxs.length > 0 ? yesterdayRevenue / yesterdayTxs.length : 0

  const [allProducts, categories, topSellingItems, totalCustomers, newThisWeekCount, topSpenders, setting, loyaltyEarned, loyaltyRedeemed, paymentGroups, todayFullTxs, outlet] = await Promise.all([
    db.product.findMany({ where: { outletId }, select: { id: true, name: true, stock: true, lowStockAlert: true, price: true, hpp: true, categoryId: true, sku: true, image: true, hasVariants: true, variants: { select: { price: true, stock: true } } } }),
    db.category.findMany({ where: { outletId }, select: { id: true, name: true, products: { select: { id: true } } } }),
    db.transactionItem.groupBy({ by: ['productName'], where: { transaction: { outletId, ...voidExclude } }, _sum: { qty: true, subtotal: true }, orderBy: { _sum: { qty: 'desc' } }, take: 10 }),
    db.customer.count({ where: { outletId } }),
    db.customer.count({ where: { outletId, createdAt: { gte: weekAgo } } }),
    db.customer.findMany({ where: { outletId }, orderBy: { totalSpend: 'desc' }, take: 5, select: { name: true, totalSpend: true, points: true } }),
    db.outletSetting.findUnique({ where: { outletId } }),
    db.loyaltyLog.aggregate({ where: { customer: { outletId }, type: 'EARN' }, _sum: { points: true } }),
    db.loyaltyLog.aggregate({ where: { customer: { outletId }, type: 'REDEEM' }, _sum: { points: true } }),
    db.transaction.groupBy({ by: ['paymentMethod'], where: { outletId, ...voidExclude }, _count: { id: true }, _sum: { total: true } }),
    db.transaction.findMany({ where: { outletId, createdAt: { gte: todayStart }, ...voidExclude }, select: { createdAt: true, total: true } }),
    db.outlet.findUnique({ where: { id: outletId }, select: { name: true, accountType: true, users: { select: { id: true } } } }),
  ])

  const totalProducts = allProducts.length
  const getAggStock = (p: typeof allProducts[number]) =>
    p.hasVariants && p.variants?.length > 0 ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock
  const getAggPrice = (p: typeof allProducts[number]) => {
    if (p.hasVariants && p.variants?.length > 0) {
      const totalStock = p.variants.reduce((s, v) => s + v.stock, 0)
      return totalStock > 0 ? p.variants.reduce((s, v) => s + v.price * v.stock, 0) / totalStock : p.price
    }
    return p.price
  }
  const outOfStock = allProducts.filter(p => getAggStock(p) === 0).length
  const lowStock = allProducts.filter(p => { const s = getAggStock(p); return s > 0 && s <= p.lowStockAlert }).length
  const inventoryValue = allProducts.reduce((s, p) => s + (getAggPrice(p) * getAggStock(p)), 0)
  const avgPrice = totalProducts > 0 ? allProducts.reduce((s, p) => s + getAggPrice(p), 0) / totalProducts : 0

  const avgSpendPerCustomer = totalCustomers > 0
    ? (await db.customer.aggregate({ where: { outletId }, _avg: { totalSpend: true } }))._avg.totalSpend ?? 0
    : 0

  const hourBuckets: { hour: number; count: number; revenue: number }[] = []
  for (let h = 0; h < 24; h++) hourBuckets.push({ hour: h, count: 0, revenue: 0 })
  for (const t of todayFullTxs) {
    const h = tzOffset !== null
      ? getHourInTimezone(t.createdAt, tzOffset)
      : t.createdAt.getHours()
    hourBuckets[h].count++
    hourBuckets[h].revenue += t.total
  }
  let peakHour = 0; let peakHourRevenue = 0; let peakHourCount = 0
  for (const b of hourBuckets) {
    if (b.count > peakHourCount) { peakHourCount = b.count; peakHour = b.hour; peakHourRevenue = b.revenue }
  }

  // Data quality metrics
  const productsWithoutCategory = allProducts.filter(p => !p.categoryId).length
  const productsWithoutSku = allProducts.filter(p => !p.sku).length
  const productsWithoutImage = allProducts.filter(p => !p.image).length

  // Dead stock: products with stock > 0 but not in top selling items
  const sellingProductNames = new Set(topSellingItems.map(i => i.productName))
  const deadStock = allProducts.filter(p => getAggStock(p) > 0 && !sellingProductNames.has(p.name))
  const deadStockCount = deadStock.length
  const deadStockValue = deadStock.reduce((s, p) => s + (getAggPrice(p) * getAggStock(p)), 0)

  return {
    today: { revenue: todayRevenue, transactions: todayTxs.length, avgOrder: todayAvgOrder },
    yesterday: { revenue: yesterdayRevenue, transactions: yesterdayTxs.length, avgOrder: yesterdayAvgOrder },
    thisWeek: { revenue: weekRevenue, transactions: weekTxs.length },
    thisMonth: { revenue: monthRevenue, transactions: monthTxs.length },
    products: {
      total: totalProducts, outOfStock, lowStock, categories: categories.length,
      topSelling: topSellingItems.map(i => ({ name: i.productName, qty: i._sum.qty ?? 0, revenue: i._sum.subtotal ?? 0 })),
      categoryDistribution: categories.map(c => ({ name: c.name, count: c.products.length })),
      inventoryValue, avgPrice,
    },
    customers: {
      total: totalCustomers, newThisWeek: newThisWeekCount,
      loyaltyEnabled: setting?.loyaltyEnabled ?? false,
      totalPointsIssued: loyaltyEarned._sum.points ?? 0,
      totalPointsRedeemed: loyaltyRedeemed._sum.points ?? 0,
      avgSpendPerCustomer,
      topSpenders: topSpenders.map(c => ({ name: c.name, totalSpend: c.totalSpend, points: c.points })),
    },
    transactions: {
      paymentMethods: paymentGroups.map(g => ({ method: g.paymentMethod, count: g._count.id, total: g._sum.total ?? 0 })),
      peakHour, peakHourRevenue,
      avgDiscount: todayTxs.length > 0 ? todayDiscount / todayTxs.length : 0,
      hourBuckets,
    },
    outlet: { name: outlet?.name ?? 'Unknown', totalCrew: outlet?.users.length ?? 0, accountType: outlet?.accountType ?? 'free' },
    dataQuality: {
      productsWithoutCategory, productsWithoutSku, productsWithoutImage,
      totalTransactionItems: topSellingItems.reduce((s, i) => s + (i._sum.qty ?? 0), 0),
      deadStockCount, deadStockValue,
    },
  }
}

// ============================================================
// CMO Insight Generator
// ============================================================

function generateCMOInsights(d: InsightData): { insights: { title: string; description: string; type: 'positive' | 'warning' | 'info' | 'critical'; metric?: string }[]; score: number } {
  const insights: { title: string; description: string; type: 'positive' | 'warning' | 'info' | 'critical'; metric?: string }[] = []
  let score = 50

  // 1. Revenue trend (today vs yesterday)
  if (d.yesterday.revenue > 0) {
    const change = ((d.today.revenue - d.yesterday.revenue) / d.yesterday.revenue) * 100
    if (change > 0) {
      score += Math.min(15, Math.floor(change / 2))
      insights.push({
        title: 'Pendapatan Naik',
        description: `Revenue hari ini ${formatChange(change)} dibanding kemarin. Tren positif!`,
        type: 'positive',
        metric: `+${change.toFixed(1)}%`,
      })
    } else if (change < -10) {
      score -= Math.min(10, Math.floor(Math.abs(change) / 3))
      insights.push({
        title: 'Pendapatan Turun Signifikan',
        description: `Revenue hari ini turun ${Math.abs(change).toFixed(1)}% dari kemarin (${formatRp(d.yesterday.revenue)} → ${formatRp(d.today.revenue)}). Perlu evaluasi penyebab penurunan.`,
        type: 'critical',
        metric: `${change.toFixed(1)}%`,
      })
    } else {
      insights.push({
        title: 'Pendapatan Stabil',
        description: `Revenue hari ini ${formatRp(d.today.revenue)}, relatif stabil dibanding kemarin.`,
        type: 'info',
      })
    }
  } else if (d.today.revenue > 0) {
    insights.push({
      title: 'Transaksi Pertama Hari Ini',
      description: `Revenue awal ${formatRp(d.today.revenue)} dari ${d.today.transactions} transaksi.`,
      type: 'info',
    })
  } else {
    score -= 10
    insights.push({
      title: 'Belum Ada Transaksi',
      description: 'Belum ada penjualan hari ini. Perlu dorong promosi atau cek jam operasional.',
      type: 'warning',
    })
  }

  // 2. Average Order Value
  if (d.yesterday.avgOrder > 0 && d.today.avgOrder > 0) {
    const aovChange = ((d.today.avgOrder - d.yesterday.avgOrder) / d.yesterday.avgOrder) * 100
    if (aovChange > 10) {
      score += 5
      insights.push({
        title: 'Rata-rata Nilai Order Meningkat',
        description: `AOV naik ${aovChange.toFixed(1)}% (${formatRp(d.yesterday.avgOrder)} → ${formatRp(d.today.avgOrder)}). Strategi upselling/bundling berdampak positif.`,
        type: 'positive',
        metric: formatRp(d.today.avgOrder),
      })
    } else if (aovChange < -15) {
      score -= 5
      insights.push({
        title: 'Nilai Order Menurun',
        description: `AOV turun ke ${formatRp(d.today.avgOrder)}. Pertimbangkan promo minimum purchase atau bundling produk.`,
        type: 'warning',
        metric: formatRp(d.today.avgOrder),
      })
    }
  }

  // 3. Top Product Performance
  if (d.products.topSelling.length > 0) {
    const top = d.products.topSelling[0]
    const topRevenueShare = d.thisMonth.revenue > 0 ? (top.revenue / d.thisMonth.revenue) * 100 : 0
    insights.push({
      title: 'Produk Terlaris',
      description: `"${top.name}" mendominasi dengan ${top.qty} unit terjual dan revenue ${formatRp(top.revenue)} bulan ini.${topRevenueShare > 30 ? ` Mendominasi ${topRevenueShare.toFixed(0)}% revenue — diversifikasi produk perlu dipertimbangkan.` : ''}`,
      type: 'positive',
      metric: top.name,
    })
    if (topRevenueShare > 40) {
      score -= 5
      insights.push({
        title: 'Risiko Konsentrasi Produk',
        description: `Satu produk menyumbang ${topRevenueShare.toFixed(0)}% revenue. Terlalu bergantung pada satu produk berisiko. Kembangkan produk alternatif.`,
        type: 'warning',
      })
    }
  }

  // 4. Customer Acquisition
  if (d.customers.total > 0) {
    const newCustomerRate = (d.customers.newThisWeek / d.customers.total) * 100
    if (newCustomerRate > 10) {
      score += 5
      insights.push({
        title: 'Akuisisi Customer Baik',
        description: `${d.customers.newThisWeek} customer baru minggu ini (${newCustomerRate.toFixed(1)}% dari total). Pertahankan strategi pemasaran saat ini.`,
        type: 'positive',
        metric: `+${d.customers.newThisWeek}`,
      })
    } else if (d.customers.newThisWeek === 0 && d.customers.total > 5) {
      score -= 5
      insights.push({
        title: 'Tidak Ada Customer Baru',
        description: '0 customer baru minggu ini. Pertimbangkan promo referral atau program loyalitas untuk menarik pelanggan baru.',
        type: 'warning',
      })
    }
  }

  // 5. Loyalty Program
  if (d.customers.loyaltyEnabled) {
    const redemptionRate = d.customers.totalPointsIssued > 0
      ? (d.customers.totalPointsRedeemed / d.customers.totalPointsIssued) * 100
      : 0
    if (redemptionRate > 50) {
      score += 5
      insights.push({
        title: 'Loyalitas Aktif',
        description: `Program loyalitas efektif — ${redemptionRate.toFixed(0)}% poin telah ditukar. Customer engaged dengan reward system.`,
        type: 'positive',
        metric: `${redemptionRate.toFixed(0)}%`,
      })
    } else if (d.customers.totalPointsIssued > 100 && redemptionRate < 20) {
      insights.push({
        title: 'Poin Tidak Ditukar',
        description: `${d.customers.totalPointsIssued} poin diterbitkan tapi hanya ${redemptionRate.toFixed(0)}% yang ditukar. Perlu komunikasi benefit poin ke customer.`,
        type: 'info',
      })
    }
  } else {
    insights.push({
      title: 'Loyalitas Belum Aktif',
      description: 'Program loyalitas belum diaktifkan. Fitur ini bisa meningkatkan repeat order hingga 20-30%.',
      type: 'info',
    })
  }

  // 6. Payment Methods
  const cashPayments = d.transactions.paymentMethods.find(p => p.method === 'CASH')
  const qrisPayments = d.transactions.paymentMethods.find(p => p.method === 'QRIS')
  if (qrisPayments && cashPayments) {
    const cashShare = (cashPayments.count / d.transactions.paymentMethods.reduce((s, p) => s + p.count, 0)) * 100
    if (cashShare > 80) {
      insights.push({
        title: 'Dominasi Pembayaran Cash',
        description: `${cashShare.toFixed(0)}% transaksi menggunakan cash. Pertimbangkan promosi QRIS untuk meningkatkan cashless payment (lebih mudah tracking).`,
        type: 'info',
        metric: `${cashShare.toFixed(0)}% cash`,
      })
    } else if (cashShare < 30) {
      score += 3
      insights.push({
        title: 'Pembayaran Digital Mendominasi',
        description: `Hanya ${cashShare.toFixed(0)}% transaksi cash. Cashless payment memudahkan operasional dan tracking.`,
        type: 'positive',
      })
    }
  }

  // 7. Weekly/Monthly projection
  if (d.thisWeek.revenue > 0) {
    const dayOfWeek = new Date().getDay()
    const daysElapsed = dayOfWeek === 0 ? 7 : dayOfWeek
    const dailyAvg = d.thisWeek.revenue / daysElapsed
    const projectedMonthly = dailyAvg * 30
    insights.push({
      title: 'Proyeksi Bulanan',
      description: `Berdasarkan rata-rata harian ${formatRp(dailyAvg)}, diproyeksikan revenue bulan ini mencapai ${formatRp(projectedMonthly)}.`,
      type: 'info',
      metric: formatRp(projectedMonthly),
    })
  }

  score = Math.max(0, Math.min(100, score))
  return { insights, score }
}

// ============================================================
// CTO Insight Generator
// ============================================================

function generateCTOInsights(d: InsightData): { insights: { title: string; description: string; type: 'positive' | 'warning' | 'info' | 'critical'; metric?: string }[]; score: number } {
  const insights: { title: string; description: string; type: 'positive' | 'warning' | 'info' | 'critical'; metric?: string }[] = []
  let score = 50

  // 1. Inventory Health
  if (d.products.outOfStock > 0) {
    score -= Math.min(15, d.products.outOfStock * 3)
    insights.push({
      title: 'Produk Habis Stok',
      description: `${d.products.outOfStock} dari ${d.products.total} produk habis stok (${((d.products.outOfStock / d.products.total) * 100).toFixed(0)}%). Ini berpotensi kehilangan penjualan. Segera lakukan restock.`,
      type: 'critical',
      metric: `${d.products.outOfStock} item`,
    })
  } else if (d.products.total > 0) {
    score += 10
    insights.push({
      title: 'Stok Aman',
      description: 'Semua produk memiliki stok. Tidak ada produk yang habis.',
      type: 'positive',
    })
  }

  if (d.products.lowStock > 0) {
    score -= Math.min(10, d.products.lowStock * 2)
    insights.push({
      title: 'Stok Rendah',
      description: `${d.products.lowStock} produk mendekati batas minimum stok. Perlu segera di-restock untuk menghindari kehabisan.`,
      type: 'warning',
      metric: `${d.products.lowStock} item`,
    })
  }

  // 2. Dead Stock Analysis
  if (d.dataQuality.deadStockCount > 0 && d.products.total > 0) {
    const deadRatio = d.dataQuality.deadStockCount / d.products.total
    if (deadRatio > 0.5) {
      score -= 10
      insights.push({
        title: 'Banyak Dead Stock',
        description: `${d.dataQuality.deadStockCount} produk (${(deadRatio * 100).toFixed(0)}%) memiliki stok tapi tidak laku terjual. Nilai tersumbat: ${formatRp(d.dataQuality.deadStockValue)}. Pertimbangkan clearance sale.`,
        type: 'critical',
        metric: formatRp(d.dataQuality.deadStockValue),
      })
    } else if (deadRatio > 0.2) {
      insights.push({
        title: 'Potensi Dead Stock',
        description: `${d.dataQuality.deadStockCount} produk jarang terjual. Nilai inventori tersumbat: ${formatRp(d.dataQuality.deadStockValue)}. Evaluasi apakah perlu diskon atau promo.`,
        type: 'warning',
        metric: `${d.dataQuality.deadStockCount} item`,
      })
    }
  }

  // 3. Inventory Value
  if (d.products.inventoryValue > 0) {
    insights.push({
      title: 'Nilai Inventori',
      description: `Total nilai inventori saat ini: ${formatRp(d.products.inventoryValue)} dari ${d.products.total} produk.`,
      type: 'info',
      metric: formatRp(d.products.inventoryValue),
    })
  }

  // 4. Data Quality
  const dataIssues: string[] = []
  if (d.dataQuality.productsWithoutCategory > 0) dataIssues.push(`${d.dataQuality.productsWithoutCategory} tanpa kategori`)
  if (d.dataQuality.productsWithoutSku > 0) dataIssues.push(`${d.dataQuality.productsWithoutSku} tanpa SKU`)
  if (d.dataQuality.productsWithoutImage > 0) dataIssues.push(`${d.dataQuality.productsWithoutImage} tanpa foto`)

  if (dataIssues.length > 0) {
    const totalIssues = d.dataQuality.productsWithoutCategory + d.dataQuality.productsWithoutSku + d.dataQuality.productsWithoutImage
    const dataScore = Math.max(0, 100 - ((totalIssues / d.products.total) * 100))
    if (dataScore < 60) {
      score -= 8
      insights.push({
        title: 'Kualitas Data Perlu Perbaikan',
        description: `Data produk tidak lengkap: ${dataIssues.join(', ')}. Kelengkapan data penting untuk analisis dan reporting yang akurat.`,
        type: 'warning',
        metric: `${dataScore.toFixed(0)}%`,
      })
    } else {
      insights.push({
        title: 'Data Cukup Lengkap',
        description: `Kelengkapan data produk ${dataScore.toFixed(0)}%. ${dataIssues.length > 0 ? `Perbaikan kecil: ${dataIssues.join(', ')}.` : ''}`,
        type: dataIssues.length > 0 ? 'info' : 'positive',
        metric: `${dataScore.toFixed(0)}%`,
      })
    }
  } else if (d.products.total > 0) {
    score += 5
    insights.push({
      title: 'Data Produk Lengkap',
      description: 'Semua produk memiliki kategori, SKU, dan foto. Sangat baik untuk operasional.',
      type: 'positive',
      metric: '100%',
    })
  }

  // 5. Peak Hours
  const busyHours = d.transactions.hourBuckets.filter(h => h.count >= 3)
  if (busyHours.length > 0) {
    const peakRange = busyHours.map(h => `${String(h.hour).padStart(2, '0')}:00`)
    insights.push({
      title: 'Jam Ramai Terdeteksi',
      description: `Jam sibuk hari ini: ${peakRange.join(', ')}. Pastikan crew tersedia di jam-jam ini untuk layanan optimal.`,
      type: 'info',
      metric: `${String(d.transactions.peakHour).padStart(2, '0')}:00`,
    })
  }

  // 6. Staffing Ratio
  if (d.outlet.totalCrew > 0 && d.today.transactions > 0) {
    const txPerCrew = d.today.transactions / d.outlet.totalCrew
    if (txPerCrew > 30) {
      insights.push({
        title: 'Beban Kerja Tinggi',
        description: `Rata-rata ${txPerCrew.toFixed(0)} transaksi per crew hari ini. Pertimbangkan tambah crew di jam puncak.`,
        type: 'warning',
        metric: `${txPerCrew.toFixed(0)} tx/crew`,
      })
    } else if (txPerCrew < 5 && d.today.transactions > 10) {
      insights.push({
        title: 'Overstaffing?',
        description: `Hanya ${txPerCrew.toFixed(0)} transaksi per crew. Crew mungkin berlebih untuk volume saat ini.`,
        type: 'info',
      })
    }
  }

  // 7. Discount Impact
  if (d.transactions.avgDiscount > 0) {
    const discountImpact = d.today.revenue > 0 ? (d.transactions.avgDiscount / d.today.avgOrder) * 100 : 0
    if (discountImpact > 20) {
      score -= 5
      insights.push({
        title: 'Diskon Terlalu Besar',
        description: `Rata-rata diskon ${formatRp(d.transactions.avgDiscount)} per transaksi (${discountImpact.toFixed(0)}% dari AOV). Evaluasi efektivitas promo — margin bisa tergerus.`,
        type: 'warning',
        metric: formatRp(d.transactions.avgDiscount),
      })
    } else {
      insights.push({
        title: 'Diskon Terkontrol',
        description: `Rata-rata diskon ${formatRp(d.transactions.avgDiscount)}/transaksi — masih dalam batas wajar.`,
        type: 'positive',
      })
    }
  }

  // 8. Transaction Volume Health
  if (d.thisWeek.transactions > 0 && d.yesterday.transactions > 0) {
    const dailyAvgWeek = d.thisWeek.transactions / Math.max(1, Math.min(7, new Date().getDay() || 7))
    const ratio = dailyAvgWeek / d.yesterday.transactions
    if (ratio > 1.3) {
      score += 5
      insights.push({
        title: 'Volume Transaksi Meningkat',
        description: `Rata-rata ${dailyAvgWeek.toFixed(0)} transaksi/hari minggu ini vs ${d.yesterday.transactions} kemarin. Tren volume naik.`,
        type: 'positive',
        metric: `${dailyAvgWeek.toFixed(0)}/hari`,
      })
    } else if (ratio < 0.7) {
      score -= 5
      insights.push({
        title: 'Volume Transaksi Menurun',
        description: `Hanya rata-rata ${dailyAvgWeek.toFixed(0)} transaksi/hari minggu ini. Bandingkan dengan minggu lalu untuk konfirmasi tren.`,
        type: 'warning',
      })
    }
  }

  // 9. Category Balance
  if (d.products.categoryDistribution.length > 1) {
    const maxCat = d.products.categoryDistribution.reduce((a, b) => a.count > b.count ? a : b)
    const imbalance = maxCat.count / d.products.total
    if (imbalance > 0.6) {
      insights.push({
        title: 'Distribusi Kategori Tidak Seimbang',
        description: `Kategori "${maxCat.name}" mendominasi ${d.products.total > 0 ? `${(imbalance * 100).toFixed(0)}` : '0'}% dari semua produk. Pertimbangkan diversifikasi kategori.`,
        type: 'info',
      })
    }
  }

  score = Math.max(0, Math.min(100, score))
  return { insights, score }
}

// ============================================================
// Helpers
// ============================================================

function formatRp(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function formatChange(pct: number): string {
  return pct > 0 ? `naik ${pct.toFixed(1)}%` : `turun ${Math.abs(pct).toFixed(1)}%`
}

// ============================================================
// API Handler
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Owner only', 403)

    const tzOffset = parseTzOffset(request.nextUrl.searchParams)
    const data = await aggregateData(user.outletId, tzOffset)
    const cmo = generateCMOInsights(data)
    const cto = generateCTOInsights(data)

    return safeJson({
      data,
      cmo,
      cto,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Insights analyze error:', error)
    return safeJsonError('Failed to analyze insights')
  }
}
