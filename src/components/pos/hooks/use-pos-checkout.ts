/**
 * usePosCheckout() — Payment flow, hold/resume transactions, checkout orchestration,
 * and dialog state management for POS.
 *
 * Extracted from pos-page.tsx Phase 1A modularization.
 * Original lines: 118-123 (CheckoutResult), 440-442 (payment states),
 *                 534-536 + 561 (dialog states), 543 (holdNote),
 *                 544 (holdNoteOpen), 545 (checkingOut), 546 (checkoutResult),
 *                 1130-1132 (pointsChange), 1134-1234 (pending transactions),
 *                 1354-1483 (handleCheckout + payment/receipt handlers)
 *
 * @phase 1A — Move code without changing meaning
 * @boundary COCKPIT only — no engine imports
 * @preserve OFFLINE-FIRST COMMIT PATTERN: Local commit ≠ server success
 * @preserve BUG-02 (stock rollback on sync failure) — fix in Phase 1B
 */

'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { localDB } from '@/lib/local-db'
import { useSession } from 'next-auth/react'
import type { CartItem } from './use-pos-cart'
import type { Product, ProductVariant } from './use-pos-products'
import type { Customer } from './use-pos-customers'

// ==================== INTERFACES ====================

export interface CheckoutResult {
  success: boolean
  invoiceNumber: string
  message?: string
  syncError?: string
}

export interface PendingTransaction {
  id?: number
  items: Array<{
    product: Product
    variant: unknown
    qty: number
    customPrice?: number | null
  }>
  customerId: string | null
  customerName: string | null
  note: string
  subtotal: number
  createdAt: number
  userId: string
  userName: string
}

// ==================== HOOK OPTIONS ====================

interface UsePosCheckoutOptions {
  // From usePosCart
  cart: CartItem[]
  subtotal: number
  total: number
  change: number
  manualDiscountTotal: number
  pointsDiscount: number
  promoDiscount: number
  ppnAmount: number
  hasBelowHpp: boolean
  maxPointsToUse: number
  pointsToUse: number

  // From usePosSync
  isOnline: boolean
  checkoutSyncRef: React.RefObject<boolean>

  // From usePosCustomers
  selectedCustomer: Customer | null
  customers: Customer[]

  // From usePosSettings
  availablePaymentMethods: Array<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>
  selectedPromo: { id: string; name: string } | null

  // Helpers from usePosCart
  getItemPrice: (item: CartItem) => number

  // Refresh callbacks
  onRefreshProducts?: () => void
  onRefreshCustomers?: () => void

  // State setters from parent (for cross-concern coordination)
  onClearCart: () => void
  onSetPointsToUse: (points: number) => void
  onSetSelectedCustomer: (customer: Customer | null) => void
  onSetPaidAmount: (amount: string) => void
  onSetPaymentMethod: (method: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER') => void
  onSetSelectedPromo: (promo: { id: string; name: string; type: string; discount: number; description: string } | null) => void
  onSetPromoDiscount: (discount: number) => void

  // C3: Resume pending — restore cart items through usePosCart (single source of truth)
  onRestoreCart: (items: CartItem[]) => void
}

// ==================== HOOK RETURN ====================

interface UsePosCheckoutReturn {
  // State
  paymentMethod: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'
  paidAmount: string
  paymentDialogOpen: boolean
  receiptDialogOpen: boolean
  holdNote: string
  holdNoteOpen: boolean
  checkingOut: boolean
  checkoutResult: CheckoutResult | null
  mobileCartOpen: boolean

  // Actions
  setPaidAmount: (amount: string) => void
  setPaymentDialogOpen: (open: boolean) => void
  setReceiptDialogOpen: (open: boolean) => void
  setMobileCartOpen: (open: boolean) => void
  setHoldNote: (note: string) => void
  setHoldNoteOpen: (open: boolean) => void

  // Handlers
  openPaymentDialog: () => void
  handleCheckout: () => Promise<void>
  handleReceiptFinish: () => void
  handlePointsChange: (value: string) => void

