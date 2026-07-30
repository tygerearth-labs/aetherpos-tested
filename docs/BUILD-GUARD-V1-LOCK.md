# Aether Whole-App Build Version Guard V1 — LOCK

**Date**: 2026-08-01
**Status**: V1 LOCKED — production-ready, all 5 review gaps closed, E2E verified.
**Predecessor**: `docs/OFFLINE-NAV-V1-LOCK.md` (Offline Navigation V1 — the chunk-recovery + route-protection layer this guard sits on top of)
**Verification evidence**: `docs/BUILD-GUARD-VERIFICATION.md` (authenticated E2E via agent-browser)

---

## 0. MANDATORY PRODUCTION-GATE POLICY (READ FIRST)

> **Setiap fitur baru yang punya draft, upload, background job, atau mutation
> WAJIB mendaftarkan critical activity sebelum boleh masuk production.**

A feature is **BLOCKED FROM PRODUCTION MERGE** if it introduces any of the
following and does NOT register a corresponding critical activity:

| Feature shape | Required activity type | Required severity |
|---|---|---|
| Unsaved form state (`isDirty`, `formState.isDirty`, `hasChanges`) | `dirty-form` | `data-loss` |
| Draft buffer (cart, PO draft, stock-opname draft, transfer draft) | `purchase-draft` / `stock-opname` / `pos-cart` | `data-loss` (or `interrupt` if persisted to Dexie) |
| File upload / file parsing / Excel import / file export in flight | `file-upload` | `interrupt` |
| Background job with a worker or queue (bulk engine, migration engine) | `bulk-job` / `migration-job` | `interrupt` |
| Pending outbox entries (Dexie syncQueue) | `outbox-sync` | `interrupt` |
| In-flight API mutation (POST/PUT/DELETE that commits domain state) | `domain-mutation` | `in-flight` |
| In-flight payment / checkout commit (POS payment, settlement) | `pos-payment` | `in-flight` |

**Enforcement**: `bun run check:critical-activities` (static scanner in
`scripts/check-critical-activity-coverage.ts`). The scanner flags files that
exhibit a draft/upload/job/mutation pattern but contain no `useCriticalActivity`
call. CI MUST run this gate. New violations = merge blocked. False positives
are resolved through the allowlist at `scripts/critical-activity-allowlist.json`
(read-only views, simple confirm dialogs that have no in-flight window, etc.).

**Reviewer checklist** (paste into PR template):

- [ ] Does this PR add a new form with mutable state? → `useCriticalActivity('dirty-form', …, isDirty)`
- [ ] Does this PR add a draft buffer? → `purchase-draft` / `stock-opname` / `pos-cart`
- [ ] Does this PR add a file upload / Excel import / export? → `file-upload`
- [ ] Does this PR add a background worker / queue? → `bulk-job` / `migration-job`
- [ ] Does this PR add a POST/PUT/DELETE API mutation that commits domain state? → `domain-mutation`
- [ ] Does this PR add a payment / checkout commit? → `pos-payment`
- [ ] If yes to any, is the activity severity correct? (`in-flight` for mid-API mutations, `data-loss` for unsaved drafts, `interrupt` for resumable background work)
- [ ] Is the `useCriticalActivity` call placed at the **top level** of the component/hook body (Rules of Hooks — NOT inside a conditional or loop)?
- [ ] Did `bun run check:critical-activities` pass with zero new violations?

---

## 1. V1 Scope (LOCKED)

### 1.1 Architecture

Whole-app build version guard = a coordinated, activity-aware update lifecycle
that prevents a new deployment from corrupting an in-flight user session.

```
SW detects new build ─┐
                      ▼
        AETHER_NEW_BUILD message → useServiceWorker
                      ▼
        build-version-store.reportServerBuildId()
                      ▼
        ┌── has critical activity? ──┐
        │                              │
       YES                            NO
        │                              │
        ▼                              ▼
     pending                       ready
        │                              │
   activities clear                  (banner shown,
        │                             manual apply)
        ▼                              │
      ready ◀──────────────────────────┘
        │
   user clicks "Perbarui sekarang"  (or 3-tier "Muat ulang paksa")
        │
        ▼
     applying ── SW skipWaiting + claim ── controllerchange ── ONE reload
        │
        ▼
      idle  (sessionStorage guard prevents loop)
```

### 1.2 Core modules (V1 LOCKED)

