/**
 * usePosCart() — Cart state management, CRUD, totals via shared calc engine,
 * HPP validation, inline editing, and Dexie persistence (survives reload).
 *
 * PR 3 — uses the shared calculation engine (pos-calc.ts) for online/offline
 * parity. Cart is persisted to posDB.cart so it survives reload.
 *
 * @boundary COCKPIT only — no engine imports
 */

'use client'

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import type { Product, ProductVariant, CartItem } from './use-pos-products'
import {
  calcTotals, getItemPrice, getItemStock, getCartKey, getItemDisplayName,
  getEffectivePrice, getItemHpp, type CalcCartItem, type CalcSettings, type CalcPromo,
} from '@/lib/pos/pos-calc'
import { tryGetPosDB, saveCart, loadCart, clearCart, type CartRow } from '@/lib/pos/pos-db'
import { useCriticalActivity } from '@/hooks/use-critical-activity'

// ==================== INTERFACES ====================

export interface BelowHppItem {
  name: string
  customPrice: number
  hpp: number
  loss: number
}

interface UsePosCartOptions {
  loyaltyPointValue: number
  ppnEnabled: boolean
  ppnRate: number
  selectedCustomer: { points: number } | null
  selectedPromo: CalcPromo | null
  pointsToUse: number
}

interface UsePosCartReturn {
  cart: CartItem[]
  pointsToUse: number
  batchInfo: Record<string, { batchNumber: string | null; expiredDate: string | null; daysUntilExpiry: number | null }>
  editingQtyId: string | null
  editingQtyValue: string
  editingPriceId: string | null
  editingPriceValue: string
  /** Exposed so the POS edit inputs can update the draft value on each keystroke.
   *  Without these, onChange throws (undefined is not a function) and the draft
   *  never updates — confirmEditPrice/Qty then re-applies the ORIGINAL value, so
   *  manual price/qty edits silently no-op. (Fix for SETTINGS-AUDIT-MANUAL-DISCOUNT.) */
  setEditingQtyValue: (v: string) => void
  setEditingPriceValue: (v: string) => void
  qtyInputRef: React.RefObject<HTMLInputElement | null>
  priceInputRef: React.RefObject<HTMLInputElement | null>
  subtotal: number
  manualDiscountTotal: number
  maxPointsToUse: number
  pointsDiscount: number
  ppnAmount: number
  total: number
  belowHppItems: BelowHppItem[]
  hasBelowHpp: boolean
  belowHppTotalLoss: number
  addToCart: (product: Product, qty?: number, variant?: ProductVariant) => void
  updateQty: (productId: string, newQty: number, variantId?: string) => void
  updateItemPrice: (productId: string, newPrice: number | null, variantId?: string) => void
  removeFromCart: (productId: string, variantId?: string) => void
  clearCart: () => void
  restoreCart: (items: CartItem[]) => void
  setPointsToUse: (points: number) => void
  startEditQty: (productId: string, currentQty: number) => void
  confirmEditQty: () => void
  cancelEditQty: () => void
  startEditPrice: (itemKey: string, currentPrice: number) => void
  confirmEditPrice: () => void
  cancelEditPrice: () => void
  getItemPrice: (item: CartItem) => number
  getItemStock: (item: CartItem) => number
  getCartKey: (productId: string, variantId: string | null) => string
  getItemDisplayName: (item: CartItem) => string
  getEffectivePrice: (item: CartItem) => number
  getItemHpp: (item: CartItem) => number
  /** PR 3: the full calc result (for checkout snapshot) */
  getCalcResult: () => ReturnType<typeof calcTotals>
  /** PR 3: deleted-product warnings (product no longer in cache) */
  deletedCartWarnings: string[]
}

