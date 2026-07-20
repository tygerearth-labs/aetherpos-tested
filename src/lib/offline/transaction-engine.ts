/**
 * @deprecated This offline engine is DORMANT — not wired into production.
 * Production uses an in-memory localDB shim that defers to server-side
 * InventoryConsumptionService on sync. See src/lib/local-db.ts and
 * src/lib/sync-service.ts. This file is preserved for reference only.
 * Do NOT import or use in production code.
 *
 * Known latent bugs (do NOT fix — file is dead code):
 *   - Hardcoded `Math.floor(total / 10000)` loyalty earn rate at lines ~343, ~438
 *     (should consult `loyaltyPointsPerAmount` setting — see AUDIT-PLATFORM-3
 *     SET-001 for details).
 *   - Missing `unitCost` in BatchConsumptionResult (see AUDIT-PLATFORM-3 line
 *     3754 for details).
 */

/**
 * transaction-engine.ts — Offline Transaction (Checkout) Engine
 *
 * Arsitektur: Offline-First Checkout
 * ──────────────────────────────────
 * Saat offline, checkout flow:
 *   1. Create Transaction + TransactionItems di Dexie
 *   2. Untuk produk dengan komposisi (BOM/recipe): FEFO batch consumption
 *   3. Update customer totalSpend & points
 *   4. Soft-delete pada void (bukan hard delete)
 *
 * Semua operasi DB dibungkus dalam 1 Dexie transaction untuk atomicity.
 * FEFO engine mengelola transaction + sync-nya sendiri (nested Dexie tx).
 * Setelah commit, semua perubahan non-FEFO di-enqueue ke syncQueue.
 *
 * Cloud-only (tidak ada di Dexie): LoyaltyLog, AuditLog
 * LoyaltyLog akan dibuat oleh server saat sync.
 */

import { getAetherDB } from './aether-db'
import type {
  OfflineTransaction,
  OfflineTransactionItem,
  OfflineBatchConsumptionLog,
  OfflineCustomer,
  SyncAction,
} from './aether-db'
import {
  OfflineFEFO,
  type BatchConsumptionResult,
  type BatchRestorationResult,
} from './fefo-engine'
import { syncEnqueueBatch } from './sync-queue'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export interface CheckoutItemParam {
  productId: string | null
  variantId: string | null
  productName: string
  productSku?: string | null
  variantName?: string | null
  variantSku?: string | null
  price: number
  qty: number
  itemDiscount?: number
  hpp: number
  compositionConsumptions?: Array<{
    inventoryItemId: string
    itemName: string
    baseUnit: string
    totalConsumed: number
  }>
}

export interface CheckoutParams {
  outletId: string
  userId: string
  customerId?: string | null
  paymentMethod: string        // CASH | QRIS | DEBIT
  paidAmount: number
  items: CheckoutItemParam[]
  discount?: number
  pointsUsed?: number
  taxAmount?: number
  note?: string | null
}

export interface VoidParams {
  transactionId: string
  outletId: string
  userId: string
}

export interface CheckoutResult {
  transaction: OfflineTransaction
  items: OfflineTransactionItem[]
}

// ════════════════════════════════════════════════════════════
// Internal: Sync Queue Entry
// ════════════════════════════════════════════════════════════

interface SyncEntry {
  entity: string
  entityId: string
  action: SyncAction
  payload: Record<string, unknown>
}

// ════════════════════════════════════════════════════════════
// Dexie table names involved in checkout/void
// ════════════════════════════════════════════════════════════

const CHECKOUT_TABLES = [
  'transactions',
  'transactionItems',
  'inventoryBatches',
  'batchConsumptionLogs',
  'inventoryMovements',
  'inventoryItems',
  'customers',
] as const

// ════════════════════════════════════════════════════════════
// OfflineTransactionEngine
// ════════════════════════════════════════════════════════════

export class OfflineTransactionEngine {

  // ────────────────────────────────────────────────────────
  // Helper: Generate Invoice Number
  // Format: TXN-YYYYMMDD-XXXX (auto-increment per hari)
  // ────────────────────────────────────────────────────────

  private static async generateInvoiceNumber(): Promise<string> {
    const db = getAetherDB()
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '') // YYYYMMDD
    const prefix = `TXN-${dateStr}-`

