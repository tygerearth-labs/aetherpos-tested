# AETHER AUDIT LOG V2 — LOCK (v2.3)

> **Scope**: Event-oriented AuditLog V2 system ONLY (`src/lib/audit-v2/*`, the `AuditLog` Prisma model, all emitters in `src/app/api/**`, the audit-log UI page, and the CSV/JSON export endpoints).
> **Out of Scope**: Core inventory engine invariants (see `docs/ARCHITECTURE-LOCK.md`); bulk-engine adapter contract (see `governance/AETHER-BULK-ENGINE-V1.md`); platform-layer audit coverage (see `docs/audit-v2-scope-registry.md`).
> **Architecture Lock Date**: 2026-07-29
> **Status**: APPROVED
> **Companion Documents**: `docs/ARCHITECTURE-LOCK.md` §12 (Auditability), `docs/audit-v2-scope-registry.md` (per-domain scope), `governance/AETHER-BULK-ENGINE-V1.md` (bulk adapter pattern)
> **Regression Command**: `bun run lint` + manual flow verification (audit-v2 has no standalone invariant suite; correctness is enforced by code-review + the spam-suppression rules in §6)

---

## 0. LOCK STATEMENT

The Aether POS **AuditLog V2** system is the single, event-oriented audit surface for the application. It replaces the V1 pattern of "one audit row per technical write" with "**one audit row per meaningful user/business action**". The architecture, event taxonomy, emit contract, UI rendering contract, and spam-suppression rules documented here are **FROZEN** as the baseline.

The core invariant is:

> **ONE user action = ONE AuditLog row.**

Any change to the contracts documented here requires an explicit Architecture Decision Record (ADR), a review of every emitter listed in §5, and a re-verification of the spam-suppression rules in §6.

---

## 1. CORE PRINCIPLE — ONE ACTION = ONE ROW

The V1 audit system produced one audit row per database write. A checkout of 5 items produced 5 `RESTOCK` rows + 1 `SALE` row + 5 `COMPOSITION_DEDUCT` rows = 11 rows for a single user action. This made the audit log unreadable and hid real business events behind technical noise.

V2 fixes this by collapsing every multi-write user action into a **single** structured event:

| User Action | V1 Row Count | V2 Row Count | Event Type |
|---|---|---|---|
| POS checkout (5 items) | 11 | **1** | `SALE` |
| Void a transaction (5 items) | 11 | **1** | `VOID` |
| Excel migration (50 products) | 50+ | **1** | `MIGRATION_BATCH` |
| Bulk product upload (50 products) | 50+ | **1** | `BULK_BATCH` |
| Bulk product delete (K products) | K | **1** | `BULK_BATCH` (`adapterKind='product-delete'`) |
| Bulk category delete (K categories) | K | **1** | `BULK_BATCH` (`adapterKind='category-delete'`) |
| Bulk inventory item delete (K items) | K | **1** | `BULK_BATCH` (`adapterKind='inventory-delete'`) |
| Single product create/edit/delete | 1 | **1** | `PRODUCT_CHANGE` |
| Single category create/edit/delete | 1 | **1** | `PRODUCT_CATEGORY_CHANGE` |
| Purchase create/edit/delete | 1 | **1** | `PURCHASE` |

**The per-row detail is NOT lost** — it is captured in the event's `sections` array (Summary + Changes + Inventory Impact + Errors + Skipped + Metadata). The UI renders these as grouped tables inside a single detail drawer, with full JSON available for download when a section exceeds the truncation limit.

---

## 2. EVENT TYPE REGISTRY (LOCKED)

The `EventType` enum in `src/lib/audit-v2/types.ts` is the single source of truth for supported event types. **No event type may be added, removed, merged, or renamed without an ADR.**