export function usePosCart(options: UsePosCartOptions): UsePosCartReturn {
  const { loyaltyPointValue, ppnEnabled, ppnRate,
    selectedCustomer, selectedPromo, pointsToUse } = options

  const [cart, setCart] = useState<CartItem[]>([])
  const [batchInfo, setBatchInfo] = useState<Record<string, { batchNumber: string | null; expiredDate: string | null; daysUntilExpiry: number | null }>>({})
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null)
  const [editingQtyValue, setEditingQtyValue] = useState('')
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [editingPriceValue, setEditingPriceValue] = useState('')
  const [deletedCartWarnings, setDeletedCartWarnings] = useState<string[]>([])

  const qtyInputRef = useRef<HTMLInputElement | null>(null)
  const priceInputRef = useRef<HTMLInputElement | null>(null)
  const didLoadCartRef = useRef(false)

  // ── Critical activity: warn mildly when cart has items ──
  //
  // The cart IS persisted to Dexie (saveCart) so a reload does NOT lose data.
  // However a reload mid-POS-session is still disruptive (the cashier loses
  // their flow, the customer's checkout is delayed). So we register this as
  // an 'interrupt' severity — warn the user, but don't hard-block a build
  // update from applying.
  useCriticalActivity(
    'pos-cart',
    'pos-cart',
    'Keranjang POS',
    cart.length > 0,
    'interrupt',
  )

  // ── PR 3: Load persisted cart on mount ──
  useEffect(() => {
    if (didLoadCartRef.current) return
    didLoadCartRef.current = true
    loadCart().then((rows) => {
      if (rows.length > 0) {
        const items: CartItem[] = rows.map(r => ({
          product: cachedRowToProduct(r),
          variant: r.variant ? cachedRowToVariant(r.variant) : null,
          qty: r.qty,
          customPrice: r.customPrice,
        }))
        setCart(items)
      }
    }).catch(() => {})
  }, [])

  // ── PR 3: Persist cart to Dexie on every change ──
  useEffect(() => {
    if (!didLoadCartRef.current) return // don't save before initial load
    const rows: CartRow[] = cart.map(item => ({
      id: getCartKey(item.product.id, item.variant?.id || null),
      productId: item.product.id,
      variantId: item.variant?.id || null,
      product: productToCached(item.product),
      variant: item.variant ? variantToCached(item.variant) : null,
      qty: item.qty,
      customPrice: item.customPrice,
      addedAt: Date.now(),
    }))
    saveCart(rows).catch(() => {})
  }, [cart])

  // ── PR 3: Detect deleted products in cart (warning, not silent removal) ──
  useEffect(() => {
    if (cart.length === 0) { setDeletedCartWarnings([]); return }
    const db = tryGetPosDB()
    if (!db) return
    Promise.all(cart.map(async (item) => {
      const cached = await db.posProducts.get(item.product.id)
      return cached ? null : item.product.name
    })).then(warnings => {
      setDeletedCartWarnings(warnings.filter((w): w is string => w !== null))
    })
  }, [cart])

  // ── HPP validation ──
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
  }, [cart])

  const hasBelowHpp = belowHppItems.length > 0
  const belowHppTotalLoss = belowHppItems.reduce((s, i) => s + i.loss, 0)

  const prevBelowHppRef = useRef<boolean>(false)
  useEffect(() => {
    if (hasBelowHpp && !prevBelowHppRef.current) {
      toast.warning(
        `Harga di bawah HPP untuk ${belowHppItems.length} item! Rugi: -${formatCurrency(belowHppTotalLoss)}`,
        { duration: 4000, id: 'below-hpp-warning' }
      )
    }
    prevBelowHppRef.current = hasBelowHpp
  }, [hasBelowHpp, belowHppItems.length, belowHppTotalLoss])

  // ── PR 3: Shared calculation engine ──
  const calcSettings: CalcSettings = useMemo(() => ({
    ppnEnabled, ppnRate, loyaltyPointValue,
  }), [ppnEnabled, ppnRate, loyaltyPointValue])

  const calcInput: CalcCartItem[] = useMemo(() => cart.map(item => ({
    product: { id: item.product.id, name: item.product.name, price: item.product.price, hpp: item.product.hpp, stock: item.product.stock, sku: item.product.sku, barcode: item.product.barcode },
    variant: item.variant ? { id: item.variant.id, name: item.variant.name, price: item.variant.price, hpp: item.variant.hpp, stock: item.variant.stock, sku: item.variant.sku, barcode: item.variant.barcode } : null,
    qty: item.qty,
    customPrice: item.customPrice,
  })), [cart])

  const calcResult = useMemo(() => calcTotals(calcInput, calcSettings, selectedCustomer, pointsToUse, selectedPromo), [calcInput, calcSettings, selectedCustomer, pointsToUse, selectedPromo])
  // NOTE: calcTotals signature changed (removed outletSettingVersion param); kept inline for clarity.

  const subtotal = calcResult.subtotal
  const manualDiscountTotal = calcResult.manualDiscountTotal
  const maxPointsToUse = calcResult.maxPointsToUse
  const pointsDiscount = calcResult.pointsDiscount
  const ppnAmount = calcResult.taxAmount
  const total = calcResult.grandTotal

  const getCalcResult = useCallback(() => calcResult, [calcResult])

  // ── Cart CRUD ──
  const removeFromCart = useCallback((productId: string, variantId?: string) => {
    const key = getCartKey(productId, variantId || null)
    setCart((prev) => prev.filter((i) => getCartKey(i.product.id, i.variant?.id || null) !== key))
  }, [])

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
  }, [])

  const updateQty = useCallback((productId: string, newQty: number, variantId?: string) => {
    if (newQty <= 0) { removeFromCart(productId, variantId); return }
    const key = getCartKey(productId, variantId || null)
    const item = cart.find((i) => getCartKey(i.product.id, i.variant?.id || null) === key)
    if (item && newQty > getItemStock(item)) { toast.warning('Stok tidak cukup'); return }
    setCart((prev) => prev.map((i) => (getCartKey(i.product.id, i.variant?.id || null) === key ? { ...i, qty: newQty } : i)))
  }, [cart, removeFromCart])

  const updateItemPrice = useCallback((productId: string, newPrice: number | null, variantId?: string) => {
    const key = getCartKey(productId, variantId || null)
    const item = cart.find((i) => getCartKey(i.product.id, i.variant?.id || null) === key)
    if (!item) return
    const originalPrice = getItemPrice(item)
    const finalPrice = newPrice === null || newPrice >= originalPrice ? null : newPrice
    setCart((prev) => prev.map((i) => (getCartKey(i.product.id, i.variant?.id || null) === key ? { ...i, customPrice: finalPrice } : i)))
  }, [cart])

  const clearCartState = useCallback(() => {
    setCart([])
  }, [])

  const restoreCart = useCallback((items: CartItem[]) => {
    setCart(items.map(item => ({ ...item, customPrice: item.customPrice ?? null })))
  }, [])

  // ── Inline edit handlers ──
  const startEditQty = useCallback((productId: string, currentQty: number) => {
    setEditingQtyId(productId); setEditingQtyValue(String(currentQty))
    setTimeout(() => qtyInputRef.current?.focus(), 50)
  }, [])
  const confirmEditQty = useCallback(() => {
    if (!editingQtyId) return
    const val = parseInt(editingQtyValue, 10)
    if (isNaN(val) || val <= 0) removeFromCart(editingQtyId)
    else updateQty(editingQtyId, val)
    setEditingQtyId(null); setEditingQtyValue('')
  }, [editingQtyId, editingQtyValue, removeFromCart, updateQty])
  const cancelEditQty = useCallback(() => { setEditingQtyId(null); setEditingQtyValue('') }, [])
  const startEditPrice = useCallback((itemKey: string, currentPrice: number) => {
    setEditingPriceId(itemKey); setEditingPriceValue(String(currentPrice))
  }, [])
  const confirmEditPrice = useCallback(() => {
    if (!editingPriceId) return
    const val = parseInt(editingPriceValue, 10)
    updateItemPrice(editingPriceId, isNaN(val) || val < 0 ? null : val)
    setEditingPriceId(null)
  }, [editingPriceId, editingPriceValue, updateItemPrice])
  const cancelEditPrice = useCallback(() => { setEditingPriceId(null) }, [])

  useEffect(() => {
    if (editingPriceId) { setTimeout(() => priceInputRef.current?.select(), 50) }
  }, [editingPriceId])

  // ── Clear Dexie cart when cart empties (e.g. after checkout) ──
  const clearCartAll = useCallback(() => {
    setCart([])
    clearCart().catch(() => {})
  }, [])

  return {
    cart, pointsToUse: pointsToUse, batchInfo,
    editingQtyId, editingQtyValue, editingPriceId, editingPriceValue,
    setEditingQtyValue, setEditingPriceValue,
    qtyInputRef, priceInputRef,
    subtotal, manualDiscountTotal, maxPointsToUse, pointsDiscount, ppnAmount,
    total,
    belowHppItems, hasBelowHpp, belowHppTotalLoss,
    addToCart, updateQty, updateItemPrice, removeFromCart,
    clearCart: clearCartAll, restoreCart, setPointsToUse: () => {},
    startEditQty, confirmEditQty, cancelEditQty,
    startEditPrice, confirmEditPrice, cancelEditPrice,
    getItemPrice, getItemStock, getCartKey, getItemDisplayName, getEffectivePrice, getItemHpp,
    getCalcResult, deletedCartWarnings,
  }
}

