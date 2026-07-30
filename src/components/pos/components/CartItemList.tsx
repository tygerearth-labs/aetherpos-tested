/* eslint-disable react-hooks/refs -- Refs are passed as props and only assigned to DOM elements, never read during render */

/**
 * CartItemList — Presentational component for rendering cart items
 *
 * Layout: stable 3-column CSS grid per item
 *   ┌──────────┬─────────────────────────┬──────────────┐
 *   │ THUMB    │ Product name (1-2 ln)   │ Subtotal     │
 *   │ 52/44px  │ Variant attrs (badge)   │ (bold/white) │
 *   │          │ SKU · unit price (muted)│ [−] qty [+]  │
 *   └──────────┴─────────────────────────┴──────────────┘
 *
 * The content column uses minmax(0, 1fr) so long product names can NEVER
 * push the price/qty controls. The action column has a fixed width, locking
 * subtotal + qty control to the right edge at all times.
 *
 * Visual hierarchy (priority): name > subtotal > qty > unit price > SKU.
 * Subtotal is bold/white; unit price is muted/smaller.
 *
 * @module components/pos/components/CartItemList
 */

import React, { useState } from 'react'
import { cn } from '@/lib/utils'
import { Minus, Plus, X, Pencil, Package } from 'lucide-react'

/** Cart item shape (mirrors usePosCart CartItem — broadened with sku/unit/price for display) */
export interface CartItem {
  product: {
    id: string
    name: string
    image?: string | null
    sku?: string | null
    unit?: string
    price?: number
  }
  variant?: {
    id: string
    name: string
    sku?: string | null
    price?: number
  } | null
  qty: number
  customPrice?: number | null
}

/** Props for CartItemList */
export interface CartItemListProps {
  /** Array of cart items to render */
  cart: CartItem[]
  /** When false, renders card-style layout (larger touch targets); when true, renders compact desktop layout */
  compact?: boolean

  // ── Read-only accessors from usePosCart ────────────────────
  getCartKey: (productId: string, variantId: string | null) => string
  getItemPrice: (item: CartItem) => number
  getEffectivePrice: (item: CartItem) => number
  getItemStock: (item: CartItem) => number

  // ── Editing state from usePosCart ──────────────────────────
  editingQtyId: string | null
  editingQtyValue: number
  editingPriceId: string | null
  editingPriceValue: number
  priceInputRef: React.RefObject<HTMLInputElement>
  qtyInputRef: React.RefObject<HTMLInputElement>

  // ── Callbacks ──────────────────────────────────────────────
  onUpdateQty: (productId: string, qty: number, variantId?: string) => void
  onRemoveFromCart: (productId: string, variantId?: string) => void
  onStartEditQty: (itemKey: string, value: number) => void
  onConfirmEditQty: () => void
  onCancelEditQty: () => void
  onStartEditPrice: (itemKey: string, value: number) => void
  onConfirmEditPrice: () => void
  onCancelEditPrice: () => void

  // ── Display helpers ────────────────────────────────────────
  formatCurrency: (amount: number) => string
  batchInfo: Record<string, any>
  manualDiscountEnabled: boolean
}

/** Renders a single batch expiry badge for a cart item */
function BatchExpiryBadge({ productId, variantId, batchInfo }: {
  productId: string
  variantId: string | null
  batchInfo: Record<string, any>
}) {
  const bKey = `${productId}::${variantId || 'base'}`
  const bInfo = batchInfo[bKey]
  if (!bInfo || !bInfo.batchNumber) return null
  const d = bInfo.daysUntilExpiry
  if (d == null) return null
  if (d <= 7) return <span className="text-[9px] text-rose-400 leading-none whitespace-nowrap">🔴 Exp {d}h</span>
  if (d <= 30) return <span className="text-[9px] text-amber-400 leading-none whitespace-nowrap">🟠 Exp {d}h</span>
  return <span className="text-[9px] text-emerald-400 leading-none whitespace-nowrap">🟢 {bInfo.batchNumber}</span>
}

