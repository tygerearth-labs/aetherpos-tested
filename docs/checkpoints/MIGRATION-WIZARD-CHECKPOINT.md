# Migration Wizard — Enterprise Upload Capacity + Safe Batch Processing Checkpoint

**Last Updated**: 2026-07-23 (Batch Rewrite update)
**Status**: ✅ PASS — Enterprise unlimited upload capacity + safe 50-row sequential batch processing with PARTIAL failure UX

---

## Scope of This Checkpoint

This checkpoint documents the **Migration Wizard Enterprise upload capacity fix**.
It covers ONLY:

- `src/app/api/migration/import/route.ts` — plan resolution + row limit enforcement
- Supporting DB setup (Plan table rows — webmaster authoritative)

**Out of scope** (explicitly NOT modified by this fix):
- `src/app/api/products/bulk-upload/route.ts`
- `src/app/api/products/bulk-update-excel/route.ts`
- `src/lib/config/plan-config.ts` (static PLANS matrix unchanged)
- `prisma/schema.prisma` (Prisma schema unchanged)
- Inventory engine / FEFO / HPP (core inventory contract honored)
- Migration mapping logic (sheet detection, column mapping, composition linking)
- Product page UX
- Unrelated plan routes

---

## Problem Statement

The Migration Wizard's `POST /api/migration/import` route had two compounding bugs that
prevented Enterprise plans from uploading more than 500 rows per migration:

### Bug 1: Static-only plan resolution (ignored webmaster DB overrides)

The route used `getOutletPlan(outletId, db)` from `plan-config.ts`, which resolves
plan features from the **static `PLANS` matrix only** — it does NOT consult the
`Plan` table in the database. This meant webmaster-configured `maxBulkUploadRows`
overrides (set via the Command Center admin UI at `/api/webmaster/plans`) were
silently ignored by the Migration Wizard.

**Result**: Enterprise was always capped at `PLANS.enterprise.maxBulkUploadRows = 500`
(the static value), regardless of what the webmaster set in the DB.

### Bug 2: Independent per-sheet `MAX_ROWS = 5000` truncation

Even when the plan limit was unlimited (or ≥ 5000), the route independently
truncated each sheet at 5000 rows via `rows.splice(MAX_ROWS)` — silently dropping
rows beyond 5000 without any error. This was a secondary cap that bypassed the
plan-aware limit enforcement.

**Result**: Even if Bug 1 were fixed (Enterprise = unlimited), a 10000-row sheet
would be silently truncated to 5000 rows — productsCreated would be 5000, not 10000.

---

## Fix Applied

### Source of Truth

**Webmaster Plan DB settings are authoritative** for the Migration Wizard.
The route now uses `getFeaturesForOutlet(db, outletId)` which merges
`Plan` table features over static `PLANS` defaults — DB overrides win.

### Changes to `src/app/api/migration/import/route.ts`

1. **Import swap** (line 5):
   - Before: `import { getOutletPlan, isUnlimited } from '@/lib/config/plan-config'`
   - After:  `import { getFeaturesForOutlet, isUnlimited } from '@/lib/config/plan-config'`

2. **Plan resolution swap** (line ~362):
   - Before: `const outletPlan = await getOutletPlan(outletId, db)`
   - After:  `const outletPlan = await getFeaturesForOutlet(db, outletId)`
   - Note: `outletPlan.features.*` access is unchanged (both return `{ features, ... }`).
     The `.plan` field from `getOutletPlan` was never used by this route.

3. **Removed `MAX_ROWS = 5000` constant** (was line 13):
   - No longer needed — no per-sheet truncation.

4. **Removed per-sheet truncation block** (was lines 606-609):
   - Before: `if (rows.length > MAX_ROWS) { errors.push("...dipotong..."); rows.splice(MAX_ROWS) }`
   - After:  Removed entirely. Unlimited Enterprise plans process all rows as-is.
   - The effective plan limit (DB-aware, -1 = unlimited) is enforced BEFORE the
     transaction starts (at line ~428), so limited plans are rejected before any
     row is processed.

