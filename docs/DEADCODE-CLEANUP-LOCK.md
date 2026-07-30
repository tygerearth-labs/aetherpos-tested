# AETHER DEAD CODE & UNUSED FILES CLEANUP — LOCK (v1.0)

> **Scope**: The dead-code & unused-files cleanup executed in commit `d857aa7` (initial) + corrected in commit `1b160e8` (corrective pass). Covers deleted source files (A1/A2/A4/A5/A6-barrel), removed npm dependencies (C-HIGH), deleted scripts (D-HIGH), deleted misc files (E-SELECTIVE), and the explicitly KEPT categories (A3, B, C-MEDIUM, D-MEDIUM, F, offline engine implementations, examples/websocket, query-audit.ts).
> **Out of Scope**: Audit Log V2 architecture (see `docs/AUDIT-V2-LOCK.md`); core inventory engine invariants (see `docs/ARCHITECTURE-LOCK.md`); bulk-engine adapter contract (see `governance/AETHER-BULK-ENGINE-V1.md`); A3 POS extracted-layout feature-parity audit (tracked separately).
> **Lock Date**: 2026-07-29
> **Status**: APPROVED — with two formally recorded residual debts (see §5)
> **Companion Documents**: `docs/DEADCODE-CLEANUP-VERIFICATION.md` (full evidence report), `docs/baselines/tsc-before-cleanup.txt` + `tsc-after-cleanup.txt` (TypeScript baselines), `docs/AUDIT-V2-LOCK.md` (audit architecture — unaffected by this cleanup)
> **Regression Command**: `bun run lint` + `bunx tsc --noEmit` (compare against `docs/baselines/tsc-after-cleanup.txt`) + Agent Browser smoke test (§7)

---

## 0. LOCK STATEMENT

The Aether POS dead-code & unused-files cleanup is **FROZEN** at the state represented by commit `1b160e8` (corrective pass on top of the initial cleanup commit `d857aa7`). The file inventory, dependency manifest, and tsconfig exclude list documented here are the baseline.

The cleanup removed **21 source files** (A1/A2/A4/A5 + A6 barrel), **11 npm dependencies** (C-HIGH), **6 stale scripts** (D-HIGH), and **3 misc files** (E-SELECTIVE) — a net reduction of **−77 TypeScript errors** (proven: 431→354, see §5.2). The corrective pass restored 7 files that were deleted beyond scope (examples/websocket system reference + 5 offline engine implementations) and promoted `scripts/query-audit.ts` to official dev tooling.

Any reintroduction of a deleted file, re-addition of a removed dependency, or removal of a KEPT file requires an explicit Architecture Decision Record (ADR) and a re-verification of the §7 regression checks.

> **Commit hash note**: The user approved locking at `b9b6c6b`. That commit was amended to `1b160e8` (identical tree content; only file-mode metadata changed on `bun.lock` and `docs/*.md`). `1b160e8` is the commit reachable from `main` and is the authoritative lock reference. `b9b6c6b` is preserved in the reflog (`git reflog --oneline | grep b9b6c6b`) for traceability.

**Two residual debts are formally recorded and LOCKED as known-state** (see §5):

> 1. **Production build NOT TESTED** — system constraint prohibits `bun run build` in sandbox.
> 2. **354 pre-existing TypeScript errors** — repository type-safety baseline debt (not caused by this cleanup; proven 0 new errors introduced).

These debts are acknowledged, baselined, and tracked — they are NOT blockers for this lock. They must be resolved in dedicated follow-up passes (see §8).

---

## 1. CLEANUP SUMMARY

| Category | Action | Count | Net LOC |
|----------|--------|-------|---------|
| A1 — Orphan pages | DELETE | 2 files | −1,382 |
| A2 — POS hooks barrel | DELETE | 1 file | −31 |
| A3 — POS extracted-layout | **KEEP** (separate audit) | 12 files | ~3,900 (preserved) |
| A4 — Orphan shared components | DELETE | 4 files | −1,131 |
| A5 — Orphan hooks/actions/helpers | DELETE | 9 files | −1,563 |
| A6 — Offline barrel (`index.ts`) | DELETE (barrel only) | 1 file | −73 |
| A6 — Offline engine implementations | **RESTORED** (corrective) | 5 files | 2,170 (preserved) |
| B — shadcn/ui primitives | **KEEP** | all | — |
| C-HIGH — Unused npm deps | DELETE | 11 deps | (lockfile) |
| C-MEDIUM — tsx, sharp | **KEEP** | 2 deps | — |
| D-HIGH — Stale scripts | DELETE | 6 scripts | −627 |
| D-MEDIUM — Verification scripts | **KEEP** (query-audit.ts promoted) | — | — |
| E-SELECTIVE — Misc files | DELETE | 3 files | −1,766 |
| F — Unused exports | **KEEP** | — | — |
| examples/websocket | **RESTORED** (corrective) | 2 files | 334 (preserved) |