/**
 * Product image with CONSISTENT fallback.
 * Uses React state for error tracking — no DOM manipulation, no broken-image flash.
 * On error or missing src: muted background + Package icon.
 */
function ProductImage({ src, alt, size }: { src?: string | null; alt: string; size: 'mobile' | 'compact' }) {
  const [errored, setErrored] = useState(false)
  const dimensions = size === 'mobile' ? 'w-[52px] h-[52px] rounded-xl' : 'w-11 h-11 rounded-lg'
  const iconSize = size === 'mobile' ? 'h-5 w-5' : 'h-4 w-4'

  if (!src || errored) {
    return (
      <div className={cn(dimensions, 'shrink-0 bg-white/[0.04] flex items-center justify-center')}>
        <Package className={cn(iconSize, 'text-slate-600')} strokeWidth={1.5} />
      </div>
    )
  }

  return (
    <div className={cn(dimensions, 'shrink-0 overflow-hidden bg-white/[0.03]')}>
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
        onError={() => setErrored(true)}
      />
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// UNIFIED CART ITEM ROW — 3-column grid (thumbnail | content | action)
// Used for both card-style (compact=false) and compact (compact=true).
// Only sizing differs; structure is identical for layout consistency.
// ════════════════════════════════════════════════════════════

function CartItemRow({
  item,
  itemKey,
  itemTotal,
  props,
  compact,
}: {
  item: CartItem
  itemKey: string
  itemTotal: number
  props: CartItemListProps
  compact: boolean
}) {
  const hasVariant = !!item.variant
  const isEditingQty = props.editingQtyId === itemKey
  const isEditingPrice = props.editingPriceId === itemKey
  const hasCustomPrice = item.customPrice != null

  // SKU for display: variant SKU if variant, else product SKU
  const displaySku = hasVariant ? (item.variant?.sku || null) : (item.product.sku || null)
  const unit = item.product.unit || null
  const unitPrice = props.getItemPrice(item)
  const effectivePrice = props.getEffectivePrice(item)

  // Grid template: thumbnail | content(minmax(0,1fr)) | action(fixed)
  const gridCols = compact
    ? 'grid-cols-[44px_minmax(0,1fr)_108px] gap-2.5'
    : 'grid-cols-[52px_minmax(0,1fr)_132px] gap-3'

  return (
    <div className={cn(
      'grid items-start rounded-xl aether-card transition-all duration-150 overflow-hidden',
      gridCols,
      compact ? 'p-2.5' : 'p-3.5',
    )}>
      {/* ═══ COL 1: Thumbnail (52px / 44px) ═══ */}
      <ProductImage
        src={item.product.image}
        alt={item.product.name}
        size={compact ? 'compact' : 'mobile'}
      />

      {/* ═══ COL 2: Content (minmax(0, 1fr)) — name, variant, SKU·unit price ═══ */}
      <div className="min-w-0 flex flex-col gap-1">
        {/* Product name — 1-2 lines, prominent (white, semibold) */}
        <p
          className={cn(
            'font-semibold text-white leading-tight line-clamp-2 [overflow-wrap:anywhere]',
            compact ? 'text-[12px]' : 'text-[13px]',
          )}
          title={item.product.name}
        >
          {item.product.name}
        </p>

        {/* Variant attributes — 1 line, more prominent than SKU (violet badge) */}
        {hasVariant && (
          <span className="inline-flex max-w-full items-center px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/15 w-fit">
            <span className={cn('font-medium text-violet-400 truncate', compact ? 'text-[9px]' : 'text-[10px]')}>
              {item.variant!.name}
            </span>
          </span>
        )}

        {/* SKU · unit price — muted, smaller. Becomes input when price editing is active. */}
        {isEditingPrice ? (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn('text-slate-500', compact ? 'text-[9px]' : 'text-[10px]')}>Rp</span>
            <input
              ref={props.priceInputRef}
              type="number"
              min="0"
              value={props.editingPriceValue}
              onChange={() => {} /* handled internally by hook via setEditingPriceValue */}
              onBlur={() => props.onConfirmEditPrice()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onConfirmEditPrice()
                if (e.key === 'Escape') props.onCancelEditPrice()
              }}
              className={cn(
                'flex-1 min-w-0 font-bold bg-white/[0.04] border border-amber-500/25 text-amber-400 rounded-md outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                compact ? 'h-6 text-[10px]' : 'h-7 text-[11px]',
              )}
            />
          </div>
        ) : props.manualDiscountEnabled ? (
          /* Clickable unit price — starts edit on click */
          <button
            className="flex items-center gap-1 mt-0.5 group/price max-w-full"
            onClick={() => props.onStartEditPrice(itemKey, effectivePrice)}
          >
            {displaySku && (
              <span className={cn('text-slate-600 truncate', compact ? 'text-[9px]' : 'text-[10px]')}>
                {displaySku} ·
              </span>
            )}
            {hasCustomPrice && (
              <span className={cn('line-through text-slate-600 tabular-nums', compact ? 'text-[9px]' : 'text-[10px]')}>
                {props.formatCurrency(unitPrice)}
              </span>
            )}
            <span className={cn(
              'tabular-nums',
              compact ? 'text-[10px]' : 'text-[11px]',
              hasCustomPrice ? 'text-amber-400 font-medium' : 'text-slate-400',
            )}>
              {props.formatCurrency(effectivePrice)}{unit ? `/${unit}` : ''}
            </span>
            <Pencil className="h-2.5 w-2.5 text-slate-600 opacity-0 group-hover/price:opacity-100 transition-opacity shrink-0" strokeWidth={1.5} />
          </button>
        ) : (
          /* Static unit price — muted, smaller */
          <div className={cn('flex items-center gap-1 mt-0.5 max-w-full', compact ? 'text-[9px]' : 'text-[10px]')}>
            {displaySku && (
              <span className="text-slate-600 truncate">{displaySku} ·</span>
            )}
            {hasCustomPrice && (
              <span className="line-through text-slate-600 tabular-nums">
                {props.formatCurrency(unitPrice)}
              </span>
            )}
            <span className={cn('tabular-nums truncate', hasCustomPrice ? 'text-amber-400' : 'text-slate-500')}>
              {props.formatCurrency(effectivePrice)}{unit ? `/${unit}` : ''}
            </span>
          </div>
        )}

        {/* Batch expiry badge — tiny, only if batch info exists */}
        <BatchExpiryBadge
          productId={item.product.id}
          variantId={item.variant?.id || null}
          batchInfo={props.batchInfo}
        />
      </div>

      {/* ═══ COL 3: Action (fixed width) — subtotal + qty + delete ═══ */}
      <div className="flex flex-col items-end gap-1.5 min-w-0">
        {/* Subtotal — bold, white, right-aligned (highest priority after name) */}
        <p className={cn(
          'font-bold tabular-nums text-right text-white leading-tight w-full truncate',
          compact ? 'text-[13px]' : 'text-sm',
        )}>
          {props.formatCurrency(itemTotal)}
        </p>

        {/* Qty control — [−] value [+] */}
        <div className="flex items-center gap-1 justify-end">
          <button
            className={cn(
              'flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all active:scale-95',
              compact ? 'w-6 h-6' : 'w-8 h-8',
            )}
            onClick={() => props.onUpdateQty(item.product.id, item.qty - 1, item.variant?.id)}
            aria-label="Kurangi qty"
          >
            <Minus className={cn('stroke-[1.5]', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
          </button>
          {isEditingQty ? (
            <input
              ref={props.qtyInputRef}
              type="number"
              min="0"
              max={props.getItemStock(item)}
              value={props.editingQtyValue}
              onChange={() => {} /* handled internally by hook via setEditingQtyValue */}
              onBlur={() => props.onConfirmEditQty()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onConfirmEditQty()
                if (e.key === 'Escape') props.onCancelEditQty()
              }}
              className={cn(
                'font-bold text-white text-center bg-white/[0.04] border border-white/[0.08] rounded-lg outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                compact ? 'w-8 h-6 text-[11px]' : 'w-10 h-8 text-xs',
              )}
            />
          ) : (
            <span
              className={cn(
                'cursor-pointer hover:theme-text transition-colors font-bold text-white tabular-nums flex items-center justify-center',
                compact ? 'w-8 h-6 text-[11px]' : 'w-10 h-8 text-xs',
              )}
              onClick={() => props.onStartEditQty(itemKey, item.qty)}
            >
              {item.qty}
            </span>
          )}
          <button
            className={cn(
              'flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all active:scale-95',
              compact ? 'w-6 h-6' : 'w-8 h-8',
            )}
            onClick={() => props.onUpdateQty(item.product.id, item.qty + 1, item.variant?.id)}
            aria-label="Tambah qty"
          >
            <Plus className={cn('stroke-[1.5]', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
          </button>
        </div>

        {/* Delete — small, right-aligned, muted (red on hover) */}
        <button
          onClick={() => props.onRemoveFromCart(item.product.id, item.variant?.id)}
          className={cn(
            'flex items-center justify-center text-slate-600 hover:text-red-400 transition-colors',
            compact ? 'h-5 w-5' : 'h-6 w-6',
          )}
          aria-label="Hapus item"
        >
          <X className={cn('stroke-[1.5]', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════

/**
 * CartItemList — Renders cart items in a stable 3-column grid layout.
 *
 * Both `compact=false` (card-style, larger touch targets) and `compact=true`
 * (compact desktop) use the SAME grid structure — only sizing differs.
 *
 * Grid: [thumbnail | content(minmax(0,1fr)) | action(fixed)]
 * - Long product names can never push price/qty controls
 * - Subtotal is bold/white (high priority); unit price is muted/smaller
 * - Variant items show parent name + variant badge + variant SKU·unit price
 * - Thumbnail falls back to Package icon on muted bg (no broken images)
 *
 * @example
 * ```tsx
 * <CartItemList
 *   cart={cartHook.cart}
 *   compact={false}
 *   getCartKey={cartHook.getCartKey}
 *   getItemPrice={cartHook.getItemPrice}
 *   getEffectivePrice={cartHook.getEffectivePrice}
 *   getItemStock={cartHook.getItemStock}
 *   editingQtyId={cartHook.editingQtyId}
 *   editingQtyValue={cartHook.editingQtyValue}
 *   editingPriceId={cartHook.editingPriceId}
 *   editingPriceValue={cartHook.editingPriceValue}
 *   priceInputRef={cartHook.priceInputRef}
 *   qtyInputRef={cartHook.qtyInputRef}
 *   onUpdateQty={cartHook.updateQty}
 *   onRemoveFromCart={cartHook.removeFromCart}
 *   onStartEditQty={cartHook.startEditQty}
 *   onConfirmEditQty={cartHook.confirmEditQty}
 *   onCancelEditQty={cartHook.cancelEditQty}
 *   onStartEditPrice={cartHook.startEditPrice}
 *   onConfirmEditPrice={cartHook.confirmEditPrice}
 *   onCancelEditPrice={cartHook.cancelEditPrice}
 *   formatCurrency={formatCurrency}
 *   batchInfo={batchInfo}
 *   manualDiscountEnabled={settings.manualDiscountEnabled}
 * />
 * ```
 */
export default function CartItemList(props: CartItemListProps) {
  const { cart, compact = false } = props

  if (cart.length === 0) return null

  return (
    <div className={compact ? 'space-y-2 pb-2' : 'space-y-3 pb-4'}>
      {cart.map((item) => {
        const itemKey = props.getCartKey(item.product.id, item.variant?.id || null)
        const itemTotal = props.getEffectivePrice(item) * item.qty
        return (
          <CartItemRow
            key={itemKey}
            item={item}
            itemKey={itemKey}
            itemTotal={itemTotal}
            props={props}
            compact={compact}
          />
        )
      })}
    </div>
  )
}
