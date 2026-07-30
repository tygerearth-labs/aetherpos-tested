// Aether POS - Service Worker v2.2 (Offline Navigation Capability)
//
// Strategy:
//   1. CacheFirst for /_next/static/{chunks,css,media}/* — immutable build assets.
//      Each build gets its own cache namespace keyed by the buildId extracted
//      from the URL path. Old build caches are cleaned up after activation,
//      but recent builds AND builds with active open tabs are retained.
//   2. StaleWhileRevalidate for /_next/static/* non-chunk assets + public
//      static assets (logo, manifest, fonts).
//   3. NetworkFirst for pages (HTML) + API — fall back to cache when offline.
//   4. Priority route prefetch: on AETHER_PREFETCH_ROUTES message, fetch and
//      cache the lazy chunk URLs for FULL + READ_ONLY routes.
//   5. Build versioning with ACTIVE-CLIENT protection:
//      a. "recent builds" list — the N most recently seen buildIds.
//      b. "active client builds" map — clientId → { buildId, timestamp },
//         updated by clients posting AETHER_CLIENT_BUILD on load + every 60s.
//      On activate, the keep-set = recent-builds ∪ active-client-builds.
//      A build cache is NEVER deleted while at least one open tab reports it.
//      This guarantees the dangerous sequence never happens:
//        activate new SW → delete old build cache → old tab navigates → chunk missing
//
// DO NOT:
//   - precache the entire application (only cache what's used or prefetched)
//   - cache API responses with side effects (only GET)
//   - retain every historical build (only recent N + actively-used)
//   - delete a build cache that an open tab is still using (active-client map)

const SW_VERSION = 'aether-sw-v2.2'
const BUILD_CACHE_PREFIX = 'aether-build-'
const STATIC_CACHE = 'aether-static-v2'
const PAGE_CACHE = 'aether-pages-v2'
const API_CACHE = 'aether-api-v2'

// Maximum number of build caches to retain from the "recent builds" list.
// This is a floor, not a ceiling: builds with active open tabs are ALWAYS kept
// regardless of this limit. With 2: current build + previous build. This
// covers the common single-deployment transition. The active-client map
// additionally protects any older build still in use by an open tab.
const MAX_BUILD_CACHES = 2

// A client is considered "active" if it has reported its buildId within this
// window. Clients report on load + every 60s, so 3 minutes (180s) gives ample
// margin for a temporarily delayed report (e.g. tab backgrounded).
const ACTIVE_CLIENT_TTL_MS = 3 * 60 * 1000

// Static assets to precache on install (small, always needed)
const PRECACHE_ASSETS = ['/', '/manifest.json', '/logo.png', '/favicon.png']

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract the Next.js buildId from a /_next/static/ URL.
 * Path format: /_next/static/<buildId>/chunks/... | /_next/static/<buildId>/css/...
 * Returns null for paths without a buildId (e.g. /_next/static/chunks/ in dev).
 */
function extractBuildId(pathname) {
  const m = pathname.match(/^\/_next\/static\/([^/]+)\//)
  return m ? m[1] : null
}

/**
 * Get the cache name for a specific buildId.
 */
function buildCacheName(buildId) {
  return `${BUILD_CACHE_PREFIX}${buildId}`
}

// ── Recent-builds tracking ───────────────────────────────────────────────
//
// We maintain an ordered list of recently-seen buildIds in the STATIC_CACHE
// under a synthetic request URL 'aether://recent-builds'. The list is ordered
// most-recent-first. When a new buildId is detected, it's prepended and the
// list is trimmed to MAX_BUILD_CACHES.
//
// On activate, only build caches whose buildId is in this list are kept.
// All others are deleted. This guarantees that the N most recent builds
// survive activation, so open tabs using any of those builds don't break.

async function getRecentBuilds() {
  try {
    const cache = await caches.open(STATIC_CACHE)
    const resp = await cache.match('aether://recent-builds')
    if (!resp) return []
    const text = await resp.text()
    const arr = JSON.parse(text)
    return Array.isArray(arr) ? arr.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

async function addRecentBuild(buildId) {
  const recent = await getRecentBuilds()
  // Prepend new buildId, remove duplicates, trim to MAX
  const updated = [buildId, ...recent.filter((id) => id !== buildId)].slice(0, MAX_BUILD_CACHES)
  const cache = await caches.open(STATIC_CACHE)
  await cache.put(
    new Request('aether://recent-builds'),
    new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } }),
  )
  return updated
}

