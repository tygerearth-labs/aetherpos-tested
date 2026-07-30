'use client'

import { useEffect } from 'react'

/**
 * useServiceWorker — registers the app SW and reports the current buildId
 * to it so the SW never deletes a build cache that an open tab is using.
 *
 * Build-report protocol:
 *   - On SW ready, the client posts { type: 'AETHER_CLIENT_BUILD', buildId }.
 *   - An interval re-posts every 60s so the SW's active-client entry stays
 *     fresh within its TTL (3 min). If the tab is closed, the SW prunes the
 *     stale entry after the TTL and the build becomes eligible for cleanup.
 *   - Also re-reports on `pageshow` (bfcache restore) and `online` events.
 *
 * The buildId is read from `window.__NEXT_DATA__.buildId` (set by Next.js on
 * every page). In dev mode this is "development" — the SW handles that as a
 * normal (single) build.
 */
export function useServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    let intervalId: ReturnType<typeof setInterval> | undefined

    const reportBuild = () => {
      // @ts-expect-error — __NEXT_DATA__ is injected by Next.js at runtime
      const buildId = window.__NEXT_DATA__?.buildId
      if (!buildId) return
      navigator.serviceWorker.controller?.postMessage({
        type: 'AETHER_CLIENT_BUILD',
        buildId,
      })
    }

    const onPageshow = () => reportBuild()
    const onOnline = () => reportBuild()

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope)
        // Report once the SW is active. If a new SW just took over via
        // skipWaiting, `controller` may be null briefly — wait for
        // `controllerchange` then report.
        if (navigator.serviceWorker.controller) {
          reportBuild()
        } else {
          navigator.serviceWorker.addEventListener('controllerchange', reportBuild, { once: true })
        }
        // Re-report every 60s so the SW's active-client TTL (3 min) stays fresh.
        intervalId = setInterval(reportBuild, 60_000)
      })
      .catch((error) => {
        console.warn('SW registration failed:', error)
      })

    window.addEventListener('pageshow', onPageshow)
    window.addEventListener('online', onOnline)

    return () => {
      if (intervalId) clearInterval(intervalId)
      window.removeEventListener('pageshow', onPageshow)
      window.removeEventListener('online', onOnline)
    }
  }, [])
}
