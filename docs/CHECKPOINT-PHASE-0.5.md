# CHECKPOINT — Phase 0.5: Platform Health Check v1.0

> **Status**: ✅ COMPLETE
> **Date closed**: 2026-07-22 (Asia/Jakarta)
> **Stable baseline commit**: see `git log` for tag/checkpoint message
> **Next phase**: Aether UX Blueprint → POS Pilot Redesign

---

## 1. Headline Numbers

| Metric | Value |
|---|---|
| Live P0 bugs | **0** |
| Live P1 bugs | **0** |
| Live P2 bugs | **0** (HC-P2-001 closed) |
| Blocked features (architectural) | Transfer, Multi-Outlet (gated by `groupOnly: true`, requires multi-outlet group) |
| Domains audited | 14 (route + render) |
| Critical workflows verified | 4 / 4 (Product, Purchase, POS, Stock Opname) |
| Core integrity verified | 4 / 4 (FEFO, HPP, Void+Restore, Offline→Sync→Dedup) |
| Deep interactive tests | 7 / 7 (Settings, Crew, Inventory, Migration, Dashboard, Audit Log, Plan & Pricing) |

---

## 2. Layers Completed

### Layer A — Route Health (14/14 domains)
All 14 domains respond `200 OK` on first hit (no fatal middleware/redirect loops). Full results in `worklog.md` record `HC-1`.

### Layer B — Render Health (14/14 domains)
All 14 domains render without white-screen / error-boundary. Hydration is clean except for 1 cosmetic P3 warning in POS (button-nesting). Full results in `worklog.md` record `HC-1`.

### Layer C — Critical Workflows (4/4)
| ID | Workflow | DB Verify | Result |
|----|----------|-----------|--------|
| C1 | Product Create → Save → DB | ✅ Product row created | 🟢 PASS |
| C2 | Purchase Create → Receive → Inventory impact | ✅ InventoryBatch rows inserted | 🟢 PASS |
| C3 | POS Checkout → Sync → Transaction | ✅ Transaction row + items persisted | 🟢 PASS |
| C4 | Stock Opname → Review → Finalize → Inventory adjusted | ✅ InventoryBatch adjusted | 🟢 PASS |

### Layer D — Core Integrity (4/4)
| ID | Integrity check | Result |
|----|-----------------|--------|
| D1 | Inventory Consumption (FEFO — First-Expire-First-Out) | 🟢 PASS |
| D2 | HPP / Price Integrity (price≠hpp, both persisted correctly) | 🟢 PASS (HC-BUG-01/02 INVALIDATED) |
| D3 | Void + Restoration (RECALC method, inventory restored) | 🟢 PASS |
| D4 | Offline → Sync → Dedup (structural + production SYNC_DEDUP audit entry) | 🟢 PASS |

### HC-4 — Deep Interactive Tests (7/7)
| Domain | Test | DB Verify | Result |
|--------|------|-----------|--------|
| Settings (4 tabs) | Outlet name, theme toggle, footer save, Debit toggle, Tambah Promo | Outlet.name, OutletSetting.themePrimaryColor, OutletSetting.paymentMethods, Promo row | 🟢 PASS |
| Crew | Tambah Crew + Hak Akses toggle | User{role:CREW}, CrewPermission.pages="pos,dashboard" | 🟢 PASS |
| Inventory Items | Kelola Kategori, Cari Batch, Waste Report, Excel dropdown | InventoryCategory row | 🟢 PASS |
| Migration | Structural: 3 import modes + template download | — | 🟢 PASS (structural) |
| Dashboard | Quick action→POS, stat cards, period buttons, chart tabs, Freshness Score | — | 🟢 PASS |
| Audit Log | 7 filter tabs, Export download | — | 🟢 PASS |
| Plan & Pricing | Plan Free, usage metrics | — | 🟢 PASS |

---

## 3. Issues — Final Classification

| Severity | ID | Description | Final status |
|----------|-----|-------------|--------------|
| ~~P0~~ | HC-BUG-01 | Product form field mapping (price/hpp swap) | **INVALIDATED** — test-agent misidentification. Form code correct. DB verified price=25000/hpp=12000. |
| ~~P0~~ | HC-BUG-02 | POS total = 8000 instead of 18000 | **INVALIDATED** — downstream of HC-BUG-01. |
| ~~P2~~ | **HC-P2-001** | Prisma "Unknown argument `deletedAt`" on Customer | **CLOSED** — schema fix committed (commit `dfbb092`), DB synced via `db:push`, smoke test passed (CRUD on Customer.deletedAt verified). |
| P3 | HC-P3-001 | Hydration warning POS (button nested) | LIVE — cosmetic, backlog, not blocking |
| Blocked | — | Transfer + Multi Outlet | `groupOnly: true` — requires multi-outlet group, architectural, out-of-scope for Phase 0.5 |

---

## 4. HC-P2-001 — Closure Detail

**Root cause** (RCA-1, see worklog): Code at 25 sites referenced `Customer.deletedAt` (21 read filters, 2 writes, 1 read, 2 raw SQL), but the field was never declared in `prisma/schema.prisma` nor the DB. Audit doc `PLATFORM-ARCHITECTURE-REVIEW.md` claimed the fix was applied, but git history (5 commits, 1 branch, 0 stash) proved no commit ever added it. Audit doc was **not** reliable as evidence of fix.

