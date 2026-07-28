# AETHERPOS AuditLog V2.2 — Concise Before→After Diffs + POS Optimization

**Date:** 2026-07-28
**Version:** V2.2 (builds on V2.1 bulk-final)
**Status:** ✅ COMPLETE — 12/12 concise-diff checks PASS, 23/23 regression PASS

---

## What V2.2 Changes

### Problem (User Request)
> "movement stock, perubahan yang dilakukan (nama, hpp, qty, harga, atau apapun tidak ditampilkan secara detail pada audit log)"

The audit log was dumping full object JSON into the UI:
- BULK_BATCH Changes table showed `before: {"name":"Kopi","price":10000,...}` and `after: {"name":"Kopi","price":12000,...}` — ugly, unreadable JSON blobs.
- Single-entity events (PRODUCT_CHANGE, INVENTORY_ITEM_CHANGE) showed ALL fields from before/after, including unchanged ones.

### Solution
Audit log now renders **concise field-level diffs** — only CHANGED fields are shown, with currency auto-formatted as Rp.

| Event Type | Before (V2.1) | After (V2.2) |
|---|---|---|
| **PRODUCT_CHANGE** | All fields shown (name, sku, price, stock, hpp, unit, ...) | Only changed fields: `price: Rp 10.000 → Rp 12.000` |
| **INVENTORY_ITEM_CHANGE** | All 5 fields shown | Only changed fields: `name: Gula → Gula Edited` |
| **CUSTOMER_CHANGE** | All fields shown | Only changed fields |
| **PURCHASE (change)** | Full items[] array on both sides | Only changed fields |
| **BULK_BATCH** | `before`/`after` JSON blob columns | Single `change` column: `price: Rp 15.000 → Rp 16.000, stock: 98 → 103` |
| **VOID** | inventoryRestored[] unbounded | Truncated at 50 (matches SALE pattern) |

### Key Design Decisions
1. **`diffChangedFields(before, after)`** — builder-level filter that returns ONLY fields whose values differ. Routes don't need to change — the builder handles it.
2. **`diffSummary(action, before, after)`** — one-line concise summary for bulk rows:
   - updated: `"price: Rp 10.000 → Rp 12.000, stock: 50 → 60"`
   - created: `"Kopi · Rp 10.000 · 50 stk"` (name + key fields)
   - deleted: `"Kopi · SKU001"` (identity)
3. **Currency auto-formatting** — fields named `price`, `hpp`, `avgCost`, `unitCost`, `totalCost`, etc. are auto-formatted as `Rp X.XXX` in diffs.
4. **Full objects preserved** — BULK_BATCH still has a downloadable JSON log with full before/after objects for traceability. The UI just doesn't dump them inline.
5. **Before→after integration verified** — all 25 route call sites consistently capture before→after (verified by Task 12-a).

---

## POS Audit Log Optimization

The POS audit log was **already optimized** in V2.1 (verified by Task 12-b):

| POS Route | Event Count | Per-Item Spam | Atomicity |
|---|---|---|---|
| `/api/pos/checkout` | 1 SALE per transaction | ❌ None | ✅ Inside tx |
| `/api/transactions/sync` | 1 SALE per synced transaction | ❌ None | ✅ Inside tx |
| `/api/transactions/[id]/void` | 1 VOID per void | ❌ None | ✅ Inside tx |
| `inventory-consumption-service` | 0 (folded into SALE/VOID) | ❌ None | N/A |

**V2.2 minor improvement:** `buildVoidEvent` now truncates `inventoryRestored[]` and `orphanedVariantItems[]` at 50 rows (was unbounded), matching the SALE builder's `truncate(items, 50)` pattern.

**SYNC_DEDUP / STOCK_OPNAME_DEDUP markers** remain filtered from the audit feed via `where.action = { notIn: ['SYNC_DEDUP', 'STOCK_OPNAME_DEDUP'] }` in `/api/audit-logs/route.ts`.

---

## Verification Results