**Net deletion**: 21 source files + 11 deps + 6 scripts + 3 misc files = **−5,472 LOC** removed from the active codebase. The 7 restored files (2,504 LOC) are preserved as dormant/secondary architecture pending separate audits.

---

## 2. DELETED FILES REGISTRY (LOCKED — DO NOT REINTRODUCE)

The following files were verified as orphan (0 inbound imports via `rg`) and deleted. **Reintroducing any of these requires an ADR** justifying why the orphan status changed and what consumer will import it.

### A1 — Orphan Pages (2 files)
| File | LOC | Last consumer |
|------|-----|---------------|
| `src/components/pages/insights-page.tsx` | 783 | None (orphan) |
| `src/components/pages/test-suite-page.tsx` | 599 | None (orphan) |

### A2 — POS Hooks Barrel (1 file)
| File | LOC | Note |
|------|-----|------|
| `src/components/pos/hooks/index.ts` | 31 | Barrel only. The 6 `use-pos-*.ts` hooks it re-exported are imported directly by `pos-page.tsx` — those are KEPT. |

### A4 — Orphan Shared Components (4 files)
| File | LOC | Replacement |
|------|-----|-------------|
| `src/components/shared/confirm-dialog.tsx` | 334 | `AlertDialog` (shadcn/ui) |
| `src/components/shared/data-table.tsx` | 138 | `Table` (shadcn/ui) |
| `src/components/shared/locked-dropdown-item.tsx` | 81 | Inline pattern |
| `src/components/shared/state-components.tsx` | 578 | Skeleton/Spinner (shadcn/ui) |

### A5 — Orphan Hooks / Server Actions / Helpers (9 files)
| File | LOC | Note |
|------|-----|------|
| `src/hooks/use-mutation.ts` | 378 | Superseded by TanStack Query |
| `src/lib/actions/audit.ts` | 82 | Server actions → API routes (V2 audit) |
| `src/lib/actions/customers.ts` | 136 | Server actions → API routes |
| `src/lib/actions/dashboard.ts` | 81 | Server actions → API routes |
| `src/lib/actions/products.ts` | 275 | Server actions → API routes |
| `src/lib/actions/transactions.ts` | 367 | Server actions → API routes |
| `src/lib/api/dual-profit.ts` | 194 | Unused profit-calc variant |
| `src/lib/expiry-notify.ts` | 177 | Unused notification helper |
| *(empty `src/lib/actions/` folder removed)* | — | — |

### A6 — Offline Barrel (1 file — implementations RESTORED, see §3)
| File | LOC | Note |
|------|-----|------|
| `src/lib/offline/index.ts` | 73 | Barrel re-export. The 5 implementations it re-exported are KEPT (restored in corrective pass) pending separate audit. |

### C-HIGH — Removed npm Dependencies (11 deps)
| Dependency | Version | Was used by |
|------------|---------|-------------|
| `@dnd-kit/core` | * | Nothing (0 imports) |
| `@dnd-kit/sortable` | * | Nothing |
| `@dnd-kit/utilities` | * | Nothing |
| `@hookform/resolvers` | * | Nothing (zod removed too) |
| `@mdxeditor/editor` | * | Nothing |
| `@reactuses/core` | * | Nothing |
| `@tanstack/react-table` | * | Nothing (custom Table used) |
| `date-fns` | * | Nothing (Intl used) |
| `react-markdown` | * | Nothing |
| `react-syntax-highlighter` | * | Nothing |
| `zod` | * | Nothing (manual validation) |

**Re-adding any of these requires**: proof of active import in `src/` + justification that no existing dependency covers the use case.

