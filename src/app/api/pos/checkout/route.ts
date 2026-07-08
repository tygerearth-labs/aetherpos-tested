import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { generateInvoiceNumber, resolvePlanType } from '@/lib/api/api-helpers'
import { notifyNewTransaction } from '@/lib/notify'
import { notifyInsight } from '@/lib/notify'
import { runInsightEngine } from '@/lib/insight-engine'
import { getPlanFeatures, isUnlimited } from '@/lib/config/plan-config'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { ensureMigrated } from '@/lib/db-migrate'
import { InventoryConsumptionService } from '@/lib/inventory-consumption-service'

interface CheckoutItem {
  productId: string
  productName: string
  price: number
  qty: number
  subtotal?: number
  variantId?: string
  variantName?: string
  itemDiscount?: number
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const userId = user.id
    const outletId = user.outletId

    // Auto-migrate: ensure new columns exist (e.g. itemDiscount)
    await ensureMigrated()

    const body = await request.json()
    const {
      customerId,
      items,
      subtotal,
      discount,
      pointsUsed,
      total,
      paymentMethod,
      paidAmount,
      change,
      promoId,
      promoDiscount,
      taxAmount,
    } = body

    // Validate items
    if (!items || items.length === 0) {
      return safeJsonError('Cart is empty', 400)
    }

    const checkoutItems: CheckoutItem[] = items