| # | EventType | Domain | Cardinality | Builder |
|---|---|---|---|---|
| 1 | `SALE` | POS | 1 per transaction | `buildSaleEvent` |
| 2 | `VOID` | POS | 1 per voided transaction | `buildVoidEvent` |
| 3 | `PURCHASE` | Purchase | 1 per purchase document (create/edit/cancel/delete/bulk-edit) | `buildPurchaseEvent` / `buildPurchaseChangeEvent` |
| 4 | `INVENTORY_ADJUSTMENT` | Inventory | 1 per stock-quantity mutation (adjust, restock, composition-sync recovery) | `buildInventoryAdjustmentEvent` |
| 5 | `INVENTORY_ITEM_CHANGE` | Inventory | 1 per non-quantity item edit (name/unit/threshold/avgCost/archive/restore) | `buildInventoryItemChangeEvent` |
| 6 | `COMPOSITION_UPDATE` | Composition | 1 per product composition save | `buildCompositionUpdateEvent` |
| 7 | `CUSTOMER_CHANGE` | Customer | 1 per customer mutation (create/edit/delete/merge/loyalty) | `buildCustomerChangeEvent` |
| 8 | `PRODUCT_CHANGE` | Product | 1 per manual product mutation (create/edit/delete) | `buildProductChangeEvent` |
| 9 | `PRODUCT_CATEGORY_CHANGE` | Product Catalog | 1 per single-category create/update/delete | `buildProductCategoryChangeEvent` |
| 10 | `INVENTORY_CATEGORY_CHANGE` | Inventory Catalog | 1 per single-inventory-category create/update/delete | `buildInventoryCategoryChangeEvent` |
| 11 | `SUPPLIER_CHANGE` | Supplier | 1 per supplier mutation | `buildSupplierChangeEvent` |
| 12 | `CREW_CHANGE` | Crew | 1 per crew mutation | `buildCrewChangeEvent` |
| 13 | `PROMO_CHANGE` | Promo | 1 per promo mutation | `buildPromoChangeEvent` |
| 14 | `OUTLET_CHANGE` | Multi-Outlet | 1 per outlet mutation | `buildOutletChangeEvent` |
| 15 | `MIGRATION_BATCH` | Migration | 1 per migration batch (Excel import) | `buildMigrationBatchEvent` |
| 16 | `BULK_BATCH` | Bulk Engine | 1 per bulk-operation batch (the idempotency marker) | `buildBulkBatchEvent` |
| 17 | `LEGACY` | (legacy) | 1 per un-converted V1 caller | (none — raw V1 write) |

### Event Naming Separation (LOCKED — do not merge)

The split between `INVENTORY_ITEM_CHANGE` and `INVENTORY_ADJUSTMENT` is **intentional**:

- **`INVENTORY_ADJUSTMENT`** — mutation changes `stock` / `remainingQty` (material financial impact).
- **`INVENTORY_ITEM_CHANGE`** — mutation changes catalog metadata only (no quantity delta).

**Rule**: If the mutation changes `stock` or `remainingQty` → `INVENTORY_ADJUSTMENT`. Otherwise → `INVENTORY_ITEM_CHANGE`. Never force a non-quantity edit into `INVENTORY_ADJUSTMENT` just to fill a matrix cell.

See `docs/audit-v2-scope-registry.md` for the full per-domain scope matrix and the NOT SUPPORTED decisions (purchase:bulk-add, inventory:batch-edit).

---

## 3. AUDITLOG SCHEMA (LOCKED)

The `AuditLog` Prisma model (`prisma/schema.prisma:286-315`) carries both V1 mirror fields and V2 event-oriented fields. The V1 fields are **kept** because legacy readers (bulk-engine `findMarker`, void dedup, sync dedup) parse the `details` / `action` / `entityType` columns directly. The V2 emitter (`serializeEvent` in `emit.ts`) mirrors every V2 event into the V1 columns so legacy readers keep working.

```
model AuditLog {
  id          String   @id @default(cuid())

  // --- V1 mirror (kept; populated by serializeEvent) ---
  action      String               // = ev.action ?? ev.eventType
  entityType  String               // = ev.entityType ?? ev.sourceEntityType ?? 'UNKNOWN'
  entityId    String?              // = ev.entityId ?? ev.sourceEntityId ?? ev.operationId
  details     String?              // = ev.v1Details ?? compact JSON {eventType, title, summary, ...metadata}

  // --- V2 event-oriented ---
  eventType   String?              // EventType.* (see §2)
  title       String?              // concise human title
  summary     String?              // one-line business summary
  sections    String?              // JSON: AuditSection[] (grouped detail)
  metadata    String?              // JSON: free-form structured metadata
  operationId String?              // idempotency / correlation id
  sourceEntityType String?         // PRODUCT | TRANSACTION | PURCHASE_ORDER | ...
  sourceEntityId   String?         // id of the primary source entity

  outletId    String
  userId      String
  createdAt   DateTime @default(now())

  @@index([outletId, createdAt])
  @@index([outletId, eventType, createdAt])
  @@index([operationId])
}
```

