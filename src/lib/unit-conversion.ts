/**
 * Unit Conversion Utility
 *
 * Used by the Purchase Dialog to convert between a "conversion unit" (the unit
 * the user thinks in when entering package contents, e.g. "gram") and the
 * inventory "base unit" (e.g. "kg").
 *
 * Design goals:
 *  - Pure functions, no side effects, safe to call during render.
 *  - Graceful fallback: unknown units are treated as incompatible (factor = null)
 *    so the UI can show a validation error instead of crashing.
 *  - Case-insensitive matching (gram == Gram == GR).
 *  - Trims whitespace.
 *
 * NOTE: This is a FRONTEND-ONLY helper for UX clarity. It does NOT change the
 * purchase API, inventory engine, HPP calculation, or Prisma schema. The API
 * still receives `baseQty` expressed in the inventory base unit; this utility
 * is what turns "1 box = 1000 gram" into "1 box = 1 kg" before submission.
 */

// Canonical unit families. Each family has a root (base) unit and a map of
// member → factor, where factor is "multiply by this to convert TO the root".
// Example: 1 gram = 0.001 kg, so factors.gram = 0.001 in the mass family.
const UNIT_FAMILIES: Record<string, { root: string; factors: Record<string, number> }> = {
  mass: {
    root: 'kg',
    factors: {
      kg: 1,
      gr: 0.001,
      gram: 0.001,
      g: 0.001,
      ons: 0.1,
      hg: 0.1,
      ton: 1000,
    },
  },
  volume: {
    root: 'liter',
    factors: {
      liter: 1,
      l: 1,
      ml: 0.001,
      cc: 0.001,
      m3: 1000,
    },
  },
  length: {
    root: 'meter',
    factors: {
      meter: 1,
      m: 1,
      cm: 0.01,
      mm: 0.001,
      km: 1000,
      yard: 0.9144,
      yd: 0.9144,
      inch: 0.0254,
      in: 0.0254,
      feet: 0.3048,
      ft: 0.3048,
    },
  },
  each: {
    root: 'pcs',
    factors: {
      pcs: 1,
      pc: 1,
      box: 1,
      pack: 1,
      pak: 1,
      lembar: 1,
      lbr: 1,
      unit: 1,
      buah: 1,
      biji: 1,
      ekor: 1,
      pasang: 1,
      set: 1,
      lusin: 12,
      kodi: 20,
      rim: 500,
    },
  },
}

// Reverse lookup: normalized unit name → family key.
const UNIT_TO_FAMILY: Record<string, string> = {}
for (const family of Object.keys(UNIT_FAMILIES)) {
  for (const unit of Object.keys(UNIT_FAMILIES[family].factors)) {
    UNIT_TO_FAMILY[unit.toLowerCase()] = family
  }
}

/** Normalize a unit string for comparison (trim + lowercase). */
export function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? '').trim().toLowerCase()
}

/** True when two unit strings refer to the same unit (case-insensitive, trim). */
export function isSameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeUnit(a)
  const nb = normalizeUnit(b)
  if (!na || !nb) return false
  return na === nb
}

/** Returns the family key for a unit, or null if unknown. */
export function getUnitFamily(unit: string | null | undefined): string | null {
  const u = normalizeUnit(unit)
  return UNIT_TO_FAMILY[u] ?? null
}

/**
 * Returns the conversion factor to convert `fromUnit` into `toUnit`.
 * result = value_in_fromUnit * factor → value_in_toUnit
 *
 * Returns:
 *  - 1 when fromUnit === toUnit (case-insensitive).
 *  - null when the two units are in different families (incompatible, e.g. gram → pcs).
 *  - null when either unit is unknown.
 */
export function getConversionFactor(
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
): number | null {
  const from = normalizeUnit(fromUnit)
  const to = normalizeUnit(toUnit)
  if (!from || !to) return null
  if (from === to) return 1
  const fromFam = UNIT_TO_FAMILY[from]
  const toFam = UNIT_TO_FAMILY[to]
  if (!fromFam || !toFam || fromFam !== toFam) return null
  const fam = UNIT_FAMILIES[fromFam]
  const fromFactor = fam.factors[from]
  const toFactor = fam.factors[to]
  if (fromFactor == null || toFactor == null) return null
  // value_in_root = value_in_from * fromFactor
  // value_in_to   = value_in_root / toFactor
  return fromFactor / toFactor
}

/**
 * Convert a numeric value from one unit to another.
 * Returns null when the units are incompatible or the value is not finite.
 */
export function convertQty(
  value: number,
  fromUnit: string | null | undefined,
  toUnit: string | null | undefined,
): number | null {
  if (!Number.isFinite(value)) return null
  const factor = getConversionFactor(fromUnit, toUnit)
  if (factor == null) return null
  return value * factor
}

/**
 * Returns the list of unit names that are convertible to `baseUnit`
 * (i.e. in the same family). Always includes the base unit itself.
 * Useful for populating a conversion-unit dropdown.
 *
 * If `baseUnit` is unknown, returns just [baseUnit] as a graceful fallback
 * so the UI can still render without crashing.
 */
export function getConvertibleUnits(baseUnit: string | null | undefined): string[] {
  const base = normalizeUnit(baseUnit)
  if (!base) return []
  const family = UNIT_TO_FAMILY[base]
  if (!family) return [baseUnit!.trim()]
  const fam = UNIT_FAMILIES[family]
  // Prefer the canonical spelling of the base unit (as passed in) first,
  // then list the rest sorted for a stable dropdown order.
  const units = Object.keys(fam.factors)
  const baseCanonical = units.find((u) => u.toLowerCase() === base)
  const rest = units.filter((u) => u.toLowerCase() !== base).sort()
  return [baseCanonical || baseUnit!.trim(), ...rest]
}

/** True when the two units are in the same family (convertible). */
export function areUnitsCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const fa = getUnitFamily(a)
  const fb = getUnitFamily(b)
  if (!fa || !fb) return false
  return fa === fb
}

/**
 * Resolve a safe conversion-unit default for a given base unit.
 * If `preferred` is compatible with `baseUnit`, use it; otherwise fall back
 * to the base unit itself (factor = 1, safe).
 */
export function resolveConversionUnit(
  preferred: string | null | undefined,
  baseUnit: string | null | undefined,
): string {
  const base = (baseUnit ?? '').trim()
  if (!base) return ''
  const pref = (preferred ?? '').trim()
  if (pref && areUnitsCompatible(pref, base)) return pref
  return base
}
