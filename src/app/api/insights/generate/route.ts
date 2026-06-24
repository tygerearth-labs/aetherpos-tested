import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getVoidedTxIds, parseTzOffset, getTodayRangeTz, getHourInTimezone } from '@/lib/api-helpers'
import { safeJson, safeJsonError } from '@/lib/safe-response'
import ZAI from 'z-ai-web-dev-sdk'

export const maxDuration = 60

// ── Reusable data aggregator (same logic as GET /api/insights) ──
async function aggregateInsightData(outletId: string, tzOffset: number | null) {
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

  const [allProducts, categories, topSellingItems, totalCustomers, newThisWeekCount, topSpenders, setting, loyaltyStats, paymentGroups, todayFullTxs, outlet] = await Promise.all([
    db.product.findMany({ where: { outletId }, select: { id: true, name: true, stock: true, lowStockAlert: true, price: true, hpp: true, categoryId: true, hasVariants: true, variants: { select: { price: true, stock: true } } } }),
    db.category.findMany({ where: { outletId }, select: { id: true, name: true, products: { select: { id: true } } } }),
    db.transactionItem.groupBy({ by: ['productName'], where: { transaction: { outletId, ...voidExclude } }, _sum: { qty: true, subtotal: true }, orderBy: { _sum: { qty: 'desc' } }, take: 10 }),
    db.customer.count({ where: { outletId } }),
    db.customer.count({ where: { outletId, createdAt: { gte: weekAgo } } }),
    db.customer.findMany({ where: { outletId }, orderBy: { totalSpend: 'desc' }, take: 5, select: { name: true, totalSpend: true, points: true } }),
    db.outletSetting.findUnique({ where: { outletId } }),
    db.loyaltyLog.aggregate({ where: { customer: { outletId }, type: 'EARN' }, _sum: { points: true } }),
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
  const outOfStock = allProducts.filter((p) => getAggStock(p) === 0).length
  const lowStock = allProducts.filter((p) => { const s = getAggStock(p); return s > 0 && s <= p.lowStockAlert }).length
  const inventoryValue = allProducts.reduce((s, p) => s + (getAggPrice(p) * getAggStock(p)), 0)
  const avgPrice = totalProducts > 0 ? allProducts.reduce((s, p) => s + getAggPrice(p), 0) / totalProducts : 0

  const avgSpendPerCustomer = totalCustomers > 0
    ? (await db.customer.aggregate({ where: { outletId }, _avg: { totalSpend: true } }))._avg.totalSpend ?? 0
    : 0

  const hourBuckets = new Map<number, { count: number; revenue: number }>()
  for (let h = 0; h < 24; h++) hourBuckets.set(h, { count: 0, revenue: 0 })
  for (const t of todayFullTxs) {
    const h = tzOffset !== null
      ? getHourInTimezone(t.createdAt, tzOffset)
      : t.createdAt.getHours()
    const b = hourBuckets.get(h)!
    b.count++
    b.revenue += t.total
  }
  let peakHour = 0
  let peakHourRevenue = 0
  let peakHourCount = 0
  for (const [h, b] of hourBuckets) {
    if (b.count > peakHourCount) {
      peakHourCount = b.count
      peakHour = h
      peakHourRevenue = b.revenue
    }
  }

  return {
    today: { revenue: todayRevenue, transactions: todayTxs.length, avgOrder: todayAvgOrder },
    yesterday: { revenue: yesterdayRevenue, transactions: yesterdayTxs.length, avgOrder: yesterdayAvgOrder },
    thisWeek: { revenue: weekRevenue, transactions: weekTxs.length },
    thisMonth: { revenue: monthRevenue, transactions: monthTxs.length },
    products: {
      total: totalProducts,
      outOfStock,
      lowStock,
      categories: categories.length,
      topSelling: topSellingItems.map((i) => ({ name: i.productName, qty: i._sum.qty ?? 0, revenue: i._sum.subtotal ?? 0 })),
      categoryDistribution: categories.map((c) => ({ name: c.name, count: c.products.length })),
      inventoryValue,
      avgPrice,
    },
    customers: {
      total: totalCustomers,
      newThisWeek: newThisWeekCount,
      loyaltyEnabled: setting?.loyaltyEnabled ?? false,
      totalPointsIssued: loyaltyStats._sum.points ?? 0,
      avgSpendPerCustomer,
      topSpenders: topSpenders.map((c) => ({ name: c.name, totalSpend: c.totalSpend, points: c.points })),
    },
    transactions: {
      paymentMethods: paymentGroups.map((g) => ({ method: g.paymentMethod, count: g._count.id, total: g._sum.total ?? 0 })),
      peakHour,
      peakHourRevenue,
      avgDiscount: todayTxs.length > 0 ? todayDiscount / todayTxs.length : 0,
    },
    outlet: { name: outlet?.name ?? 'Unknown', totalCrew: outlet?.users.length ?? 0, accountType: outlet?.accountType ?? 'free' },
  }
}

function formatRp(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function buildDataContext(data: Awaited<ReturnType<typeof aggregateInsightData>>): string {
  return `
## DATA PENJUALAN OUTLET: "${data.outlet.name}"
Tanggal: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

### Penjualan Harian
- Hari ini: ${formatRp(data.today.revenue)} (${data.today.transactions} transaksi, rata-rata ${formatRp(data.today.avgOrder)}/trx)
- Kemarin: ${formatRp(data.yesterday.revenue)} (${data.yesterday.transactions} transaksi)
- Minggu ini: ${formatRp(data.thisWeek.revenue)} (${data.thisWeek.transactions} transaksi)
- Bulan ini: ${formatRp(data.thisMonth.revenue)} (${data.thisMonth.transactions} transaksi)

### Produk
- Total: ${data.products.total} produk dalam ${data.products.categories} kategori
- Stok habis (0): ${data.products.outOfStock} produk
- Stok rendah: ${data.products.lowStock} produk
- Nilai inventori: ${formatRp(data.products.inventoryValue)}
- Rata-rata harga: ${formatRp(data.products.avgPrice)}
- Top 5 produk:
${data.products.topSelling.map((p, i) => `  ${i + 1}. ${p.name} — ${p.qty} unit terjual, revenue ${formatRp(p.revenue)}`).join('\n')}
- Distribusi kategori:
${data.products.categoryDistribution.map((c) => `  ${c.name}: ${c.count} produk`).join('\n')}

### Customer
- Total: ${data.customers.total} customer
- Baru minggu ini: ${data.customers.newThisWeek}
- Program loyalitas: ${data.customers.loyaltyEnabled ? 'Aktif' : 'Tidak aktif'}
- Total poin diterbitkan: ${data.customers.totalPointsIssued}
- Rata-rata spend/customer: ${formatRp(data.customers.avgSpendPerCustomer)}
- Top 5 customer:
${data.customers.topSpenders.map((c, i) => `  ${i + 1}. ${c.name} — total ${formatRp(c.totalSpend)}, ${c.points} poin`).join('\n')}

### Pola Transaksi
- Metode pembayaran:
${data.transactions.paymentMethods.map((p) => `  ${p.method}: ${p.count} trx (${formatRp(p.total)})`).join('\n')}
- Jam puncak hari ini: ${String(data.peakHour).padStart(2, '0')}:00 (${formatRp(data.peakHourRevenue)} revenue)
- Rata-rata diskon per transaksi: ${formatRp(data.transactions.avgDiscount)}

### Info Outlet
- Tipe akun: ${data.outlet.accountType}
- Total crew: ${data.outlet.totalCrew}
`.trim()
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Owner only', 403)

    // Aggregate data
    const tzOffset = parseTzOffset(request.nextUrl.searchParams)
    const data = await aggregateInsightData(user.outletId, tzOffset)
    const dataContext = buildDataContext(data)
    const outletName = data.outlet.name

    const zai = await ZAI.create()

    // ── CMO Insights ──
    const cmoSystemPrompt = `Kamu adalah Chief Marketing Officer (CMO) untuk bisnis retail/UMKM bernama "${outletName}".
Berdasarkan data berikut, berikan 3-5 insight strategis marketing yang actionable.
Fokus pada: revenue growth, customer acquisition, product mix, pricing strategy, promotional opportunities.
Format: Gunakan bullet points (•), singkat dan padat, bahasa Indonesia.
Jika data terlalu sedikit, berikan insight berdasarkan pola umum UMKM Indonesia.`

    const cmoCompletion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: cmoSystemPrompt },
        { role: 'user', content: dataContext },
      ],
      thinking: { type: 'disabled' },
    })
    const cmoInsight = cmoCompletion.choices[0]?.message?.content ?? 'Gagal menghasilkan insight CMO.'

    // ── CTO Insights ──
    const ctoSystemPrompt = `Kamu adalah Chief Technology Officer (CTO) untuk bisnis retail/UMKM bernama "${outletName}".
Berdasarkan data berikut, berikan 3-5 insight strategis operational yang actionable.
Fokus pada: inventory efficiency, stock management, operational optimization, data health, automation opportunities.
Format: Gunakan bullet points (•), singkat dan padat, bahasa Indonesia.
Jika data terlalu sedikit, berikan insight berdasarkan pola umum UMKM Indonesia.`

    const ctoCompletion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: ctoSystemPrompt },
        { role: 'user', content: dataContext },
      ],
      thinking: { type: 'disabled' },
    })
    const ctoInsight = ctoCompletion.choices[0]?.message?.content ?? 'Gagal menghasilkan insight CTO.'

    return safeJson({
      cmo: cmoInsight,
      cto: ctoInsight,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Insights generate error:', error)
    return safeJsonError('Failed to generate AI insights')
  }
}
