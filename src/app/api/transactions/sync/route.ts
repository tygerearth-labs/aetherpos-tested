import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { generateInvoiceNumber, resolvePlanType } from '@/lib/api/api-helpers'
import { getPlanFeatures, isUnlimited } from '@/lib/config/plan-config'
import { assertOutletWithinLimits } from '@/lib/api/plan-enforcement'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { ensureMigrated } from '@/lib/db-migrate'
import { InventoryConsumptionService } from '@/lib/inventory-consumption-service'

interface SyncTransactionItem {
  productId: string
  productName: string
  price: number
  qty: number
  subtotal: number
  variantId?: string | null
  variantName?: string | null
  itemDiscount?: number
}

interface SyncTransaction {
  id?: number
  eventId?: string // DEX-007: Client-provided idempotency key
  payload: {
    customerId: string | null
    items: SyncTransactionItem[]
    subtotal: number
    discount: number
    pointsUsed: number
    taxAmount?: number
    total: number
    paymentMethod: string
    paidAmount: number
    change: number
    promoId?: string | null
    promoDiscount?: number
  }
  createdAt: number // timestamp
}

interface SyncResult {
  localId: number | undefined
  success: boolean
  invoiceNumber?: string
  serverId?: string
  error?: string
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

    // FIX-PLAN-007: Block ALL mutations when the outlet is over-limit after
    // a downgrade. Offline sync is a mutation that creates transactions and
    // decrements stock, so it must respect the over-limit gate.
    const overLimitResponse = await assertOutletWithinLimits(outletId)
    if (overLimitResponse) return overLimitResponse