### Field Non-Negotiables

- `outletId` and `userId` are **required** (never null). Every audit event is scoped to an outlet and attributed to a user.
- `eventType`, `title`, `summary` are **nullable for legacy rows only**. Every V2 emitter MUST populate all three.
- `sections` is a JSON string of `AuditSection[]`. Each section has `type`, `label`, optional `fields`/`items`, optional `tone`, `collapsed`, `columns`, `download`.
- `metadata` is a JSON string of a free-form object. Used for machine-readable fields that don't fit the human-readable `sections`.
- `operationId` is the idempotency key for bulk/migration/sync events. The `@@index([operationId])` supports the bulk-engine `findMarker` lookup.

---

## 4. EMIT CONTRACT (LOCKED)

Two emit modes, defined in `src/lib/audit-v2/emit.ts`:

### 4.1 Transactional — `emitAuditEvent(tx, event)`

**Use**: INSIDE `db.$transaction(async (tx) => { ... })`.

The audit row commits in the **same transaction** as the domain mutation. This guarantees:
- **Atomicity** — if the mutation rolls back, no orphan audit row is left behind.
- **Idempotency** — the audit row is part of the same atomic unit as the mutation it describes.

```typescript
await db.$transaction(async (tx) => {
  await tx.transaction.create({ ... })
  await emitAuditEvent(tx, buildSaleEvent({ ... }))
})
```

**This is the preferred emit mode.** Every mutation that touches a single transaction MUST use it.

### 4.2 Non-transactional — `safeEmitAuditEvent(event)`

**Use**: AFTER a transaction commits (when the audit row must not be inside an already-committed tx).

```typescript
await db.$transaction(async (tx) => { ... })  // commits
await safeEmitAuditEvent(buildMigrationBatchEvent({ ... }))
```

**Never throws** — audit is non-critical, so a logging failure is logged via `console.warn` and swallowed. This is a deliberate defense-in-depth tradeoff: the main operation must never fail because of an audit-write error.

### 4.3 Value Formatting — `toDisplay()`

Every value that flows into `AuditField.v` or `AuditItem` values MUST go through `toDisplay()` (in `emit.ts`). This is the **single source of truth** for value formatting and guarantees the UI can NEVER render `[object Object]`:

- `null` / `undefined` → `''`
- `string` / `number` / `boolean` → `String(v)`
- `Date` → ISO string
- `object` / `array` → `JSON.stringify` (falls back to `String(v)` on failure)

Builders MUST use the `field()` / `fields()` helpers (which call `toDisplay` internally) — never inline raw objects into `AuditField.v`.

---

## 5. EMITTER REGISTRY (LOCKED — 39 routes)

Every `emitAuditEvent` / `safeEmitAuditEvent` call site is listed here. **Adding a new emitter requires updating this registry.** Removing or changing an emitter's event type requires an ADR.

### POS (2 emitters)
| Route | Event | Mode |
|---|---|---|
| `api/pos/checkout/route.ts` | `SALE` | transactional |
| `api/transactions/[id]/void/route.ts` | `VOID` | transactional |
| `api/transactions/sync/route.ts` | `SALE` (offline→online sync) | transactional |

### Purchase (3 emitters)
| Route | Event | Mode |
|---|---|---|
| `api/purchases/route.ts` | `PURCHASE` (created) | transactional |
| `api/purchases/[id]/route.ts` | `PURCHASE` (updated / cancelled / deleted) | transactional |
| `api/purchases/bulk-update-excel/route.ts` | `PURCHASE` × N (one per PO document — NOT one BULK_BATCH) | transactional |

