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
  saveLastReceipt, getLastReceipt, updateLastReceiptResult,
} from '@/lib/pos/pos-db'
import { buildCheckoutPayload, type CalcResult } from '@/lib/pos/pos-calc'
import {
  startCheckoutTelemetry,
  markCommit,
  markModalVisible,
  markSyncDone,
  setInvoice,
  setProvisionalInvoice,
  setCatalogRefetched,
} from '@/lib/checkout-telemetry'

// ==================== INTERFACES ====================

/**
 * STATUS CONTRACT — HARDENED OPTIMISTIC CHECKOUT
 *
 * The local Dexie commit is NOT final success. The receipt modal opens
 * immediately with `syncStatus='pending'` (PENDING_SYNC) and a provisional
 * `SYNC-…` invoice reference. The status transitions to `synced` (SYNCED)
 * only after the server ACKs — at which point the real `INV-…` replaces the
 * provisional reference. If sync fails, the status becomes `failed`
 * (SYNC_FAILED); the transaction remains safely stored in the outbox and is
 * retried with the SAME immutable eventId (never a second checkout).
 *
 *   ┌─────────────┐   server ACK    ┌────────┐
 *   │  pending    │ ──────────────▶ │ synced │
 *   │ (PENDING_SYNC)│                │(SYNCED)│
 *   └─────┬───────┘                 └────────┘
 *         │ sync fails
 *         ▼
 *   ┌──────────┐  retry (same eventId)  ┌────────┐
 *   │  failed  │ ─────────────────────▶ │ synced │
 *   │(SYNC_FAIL)│                        │(SYNCED)│
 *   └──────────┘
 *
 *   ┌──────────┐  reconnect + sync   ┌────────┐
 *   │ offline  │ ──────────────────▶ │ synced │
 *   │ (OFFLINE)│                      │(SYNCED)│
 *   └──────────┘                      └────────┘
 *
 * `success: true` means "a local commit was produced and a receipt is
 * available" — it does NOT mean the server has confirmed. The UI may show
 * "Pembayaran Berhasil" ONLY when `syncStatus === 'synced'`.
 */
export type CheckoutSyncStatus = 'pending' | 'synced' | 'failed' | 'offline' | 'skipped'

