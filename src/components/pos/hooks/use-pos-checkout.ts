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
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import type { CartItem } from './use-pos-cart'
import type { Customer } from './use-pos-customers'
import type { Product, ProductVariant } from './use-pos-products'
import {
  tryGetPosDB, type TransactionOutboxRow,
  type PendingTransactionRow, type LastReceiptRow, type PendingCartItem,
  addPendingTransaction, getPendingTransactions, deletePendingTransaction,
  saveLastReceipt, getLastReceipt,
} from '@/lib/pos/pos-db'
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
  /** Patch the React product-grid state from updatedStock (no network refetch).
   *  Called when stockUpdateSource === 'patched' — the Dexie cache was already
   *  updated by doSyncOutbox, but the product grid uses useState (not
   *  useLiveQuery), so without this the UI shows stale stock until a refetch. */
  onPatchProductStock?: (stock: { products: Record<string, number>; variants: Record<string, number> }) => void
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
  triggerSync: () => Promise<{ synced: number; failed: number; duplicateResolved: number; abandoned: number }>
  // PR 4 — Pending / Held orders
  pendingCount: number
  pendingList: PendingTransactionRow[]
  pendingListOpen: boolean
  setPendingListOpen: (open: boolean) => void
  handleHoldTransaction: () => void
  confirmHoldTransaction: () => Promise<void>
  handleResumePending: (pending: PendingTransactionRow) => Promise<void>
  handleDeletePending: (id: number) => Promise<void>
  // PR 4 — Reprint last receipt
  reprintOpen: boolean
  setReprintOpen: (open: boolean) => void
  reprintData: LastReceiptRow | null
  handleReprint: () => Promise<void>
}