### Inventory (8 emitters)
| Route | Event | Mode |
|---|---|---|
| `api/inventory/items/route.ts` | `INVENTORY_ITEM_CHANGE` (created) | transactional |
| `api/inventory/items/[id]/route.ts` | `INVENTORY_ITEM_CHANGE` (updated / archived / restored / deleted) | transactional |
| `api/inventory/items/[id]/adjust/route.ts` | `INVENTORY_ADJUSTMENT` | transactional |
| `api/inventory/items/bulk/route.ts` | `BULK_BATCH` (`adapterKind='inventory-bulk'`) | transactional |
| `api/inventory/items/bulk-category/route.ts` | `BULK_BATCH` (`adapterKind='inventory-category'`) | transactional |
| `api/inventory/items/bulk-delete/route.ts` | `BULK_BATCH` (`adapterKind='inventory-delete'`) | transactional |
| `api/inventory/items/bulk-update-excel/route.ts` | `BULK_BATCH` (`adapterKind='inventory-edit'`) | transactional |
| `api/inventory/composition-sync/route.ts` | `INVENTORY_ADJUSTMENT` (recovery) | transactional |
| `api/inventory/stock-opname/complete.ts` | `INVENTORY_ADJUSTMENT` | transactional |

### Inventory Categories (2 emitters)
| Route | Event | Mode |
|---|---|---|
| `api/inventory/categories/route.ts` | `INVENTORY_CATEGORY_CHANGE` (created) | transactional |
| `api/inventory/categories/[id]/route.ts` | `INVENTORY_CATEGORY_CHANGE` (updated / deleted) | transactional |

### Product (8 emitters)
| Route | Event | Mode |
|---|---|---|
| `api/products/route.ts` | `PRODUCT_CHANGE` (created) | transactional |
| `api/products/[id]/route.ts` | `PRODUCT_CHANGE` (updated / deleted) | transactional |
| `api/products/[id]/composition/route.ts` | `COMPOSITION_UPDATE` | transactional |
| `api/products/[id]/variants/route.ts` | `PRODUCT_CHANGE` (variant create/edit/delete) | transactional |
| `api/products/bulk-upload/route.ts` | `BULK_BATCH` (`adapterKind='product-add'`) | transactional |
| `api/products/bulk-update/route.ts` | `BULK_BATCH` (`adapterKind='product-update'`) | transactional |
| `api/products/bulk-update-excel/route.ts` | `BULK_BATCH` (`adapterKind='product-edit'`) | transactional |
| `api/products/bulk-delete/route.ts` | `BULK_BATCH` (`adapterKind='product-delete'`) | transactional |

### Product Categories (2 emitters)
| Route | Event | Mode |
|---|---|---|
| `api/categories/route.ts` | `PRODUCT_CATEGORY_CHANGE` (created) | transactional |
| `api/categories/[id]/route.ts` | `PRODUCT_CATEGORY_CHANGE` (updated / deleted — single only) | transactional |
| `api/categories/bulk-delete/route.ts` | `BULK_BATCH` (`adapterKind='category-delete'`) | transactional |

### Customer (4 emitters)
| Route | Event | Mode |
|---|---|---|
| `api/customers/route.ts` | `CUSTOMER_CHANGE` (created) | transactional |
| `api/customers/[id]/route.ts` | `CUSTOMER_CHANGE` (updated / deleted) | transactional |
| `api/customers/merge/route.ts` | `CUSTOMER_CHANGE` (merge) | transactional |
| `api/customers/[id]/loyalty/adjust/route.ts` | `CUSTOMER_CHANGE` (loyalty) | transactional |

### Migration (1 emitter)
| Route | Event | Mode |
|---|---|---|
| `api/migration/import/route.ts` | `MIGRATION_BATCH` | safeEmit (post-tx) |

### Bulk Engine (1 emitter)
| Route | Event | Mode |
|---|---|---|
| `api/bulk-engine/execute/route.ts` | `BULK_BATCH` (per-batch idempotency marker) | safeEmit (post-tx) |
| `api/bulk-engine/delegate/purchase/route.ts` | `BULK_BATCH` (`adapterKind='purchase:add'`) | safeEmit |

### Platform — Supplier / Crew / Promo / Outlet (4 emitters)
| Route | Event | Mode |
|---|---|---|
| `api/suppliers/[id]/route.ts` | `SUPPLIER_CHANGE` | transactional |
| `api/multi-outlet/crew/[id]/route.ts` | `CREW_CHANGE` | transactional |
| `api/outlet/crew/[id]/route.ts` | `CREW_CHANGE` | transactional |
| `api/settings/promos/[id]/route.ts` | `PROMO_CHANGE` | transactional |
| `api/outlet-group/outlets/route.ts` | `OUTLET_CHANGE` | transactional |

