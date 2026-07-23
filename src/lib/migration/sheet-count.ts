/**
 * MIG-BATCH-V3: client-side xlsx parse to count products in the non_varian
 * sheet. This lets the wizard create job + N batch records in Dexie BEFORE
 * making any server request, so the UI can show "Batch X / Y" immediately.
 *
 * Mirrors the backend's detectSheetType() + BATCH_SIZE=50 so the client-side
 * totalBatches matches the server's authoritative totalBatches (returned in
 * the batch 0 response). Any mismatch is reconciled by the processor.
 *
 * xlsx is dynamically imported so it only lands in the browser bundle when
 * the user actually starts a migration.
 */

import { MIGRATION_BATCH_SIZE } from './dexie-db'

type SheetType = 'non_varian' | 'varian' | 'inventory' | 'komposisi' | 'guide' | 'unknown'

function detectSheetType(sheetName: string): SheetType {
  const lower = sheetName.toLowerCase()
  if (lower.includes('non-varian') || lower.includes('non varian')) return 'non_varian'
  if (lower.includes('varian') && !lower.includes('non')) return 'varian'
  if (lower.includes('inventory') || lower.includes('bahan') || lower.includes('stok gudang')) return 'inventory'
  if (lower.includes('komposisi') || lower.includes('resep') || lower.includes('bom')) return 'komposisi'
  if (lower.includes('panduan') || lower.includes('guide') || lower.includes('petunjuk')) return 'guide'
  return 'unknown'
}

export interface ProductCount {
  totalProducts: number
  totalBatches: number
}

export async function countProductsInFile(file: File): Promise<ProductCount> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })

  let totalProducts = 0
  for (const sheetName of workbook.SheetNames) {
    if (detectSheetType(sheetName) !== 'non_varian') continue
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    totalProducts += rows.length
  }

  const totalBatches = totalProducts > 0 ? Math.ceil(totalProducts / MIGRATION_BATCH_SIZE) : 0
  return { totalProducts, totalBatches }
}
