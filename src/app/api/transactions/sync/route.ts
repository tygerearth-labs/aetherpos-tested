import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { generateInvoiceNumber } from '@/lib/api-helpers'
import { safeJson, safeJsonError } from '@/lib/safe-response'

interface SyncTransactionItem {
  productId: string
  productName: string
  price: number
  qty: number
  subtotal: number
  variantId?: string | null
  variantName?: string | null
}

interface SyncTransaction {
  id?: number
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

    const body = await request.json()
    const { transactions }: { transactions: SyncTransaction[] } = body

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return safeJsonError('No transactions to sync', 400)
    }

    // Limit batch size to 50
    const batch = transactions.slice(0, 50)
    const results: SyncResult[] = []

    for (const tx of batch) {
      try {
        // Validate localId
        if (!tx.id) {
          results.push({ localId: -1, success: false, error: 'Missing localId' })
          continue
        }

        const { payload, createdAt } = tx

        // Validate items
        if (!payload.items || payload.items.length === 0) {
          results.push({ localId: tx.id, success: false, error: 'Empty cart' })
          continue
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
          await txDb.transactionItem.createMany({
            data: payload.items.map((item) => {
              const product = productMap.get(item.productId)!
              let itemHpp = product.hpp

              // Use variant HPP if variant is specified
              if (item.variantId) {
                const variant = variantMap.get(item.variantId)
                if (variant) {
                  itemHpp = variant.hpp
                }
              }

              return {
                productId: item.productId,
                productName: item.productName,
                variantId: item.variantId || null,
                variantName: item.variantName || null,
                price: item.price,
                qty: item.qty,
                subtotal: item.subtotal,
                hpp: itemHpp,
                transactionId: transaction.id,
              }
            }),
          })

          // 7. Update stock — decrement variant stock OR parent product stock
          for (const item of payload.items) {
            if (item.variantId) {
              // Decrement variant stock
              await txDb.productVariant.update({
                where: { id: item.variantId },
                data: { stock: { decrement: item.qty } },
              })
            } else {
              // Decrement parent product stock
              await txDb.product.update({
                where: { id: item.productId },
                data: { stock: { decrement: item.qty } },
              })
            }
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
                  variantName: item.variantName,
                  quantitySold: item.qty,
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
                  quantitySold: item.qty,
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
              where: { id: payload.customerId, outletId },
            })
            if (!customer) {
              throw new Error('Customer not found')
            }

            const pointsToUse = payload.pointsUsed || 0

            if (pointsToUse > customer.points) {
              throw new Error(
                `Poin customer tidak cukup. Tersedia: ${customer.points}, Digunakan: ${pointsToUse}`
              )
            }

            // Calculate earned points based on outlet loyalty settings
            let earnedPoints = 0
            const syncSetting = await txDb.outletSetting.findUnique({
              where: { outletId },
              select: { loyaltyEnabled: true, loyaltyPointsPerAmount: true },
            })
            if (syncSetting?.loyaltyEnabled && syncSetting.loyaltyPointsPerAmount > 0) {
              earnedPoints = Math.floor(payload.total / syncSetting.loyaltyPointsPerAmount)
            }

            // Combine customer updates into a single query
            const customerUpdateData: { totalSpend: { increment: number }; points?: { increment: number } | { decrement: number } } = {
              totalSpend: { increment: payload.total },
            }
            let netPointsDelta = 0
            if (earnedPoints > 0) netPointsDelta += earnedPoints
            if (pointsToUse > 0) netPointsDelta -= pointsToUse
            if (netPointsDelta !== 0) {
              customerUpdateData.points = netPointsDelta > 0
                ? { increment: netPointsDelta }
                : { decrement: Math.abs(netPointsDelta) }
            }

            await txDb.customer.update({
              where: { id: payload.customerId },
              data: customerUpdateData,
            })

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
              const pointsDiscount = pointsToUse * 100
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
