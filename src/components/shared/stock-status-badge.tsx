'use client'

import { AlertTriangle, PackageX } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StockStatus = 'out' | 'low' | 'ok'

interface StockStatusBadgeProps {
  /** Current stock value. */
  stock: number
  /** Low-stock threshold (inclusive). When stock > 0 && stock <= threshold → 'low'. */
  lowThreshold: number
  /** Optional className passthrough. */
  className?: string
}

/**
 * Derive the stock status from raw values.
 *
 *   stock === 0                       → 'out'   (Stok Habis)
 *   stock > 0 && stock <= threshold   → 'low'   (Stok Rendah)
 *   otherwise                         → 'ok'    (no badge — "Aman" dihilangkan dari list)
 */
export function deriveStockStatus(stock: number, lowThreshold: number): StockStatus {
  if (stock <= 0) return 'out'
  if (stock <= lowThreshold) return 'low'
  return 'ok'
}

/**
 * StockStatusBadge — compact inline badge for the stock cell.
 *
 * Per spec point 2 (STATUS PLACEMENT):
 *   - Stok Rendah → amber tint, AlertTriangle icon
 *   - Stok Habis  → red tint, PackageX icon
 *   - Aman / Tersedia → NO badge (returns null) — hilangkan dari list utama
 *
 * Per spec point 3 (REMOVE AGGRESSIVE HIGHLIGHT):
 *   - No animation (no animate-pulse / animate-ping)
 *   - Compact, does not change row height (text-[10px], py-0, h-4)
 *
 * Placement: render inside the Stok cell, alongside the numeric stock value.
 */
export function StockStatusBadge({ stock, lowThreshold, className }: StockStatusBadgeProps) {
  const status = deriveStockStatus(stock, lowThreshold)

  if (status === 'ok') return null

  const isOut = status === 'out'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-semibold tracking-wide uppercase whitespace-nowrap shrink-0',
        isOut
          ? 'bg-red-500/15 text-red-400 ring-1 ring-red-500/25'
          : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25',
        className,
      )}
      title={isOut ? 'Stok habis' : 'Stok rendah'}
    >
      {isOut ? <PackageX className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
      {isOut ? 'Habis' : 'Rendah'}
    </span>
  )
}

/**
 * Helper: get the text color class for a stock number based on its status.
 * Use this to color the numeric value itself (spec point 3: "warna angka stok sesuai status").
 *
 *   out  → text-red-400
 *   low  → text-amber-400
 *   ok   → text-slate-200 (default)
 */
export function stockValueColorClass(stock: number, lowThreshold: number): string {
  const status = deriveStockStatus(stock, lowThreshold)
  if (status === 'out') return 'text-red-400'
  if (status === 'low') return 'text-amber-400'
  return 'text-slate-200'
}

export default StockStatusBadge
