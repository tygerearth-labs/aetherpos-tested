/**
 * Shared types, helpers, and constants for the Stock Opname V3 UI.
 *
 * Extracted from stock-opname-page.tsx to keep the page file focused on
 * orchestration. This is NOT the SO-V2-DEBT-1 full refactor — just shared
 * plumbing for the V3 sub-components.
 */

import type { OpnameScope, SnapshotItem, CompletionSummary } from '@/lib/stock-opname/service'

export type { OpnameScope, SnapshotItem, CompletionSummary }

export const VARIANCE_EPSILON = 0.001

export type CountingFilter = 'ALL' | 'UNCOUNTED' | 'COUNTED' | 'MATCHED' | 'DIFFERENCE'
export type SortMode = 'NAME' | 'SKU' | 'CATEGORY' | 'LAST_COUNTED'

export interface OpnameCategory {
  id: string
  name: string
  itemCount: number
}

export interface ModeOption {
  value: OpnameScope
  label: string
  description: string
  hint: string
}

export const MODE_OPTIONS: ModeOption[] = [
  {
    value: 'ALL_ITEMS',
    label: 'Semua Item',
    description: 'Hitung seluruh item inventory aktif di outlet.',
    hint: 'Cocok untuk stock opname penuh.',
  },
  {
    value: 'CATEGORY',
    label: 'Per Kategori',
    description: 'Hitung stok bertahap berdasarkan kategori.',
    hint: 'Cocok untuk toko yang tetap beroperasi.',
  },
  {
    value: 'SELECTED_ITEMS',
    label: 'Pilih Item Tertentu',
    description: 'Pilih item satu per satu untuk pengecekan parsial.',
    hint: 'Cocok untuk audit item tertentu.',
  },
]

export const STATUS_FILTER_OPTIONS: Array<{ value: CountingFilter; label: string }> = [
  { value: 'ALL', label: 'Semua' },
  { value: 'UNCOUNTED', label: 'Belum dihitung' },
  { value: 'COUNTED', label: 'Sudah dihitung' },
  { value: 'MATCHED', label: 'Sesuai' },
  { value: 'DIFFERENCE', label: 'Ada selisih' },
]

export const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'NAME', label: 'Nama' },
  { value: 'SKU', label: 'SKU' },
  { value: 'CATEGORY', label: 'Kategori' },
  { value: 'LAST_COUNTED', label: 'Terakhir dihitung' },
]

// ── Formatting helpers ──

export function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function fmtDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Strip trailing zeros for display: 5.00 → "5", 5.50 → "5.5", 5.25 → "5.25"
 */
export function fmtQty(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return rounded.toFixed(3).replace(/\.?0+$/, '') || '0'
}

/**
 * Format a signed delta: +3, −2, 0
 */
export function fmtSignedDelta(n: number): string {
  if (Math.abs(n) < VARIANCE_EPSILON) return '0'
  const sign = n > 0 ? '+' : '−'  // Unicode minus for display
  return `${sign}${fmtQty(Math.abs(n))}`
}

// ── Variance helpers ──

export function varianceOf(s: SnapshotItem): number {
  if (s.physicalQty === null) return 0
  return (s.physicalQty ?? 0) - s.systemQty
}

export function isMatched(s: SnapshotItem): boolean {
  return s.physicalQty !== null && Math.abs(varianceOf(s)) < VARIANCE_EPSILON
}

export function isDifference(s: SnapshotItem): boolean {
  return s.physicalQty !== null && Math.abs(varianceOf(s)) >= VARIANCE_EPSILON
}

/**
 * Human-readable impact text for review/complete screens.
 * "Kurangi stok 3 pcs" / "Tambah stok 2 pcs" / "Tidak ada perubahan"
 */
export function impactText(s: SnapshotItem): string {
  const diff = varianceOf(s)
  if (Math.abs(diff) < VARIANCE_EPSILON) return 'Tidak ada perubahan'
  const abs = fmtQty(Math.abs(diff))
  const unit = s.itemUnit
  if (diff > 0) return `Tambah stok ${abs} ${unit}`
  return `Kurangi stok ${abs} ${unit}`
}