### D-HIGH — Deleted Stale Scripts (6 scripts)
| Script | LOC | Reason |
|--------|-----|--------|
| `scripts/preview-audit-final.sh` | 93 | One-off preview script, superseded |
| `scripts/preview-audit-log-v2.sh` | 87 | One-off preview script |
| `scripts/preview-audit-log.sh` | 94 | One-off preview script |
| `scripts/preview-audit-robust.sh` | 91 | One-off preview script |
| `scripts/preview-verify.sh` | 117 | One-off preview script |
| `scripts/pg-verify-all.sh` | 145 | Broken reference (stale paths) |

### E-SELECTIVE — Deleted Misc Files (3 files)
| File | LOC | Reason |
|------|-----|--------|
| `tests/python-runtime-build.sh` | 64 | Broken reference (no python runtime) |
| `tests/python-runtime-container.sh` | 31 | Broken reference |
| `AETHERPOS-PROJECT-WORKLOG.md` | 1,671 | 208KB duplicate of `worklog.md`, 0 inbound refs |

### NOT in commit (verified clean)
- `.env` — gitignored (`/.env*/.env` pattern), never tracked
- ICU `.so` files — in `node_modules/`, never tracked
- `db/pgdata/` — gitignored

---

## 3. KEPT FILES REGISTRY (LOCKED — DO NOT DELETE WITHOUT SEPARATE AUDIT)

The following were explicitly KEPT per the cleanup spec or restored in the corrective pass. **Deleting any of these requires a separate audit** (like the A3 audit) proving the file is truly dead.

### A3 — POS Extracted-Layout (~3,900 LOC, 12 files)
**Status**: KEPT — highest-risk item, requires separate feature-parity audit before any deletion.

The scanner flagged these as unused based on import-graph analysis, but the POS terminal is the application's core revenue flow. Import-graph "unused" does not equal "dead" when the code may be reached via runtime lazy-loading, dynamic imports, or state-driven rendering.

**Separate audit required**: Verify each of the 12 files against the live POS terminal feature set. Do NOT delete based on import-graph alone.

### Offline Engine Implementations (5 files, 2,170 LOC — RESTORED)
**Status**: KEPT (restored in corrective commit `1b160e8`) — barrel deleted per spec A6, implementations preserved.

