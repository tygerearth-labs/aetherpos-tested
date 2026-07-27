/**
 * AETHER BULK ENGINE V1 — Universal cell semantics.
 *
 * Rules:
 *  - blank  = no change (skip the field on update)
 *  - 0      = valid value (treated as 0, NOT blank)
 *  - CLEAR  = clear supported field (set to null)
 *  - DELETE = only when adapter explicitly supports it
 *
 * Token matching is case-insensitive and trimmed. "CLEAR" and "HAPUS" both
 * map to clear; "DELETE" and "HAPUS_ROW" map to delete.
 */

import { isPresent } from '@/lib/excel-utils'
import type { CellInterpretation } from './types'

const CLEAR_TOKENS = new Set(['clear', 'hapus', 'kosongkan', 'reset'])
const DELETE_TOKENS = new Set(['delete', 'hapus_row', 'hapus-baris', 'del'])

/** True when the cell is blank (null/undefined/empty-string/whitespace). */
export function isBlankCell(val: unknown): boolean {
  return !isPresent(val)
}

/** True when the cell equals a CLEAR token (case-insensitive). */
export function isClearToken(val: unknown): boolean {
  if (typeof val !== 'string') return false
  return CLEAR_TOKENS.has(val.trim().toLowerCase())
}

/** True when the cell equals a DELETE token (case-insensitive). */
export function isDeleteToken(val: unknown): boolean {
  if (typeof val !== 'string') return false
  return DELETE_TOKENS.has(val.trim().toLowerCase())
}

/**
 * Interpret a raw cell value per universal semantics.
 * `supportsClear` / `supportsDelete` control whether those tokens are
 * recognized; if not supported, the token is treated as a literal value.
 */
export function interpretCell(
  val: unknown,
  opts: { supportsClear?: boolean; supportsDelete?: boolean } = {},
): CellInterpretation {
  if (isBlankCell(val)) return { kind: 'blank' }
  if (opts.supportsClear && isClearToken(val)) return { kind: 'clear' }
  if (opts.supportsDelete && isDeleteToken(val)) return { kind: 'delete' }
  // Normalize: numbers stay numbers, everything else stringified.
  if (typeof val === 'number') return { kind: 'value', value: val }
  if (typeof val === 'boolean') return { kind: 'value', value: val }
  return { kind: 'value', value: String(val).trim() }
}

/** Helper: apply a CellInterpretation to a target field on an update payload. */
export function applyCell(
  interp: CellInterpretation,
  currentValue: unknown,
): { changed: boolean; value: unknown } {
  switch (interp.kind) {
    case 'blank':
      return { changed: false, value: currentValue }
    case 'clear':
      return { changed: true, value: null }
    case 'delete':
      return { changed: true, value: null } // delete handled by adapter at entity level
    case 'value':
      return { changed: true, value: interp.value }
  }
}
