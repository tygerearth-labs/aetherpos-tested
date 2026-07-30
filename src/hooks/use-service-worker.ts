'use client'

/**
 * useServiceWorker — registers the app SW and orchestrates the whole-app
 * build version guard.
 *
 * Responsibilities:
 *   1. Register the SW.
 *   2. Report the client's current buildId (AETHER_CLIENT_BUILD) so the SW
 *      never deletes a build cache an open tab is using (active-client protection).
 *   3. Listen for SW messages:
 *        AETHER_NEW_BUILD  → reportServerBuildId() (triggers update lifecycle)
 *        AETHER_UPDATE_APPLIED → (SW finished skipWaiting + claim)
 *   4. On controllerchange (new SW took over) → if a build update was being
 *      applied, reload ONCE (sessionStorage-guarded, loop-safe).
 *   5. PROACTIVELY check for a new build via multiple triggers:
 *        - app startup (3s after registration, to avoid racing with first paint)
 *        - window online (after re-reporting client build)
 *        - visibilitychange to visible (throttled to once / 5 min)
 *        - 5-minute setInterval (light background poll)
 *      Each trigger calls checkForUpdate() which does:
 *        a. registration.update()       — ask the browser to re-fetch /sw.js
 *        b. checkServerBuildId()        — SAFETY NET: fetch the HTML with
 *           cache:'no-store' and parse __NEXT_DATA__.buildId out of it.
 *           This catches new builds even if the SW never sees a new chunk
 *           (e.g. user never navigates, so the SW fetch handler never runs).
 *
 * BuildId is read from `window.__NEXT_DATA__.buildId`. In dev mode this is
 * "development" — the SW handles that as a single (dev) build.
 */

import { useEffect } from 'react'
import { useBuildVersionStore, markBuildUpdateReloading, canApplyBuildUpdate } from '@/lib/build-guard/build-version-store'

