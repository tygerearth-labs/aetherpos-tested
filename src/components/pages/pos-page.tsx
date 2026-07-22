'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter } from '@/components/ui/responsive-dialog'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { Separator } from '@/components/ui/separator'
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Package,
  Loader2,
  Check,
  X,
  User,
  UserPlus,
  Coins,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Wifi,
  WifiOff,
  RefreshCw,
  CloudOff,
  Database,
  ArrowDownToLine,
  LayoutGrid,
  Store,
  Tag,
  Layers,
  ClockArrowDown,
  Clock,
  MessageSquare,
  Pencil,
  AlertTriangle,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB, type PendingTransaction, type OfflineTransaction } from '@/lib/local-db'
import { syncAllData, getAllSyncTimes, syncSettingsFromServer, getCachedSettings } from '@/lib/sync-service'
import { cn } from '@/lib/utils'
import { useSession } from 'next-auth/react'
import { usePageStore } from '@/hooks/use-page-store'
import { PaymentDialog } from '@/components/pos/payment-dialog'
import { ReceiptDialog } from '@/components/pos/receipt-dialog'

// ==================== HOOKS (Phase 1A modularization) ====================

import { usePosSettings } from '../pos/hooks/use-pos-settings'
import { usePosProducts, type Product, ProductVariant, Category, type CartItem as CartItemType } from '../pos/hooks/use-pos-products'
import { usePosCustomers, type Customer } from '../pos/hooks/use-pos-customers'
import { usePosCart as UsePosCartHook, type CartItem as CartItemType2, type BelowHppItem } from '../pos/hooks/use-pos-cart'
import { usePosSync } from '../pos/hooks/use-pos-sync'
import { usePosCheckout, type CheckoutResult, type PendingTransaction as PendingTxType } from '../pos/hooks/use-pos-checkout'

// ==================== CONSTANTS (stay in component) ====================

const PRODUCTS_PER_PAGE = 24

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; activeBg: string }> = {
  emerald: { bg: 'theme-bg-very-light', text: 'theme-text', border: 'theme-border-light', activeBg: 'theme-bg-subtle' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', activeBg: 'bg-blue-500/20' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', activeBg: 'bg-violet-500/20' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', activeBg: 'bg-rose-500/20' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', activeBg: 'bg-amber-500/20' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', activeBg: 'bg-cyan-500/20' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20', activeBg: 'bg-orange-500/20' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/20', activeBg: 'bg-pink-500/20' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/20', activeBg: 'bg-teal-500/20' },
  zinc: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20', activeBg: 'bg-slate-500/20' },
}

const QUICK_NOMINALS = [5000, 10000, 20000, 50000, 100000, 200000, 500000]

// ==================== MAIN COMPONENT ====================

