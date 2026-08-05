/**
 * checkout-telemetry.ts — Post-checkout UI latency instrumentation.
 *
 * Measures the commit→modal-visible gap required by the AETHER POS
 * post-checkout latency target:
 *
 *   TARGETS:
 *   - commit→modal visible < 150ms
 *   - total click→success modal < 1s (warm)
 *   - 0 full catalog refetch after patched checkout
 *   - 0 /sync call when offline outbox is empty
 *   - no duplicate plan/search/variants/customers/today requests
 *
 * Usage:
 *   const t = startCheckoutTelemetry()
 *   markCommit(t)              // after Dexie outbox put
 *   markModalVisible(t)        // after setReceiptDialogOpen(true)
 *   markSyncDone(t, 'synced')  // after background sync resolves
 *   // auto-logs after 5s observation window
 */

export type SyncStatus = 'pending' | 'synced' | 'failed' | 'skipped'

export interface CheckoutTelemetry {
  /** performance.now() at click (handleCheckout entry). */
  tClick: number
  /** performance.now() after Dexie outbox.put resolved (local commit). */
  tCommit: number | null
  /** performance.now() at setReceiptDialogOpen(true). */
  tModalVisible: number | null
  /** performance.now() when background sync resolved. */
  tSyncDone: number | null
  /** performance.now() when receipt content first rendered. */
  tReceiptReady: number | null
  /** Network duration of /api/transactions/sync (ms), null if skipped. */
  checkoutApiDuration: number | null
  /** Final sync status for this checkout. */
  syncStatus: SyncStatus
  /** True if onRefreshProducts (full catalog refetch) was called. */
  catalogRefetched: boolean
  /** Count of /api/* requests in the 5s window after modal visible. */
  postCheckoutRequestCount: number
  /** Final invoice number (server-issued when synced, provisional otherwise). */
  invoiceNumber: string | null
  /** Provisional invoice shown before sync resolved. */
  provisionalInvoice: string | null
  /** List of /api/* URLs hit in the observation window (for duplicate detection). */
  observedUrls: string[]
}

const POST_CHECKOUT_WINDOW_MS = 5000
const DUPLICATE_TRACKING_MS = 5000

let active: CheckoutTelemetry | null = null
let observer: PerformanceObserver | null = null
let requestCount = 0
let observedUrls: string[] = []
let windowTimer: ReturnType<typeof setTimeout> | null = null
let duplicateCheckTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Begin a new telemetry session. Call at the very start of handleCheckout.
 * Only one session is active at a time — a second call replaces the first.
 */
export function startCheckoutTelemetry(): CheckoutTelemetry {
  // Clean up any prior session
  if (observer) {
    try { observer.disconnect() } catch { /* noop */ }
    observer = null
  }
  if (windowTimer) {
    clearTimeout(windowTimer)
    windowTimer = null
  }
  if (duplicateCheckTimer) {
    clearTimeout(duplicateCheckTimer)
    duplicateCheckTimer = null
  }

  active = {
    tClick: performance.now(),
    tCommit: null,
    tModalVisible: null,
    tSyncDone: null,
    tReceiptReady: null,
    checkoutApiDuration: null,
    syncStatus: 'pending',
    catalogRefetched: false,
    postCheckoutRequestCount: 0,
    invoiceNumber: null,
    provisionalInvoice: null,
    observedUrls: [],
  }
  requestCount = 0
  observedUrls = []

  // Observe network resource entries (fetch/XHR) to count post-checkout
  // requests automatically — no need to wrap global fetch.
  try {
    if (typeof PerformanceObserver !== 'undefined') {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const name = entry.name
          // Only count same-origin /api/* requests (the ones the latency
          // target cares about: sync, plan, products, variants, customers,
          // today, settings). External URLs (auth, analytics) are ignored.
          if (name.includes('/api/') && !name.includes('/api/auth/')) {
            requestCount++
            observedUrls.push(name.replace(/^https?:\/\/[^/]+/, ''))
          }
        }
      })
      observer.observe({ type: 'resource', buffered: false })
    }
  } catch {
    // PerformanceObserver unavailable (old browser) — degrade gracefully.
  }

  return active
}

/** Mark the local commit point (Dexie outbox.put resolved). */
export function markCommit(t: CheckoutTelemetry): void {
  t.tCommit = performance.now()
}

/**
 * Mark the moment the receipt modal becomes visible. Starts the 5s
 * observation window, after which the telemetry is logged automatically.
 */
export function markModalVisible(t: CheckoutTelemetry): void {
  t.tModalVisible = performance.now()
  // Observe for 5s after the modal appears, then log.
  if (windowTimer) clearTimeout(windowTimer)
  windowTimer = setTimeout(() => {
    if (observer) {
      try { observer.disconnect() } catch { /* noop */ }
      observer = null
    }
    t.postCheckoutRequestCount = requestCount
    t.observedUrls = observedUrls
    logTelemetry(t)
    active = null
  }, POST_CHECKOUT_WINDOW_MS)
}