export interface CheckoutResult {
  /**
   * True once a local Dexie commit has been produced (receipt available).
   * NOT a server-confirmation signal — see `syncStatus`.
   */
  success: boolean
  /**
   * Provisional `SYNC-…` / `OFF-…` reference before sync, replaced by the
   * server-issued `INV-…` after `syncStatus` becomes `synced`.
   */
  invoiceNumber: string
  message?: string
  syncError?: string
  /**
   * The authoritative status contract field. Drives the receipt title, badge,
   * and watermark. See the state-machine diagram above.
   */
  syncStatus?: CheckoutSyncStatus
  /**
   * The immutable eventId (= Dexie `transactionOutbox.id`). All retries reuse
   * this exact value — the server dedupes via DEX-007, so a retry can NEVER
   * create a second checkout. Persisted on the receipt so the cashier can
   * trace a provisional transaction back to its outbox row.
   */
  localTransactionId?: string
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
  /** POST-CHECKOUT LATENCY FIX: Optimistically patch today's summary (count+1,
   *  total+grandTotal) instead of fetching /api/pos/today after checkout.
   *  Called immediately after the local commit, before the receipt modal opens. */
  onPatchTodaySummary?: (delta: { count: number; total: number }) => void
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
    onRefreshProducts, onPatchProductStock, onPatchTodaySummary, onRefreshCustomers, onClearCart,
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
  //
  // POST-CHECKOUT LATENCY FIX + STATUS CONTRACT HARDENING (AETHER POS):
  //
  // The receipt modal opens immediately after the LOCAL Dexie commit — it does
  // NOT wait for the server. The local commit produces status PENDING_SYNC
  // (syncStatus='pending'), NOT final SUCCESS. The state machine is:
  //
  //   pending (PENDING_SYNC) ──server ACK──▶ synced (SYNCED)
  //      │                                    └─ title "Pembayaran Berhasil", INV-…
  //      │ sync fails
  //      ▼
  //   failed (SYNC_FAILED) ──retry (SAME eventId)──▶ synced
  //      └─ title "Sync Gagal", badge "Menunggu Retry", keep SYNC-…
  //
  //   offline (OFFLINE) ──reconnect + sync──▶ synced
  //      └─ title "Tersimpan Offline", OFF-…
  //
  // Flow:
  //   1. Generate immutable localTransactionId (= eventId). NEVER regenerated.
  //   2. Build payload + outbox row (status PENDING), put in Dexie (LOCAL COMMIT)
  //   3. Optimistically patch Dexie stock + React product grid (no network)
  //   4. Optimistically patch today's summary (count+1, total+grandTotal)
  //   5. Provisional invoice: SYNC-{shortId} (online) / OFF-{ts} (offline)
  //   6. setCheckoutResult({ syncStatus: 'pending'|'offline', invoiceNumber: provisional })
  //   7. saveLastReceiptSnapshot() — persists the provisional receipt to Dexie
  //   8. setPaymentDialogOpen(false) + setReceiptDialogOpen(true)  ← MODAL VISIBLE (<150ms)
  //   9. Fire-and-forget: syncOutbox().then(patch result + real invoice + Dexie)
  //  10. Do NOT call onRefreshProducts / onRefreshCustomers / fetchTodaySummary
  //
  // EVENTID IMMUTABILITY (requirement 7): localTransactionId is generated ONCE
  // and stored as the outbox row's primary key. doSyncOutbox uses tx.id as the
  // eventId on every retry — it is NEVER regenerated. Server-side DEX-007
  // dedupes on eventId, so a retry can NEVER create a second checkout.
  //
  // DEXIE PERSISTENCE (requirement 6): when sync resolves, the final invoice +
  // status are patched into BOTH React state (checkoutResult) AND the Dexie
  // lastReceipt row (via updateLastReceiptResult). The Dexie patch runs in the
  // fire-and-forget .then() — it executes whether or not the receipt dialog is
  // still open, so "Cetak Ulang" always shows the final INV-… reference.