    const body = await request.json()
    const { transactions }: { transactions: SyncTransaction[] } = body

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return safeJsonError('No transactions to sync', 400)
    }

    // Limit batch size to 50
    const batch = transactions.slice(0, 50)

    // FIX-PLAN-004: Enforce maxTransactionsPerMonth plan limit on the offline
    // sync path. Previously this endpoint did NOT check the limit, while the
    // online /api/pos/checkout endpoint did. A Free user (limit 500 tx/month)
    // could go offline, perform 1000 transactions in IndexedDB, then sync
    // them via this endpoint — all 1000 were recorded, none rejected. This
    // mirrors the K4 logic from /api/pos/checkout/route.ts:111-123 and rejects
    // the entire batch when (currentMonthCount + batchSize) > limit so the
    // client gets a clear error and can prompt the user to upgrade.
    const syncOutlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { accountType: true },
    })
    const syncAccountType = resolvePlanType(syncOutlet?.accountType)
    const syncFeatures = getPlanFeatures(syncAccountType)
    if (!isUnlimited(syncFeatures.maxTransactionsPerMonth)) {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthTxCount = await db.transaction.count({
        where: {
          outletId,
          createdAt: { gte: monthStart },
        },
      })
      if (monthTxCount + batch.length > syncFeatures.maxTransactionsPerMonth) {
        return safeJsonError(
          'Anda telah mencapai batas transaksi bulanan paket Anda',
          403,
        )
      }
    }

    const results: SyncResult[] = []

    // AUDIT-1-004 FIX: label the batch loop so inner validation `continue`s can
    // skip to the next transaction instead of falling through into the $transaction.
    outerLoop: for (const tx of batch) {
      try {
        // Validate localId
        if (!tx.id) {
          results.push({ localId: -1, success: false, error: 'Missing localId' })
          continue
        }

        // DEX-007 FIX: Idempotency check — skip if event was already processed.
        // AUDIT-1-001 FIX: Frontend now sends eventId on every checkout, so this
        // fast pre-check actually fires for the common case (double-click, auto-
        // resync, refresh-during-checkout).
        // AUDIT-1-004 FIX: The pre-check is a FAST PATH only. The authoritative
        // atomic guard is the unique-index INSERT inside the $transaction below.
        // Two parallel syncs can both pass this pre-check (neither sees the
        // other's uncommitted marker), but only one can win the unique-index
        // INSERT — the other throws and rolls back.
        if (tx.eventId) {
          const existingAudit = await db.auditLog.findFirst({
            where: {
              outletId,
              action: 'SYNC_DEDUP',
              entityId: tx.eventId,
            },
          })
          if (existingAudit) {
            console.log(`[sync] DEX-007: Duplicate event ${tx.eventId} ignored (already processed)`)
            try {
              const parsed = JSON.parse(existingAudit.details || '{}')
              results.push({
                localId: tx.id,
                success: true,
                invoiceNumber: parsed.invoiceNumber as string | undefined,
                serverId: parsed.serverId as string | undefined,
              })
            } catch {
              results.push({ localId: tx.id, success: true, error: 'Already synced (duplicate skipped)' })
            }
            continue
          }
        }

        const { payload, createdAt } = tx

        // Validate items
        if (!payload.items || payload.items.length === 0) {
          results.push({ localId: tx.id, success: false, error: 'Empty cart' })
          continue
        }

        // AUDIT-1-002 FIX (sync path): Reject non-positive qty (fraud / stock inflation).
        // Same validation as /api/pos/checkout — without this, a malicious offline
        // payload with qty=-5 would be accepted by sync (the atomic SQL
        // `WHERE stock >= -5` is always true) and inflate stock.
        for (const item of payload.items) {
          if (!Number.isFinite(item.qty) || item.qty <= 0) {
            results.push({ localId: tx.id, success: false, error: `Qty tidak valid untuk ${item.productName}. Qty harus > 0.` })
            continue outerLoop // skip to next transaction in batch
          }
          if (!Number.isFinite(item.price) || item.price < 0) {
            results.push({ localId: tx.id, success: false, error: `Harga tidak valid untuk ${item.productName}.` })
            continue outerLoop
          }
        }

        // AUDIT-1-003 FIX (sync path): Server-side recompute of subtotal & total.
        // Same anti-fraud check as /api/pos/checkout. Offline payloads could
        // otherwise carry a manipulated total.
        const computedSubtotal = payload.items.reduce((s, it) => s + (it.price * it.qty), 0)
        const computedTotal = computedSubtotal - (payload.discount || 0) + (payload.taxAmount || 0)
        if (Math.abs((payload.subtotal || 0) - computedSubtotal) > 1) {
          results.push({ localId: tx.id, success: false, error: `Subtotal tidak sesuai server (Rp ${computedSubtotal.toLocaleString('id-ID')}).` })
          continue outerLoop
        }
        if (Math.abs((payload.total || 0) - computedTotal) > 1) {
          results.push({ localId: tx.id, success: false, error: `Total tidak sesuai server (Rp ${computedTotal.toLocaleString('id-ID')}).` })
          continue outerLoop
        }

        const transactionDate = new Date(createdAt)

        const result = await db.$transaction(async (txDb) => {
          // 1. Collect all variant IDs from items to batch-fetch
          const variantIds = payload.items
            .map((item) => item.variantId)
            .filter((id): id is string => !!id)

          // Batch-fetch products and variants
          const productIds = payload.items.map((item) => item.productId)
          const products = await txDb.product.findMany({
            where: { id: { in: productIds }, outletId },
          })
          const productMap = new Map(products.map((p) => [p.id, p]))

          // Batch-fetch all variants needed
          const variants = variantIds.length > 0
            ? await txDb.productVariant.findMany({
                where: { id: { in: variantIds }, outletId },
              })
            : []
          const variantMap = new Map(variants.map((v) => [v.id, v]))

          // 2. Validate all items (stock check against variant or parent product)
          for (const item of payload.items) {
            const product = productMap.get(item.productId)
            if (!product) {
              throw new Error(`Product ${item.productName} not found in this outlet`)
            }

            if (item.variantId) {
              // Variant item: validate variant exists, belongs to product, and has stock
              const variant = variantMap.get(item.variantId)
              if (!variant) {
                throw new Error(`Varian tidak ditemukan untuk ${item.productName}`)
              }
              if (variant.productId !== item.productId) {
                throw new Error(`Varian tidak cocok dengan produk ${item.productName}`)
              }
              if (variant.stock < item.qty) {
                throw new Error(
                  `Stok ${item.variantName || item.productName} tidak cukup. Tersedia: ${variant.stock}, Diminta: ${item.qty}`
                )
              }
            } else {
              // Non-variant item: validate against parent product stock
              if (product.stock < item.qty) {
                throw new Error(
                  `Stok ${product.name} tidak cukup. Tersedia: ${product.stock}, Diminta: ${item.qty}`
                )
              }
            }
          }

          // 3. Validate payment for CASH
          if (payload.paymentMethod === 'CASH') {
            if (payload.paidAmount < payload.total) {
              throw new Error('Jumlah bayar kurang dari total')
            }
          }

          // 4. Generate invoice number
          const invoiceNumber = generateInvoiceNumber()

          // 4b. Check for invoice uniqueness
          const existingInvoice = await txDb.transaction.findUnique({
            where: { invoiceNumber },
          })
          if (existingInvoice) {
            throw new Error('Invoice number collision — please try again')
          }

          // 5. Create Transaction record
          const transaction = await txDb.transaction.create({
            data: {
              invoiceNumber,
              subtotal: payload.subtotal,
              discount: payload.discount || 0,
              pointsUsed: payload.pointsUsed || 0,
              taxAmount: payload.taxAmount || 0,
              total: payload.total,
              paymentMethod: payload.paymentMethod,
              paidAmount: payload.paidAmount || 0,
              change: payload.change || 0,
              outletId,
              customerId: payload.customerId || null,
              userId,
              createdAt: transactionDate,
            },
          })

          // 6. Create TransactionItems — with variant support
          //    productName & variantName: server-verified from DB
          //    productSku & variantSku: snapshotted from DB at sale time
          //    hpp: snapshotted from DB at sync time
          //    price: kept from client (offline effective price)
          await txDb.transactionItem.createMany({
            data: payload.items.map((item) => {
              const product = productMap.get(item.productId)!
              const variant = item.variantId ? variantMap.get(item.variantId) : null
              let itemHpp = product.hpp

              // Use variant HPP if variant is specified
              if (item.variantId && variant) {
                itemHpp = variant.hpp
              }

              // Server-side name verification — log if client name differs from DB
              const verifiedProductName = product.name
              const verifiedVariantName = variant?.name || item.variantName || null
              if (item.productName && item.productName !== product.name) {
                console.warn(
                  `[sync] productName mismatch: client="${item.productName}" db="${product.name}" productId=${product.id}`
                )
              }
              if (item.variantName && variant && item.variantName !== variant.name) {
                console.warn(
                  `[sync] variantName mismatch: client="${item.variantName}" db="${variant.name}" variantId=${variant.id}`
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
                subtotal: item.subtotal,
                itemDiscount: item.itemDiscount || 0,
                hpp: itemHpp,
                transactionId: transaction.id,
              }
            }),
          })

          // 7. ATOMIC stock deduction — race-condition-free (P1-3 AUDIT-3 fix)
          //    PREVIOUSLY: validation SELECT in step 2 + non-atomic `{ decrement: qty }`.
          //    Two parallel sync calls could both pass the validation SELECT, then both
          //    decrement, driving stock below zero. The non-atomic decrement is a
          //    TOCTOU race window.
          //    NOW: raw SQL `UPDATE ... SET stock = stock - qty WHERE stock >= qty`
          //    is atomic in SQLite — the WHERE check and the SET happen under a
          //    single statement-level lock. If affected rows = 0, another transaction
          //    took the last stock; we abort the whole batch (transaction rolls back).
          //    Pattern backported from /api/pos/checkout (lines 213-240).
          for (const item of payload.items) {
            const product = productMap.get(item.productId)!
            if (item.variantId) {
              const affected = await txDb.$executeRaw`
                UPDATE "ProductVariant" SET stock = stock - ${item.qty}
                WHERE id = ${item.variantId} AND stock >= ${item.qty} AND "outletId" = ${outletId}
              `
              if (affected === 0) {
                throw new Error(
                  `Stok tidak cukup untuk ${product.name} - ${item.variantName || item.variantId}. Kemungkinan stok terakhir sudah diambil transaksi lain. Coba lagi.`
                )
              }
            } else {
              const affected = await txDb.$executeRaw`
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
          //     This keeps parent.stock == SUM(variants.stock) invariant after
          //     variant stock changes. Mirrors /api/pos/checkout pattern.
          const variantProductIds = new Set<string>()
          for (const item of payload.items) {
            if (item.variantId) variantProductIds.add(item.productId)
          }
          for (const productId of variantProductIds) {
            await txDb.$executeRaw`
              UPDATE "Product" SET stock = (
                SELECT COALESCE(SUM(stock), 0) FROM "ProductVariant"
                WHERE "productId" = ${productId} AND "outletId" = ${outletId}
              )
              WHERE id = ${productId}
            `
          }

          // 7c. Deduct inventory via InventoryConsumptionService (atomic, yield-aware)
          //     Jika stok bahan tidak cukup → error → seluruh transaksi di-rollback
          const syncConsumptionResult = await InventoryConsumptionService.consumeForTransaction(txDb, {
            items: payload.items.map(item => ({
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

          // 7d. Snapshot consumption data for accurate void reversal
          if (syncConsumptionResult.deductions.length > 0) {
            const snapshots = InventoryConsumptionService.buildConsumptionSnapshots(
              syncConsumptionResult.deductions,
              transaction.id,
            )
            await txDb.transactionConsumption.createMany({ data: snapshots })
          }

          // 8. Create audit logs — VARIANT type for variant items, PRODUCT for normal
          const auditLogs = []
          for (const item of payload.items) {
            const product = productMap.get(item.productId)!
            if (item.variantId) {
              const variant = variantMap.get(item.variantId)
              auditLogs.push({
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
                  previousStock: variant?.stock || 0,
                  newStock: (variant?.stock || 0) - item.qty,
                  syncedFromOffline: true,
                  originalCreatedAt: createdAt,
                }),
                outletId,
                userId,
                createdAt: transactionDate,
              })
            } else {
              auditLogs.push({
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
                  previousStock: product.stock,
                  newStock: product.stock - item.qty,
                  syncedFromOffline: true,
                  originalCreatedAt: createdAt,
                }),
                outletId,
                userId,
                createdAt: transactionDate,
              })
            }
          }
          if (auditLogs.length > 0) {
            await txDb.auditLog.createMany({ data: auditLogs })
          }

          // 9. Handle customer loyalty
          if (payload.customerId) {
            const customer = await txDb.customer.findFirst({
              where: { id: payload.customerId, outletId, deletedAt: null },
              select: { id: true },
            })
            if (!customer) {
              throw new Error('Customer not found')
            }

            const pointsToUse = payload.pointsUsed || 0

            // Calculate earned points based on outlet loyalty settings
            let earnedPoints = 0
            const syncSetting = await txDb.outletSetting.findUnique({
              where: { outletId },
              select: { loyaltyEnabled: true, loyaltyPointsPerAmount: true, loyaltyPointValue: true },
            })
            if (syncSetting?.loyaltyEnabled && syncSetting.loyaltyPointsPerAmount > 0) {
              earnedPoints = Math.floor(payload.total / syncSetting.loyaltyPointsPerAmount)
            }

            // CUST-001 FIX: Atomic loyalty point update — race-condition-free.
            // Mirrors the atomic stock-deduction pattern used earlier in this route
            // (and in /api/pos/checkout STEP 7). The `points >= pointsToUse`
            // predicate is evaluated atomically with the mutation, so two concurrent
            // syncs (or sync + checkout) cannot both pass the balance check and
            // over-spend the customer's loyalty balance. If affected rows = 0,
            // another transaction drained the balance first — abort and rollback.
            const netPointsDelta = earnedPoints - pointsToUse
            const loyaltyAffected = await txDb.$executeRaw`
              UPDATE "Customer"
              SET points = points + ${netPointsDelta},
                  totalSpend = totalSpend + ${payload.total},
                  "updatedAt" = ${new Date()}
              WHERE id = ${payload.customerId}
                AND points >= ${pointsToUse}
                AND outletId = ${outletId}
                AND "deletedAt" IS NULL
            `
            if (loyaltyAffected === 0) {
              throw new Error(
                `Poin loyalitas tidak mencukupi (butuh ${pointsToUse}, kemungkinan baru saja dipakai transaksi lain). Coba lagi.`
              )
            }

            // Batch create loyalty logs
            const loyaltyLogs = []
            if (earnedPoints > 0) {
              loyaltyLogs.push({
                type: 'EARN' as const,
                points: earnedPoints,
                description: `Earned ${earnedPoints} points from transaction ${invoiceNumber} (Rp ${payload.total.toLocaleString('id-ID')}) [synced offline]`,
                customerId: payload.customerId,
                transactionId: transaction.id,
                createdAt: transactionDate,
              })
            }
            if (pointsToUse > 0) {
              // SET-002 FIX: Consult loyaltyPointValue setting instead of hardcoding * 100.
              // The client UI (pos-page.tsx:1060) computes the discount using this
              // same setting, so the LoyaltyLog description must match.
              const pointValue = syncSetting?.loyaltyPointValue ?? 100
              const pointsDiscount = pointsToUse * pointValue
              loyaltyLogs.push({
                type: 'REDEEM' as const,
                points: -pointsToUse,
                description: `Redeemed ${pointsToUse} points for Rp ${pointsDiscount.toLocaleString('id-ID')} discount on transaction ${invoiceNumber} [synced offline]`,
                customerId: payload.customerId,
                transactionId: transaction.id,
                createdAt: transactionDate,
              })
            }
            if (loyaltyLogs.length > 0) {
              await txDb.loyaltyLog.createMany({ data: loyaltyLogs })
            }
          }

          // AUDIT-1-004 FIX: Atomic idempotency marker — INSERT ... WHERE NOT EXISTS
          // guarded by the unique partial index `auditlog_sync_dedup_eventid_uidx`
          // (created by ensureMigrated). This is the authoritative dedup guard:
          // two parallel sync transactions can both pass the fast pre-check
          // (neither sees the other's uncommitted write), but only ONE can win
          // this INSERT — the other gets affected=0 (or a unique-constraint
          // violation on race) and we throw, rolling back the transaction.create
          // and stock decrements so no duplicate is persisted.
          if (tx.eventId) {
            const markerDetails = JSON.stringify({
              invoiceNumber,
              serverId: transaction.id,
              localId: tx.id,
              processedAt: new Date().toISOString(),
            })
            const affected = await txDb.$executeRaw`
              INSERT INTO "AuditLog" (id, action, "entityType", "entityId", "outletId", "userId", details, "createdAt")
              SELECT ${crypto.randomUUID()}, 'SYNC_DEDUP', 'SYNC_EVENT', ${tx.eventId}, ${outletId}, ${userId}, ${markerDetails}, ${new Date()}
              WHERE NOT EXISTS (
                SELECT 1 FROM "AuditLog"
                WHERE action = 'SYNC_DEDUP' AND "entityId" = ${tx.eventId}
              )
            `
            if (affected === 0) {
              // Another parallel sync won the race — fetch its result and treat as duplicate.
              const winner = await txDb.auditLog.findFirst({
                where: { action: 'SYNC_DEDUP', entityId: tx.eventId },
              })
              throw new Error(
                'DUPLICATE_SYNC_EVENT' +
                (winner ? `::${winner.details}` : '')
              )
            }
          }

          return { transactionId: transaction.id, invoiceNumber }
        }, { timeout: 15000 })

        results.push({
          localId: tx.id,
          success: true,
          invoiceNumber: result.invoiceNumber,
          serverId: result.transactionId,
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Sync failed'
        // AUDIT-1-004: A duplicate-event throw is NOT a failure — another parallel
        // sync request already committed this transaction. Surface it as success
        // with the winner's invoice number so the client marks the local row synced.
        if (message.startsWith('DUPLICATE_SYNC_EVENT')) {
          const [, winnerDetails] = message.split('::')
          try {
            const parsed = JSON.parse(winnerDetails || '{}')
            results.push({
              localId: tx.id,
              success: true,
              invoiceNumber: parsed.invoiceNumber,
              serverId: parsed.serverId,
            })
            console.log(`[sync] AUDIT-1-004: Parallel duplicate event ${tx.eventId} resolved to winner ${parsed.invoiceNumber}`)
            continue
          } catch {
            // Fall through to success-without-details
            results.push({ localId: tx.id, success: true, error: 'Already synced (parallel duplicate)' })
            continue
          }
        }
        results.push({
          localId: tx.id,
          success: false,
          error: message,
        })
      }
    }

    const synced = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    return safeJson({
      synced,
      failed,
      total: batch.length,
      results,
    })
  } catch (error) {
    console.error('Transactions sync error:', error)
    return safeJsonError('Sync failed', 500)
  }
}
