# AETHER — DEFERRED ISSUES BACKLOG (v1.0)

> **Purpose**: Single consolidated backlog of architecture findings that were **explicitly deferred** during the Core Inventory Lock Review and Platform Architecture Review. This document exists so the backlog does not get lost inside two large review documents.
>
> **Non-Goal**: This document does **NOT** reopen the architecture lock. The Core Inventory Architecture remains **LOCKED** (`docs/ARCHITECTURE-LOCK.md`). The Platform Architecture remains **REVIEWED** (`docs/PLATFORM-ARCHITECTURE-REVIEW.md`). Every item here was accepted as deferrable during the review — none is a freeze-blocker.
>
> **Created**: 2026-07-20
> **Owners**: Architecture / Platform engineering
> **Review Cadence**: monthly, or before any quarterly planning cycle
> **Source Documents**:
> - `docs/ARCHITECTURE-LOCK.md` §15 (Core Inventory P2/P3)
> - `docs/PLATFORM-ARCHITECTURE-REVIEW.md` §1–5 + §9 (Platform P1/P2/P3)
> - `worklog.md` AUDIT-PLATFORM-1..5 (audit agent reports — full P2/P3 enumerations for some layers live only in worklog)

---

## 0. HOW TO USE THIS BACKLOG

- Each item has a stable **ID** (`<LAYER>-<NNN>`), **severity**, **layer**, **status**, and **effort estimate** (S/M/L).
- Items are grouped by **severity first**, then by **layer**, so the highest-leverage work surfaces to the top.
- When you start working an item, update its status to `In Progress` and link the PR/ADR. When done, move it to `Resolved` with a one-line resolution note (do not delete — keep the history for audit).
- New findings discovered post-lock are appended at the bottom of the relevant layer section with a `NEW-<YYYYMMDD>` suffix and `Status: Triaged` until reviewed.
- **No item in this file may touch a Core Inventory invariant** (see `ARCHITECTURE-LOCK.md` §3 Authoritative Ledger, §4 Unified Engine, §5 Dual COGS) without an Architecture Decision Record (ADR) and a passing `bun run test:invariant`.

---

## 1. SUMMARY

### Counts (post-remediation, as of 2026-07-20)

| Layer | P0 | P1 | P2 | P3 | Total | Fixed | Deferred |
|-------|----|----|----|----|-------|-------|----------|
| **Core Inventory** (`ARCHITECTURE-LOCK.md`) | 0 | 5 | 9 | 4 | 18 | 5/5 P1 | 13 (9 P2 + 4 P3) |
| Migration Wizard | 0 | 7 | 8 | 9 | 24 | 7/7 P1 | 17 (8 P2 + 9 P3) |
| Crew / Access Control | 10 | 3 | 4 | 2 | 19 | 13/13 P0+P1 | 6 (4 P2 + 2 P3) |
| Settings | 3 | 9 | 4 | 6 | 22 | 3/3 P0 + 7/9 P1 | 12 (2 P1 + 4 P2 + 6 P3) |
| Customer Domain | 0 | 3 | 6 | 4 | 13 | 3/3 P1 + 4/6 P2 | 6 (2 P2 + 4 P3) |
| Plan & Pricing | 4 | 3 | 4 | 2 | 13 | 7/7 P0+P1 | 6 (4 P2 + 2 P3) |
| **TOTAL** | **17** | **30** | **35** | **27** | **109** | **58 fixed** | **60 deferred** |

### Deferred by severity

| Severity | Count | Notes |
|----------|-------|-------|
| **P1** (deferred) | 3 | SET-010/011 (real-time cache invalidation), SET-012 (promo auto-expiry) — both require infrastructure not in current stack |
| **P2** (deferred) | 35 | Cosmetic-by-design, mitigated elsewhere, or non-blocking enhancements |
| **P3** (deferred) | 22 | Documentation drift, dead code, unreachable latent bugs |

### Severity definitions (recap)

