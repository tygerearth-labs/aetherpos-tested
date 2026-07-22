# PHASE 1 POS SCOPE v1.0

> **Status**: ✅ **APPROVED v1.0** — With BUG-02 Boundary Condition Satisfied
> **Approval Date**: 2026-01-29
> **Approver**: Project Owner (via G1-G5 Guardrails compliance)
> **Audit Date**: 2026-01-29
> **Auditor**: Phase 1 POS Audit Agent (READ-ONLY)
> **Basis**: Full code-level trace of all execution flows, mutation surfaces, state complexity
> **Companion**: `docs/UX-DESIGN-CONTRACT.md` (Approved), `docs/ARCHITECTURE-LOCK.md` (Frozen)

---

## CORE PRINCIPLE (REAFFIRMED)

> **"Improve the cockpit without touching the engine."**

**Verdict: ✅ BOUNDARY IS CLEAN**

The cockpit-engine boundary is **clean and well-defined**:
- All engine calls (`InventoryConsumptionService`, `FEFOEngine`) happen **exclusively inside server-side API routes**
- The POS frontend (cockpit) touches only: React state, IndexedDB via `local-db.ts`, and `fetch()` to `/api/transactions/sync`
- **Nothing in pos-page.tsx or its child components directly imports or calls engine services**
- This means UX redesign has **maximum freedom** within the cockpit layer

---

## 0. EXECUTION FLOW SUMMARY

### Complete POS Transaction Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        USER-FACING LAYER (COCKPIT)                          │
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────────┐  │
│  │ SCAN /   │───▶│   CART   │───▶│ CHECKOUT │───▶│   PAYMENT DIALOG     │  │
│  │ SEARCH   │    │ (memory) │    │          │    │   (method + amount)  │  │
│  └──────────┘    └──────────┘    └────┬─────┘    └──────────┬───────────┘  │
│       ▲               │               │                      │              │
│       │               ▼               ▼                      ▼              │
│  [Barcode heuristic]  [useState]  [validate]            [confirm pay]       │
│  [80ms timing]        [49 total]  [HPP guard]           [canPay check]     │
└───────────────────────────────────────┼───────────────────────────────────┘
                                        │
         ┌──────────────────────────────┼──────────────────────────────┐
         │         LOCAL COMMIT LAYER (IndexedDB)                       │
         │                                                              │
         │    STEP 1: Generate eventId (UUID)                           │
         │    STEP 2: Write to localDB.transactions (isSynced=0)        │
         │    STEP 3: Decrement local stock in IndexedDB                │
         │    STEP 4: IF online → POST /api/transactions/sync           │
         │             IF offline → generate OFF-{timestamp} invoice    │
         │                                                              │
         │    ⚠️ COMMIT ≠ SERVER SUCCESS                                 │
         │    ⚠️ Local stock NOT rolled back on sync failure            │
         └──────────────────────────────┼──────────────────────────────┘
                                        │
         ┌──────────────────────────────┼──────────────────────────────┐
         │              SERVER LAYER (API Routes)                        │
         │                                                              │
         │  POST /api/transactions/sync                                  │
         │    ├── Auth + Limits check                                    │
         │    ├── DEX-007 Dedup (eventId lookup)                         │
         │    ├── Validation (items, qty, price)                         │
         │    ├── Stock pre-check                                       │
         │    ├── Invoice generation                                     │
         │    ├── Create Transaction + TransactionItems                  │
         │    ├── Atomic SQL stock deduction                             │
         │    ├── 🔒 InventoryConsumptionService.consumeForTransaction() │
         │    ├── 🔒 FEFOEngine integration (batch consumption)          │
         │    ├── Loyalty points handling                               │
         │    └── DEX-007 Dedup marker (post-tx)                        │
         │                                                              │
         │  POST /api/transactions/[id]/void  (EXTERNAL to POS)          │
         │    ├── OWNER-only guard                                       │
         │    ├── Double-void prevention                                 │
         │    ├── db.$transaction atomic void:                          │
         │    │   ├── Step 1: Restock Product/Variant stock             │
         │    │   ├── Step 2: Parent stock recalculation                │
         │    │   ├── Step 3: Inventory reverse (snapshots/fallback)    │
         │    │   ├── Step 3.5: FEFO batch restoration                  │
         │    │   ├── Step 4: Loyalty reversal                          │
         │    │   └── Step 5: RESTOCK + VOID audit logs                │
         │                                                              │
         └──────────────────────────────┼──────────────────────────────┘
                                        │
                              ┌─────────▼─────────┐
                              │   POSTGRESQL DB    │
                              │   (Authoritative)   │
                              └────────────────────┘
