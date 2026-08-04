/**
 * purchase-unit-resolver.ts — Canonical unit resolver + validator.
 *
 * Single source of truth for "is this imported purchase unit acceptable?"
 * Used by BOTH the Direct Posting flow and the Apply-to-Form flow, and
 * enforced AGAIN on the backend by `createPurchaseFromDraft` /
 * `PUT /api/purchases/[id]`.
 *
 * Contract:
 *  - `VALID`             → unit + base + factor all known. Safe to persist.
 *  - `NEEDS_MAPPING`     → unit is unknown OR target base is unset; the user
 *                          MUST enter a conversion factor (and base unit for
 *                          new items) before the row can be submitted.
 *  - `INVALID`           → unit is known but incompatible with the target
 *                          base unit's family (e.g. "gram" → "pcs"). Cannot
 *                          be fixed by entering a factor; the user must
 *                          change the unit or the base unit.
 *
 * Hard rules (never violated):
 *  1. Never silently replace an unknown unit with "pcs".
 *  2. Never accept arbitrary unit strings directly.
 *  3. Never let Direct Posting bypass mapping.
 *  4. Preserve the original Excel unit string on the preview row for display
 *     and audit (the resolver returns the resolved `purchaseUnit` separately).
 *  5. The empty-cell fallback (purchaseUnit = baseUnit, factor = 1) applies
 *     ONLY when the cell is genuinely empty AND the matched inventory item
 *     has a known baseUnit. It does NOT apply to a non-empty unknown unit.
 */

import {
  normalizeUnit,
  isSameUnit,
  getConversionFactor,
  getUnitFamily,
} from '@/lib/unit-conversion'

/** Minimal inventory-item shape the resolver needs. */
export interface ResolverInventoryItem {
  baseUnit: string
}

export interface UnitResolutionValid {
  status: 'VALID'
  /** The purchase unit to persist (may differ from imported when empty cell falls back to base). */
  purchaseUnit: string
  baseUnit: string
  /** > 0. baseQty = purchaseQty * conversionFactor. */
  conversionFactor: number
}

export interface UnitResolutionNeedsMapping {
  status: 'NEEDS_MAPPING'
  /** Original imported unit (preserved for display/audit). */
  importedUnit: string
  /** Target base unit if known (empty for new items without a base unit yet). */
  targetBaseUnit: string
  reason: string
}

export interface UnitResolutionInvalid {
  status: 'INVALID'
  importedUnit: string
  reason: string
}

export type ResolvePurchaseUnitResult =
  | UnitResolutionValid
  | UnitResolutionNeedsMapping
  | UnitResolutionInvalid

/**
 * The default allowlist of recognized purchase units. This is the union of
 * every unit defined in `unit-conversion.ts`'s `UNIT_FAMILIES`. A unit not in
 * this list is treated as "unknown" → NEEDS_MAPPING (unless it equals the
 * base unit, in which case factor = 1).
 *
 * Exported so callers (UI, tests) can pass the same allowlist explicitly and
 * so the backend can enforce against the exact same set.
 */
export const DEFAULT_ALLOWED_PURCHASE_UNITS: readonly string[] = (() => {
  // Pulled from unit-conversion.ts families. Duplicated here as a literal so
  // the resolver does not depend on the families object's shape (which is
  // module-private). If unit-conversion.ts grows a new family, add its units
  // here too.
  return [
    // mass
    'kg', 'gr', 'gram', 'g', 'ons', 'hg', 'ton',
    // volume
    'liter', 'l', 'ml', 'cc', 'm3',
    // length
    'meter', 'm', 'cm', 'mm', 'km', 'yard', 'yd', 'inch', 'in', 'feet', 'ft',
    // each
    'pcs', 'pc', 'box', 'pack', 'pak', 'lembar', 'lbr', 'unit', 'buah',
    'biji', 'ekor', 'pasang', 'set', 'lusin', 'kodi', 'rim',
    // common Indonesian extras (treated as aliases of "each" — factor 1 to pcs)
    'dus', 'ikat', 'batang', 'butir', 'sachet', 'pouch', 'botol', 'galon',
    'jerigen', 'karung', 'sak', 'krat',
  ]
})()

