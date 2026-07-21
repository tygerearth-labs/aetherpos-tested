# AetherPOS Fixes — Change Log

## v3 (2026-07-18) — Performance: Drop $transaction on reads + In-memory SWR cache

### Root cause
`GET /api/inventory/batches?type=heatmap` and friends were wrapping **read-only**
`findMany` calls in `db.$transaction(async tx => ...)`. Prisma's default transaction
timeout is **5,000 ms** — combined with cold compile + bulk `markExpiredBatches`
running **blocking** on every request, the API was hitting `P2028` timeout errors
on cold/warm starts, and the dashboard widgets (Freshness Score, Peta Kadaluarsa,
Expiry Banner) silently rendered as `null`.

### Solution A — Drop `$transaction` on read-only paths
- `src/lib/fefo-engine.ts` — 7 read-only functions now accept
  `db: PrismaClient | TxClient` (union) instead of `tx: TxClient`:
  - `checkDuplicateBatch`
  - `calculateFreshnessScore`
  - `getExpiryHeatmap`
  - `getWasteReport`
  - `searchBatch`
  - `getBatchTimeline`
  - `getPurchaseRecommendations`
- `src/app/api/inventory/batches/route.ts` — all 7 read handlers no longer wrap
  in `$transaction`; they pass `db` directly.
- `src/app/api/inventory/batches/expiry-check/route.ts` — split WRITE
  (`markExpiredBatches`, still in short `$transaction`) from READ (heatmap via
  cache).

### Solution B — In-memory TTL cache with SWR pattern
- `src/lib/cache.ts` (NEW) — LRU cache (max 1000 entries) with
  stale-while-revalidate semantics:
  - Fresh hit (< TTL) → return immediately
  - Stale (> TTL) → return stale + refresh in background
  - Cold miss → refresh synchronously
  - `invalidate(pattern)` and `invalidateOutletExpiry(outletId)` helpers
- Applied in route handlers:
  | Endpoint                        | Cache key                       | TTL  |
  | ------------------------------- | -------------------------------- | ---- |
  | `?type=heatmap`                 | `heatmap:{outletId}`             | 5 m  |
  | `?type=freshness-score`         | `freshness:{outletId}`           | 5 m  |
  | `?type=waste-report`            | `waste:{outletId}:{start}:{end}` | 5 m  |
  | `?type=recommendations`         | `recs:{outletId}`                | 10 m |
  | `?type=timeline`                | `timeline:{outletId}:{itemId}`   | 2 m  |
  | `?type=search`                  | — (no cache)                     | —    |
  | `?type=check-duplicate`         | — (no cache)                     | —    |
  | POST `expiry-check`             | `expirycheck:{outletId}`         | 5 m  |

### `markExpiredBatches` — lazy + throttled
- Now triggered fire-and-forget via `triggerMarkExpiredLazy(outletId)`.
- Throttled to **max 1× per 5 minutes per outlet** using the cache itself as a
  cooldown marker.
- No longer blocks the read response.

### Cache invalidation on writes
Added `invalidateOutletExpiry(outletId)` calls on all 3 write endpoints so a
fresh write immediately busts the cached heatmap/freshness/recommendations:
- `src/app/api/purchases/route.ts` — POST (new PO creates new batches)
- `src/app/api/inventory/items/[id]/adjust/route.ts` — POST (stock adjustment)
- `src/app/api/inventory/stock-opname/complete.ts` — POST (stock opname done)

### Bonus UI fix
- `src/components/dashboard/dashboard-sections.tsx` — three dashboard widgets
  (`InventoryFreshnessWidget`, `ExpiryHeatmapWidget`, `ExpiryAlertBanner`) were
  reading `json?.data` but `safeJson()` returns a flat payload (no `.data`
  wrapper). After dropping the 5 s transaction, the timeout was no longer
  masking this bug — widgets were silently rendering `null`. Fixed to
  `const payload = (json?.data ?? json) as Type | null`.

### Result (verified via Agent Browser)
| Endpoint                                  | Before          | After     |
| ----------------------------------------- | --------------- | --------- |
| `GET ?type=heatmap` (cold)                | 5,500 ms (P2028)| 22 ms     |
| `GET ?type=freshness-score` (cold)        | 5,900 ms (P2028)| 19 ms     |
| `POST /expiry-check` (cold)               | 5,394 ms (P2028)| 21–57 ms  |
| 10 concurrent heatmap requests            | ~50,000 ms      | ~107 ms   |

No more `P2028` transaction timeout errors. Dashboard widgets now actually
render the freshness score, expiry heatmap, and expiry alert banner.

---

## v2 (2026-07-18) — UI/UX fixes + case-insensitive PostgreSQL search

- `src/components/pages/purchase-page.tsx`
  - Search no longer triggers a full-page refresh / skeleton flash.
  - Skeleton only shows on initial load; inline spinner shows next to the
    search input while typing.
- `src/lib/api/api-helpers.ts`
  - `buildFlexibleSearch()` auto-detects PostgreSQL vs SQLite.
  - For PostgreSQL it adds `mode: 'insensitive'` to every `contains` clause.
  - New `ciContains()` helper for direct use in `fefo-engine.ts`.
- `src/lib/fefo-engine.ts`
  - `searchBatch` and `checkDuplicateBatch` now use `ciContains()` so
    case-insensitive search works on the user's real PostgreSQL DB.
- `src/app/api/products/route.ts`, `products/search/route.ts`,
  `inventory/items/route.ts`, `inventory/items/[id]/route.ts`
  - Switched to `buildFlexibleSearch()` so product/inventory/batch search is
    case-insensitive in PostgreSQL.

---

## v1 (2026-07-17) — Initial fixes

- Case-insensitive search groundwork.
- Product/inventory/batch list endpoints.
- Inventory item detail endpoint.

---

## Files in this zip (15)

| # | Path                                                         | Status      |
|---|--------------------------------------------------------------|-------------|
| 1 | `src/lib/cache.ts`                                           | NEW         |
| 2 | `src/lib/api/api-helpers.ts`                                 | Updated (v2)|
| 3 | `src/lib/fefo-engine.ts`                                     | Updated (v3)|
| 4 | `src/app/api/products/route.ts`                              | Updated (v1)|
| 5 | `src/app/api/products/search/route.ts`                       | Updated (v1)|
| 6 | `src/app/api/inventory/items/route.ts`                       | Updated (v1)|
| 7 | `src/app/api/inventory/items/[id]/route.ts`                  | Updated (v1)|
| 8 | `src/app/api/inventory/items/[id]/adjust/route.ts`           | Updated (v3)|
| 9 | `src/app/api/inventory/batches/route.ts`                     | Updated (v3)|
|10 | `src/app/api/inventory/batches/expiry-check/route.ts`        | Updated (v3)|
|11 | `src/app/api/inventory/stock-opname/complete.ts`             | Updated (v3)|
|12 | `src/app/api/purchases/route.ts`                             | Updated (v3)|
|13 | `src/components/dashboard/dashboard-sections.tsx`            | Updated (v3)|
|14 | `src/components/pages/dashboard-page.tsx`                    | Updated (v3)|
|15 | `src/components/pages/purchase-page.tsx`                     | Updated (v2)|

## Install

1. Unzip into your project root (overwrite existing files).
2. Restart the dev server.
3. In the browser: unregister any service worker + clear caches
   (DevTools → Application → Service Workers → Unregister).
4. Open the dashboard — the Freshness Score, Peta Kadaluarsa, and Expiry
   Alert Banner widgets should now render with real data.
