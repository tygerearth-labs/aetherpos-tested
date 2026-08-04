/**
 * purchase-draft.ts — Canonical purchase draft model + import normalizer.
 *
 * All three purchase creation flows (manual form, Posting Langsung, Terapkan
 * ke Form) produce `PurchaseDraftItem[]` before persistence. This eliminates
 * the historical split between "items with inventoryItemId" and "newItems with
 * a key" — every line item carries both identity fields, and exactly one is
 * set. The persistence service (`createPurchaseFromDraft`) consumes this
 * shape and runs every write inside a single `$transaction`.
 *
 * Identity rules:
 * - Existing inventory item: `inventoryItemId` set, `newKey` null.
 * - New inventory item (to be created inside the purchase tx): `inventoryItemId`
 *   null, `newKey` set to a client-generated stable key
 *   (e.g. `"import_row_3"`, `"__pending_coffee_bean_0"`).
 *
 * Quantity semantics (canonical — shared by all three flows):
 * - `purchaseQty` + `purchaseUnit`: the quantity in the unit the supplier
 *   bills in (e.g. `2` Ekor, `5` Karung).
 * - `baseUnit`: the inventory base unit (e.g. "kg", "ml", "pcs").
 * - `conversionFactor`: how many base units one purchase unit equals
 *   (e.g. 1 Ekor = 1.85 kg → factor 1.85; 1 dus = 12 pcs → factor 12).
 *   MUST be > 0. `baseQty = purchaseQty × conversionFactor`.
 * - `baseQty`: the same quantity converted to the inventory base unit
 *   (e.g. 2 Ekor × 1.85 = 3.7 kg). For 1:1 items, factor = 1 and
 *   `baseQty === purchaseQty`.
 * - `unitCost`: cost per BASE unit (not per purchase unit). Computed as
 *   `totalCost / baseQty`. Matches the existing `PurchaseOrderItem.unitCost`
 *   semantic.
 * - `totalCost`: line total = `purchaseQty × pricePerPurchaseUnit`.
 *
 * Unit resolution contract (see `purchase-unit-resolver.ts`):
 *  - The frontend runs `resolvePurchaseUnit()` on every import preview row
 *    and stores the result on the row's `unitResolution` field.
 *  - The normalizer drops any row whose `unitResolution.status` is not
 *    `VALID` (i.e. NEEDS_MAPPING or INVALID rows are blocked at the gate).
 *  - The backend re-validates via `validateCanonicalPurchaseUnits()` inside
 *    `createPurchaseFromDraft` — frontend validation is never trusted alone.
 */

export interface PurchaseDraftItem {
  /** Real InventoryItem.id for existing items. `null` for new items. */
  inventoryItemId: string | null
  /** Client-generated stable key for new items. `null` for existing items. */
  newKey: string | null

  /** Item name snapshot. Used to create new InventoryItem; ignored for existing. */
  name: string
  /** Item SKU snapshot. Used to create new InventoryItem; ignored for existing. */
  sku: string | null
  /** Inventory base unit (kg, ml, pcs, ...). Required for new items. */
  baseUnit: string

  // ── Quantities ──
  purchaseQty: number
  purchaseUnit: string
  /**
   * Conversion factor: base units per purchase unit (e.g. 12 for 1 dus = 12 pcs).
   * MUST be > 0. `baseQty = purchaseQty × conversionFactor`.
   */
  conversionFactor: number
  /** Already converted to base units = purchaseQty × conversionFactor. */
  baseQty: number

  // ── Cost ──
  /** Cost per base unit. */
  unitCost: number
  /** Line total = purchaseQty × pricePerPurchaseUnit. */
  totalCost: number

  // ── Batch ──
  batch: string | null
  /** ISO date string (YYYY-MM-DD) or null. */
  expiredDate: string | null
}

export interface PurchaseDraft {
  outletId: string
  userId: string
  supplierId: string | null
  notes: string | null
  items: PurchaseDraftItem[]
}

// ────────────────────────────────────────────────────────────────
// Import preview row → PurchaseDraftItem normalizer
// ────────────────────────────────────────────────────────────────

/**
 * Shape of a row in the Excel import preview (`importPreviewData` in
 * purchase-page.tsx). Mirrors the backend `/api/purchases/import-excel`
 * response item, plus the frontend-computed `unitResolution`.
 */
export interface ImportPreviewRow {
  row: number
  name: string
  sku: string | null
  purchaseUnit: string
  qty: number
  /** Per-purchase-unit conversion factor (e.g. 1.85 for 1 Ekor = 1.85 kg). */
  baseQty: number
  baseUnit: string
  /** Price per PURCHASE unit (not per base unit). */
  pricePerUnit: number
  batch: string | null
  expiredDate: string | null
  matchedItemId: string | null
  matchedItemName: string | null
  matchedItemSku: string | null
  matchedItemUnit: string | null
  isNew: boolean
  error?: string
  /**
   * Frontend-computed unit resolution (see `resolvePurchaseUnit`).
   * - `VALID` → row is submittable; use `conversionFactor` + `baseUnit`.
   * - `NEEDS_MAPPING` → row is blocked until the user enters a factor.
   * - `INVALID` → row is blocked permanently (incompatible units).
   * Undefined when the frontend has not yet run the resolver (treated as
   * blocked by the normalizer + submission gate).
   */
  unitResolution?: {
    status: 'VALID' | 'NEEDS_MAPPING' | 'INVALID'
    purchaseUnit: string
    baseUnit: string
    conversionFactor: number
    reason?: string
  }
}