**Total: 39 transactional + 14 non-transactional (safeEmit) call sites across 38 route files.**

> Note: `safeEmitAuditEvent` count includes internal helper callsites in `src/lib/actions/transactions.ts` and `src/lib/safe-audit.ts` (legacy bridge).

---

## 6. SPAM-SUPPRESSION RULES (LOCKED — the heart of V2)

These rules are the difference between V1 (unreadable noise) and V2 (one row per action). **Every emitter MUST obey them.** Violating any rule is a P1 regression.

### Rule 6.1 — No per-row audit inside a loop

A bulk operation that touches K entities MUST emit exactly **ONE** `BULK_BATCH` event covering all K entities. The per-entity detail goes into the event's `changes` array (one `BulkChangeInput` per entity).

**FORBIDDEN** (the V1 anti-pattern that V2 replaced):
```typescript
// ❌ WRONG — emits K audit rows
for (const id of ids) {
  await db.category.delete({ where: { id } })
  await emitAuditEvent(tx, buildProductCategoryChangeEvent({ ... }))
}
```

**REQUIRED** (the V2 pattern):
```typescript
// ✅ CORRECT — emits 1 BULK_BATCH row with K entries in changes[]
await db.$transaction(async (tx) => {
  const cats = await tx.category.findMany({ where: { id: { in: ids } }, ... })
  await tx.product.updateMany({ where: { categoryId: { in: ids } }, data: { categoryId: null } })
  await tx.category.deleteMany({ where: { id: { in: ids } } })
  await emitAuditEvent(tx, buildBulkBatchEvent({
    adapterKind: 'category-delete',
    changes: cats.map(c => ({ entity: 'CATEGORY', identifier: c.id, action: 'deleted', before: {...} })),
    ...
  }))
})
```

**Enforced bulk-delete routes** (the "1 delete = 1 log" fix):
- `api/products/bulk-delete` → `adapterKind='product-delete'`
- `api/categories/bulk-delete` → `adapterKind='category-delete'` *(added 2026-07-29)*
- `api/inventory/items/bulk-delete` → `adapterKind='inventory-delete'`

The frontend MUST call these single bulk endpoints — it MUST NOT loop single-DELETE calls. The `handleBulkDeleteCategories` in `products-page.tsx` was the last offender (fixed 2026-07-29).

### Rule 6.2 — SALE collapses all per-item writes into one event

A POS checkout of N items produces exactly **ONE** `SALE` event. The per-item inventory impact (stock deduction, batch consumption, composition deduction) is captured in the event's `inventory` section — NOT as separate `RESTOCK` / `COMPOSITION_DEDUCT` rows.

The legacy `COMPOSITION_DEDUCT` audit rows emitted by `inventory-consumption-service.ts` are **suppressed** in the V2 path — they remain as `InventoryMovement` ledger rows (the system ledger), but they do NOT produce AuditLog rows.

### Rule 6.3 — VOID collapses all per-item restoration into one event

A void of N items produces exactly **ONE** `VOID` event. The per-item restoration (stock restore, batch restore, composition restore, loyalty reversal) is captured in the event's `inventory` section.

The legacy per-item `RESTOCK` audit rows are suppressed in the V2 path.

### Rule 6.4 — MIGRATION_BATCH is one event per migration batch

An Excel migration that creates 50 products + 120 variants + 50 compositions + 50 inventory items produces exactly **ONE** `MIGRATION_BATCH` event. The per-entity detail goes into the event's `created` / `skipped` / `errors` / `warnings` sections.

### Rule 6.5 — PURCHASE bulk-edit is one event PER PO document (not one BULK_BATCH)

The `/api/purchases/bulk-update-excel` route emits **1 `PURCHASE` event per purchase document** touched by the Excel batch — NOT a single `BULK_BATCH`.

Rationale: each PO is an independent financial document with its own supplier/batches. A single `BULK_BATCH` would be unreadable when the Excel edits 20+ POs. If the Excel batch edits 5 POs → 5 `PURCHASE` events (each with its own Changes table). Zero `BULK_BATCH` events.

