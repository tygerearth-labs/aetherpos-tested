/**
 * AETHER BULK ENGINE V1 — error export (row-level errors → xlsx).
 *
 * Canonical 9-column contract (AETHER BULK TEMPLATE CONTRACT ALIGNMENT):
 *   Batch | Baris | Field | Kode Error | Pesan Error | Nilai Asli |
 *   Nilai Normalisasi | Snapshot Baris | Saran Perbaikan
 *
 * Rules:
 *  - NEVER export a blank `Field` — fall back to the row's primary identifier.
 *  - NEVER export a blank `Pesan Error` — fall back to the error code.
 *  - When `originalValue` / `normalizedValue` / `suggestion` are absent on the
 *    record, the cell is empty (not 'undefined').
 *  - `Snapshot Baris` is capped at 500 chars to keep the cell readable.
 *
 * This exporter is consumed by:
 *  - bulk-engine flows (purchase:add, purchase:edit, product:*, inventory:edit,
 *    customer:*) via /src/components/bulk-engine/bulk-worker-provider.tsx
 *  - migration import (when the frontend requests an error file)
 *  - purchase import (when the frontend requests an error file)
 */

import type { BulkErrorRecord } from './dexie-db'

/** The canonical 9 column headers, in canonical order. */
export const ERROR_EXPORT_COLUMNS = [
  'Batch',
  'Baris',
  'Field',
  'Kode Error',
  'Pesan Error',
  'Nilai Asli',
  'Nilai Normalisasi',
  'Snapshot Baris',
  'Saran Perbaikan',
] as const

export async function exportErrorsToXlsx(
  job: { fileName: string; kind: string },
  errors: BulkErrorRecord[],
): Promise<Blob> {
  const XLSX = await import('xlsx')

  const aoa: (string | number)[][] = []
  // Header row — canonical 9 columns.
  aoa.push([...ERROR_EXPORT_COLUMNS])

  for (const e of errors) {
    const snapshot = Object.entries(e.rowSnapshot || {})
      .map(([k, v]) => `${k}=${v === null || v === undefined ? '' : String(v)}`)
      .join(' | ')
      .slice(0, 500)

    // NEVER blank Field — fall back to row's primary identifier.
    const field =
      e.field ||
      (typeof e.rowSnapshot?.name === 'string' && e.rowSnapshot.name
        ? `name=${e.rowSnapshot.name}`
        : '') ||
      (typeof e.rowSnapshot?.['Nama Barang*'] === 'string' && e.rowSnapshot['Nama Barang*']
        ? `Nama Barang*=${e.rowSnapshot['Nama Barang*']}`
        : '') ||
      '(tidak diketahui)'

    // NEVER blank Pesan Error — fall back to the code.
    const message = e.message || e.code || '(tidak ada pesan)'

    aoa.push([
      e.batchIndex + 1,
      e.rowIndex,
      field,
      e.code,
      message,
      e.originalValue ?? '',
      e.normalizedValue ?? '',
      snapshot,
      e.suggestion ?? '',
    ])
  }

  if (errors.length === 0) {
    aoa.push(['', '', '', '', 'Tidak ada error', '', '', '', ''])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Set column widths — 9 columns.
  ws['!cols'] = [
    { wch: 8 },   // Batch
    { wch: 8 },   // Baris
    { wch: 22 },  // Field
    { wch: 20 },  // Kode Error
    { wch: 50 },  // Pesan Error
    { wch: 20 },  // Nilai Asli
    { wch: 20 },  // Nilai Normalisasi
    { wch: 60 },  // Snapshot Baris
    { wch: 50 },  // Saran Perbaikan
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Errors')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Trigger a browser download of the errors blob. */
export function downloadErrorsBlob(blob: Blob, jobFileName: string): void {
  const base = jobFileName.replace(/\.(xlsx|xls|csv)$/i, '')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${base}-errors.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