    // K4: Monthly transaction limit check
    const outlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { accountType: true },
    })
    const accountType = resolvePlanType(outlet?.accountType)
    const features = getPlanFeatures(accountType)
    if (!isUnlimited(features.maxTransactionsPerMonth)) {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthTxCount = await db.transaction.count({
        where: {
          outletId,
          createdAt: { gte: monthStart },
        },
      })
      if (monthTxCount >= features.maxTransactionsPerMonth) {
        return safeJsonError(`Batas transaksi bulanan untuk paket ${accountType} sudah tercapai (${features.maxTransactionsPerMonth}). Upgrade ke Pro untuk unlimited!`, 400)
      }
    }

    // K5: Validate paymentMethod against outlet settings
    if (paymentMethod) {
      const setting = await db.outletSetting.findUnique({
        where: { outletId },
        select: { paymentMethods: true },
      })
      if (setting?.paymentMethods) {
        const allowedMethods = setting.paymentMethods.split(',').map((m) => m.trim().toUpperCase())
        if (!allowedMethods.includes(paymentMethod.toUpperCase())) {
          return safeJsonError(`Metode pembayaran "${paymentMethod}" tidak tersedia. Metode yang diizinkan: ${setting.paymentMethods}`, 400)
        }
      }
    }

    const result = await db.$transaction(async (tx) => {
      // 1. Collect all variant IDs and product IDs
      const variantIds = checkoutItems
        .filter((item) => item.variantId)
        .map((item) => item.variantId!)
      const productIds = checkoutItems.map((item) => item.productId)

      // Batch fetch products and variants
      const [products, variants] = await Promise.all([
        tx.product.findMany({
          where: { id: { in: productIds }, outletId },
        }),
        variantIds.length > 0
          ? tx.productVariant.findMany({
              where: { id: { in: variantIds }, outletId },
            })
          : ([] as Array<{ id: string; productId: string; name: string; stock: number; hpp: number; sku: string | null }>),
      ])

      const productMap = new Map<string, typeof products[number]>()
      for (const p of products) productMap.set(p.id, p)
      const variantMap = new Map<string, typeof variants[number]>()
      for (const v of variants) variantMap.set(v.id, v)

      // 2. Validate item existence (stock validated atomically at decrement time)
      for (const item of checkoutItems) {
        const product = productMap.get(item.productId)
        if (!product) {
          throw new Error(`Product ${item.productName} not found`)
        }

        if (item.variantId) {
          const variant = variantMap.get(item.variantId)
          if (!variant) {
            throw new Error(`Variant ${item.variantName || item.variantId} not found`)
          }
          if (variant.productId !== item.productId) {
            throw new Error(`Variant ${item.variantName || item.variantId} does not belong to product ${item.productName}`)
          }
        }
      }

      // 3. Validate payment for CASH
      if (paymentMethod === 'CASH') {
        if (paidAmount < total) {
          throw new Error('Insufficient payment amount')
        }
      }

      // 4. Generate invoice number
      const invoiceNumber = generateInvoiceNumber()

      // Check for invoice uniqueness
      const existingInvoice = await tx.transaction.findUnique({
        where: { invoiceNumber },
      })
      if (existingInvoice) {
        throw new Error('Invoice number collision — please try again')
      }

      // 5. Create Transaction record
      const transaction = await tx.transaction.create({
        data: {
          invoiceNumber,
          subtotal,
          discount: discount || 0,
          pointsUsed: pointsUsed || 0,
          taxAmount: taxAmount || 0,
          total,
          paymentMethod,
          paidAmount: paidAmount || 0,
          change: change || 0,
          outletId,
          customerId: customerId || null,
          userId,
        },
      })

      // 6. Batch create TransactionItems
      //    productName & variantName: server-verified from DB (not trusted from client)
      //    productSku & variantSku: snapshotted from DB at sale time
      //    hpp: snapshotted from DB at sale time
      //    price: kept from client (effective selling price at checkout, may include custom price)
      const itemData = checkoutItems.map((item) => {
        const product = productMap.get(item.productId)!
        const variant = item.variantId ? variantMap.get(item.variantId) : null

        // Server-side name verification — log if client name differs from DB
        const verifiedProductName = product.name
        const verifiedVariantName = variant?.name || item.variantName || null
        if (item.productName && item.productName !== product.name) {
          console.warn(
            `[checkout] productName mismatch: client="${item.productName}" db="${product.name}" productId=${product.id} invoice=${invoiceNumber}`
          )
        }
        if (item.variantName && variant && item.variantName !== variant.name) {
          console.warn(
            `[checkout] variantName mismatch: client="${item.variantName}" db="${variant.name}" variantId=${variant.id} invoice=${invoiceNumber}`
          )
        }

        return {
          productId: item.productId,
          productName: verifiedProductName,
          productSku: product.sku || null,
          variantId: item.variantId || null,
          variantName: verifiedVariantName,
          variantSku: variant?.sku || null,
          price: item.price,
          qty: item.qty,
          subtotal: item.price * item.qty,
          itemDiscount: item.itemDiscount || 0,
          hpp: variant ? variant.hpp : product.hpp,
          transactionId: transaction.id,
        }
      })

      await tx.transactionItem.createMany({ data: itemData })

      // 7. ATOMIC stock deduction — race-condition-free
      //    Uses raw SQL: UPDATE ... SET stock = stock - qty WHERE stock >= qty
      //    This is atomic in SQLite: the WHERE check and decrement happen together.
      //    If affected rows = 0, another transaction consumed the last stock.
      for (const item of checkoutItems) {
        const product = productMap.get(item.productId)!
        if (item.variantId) {
          const affected = await tx.$executeRaw`
            UPDATE "ProductVariant" SET stock = stock - ${item.qty}
            WHERE id = ${item.variantId} AND stock >= ${item.qty} AND "outletId" = ${outletId}
          `
          if (affected === 0) {
            throw new Error(
              `Stok tidak cukup untuk ${product.name} - ${item.variantId}. Kemungkinan stok terakhir sudah diambil transaksi lain. Coba lagi.`
            )
          }
        } else {
          const affected = await tx.$executeRaw`
            UPDATE "Product" SET stock = stock - ${item.qty}
            WHERE id = ${item.productId} AND stock >= ${item.qty} AND "outletId" = ${outletId}
          `
          if (affected === 0) {
            throw new Error(
              `Stok tidak cukup untuk ${product.name}. Kemungkinan stok terakhir sudah diambil transaksi lain. Coba lagi.`
            )
          }
        }
      }

      // 7b. Recalculate parent product stock for variant products (atomic)
      const variantProductIds = new Set<string>()
      for (const item of checkoutItems) {
        if (item.variantId) variantProductIds.add(item.productId)
      }
      for (const productId of variantProductIds) {
        await tx.$executeRaw`
          UPDATE "Product" SET stock = (
            SELECT COALESCE(SUM(stock), 0) FROM "ProductVariant"
            WHERE "productId" = ${productId} AND "outletId" = ${outletId}
          )
          WHERE id = ${productId}
        `
      }

      // 7c. Re-read updated stock for audit logs (post-atomic decrement)
      const [updatedProducts, updatedVariants] = await Promise.all([
        tx.product.findMany({
          where: { id: { in: productIds }, outletId },
          select: { id: true, stock: true },
        }),
        variantIds.length > 0
          ? tx.productVariant.findMany({
              where: { id: { in: variantIds }, outletId },
              select: { id: true, stock: true },
            })
          : Promise.resolve([] as Array<{ id: string; stock: number }>),
      ])
      const updatedProductMap = new Map<string, number>(updatedProducts.map(p => [p.id, p.stock] as const))
      const updatedVariantMap = new Map<string, number>(updatedVariants.map(v => [v.id, v.stock] as const))

      // 7c. Deduct inventory via InventoryConsumptionService (atomic, yield-aware, validated)
      //     Jika stok bahan tidak cukup → error → seluruh transaksi di-rollback
      const consumptionResult = await InventoryConsumptionService.consumeForTransaction(tx, {
        items: checkoutItems.map(item => ({
          productId: item.productId,
          variantId: item.variantId || null,
          productName: item.productName,
          variantName: item.variantName || null,
          qty: item.qty,
        })),
        transactionId: transaction.id,
        invoiceNumber,
        outletId,
        userId,
      })

      // 7d. Snapshot consumption data for accurate void reversal later
      //     This ensures void restores exactly what was consumed, even if
      //     the product recipe/composition changes months after the sale.
      if (consumptionResult.deductions.length > 0) {
        const snapshots = InventoryConsumptionService.buildConsumptionSnapshots(
          consumptionResult.deductions,
          transaction.id,
        )
        await tx.transactionConsumption.createMany({ data: snapshots })
      }

      // 8. Batch create audit logs
      const auditData = checkoutItems.map((item) => {
        const product = productMap.get(item.productId)!
        const variant = item.variantId ? variantMap.get(item.variantId) : null

        const newStock = item.variantId
          ? updatedVariantMap.get(item.variantId) ?? 0
          : updatedProductMap.get(item.productId) ?? 0
        const previousStock = newStock + item.qty // derive previous from new + qty (accurate because atomic)

        if (variant) {
          return {
            action: 'SALE' as const,
            entityType: 'VARIANT' as const,
            entityId: item.variantId,
            details: JSON.stringify({
              invoiceNumber,
              productName: item.productName,
              productSku: product.sku || null,
              variantName: item.variantName,
              variantSku: variant?.sku || null,
              quantitySold: item.qty,
              price: item.price,
              subtotal: item.price * item.qty,
              previousStock,
              newStock,
            }),
            outletId,
            userId,
          }
        }

        return {
          action: 'SALE' as const,
          entityType: 'PRODUCT' as const,
          entityId: item.productId,
          details: JSON.stringify({
            invoiceNumber,
            productName: item.productName,
            productSku: product.sku || null,
            quantitySold: item.qty,
            price: item.price,
            subtotal: item.price * item.qty,
            previousStock,
            newStock,
          }),
          outletId,
          userId,
        }
      })
      if (auditData.length > 0) {
        await tx.auditLog.createMany({ data: auditData })
      }

      // 9. Handle customer loyalty
      if (customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: customerId, outletId },
        })
        if (!customer) {
          throw new Error('Customer not found')
        }

        const pointsToUse = pointsUsed || 0

        // Check points balance
        if (pointsToUse > customer.points) {
          throw new Error(
            `Insufficient points. Available: ${customer.points}, Requested: ${pointsToUse}`
          )
        }

        // Calculate earned points based on outlet loyalty settings
        let earnedPoints = 0
        const setting = await tx.outletSetting.findUnique({
          where: { outletId },
          select: { loyaltyEnabled: true, loyaltyPointsPerAmount: true },
        })
        if (setting?.loyaltyEnabled && setting.loyaltyPointsPerAmount > 0) {
          earnedPoints = Math.floor(total / setting.loyaltyPointsPerAmount)
        }

        // Combine customer updates into a single query
        const customerUpdateData: { totalSpend: { increment: number }; points?: { increment: number } | { decrement: number } } = {
          totalSpend: { increment: total },
        }
        let netPointsDelta = 0
        if (earnedPoints > 0) netPointsDelta += earnedPoints
        if (pointsToUse > 0) netPointsDelta -= pointsToUse
        if (netPointsDelta !== 0) {
          customerUpdateData.points = netPointsDelta > 0
            ? { increment: netPointsDelta }
            : { decrement: Math.abs(netPointsDelta) }
        }

        await tx.customer.update({
          where: { id: customerId },
          data: customerUpdateData,
        })

        // Create loyalty logs in batch
        const loyaltyLogs: Array<{
          type: 'EARN' | 'REDEEM'
          points: number
          description: string
          customerId: string
          transactionId: string
        }> = []
        if (earnedPoints > 0) {
          loyaltyLogs.push({
            type: 'EARN',
            points: earnedPoints,
            description: `Earned ${earnedPoints} points from transaction ${invoiceNumber} (Rp ${total.toLocaleString('id-ID')})`,
            customerId,
            transactionId: transaction.id,
          })
        }
        if (pointsToUse > 0) {
          const pointsDiscount = pointsToUse * 100
          loyaltyLogs.push({
            type: 'REDEEM',
            points: -pointsToUse,
            description: `Redeemed ${pointsToUse} points for Rp ${pointsDiscount.toLocaleString('id-ID')} discount on transaction ${invoiceNumber}`,
            customerId,
            transactionId: transaction.id,
          })
        }
        if (loyaltyLogs.length > 0) {
          await tx.loyaltyLog.createMany({ data: loyaltyLogs })
        }
      }

      return { invoiceNumber }
    }, { timeout: 15000 })

    // H4: Post-transaction notification — properly awaited to ensure delivery.
    //     Wrapped in try/catch so a notification failure never causes a
    //     "checkout failed" response when data was already saved.
    let cashierName = userId
    let outletName = 'Outlet'
    try {
      const [cashierUser, outletData, customerData] = await Promise.all([
        db.user.findUnique({ where: { id: userId }, select: { name: true } }),
        db.outlet.findUnique({ where: { id: outletId }, select: { name: true } }),
        customerId
          ? db.customer.findUnique({ where: { id: customerId }, select: { name: true } })
          : Promise.resolve(null),
      ])
      cashierName = cashierUser?.name || userId
      outletName = outletData?.name || 'Outlet'
      const customerName = customerData?.name || undefined

      console.log(`[checkout] Sending Telegram notification for ${result.invoiceNumber} (outlet: ${outletId})`)

      // MUST await — fire-and-forget doesn't work reliably in Next.js App Router
      await notifyNewTransaction(outletId, {
        invoiceNumber: result.invoiceNumber,
        items: checkoutItems.map((item) => ({
          productName: item.productName,
          variantName: item.variantName || undefined,
          price: item.price,
          qty: item.qty,
          subtotal: item.subtotal || item.price * item.qty,
        })),
        subtotal,
        discount: discount || 0,
        taxAmount: taxAmount || 0,
        total,
        paymentMethod,
        paidAmount: paidAmount || 0,
        change: change || 0,
        customerName,
        cashierName,
        outletName,
      })

      console.log(`[checkout] ✅ Telegram notification completed for ${result.invoiceNumber}`)
    } catch (notifyError) {
      // Notification lookups / sending are best-effort; never fail the checkout
      console.error('[checkout] Post-checkout notification error (non-fatal):', notifyError)
    }

    // Fire-and-forget: Trigger insight notification after checkout
    // Only runs every ~5 transactions to avoid spam (uses rate limiter in notifyInsight)
    triggerInsightAfterCheckout(outletId).catch(() => {})

    return safeJson({
      success: true,
      invoiceNumber: result.invoiceNumber,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Checkout failed'
    console.error('Checkout POST error:', error)
    return safeJsonError(message, 400)
  }
}