```

### Sync Queue Flow

```
┌────────────────────────────────────────────────────────────────┐
│                    SYNC QUEUE LIFECYCLE                        │
│                                                                │
│  TRIGGERS:                                                     │
│  ├─ Auto-sync: useEffect(isOnline) → 2000ms debounce           │
│  ├─ Manual sync: handleSync() click handler                    │
│  ├─ Per-tx sync: "Sync Sekarang" button in offline list        │
│  └─ Initial mount: useEffect on mount + isOnline               │
│                                                                │
│  EXECUTION:                                                    │
│  1. Query localDB.transactions.where('isSynced').equals(0)     │
│  2. POST /api/transactions/sync { transactions: pending[] }    │
│  3. For each result:                                          │
│     ├─ success → update localDB (isSynced=1, invoiceNumber)   │
│     └─ fail → increment retryCount, store lastError            │
│  4. Refresh master data (products, customers, categories)      │
│                                                                │
│  DEDUP (DEX-007):                                              │
│  ├─ Client: crypto.randomUUID() eventId at checkout time       │
│  ├─ Server pre-check: auditLog lookup by eventId               │
│  └─ Server authoritative: unique-index INSERT (race-safe)      │
│                                                                │
│  ⚠️ No exponential backoff on retries                           │
│  ⚠️ No max retry limit (indefinite retry)                       │
└────────────────────────────────────────────────────────────────┘
```

---

## 1. ALLOWED — COCKPIT REDESIGN SCOPE

### 1.1 Component Modularization (CRITICAL)

| ID | Scope | Current | Target | Rationale |
|----|-------|---------|--------|-----------|
| A1 | Split `pos-page.tsx` into orchestrator + modules | 3516 lines in 1 file | ~200 lines orchestrator | God component anti-pattern; untestable |
| A2 | Extract `usePosCart()` hook | Inline state (#24-26, #39-42) | ~300 line custom hook | Cart CRUD, totals, HPP validation |
| A3 | Extract `usePosCheckout()` hook | Inline state (#32-37, #43-44) | ~250 line custom hook | Payment flow, hold/resume |
| A4 | Extract `usePosSync()` hook | Inline state (#1-5, #45-46) + effects | ~250 line custom hook | Online/offline, auto-sync, manual sync |
| A5 | Extract `usePosProducts()` hook | Inline state (#6-12, #27) | ~250 line custom hook | Browse, search, variants |
| A6 | Extract `usePosCustomers()` hook | Inline state (#17-23) | ~150 line custom hook | Search, select, add new |
| A7 | Extract `usePosSettings()` hook | Inline state (#13-16, #28-31) | ~150 line custom hook | Settings, promos, outlets |
| A8 | Extract `ProductBrowser` component | 3 duplicate layout renders | Single component with layout props | DRY desktop/tablet/mobile |
| A9 | Extract `CartItemList` + `CartItemRow` | ~200 lines inline mobile cart | Shared components | Desktop/mobile reuse |
| A10 | Extract `SyncStatusBar` component | ~50 lines inline header | Standalone component | Header cleanup |
| A11 | Extract `OfflinePanel` component | ~350 lines inline JSX | Standalone panel | Offline list detail view |
| A12 | Extract `CustomerSelector` component | ~100 lines inline | Standalone with Portal dropdown | Mobile overflow fix |

**Target file structure after modularization:**
```
src/components/pos/
├── pos-page.tsx                 (~200 lines — orchestrator)
├── hooks/
│   ├── use-pos-cart.ts          (~300 lines)
│   ├── use-pos-checkout.ts      (~250 lines)
│   ├── use-pos-sync.ts          (~250 lines)
│   ├── use-pos-products.ts      (~250 lines)
│   ├── use-pos-customers.ts     (~150 lines)
│   └── use-pos-settings.ts      (~150 lines)
├── components/
│   ├── product-browser.tsx      (~200 lines)
│   ├── cart-item-list.tsx       (~200 lines)
│   ├── cart-summary.tsx         (~100 lines)
│   ├── customer-selector.tsx    (~150 lines)
│   ├── variant-picker.tsx       (~100 lines)
│   ├── sync-status-bar.tsx      (~80 lines)
│   ├── offline-panel.tsx        (~300 lines)
│   └── hold-dialog.tsx          (~80 lines)
├── payment-dialog.tsx           (existing — 455 lines)
├── receipt-dialog.tsx           (existing — 528 lines)
└── layouts/
    ├── pos-desktop-layout.tsx   (~200 lines)
    ├── pos-mobile-layout.tsx    (~150 lines)
    └── pos-tablet-layout.tsx    (~150 lines)