  // Pending transactions
  handleHoldTransaction: () => void
  confirmHoldTransaction: () => Promise<void>
  handleResumePending: (pending: PendingTransaction) => Promise<void>
  handleDeletePending: (id: number) => Promise<void>
}

// ==================== HOOK IMPLEMENTATION ====================

export function usePosCheckout(options: UsePosCheckoutOptions): UsePosCheckoutReturn {
  const {
    cart, subtotal, total, change, manualDiscountTotal, pointsDiscount, promoDiscount, ppnAmount,
    hasBelowHpp, maxPointsToUse, pointsToUse,
    isOnline, checkoutSyncRef,
    selectedCustomer, customers,
    availablePaymentMethods, selectedPromo,
    getItemPrice,
    onRefreshProducts, onRefreshCustomers,
    onClearCart, onSetPointsToUse, onSetSelectedCustomer, onSetPaidAmount,
    onSetPaymentMethod, onSetSelectedPromo, onSetPromoDiscount,
    onRestoreCart,
  } = options

  const { data: session } = useSession()

  // ── Dialog / UI State (originally lines 440-446, 534-546) ──
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>('CASH')
  const [paidAmount, setPaidAmount] = useState('')
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [holdNote, setHoldNote] = useState('')
  const [holdNoteOpen, setHoldNoteOpen] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)

  // ── Payment method reset if not in available methods (C2: single owner) ──
  // Moved from usePosSettings — usePosCheckout owns active paymentMethod
  useEffect(() => {
    if (availablePaymentMethods.length > 0 && !availablePaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(availablePaymentMethods[0])
    }
  }, [availablePaymentMethods, paymentMethod])

  // ── Points change handler (originally line 1130-1132) ──
  const handlePointsChange = (value: string) => {
    onSetPointsToUse(Math.min(Number(value) || 0, maxPointsToUse))
  }

  // ==================== PENDING TRANSACTIONS (originally lines 1134-1234) ====================

  const handleHoldTransaction = useCallback(() => {
    if (cart.length === 0) return
    setHoldNoteOpen(true)
  }, [cart.length])

  const confirmHoldTransaction = useCallback(async () => {
    setHoldNoteOpen(false)
    try {
      const userName = session?.user?.name || 'Unknown'
      const userId = (session?.user as any)?.id || ''
      await localDB.pendingTransactions.add({
        items: cart.map(item => ({
          product: item.product,
          variant: item.variant,
          qty: item.qty,
          customPrice: item.customPrice,
        })),
        customerId: selectedCustomer?.id || null,
        customerName: selectedCustomer?.name || null,
        note: holdNote.trim(),
        subtotal,
        createdAt: Date.now(),
        userId,
        userName,
      })
      setHoldNote('')
      onClearCart()
      setMobileCartOpen(false)
      toast.success('Transaksi ditunda')
    } catch {
      toast.error('Gagal menunda transaksi')
    }
  }, [cart, selectedCustomer, holdNote, subtotal, session, onClearCart])