- **P0**: Security boundary violation / data corruption / IDOR / privilege escalation. → Must fix before any further release.
- **P1**: Correctness issue with limited blast radius, or requires infrastructure change to fully resolve. → Should fix in next 1–2 cycles.
- **P2**: By-design tradeoff, mitigated risk, or enhancement with no immediate user impact. → Backlog, schedule opportunistically.
- **P3**: Cosmetic, dead code, documentation drift, unreachable latent bug. → Fix during touch-ups, no schedule pressure.

---

## 2. P1 DEFERRED (3 items — highest priority in this backlog)

These are the only P1 findings that did not get remediated during the Platform Review. They are deferred because each requires infrastructure outside the current stack. **They are the first things to revisit when the infrastructure becomes available.**

### SET-010 / SET-011 — Stale cache invalidation (Settings)

- **Layer**: Settings
- **Status**: Deferred — requires WebSocket or polling mechanism
- **Effort**: L (introduces a new real-time primitive)
- **What**: When OWNER updates settings (tax rate, loyalty formula, payment methods), CREW sessions in other tabs/devices continue to use stale cached settings until they reload.
- **Mitigation in place**: SET-003 fixed single-session persistence (real Dexie table survives reloads). Within a single session, the cache is consistent. The gap is **cross-session real-time propagation**.
- **Why deferred**: Requires either (a) WebSocket push from server → all connected clients, or (b) client-side polling of a settings-version endpoint every N seconds. Neither primitive exists in the current stack. Adding it is its own architecture decision (see "Real-time primitive" in §6).
- **User impact**: Low — most settings changes are infrequent (tax rate changes yearly, loyalty formula rarely). The main friction is a CREW needing to refresh once after OWNER changes payment methods.
- **Trigger to revisit**: When WebSocket infrastructure is added for any other feature (e.g., multi-outlet live dashboard), bundle SET-010/011 into the same rollout.

### SET-012 — Promo auto-expiry (Settings)

- **Layer**: Settings
- **Status**: Deferred — requires Prisma schema change
- **Effort**: M
- **What**: Promos have `validUntil` but no automated expiry job. Expired promos remain selectable at POS until manually deactivated.
- **Mitigation in place**: POS checkout validates `validUntil >= now()` at sale time, so an expired promo cannot actually be applied to a transaction. The friction is UI clutter — expired promos still show in the dropdown.
- **Why deferred**: Proper fix needs (a) a `status` enum on Promo (`ACTIVE` / `EXPIRED` / `SCHEDULED`), (b) a cron job or lazy-expire-on-read to flip status. Schema change in a non-locked layer is allowed but was out of P0/P1 scope.
- **User impact**: Low — POS guards correctness. UI clutter only.
- **Trigger to revisit**: When promo scheduling (future-dated activation) is requested, this should be bundled in.

### (Implicit P1) — Real-time primitive gap