```

**Rule: No single file exceeds 350 lines.**

### 1.2 State Management Improvements

| ID | Scope | Current Issue | Solution |
|----|-------|--------------|----------|
| S1 | Consolidate inline edit states | 4 states (`editingQtyId`, `editingQtyValue`, `editingPriceId`, `editingPriceValue`) | Single `inlineEdit: { type, id, value }` object |
| S2 | Move derived values into hooks | `subtotal`, `total`, `change`, `belowHppItems` computed inline | Memoized inside owning hook |
| S3 | Unify sync guards | `syncingRef` + `checkoutSyncRef` + `syncing` state = 3 guards | Document clearly or use state machine |
| S4 | Reduce dialog open states | 7 boolean states for dialogs/panels | Consider state reducer or enum |

### 1.3 UI/UX Improvements

| ID | Scope | Current | Proposed |
|----|-------|---------|----------|
| U1 | Receipt printing | `window.open('', '_blank')` blocked by popup blockers | Iframe-based print or react-to-print library |
| U2 | Barcode detection | Fragile 80ms timing heuristic | Add `KeyboardEvent.isComposing` guard + configurable threshold |
| U3 | Mobile cart experience | FAB button positioning can overlap | Unified floating bottom bar |
| U4 | Customer dropdown | Absolutely positioned, clips on small screens | Portal-based or Sheet on mobile |
| U5 | HPP warning timing | Fires on every transition (annoying during edits) | Debounce or show only on payment attempt |
| U6 | Loading states | Basic spinner in some areas | Skeleton loading, optimistic updates |
| U7 | Error states | Toast-only error feedback | Inline error messages + recovery actions |
| U8 | Empty states | Generic empty product list | Empty state illustrations + CTA |
| U9 | Indonesian language | Mostly good, some English strings remain | Full id-ID audit pass |
| U10 | Keyboard shortcuts | None | F2=focus search, F12=toggle cart, Ctrl+Enter=quick-pay |

### 1.4 Code Quality Improvements

| ID | Scope | Current | Proposed |
|----|-------|---------|----------|
| Q1 | Settings fetch duplication | ~75 lines duplicated in 2 useEffects (lines 266 & 345) | Extract `useSettings()` hook |
| Q2 | Sync logic duplication | ~80% identical between `handleSync()` and auto-sync effect | Extract shared `executeSync()` function |
| Q3 | Checkout function complexity | `handleCheckout()` is ~130 lines doing 5+ things | Break into: `buildPayload()` → `localCommit()` → `serverSync()` → `handleResult()` |
| Q4 | Quick nominals computation | Complex useMemo buried in component body | Extract to shared utility or checkout hook |

### 1.5 Offline Experience Improvements

| ID | Scope | Current | Proposed |
|----|-------|---------|----------|
| O1 | Sync failure stock reconciliation | Local stock decremented but not rolled back on server rejection | Add reconciliation step on failure |
| O2 | Retry behavior | No exponential backoff, no max retry limit | Implement backoff: 30s → 60s → 120s → 300s → max 5min |
| O3 | Race condition protection | Auto-sync and manual sync can run concurrently | Unify to single syncing mutex |
| O4 | Resume pending cart hold | Auto-holds current cart without confirmation | Add confirmation dialog |
| O5 | Cart persistence | Memory-only, lost on refresh | Optional sessionStorage backup |

---

## 2. FORBIDDEN — DO NOT MODIFY UNDER ANY CIRCUMSTANCE

### 2.1 Engine Services (🔒 ARCHITECTURE LOCK)

| File | What | Why Frozen | Exception Process |
|------|------|-----------|-------------------|
| `src/lib/inventory-consumption-service.ts` | **ENTIRE FILE** (~900 lines) | Core business logic; bug = wrong stock, financial loss | ADR required |
| `src/lib/fefo-engine.ts` | **ENTIRE FILE** (~1800 lines) | Batch tracking; food safety compliance | ADR required |
| `prisma/schema.prisma` (TransactionConsumption) | Schema definition | Immutable audit trail; void depends on shape | ADR required |
| `prisma/schema.prisma` (BatchConsumptionLog) | Schema definition | Provenance tracking; cannot be altered | ADR required |

### 2.2 Server-Side Mutation Logic (🔒 ARCHITECTURE LOCK)

| File | Lines | What | Why Frozen |
|------|-------|------|-----------|
| `/api/pos/checkout/route.ts` | 326-360 | Stock deduction SQL (atomic `WHERE stock >= qty`) | Race-condition-free guarantee |
| `/api/pos/checkout/route.ts` | 353-380 | Parent stock recalculation | Variant invariant maintenance |
| `/api/pos/checkout/route.ts` | 407-489 | Loyalty point handling | Atomic point update |
| `/api/transactions/sync/route.ts` | 340-400 | Mirror of checkout stock deduction | Must stay identical to checkout |
| `/api/transactions/sync/route.ts` | 382-396 | `InventoryConsumptionService.consumeForTransaction()` call | Engine boundary |
| `/api/transactions/[id]/void/route.ts` | 108-370 | Full 6-step atomic void pipeline | Most critical operation |

### 2.3 Data Contracts (🔒 ARCHITECTURE LOCK)

| Contract | Detail |
|----------|--------|
| `InventoryItem.stock = Σ(AVAILABLE InventoryBatch.remainingQty)` | Invariant must hold |
| Estimated COGS ≠ Actual COGS | Both preserved, never mixed |
| TransactionConsumption is append-only | No update/delete operations |
| EventId UUID for deduplication (DEX-007) | Idempotency guarantee |
| Void is atomic (db.$transaction) | All-or-nothing restoration |

### 2.4 Forbidden Patterns

| Pattern | Reason |
|---------|--------|
| ❌ Direct import of `InventoryConsumptionService` in frontend code | Engine boundary violation |
| ❌ Direct import of `FEFOEngine` in frontend code | Engine boundary violation |
| ❌ Client-side stock deduction logic that differs from server | Semantic divergence risk |
| ❌ Modifying `local-db.ts` table schemas | IndexedDB schema migration complexity |
| ❌ Changing checkout payload structure | Server expects specific format |
| ❌ Removing eventId generation | Breaks DEX-007 dedup |
| ❌ Skipping local commit before API call | Breaks offline-first contract |
| ❌ Using standard `useMutation()` for checkout without adaptation | COMMIT ≠ server success |

---

## 3. PRESERVE — WORKING LOGIC THAT MUST REMAIN UNCHANGED

### 3.1 Business Logic (Preserve Behavior, May Restructure Code)

| ID | Location | Behavior | Preservation Requirement |
|----|----------|----------|-------------------------|
| P1 | `addToCart()` (line 1065) | Stock guard, merge on key, overflow check | Same validation logic after refactor |
| P2 | Cart item structure | `{product, variant, qty, customPrice}` | Keep data shape (used by checkout payload) |
| P3 | Total calculation formula | Subtotal - discounts - points + tax | Same arithmetic (accounting compliance) |
| P4 | HPP below-cost block | Prevents opening payment if selling below cost | Keep hard block (financial safeguard) |
| P5 | Barcode exact-match validation | Checks barcode, SKU, variant SKU/barcode, name | Same matching logic |
| P6 | Category filter + search sort | In-stock first, then highest stock, then alpha | Same sort priority |
| P7 | Variant auto-add optimization | Single in-stock variant skips picker | Keep UX optimization |
| P8 | Payment method filtering | From `settings.paymentMethods.split(',')` | Respect server config |
| P9 | Quick nominal computation | Includes exact total, round up/down, standard denominations | Same smart nominals |
| P10 | Loyalty points calculation | `pointsToUse * loyaltyPointValue` | Same formula |
| P11 | Offline invoice format | `OFF-{Date.now().toString(36).toUpperCase()}` | Keep parseable format |
| P12 | DEX-007 eventId pattern | `crypto.randomUUID()` or fallback | Keep uniqueness guarantee |

### 3.2 User Flows (Preserve, May Improve Presentation)

| Flow | Current Steps | Preservation |
|------|---------------|-------------|
| Add to cart | Click/scan/search → validate stock → add/merge | Same steps, better feedback |
| Edit quantity | Click edit → input appears → confirm/cancel | Same interaction model |
| Edit price | Click price → input appears → confirm/cancel | Same interaction model |
| Select customer | Search → dropdown → select OR add new | Same flow |
| Apply promo | Auto-calculate on cart change → show discount | Same trigger, better display |
| Payment | Open dialog → select method → enter amount → confirm | Same flow, better UX |
| Hold transaction | Enter note → save to pending → clear cart | Same semantics |
| Resume pending → Load cart + customer → delete pending | Same, add confirmation |
| Print receipt | Click print → render receipt → trigger print | Fix implementation, keep output |
| Share WhatsApp | Click WA → open waUrl with pre-filled message | Fix popup blocker issue |
| View offline list | Click header badge → see pending transactions | Same access, better presentation |
| Manual sync | Click sync → process queue → show results | Same, add progress indicator |

---

## 4. CONFIRMED BUGS

### Priority Classification

| Priority | Definition | Action |
|----------|-----------|--------|
| 🔴 P0-CRITICAL | Core workflow broken, affects all users | Fix immediately in Phase 1 |
| 🟡 P1-HIGH | Significant impact, workaround exists | Fix in Phase 1 |
| 🟢 P2-MEDIUM | Minor issue, edge case | Fix if time permits |
| ⚪ P3-LOW | Cosmetic/nit | Defer |

### Bug Register

| ID | Severity | File:Line | Bug Description | Impact | Root Cause | Fix Complexity | Phase |
|----|----------|-----------|-----------------|--------|------------|---------------|-------|
| **BUG-01** | 🔴 P0 | `receipt-dialog.tsx:285` | **`window.open('', '_blank')` for print receipt is blocked by popup blockers** | Users cannot print receipts in Chrome/Firefox/Safari defaults. Silent failure — nothing happens on click. | Popup blockers block `window.open()` with empty URL; should use iframe or react-to-print | 🟡 MEDIUM (2-3 hours) | **Phase 1** |
| **BUG-02** | 🟡 P1 | `pos-page.tsx:1405-1421` | **Local stock decrement NOT rolled back on sync failure** | If server rejects transaction (insufficient stock, plan limit), local IndexedDB stock already decremented. Shows wrong stock until next full sync. | No error/reconciliation path in catch block after `localDB.products.modify()` | 🟡 HIGH (1 day) | **Phase 1** |
| **BUG-03** | 🟡 P1 | `pos-page.tsx:904-936` | **Timing-based barcode detection is fragile** | 80ms threshold assumes specific scanner hardware. Fast typists (>80wpm) may accidentally trigger barcode mode. Some scanners may not match threshold. | Heuristic uses `now - lastInputTime < 80ms` with no configuration or alternative detection method | 🟡 MEDIUM (2-3 hours) | **Phase 1** |
| **BUG-04** | 🟡 P2 | `pos-page.tsx:1510 vs 658` | **Race condition: auto-sync and manual sync can execute concurrently** | `syncingRef` guards auto-sync but `handleSync()` uses separate `syncing` state. Both paths can execute simultaneously → potential double-sync (partially mitigated by DEX-007 eventId) | Two separate synchronization guards not unified | 🟢 LOW (30 min) | **Phase 1** |
| **BUG-05** | 🟡 P2 | `pos-page.tsx:848-890` | **Barcode auto-add useEffect has implicit ref dependency** | Effect watches `[products, productsLoading, productSearch]` but reads `barcodeDetectedRef` which is NOT in dependency array. Stale closure possible in rare timing scenarios. | Refs are intentionally excluded from deps, but effect reads ref value for decision logic | 🟢 LOW (15 min) | **Phase 1** |
| **BUG-06** | 🟢 P3 | `pos-page.tsx:1171-1193` | **Resume pending silently auto-holds current cart** | If user has items in cart and resumes pending, current cart is held without explicit confirmation. User may lose track of current cart. | No confirmation dialog before `holdTransaction()` call | ⚪ TRIVIAL (15 min) | Phase 2 |

### Recommended Fix Order

```
Phase 1 Sprint 1 (Foundation):
  └─ BUG-01: Receipt print fix (highest user-visible impact)

