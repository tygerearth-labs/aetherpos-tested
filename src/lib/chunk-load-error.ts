/**
 * chunk-load-error.ts — ChunkLoadError classification + controlled reload guard
 *
 * A "chunk load failure" happens when React.lazy / next/dynamic tries to
 * import a JS/CSS chunk that is not available (offline, stale build, deploy
 * mismatch). The error surfaces under several names depending on the bundler:
 *   - Webpack:  Error { name: 'ChunkLoadError', message: 'Loading chunk X failed...' }
 *   - Turbopack: TypeError { message: 'Failed to fetch dynamically imported module ...' }
 *   - Safari:   Error { message: 'Importing a module script failed.' }
 *   - CSS chunk: Error { message: 'Loading CSS chunk X failed.' }
 *
 * We detect all of these so the error boundary can show the right recovery UI
 * instead of a generic "Halaman Error".
 */

const CHUNK_ERROR_PATTERNS = [
  /Loading chunk/i,
  /Loading CSS chunk/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /chunk load/i,
]

/**
 * Returns true if the error represents a failed dynamic-import / chunk load.
 * This covers both "offline, chunk never cached" and "stale build, chunk hash
 * no longer exists on server".
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { name?: string; message?: string; code?: string | number }
  if (err.name === 'ChunkLoadError') return true
  if (typeof err.code === 'string' && /chunk|import/i.test(err.code)) return true
  const msg = err.message ?? ''
  if (!msg) return false
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(msg))
}

// ── Controlled reload guard (online stale-build recovery) ───────────────────
//
// When a chunk load fails while ONLINE, the most likely cause is a stale
// deployment: the user has an old build tab open, navigates, and the server
// no longer serves the old chunk hash. One controlled reload resolves this
// (the reload fetches the new HTML which points at new chunk hashes).
//
// We guard with sessionStorage so we reload AT MOST ONCE per session. If the
// reload still fails, the error boundary shows a "Muat ulang aplikasi" /
// "Clear cache" recovery UI instead of looping.

const RELOAD_GUARD_KEY = 'aether-chunk-reloaded'

/**
 * Returns true if we have NOT yet attempted a chunk-load reload this session.
 * The caller should: if true → set guard + reload; if false → show recovery UI.
 */
export function canAttemptChunkReload(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY) !== '1'
  } catch {
    return false
  }
}

/**
 * Mark that a chunk-load reload has been attempted, then reload the page.
 * Safe to call only when canAttemptChunkReload() returned true.
 */
export function performChunkReload(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
  } catch {
    /* sessionStorage might be blocked; proceed with reload anyway */
  }
  // Force a hard reload (bypass HTTP cache for the HTML document so new
  // chunk hashes are discovered). The chunks themselves are still served
  // cache-first by the SW, but the new HTML's import map points to new hashes.
  window.location.reload()
}

/**
 * Reset the reload guard. Called when the user manually clears cache from
 * the recovery UI, or after a successful navigation post-reload (so a future
 * stale-build event can auto-recover again).
 */
export function resetChunkReloadGuard(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY)
  } catch {
    /* ignore */
  }
}
