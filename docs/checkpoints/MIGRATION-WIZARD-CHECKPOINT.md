# Migration Wizard — Enterprise Upload Capacity Checkpoint

**Last Updated**: 2026-07-23
**Status**: ✅ PASS — Enterprise unlimited upload capacity restored

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