Phase 1 Sprint 2 (Core):
  ├─ BUG-02: Stock reconciliation on sync failure
  ├─ BUG-03: Barcode detection improvement
  └─ BUG-04: Sync race condition unification

Phase 1 Sprint 3 (Polish):
  ├─ BUG-05: Ref dependency correction
  └─ BUG-06: Resume confirmation dialog
```

---

## 5. UX REDESIGN TARGETS (PRIORITIZED)

### Tier 1 — Foundation (Must Do First)

| ID | Target | Effort | Dependency |
|----|--------|--------|------------|
| T1 | **Modularize pos-page.tsx** — Split into orchestrator + 6 hooks + 8 sub-components | 3-4 days | None (blocks everything else) |
| T2 | **Fix receipt printing** (BUG-01) — Replace window.open with iframe-based print | 2-3 hours | None |
| T3 | **Extract usePosCart()** — Cart state, CRUD, totals, HPP validation | 4-6 hours | After T1 |
| T4 | **Extract usePosCheckout()** — Payment flow, hold/resume, checkout orchestration | 4-6 hours | After T1 |
| T5 | **Extract usePosSync()** — Online/offline detection, sync queue management | 4-6 hours | After T1 |

### Tier 2 — Core UX Improvements

| ID | Target | Effort | Dependency |
|----|--------|--------|------------|
| T6 | **Extract ProductBrowser component** — DRY 3 layout renders into 1 | 4-6 hours | After T1 |
| T7 | **Extract CustomerSelector with Portal** — Fix mobile overflow | 2-3 hours | After T1 |
| T8 | **Extract OfflinePanel** — Offline transaction list as standalone | 3-4 hours | After T5 |
| T9 | **Improve barcode detection** (BUG-03) — Add isComposing guard | 2-3 hours | None |
| T10 | **Add sync stock reconciliation** (BUG-02) — Rollback on failure | 4-6 hours | After T5 |
| T11 | **Unify sync logic** (Q2) — Extract shared executeSync() | 1-2 hours | After T5 |

### Tier 3 — Polish & Enhancement

| ID | Target | Effort | Dependency |
|----|--------|--------|------------|
| T12 | **Cart sessionStorage persistence** — Survive accidental refresh | 2-3 hours | After T3 |
| T13 | **Keyboard shortcuts** — F2, F12, Ctrl+Enter | 2-3 hours | After T1 |
| T14 | **Exponential backoff for sync retry** — Prevent server hammering | 1-2 hours | After T5 |
| T15 | **Skeleton loading states** — Replace spinners with content skeletons | 3-4 hours | After T6 |
| T16 | **Empty state designs** — Illustrations + CTAs for empty lists | 2-3 hours | After T6 |
| T17 | **Indonesian language audit** — Ensure all strings are id-ID | 1-2 hours | Anytime |
| T18 | **HPP warning debouncing** — Only show on payment attempt | 30 min | After T3 |

---

## 6. VERIFICATION CHECKLIST

### Pre-Redesign Verification (BASELINE)

- [ ] **V-01**: Record current pos-page.tsx line count: ____ (expected ~3516)
- [ ] **V-02**: Record current useState count: ____ (expected ~49)
- [ ] **V-03**: Run `bun run lint` — record errors: ____
- [ ] **V-04**: Open POS page in browser — verify basic functionality works:
  - [ ] Product search returns results
  - [ ] Add to cart works
  - [ ] Quantity adjustment works
  - [ ] Cart total calculates correctly
  - [ ] Payment dialog opens
  - [ ] Can complete a test transaction (online)
  - [ ] Receipt displays correctly
  - [ ] Print button triggers (even if blocked by popup blocker currently)
- [ ] **V-05**: Test barcode scanning (or manual barcode/SKU entry via Enter key)
- [ ] **V-06**: Test offline mode (disconnect network, complete transaction, verify OFF- invoice)
- [ ] **V-07**: Test sync (reconnect, verify auto-sync triggers)
- [ ] **V-08**: Test hold/resume pending transaction
- [ ] **V-09**: Verify `bun run test:invariant` passes: 61 PASS / 0 FAIL / 1 WARN

### Post-Modularization Verification

- [ ] **V-10**: pos-page.tsx line count < 400 (orchestrator only)
- [ ] **V-11**: No individual hook file > 350 lines
- [ ] **V-12**: No individual component file > 350 lines
- [ ] **V-13**: `bun run lint` passes with 0 new errors
- [ ] **V-14**: All V-04 tests still pass (regression check)
- [ ] **V-15**: useState count distributed across hooks (no single hook > 10 states)

### Post-Bug-Fix Verification

- [ ] **V-16**: BUG-01 — Receipt print works in Chrome (popup blocker no longer blocks)
- [ ] **V-17**: BUG-02 — When sync fails, local stock reverts to pre-checkout value
- [ ] **V-18**: BUG-03 — Fast typing (>80wpm) does not falsely trigger barcode mode
- [ ] **V-19**: BUG-04 — Rapidly clicking sync while auto-sync running does not cause double-sync
- [ ] **V-20**: `bun run test:invariant` still passes: 61 PASS / 0 FAIL / 1 WARN

### Post-UX Verification

- [ ] **V-21**: Responsive layout works on mobile (<640px), tablet (640-1024px), desktop (>1024px)
- [ ] **V-22**: All user-facing text is Indonesian (no English strings visible to user)
- [ ] **V-23**: Loading states shown during async operations (no frozen UI)
- [ ] **V-24**: Error states actionable (not just toast — recovery option where possible)
- [ ] **V-25**: Empty states shown when appropriate (no blank screens)
- [ ] **V-26**: Keyboard navigation works (Tab order logical, Enter activates buttons)
- [ ] **V-27**: Touch targets ≥44px on mobile interactive elements
- [ ] **V-28**: Sticky footer works correctly (pushed down on long content, fixed on short)

### Continuous Verification (Every Commit)

- [ ] **V-C1**: `bun run lint` passes
- [ ] **V-C2**: Dev server starts without errors (`bun run dev`)
- [ ] **V-C3**: POS page loads without console errors
- [ ] **V-C4**: `bun run test:invariant` passes (engine integrity)

---

## 7. ONLINE VS OFFLINE LIFECYCLE COMPATIBILITY

### Critical Insight for Redesign

> **"Jangan otomatis memasukkan useMutation() ke POS hanya karena primitive itu sudah dibuat."**

The standard TanStack Query `useMutation()` assumes this lifecycle:

```
mutate(variables) → API call → cache invalidate → onSuccess/onError
```

But POS checkout requires this lifecycle:

```
PREPARE (build payload, validate)
  ↓
