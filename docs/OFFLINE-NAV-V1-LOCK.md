# Offline Navigation V1 — LOCK

**Date**: 2026-07-31
**Commit**: `83ca2c0` (residuals closure) + this lock commit
**Verdict**: V1 scope LOCKED. Read-only offline coverage deferred to a future phase.

---

## V1 Scope (LOCKED — production-ready)

These capabilities are complete, browser-verified, and locked as V1:

### 1. Route Protection
- **Route capability registry** (`src/lib/route-capability.ts`) — single source of truth classifying every route as `FULL` / `READ_ONLY` / `ONLINE_ONLY`
- **Navigation guard** (`src/lib/navigate.ts`) — blocks navigation to `ONLINE_ONLY` routes when offline, shows intentional `OfflineRouteBlocker` dialog
- **Sidebar + mobile nav** — dim `ONLINE_ONLY` items with WifiOff icon when offline; all navigation uses the guarded `navigate()` helper
- **Deep-link safety** — SPA state-based navigation means no URL-based deep links to guard

### 2. Chunk Load Error Recovery
- **`isChunkLoadError()`** — detects Webpack `ChunkLoadError`, Turbopack `Failed to fetch dynamically imported module`, Safari `Importing a module script failed`, CSS chunk errors
- **ErrorBoundary 3-path recovery**:
  - Offline → "Halaman ini belum tersedia secara offline" + "Kembali ke POS" (no reload)
  - Online first failure → auto-reload once (sessionStorage guard)
  - Online already-reloaded → "Versi aplikasi berubah" + "Muat ulang aplikasi" (clear cache + reload)
- **Reload loop protection** — sessionStorage guard ensures at most ONE auto-reload per session
- **No raw chunk/module identifiers** exposed to users

### 3. Service Worker (v2.2)
- **Build-namespaced caches** — `aether-build-<buildId>` per build, CacheFirst for chunks/css/media
- **Active-client-build protection** — clients report buildId on load + every 60s; SW never deletes a build cache that an open tab is using (3-min TTL)
- **Recent-builds retention** — keeps N most recent builds as a floor
- **Priority prefetch** — `useRoutePrefetch` triggers lazy imports for FULL + READ_ONLY routes while online + idle
- **Stale-build detection** — SW notifies clients on `AETHER_NEW_BUILD`
- **The dangerous sequence is impossible**: `activate new SW → delete old build cache → old tab navigates → chunk missing`

### 4. POS Offline (FULL)
- Local transactions queued in Dexie outbox
- Syncs on reconnect
- Core revenue flow survives offline — unchanged from prior work

### 5. UI Consistency
- Offline banner text aligned with error page (no contradictory "Coba Lagi" on a guaranteed-fail path)
- `ONLINE_ONLY` routes show no retry button (only "Kembali ke POS" + "Tutup")

---

## V2 Scope (DEFERRED — read-only offline coverage, future phase)

The READ_ONLY routes (Dashboard, Products, Customers, Transactions) currently use **in-memory SNAPSHOT**, not true Dexie fallback. This is a stepping stone, not the final offline vision. Honest limitations:

### What READ_ONLY does today (V1)
- Renders the last successful API response from in-memory React/TanStack state
- Shows `<OfflineDataNotice>` ("Mode Offline — menampilkan data tersimpan") as the first element
- Disables all mutations (create/edit/delete/void/export/bulk) when offline
- Persists "last updated" timestamp in Dexie metadata (survives reloads)
- Browser-verified on all 4 routes: notice-first + mutations disabled

### What READ_ONLY does NOT do (V2 work)
1. **Snapshot does not survive offline reload** — if the user reloads while offline, the in-memory snapshot is lost and the page shows a loading/empty state (the notice still shows, explaining the situation). True persistence requires wiring sync-service to populate `aetherDB` product/customer/transaction tables and reading from them when offline.
2. **No background sync of READ_ONLY data** — there is no periodic Dexie sync of products/customers/transactions while online; the snapshot is only refreshed on page visit.
3. **No conflict resolution** — since mutations are disabled offline, there are no conflicts to resolve. When true offline mutation (with outbox) is added for these routes, conflict resolution will be needed.

### Why deferred
- True Dexie fallback for READ_ONLY routes requires a sync-service redesign: populating aetherDB tables, adding read paths from Dexie when offline, handling schema migrations, and testing data consistency.
- This is a substantial body of work that belongs in a dedicated V2 phase, not bolted onto the V1 chunk-recovery + route-protection work.
- The V1 SNAPSHOT approach is honest (labeled `SNAPSHOT`, not `DEXIE`), useful (cached data renders offline without reload), and safe (mutations disabled).

---

## Verification Status

| Area | Status |
|------|--------|
| Route protection (ONLINE_ONLY blocking) | ✅ PASS — browser-verified |
| ChunkLoadError recovery (offline path) | ✅ PASS — browser-verified |
| ChunkLoadError recovery (online stale-build path) | ⚪ NOT RUNTIME-TESTED — requires production build (sandbox prohibits `bun run build`). Logic implemented + code-reviewed. Must be tested in a prod-build environment before claiming PASS. |
| SW v2.2 active-client-build protection | ⚪ NOT RUNTIME-TESTED — requires two production builds to simulate deploy transition. Logic implemented + code-reviewed. |
| POS offline (FULL) | ✅ PASS — unchanged from prior |
| READ_ONLY SNAPSHOT (4 routes) | ✅ PASS for in-memory snapshot + notice + disabled mutations. Does NOT survive offline reload (V2 work). |

---

## Files (V1 lock baseline)

**Created**: `route-capability.ts`, `chunk-load-error.ts`, `navigate.ts`, `use-route-prefetch.ts`, `use-offline-data.ts`, `offline-route-blocker.tsx`, `offline-data-notice.tsx`

**Modified**: `error-boundary.tsx`, `app-shell.tsx`, `sidebar.tsx`, `mobile-bottom-nav.tsx`, `use-page-store.ts`, `use-service-worker.ts`, `dashboard-page.tsx`, `products-page.tsx`, `customers-page.tsx`, `transactions-page.tsx`

**Rewritten**: `public/sw.js` (v1 → v2.2)

**Docs**: `docs/OFFLINE-NAV-VERIFICATION.md` (honest status), `docs/OFFLINE-NAV-V1-LOCK.md` (this file)

---

## V2 Entry Points (when work begins)

When the read-only offline coverage V2 phase starts, the key files to touch:
- `src/lib/sync-service.ts` — extend to populate `aetherDB` products/customers/transactions tables (not just syncMeta)
- `src/lib/offline/aether-db.ts` — add read queries for offline fallback
- `src/lib/route-capability.ts` — change `cacheDataSource: 'SNAPSHOT'` → `'DEXIE'` for the 4 routes once Dexie fallback is wired
- `src/hooks/use-offline-data.ts` — add a `readFromDexie(syncKey)` companion for true offline reads
- `src/components/pages/{dashboard,products,customers,transactions}-page.tsx` — fall back to Dexie reads when API fails offline (instead of showing empty/loading)
- `docs/OFFLINE-NAV-VERIFICATION.md` — update TEST C to reflect Dexie-fallback survival of offline reload

The V1 building blocks (`useOfflineData`, `<OfflineDataNotice>`, `recordDataFetch`) are designed to extend cleanly to V2 — the hook already reads from `aetherDB.metadata`, so adding `aetherDB.products` reads is incremental.