  // C3: Resume pending — FULL CART RESTORATION through usePosCart (single source of truth)
  // Flow: load pending → restore customer → restore payment → RESTORE CART ITEMS → UI reflects
  const handleResumePending = useCallback(async (pending: PendingTransaction) => {
    // Step 1: If current cart has items, auto-hold them first (BUG-06: silent, fix in Phase 1B)
    if (cart.length > 0) {
      try {
        const userName = session?.user?.name || 'Unknown'
        const userId = (session?.user as any)?.id || ''
        await localDB.pendingTransactions.add({
          items: cart.map(item => ({
            product: item.product,
            variant: item.variant,
            qty: item.qty,
            customPrice: item.customPrice,
          })),
          customerId: selectedCustomer?.id || null,
          customerName: selectedCustomer?.name || null,
          note: '',
          subtotal,
          createdAt: Date.now(),
          userId,
          userName,
        })
      } catch { /* silent auto-hold */ }
    }

    // Step 2: Restore customer
    if (pending.customerId && pending.customerName) {
      const customer = customers.find(c => c.id === pending.customerId)
      if (customer) {
        onSetSelectedCustomer(customer)
      } else {
        onSetSelectedCustomer({ id: pending.customerId, name: pending.customerName, whatsapp: '', points: 0 })
      }
    } else {
      onSetSelectedCustomer(null)
    }

    // Step 3: Reset payment and promo state
    onSetPointsToUse(0)
    onSetPaidAmount('')
    onSetSelectedPromo(null)
    onSetPromoDiscount(0)

    // Step 4: RESTORE CART ITEMS through usePosCart (single source of truth!)
    const items = pending.items as Array<{ product: Product; variant: ProductVariant | null; qty: number; customPrice?: number | null }>
    onRestoreCart(items.map(item => ({
      product: item.product,
      variant: item.variant,
      qty: item.qty,
      customPrice: item.customPrice ?? null,
    })))

    // Step 5: Delete the pending transaction from IndexedDB
    if (pending.id) {
      await localDB.pendingTransactions.delete(pending.id)
    }

    toast.success('Transaksi dilanjutkan')
  }, [cart, selectedCustomer, subtotal, session, customers, onSetSelectedCustomer, onSetPointsToUse, onSetPaidAmount, onSetSelectedPromo, onSetPromoDiscount, onRestoreCart])

  const handleDeletePending = useCallback(async (id: number) => {
    try {
      await localDB.pendingTransactions.delete(id)
      toast.success('Transaksi pending dihapus')
    } catch {
      toast.error('Gagal menghapus transaksi pending')
    }
  }, [])

  // ==================== CHECKOUT (originally lines 1354-1483) ====================
  // PRESERVE: Offline-first commit pattern (COMMIT ≠ server success)

