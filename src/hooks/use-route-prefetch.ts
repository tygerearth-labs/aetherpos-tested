/**
 * use-route-prefetch.ts — Prefetch priority route chunks while online + idle
 *
 * When the app is online and the user is idle, send the chunk URLs of
 * priority (FULL + READ_ONLY) routes to the service worker for caching.
 * This ensures that if the user later goes offline, the chunks for
 * dashboard/products/customers/transactions/POS are already in the SW cache
 * and navigation won't throw ChunkLoadError.
 *
 * Strategy:
 *   1. Wait for `online` + `idle` (requestIdleCallback).
 *   2. For each prefetch route, discover its chunk URL by importing the lazy
 *      component's module (this triggers the browser to fetch the chunk,
 *      which the SW then caches cache-first-on-success).
 *   3. Also send a message to the SW with the list of chunk URLs so the SW
 *      can proactively cache them even if the browser doesn't fetch them.
 *
 * This hook is a no-op when offline or when the SW is not registered.
 */

'use client'

import { useEffect } from 'react'
import { PREFETCH_ROUTES } from '@/lib/route-capability'
import { useOnlineStatus } from '@/hooks/use-online-status'

// Map of route → lazy import factory (must match app-shell.tsx lazy declarations)
// We import these lazily here so the prefetch hook itself doesn't pull all chunks
// at initial load. Each factory is only called during prefetch.
const LAZY_FACTORIES: Record<string, () => Promise<unknown>> = {
  pos: () => import('@/components/pages/pos-page'),
  dashboard: () => import('@/components/pages/dashboard-page'),
  products: () => import('@/components/pages/products-page'),
  customers: () => import('@/components/pages/customers-page'),
  transactions: () => import('@/components/pages/transactions-page'),
}

export function useRoutePrefetch() {
  const isOnline = useOnlineStatus()

  useEffect(() => {
    if (!isOnline) return
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (typeof window.requestIdleCallback !== 'function') return

    let cancelled = false

    const run = () => {
      if (cancelled) return
      // For each prefetch route, trigger the lazy import. The browser fetches
      // the chunk; the SW (cache-first with cache-on-success) stores it.
      // We catch errors silently — prefetch is best-effort.
      PREFETCH_ROUTES.forEach((route) => {
        const factory = LAZY_FACTORIES[route]
        if (!factory) return
        factory().catch(() => {
          /* prefetch failure is non-fatal */
        })
      })

      // Also notify the SW to prefetch these routes' chunks explicitly.
      // The SW can then cache them even without the browser fetching them
      // (useful for chunks the browser defers).
      navigator.serviceWorker.ready
        .then((reg) => {
          if (cancelled) return
          reg.active?.postMessage({
            type: 'AETHER_PREFETCH_ROUTES',
            routes: PREFETCH_ROUTES,
          })
        })
        .catch(() => {
          /* SW not ready — non-fatal */
        })
    }

    // Defer until idle + a short delay so we don't compete with initial load
    const idleId = window.requestIdleCallback(run, { timeout: 8000 })

    return () => {
      cancelled = true
      if (window.cancelIdleCallback) {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [isOnline])
}
