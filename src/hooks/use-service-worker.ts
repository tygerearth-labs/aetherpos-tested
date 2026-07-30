'use client'

/**
 * useServiceWorker — registers the app SW and orchestrates the whole-app
 * build version guard. (v3.0 — stale-shell fix)
 *
 * Responsibilities:
 *   1. Register the SW with `updateViaCache: 'none'` so /sw.js is ALWAYS
 *      re-fetched from the network (never served from browser cache).
 *   2. Report the client's current buildId (AETHER_CLIENT_BUILD) so the SW
 *      never deletes a build cache an open tab is using (active-client protection).
 *   3. Detect new builds via `/api/build-version` (canonical source, no-store).
 *      The old HTML-parse approach is REMOVED — it could read a stale cached
 *      HTML document. `/api/build-version` bypasses the SW fetch handler
 *      entirely and is served with Cache-Control: no-store.
 *   4. Listen for SW messages:
 *        AETHER_NEW_BUILD      → reportServerBuildId() (triggers update lifecycle)
 *        AETHER_UPDATE_APPLIED → (SW finished skipWaiting + claim)
 *        AETHER_SW_ACTIVATED   → (new SW version took over — re-report build)
 *        AETHER_PURGE_ACK      → (HTML caches purged — proceed with recovery)
 *   5. Controlled update order (v3.0):
 *        a. registration.update()       — ask browser to re-fetch /sw.js
 *        b. detect registration.waiting — a new SW is waiting to activate
 *        c. if status === 'ready', send AETHER_ACTIVATE_UPDATE to waiting SW
 *        d. waiting SW calls skipWaiting() + clients.claim()
 *        e. client receives controllerchange
 *        f. client reloads EXACTLY ONCE (sessionStorage-guarded, loop-safe)
 *      NEVER reload before controllerchange.
 *   6. Emergency stale-shell recovery (v3.0):
 *        If serverBuildId differs AND coordinated SW activation fails/times
 *        out (no controllerchange within 8s), the client:
 *          - sends AETHER_PURGE_HTML_CACHES to the SW (deletes only page/HTML
 *            caches, preserves Dexie/outbox/cart/migration/bulk queues)
 *          - navigates with a cache-busting query parameter (?_aether_recover=1)
 *          - reloads once (sessionStorage-guarded)
 *          - never loops
 *   7. PROACTIVE detection triggers (retained):
 *        - app startup (3s after registration)
 *        - window online
 *        - visibilitychange to visible (throttled 5 min)
 *        - 5-minute setInterval
 *
 * BuildId is read from `window.__NEXT_DATA__.buildId` for the CLIENT build.
 * The SERVER build is read from `/api/build-version`.
 */

import { useEffect } from 'react'
import {
  useBuildVersionStore,
  markBuildUpdateReloading,
  canApplyBuildUpdate,
} from '@/lib/build-guard/build-version-store'

// Timeout for coordinated SW activation. If controllerchange doesn't fire
// within this window after sending AETHER_ACTIVATE_UPDATE, we fall back to
// emergency stale-shell recovery.
const SW_ACTIVATION_TIMEOUT_MS = 8000

