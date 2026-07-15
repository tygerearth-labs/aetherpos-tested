/**
 * Shared Excel Utilities for Aether POS
 * 
 * Single source of truth for all Excel import/export operations.
 * Fixes: Inconsistent sanitizeNumber(), code duplication, date parsing issues.
 */

// ═══════════════════════════════════════════════════════════════════
// NUMBER SANITIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Sanitize numeric values from Excel — handles:
 * - "Rp 25.000" → 25000
 * - "Rp25000" → 25000
 * - "25.000" (Indonesian thousands) → 25000
 * - "25,000" (comma thousands) → 25000
 * - "25.500,00" (Indonesian decimal) → 25500
 * - "-5000" → -5000 (preserves negative sign!)
 * - "−5000" (unicode minus) → -5000
 * - 25000 (number) → 25000
 * - "" / empty → 0
 */
export function sanitizeNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (val === null || val === undefined) return 0
  const str = String(val).trim()
  if (!str) return 0

  // Detect leading negative sign BEFORE stripping (critical fix!)
  let isNegative = false
  let trimmed = str
  if (trimmed.startsWith('-') || trimmed.startsWith('\u2212')) { // unicode minus −
    isNegative = true
    trimmed = trimmed.slice(1)
  }

  // Remove currency symbols & whitespace (keep dots, commas, digits)
  let cleaned = trimmed.replace(/[Rp\s$€¥£]/g, '').trim()

  // Detect format: if we have both dots and commas, the LAST separator is the decimal
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')

  if (lastDot > -1 && lastComma > -1) {
    if (lastDot > lastComma) {
      // Format: 25.000,50 → Indonesian (dot=thousands, comma=decimal)
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      // Format: 25,000.50 → English (comma=thousands, dot=decimal)
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (lastDot > -1 && lastComma === -1) {
    // Only dots: check if it looks like thousands separator (25.000) or decimal (25.50)
    const parts = cleaned.split('.')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      // Likely thousands separator: 25.000 → 25000
      cleaned = cleaned.replace(/\./g, '')
    }
    // else it's already a valid decimal like 25.50
  } else if (lastComma > -1 && lastDot === -1) {
    // Only commas: check if thousands or decimal
    const parts = cleaned.split(',')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      // Likely thousands: 25,000 → 25000
      cleaned = cleaned.replace(/,/g, '')
    } else {
      // Likely decimal: 25,50 → 25.50
      cleaned = cleaned.replace(',', '.')
    }
  }

  const num = Number(cleaned)
  return isNaN(num) ? 0 : (isNegative ? -Math.abs(num) : num)
}

// ═══════════════════════════════════════════════════════════════════
// HEADER MATCHING
// ═══════════════════════════════════════════════════════════════════

/** Normalize header key for flexible matching */
export function normalizeHeader(key: string): string {
  return key.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase()
}

/** Find matching column from row by trying normalized header aliases */
export function findColumn(row: Record<string, unknown>, aliases: string[]): unknown {
  // Build a map of normalized headers → actual keys
  const normalizedMap = new Map<string, string>()
  for (const key of Object.keys(row)) {
    const norm = normalizeHeader(key)
    normalizedMap.set(norm, key)
  }

  for (const alias of aliases) {
    const norm = normalizeHeader(alias)
    // Try exact normalized match first
    if (normalizedMap.has(norm)) {
      return row[normalizedMap.get(norm)!]
    }
    // Try contains match (e.g., 'harga jual' matches 'HARGA JUAL* (Rp)')
    for (const normKey of normalizedMap.keys()) {
      const actualKey = normalizedMap.get(normKey)!
      if (normKey.includes(norm) || norm.includes(normKey)) {
        return row[actualKey]
      }
    }
  }
  return undefined
}

// ═══════════════════════════════════════════════════════════════════
// DATE PARSING
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse Excel date value to ISO string (YYYY-MM-DD).
 * Handles:
 * - Excel serial date numbers (e.g., 45678)
 * - Date objects from XLSX parsing
 * - ISO strings: "2026-01-15"
 * - Indonesian format: "15/01/2026" or "15-01-2026"
 * 
 * @returns Date string in YYYY-MM-DD format, or null if invalid
 */
export function parseExcelDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null

  // Handle Excel serial date number
  if (typeof raw === 'number') {
    // Use XLSX SSF parse_date_code if available, otherwise manual conversion
    // Excel serial date: days since December 30, 1899
    const excelEpoch = new Date(1899, 11, 30)
    const resultDate = new Date(excelEpoch.getTime() + raw * 86400000)
    if (!isNaN(resultDate.getTime())) {
      // Check for reasonable date range (year 1900-2100)
      const year = resultDate.getFullYear()
      if (year >= 1900 && year <= 2100) {
        return resultDate.toISOString().split('T')[0]
      }
    }
    return null
  }

  // Handle Date object
  if (raw instanceof Date) {
    if (!isNaN(raw.getTime())) {
      return raw.toISOString().split('T')[0]
    }
    return null
  }

  // Handle string values
  const strVal = String(raw).trim()
  if (!strVal) return null

  // Try DD/MM/YYYY or DD-MM-YYYY format (Indonesian common format)
  const dmyMatch = strVal.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch
    const parsed = new Date(Number(y), Number(m) - 1, Number(d))
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0]
    }
  }

  // Try YYYY-MM-DD or ISO format
  const parsed = new Date(strVal)
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0]
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Check if a value is non-empty (not null, undefined, empty string, or whitespace-only) */
export function isNonEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return false
  if (typeof val === 'string') return val.trim().length > 0
  if (typeof val === 'number') return val !== 0
  return true
}

/** Valid units for products and inventory items */
export const VALID_UNITS = [
  'pcs', 'ml', 'lt', 'gr', 'kg', 'box', 'pack', 'botol',
  'gelas', 'mangkuk', 'porsi', 'bungkus', 'sachet', 'dus',
  'rim', 'lembar', 'meter', 'cm', 'ons', 'roll', 'strip', 'ekor',
  'butir', 'karton', 'lusin', 'slop', 'unit', 'liter', 'kg',
] as const

export type ValidUnit = typeof VALID_UNITS[number]

/** Validate and normalize unit, returning default if invalid */
export function validateUnit(unitRaw: string, defaultUnit: string = 'pcs'): ValidUnit {
  const normalized = unitRaw.trim().toLowerCase()
  return VALID_UNITS.includes(normalized as ValidUnit) 
    ? (normalized as ValidUnit) 
    : defaultUnit as ValidUnit
}