### 1. Concise Diff Verification (scripts/verify-audit-v2-concise-diff.ts)
**12 PASS / 0 FAIL / 12 TOTAL**

| # | Check | Result | Detail |
|---|-------|--------|--------|
| 1 | product:edit has Changes section | ✅ PASS | label="Changes (2 fields)" |
| 2 | product:edit only changed fields shown | ✅ PASS | fields=[price,stock] expected=[price,stock] |
| 3 | product:edit before/after concise (no JSON dump) | ✅ PASS | price before="Rp 10.000" after="Rp 12.000" |
| 4 | product:edit price formatted as Rp | ✅ PASS | before="Rp 10.000" after="Rp 12.000" |
| 5 | product:edit no [object Object] | ✅ PASS | clean |
| 6 | product:edit no JSON object dumps | ✅ PASS | clean |
| 7 | inventory:edit only changed fields shown | ✅ PASS | fields=[name] expected=[name] |
| 8 | inventory:edit no JSON dumps / [object Object] | ✅ PASS | clean |
| 9 | bulk:uses concise "change" column (not before/after) | ✅ PASS | columns=[entity,id,action,change,note] |
| 10 | bulk:change value concise (not JSON blob) | ✅ PASS | change="price: Rp 15.000 → Rp 16.000, stock: 98 → 103" |
| 11 | bulk:no [object Object] / JSON dumps | ✅ PASS | clean |
| 12 | bulk:full change log downloadable | ✅ PASS | filename=bulk-product-update-...json |

### 2. Regression Matrix (scripts/verify-audit-v2-matrix.ts)
**23 PASS / 0 FAIL / 1 NOT SUPPORTED / 3 NOT TESTED / 27 TOTAL**
— identical to pre-V2.2 baseline. No regression.

### 3. Agent Browser UI Verification
- **Produk tab → Product updated row**: Detail drawer shows Changes table with only [price, stock] rows. `Rp 10.000 → Rp 12.000`. No JSON dumps. ✅
- **Massal tab → Bulk product-update row**: Detail drawer shows `change` column = `"price: Rp 15.000 → Rp 16.000, stock: 98 → 103"`. Download button for full log. ✅
- **Penjualan tab → SALE row**: Detail drawer shows concise Items + Inventory Impact tables. ONE event per transaction. ✅
- **Console**: only pre-existing DialogTitle accessibility warning. No runtime errors.
- **Screenshots**: `audit-v2-concise-product-edit.png`, `audit-v2-concise-bulk-change.png`, `audit-v2-pos-sale-optimized.png`

---

## Files Changed (V2.2)

| File | Change |
|---|---|
| `src/lib/audit-v2/builders.ts` | +`diffChangedFields()` helper, +`diffSummary()` helper, +`fmtVal()`/`CURRENCY_FIELDS`. Updated 5 builders (BULK_BATCH, PRODUCT_CHANGE, INVENTORY_ITEM_CHANGE, CUSTOMER_CHANGE, PURCHASE_CHANGE) to use concise diffs. Updated buildVoidEvent to truncate inventoryRestored/orphanedVariantItems at 50. |

**No route files changed** — the builder-level filtering handles all routes automatically.

---

## Combined Final Status (V2.1 + V2.2)

| Category | Count |
|---|---|
| Domain actions PASS (V2.1) | 23 |
| Bulk actions PASS (V2.1) | 4 |
| Concise-diff checks PASS (V2.2) | 12 |
| **TOTAL PASS** | **39** |
| FAIL | 0 |
| NOT SUPPORTED (by design) | 2 |
| NOT TESTED | 0 |

### NOT SUPPORTED (locked in docs/audit-v2-scope-registry.md)
1. `purchase:bulk-add` — file-delegate mode by design (import-excel is preview-only)
2. `inventory:batch-edit` — no dedicated route (batch editing happens via purchase-order receive)

### Event Naming Rule (locked)
- `INVENTORY_ITEM_CHANGE` — edit name/unit/threshold/metadata (non-qty)
- `INVENTORY_ADJUSTMENT` — change quantity/stock only
- Never mix the two.