COMMIT (write to IndexedDB → THIS is the real commit)
  ↓
INVALIDATE (decrement local stock)
  ↓
SYNC CONDITIONAL (if online → POST /api/transactions/sync)
  ↓
REFRESH (update IndexedDB row with server response)
  ↓
FEEDBACK (UI: receipt dialog, toast, clear cart)
```

### Compatibility Matrix

| Hook/Mutation | Standard useMutation? | Custom Wrapper Needed? | Notes |
|---------------|----------------------|----------------------|-------|
| **Checkout** | ❌ NO | ✅ YES — `usePosCheckout()` or `useOfflineMutation()` | COMMIT happens before API; API is conditional |
| **Sync (batch)** | ❌ NO | ✅ YES — Same offline-first pattern | Has dedup, retry, partial failure |
| **Hold transaction** | ⚠️ PARTIAL | Could wrap with callbacks | Purely local but has side-effects |
| **Resume pending** | ❌ NO | ✅ YES — Multi-step local mutation | May auto-hold current cart |
| **Add customer** | ✅ YES | No wrapper needed | Simple POST, response = entity |
| **Calculate promo** | ✅ YES | No wrapper needed | Derivation, no side effects |
| **Delete pending tx** | ✅ YES | No wrapper needed | Simple local deletion |

### Recommendation

Build **domain-specific hooks** that encapsulate the full lifecycle:

```typescript
// For standard HTTP mutations (customer add, promo calc):
const addCustomer = useMutation({
  mutationFn: (data) => fetch('/api/customers', { method: 'POST', body: data }),
  onSuccess: () => { /* refresh customers */ }
})