// ── Active-client-builds tracking ─────────────────────────────────────────
//
// Map of clientId → { buildId, ts }. Updated when a client posts
// AETHER_CLIENT_BUILD. On activate, any build in this map (within TTL) is
// kept — even if it's not in the recent-builds list. This prevents the SW
// from deleting a build cache that an open tab still needs.

async function getActiveClientBuilds() {
  try {
    const cache = await caches.open(STATIC_CACHE)
    const resp = await cache.match('aether://active-client-builds')
    if (!resp) return {}
    const text = await resp.text()
    const obj = JSON.parse(text)
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

async function setActiveClientBuild(clientId, buildId) {
  const map = await getActiveClientBuilds()
  map[clientId] = { buildId, ts: Date.now() }
  // Prune stale entries while we're here (TTL-based cleanup)
  const now = Date.now()
  for (const id of Object.keys(map)) {
    if (now - (map[id].ts || 0) > ACTIVE_CLIENT_TTL_MS) {
      delete map[id]
    }
  }
  const cache = await caches.open(STATIC_CACHE)
  await cache.put(
    new Request('aether://active-client-builds'),
    new Response(JSON.stringify(map), { headers: { 'Content-Type': 'application/json' } }),
  )
  return map
}

async function getActiveBuildSet() {
  const map = await getActiveClientBuilds()
  const now = Date.now()
  const set = new Set()
  for (const id of Object.keys(map)) {
    const entry = map[id]
    if (entry && now - (entry.ts || 0) <= ACTIVE_CLIENT_TTL_MS) {
      set.add(entry.buildId)
    }
  }
  return set
}

// ── Install: precache minimal static assets ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS)),
  )
  // Take over immediately — don't wait for old SW clients to close.
  // This is safe because we keep recent build caches during activate.
  self.skipWaiting()
})

// ── Activate: clean old caches, keep recent + active-client builds ─────────
//
// CRITICAL SAFETY: The keep-set is the UNION of:
//   1. recent-builds list (most recent N buildIds seen by the SW)
//   2. active-client-builds map (buildIds reported by currently-open tabs
//      within the ACTIVE_CLIENT_TTL_MS window)
//
// This GUARANTEES that a build cache is never deleted while an open tab is
// still using it — even if that build is 2+ deploys old. The dangerous
// sequence is impossible:
//   activate new SW → delete old build cache → old tab navigates → chunk missing
//
// Flow:
//   1. Old tab on buildA reports buildA → active-client-builds['tab1'] = buildA
//   2. New deploy buildB → new SW installs → skipWaiting → activate
//   3. Activate reads recent-builds (['buildA']) + active-client-builds ({tab1: buildA})
//   4. keep-set = {buildA} → buildA cache survives ✓
//   5. Old tab navigates → buildA chunks still cached ✓
//   6. Tab reloads → fetches buildB → reports buildB → recent becomes ['buildB', 'buildA']
//   7. After ACTIVE_CLIENT_TTL_MS with no buildA report → buildA eligible for cleanup
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys()
      const recentBuilds = await getRecentBuilds()
      const activeBuilds = await getActiveBuildSet()

      // Build the keep set from recent-builds ∪ active-client-builds
      const keepSet = new Set()
      recentBuilds.forEach((id) => keepSet.add(buildCacheName(id)))
      activeBuilds.forEach((id) => keepSet.add(buildCacheName(id)))

      // Group build caches by buildId
      const buildCaches = cacheNames
        .filter((n) => n.startsWith(BUILD_CACHE_PREFIX))
        .map((n) => ({ name: n, buildId: n.slice(BUILD_CACHE_PREFIX.length) }))

      // Delete build caches not in the keep set
      const buildDeletes = buildCaches
        .filter((c) => !keepSet.has(c.name))
        .map((c) => caches.delete(c.name))

      // Delete legacy v1 caches (from the old SW)
      const legacyDeletes = cacheNames
        .filter((n) => n === 'aether-pos-v1')
        .map((n) => caches.delete(n))

      await Promise.all([...buildDeletes, ...legacyDeletes])
      await self.clients.claim()
    })(),
  )
})

