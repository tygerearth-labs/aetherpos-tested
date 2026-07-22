/* eslint-disable react-hooks/refs -- Refs are passed as props and only assigned to DOM elements, never read during render */

/**
 * CartItemList — Presentational component for rendering cart items
 *
 * Extracted from pos-page.tsx (lines 604-915)
 * Combines mobile card-style and compact/desktop layouts via the `compact` prop.
 *
 * @module components/pos/components/CartItemList
 */

import React from 'react'
import { cn } from '@/lib/utils'
import { Minus, Plus, X, Trash2, Pencil, Package } from 'lucide-react'

/** Cart item shape (mirrors usePosCart CartItem) */
export interface CartItem {
  product: {
    id: string
    name: string
    image?: string | null
  }
  variant?: {
    id: string
    name: string
  } | null
  qty: number
  customPrice?: number | null
}

/** Props for CartItemList */
export interface CartItemListProps {
  /** Array of cart items to render */
  cart: CartItem[]
  /** When false, renders mobile card-style layout; when true, renders compact desktop layout */
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
  if (d <= 7) return <span className="text-[10px] text-rose-400 leading-tight">🔴 Exp {d} hari</span>
  if (d <= 30) return <span className="text-[10px] text-amber-400 leading-tight">🟠 Exp {d} hari</span>
  return <span className="text-[10px] text-emerald-400 leading-tight">🟢 Batch: {bInfo.batchNumber}</span>
}