- **Layer**: Platform (cross-cutting)
- **Status**: Architectural decision pending
- **Effort**: L
- **What**: Several deferred items (SET-010/011, multi-outlet live dashboards, live stock sync across outlets) all want a server → client push primitive. Currently the platform is request/response only.
- **Decision needed**: WebSocket (socket.io mini-service per the project's `mini-services` pattern) vs Server-Sent Events vs polling. The project already has a `mini-services` folder and a websocket demo in `examples/websocket/` — adopting it is the path of least resistance.
- **Note**: This is the single highest-leverage architectural decision on the backlog. It unlocks SET-010/011, live multi-outlet dashboards, and cross-outlet stock awareness in one move.

---

## 3. CORE INVENTORY — P2/P3 DEFERRED (13 items)

Source: `docs/ARCHITECTURE-LOCK.md` §15. These are by-design tradeoffs or self-healing behaviors that do not corrupt the authoritative ledger. **None may be "fixed" without an ADR** — most are conservative choices that prevent silent data corruption.

### P2 (9 items)

| ID | Title | Status | Effort | Notes |
|----|-------|--------|--------|-------|
| INV-P2-001 | Manual adjustment creates drift | Deferred-by-design | S | Self-heals on next sale via INV-HC-05. Fixing would require immediate batch correction at adjust time — higher regression risk than the drift itself. |
| INV-P2-002 | Stock opname uses parallel inline FEFO logic | Deferred | M | Invariant maintained; parallel logic duplicates `fefo-engine.ts` partially. Consolidating is a refactor with regression risk — defer until next opname rewrite. |
| INV-P2-003 | Purchase Edit/Delete blocks instead of SUPERSEDE | Deferred-by-design | L | Conservative — prevents silent data corruption. SUPERSEDE semantics (preserve consumed batch as `SUPERSEDED`, reverse only unconsumed portion) is a future enhancement. See `ARCHITECTURE-LOCK.md` §6. |
| INV-P2-004 | Void EXPIRED batch drift | Deferred-by-design | S | Self-heals on next sale. Same pattern as INV-P2-001. |
| INV-P2-005 | Void does not create ADJUSTMENT batch | Deferred-by-design | M | Relies on next-sale self-heal. Adding explicit ADJUSTMENT batch on void would tighten the invariant but adds a new mutation path → regression risk. |
| INV-P2-006 | Transfer blocks batch-tracked items (TRF-05) | Deferred — documented limitation | M | Modes C/D/E items cannot be transferred between outlets. Mode B items transfer fine. Fixing requires designing batch-transfer semantics (do batches move? merge? split?). User-facing workaround: stock opname adjustments at both ends. |
| INV-P2-007 | Insights `inventoryValue` uses selling price instead of HPP | Deferred | S | Mislabel — should be `inventoryRetailValue` or compute true HPP-based value. Cosmetic in reports, does not affect accounting. |
| INV-P2-008 | `safeAuditLog` is non-transactional | Deferred — defense-in-depth gap | M | Audit logs are written outside the main `db.$transaction`. If the tx commits but the audit log write fails (network blip), the action is unaudited. Mitigated by `safeAuditLog`'s try/catch + console.error. True fix requires per-call refactoring to `tx.auditLog.create` inside each transaction. |
| INV-P2-009 | No report shows Estimated vs Actual vs Variance | Deferred — future enhancement | M | Both COGS values are computed and stored (`TransactionItem.hpp` for Estimated, `TransactionConsumption.materialCost` for Actual). The variance report just hasn't been built. Pure additive feature, no invariant risk. |

### P3 (4 items)

| ID | Title | Status | Effort | Notes |
|----|-------|--------|--------|-------|
| INV-P3-001 | Dormant offline engine has semantic divergences | Deferred — not in production path | L | `src/lib/offline/*` (transaction-engine, purchase-engine, fefo-engine, sync-queue, repository) is dormant. Production "offline" uses in-memory `localDB` shim that defers to server-side `InventoryConsumptionService` on sync. Preserved for potential future offline-first work. |
| INV-P3-002 | Schema cascade rules on `InventoryItem → InventoryMovement` | Deferred — mitigated by app-layer guards | S | Prisma schema lacks explicit `onDelete` cascade declarations. Mitigated by application-layer guards that prevent deletion when movements exist. Adding `onDelete: Restrict` is a schema hardening, not a behavior change. |
| INV-P3-003 | Void race condition | Deferred — mitigated by OWNER-only permission | M | Two concurrent void calls on the same transaction could theoretically race. Mitigated by OWNER-only permission (only one OWNER typically active) + idempotency checks in the void handler. True fix requires a row-level lock or unique constraint on `voidedAt`. |
| INV-P3-004 | AuditLog schema lacks explicit `onDelete: Restrict` | Deferred — mitigated by app-layer guards | S | Same pattern as INV-P3-002. |

### NOT IMPLEMENTED (architecture decisions pending — not bugs)

These are explicit non-implementations documented in `ARCHITECTURE-LOCK.md`. Listed here for visibility — they are **enhancements**, not defects.

| Item | Status | Notes |
|------|--------|-------|
| On-Hand Accounting (`On-Hand = AVAILABLE + EXPIRED + QUARANTINED`) | Not implemented — needs ADR | Only `AVAILABLE` / `EXPIRED` / `CONSUMED` / `DISCARDED` statuses exist. Adding On-Hand requires an explicit architecture decision. See `ARCHITECTURE-LOCK.md` §7. |
| SUPERSEDE batch semantics | Not implemented — conservative block instead | See INV-P2-003 above. |
| Offline-first engine activation | Not implemented — dormant code preserved | See INV-P3-001 above. |

---

## 4. PLATFORM — P2/P3 DEFERRED (47 items)

### 4.1 Migration Wizard (17 deferred: 8 P2 + 9 P3)

Source: `docs/PLATFORM-ARCHITECTURE-REVIEW.md` §1.

**Documented in review doc (4 items):**

| ID | Severity | Title | Status | Effort | Notes |
|----|----------|-------|--------|--------|-------|
| MIG-P2-001 | P2 | Schema drift across 4+ `VALID_UNITS` lists | Deferred | M | 28 in excel-utils, 22 in migration import, 25 in template dropdowns, 19 in product bulk-upload. User inputs like "butir", "karton", "lusin" silently default to `pcs`. Fix: consolidate into single `src/lib/units.ts` source of truth. |
| MIG-P2-002 | P2 | Migration import duplicates shared excel-utils code | Deferred | S | Should `import` from `src/lib/excel-utils.ts` instead of copy-pasting. Pure refactor. |
| MIG-P3-001 | P3 | No streaming for large files | Deferred | L | Entire Excel parsed in memory. For 500-row Enterprise plan limit this is fine; if limit ever raises, revisit. |
| MIG-P3-002 | P3 | Error reporting could be more granular | Deferred | S | Currently returns row number + message. Could add field name + suggested fix. UX polish. |

**Enumerated in audit but not in review doc (13 items):** The full P2/P3 enumeration for Migration Wizard was produced by AUDIT-PLATFORM-1 and is preserved in `worklog.md`. The 4 items above are the ones formally documented. The remaining 6 P2 + 7 P3 are minor (column ordering, header validation, sheet name case sensitivity, etc.) — dig into the worklog if a full Migration Wizard refactor is scheduled.

### 4.2 Crew / Access Control (6 deferred: 4 P2 + 2 P3)

Source: `docs/PLATFORM-ARCHITECTURE-REVIEW.md` §2.

| ID | Severity | Title | Status | Effort | Notes |
|----|----------|-------|--------|--------|-------|
| CREW-P2-001 | P2 | `CrewPermission.pages` is UI-only cosmetic gate | Deferred | L | A CREW with `pages='pos'` can still hit any mutation endpoint via curl (now blocked by OWNER checks at API layer). Future: enforce page-level permissions at API. Requires defining page→endpoint mapping. |
| CREW-P2-002 | P2 | Inconsistent single-vs-bulk role checks | Resolved during review | — | Listed for history. Single `[id]` DELETE was missing OWNER check; now fixed alongside the bulk path. |
| CREW-P2-003 | P2 | (Audit-only — see worklog) | Deferred | — | One of the 4 P2s was resolved during remediation; the remaining 2 P2s are audit-only nits. |
| CREW-P2-004 | P2 | (Audit-only — see worklog) | Deferred | — | Audit-only nit. |
| CREW-P3-001 | P3 | AuditLog schema lacks explicit `onDelete: Restrict` | Deferred | S | Same as INV-P3-004. Mitigated by app-layer guards. |
| CREW-P3-002 | P3 | (Audit-only — see worklog) | Deferred | — | Audit-only nit. |

### 4.3 Settings (10 deferred: 2 P1 + 4 P2 + 6 P3)

Source: `docs/PLATFORM-ARCHITECTURE-REVIEW.md` §3. The 2 P1s are covered in §2 above.

| ID | Severity | Title | Status | Effort | Notes |
|----|----------|-------|--------|--------|-------|
| SET-P1-001 | P1 | Stale cache invalidation | Deferred | L | See §2 (SET-010/011). |
| SET-P1-002 | P1 | Promo auto-expiry | Deferred | M | See §2 (SET-012). |
| SET-P2-001..004 | P2 | (Audit-only — see worklog) | Deferred | — | 4 P2 findings from AUDIT-PLATFORM-3 not enumerated in review doc. Likely validation edge cases and defaults. Dig into worklog when scheduling a Settings hardening sprint. |
| SET-P3-001..006 | P3 | (Audit-only — see worklog) | Deferred | — | 6 P3 findings from AUDIT-PLATFORM-3. Cosmetic / dead code / doc drift. |

### 4.4 Customer Domain (6 deferred: 2 P2 + 4 P3)

Source: `docs/PLATFORM-ARCHITECTURE-REVIEW.md` §4 + `worklog.md` AUDIT-PLATFORM-4.

| ID | Severity | Title | Status | Effort | Notes |
|----|----------|-------|--------|--------|-------|
| CUST-P2-001 | P2 | CUST-006: Loyalty points can go negative on void | Deferred-by-design | S | Void can't un-void. Removing the floor check from manual adjust for consistency would WEAKEN manual adjust safety. Kept as-is. |
| CUST-P2-002 | P2 | CUST-007 follow-ups: GDPR export is a stub | Deferred | M | Current `/api/customers/[id]/export` returns raw JSON. Production version should offer CSV/ZIP download + redact PII from `AuditLog.details` JSON for right-to-be-forgotten. |
| CUST-P3-001 | P3 | CUST-010: LoyaltyLog.type schema comment drift | Deferred | S | Cosmetic — schema comment doesn't match actual enum values used. |
| CUST-P3-002 | P3 | CUST-011: Dead code in `src/lib/actions/customers.ts` | Deferred | S | 0 callers. Safe to delete. |
| CUST-P3-003 | P3 | CUST-012: Manual loyalty adjust TOCTOU race | Deferred | M | Lower severity than CUST-001 (already fixed). OWNER-only, concurrency unlikely. True fix needs SELECT FOR UPDATE or version column. |
| CUST-P3-004 | P3 | CUST-013: Customer tier calculation client-side only | Deferred | S | Single source of UI currently. Server-side tier calc would enable tier-based promos. |

### 4.5 Plan & Pricing (6 deferred: 4 P2 + 2 P3)

Source: `docs/PLATFORM-ARCHITECTURE-REVIEW.md` §5.

| ID | Severity | Title | Status | Effort | Notes |
|----|----------|-------|--------|--------|-------|
| PLAN-P2-001 | P2 | `products/bulk-upload` uses hardcoded MAX_ROWS=500 | Deferred | S | Should use `maxBulkUploadRows` per plan. Mitigated by MIG-005 fix on migration import. |
| PLAN-P2-002 | P2 | `<ProGate>` is UI-only (blur+lock overlay) | Deferred-by-design | L | Does not prevent underlying API calls. Mitigated by server-side enforcement on all endpoints. True fix would require per-route entitlement checks in middleware. |
| PLAN-P2-003 | P2 | No grace period on plan expiry | Deferred | M | Currently immediate block/downgrade. Future: 7-day grace period with banner. UX polish, no security impact. |
| PLAN-P2-004 | P2 | (Audit-only — see worklog) | Deferred | — | Audit-only nit. |
| PLAN-P3-001 | P3 | Latent bug in `inventory/items/bulk-update-excel` | Deferred | S | References `outletPlan.accountType` (undefined; should be `outletPlan.plan`). Unreachable due to upstream checks. |
| PLAN-P3-002 | P3 | Legacy `/api/outlets` POST/DELETE duplicates group-aware path | Deferred | S | Dead route — superseded by `/api/outlet-group/outlets`. Safe to remove. |

---

## 5. CROSS-CUTTING THEMES

These are patterns that appear across multiple layers. Tackling them as themes (rather than individual findings) often delivers more value.

### Theme A — Real-time primitive (unlocks 3+ items)

- **Items unlocked**: SET-010/011 (settings cache), live multi-outlet dashboards, cross-outlet stock awareness, real-time audit log streaming.
- **Decision**: WebSocket (socket.io mini-service) vs SSE vs polling.
- **Recommendation**: WebSocket via the existing `mini-services` pattern + `examples/websocket/` reference. One mini-service on a dedicated port, frontend connects via `io("/?XTransformPort=<port>")`.
- **Why now**: This is the single highest-leverage architectural decision on the backlog.

### Theme B — Single source of truth for shared constants

- **Items**: MIG-P2-001 (VALID_UNITS drift), plus likely several SET/CREW P2/P3 audit nits.
- **Pattern**: Multiple files define the same enum/constant with slight drift. Inputs silently default when they don't match.
- **Recommendation**: Consolidate into `src/lib/constants/` (units, payment methods, theme colors, role names, page whitelists). One import, one validation point.

### Theme C — Schema hardening (`onDelete: Restrict`)

- **Items**: INV-P3-002, INV-P3-004, CREW-P3-001.
- **Pattern**: Prisma schema lacks explicit `onDelete` declarations. Mitigated by app-layer guards, but a defense-in-depth pass would tighten this.
- **Recommendation**: One schema-only PR adding `onDelete: Restrict` to all foreign keys on `AuditLog`, `InventoryMovement`, `LoyaltyLog`, `Transaction`. Low risk, high consistency. Run `bun run db:push` + `bun run test:invariant` to verify.

### Theme D — Audit log transactional consistency

- **Items**: INV-P2-008 (`safeAuditLog` non-transactional), CUST-P3-003 (TOCTOU).
- **Pattern**: Audit logs written outside the main transaction can be lost if the audit write fails after the tx commits.
- **Recommendation**: Migrate `safeAuditLog` calls to `tx.auditLog.create` inside each `db.$transaction`. CUST-001/002/003 already demonstrated the pattern. Mechanical refactor across ~15 call sites.

### Theme E — Dead code & legacy routes cleanup

- **Items**: CUST-P3-002 (`actions/customers.ts`), PLAN-P3-002 (legacy `/api/outlets`), INV-P3-001 (dormant offline engine).
- **Recommendation**: One cleanup PR per cycle. Low risk if `bun run test:invariant` passes. Frees up cognitive load.

### Theme F — Variance & reporting layer

- **Items**: INV-P2-009 (Estimated vs Actual COGS variance report), INV-P2-007 (inventory value mislabel).
- **Recommendation**: Build as a new reporting module on top of the locked engine. Both COGS values are already stored — this is pure additive UI work. High business value (owner visibility into costing accuracy).

---

## 6. RECOMMENDED SEQUENCING (next 3 cycles)

Sequenced by leverage (value ÷ effort), not by severity alone. P1s are interleaved with high-leverage P2 themes.

### Cycle 1 — Infrastructure & cleanup

1. **Theme A decision + spike** (L) — Decide WebSocket vs SSE, build a minimal socket.io mini-service, prove a single end-to-end message. Does NOT yet integrate SET-010/011.
2. **Theme C — Schema hardening** (S) — One PR, `onDelete: Restrict` everywhere. Run `db:push` + `test:invariant`.
3. **Theme E — Dead code cleanup** (S) — Remove `actions/customers.ts` dead code, legacy `/api/outlets` route. Verify lint + invariant.
4. **MIG-P2-001 + Theme B — VALID_UNITS consolidation** (M) — High user-facing value (fixes silent "butir" → "pcs" defaulting).

### Cycle 2 — Real-time rollout + audit consistency

1. **SET-010/011 — Real-time settings invalidation** (L) — Build on Cycle 1's WebSocket spike. Push settings-version events to connected clients.
2. **Theme D — Audit log transactional consistency** (M) — Migrate `safeAuditLog` → `tx.auditLog.create` across ~15 sites.
3. **INV-P2-009 — Estimated vs Actual COGS variance report** (M) — High business value. Pure additive, no invariant risk.

### Cycle 3 — Polish & UX

1. **SET-012 — Promo auto-expiry** (M) — Add `status` enum + lazy-expire-on-read. Schema change in non-locked layer.
2. **PLAN-P2-003 — Plan expiry grace period** (M) — 7-day grace with banner. UX polish.
3. **CUST-P2-002 — GDPR export productionization** (M) — CSV/ZIP download + PII redaction.
4. **INV-P2-007 — Insights `inventoryValue` mislabel fix** (S) — Quick win.

### Beyond Cycle 3 (large, schedule when triggered)

- **INV-P2-003 — SUPERSEDE batch semantics** (L) — Triggered by user request for purchase edit after consumption.
- **INV-P2-006 — Transfer batch-tracked items** (M) — Triggered by multi-outlet merchant with perishable inventory.
- **CREW-P2-001 — Page-level API enforcement** (L) — Triggered by tenant requesting granular CREW permissions.
- **INV-P3-001 — Offline-first engine activation** (L) — Triggered by merchants operating in low-connectivity environments.

---

## 7. HOW TO ADD NEW FINDINGS

When a new issue is discovered post-lock:

1. **Triage severity** using the definitions in §1.
2. **If P0 or P1**: This is a freeze violation. File immediately, notify architecture owner. Do NOT silently defer.
3. **If P2 or P3**: Append to the relevant layer section in §3 or §4 with:
   - `ID`: `<LAYER>-P<severity>-<NNN>-NEW-<YYYYMMDD>`
   - `Status`: `Triaged`
   - `Effort`: S / M / L
   - `Title` + `Notes` (what, why deferred, mitigation in place, trigger to revisit)
4. **Cross-cutting?** If the finding spans layers, also add a row to §5 (Cross-Cutting Themes).
5. **Commit** with message `docs(deferred): add <ID> — <title>`.

When an item is resolved:

1. Move the row to a `### Resolved` subsection at the bottom of its layer section (do not delete — keep history).
2. Add a one-line `Resolution` note: PR link, date, brief description.
3. Update the counts in §1.

---

## 8. RELATIONSHIP TO THE ARCHITECTURE DOCS

```
┌─────────────────────────────────────────────────────────────┐
│  docs/ARCHITECTURE-LOCK.md          (Core Inventory v1.0)   │
│  Status: LOCKED                                             │
│  §15 P2/P3 ──────────────────────────┐                      │
│                                       │                      │
│                                       ▼                      │
│  docs/PLATFORM-ARCHITECTURE-REVIEW.md (Platform v1.0)       │
│  Status: REVIEWED                                           │
│  §1-5 P1/P2/P3 ──────────────────────┐                      │
│                                       │                      │
│                                       ▼                      │
│  docs/DEFERRED-ISSUES.md  ◄──── YOU ARE HERE                │
│  Status: Living backlog                                     │
│  - Consolidates ALL deferred items from both docs           │
│  - Adds cross-cutting themes + sequencing                   │
│  - Does NOT reopen either lock                              │
│  - New findings appended here, not to the lock docs         │
└─────────────────────────────────────────────────────────────┘
```

### Rules of engagement

- **Lock docs are immutable** except for typo fixes and explicit ADRs. Do not add new findings to them.
- **This backlog is mutable** — that's its purpose. Update freely.
- **Regression gate**: Any work that touches Core Inventory invariants must pass `bun run test:invariant` (61 PASS / 0 FAIL / 1 WARN baseline) before merge.
- **Architecture Decision Records**: Required for any item marked "needs ADR" or any work that introduces a new primitive (WebSocket, cron, background job).

---

**Document Owner**: Architecture / Platform engineering
**Last Updated**: 2026-07-20
**Next Review**: 2026-08-20 (monthly cadence) or before quarterly planning