  const handleCheckout = useCallback(async () => {
    if (cart.length === 0) return
    if (paymentMethod === 'CASH' && Number(paidAmount) < calcResult.grandTotal) {
      toast.error('Jumlah bayar kurang dari total')
      return
    }
    // DEFENSIVE: never start a second checkout while one is in-flight. The
    // payment dialog closes on checkout, but a double-tap or race could
    // otherwise produce two outbox rows for the same cart. Each checkout gets
    // its own eventId, so this isn't a duplicate-checkout risk per se — but
    // blocking here keeps the telemetry session + receipt state coherent.
    if (checkingOut) return
    setCheckingOut(true)
    // Start telemetry session — measures commit→modal, post-checkout request
    // count, sync status, catalog refetched, receipt ready timing.
    const telemetry = startCheckoutTelemetry()
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
      // LOCAL COMMIT COMPLETE — status is now PENDING_SYNC (outbox row
      // status='PENDING'). This is NOT final success; the receipt will open
      // with syncStatus='pending' and transition to 'synced' only after the
      // server ACKs. Telemetry marks this commit point.
      markCommit(telemetry)

      // ── OPTIMISTIC STOCK PATCH (no network fetch) ──
      // Decrement each cart item's stock locally so the product grid updates
      // instantly. The server's authoritative updatedStock (from sync) will
      // overwrite this when sync resolves. If sync fails, we revert via
      // onRefreshProducts.
      const optimisticStock = computeOptimisticStockDelta(cart)
      if (db) {
        try {
          for (const [pid, stock] of Object.entries(optimisticStock.products)) {
            await db.posProducts.update(pid, { stock, cachedAt: Date.now() })
          }
          for (const [vid, stock] of Object.entries(optimisticStock.variants)) {
            await db.posVariants.update(vid, { stock, cachedAt: Date.now() })
          }
        } catch { /* non-critical — React state patch below is the primary UI update */ }
      }
      // Patch React product-grid state (the grid uses useState, not useLiveQuery).
      onPatchProductStock?.(optimisticStock)

      // ── OPTIMISTIC TODAY SUMMARY PATCH (no /api/pos/today fetch) ──
      onPatchTodaySummary?.({ count: 1, total: calcResult.grandTotal })

      // ── PROVISIONAL INVOICE + RECEIPT MODAL ──
      // The provisional reference is the ONLY invoice shown until the server
      // ACKs. Online: SYNC-{shortId} (derived from the immutable eventId so
      // the cashier can trace it back to the outbox row). Offline: OFF-{ts}.
      // The receipt dialog renders this with a "Menunggu Sinkronisasi" badge
      // and a watermark stating it is not yet synchronized.
      const provisionalInvoice = isOnline
        ? `SYNC-${localTransactionId.slice(0, 8).toUpperCase()}`
        : `OFF-${Date.now().toString(36).toUpperCase()}`
      setProvisionalInvoice(telemetry, provisionalInvoice)

      // LOCAL COMMIT result — status is PENDING_SYNC (online) or OFFLINE.
      // `success: true` means "a receipt is available", NOT "server confirmed".
      // The receipt title is "Transaksi Tersimpan" until syncStatus→'synced'.
      const result: CheckoutResult = {
        success: true,
        invoiceNumber: provisionalInvoice,
        syncStatus: isOnline ? 'pending' : 'offline',
        localTransactionId,
        ...(isOnline ? {} : { message: 'Tersimpan offline, menunggu sinkronisasi' }),
      }
      setCheckoutResult(result)

      // Persist the provisional receipt snapshot to Dexie for reprint. This is
      // the INITIAL write — the final invoice patch is applied on sync success
      // via updateLastReceiptResult (requirement 6), independently of the
      // receipt dialog lifecycle.
      await saveLastReceiptSnapshot(result, cart, calcResult, paymentMethod, paidAmount, selectedCustomer, selectedPromo)

      // CLOSE PAYMENT DIALOG + OPEN RECEIPT MODAL — this is the <150ms target.
      setPaymentDialogOpen(false)
      setReceiptDialogOpen(true)
      markModalVisible(telemetry)

      // Toast: contract-aligned message. Before server ACK, the transaction is
      // "saved" (Tersimpan), not "successful" (Berhasil).
      if (isOnline) {
        toast.success('Transaksi tersimpan — menunggu sinkronisasi')
      } else {
        toast.info('Tersimpan offline — menunggu sinkronisasi', { duration: 5000 })
      }

      // ── BACKGROUND SYNC (fire-and-forget, non-blocking) ──
      // Only sync if online. The sync hook's periodic/focus/mount triggers
      // will retry the outbox if this background call doesn't succeed.
      if (isOnline) {
        const tSyncStart = performance.now()
        // Do NOT await — fire-and-forget. The .then() patches the receipt
        // in-place when sync resolves (success or failure).
        void syncOutbox().then(async (syncResult) => {
          const tSyncEnd = performance.now()
          const apiDuration = Math.round(tSyncEnd - tSyncStart)
          const row = db ? await db.transactionOutbox.get(localTransactionId) : null

          if (row?.status === 'SYNCED') {
            // ── SYNCED: server confirmed the transaction ──
            // The receipt title may now become "Pembayaran Berhasil" and the
            // provisional SYNC-… reference is replaced by the final INV-…
            const realInvoice = row.invoiceNumber || provisionalInvoice
            // Patch React checkoutResult (drives the open receipt dialog).
            setCheckoutResult(prev => prev && prev.localTransactionId === localTransactionId
              ? { ...prev, invoiceNumber: realInvoice, syncStatus: 'synced', syncError: undefined }
              : prev)
            setInvoice(telemetry, realInvoice)

            // PERSIST FINAL INVOICE IN DEXIE (requirement 6): patch the
            // lastReceipt row so "Cetak Ulang" shows the real INV-… even if
            // the receipt dialog was already closed. Keyed by eventId so a
            // newer checkout's snapshot is never regressed.
            void updateLastReceiptResult({
              localTransactionId,
              invoiceNumber: realInvoice,
              syncStatus: 'synced',
              syncError: undefined,
            })

            // Patch stock with server's authoritative updatedStock. This
            // overwrites the optimistic patch with the true post-transaction
            // values. If the server returned no stock payload (duplicate-event
            // path), the optimistic patch stays (it's already correct).
            if (syncResult.stockUpdateSource === 'patched' && syncResult.mergedStock) {
              onPatchProductStock?.(syncResult.mergedStock)
            } else if (syncResult.stockUpdateSource === 'refetched') {
              // Patch threw or product not in Dexie — fall back to full refetch
              // to guarantee consistency. This is the slow path; rare.
              setCatalogRefetched(telemetry, true)
              onRefreshProducts?.()
            }
            // 'skipped' → no stock payload, optimistic patch is correct. No action.

            markSyncDone(telemetry, 'synced', apiDuration)
          } else {
            // ── SYNC_FAILED: server rejected or network error ──
            // The outbox row is PRESERVED (status FAILED, retryCount++). It will
            // be retried on the next focus/periodic/reconnect trigger using the
            // SAME eventId — a retry can NEVER create a second checkout because
            // the server dedupes via DEX-007. The receipt stays valid; the
            // cashier can finish. The status badge shows "Menunggu Retry".
            const errMsg = row?.error || 'Gagal terhubung ke server'
            // Patch React checkoutResult (drives the open receipt dialog).
            setCheckoutResult(prev => prev && prev.localTransactionId === localTransactionId
              ? { ...prev, syncStatus: 'failed', syncError: errMsg }
              : prev)
            // PERSIST FAILED STATUS IN DEXIE (requirement 6): so reprint also
            // reflects the sync-failed state (watermark + badge).
            void updateLastReceiptResult({
              localTransactionId,
              invoiceNumber: provisionalInvoice,
              syncStatus: 'failed',
              syncError: errMsg,
            })
            // Revert the optimistic stock patch — the server didn't commit,
            // so the true stock is the original. Full refetch is the safest
            // way to guarantee consistency after a failed sync.
            setCatalogRefetched(telemetry, true)
            onRefreshProducts?.()
            // Non-blocking warning — the receipt is still valid locally,
            // the cashier can finish the transaction. The outbox will retry.
            toast.warning(`Sync gagal: ${errMsg}`, {
              duration: 6000,
              description: 'Transaksi tersimpan lokal, akan diretry otomatis.',
            })
            markSyncDone(telemetry, 'failed', apiDuration)
          }
          // NOTE: onRefreshCustomers is intentionally NOT called. Customer
          // points (loyalty earn/redeem) will refresh on next page visit or
          // manual sync — accepting points-display staleness in exchange for
          // zero post-checkout customer-list refetches.
        }).catch(() => {
          // Network error in the sync promise itself (rare — syncOutbox
          // handles its own errors internally). Mark as SYNC_FAILED. The outbox
          // row stays PENDING/FAILED and will retry with the same eventId.
          setCheckoutResult(prev => prev && prev.localTransactionId === localTransactionId
            ? { ...prev, syncStatus: 'failed', syncError: 'Network error' }
            : prev)
          // Persist the failed status to Dexie (requirement 6).
          void updateLastReceiptResult({
            localTransactionId,
            invoiceNumber: provisionalInvoice,
            syncStatus: 'failed',
            syncError: 'Network error',
          })
          setCatalogRefetched(telemetry, true)
          onRefreshProducts?.()
          markSyncDone(telemetry, 'failed', null)
        })
      } else {
        // Offline: no sync attempted. The outbox will sync on reconnect.
        markSyncDone(telemetry, 'skipped', null)
        // Don't refetch products/customers — offline, so the server is
        // unreachable. The optimistic patch + Dexie cache are the UI truth.
      }
    } catch {
      toast.error('Checkout gagal')
    } finally {
      setCheckingOut(false)
    }
  }, [cart, calcResult, paymentMethod, paidAmount, isOnline, selectedCustomer, selectedPromo, checkingOut, onRefreshProducts, onPatchProductStock, onPatchTodaySummary, onRefreshCustomers])

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

