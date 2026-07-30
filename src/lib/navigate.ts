/**
 * navigate.ts — Canonical Guarded Navigation API (APP-WIDE)
 *
 * Single function used by sidebar, mobile-bottom-nav, command menu, dashboard
 * quick-actions, and any other navigation source. No internal navigation path
 * should bypass this function.
 *
 * Guard sequence (per the global navigation API contract):
 *   1. route offline capability — block ONLINE_ONLY when offline
 *   2. online state              — (covered by #1)
 *   3. server/client build ver.  — non-blocking; chunk failure handled by ErrorBoundary
 *   4. update pending            — non-blocking; banner informs the user
 *   5. active critical activity  — non-blocking for in-app nav (state survives
 *                                   in Zustand/Dexie); beforeunload handles
 *                                   tab-close / hard-reload separately
 *   6. navigation                — setCurrentPage (lazy import proceeds; if the
 *                                   chunk is missing, ErrorBoundary catches it)
 *
 * Steps 3–5 are non-blocking for in-app navigation because:
 *   - In-app nav preserves React state (Zustand) and Dexie (IndexedDB), so
 *     cart/jobs/drafts are NOT lost.
 *   - A stale build chunk is caught by the ErrorBoundary (which itself respects
 *     critical activities before force-reloading).
 *   - The update banner shows globally regardless of the current page.
 *
 * The force-reload risk is handled at beforeunload + build-update-apply time,
 * NOT at in-app navigation time.
 */

import { usePageStore, type PageType } from '@/hooks/use-page-store'
import { isNavigableOffline } from '@/lib/route-capability'

/**
 * Attempt to navigate to `page`. Returns true if navigation proceeded,
 * false if it was blocked (offline + ONLINE_ONLY).
 *
 * Callers should NOT also call setCurrentPage — this function does it.
 */
export function navigate(page: PageType): boolean {
  const store = usePageStore.getState()
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

  // Guard 1: route offline capability + online state
  if (!isOnline && !isNavigableOffline(page)) {
    // Block: ONLINE_ONLY route while offline. Set blockedPage so the
    // app-shell renders the intentional offline-unavailable dialog.
    store.setBlockedPage(page)
    return false
  }

  // Guards 3–5 are non-blocking for in-app nav (see rationale above).
  // The build version + critical activity gating is enforced at:
  //   - beforeunload (tab close / hard reload) — see app-shell useBlockRefresh
  //   - build-update apply time                — see update-banner + app-shell
  //   - ChunkLoadError recovery                — see error-boundary

  // Guard 6: navigation
  store.setCurrentPage(page)
  return true
}

/**
 * Navigate to a page WITHOUT going through the offline guard.
 *
 * Reserved for recovery paths where the caller has already decided the
 * navigation is safe (e.g. ErrorBoundary "Kembali ke POS" — POS is FULL
 * offline so the guard would pass anyway, but we bypass to avoid any edge
 * case where the guard blocks a recovery action).
 *
 * Use sparingly — most callers should use `navigate()`.
 */
export function navigateUnchecked(page: PageType): void {
  usePageStore.getState().setCurrentPage(page)
}
