/**
 * usePosCheckout() — Payment flow, hold/resume, checkout orchestration, dialog state.
 *
 * PR 3 — Offline POS with Dexie:
 *   - Checkout writes to transactionOutbox with localTransactionId (= eventId)
 *     + persisted calculation snapshot.
 *   - Online: sync immediately via /api/transactions/sync (eventId = idempotency).
 *   - Offline: store in outbox (status PENDING); synced on reconnect.
 *   - localTransactionId prevents duplicate invoice / inventory / audit (DEX-007).
 *
 * @boundary COCKPIT only — no engine imports
 * @preserve OFFLINE-FIRST COMMIT PATTERN: Local commit ≠ server success
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import type { CartItem } from './use-pos-cart'
import type { Customer } from './use-pos-customers'
import { tryGetPosDB, type TransactionOutboxRow } from '@/lib/pos/pos-db'
import { buildCheckoutPayload, type CalcResult } from '@/lib/pos/pos-calc'

// ==================== INTERFACES ====================

export interface CheckoutResult {
  success: boolean
  invoiceNumber: string
  message?: string
  syncError?: string
}

interface UsePosCheckoutOptions {
  cart: CartItem[]
  calcResult: CalcResult
  isOnline: boolean
  selectedCustomer: Customer | null
  availablePaymentMethods: Array<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>
  selectedPromo: { id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null } | null
  pointsToUse: number
  paymentMethod: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'
  paidAmount: string
  onSetPaymentMethod: (m: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER') => void
  onSetPaidAmount: (a: string) => void
  onRefreshProducts?: () => void
  onRefreshCustomers?: () => void
  onClearCart: () => void
  onSetPointsToUse: (points: number) => void
  onSetSelectedCustomer: (customer: Customer | null) => void
  onSetSelectedPromo: (promo: unknown) => void
  onSetPromoDiscount: (discount: number) => void
  onRestoreCart: (items: CartItem[]) => void
}

interface UsePosCheckoutReturn {
  paymentMethod: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'
  paidAmount: string
  setPaymentMethod: (m: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER') => void
  setPaidAmount: (a: string) => void
  paymentDialogOpen: boolean
  receiptDialogOpen: boolean
  holdNote: string
  holdNoteOpen: boolean
  checkingOut: boolean
  checkoutResult: CheckoutResult | null
  mobileCartOpen: boolean
  setPaymentDialogOpen: (open: boolean) => void
  setReceiptDialogOpen: (open: boolean) => void
  setMobileCartOpen: (open: boolean) => void
  setHoldNote: (note: string) => void
  setHoldNoteOpen: (open: boolean) => void
  openPaymentDialog: () => void
  handleCheckout: () => Promise<void>
  handleReceiptFinish: () => void
  handlePointsChange: (value: string) => void
  triggerSync: () => Promise<{ synced: number; failed: number }>
}

export function usePosCheckout(options: UsePosCheckoutOptions): UsePosCheckoutReturn {
  const {
    cart, calcResult, isOnline, selectedCustomer, availablePaymentMethods, selectedPromo, pointsToUse,
    paymentMethod, paidAmount, onSetPaymentMethod, onSetPaidAmount,
    onRefreshProducts, onRefreshCustomers, onClearCart,
    onSetPointsToUse, onSetSelectedCustomer,
    onSetSelectedPromo, onSetPromoDiscount, onRestoreCart,
  } = options

  const { data: session } = useSession()

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [holdNote, setHoldNote] = useState('')
  const [holdNoteOpen, setHoldNoteOpen] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)

  useEffect(() => {
    if (availablePaymentMethods.length > 0 && !availablePaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(availablePaymentMethods[0])
    }
  }, [availablePaymentMethods, paymentMethod])

  const handlePointsChange = (value: string) => {
    onSetPointsToUse(Math.min(Number(value) || 0, calcResult.maxPointsToUse))
  }

  // ==================== CHECKOUT (PR 3: transactionOutbox + localTransactionId) ====================

  const handleCheckout = useCallback(async () => {
    if (cart.length === 0) return
    if (paymentMethod === 'CASH' && Number(paidAmount) < calcResult.grandTotal) {
      toast.error('Jumlah bayar kurang dari total')
      return
    }
    setCheckingOut(true)
    try {
      const localTransactionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

      const customerIsLocal = !!(selectedCustomer?.isLocal)
      const payload = buildCheckoutPayload(cart, calcResult, {
        customerId: selectedCustomer?.id || null,
        customerIsLocal,
        paymentMethod,
        paidAmount: Number(paidAmount) || calcResult.grandTotal,
        promoId: selectedPromo?.id || null,
        pointsUsed: calcResult.snapshot.pointsUsed,
      })

      const outboxRow: TransactionOutboxRow = {
        id: localTransactionId,
        payload,
        snapshot: calcResult.snapshot,
        createdAt: Date.now(),
        status: 'PENDING',
        serverId: null,
        invoiceNumber: null,
        error: null,
        retryCount: 0,
      }
      const db = tryGetPosDB()
      if (db) {
        await db.transactionOutbox.put(outboxRow)
      }

      if (isOnline) {
        const syncResult = await syncOutbox()
        if (syncResult.synced > 0) {
          const row = db ? await db.transactionOutbox.get(localTransactionId) : null
          const invoiceNum = row?.invoiceNumber || `INV-${Date.now().toString(36).toUpperCase()}`
          setCheckoutResult({ success: true, invoiceNumber: invoiceNum })
          toast.success(`Pembayaran berhasil! Invoice: ${invoiceNum}`)
        } else {
          const invoiceNum = `OFF-${Date.now().toString(36).toUpperCase()}`
          setCheckoutResult({ success: true, invoiceNumber: invoiceNum, message: 'Tersimpan lokal', syncError: 'Akan sync otomatis' })
          toast.warning('Tersimpan lokal — akan sync otomatis')
        }
      } else {
        const invoiceNum = `OFF-${Date.now().toString(36).toUpperCase()}`
        setCheckoutResult({ success: true, invoiceNumber: invoiceNum, message: 'Transaksi offline' })
        toast.warning('Offline — transaksi tersimpan lokal', { duration: 5000 })
      }

      setPaymentDialogOpen(false)
      setReceiptDialogOpen(true)
      onRefreshProducts?.()
      onRefreshCustomers?.()
    } catch {
      toast.error('Checkout gagal')
    } finally {
      setCheckingOut(false)
    }
  }, [cart, calcResult, paymentMethod, paidAmount, isOnline, selectedCustomer, selectedPromo, onRefreshProducts, onRefreshCustomers])

  const triggerSync = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    return syncOutbox()
  }, [])

  const openPaymentDialog = useCallback(() => {
    if (cart.length === 0) return
    if (cart.some(item => {
      const eff = item.customPrice != null ? item.customPrice : (item.variant ? item.variant.price : item.product.price)
      const hpp = item.variant ? item.variant.hpp : item.product.hpp
      return eff < hpp
    })) {
      toast.error('Harga diskon di bawah HPP. Sesuaikan harga atau konfirmasi owner.', { duration: 3000, id: 'below-hpp-block' })
      return
    }
    setCheckoutResult(null)
    onSetPaidAmount('')
    setPaymentDialogOpen(true)
    setMobileCartOpen(false)
  }, [cart, calcResult, onSetPaidAmount])

  const handleReceiptFinish = useCallback(() => {
    setReceiptDialogOpen(false)
    onClearCart()
  }, [onClearCart])

  return {
    paymentMethod, paidAmount, setPaymentMethod: onSetPaymentMethod, setPaidAmount: onSetPaidAmount,
    paymentDialogOpen, receiptDialogOpen, holdNote, holdNoteOpen,
    checkingOut, checkoutResult, mobileCartOpen,
    setPaymentDialogOpen, setReceiptDialogOpen, setMobileCartOpen,
    setHoldNote, setHoldNoteOpen,
    openPaymentDialog, handleCheckout, handleReceiptFinish, handlePointsChange,
    triggerSync,
  }
}

// ==================== PR 3: Outbox sync logic ====================

/**
 * Sync the outbox in the correct order:
 *   1. Sync customerOutbox (create local customers on server)
 *   2. Resolve localCustomerId → serverId in pending transactions
 *   3. Sync transactionOutbox (eventId = localTransactionId for idempotency)
 *
 * Safety:
 *   - Never clears Dexie before successful response.
 *   - Failed sync preserves cache + outbox row (status FAILED, retryCount++).
 *   - Duplicate-safe: eventId dedupes server-side (DEX-007).
 */