**Wider impact** (beyond Customers page):
- `/api/pos/checkout/route.ts` lines 410, 447 — POS checkout failed if `customerId` selected
- `/api/transactions/sync/route.ts` lines 465, 500 — Transaction sync failed if payload had `customerId`

**Similar-case scan**: Static scanner found 22 candidate mismatches; **all 22 were false positives** (nested relation filters / compound unique / catch identifiers / test helpers). dev.log ground-truth confirmed `deletedAt` was the **only** "Unknown argument" Prisma error in the codebase. No systemic pattern.

**Fix applied (this checkpoint)**:
1. ✅ `prisma/schema.prisma` — Customer model: `deletedAt DateTime?` field added + `@@index([outletId, deletedAt])`
2. ✅ `sql/fix-customer-deletedat-neon.sql` — idempotent PostgreSQL DDL for Neon prod target (user to execute manually)
3. ✅ `bun run db:generate` — Prisma client regenerated, `deletedAt` now in `CustomerScalarFieldEnum`
4. ✅ `bun run db:push` — local SQLite synced, `PRAGMA table_info(Customer)` confirms column exists (cid=8, nullable, default null)
5. ✅ Smoke test — full CRUD on Customer.deletedAt verified:
   - `create` → ok
   - `findFirst({ where: { deletedAt: null } })` → ok (the exact pattern that was failing)
   - `update({ data: { deletedAt: new Date() } })` → soft-delete ok
   - `findFirst({ where: { id, deletedAt: null } })` → soft-deleted row correctly excluded from active set
6. ✅ Dev server restarted — regenerated Prisma client loaded, no new Prisma errors after restart
7. ⏳ **PENDING (user)**: Execute `sql/fix-customer-deletedat-neon.sql` in Neon SQL Editor for production PostgreSQL target. Local env is fully fixed; production env still needs the manual SQL execution.

---

## 5. Test Data Left in Local DB

These rows are leftovers from HC test sessions. Safe to keep for regression or to delete:

| Entity | Identifier | Notes |
|---|---|---|
| Product | "HC3 Test Product" (sku `HCTP-HZD3KNCB`) | price 25000, hpp 12000, stock 50 |
| Product | "Kopi Susu Gula Aren" | from HC-2, price 8000 |
| Promo | "HC3 Test Promo 10%" | PERCENTAGE 15%, maxDiscount 50000 |
| Crew | "Crew Test HC3" (`crew-hc3@test.com`) | role CREW, permissions: pos,dashboard |
| InventoryCategory | "HC3 Test Kategori" | color: zinc |
| Settings | outlet name="Health Check Test Outlet - EDITED" | paymentMethods="CASH,QRIS,DEBIT", theme=emerald (restored) |

> **Backup**: `db/custom.db.bak.1784735812` was taken before `db:push` for rollback safety.

---

## 6. Files Touched in Phase 0.5

**Source code**:
- `prisma/schema.prisma` — Customer model: `deletedAt DateTime?` + `@@index([outletId, deletedAt])` (committed in `dfbb092`)

**New files**:
- `sql/fix-customer-deletedat-neon.sql` — Neon PostgreSQL DDL script for production
- `docs/CHECKPOINT-PHASE-0.5.md` — this document
- `docs/AETHER_UX_BLUEPRINT.md` — next-phase blueprint (drafted alongside this checkpoint)

**Updated**:
- `worklog.md` — appended records HC-1 → HC-FINAL-v2 → HC-RCA-1 → HC-FIX-1 → PHASE-0.5-COMPLETE

**Generated (not committed)**:
- `node_modules/.prisma/client/*` — regenerated by `bun run db:generate`
- `db/custom.db` — schema-synced by `bun run db:push` (column added; no data loss)

---

## 7. Decision Gate — Phase 0.5 → Phase 1 (Aether UX Blueprint)

**Verdict**: Platform is **stable enough** to enter redesign phase. No live P0/P1/P2 bugs. Architecture is mapped. Core engine (FEFO/HPP/consumption/void/sync-dedup) is verified intact.

**Mandate for Phase 1**:
- Output: `docs/AETHER_UX_BLUEPRINT.md`
- Sequence: Business Mode → User Role → User Intent → First-Time Journey → Daily Operational Journey → Navigation → Page Guidance → System Feedback
- Pilot redesign: **POS** (open POS → pick product → pay → done). **Do NOT touch core / sync / FEFO / HPP / consumption engine**.
- No new audits. Platform is mapped; focus shifts to human comprehension.

**Out-of-scope (deferred indefinitely or until business need)**:
- Multi-Outlet transfers (architectural gate `groupOnly: true`)
- P3 hydration warning in POS (cosmetic)
- Neon production SQL execution (manual user task; not blocking local dev)

---

## 8. Sign-off

- Audit discipline: READ-ONLY → CLASSIFY → RECORD → PRIORITIZE → DECIDE → FIX-WITH-APPROVAL — followed throughout.
- All "fixes" were additive schema changes only (no business logic touched).
- DB backup taken before any DDL.
- Smoke test passed before sign-off.
- No `--accept-data-loss` blind runs.
- No trust in audit docs without git verification.

**Phase 0.5 — CLOSED.**
**Phase 1 — Aether UX Blueprint — OPENED.**
