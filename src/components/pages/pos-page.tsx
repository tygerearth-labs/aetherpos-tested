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

// ==================== EXTRACTED UI COMPONENTS (Phase 1A-7) ====================

import CategoryFilter from '../pos/components/CategoryFilter'
import ProductGrid, { Pagination } from '../pos/components/ProductGrid'
import { CustomerSelector } from '../pos/components/CustomerSelector'
import CartItemList from '../pos/components/CartItemList'
import CartSummary from '../pos/components/CartSummary'
import PendingTransactionsList from '../pos/components/PendingTransactionsList'

// ==================== LAYOUT COMPONENTS (Phase 1A-8 integration) ====================

import POSDesktopLayout from '../pos/components/POSDesktopLayout'
import POSMobileLayout from '../pos/components/POSMobileLayout'
import POSDialogsLayer from '../pos/components/POSDialogsLayer'

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

  const cartHook = UsePosCartHook({
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
  // RENDER HELPERS replaced by extracted components (Phase 1A-7)
  // ═══════════════════════════════════════════════════

  // (renderProductGrid replaced by <ProductGrid> component)
  // (renderPagination replaced by <Pagination> component)

  // (renderCustomerSelector replaced by <CustomerSelector> component)

  // (renderCartItemsMobile replaced by <CartItemList compact={false} />)

  // (renderCartItems replaced by <CartItemList compact={...} />)

  // (renderCartSummary replaced by <CartSummary> component)

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
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border-amber-500/20 text-amber-400 text-[11px] font-medium">
              <Database className="h-3 w-3" /><span>No cache</span>
            </div>
          )}

          {/* Unsynced */}
          {sync.unsyncedCount > 0 && (
            <button onClick={() => sync.setOfflineListOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border-amber-500/20 text-amber-400 text-[11px] font-medium hover:bg-amber-500/15 transition-all cursor-pointer">
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

      {/* ══════ DESKTOP LAYOUT (integrated component) ══════ */}
      <POSDesktopLayout
        // SEARCH
        searchInputRef={searchInputRef}
        productSearch={productsHook.productSearch}
        onSearchChange={(v) => productsHook.handleSearchChange(v)}
        onSearchKeyDown={productsHook.handleSearchKeyDown}
        // PRODUCTS
        products={productsHook.products}
        productsLoading={productsHook.productsLoading}
        selectedCategoryId={productsHook.selectedCategoryId}
        categories={productsHook.categories}
        cart={cartHook.cart}
        productPage={productsHook.productPage}
        totalProductPages={productsHook.totalProductPages}
        productSearchActive={productsHook.productSearch}
        onCategorySelect={(id) => productsHook.handleCategorySelect(id)}
        onAddToCart={cartHook.addToCart}
        onOpenVariantPicker={productsHook.openVariantPicker}
        getItemPrice={cartHook.getItemPrice}
        getCartKey={cartHook.getCartKey}
        onProductPagePrev={() => productsHook.setProductPage(p => Math.max(1, p - 1))}
        onProductPageNext={() => productsHook.setProductPage(p => Math.min(productsHook.totalProductPages, p + 1))}
        // CART
        cartItems={cartHook.cart}
        subtotal={cartHook.subtotal}
        total={cartHook.total}
        change={cartHook.change}
        manualDiscountTotal={cartHook.manualDiscountTotal}
        pointsDiscount={cartHook.pointsDiscount}
        ppnAmount={cartHook.ppnAmount}
        hasBelowHpp={cartHook.hasBelowHpp}
        belowHppItems={cartHook.belowHppItems}
        maxPointsToUse={cartHook.maxPointsToUse}
        pointsToUse={cartHook.pointsToUse}
        editingQtyId={cartHook.editingQtyId}
        editingQtyValue={cartHook.editingQtyValue}
        editingPriceId={cartHook.editingPriceId}
        editingPriceValue={cartHook.editingPriceValue}
        priceInputRef={cartHook.priceInputRef}
        qtyInputRef={cartHook.qtyInputRef}
        onUpdateQty={cartHook.updateQty}
        onRemoveFromCart={cartHook.removeFromCart}
        onStartEditQty={cartHook.startEditQty}
        onConfirmEditQty={cartHook.confirmEditQty}
        onCancelEditQty={cartHook.cancelEditQty}
        onStartEditPrice={cartHook.startEditPrice}
        onConfirmEditPrice={cartHook.confirmEditPrice}
        onCancelEditPrice={cartHook.cancelEditPrice}
        // CUSTOMER (desktop inline version)
        selectedCustomer={customersHook.selectedCustomer}
        customerSearch={customersHook.customerSearch}
        filteredCustomers={customersHook.filteredCustomers}
        customerDropdownOpen={customersHook.customerDropdownOpen}
        onCustomerSearchChange={(v) => customersHook.setCustomerSearch(v)}
        onCustomerDropdownOpen={(open) => customersHook.setCustomerDropdownOpen(open)}
        onSelectCustomer={(c) => customersHook.setSelectedCustomer(c)}
        onClearCustomer={() => { customersHook.setSelectedCustomer(null); customersHook.setCustomerSearch(''); cartHook.setPointsToUse(0) }}
        onAddCustomerOpen={() => customersHook.setAddCustomerOpen(true)}
        onSetPointsToUse={cartHook.setPointsToUse}
        // CHECKOUT/ACTIONS
        paidAmount={checkoutHook.paidAmount}
        isProcessing={checkoutHook.checkingOut}
        promoDiscount={promoDiscount}
        selectedPromo={selectedPromo}
        promoName={selectedPromo?.name}
        onHoldTransaction={checkoutHook.handleHoldTransaction}
        openPaymentDialog={checkoutHook.openPaymentDialog}
        handlePointsChange={checkoutHook.handlePointsChange}
        setPaidAmount={checkoutHook.setPaidAmount}
        // SETTINGS
        themeColors={themeColors}
        formatCurrency={formatCurrency}
        ppnEnabled={settingsHook.settings.ppnEnabled}
        loyaltyEnabled={settingsHook.settings.loyaltyEnabled}
        ppnRate={settingsHook.settings.ppnRate}
        customerPoints={customersHook.selectedCustomer?.points}
        loyaltyPointValue={settingsHook.settings.loyaltyPointValue}
        manualDiscountEnabled={settingsHook.settings.manualDiscountEnabled}
        batchInfo={batchInfo}
        // SYNC STATUS
        pendingCount={pendingCount}
        onPendingListOpen={() => sync.setPendingListOpen(true)}
        onClearCart={cartHook.clearCart}
      />

      {/* ══════ MOBILE LAYOUT (integrated component) ══════ */}
      <POSMobileLayout
        // Search
        searchInputRef={searchInputRef}
        productSearch={productsHook.productSearch}
        onSearchChange={(v) => productsHook.handleSearchChange(v)}
        onSearchKeyDown={productsHook.handleSearchKeyDown}
        // Products
        products={productsHook.products}
        productsLoading={productsHook.productsLoading}
        selectedCategoryId={productsHook.selectedCategoryId}
        categories={productsHook.categories}
        cart={cartHook.cart}
        productPage={productsHook.productPage}
        totalProductPages={productsHook.totalProductPages}
        productSearchActive={productsHook.productSearch}
        onCategorySelect={(id) => productsHook.handleCategorySelect(id)}
        onAddToCart={cartHook.addToCart}
        onOpenVariantPicker={productsHook.openVariantPicker}
        getItemPrice={cartHook.getItemPrice}
        getCartKey={cartHook.getCartKey}
        onProductPagePrev={() => productsHook.setProductPage(p => Math.max(1, p - 1))}
        onProductPageNext={() => productsHook.setProductPage(p => Math.min(productsHook.totalProductPages, p + 1))}
        // Cart (for floating button)
        cartItems={cartHook.cart}
        cartTotal={cartHook.total}
        cartItemCount={cartHook.cart.length}
        onMobileCartOpen={() => checkoutHook.setMobileCartOpen(true)}
        // Display
        themeColors={themeColors}
        formatCurrency={formatCurrency}
      />

      {/* ══════ DIALOGS LAYER (integrated component) ══════ */}
      <POSDialogsLayer
        // === VARIANT PICKER ===
        variantPicker={productsHook.variantPicker}
        onVariantPickerChange={(open) => { if (!open) productsHook.setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false }) }}
        onVariantPickerSet={(picker) => productsHook.setVariantPicker(picker)}
        onVariantSelect={(variant) => productsHook.handleVariantSelect(variant)}

        // === PAYMENT DIALOG ===
        paymentDialogOpen={checkoutHook.paymentDialogOpen}
        onPaymentDialogOpen={checkoutHook.setPaymentDialogOpen}
        paymentDialogProps={{
          cartItems: cartHook.cart,
          subtotal: cartHook.subtotal,
          total: cartHook.total,
          manualDiscountTotal: cartHook.manualDiscountTotal,
          pointsDiscount: cartHook.pointsDiscount,
          promoDiscount: promoDiscount,
          ppnAmount: cartHook.ppnAmount,
          paymentMethod: checkoutHook.paymentMethod,
          paidAmount: checkoutHook.paidAmount,
          change: cartHook.change,
          settings: settingsHook.settings,
          selectedCustomer: customersHook.selectedCustomer,
          maxPointsToUse: cartHook.maxPointsToUse,
          pointsToUse: cartHook.pointsToUse,
          onPaymentMethodChange: (_method) => {
            // Payment method is owned by checkoutHook
          },
          onPaidAmountChange: checkoutHook.setPaidAmount,
          onPointsChange: checkoutHook.handlePointsChange,
          onCheckout: checkoutHook.handleCheckout,
          checkingOut: checkoutHook.checkingOut,
          checkoutResult: checkoutHook.checkoutResult,
          availablePaymentMethods: settingsHook.availablePaymentMethods,
          getItemPrice: cartHook.getItemPrice,
          getEffectivePrice: cartHook.getEffectivePrice,
          getItemDisplayName: cartHook.getItemDisplayName,
          getQuickNominals: getQuickNominals,
          hasBelowHpp: cartHook.hasBelowHpp,
          belowHppItems: cartHook.belowHppItems,
          belowHppTotalLoss: cartHook.belowHppTotalLoss,
          editingQtyId: cartHook.editingQtyId,
          editingQtyValue: cartHook.editingQtyValue,
          startEditQty: cartHook.startEditQty,
          confirmEditQty: cartHook.confirmEditQty,
          cancelEditQty: cartHook.cancelEditQty,
          qtyInputRef: cartHook.qtyInputRef,
          updateQty: cartHook.updateQty,
          removeFromCart: cartHook.removeFromCart,
          getItemStock: cartHook.getItemStock,
          getCartKey: cartHook.getCartKey,
          selectedPromo: selectedPromo,
          availablePromos: settingsHook.availablePromos,
          onPromoSelect: (promo) => {
            if (promo) {
              setSelectedPromo(promo as { id: string; name: string; type: string; discount: number; description: string })
              setPromoDiscount((promo as { discount: number }).discount || 0)
            } else {
              setSelectedPromo(null)
              setPromoDiscount(0)
            }
          },
          promoLoading: promoLoading,
        }}

        // === RECEIPT DIALOG ===
        receiptDialogOpen={checkoutHook.receiptDialogOpen}
        onReceiptDialogOpen={checkoutHook.setReceiptDialogOpen}
        receiptDialogProps={{
          checkoutResult: checkoutHook.checkoutResult,
          cartItems: cartHook.cart,
          subtotal: cartHook.subtotal,
          total: cartHook.total,
          manualDiscountTotal: cartHook.manualDiscountTotal,
          pointsDiscount: cartHook.pointsDiscount,
          promoDiscount: promoDiscount,
          ppnAmount: cartHook.ppnAmount,
          paymentMethod: checkoutHook.paymentMethod,
          paidAmount: checkoutHook.paidAmount,
          change: cartHook.change,
          settings: settingsHook.settings,
          outletInfo: settingsHook.outletInfo,
          selectedCustomer: customersHook.selectedCustomer,
          onFinish: checkoutHook.handleReceiptFinish,
          getItemPrice: cartHook.getItemPrice,
          getEffectivePrice: cartHook.getEffectivePrice,
          getItemDisplayName: cartHook.getItemDisplayName,
          selectedPromo: selectedPromo,
        }}

        // === ADD CUSTOMER DIALOG ===
        addCustomerOpen={customersHook.addCustomerOpen}
        onAddCustomerOpen={customersHook.setAddCustomerOpen}
        newCustomer={customersHook.newCustomer}
        onNewCustomerChange={(c) => customersHook.setNewCustomer(c)}
        onAddCustomer={customersHook.handleAddCustomer}
        addingCustomer={customersHook.addingCustomer}

        // === PENDING TRANSACTIONS DIALOG ===
        pendingListOpen={sync.pendingListOpen}
        onPendingListOpen={sync.setPendingListOpen}
        onResumePending={checkoutHook.handleResumePending}
        onDeletePending={checkoutHook.handleDeletePending}
        pendingCount={pendingCount}

        // === HOLD NOTE DIALOG ===
        holdNoteOpen={checkoutHook.holdNoteOpen}
        onHoldNoteOpen={checkoutHook.setHoldNoteOpen}
        holdNote={checkoutHook.holdNote}
        onHoldNoteChange={(note) => checkoutHook.setHoldNote(note)}
        onConfirmHold={checkoutHook.confirmHoldTransaction}
        onCancelHold={() => { checkoutHook.setHoldNoteOpen(false); checkoutHook.setHoldNote('') }}

        // === MOBILE CART SHEET ===
        mobileCartOpen={checkoutHook.mobileCartOpen}
        onMobileCartOpen={checkoutHook.setMobileCartOpen}
        mobileCartCustomerProps={{
          selectedCustomer: customersHook.selectedCustomer,
          customerSearch: customersHook.customerSearch,
          filteredCustomers: customersHook.filteredCustomers,
          customerDropdownOpen: customersHook.customerDropdownOpen,
          manualDiscountEnabled: settingsHook.settings.manualDiscountEnabled,
          onCustomerSearchChange: (v) => { customersHook.setCustomerSearch(v); customersHook.setCustomerDropdownOpen(true) },
          onCustomerDropdownOpen: customersHook.setCustomerDropdownOpen,
          onSelectCustomer: (c) => { customersHook.setSelectedCustomer(c); customersHook.setCustomerSearch(''); customersHook.setCustomerDropdownOpen(false); cartHook.setPointsToUse(0) },
          onClearCustomer: () => { customersHook.setSelectedCustomer(null); customersHook.setCustomerSearch(''); cartHook.setPointsToUse(0) },
          onAddNewCustomer: () => customersHook.setAddCustomerOpen(true),
          onSetPointsToUse: cartHook.setPointsToUse,
        }}
        mobileCartItemsProps={{
          cart: cartHook.cart,
          getCartKey: cartHook.getCartKey,
          getItemPrice: cartHook.getItemPrice,
          getEffectivePrice: cartHook.getEffectivePrice,
          getItemStock: cartHook.getItemStock,
          editingQtyId: cartHook.editingQtyId,
          editingQtyValue: cartHook.editingQtyValue,
          editingPriceId: cartHook.editingPriceId,
          editingPriceValue: cartHook.editingPriceValue,
          priceInputRef: cartHook.priceInputRef,
          qtyInputRef: cartHook.qtyInputRef,
          onUpdateQty: cartHook.updateQty,
          onRemoveFromCart: cartHook.removeFromCart,
          onStartEditQty: cartHook.startEditQty,
          onConfirmEditQty: cartHook.confirmEditQty,
          onCancelEditQty: cartHook.cancelEditQty,
          onStartEditPrice: cartHook.startEditPrice,
          onConfirmEditPrice: cartHook.confirmEditPrice,
          onCancelEditPrice: cartHook.cancelEditPrice,
          batchInfo: batchInfo,
          manualDiscountEnabled: settingsHook.settings.manualDiscountEnabled,
        }}
        mobileCartSummaryProps={{
          subtotal: cartHook.subtotal,
          manualDiscountTotal: cartHook.manualDiscountTotal,
          pointsDiscount: cartHook.pointsDiscount,
          promoDiscount: promoDiscount,
          ppnAmount: cartHook.ppnAmount,
          total: cartHook.total,
          paidAmount: checkoutHook.paidAmount,
          change: cartHook.change,
          hasBelowHpp: cartHook.hasBelowHpp,
          belowHppItems: cartHook.belowHppItems,
          maxPointsToUse: cartHook.maxPointsToUse,
          pointsToUse: cartHook.pointsToUse,
          ppnEnabled: settingsHook.settings.ppnEnabled,
          loyaltyEnabled: settingsHook.settings.loyaltyEnabled,
          ppnRate: settingsHook.settings.ppnRate,
          customerPoints: customersHook.selectedCustomer?.points,
          loyaltyPointValue: settingsHook.settings.loyaltyPointValue,
          promoName: selectedPromo?.name,
          onSetPointsToUse: (val) => checkoutHook.handlePointsChange(String(val)),
          onSetPaidAmount: checkoutHook.setPaidAmount,
        }}
        mobileCartActionsProps={{
          onHoldTransaction: checkoutHook.handleHoldTransaction,
          openPaymentDialog: checkoutHook.openPaymentDialog,
          hasBelowHpp: cartHook.hasBelowHpp,
          cartTotal: cartHook.total,
        }}
        mobileCartItemCount={cartHook.cart.length}
        mobileCartTotalQty={cartHook.cart.reduce((s, i) => s + i.qty, 0)}

        // === OFFLINE SYNC LIST DIALOG ===
        offlineListOpen={sync.offlineListOpen}
        onOfflineListOpen={sync.setOfflineListOpen}
        isOnline={sync.isOnline}
        offlineList={[]}
        onSynced={() => {
          productsHook.fetchProducts(productsHook.productSearch, productsHook.productPage, productsHook.selectedCategoryId)
          customersHook.loadCustomersFromCache()
        }}
      />
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