export async function syncOutbox(): Promise<{ synced: number; failed: number }> {
  const db = tryGetPosDB()
  if (!db) return { synced: 0, failed: 0 }

  let synced = 0
  let failed = 0

  // ── 1. Sync customerOutbox ──
  const pendingCustomers = await db.customerOutbox.where('status').equals('PENDING').toArray()
  for (const cust of pendingCustomers) {
    try {
      await db.customerOutbox.update(cust.id, { status: 'SYNCING' })
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cust.name, whatsapp: cust.whatsapp || undefined }),
      })
      if (res.ok) {
        const created = await res.json()
        await db.customerOutbox.update(cust.id, { status: 'SYNCED', serverId: created.id })
        await db.customers.delete(cust.id)
        await db.customers.put({
          id: created.id, name: created.name, whatsapp: created.whatsapp || '',
          points: 0, totalSpend: 0, isLocal: false, cachedAt: Date.now(),
        })
        synced++
      } else {
        const err = await res.json().catch(() => ({}))
        await db.customerOutbox.update(cust.id, {
          status: 'FAILED', error: err.message || `HTTP ${res.status}`, retryCount: cust.retryCount + 1,
        })
        failed++
      }
    } catch (e) {
      await db.customerOutbox.update(cust.id, {
        status: 'FAILED', error: e instanceof Error ? e.message : 'Network error',
        retryCount: cust.retryCount + 1,
      })
      failed++
    }
  }

  // ── 2. Resolve localCustomerId in pending transactions ──
  const resolvedCustomers = await db.customerOutbox.where('status').equals('SYNCED').toArray()
  const localToServer = new Map(resolvedCustomers.filter(c => c.serverId).map(c => [c.id, c.serverId!]))
  const pendingTx = await db.transactionOutbox.where('status').equals('PENDING').toArray()
  for (const tx of pendingTx) {
    if (tx.payload.customerIsLocal && tx.payload.customerId && localToServer.has(tx.payload.customerId)) {
      const serverId = localToServer.get(tx.payload.customerId)!
      await db.transactionOutbox.update(tx.id, {
        payload: { ...tx.payload, customerId: serverId, customerIsLocal: false },
      })
    }
  }

  // ── 3. Sync transactionOutbox ──
  const toSync = await db.transactionOutbox.where('status').equals('PENDING').toArray()
  if (toSync.length > 0) {
    // Assign unique integer localIds for result matching (sync route returns localId)
    const idMap = new Map<number, string>() // localId → eventId (localTransactionId)
    const transactions = toSync.map((tx, i) => {
      const localId = i + 1
      idMap.set(localId, tx.id)
      return { id: localId, eventId: tx.id, payload: tx.payload, createdAt: tx.createdAt }
    })
    try {
      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions }),
      })
      const data = await res.json()
      if (res.ok) {
        for (const result of data.results || []) {
          const eventId = idMap.get(result.localId)
          if (!eventId) continue
          if (result.success) {
            await db.transactionOutbox.update(eventId, {
              status: 'SYNCED', serverId: result.serverId || null,
              invoiceNumber: result.invoiceNumber || null,
            })
            synced++
          } else {
            const existing = await db.transactionOutbox.get(eventId)
            await db.transactionOutbox.update(eventId, {
              status: 'FAILED', error: result.error || 'Sync failed',
              retryCount: (existing?.retryCount || 0) + 1,
            })
            failed++
          }
        }
      } else {
        for (const tx of toSync) {
          await db.transactionOutbox.update(tx.id, { status: 'FAILED', error: `HTTP ${res.status}` })
        }
        failed += toSync.length
      }
    } catch (e) {
      // Network error — leave as PENDING (will retry on next trigger)
      failed += toSync.length
    }
  }

  return { synced, failed }
}
