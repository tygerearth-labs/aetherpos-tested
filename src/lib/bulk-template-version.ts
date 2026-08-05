/**
 * AETHER BULK TEMPLATE — Shared Template Versioning Contract.
 *
 * Single source of truth for TEMPLATE_VERSION emitted by every generated
 * Excel template (migration + purchase import) and read by every parser.
 *
 * VERSIONING CONTRACT
 * ───────────────────
 *  - current version → parse normally
 *  - known older version → map aliases where safe (see ALIAS_COMPAT_MAP)
 *  - unsupported version → reject BEFORE row processing; tell the user to
 *    download the latest template
 *
 * STORAGE
 * ───────
 * The version is written to a hidden `_Meta` sheet as a single-cell key=value
 * block, AND to the workbook Properties (`wb.Props.Title`). Parsers look for
 * both — the `_Meta` sheet survives most user edits; the Properties payload
 * is a fallback for tools that strip sheets.
 *
 * This file is consumed by:
 *   - src/app/api/migration/template/route.ts        (writes MIGRATION_TEMPLATE_VERSION)
 *   - src/app/api/migration/import/route.ts          (reads it)
 *   - src/app/api/purchases/import-excel/template/route.ts  (writes PURCHASE_TEMPLATE_VERSION)
 *   - src/app/api/purchases/import-excel/route.ts    (reads it)
 */

/** Bumped whenever the template schema (headers, aliases, sheet names) changes. */
export const MIGRATION_TEMPLATE_VERSION = '2025.10.0'
export const PURCHASE_TEMPLATE_VERSION = '2025.10.0'

/** Versions older than CURRENT that we still know how to parse (with alias map). */
export const MIGRATION_SUPPORTED_OLD_VERSIONS: string[] = []
export const PURCHASE_SUPPORTED_OLD_VERSIONS: string[] = []

/** Sheet name used to embed template metadata. Hidden in the workbook. */
export const META_SHEET_NAME = '_Meta'

/** Cell key written to the _Meta sheet. */
export const META_VERSION_KEY = 'TEMPLATE_VERSION'

export type VersionCheckResult =
  | { status: 'ok'; version: string }
  | { status: 'unknown'; version: string | null }
  | { status: 'unsupported'; version: string; message: string }

/**
 * Inspect a parsed workbook's _Meta sheet (and Properties fallback) to extract
 * the TEMPLATE_VERSION stamp. Returns null when no version is present (legacy
 * file or hand-crafted).
 */
export function readTemplateVersion(
  workbook: { Sheets: Record<string, unknown>; Props?: Record<string, unknown> } | null | undefined,
): string | null {
  if (!workbook || !workbook.Sheets) return null

  // 1. _Meta sheet (preferred).
  const metaSheet = workbook.Sheets[META_SHEET_NAME]
  if (metaSheet) {
    try {
      // SheetJS exposes the sheet as an A1-keyed object. We scan the first 20
      // cells for our key (handles single-cell and key=value row layouts).
      const sheet = metaSheet as Record<string, { v?: unknown; w?: string }>
      for (const key of Object.keys(sheet)) {
        if (key.startsWith('!')) continue // skip !ref, !cols, etc.
        const cell = sheet[key]
        const raw = String(cell?.v ?? cell?.w ?? '').trim()
        if (raw.includes(META_VERSION_KEY)) {
          // "TEMPLATE_VERSION=2025.10.0" or "TEMPLATE_VERSION: 2025.10.0"
          const match = raw.match(/TEMPLATE_VERSION\s*[:=]\s*([0-9.]+)/i)
          if (match) return match[1]
        }
        if (raw === META_VERSION_KEY) {
          // The key is in this cell, the value is in the next column.
          // SheetJS A1 notation: A1, B1, C1... — adjacent column = same row.
          const m = key.match(/^([A-Z]+)(\d+)$/)
          if (m) {
            const col = m[1]
            const row = m[2]
            const nextCol = nextColumn(col)
            const nextCell = sheet[`${nextCol}${row}`]
            const v = String(nextCell?.v ?? nextCell?.w ?? '').trim()
            if (v) return v
          }
        }
      }
    } catch {
      // fall through to Properties
    }
  }

  // 2. Workbook Properties fallback.
  const title = String(workbook.Props?.Title ?? '').trim()
  const m = title.match(/TEMPLATE_VERSION\s*[:=]\s*([0-9.]+)/i)
  if (m) return m[1]

  return null
}

/** Compute the next column letter (A→B, Z→AA). Used for _Meta sheet parsing. */
function nextColumn(col: string): string {
  let carry = 1
  let out = ''
  for (let i = col.length - 1; i >= 0; i--) {
    const code = col.charCodeAt(i) - 65 + carry // A=0
    if (code >= 26) {
      out = String.fromCharCode(65 + (code - 26)) + out
      carry = 1
    } else {
      out = String.fromCharCode(65 + code) + out
      carry = 0
    }
  }
  if (carry) out = 'A' + out
  return out
}

/**
 * Decide what to do with the file based on the version stamp.
 *  - exact match to CURRENT → ok
 *  - exact match to a SUPPORTED_OLD_VERSIONS entry → ok (alias map applied downstream)
 *  - any other non-null version → unsupported (reject)
 *  - null (no stamp found) → unknown (legacy file — accept with warning)
 */
export function checkTemplateVersion(
  fileVersion: string | null,
  currentVersion: string,
  supportedOldVersions: string[],
  templateLabel: string,
): VersionCheckResult {
  if (fileVersion === null) {
    return {
      status: 'unknown',
      version: null,
    }
  }
  if (fileVersion === currentVersion) {
    return { status: 'ok', version: fileVersion }
  }
  if (supportedOldVersions.includes(fileVersion)) {
    return { status: 'ok', version: fileVersion }
  }
  return {
    status: 'unsupported',
    version: fileVersion,
    message:
      `Versi template ${templateLabel} tidak didukung (ditemukan: ${fileVersion}, ` +
      `terbaru: ${currentVersion}). Silakan unduh template terbaru sebelum import.`,
  }
}

/**
 * Build the _Meta sheet content as an array-of-arrays, ready for
 * `XLSX.utils.aoa_to_sheet`. Layout:
 *
 *   TEMPLATE_VERSION | <version>
 *   GENERATED_AT     | <iso>
 *
 * Hidden when added to the workbook (the route sets the sheet state to 'hidden').
 */
export function buildMetaSheetRows(version: string): (string)[][] {
  return [
    [META_VERSION_KEY, version],
    ['GENERATED_AT', new Date().toISOString()],
  ]
}
