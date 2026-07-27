/**
 * AETHER BULK ENGINE V1 — error export (row-level errors → xlsx).
 *
 * Exports all BulkErrorRecord for a job to an .xlsx file with:
 *  - Batch index
 *  - Row index (in original file)
 *  - Field (if known)
 *  - Error code
 *  - Error message
 *  - Row snapshot (key cells for debugging)
 */

import type { BulkErrorRecord } from './dexie-db'

export async function exportErrorsToXlsx(
  job: { fileName: string; kind: string },
  errors: BulkErrorRecord[],
): Promise<Blob> {
  const XLSX = await import('xlsx')

  const aoa: (string | number)[][] = []
  // Header row.
  aoa.push(['Batch', 'Baris', 'Field', 'Kode Error', 'Pesan Error', 'Snapshot Baris'])

  for (const e of errors) {
    const snapshot = Object.entries(e.rowSnapshot || {})
      .map(([k, v]) => `${k}=${v === null || v === undefined ? '' : String(v)}`)
      .join(' | ')
      .slice(0, 500)
    aoa.push([
      e.batchIndex + 1,
      e.rowIndex,
      e.field || '',
      e.code,
      e.message,
      snapshot,
    ])
  }

  if (errors.length === 0) {
    aoa.push(['', '', '', '', 'Tidak ada error', ''])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Set column widths.
  ws['!cols'] = [
    { wch: 8 },
    { wch: 8 },
    { wch: 18 },
    { wch: 16 },
    { wch: 50 },
    { wch: 60 },
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
