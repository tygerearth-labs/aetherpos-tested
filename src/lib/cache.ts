/**
 * cache.ts — Lightweight in-memory TTL cache (per-process)
 *
 * Used by inventory/batch read endpoints to avoid re-running expensive
 * read-only Prisma queries on every dashboard load.
 *
 * Features:
 *   - LRU eviction (max 1000 entries)
 *   - TTL per-entry
 *   - SWR pattern (stale-while-revalidate):
 *       * Fresh hit  → return immediately
 *       * Expired w/ stale → return stale, refresh in background
 *       * Miss → refresh synchronously
 *   - Pattern-based invalidation for write paths
 *
 * Design notes:
 *   - Single-process cache. On Vercel serverless, each instance has its own
 *     cache (acceptable for now; swap to Redis later via same interface).
 *   - Per-outlet key namespacing → multi-tenant safe.
 *   - Cache value is JSON-serializable; we store the already-serialized
 *     plain object (safeJson already strips Prisma magic types upstream).
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number // epoch ms
  refreshing?: Promise<T> | undefined
}

const MAX_ENTRIES = 1000
const store = new Map<string, CacheEntry<unknown>>()

/**
 * Read a cached value if still fresh. Returns null on miss/expiry.
 */
export function getCached<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.value as T
}

/**
 * Store a value with a TTL (in milliseconds).
 */
export function setCached<T>(key: string, value: T, ttlMs: number): void {
  // LRU eviction: drop oldest entry if we're at capacity
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value
    if (oldestKey) store.delete(oldestKey)
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/**
 * Stale-While-Revalidate: return fresh immediately, or stale + background
 * refresh, or wait for first refresh on cold miss.
 *
 * @param key      Cache key (include outletId for multi-tenant safety)
 * @param ttlMs    Fresh duration in ms
 * @param refreshFn  Function to fetch fresh data
 */
export async function swr<T>(
  key: string,
  ttlMs: number,
  refreshFn: () => Promise<T>
): Promise<T> {
  const entry = store.get(key) as CacheEntry<T> | undefined

  // 1. Fresh hit → return immediately
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value
  }

  // 2. Already refreshing? Return stale (don't pile up concurrent refreshes)
  if (entry && entry.refreshing) {
    return entry.value
  }

  // 3. Cold miss — refresh synchronously
  const refreshPromise = refreshFn()
    .then((value) => {
      setCached(key, value, ttlMs)
      return value
    })
    .finally(() => {
      const e = store.get(key) as CacheEntry<T> | undefined
      if (e) e.refreshing = undefined
    })

  if (entry) {
    // 4. Stale exists → return stale, refresh in background (SWR)
    entry.refreshing = refreshPromise
    return entry.value
  }

  // 5. No stale — wait for the first refresh
  return refreshPromise
}

/**
 * Invalidate cache entries whose key contains the pattern.
 * Use `invalidate('heatmap:' + outletId)` for a specific outlet,
 * or `invalidate('heatmap:')` to clear all outlets.
 */
export function invalidate(pattern: string): void {
  for (const key of Array.from(store.keys())) {
    if (key.includes(pattern)) {
      store.delete(key)
    }
  }
}

/**
 * Invalidate all expiry/inventory-related cache entries for a given outlet.
 * Convenience helper for write paths (PO create, stock adjust, stock opname).
 */
export function invalidateOutletExpiry(outletId: string): void {
  const patterns = [
    `heatmap:${outletId}`,
    `freshness:${outletId}`,
    `expirycheck:${outletId}`,
    `recs:${outletId}`,
    `timeline:${outletId}:`,
    `waste:${outletId}:`,
  ]
  for (const p of patterns) invalidate(p)
}

// ────────────────────────────────────────────────────────────
// markExpired throttle helper
// ────────────────────────────────────────────────────────────

const MARK_EXPIRED_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes
const MARK_EXPIRED_RETRY_MS = 30 * 1000 // 30 seconds on failure

/**
 * Returns true if markExpiredBatches has run for this outlet in the last
 * 5 minutes (i.e. still in cooldown → skip the background trigger).
 */
export function isMarkExpiredInCooldown(outletId: string): boolean {
  return getCached<boolean>(`markexpired:${outletId}`) !== null
}

/**
 * Mark that we just triggered markExpired for this outlet. Sets the cooldown.
 * On failure, the caller should call this with `failed=true` to use a shorter
 * retry cooldown instead.
 */
export function setMarkExpiredTriggered(outletId: string, failed = false): void {
  setCached(
    `markexpired:${outletId}`,
    true,
    failed ? MARK_EXPIRED_RETRY_MS : MARK_EXPIRED_COOLDOWN_MS
  )
}