// For offline-first mutations (checkout, sync):
const { checkout, isCheckingOut, checkoutResult } = usePosCheckout({
  onSuccess: (result) => { /* open receipt */ },
  onError: (error) => { /* show offline saved */ }
})

// usePosCheckout internally manages:
// 1. PREPARE → validate cart, build payload
// 2. COMMIT → localDB.transactions.add()
// 3. INVALIDATE → localDB.products.modify(decrement stock)
// 4. SYNC → conditional POST /api/transactions/sync
// 5. REFRESH → update localDB row with result
// 6. FEEDBACK → setCheckoutResult, callbacks
```

---

## 8. IMPLEMENTATION ROADMAP

### Phase 1A — Foundation (Week 1)

```
Day 1-2: Modularize pos-page.tsx
  ├─ Create hooks/ directory structure
  ├─ Extract usePosCart() (T3)
  ├─ Extract usePosSettings() (extract settings fetch first — removes duplication)
  └─ Verify: lint passes, POS loads, basic cart works

Day 3: Continue extraction
  ├─ Extract usePosProducts() 
  ├─ Extract usePosCustomers()
  ├─ Extract usePosCheckout()
  └─ Extract usePosSync()

Day 4: Component extraction
  ├─ Extract ProductBrowser (DRY 3 layouts)
  ├─ Extract CartItemList + CartItemRow
  ├─ Extract CustomerSelector
  └─ Extract SyncStatusBar