    // Hitung transaksi yang sudah ada dengan prefix yang sama hari ini
    // (termasuk soft-deleted, agar tidak duplicate sequence number)
    const count = await db.transactions
      .where('invoiceNumber')
      .between(prefix, prefix + '\uffff', true, true)
      .count()

    const seq = String(count + 1).padStart(4, '0')
    return `${prefix}${seq}`
  }

  // ────────────────────────────────────────────────────────
  // Main: Checkout
  // ────────────────────────────────────────────────────────

  /**
   * Proses checkout offline.
   *
   * Atomic operation — semua atau gagal:
   * - Buat transaction + transaction items
   * - FEFO consumption untuk produk komposisi (delegated ke OfflineFEFO)
   * - Update customer totalSpend & points
   * - Enqueue perubahan ke sync queue
   *
   * Catatan: OfflineFEFO.consumeBatch mengelola transaction Dexie-nya sendiri
   * (nested dalam transaction utama) dan sync queue-nya sendiri.
   */
  static async checkout(params: CheckoutParams): Promise<CheckoutResult> {
    const {
      outletId,
      userId,
      customerId = null,
      paymentMethod,
      paidAmount,
      items,
      discount = 0,
      pointsUsed = 0,
      taxAmount = 0,
      note = null,
    } = params

    // ── Validasi dasar ──
    if (!items || items.length === 0) {
      throw new Error('Item transaksi tidak boleh kosong')
    }

    for (const item of items) {
      if (item.qty <= 0) {
        throw new Error(`Jumlah item "${item.productName}" harus lebih dari 0`)
      }
    }

    // ── Hitung subtotal per item dan total ──
    let subtotal = 0
    for (const item of items) {
      const itemSubtotal = (item.price * item.qty) - (item.itemDiscount ?? 0)
      if (itemSubtotal < 0) {
        throw new Error(`Diskon item "${item.productName}" melebihi subtotal`)
      }
      subtotal += itemSubtotal
    }

    const total = subtotal - discount - pointsUsed + taxAmount
    if (total < 0) {
      throw new Error('Total transaksi tidak boleh negatif. Periksa diskon dan poin yang digunakan.')
    }

    // Change hanya relevan untuk CASH
    const change = paymentMethod === 'CASH' ? paidAmount - total : 0

    if (paymentMethod === 'CASH' && change < 0) {
      throw new Error(
        `Pembayaran kurang Rp${Math.abs(change).toLocaleString('id-ID')}. ` +
        `Total: Rp${total.toLocaleString('id-ID')}, Dibayar: Rp${paidAmount.toLocaleString('id-ID')}`,
      )
    }

    // ── Variabel hasil ──
    let createdTransaction!: OfflineTransaction
    let createdItems!: OfflineTransactionItem[]
    const syncEntries: SyncEntry[] = []

    const db = getAetherDB()

    // ── Single Dexie Transaction (atomic) ──
    await db.transaction('rw', [...CHECKOUT_TABLES], async () => {
      const now = new Date().toISOString()

      // 1. Generate invoice number (dalam transaction, atomic count)
      const invoiceNumber = await OfflineTransactionEngine.generateInvoiceNumber()

      // 2. Create OfflineTransaction
      const transactionId = crypto.randomUUID()
      createdTransaction = {
        id: transactionId,
        invoiceNumber,
        subtotal: Math.round(subtotal),
        discount: Math.round(discount),
        pointsUsed: Math.round(pointsUsed),
        taxAmount: Math.round(taxAmount),
        total: Math.round(total),
        paymentMethod,
        paidAmount: Math.round(paidAmount),
        change: Math.round(change),
        note,
        outletId,
        customerId,
        userId,
        syncStatus: 'PENDING',
        version: 1,
        updatedAt: now,
        createdAt: now,
        deletedAt: null,
      }

      await db.transactions.add(createdTransaction)
      syncEntries.push({
        entity: 'transactions',
        entityId: transactionId,
        action: 'CREATE',
        payload: { ...createdTransaction },
      })

      // 3. Create OfflineTransactionItems + handle composition
      createdItems = []

      for (const item of items) {
        const itemSubtotal = (item.price * item.qty) - (item.itemDiscount ?? 0)
        const txItemId = crypto.randomUUID()

        const txItem: OfflineTransactionItem = {
          id: txItemId,
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          productSku: item.productSku ?? null,
          variantName: item.variantName ?? null,
          variantSku: item.variantSku ?? null,
          price: item.price,
          qty: item.qty,
          subtotal: Math.round(itemSubtotal),
          itemDiscount: Math.round(item.itemDiscount ?? 0),
          hpp: item.hpp,
          transactionId,
          syncStatus: 'PENDING',
          version: 1,
          updatedAt: now,
          createdAt: now,
          deletedAt: null,
        }

        await db.transactionItems.add(txItem)
        createdItems.push(txItem)

        syncEntries.push({
          entity: 'transactionItems',
          entityId: txItemId,
          action: 'CREATE',
          payload: { ...txItem },
        })

        // 4. Handle composition consumptions via FEFO
        if (item.compositionConsumptions && item.compositionConsumptions.length > 0) {
          for (const comp of item.compositionConsumptions) {
            // Pre-check stok sebelum consume
            const availableStock = await OfflineFEFO.calculateItemStock(
              comp.inventoryItemId,
              outletId,
            )

            if (availableStock < comp.totalConsumed) {
              throw new Error(
                `Stok tidak cukup untuk ${comp.itemName}. ` +
                `Tersedia: ${availableStock} ${comp.baseUnit}, ` +
                `dibutuhkan: ${comp.totalConsumed} ${comp.baseUnit}`,
              )
            }

            // Delegate ke FEFO engine — mengelola batch deduction, movement
            // creation, stock recalculation, dan sync queue-nya sendiri
            // (nested Dexie transaction)
            const _result: BatchConsumptionResult = await OfflineFEFO.consumeBatch({
              inventoryItemId: comp.inventoryItemId,
              quantityNeeded: comp.totalConsumed,
              outletId,
              transactionId,
              invoiceNumber,
              userId,
              sourceDetails: JSON.stringify({
                transactionItemId: txItemId,
                productName: item.productName,
                variantName: item.variantName ?? null,
                qty: item.qty,
              }),
            })
            // _result digunakan secara implisit — FEFO sudah menangani
            // batch updates, consumption logs, movements, dan sync entries
          }
        }
      }

      // 5. Update customer totalSpend & points
      if (customerId) {
        const customer = await db.customers.get(customerId)
        if (!customer) {
          throw new Error(`Pelanggan dengan ID ${customerId} tidak ditemukan`)
        }
        if (customer.deletedAt) {
          throw new Error('Pelanggan sudah tidak aktif')
        }

        // Validasi poin
        if (pointsUsed > customer.points) {
          throw new Error(
            `Poin pelanggan tidak cukup. Tersedia: ${customer.points} poin, ` +
            `digunakan: ${Math.round(pointsUsed)} poin`,
          )
        }

        // Points earned: Rp10.000 = 1 poin (standar retail Indonesia)
        const pointsEarned = Math.floor(Math.round(total) / 10000)

        const updatedCustomer: OfflineCustomer = {
          ...customer,
          totalSpend: customer.totalSpend + Math.round(total),
          points: customer.points - Math.round(pointsUsed) + pointsEarned,
          syncStatus: 'PENDING',
          version: customer.version + 1,
          updatedAt: now,
          deletedAt: null,
        }

        await db.customers.put(updatedCustomer)

        syncEntries.push({
          entity: 'customers',
          entityId: customerId,
          action: 'UPDATE',
          payload: { ...updatedCustomer },
        })

        // LoyaltyLog adalah cloud-only — tidak ada tabel di Dexie.
        // Saat sync ke server, server akan membuat LoyaltyLog.
      }
    })

    // 6. Setelah transaction commit, enqueue perubahan non-FEFO ke sync queue
    //    (FEFO engine sudah meng-enqueue perubahan inventarisnya sendiri)
    if (syncEntries.length > 0) {
      await syncEnqueueBatch(syncEntries)
    }

    return {
      transaction: createdTransaction,
      items: createdItems,
    }
  }

  // ────────────────────────────────────────────────────────
  // Void Transaction
  // ────────────────────────────────────────────────────────

  /**
   * Batalkan (void) transaksi offline.
   *
   * Proses:
   * - Restore semua FEFO batch consumption (delegated ke OfflineFEFO)
   * - Restore customer totalSpend & points
   * - Soft-delete transaction, items, dan consumption logs
   * - Enqueue ke sync queue dengan action DELETE
   */
  static async voidTransaction(params: VoidParams): Promise<{ success: boolean }> {
    const { transactionId, outletId, userId } = params

    const db = getAetherDB()
    const syncEntries: SyncEntry[] = []

    await db.transaction('rw', [...CHECKOUT_TABLES], async () => {
      const now = new Date().toISOString()

      // 1. Baca transaction
      const transaction = await db.transactions.get(transactionId)
      if (!transaction) {
        throw new Error('Transaksi tidak ditemukan')
      }
      if (transaction.deletedAt) {
        throw new Error('Transaksi sudah dibatalkan sebelumnya')
      }
      if (transaction.outletId !== outletId) {
        throw new Error('Transaksi bukan milik outlet ini')
      }

      // 2. Baca transaction items (active only)
      const txItems = await db.transactionItems
        .where('transactionId')
        .equals(transactionId)
        .filter(item => !item.deletedAt)
        .toArray()

      // 3. Restore FEFO batch consumptions
      //    OfflineFEFO.restoreFromLogs menangani: batch quantity restoration,
      //    RESTOCK movement creation, inventory item stock recalculation,
      //    dan sync queue-nya sendiri (nested Dexie transactions)
      const _restoreResults: BatchRestorationResult[] = await OfflineFEFO.restoreFromLogs({
        transactionId,
        invoiceNumber: transaction.invoiceNumber,
        outletId,
        userId,
      })

      // 4. Restore customer totalSpend & points
      if (transaction.customerId) {
        const customer = await db.customers.get(transaction.customerId)
        if (customer && !customer.deletedAt) {
          // Points earned yang perlu di-revert (Rp10.000 = 1 poin)
          const pointsEarned = Math.floor(transaction.total / 10000)

          const updatedCustomer: OfflineCustomer = {
            ...customer,
            totalSpend: Math.max(0, customer.totalSpend - transaction.total),
            points: Math.max(0, customer.points + transaction.pointsUsed - pointsEarned),
            syncStatus: 'PENDING',
            version: customer.version + 1,
            updatedAt: now,
            deletedAt: null,
          }

          await db.customers.put(updatedCustomer)

          syncEntries.push({
            entity: 'customers',
            entityId: transaction.customerId,
            action: 'UPDATE',
            payload: { ...updatedCustomer },
          })
        }
      }

      // 5. Soft-delete transaction (set deletedAt — JANGAN hard delete!)
      const voidedTransaction: OfflineTransaction = {
        ...transaction,
        deletedAt: now,
        updatedAt: now,
        syncStatus: 'PENDING',
        version: transaction.version + 1,
      }
      await db.transactions.put(voidedTransaction)

      syncEntries.push({
        entity: 'transactions',
        entityId: transactionId,
        action: 'DELETE',
        payload: { id: transactionId, deletedAt: now },
      })

      // 6. Soft-delete transaction items
      for (const item of txItems) {
        const voidedItem: OfflineTransactionItem = {
          ...item,
          deletedAt: now,
          updatedAt: now,
          syncStatus: 'PENDING',
          version: item.version + 1,
        }
        await db.transactionItems.put(voidedItem)

        syncEntries.push({
          entity: 'transactionItems',
          entityId: item.id,
          action: 'DELETE',
          payload: { id: item.id, deletedAt: now },
        })
      }

      // 7. Soft-delete batch consumption logs untuk transaksi ini
      //    (FEFO engine tidak melakukan ini — kita yang handle)
      const consumptionLogs = await db.batchConsumptionLogs
        .where('transactionId')
        .equals(transactionId)
        .toArray()

      for (const log of consumptionLogs) {
        const voidedLog: OfflineBatchConsumptionLog = {
          ...log,
          deletedAt: now,
          updatedAt: now,
          syncStatus: 'PENDING',
          version: log.version + 1,
        }
        await db.batchConsumptionLogs.put(voidedLog)

        syncEntries.push({
          entity: 'batchConsumptionLogs',
          entityId: log.id,
          action: 'DELETE',
          payload: { id: log.id, deletedAt: now },
        })
      }
    })

    // 8. Setelah transaction commit, enqueue semua perubahan ke sync queue
    //    (FEFO engine sudah meng-enqueue perubahan inventarisnya sendiri)
    if (syncEntries.length > 0) {
      await syncEnqueueBatch(syncEntries)
    }

    return { success: true }
  }
}