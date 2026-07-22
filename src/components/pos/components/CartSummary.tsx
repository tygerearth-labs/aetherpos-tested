/**
 * CartSummary — Presentational component for cart totals & summary section
 *
 * Extracted from pos-page.tsx (lines 917-1002)
 * Renders subtotal, discounts, tax, total, points usage, and below-HPP warnings.
 *
 * @module components/pos/components/CartSummary
 */

import React from 'react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Coins, Tag, AlertTriangle } from 'lucide-react'

/** Props for CartSummary */
export interface CartSummaryProps {
  // ── Totals from usePosCart ────────────────────────────────
  subtotal: number
  manualDiscountTotal: number
  pointsDiscount: number
  promoDiscount: number
  ppnAmount: number
  total: number
  paidAmount: string
  change: number
  hasBelowHpp: boolean
  belowHppItems: any[]

  // ── Points ────────────────────────────────────────────────
  maxPointsToUse: number
  pointsToUse: number

  // ── Settings ──────────────────────────────────────────────
  ppnEnabled: boolean
  loyaltyEnabled: boolean
  ppnRate?: number

  // ── Points display context ────────────────────────────────
  /** Selected customer's point balance (for display) */
  customerPoints?: number
  /** Loyalty point value setting */
  loyaltyPointValue?: number
  /** Promo name to display alongside promo discount */
  promoName?: string | null

  // ── Callbacks ─────────────────────────────────────────────
  onSetPointsToUse: (points: number) => void
  onSetPaidAmount: (amount: string) => void

  // ── Helpers ───────────────────────────────────────────────
  formatCurrency: (amount: number) => string
}

/**
 * CartSummary — Displays cart financial summary including:
 *
 * - Subtotal
 * - Manual discount (if any)
 * - Points discount (if any)
 * - Promo discount (if any)
 * - PPN/Tax (if enabled)
 * - Grand Total
 * - Points usage input (when loyalty enabled and customer selected)
 * - Below-HPP warning (if items are priced below cost)
 *
 * @example
 * ```tsx
 * <CartSummary
 *   subtotal={cartHook.subtotal}
 *   manualDiscountTotal={cartHook.manualDiscountTotal}
 *   pointsDiscount={cartHook.pointsDiscount}
 *   promoDiscount={promoDiscount}
 *   ppnAmount={cartHook.ppnAmount}
 *   total={cartHook.total}
 *   paidAmount={checkoutHook.paidAmount}
 *   change={checkoutHook.change}
 *   hasBelowHpp={cartHook.hasBelowHpp}
 *   belowHppItems={cartHook.belowHppItems}
 *   maxPointsToUse={cartHook.maxPointsToUse}
 *   pointsToUse={cartHook.pointsToUse}
 *   ppnEnabled={settings.ppnEnabled}
 *   loyaltyEnabled={settings.loyaltyEnabled}
 *   ppnRate={settings.ppnRate}
 *   customerPoints={selectedCustomer?.points}
 *   loyaltyPointValue={settings.loyaltyPointValue}
 *   promoName={selectedPromo?.name}
 *   onSetPointsToUse={(p) => checkoutHook.handlePointsChange(String(p))}
 *   onSetPaidAmount={checkoutHook.setPaidAmount}
 *   formatCurrency={formatCurrency}
 * />
 * ```
 */
export default function CartSummary(props: CartSummaryProps) {
  const {
    subtotal,
    manualDiscountTotal,
    pointsDiscount,
    promoDiscount,
    ppnAmount,
    total,
    hasBelowHpp,
    belowHppItems,
    maxPointsToUse,
    pointsToUse,
    ppnEnabled,
    loyaltyEnabled,
    ppnRate = 11,
    customerPoints,
    loyaltyPointValue = 100,
    promoName,
    onSetPointsToUse,
    formatCurrency,
  } = props

  return (
    <>
      {/* Subtotal row */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-500">Subtotal</span>
        <span className="text-slate-300 font-medium tabular-nums">{formatCurrency(subtotal)}</span>
      </div>

      {/* Manual Discount (if any) */}
      {manualDiscountTotal > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-amber-400">Diskon Manual</span>
          <span className="text-amber-400 font-medium tabular-nums">-{formatCurrency(manualDiscountTotal)}</span>
        </div>
      )}

      {/* Points Discount (if any) */}
      {pointsDiscount > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cyan-400 flex items-center gap-1">
            <Coins className="h-3 w-3" strokeWidth={1.5} /> Poin ({pointsToUse})
          </span>
          <span className="text-cyan-400 font-medium tabular-nums">-{formatCurrency(pointsDiscount)}</span>
        </div>
      )}

      {/* Promo Discount (if any) */}
      {promoDiscount > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-emerald-400 flex items-center gap-1">
            <Tag className="h-3 w-3" strokeWidth={1.5} /> {promoName || 'Promo'}
          </span>
          <span className="text-emerald-400 font-medium tabular-nums">-{formatCurrency(promoDiscount)}</span>
        </div>
      )}

      {/* PPN/Tax (if enabled) */}
      {ppnAmount > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">PPN ({ppnRate}%)</span>
          <span className="text-slate-300 font-medium tabular-nums">{formatCurrency(ppnAmount)}</span>
        </div>
      )}

      <Separator className="bg-white/[0.06]" />

      {/* Total */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">Total</span>
        <span className="text-lg font-bold theme-text tabular-nums">{formatCurrency(total)}</span>
      </div>

      {/* Points usage (if customer selected with points) */}
      {customerPoints != null && customerPoints > 0 && loyaltyEnabled && (
        <div className="pt-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">Poin tersedia</span>
            <span className="text-amber-400 font-medium">
              {customerPoints} poin (maks. {formatCurrency(Math.min(customerPoints * loyaltyPointValue, subtotal - manualDiscountTotal - promoDiscount))})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-slate-500 shrink-0">Gunakan poin:</Label>
            <input
              type="number"
              min="0"
              max={maxPointsToUse}
              value={pointsToUse || ''}
              onChange={(e) => {
                const val = e.target.value === '' ? 0 : Number(e.target.value)
                onSetPointsToUse(val)
              }}
              placeholder="0"
              className="flex-1 h-7 text-xs bg-white/[0.04] border border-white/[0.08] text-white rounded-lg px-2 outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            {pointsToUse > 0 && (
              <span className="text-[10px] text-cyan-400 font-medium shrink-0">-{formatCurrency(pointsDiscount)}</span>
            )}
          </div>
        </div>
      )}

      {/* Below-HPP Warning */}
      {hasBelowHpp && (
        <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/15">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" strokeWidth={1.5} />
          <div className="text-[10px] text-red-400/90 leading-relaxed">
            <p className="font-semibold">&nbsp;{belowHppItems.length} item di bawah HPP!</p>
            <p className="mt-0.5">Periksa item yang merugi.</p>
          </div>
        </div>
      )}
    </>
  )
}