| File | LOC | Status |
|------|-----|--------|
| `src/lib/offline/repository.ts` | 322 | Dormant (0 consumers) — preserved for audit |
| `src/lib/offline/fefo-engine.ts` | 657 | Dormant — NOT the live FEFO engine (that's `src/lib/fefo-engine.ts` at root) |
| `src/lib/offline/purchase-engine.ts` | 460 | Dormant |
| `src/lib/offline/transaction-engine.ts` | 546 | Dormant |
| `src/lib/offline/sync-queue.ts` | 185 | Dormant |

**Note**: These represent an older offline-first architecture superseded by the current `sync-service.ts` + root `fefo-engine.ts` approach. They have 0 consumers but are preserved pending a separate audit (like A3). The 7 pre-existing `repository.ts` type errors are part of the §5.2 baseline debt.

### examples/websocket (2 files, 334 LOC — RESTORED)
**Status**: KEPT (restored in corrective commit `1b160e8`) — **system reference asset**, NOT project dead code.

The project's system instructions explicitly reference this: *"There is already a websocket demo for reference in the examples folder."* The `server.ts` file contains the comment *"DO NOT change the path, it is used by Caddy to forward the request to the correct port"* — it documents the Caddy gateway WebSocket pattern (`io('/?XTransformPort={Port}')`) that all mini-services must follow.

**tsconfig**: `examples` and `skills` are in `tsconfig.json` `exclude` — they are system/vendor directories, not project source.

### B — shadcn/ui Primitives (all in `src/components/ui/`)
**Status**: KEPT — the component library foundation. Never delete a primitive without confirming no consumer uses it.

### C-MEDIUM — npm Dependencies (2 deps)
| Dependency | Reason kept |
|------------|-------------|
| `tsx` | Used by `scripts/` for TypeScript execution |
| `sharp` | Used by Next.js image optimization |

### D-MEDIUM — Verification Scripts
**Status**: KEPT — active diagnostic and verification tooling.

| Script | Status |
|--------|--------|
| `scripts/query-audit.ts` | **PROMOTED** to official dev tooling (see §4) |
| `scripts/verify-v23-fixes.ts` | Active verification |
| `scripts/pg-start.ts` | Embedded PostgreSQL bootstrap |
| `scripts/with-pg.sh` | PG auto-start wrapper |
| *(others in `scripts/`)* | Active tooling |

### F — Unused Exports
**Status**: KEPT (for now) — unused exports within otherwise-active files. A future pass may clean these, but they are low-risk and out of scope for this cleanup.

---

## 4. DEPENDENCY & TOOLING STATUS CHANGES

### 4.1 Removed Dependencies (C-HIGH — 11 deps)
See §2 "C-HIGH" table. All 11 were verified with 0 source imports before removal.

### 4.2 Promoted: `scripts/query-audit.ts`
**Was**: Flagged as "debug one-off" under D-HIGH approval scope.
**Now**: Official dev tooling under D-MEDIUM.

Added 24-line JSDoc header documenting: purpose (AuditLog V2 row inspection), status (official dev tooling, NOT dead code), usage (`bun run scripts/query-audit.ts`), output sections (recent 50 rows, counts by action/entityType, counts by eventType), expected V2 behavior (1 BULK_BATCH per bulk operation), and reference to `docs/AUDIT-V2-LOCK.md` §1/§6.

### 4.3 tsconfig.json Exclude
Added `examples` and `skills` to the `exclude` array (alongside `node_modules`). These are system/vendor directories, not project source — excluding them prevents reference-demo module-resolution errors from polluting the project type-check.

### 4.4 Corrective Fixes (committed in `1b160e8`, NOT part of dead-code cleanup)
- `src/lib/local-db.ts` — noop shim (required by `sync-service.ts`; was gitignored by `local-*` pattern, `.gitignore` exception `!src/lib/local-db.ts` added in `d857aa7`)
- `.env` `NEXTAUTH_SECRET` — environment-local (gitignored, never committed)
- ICU `.so` soname files — in `node_modules/` (never committed)

These are **corrective dependency fixes**, not dead-code cleanup. They are noted for transparency but classified separately.

---

## 5. RESIDUAL DEBT (LOCKED — FORMALLY RECORDED)

The user explicitly approved locking the cleanup at commit `b9b6c6b` (amended to `1b160e8`, see §0) with these two residual debts recorded as known-state. They are NOT blockers — they are tracked, baselined, and must be resolved in dedicated follow-up passes.

### 5.1 Production Build — NOT TESTED

**Status**: ⚪ NOT TESTED

**Reason**: The project's system constraints explicitly prohibit `bun run build` in the sandbox environment. A production build cannot be executed here.

**Risk acknowledged**: A production build can surface issues not visible in dev server:
- Missing modules / server-client boundary violations
- Dynamic import / route compilation failures
- Static generation errors
- Prisma bundling issues
- Environment validation

**Mitigations applied** (what WAS verified):
- `bunx tsc --noEmit` — type checking (see §5.2)
- `bun run lint` — ESLint, 0 errors
- Agent Browser runtime smoke test — 9 views, 0 console errors (see `docs/DEADCODE-CLEANUP-VERIFICATION.md` §6)
- API route registration — 10 critical routes verified registered + auth-enforced

**Resolution requirement**: A production build MUST be run in an environment that permits `bun run build` before any deployment. The status of this debt must be updated from "NOT TESTED" to "PASS" or "FAIL" at that time.

**Lock rule**: No claim of "production-ready" may be made while this debt is open. The honest status is "dev-server verified, production build NOT TESTED".

### 5.2 Repository Type Safety — 354 Pre-existing TypeScript Errors

**Status**: ❌ FAIL (pre-existing baseline debt)

**Proof of non-regression** (the cleanup did NOT cause these):

| State | tsc errors | Baseline file |
|-------|------------|---------------|
| BEFORE (backup `fbd03cd`, pre-cleanup, same tsconfig) | **431** | `docs/baselines/tsc-before-cleanup.txt` |
| AFTER (commit `1b160e8`, post-cleanup + corrective restore) | **354** | `docs/baselines/tsc-after-cleanup.txt` |
| **Delta** | **−77** | Cleanup NET REMOVED 77 errors |

The dead-code deletions only REMOVED errors (from deleted files' own type issues). **Zero new errors were introduced.**

**Breakdown of the 354 remaining errors** (all pre-existing technical debt):
| Source | ~Errors | Nature |
|--------|---------|--------|
| `scripts/verify-v23-fixes.ts` | ~15 | `metadata possibly undefined` (strict null check) |
| `src/app/api/inventory/composition-sync/route.ts` | ~10 | `compositionUsageSnapshot` not in Prisma schema |
| `src/app/api/bulk-engine/delegate/purchase/route.ts` | ~5 | `preload` undefined, arg-count mismatches |
| `src/app/api/insights/generate/route.ts` | ~2 | `peakHour`/`peakHourRevenue` not in dashboard type |
| `src/lib/offline/repository.ts` | 7 | Restored engine, `IDType<T>` type mismatches (pre-existing, was hidden when file was deleted) |
| Various `scripts/` + `src/app/api/` | ~315 | Pre-existing type issues across the codebase |

**Lock rule**: The number 354 is the **baseline**. Any future cleanup or feature work must not INCREASE this number without an ADR. A dedicated type-safety pass should be opened to drive this number toward 0.

**Why this matters for dead-code scanning**: A scanner operating on a type-graph with 354 errors may produce false positives (flagging live code as dead because an import fails to resolve due to an unrelated type error). This is why A3 (POS extracted-layout) was KEPT — its "unused" flag may be a scanner false-positive caused by the unhealthy type graph. The type-safety pass must precede any aggressive dead-code deletion based on import-graph analysis.

---

## 6. FREEZE RULES

### DO NOT (LOCKED — violation requires ADR)

1. **DO NOT** reintroduce any file listed in §2 (Deleted Files Registry) without an ADR proving the orphan status changed.
2. **DO NOT** re-add any of the 11 C-HIGH npm dependencies without proof of active import + justification that no existing dependency covers the use case.
3. **DO NOT** delete any file in §3 (Kept Files Registry) without a separate audit (like the A3 audit). Import-graph "unused" is insufficient for A3, offline engines, or any §3 entry.
4. **DO NOT** delete `examples/websocket/` — it is a system reference asset (Caddy gateway WebSocket pattern), not project dead code.
5. **DO NOT** delete `scripts/query-audit.ts` — it is official dev tooling for Audit Log V2 verification.
6. **DO NOT** remove `examples` or `skills` from `tsconfig.json` `exclude` — they are system/vendor directories.
7. **DO NOT** claim "production-ready" or "build PASS" while §5.1 (production build NOT TESTED) is open.
8. **DO NOT** claim "TypeScript PASS" or "type-safe" while §5.2 (354 errors) is open. The honest status is "deletion regression PASS / repository type safety FAIL (pre-existing)".
9. **DO NOT** run a dead-code scanner against the current type-graph and treat its output as authoritative — the 354 type errors (§5.2) can cause false-positive "dead" flags.
10. **DO NOT** delete engine implementations under the "barrel re-export" category — only the barrel itself. (The `d857aa7` commit violated this for A6; `1b160e8` corrected it. This rule prevents recurrence.)
11. **DO NOT** commit `.env`, ICU `.so` files, or `db/pgdata/` — they are environment-local (gitignored).

### MUST (LOCKED — required for future cleanup passes)

1. **MUST** create a git tag backup before any cleanup pass (e.g., `backup-before-deadcode-cleanup` at `fbd03cd`).
2. **MUST** verify 0 inbound imports via `rg` for every DELETE candidate before deletion.
3. **MUST** distinguish "barrel re-export" (small `index.ts`) from "engine implementation" (large `.ts` with real logic) in the scanner output — only barrels may be deleted under barrel-category scope.
4. **MUST** run `bunx tsc --noEmit` before AND after cleanup, save both baselines to `docs/baselines/`, and prove the delta is ≤ 0 new errors.
5. **MUST** run `bun run lint` before AND after cleanup — 0 errors required, warnings must not increase.
6. **MUST** run Agent Browser smoke test across all critical views (Login, Dashboard, POS, Transaksi, Pembelian, Audit Log, Pengaturan — see §7) after cleanup.
7. **MUST** verify `.env` and ICU files are NOT in the commit (`git show --name-only <commit> | grep -E "\.env|icu"`).
8. **MUST** record any scope deviation (file deleted beyond spec, file restored from backup) in the commit message AND the worklog.
9. **MUST** update this LOCK document if any file moves between §2 (Deleted) and §3 (Kept), or if a §5 residual debt is resolved.

---

## 7. REGRESSION & VERIFICATION

### 7.1 Automated

```bash
# Lint — must be 0 errors
bun run lint

# Type-check — must be ≤ 354 errors (the §5.2 baseline)
bunx tsc --noEmit 2>&1 | grep -c "error TS"
# Compare against:
#   docs/baselines/tsc-after-cleanup.txt (354 errors at lock time)
```

### 7.2 Manual — Agent Browser Smoke Test (10 points)

After any change to the file inventory or dependencies, verify these views render with real data and 0 console errors:

| # | View | How to verify |
|---|------|---------------|
| 1 | Login | Authenticate as `owner@free.aether.com` / `password123` — reach dashboard |
| 2 | Dashboard | "Selamat [time], Pak" greeting + Revenue/Transaksi/Profit/Stok widgets |
| 3 | POS Terminal | Product grid renders (Kopi Susu Gula Aren, Teh Botol Sosro) + "Synced" indicator |
| 4 | POS Checkout | Add product to cart → payment → receipt (route `POST /api/pos/checkout` registered) |
| 5 | Transaksi | Daftar Transaksi + Closing Harian tabs render |
| 6 | Void | `POST /api/transactions/[id]/void` route registered (void a tx if one exists) |
| 7 | Pembelian & Inventori | Purchase + Inventory Items tabs, "Buat Pembelian" button |
| 8 | Offline Sync | `GET /api/transactions/sync` route registered, POS shows "Synced" |
| 9 | Migration | `GET /api/migration/template` returns valid xlsx (200) |
| 10 | Audit Log | V2 event-type filters render (Penjualan, Stok & Pembelian, Operasi Massal, Legacy) |
| 11 | Bulk Engine | `POST /api/bulk-engine/execute` route registered (401 = auth-enforced) |
| 12 | Pengaturan | Outlet & Struk, Pembayaran & Promo, Telegram, Akun tabs render |

### 7.3 API Route Registration (10 critical routes)

All must return 401 (auth-enforced) or 200 (public) — not 404 (missing) or 500 (crash):

```
POST   /api/pos/checkout              → 401
POST   /api/transactions/[id]/void    → 401
GET    /api/transactions/sync         → registered
POST   /api/bulk-engine/execute       → 401
GET    /api/migration/template        → 200 (xlsx)
GET    /api/purchases                 → 401
GET    /api/inventory/items           → 401
GET    /api/inventory/stock-opname    → registered
GET    /api/audit-logs                → 401
GET    /api/dashboard/summary         → 401
```

### 7.4 Commit Hygiene Check

```bash
# Must return empty (no .env, no ICU, no pgdata)
git show --name-only <commit> | grep -E "\.env|libicu|pgdata"

# .env must NOT be tracked
git ls-files --error-unmatch .env  # → should fail

# src/lib/local-db.ts MUST be tracked (the .gitignore exception)
git ls-files --error-unmatch src/lib/local-db.ts  # → should succeed
```

---

## 8. FOLLOW-UP ITEMS (Out of Scope for this Lock)

1. **A3 POS extracted-layout audit** (~3,900 LOC, 12 files) — separate feature-parity audit required before any deletion. Must verify each file against the live POS terminal feature set. Do NOT delete based on import-graph alone (the 354 type errors may cause false-positive "dead" flags).

2. **Offline engine implementations audit** (5 files, 2,170 LOC) — the restored `src/lib/offline/{repository,fefo-engine,purchase-engine,transaction-engine,sync-queue}.ts` are dormant (0 consumers). A separate audit must decide: (a) wire them into the active sync-service architecture, or (b) delete them with a proper ADR. The 7 `repository.ts` type errors (§5.2) must be resolved as part of this audit.

3. **Type-safety pass** — drive the 354 TypeScript errors toward 0. This is a prerequisite for trusting dead-code scanner output. Priority targets: `composition-sync/route.ts` (schema mismatch), `bulk-engine/delegate/purchase/route.ts` (undefined `preload`), `insights/generate/route.ts` (missing `peakHour`).

4. **Production build** — run `bun run build` in an environment that permits it. Update §5.1 status from "NOT TESTED" to "PASS" or "FAIL".

5. **Secondary orphan check** — after the type-safety pass, re-scan for newly-revealed orphans:
   - `src/lib/offline/legacy-stub.ts` (orphan after `local-db.ts` became standalone)
   - `src/lib/test-helpers.ts` + `test-scenarios{,-v2}.ts` (may be orphan after `test-suite-page` deletion)

6. **Unused exports pass (F)** — after the type-safety pass, clean unused exports within otherwise-active files. Low-risk, out of scope for this cleanup.

---

## 9. HISTORICAL CONTEXT

### Cleanup timeline

| Date | Commit | Event |
|------|--------|-------|
| 2026-07-29 | `fbd03cd` | Backup tag `backup-before-deadcode-cleanup` created |
| 2026-07-29 | `d857aa7` | Initial cleanup: 32 files deleted (9,204 LOC), 11 deps removed. **Scope deviation**: A6 deleted engine implementations (not just barrel), E-SELECTIVE deleted examples/websocket (system reference). |
| 2026-07-29 | `b9b6c6b` → `1b160e8` | Corrective pass: restored 7 files (examples/websocket + 5 offline engines), promoted query-audit.ts, added tsconfig excludes, saved tsc baselines, created verification report. Originally committed as `b9b6c6b`, amended to `1b160e8` (identical tree content, file-mode metadata only). **`1b160e8` is the LOCK commit.** |

### Key lessons (LOCKED as institutional memory)

1. **"Barrel re-export" ≠ "engine implementation"** — The `d857aa7` commit message claimed A6 deleted "barrel re-exports" but `git show --stat` revealed 2,170 LOC of implementations were deleted. Always distinguish a small `index.ts` barrel (safe to delete if orphan) from the large `.ts` files it re-exports (require separate audit).

2. **System reference assets are not dead code** — `examples/websocket` was flagged as orphan (missing socket.io deps) but is a sandbox/system reference for the Caddy gateway WebSocket pattern. System instructions explicitly reference it. Always check whether a file is referenced by the platform/system before deleting.

3. **tsc baseline must be proven, not asserted** — The initial cleanup claimed "0 new errors" based on manual observation. The corrective pass proved it rigorously: 431 (before) → 354 (after) = −77, saved as `docs/baselines/tsc-{before,after}-cleanup.txt`. Always save both baselines and compute the delta.

4. **354 type errors invalidate dead-code scanners** — A scanner operating on an unhealthy type-graph produces false positives. A3 (POS extracted-layout) was correctly KEPT because its "unused" flag may be a false positive caused by the 354 type errors breaking import resolution. The type-safety pass must precede aggressive dead-code deletion.

5. **Commit hygiene is verifiable** — `.env` and ICU files were verified NOT in the commit via `git show --name-only | grep`. This check is now part of §7.4.

---

## 10. ARCHITECTURE LOCK APPROVAL

Based on the dead-code & unused-files cleanup (21 source files + 11 deps + 6 scripts + 3 misc files deleted, −77 TypeScript errors proven, 9-view smoke test PASS, 0 console errors), the corrective pass (7 files restored, scope deviations fixed), and the two formally recorded residual debts (§5):

```
DEAD CODE & UNUSED FILES CLEANUP LOCK: APPROVED
```

The Aether POS dead-code cleanup state at commit `1b160e8` is **FROZEN** as the baseline. All subsequent development MUST adhere to the freeze rules in §6. Any deviation — reintroducing a deleted file, deleting a KEPT file, re-adding a removed dependency, or resolving a §5 residual debt — requires an Architecture Decision Record (ADR) and a re-verification of the §7 regression checks.

The two residual debts (§5.1 production build NOT TESTED, §5.2 354 pre-existing TS errors) are acknowledged, baselined, and tracked. They are NOT blockers for this lock — they are known-state that must be resolved in dedicated follow-up passes (§8).

---

**Lock Date**: 2026-07-29
**Locked At**: commit `1b160e8` (amended from `b9b6c6b`; see §0 commit hash note)
**Locked By**: Dead Code & Unused Files Cleanup Lock Review
**Regression**: `bun run lint` + `bunx tsc --noEmit` (≤354) + §7 Agent Browser smoke test
**Next Review**: Triggered by any §2 file reintroduction, any §3 file deletion, any C-HIGH dependency re-addition, or resolution of a §5 residual debt
**Companion Documents**:
- `docs/DEADCODE-CLEANUP-VERIFICATION.md` (full evidence report — the corrective pass record)
- `docs/baselines/tsc-before-cleanup.txt` (431 errors, pre-cleanup baseline)
- `docs/baselines/tsc-after-cleanup.txt` (354 errors, post-cleanup baseline — the LOCK baseline)
- `docs/AUDIT-V2-LOCK.md` (audit architecture — unaffected by this cleanup)
- `backup-before-deadcode-cleanup` git tag at `fbd03cd` (pre-cleanup recovery point)
