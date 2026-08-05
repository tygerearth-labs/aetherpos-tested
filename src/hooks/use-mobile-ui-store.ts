'use client'

import { create } from 'zustand'

/**
 * Mobile UI coordination store.
 *
 * Allows page-level components (ProductsPage, PurchasePage) to signal
 * "mobile selection overlay active" to the app shell so it can:
 *  - hide the persistent MobileBottomNav (avoiding overlap)
 *  - reserve bottom content padding for the selection action bar
 *
 * This store is intentionally minimal — it only tracks a boolean flag and
 * a numeric "bar height" hint so the app-shell can reserve the right amount
 * of bottom padding. Business logic (selection state, bulk actions, etc.)
 * remains in each page component.
 *
 * On desktop (md+) the flag has NO visual effect — the bottom nav is
 * already hidden via `md:hidden`, and the extra bottom padding only applies
 * on mobile (`pb-… md:pb-0`).
 */

interface MobileUiStore {
  /** Whether a full-width mobile selection action bar is currently shown. */
  selectionOverlayActive: boolean
  /**
   * Approximate pixel height of the mobile selection bar (excluding
   * safe-area). Used by the app shell to reserve bottom padding so the
   * bar never covers list content. Default 0 (no bar).
   */
  selectionBarHeight: number
  /** Activate the selection overlay with a given bar height. */
  setSelectionOverlay: (active: boolean, barHeight?: number) => void
}

export const useMobileUiStore = create<MobileUiStore>((set) => ({
  selectionOverlayActive: false,
  selectionBarHeight: 0,
  setSelectionOverlay: (active, barHeight = 0) =>
    set({
      selectionOverlayActive: active,
      selectionBarHeight: active ? barHeight : 0,
    }),
}))
