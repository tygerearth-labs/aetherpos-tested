/**
 * usePosCart() — Cart state management, CRUD operations, totals calculation,
 * HPP validation, and inline editing for POS.
 *
 * Extracted from pos-page.tsx Phase 1A modularization.
 * Original lines: 104-109 (CartItem interface), 418-423 (cart states),
 *                 1005-1063 (helpers + derived totals), 1065-1128 (CRUD operations),
 *                 584-630 (inline edit handlers)
 *
 * @phase 1A — Move code without changing meaning
 * @boundary COCKPIT only — no engine imports
 */

'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import type { Product, ProductVariant } from './use-pos-products'

// ==================== INTERFACES ====================

export interface CartItem {
  product: Product
  variant: ProductVariant | null
  qty: number
  customPrice: number | null // Override unit price (null = use original)
}

export interface BelowHppItem {
  name: string
  customPrice: number
  hpp: number
  loss: number
}

// ==================== HOOK OPTIONS ====================

interface UsePosCartOptions {
  /** Settings for loyalty point value (from usePosSettings) */
  loyaltyPointValue: number
  ppnEnabled: boolean
  ppnRate: number
  /** Selected customer for points calculation (from usePosCustomers) */
  selectedCustomer: { points: number } | null
  /** Payment method for change calculation */
  paymentMethod: string
  paidAmount: string
  /** Active promo discount */
  promoDiscount: number
}

// ==================== HOOK RETURN ====================

interface UsePosCartReturn {
  // State
  cart: CartItem[]
  pointsToUse: number
  batchInfo: Record<string, { batchNumber: string | null; expiredDate: string | null; daysUntilExpiry: number | null }>

  // Inline edit state
  editingQtyId: string | null
  editingQtyValue: string
  editingPriceId: string | null
  editingPriceValue: string

  // Refs for inline edit inputs
  qtyInputRef: React.RefObject<HTMLInputElement | null>
  priceInputRef: React.RefObject<HTMLInputElement | null>

  // Derived: Totals
  subtotal: number
  manualDiscountTotal: number
  maxPointsToUse: number
  pointsDiscount: number
  ppnAmount: number
  total: number
  change: number

  // Derived: HPP validation
  belowHppItems: BelowHppItem[]
  hasBelowHpp: boolean
  belowHppTotalLoss: number

  // Actions
  addToCart: (product: Product, qty?: number, variant?: ProductVariant) => void
  updateQty: (productId: string, newQty: number, variantId?: string) => void
  updateItemPrice: (productId: string, newPrice: number | null, variantId?: string) => void
  removeFromCart: (productId: string, variantId?: string) => void
  clearCart: () => void
  restoreCart: (items: CartItem[]) => void  // For resume-pending flow (C3)
  setPointsToUse: (points: number) => void

  // Inline edit actions
  startEditQty: (productId: string, currentQty: number) => void
  confirmEditQty: () => void
  cancelEditQty: () => void
  startEditPrice: (itemKey: string, currentPrice: number) => void
  confirmEditPrice: () => void
  cancelEditPrice: () => void

  // Helpers (exposed for components that need them)
  getItemPrice: (item: CartItem) => number
  getItemStock: (item: CartItem) => number
  getCartKey: (productId: string, variantId: string | null) => string
  getItemDisplayName: (item: CartItem) => string
  getEffectivePrice: (item: CartItem) => number
  getItemHpp: (item: CartItem) => number
}

// ==================== HOOK IMPLEMENTATION ====================