See `docs/audit-v2-scope-registry.md` §"purchase:bulk-edit" for the locked decision.

### Rule 6.6 — Technical idempotency markers are HIDDEN from the audit feed

`SYNC_DEDUP` and `STOCK_OPNAME_DEDUP` are technical idempotency markers stored as AuditLog rows (they back the partial-unique-index dedup pattern for offline sync and stock opname). They are **NOT** business events and MUST be filtered out of the visible audit feed.

Enforced in `api/audit-logs/route.ts`:
```typescript
where.action = { notIn: ['SYNC_DEDUP', 'STOCK_OPNAME_DEDUP'] }
```

The rows remain in the DB (the unique index needs them); only the API response hides them.

### Rule 6.7 — BULK_BATCH sections stay concise (no JSON dumps)

For bulk operations that touch many entities, the `BULK_BATCH` event MUST stay concise:

1. **Summary section** — standard stats (Processed/Created/Updated/Skipped/Failed/Deleted) + optional `breakdown` sub-counts (e.g. "Produk Dibuat: 50", "Varian Dibuat: 120").
2. **Changes section** — per-entity rows, truncated to 50 shown (rest hidden with "N hidden"), collapsed by default when > 8 rows.
3. **Full Change Log (download)** — for batches > 50, a downloadable JSON attachment with the complete change list.

**Never** dump the entire raw object payload into the Summary or Changes section. The `breakdown` field is the concise aggregate; the Changes table is the detailed ledger (truncated + downloadable).

---

## 7. UI RENDERING CONTRACT (LOCKED)

The audit-log page (`src/components/pages/audit-log-page.tsx`) renders V2 events. The contract:

### 7.1 Section render order

```typescript
const SECTION_ORDER = ['summary', 'changes', 'inventory', 'errors', 'warnings', 'skipped', 'metadata']
```

Sections are grouped and rendered in this order regardless of their order in the `sections` JSON. This guarantees a consistent visual hierarchy across all event types.

### 7.2 Section types

| `type` | Renders as | Purpose |
|---|---|---|
| `summary` | Definition list (key/value fields) | Standard stats + business context |
| `changes` | Table (field/before/after or row/entity/name/sku/detail) | Per-entity diff or per-row created/skipped detail |
| `inventory` | Table (item/batch/qty/cost) | Stock impact (SALE/VOID/PURCHASE) |
| `errors` | Table (row/message) | Failed rows in a bulk operation |
| `warnings` | Table (row/message) | Non-fatal warnings |
| `skipped` | Table (row/reason) | Skipped rows in migration |
| `metadata` | Definition list | Machine-readable metadata |

### 7.3 `[object Object]` prevention

The UI's `safeText()` helper mirrors `toDisplay()` — objects become `JSON.stringify`, null/undefined become `—`. Combined with the builder-side `toDisplay()` contract (§4.3), this is a **double guarantee** that the UI can never render `[object Object]`.

### 7.4 Event-type badges

Each `EventType` has a CSS badge class (`EVENT_TYPE_BADGE`) and a human label (`eventTypeLabel`). Adding a new event type requires adding both — otherwise the UI falls back to the `LEGACY` badge.

### 7.5 Filtering & export

- **Filter by** `eventType`, `entityType`, `action`, date range, free-text search.
- **Pagination** via `parsePagination` (default limit 20).
- **Export**: CSV (`/api/audit-logs/export`) and JSON (`/api/audit-logs/export?format=json`), plus batch-export for very large result sets (`/api/audit-logs/batch-export`).
- **Permission**: OWNER always allowed; CREW must have `audit-log` in their assigned pages (`crewPermission.pages`).

---

## 8. BULK_BATCH ADAPTER REGISTRY (LOCKED)

Every `BULK_BATCH` emitter declares an `adapterKind` string. This is the bulk-operation discriminator used by the bulk-engine registry and the audit filter. **Adding a new adapterKind requires updating this registry.**