/**
 * Normalize import preview rows into canonical `PurchaseDraftItem[]`.
 *
 * Rules:
 *  - Rows with `error` are dropped.
 *  - Rows whose `unitResolution` is missing or `status !== 'VALID'` are
 *    dropped (NEEDS_MAPPING / INVALID rows are blocked at the submission gate;
 *    this is the defense-in-depth normalizer).
 *  - For VALID rows, `conversionFactor` and `baseUnit` come from the
 *    resolution (which may differ from the raw Excel `baseQty`/`baseUnit`
 *    when the user provided an explicit mapping).
 *  - `baseQty = qty × conversionFactor` (recomputed from the canonical
 *    factor — never trusts the raw Excel `baseQty` field when a resolution
 *    is present).
 *  - Matched rows → `inventoryItemId = matchedItemId`, `newKey = null`.
 *  - Unmatched rows → `inventoryItemId = null`, `newKey = "import_row_${row}"`.
 *
 * Cost math:
 *   totalCost = pricePerUnit × qty
 *   unitCost  = totalCost / baseQty (when baseQty > 0, else 0)
 *
 * This is the single source of truth for "how an Excel preview row becomes a
 * purchase line item" — both Posting Langsung and Terapkan ke Form call this.
 */
export function normalizeImportToPurchaseDraft(
  rows: ImportPreviewRow[],
): PurchaseDraftItem[] {
  const out: PurchaseDraftItem[] = []
  for (const r of rows) {
    if (r.error) continue

    // ── Unit resolution gate ──
    const res = r.unitResolution
    if (!res || res.status !== 'VALID') continue
    const conversionFactor = res.conversionFactor
    if (!(conversionFactor > 0) || !Number.isFinite(conversionFactor)) continue

    const qtyVal = r.qty || 0
    const pricePerUnit = r.pricePerUnit || 0
    const totalCost = pricePerUnit * qtyVal
    const baseQty = qtyVal * conversionFactor
    const unitCost = baseQty > 0 ? totalCost / baseQty : 0

    const resolvedBaseUnit = res.baseUnit || r.baseUnit || r.matchedItemUnit || 'pcs'
    const resolvedPurchaseUnit = res.purchaseUnit || r.purchaseUnit || ''
    const resolvedName = r.matchedItemId ? (r.matchedItemName || r.name) : r.name
    const resolvedSku = r.matchedItemId ? (r.matchedItemSku || r.sku || null) : (r.sku || null)

    if (r.matchedItemId) {
      out.push({
        inventoryItemId: r.matchedItemId,
        newKey: null,
        name: resolvedName,
        sku: resolvedSku,
        baseUnit: resolvedBaseUnit,
        purchaseQty: qtyVal,
        purchaseUnit: resolvedPurchaseUnit,
        conversionFactor,
        baseQty,
        unitCost,
        totalCost,
        batch: r.batch?.trim() || null,
        expiredDate: r.expiredDate || null,
      })
    } else {
      out.push({
        inventoryItemId: null,
        newKey: `import_row_${r.row}`,
        name: resolvedName,
        sku: resolvedSku,
        baseUnit: resolvedBaseUnit,
        purchaseQty: qtyVal,
        purchaseUnit: resolvedPurchaseUnit,
        conversionFactor,
        baseQty,
        unitCost,
        totalCost,
        batch: r.batch?.trim() || null,
        expiredDate: r.expiredDate || null,
      })
    }
  }
  return out
}

/**
 * Split a `PurchaseDraftItem[]` into the legacy `{ items, newItems }` pair
 * that the historical API contract accepted. Used by API routes that still
 * need to produce the legacy shape (e.g. for backward-compat response fields),
 * and by the frontend when posting to an endpoint that expects the split.
 *
 * Prefer sending the unified `items[]` shape directly to `createPurchaseFromDraft`.
 */
export function splitDraftToLegacy(
  draftItems: PurchaseDraftItem[],
): {
  items: Array<{
    inventoryItemId: string
    purchaseQty: number
    purchaseUnit: string
    conversionFactor: number
    baseQty: number
    baseUnit: string
    unitCost: number
    totalCost: number
    batch?: string | null
    expiredDate?: string | null
  }>
  newItems: Array<{
    key: string
    name: string
    sku?: string | null
    baseUnit: string
    purchaseQty: number
    purchaseUnit: string
    conversionFactor: number
    baseQty: number
    unitCost: number
    totalCost: number
    batch?: string | null
    expiredDate?: string | null
  }>
} {
  const items: ReturnType<typeof splitDraftToLegacy>['items'] = []
  const newItems: ReturnType<typeof splitDraftToLegacy>['newItems'] = []
  for (const d of draftItems) {
    if (d.inventoryItemId) {
      items.push({
        inventoryItemId: d.inventoryItemId,
        purchaseQty: d.purchaseQty,
        purchaseUnit: d.purchaseUnit,
        conversionFactor: d.conversionFactor,
        baseQty: d.baseQty,
        baseUnit: d.baseUnit,
        unitCost: d.unitCost,
        totalCost: d.totalCost,
        batch: d.batch,
        expiredDate: d.expiredDate,
      })
    } else if (d.newKey) {
      newItems.push({
        key: d.newKey,
        name: d.name,
        sku: d.sku,
        baseUnit: d.baseUnit,
        purchaseQty: d.purchaseQty,
        purchaseUnit: d.purchaseUnit,
        conversionFactor: d.conversionFactor,
        baseQty: d.baseQty,
        unitCost: d.unitCost,
        totalCost: d.totalCost,
        batch: d.batch,
        expiredDate: d.expiredDate,
      })
    }
  }
  return { items, newItems }
}