export function usePosCart(options: UsePosCartOptions): UsePosCartReturn {
  const { loyaltyPointValue, ppnEnabled, ppnRate, selectedCustomer, paymentMethod, paidAmount, promoDiscount } = options

  // ── Core State (originally lines 418-423) ──
  const [cart, setCart] = useState<CartItem[]>([])
  const [pointsToUse, setPointsToUse] = useState(0)
  const [batchInfo, setBatchInfo] = useState<Record<string, { batchNumber: string | null; expiredDate: string | null; daysUntilExpiry: number | null }>>({})

  // ── Inline Edit State (originally scattered, consolidated here) ──
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null)
  const [editingQtyValue, setEditingQtyValue] = useState('')
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [editingPriceValue, setEditingPriceValue] = useState('')

  // ── Refs for auto-focus (originally declared in main component) ──
  const qtyInputRef = useRef<HTMLInputElement | null>(null)
  const priceInputRef = useRef<HTMLInputElement | null>(null)

  // ==================== CART HELPERS (originally lines 1007-1019) ====================

  const getItemPrice = useCallback((item: CartItem): number => {
    return item.variant ? item.variant.price : item.product.price
  }, [])

  const getItemStock = useCallback((item: CartItem): number => {
    return item.variant ? item.variant.stock : item.product.stock
  }, [])

  const getCartKey = useCallback((productId: string, variantId: string | null): string => {
    return variantId ? `${productId}_${variantId}` : productId
  }, [])

  const getItemDisplayName = useCallback((item: CartItem): string => {
    return item.variant ? `${item.product.name} - ${item.variant.name}` : item.product.name
  }, [])

  const getEffectivePrice = useCallback((item: CartItem): number => {
    return item.customPrice != null ? item.customPrice : getItemPrice(item)
  }, [getItemPrice])

  const getItemHpp = useCallback((item: CartItem): number => {
    return item.variant ? item.variant.hpp : item.product.hpp
  }, [])

  // ==================== HPP VALIDATION (originally lines 1021-1050) ====================

  const belowHppItems = useMemo((): BelowHppItem[] => {
    const result: BelowHppItem[] = []
    for (const item of cart) {
      if (item.customPrice != null && item.customPrice < getItemHpp(item)) {
        result.push({
          name: getItemDisplayName(item),
          customPrice: item.customPrice,
          hpp: getItemHpp(item),
          loss: Math.round((getItemHpp(item) - item.customPrice) * item.qty),
        })
      }
    }
    return result
  }, [cart, getItemHpp, getItemDisplayName])

  const hasBelowHpp = belowHppItems.length > 0
  const belowHppTotalLoss = belowHppItems.reduce((s, i) => s + i.loss, 0)

  // Show warning toast when price drops below HPP (originally lines 1040-1050)
  const prevBelowHppRef = useRef<boolean>(false)
  useEffect(() => {
    if (hasBelowHpp && !prevBelowHppRef.current) {
      toast.warning(
        `⚠️ Harga di bawah HPP untuk ${belowHppItems.length} item! Rugi: -${formatCurrency(belowHppTotalLoss)}`,
        { duration: 4000, id: 'below-hpp-warning' }
      )
    }
    prevBelowHppRef.current = hasBelowHpp
  }, [hasBelowHpp, belowHppItems.length, belowHppTotalLoss])

  // ==================== DERIVED TOTALS (originally lines 1052-1063) ====================

  const manualDiscountTotal = useMemo(() => cart.reduce((sum, item) => {
    const origPrice = getItemPrice(item)
    const effPrice = getEffectivePrice(item)
    return sum + Math.round((origPrice - effPrice) * item.qty)
  }, 0), [cart, getItemPrice, getEffectivePrice])

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + getItemPrice(item) * item.qty, 0), [cart, getItemPrice])
  const maxPointsToUse = selectedCustomer ? selectedCustomer.points : 0
  const pointsDiscount = pointsToUse * loyaltyPointValue
  const ppnAmount = ppnEnabled ? Math.round(subtotal * ppnRate / 100) : 0
  const total = Math.max(0, subtotal - manualDiscountTotal - pointsDiscount - promoDiscount + ppnAmount)
  const change = paymentMethod === 'CASH' ? Math.max(0, Number(paidAmount) - total) : 0

  // ==================== CART CRUD OPERATIONS (originally lines 1065-1128) ====================
  // NOTE: Function order matters — removeFromCart must be declared before updateQty/confirmEditQty

  const removeFromCart = useCallback((productId: string, variantId?: string) => {
    const key = getCartKey(productId, variantId || null)
    setCart((prev) => prev.filter((i) => getCartKey(i.product.id, i.variant?.id || null) !== key))
  }, [getCartKey])

  const addToCart = useCallback((product: Product, qty: number = 1, variant?: ProductVariant) => {
    if (variant) {
      if (variant.stock <= 0) return
      if (qty <= 0) return
      const key = getCartKey(product.id, variant.id)
      setCart((prev) => {
        const existing = prev.find((item) => getCartKey(item.product.id, item.variant?.id || null) === key)
        if (existing) {
          const newQty = existing.qty + qty
          if (newQty > variant.stock) { toast.warning('Stok tidak cukup'); return prev }
          return prev.map((item) => getCartKey(item.product.id, item.variant?.id || null) === key ? { ...item, qty: newQty } : item)
        }
        if (qty > variant.stock) { toast.warning('Stok tidak cukup'); return prev }
        return [...prev, { product, variant, qty, customPrice: null }]
      })
    } else {
      if (product.stock <= 0) return
      if (qty <= 0) return
      setCart((prev) => {
        const existing = prev.find((item) => !item.variant && item.product.id === product.id)
        if (existing) {
          const newQty = existing.qty + qty
          if (newQty > product.stock) { toast.warning('Stok tidak cukup'); return prev }
          return prev.map((item) => item.product.id === product.id && !item.variant ? { ...item, qty: newQty } : item)
        }
        if (qty > product.stock) { toast.warning('Stok tidak cukup'); return prev }
        return [...prev, { product, variant: null, qty, customPrice: null }]
      })
    }
  }, [getCartKey])

  const updateQty = useCallback((productId: string, newQty: number, variantId?: string) => {
    if (newQty <= 0) { removeFromCart(productId, variantId); return }
    const key = getCartKey(productId, variantId || null)
    const item = cart.find((i) => getCartKey(i.product.id, i.variant?.id || null) === key)
    if (item && newQty > getItemStock(item)) { toast.warning('Stok tidak cukup'); return }
    setCart((prev) => prev.map((i) => (getCartKey(i.product.id, i.variant?.id || null) === key ? { ...i, qty: newQty } : i)))
  }, [cart, getCartKey, getItemStock, removeFromCart])

  const updateItemPrice = useCallback((productId: string, newPrice: number | null, variantId?: string) => {
    const key = getCartKey(productId, variantId || null)
    const item = cart.find((i) => getCartKey(i.product.id, i.variant?.id || null) === key)
    if (!item) return
    const originalPrice = getItemPrice(item)
    // If same as original, clear custom price
    const finalPrice = newPrice === null || newPrice >= originalPrice ? null : newPrice
    setCart((prev) => prev.map((i) => (getCartKey(i.product.id, i.variant?.id || null) === key ? { ...i, customPrice: finalPrice } : i)))
  }, [cart, getCartKey, getItemPrice])

  const clearCart = useCallback(() => {
    setCart([])
    setPointsToUse(0)
    // Note: checkoutResult, paymentDialogOpen, receiptDialogOpen are handled by parent
    // because they involve dialog state coordination beyond cart's concern
  }, [])

  // ── Restore cart from pending transaction (C3: Resume Pending flow) ──
  // This is the SINGLE entry point for restoring cart items from pending transactions
  const restoreCart = useCallback((items: CartItem[]) => {
    setCart(items.map(item => ({ ...item, customPrice: item.customPrice ?? null })))
  }, [])

  // ==================== INLINE EDIT HANDLERS (originally lines 584-630) ====================

  const startEditQty = useCallback((productId: string, currentQty: number) => {
    setEditingQtyId(productId)
    setEditingQtyValue(String(currentQty))
    setTimeout(() => qtyInputRef.current?.focus(), 50)
  }, [])

  const confirmEditQty = useCallback(() => {
    if (!editingQtyId) return
    const val = parseInt(editingQtyValue, 10)
    if (isNaN(val) || val <= 0) {
      removeFromCart(editingQtyId)
    } else {
      updateQty(editingQtyId, val)
    }
    setEditingQtyId(null)
    setEditingQtyValue('')
  }, [editingQtyId, editingQtyValue, removeFromCart, updateQty])

  const cancelEditQty = useCallback(() => {
    setEditingQtyId(null)
    setEditingQtyValue('')
  }, [])

  const startEditPrice = useCallback((itemKey: string, currentPrice: number) => {
    setEditingPriceId(itemKey)
    setEditingPriceValue(String(currentPrice))
  }, [])

  const confirmEditPrice = useCallback(() => {
    if (!editingPriceId) return
    const val = parseInt(editingPriceValue, 10)
    updateItemPrice(editingPriceId, isNaN(val) || val < 0 ? null : val)
    setEditingPriceId(null)
  }, [editingPriceId, editingPriceValue, updateItemPrice])

  const cancelEditPrice = useCallback(() => {
    setEditingPriceId(null)
  }, [])

  // Auto-focus price input when editing starts (originally lines 626-630)
  useEffect(() => {
    if (editingPriceId) {
      setTimeout(() => priceInputRef.current?.select(), 50)
    }
  }, [editingPriceId])

  return {
    // State
    cart,
    pointsToUse,
    batchInfo,

    // Inline edit state
    editingQtyId,
    editingQtyValue,
    editingPriceId,
    editingPriceValue,

    // Refs
    qtyInputRef,
    priceInputRef,

    // Derived: Totals
    subtotal,
    manualDiscountTotal,
    maxPointsToUse,
    pointsDiscount,
    ppnAmount,
    total,
    change,

    // Derived: HPP validation
    belowHppItems,
    hasBelowHpp,
    belowHppTotalLoss,

    // Actions
    addToCart,
    updateQty,
    updateItemPrice,
    removeFromCart,
    clearCart,
    restoreCart,  // C3: Resume pending flow
    setPointsToUse,

    // Inline edit actions
    startEditQty,
    confirmEditQty,
    cancelEditQty,
    startEditPrice,
    confirmEditPrice,
    cancelEditPrice,

    // Helpers
    getItemPrice,
    getItemStock,
    getCartKey,
    getItemDisplayName,
    getEffectivePrice,
    getItemHpp,
  }
}