// ============================================================
// Insight Trigger After Checkout
// ============================================================

// In-memory counter to throttle insight checks after checkout
const insightCheckCounters = new Map<string, { count: number; resetAt: number }>()
const INSIGHT_CHECK_INTERVAL = 5 // Check every 5 transactions per outlet

async function triggerInsightAfterCheckout(outletId: string): Promise<void> {
  // Throttle: only run insight every N transactions
  const now = Date.now()
  const counter = insightCheckCounters.get(outletId)

  if (counter && now < counter.resetAt) {
    counter.count++
    if (counter.count < INSIGHT_CHECK_INTERVAL) {
      return // Not yet time to check
    }
  } else {
    insightCheckCounters.set(outletId, { count: 1, resetAt: now + 30 * 60 * 1000 }) // 30 min window
    return // First in window, skip
  }

  // Reset counter
  insightCheckCounters.set(outletId, { count: 0, resetAt: now + 30 * 60 * 1000 })

  // Fetch quick data for insight engine
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const yesterday = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)

  try {
    const [todayTxns, yesterdayTxns, products] = await Promise.all([
      db.transaction.findMany({
        where: { outletId, createdAt: { gte: todayStart } },
        select: { subtotal: true, total: true, discount: true, items: { select: { productName: true, qty: true, price: true } } },
      }),
      db.transaction.findMany({
        where: { outletId, createdAt: { gte: yesterday, lt: todayStart } },
        select: { total: true, items: { select: { productName: true, qty: true } } },
      }),
      db.product.findMany({
        where: { outletId },
        select: { id: true, name: true, stock: true, lowStockAlert: true, price: true },
      }),
    ])

    const todayNetto = todayTxns.reduce((s, t) => s + t.total, 0)
    const yesterdayNetto = yesterdayTxns.reduce((s, t) => s + t.total, 0)

    const outOfStockCount = products.filter(p => p.stock <= 0).length
    const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= p.lowStockAlert).length

    // Top selling (by qty today)
    const productQtyMap = new Map<string, { qty: number; revenue: number; stock: number; lowStockAlert: number }>()
    for (const txn of todayTxns) {
      for (const item of txn.items) {
        const existing = productQtyMap.get(item.productName) || { qty: 0, revenue: 0, stock: 0, lowStockAlert: 5 }
        existing.qty += item.qty
        existing.revenue += item.price * item.qty
        productQtyMap.set(item.productName, existing)
      }
    }
    // Merge stock info
    for (const [name, data] of productQtyMap) {
      const p = products.find(pr => pr.name === name)
      if (p) {
        data.stock = p.stock
        data.lowStockAlert = p.lowStockAlert
      }
    }
    const topSelling = [...productQtyMap.entries()]
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 5)
      .map(([name, data]) => ({ name, ...data }))

    const avgPrice = products.length > 0 ? products.reduce((s, p) => s + p.price, 0) / products.length : 0

    const engineResult = runInsightEngine({
      todayRevenue: todayNetto,
      yesterdayRevenue: yesterdayNetto,
      todayTransactions: todayTxns.length,
      yesterdayTransactions: yesterdayTxns.length,
      todayAOV: todayTxns.length > 0 ? todayNetto / todayTxns.length : 0,
      yesterdayAOV: yesterdayTxns.length > 0 ? yesterdayNetto / yesterdayTxns.length : 0,
      totalProducts: products.length,
      lowStockCount,
      outOfStockCount,
      topSelling,
      totalCustomers: 0,
      repeatCustomersThisWeek: 0,
      newCustomersThisWeek: 0,
      avgProductPrice: avgPrice,
      todayProfit: null,
      todayBrutto: todayTxns.reduce((s, t) => s + t.subtotal, 0),
      todayDiscount: todayTxns.reduce((s, t) => s + t.discount, 0),
      todayTax: 0,
      // New inventory/transfer/purchase fields (defaults for POS context)
      lowInventoryCount: 0,
      outOfInventoryCount: 0,
      inventoryAlerts: [],
      totalInventoryValue: 0,
      pendingTransfers: 0,
      pendingTransferItems: 0,
      pendingPurchases: 0,
      pendingPurchaseValue: 0,
      topVariantSelling: [],
    })

    // Filter out non-actionable insights
    const actionableInsights = engineResult.insights.filter(i => i.id !== 'all-good')

    if (actionableInsights.length > 0) {
      await notifyInsight(
        outletId,
        actionableInsights.map(i => ({
          id: i.id,
          title: i.title,
          why: i.why,
          actions: i.actions,
          priority: i.priority,
          emoji: i.emoji,
          outletName: 'Outlet',
          healthScore: engineResult.healthScore,
        })),
        engineResult.healthScore
      )
    }
  } catch {
    // Silent fail — insight notification is non-critical
  }
}