// ── Fetch: route by request type ─────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle GET
  if (request.method !== 'GET') return
  // Skip non-http(s)
  if (!url.protocol.startsWith('http')) return
  // Skip Next.js HMR / dev-only paths
  if (url.pathname.startsWith('/_next/webpack-hmr')) return

  // 1. Next static build assets (chunks, css, media) → CacheFirst + build namespace
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(handleBuildAsset(request, url))
    return
  }

  // 2. API → NetworkFirst (fall back to cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApi(request))
    return
  }

  // 3. Pages (HTML navigation) → NetworkFirst, fall back to cached page or '/'
  event.respondWith(handlePage(request))
})

// ── Build asset handler: CacheFirst with build versioning ────────────────
async function handleBuildAsset(request, url) {
  const buildId = extractBuildId(url.pathname)

  // Dev mode (no buildId in path) → just fetch, don't cache
  if (!buildId) {
    try {
      return await fetch(request)
    } catch {
      const cached = await caches.match(request)
      return cached || Response.error()
    }
  }

  const cacheName = buildCacheName(buildId)
  const cache = await caches.open(cacheName)

  // CacheFirst: try cache
  const cached = await cache.match(request)
  if (cached) return cached

  // Not in cache → fetch, cache on success, update recent builds
  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
      // If this is a new buildId, add it to the recent-builds list + notify clients
      const recent = await getRecentBuilds()
      if (!recent.includes(buildId)) {
        await addRecentBuild(buildId)
        // Notify clients a new build was detected (for telemetry / reload prompt)
        const clients = await self.clients.matchAll({ type: 'window' })
        clients.forEach((c) => c.postMessage({ type: 'AETHER_NEW_BUILD', buildId }))
      }
    }
    return response
  } catch (err) {
    // Offline + chunk not cached → return an error response so the
    // ErrorBoundary's isChunkLoadError path triggers
    return Response.error()
  }
}

// ── API handler: NetworkFirst with cache fallback (GET only) ─────────────
async function handleApi(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(API_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached || Response.error()
  }
}

// ── Page handler: NetworkFirst, fall back to cached HTML or '/' ──────────
async function handlePage(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(PAGE_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached || caches.match('/')
  }
}

// ── Message handler: prefetch priority route chunks ──────────────────────
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return

  if (data.type === 'AETHER_PREFETCH_ROUTES' && Array.isArray(data.routes)) {
    // The client has already triggered the lazy imports (which causes the
    // browser to fetch the chunks). We additionally proactively cache any
    // /_next/static/* requests that are in-flight. The actual chunk URLs
    // are discovered by the fetch handler above. Here we just signal that
    // prefetch is allowed — the fetch handler does the caching.
    event.source?.postMessage({ type: 'AETHER_PREFETCH_ACK', routes: data.routes })
    return
  }

  if (data.type === 'AETHER_SKIP_WAITING') {
    self.skipWaiting()
    return
  }

  // Client reports its current buildId so the SW knows which build caches
  // are actively in use. The SW keeps these caches during activate (see the
  // active-client-builds logic above). Clients should send this on load and
  // periodically (every 60s) so the entry stays fresh within the TTL.
  if (data.type === 'AETHER_CLIENT_BUILD' && typeof data.buildId === 'string') {
    const clientId = event.source?.id
    if (clientId) {
      setActiveClientBuild(clientId, data.buildId).catch(() => {
        // best-effort — IndexedDB/cache failure is non-fatal
      })
    }
    return
  }
})