export function usePosCheckout(options: UsePosCheckoutOptions): UsePosCheckoutReturn {
  const {
    cart, calcResult, isOnline, selectedCustomer, availablePaymentMethods, selectedPromo, pointsToUse,
    paymentMethod, paidAmount, onSetPaymentMethod, onSetPaidAmount,
    onRefreshProducts, onPatchProductStock, onRefreshCustomers, onClearCart,
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
  // PR 4 — Pending / Held orders + reprint
  const [pendingListOpen, setPendingListOpen] = useState(false)
  const [reprintOpen, setReprintOpen] = useState(false)
  const [reprintData, setReprintData] = useState<LastReceiptRow | null>(null)

  // Live pending list + count (auto-updates when Dexie changes)
  const pendingList = useLiveQuery(() => getPendingTransactions(), []) ?? []
  const pendingCount = pendingList.length

  // AUTO-SWITCH: if the currently selected payment method is no longer in the
  // outlet's enabled list (e.g. owner disabled CASH via Settings → Pembayaran &
  // Promo), fall back to the first available method so POS never renders a
  // payment method the server will reject at checkout.
  // NOTE: the option is named `onSetPaymentMethod` here (renamed to
  // `setPaymentMethod` only on the public return object at the bottom of this
  // hook). Previously this called `setPaymentMethod` directly, which is not in
  // scope → ReferenceError → <PosPage> crashed whenever CASH (the default
  // initial state) was disabled in settings.
  useEffect(() => {
    if (availablePaymentMethods.length > 0 && !availablePaymentMethods.includes(paymentMethod)) {
      onSetPaymentMethod(availablePaymentMethods[0])
    }
  }, [availablePaymentMethods, paymentMethod, onSetPaymentMethod])

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
    // PHASE 1: Frontend timing instrumentation (click → request → response → refetch)
    const tClick = performance.now()
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

      // OUTBOX CONTRADICTION FIX: the checkout's toast is now based on the
      // status of THIS transaction's own outbox row (looked up after sync),
      // NOT on the aggregate synced/failed counts. This prevents two bugs:
      //   (a) An OLD failed row masking the new row's success (synced > 0
      //       from the old row resolving → "Pembayaran berhasil" even though
      //       the new row actually failed).
      //   (b) The new row failing but "Tersimpan lokal" showing (synced === 0
      //       branch was reached even when failed > 0 — a real failure was
      //       mislabeled as offline-saved).
      // Correct UX:
      //   - Online + own row SYNCED → only "Pembayaran berhasil" + receipt.
      //   - Online + own row FAILED → "Pembayaran gagal: <reason>" (no receipt,
      //     cart preserved so cashier can fix and retry).
      //   - Offline → "Tersimpan offline, menunggu sinkronisasi" + receipt.
      if (isOnline) {
        const tRequestStart = performance.now()
        const syncResult = await syncOutbox()
        const tResponse = performance.now()
        const row = db ? await db.transactionOutbox.get(localTransactionId) : null
        if (row?.status === 'SYNCED') {
          const invoiceNum = row.invoiceNumber || `INV-${Date.now().toString(36).toUpperCase()}`
          const result: CheckoutResult = { success: true, invoiceNumber: invoiceNum }
          setCheckoutResult(result)
          toast.success(`Pembayaran berhasil! Invoice: ${invoiceNum}`)
          await saveLastReceiptSnapshot(result, cart, calcResult, paymentMethod, paidAmount, selectedCustomer, selectedPromo)
          setPaymentDialogOpen(false)
          setReceiptDialogOpen(true)
          // PHASE 2 OPTIMIZATION (rule 10): Skip full catalog refetch when
          // the sync response included updatedStock and we patched the local
          // catalog. Only refetch customers (loyalty points changed) and
          // products if stock wasn't patched (e.g. variant parents, or the
          // patch threw — see stockUpdateSource).
          //
          // stockUpdateSource verdict (honest):
          //  - 'patched'   → local Dexie updated + React state patched (fast path)
          //  - 'refetched' → server had stock but patch wrote 0 rows (threw,
          //                  or product not in Dexie yet) → MUST refetch
          //  - 'skipped'   → no stock payload (e.g. duplicate-event path);
          //                  UI is already consistent, no refetch needed
          //
          // REACT STATE PATCH: the product grid uses useState (not useLiveQuery),
          // so patching Dexie alone doesn't update the UI. When stockUpdateSource
          // === 'patched', we also patch the React state from mergedStock — no
          // network refetch needed. This is the true fast path.
          if (syncResult.stockUpdateSource === 'refetched') {
            onRefreshProducts?.()
          } else if (syncResult.stockUpdateSource === 'patched' && syncResult.mergedStock) {
            onPatchProductStock?.(syncResult.mergedStock)
          }
          onRefreshCustomers?.()
          // PHASE 1: Log frontend timing with honest stock-update verdict.
          // Previously logged only `stockPatched: false` which was ambiguous —
          // it couldn't tell "server didn't return stock" from "patch broke".
          // Now logs the source + count + any error so the metric can't lie.
          const tEnd = performance.now()
          console.log(
            `[checkout:fe-perf] click→request: ${Math.round(tRequestStart - tClick)}ms, ` +
            `network: ${Math.round(tResponse - tRequestStart)}ms, ` +
            `response→dialogClose: ${Math.round(tEnd - tResponse)}ms, ` +
            `total: ${Math.round(tEnd - tClick)}ms, ` +
            `stockUpdateSource: ${syncResult.stockUpdateSource}, ` +
            `patchedCount: ${syncResult.patchedCount}` +
            (syncResult.patchError ? `, patchError: ${syncResult.patchError}` : '') +
            `, stockPatched: ${syncResult.stockPatched}`
          )
        } else {
          // Online but this transaction's sync failed — genuine failure.
          // Keep the row (for manual retry from the sync panel) but do NOT
          // show a receipt or clear the cart. The cashier sees the error and
          // can adjust (stock/price) and retry.
          const errMsg = row?.error || 'Gagal terhubung ke server'
          toast.error(`Pembayaran gagal: ${errMsg}`, { duration: 6000 })
          // Leave payment dialog open so the cashier can retry or cancel.
        }
      } else {
        const invoiceNum = `OFF-${Date.now().toString(36).toUpperCase()}`
        const result: CheckoutResult = { success: true, invoiceNumber: invoiceNum, message: 'Tersimpan offline, menunggu sinkronisasi' }
        setCheckoutResult(result)
        toast.info('Tersimpan offline — menunggu sinkronisasi', { duration: 5000 })
        await saveLastReceiptSnapshot(result, cart, calcResult, paymentMethod, paidAmount, selectedCustomer, selectedPromo)
        setPaymentDialogOpen(false)
        setReceiptDialogOpen(true)
        onRefreshProducts?.()
        onRefreshCustomers?.()
      }
    } catch {
      toast.error('Checkout gagal')
    } finally {
      setCheckingOut(false)
    }
  }, [cart, calcResult, paymentMethod, paidAmount, isOnline, selectedCustomer, selectedPromo, onRefreshProducts, onPatchProductStock, onRefreshCustomers])

  const triggerSync = useCallback(async (): Promise<{ synced: number; failed: number; duplicateResolved: number; abandoned: number }> => {
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

  // ==================== PR 4: Pending / Held orders ====================
  //
  // Behavior matches the pre-rewrite implementation:
  //   - Tunda → opens note dialog → confirm → freeze cart+customer+promo+points
  //     to posDB.pendingTransactions → clear active cart.
  //   - Resume → if active cart has items, hold it first; then load pending items
  //     + customer + promo + points into the cart; delete the pending row.
  //   - Delete → removes the pending row.
  //   - pendingCount + pendingList are live (useLiveQuery) — the badge + dialog
  //     update automatically when rows are added/removed.

  const handleHoldTransaction = useCallback(() => {
    if (cart.length === 0) return
    setHoldNoteOpen(true)
  }, [cart.length])

  const confirmHoldTransaction = useCallback(async () => {
    setHoldNoteOpen(false)
    try {
      const userName = session?.user?.name || 'Unknown'
      const userId = (session?.user as { id?: string } | undefined)?.id || ''
      await addPendingTransaction({
        items: cartToPendingItems(cart),
        customerId: selectedCustomer?.id || null,
        customerName: selectedCustomer?.name || null,
        promo: selectedPromo ? { id: selectedPromo.id, name: selectedPromo.name, type: selectedPromo.type, value: selectedPromo.value, minPurchase: selectedPromo.minPurchase, maxDiscount: selectedPromo.maxDiscount } : null,
        pointsToUse,
        note: holdNote.trim(),
        subtotal: calcResult.subtotal,
        createdAt: Date.now(),
        userId,
        userName,
      })
      setHoldNote('')
      onClearCart()
      onSetSelectedCustomer(null)
      onSetSelectedPromo(null)
      onSetPointsToUse(0)
      setMobileCartOpen(false)
      toast.success('Transaksi ditunda')
    } catch {
      toast.error('Gagal menunda transaksi')
    }
  }, [cart, selectedCustomer, selectedPromo, pointsToUse, holdNote, calcResult.subtotal, session, onClearCart, onSetSelectedCustomer, onSetSelectedPromo, onSetPointsToUse])

  const handleResumePending = useCallback(async (pending: PendingTransactionRow) => {
    if (!pending.id) return
    // If active cart has items, hold it first (preserves current work)
    if (cart.length > 0) {
      try {
        const userName = session?.user?.name || 'Unknown'
        const userId = (session?.user as { id?: string } | undefined)?.id || ''
        await addPendingTransaction({
          items: cartToPendingItems(cart),
          customerId: selectedCustomer?.id || null,
          customerName: selectedCustomer?.name || null,
          promo: selectedPromo ? { id: selectedPromo.id, name: selectedPromo.name, type: selectedPromo.type, value: selectedPromo.value, minPurchase: selectedPromo.minPurchase, maxDiscount: selectedPromo.maxDiscount } : null,
          pointsToUse,
          note: '',
          subtotal: calcResult.subtotal,
          createdAt: Date.now(),
          userId,
          userName,
        })
      } catch { /* silent — don't block resume */ }
    }

    // Load pending items into cart + restore customer/promo/points
    try {
      const items = pendingItemsToCart(pending.items)
      onRestoreCart(items)
      if (pending.customerId && pending.customerName) {
        onSetSelectedCustomer({ id: pending.customerId, name: pending.customerName, whatsapp: '', points: 0 } as Customer)
      } else {
        onSetSelectedCustomer(null)
      }
      onSetPointsToUse(pending.pointsToUse || 0)
      onSetSelectedPromo(pending.promo)
      onSetPaidAmount('')

      await deletePendingTransaction(pending.id)
      setPendingListOpen(false)
      setMobileCartOpen(false)
      toast.success('Transaksi dilanjutkan')
    } catch {
      toast.error('Gagal melanjutkan transaksi')
    }
  }, [cart, selectedCustomer, selectedPromo, pointsToUse, calcResult.subtotal, session, onRestoreCart, onSetSelectedCustomer, onSetPointsToUse, onSetSelectedPromo, onSetPaidAmount])

  const handleDeletePending = useCallback(async (id: number) => {
    try {
      await deletePendingTransaction(id)
      toast.success('Transaksi pending dihapus')
    } catch {
      toast.error('Gagal menghapus transaksi pending')
    }
  }, [])

  // ==================== PR 4: Reprint last receipt ====================

  const handleReprint = useCallback(async () => {
    const last = await getLastReceipt()
    if (!last) {
      toast.info('Belum ada transaksi untuk dicetak ulang')
      return
    }
    setReprintData(last)
    setReprintOpen(true)
  }, [])

  return {
    paymentMethod, paidAmount, setPaymentMethod: onSetPaymentMethod, setPaidAmount: onSetPaidAmount,
    paymentDialogOpen, receiptDialogOpen, holdNote, holdNoteOpen,
    checkingOut, checkoutResult, mobileCartOpen,
    setPaymentDialogOpen, setReceiptDialogOpen, setMobileCartOpen,
    setHoldNote, setHoldNoteOpen,
    openPaymentDialog, handleCheckout, handleReceiptFinish, handlePointsChange,
    triggerSync,
    // PR 4
    pendingCount, pendingList, pendingListOpen, setPendingListOpen,
    handleHoldTransaction, confirmHoldTransaction, handleResumePending, handleDeletePending,
    reprintOpen, setReprintOpen, reprintData, handleReprint,
  }
}

// ==================== PR 4: Cart ↔ Pending mappers ====================

/** Convert active cart items to the serializable pending-item shape. */
function cartToPendingItems(cart: CartItem[]): PendingCartItem[] {
  return cart.map(item => ({
    product: {
      id: item.product.id,
      name: item.product.name,
      price: item.product.price,
      stock: item.product.stock,
      hpp: item.product.hpp,
      sku: item.product.sku,
      barcode: item.product.barcode,
      categoryId: item.product.categoryId,
      categoryName: item.product.categoryName,
      image: item.product.image,
      unit: item.product.unit,
      hasVariants: item.product.hasVariants,
      _variantCount: item.product._variantCount,
    },
    variant: item.variant ? {
      id: item.variant.id,
      name: item.variant.name,
      sku: item.variant.sku,
      barcode: item.variant.barcode,
      price: item.variant.price,
      hpp: item.variant.hpp,
      stock: item.variant.stock,
    } : null,
    qty: item.qty,
    customPrice: item.customPrice,
  }))
}

/** Convert stored pending items back to full CartItem (reconstructs Product/Variant). */
function pendingItemsToCart(items: PendingCartItem[]): CartItem[] {
  return items.map(item => ({
    product: {
      ...item.product,
      variants: [] as ProductVariant[],
    } as Product,
    variant: item.variant ? { ...item.variant } as ProductVariant : null,
    qty: item.qty,
    customPrice: item.customPrice ?? null,
  }))
}

/** Save a frozen snapshot of the just-completed transaction for reprint. */
async function saveLastReceiptSnapshot(
  result: CheckoutResult,
  cart: CartItem[],
  calcResult: CalcResult,
  paymentMethod: string,
  paidAmount: string,
  selectedCustomer: Customer | null,
  selectedPromo: { id: string; name: string } | null,
): Promise<void> {
  try {
    await saveLastReceipt({
      cart: cartToPendingItems(cart),
      subtotal: calcResult.subtotal,
      pointsDiscount: calcResult.pointsDiscount,
      promoDiscount: calcResult.promoDiscount,
      manualDiscountTotal: calcResult.manualDiscountTotal,
      ppnAmount: calcResult.taxAmount,
      total: calcResult.grandTotal,
      paymentMethod,
      paidAmount,
      change: paymentMethod === 'CASH' ? Math.max(0, (Number(paidAmount) || 0) - calcResult.grandTotal) : 0,
      customer: selectedCustomer ? { id: selectedCustomer.id, name: selectedCustomer.name, whatsapp: selectedCustomer.whatsapp, points: selectedCustomer.points } : null,
      promo: selectedPromo ? { id: selectedPromo.id, name: selectedPromo.name } : null,
      checkoutResult: result,
      createdAt: Date.now(),
    })
  } catch { /* non-critical — reprint just won't have a snapshot */ }
}

// ==================== PR 3: Outbox sync logic ====================

/**
 * Max sync attempts before a FAILED row is marked ABANDONED.
 *
 * Rationale: a genuinely broken row (e.g. qty=0 validation, deleted product)
 * will never sync. Capping retries prevents infinite hammering. Rows that hit
 * this cap are marked ABANDONED — preserved for audit but removed from the
 * active failed queue (no longer counted in unsyncedCount, no longer retried).
 *
 * Stale rows whose transaction was actually committed server-side (but whose
 * client response was lost) resolve on the FIRST retry via DEX-007 — they
 * never approach this cap.
 */
const MAX_SYNC_RETRY = 10

export type StockUpdateSource =
  /** Local Dexie catalog was patched from the sync response's updatedStock.
   *  Fast path — no full catalog refetch needed. */
  | 'patched'
  /** Server returned no updatedStock (e.g. duplicate-event path) OR the patch
   *  threw an error. Caller MUST do a full refetch to keep UI consistent. */
  | 'refetched'
  /** No stock-bearing transactions in this batch (nothing to update). */
  | 'skipped'

export interface SyncOutboxResult {
  synced: number
  failed: number
  /** Rows that were previously FAILED but resolved as SYNCED this cycle
   *  (server confirmed the transaction was already processed — DEX-007). */
  duplicateResolved: number
  /** Rows that exceeded MAX_SYNC_RETRY and were marked ABANDONED. */
  abandoned: number
  /** PHASE 2 (legacy): true only when stockUpdateSource === 'patched'.
   *  Kept for backward-compat callers; prefer reading stockUpdateSource. */
  stockPatched: boolean
  /** PHASE 2 (honest): unambiguous reason for how local stock was reconciled.
   *  - 'patched'  → local Dexie updated from server response (fast path)
   *  - 'refetched'→ caller did (or must do) a full catalog refetch
   *  - 'skipped'  → no stock changes in this batch
   *  Replaces the misleading boolean which couldn't distinguish "server didn't
   *  return stock" from "patch attempted but threw". */
  stockUpdateSource: StockUpdateSource
  /** Count of products + variants actually written to Dexie (0 if patch
   *  threw or server returned no updatedStock). For diagnostics. */
  patchedCount: number
  /** If the patch attempt threw (e.g. Dexie unavailable, schema mismatch),
   *  the error message — so telemetry can distinguish "server didn't send
   *  stock" (null) from "patch broke" (non-null). */
  patchError: string | null
  /** Merged updatedStock across ALL synced transactions in this batch.
   *  Used by handleCheckout to patch the React product-grid state (not just
   *  Dexie) when stockUpdateSource === 'patched'. Without this, the Dexie
   *  cache is updated but the UI still shows stale stock (because the product
   *  grid uses useState, not useLiveQuery). */
  mergedStock: { products: Record<string, number>; variants: Record<string, number> }
}

/**
 * Sync the outbox in the correct order:
 *   1. Sync customerOutbox (create local customers on server)
 *   2. Resolve localCustomerId → serverId in pending transactions
 *   3. Sync transactionOutbox (eventId = localTransactionId for idempotency)
 *
 * Retry policy (UX FIX 2026-07-24):
 *   - PENDING rows: always synced.
 *   - FAILED rows with retryCount < MAX_SYNC_RETRY: retried. This is the key
 *     fix — a stale FAILED row whose server commit succeeded (but whose HTTP
 *     response was lost) will resolve as SYNCED on the next sync, because the
 *     server's DEX-007 pre-check returns success:true with the original
 *     invoiceNumber + serverId.
 *   - FAILED rows with retryCount >= MAX_SYNC_RETRY: marked ABANDONED.
 *     Removed from the active failed queue; preserved for audit.
 *
 * Safety:
 *   - Never clears Dexie before successful response.
 *   - Failed sync preserves cache + outbox row (status FAILED, retryCount++).
 *   - Duplicate-safe: eventId dedupes server-side (DEX-007).
 */
// OUTBOX CONTRADICTION FIX: module-level lock prevents concurrent syncOutbox
// calls. Previously, handleCheckout called syncOutbox() directly while the
// sync hook's runSync() (triggered by mount/focus/periodic) could fire
// concurrently — both processed the same PENDING row, both POSTed to the
// server, and the loser's response (a stock-mismatch from the parallel
// duplicate) overwrote the winner's SYNCED status with FAILED. Now, a
// second call while one is in-flight simply awaits the same promise.
//
// The `initiated` flag (from syncOutboxTracked) lets the sync hook suppress
// its "N transaksi tersinkron" toast when it JOINED an in-flight sync that
// the checkout started — so an online checkout shows ONLY "Pembayaran
// berhasil", not a redundant sync toast alongside it.
let syncOutboxPromise: Promise<SyncOutboxResult> | null = null

export async function syncOutbox(): Promise<SyncOutboxResult> {
  return (await syncOutboxTracked()).result
}

/** Like syncOutbox, but also reports whether this call initiated the sync
 *  (true) or joined an in-flight one (false). Used by the sync hook to
 *  suppress redundant toasts when the checkout triggered the sync. */
export async function syncOutboxTracked(): Promise<{ result: SyncOutboxResult; initiated: boolean }> {
  if (syncOutboxPromise) {
    const result = await syncOutboxPromise
    return { result, initiated: false }
  }
  const promise = doSyncOutbox().finally(() => { syncOutboxPromise = null })
  syncOutboxPromise = promise
  const result = await promise
  return { result, initiated: true }
}

async function doSyncOutbox(): Promise<SyncOutboxResult> {
  const db = tryGetPosDB()
  if (!db) return { synced: 0, failed: 0, duplicateResolved: 0, abandoned: 0, stockPatched: false, stockUpdateSource: 'skipped', patchedCount: 0, patchError: null, mergedStock: { products: {}, variants: {} } }

  let synced = 0
  let failed = 0
  let duplicateResolved = 0
  let abandoned = 0
  let stockPatched = false
  let needsStockRefetch = true
  let patchedCount = 0
  let patchError: string | null = null
  let sawAnyStockPayload = false
  const mergedStock: { products: Record<string, number>; variants: Record<string, number> } = { products: {}, variants: {} }

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

  // ── 3. Sync transactionOutbox (PENDING + retryable FAILED) ──
  //
  // UX FIX 2026-07-24: FAILED rows are retried (up to MAX_SYNC_RETRY) so that
  // DEX-007 duplicate responses can resolve stale entries. The server returns
  // success:true + invoiceNumber + serverId when an eventId was already
  // processed — we mark the row SYNCED with that reference, removing it from
  // the failed queue. Rows exceeding the retry cap are marked ABANDONED.
  const pendingOrFailed = await db.transactionOutbox
    .where('status').anyOf('PENDING', 'FAILED').toArray()

  // Abandon permanently-failed rows (retryCount exhausted)
  const toAbandon = pendingOrFailed.filter(r => r.status === 'FAILED' && r.retryCount >= MAX_SYNC_RETRY)
  for (const r of toAbandon) {
    await db.transactionOutbox.update(r.id, {
      status: 'ABANDONED',
      error: r.error || `Melebihi batas retry (${MAX_SYNC_RETRY}x) — periksa manual`,
    })
    abandoned++
  }

  // Retryable: PENDING rows + FAILED rows below the cap
  const toSync = pendingOrFailed.filter(r => r.status === 'PENDING' || r.retryCount < MAX_SYNC_RETRY)

  // Track which rows were previously FAILED so we can count duplicateResolved
  // (stale entries confirmed as already-processed by the server).
  const previouslyFailed = new Set(toSync.filter(r => r.status === 'FAILED').map(r => r.id))

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
            // DEX-007 duplicates arrive here too (server returns success:true
            // + invoiceNumber + serverId). Resolving as SYNCED removes the
            // row from the failed queue and stores the server reference.
            await db.transactionOutbox.update(eventId, {
              status: 'SYNCED',
              serverId: result.serverId || null,
              invoiceNumber: result.invoiceNumber || null,
              error: null,
            })
            synced++
            if (previouslyFailed.has(eventId)) duplicateResolved++

            // PHASE 2 OPTIMIZATION (rule 10): Patch local product stock
            // from the server response instead of triggering a full catalog
            // refetch.
            //
            // TELEMETRY HONESTY FIX (stockPatched audit): the previous
            // implementation referenced `db.products` / `db.variants` — tables
            // that do NOT exist on PosDB (the schema declares `posProducts` /
            // `posVariants`). Accessing `db.products` returned `undefined`, so
            // `.update()` threw a TypeError. That throw was silently caught by
            // the outer network-error catch, which left `stockPatched = false`
            // even though the server HAD returned updatedStock. The UI still
            // updated correctly because `handleCheckout` then fell back to a
            // full catalog refetch — but the metric reported "false", making it
            // impossible to tell the optimization was actually BROKEN.
            //
            // Now: the patch runs in its own try/catch so a Dexie error no
            // longer swallows the entire batch. `patchedCount` reflects how
            // many rows actually wrote, `patchError` captures any failure, and
            // `stockUpdateSource` gives an unambiguous verdict to the caller.
            if (result.updatedStock) {
              const { products: prodStock, variants: varStock } = result.updatedStock
              const prodEntries = prodStock ? Object.entries(prodStock) : []
              const varEntries = varStock ? Object.entries(varStock) : []
              if (prodEntries.length > 0 || varEntries.length > 0) {
                sawAnyStockPayload = true
              }
              // Merge into mergedStock (for React state patching in handleCheckout).
              // Later transactions overwrite earlier ones for the same product —
              // correct, since the server's final stock is the latest value.
              for (const [pid, stock] of prodEntries) mergedStock.products[pid] = stock
              for (const [vid, stock] of varEntries) mergedStock.variants[vid] = stock
              try {
                for (const [pid, stock] of prodEntries) {
                  // BUG FIX: PosDB table is `posProducts`, not `products`.
                  await db.posProducts.update(pid, { stock, cachedAt: Date.now() })
                  patchedCount++
                }
                for (const [vid, stock] of varEntries) {
                  // BUG FIX: PosDB table is `posVariants`, not `variants`.
                  await db.posVariants.update(vid, { stock, cachedAt: Date.now() })
                  patchedCount++
                }
                // If we patched at least one row, skip the full catalog refetch.
                // (Previously only checked prodStock — a variant-only cart
                // would patch variants but still flag stockPatched=false.)
                if (patchedCount > 0) {
                  stockPatched = true
                  needsStockRefetch = false
                }
              } catch (patchErr) {
                // Dexie error (e.g. table missing, IndexedDB blocked). Don't
                // let it kill the rest of the batch — record it for telemetry
                // and fall back to a full refetch.
                patchError = patchErr instanceof Error ? patchErr.message : String(patchErr)
                console.warn('[syncOutbox] Local stock patch failed — falling back to refetch:', patchError)
              }
            }
          } else {
            // DEFENSIVE: never overwrite a SYNCED row with FAILED. If a
            // concurrent syncOutbox call (or the server's DEX-007 late
            // resolution) already marked this row SYNCED, a stale FAILED
            // response must not regress it. This is the client-side half of
            // the outbox contradiction fix.
            const existing = await db.transactionOutbox.get(eventId)
            if (existing?.status === 'SYNCED') {
              // Already synced — count as a silent duplicate resolution.
              duplicateResolved++
              continue
            }
            await db.transactionOutbox.update(eventId, {
              status: 'FAILED',
              error: result.error || 'Sync failed',
              retryCount: (existing?.retryCount || 0) + 1,
            })
            failed++
          }
        }
      } else {
        for (const tx of toSync) {
          const existing = await db.transactionOutbox.get(tx.id)
          if (existing?.status === 'SYNCED') continue
          await db.transactionOutbox.update(tx.id, {
            status: 'FAILED',
            error: `HTTP ${res.status}`,
            retryCount: (existing?.retryCount || 0) + 1,
          })
        }
        failed += toSync.length
      }
    } catch (e) {
      // Network error — leave rows in their current status (PENDING stays
      // PENDING, FAILED stays FAILED); they'll be retried on the next trigger.
      // Do NOT increment retryCount for network errors (transient, not a real
      // validation failure).
      failed += toSync.length
    }
  }

  // Derive the honest stockUpdateSource verdict:
  //  - 'patched'   → at least one row wrote to Dexie (fast path succeeded)
  //  - 'skipped'   → no stock-bearing payload seen (no transactions, or all
  //                  were duplicate-event responses without updatedStock, and
  //                  nothing failed). Caller can skip the refetch.
  //  - 'refetched' → server returned stock payload but the patch wrote 0 rows
  //                  (e.g. patch threw, or products weren't in Dexie yet), OR
  //                  needsStockRefetch is still true. Caller MUST refetch.
  let stockUpdateSource: StockUpdateSource
  if (stockPatched) {
    stockUpdateSource = 'patched'
  } else if (!sawAnyStockPayload && !patchError) {
    stockUpdateSource = 'skipped'
  } else {
    stockUpdateSource = 'refetched'
  }
  // needsStockRefetch is currently unused downstream (handleCheckout decides
  // via stockPatched), but kept for clarity / future callers.
  void needsStockRefetch

  return { synced, failed, duplicateResolved, abandoned, stockPatched, stockUpdateSource, patchedCount, patchError, mergedStock }
}