| adapterKind | Route | Entity | Status |
|---|---|---|---|
| `product-add` | `api/products/bulk-upload` | Product (create) | ✅ |
| `product-update` | `api/products/bulk-update` | Product (edit) | ✅ |
| `product-edit` | `api/products/bulk-update-excel` | Product (Excel edit) | ✅ |
| `product-delete` | `api/products/bulk-delete` | Product (delete) | ✅ |
| `category-delete` | `api/categories/bulk-delete` | Product Category (delete) | ✅ *(added 2026-07-29)* |
| `inventory-bulk` | `api/inventory/items/bulk` | Inventory Item (bulk) | ✅ |
| `inventory-category` | `api/inventory/items/bulk-category` | Inventory Item (reassign category) | ✅ |
| `inventory-edit` | `api/inventory/items/bulk-update-excel` | Inventory Item (Excel edit) | ✅ |
| `inventory-delete` | `api/inventory/items/bulk-delete` | Inventory Item (delete) | ✅ |
| `purchase:add` | `api/bulk-engine/delegate/purchase` | Purchase (bulk-engine delegate) | ✅ |

### NOT SUPPORTED (locked decisions — see `docs/audit-v2-scope-registry.md`)

| Operation | Status | Reason |
|---|---|---|
| `purchase:bulk-add` | NOT SUPPORTED (file-delegate mode) | Excel import is preview-only; each PO created via normal `POST /api/purchases` (1 PURCHASE per PO) |
| `inventory:batch-edit` | NOT SUPPORTED (no route) | `InventoryBatch` edited only via purchase receive; no standalone batch-edit API |

---

## 9. ARCHITECTURE FREEZE RULES

### DO NOT

- ❌ Add a new `EventType` without an ADR + this registry update
- ❌ Emit more than ONE audit row per user action (see §6)
- ❌ Loop single-entity DELETE/UPDATE calls and emit one audit row per iteration — use the bulk endpoint
- ❌ Inline raw objects into `AuditField.v` — always use `field()` / `fields()` / `toDisplay()`
- ❌ Use `safeEmitAuditEvent` INSIDE a transaction (it would write outside the tx and lose atomicity)
- ❌ Use `emitAuditEvent` OUTSIDE a transaction (it requires a `tx` client)
- ❌ Force a non-quantity inventory edit into `INVENTORY_ADJUSTMENT` (use `INVENTORY_ITEM_CHANGE`)
- ❌ Force a batch-edit mutation into `INVENTORY_ADJUSTMENT` unless it changes aggregate `stock`
- ❌ Dump full object JSON into BULK_BATCH Summary/Changes sections (use `breakdown` + truncated Changes + download)
- ❌ Remove the `SYNC_DEDUP` / `STOCK_OPNAME_DEDUP` filter from the audit-logs GET route (it would spam the feed)
- ❌ Add a `password` / `token` / `secret` field to AuditLog (see `docs/ARCHITECTURE-LOCK.md` §12 — `telegramBotToken` is masked at write time)
- ❌ Delete or overwrite `AuditLog` rows (append-only; branch deletion migrates with provenance annotations)
- ❌ Bypass the V2 emitter by writing raw `db.auditLog.create()` — always go through `emitAuditEvent` / `safeEmitAuditEvent`

### MUST

- ✅ Emit audit INSIDE the mutation transaction (`emitAuditEvent(tx, ...)`) for single-entity mutations
- ✅ Emit ONE `BULK_BATCH` per bulk operation (not per row)
- ✅ Populate `eventType`, `title`, `summary` on every V2 event
- ✅ Use `toDisplay()` / `field()` / `fields()` for all field values
- ✅ Update §5 (Emitter Registry) and §8 (adapterKind Registry) when adding a new emitter
- ✅ Add a regression note in the worklog when fixing a spam source
- ✅ Keep `purchase:bulk-edit` as per-PO `PURCHASE` events (NOT one `BULK_BATCH`)
- ✅ Keep the audit feed filtered (`action notIn ['SYNC_DEDUP', 'STOCK_OPNAME_DEDUP']`)
- ✅ Ensure CREW permission check (`audit-log` in `crewPermission.pages`) before returning audit data

---

## 10. REGRESSION & VERIFICATION

### Automated

```bash
bun run lint
```

ESLint catches TypeScript `any` regressions in audit routes and unused imports. It does NOT catch spam-suppression violations — those require code review against §6.

### Manual flow verification (the golden path)

After any change to an emitter, verify the spam-suppression rules by counting audit rows before/after:

1. **Bulk category delete** — select 5 categories, delete. Expect **1** `BULK_BATCH` row in `/api/audit-logs?eventType=BULK_BATCH` (was: 5 `PRODUCT_CATEGORY_CHANGE` rows).
2. **Bulk product delete** — select 5 products, delete. Expect **1** `BULK_BATCH` row (was: 5 `PRODUCT_CHANGE` rows).
3. **POS checkout** — sell 5 items. Expect **1** `SALE` row (was: 11 rows in V1).
4. **Void** — void the transaction. Expect **1** `VOID` row (was: 11 rows in V1).
5. **Excel migration** — import 50 products. Expect **1** `MIGRATION_BATCH` row.
6. **Excel purchase bulk-edit** — edit 5 POs. Expect **5** `PURCHASE` rows (NOT 1 `BULK_BATCH`).
7. **Audit feed** — confirm no `SYNC_DEDUP` / `STOCK_OPNAME_DEDUP` rows appear in the default feed.

### Browser self-verification

Per the agent runtime rules, after any emitter change, open `/` in Agent Browser and exercise the primary user flow that the emitter covers. Confirm:
- The audit-log page renders without `[object Object]`.
- The detail drawer shows the expected sections in the §7.1 order.
- The event-type badge matches the event.
- CSV/JSON export downloads successfully.

---

## 11. HISTORICAL CONTEXT — V1 → V2 MIGRATION

### V1 anti-patterns (eliminated)

- `auditLog.createMany` inside checkout loops → 1 `RESTOCK` per item
- `COMPOSITION_DEDUCT` per composition deduction in `inventory-consumption-service.ts`
- `RESTOCK` per voided item
- Per-row `auditLog.createMany` in bulk adapters
- Per-row `RESTOCK` in migration (opening stock)
- Frontend looping single-DELETE for bulk category delete → K `PRODUCT_CATEGORY_CHANGE` rows

### V2 replacements

| V1 (per-row) | V2 (per-action) | Builder |
|---|---|---|
| N `RESTOCK` + 1 `SALE` + N `COMPOSITION_DEDUCT` (checkout) | 1 `SALE` | `buildSaleEvent` |
| N `RESTOCK` + 1 `VOID` + N `COMPOSITION_RESTORE` (void) | 1 `VOID` | `buildVoidEvent` |
| N `CREATE` (migration) | 1 `MIGRATION_BATCH` | `buildMigrationBatchEvent` |
| N per-row `auditLog.createMany` (bulk adapters) | 1 `BULK_BATCH` | `buildBulkBatchEvent` |
| K `PRODUCT_CATEGORY_CHANGE` (bulk category delete loop) | 1 `BULK_BATCH` (`category-delete`) | `buildBulkBatchEvent` |

### V1 fields preserved (mirrored by `serializeEvent`)

`action`, `entityType`, `entityId`, `details` are populated from V2 values so legacy readers (bulk-engine `findMarker`, void dedup, sync dedup) keep working without modification.

---

## 12. ARCHITECTURE LOCK APPROVAL

Based on the audit-v2 implementation (17 event types, 17 builders, 2 emit modes, 39 transactional + 14 non-transactional emitters across 38 routes), the spam-suppression rules (§6), and the per-domain scope registry (`docs/audit-v2-scope-registry.md`):

```
AUDIT LOG V2 ARCHITECTURE LOCK: APPROVED
```

The Aether POS AuditLog V2 system is **FROZEN** as the baseline audit architecture. All subsequent development MUST adhere to the contracts documented in this file. Any deviation — new event type, new emitter, new adapterKind, changed cardinality — requires an Architecture Decision Record (ADR) and a re-verification of the §10 regression checks.

---

**Lock Date**: 2026-07-29
**Locked By**: Audit Log V2 Architecture Lock Review
**Regression**: `bun run lint` + §10 manual flow verification
**Next Review**: Triggered by any new `EventType`, new `adapterKind`, or any change that violates a §6 spam-suppression rule
**Companion Documents**:
- `docs/ARCHITECTURE-LOCK.md` §12 (Auditability — the core-inventory lock that V2 implements)
- `docs/audit-v2-scope-registry.md` (per-domain scope matrix + NOT SUPPORTED decisions)
- `governance/AETHER-BULK-ENGINE-V1.md` (bulk-engine adapter pattern — all `BULK_BATCH` emitters MUST use this pattern)
