/**
 * navigate.ts — Central navigation guard helper
 *
 * Single function used by sidebar, mobile-bottom-nav, command menu, and any
 * other navigation source. Enforces the route capability contract:
 *
 *   - If the route is ONLINE_ONLY and the browser is offline → set
 *     blockedPage on the page store (the app-shell renders the
 *     OfflineRouteBlocker dialog). Do NOT call setCurrentPage.
 *   - Otherwise → setCurrentPage (the lazy import proceeds; if the chunk
 *     is missing, the ErrorBoundary catches the ChunkLoadError).
 *
 * This prevents the "import-then-crash" pattern: ONLINE_ONLY routes are
 * blocked BEFORE the dynamic import is attempted.
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

  if (!isOnline && !isNavigableOffline(page)) {
    // Block: ONLINE_ONLY route while offline. Set blockedPage so the
    // app-shell renders the intentional offline-unavailable dialog.
    store.setBlockedPage(page)
    return false
  }

  store.setCurrentPage(page)
  return true
}