  const handleCheckout = useCallback(async () => {
    if (cart.length === 0) return
    if (paymentMethod === 'CASH' && Number(paidAmount) < total) {
      toast.error('Jumlah bayar kurang dari total')
      return
    }
    setCheckingOut(true)
    try {
      const checkoutPayload = {
        customerId: selectedCustomer?.id || null,
        items: cart.map((item) => ({
          productId: item.product.id,
          productName: item.product.name,
          price: getItemPrice(item),
          qty: item.qty,
          subtotal: getItemPrice(item) * item.qty,
          variantId: item.variant?.id || null,
          variantName: item.variant?.name || null,
          itemDiscount: item.customPrice != null ? Math.round((getItemPrice(item) - item.customPrice) * item.qty) : 0,
        })),
        subtotal,
        discount: manualDiscountTotal + pointsDiscount + promoDiscount,
        pointsUsed: pointsToUse,
        taxAmount: ppnAmount,
        total,
        paymentMethod,
        paidAmount: paymentMethod === 'CASH' ? Number(paidAmount) : total,
        change: paymentMethod === 'CASH' ? change : 0,
        promoId: selectedPromo?.id || null,
        promoDiscount,
      }

      // STEP 1: Save to IndexedDB first (LOCAL COMMIT)
      const eventId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const localId = await localDB.transactions.add({
        payload: checkoutPayload,
        isSynced: 0,
        createdAt: Date.now(),
        retryCount: 0,
        eventId,
      })

      // STEP 1b: Decrement stock locally in IndexedDB to prevent overselling while offline
      await Promise.all(cart.map(item =>
        localDB.products
          .where('id')
          .equals(item.product.id)
          .modify((p: any) => {
            if (item.variant) {
              const v = p.variants?.find((v: any) => v.id === item.variant!.id)
              if (v) {
                v.stock = Math.max(0, (v.stock || 0) - item.qty)
              }
            } else {
              p.stock = Math.max(0, (p.stock || 0) - item.qty)
            }
            p.updatedAt = new Date().toISOString()
          })
      ))

      // STEP 2: If online, sync immediately
      if (isOnline) {
        checkoutSyncRef.current = true
        try {
          const unsyncedTx = await localDB.transactions.get(localId)
          if (unsyncedTx) {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 20000)
            try {
              const syncRes = await fetch('/api/transactions/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transactions: [unsyncedTx] }),
                signal: controller.signal,
              })
              clearTimeout(timeoutId)
              const syncData = await syncRes.json()
              if (syncRes.ok && syncData.synced > 0) {
                await localDB.transactions.update(localId, {
                  isSynced: 1,
                  syncedAt: Date.now(),
                  invoiceNumber: syncData.results?.[0]?.invoiceNumber,
                  serverTransactionId: syncData.results?.[0]?.serverId,
                })
                const invoiceNum = syncData.results?.[0]?.invoiceNumber || `OFF-${Date.now().toString(36).toUpperCase()}`
                setCheckoutResult({ success: true, invoiceNumber: invoiceNum })
                toast.success(`Pembayaran berhasil! Invoice: ${invoiceNum}`)
              } else {
                const error = syncData.results?.[0]?.error || syncData.error || 'Gagal sync ke server'
                const invoiceNum = `OFF-${Date.now().toString(36).toUpperCase()}`
                setCheckoutResult({ success: true, invoiceNumber: invoiceNum, message: 'Tersimpan lokal', syncError: error })
                toast.warning('Tersimpan lokal — akan sync otomatis', { description: error })
              }
            } catch (syncErr) {
              clearTimeout(timeoutId)
              console.error('Immediate sync failed:', syncErr)
              const invoiceNum = `OFF-${Date.now().toString(36).toUpperCase()}`
              setCheckoutResult({ success: true, invoiceNumber: invoiceNum, message: 'Tersimpan offline', syncError: 'Tidak dapat terhubung ke server' })
              toast.warning('Tersimpan offline — akan sync otomatis')
            }
          }
        } finally {
          checkoutSyncRef.current = false
        }
      } else {
        const invoiceNum = `OFF-${Date.now().toString(36).toUpperCase()}`
        setCheckoutResult({ success: true, invoiceNumber: invoiceNum, message: 'Transaksi offline' })
        toast.warning('Offline — transaksi tersimpan lokal', { duration: 5000 })
      }

      // Close payment dialog, open receipt dialog
      setPaymentDialogOpen(false)
      setReceiptDialogOpen(true)
      onRefreshProducts?.()
      onRefreshCustomers?.()
    } catch {
      toast.error('Checkout gagal')
    } finally {
      setCheckingOut(false)
    }
  }, [
    cart, selectedCustomer, subtotal, total, paymentMethod, paidAmount, change,
    manualDiscountTotal, pointsDiscount, promoDiscount, ppnAmount, pointsToUse,
    selectedPromo, getItemPrice, isOnline, checkoutSyncRef,
    onRefreshProducts, onRefreshCustomers,
  ])

  // ── Open payment dialog (originally lines 1486-1496) ──
  const openPaymentDialog = useCallback(() => {
    if (cart.length === 0) return
    if (hasBelowHpp) {
      toast.error('Harga diskon di bawah HPP. Sesuaikan harga atau konfirmasi owner.', { duration: 3000, id: 'below-hpp-block' })
      return
    }
    setCheckoutResult(null)
    onSetPaidAmount('')
    setPaymentDialogOpen(true)
    setMobileCartOpen(false)
  }, [cart.length, hasBelowHpp, onSetPaidAmount])

  // ── Receipt finish (originally lines 1499-1502) ──
  const handleReceiptFinish = useCallback(() => {
    setReceiptDialogOpen(false)
    onClearCart()
  }, [onClearCart])

  return {
    // State
    paymentMethod,
    paidAmount,
    paymentDialogOpen,
    receiptDialogOpen,
    holdNote,
    holdNoteOpen,
    checkingOut,
    checkoutResult,
    mobileCartOpen,

    // Setters
    setPaidAmount,
    setPaymentDialogOpen,
    setReceiptDialogOpen,
    setMobileCartOpen,
    setHoldNote,
    setHoldNoteOpen,

    // Handlers
    openPaymentDialog,
    handleCheckout,
    handleReceiptFinish,
    handlePointsChange,

    // Pending transactions
    handleHoldTransaction,
    confirmHoldTransaction,
    handleResumePending,
    handleDeletePending,
  }
}
