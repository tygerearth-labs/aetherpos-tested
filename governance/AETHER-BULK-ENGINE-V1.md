# AETHER BULK ENGINE V1 — Governance & Lock Rules

> **Lock label**: `AETHER BULK ENGINE V1`
> **Lock date**: 2026-07-23
> **Lock basis**: Migration Wizard runtime proof on 2,739 non-variant SKUs (commit `697ff2d`) + 1,000 variant SKUs (commit `6996568`). Both passed correctness verification scenarios 3a/3b/4a/4b/5/6.
> **Reference implementation**: `src/app/api/migration/import/route.ts`
> **Engine source**: `src/lib/bulk-engine/`
> **Adapter contract**: `src/lib/bulk-engine/adapters/README.md`
> **Status**: APPROVED — frozen as the standard bulk import pattern for all modules.

---

## 0. LOCK STATEMENT

The Aether bulk import engine has been proven at production scale (2,739 + 1,000 SKUs across 75+ batches) with the following capabilities:

- ✅ Batching (50 rows/batch)
- ✅ Resume / retry (idempotent)
- ✅ Duplicate-safe (preload Maps + in-batch Sets)
- ✅ Atomic transaction (per-batch `$transaction`)
- ✅ Partial failure handling (other batches' data NOT rolled back)
- ✅ Progress persistence (in-memory + opt-in `ProgressPersister`)
- ✅ Error export (per-row CSV/Excel)
- ✅ Query optimization (preload + Map + grouped writes — no `findFirst` in row loop)
- ✅ Fresh import + re-migration (both supported)
- ✅ Non-variant + variant (both supported)
- ✅ Inventory + composition linking (Mode 2 + Mode 3)

The engine is now **FROZEN** as the standard for all bulk import paths. The engine pattern is locked — not the entire migration route implementation file. The migration route is the **reference implementation**; the engine is **extracted from it** for other modules to reuse.

---

## 1. WHAT IS LOCKED (cross-cutting, reusable)

These are encoded in `src/lib/bulk-engine/` and MUST NOT be re-implemented per module:

| Component | File | Responsibility |
|---|---|---|
| Parser orchestration | `engine.ts` | Calls `adapter.parseRow`, filters note rows, collects parse errors |
| Validator orchestration | `engine.ts` | Calls `adapter.validateRow` (pre-batch, no DB), collects validation errors |
| Batch queue | `engine.ts` | Chunks rows into 50-row batches (configurable, default 50) |
| Retry / resume | `engine.ts` + `progress.ts` | Skips already-completed batches on re-run (idempotent) |
| Progress state | `progress.ts` | In-memory tracker + optional `ProgressPersister` for resume |
| Duplicate strategy | adapter-owned | `preloadBatch` returns Maps; `processBatch` consults them in-memory |
| Transaction runner | `engine.ts` | Wraps `adapter.processBatch` in `db.$transaction` (atomic per-batch) |
| Error collector | `error-collector.ts` | Per-row errors, exportable to CSV/Excel |
| Result summary | `engine.ts` | `BulkImportResult` with created/updated/skipped/failed + per-batch durations |

---

## 2. LOCK RULES (non-negotiable)

### R1. Batch size 50 as default safe value
- Default `batchSize: 50` (proven on 2,739 SKUs across 55 batches).
- May be tuned per adapter, but MUST NOT exceed 200 without load test evidence.
- Engine warns + clamps if out of `[1, 200]`.

### R2. Concurrency locked at 1
- `concurrency: 1` is the ONLY allowed value.
- Parallel batch writes risk deadlocks (overlapping table locks) + invariant violation (e.g. parent stock recalculation reads stale state).
- Engine FORCES concurrency to 1 even if adapter requests higher.

### R3. Batch commit atomic
- Each batch runs inside `db.$transaction(async (tx) => adapter.processBatch(...))`.
- If `processBatch` throws, the **entire batch** rolls back — no partial commits.
- Successful batches commit before the next batch starts.

### R4. No `findFirst` inside the row loop
- All reads must happen in `preloadBatch` (O(N) queries, not N×batch).
- `processBatch` consults preloaded Maps/Sets — 0 reads per row.
- Code review MUST verify this. Engine cannot enforce at compile time.

### R5. Preload + Map + grouped writes
- `preloadBatch` returns Maps/Sets (immutable-ish).
- `processBatch` groups writes: `createMany` / `updateMany` (not per-row `create`).
- Reuse Maps across the batch — no re-querying mid-batch.

### R6. Retry must be idempotent
- `preloadBatch` re-queries current DB state on every call.
- `processBatch` skips or updates already-existing rows (detected via preload Maps).
- Re-running a successful batch produces the same outcome — no duplicates.

### R7. Error per row remains exportable
- Per-row errors are kept individually (not collapsed to "batch failed").
- `ErrorCollector.toCSV()` / `toExportRows()` produce downloadable error reports.
- Whole-batch failures mark ALL rows in that batch as failed (recoverable=true).

### R8. Successful data MUST NOT roll back because another batch failed
- `continueOnBatchFailure: true` is the default.
- Batch N+1 runs even if batch N failed.
- Batch N's committed data stays committed.

### R9. Never `clear()` cache before sync validates
- Applies to sync-service (`src/lib/sync-service.ts`) — see commit `bea58b70`.
- Equivalent for bulk engine: `bulkDelete(stale)` only after successful, non-empty pagination.
- Empty server response → skip both `bulkPut` AND `bulkDelete` → cache preserved.

### R10. Note/instruction rows MUST NOT enter the data range
- Adapter's `isNoteRow(raw, rowNum, ctx)` filters them BEFORE parsing.
- Engine counts them as `skippedNoteRows` (separate from data rows).
- Examples: `(Semua produk ber-varian — lihat sheet lain)`, `PANDUAN IMPORT`, empty rows.

---

## 3. WHAT IS NOT LOCKED (domain-specific, stays in adapter)

These concerns belong **inside the adapter**, NOT in the engine. If you find yourself wanting to add any of these to the engine — **stop**. Put it in the adapter.

| Concern | Owner | Why it stays domain-specific |
|---|---|---|
| **Mode 2 vs Mode 3 business rules** | migration adapter | Mode 2 = product + 1:1 inventory link + stock movement. Mode 3 = product + deferred composition only. Engine must not know about "modes". |
| **Composition conflict resolution** | migration adapter | Skip composition if ingredient doesn't exist; warn but don't fail batch. This is migration-specific tolerance. |
| **Variant parent mapping** | migration adapter | Carry-down logic: parent columns filled only on first variant row. Sheet-layout-specific. |
| **FEFO / batch consumption** | `FEFOEngine` (not bulk engine) | Bulk import creates initial stock; it does NOT consume batches. FEFO is a separate engine (`src/lib/fefo-engine.ts`). |
| **Stock movement semantics** | migration adapter | `OPENING_STOCK` movement type, `MIGRATION` source tag, `currentStock` snapshot. These are migration inventory semantics. |
| **HPP / costing** | migration adapter | HPP from row, `avgCost` init = HPP, `materialCost` snapshot at sale. Costing is a core inventory contract (`docs/ARCHITECTURE-LOCK.md` §4), not a bulk engine concern. |

---

## 4. ADAPTER CONTRACT

Every new bulk import module MUST implement `BulkImportAdapter<TPreload, TContext>`:

```typescript
interface BulkImportAdapter<TPreload, TContext> {
  name: string
  isNoteRow?(raw, rowNum, ctx): boolean              // R10: filter instruction rows
  parseRow(raw, rowNum, ctx): ParsedRow              // raw → typed (throw ParseError)
  validateRow(parsed, rowNum, ctx): ValidationError[]|void  // pre-batch, NO DB
  preloadBatch(parsedRows, batchId, ctx): Promise<TPreload>  // R4+R5: O(N) queries → Maps
  processBatch(parsedRows, preload, ctx, tx): Promise<BatchOutcome>  // R3+R4+R5+R6: atomic, idempotent
  buildError(row, rowNum, err, ctx): BulkImportError // R7: actionable message
}
```

See `src/lib/bulk-engine/adapters/README.md` for the full contract + checklist + reference stub.

---

## 5. MANDATORY USAGE

### 5.1 All new bulk imports MUST use Bulk Engine V1

| Module | Status | Adapter |
|---|---|---|
| Migration Wizard (product non-variant) | ✅ Reference impl (not yet refactored to use engine — route IS the proof) | `src/app/api/migration/import/route.ts` |
| Migration Wizard (product variant) | ✅ Reference impl (same route) | same |
| Customer bulk import (future) | 🔲 MUST use `BulkImportEngine` + adapter | TBD |
| Inventory item bulk import (future) | 🔲 MUST use `BulkImportEngine` + adapter | TBD |
| Purchase bulk import (future) | 🔲 MUST use `BulkImportEngine` + adapter | TBD |
| Supplier bulk import (future) | 🔲 MUST use `BulkImportEngine` + adapter | TBD |
| Any other bulk Excel/CSV import (future) | 🔲 MUST use `BulkImportEngine` + adapter | TBD |

**The migration route itself (`src/app/api/migration/import/route.ts`) is NOT refactored to use the engine yet.** It is the reference implementation from which the engine was extracted. A future refactor may migrate it to use `BulkImportEngine` + `migration-adapter`, but this is OPTIONAL — the route works, is proven, and refactoring carries regression risk. New modules MUST use the engine from day one.

### 5.2 No per-row query loops

```typescript
// ❌ FORBIDDEN
for (const row of rows) {
  const existing = await tx.product.findFirst({ where: { sku: row.sku } })
  // ...
}

// ✅ REQUIRED
const skus = rows.map(r => r.sku)
const existing = await db.product.findMany({ where: { sku: { in: skus } } })
const map = new Map(existing.map(p => [p.sku, p]))
for (const row of rows) {
  const ex = map.get(row.sku)  // 0 queries
  // ...
}
```

### 5.3 Engine changes require regression test

Any change to `src/lib/bulk-engine/*` (engine.ts, types.ts, error-collector.ts, progress.ts) MUST:

1. Pass `bun run lint` (exit 0).
2. Pass `tsc --noEmit` (no new errors in engine files).
3. Re-run the migration product regression test:
   - 6 correctness scenarios (3a/3b/4a/4b/5/6) — see `docs/checkpoints/MIGRATION-WIZARD-CHECKPOINT.md`.
   - At minimum: 50 SKU fresh Mode 2 + 50 SKU re-migration + 50 variant SKU fresh.
4. Document the change in `worklog.md` with Task ID `BULK-ENGINE-*`.
5. Update this governance doc if any lock rule changes.

---

## 6. REGRESSION TEST REQUIREMENT

### 6.1 The 6 Correctness Scenarios (migration-specific)

These MUST pass after any engine change:

| # | Scenario | What it verifies |
|---|---|---|
| 3a | Mode 2 non-variant → 1:1 linking | Product + InventoryItem + ProductComposition + InventoryMovement all created atomically |
| 4a | Mode 2 variant → linking correct | Parent + Variant + per-variant InventoryItem + 1:1 composition + movement |
| 3b | Mode 3 non-variant → linking correct | Product + deferred inline composition only (no inventory/movement) |
| 4b | Mode 3 variant → linking correct | Parent + Variant + deferred inline compositions only |
| 5 | Forced composition failure → rollback batch | `MIG_FORCE_FAIL_BATCH` test hook → batch rolls back, other batches unaffected |
| 6 | Retry → no duplicate links | Re-run same batch → preload catches existing, skips (no duplicates) |

### 6.2 Benchmark Thresholds (post-optimization)

Per 50-row batch, on production-grade Neon Postgres:

| Path | Fresh Mode 2 | Re-migration Mode 2 |
|---|---|---|
| Non-variant | ~5-10s | ~15-20s |
| Variant | ~5-15s | ~15-25s |

If a batch exceeds 30s, STOP and investigate before continuing large migration.

### 6.3 Test Dataset

- Non-variant: 2,739 SKUs (user's production dataset)
- Variant: 1,000 SKUs (100 parents × 10 variants) — see `/home/z/my-project/download/dataset-fashion-1000sku-mode2.xlsx`
- Small tests: 50 SKU fresh Mode 2, 100 SKU fresh Mode 2, 50 SKU re-migration

---

## 7. ANTI-PATTERNS (FORBIDDEN)

| Anti-pattern | Why forbidden | Fix |
|---|---|---|
| `findFirst` in row loop | O(N) queries per batch | Preload Map, in-memory lookup |
| Per-row `create` | N round-trips | `createMany` |
| Catch-and-swallow in `processBatch` | Silent partial failures | Throw → batch rolls back |
| `clear()` cache before sync | Empty server response wipes cache | `bulkDelete(stale)` only after non-empty successful pagination |
| Validation touches DB | N queries pre-batch | All cross-row checks in `preloadBatch` |
| Engine knows "Mode 2" | Couples engine to migration domain | Mode logic stays in adapter |
| Adapter calls `db.$transaction` | Nested transactions / deadlocks | Use the `tx` the engine passes |
| Hardcoded `concurrency: 2` | Deadlocks + invariant violation | Engine forces 1; respect it |
| `batchSize: 1000` to "go faster" | Memory pressure + tx timeout | Stay at 50; proven safe |
| Instruction row enters data range | Parser crashes on non-data rows | `isNoteRow` filters them first |
| Successful batch rolls back due to later failure | User loses committed work | `continueOnBatchFailure: true` (default) |

---

## 8. ENGINE LABEL (for logging/audit)

All engine logs are prefixed with `[AETHER BULK ENGINE V1]` for grep-ability:

```
[AETHER BULK ENGINE V1] Starting run: adapter=migration-product sheet=Produk Non-Varian mode=product_stock
[AETHER BULK ENGINE V1] Parse phase done: 50 valid, 1 note rows filtered, 0 validation failures.
[AETHER BULK ENGINE V1] Batch 1/55: 50 rows
[AETHER BULK ENGINE V1] Batch 1 done: 50 ok / 0 fail / 0 skip (8234ms, 12q)
[AETHER BULK ENGINE V1] Run complete: 55/55 batches ok, 2739 created, 0 updated, 0 skipped, 0 failed (452891ms total)
```

---

## 9. CHANGE LOG

| Date | Change | Commit | Worklog Task ID |
|---|---|---|---|
| 2026-07-23 | Initial lock — engine extracted from migration route (commits 697ff2d + 6996568) | (this commit) | BULK-ENGINE-V1-LOCK |

---

## 10. COMPANION DOCUMENTS

- `docs/ARCHITECTURE-LOCK.md` — Core inventory engine lock (Mode A/B/C/D/E, FEFO, costing, void)
- `docs/PLATFORM-ARCHITECTURE-REVIEW.md` — Platform layers (Migration ingress, Crew, Customer, Settings, Plan)
- `docs/checkpoints/MIGRATION-WIZARD-CHECKPOINT.md` — Migration wizard correctness scenarios
- `src/lib/bulk-engine/adapters/README.md` — Adapter contract + checklist + reference stub
- `src/lib/bulk-engine/adapters/stub.ts` — Working stub adapter (customer-import illustration)

---

## 11. APPROVAL

```
AETHER BULK ENGINE V1: APPROVED
```

The engine pattern is **FROZEN** as the standard bulk import architecture. All new bulk imports MUST use `BulkImportEngine` + adapter. Any deviation requires an Architecture Decision Record (ADR) and a passing regression run on the 6 correctness scenarios.

---

**Lock Date**: 2026-07-23
**Locked By**: Architecture review (post migration-wizard variant optimization, commit `6996568`)
**Regression**: 6 correctness scenarios (3a/3b/4a/4b/5/6) + benchmark thresholds (§6.2)
**Next Review**: Triggered by any P0/P1 finding or new bulk-import module addition