Day 5: Integration & verification
  ├─ Full regression test (V-04 checklist)
  ├─ Fix any integration issues
  └─ Document final architecture
```

### Phase 1B — Bug Fixes (Week 1-2, can parallelize with 1A after Day 2)

```
Day 3: BUG-01 — Receipt print fix (iframe approach)
Day 4: BUG-03 — Barcode detection improvement  
Day 5: BUG-02 — Stock reconciliation on sync failure
Day 5: BUG-04 — Sync race condition unification
```

### Phase 1C — Core UX (Week 2-3, after 1A complete)

```
Week 2:
  ├─ T8: Extract OfflinePanel
  ├─ T11: Unify sync logic
  ├─ T12: Cart sessionStorage persistence
  └─ T13: Keyboard shortcuts

Week 3:
  ├─ T15: Skeleton loading states
  ├─ T16: Empty state designs
  ├─ T17: Indonesian language audit
  └─ T18: HPP warning debouncing
```

### Phase 1D — Polish (Week 3-4)

```
Week 3-4:
  ├─ T14: Exponential backoff for sync
  ├─ Mobile UX pass (touch targets, scroll behavior)
  ├─ Accessibility pass (ARIA labels, screen reader)
  └─ Performance review (React DevTools, unnecessary re-renders)
```

---

## 9. RISK REGISTER

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Modularization introduces regressions | Medium | High | Incremental extraction; verify after each hook extraction |
| State hook coupling (hooks depend on each other) | Medium | Medium | Design clean interfaces between hooks; lift shared state up |
| Offline-first pattern misunderstood by future devs | Medium | High | Clear documentation in each hook; comments explaining lifecycle |
| Cart sessionStorage causes stale cart issues | Low | Medium | Add expiry timestamp; clear on successful checkout |
| Barcode fix breaks existing scanner setups | Low | High | Make threshold configurable; test with multiple scanners |
| Sync stock reconciliation causes flicker | Low | Medium | Optimistic UI with rollback animation |

---

## 10. SIGN-OFF

### Audit Completion Checklist

- [ ] **AUDIT-01**: All 10 execution flows traced end-to-end ✅
- [ ] **AUDIT-02**: All 26 mutation surfaces mapped ✅
- [ ] **AUDIT-03**: Engine-cockpit boundary verified CLEAN ✅
- [ ] **AUDIT-04**: All 49 useState classified ✅
- [ ] **AUDIT-05**: 6 confirmed bugs documented ✅
- [ ] **AUDIT-06**: 17 cockpit redesign targets identified ✅
- [ ] **AUDIT-07**: 10 enhancements catalogued ✅
- [ ] **AUDIT-08**: Online/offline lifecycle compatibility analyzed ✅
- [ ] **AUDIT-09**: Forbidden list validated against Architecture Lock ✅
- [ ] **AUDIT-10**: Preserve list captures all working business logic ✅

### Approval Gate

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│   PHASE 1 POS AUDIT: ✅ COMPLETE                                 │
│   PHASE 1 POS SCOPE: ✅ APPROVED v1.0                            │
│                                                                  │
│   Approver: Project Owner   Date: 2026-01-29                     │
│                                                                  │
│   Status: ✅ APPROVED — READY FOR PHASE 1A IMPLEMENTATION        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. APPROVAL DECISION & BUG-02 BOUNDARY AUDIT

### Approval Verdict

```
✅ POS SCOPE v1.0 — APPROVED WITH CONDITION SATISFIED

Condition: BUG-02 must be classified as local-reconciliation (A) or engine-mutation (B)
         before implementation.

Classification Result: ✅ CATEGORY A — LOCAL RECONCILIATION
                        → SAFE FOR PHASE 1 IMPLEMENTATION