function isAllowed(unit: string, allowedUnits?: readonly string[]): boolean {
  if (!allowedUnits || allowedUnits.length === 0) {
    // Fall back to the family table — a unit is "known" if it belongs to a family.
    return getUnitFamily(unit) != null
  }
  const lower = normalizeUnit(unit)
  return allowedUnits.some((u) => normalizeUnit(u) === lower)
}

/**
 * Canonical unit resolver for purchase imports.
 *
 * @param importedUnit   Raw unit string from the Excel cell (may be empty).
 * @param inventoryItem  Matched inventory item (null for new/unmatched rows).
 *                       Only `baseUnit` is read.
 * @param allowedUnits   Optional allowlist of recognized unit names. When
 *                       omitted, the resolver uses `DEFAULT_ALLOWED_PURCHASE_UNITS`.
 */
export function resolvePurchaseUnit(
  importedUnit: string | null | undefined,
  inventoryItem: ResolverInventoryItem | null | undefined,
  allowedUnits: readonly string[] = DEFAULT_ALLOWED_PURCHASE_UNITS,
): ResolvePurchaseUnitResult {
  const raw = (importedUnit ?? '').trim()
  const baseUnit = (inventoryItem?.baseUnit ?? '').trim()

  // ── Rule 3: Empty cell fallback ──
  // ONLY when: cell is genuinely empty AND matched item has a known baseUnit.
  // purchaseUnit = baseUnit, conversionFactor = 1.
  // Does NOT apply to a non-empty unknown unit.
  if (!raw) {
    if (!baseUnit) {
      return {
        status: 'INVALID',
        importedUnit: '',
        reason: 'Satuan beli kosong dan inventory item belum memiliki satuan dasar',
      }
    }
    return {
      status: 'VALID',
      purchaseUnit: baseUnit,
      baseUnit,
      conversionFactor: 1,
    }
  }

  // We have a non-empty imported unit from here on.

  // ── Need a baseUnit to resolve against ──
  // If the matched item has no baseUnit (new item, or matched item somehow
  // missing baseUnit), the user must specify one → NEEDS_MAPPING.
  if (!baseUnit) {
    if (!isAllowed(raw, allowedUnits)) {
      return {
        status: 'NEEDS_MAPPING',
        importedUnit: raw,
        targetBaseUnit: '',
        reason: `Unit "${raw}" tidak dikenali dan satuan dasar belum diisi`,
      }
    }
    return {
      status: 'NEEDS_MAPPING',
      importedUnit: raw,
      targetBaseUnit: '',
      reason: `Satuan dasar belum diisi — konfirmasi satuan dasar dan faktor konversi untuk "${raw}"`,
    }
  }

  // ── Rule: importedUnit === baseUnit → factor 1 (exact match, case-insensitive) ──
  if (isSameUnit(raw, baseUnit)) {
    return {
      status: 'VALID',
      purchaseUnit: baseUnit,
      baseUnit,
      conversionFactor: 1,
    }
  }

  // ── Same family → compute factor ──
  const factor = getConversionFactor(raw, baseUnit)
  if (factor != null && factor > 0 && Number.isFinite(factor)) {
    return {
      status: 'VALID',
      purchaseUnit: raw,
      baseUnit,
      conversionFactor: factor,
    }
  }

  // ── Known unit but incompatible family → INVALID ──
  const rawFamily = getUnitFamily(raw)
  const baseFamily = getUnitFamily(baseUnit)
  if (rawFamily != null && baseFamily != null && rawFamily !== baseFamily) {
    return {
      status: 'INVALID',
      importedUnit: raw,
      reason: `Unit "${raw}" tidak kompatibel dengan satuan dasar "${baseUnit}"`,
    }
  }

  // ── Unknown unit → NEEDS_MAPPING (never silently replace) ──
  return {
    status: 'NEEDS_MAPPING',
    importedUnit: raw,
    targetBaseUnit: baseUnit,
    reason: `Unit "${raw}" tidak dikenali — isi faktor konversi ke ${baseUnit}`,
  }
}