| Module | Path | Responsibility |
|---|---|---|
| Critical Activity Registry | `src/lib/build-guard/critical-activity-registry.ts` | Zustand store, 10 activity types, 3 severity tiers, non-reactive getters, subscription helper |
| Build Version Store | `src/lib/build-guard/build-version-store.ts` | `idle → ready → pending → applying` state machine, auto-transitions, loop-safe sessionStorage guard |
| `useCriticalActivity` hook | `src/hooks/use-critical-activity.ts` | Declarative registration (auto-cleanup on unmount/active=false) |
| Service Worker v2.3 | `public/sw.js` | Build-namespaced caches, active-client-build tracking, `AETHER_NEW_BUILD` emission, `AETHER_ACTIVATE_UPDATE` handler |
| SW registration + triggers | `src/hooks/use-service-worker.ts` | 5 detection triggers + direct server-buildId check via HTML parse |
| Update Banner | `src/components/shared/update-banner.tsx` | 3-tier force ladder, manual "Perbarui sekarang" button (NO auto-apply) |
| Error Boundary | `src/components/error-boundary.tsx` | ChunkLoadError recovery with activity-aware gating |
| Guarded Navigation | `src/lib/navigate.ts` | 6-step guard sequence, `navigateUnchecked()` for recovery |
| App Shell wiring | `src/components/layout/app-shell.tsx` | SW boot, build-version-store subscription, controllerchange reload, `outbox-sync` registration, debug hook |
| Policy gate (NEW) | `scripts/check-critical-activity-coverage.ts` + `scripts/critical-activity-allowlist.json` | Static scanner that flags draft/upload/job/mutation patterns missing `useCriticalActivity` |

### 1.3 The 10 activity types (V1 LOCKED)

| Type | Severity | Description |
|---|---|---|
| `pos-cart` | `interrupt` | POS cart has items. Cart is persisted to Dexie, so a reload doesn't lose data — but it disrupts the cashier's flow. Simple confirm. |
| `pos-payment` | `in-flight` | POS checkout API call in flight. Reloading mid-call leaves the user unsure if the transaction succeeded (double-charge risk). Force DISABLED. |
| `outbox-sync` | `interrupt` | Dexie syncQueue has PENDING items. Will retry on next load. Simple confirm. |
| `bulk-job` | `interrupt` | Bulk engine has a processing job. Resumes on reload (state in Dexie). Simple confirm. |
| `migration-job` | `interrupt` | Migration engine has a PROCESSING job. Resumes on reload. Simple confirm. |
| `stock-opname` | `data-loss` | Stock opname session in progress (draft adjustments). Hard confirm. |
| `purchase-draft` | `data-loss` | Purchase form has unsaved changes. Hard confirm. |
| `dirty-form` | `data-loss` | Any form is dirty (customer/product form). Hard confirm. |
| `file-upload` | `interrupt` | A file upload / Excel parse / export is in flight. Must restart on reload. Simple confirm. |
| `domain-mutation` | `in-flight` | An in-flight domain API mutation (void, adjust, receive, cancel, save, transfer). Reloading mid-request is ambiguous. Force DISABLED. |

### 1.4 The 3-tier force-update ladder (V1 LOCKED)

When the user clicks "Muat ulang paksa" on the UpdateBanner:

```
                   ┌─── any in-flight activity? ──── YES ──▶ [DISABLED]
                   │                                   (caption: "Tidak dapat memuat
                   │                                    ulang selama transaksi berlangsung.
                   │                                    Tunggu hingga selesai.")
                   │
                   │   NO
                   ▼
              ┌── any data-loss activity? ── YES ──▶ HARD CONFIRM
              │                                  (dialog lists every active
              │                                   data-loss + in-flight activity,
              │                                   "Perubahan belum disimpan akan hilang",
              │                                   [Kembali] [Tetap muat ulang])
              │
              │   NO
              ▼
         only interrupt activities ─────────▶ SIMPLE CONFIRM
                                              ("Muat ulang sekarang?",
                                               [Batal] [Muat ulang])

         no activities at all ──────────────▶ DIRECT APPLY
                                              (status='ready', banner shows
                                               "Perbarui sekarang", no dialog)
```

### 1.5 The 5 build-detection triggers (V1 LOCKED)

Implemented in `src/hooks/use-service-worker.ts`:

1. **App startup** — 3s after mount, report client buildId + check server
2. **`window.online` event** — re-check server buildId
3. **`visibilitychange` → visible** — throttled to once per 5 minutes, re-check
4. **5-minute interval** — periodic `registration.update()` + server-buildId check via HTML parse (`?_aether_check=1`)
5. **SW lifecycle** — `updatefound` + `controllerchange` listeners (existing, retained)

The SW lifecycle alone is NOT sufficient because the browser may not call
`update()` for hours if the tab is idle. Explicit triggers guarantee a new
deploy is detected within ~5 minutes of any user activity.

### 1.6 Loop protection (V1 LOCKED)

Two independent sessionStorage guards ensure at most ONE controlled reload per
session, regardless of trigger source:

- `aether-build-update-reloaded` — set before applying a build update; if already
  `'1'` on next load, the app-shell skips the apply and shows recovery instead.
- `aether-chunk-reload-attempted` — set before ErrorBoundary's ChunkLoadError
  auto-reload; if already `'1'` on next load, shows the "Versi aplikasi berubah"
  recovery page instead of looping.

The guards are reset only on a successful post-reload navigation (so a future
update can auto-apply again).

---

## 2. Critical Activity Coverage Matrix (V1 BASELINE — 24 call sites)

All 10 activity types are wired. Each row = one `useCriticalActivity()` call.
Rows marked **[V1.1]** were added by the V1 lock task's policy-gate scan
(discovered by `bun run check:critical-activities` and wired before lock).

| # | File | Type | ID | Severity | Trigger flag |
|---|---|---|---|---|---|
| 1 | `pos/hooks/use-pos-cart.ts` | `pos-cart` | `pos-cart` | interrupt | `cart.length > 0` |
| 2 | `pos/hooks/use-pos-checkout.ts` | `pos-payment` | `pos-payment` | in-flight | `checkingOut` |
| 3 | `layout/app-shell.tsx` | `outbox-sync` | `outbox-sync` | interrupt | `pendingOutboxCount > 0` |
| 4 | `bulk-engine/bulk-worker-provider.tsx` | `bulk-job` | `bulk-job` | interrupt | `hasProcessingBulkJob` |
| 5 | `migration/migration-processor-provider.tsx` | `migration-job` | `migration-job` | interrupt | `hasProcessingMigrationJob` |
| 6 | `pages/stock-opname-page.tsx` | `stock-opname` | `stock-opname` | data-loss | (session in progress) |
| 7 | `pages/purchase-page.tsx` | `purchase-draft` | `purchase-draft` | data-loss | (form has changes) |
| 8 | `pages/purchase-page.tsx` | `domain-mutation` | `domain-mutation-purchase-receive-cancel` | in-flight | `poCreateLoading \|\| poEditLoading \|\| deletingPo` |
| 9 | `pages/customer-form-dialog.tsx` | `dirty-form` | `customer-form` | data-loss | `isDirty` |
| 10 | `pages/product-form-dialog.tsx` | `dirty-form` | `product-form` | data-loss | `isDirty` |
| 11 | `pages/products-page.tsx` | `file-upload` | `file-upload-product-import` | interrupt | `uploading \|\| editExcelUploading` |
| 12 | `pages/products-page.tsx` | `domain-mutation` | `domain-mutation-inventory-adjust` | in-flight | `adjusting` |
| 13 | `pages/transactions-page.tsx` | `domain-mutation` | `domain-mutation-void-transaction` | in-flight | `voidSubmitting` |
| 14 | `pages/customers-page.tsx` | `domain-mutation` | `domain-mutation-customer-loyalty-adjust` | in-flight | `adjusting` |
| 15 | `pages/transfer-page.tsx` | `domain-mutation` | `domain-mutation-stock-transfer` | in-flight | `createLoading \|\| invCreateLoading \|\| actionLoading !== null \|\| invActionLoading !== null` |
| 16 | `pages/settings-page.tsx` | `domain-mutation` | `domain-mutation-settings-save` | in-flight | `saving` (useSettings hook) |
| 17 | `pages/settings-page.tsx` | `domain-mutation` | `domain-mutation-settings-promo-save` | in-flight | `saving \|\| deleting` (PromoTab) |
| 18 | `pages/settings-page.tsx` | `domain-mutation` | `domain-mutation-settings-outlet-save` | in-flight | `saving \|\| deleting` (MultiOutletTab) |
| 19 | `bulk-engine/bulk-upload-dialog.tsx` | `file-upload` | `file-upload-bulk-dialog` | interrupt | `parsing` |
| 20 | `migration/migration-wizard.tsx` | `file-upload` | `file-upload-migration-wizard` | interrupt | `isCheckingDup \|\| isStarting` |
| 21 | **[V1.1]** `pages/crew-page.tsx` | `domain-mutation` | `domain-mutation-crew-save` | in-flight | `saving \|\| deleting` (crew create/edit/delete) |
| 22 | **[V1.1]** `pages/multi-outlet-terminal-page.tsx` (OutletDetailDialog) | `domain-mutation` | `domain-mutation-multi-outlet-crew-delete` | in-flight | `deletingCrew` |
| 23 | **[V1.1]** `pages/multi-outlet-terminal-page.tsx` (MultiOutletTerminalPage) | `domain-mutation` | `domain-mutation-multi-outlet-delete` | in-flight | `deleting` (outlet delete — destructive, removes outlet + all its data) |
| 24 | **[V1.1]** `pos/hooks/use-pos-customers.ts` | `domain-mutation` | `domain-mutation-pos-customer-create` | in-flight | `addingCustomer` (customer create mid-POS) |