export function useServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    let intervalId: ReturnType<typeof setInterval> | undefined
    let checkIntervalId: ReturnType<typeof setInterval> | undefined
    let startupCheckTimeoutId: ReturnType<typeof setTimeout> | undefined
    let registrationRef: ServiceWorkerRegistration | undefined
    let lastVisibilityCheck = 0

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

    // ── Direct server-buildId check (SAFETY NET) ───────────────────────
    //
    // Fetches the HTML page with cache:'no-store' so we always hit the
    // network (bypassing any cached copy). Parses __NEXT_DATA__.buildId out
    // of the HTML and compares it to the client's buildId. If they differ,
    // calls reportServerBuildId() — which kicks off the update lifecycle
    // (status → 'ready' or 'pending' depending on critical activities).
    //
    // This catches the case where the SW never fires AETHER_NEW_BUILD
    // (e.g. the user hasn't navigated, so no /_next/static/* chunk fetch
    // has hit the SW's fetch handler). It is the client-side ground truth.
    const checkServerBuildId = async () => {
      try {
        // The query param + header distinguish this from a normal navigation
        // so the SW's page handler won't try to use it as a bfcache fallback.
        const res = await fetch(`/?_aether_check=1&t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'X-Aether-Build-Check': '1' },
        })
        if (!res.ok) return
        const html = await res.text()
        // Extract buildId from the __NEXT_DATA__ JSON embedded in the HTML.
        const match = html.match(/"buildId":"([^"]+)"/)
        if (!match) return
        const serverBuildId = match[1]
        const clientBuildId = useBuildVersionStore.getState().clientBuildId
        if (clientBuildId && serverBuildId !== clientBuildId) {
          // Direct detection — bypass the SW entirely.
          useBuildVersionStore.getState().reportServerBuildId(serverBuildId)
        }
      } catch {
        // Network error — offline or SW issue; ignore. The next trigger
        // (online event, visibility, interval) will retry.
      }
    }

    // ── checkForUpdate(): registration.update() + safety-net check ──────
    //
    // registration.update() asks the browser to re-fetch /sw.js and start
    // installing a new SW if it changed (this triggers 'updatefound').
    // We ALSO run checkServerBuildId() because a new app build can land
    // without /sw.js itself changing (the SW script is static; only the
    // Next.js buildId in the chunks changes). The HTML parse is the
    // reliable signal.
    const checkForUpdate = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        if (!registration) return
        // Ask the browser to check for a new SW version.
        await registration.update()
        // ALSO do a direct server-buildId check (safety net — doesn't
        // rely on the SW seeing a new chunk).
        await checkServerBuildId()
      } catch {
        // update() can throw if the network is down; ignore.
      }
    }

    // ── SW message listener (new build detected, update applied) ────────
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'AETHER_NEW_BUILD' && typeof data.buildId === 'string') {
        // The SW detected a chunk URL with a new buildId. Report it to the
        // store — if it differs from clientBuildId, the update lifecycle
        // begins (status → 'ready' or 'pending' depending on activities).
        buildStore.reportServerBuildId(data.buildId)
      }

      if (data.type === 'AETHER_UPDATE_APPLIED') {
        // The SW finished skipWaiting + clients.claim. A controllerchange
        // will follow. The controllerchange handler below does the reload.
      }
    }

    // ── controllerchange → reload once (if a build update is applying) ───
    const onControllerChange = () => {
      const status = useBuildVersionStore.getState().status
      if (status === 'applying') {
        if (canApplyBuildUpdate()) {
          markBuildUpdateReloading()
          // Reload to pick up the new SW + new build chunks.
          window.location.reload()
        }
      } else {
        // A new SW took over outside an explicit apply (e.g. first install,
        // or the SW self-updated). Re-report our buildId so the new SW's
        // active-client map is accurate.
        reportBuild()
      }
    }

    const onPageshow = () => reportBuild()

    // online: re-report client build (so the SW's active-client map is
    // current after a reconnect) AND immediately check for a new build
    // (a deploy may have happened while we were offline).
    const onOnline = () => {
      reportBuild()
      checkForUpdate()
    }

    // visibilitychange: when the tab becomes visible, check for a new build
    // — but throttle to once per 5 minutes to avoid hammering the server on
    // rapid tab switches.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now()
        if (now - lastVisibilityCheck > 5 * 60 * 1000) {
          lastVisibilityCheck = now
          checkForUpdate()
        }
      }
    }

    // updatefound: a new SW version is installing. Informational only —
    // we do NOT auto-apply. The build-version-store + UpdateBanner handle
    // the apply decision based on critical activities.
    const onUpdateFound = (event: Event) => {
      const registration = event.target as ServiceWorkerRegistration
      console.info(
        '[useServiceWorker] SW update found:',
        registration.installing?.scriptURL,
      )
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope)
        registrationRef = registration
        registration.addEventListener('updatefound', onUpdateFound)

        if (navigator.serviceWorker.controller) {
          reportBuild()
        } else {
          navigator.serviceWorker.addEventListener('controllerchange', reportBuild, { once: true })
        }
        // Re-report every 60s so the SW's active-client TTL (3 min) stays fresh.
        intervalId = setInterval(reportBuild, 60_000)

        // Also check for a waiting SW on registration (in case a new SW was
        // already downloaded before this tab opened).
        if (registration.waiting) {
          // A new SW is waiting — this means a new build is likely available.
          // We don't auto-activate; the build-version-store lifecycle handles
          // that. Just note the server build may differ.
        }

        // Initial check for a new build (in case the server was updated
        // while the tab was closed). Delay 3s to avoid racing with the
        // initial page load + first chunk fetches.
        startupCheckTimeoutId = setTimeout(checkForUpdate, 3000)
      })
      .catch((error) => {
        console.warn('SW registration failed:', error)
      })

    window.addEventListener('pageshow', onPageshow)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Light background poll — every 5 minutes, check for a new build.
    // This catches deploys that happen while the tab stays in the
    // foreground without any navigation (so the SW fetch handler never
    // sees a new chunk). Combined with the visibility + online triggers,
    // this ensures a new build is detected within ~5 min in the worst case.
    checkIntervalId = setInterval(checkForUpdate, 5 * 60 * 1000)

    return () => {
      if (intervalId) clearInterval(intervalId)
      if (checkIntervalId) clearInterval(checkIntervalId)
      if (startupCheckTimeoutId) clearTimeout(startupCheckTimeoutId)
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