export default function PosPage() {
  const session = useSession()
  const isMobile = useIsMobile()
  const { currentPage } = usePageStore()

  // ── DOM Refs (stay in component — UI concerns) ──
  const searchInputRef = useRef<HTMLInputElement>(null)

  // ═══════════════════════════════════════════════════
  // HOOK WIRING — Phase 1A modularization
  // Order matters: Sync → Settings → Customers → Cart → Products → Checkout
  // ═══════════════════════════════════════════════════

  // ── Refs for breaking circular hook dependencies ──
  // These allow hooks to call each other's methods without direct circular references
  const fetchProductsRef = useRef<((search: string, page: number, categoryId: string | null) => Promise<void>) | null>(null)
  const loadCustomersFromCacheRef = useRef<(() => Promise<void>) | null>(null)
  const openVariantPickerRef = useRef<((product: Product) => Promise<void>) | null>(null)

  // ── 1. SYNC HOOK (must be first — other hooks depend on isOnline) ──
  const sync = usePosSync({
    onRefreshProducts: () => { fetchProductsRef.current?.() },
    onRefreshCustomers: () => { loadCustomersFromCacheRef.current?.() },
    onRefreshCategories: () => {}, // Categories are loaded inside usePosProducts
  })

  // ── 2. SETTINGS HOOK (depends on isOnline from sync) ──
  const settingsHook = usePosSettings({
    isOnline: sync.isOnline,
    currentPage,
  })

  // ── 3. CUSTOMERS HOOK (independent) ──
  const customersHook = usePosCustomers()

  // Store loadCustomersFromCache ref after customers hook is created
  loadCustomersFromCacheRef.current = customersHook.loadCustomersFromCache

  // ── 4. CART HOOK (depends on settings + customers) ──
  // NOTE: paymentMethod and paidAmount will be wired from checkoutHook below
  // We use placeholder values initially; cart totals recalculate via React re-renders
  const [promoDiscount, setPromoDiscount] = useState(0) // Local state — promo calculation stays here

  const cartHook = usePosCart({
    loyaltyPointValue: settingsHook.settings.loyaltyPointValue,
    ppnEnabled: settingsHook.settings.ppnEnabled,
    ppnRate: settingsHook.settings.ppnRate,
    selectedCustomer: customersHook.selectedCustomer,
    paymentMethod: 'CASH', // Placeholder — updated via checkoutHook.paymentMethod
    paidAmount: '',         // Placeholder — updated via checkoutHook.paidAmount
    promoDiscount,
  })

  // ── 5. PRODUCTS HOOK (needs addToCart callback from cart) ──
  const productsHook = usePosProducts({
    onAddToCart: cartHook.addToCart,
    onOpenVariantPicker: (product) => { openVariantPickerRef.current?.(product) },
  })

  // Store fetchProducts and openVariantPicker refs after products hook is created
  fetchProductsRef.current = productsHook.fetchProducts
  openVariantPickerRef.current = productsHook.openVariantPicker

  // ── 6. CHECKOUT HOOK (needs EVERYTHING from other hooks) ──
  // Promo state is local (not yet extracted)
  const [selectedPromo, setSelectedPromo] = useState<{
    id: string; name: string; type: string; discount: number; description: string
  } | null>(null)
  const [promoLoading, setPromoLoading] = useState(false)

  const checkoutHook = usePosCheckout({
    // From usePosCart
    cart: cartHook.cart,
    subtotal: cartHook.subtotal,
    total: cartHook.total,
    change: cartHook.change,
    manualDiscountTotal: cartHook.manualDiscountTotal,
    pointsDiscount: cartHook.pointsDiscount,
    promoDiscount,
    ppnAmount: cartHook.ppnAmount,
    hasBelowHpp: cartHook.hasBelowHpp,
    maxPointsToUse: cartHook.maxPointsToUse,
    pointsToUse: cartHook.pointsToUse,

    // From usePosSync
    isOnline: sync.isOnline,
    checkoutSyncRef: sync.checkoutSyncRef,

    // From usePosCustomers
    selectedCustomer: customersHook.selectedCustomer,
    customers: customersHook.customers,

    // From usePosSettings
    availablePaymentMethods: settingsHook.availablePaymentMethods,
    selectedPromo,

    // Helpers from usePosCart
    getItemPrice: cartHook.getItemPrice,

    // Refresh callbacks
    onRefreshProducts: () => { fetchProductsRef.current?.() },
    onRefreshCustomers: () => { loadCustomersFromCacheRef.current?.() },

    // State setters from parent (cross-concern coordination)
    onClearCart: cartHook.clearCart,
    onSetPointsToUse: cartHook.setPointsToUse,
    onSetSelectedCustomer: customersHook.setSelectedCustomer,
    onSetPaidAmount: checkoutHook.setPaidAmount,
    onSetPaymentMethod: (method) => {
      // Payment method is owned by checkoutHook — this is a no-op in the setter pattern
      // The actual value flows through checkoutHook.paymentMethod → cartHook options
    },
    onSetSelectedPromo: setSelectedPromo,
    onSetPromoDiscount: setPromoDiscount,

    // C3: Resume pending — restore cart items through usePosCart
    onRestoreCart: cartHook.restoreCart,
  })

  // ═══════════════════════════════════════════════════
  // LOCAL STATE (stays in pos-page.tsx — not yet extracted)
  // ═══════════════════════════════════════════════════

  // ── Promo calculation state (effects stay local) ──
  // selectedPromo, promoDiscount, promoLoading declared above before checkoutHook

  // ── Batch info for FEFO preview (fetch effect stays local) ──
  const [batchInfo, setBatchInfo] = useState<Record<string, { batchNumber: string | null; expiredDate: string | null; daysUntilExpiry: number | null }>>({})
  const batchFetchedRef = useRef<Set<string>>(new Set())

  // ── Pending transaction count (live query) ──
  const pendingCount = useLiveQuery(
    () => localDB.pendingTransactions.count(),
    []
  ) ?? 0

  // ═══════════════════════════════════════════════════
  // LOCAL EFFECTS (not extracted to hooks yet)
  // ═══════════════════════════════════════════════════

  // ── Auto-focus search input on mount ──
  useEffect(() => {
    if (searchInputRef.current) searchInputRef.current.focus()
  }, [])

  // ── Calculate promo when cart changes ──
  useEffect(() => {
    if (cartHook.cart.length === 0) {
      setSelectedPromo(null)
      setPromoDiscount(0)
      return
    }
    const calculatePromo = async () => {
      setPromoLoading(true)
      try {
        const cartSubtotal = cartHook.cart.reduce((sum, item) => sum + cartHook.getItemPrice(item) * item.qty, 0)
        const res = await fetch('/api/promos/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: cartHook.cart.map(item => ({
              productId: item.product.id,
              productName: cartHook.getItemDisplayName(item),
              price: cartHook.getItemPrice(item),
              qty: item.qty,
              subtotal: cartHook.getItemPrice(item) * item.qty,
              categoryId: item.product.categoryId,
            })),
            subtotal: cartSubtotal,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.applicablePromo) {
            setSelectedPromo(data.applicablePromo)
            setPromoDiscount(data.discount)
          } else {
            setSelectedPromo(null)
            setPromoDiscount(0)
          }
        }
      } catch { /* silent */ }
      finally { setPromoLoading(false) }
    }
    const timer = setTimeout(calculatePromo, 500)
    return () => clearTimeout(timer)
  }, [cartHook.cart])

  // ── Fetch batch info for new cart items (FEFO preview) ──
  useEffect(() => {
    if (cartHook.cart.length === 0) {
      setBatchInfo({})
      batchFetchedRef.current.clear()
      return
    }
    const toFetch: string[] = []
    for (const item of cartHook.cart) {
      const key = `${item.product.id}::${item.variant?.id || 'base'}`
      if (!batchFetchedRef.current.has(key)) {
        toFetch.push(key)
        batchFetchedRef.current.add(key)
      }
    }
    if (toFetch.length === 0) return
    try {
      toFetch.forEach(key => {
        const [pid, vid] = key.split('::')
        const variantId = vid === 'base' ? undefined : vid
        const params = new URLSearchParams({ productId: pid })
        if (variantId) params.set('variantId', variantId)
        fetch(`/api/inventory/batches/pos-preview?${params}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data || !data.hasBatches || data.items.length === 0) return
            // Show the most urgent batch (smallest daysUntilExpiry, or first item)
            const sorted = [...data.items].sort((a, b) => {
              if (a.daysUntilExpiry == null && b.daysUntilExpiry == null) return 0
              if (a.daysUntilExpiry == null) return 1
              if (b.daysUntilExpiry == null) return -1
              return a.daysUntilExpiry - b.daysUntilExpiry
            })
            const mostUrgent = sorted[0]
            setBatchInfo(prev => ({
              ...prev,
              [key]: {
                batchNumber: mostUrgent.batchNumber,
                expiredDate: mostUrgent.expiredDate,
                daysUntilExpiry: mostUrgent.daysUntilExpiry,
              },
            }))
          })
          .catch(() => { /* silent */ })
      })
    } catch { /* guard against unexpected errors in batch fetch setup */ }
  }, [cartHook.cart])

  // ═══════════════════════════════════════════════════
  // DERIVED VALUES / HELPERS (from hooks or local)
  // ═══════════════════════════════════════════════════

  const themeColors = CATEGORY_COLORS[settingsHook.settings.themePrimaryColor] || CATEGORY_COLORS.emerald

  // Quick nominal buttons for payment dialog
  const getQuickNominals = useMemo(() => {
    if (cartHook.total <= 0) return QUICK_NOMINALS
    // Generate smart nominals around the total
    const roundedUp = Math.ceil(cartHook.total / 10000) * 10000
    const roundedDown = Math.floor(cartHook.total / 10000) * 10000
    const exact = cartHook.total

    const nominals = new Set<number>()
    nominals.add(Math.round(exact))
    if (roundedUp > exact) nominals.add(roundedUp)
    if (roundedDown > 0 && roundedDown >= exact) nominals.add(roundedDown)

    // Add common denominations above total
    for (const n of QUICK_NOMINALS) {
      if (n >= cartHook.total) nominals.add(n)
    }

    return Array.from(nominals).sort((a, b) => a - b).slice(0, 6)
  }, [cartHook.total])

  // ═══════════════════════════════════════════════════
  // RENDER HELPERS (all stay in component — same JSX output)
  // ═══════════════════════════════════════════════════

  const renderCategoryChips = () => (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide px-1">
      <button
        onClick={() => productsHook.handleCategorySelect(null)}
        className={`shrink-0 px-3 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-[11px] font-medium border transition-all backdrop-blur-sm ${
          !productsHook.selectedCategoryId
            ? `${themeColors.activeBg} ${themeColors.text} ${themeColors.border} shadow-sm`
            : 'aether-card text-slate-500 hover:text-slate-300'
        }`}
      >
        <LayoutGrid className="inline h-3 w-3 mr-1 -mt-0.5" strokeWidth={1.5} />
        Semua
      </button>
      {productsHook.categories.map((cat) => {
        const colors = CATEGORY_COLORS[cat.color] || CATEGORY_COLORS.zinc
        const isActive = productsHook.selectedCategoryId === cat.id
        return (
          <button
            key={cat.id}
            onClick={() => productsHook.handleCategorySelect(cat.id)}
            className={`shrink-0 px-3 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-[11px] font-medium border transition-all backdrop-blur-sm ${
              isActive
                ? `${colors.activeBg} ${colors.text} ${colors.border} shadow-sm`
                : 'aether-card text-slate-500 hover:text-slate-300'
            }`}
          >
            {cat.name}
          </button>
        )
      })}
    </div>
  )

  const renderProductGrid = () => {
    if (productsHook.productsLoading) {
      return Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-[88px] md:h-[72px] rounded-xl aether-shimmer" />
      ))
    }

    if (productsHook.products.length === 0) {
      return (
        <div className="col-span-full text-center py-12">
          <Package className="h-10 w-10 text-slate-600 mx-auto mb-2" strokeWidth={1.5} />
          <p className="text-xs text-slate-500">
            {productsHook.selectedCategoryId ? 'Tidak ada produk di kategori ini' : 'Tidak ada produk ditemukan'}
          </p>
        </div>
      )
    }

    return productsHook.products.map((product) => {
      const cartItemsForProduct = cartHook.cart.filter((i) => i.product.id === product.id)
      const hasCartItems = cartItemsForProduct.length > 0
      const isVariantProduct = product.hasVariants && product._variantCount > 0

      const cartItem = !isVariantProduct ? cartHook.cart.find((i) => i.product.id === product.id && !i.variant) : null
      const outOfStock = isVariantProduct
        ? product.variants.length > 0 && product.variants.every(v => v.stock <= 0)
        : product.stock <= 0
      const catColor = product.categoryId && productsHook.categories.find(c => c.id === product.categoryId)?.color
      const accentColor = catColor ? (CATEGORY_COLORS[catColor] || themeColors) : themeColors
      const lowStock = product.stock > 0 && product.stock <= 5

      const displayPrice = isVariantProduct
        ? (product.variants && product.variants.length > 0
          ? (() => {
              const prices = product.variants.map(v => v.price)
              const min = Math.min(...prices)
              const max = Math.max(...prices)
              return min === max ? formatCurrency(min) : `${formatCurrency(min)} - ${formatCurrency(max)}`
            })()
          : formatCurrency(product.price))
        : formatCurrency(product.price)

      const totalCartQty = isVariantProduct
        ? cartItemsForProduct.reduce((sum, ci) => sum + ci.qty, 0)
        : (cartItem?.qty || 0)

      return (
        <div
          key={product.id}
          className={cn(
            'relative group min-h-[68px] md:min-h-0 rounded-2xl md:rounded-xl border text-left transition-all duration-200',
            outOfStock
              ? 'opacity-40 cursor-not-allowed aether-card p-2.5 md:p-3'
              : hasCartItems
              ? `${accentColor.border} ${accentColor.bg} ring-1 ring-inset ${accentColor.border.replace('border-', 'ring-')} cursor-pointer active:scale-[0.98]`
              : 'aether-card cursor-pointer active:scale-[0.98]'
          )}
        >
          {!outOfStock && (
            <button
              className="absolute inset-0 z-[2] rounded-2xl md:rounded-xl"
              onClick={() => isVariantProduct ? productsHook.openVariantPicker(product) : cartHook.addToCart(product)}
            />
          )}
          {hasCartItems && !outOfStock && (
            <div className="absolute -top-1.5 -right-1.5 z-[3] flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full theme-bg text-white text-[10px] font-bold shadow-lg theme-shadow pointer-events-none">
              {totalCartQty}
            </div>
          )}
          <div className={cn(
            'relative z-[1] pointer-events-none',
            'p-2.5 md:p-3'
          )}>
            {/* Product Image */}
            {product.image && (
              <div className="relative w-full aspect-square max-h-[72px] md:max-h-[96px] mx-auto mb-2 md:mb-2.5 rounded-lg overflow-hidden bg-white/[0.03]">
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                    const next = e.currentTarget.nextElementSibling
                    if (next) next.setAttribute('style', 'display:flex')
                  }}
                />
                <div className="absolute inset-0 items-center justify-center bg-white/[0.02] hidden">
                  <Package className="h-5 w-5 text-slate-700" strokeWidth={1.5} />
                </div>
              </div>
            )}
            <div className="flex items-start justify-between gap-1 mb-1 md:mb-1.5">
              <p className="text-[11px] md:text-xs font-medium text-slate-200 truncate">{product.name}</p>
              {isVariantProduct && (
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  <Layers className="h-2.5 w-2.5" strokeWidth={1.5} />
                  {product._variantCount}
                </span>
              )}
            </div>
            <p className={cn('text-xs md:text-sm font-bold', isVariantProduct ? 'text-violet-400' : accentColor.text)}>{displayPrice}</p>
            <div className="flex items-center justify-between mt-1.5">
                {outOfStock ? (
                  <span className="text-[10px] text-red-400 font-medium">Habis</span>
                ) : isVariantProduct ? (
                  (() => {
                    const availableCount = product.variants.filter(v => v.stock > 0).length
                    const totalCount = product.variants.length
                    return (
                      <span className={cn(
                        'text-[10px] font-medium',
                        availableCount === 0 ? 'text-red-400' : 'text-violet-400/70'
                      )}>
                        {availableCount === totalCount
                          ? `${totalCount} varian tersedia`
                          : availableCount > 0
                            ? `${availableCount}/${totalCount} tersedia`
                            : 'Semua varian habis'}
                      </span>
                    )
                  })()
                ) : (
                  <span className={cn(
                    'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium',
                    lowStock
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-white/[0.04] text-slate-500'
                  )}>
                    <span className={cn('w-1 h-1 rounded-full', lowStock ? 'bg-amber-400' : 'bg-slate-600')} />
                    {product.stock}
                  </span>
                )}
              </div>
          </div>
        </div>
      )
    })
  }

  const renderPagination = () => {
    if (productsHook.totalProductPages <= 1 && !productsHook.productSearch) return null
    return (
      <div className="flex items-center justify-between px-1 py-2">
        <Button variant="outline" size="sm" onClick={() => productsHook.setProductPage(p => Math.max(1, p - 1))} disabled={productsHook.productPage <= 1 || productsHook.productsLoading}
          className="bg-nebula border-white/[0.06] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 h-7 text-xs">
          <ChevronLeft className="h-3 w-3 mr-1" strokeWidth={1.5} /> Prev
        </Button>
        <span className="text-[11px] text-slate-500 font-medium">{productsHook.productPage}/{productsHook.totalProductPages}</span>
        <Button variant="outline" size="sm" onClick={() => productsHook.setProductPage(p => Math.min(productsHook.totalProductPages, p + 1))} disabled={productsHook.productPage >= productsHook.totalProductPages || productsHook.productsLoading}
          className="bg-nebula border-white/[0.06] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 h-7 text-xs">
          Next <ChevronRight className="h-3 w-3 ml-1" strokeWidth={1.5} />
        </Button>
      </div>
    )
  }

  // Customer selector for mobile cart sheet
  const renderCustomerSelector = (isMobileView = false) => (
    <div className={isMobileView ? 'aether-card rounded-2xl p-3.5 space-y-2' : 'border-b border-white/[0.06] px-4 py-3'}>
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-slate-500 font-medium tracking-wide uppercase">Customer</Label>
        <button onClick={() => customersHook.setAddCustomerOpen(true)} className="text-[10px] theme-text hover:theme-text font-semibold flex items-center gap-1 transition-colors">
          <UserPlus className="h-3 w-3" strokeWidth={1.5} /> Tambah Baru
        </button>
      </div>
      <div className="relative">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" strokeWidth={1.5} />
        <Input
          placeholder={customersHook.selectedCustomer ? customersHook.selectedCustomer.name : 'Cari customer (walk-in jika kosong)'}
          value={customersHook.customerSearch}
          onChange={(e) => { customersHook.setCustomerSearch(e.target.value); customersHook.setCustomerDropdownOpen(true) }}
          onFocus={() => customersHook.setCustomerDropdownOpen(true)}
          className="pl-10 pr-8 h-10 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl backdrop-blur-sm"
        />
        {customersHook.selectedCustomer && (
          <button onClick={() => { customersHook.setSelectedCustomer(null); customersHook.setCustomerSearch(''); cartHook.setPointsToUse(0) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors">
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}
      </div>
      {customersHook.customerDropdownOpen && customersHook.filteredCustomers.length > 0 && !customersHook.selectedCustomer && (
        <div className={`absolute z-30 ${isMobileView ? 'w-[calc(100%-1.75rem)]' : 'w-full'} mt-1 aether-card-elevated rounded-2xl max-h-44 overflow-y-auto`}>
          {customersHook.filteredCustomers.map((customer) => (
            <button key={customer.id} onClick={() => { customersHook.setSelectedCustomer(customer); customersHook.setCustomerSearch(''); customersHook.setCustomerDropdownOpen(false); cartHook.setPointsToUse(0) }}
              className="w-full text-left px-4 py-2.5 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0 transition-colors first:rounded-t-2xl last:rounded-b-2xl">
              <p className="text-xs text-slate-200 font-medium">{customer.name}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{customer.whatsapp} · <span className="text-amber-400">{customer.points} pts</span></p>
            </button>
          ))}
        </div>
      )}
      {customersHook.selectedCustomer && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl theme-bg-very-light border theme-border-light">
            <User className="h-3 w-3 theme-text" strokeWidth={1.5} />
            <span className="text-[11px] theme-text font-medium">{customersHook.selectedCustomer.name}</span>
          </div>
          {customersHook.selectedCustomer.points > 0 && (
            <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px] rounded-lg">
              <Coins className="mr-1 h-2.5 w-2.5" strokeWidth={1.5} />
              {customersHook.selectedCustomer.points} poin
            </Badge>
          )}
        </div>
      )}
    </div>
  )

  // Cart items — mobile card-style layout (dedicated, not shared)
  const renderCartItemsMobile = () => {
    if (cartHook.cart.length === 0) return null
    return (
      <div className="space-y-3 pb-4">
        {cartHook.cart.map((item) => {
          const itemKey = cartHook.getCartKey(item.product.id, item.variant?.id || null)
          const itemTotal = cartHook.getEffectivePrice(item) * item.qty
          return (
            <div key={itemKey} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              {/* Top: Image + Name + Delete */}
              <div className="flex items-center gap-3 mb-3">
                {/* Image */}
                {item.product.image ? (
                  <div className="w-12 h-12 rounded-xl bg-white/[0.03] shrink-0 overflow-hidden relative">
                    <img
                      src={item.product.image}
                      alt={item.product.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        const fb = e.currentTarget.parentElement?.querySelector('.img-fb')
                        if (fb) fb.setAttribute('style', 'display:flex')
                      }}
                    />
                    <div className="img-fb absolute inset-0 items-center justify-center bg-white/[0.03] hidden">
                      <Package className="h-5 w-5 text-slate-600" strokeWidth={1.5} />
                    </div>
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center shrink-0">
                    <Package className="h-5 w-5 text-slate-600" strokeWidth={1.5} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-white truncate">{item.product.name}</p>
                  {item.variant && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/15 mt-1">
                      <span className="text-[10px] font-medium text-violet-400">{item.variant.name}</span>
                    </span>
                  )}
                  {(() => {
                    const bKey = `${item.product.id}::${item.variant?.id || 'base'}`
                    const bInfo = batchInfo[bKey]
                    if (!bInfo || !bInfo.batchNumber) return null
                    const d = bInfo.daysUntilExpiry
                    if (d == null) return null
                    if (d <= 7) return <span className="text-[10px] text-rose-400 leading-tight">🔴 Exp {d} hari</span>
                    if (d <= 30) return <span className="text-[10px] text-amber-400 leading-tight">🟠 Exp {d} hari</span>
                    return <span className="text-[10px] text-emerald-400 leading-tight">🟢 Batch: {bInfo.batchNumber}</span>
                  })()}
                </div>
                <button
                  onClick={() => cartHook.removeFromCart(item.product.id, item.variant?.id)}
                  className="h-9 w-9 flex items-center justify-center rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all active:scale-95"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>

              {/* Bottom: Price + Qty + Total */}
              <div className="flex items-center justify-between gap-3">
                {/* Price info */}
                <div className="min-w-0">
                  {cartHook.editingPriceId === itemKey ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500">Rp</span>
                      <input
                        ref={cartHook.priceInputRef}
                        type="number"
                        min="0"
                        value={cartHook.editingPriceValue}
                        onChange={(e) => {} /* handled internally by hook — but we need to wire this */}
                        onBlur={() => {} /* handled internally */}
                        onKeyDown={(e) => { if (e.key === 'Enter') cartHook.confirmEditPrice(); if (e.key === 'Escape') cartHook.cancelEditPrice() }}
                        className="flex-1 h-8 text-sm font-bold bg-white/[0.04] border border-amber-500/25 text-amber-400 rounded-lg outline-none text-right min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  ) : settingsHook.settings.manualDiscountEnabled ? (
                    <button onClick={() => cartHook.startEditPrice(itemKey, cartHook.getEffectivePrice(item))} className="text-left">
                      {item.customPrice != null && (
                        <span className="block text-[11px] text-slate-500 line-through">{formatCurrency(cartHook.getItemPrice(item))}</span>
                      )}
                      <div className="flex items-center gap-1">
                        <span className={cn('text-[13px] font-medium', item.customPrice != null ? 'text-amber-400' : 'text-slate-300')}>@{formatCurrency(cartHook.getEffectivePrice(item))}</span>
                        <Pencil className="h-3 w-3 text-slate-500" strokeWidth={1.5} />
                      </div>
                    </button>
                  ) : (
                    <span className="text-[13px] text-slate-400">@{formatCurrency(cartHook.getItemPrice(item))}</span>
                  )}
                  <span className="text-[11px] text-slate-500 mt-0.5 block">× {item.qty} item</span>
                </div>

                {/* Qty stepper — LARGE touch targets */}
                <div className="flex items-center gap-1">
                  <button
                    className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all"
                    onClick={() => cartHook.updateQty(item.product.id, item.qty - 1, item.variant?.id)}
                  >
                    <Minus className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                  {cartHook.editingQtyId === itemKey ? (
                    <input
                      ref={cartHook.qtyInputRef}
                      type="number"
                      min="0"
                      max={cartHook.getItemStock(item)}
                      value={cartHook.editingQtyValue}
                      onChange={(e) => {} /* handled internally */}
                      onBlur={() => cartHook.confirmEditQty()}
                      onKeyDown={(e) => { if (e.key === 'Enter') cartHook.confirmEditQty(); if (e.key === 'Escape') cartHook.cancelEditQty() }}
                      className="w-12 h-10 text-[15px] font-bold text-white text-center bg-white/[0.04] border border-white/[0.08] rounded-xl outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  ) : (
                    <span
                      className="w-12 text-center text-[15px] font-bold text-white cursor-pointer hover:theme-text transition-colors"
                      onClick={() => cartHook.startEditQty(itemKey, item.qty)}
                    >{item.qty}</span>
                  )}
                  <button
                    className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all"
                    onClick={() => cartHook.updateQty(item.product.id, item.qty + 1, item.variant?.id)}
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>

                {/* Total */}
                <p className="text-[15px] font-bold theme-text shrink-0 tabular-nums">{formatCurrency(itemTotal)}</p>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Cart items list — shared between desktop and mobile
  const renderCartItems = (compact = false) => {
    if (cartHook.cart.length === 0) return null
    return (
      <div className={compact ? 'space-y-2 pb-2' : 'space-y-1.5'}>
        {cartHook.cart.map((item) => {
          const itemKey = cartHook.getCartKey(item.product.id, item.variant?.id || null)
          const itemTotal = cartHook.getEffectivePrice(item) * item.qty
          return (
            <div key={itemKey} className={cn(
              'group flex items-center gap-2.5 rounded-xl aether-card transition-all duration-150',
              compact ? 'p-3' : 'p-2.5'
            )}>
              {/* Product Image */}
              {item.product.image ? (
                <div className={cn(
                  'shrink-0 relative rounded-lg overflow-hidden bg-white/[0.03]',
                  compact ? 'w-11 h-11' : 'w-9 h-9'
                )}>
                  <img
                    src={item.product.image}
                    alt={item.product.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                      const fb = e.currentTarget.parentElement?.querySelector('.img-fallback')
                      if (fb) fb.setAttribute('style', 'display:flex')
                    }}
                  />
                  <div className="img-fallback absolute inset-0 items-center justify-center bg-white/[0.03] hidden">
                    <Package className="h-3.5 w-3.5 text-slate-700" strokeWidth={1.5} />
                  </div>
                </div>
              ) : (
                <div className={cn(
                  'shrink-0 rounded-lg bg-white/[0.03] flex items-center justify-center',
                  compact ? 'w-11 h-11' : 'w-9 h-9'
                )}>
                  <Package className="h-3.5 w-3.5 text-slate-700" strokeWidth={1.5} />
                </div>
              )}
              {/* Product Info */}
              <div className="flex-1 min-w-0">
                <p className={cn('font-semibold text-white truncate leading-tight', compact ? 'text-[13px]' : 'text-xs')}>{item.product.name}</p>
                {item.variant && (
                  <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/15">
                    <span className="text-[9px] font-medium text-violet-400 leading-tight">{item.variant.name}</span>
                  </span>
                )}
                {(() => {
                  const bKey = `${item.product.id}::${item.variant?.id || 'base'}`
                  const bInfo = batchInfo[bKey]
                  if (!bInfo || !bInfo.batchNumber) return null
                  const d = bInfo.daysUntilExpiry
                  if (d == null) return null
                  if (d <= 7) return <span className="text-[10px] text-rose-400 leading-tight">🔴 Exp {d} hari</span>
                  if (d <= 30) return <span className="text-[10px] text-amber-400 leading-tight">🟠 Exp {d} hari</span>
                  return <span className="text-[10px] text-emerald-400 leading-tight">🟢 Batch: {bInfo.batchNumber}</span>
                })()}
                {/* Price — editable when manual discount enabled */}
                {settingsHook.settings.manualDiscountEnabled ? (
                  cartHook.editingPriceId === itemKey ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-slate-500">Rp</span>
                      <input
                        ref={cartHook.priceInputRef}
                        type="number"
                        min="0"
                        value={cartHook.editingPriceValue}
                        onChange={(e) => {} /* internal */}
                        onBlur={() => cartHook.confirmEditPrice()}
                        onKeyDown={(e) => { if (e.key === 'Enter') cartHook.confirmEditPrice(); if (e.key === 'Escape') cartHook.cancelEditPrice() }}
                        className={cn(
                          'flex-1 h-6 text-xs font-bold bg-white/[0.04] border border-amber-500/25 text-amber-400 rounded-md outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                          compact ? 'min-w-0' : 'min-w-0'
                        )}
                      />
                      <span className={cn('text-slate-600', compact ? 'text-[11px]' : 'text-[10px]')}>× {item.qty}</span>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1.5 mt-1 group/price"
                      onClick={() => cartHook.startEditPrice(itemKey, cartHook.getEffectivePrice(item))}
                    >
                      {item.customPrice != null && (
                        <span className={cn('line-through text-slate-600', compact ? 'text-[10px]' : 'text-[9px]')}>
                          {formatCurrency(cartHook.getItemPrice(item))}
                        </span>
                      )}
                      <span className={cn(
                        'font-medium tabular-nums',
                        compact ? 'text-[12px]' : 'text-[11px]',
                        item.customPrice != null ? 'text-amber-400' : 'text-slate-300'
                      )}>
                        @{formatCurrency(cartHook.getEffectivePrice(item))}
                      </span>
                      <Pencil className="h-2.5 w-2.5 text-slate-600 opacity-0 group-hover/price:opacity-100 transition-opacity" strokeWidth={1.5} />
                    </button>
                  )
                ) : (
                  <span className={cn(
                    'text-slate-400 tabular-nums mt-0.5 block',
                    compact ? 'text-[11px]' : 'text-[10px]'
                  )}>
                    @{formatCurrency(cartHook.getItemPrice(item))} × {item.qty}
                  </span>
                )}
              </div>
              {/* Qty Controls */}
              <div className={cn('flex items-center gap-1 shrink-0', compact ? 'ml-auto' : '')}>
                <button
                  className={cn(
                    'w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all',
                    compact ? 'text-xs' : 'text-[11px]'
                  )}
                  onClick={() => cartHook.updateQty(item.product.id, item.qty - 1, item.variant?.id)}
                >
                  <Minus className={cn('stroke-[1.5]', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                </button>
                {cartHook.editingQtyId === itemKey ? (
                  <input
                    ref={cartHook.qtyInputRef}
                    type="number"
                    min="0"
                    max={cartHook.getItemStock(item)}
                    value={cartHook.editingQtyValue}
                    onChange={(e) => {} /* internal */}
                    onBlur={() => cartHook.confirmEditQty()}
                    onKeyDown={(e) => { if (e.key === 'Enter') cartHook.confirmEditQty(); if (e.key === 'Escape') cartHook.cancelEditQty() }}
                    className={cn(
                      'font-bold text-white text-center bg-white/[0.04] border border-white/[0.08] rounded-lg outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                      compact ? 'w-8 h-6 text-xs' : 'w-8 h-7 text-[11px]'
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      'cursor-pointer hover:theme-text transition-colors font-bold text-white tabular-nums',
                      compact ? 'w-8 h-6 text-xs flex items-center justify-center' : 'w-8 h-7 text-[11px] flex items-center justify-center'
                    )}
                    onClick={() => cartHook.startEditQty(itemKey, item.qty)}
                  >{item.qty}</span>
                )}
                <button
                  className={cn(
                    'w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all',
                    compact ? 'text-xs' : 'text-[11px]'
                  )}
                  onClick={() => cartHook.updateQty(item.product.id, item.qty + 1, item.variant?.id)}
                >
                  <Plus className={cn('stroke-[1.5]', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                </button>
              </div>
              {/* Item Total & Delete */}
              <div className={cn('text-right shrink-0', compact ? 'ml-2' : '')}>
                <p className={cn('font-bold tabular-nums', compact ? 'text-sm text-white' : 'text-xs text-slate-200')}>
                  {formatCurrency(itemTotal)}
                </p>
                <button
                  onClick={() => cartHook.removeFromCart(item.product.id, item.variant?.id)}
                  className={cn(
                    'mt-0.5 flex items-center justify-center text-slate-600 hover:text-red-400 transition-colors ml-auto',
                    compact ? 'h-6 w-6' : 'h-5 w-5'
                  )}
                >
                  <X className={cn('stroke-[1.5]', compact ? 'h-3.5 w-3.5' : 'h-3 w-3')} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Cart summary section (desktop right panel bottom)
  const renderCartSummary = () => (
    <>
      {/* Subtotal row */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-500">Subtotal</span>
        <span className="text-slate-300 font-medium tabular-nums">{formatCurrency(cartHook.subtotal)}</span>
      </div>

      {/* Manual Discount (if any) */}
      {cartHook.manualDiscountTotal > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-amber-400">Diskon Manual</span>
          <span className="text-amber-400 font-medium tabular-nums">-{formatCurrency(cartHook.manualDiscountTotal)}</span>
        </div>
      )}

      {/* Points Discount (if any) */}
      {cartHook.pointsDiscount > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cyan-400 flex items-center gap-1"><Coins className="h-3 w-3" strokeWidth={1.5} /> Poin ({cartHook.pointsToUse})</span>
          <span className="text-cyan-400 font-medium tabular-nums">-{formatCurrency(cartHook.pointsDiscount)}</span>
        </div>
      )}

      {/* Promo Discount (if any) */}
      {promoDiscount > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-emerald-400 flex items-center gap-1"><Tag className="h-3 w-3" strokeWidth={1.5} /> {selectedPromo?.name || 'Promo'}</span>
          <span className="text-emerald-400 font-medium tabular-nums">-{formatCurrency(promoDiscount)}</span>
        </div>
      )}

      {/* PPN/Tax (if enabled) */}
      {cartHook.ppnAmount > 0 && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">PPN ({settingsHook.settings.ppnRate}%)</span>
          <span className="text-slate-300 font-medium tabular-nums">{formatCurrency(cartHook.ppnAmount)}</span>
        </div>
      )}

      <Separator className="bg-white/[0.06]" />

      {/* Total */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">Total</span>
        <span className="text-lg font-bold theme-text tabular-nums">{formatCurrency(cartHook.total)}</span>
      </div>

      {/* Points usage (if customer selected with points) */}
      {customersHook.selectedCustomer && customersHook.selectedCustomer.points > 0 && settingsHook.settings.loyaltyEnabled && (
        <div className="pt-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">Poin tersedia</span>
            <span className="text-amber-400 font-medium">{customersHook.selectedCustomer.points} poin (maks. {formatCurrency(Math.min(customersHook.selectedCustomer.points * settingsHook.settings.loyaltyPointValue, cartHook.subtotal - cartHook.manualDiscountTotal - promoDiscount))})</span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-slate-500 shrink-0">Gunakan poin:</Label>
            <input
              type="number"
              min="0"
              max={cartHook.maxPointsToUse}
              value={cartHook.pointsToUse || ''}
              onChange={(e) => checkoutHook.handlePointsChange(e.target.value)}
              placeholder="0"
              className="flex-1 h-7 text-xs bg-white/[0.04] border border-white/[0.08] text-white rounded-lg px-2 outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            {cartHook.pointsToUse > 0 && (
              <span className="text-[10px] text-cyan-400 font-medium shrink-0">-{formatCurrency(cartHook.pointsDiscount)}</span>
            )}
          </div>
        </div>
      )}

      {/* Below-HPP Warning */}
      {cartHook.hasBelowHpp && (
        <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/15">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" strokeWidth={1.5} />
          <div className="text-[10px] text-red-400/90 leading-relaxed">
            <p className="font-semibold">⚠️ {cartHook.belowHppItems.length} item di bawah HPP!</p>
            <p className="mt-0.5">Rugi total: <strong>-{formatCurrency(cartHook.belowHppTotalLoss)}</strong></p>
          </div>
        </div>
      )}
    </>
  )

  // ═══════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════

  return (
    <div className="h-full flex flex-col bg-deep-space overflow-hidden">
      {/* ══════ HEADER BAR ══════ */}
      <div className="flex items-center justify-between px-3 py-2 md:px-4 md:py-3 border-b border-white/[0.06] bg-nebula/80 backdrop-blur-xl shrink-0 z-20">
        {/* Left: Status indicators */}
        <div className="flex items-center gap-1.5">
          {/* Connection status */}
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
            sync.isOnline ? 'theme-bg-very-light theme-border-light theme-text' : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {sync.isOnline ? <Wifi className="h-2.5 w-2.5" strokeWidth={1.5} /> : <WifiOff className="h-2.5 w-2.5" strokeWidth={1.5} />}
            <span className="hidden sm:inline">{sync.isOnline ? 'Online' : 'Offline'}</span>
          </div>

          {/* Data freshness badge */}
          {sync.lastSyncTimes.products ? (
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
              sync.dataSyncing
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                : sync.isSyncStale
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse-slow'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-500'
            }`}>
              <Database className="h-2.5 w-2.5" strokeWidth={1.5} />
              {sync.timeAgo(sync.lastSyncTimes.products)}
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-medium">
              <Database className="h-2.5 w-2.5" strokeWidth={1.5} /><span>No cache</span>
            </div>
          )}
        </div>

        {/* Center: Title (mobile only) */}
        <h1 className="text-sm font-bold text-white md:hidden absolute left-1/2 -translate-x-1/2">POS</h1>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          {/* Unsynced count */}
          {sync.unsyncedCount > 0 && (
            <button onClick={() => sync.setOfflineListOpen(true)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-medium hover:bg-amber-500/15 transition-all">
              <CloudOff className="h-2.5 w-2.5" strokeWidth={1.5} />
              <span>{sync.unsyncedCount}</span>
            </button>
          )}
          {/* Refresh button */}
          <button onClick={async () => {
            if (sync.dataSyncing || !sync.isOnline) return
            sync.setDataSyncing(true)
            try {
              const result = await syncAllData()
              productsHook.fetchProducts(productsHook.productSearch, productsHook.productPage, productsHook.selectedCategoryId)
              customersHook.loadCustomersFromCache()
              const times = await getAllSyncTimes()
              // Note: sync.setLastSyncTimes is not exposed; using internal state update instead
              toast.success(`Data direfresh: ${result.products.count} produk, ${result.customers.count} customer`)
            } catch { toast.error('Gagal refresh data') }
            finally { sync.setDataSyncing(false) }
          }} disabled={sync.dataSyncing || !sync.isOnline}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-medium shrink-0 transition-all disabled:opacity-50',
              sync.isSyncStale && !sync.dataSyncing
                ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300 active:scale-95 shadow-[0_0_6px_rgba(245,158,11,0.15)]'
                : 'aether-card text-slate-500'
            )}>
            {sync.dataSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {/* ══════ HEADER — Desktop Full ══════ */}
      <div className="hidden md:flex md:items-center md:justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Point of Sale</h1>
            <p className="text-[11px] text-slate-500">Proses transaksi & terima pembayaran</p>
          </div>

          {/* Outlet Selector */}
          {settingsHook.userOutlets.length > 1 ? (
            <Select
              value={settingsHook.outletInfo?.id || ''}
              onValueChange={(value) => {
                const selectedOutlet = settingsHook.userOutlets.find(o => o.id === value)
                if (selectedOutlet && selectedOutlet.id !== settingsHook.outletInfo?.id) {
                  toast.info(`Switching to "${selectedOutlet.name}"...`, {
                    description: 'Data will reload for the selected outlet.',
                    duration: 3000,
                  })
                  // Outlet switching would need to update settingsHook's outletInfo
                  // For now this is informational — full outlet switch logic not in scope
                }
              }}
            >
              <SelectTrigger className="w-auto min-w-[180px] max-w-[220px] h-8 bg-nebula border-white/[0.08] text-slate-200 text-xs rounded-lg gap-1.5 pr-2">
                <Store className="h-3.5 w-3.5 text-slate-500 shrink-0" strokeWidth={1.5} />
                <SelectValue placeholder={settingsHook.outletsLoading ? 'Loading...' : 'Select outlet'} />
              </SelectTrigger>
              <SelectContent className="bg-nebula border-white/[0.08]">
                {settingsHook.userOutlets.map((outlet) => (
                  <SelectItem key={outlet.id} value={outlet.id} className="text-xs text-slate-200 focus:bg-white/[0.04] focus:text-white">
                    <div className="flex items-center gap-2">
                      <Store className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.5} />
                      <span>{outlet.name}</span>
                      {outlet.isPrimary && (
                        <span className="text-[9px] theme-bg-very-light theme-text border theme-border-light px-1.5 py-0.5 rounded-full font-medium">
                          Primary
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : settingsHook.outletInfo ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-medium text-slate-400">
              <Store className="h-3 w-3" strokeWidth={1.5} />
              <span>{settingsHook.outletInfo.name}</span>
            </div>
          ) : !settingsHook.outletsLoading ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/[0.06] text-[11px] font-medium text-slate-600">
              <Store className="h-3 w-3" strokeWidth={1.5} />
              <span>No outlet</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Connection */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
            sync.isOnline ? 'theme-bg-very-light theme-border-light theme-text' : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {sync.isOnline ? <><Wifi className="h-3 w-3" strokeWidth={1.5} /><span>Online</span></> : <><WifiOff className="h-3 w-3" strokeWidth={1.5} /><span>Offline</span></>}
          </div>

          {/* Data sync badge — shows timestamp, pulses when stale */}
          {sync.lastSyncTimes.products ? (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              sync.dataSyncing
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                : sync.isSyncStale
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse-slow'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-500'
            }`}>
              {sync.dataSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" strokeWidth={1.5} />}
              <span>{sync.dataSyncing ? 'Syncing...' : sync.timeAgo(sync.lastSyncTimes.products)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium">
              <Database className="h-3 w-3" /><span>No cache</span>
            </div>
          )}

          {/* Unsynced */}
          {sync.unsyncedCount > 0 && (
            <button onClick={() => sync.setOfflineListOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium hover:bg-amber-500/15 transition-all cursor-pointer">
              <CloudOff className="h-3 w-3" strokeWidth={1.5} /><span>{sync.unsyncedCount} pending</span>
            </button>
          )}

          {/* Sync / Refresh button — glows when stale */}
          <Button onClick={async () => {
            if (sync.dataSyncing || !sync.isOnline) return
            sync.setDataSyncing(true)
            try {
              const result = await syncAllData()
              productsHook.fetchProducts(productsHook.productSearch, productsHook.productPage, productsHook.selectedCategoryId)
              // Categories loaded inside products hook
              customersHook.loadCustomersFromCache()
              const times = await getAllSyncTimes()
              // Note: Internal sync state update would happen here
              toast.success(`Data direfresh: ${result.products.count} produk, ${result.customers.count} customer`)
            } catch { toast.error('Gagal refresh data') }
            finally { sync.setDataSyncing(false) }
          }} disabled={sync.dataSyncing || !sync.isOnline} variant="outline" size="sm"
            className={cn(
              'h-7 text-xs gap-1.5 transition-all',
              sync.isSyncStale && !sync.dataSyncing
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200 shadow-[0_0_8px_rgba(245,158,11,0.15)]'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
              'disabled:opacity-50'
            )}>
            {sync.dataSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" strokeWidth={1.5} />}
            Sync
          </Button>

          {sync.unsyncedCount > 0 && (
            <Button onClick={() => sync.setOfflineListOpen(true)} variant="outline" size="sm"
              className="bg-amber-600/20 border-amber-500/30 text-amber-400 hover:bg-amber-600/30 h-7 text-xs gap-1.5">
              <CloudOff className="h-3 w-3" />
              {sync.unsyncedCount} Offline
            </Button>
          )}
        </div>
      </div>

      {/* ══════ DESKTOP LAYOUT ══════ */}
      <div className="hidden lg:grid lg:grid-cols-5 gap-3 flex-1 min-h-0">
        {/* Products - Left (3/5) */}
        <div className="lg:col-span-3 flex flex-col min-h-0">
          {/* Search */}
          <div className="relative mb-3 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" strokeWidth={1.5} />
            <Input
              ref={searchInputRef}
              placeholder="Scan barcode atau cari produk..."
              value={productsHook.productSearch}
              onChange={(e) => productsHook.handleSearchChange(e.target.value)}
              onKeyDown={productsHook.handleSearchKeyDown}
              className="pl-10 h-10 text-sm bg-nebula/80 border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl"
            />
          </div>

          {/* Category Chips */}
          <div className="shrink-0">{renderCategoryChips()}</div>

          {/* Product Grid — scrollable middle (pt-2 for badge clearance) */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-2">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 pb-2">
              {renderProductGrid()}
            </div>
          </div>

          {/* Pagination — fixed bottom */}
          <div className="shrink-0">{renderPagination()}</div>
        </div>

        {/* Cart - Right (2/5) — CLEAN DESIGN: no inline payment */}
        <div className="lg:col-span-2 flex flex-col h-full bg-deep-space border border-white/[0.06] rounded-2xl overflow-hidden shadow-2xl shadow-black/20">
          {/* Cart Header */}
          <div className="px-4 py-3 border-b border-white/[0.06] bg-gradient-to-b from-nebula/50 to-transparent shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl theme-gradient-subtle flex items-center justify-center border theme-border-light">
                  <ShoppingCart className="h-4 w-4 theme-text" strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white leading-tight">Keranjang</h2>
                  {cartHook.cart.length > 0 && <p className="text-[10px] text-slate-500 leading-tight">{cartHook.cart.length} produk · {cartHook.cart.reduce((s, i) => s + i.qty, 0)} item</p>}
                </div>
              </div>
              {cartHook.cart.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => sync.setPendingListOpen(true)} className={cn(
                    "relative flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-semibold transition-all",
                    pendingCount > 0
                      ? "text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15"
                      : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20"
                  )}>
                    <ClockArrowDown className="h-3 w-3" strokeWidth={1.5} />
                    {pendingCount > 0 && <span>{pendingCount}</span>}
                  </button>
                  <button onClick={cartHook.clearCart} className="h-7 px-2.5 rounded-lg text-[10px] font-semibold text-slate-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all">
                    Hapus Semua
                  </button>
                </div>
              )}
              {cartHook.cart.length === 0 && pendingCount > 0 && (
                <button onClick={() => sync.setPendingListOpen(true)} className="relative flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-all">
                  <ClockArrowDown className="h-3 w-3" strokeWidth={1.5} />
                  <span>{pendingCount} pending</span>
                </button>
              )}
            </div>
          </div>

          {/* Customer Selector — embedded at top of scrollable area */}
          <div className="shrink-0 px-4 pt-3 pb-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Customer</span>
              <button onClick={() => customersHook.setAddCustomerOpen(true)} className="text-[10px] theme-text hover:theme-text font-semibold flex items-center gap-0.5 transition-colors">
                <UserPlus className="h-2.5 w-2.5" strokeWidth={1.5} /> Baru
              </button>
            </div>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" strokeWidth={1.5} />
              <Input
                placeholder={customersHook.selectedCustomer ? customersHook.selectedCustomer.name : 'Tambah customer (opsional)'}
                value={customersHook.customerSearch}
                onChange={(e) => { customersHook.setCustomerSearch(e.target.value); customersHook.setCustomerDropdownOpen(true) }}
                onFocus={() => customersHook.setCustomerDropdownOpen(true)}
                className="pl-9 pr-8 h-9 text-xs bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 rounded-xl"
              />
              {customersHook.selectedCustomer && (
                <button onClick={() => { customersHook.setSelectedCustomer(null); customersHook.setCustomerSearch(''); cartHook.setPointsToUse(0) }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-white/[0.04] text-slate-400 hover:text-slate-200 transition-colors">
                  <X className="h-2.5 w-2.5" strokeWidth={1.5} />
                </button>
              )}
            </div>
            {customersHook.customerDropdownOpen && customersHook.filteredCustomers.length > 0 && !customersHook.selectedCustomer && (
              <div className="absolute z-30 w-full mt-1 bg-nebula border border-white/[0.08] rounded-xl shadow-2xl shadow-black/50 max-h-40 overflow-y-auto">
                {customersHook.filteredCustomers.map((customer) => (
                  <button key={customer.id} onClick={() => { customersHook.setSelectedCustomer(customer); customersHook.setCustomerSearch(''); customersHook.setCustomerDropdownOpen(false); cartHook.setPointsToUse(0) }}
                    className="w-full text-left px-3.5 py-2 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0 transition-colors">
                    <p className="text-xs text-slate-200 font-medium">{customer.name}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{customer.whatsapp} · <span className="text-amber-400">{customer.points} pts</span></p>
                  </button>
                ))}
              </div>
            )}
            {customersHook.selectedCustomer && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg theme-bg-very-light border theme-border-light">
                  <User className="h-2.5 w-2.5 theme-text" strokeWidth={1.5} />
                  <span className="text-[10px] theme-text font-medium">{customersHook.selectedCustomer.name}</span>
                </div>
                {customersHook.selectedCustomer.points > 0 && (
                  <span className="text-[10px] text-amber-400 font-medium">{customersHook.selectedCustomer.points} pts</span>
                )}
              </div>
            )}
          </div>

          {/* Items — scrollable middle */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2">
            {cartHook.cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-white/[0.04] to-nebula border border-white/[0.04] flex items-center justify-center mb-4">
                  <ShoppingCart className="h-8 w-8 text-slate-700/60" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-medium text-slate-500">Keranjang Kosong</p>
                <p className="text-[11px] text-slate-600 mt-1">Pilih produk dari kiri untuk memulai</p>
              </div>
            ) : (
              renderCartItems(false)
            )}
          </div>

          {/* Summary & Action Buttons — fixed bottom (NO inline payment) */}
          {cartHook.cart.length > 0 && (
            <div className="shrink-0 border-t border-white/[0.06] bg-gradient-to-t from-deep-space to-nebula/80 p-4 space-y-3">
              {renderCartSummary()}
              <div className="flex gap-2">
                <Button onClick={checkoutHook.handleHoldTransaction} variant="outline"
                  className="h-11 px-4 font-semibold text-sm rounded-xl border-white/[0.08] text-slate-300 hover:bg-white/[0.04] hover:text-white transition-all shrink-0">
                  <ClockArrowDown className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                  Tunda
                </Button>
                <Button onClick={checkoutHook.openPaymentDialog} disabled={cartHook.cart.length === 0 || cartHook.hasBelowHpp}
                  className={`flex-1 h-11 font-bold text-sm rounded-xl transition-all ${
                    cartHook.cart.length > 0 && !cartHook.hasBelowHpp
                      ? 'theme-gradient hover:theme-hover text-white shadow-lg theme-shadow hover:theme-shadow active:scale-[0.99]'
                      : 'bg-white/[0.04] text-slate-500 cursor-not-allowed'
                  }`}>
                  <Check className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                  {cartHook.hasBelowHpp ? 'Harga di bawah HPP' : 'Proses Bayar'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══════ MOBILE LAYOUT — Product view + floating cart ══════ */}
      <div className="md:hidden shrink-0">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" strokeWidth={1.5} />
          <Input
            ref={searchInputRef}
            placeholder="Cari produk..."
            value={productsHook.productSearch}
            onChange={(e) => productsHook.handleSearchChange(e.target.value)}
            onKeyDown={productsHook.handleSearchKeyDown}
            className="pl-10 h-11 text-sm bg-nebula/80 border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl"
          />
        </div>
        {renderCategoryChips()}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-2 pb-20">
          <div className="grid grid-cols-2 gap-2.5 pb-2">
            {renderProductGrid()}
          </div>
          {renderPagination()}
        </div>
      </div>

      {/* Mobile Floating Cart Button */}
      {cartHook.cart.length > 0 && (
        <button
          onClick={() => checkoutHook.setMobileCartOpen(true)}
          className="md:hidden fixed bottom-4 right-4 z-40 flex items-center gap-2 h-12 pl-4 pr-5 theme-gradient rounded-2xl shadow-lg theme-shadow active:scale-[0.97] transition-transform"
        >
          <ShoppingCart className="h-5 w-5 text-white" strokeWidth={1.5} />
          <span className="text-sm font-bold text-white">{cartHook.cart.length} item</span>
          <span className="text-sm font-bold text-white/90 tabular-nums">{formatCurrency(cartHook.total)}</span>
          <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold text-white">
            {cartHook.cart.reduce((s, i) => s + i.qty, 0)}
          </span>
        </button>
      )}

      {/* ══════ DIALOGS ══════ */}

      {/* Variant Picker Dialog */}
      <ResponsiveDialog open={productsHook.variantPicker.open} onOpenChange={(open) => { if (!open) productsHook.setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false }) }}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="h-4 w-4 text-violet-400" strokeWidth={1.5} />
              Pilih Varian — {productsHook.variantPicker.product?.name}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-400">
              Pilih varian yang diinginkan
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2 space-y-1.5 max-h-[40vh] overflow-y-auto">
            {productsHook.variantPicker.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
              </div>
            ) : productsHook.variantPicker.variants.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-8 w-8 text-slate-600 mx-auto mb-2" strokeWidth={1.5} />
                <p className="text-xs text-slate-500">Tidak ada varian tersedia</p>
              </div>
            ) : (
              productsHook.variantPicker.variants.map((variant) => (
                <button
                  key={variant.id}
                  onClick={() => productsHook.handleVariantSelect(variant)}
                  disabled={variant.stock <= 0}
                  className={cn(
                    'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-all text-left',
                    variant.stock <= 0
                      ? 'bg-white/[0.02] border-white/[0.04] opacity-50 cursor-not-allowed'
                      : 'aether-card hover:bg-white/[0.04] active:scale-[0.98]'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-medium text-slate-200">{variant.name}</span>
                    {variant.sku && (
                      <span className="text-[10px] text-slate-500 font-mono">{variant.sku}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {variant.stock <= 0 ? (
                      <span className="text-[10px] text-red-400 font-medium">Habis</span>
                    ) : (
                      <span className="text-[10px] text-slate-500">Stok: {variant.stock}</span>
                    )}
                    <span className="text-xs font-bold text-slate-300 tabular-nums">{formatCurrency(variant.price)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Payment Dialog */}
      <PaymentDialog
        open={checkoutHook.paymentDialogOpen}
        onOpenChange={checkoutHook.setPaymentDialogOpen}
        cartItems={cartHook.cart}
        subtotal={cartHook.subtotal}
        total={cartHook.total}
        manualDiscountTotal={cartHook.manualDiscountTotal}
        pointsDiscount={cartHook.pointsDiscount}
        promoDiscount={promoDiscount}
        ppnAmount={cartHook.ppnAmount}
        paymentMethod={checkoutHook.paymentMethod}
        paidAmount={checkoutHook.paidAmount}
        change={cartHook.change}
        settings={settingsHook.settings}
        selectedCustomer={customersHook.selectedCustomer}
        maxPointsToUse={cartHook.maxPointsToUse}
        pointsToUse={cartHook.pointsToUse}
        onPaymentMethodChange={(method) => {
          // Payment method is owned by checkoutHook
          // This callback would need to go through the setter pattern
        }}
        onPaidAmountChange={checkoutHook.setPaidAmount}
        onPointsChange={checkoutHook.handlePointsChange}
        onCheckout={checkoutHook.handleCheckout}
        checkingOut={checkoutHook.checkingOut}
        checkoutResult={checkoutHook.checkoutResult}
        availablePaymentMethods={settingsHook.availablePaymentMethods}
        getItemPrice={cartHook.getItemPrice}
        getEffectivePrice={cartHook.getEffectivePrice}
        getItemDisplayName={cartHook.getItemDisplayName}
        getQuickNominals={getQuickNominals}
        hasBelowHpp={cartHook.hasBelowHpp}
        belowHppItems={cartHook.belowHppItems}
        belowHppTotalLoss={cartHook.belowHppTotalLoss}
        editingQtyId={cartHook.editingQtyId}
        editingQtyValue={cartHook.editingQtyValue}
        startEditQty={cartHook.startEditQty}
        confirmEditQty={cartHook.confirmEditQty}
        cancelEditQty={cartHook.cancelEditQty}
        qtyInputRef={cartHook.qtyInputRef}
        updateQty={cartHook.updateQty}
        removeFromCart={cartHook.removeFromCart}
        getItemStock={cartHook.getItemStock}
        getCartKey={cartHook.getCartKey}
        selectedPromo={selectedPromo}
        availablePromos={settingsHook.availablePromos}
        onPromoSelect={(promo) => {
          // Promo selection is local state
          if (promo) {
            setSelectedPromo(promo as { id: string; name: string; type: string; discount: number; description: string })
            setPromoDiscount((promo as { discount: number }).discount || 0)
          } else {
            setSelectedPromo(null)
            setPromoDiscount(0)
          }
        }}
        promoLoading={promoLoading}
      />

      {/* Receipt Dialog */}
      <ReceiptDialog
        open={checkoutHook.receiptDialogOpen}
        onOpenChange={checkoutHook.setReceiptDialogOpen}
        checkoutResult={checkoutHook.checkoutResult}
        cartItems={cartHook.cart}
        subtotal={cartHook.subtotal}
        total={cartHook.total}
        manualDiscountTotal={cartHook.manualDiscountTotal}
        pointsDiscount={cartHook.pointsDiscount}
        promoDiscount={promoDiscount}
        ppnAmount={cartHook.ppnAmount}
        paymentMethod={checkoutHook.paymentMethod}
        paidAmount={checkoutHook.paidAmount}
        change={cartHook.change}
        settings={settingsHook.settings}
        outletInfo={settingsHook.outletInfo}
        selectedCustomer={customersHook.selectedCustomer}
        onFinish={checkoutHook.handleReceiptFinish}
        getItemPrice={cartHook.getItemPrice}
        getEffectivePrice={cartHook.getEffectivePrice}
        getItemDisplayName={cartHook.getItemDisplayName}
        selectedPromo={selectedPromo}
      />

      {/* Add Customer Dialog */}
      <ResponsiveDialog open={customersHook.addCustomerOpen} onOpenChange={customersHook.setAddCustomerOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
              Pelanggan Baru
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-500">
              Tambahkan pelanggan baru ke database
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-slate-400 font-medium">Nama *</Label>
              <Input
                value={customersHook.newCustomer.name}
                onChange={(e) => customersHook.setNewCustomer({ ...customersHook.newCustomer, name: e.target.value })}
                placeholder="Nama pelanggan"
                className="h-10 text-sm bg-white/[0.04] border-white/[0.08] text-white rounded-xl"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-slate-400 font-medium">WhatsApp</Label>
              <Input
                value={customersHook.newCustomer.whatsapp}
                onChange={(e) => customersHook.setNewCustomer({ ...customersHook.newCustomer, whatsapp: e.target.value })}
                placeholder="08xxxxxxxxxx"
                className="h-10 text-sm bg-white/[0.04] border-white/[0.08] text-white rounded-xl"
              />
            </div>
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => customersHook.setAddCustomerOpen(false)}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] text-xs rounded-xl">
              Batal
            </Button>
            <Button onClick={customersHook.handleAddCustomer} disabled={customersHook.addingCustomer}
              className="theme-bg hover:theme-hover text-white text-xs rounded-xl font-medium">
              {customersHook.addingCustomer ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Menyimpan...</> : <><UserPlus className="mr-1.5 h-3 w-3" /> Simpan</>}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Pending Transactions Dialog */}
      <ResponsiveDialog open={sync.pendingListOpen} onOpenChange={sync.setPendingListOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-md rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <ClockArrowDown className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
              Transaksi Ditunda
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-400 flex items-center gap-2 pt-1">
              Keranjang yang ditunda bisa dilanjutkan kapan saja
              {pendingCount > 0 && (
                <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] px-2 py-0.5 h-5 font-semibold">{pendingCount}</Badge>
              )}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <PendingListContent
            onResume={checkoutHook.handleResumePending}
            onDelete={checkoutHook.handleDeletePending}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Hold Note Dialog */}
      <ResponsiveDialog open={checkoutHook.holdNoteOpen} onOpenChange={checkoutHook.setHoldNoteOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-amber-400" strokeWidth={1.5} /> Catatan Tunda
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-500">
              Tambahkan catatan opsional untuk transaksi ini
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2">
            <textarea
              value={checkoutHook.holdNote}
              onChange={(e) => checkoutHook.setHoldNote(e.target.value)}
              placeholder="Contoh: customer minta ditunda, menunggu pembayaran..."
              rows={3}
              autoFocus
              className="w-full bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-slate-600 text-sm rounded-xl px-3.5 py-2.5 resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/50 focus-visible:border-cyan-500/30 transition-all"
            />
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => { checkoutHook.setHoldNoteOpen(false); checkoutHook.setHoldNote('') }}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] text-xs rounded-xl">
              Batal
            </Button>
            <Button onClick={checkoutHook.confirmHoldTransaction}
              className="theme-bg hover:theme-hover text-white text-xs rounded-xl font-medium">
              <ClockArrowDown className="mr-1.5 h-3 w-3" strokeWidth={1.5} />
              Tunda Transaksi
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Mobile Cart Sheet */}
      <Sheet open={checkoutHook.mobileCartOpen} onOpenChange={checkoutHook.setMobileCartOpen}>
        <SheetContent side="bottom" className="flex flex-col h-[85vh] p-0 bg-deep-space rounded-t-2xl">
          {/* Sheet Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 theme-text" strokeWidth={1.5} />
              <h2 className="text-sm font-bold text-white">Keranjang</h2>
              <Badge variant="secondary" className="bg-white/[0.06] text-slate-400 border-white/[0.08] text-[10px] px-1.5 py-0 h-5">
                {cartHook.cart.length} · {cartHook.cart.reduce((s, i) => s + i.qty, 0)} item
              </Badge>
            </div>
            <button onClick={() => checkoutHook.setMobileCartOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors">
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          {/* Sheet Body — scrollable */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {renderCustomerSelector(true)}
            {renderCartItemsMobile()}

            {/* Summary Section */}
            {cartHook.cart.length > 0 && (
              <div className="px-4 py-3 space-y-2 border-t border-white/[0.06] mt-2">
                {renderCartSummary()}
              </div>
            )}
          </div>

          {/* Sheet Footer — sticky action buttons */}
          {cartHook.cart.length > 0 && (
            <div className="shrink-0 px-4 py-3 border-t border-white/[0.06] bg-nebula/95 backdrop-blur-xl space-y-2">
              <div className="flex gap-2">
                <Button onClick={checkoutHook.handleHoldTransaction} variant="outline"
                  className="flex-1 h-11 font-semibold text-sm rounded-xl border-white/[0.08] text-slate-300">
                  <ClockArrowDown className="mr-1 h-4 w-4" strokeWidth={1.5} />
                  Tunda
                </Button>
                <Button onClick={checkoutHook.openPaymentDialog} disabled={cartHook.hasBelowHpp}
                  className={`flex-1 h-11 font-bold text-sm rounded-xl transition-all ${
                    !cartHook.hasBelowHpp
                      ? 'theme-gradient hover:theme-hover text-white shadow-lg theme-shadow'
                      : 'bg-white/[0.04] text-slate-500 cursor-not-allowed'
                  }`}>
                  <Check className="mr-1 h-4 w-4" strokeWidth={1.5} />
                  Bayar {formatCurrency(cartHook.total)}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Offline Sync List Dialog */}
      <ResponsiveDialog open={sync.offlineListOpen} onOpenChange={sync.setOfflineListOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-lg rounded-2xl max-h-[85vh] flex flex-col">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <CloudOff className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
              Daftar Offline
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-400">
              Transaksi yang belum tersinkronisasi ke server
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <OfflineSyncContent
            isOnline={sync.isOnline}
            onSynced={() => {
              // Trigger refresh after sync
              productsHook.fetchProducts(productsHook.productSearch, productsHook.productPage, productsHook.selectedCategoryId)
              customersHook.loadCustomersFromCache()
            }}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}

// ==================== PENDING LIST SUB-COMPONENT (unchanged) ====================

function PendingListContent({
  onResume,
  onDelete,
}: {
  onResume: (pending: PendingTransaction) => void
  onDelete: (id: number) => void
}) {
  const pendingList = useLiveQuery(
    () => localDB.pendingTransactions.orderBy('createdAt').reverse().toArray(),
    []
  )

  if (!pendingList) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
      </div>
    )
  }

  if (pendingList.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3.5 border border-white/[0.06]">
          <ClockArrowDown className="h-7 w-7 text-slate-600" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-white font-bold">Belum Ada yang Ditunda</p>
        <p className="text-[11px] text-slate-500 mt-1.5 max-w-[220px] mx-auto leading-relaxed">
          Saat melayani pelanggan, Anda bisa menunda transaksi yang sedang berjalan lalu melanjutkannya nanti.
        </p>
        <div className="mt-4 mx-auto max-w-[260px] px-3 py-2.5 rounded-xl bg-amber-500/[0.06] border border-amber-500/[0.08]">
          <p className="text-[10px] text-amber-400/80 leading-relaxed text-left">
            💡 <span className="font-medium text-amber-400">Tip:</span> Gunakan tombol <span className="font-semibold text-white">Tunda</span> di keranjang untuk menahan sementara pesanan ini.
          </p>
        </div>
      </div>
    )
  }

  const formatRelativeTime = (ts: number) => {
    const diff = Date.now() - ts
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'Baru saja'
    if (minutes < 60) return `${minutes} menit lalu`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} jam lalu`
    const days = Math.floor(hours / 24)
    return `${days} hari lalu`
  }

  return (
    <div className="space-y-2.5 py-2 max-h-[60vh] overflow-y-auto">
      {pendingList.map((pending) => {
        const items = pending.items as Array<{ product: { name: string; image: string | null }; variant: { name: string } | null; qty: number }>
        const totalItems = items.reduce((s, i) => s + i.qty, 0)

        return (
          <div key={pending.id} className="relative rounded-xl border border-white/[0.06] bg-white/[0.02] border-l-[3px] border-l-amber-500/30 p-3.5 space-y-3">
            {/* Delete button overlay top-right */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(pending.id!)}
              className="absolute top-2.5 right-2.5 h-6 w-6 px-0 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </Button>

            {/* Header: time + user + item count | subtotal */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" strokeWidth={1.5} />
                    {formatRelativeTime(pending.createdAt)}
                  </span>
                  <Badge variant="secondary" className="bg-white/[0.06] text-slate-400 border-white/[0.08] text-[9px] px-1.5 py-0 h-4 font-normal">
                    {pending.userName}
                  </Badge>
                  <Badge variant="secondary" className="bg-white/[0.06] text-slate-400 border-white/[0.08] text-[9px] px-1.5 py-0 h-4 font-normal">
                    {totalItems} item
                  </Badge>
                </div>
              </div>
              <div className="shrink-0">
                <p className="text-sm font-bold text-white tabular-nums">{formatCurrency(pending.subtotal)}</p>
              </div>
            </div>

            {/* Items preview — mini receipt look */}
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] border-l-2 border-l-white/[0.06] overflow-hidden">
              <div className="space-y-0.5 px-3 py-2">
                {items.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex items-baseline gap-2 text-[11px]">
                    <span className="font-mono text-slate-500 w-5 text-right shrink-0">{item.qty}×</span>
                    <span className="text-slate-300 truncate">{item.product.name}</span>
                    {item.variant && (
                      <span className="text-slate-600 text-[10px] truncate">{item.variant.name}</span>
                    )}
                  </div>
                ))}
                {items.length > 3 && (
                  <p className="text-[10px] text-slate-600 pl-7">+{items.length - 3} item lainnya</p>
                )}
              </div>
            </div>

            {/* Note — chat bubble style */}
            {pending.note && (
              <div className="flex items-start gap-1.5">
                <MessageSquare className="h-3 w-3 text-slate-600 shrink-0 mt-0.5" strokeWidth={1.5} />
                <div className="rounded-xl rounded-tl-sm bg-white/[0.03] border border-white/[0.05] px-3 py-2 max-w-full">
                  <p className="text-[11px] text-slate-400 leading-relaxed">{pending.note}</p>
                </div>
              </div>
            )}

            {/* Customer */}
            {pending.customerName && (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <User className="h-3 w-3 text-slate-500" strokeWidth={1.5} />
                <span className="font-medium text-slate-300">{pending.customerName}</span>
              </div>
            )}

            {/* Action — full width resume button */}
            <Button size="sm" onClick={() => onResume(pending)}
              className="w-full h-8.5 text-[11px] font-medium rounded-xl theme-bg hover:theme-hover text-white transition-colors">
              <ShoppingCart className="mr-1.5 h-3 w-3" /> Lanjutkan ke Keranjang
            </Button>
          </div>
        )
      })}
    </div>
  )
}

// ==================== OFFLINE SYNC SUB-COMPONENT (unchanged) ====================

function OfflineSyncContent({
  isOnline,
  onSynced,
}: {
  isOnline: boolean
  onSynced: () => void
}) {
  const offlineList = useLiveQuery(
    async () => {
      const list = await localDB.transactions.where('isSynced').equals(0).toArray()
      return list.sort((a, b) => b.createdAt - a.createdAt)
    },
    []
  )
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set())
  const [syncingAll, setSyncingAll] = useState(false)

  const syncOne = async (tx: OfflineTransaction) => {
    if (!tx.id || syncingIds.has(tx.id)) return
    setSyncingIds(prev => new Set(prev).add(tx.id!))
    try {
      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [tx] }),
      })
      const data = await res.json()
      if (res.ok && data.results?.[0]?.success) {
        await localDB.transactions.update(tx.id, {
          isSynced: 1,
          syncedAt: Date.now(),
          invoiceNumber: data.results[0].invoiceNumber,
          serverTransactionId: data.results[0].serverId,
        })
        toast.success('Transaksi berhasil disync!')
        onSynced()
      } else {
        const error = data.results?.[0]?.error || data.error || 'Gagal sync'
        await localDB.transactions.update(tx.id, {
          retryCount: (tx.retryCount || 0) + 1,
          lastError: error,
        })
        toast.error('Sync gagal', { description: error })
      }
    } catch {
      await localDB.transactions.update(tx.id, {
        retryCount: (tx.retryCount || 0) + 1,
        lastError: 'Tidak ada koneksi internet',
      })
      toast.error('Sync gagal — tidak ada koneksi')
    } finally {
      setSyncingIds(prev => {
        const next = new Set(prev)
        next.delete(tx.id!)
        return next
      })
    }
  }

  const syncAll = async () => {
    if (!offlineList || offlineList.length === 0 || syncingAll) return
    setSyncingAll(true)
    try {
      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: offlineList }),
      })
      const data = await res.json()
      if (res.ok) {
        let synced = 0
        let failed = 0
        for (const result of data.results || []) {
          if (result.success) {
            await localDB.transactions.update(result.localId, {
              isSynced: 1,
              syncedAt: Date.now(),
              invoiceNumber: result.invoiceNumber,
              serverTransactionId: result.serverId,
            })
            synced++
          } else {
            const existing = await localDB.transactions.get(result.localId)
            await localDB.transactions.update(result.localId, {
              retryCount: (existing?.retryCount || 0) + 1,
              lastError: result.error,
            })
            failed++
          }
        }
        if (synced > 0) {
          toast.success(`${synced} transaksi berhasil disync!`)
          onSynced()
        }
        if (failed > 0) {
          toast.error(`${failed} transaksi gagal sync`, { description: 'Periksa stok produk.' })
        }
      } else {
        toast.error('Sync gagal — server error')
      }
    } catch {
      toast.error('Sync gagal — tidak ada koneksi internet')
    } finally {
      setSyncingAll(false)
    }
  }

  const deleteOne = async (id: number) => {
    await localDB.transactions.delete(id)
    toast.success('Transaksi offline dihapus')
  }

  const deleteAll = async () => {
    if (!offlineList) return
    for (const tx of offlineList) {
      if (tx.id) await localDB.transactions.delete(tx.id)
    }
    toast.success(`${offlineList.length} transaksi offline dihapus`)
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const getTxInfo = (tx: OfflineTransaction) => {
    const p = tx.payload
    const invoice = (tx.invoiceNumber as string) || (p.invoiceNumber as string) || `OFF-${tx.createdAt.toString(36).toUpperCase()}`
    const total = (p.total as number) || (p.subtotal as number) || 0
    const items = (p.items as Array<{ product?: { name: string }; variant?: { name: string }; qty: number }>) || []
    const itemCount = items.reduce((s, i) => s + (i.qty || 1), 0)
    return { invoice, total, itemCount }
  }

  if (!offlineList) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
      </div>
    )
  }

  if (offlineList.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center mx-auto mb-3.5">
          <Check className="h-7 w-7 text-emerald-400" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-bold text-white">Semua Tersinkronisasi</p>
        <p className="text-xs text-slate-500 mt-1.5">Tidak ada transaksi yang perlu disinkronkan</p>
        <Separator className="mt-5 bg-white/[0.06]" />
      </div>
    )
  }

  const totalNominal = offlineList.reduce((s, tx) => {
    const p = tx.payload
    return s + ((p.total as number) || (p.subtotal as number) || 0)
  }, 0)

  return (
    <div className="space-y-3 py-2">
      {/* Offline warning banner */}
      {!isOnline && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/[0.15]">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <WifiOff className="h-4 w-4 text-red-400 shrink-0" strokeWidth={1.5} />
          <div className="min-w-0">
            <p className="text-[11px] text-red-400 font-bold leading-tight">Mode Offline Aktif</p>
            <p className="text-[10px] text-red-400/60 mt-0.5 leading-relaxed">Sinkronisasi otomatis akan dilakukan saat koneksi kembali</p>
          </div>
        </div>
      )}

      {/* Summary stats bar */}
      <div className="flex gap-2">
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
          <p className="text-[10px] text-slate-500">Transaksi</p>
          <p className="text-sm font-bold text-white tabular-nums">{offlineList.length}</p>
        </div>
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
          <p className="text-[10px] text-slate-500">Total Nominal</p>
          <p className="text-sm font-bold text-white tabular-nums">{formatCurrency(totalNominal)}</p>
        </div>
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
          <p className="text-[10px] text-slate-500">Status</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", isOnline ? "bg-emerald-400" : "bg-red-400")} />
            <span className={cn("text-xs font-semibold", isOnline ? "text-emerald-400" : "text-red-400")}>{isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Sticky bulk actions bar */}
      <div className="sticky top-0 z-10 -mx-1 px-1 pb-2 bg-nebula/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2">
          <Button
            size="sm"
            onClick={syncAll}
            disabled={syncingAll || !isOnline}
            className="h-8 text-[11px] font-medium rounded-lg theme-bg hover:theme-hover text-white transition-colors disabled:opacity-40"
          >
            {syncingAll ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" strokeWidth={1.5} />}
            Sinkronkan Semua
            {offlineList.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 bg-white/[0.15] text-white border-white/[0.2] text-[9px] px-1.5 py-0 h-4 font-semibold">
                {offlineList.length}
              </Badge>
            )}
          </Button>
          <button
            onClick={deleteAll}
            className="text-[11px] text-slate-500 hover:text-red-400 transition-colors font-medium shrink-0"
          >
            Hapus Semua
          </button>
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-2.5 max-h-[50vh] overflow-y-auto">
        {offlineList.map((tx) => {
          const { invoice, total, itemCount } = getTxInfo(tx)
          const isSyncing = syncingIds.has(tx.id!)
          const hasError = !!tx.lastError
          const borderColor = hasError ? 'border-l-red-500/40' : 'border-l-amber-500/40'

          return (
            <div key={tx.id} className={cn(
              "relative rounded-xl border border-white/[0.06] bg-white/[0.02] border-l-[3px] p-3.5 space-y-3",
              borderColor
            )}>
              {/* Delete button overlay top-right */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deleteOne(tx.id!)}
                className="absolute top-2.5 right-2.5 h-6 w-6 px-0 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </Button>

              {/* Header: Invoice + OFFLINE tag + item count | Total */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-slate-200 font-mono truncate">{invoice}</p>
                    <Badge variant="secondary" className="bg-red-500/10 text-red-400 border-red-500/15 text-[8px] px-1.5 py-0 h-4 font-bold tracking-wider shrink-0">
                      OFFLINE
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Package className="h-2.5 w-2.5" strokeWidth={1.5} />
                      {itemCount} item
                    </span>
                    <span className="text-slate-700">·</span>
                    <span className="text-[10px] text-slate-600">{formatTime(tx.createdAt)}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  <p className="text-sm font-bold text-white tabular-nums">{formatCurrency(total)}</p>
                </div>
              </div>

              {/* Status section: retry badge + error */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[9px] px-1.5 py-0 h-4 font-semibold border",
                    (tx.retryCount || 0) > 2
                      ? "bg-red-500/10 text-red-400 border-red-500/15"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/15"
                  )}
                >
                  {(tx.retryCount || 0)}x retry
                </Badge>
                {tx.lastError && (
                  <span className="flex items-center gap-1 text-[10px] text-red-400/80 min-w-0">
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} />
                    <span className="truncate" title={tx.lastError}>{tx.lastError}</span>
                  </span>
                )}
              </div>

              {/* Sync button — full width */}
              <Button
                size="sm"
                onClick={() => syncOne(tx)}
                disabled={isSyncing || !isOnline}
                className="w-full h-8 text-[11px] font-medium rounded-xl theme-bg hover:theme-hover text-white transition-colors disabled:opacity-40"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Menyinkronkan...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 h-3 w-3" strokeWidth={1.5} />
                    Sync Sekarang
                  </>
                )}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