export function useServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    let intervalId: ReturnType<typeof setInterval> | undefined
    let checkIntervalId: ReturnType<typeof setInterval> | undefined
    let startupCheckTimeoutId: ReturnType<typeof setTimeout> | undefined
    let activationTimeoutId: ReturnType<typeof setTimeout> | undefined
    let registrationRef: ServiceWorkerRegistration | undefined
    let lastVisibilityCheck = 0
    let emergencyRecoveryInProgress = false

    const buildStore = useBuildVersionStore.getState()

    // ── Read + report the client's buildId ──────────────────────────────
    const getClientBuildId = (): string | null => {
      // @ts-expect-error — __NEXT_DATA__ is injected by Next.js at runtime
      return window.__NEXT_DATA__?.buildId ?? null
    }

    const reportBuild = () => {
      const buildId = getClientBuildId()
      if (!buildId) return
      buildStore.setClientBuildId(buildId)
      navigator.serviceWorker.controller?.postMessage({
        type: 'AETHER_CLIENT_BUILD',
        buildId,
      })
    }

    // ── Canonical server-buildId check via /api/build-version ───────────
    //
    // v3.0: fetches /api/build-version (no-store) instead of parsing HTML.
    // The SW fetch handler BYPASSES /api/build-version, so this always hits
    // the network origin. The response carries Cache-Control: no-store so
    // the browser never caches it either.
    const checkServerBuildId = async () => {
      try {
        const res = await fetch('/api/build-version', {
          cache: 'no-store',
          headers: { 'X-Aether-Build-Check': '1' },
        })
        if (!res.ok) return
        const data = await res.json()
        if (!data || typeof data.buildId !== 'string') return
        const serverBuildId = data.buildId
        const clientBuildId = useBuildVersionStore.getState().clientBuildId
        if (clientBuildId && serverBuildId !== clientBuildId) {
          useBuildVersionStore.getState().reportServerBuildId(serverBuildId)
        }
      } catch {
        // Network error — offline or SW issue; ignore. The next trigger
        // (online event, visibility, interval) will retry.
      }
    }

    // ── checkForUpdate(): registration.update() + /api/build-version ───
    const checkForUpdate = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        if (registration) {
          // Ask the browser to re-fetch /sw.js. With updateViaCache:'none',
          // the browser always goes to the network for this.
          await registration.update()
        }
        // ALSO do a direct /api/build-version check (canonical signal).
        await checkServerBuildId()
      } catch {
        // update() can throw if the network is down; ignore.
      }
    }

    // ── Emergency stale-shell recovery (v3.0) ───────────────────────────
    //
    // Triggered when:
    //   - serverBuildId differs from clientBuildId (stale build detected)
    //   - AND coordinated SW activation failed/timed out (no controllerchange
    //     within SW_ACTIVATION_TIMEOUT_MS after sending AETHER_ACTIVATE_UPDATE)
    //
    // Recovery steps:
    //   1. Send AETHER_PURGE_HTML_CACHES to the SW (deletes only page/HTML
    //      caches, preserves Dexie/outbox/cart/migration/bulk queues).
    //   2. Navigate with a cache-busting query parameter.
    //   3. Reload once (sessionStorage-guarded, loop-safe).
    const emergencyRecover = async () => {
      if (emergencyRecoveryInProgress) return
      if (!canApplyBuildUpdate()) return
      emergencyRecoveryInProgress = true
      markBuildUpdateReloading()
      try {
        // Ask the SW to purge HTML caches (best-effort — if the SW is
        // unresponsive, the browser's no-store fetch + cache-busting query
        // will still get a fresh HTML response).
        navigator.serviceWorker.controller?.postMessage({
          type: 'AETHER_PURGE_HTML_CACHES',
        })
      } catch {
        /* ignore */
      }
      // Wait briefly for the purge to complete, then reload with a
      // cache-busting query param.
      setTimeout(() => {
        const url = new URL(window.location.href)
        url.searchParams.set('_aether_recover', String(Date.now()))
        window.location.replace(url.toString())
      }, 200)
    }

    // ── SW message listener ─────────────────────────────────────────────
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'AETHER_NEW_BUILD' && typeof data.buildId === 'string') {
        buildStore.reportServerBuildId(data.buildId)
      }

      if (data.type === 'AETHER_UPDATE_APPLIED') {
        // SW finished skipWaiting + claim. controllerchange will follow.
        // The controllerchange handler does the reload.
        if (activationTimeoutId) clearTimeout(activationTimeoutId)
      }

      if (data.type === 'AETHER_SW_ACTIVATED') {
        // A new SW version took over. Re-report our buildId so the new SW's
        // active-client map is accurate.
        reportBuild()
      }

      if (data.type === 'AETHER_PURGE_ACK') {
        // HTML caches purged. The emergency recovery's reload will proceed.
      }
    }

    // ── controllerchange → reload once (if a build update is applying) ───
    //
    // v3.0: This is the ONLY place a build-update reload happens. The SW
    // NEVER reloads the client directly. Reload happens ONLY after
    // controllerchange fires, which means the new SW has fully taken over.
    const onControllerChange = () => {
      if (activationTimeoutId) {
        clearTimeout(activationTimeoutId)
        activationTimeoutId = undefined
      }
      const status = useBuildVersionStore.getState().status
      if (status === 'applying') {
        if (canApplyBuildUpdate()) {
          markBuildUpdateReloading()
          window.location.reload()
        }
      } else {
        // A new SW took over outside an explicit apply (e.g. first install,
        // or the SW self-updated). Re-report our buildId.
        reportBuild()
      }
    }

    // ── Coordinated update activation ───────────────────────────────────
    //
    // Called when the build-version-store transitions to 'applying' (user
    // clicked "Perbarui sekarang" or "Muat ulang paksa" with confirmation).
    // Sends AETHER_ACTIVATE_UPDATE to the waiting SW. If controllerchange
    // doesn't fire within SW_ACTIVATION_TIMEOUT_MS, falls back to emergency
    // recovery.
    const activateUpdate = () => {
      const registration = registrationRef
      if (!registration || !registration.waiting) {
        // No waiting SW — nothing to activate. Try emergency recovery if
        // we know the server build differs.
        const { clientBuildId, serverBuildId } = useBuildVersionStore.getState()
        if (clientBuildId && serverBuildId && clientBuildId !== serverBuildId) {
          emergencyRecover()
        }
        return
      }
      // Set a timeout — if controllerchange doesn't fire in time, recover.
      activationTimeoutId = setTimeout(() => {
        const { clientBuildId, serverBuildId } = useBuildVersionStore.getState()
        if (clientBuildId && serverBuildId && clientBuildId !== serverBuildId) {
          console.warn(
            '[useServiceWorker] SW activation timed out — emergency recovery',
          )
          emergencyRecover()
        }
      }, SW_ACTIVATION_TIMEOUT_MS)
      // Ask the waiting SW to take over.
      registration.waiting.postMessage({ type: 'AETHER_ACTIVATE_UPDATE' })
    }

    // Subscribe to build-version-store 'applying' transitions
    // (Zustand v5: subscribe(listener) fires on every state change with
    // (state, prevState) — we filter for the idle/ready/pending → applying
    // transition ourselves.)
    let prevStatus = useBuildVersionStore.getState().status
    const unsubscribeBuildStore = useBuildVersionStore.subscribe((state) => {
      if (prevStatus !== 'applying' && state.status === 'applying') {
        activateUpdate()
      }
      prevStatus = state.status
    })

    const onPageshow = () => reportBuild()

    const onOnline = () => {
      reportBuild()
      checkForUpdate()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now()
        if (now - lastVisibilityCheck > 5 * 60 * 1000) {
          lastVisibilityCheck = now
          checkForUpdate()
        }
      }
    }

    const onUpdateFound = (event: Event) => {
      const registration = event.target as ServiceWorkerRegistration
      console.info(
        '[useServiceWorker] SW update found:',
        registration.installing?.scriptURL,
      )
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // ── Register with updateViaCache: 'none' (v3.0 critical fix) ────────
    //
    // This tells the browser to NEVER use the HTTP cache when fetching
    // /sw.js. Combined with the Cache-Control: no-cache,no-store header
    // on /sw.js (set in next.config.ts), this guarantees the browser always
    // sees the latest SW script.
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        console.log('SW registered (updateViaCache:none):', registration.scope)
        registrationRef = registration
        registration.addEventListener('updatefound', onUpdateFound)

        if (navigator.serviceWorker.controller) {
          reportBuild()
        } else {
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            reportBuild,
            { once: true },
          )
        }
        // Re-report every 60s so the SW's active-client TTL (3 min) stays fresh.
        intervalId = setInterval(reportBuild, 60_000)

        // Initial check for a new build (in case the server was updated
        // while the tab was closed). Delay 3s to avoid racing with the
        // initial page load.
        startupCheckTimeoutId = setTimeout(checkForUpdate, 3000)
      })
      .catch((error) => {
        console.warn('SW registration failed:', error)
      })

    window.addEventListener('pageshow', onPageshow)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Light background poll — every 5 minutes.
    checkIntervalId = setInterval(checkForUpdate, 5 * 60 * 1000)

    return () => {
      if (intervalId) clearInterval(intervalId)
      if (checkIntervalId) clearInterval(checkIntervalId)
      if (startupCheckTimeoutId) clearTimeout(startupCheckTimeoutId)
      if (activationTimeoutId) clearTimeout(activationTimeoutId)
      unsubscribeBuildStore()
      navigator.serviceWorker.removeEventListener('message', onMessage)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      navigator.serviceWorker.removeEventListener('controllerchange', reportBuild)
      window.removeEventListener('pageshow', onPageshow)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (registrationRef) {
        registrationRef.removeEventListener('updatefound', onUpdateFound)
      }
    }
  }, [])
}