5. **Plan limit enforcement** (line ~428):
   - Before: `if (!isUnlimited(planMaxRows) && planMaxRows > 0 && totalSheetRows > planMaxRows)`
   - After:  `if (!isUnlimited(planMaxRows) && planMaxRows >= 0 && totalSheetRows > planMaxRows)`
   - Changed `> 0` to `>= 0` so Free plans (maxBulkUploadRows = 0) are also caught
     here as a defense-in-depth (Free is already blocked by the `bulkUpload` gate
     at line ~368, but this makes the row-limit check self-contained).

6. **Transaction timeout bump** (line ~1470):
   - Before: `timeout: 120000` (2 minutes)
   - After:  `timeout: 270000` (4.5 minutes)
   - Enterprise is now unlimited, so imports can exceed the old 500-row cap.
     270s fits within the route's `maxDuration = 300` (5 min) with 30s buffer for
     audit log + response serialization.

7. **Response enrichment** (line ~1505):
   - Added `totalInputRows: totalSheetRows` — the total row count across all
     processed sheets (founder requirement: "Return actual productsCreated and
     total input rows").
   - Added `effectiveMaxBulkUploadRows: planMaxRows` — the DB-resolved plan limit
     (-1, 0, or positive), for client-side transparency.

### DB Setup (webmaster Plan table — authoritative)

The Plan table was populated to simulate webmaster configuration via the
Command Center admin UI. This is **data**, not schema — `prisma/schema.prisma`
was NOT modified.

| slug        | maxBulkUploadRows | Source         |
|-------------|-------------------|----------------|
| free        | 0                 | DB (explicit)  |
| pro         | 200               | DB (explicit)  |
| enterprise  | -1 (unlimited)    | DB (webmaster override; static was 500) |

Free and Pro retain their configured limits. Enterprise is unlimited via the
webmaster DB override.

---

## Verification Results

All 4 founder-specified verification tests PASSED.

### Test 1: Enterprise + 5001-row sheet (not rejected or truncated)

- **File**: `/tmp/test-enterprise-5001.xlsx` (5001 valid product rows, sheet "Produk Non-Varian")
- **Mode**: `product_only`
- **Outlet**: `accountType = enterprise`, DB `maxBulkUploadRows = -1`
- **HTTP**: `200`
- **Response**:
  - `totalInputRows: 5001` ✅ (not rejected)
  - `productsCreated: 5001` ✅ (all rows processed)
  - `effectiveMaxBulkUploadRows: -1` ✅ (DB value read correctly)
  - `errors: []` ✅ (no "dipotong" truncation error)
- **Duration**: 8.1s
- **PASS** ✅

### Test 2: Enterprise + 10000-row sheet (counted as 10000, not 5000)

- **File**: `/tmp/test-enterprise-10000.xlsx` (10000 valid product rows)
- **Mode**: `product_only`
- **Outlet**: `accountType = enterprise`, DB `maxBulkUploadRows = -1`
- **HTTP**: `200`
- **Response**:
  - `totalInputRows: 10000` ✅ (counted as 10000, NOT 5000)
  - `productsCreated: 10000` ✅ (all rows created — no silent truncation)
  - `effectiveMaxBulkUploadRows: -1` ✅
  - `errors: []` ✅ (no "dipotong")
- **Duration**: 14.7s
- **PASS** ✅

### Test 3: Pro + 201-row sheet (rejected before processing)

- **File**: `/tmp/test-pro-201.xlsx` (201 valid product rows)
- **Mode**: `product_only`
- **Outlet**: `accountType = pro` (temporarily switched), DB `maxBulkUploadRows = 200`
- **HTTP**: `403`
- **Response**: `{ "error": "Migrasi melebihi batas baris paket Anda (200 baris). Silakan upgrade paket." }` ✅
- **Duration**: 15ms (rejected before transaction — no rows processed)
- **PASS** ✅

### Test 4: Response returns actual productsCreated and totalInputRows

- Confirmed in Tests 1 and 2: both `productsCreated` and `totalInputRows` are
  present in the success response, with correct values matching input.
- **PASS** ✅

### Post-test cleanup

- 15001 test products (SKU prefixes `SKU-E5K-`, `SKU-E10K-`, `SKU-PRO-`) deleted.
- Outlet restored to `accountType = enterprise`.
- 3 original products remain.

---

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/migration/import/route.ts` | DB-aware plan resolution, removed MAX_ROWS truncation, bumped tx timeout, enriched response |

**No other files modified.** Specifically NOT modified:
- `src/app/api/products/bulk-upload/route.ts` ❌ (founder constraint)
- `src/app/api/products/bulk-update-excel/route.ts` ❌ (founder constraint)
- `src/lib/config/plan-config.ts` ❌ (founder constraint — static values unchanged)
- `prisma/schema.prisma` ❌ (founder constraint)
- Inventory engine / FEFO / HPP ❌ (founder constraint — core contract honored)
- Migration mapping ❌ (founder constraint)
- Product page UX ❌ (founder constraint)
- Unrelated plan routes ❌ (founder constraint)

---

## Lint

`bun run lint` → 0 errors, 0 warnings. ✅

---

## Architecture Lock Compliance

Per `docs/ARCHITECTURE-LOCK.md`, the Migration Wizard is explicitly **out of scope**
for the core inventory contract lock (it is a platform layer that "may evolve
independently as long as they continue to honor the core inventory contract").

This fix touches ONLY:
- Plan resolution (which `getFeaturesForOutlet` to call)
- Row count limit enforcement (DB-aware, -1 = unlimited)
- Per-sheet truncation removal
- Transaction timeout
- Response shape

It does NOT touch:
- `InventoryConsumptionService` ❌
- `FEFOEngine` ❌
- `Product.stock` / `Product.hpp` semantics ❌
- Void contract ❌

**Compliant.** ✅

---

# MIG-BATCH-REWRITE — Plan Enforcement + Safe Batch Processing + Partial Failure UX

**Date**: 2026-07-23
**Status**: ✅ PASS — All 12 backend requirements + 6 frontend UX requirements implemented and verified

---

## Problem Statement

The Migration Wizard's `POST /api/migration/import` route wrapped the entire
import (potentially thousands of rows) in a single `db.$transaction` with a
120s timeout. This caused:

1. **No plan product-quota enforcement** — `maxProducts` (Free=50, Pro/Enterprise=-1)
   was not checked before processing. A Free user could upload 5000 products,
   blowing past their plan limit.
2. **All-or-nothing atomicity** — one technical failure (DB timeout, unique
   constraint, OOM) rolled back the entire import. A 10000-row upload that
   failed at row 9999 lost all 9998 successfully-created products.
3. **Fake client-side progress** — `migration-wizard.tsx` used `setTimeout`
   theater to animate steps (Upload → Proses → Simpan → Selesai) that did
   not reflect actual server state.
4. **No resume capability** — after a failure, the only option was to re-upload
   the entire file. The dedup-by-name check prevented duplicate products, but
   the user had no UI signal that re-uploading was safe.
5. **No per-row error visibility** — invalid rows were silently skipped
   (`errors.push("Baris N: ...")`) but the user only saw a count, not which
   rows failed or why.

## Founder Requirements (12 backend + 6 frontend)

### Backend (12)

1. ✅ Read effective `maxProducts` from `Prisma.Plan.features` (DB-aware).
2. ✅ Count currently-active products (`db.product.count`).
3. ✅ Count only the **unique new product records** that will actually be created
   (dedup by name → excludes already-existing products from the new count).
4. ✅ Exclude duplicates that will be skipped from the projected total.
5. ✅ Reject with 403 BEFORE any write if `currentCount + uniqueNew > maxProducts`.
6. ✅ Split allowed products into sequential batches of `BATCH_SIZE = 50`.
7. ✅ Each batch in its own `db.$transaction` (independent commit/rollback).
8. ✅ Product, InventoryItem, composition, opening-stock all aligned to the
   correct product batch (cross-batch state shared via closures outside tx).
9. ✅ Never silently truncate rows (no `rows.splice(MAX_ROWS)`).
10. ✅ Preserve existing dedup behavior (skip-if-name-exists).
11. ✅ Retry does not create duplicate products (dedup is name-based, so
    re-uploading completed batches is a no-op).
12. ✅ Technical batch failure stops processing subsequent batches (sets
    `batchFailed = true; break`).

### Frontend (6)

1. ✅ Removed fake `simulateProcessing()` setTimeout theater.
2. ✅ Real progress shown via completed-batches breakdown
   (`{completedBatches} / {totalBatches} batch selesai`).
3. ✅ Per-row validation errors rendered with row number + reason in a
   scrollable list (max-h-32).
4. ✅ Technical batch failure: completed batches preserved, only the failing
   batch rolled back, subsequent batches NOT processed.
5. ✅ Three action buttons on PARTIAL/FAILED:
   - **Lanjutkan Migrasi** — re-POSTs same file with `startBatch=completedBatches`
   - **Unduh Daftar Error** — downloads `.txt` of all per-row errors
   - **Tutup** — closes the wizard
6. ✅ Resume is dedup-safe: `handleResume()` calls `handleUpload(completedBatches)`
   which appends `startBatch` to the FormData. The server's existing name-based
   dedup ensures already-created products are skipped (no duplicates).

## Required Response Shape (now returned by route)

```ts
{
  // Existing fields
  productsCreated, productsSkipped, variantsCreated, totalCategories,
  barcodeCount, errors, warnings, inventoryItemsCreated, ...
  // MIG-BATCH fields
  status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'PARTIAL' | 'FAILED',
  totalProducts: number,         // total rows that will be processed
  totalBatches: number,          // ceil(totalProducts / 50)
  completedBatches: number,      // batches that committed successfully
  currentBatch: number,          // last batch attempted (failed or succeeded)
  failedRows: number,            // per-row validation errors count
  remainingProducts: number,     // totalProducts - (completedBatches * 50)
  effectiveMaxProducts: number,  // from Plan.features (DB-aware, -1 = unlimited)
  startBatch: number,            // echo of the request's startBatch param
  batchError: string | null,     // error message from the failed batch (if any)
}
```

## Status Determination Logic

```ts
type MigrationStatus = 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'PARTIAL' | 'FAILED'

if (batchFailed) {
  status = (completedBatches > 0 || productsCreated > 0) ? 'PARTIAL' : 'FAILED'
} else if (errors.length > 0) {
  status = 'COMPLETED_WITH_ERRORS'
} else {
  status = 'COMPLETED'
}
```

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/migration/import/route.ts` | Pre-flight maxProducts quota check + 50-row sequential batch processing in independent transactions + startBatch resume support + status determination + enriched response shape |
| `src/components/migration/migration-wizard.tsx` | Removed `simulateProcessing()` fake progress + real batch progress breakdown + PARTIAL/FAILED status UX with 3 action buttons + per-row error list with download + resume handler |
| `src/components/migration/migration-banner.tsx` | Added `MigrationStatus` type export + extended `ImportResult` interface with MIG-BATCH fields |

**Not modified** (per founder constraint):
- `src/lib/config/plan-config.ts` ❌
- `prisma/schema.prisma` ❌
- Inventory engine / FEFO / HPP / void contract ❌
- `src/app/api/products/bulk-upload/route.ts` ❌
- `src/app/api/products/bulk-update-excel/route.ts` ❌
- Product page UX ❌

## Verification Results (4 end-to-end tests + 2 browser-verified UI states)

All 4 backend tests + 2 UI states PASSED.

### Backend TEST 1: Smoke (120 rows / Enterprise)

- File: `/tmp/test-batch-120.xlsx` (120 unique products, sheet "Produk Non-Varian")
- Mode: `product_only`, Outlet: `enterprise`, DB `maxProducts = -1`
- HTTP: 200 (447ms)
- Response:
  - `status: COMPLETED` ✅
  - `totalProducts: 120`, `totalBatches: 3`, `completedBatches: 3` ✅
  - `productsCreated: 120`, `productsSkipped: 0`, `failedRows: 0` ✅
  - `remainingProducts: 0`, `batchError: null` ✅
- DB diff: +120 (matches productsCreated) ✅
- **PASS** ✅

### Backend TEST 2: Dedup / resume safety (re-upload same 120-row file)

- File: same `/tmp/test-batch-120.xlsx`, `startBatch=0`
- HTTP: 200
- Response:
  - `status: COMPLETED` ✅
  - `productsCreated: 0` ✅ (no duplicates created)
  - `productsSkipped: 120` ✅ (all skipped as existing)
- DB diff: 0 ✅ (DB unchanged)
- **PASS** ✅ — proves resume is safe: re-sending completed batches = no duplicates

### Backend TEST 3: Quota rejection (Free plan, maxProducts=50)

- File: `/tmp/test-quota-48.xlsx` (48 new products)
- Outlet: `free`, DB `maxProducts = 50`, `maxBulkUploadRows = 1000` (to isolate
  the maxProducts check from the maxBulkUploadRows check)
- Existing products: 123 (left over from TEST 1+2, prior to cleanup)
- Projected total: 123 + 48 = 171 > 50 → must reject
- HTTP: 403 ✅
- Response: `{"error":"Batas produk tercapai. Produk saat ini: 123 + produk baru unik: 48 = 171, melebihi batas paket (50). Silakan upgrade paket."}` ✅
- DB diff: 0 ✅ (rejected BEFORE any write)
- **PASS** ✅ — pre-flight quota enforcement works

### Backend TEST 4: Partial failure (force batch 2 fail)

- File: `/tmp/test-batch-120.xlsx`, env `MIG_FORCE_FAIL_BATCH=1`
- Expected: batch 1 (50 rows) commits, batch 2 throws → rolled back, batch 3 NOT run
- HTTP: 200
- Response:
  - `status: PARTIAL` ✅
  - `totalBatches: 3`, `completedBatches: 1` ✅
  - `productsCreated: 50`, `remainingProducts: 70` ✅
  - `batchError: "FORCED_FAIL: batch 2 (test hook)"` ✅
- DB diff: +50 ✅ (batch 1 preserved, batch 2 rolled back, batch 3 not run)
- **PASS** ✅

### UI State 1: COMPLETED (browser-verified)

- Wizard flow: Dashboard → "Import Sekarang" → "Produk Saja" → upload → "Mulai Import"
- Result dialog rendered with:
  - Title: "Import Berhasil"
  - Status badge: "120 item berhasil diimport"
  - **Progress Batch** section with 4 stats: Dibuat=120, Dilewati (duplikat)=0, Gagal=0, Sisa=(empty)
  - Caption: "Batch 3 / 3 selesai · 120 total produk"
  - Stats grid: 120 Produk, 0 Varian, 1 Kategori, 120 Barcode
  - Primary CTA: "Mulai Berjualan"
- Screenshot: `/tmp/mig-completed.png`
- **PASS** ✅

### UI State 2: PARTIAL (browser-verified)

- Wizard flow: same as above, but with `MIG_FORCE_FAIL_BATCH=1` set on server
- Result dialog rendered with:
  - Title: "Migrasi Sebagian Berhasil" (amber)
  - Status badge: "1 dari 3 batch selesai" (amber)
  - **Progress Batch** section: Dibuat=50, Dilewati=0, Gagal=0, Sisa=70
  - Caption: "Batch 1 / 3 selesai · 120 total produk"
  - **Batch Gagal** warning card: "FORCED_FAIL: batch 2 (test hook)"
  - Subtext: "Batch dibuat: 50, Sisa: 70"
  - Action buttons: **Lanjutkan Migrasi (dari batch 1)** + **Tutup**
  - (Unduh Daftar Error hidden because `hasErrors = false` — correct,
    only per-row errors trigger the download button)
- Screenshot: `/tmp/mig-partial.png`
- **PASS** ✅

### Post-test cleanup

- 120 BT- test products deleted.
- 3 original products restored from backup.
- Outlet restored to `accountType = enterprise`.
- Free plan `maxBulkUploadRows` restored to 0.
- All temporary test scripts removed from repo.
- DB state verified: 3 original products, outlet=enterprise, plans intact.

## Lint

`bun run lint` → 0 errors, 0 warnings on `src/` (only the now-deleted temporary
test scripts had `no-require-imports` errors). ✅

## Architecture Lock Compliance

Per `docs/ARCHITECTURE-LOCK.md`, the Migration Wizard is explicitly **out of scope**
for the core inventory contract lock.

This rewrite touches ONLY:
- Plan quota enforcement (pre-flight maxProducts check)
- Batch transaction boundaries (50 rows per tx, sequential)
- Resume support (startBatch param)
- Response shape (status + batch progress fields)
- Frontend UX (real progress, PARTIAL UX, 3 buttons, resume)

It does NOT touch:
- `InventoryConsumptionService` ❌
- `FEFOEngine` ❌
- `Product.stock` / `Product.hpp` semantics ❌
- Void contract ❌

**Compliant.** ✅