```

### BUG-02 Boundary Audit (DEFINITIVE)

**Bug:** Local stock decrement NOT rolled back on sync failure (`pos-page.tsx:1405-1421` vs `1450-1461`)

**Execution Flow Analysis:**

```
STEP 1: localDB.transactions.add()          → IndexedDB write     (COCKPIT ✅)
STEP 2: localDB.products.modify(decrement) → IndexedDB write     (COCKPIT ✅) ← BUG HERE
STEP 3: POST /api/transactions/sync        → API call            (COCKPIT ✅)
        ├─ Success → update localDB row       → IndexedDB write     (COCKPIT ✅)
        └─ Error/Fail → generate OFF-invoice  → State update only  (COCKPIT ✅)
                   ❌ NO ROLLBACK OF STEP 2    ← THE BUG
```

**Boundary Classification Table:**

| Check | Result | Evidence |
|-------|--------|----------|
| Does fix modify `InventoryConsumptionService`? | ❌ NO | Fix stays in pos-page.tsx |
| Does fix modify `FEFOEngine`? | ❌ NO | No batch engine involvement |
| Does fix modify any server route? | ❌ NO | Purely client-side |
| Does fix modify Prisma schema? | ❌ NO | No schema change |
| Does fix touch `TransactionConsumption`? | ❌ No | Server-side only |
| Does fix touch `BatchConsumptionLog`? | ❌ No | Server-side only |
| What DOES it modify? | `pos-page.tsx` only | Cockpit layer |
| What operations? | `localDB.products.modify()` | IndexedDB/in-memory cache |
| What "stock" is manipulated? | `CachedProduct.stock` | Local cache, NOT authoritative `InventoryItem.stock` |

**Key Insight:**

The "stock" being decremented at line 1405-1421 is **NOT** the authoritative PostgreSQL `InventoryItem.stock`. It is the **local cached copy** inside `localDB.products` — a NoopTable/Dexie cache that:
- Lives in browser memory (or IndexedDB when available)
- Gets refreshed from server on `syncAllData()` calls
- Is a **shadow copy** for offline UX purposes

The fix adds a rollback step that re-adds to this local cache what was subtracted, keeping it consistent with server reality (where transaction was rejected, no stock deduction occurred).

**Verdict: ✅ CATEGORY A — LOCAL RECONCILIATION BUG**

> BUG-02 is **100% cockpit-layer code**. No engine involvement whatsoever.
> **Approved for Phase 1 implementation alongside other cockpit bugs.**

### Approved Scope Summary

**✅ APPROVED FOR PHASE 1:**

| Category | Items | Effort |
|----------|-------|--------|
| 🟢 Modularization | pos-page.tsx split → orchestrator + 6 hooks + 8 components + 3 layouts | 3-4 days |
| 🟢 UX Improvements | Offline panel, cart persistence, keyboard shortcuts, skeleton loading, empty states, mobile UX, accessibility, performance | 1-2 weeks |
| 🟢 Cockpit Bugs (safe) | BUG-01 print, BUG-02 stock rollback*, BUG-03 barcode, BUG-04 sync race, BUG-05 useEffect dep, BUG-06 pending confirm | 2-3 days |
| 🟢 Code Quality | Settings dedup, sync dedup, checkout decomposition | 1-2 days |

*BUG-02 classified as Category A (local reconciliation) — safe for Phase 1*

**🚫 EXPLICITLY FORBIDDEN (unchanged from Architecture Lock):**

- `InventoryConsumptionService` — any modification
- `FEFOEngine` — any modification
- Server-side stock deduction SQL — any modification
- Void restoration pipeline — any modification
- TransactionConsumption schema/logic — any modification

### Mutation Contract Compliance

**Confirmed Architecture Decision:**

> Mutation Contract v1.0 is an **invariant** (what must happen), not an **implementation mandate** (which hook to use).

| Domain | Lifecycle | Hook | Rationale |
|--------|-----------|------|----------|
| **POS Checkout/Sync** | PREPARE→LOCAL COMMIT→LOCAL UI→QUEUE SYNC→SYNC/RECONCILE→FEEDBACK | `usePosCheckout()` custom hook | COMMIT ≠ server success; offline-first pattern |
| **Standard HTTP** (customer add, promo calc, settings refresh) | PREPARE→COMMIT API→INVALIDATE→REFRESH→FEEDBACK | `useMutation()` TanStack Query | Simple request-response pattern |

Both hooks **satisfy** Mutation Contract v1.0 phases — they just implement them differently based on domain requirements.

### Execution Order (LOCKED)

```
Phase 1A: MODULARIZATION (Foundation)
    ↓ Verify baseline (V-01 to V-09)
Phase 1B: SAFE BUG FIXES (Cockpit-only bugs)
    ↓ Verify regression (V-14 to V-20)
Phase 1C: CORE UX IMPROVEMENTS
    ↓ Verify UX (V-21 to V-28)
Phase 1D: POLISH & ENHANCEMENT
    ↓ Final verification (all checklists)
```

**Rule: Each phase gate requires passing verification checklist before proceeding to next phase.**

---

**Document Version**: v1.0-APPROVED
**Last Updated**: 2026-01-29 (Approval + BUG-02 boundary audit)
**Next Update**: Phase 1A completion report
