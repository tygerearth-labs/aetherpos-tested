import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { generateInvoiceNumber, resolvePlanType } from '@/lib/api/api-helpers'
import { notifyNewTransaction } from '@/lib/notify'
import { notifyInsight } from '@/lib/notify'
import { runInsightEngine } from '@/lib/insight-engine'
import { getPlanFeatures, isUnlimited } from '@/lib/config/plan-config'
import { assertOutletWithinLimits } from '@/lib/api/plan-enforcement'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { ensureMigrated } from '@/lib/db-migrate'
import { InventoryConsumptionService } from '@/lib/inventory-consumption-service'
import { emitAuditEvent, buildSaleEvent } from '@/lib/audit-v2'
import { createCheckoutPerf, trackedQuery, isPerfEnabled, type CheckoutPerf } from '@/lib/perf-timer'
import { txPhase, formatTxError, isTransactionAbortedError } from '@/lib/tx-phase'

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
  const perf = createCheckoutPerf()
  perf.start('total')
  try {
    perf.start('auth')
    const user = await getAuthUser(request)
    perf.end('auth')
    if (!user) {
      return unauthorized()
    }
    const userId = user.id
    const outletId = user.outletId

    perf.start('migrate')
    // Auto-migrate: ensure new columns exist (e.g. itemDiscount)
    await ensureMigrated()
    perf.end('migrate')

    perf.start('planLimit')
    // FIX-PLAN-007: Block ALL mutations when the outlet is over-limit after
    // a downgrade (e.g. Pro→Free with 200 products but Free maxProducts=50).
    // Read-only GET endpoints remain allowed so the owner can still see their
    // data and decide what to delete.
    const overLimitResponse = await assertOutletWithinLimits(outletId)
    perf.end('planLimit')
    if (overLimitResponse) {
      perf.end('total')
      return overLimitResponse
    }

    perf.start('validation')
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
      perf.end('validation')
      return safeJsonError('Cart is empty', 400)
    }

    const checkoutItems: CheckoutItem[] = items

    // AUDIT-1-002 FIX: Reject non-positive qty (fraud / stock inflation).
    // Previously `qty=-5` was accepted → `UPDATE Product SET stock = stock - (-5)
    // WHERE stock >= -5` succeeded (the WHERE is always true for negative qty) →
    // stock INCREASED. Verified by audit: stock 48→53, transaction qty=-5.
    for (const item of checkoutItems) {
      if (!Number.isFinite(item.qty) || item.qty <= 0) {
        return safeJsonError(`Jumlah qty tidak valid untuk ${item.productName}. Qty harus lebih besar dari 0.`, 400)
      }
      if (!Number.isFinite(item.price) || item.price < 0) {
        return safeJsonError(`Harga tidak valid untuk ${item.productName}.`, 400)
      }
      if (!Number.isFinite(item.subtotal) || item.subtotal < 0) {
        return safeJsonError(`Subtotal tidak valid untuk ${item.productName}.`, 400)
      }
    }

    // AUDIT-1-003 FIX: Server-side recompute of subtotal & total (anti-fraud).
    // Previously the server trusted client-supplied subtotal/total verbatim.
    // Verified by audit: sent total=1000 for items summing to 18000 → recorded
    // total=1000 (undercharging). Now we recompute from items and reject if the
    // client values diverge by more than Rp 1 (rounding tolerance).
    //
    // Formula mirrors the client (pos-page.tsx handleCheckout):
    //   subtotal = Σ(item.price * item.qty)
    //   discount = manualDiscount + pointsDiscount + promoDiscount  (already
    //              includes the points-cash-value, so we do NOT subtract
    //              pointsUsed*100 again here)
    //   total    = subtotal - discount + taxAmount
    const computedSubtotal = checkoutItems.reduce((sum, it) => sum + (it.price * it.qty), 0)

    // ── SETTINGS CONTRACT — PPN (tax) server-side validation ──────────────
    // The server is authoritative for ppnEnabled/ppnRate (OutletSetting), exactly
    // as it already is for subtotal/total (AUDIT-1-003) and paymentMethod (K5).
    // Previously the server trusted the client-supplied taxAmount verbatim, so a
    // stale/offline POS client could charge the wrong tax after the owner changed
    // PPN settings. Now we recompute the expected tax from DB settings and reject
    // on mismatch (> Rp 1 rounding tolerance), forcing the POS to respect the
    // current server-side PPN configuration.
    const outletSetting = await trackedQuery(perf, () => db.outletSetting.findUnique({
      where: { outletId },
      select: { ppnEnabled: true, ppnRate: true, paymentMethods: true, loyaltyEnabled: true, loyaltyPointsPerAmount: true, loyaltyPointValue: true },
    }))
    const serverPpnEnabled = outletSetting?.ppnEnabled ?? false
    const serverPpnRate = outletSetting?.ppnRate ?? 11
    const baseAfterDiscounts = Math.max(0, computedSubtotal - (discount || 0))
    const serverTaxAmount = serverPpnEnabled
      ? Math.round((baseAfterDiscounts * (serverPpnRate || 0)) / 100)
      : 0
    if (Math.abs((taxAmount || 0) - serverTaxAmount) > 1) {
      return safeJsonError(
        `Pajak (PPN) tidak sesuai pengaturan. Server: ${serverPpnEnabled ? `PPN ${serverPpnRate}% = Rp ${serverTaxAmount.toLocaleString('id-ID')}` : 'PPN nonaktif = Rp 0'}, ` +
        `Klien: Rp ${(taxAmount || 0).toLocaleString('id-ID')}. Muat ulang pengaturan kasir lalu coba lagi.`,
        400
      )
    }

    const computedTotal = computedSubtotal - (discount || 0) + serverTaxAmount
    if (Math.abs((subtotal || 0) - computedSubtotal) > 1) {
      return safeJsonError(
        `Subtotal tidak sesuai. Server: Rp ${computedSubtotal.toLocaleString('id-ID')}, ` +
        `Klien: Rp ${(subtotal || 0).toLocaleString('id-ID')}. Transaksi ditolak.`,
        400
      )
    }
    if (Math.abs((total || 0) - computedTotal) > 1) {
      return safeJsonError(
        `Total tidak sesuai. Server: Rp ${computedTotal.toLocaleString('id-ID')}, ` +
        `Klien: Rp ${(total || 0).toLocaleString('id-ID')}. Transaksi ditolak.`,
        400
      )
    }

    // K4: Monthly transaction limit check
    const outlet = await trackedQuery(perf, () => db.outlet.findUnique({
      where: { id: outletId },
      select: { accountType: true },
    }))
    const accountType = resolvePlanType(outlet?.accountType)
    const features = getPlanFeatures(accountType)
    if (!isUnlimited(features.maxTransactionsPerMonth)) {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthTxCount = await trackedQuery(perf, () => db.transaction.count({
        where: {
          outletId,
          createdAt: { gte: monthStart },
        },
      }))
      if (monthTxCount >= features.maxTransactionsPerMonth) {
        perf.end('validation')
        return safeJsonError(`Batas transaksi bulanan untuk paket ${accountType} sudah tercapai (${features.maxTransactionsPerMonth}). Upgrade ke Pro untuk unlimited!`, 400)
      }
    }

    // K5: Validate paymentMethod against outlet settings (reuses the
    // outletSetting row fetched above for PPN validation — single query).
    if (paymentMethod && outletSetting?.paymentMethods) {
      const allowedMethods = outletSetting.paymentMethods.split(',').map((m) => m.trim().toUpperCase())
      if (!allowedMethods.includes(paymentMethod.toUpperCase())) {
        perf.end('validation')
        return safeJsonError(`Metode pembayaran "${paymentMethod}" tidak tersedia. Metode yang diizinkan: ${outletSetting.paymentMethods}`, 400)
      }
    }
    perf.end('validation')

    perf.start('transaction')
    const result = await db.$transaction(async (tx) => {
      perf.start('productLoad')
      // 1. Collect all variant IDs and product IDs
      const variantIds = checkoutItems
        .filter((item) => item.variantId)
        .map((item) => item.variantId!)
      const productIds = checkoutItems.map((item) => item.productId)

      // Batch fetch products and variants
      const [products, variants] = await Promise.all([
        trackedQuery(perf, () => tx.product.findMany({
          where: { id: { in: productIds }, outletId },
        })),
        variantIds.length > 0
          ? trackedQuery(perf, () => tx.productVariant.findMany({
              where: { id: { in: variantIds }, outletId },
            }))
          : ([] as Array<{ id: string; productId: string; name: string; stock: number; hpp: number; sku: string | null }>),
      ])
      perf.end('productLoad')

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

      perf.start('invoiceCheck')
      // Check for invoice uniqueness
      const existingInvoice = await trackedQuery(perf, () => tx.transaction.findUnique({
        where: { invoiceNumber },
      }))
      perf.end('invoiceCheck')
      if (existingInvoice) {
        throw new Error('Invoice number collision — please try again')
      }

      perf.start('txCreate')
      // 5. Create Transaction record
      const transaction = await txPhase(perf, 'txCreate', () =>
        tx.transaction.create({
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
      )
      perf.end('txCreate')

      perf.start('txItems')
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

      await txPhase(perf, 'txItems', () =>
        tx.transactionItem.createMany({ data: itemData })
      )
      perf.end('txItems')

      perf.start('stockDeduct')
      // 7. ATOMIC stock deduction — race-condition-free, BATCHED by product/variant.
      //    Multiple cart items referencing the same product/variant are grouped
      //    into a single UPDATE, reducing N queries to (unique products + unique variants).
      //    Uses raw SQL: UPDATE ... SET stock = stock - totalQty WHERE stock >= totalQty
      //    This is atomic in SQLite/Postgres: the WHERE check and decrement happen together.
      //    If affected rows = 0, another transaction consumed the last stock.
      //
      //    PHASE 2 OPTIMIZATION: previously this looped per cart item (N queries).
      //    Now it groups by (productId, variantId) and issues ONE query per unique target.
      const productQtyMap = new Map<string, number>() // productId → total qty
      const variantQtyMap = new Map<string, { qty: number; productId: string }>() // variantId → {qty, productId}
      for (const item of checkoutItems) {
        if (item.variantId) {
          const existing = variantQtyMap.get(item.variantId)
          if (existing) {
            existing.qty += item.qty
          } else {
            variantQtyMap.set(item.variantId, { qty: item.qty, productId: item.productId })
          }
        } else {
          productQtyMap.set(item.productId, (productQtyMap.get(item.productId) || 0) + item.qty)
        }
      }
      perf.setQueryCount(productQtyMap.size + variantQtyMap.size)

      for (const [productId, totalQty] of productQtyMap) {
        const product = productMap.get(productId)!
        // 25P02 FIX: wrapped in txPhase — a failed UPDATE poisons the PG txn;
        //   the error must propagate (not be swallowed) so Prisma rolls back.
        const affected = await txPhase(perf, `stockDeduct.product.${productId.slice(-6)}`, () =>
          tx.$executeRaw`
            UPDATE "Product" SET stock = stock - ${totalQty}
            WHERE id = ${productId} AND stock >= ${totalQty} AND "outletId" = ${outletId}
          `
        )
        if (affected === 0) {
          throw new Error(
            `Stok tidak cukup untuk ${product.name}. Kemungkinan stok terakhir sudah diambil transaksi lain. Coba lagi.`
          )
        }
      }
      for (const [variantId, info] of variantQtyMap) {
        const product = productMap.get(info.productId)!
        const affected = await txPhase(perf, `stockDeduct.variant.${variantId.slice(-6)}`, () =>
          tx.$executeRaw`
            UPDATE "ProductVariant" SET stock = stock - ${info.qty}
            WHERE id = ${variantId} AND stock >= ${info.qty} AND "outletId" = ${outletId}
          `
        )
        if (affected === 0) {
          throw new Error(
            `Stok tidak cukup untuk ${product.name} - ${variantId}. Kemungkinan stok terakhir sudah diambil transaksi lain. Coba lagi.`
          )
        }
      }

      // 7b. Recalculate parent product stock for variant products (atomic)
      const variantProductIds = new Set<string>()
      for (const item of checkoutItems) {
        if (item.variantId) variantProductIds.add(item.productId)
      }
      for (const productId of variantProductIds) {
        await txPhase(perf, `stockDeduct.recalcParent.${productId.slice(-6)}`, () =>
          tx.$executeRaw`
            UPDATE "Product" SET stock = (
              SELECT COALESCE(SUM(stock), 0) FROM "ProductVariant"
              WHERE "productId" = ${productId} AND "outletId" = ${outletId}
            )
            WHERE id = ${productId}
          `
        )
      }
      perf.end('stockDeduct')

      // 7c. PHASE 2 OPTIMIZATION: Compute updated stock in JS (no DB re-read).
      //    Returns updated stock values to the frontend so it can patch its local
      //    catalog without a full refetch (rule 10).
      //    - Simple products: original stock - totalQty (exact)
      //    - Variant items: original variant stock - qty (exact)
      //    - Variant parent products: approximated (we didn't fetch all siblings);
      //      the frontend will refetch ONLY those parent products if needed.
      //    The raw SQL UPDATE in 7b already set the correct parent stock in the DB,
      //    so this approximation only affects the immediate UI patch, not integrity.
      const updatedProductStock: Record<string, number> = {}
      const updatedVariantStock: Record<string, number> = {}

      for (const [variantId, info] of variantQtyMap) {
        const variant = variantMap.get(variantId)
        if (variant) {
          updatedVariantStock[variantId] = variant.stock - info.qty
        }
      }
      for (const productId of productIds) {
        const product = productMap.get(productId)
        if (!product) continue
        if (!variantProductIds.has(productId)) {
          const deducted = productQtyMap.get(productId) || 0
          updatedProductStock[productId] = product.stock - deducted
        }
        // Variant parent stock is updated in DB via 7b raw SQL but not returned
        // here (would require a re-read). Frontend refetches those if displayed.
      }

      perf.start('invConsume')
      // 7c. Deduct inventory via InventoryConsumptionService (atomic, yield-aware, validated)
      //     Jika stok bahan tidak cukup → error → seluruh transaksi di-rollback
      const consumptionResult = await InventoryConsumptionService.consumeForTransaction(tx, perf, {
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

      perf.end('invConsume')

      perf.start('snapshots')
      // 7d. Snapshot consumption data for accurate void reversal later
      //     This ensures void restores exactly what was consumed, even if
      //     the product recipe/composition changes months after the sale.
      if (consumptionResult.deductions.length > 0) {
        const snapshots = InventoryConsumptionService.buildConsumptionSnapshots(
          consumptionResult.deductions,
          transaction.id,
        )
        // 25P02 FIX: createMany wrapped in txPhase — payload verified against
        //   TransactionConsumption schema (transactionId, inventoryItemId,
        //   itemName, baseUnit, quantityUsed, sourceDetails). All fields valid.
        await txPhase(perf, 'snapshots.createMany', () =>
          tx.transactionConsumption.createMany({ data: snapshots })
        )
      }
      perf.end('snapshots')

      perf.start('audit')
      // 8. Audit log — ONE SALE event per transaction (event-oriented V2).
      //    Replaces the legacy per-item SALE audit spam: a 5-item cart used to
      //    produce 5 SALE rows; now it produces 1. Composition (inventory)
      //    consumption is included as a single "Inventory Impact" section —
      //    no separate COMPOSITION_DEDUCT audit rows are created (those remain
      //    only in the InventoryMovement technical ledger).
      let customerName: string | null = null
      let loyaltyCustomer: { id: string } | null = null
      if (customerId) {
        const c = await trackedQuery(perf, () => tx.customer.findFirst({
          where: { id: customerId, outletId, deletedAt: null },
          select: { id: true, name: true },
        }))
        customerName = c?.name ?? null
        loyaltyCustomer = c ? { id: c.id } : null
      }
      await emitAuditEvent(
        tx,
        buildSaleEvent({
          transactionId: transaction.id,
          invoiceNumber,
          items: checkoutItems.map((item) => {
            const product = productMap.get(item.productId)
            const variant = item.variantId ? variantMap.get(item.variantId) : null
            return {
              productName: item.productName,
              productSku: product?.sku || null,
              variantName: item.variantName || null,
              variantSku: variant?.sku || null,
              qty: item.qty,
              price: item.price,
              subtotal: item.subtotal || item.price * item.qty,
              itemDiscount: item.itemDiscount,
            }
          }),
          subtotal,
          discount: discount || 0,
          taxAmount: taxAmount || 0,
          total,
          paymentMethod,
          paidAmount: paidAmount || 0,
          change: change || 0,
          customerName,
          customerId: customerId || null,
          consumption: consumptionResult.deductions.map((d) => ({
            itemName: d.itemName,
            baseUnit: d.baseUnit,
            quantityUsed: d.totalDeducted,
            materialCost: d.materialCost,
          })),
          outletId,
          userId,
        }),
      )

      perf.end('audit')

      perf.start('loyalty')
      // 9. Handle customer loyalty
      if (customerId && loyaltyCustomer) {
        const customer = loyaltyCustomer

        const pointsToUse = pointsUsed || 0

        // Reuse outletSetting fetched in validation phase (includes loyalty fields)
        const setting = outletSetting
        let earnedPoints = 0
        if (setting?.loyaltyEnabled && setting.loyaltyPointsPerAmount > 0) {
          earnedPoints = Math.floor(total / setting.loyaltyPointsPerAmount)
        }

        // CUST-001 FIX: Atomic loyalty point update — race-condition-free.
        // Mirrors the atomic stock-deduction pattern (see STEP 7 above):
        //   UPDATE "Customer"
        //   SET points = points + (earned - used), totalSpend = totalSpend + total
        //   WHERE id = ? AND points >= ? AND outletId = ?
        // The `points >= pointsToUse` predicate is evaluated atomically with the
        // mutation, so two concurrent checkouts cannot both pass the balance check
        // and over-spend the customer's loyalty balance. If affected rows = 0,
        // another transaction drained the balance first — abort and rollback.
        const netPointsDelta = earnedPoints - pointsToUse
        // 25P02 FIX: wrapped in txPhase — raw SQL UPDATE must propagate errors.
        const loyaltyAffected = await txPhase(perf, 'loyalty.updatePoints', () =>
          tx.$executeRaw`
            UPDATE "Customer"
            SET points = points + ${netPointsDelta},
                "totalSpend" = "totalSpend" + ${total},
                "updatedAt" = ${new Date()}
            WHERE id = ${customerId}
              AND points >= ${pointsToUse}
              AND "outletId" = ${outletId}
              AND "deletedAt" IS NULL
          `
        )
        if (loyaltyAffected === 0) {
          throw new Error(
            `Poin loyalitas tidak mencukupi (butuh ${pointsToUse}, kemungkinan baru saja dipakai transaksi lain). Coba lagi.`
          )
        }

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
          // SET-002 FIX: Consult loyaltyPointValue setting instead of hardcoding * 100.
          // Fallback to 100 (the schema default) only if the setting row is somehow
          // missing — never silently produce a different Rp value than the UI showed.
          const pointValue = setting?.loyaltyPointValue ?? 100
          const pointsDiscount = pointsToUse * pointValue
          loyaltyLogs.push({
            type: 'REDEEM',
            points: -pointsToUse,
            description: `Redeemed ${pointsToUse} points for Rp ${pointsDiscount.toLocaleString('id-ID')} discount on transaction ${invoiceNumber}`,
            customerId,
            transactionId: transaction.id,
          })
        }
        if (loyaltyLogs.length > 0) {
          await txPhase(perf, 'loyalty.createLogs', () =>
            tx.loyaltyLog.createMany({ data: loyaltyLogs })
          )
        }
      }
      perf.end('loyalty')

      perf.end('transaction')
      return { invoiceNumber, updatedProductStock, updatedVariantStock }
    }, { timeout: 15000 })

    perf.start('postCommit')
    // PHASE 2 OPTIMIZATION (rule 9): Move noncritical notification/analytics
    // work AFTER the response is sent. The checkout data is already committed.
    // Telegram notification + insight engine run in a fire-and-forget Promise
    // via setImmediate, so the HTTP response is not blocked by 3 DB queries +
    // the Telegram network call. This saves ~100-500ms from the critical path.
    const notifyInvoice = result.invoiceNumber
    setImmediate(() => {
      (async () => {
        try {
          const [cashierUser, outletData, customerData] = await Promise.all([
            db.user.findUnique({ where: { id: userId }, select: { name: true } }),
            db.outlet.findUnique({ where: { id: outletId }, select: { name: true } }),
            customerId
              ? db.customer.findUnique({ where: { id: customerId }, select: { name: true } })
              : Promise.resolve(null),
          ])
          const cashierName = cashierUser?.name || userId
          const outletName = outletData?.name || 'Outlet'
          const customerName = customerData?.name || undefined

          await notifyNewTransaction(outletId, {
            invoiceNumber: notifyInvoice,
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
        } catch (notifyError) {
          console.error('[checkout] Post-checkout notification error (non-fatal):', notifyError)
        }

        // Insight engine (throttled internally to every 5 txns)
        triggerInsightAfterCheckout(outletId).catch(() => {})
      })()
    })
    perf.end('postCommit')

    perf.end('total')
    const perfReport = perf.report()
    if (isPerfEnabled()) {
      console.log(`[checkout:perf] ${result.invoiceNumber} — ${JSON.stringify(perfReport)}`)
    }

    return safeJson({
      success: true,
      invoiceNumber: result.invoiceNumber,
      // PHASE 2 OPTIMIZATION (rule 10): Return updated stock so the frontend
      // can patch its local catalog without a full refetch.
      updatedStock: {
        products: result.updatedProductStock,
        variants: result.updatedVariantStock,
      },
      ...(isPerfEnabled() ? { _perf: perfReport } : {}),
    })
  } catch (error: unknown) {
    // 25P02 FIX: surface the FIRST failing query via formatTxError. If the
    //   error is a 25P02 symptom ("current transaction is aborted"), an
    //   EARLIER query inside the same db.$transaction is the real root cause —
    //   the `.checkoutPhase` annotation on the error points to it.
    const message = formatTxError(error)
    const aborted = isTransactionAbortedError(error)
    console.error(
      `[checkout] POST error${aborted ? ' (25P02 — earlier query is root cause, see checkoutPhase above)' : ''}:`,
      error
    )
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