/** Mark when the receipt content is first rendered (after paint).
 *  Uses the currently-active telemetry session. No-op if no session is active
 *  (e.g. when the receipt dialog opens without a preceding checkout). */
export function markReceiptReady(): void {
  if (active) {
    active.tReceiptReady = performance.now()
  }
}

/**
 * Mark when the background sync resolves. Safe to call before or after
 * markModalVisible — the telemetry logs 5s after modal visible regardless.
 */
export function markSyncDone(
  t: CheckoutTelemetry,
  status: 'synced' | 'failed' | 'skipped',
  apiDurationMs: number | null,
): void {
  t.tSyncDone = performance.now()
  t.syncStatus = status
  t.checkoutApiDuration = apiDurationMs
}

/** Set the final invoice number (server-issued). */
export function setInvoice(t: CheckoutTelemetry, invoice: string): void {
  t.invoiceNumber = invoice
}

/** Set the provisional invoice (shown before sync resolves). */
export function setProvisionalInvoice(t: CheckoutTelemetry, invoice: string): void {
  t.provisionalInvoice = invoice
}

/** Record whether a full catalog refetch occurred. */
export function setCatalogRefetched(t: CheckoutTelemetry, refetched: boolean): void {
  t.catalogRefetched = refetched
}

/**
 * Check for duplicate requests to the same endpoint in the DUPLICATE_TRACKING_MS
 * window after checkout. Returns the count of duplicates found.
 *
 * Call this after the observation window closes (inside logTelemetry) — it
 * analyses the observedUrls list.
 */
export function detectDuplicateRequests(urls: string[]): { duplicates: number; byEndpoint: Record<string, number> } {
  const byEndpoint: Record<string, number> = {}
  for (const url of urls) {
    // Strip query params for grouping (XTransformPort, search params, etc.)
    const path = url.split('?')[0]
    byEndpoint[path] = (byEndpoint[path] || 0) + 1
  }
  let duplicates = 0
  for (const [path, count] of Object.entries(byEndpoint)) {
    if (count > 1) {
      duplicates += count - 1
      console.warn(`[checkout:telemetry] DUPLICATE: ${path} fetched ${count}×`)
    }
  }
  // Use void to satisfy linter — we intentionally iterate for side effects.
  void duplicateCheckTimer
  return { duplicates, byEndpoint }
}

function logTelemetry(t: CheckoutTelemetry): void {
  const commitToModal = t.tCommit && t.tModalVisible ? Math.round(t.tModalVisible - t.tCommit) : null
  const clickToModal = t.tModalVisible ? Math.round(t.tModalVisible - t.tClick) : null
  const modalToReceipt = t.tModalVisible && t.tReceiptReady ? Math.round(t.tReceiptReady - t.tModalVisible) : null
  const syncDuration = t.tSyncDone && t.tClick ? Math.round(t.tSyncDone - t.tClick) : null

  console.log(
    `[checkout:telemetry] ` +
    `commit→modal: ${commitToModal}ms, ` +
    `click→modal: ${clickToModal}ms, ` +
    `modal→receipt: ${modalToReceipt}ms, ` +
    `apiDuration: ${t.checkoutApiDuration ?? 'null'}ms, ` +
    `syncTotal: ${syncDuration}ms, ` +
    `syncStatus: ${t.syncStatus}, ` +
    `catalogRefetched: ${t.catalogRefetched}, ` +
    `postCheckoutRequests: ${t.postCheckoutRequestCount}, ` +
    `invoice: ${t.invoiceNumber}` +
    (t.provisionalInvoice && t.provisionalInvoice !== t.invoiceNumber ? `, provisionalWas: ${t.provisionalInvoice}` : '')
  )

  // Detect duplicate endpoint hits in the observation window.
  if (t.observedUrls.length > 0) {
    const { duplicates, byEndpoint } = detectDuplicateRequests(t.observedUrls)
    if (duplicates > 0) {
      console.warn(`[checkout:telemetry] ${duplicates} duplicate request(s) detected in 5s window`)
      console.warn('[checkout:telemetry] endpoint breakdown:', byEndpoint)
    }
  }

  // Verify targets and warn if missed.
  if (commitToModal !== null && commitToModal > 150) {
    console.warn(`[checkout:telemetry] TARGET MISSED: commit→modal ${commitToModal}ms > 150ms`)
  }
  if (clickToModal !== null && clickToModal > 1000) {
    console.warn(`[checkout:telemetry] TARGET MISSED: click→modal ${clickToModal}ms > 1000ms`)
  }
  if (t.catalogRefetched) {
    console.warn('[checkout:telemetry] TARGET MISSED: catalog refetched (expected 0)')
  }

  // Expose for debugging / Agent Browser inspection.
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __lastCheckoutTelemetry?: unknown }).__lastCheckoutTelemetry = t
  }
}

/** Get the currently-active telemetry session (or null). */
export function getActiveTelemetry(): CheckoutTelemetry | null {
  return active
}