// ────────────────────────────────────────────────────────────────
// Backend enforcement helper
// ────────────────────────────────────────────────────────────────

/**
 * A compact shape for backend validation. Any object with these fields can be
 * checked — the canonical `PurchaseDraftItem` and the PUT route's line-item
 * shape both satisfy it.
 */
export interface CanonicalUnitFields {
  purchaseQty: number
  purchaseUnit: string
  baseQty: number
  baseUnit: string
  conversionFactor?: number
}

export interface CanonicalUnitViolation {
  field: string
  message: string
}

/**
 * Backend-enforced canonical unit contract. Independent of frontend
 * validation — rejects the same conditions the frontend gates on, so a
 * buggy/legacy client cannot persist corrupt unit data.
 *
 * Rejects:
 *  - missing or empty `baseUnit`
 *  - missing or empty `purchaseUnit`
 *  - unsupported `purchaseUnit` (not in allowlist AND not equal to baseUnit)
 *  - `conversionFactor` missing or <= 0
 *  - inconsistent `baseQty` (≠ purchaseQty × conversionFactor, within 0.01 tolerance)
 *
 * @returns array of violations (empty = valid).
 */
export function validateCanonicalPurchaseUnits(
  item: CanonicalUnitFields,
  itemName: string,
  allowedUnits: readonly string[] = DEFAULT_ALLOWED_PURCHASE_UNITS,
): CanonicalUnitViolation[] {
  const violations: CanonicalUnitViolation[] = []
  const label = itemName || 'item'

  const purchaseUnit = (item.purchaseUnit ?? '').trim()
  const baseUnit = (item.baseUnit ?? '').trim()

  if (!baseUnit) {
    violations.push({
      field: 'baseUnit',
      message: `${label}: satuan dasar wajib diisi`,
    })
  }
  if (!purchaseUnit) {
    violations.push({
      field: 'purchaseUnit',
      message: `${label}: satuan beli wajib diisi`,
    })
  }

  // If either unit is empty, the remaining checks don't add value.
  if (!purchaseUnit || !baseUnit) return violations

  // purchaseUnit must be either === baseUnit (case-insensitive) OR in the allowlist.
  if (!isSameUnit(purchaseUnit, baseUnit) && !isAllowed(purchaseUnit, allowedUnits)) {
    violations.push({
      field: 'purchaseUnit',
      message: `${label}: satuan beli "${purchaseUnit}" tidak didukung`,
    })
  }

  // conversionFactor: use provided value, else compute from baseQty/purchaseQty
  // (backward-compat for legacy callers that don't send conversionFactor).
  const qty = Number(item.purchaseQty) || 0
  const baseQty = Number(item.baseQty) || 0
  let factor = item.conversionFactor != null ? Number(item.conversionFactor) : NaN

  if (item.conversionFactor == null || !Number.isFinite(factor)) {
    // Legacy caller: derive factor from baseQty/purchaseQty.
    factor = qty > 0 ? baseQty / qty : 0
  }

  if (!Number.isFinite(factor) || factor <= 0) {
    violations.push({
      field: 'conversionFactor',
      message: `${label}: faktor konversi harus lebih dari 0`,
    })
    return violations
  }

  // Consistency: baseQty must equal purchaseQty × conversionFactor (tolerance 0.01
  // for float rounding, e.g. 1.85 × 2 = 3.7 exactly, but 0.1 × 3 = 0.30000004).
  const expectedBaseQty = qty * factor
  if (qty > 0 && Math.abs(baseQty - expectedBaseQty) > 0.01) {
    violations.push({
      field: 'baseQty',
      message: `${label}: baseQty (${baseQty}) tidak konsisten dengan purchaseQty × conversionFactor (${expectedBaseQty})`,
    })
  }

  // baseQty itself must be > 0 when purchaseQty > 0.
  if (qty > 0 && baseQty <= 0) {
    violations.push({
      field: 'baseQty',
      message: `${label}: jumlah dasar harus lebih dari 0`,
    })
  }

  return violations
}