**Severity totals**: 7 interrupt + 4 data-loss + 13 in-flight = 24.

---

## 3. Review Gap Closure (all 5 closed)

| Gap | Status | Evidence |
|---|---|---|
| Gap 1 — Runtime not proven (auth blocks E2E) | ✅ CLOSED | Auth fixed (`page.tsx` server component + `getServerSession` → `AppShell` session prop). Full E2E verified via agent-browser. See `docs/BUILD-GUARD-VERIFICATION.md`. |
| Gap 2 — `file-upload` / `domain-mutation` unwired | ✅ CLOSED | 11 hook calls added across 8 files (Task 4). 3 flow substitutions documented where the named UI didn't exist (product image upload → products-page import; inventory adjustment → products-page handleAdjust; customer merge → customer loyalty adjust since merge UI doesn't exist). |
| Gap 3 — Force-update safety too weak | ✅ CLOSED | 3-tier ladder implemented: `interrupt` → simple confirm, `data-loss` → hard confirm with activity list, `in-flight` → button disabled. `in-flight` severity added to registry; `pos-payment` upgraded from `data-loss` → `in-flight`. |
| Gap 4 — Auto-apply too aggressive | ✅ CLOSED | 1.5s auto-apply timer removed. Status `ready` shows manual "Perbarui sekarang" button. No reload happens without explicit user action. |
| Gap 5 — Detection triggers insufficient | ✅ CLOSED | 5 triggers added (startup 3s, online, visibilitychange throttled 5min, 5-min interval, `registration.update()`). Plus direct server-buildId check via HTML parse (`?_aether_check=1`). |

---

## 4. Verification Status

| Area | Status |
|---|---|
| Static lint | ✅ PASS — `bun run lint` 0 errors |
| Authenticated runtime | ✅ PASS — login → dashboard renders |
| Build-update lifecycle (E2E) | ✅ PASS — full sequence verified via agent-browser + debug hook |
| 3-tier force safety (E2E) | ✅ PASS — all 3 tiers verified |
| Detection triggers (E2E) | ✅ PASS — `?_aether_check=1` + `updatefound` in dev log |
| Critical activity coverage | ✅ PASS — 10/10 types wired, 24 call sites (20 from V1 + 4 added by V1.1 policy-gate scan) |
| Loop protection | ✅ PASS — sessionStorage guards verified |
| Policy gate (NEW) | ✅ PASS — `bun run check:critical-activities` runs clean on V1 baseline (11 allowlisted false positives, 0 unallowlisted violations) |
| Real production-build transition | ⚠️ SIMULATED — verified via debug hook `reportServerBuildId()`, not a real deploy. Sandbox prohibits `bun run build`. Must be tested in a prod-build environment. |

---

## 5. V2 Deferrals (NOT in V1 — future phase)

These are explicitly **out of V1 scope** and tracked for a future phase:

1. **Idle-state auto-apply** — V1 requires explicit user click on "Perbarui sekarang". V2 may add true idle detection (no pointer/keyboard activity for N seconds, document visible, no dialog open, no navigation, no mutation request) and auto-apply then. Idle detection is non-trivial and prone to false positives; deferred until V1 manual flow is proven stable in production.
2. **Per-activity stale-build UI** — V1 shows a single global banner. V2 may show inline indicators next to the affected form/section.
3. **Cross-tab coordination** — V1 protects each tab independently. V2 may add BroadcastChannel coordination so opening a second tab with a newer build doesn't surprise the first tab.
4. **Telemetry** — V1 emits no metrics on how often updates are deferred, by which activity, for how long. V2 may add an opt-in telemetry event stream.
5. **Customer merge UI** — Gap 2 substitution flagged that `customers/merge` API has zero UI consumers. The merge flow itself remains unwired (no UI exists). When the merge UI is built, it MUST register `domain-mutation` per the production-gate policy.
6. **Real-build runtime test** — Sandbox prohibits `bun run build`. The real deploy-transition runtime test (two production builds, real SW cache invalidation) must be performed in a non-sandbox environment before V1 is declared "battle-tested".

---

## 6. Files (V1 lock baseline)

**Created (this V1)**:
- `src/lib/build-guard/critical-activity-registry.ts`
- `src/lib/build-guard/build-version-store.ts`
- `src/lib/build-guard/index.ts`
- `src/hooks/use-critical-activity.ts`
- `scripts/check-critical-activity-coverage.ts` (NEW — policy gate)
- `scripts/critical-activity-allowlist.json` (NEW — false-positive allowlist)
- `docs/BUILD-GUARD-V1-LOCK.md` (this file)
- `docs/BUILD-GUARD-VERIFICATION.md`

**Modified (this V1)**:
- `public/sw.js` (v2.2 → v2.3 — `AETHER_ACTIVATE_UPDATE` handler)
- `src/hooks/use-service-worker.ts` (5 detection triggers + server-buildId check)
- `src/components/shared/update-banner.tsx` (3-tier ladder, no auto-apply)
- `src/components/error-boundary.tsx` (activity-aware ChunkLoadError gating)
- `src/lib/navigate.ts` (6-step guarded navigation)
- `src/components/layout/app-shell.tsx` (SW boot, store wiring, debug hook, `outbox-sync`)
- `src/app/page.tsx` (server component + `getServerSession`)
- 8 page/component files wiring `file-upload` + `domain-mutation` (Task 4)
- `src/components/pos/hooks/use-pos-cart.ts`, `use-pos-checkout.ts` (severity correction)
- `package.json` (NEW `check:critical-activities` script)

---

## 7. How to wire a new critical activity (3-line template)

```tsx
import { useCriticalActivity } from '@/hooks/use-critical-activity'

// At the TOP LEVEL of the component/hook body, after the trigger flag is declared:
useCriticalActivity(
  'domain-mutation',                                            // ← pick from the 10 types
  'domain-mutation-my-feature',                                 // ← stable unique id
  'Fitur saya sedang diproses',                                 // ← human-readable Indonesian
  isSubmitting,                                                 // ← boolean: true while in-flight
  'in-flight',                                                  // ← 'interrupt' | 'data-loss' | 'in-flight'
)
```

**Rules** (non-negotiable):

1. The hook MUST be called unconditionally at the top level — never inside `if`,
   `for`, `while`, or after an early return. The hook internally gates on `active`.
2. The `id` MUST be stable and unique across the app (convention:
   `<type>-<feature>`).
3. The `label` MUST be human-readable Indonesian — it appears in the
   hard-confirmation dialog listing active data-loss activities.
4. The `severity` MUST match the consequence of reload:
   - `interrupt` — reload disrupts a resumable process (background job, sync queue)
   - `data-loss` — reload loses unsaved user input (dirty form, draft)
   - `in-flight` — reload leaves the user unsure if the API call succeeded (payment, void, mutation)

**Picking the severity** — when in doubt:

- Does reloading leave the user unsure whether money moved? → `in-flight` (force disabled).
- Does reloading lose unsaved typed input? → `data-loss` (hard confirm).
- Does reloading just restart a background process that resumes? → `interrupt` (simple confirm).

Run `bun run check:critical-activities` after wiring to confirm the scanner sees it.

---

## 8. References

- `docs/OFFLINE-NAV-V1-LOCK.md` — predecessor (chunk-recovery + route-protection layer)
- `docs/BUILD-GUARD-VERIFICATION.md` — full E2E verification record (all 5 gaps)
- `docs/ARCHITECTURE-LOCK.md` — overall platform architecture lock
- `public/sw.js` — SW v2.3 source (header comment documents the full message protocol)
- `src/lib/build-guard/index.ts` — barrel export (public API surface)