/**
 * POST-CHECKOUT LATENCY FIX: Compute the optimistic stock delta from the cart.
 *
 * For each cart item, decrement the product's (or variant's) stock by qty.
 * The result is the NEW absolute stock value (not a delta) — matching the
 * shape that `onPatchProductStock` expects (Record<id, newStock>).
 *
 * This is used to patch the React product-grid state + Dexie cache BEFORE
 * the server sync resolves, so the UI updates instantly. The server's
 * authoritative `updatedStock` (returned by /api/transactions/sync) will
 * overwrite this when sync completes.
 *
 * For variant parents: we patch the VARIANT's stock (authoritative). The
 * parent's stock is recalculated by `patchProductStock` in use-pos-products
 * as the SUM of its variants' patched stock — same logic as the server's
 * variant-parent recalculation.
 */
function computeOptimisticStockDelta(cart: CartItem[]): { products: Record<string, number>; variants: Record<string, number> } {
  const products: Record<string, number> = {}
  const variants: Record<string, number> = {}
  for (const item of cart) {
    if (item.variant) {
      // Variant item: patch variant stock. Parent stock is recalculated by
      // patchProductStock (sum of variant stocks).
      const newStock = Math.max(0, item.variant.stock - item.qty)
      variants[item.variant.id] = newStock
    } else {
      // Simple product: patch product stock directly.
      const newStock = Math.max(0, item.product.stock - item.qty)
      products[item.product.id] = newStock
    }
  }
  return { products, variants }
}

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
    // EVENTID IMMUTABILITY (requirement 7): every retry reuses `tx.id` — the
    // exact same localTransactionId assigned at checkout — as the eventId sent
    // to the server. The server dedupes on eventId (DEX-007), so a retry can
    // NEVER create a second checkout. We never generate a new id here; we only
    // read the existing row's primary key.
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

            // PERSIST FINAL INVOICE IN DEXIE (requirement 6): patch the
            // lastReceipt row so reprint ("Cetak Ulang") shows the real INV-…
            // even if the receipt dialog was already closed — and even if
            // this sync was triggered by the sync hook's runSync() (reconnect
            // / focus / periodic) rather than handleCheckout's fire-and-forget
            // .then(). This is the critical path for OFFLINE transactions that
            // sync later: handleCheckout's .then() never fires for them, so
            // without this call the lastReceipt would stay stuck on OFF-… /
            // syncStatus='offline' forever.
            //
            // The helper guards on localTransactionId, so it only patches the
            // snapshot belonging to THIS eventId — never a newer checkout's.
            if (result.invoiceNumber) {
              void updateLastReceiptResult({
                localTransactionId: eventId,
                invoiceNumber: result.invoiceNumber,
                syncStatus: 'synced',
                syncError: undefined,
              })
            }

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
            const failErr = result.error || 'Sync failed'
            await db.transactionOutbox.update(eventId, {
              status: 'FAILED',
              error: failErr,
              retryCount: (existing?.retryCount || 0) + 1,
            })
            failed++
            // PERSIST SYNC_FAILED STATUS IN DEXIE (requirement 6): patch the
            // lastReceipt so reprint reflects the failed state. The provisional
            // invoice (SYNC-… / OFF-…) is preserved — we only update syncStatus
            // + syncError. Keyed by eventId so a newer checkout isn't regressed.
            // This covers the retry-failure path (sync hook's runSync retrying a
            // FAILED row); the first-failure path is handled by handleCheckout's
            // .then() callback.
            void updateLastReceiptResult({
              localTransactionId: eventId,
              syncStatus: 'failed',
              syncError: failErr,
            })
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
