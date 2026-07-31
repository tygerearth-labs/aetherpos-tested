/**
 * MIG-RESULT-SAFE: Canonical normalization for Migration Wizard result data.
 *
 * PROBLEM
 *  The migration API (v2.3 audit-log contract) returns `errors[]` and
 *  `warnings[]` as arrays of structured issue objects:
 *    { row: number, sheet?: string, entity?: string, identifier?: string, message: string }
 *  …NOT as arrays of strings.
 *
 *  The Dexie job record (`MigrationJob.errors` / `MigrationJob.warnings`) is
 *  typed as `string[]`, but the provider was doing an unsafe cast:
 *      const batchErrors: string[] = data.errors || []
 *  …so object payloads leaked into Dexie. The result dialog then rendered
 *  those objects directly as React children, causing the production crash:
 *      "Application error: a client-side exception has occurred"
 *
 *  Old Dexie records persisted before this fix may still contain object
 *  payloads, so the renderer must also normalize on read (defence in depth).
 *
 * CONTRACT
 *  Three layers of defence:
 *    1. Adapter boundary (provider): normalize API issue objects → strings
 *       BEFORE writing to Dexie. Dexie only ever stores serializable primitives.
 *    2. Worker/Dexie: types remain `string[]`; nothing structured is persisted.
 *    3. Renderer (wizard): typeof guard + normalize on read, so legacy /
 *       corrupted Dexie records cannot crash the dialog.
 *
 * INVARIANTS
 *  - `failed` count reflects ONLY real row-level failures (errors.length).
 *  - `skipped` rows are NOT counted as errors (they live in `productsSkipped`).
 *  - `warnings` are separate from `errors` (non-fatal composition soft-fails,
 *    existing-data reuse, etc.).
 *  - Empty error/warning sections are hidden by the renderer.
 *
 * This module is pure (no React, no IO) and tree-shakeable.
 */

// ── Issue shape returned by the API (v2.3 audit-log contract) ──────────────

export interface MigrationIssueRow {
  row?: number
  sheet?: string
  entity?: string
  identifier?: string
  message: string
}

// ── Canonical view model passed to the result dialog ───────────────────────

/**
 * The ONLY shape the result dialog is allowed to consume. Every field is a
 * primitive or an array of primitives — no nested objects, no JSON payloads.
 */
export interface MigrationResultViewModel {
  // Counts (already numbers from Dexie; coerced to number here for safety).
  productsCreated: number
  variantsCreated: number
  productsSkipped: number
  totalCategories: number
  barcodeCount: number
  failedRows: number
  remainingProducts: number

  // Issue lists — ALWAYS strings.
  errors: string[]
  warnings: string[]

  // Optional inventory extras (numbers only).
  inventoryItemsCreated?: number
  inventoryItemsSkipped?: number
  inventoryItemsUpdated?: number
  migrationDataCleaned?: number
  compositionsCreated?: number
  totalStock?: number
  totalModalValue?: number

  // Batch context (numbers + safe string|null).
  totalProducts: number
  totalBatches: number
  completedBatches: number
  currentBatch: number
  startBatch: number
  batchError: string | null

  // Status — typed enum, never user-supplied.
  status:
    | 'COMPLETED'
    | 'COMPLETED_WITH_ERRORS'
    | 'PARTIAL'
    | 'FAILED'

  mode: string

  // Optional metadata for the download-report helper. Values are primitives
  // only — never objects. Used purely for display in the .txt header.
  metadata?: Record<string, string | number | boolean | null>
}

// ── Normalization helpers ──────────────────────────────────────────────────

/**
 * Convert a single API/Dexie issue value into a safe display string.
 *
 * Accepts:
 *  - string                 → returned as-is (after trim)
 *  - {row, sheet, message…} → "Baris {row} [{sheet}]: {message}"
 *  - null / undefined       → "" (filtered out by normalizeIssueList)
 *  - anything else          → safe String() fallback
 *
 * NEVER throws. NEVER returns an object.
 */
export function normalizeMigrationIssue(issue: unknown): string {
  // Fast path: string.
  if (typeof issue === 'string') {
    return issue.trim()
  }

  // Null/undefined → empty string (caller filters).
  if (issue === null || issue === undefined) {
    return ''
  }

  // Structured issue object.
  if (typeof issue === 'object') {
    const v = issue as Record<string, unknown>

    const row =
      typeof v.row === 'number' && Number.isFinite(v.row)
        ? `Baris ${v.row}`
        : typeof v.row === 'string' && v.row.trim() !== ''
          ? `Baris ${v.row.trim()}`
          : '' // row missing — use placeholder only if we have other context

    const sheet =
      typeof v.sheet === 'string' && v.sheet.trim() !== ''
        ? ` [${v.sheet.trim()}]`
        : ''

    const identifier =
      typeof v.identifier === 'string' && v.identifier.trim() !== ''
        ? ` — ${v.identifier.trim()}`
        : ''

    // Message: prefer explicit .message string; fall back to JSON for unknown
    // object shapes (rare; only for legacy/corrupted payloads). Never [object Object].
    let message = ''
    if (typeof v.message === 'string') {
      message = v.message.trim()
    } else if (v.message !== undefined && v.message !== null) {
      try {
        message = JSON.stringify(v.message)
      } catch {
        message = String(v.message)
      }
    }

    // Compose: prefer "Baris N [sheet]: message", but degrade gracefully
    // when only the message is present (e.g. warnings without row numbers).
    if (row && message) {
      return `${row}${sheet}${identifier}: ${message}`.trim()
    }
    if (row && !message) {
      return `${row}${sheet}${identifier}`.trim()
    }
    if (!row && message) {
      // No row context — just the message (with optional sheet/identifier prefix).
      const prefix = sheet || identifier
      return prefix ? `${prefix.replace(/^ /, '').trim()}: ${message}`.trim() : message
    }

    // Object with neither row nor message — fall through to safe stringify.
    try {
      const json = JSON.stringify(v)
      if (json && json !== '{}') return json
    } catch {
      // ignore
    }
    return ''
  }

  // Numbers, booleans, etc.
  if (typeof issue === 'number' || typeof issue === 'boolean') {
    return String(issue)
  }

  // Last-resort safe coercion (functions, symbols, etc.).
  try {
    const s = String(issue)
    return s === '[object Object]' ? '' : s
  } catch {
    return ''
  }
}

/**
 * Normalize a list of unknown issue values into an array of non-empty strings.
 *
 *  - Non-array input → []
 *  - Each entry is normalized via normalizeMigrationIssue
 *  - Empty strings are filtered out (no "· " bullets with no text)
 *  - Duplicates beyond the cap (500) are dropped to bound dialog memory
 */
export function normalizeIssueList(list: unknown, max = 500): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const item of list) {
    const s = normalizeMigrationIssue(item)
    if (s) {
      out.push(s)
      if (out.length >= max) break
    }
  }
  return out
}

/**
 * Coerce a count-like value to a safe non-negative integer.
 * Handles: undefined, null, NaN, Infinity, strings, etc.
 */
export function safeCount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    return Math.floor(v)
  }
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return 0
}

/**
 * Coerce a value to a safe string-or-null. Used for `batchError` which is
 * typed as `string | null` but may be an object in legacy Dexie records.
 */
export function safeStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  // Object/array — normalize via the issue helper (never [object Object]).
  const s = normalizeMigrationIssue(v)
  return s || null
}

/**
 * Coerce a value to a safe number-or-undefined. Used for optional numeric
 * extras (inventoryItemsCreated, totalStock, etc.).
 */
export function safeOptionalNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}