/** Product image with fallback icon */
function ProductImage({ src, alt, size }: { src?: string | null; alt: string; size: 'mobile' | 'compact' | 'default' }) {
  const dimensions =
    size === 'mobile' ? 'w-12 h-12 rounded-xl' :
    size === 'compact' ? 'w-11 h-11 rounded-lg' :
    'w-9 h-9 rounded-lg'

  const iconSize = size === 'mobile' ? 'h-5 w-5 text-slate-600' : 'h-3.5 w-3.5 text-slate-700'
  const fallbackClass = size === 'mobile' ? 'img-fb' : 'img-fallback'

  if (src) {
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden relative bg-white/[0.03]`}>
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            const fb = e.currentTarget.parentElement?.querySelector(`.${fallbackClass}`)
            if (fb) fb.setAttribute('style', 'display:flex')
          }}
        />
        <div className={`${fallbackClass} absolute inset-0 items-center justify-center bg-white/[0.03] hidden`}>
          <Package className={iconSize} strokeWidth={1.5} />
        </div>
      </div>
    )
  }

  return (
    <div className={`${dimensions} shrink-0 bg-white/[0.03] flex items-center justify-center`}>
      <Package className={iconSize} strokeWidth={1.5} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// MOBILE CARD-STYLE ITEM
// ════════════════════════════════════════════════════════════

function MobileCartItem({
  item,
  itemKey,
  itemTotal,
  props
}: {
  item: CartItem
  itemKey: string
  itemTotal: number
  props: CartItemListProps
}) {
  return (
    <div key={itemKey} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      {/* Top: Image + Name + Delete */}
      <div className="flex items-center gap-3 mb-3">
        <ProductImage src={item.product.image} alt={item.product.name} size="mobile" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-white truncate">{item.product.name}</p>
          {item.variant && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/15 mt-1">
              <span className="text-[10px] font-medium text-violet-400">{item.variant.name}</span>
            </span>
          )}
          <BatchExpiryBadge
            productId={item.product.id}
            variantId={item.variant?.id || null}
            batchInfo={props.batchInfo}
          />
        </div>
        <button
          onClick={() => props.onRemoveFromCart(item.product.id, item.variant?.id)}
          className="h-9 w-9 flex items-center justify-center rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all active:scale-95"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      {/* Bottom: Price + Qty + Total */}
      <div className="flex items-center justify-between gap-3">
        {/* Price info */}
        <div className="min-w-0">
          {props.editingPriceId === itemKey ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500">Rp</span>
              <input
                ref={props.priceInputRef}
                type="number"
                min="0"
                value={props.editingPriceValue}
                onChange={() => {} /* handled internally by hook */}
                onBlur={() => {} /* handled internally */}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') props.onConfirmEditPrice()
                  if (e.key === 'Escape') props.onCancelEditPrice()
                }}
                className="flex-1 h-8 text-sm font-bold bg-white/[0.04] border border-amber-500/25 text-amber-400 rounded-lg outline-none text-right min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          ) : props.manualDiscountEnabled ? (
            <button onClick={() => props.onStartEditPrice(itemKey, props.getEffectivePrice(item))} className="text-left">
              {item.customPrice != null && (
                <span className="block text-[11px] text-slate-500 line-through">{props.formatCurrency(props.getItemPrice(item))}</span>
              )}
              <div className="flex items-center gap-1">
                <span className={cn('text-[13px] font-medium', item.customPrice != null ? 'text-amber-400' : 'text-slate-300')}>
                  @{props.formatCurrency(props.getEffectivePrice(item))}
                </span>
                <Pencil className="h-3 w-3 text-slate-500" strokeWidth={1.5} />
              </div>
            </button>
          ) : (
            <span className="text-[13px] text-slate-400">@{props.formatCurrency(props.getItemPrice(item))}</span>
          )}
          <span className="text-[11px] text-slate-500 mt-0.5 block">&times; {item.qty} item</span>
        </div>

        {/* Qty stepper — LARGE touch targets */}
        <div className="flex items-center gap-1">
          <button
            className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all"
            onClick={() => props.onUpdateQty(item.product.id, item.qty - 1, item.variant?.id)}
          >
            <Minus className="h-4 w-4" strokeWidth={1.5} />
          </button>
          {props.editingQtyId === itemKey ? (
            <input
              ref={props.qtyInputRef}
              type="number"
              min="0"
              max={props.getItemStock(item)}
              value={props.editingQtyValue}
              onChange={() => {} /* handled internally */}
              onBlur={() => props.onConfirmEditQty()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onConfirmEditQty()
                if (e.key === 'Escape') props.onCancelEditQty()
              }}
              className="w-12 h-10 text-[15px] font-bold text-white text-center bg-white/[0.04] border border-white/[0.08] rounded-xl outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : (
            <span
              className="w-12 text-center text-[15px] font-bold text-white cursor-pointer hover:theme-text transition-colors"
              onClick={() => props.onStartEditQty(itemKey, item.qty)}
            >{item.qty}</span>
          )}
          <button
            className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all"
            onClick={() => props.onUpdateQty(item.product.id, item.qty + 1, item.variant?.id)}
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Total */}
        <p className="text-[15px] font-bold theme-text shrink-0 tabular-nums">{props.formatCurrency(itemTotal)}</p>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// COMPACT / DESKTOP ITEM
// ════════════════════════════════════════════════════════════

function CompactCartItem({
  item,
  itemKey,
  itemTotal,
  props
}: {
  item: CartItem
  itemKey: string
  itemTotal: number
  props: CartItemListProps
}) {
  return (
    <div key={itemKey} className={cn(
      'group flex items-center gap-2.5 rounded-xl aether-card transition-all duration-150',
      props.compact ? 'p-3' : 'p-2.5'
    )}>
      {/* Product Image */}
      <ProductImage
        src={item.product.image}
        alt={item.product.name}
        size={props.compact ? 'compact' : 'default'}
      />

      {/* Product Info */}
      <div className="flex-1 min-w-0">
        <p className={cn('font-semibold text-white truncate leading-tight', props.compact ? 'text-[13px]' : 'text-xs')}>
          {item.product.name}
        </p>
        {item.variant && (
          <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/15">
            <span className="text-[9px] font-medium text-violet-400 leading-tight">{item.variant.name}</span>
          </span>
        )}
        <BatchExpiryBadge
          productId={item.product.id}
          variantId={item.variant?.id || null}
          batchInfo={props.batchInfo}
        />

        {/* Price — editable when manual discount enabled */}
        {props.manualDiscountEnabled ? (
          props.editingPriceId === itemKey ? (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-slate-500">Rp</span>
              <input
                ref={props.priceInputRef}
                type="number"
                min="0"
                value={props.editingPriceValue}
                onChange={() => {} /* internal */}
                onBlur={() => props.onConfirmEditPrice()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') props.onConfirmEditPrice()
                  if (e.key === 'Escape') props.onCancelEditPrice()
                }}
                className={cn(
                  'flex-1 h-6 text-xs font-bold bg-white/[0.04] border border-amber-500/25 text-amber-400 rounded-md outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                  props.compact ? 'min-w-0' : 'min-w-0'
                )}
              />
              <span className={cn('text-slate-600', props.compact ? 'text-[11px]' : 'text-[10px]')}>
                &times; {item.qty}
              </span>
            </div>
          ) : (
            <button
              className="flex items-center gap-1.5 mt-1 group/price"
              onClick={() => props.onStartEditPrice(itemKey, props.getEffectivePrice(item))}
            >
              {item.customPrice != null && (
                <span className={cn('line-through text-slate-600', props.compact ? 'text-[10px]' : 'text-[9px]')}>
                  {props.formatCurrency(props.getItemPrice(item))}
                </span>
              )}
              <span className={cn(
                'font-medium tabular-nums',
                props.compact ? 'text-[12px]' : 'text-[11px]',
                item.customPrice != null ? 'text-amber-400' : 'text-slate-300'
              )}>
                @{props.formatCurrency(props.getEffectivePrice(item))}
              </span>
              <Pencil className="h-2.5 w-2.5 text-slate-600 opacity-0 group-hover/price:opacity-100 transition-opacity" strokeWidth={1.5} />
            </button>
          )
        ) : (
          <span className={cn(
            'text-slate-400 tabular-nums mt-0.5 block',
            props.compact ? 'text-[11px]' : 'text-[10px]'
          )}>
            @{props.formatCurrency(props.getItemPrice(item))} &times; {item.qty}
          </span>
        )}
      </div>

      {/* Qty Controls */}
      <div className={cn('flex items-center gap-1 shrink-0', props.compact ? 'ml-auto' : '')}>
        <button
          className={cn(
            'w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all',
            props.compact ? 'text-xs' : 'text-[11px]'
          )}
          onClick={() => props.onUpdateQty(item.product.id, item.qty - 1, item.variant?.id)}
        >
          <Minus className={cn('stroke-[1.5]', props.compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        </button>
        {props.editingQtyId === itemKey ? (
          <input
            ref={props.qtyInputRef}
            type="number"
            min="0"
            max={props.getItemStock(item)}
            value={props.editingQtyValue}
            onChange={() => {} /* internal */}
            onBlur={() => props.onConfirmEditQty()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onConfirmEditQty()
              if (e.key === 'Escape') props.onCancelEditQty()
            }}
            className={cn(
              'font-bold text-white text-center bg-white/[0.04] border border-white/[0.08] rounded-lg outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              props.compact ? 'w-8 h-6 text-xs' : 'w-8 h-7 text-[11px]'
            )}
          />
        ) : (
          <span
            className={cn(
              'cursor-pointer hover:theme-text transition-colors font-bold text-white tabular-nums',
              props.compact ? 'w-8 h-6 text-xs flex items-center justify-center' : 'w-8 h-7 text-[11px] flex items-center justify-center'
            )}
            onClick={() => props.onStartEditQty(itemKey, item.qty)}
          >{item.qty}</span>
        )}
        <button
          className={cn(
            'w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all',
            props.compact ? 'text-xs' : 'text-[11px]'
          )}
          onClick={() => props.onUpdateQty(item.product.id, item.qty + 1, item.variant?.id)}
        >
          <Plus className={cn('stroke-[1.5]', props.compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        </button>
      </div>

      {/* Item Total & Delete */}
      <div className={cn('text-right shrink-0', props.compact ? 'ml-2' : '')}>
        <p className={cn('font-bold tabular-nums', props.compact ? 'text-sm text-white' : 'text-xs text-slate-200')}>
          {props.formatCurrency(itemTotal)}
        </p>
        <button
          onClick={() => props.onRemoveFromCart(item.product.id, item.variant?.id)}
          className={cn(
            'mt-0.5 flex items-center justify-center text-slate-600 hover:text-red-400 transition-colors ml-auto',
            props.compact ? 'h-6 w-6' : 'h-5 w-5'
          )}
        >
          <X className={cn('stroke-[1.5]', props.compact ? 'h-3.5 w-3.5' : 'h-3 w-3')} />
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════

/**
 * CartItemList — Renders cart items in either mobile card-style or compact desktop layout.
 *
 * When `compact` is false (default), each cart item is rendered as a rich card with
 * large touch targets suitable for mobile POS operation.
 *
 * When `compact` is true, items are rendered in a compact row layout optimized for
 * desktop sidebar display.
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

  // Mobile card-style layout
  if (!compact) {
    return (
      <div className="space-y-3 pb-4">
        {cart.map((item) => {
          const itemKey = props.getCartKey(item.product.id, item.variant?.id || null)
          const itemTotal = props.getEffectivePrice(item) * item.qty
          return (
            <MobileCartItem
              key={itemKey}
              item={item}
              itemKey={itemKey}
              itemTotal={itemTotal}
              props={props}
            />
          )
        })}
      </div>
    )
  }

  // Compact / Desktop layout
  return (
    <div className={compact ? 'space-y-2 pb-2' : 'space-y-1.5'}>
      {cart.map((item) => {
        const itemKey = props.getCartKey(item.product.id, item.variant?.id || null)
        const itemTotal = props.getEffectivePrice(item) * item.qty
        return (
          <CompactCartItem
            key={itemKey}
            item={item}
            itemKey={itemKey}
            itemTotal={itemTotal}
            props={props}
          />
        )
      })}
    </div>
  )
}
