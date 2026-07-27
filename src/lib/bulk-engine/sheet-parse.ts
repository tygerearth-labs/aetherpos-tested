/**
 * AETHER BULK ENGINE V1 — client-side Excel sheet parsing helper.
 *
 * Dynamic `import('xlsx')` so the SheetJS library only lands in the browser
 * bundle when a bulk upload actually starts. Reuses @/lib/excel-utils for
 * header matching / number sanitization / date parsing.
 */

import * as XLSX from 'xlsx'
import { findColumn, normalizeHeader } from '@/lib/excel-utils'
import type { ColumnSpec, ParsedRow } from './types'

export interface ParseOptions {
  sheetName?: string // if omitted, uses the first sheet
  columns: ColumnSpec[] // adapter's column specs
  headerRow?: number // 0-based row index of the header (default 0)
}

export interface ParseResult {
  rows: ParsedRow[]
  sheetName: string
  warnings: string[]
}

/**
 * Parse an Excel/CSV file into normalized ParsedRow[] keyed by column.key.
 * Uses findColumn() for flexible header matching.
 */
export function parseWorkbook(file: File, opts: ParseOptions): ParseResult {
  // Note: this function is intended to be called from an async context that
  // has already dynamically imported xlsx. We import statically here because
  // this module itself is only ever dynamically imported by adapters.
  throw new Error('Use parseWorkbookAsync instead — this sync stub is for type discovery.')
}

export async function parseWorkbookAsync(file: File, opts: ParseOptions): Promise<ParseResult> {
  // Dynamic import keeps xlsx out of the main bundle.
  const XLSXmod = await import('xlsx')
  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = XLSXmod.read(buffer, { type: 'buffer' })

  const warnings: string[] = []
  let sheetName = opts.sheetName || ''
  if (!sheetName) {
    // Prefer a sheet whose normalized name contains "non" or the first column's alias.
    const names = workbook.SheetNames
    sheetName = names[0] || ''
    for (const n of names) {
      const norm = normalizeHeader(n)
      if (norm.includes('non') || norm.includes('produk') || norm.includes('item') || norm.includes('customer') || norm.includes('promo') || norm.includes('purchase') || norm.includes('po')) {
        sheetName = n
        break
      }
    }
  }
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { rows: [], sheetName, warnings: [`Sheet "${sheetName}" tidak ditemukan`] }
  }

  const rawRows = XLSXmod.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  })

  const headerOffset = opts.headerRow || 0
  const dataRows = rawRows.slice(headerOffset)

  const rows: ParsedRow[] = []
  for (let i = 0; i < dataRows.length; i++) {
    const raw = dataRows[i]
    // Skip fully-empty rows.
    const hasData = Object.values(raw).some(
      (v) => v !== null && v !== undefined && String(v).trim() !== '',
    )
    if (!hasData) continue

    const data: Record<string, unknown> = {}
    for (const col of opts.columns) {
      const aliases = col.aliases || [col.label]
      const val = findColumn(raw, aliases)
      data[col.key] = val
    }

    rows.push({
      rowIndex: i + 1 + headerOffset, // 1-based, accounting for header
      data,
      raw,
    })
  }

  if (rows.length === 0) {
    warnings.push('Tidak ada baris data ditemukan di sheet.')
  }

  return { rows, sheetName, warnings }
}

/** Generate a template workbook buffer (for client-side template download). */
export async function generateTemplate(columns: ColumnSpec[], sheetName = 'Data'): Promise<Blob> {
  const XLSXmod = await import('xlsx')
  const headerRow = columns.map((c) => c.label)
  const exampleRow = columns.map((c) => {
    if (c.type === 'number') return 0
    if (c.type === 'date') return ''
    if (c.type === 'boolean') return ''
    return ''
  })
  const aoa = [headerRow, exampleRow]
  const ws = XLSXmod.utils.aoa_to_sheet(aoa)
  const wb = XLSXmod.utils.book_new()
  XLSXmod.utils.book_append_sheet(wb, ws, sheetName)
  const out = XLSXmod.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