// ==================== Mappers (cart ↔ Dexie) ====================

function productToCached(p: Product) {
  return {
    id: p.id, name: p.name, price: p.price, stock: p.stock, hpp: p.hpp,
    sku: p.sku, barcode: p.barcode, categoryId: p.categoryId, categoryName: p.categoryName,
    image: p.image, unit: p.unit, hasVariants: p.hasVariants, _variantCount: p._variantCount,
    variants: [] as never[], cachedAt: Date.now(),
  }
}

function cachedRowToProduct(r: CartRow): Product {
  return {
    id: r.product.id, name: r.product.name, price: r.product.price, stock: r.product.stock,
    hpp: r.product.hpp, sku: r.product.sku, barcode: r.product.barcode,
    categoryId: r.product.categoryId, categoryName: r.product.categoryName,
    image: r.product.image, unit: r.product.unit, hasVariants: r.product.hasVariants,
    _variantCount: r.product._variantCount, variants: [],
  }
}

function variantToCached(v: ProductVariant) {
  return {
    id: v.id, name: v.name, sku: v.sku, barcode: v.barcode,
    price: v.price, hpp: v.hpp, stock: v.stock, cachedAt: Date.now(),
  }
}

function cachedRowToVariant(c: NonNullable<CartRow['variant']>): ProductVariant {
  return {
    id: c.id, name: c.name, sku: c.sku, barcode: c.barcode,
    price: c.price, hpp: c.hpp, stock: c.stock,
  }
}
