'use client'

/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect */

/**
 * pos-page.tsx — POS orchestrator (PR 2 + PR 3).
 *
 * Thin orchestrator that composes the 6 POS hooks and renders the UI:
 *   - usePosSettings  → settings, promos, payment methods
 *   - usePosSync      → online/offline, sync status, sync triggers
 *   - usePosProducts  → featured/search/lookup/variants (PR 2 on-demand)
 *   - usePosCustomers → customer search + offline add (PR 3 outbox)
 *   - usePosCart      → cart + shared calc engine (PR 3 service charge + rounding)
 *   - usePosCheckout  → checkout + transactionOutbox (PR 3 localTransactionId)
 *
 * V6 LAYOUT — Header + Products (75%) | Cart full-height (25%):
 *   - Left 75%: header (info strip + search + categories) + product grid (scrollable)
 *   - Right 25%: cart panel spanning full height (header + customer + items + summary + actions)
 *   - Product cards: prominent image area (h-16) + name/SKU + price/stock
 *   - White prices (hero via weight/contrast, NOT amber)
 *   - Soft amber for active states; solid amber reserved for Bayar/Proses Pembayaran ONLY
 *   - Quiet, dense, mature typography; thin borders; no glow/gradient
 *
 * @boundary COCKPIT only — no engine imports
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import { ReceiptDialog } from '@/components/pos/receipt-dialog'
import {
  Search, Plus, Minus, Trash2, ShoppingCart, ShoppingBag, Package, PackageSearch, Loader2, Check, X,
  User, UserPlus, Coins, Wifi, WifiOff, RefreshCw, CloudOff, Tag, AlertTriangle,
  ChevronLeft, ChevronRight, Pencil, History, Clock, Printer,
  LayoutGrid, Layers, Banknote, HandCoins, QrCode, CreditCard, ArrowLeftRight,
  ChevronDown, Store, Calendar, TrendingUp, ScanLine, Database, Eraser, Phone,
} from 'lucide-react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { usePageStore } from '@/hooks/use-page-store'
import { usePosSettings } from '@/components/pos/hooks/use-pos-settings'
import { usePosSync } from '@/components/pos/hooks/use-pos-sync'
import { usePosProducts } from '@/components/pos/hooks/use-pos-products'
import { usePosCustomers } from '@/components/pos/hooks/use-pos-customers'
import { usePosCart } from '@/components/pos/hooks/use-pos-cart'
import { usePosCheckout } from '@/components/pos/hooks/use-pos-checkout'
import type { CalcPromo } from '@/lib/pos/pos-calc'
import type { Product, ProductVariant, CartItem } from '@/components/pos/hooks/use-pos-products'
import type { Customer } from '@/components/pos/hooks/use-pos-customers'
import type { PendingTransactionRow, LastReceiptRow } from '@/lib/pos/pos-db'

export default function PosPage() {
  const isMobile = useIsMobile()
  const { currentPage } = usePageStore()
  const { data: session } = useSession()

  // ── Shared state (owned by orchestrator) ──
  const [selectedPromo, setSelectedPromo] = useState<{ id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null } | null>(null)
  const [pointsToUse, setPointsToUse] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>('CASH')
  const [paidAmount, setPaidAmount] = useState('')

  // ── Header info: live clock + today's transactions summary ──
  const [now, setNow] = useState(() => new Date())
  const [todaySummary, setTodaySummary] = useState<{ count: number; total: number } | null>(null)

  // ── Hooks ──
  const sync = usePosSync({
    onRefreshProducts: () => products.refreshProducts(),
    onRefreshCustomers: () => customers.loadCustomersFromCache(),
  })
  const isOnline = sync.isOnline

  const settings = usePosSettings({ isOnline, currentPage })
  const customers = usePosCustomers({ isOnline })

  const products = usePosProducts({
    isOnline,
    onAddToCart: (product, qty, variant) => cart.addToCart(product, qty, variant),
    onOpenVariantPicker: (product) => products.openVariantPicker(product),
    // Max 20 products per page on desktop (mobile uses compact 10)
    pageSize: isMobile ? 10 : 20,
  })

  const calcPromo: CalcPromo | null = selectedPromo
    ? { id: selectedPromo.id, type: selectedPromo.type, value: selectedPromo.value, minPurchase: selectedPromo.minPurchase, maxDiscount: selectedPromo.maxDiscount }
    : null

  const cart = usePosCart({
    loyaltyPointValue: settings.settings.loyaltyPointValue,
    ppnEnabled: settings.settings.ppnEnabled,
    ppnRate: settings.settings.ppnRate,
    selectedCustomer: customers.selectedCustomer,
    selectedPromo: calcPromo,
    pointsToUse,
  })

  const checkout = usePosCheckout({
    cart: cart.cart,
    calcResult: cart.getCalcResult(),
    isOnline,
    selectedCustomer: customers.selectedCustomer,
    availablePaymentMethods: settings.availablePaymentMethods,
    selectedPromo,
    pointsToUse,
    paymentMethod,
    paidAmount,
    onSetPaymentMethod: setPaymentMethod,
    onSetPaidAmount: setPaidAmount,
    onRefreshProducts: () => products.refreshProducts(),
    onRefreshCustomers: () => customers.loadCustomersFromCache(),
    onClearCart: () => cart.clearCart(),
    onSetPointsToUse: setPointsToUse,
    onSetSelectedCustomer: customers.setSelectedCustomer,
    onSetSelectedPromo: (p) => setSelectedPromo(p as typeof selectedPromo),
    onSetPromoDiscount: () => {},
    onRestoreCart: cart.restoreCart,
  })

  // Reset points/promo when cart clears
  useEffect(() => {
    if (cart.cart.length === 0) {
      setPointsToUse(0)
      setSelectedPromo(null)
    }
  }, [cart.cart.length])

  // ── Live clock (ticks every 30s — enough for minute display) ──
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(iv)
  }, [])

  // ── Fetch today's transactions summary (count + total) ──
  // Refreshes on mount, on online reconnect, and after each successful checkout.
  const fetchTodaySummary = useCallback(async () => {
    if (!sync.isOnline) return
    try {
      const tzOffset = -new Date().getTimezoneOffset()
      const res = await fetch(`/api/pos/today?tzOffset=${tzOffset}`)
      if (res.ok) {
        const data = await res.json()
        setTodaySummary({ count: data.count ?? 0, total: data.total ?? 0 })
      }
    } catch { /* silent — header is non-critical */ }
  }, [sync.isOnline])

  useEffect(() => { void fetchTodaySummary() }, [fetchTodaySummary])

  // Refresh today summary after a successful checkout (receipt shown)
  useEffect(() => {
    if (checkout.receiptDialogOpen && checkout.checkoutResult) {
      void fetchTodaySummary()
    }
  }, [checkout.receiptDialogOpen, checkout.checkoutResult, fetchTodaySummary])

  return (
    <div className="flex h-[100dvh] md:h-full bg-deep-space overflow-hidden">
      {/* ═══════════════════════════════════════════════════════════
          LAYOUT V6 — Header + Products (75%) | Cart full-height (25%)
          Left column: header (info+search+categories) + product grid
          Right column: cart panel spanning full height
          ═══════════════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
        {/* HEADER — V6 (3 rows, scoped to left 75%) */}
        <div className="sticky top-0 z-30 shrink-0 bg-nebula/95 backdrop-blur-xl border-b border-white/[0.05]">
          {/* Row 1 — Info strip (h-9, quiet) */}
          <PosInfoStrip
            outletName={settings.outletInfo?.name ?? settings.settings.receiptBusinessName}
            cashierName={session?.user?.name ?? null}
            now={now}
            todaySummary={todaySummary}
            isOnline={isOnline}
          />

          {/* Row 2 — search + product count + sync popover */}
          <div className="flex items-center gap-2 h-12 px-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
              <Input
                placeholder="Cari produk atau SKU…"
                value={products.productSearch}
                onChange={(e) => products.handleSearchChange(e.target.value)}
                onKeyDown={products.handleSearchKeyDown}
                className="pl-9 pr-9 h-9 bg-white/[0.03] border-white/[0.06] text-sm text-slate-100 placeholder:text-slate-500 rounded-lg focus-visible:border-cyan-400/30 focus-visible:bg-white/[0.05] transition-colors"
              />
              {products.productSearch ? (
                <button
                  type="button"
                  onClick={() => products.handleSearchChange('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-200 hover:bg-white/[0.08] transition-colors"
                  title="Bersihkan pencarian"
                  aria-label="Bersihkan pencarian"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : (
                <kbd className="hidden md:inline-flex absolute right-2.5 top-1/2 -translate-y-1/2 items-center gap-0.5 h-5 px-1.5 rounded bg-white/[0.04] border border-white/[0.05] text-[9px] font-medium text-slate-500 pointer-events-none">
                  <ScanLine className="h-2.5 w-2.5" /> Scan
                </kbd>
              )}
            </div>
            {/* Product count summary — quiet context */}
            {!products.productsLoading && (
              <div className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05] text-[10px] text-slate-400 shrink-0">
                <Package className="h-3 w-3 text-slate-500" />
                <span className="tabular-nums font-medium text-slate-300">{products.products.length}</span>
                <span className="text-slate-600">produk</span>
              </div>
            )}
            <SyncButton sync={sync} />
          </div>

          {/* Row 3 — segmented category chips */}
          <CategoryFilter
            categories={products.categories}
            selected={products.selectedCategoryId}
            onSelect={products.handleCategorySelect}
          />
        </div>

        {/* Offline banner */}
        {!isOnline && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm shrink-0">
            <CloudOff className="h-4 w-4 shrink-0" />
            <span>Mode Offline — transaksi tersimpan lokal dan akan disinkronkan saat online</span>
          </div>
        )}

        {/* Deleted product warnings */}
        {cart.deletedCartWarnings.length > 0 && (
          <div className="flex items-start gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-sm shrink-0">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Produk dalam keranjang tidak lagi tersedia:</p>
              <p className="text-xs">{cart.deletedCartWarnings.join(', ')}</p>
            </div>
          </div>
        )}

        {/* Product workspace — scrollable grid */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <ScrollArea className="flex-1 min-h-0">
            {products.productsLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : products.products.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
                <div className="h-10 w-10 rounded-md bg-white/[0.03] flex items-center justify-center">
                  <Package className="h-5 w-5 text-slate-600" />
                </div>
                <p className="text-sm">Tidak ada produk ditemukan</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 p-3 pb-40 md:pb-3">
                  {products.products.map((product) => (
                    <ProductCard key={product.id} product={product} onClick={() => handleProductClick(product)} />
                  ))}
                </div>
                <div className="px-3 py-3 flex items-center justify-center gap-2 text-[10px] text-slate-600">
                  <span className="h-px flex-1 max-w-12 bg-white/[0.04]" />
                  <Package className="h-3 w-3" />
                  <span className="tabular-nums">{products.products.length} produk ditampilkan</span>
                  <span className="h-px flex-1 max-w-12 bg-white/[0.04]" />
                </div>
              </>
            )}
          </ScrollArea>

          {/* Pagination */}
          {products.totalProductPages > 1 && (
            <div className="flex items-center justify-center gap-2 p-2 border-t border-white/[0.05] bg-nebula/40 shrink-0">
              <Button variant="outline" size="icon" className="h-8 w-8 bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300" onClick={() => products.setProductPage(Math.max(1, products.productPage - 1))} disabled={products.productPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-slate-400 tabular-nums min-w-16 text-center">{products.productPage} / {products.totalProductPages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8 bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300" onClick={() => products.setProductPage(Math.min(products.totalProductPages, products.productPage + 1))} disabled={products.productPage === products.totalProductPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ═══ RIGHT COLUMN — Cart full-height (25%, desktop only) ═══ */}
      {!isMobile && (
        <div className="w-1/4 min-w-[360px] max-w-[460px] border-l border-white/[0.05] flex flex-col bg-nebula shrink-0">
          <CartPanel
            cart={cart}
            customers={customers}
            settings={settings}
            selectedPromo={selectedPromo}
            onSelectPromo={setSelectedPromo}
            pointsToUse={pointsToUse}
            onPointsChange={(v) => setPointsToUse(Math.min(Number(v) || 0, cart.maxPointsToUse))}
            checkout={checkout}
            onCheckout={checkout.openPaymentDialog}
          />
        </div>
      )}

      {/* ── Mobile floating Bayar button (fixed, ABOVE bottom nav) ── */}
      {isMobile && cart.cart.length > 0 && (
        <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-3 right-3 z-50 flex justify-center pointer-events-none">
          <Button
            className="w-full max-w-md bg-amber-500 hover:bg-amber-400 text-white rounded-2xl h-14 font-semibold transition-all flex items-center justify-between px-5 shadow-[0_8px_24px_rgba(245,158,11,0.35)] hover:shadow-[0_10px_30px_rgba(245,158,11,0.45)] hover:-translate-y-0.5 pointer-events-auto"
            onClick={() => checkout.setMobileCartOpen(true)}
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" />
              <span className="text-sm">Bayar · {cart.cart.length} item</span>
            </span>
            <span className="text-base tabular-nums font-bold">{formatCurrency(cart.total)}</span>
            <ChevronRight className="h-4 w-4 opacity-80 shrink-0" />
          </Button>
        </div>
      )}

      {/* ── Mobile cart sheet ── */}
      {isMobile && (
        <ResponsiveDialog open={checkout.mobileCartOpen} onOpenChange={checkout.setMobileCartOpen}>
          <ResponsiveDialogContent className="h-[90vh] p-0">
            <CartPanel
              cart={cart}
              customers={customers}
              settings={settings}
              selectedPromo={selectedPromo}
              onSelectPromo={setSelectedPromo}
              pointsToUse={pointsToUse}
              onPointsChange={(v) => setPointsToUse(Math.min(Number(v) || 0, cart.maxPointsToUse))}
              checkout={checkout}
              onCheckout={checkout.openPaymentDialog}
              isMobile
            />
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

      {/* ═══════════════════════════════════════════════════════════
          VARIANT PICKER — compact operational rows, white prices
          ═══════════════════════════════════════════════════════════ */}
      <ResponsiveDialog open={products.variantPicker.open} onOpenChange={(o) => !o && products.setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-cyan-400" />
              Pilih Varian
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{products.variantPicker.product?.name}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {products.variantPicker.loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : (
            <div className="flex flex-col gap-2">
              {products.variantPicker.variants.map((v) => {
                const out = v.stock <= 0
                const lowStock = v.stock > 0 && v.stock <= 5
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={out}
                    onClick={() => products.handleVariantSelect(v)}
                    className={cn(
                      'flex items-center justify-between w-full text-left p-2.5 rounded-lg border transition-colors',
                      'border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.08]',
                      out && 'opacity-50 cursor-not-allowed hover:bg-white/[0.02] hover:border-white/[0.05]'
                    )}
                  >
                    <div className="flex flex-col min-w-0 gap-1">
                      <span className="text-sm font-medium text-slate-100 truncate">{v.name}</span>
                      <div className="flex items-center gap-2">
                        {v.sku && <span className="text-[10px] text-slate-500 font-mono">{v.sku}</span>}
                        <span className="inline-flex items-center gap-1 text-[10px]">
                          <span className={cn('h-1.5 w-1.5 rounded-full', out ? 'bg-red-400' : lowStock ? 'bg-orange-400' : 'bg-emerald-400')} />
                          <span className={out ? 'text-red-400' : 'text-slate-500'}>Stok {v.stock}</span>
                        </span>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-white tabular-nums shrink-0 ml-3">{formatCurrency(v.price)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Payment dialog ── */}
      <ResponsiveDialog open={checkout.paymentDialogOpen} onOpenChange={checkout.setPaymentDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Pembayaran</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <PaymentDialogBody
            total={cart.total}
            paymentMethod={checkout.paymentMethod}
            paidAmount={checkout.paidAmount}
            availableMethods={settings.availablePaymentMethods}
            onSetPaymentMethod={checkout.setPaymentMethod}
            onSetPaidAmount={checkout.setPaidAmount}
            checkingOut={checkout.checkingOut}
            onCheckout={checkout.handleCheckout}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── PR 4: Rich receipt dialog (thermal preview + print + double receipt + WhatsApp) ── */}
      <ReceiptDialog
        open={checkout.receiptDialogOpen}
        onOpenChange={(o) => { if (!o) checkout.handleReceiptFinish() }}
        cart={cart.cart}
        subtotal={cart.subtotal}
        pointsDiscount={cart.pointsDiscount}
        promoDiscount={cart.promoDiscount}
        manualDiscountTotal={cart.manualDiscountTotal}
        ppnAmount={cart.ppnAmount}
        total={cart.total}
        paymentMethod={checkout.paymentMethod}
        paidAmount={checkout.paidAmount}
        change={checkout.paymentMethod === 'CASH' ? Math.max(0, (Number(checkout.paidAmount) || 0) - cart.total) : 0}
        selectedCustomer={customers.selectedCustomer}
        selectedPromo={selectedPromo ? { id: selectedPromo.id, name: selectedPromo.name, type: selectedPromo.type, discount: cart.promoDiscount, description: '' } : null}
        checkoutResult={checkout.checkoutResult}
        settings={settings.settings}
        onFinish={checkout.handleReceiptFinish}
      />

      {/* ── PR 4: Hold note dialog ── */}
      <ResponsiveDialog open={checkout.holdNoteOpen} onOpenChange={checkout.setHoldNoteOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-400" />
              Tunda Transaksi
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Tambahkan catatan untuk transaksi yang ditunda (opsional).</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2 space-y-3">
            <Textarea
              placeholder="Catatan (mis. meja 5, customer nama…)"
              value={checkout.holdNote}
              onChange={(e) => checkout.setHoldNote(e.target.value)}
              rows={3}
              className="bg-white/[0.03] border-white/[0.06] text-slate-100 placeholder:text-slate-500 rounded-lg resize-none h-20"
            />
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.05]">
              <ShoppingCart className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <p className="text-xs text-slate-400">
                {cart.cart.length} item — <span className="text-slate-200 font-medium">{formatCurrency(cart.total)}</span> akan disimpan dan dapat dilanjutkan nanti.
              </p>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 rounded-lg h-10" onClick={() => checkout.setHoldNoteOpen(false)}>Batal</Button>
            <Button className="bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] text-slate-100 rounded-lg h-10" onClick={checkout.confirmHoldTransaction}>
              <History className="h-3.5 w-3.5 mr-2" />
              Tunda
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── PR 4: Pending transactions list drawer (Sheet, slides from right) ── */}
      <Sheet open={checkout.pendingListOpen} onOpenChange={checkout.setPendingListOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md bg-nebula border-white/[0.06] flex flex-col gap-0 p-0">
          <SheetHeader className="px-4 py-4 border-b border-white/[0.06]">
            <SheetTitle className="text-white flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400" />
              Transaksi Tertunda
              {checkout.pendingList.length > 0 && (
                <Badge variant="secondary" className="bg-white/[0.06] text-slate-300 text-xs rounded-md ml-1">{checkout.pendingList.length}</Badge>
              )}
            </SheetTitle>
            <SheetDescription className="text-slate-400">Pilih transaksi untuk dilanjutkan atau dihapus.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {checkout.pendingList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-slate-600">
                <Clock className="h-8 w-8 text-slate-600" />
                <p className="text-sm text-slate-500">Tidak ada transaksi tertunda</p>
              </div>
            ) : (
              checkout.pendingList.map((pending) => (
                <PendingRow
                  key={pending.id}
                  pending={pending}
                  onResume={() => checkout.handleResumePending(pending)}
                  onDelete={() => pending.id && checkout.handleDeletePending(pending.id)}
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── PR 4: Reprint receipt dialog ── */}
      {checkout.reprintData && (
        <ReceiptDialog
          open={checkout.reprintOpen}
          onOpenChange={checkout.setReprintOpen}
          cart={lastReceiptToCartItems(checkout.reprintData)}
          subtotal={checkout.reprintData.subtotal}
          pointsDiscount={checkout.reprintData.pointsDiscount}
          promoDiscount={checkout.reprintData.promoDiscount}
          manualDiscountTotal={checkout.reprintData.manualDiscountTotal}
          ppnAmount={checkout.reprintData.ppnAmount}
          total={checkout.reprintData.total}
          paymentMethod={checkout.reprintData.paymentMethod}
          paidAmount={checkout.reprintData.paidAmount}
          change={checkout.reprintData.change}
          selectedCustomer={checkout.reprintData.customer}
          selectedPromo={checkout.reprintData.promo ? { id: checkout.reprintData.promo.id, name: checkout.reprintData.promo.name, type: '', discount: checkout.reprintData.promoDiscount, description: '' } : null}
          checkoutResult={checkout.reprintData.checkoutResult}
          settings={settings.settings}
          onFinish={() => checkout.setReprintOpen(false)}
        />
      )}
    </div>
  )

  function handleProductClick(product: Product) {
    if (product.hasVariants) {
      products.openVariantPicker(product)
    } else if (product.stock > 0) {
      cart.addToCart(product)
      toast.success(`${product.name} ditambahkan`)
    } else {
      toast.error('Stok produk habis')
    }
  }
}

// ==================== POS INFO STRIP (Row 1 — outlet · cashier · date · today) ====================

function PosInfoStrip({ outletName, cashierName, now, todaySummary, isOnline }: {
  outletName: string | null
  cashierName: string | null
  now: Date
  todaySummary: { count: number; total: number } | null
  isOnline: boolean
}) {
  const dateStr = now.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' })
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  const todayTitle = todaySummary
    ? `Hari ini: ${todaySummary.count} tx · ${formatCurrency(todaySummary.total)}`
    : 'Hari ini: belum ada transaksi'
  return (
    <div className="flex items-center gap-2 sm:gap-2.5 h-9 px-3 border-b border-white/[0.04] bg-deep-space/40 text-[11px]">
      {/* Outlet name — primary identity with subtle accent (always visible) */}
      <div className="flex items-center gap-1.5 min-w-0 shrink-0">
        <span className="h-4 w-4 rounded-md bg-cyan-500/10 ring-1 ring-cyan-500/15 flex items-center justify-center shrink-0">
          <Store className="h-2.5 w-2.5 text-cyan-300" />
        </span>
        <span className="text-slate-100 font-semibold truncate max-w-[140px]" title={outletName ?? 'Outlet'}>
          {outletName ?? 'Outlet'}
        </span>
      </div>
      <span className="text-slate-700 hidden sm:inline">·</span>
      {/* Cashier name — icon-only popover on mobile, full on desktop */}
      <div className="flex items-center gap-1.5 min-w-0 shrink-0">
        {/* Mobile: tap icon → popover with cashier name */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="sm:hidden flex items-center text-slate-400 hover:text-slate-200 active:scale-95 transition"
              aria-label={`Kasir: ${cashierName ?? 'Kasir'}`}
            >
              <User className="h-3 w-3 text-slate-500" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-2.5 bg-nebula border-white/[0.08] text-slate-200" align="start">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-0.5">
              <User className="h-2.5 w-2.5" />
              <span>Kasir</span>
            </div>
            <p className="text-sm text-slate-100 font-medium truncate">{cashierName ?? 'Kasir'}</p>
          </PopoverContent>
        </Popover>
        {/* Desktop: icon + text */}
        <User className="h-3 w-3 text-slate-500 shrink-0 hidden sm:block" />
        <span className="text-slate-300 truncate max-w-[100px] hidden sm:inline" title={cashierName ?? 'Kasir'}>
          {cashierName ?? 'Kasir'}
        </span>
      </div>
      <span className="text-slate-700 hidden sm:inline">·</span>
      {/* Date & time — icon-only popover on mobile, full on desktop */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Mobile: tap icon → popover with date + time */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="sm:hidden flex items-center text-slate-400 hover:text-slate-200 active:scale-95 transition"
              aria-label={`Tanggal: ${dateStr} ${timeStr}`}
            >
              <Calendar className="h-3 w-3 text-slate-500" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2.5 bg-nebula border-white/[0.08] text-slate-200" align="center">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-0.5">
              <Calendar className="h-2.5 w-2.5" />
              <span>Tanggal & Waktu</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-slate-300">{dateStr}</span>
              <span className="text-sm text-slate-100 font-medium tabular-nums">{timeStr}</span>
            </div>
          </PopoverContent>
        </Popover>
        {/* Desktop: icon + text */}
        <Calendar className="h-3 w-3 text-slate-500 shrink-0 hidden sm:block" />
        <span className="text-slate-400 tabular-nums hidden sm:inline">{dateStr}</span>
        <span className="text-slate-100 tabular-nums font-medium hidden sm:inline">{timeStr}</span>
      </div>
      {/* Today's transactions — pill-style summary, right aligned */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {/* Mobile: tap icon → popover with today's count + total */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="sm:hidden flex items-center text-cyan-400/80 hover:text-cyan-300 active:scale-95 transition"
              aria-label={todayTitle}
            >
              <TrendingUp className="h-3 w-3 text-cyan-400/70" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2.5 bg-nebula border-white/[0.08] text-slate-200" align="end">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1">
              <TrendingUp className="h-2.5 w-2.5 text-cyan-400/70" />
              <span>Transaksi Hari Ini</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-slate-400">Jumlah</span>
              <span className="text-sm text-slate-100 font-medium tabular-nums">
                {todaySummary ? `${todaySummary.count} tx` : '— tx'}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-0.5">
              <span className="text-xs text-slate-400">Total</span>
              <span className="text-sm text-cyan-300 font-semibold tabular-nums">
                {todaySummary ? formatCurrency(todaySummary.total) : '—'}
              </span>
            </div>
          </PopoverContent>
        </Popover>
        {/* Desktop: pill-style summary with subtle accent bg */}
        <div className="hidden sm:flex items-center gap-1.5 h-6 px-2 rounded-full bg-cyan-500/[0.07] ring-1 ring-cyan-500/10" title={todayTitle}>
          <TrendingUp className="h-3 w-3 text-cyan-400/80 shrink-0" />
          {todaySummary ? (
            <>
              <span className="text-slate-300 tabular-nums font-medium">{todaySummary.count} tx</span>
              <span className="text-slate-700">·</span>
              <span className="text-cyan-300 tabular-nums font-semibold">{formatCurrency(todaySummary.total)}</span>
            </>
          ) : (
            <span className="text-slate-500 tabular-nums">Belum ada transaksi</span>
          )}
        </div>
        {/* Online/offline dot */}
        <span className={cn('h-1.5 w-1.5 rounded-full ml-0.5 shrink-0', isOnline ? 'bg-emerald-400' : 'bg-red-400')} title={isOnline ? 'Online' : 'Offline'} />
      </div>
    </div>
  )
}

// ==================== SYNC BUTTON (popover with rich offline context) ====================

function SyncButton({ sync }: { sync: ReturnType<typeof usePosSync> }) {
  // V4 color discipline: cyan=synced, blue-pulse=syncing, red=offline, amber=pending/failed/conflict
  const config = {
    synced:   { dot: 'bg-cyan-400',                label: 'Synced',  },
    syncing:  { dot: 'bg-blue-400 animate-pulse',  label: 'Sync…',   },
    offline:  { dot: 'bg-red-400',                 label: 'Offline', },
    failed:   { dot: 'bg-amber-400',               label: `${sync.unsyncedCount} pending`, },
    conflict: { dot: 'bg-amber-400',               label: 'Conflict', },
  }[sync.syncStatus]

  const lastSyncLabel = sync.lastSyncAt ? sync.timeAgo(sync.lastSyncAt) : null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 gap-1.5 rounded-md hover:bg-white/[0.06] text-slate-300 hover:text-slate-100 shrink-0 border border-white/[0.05]"
          title="Status sinkronisasi"
        >
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', config.dot)} />
          <span className="text-[10px] font-medium hidden sm:inline">{config.label}</span>
          <ChevronDown className="h-2.5 w-2.5 text-slate-500 hidden sm:inline" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 bg-nebula border-white/[0.08] text-slate-200" align="end">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">Status Sinkronisasi</span>
            <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium',
              sync.syncStatus === 'synced' && 'text-cyan-400',
              sync.syncStatus === 'syncing' && 'text-blue-400',
              sync.syncStatus === 'offline' && 'text-red-400',
              (sync.syncStatus === 'failed' || sync.syncStatus === 'conflict') && 'text-amber-400',
            )}>
              <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
              {config.label}
            </span>
          </div>
          <Separator className="bg-white/[0.05]" />
          {/* Local cache context */}
          <div className="flex items-center gap-2 text-[11px]">
            <Database className="h-3 w-3 text-slate-500 shrink-0" />
            <span className="text-slate-400">Produk lokal cache</span>
            <span className="ml-auto text-slate-200 tabular-nums font-medium">Aktif</span>
          </div>
          {/* Last sync */}
          <div className="flex items-center gap-2 text-[11px]">
            <RefreshCw className="h-3 w-3 text-slate-500 shrink-0" />
            <span className="text-slate-400">Terakhir sync</span>
            <span className="ml-auto text-slate-200 tabular-nums">
              {lastSyncLabel ?? 'Tidak Update'}
            </span>
          </div>
          {/* Pending count */}
          {sync.unsyncedCount > 0 && (
            <div className="flex items-center gap-2 text-[11px]">
              <CloudOff className="h-3 w-3 text-amber-400 shrink-0" />
              <span className="text-slate-400">Transaksi pending</span>
              <span className="ml-auto text-amber-300 tabular-nums font-medium">{sync.unsyncedCount}</span>
            </div>
          )}
          <Separator className="bg-white/[0.05]" />
          <Button
            size="sm"
            className="w-full h-7 text-xs rounded-md bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] text-slate-100"
            onClick={sync.handleSync}
            disabled={sync.syncing || !sync.isOnline}
          >
            {sync.syncing ? (
              <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Menyinkronkan…</>
            ) : (
              <><RefreshCw className="h-3 w-3 mr-1.5" /> Sinkronkan sekarang</>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ==================== CATEGORY FILTER (h-8 chips, dark chip + accent underline active) ====================

function CategoryFilter({ categories, selected, onSelect }: {
  categories: Array<{ id: string; name: string; color: string }>
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  // Drag-to-scroll: mouse drag moves the horizontal list (touch swipe is
  // native via overflow-x-auto). A movement threshold distinguishes drag
  // from click so chip selection isn't triggered after a drag.
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef({ isDown: false, startX: 0, scrollLeft: 0, moved: false })

  const onMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current
    if (!el) return
    drag.current = { isDown: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft, moved: false }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current.isDown) return
    const el = scrollRef.current
    if (!el) return
    e.preventDefault()
    const x = e.pageX - el.offsetLeft
    const walk = x - drag.current.startX
    if (Math.abs(walk) > 4) drag.current.moved = true
    el.scrollLeft = drag.current.scrollLeft - walk
  }
  const onMouseUp = () => { drag.current.isDown = false }
  const handleSelect = (id: string | null) => {
    if (drag.current.moved) { drag.current.moved = false; return }
    onSelect(id)
  }

  return (
    <div
      ref={scrollRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      className="flex items-center gap-1 h-10 px-3 overflow-x-auto border-t border-white/[0.05] bg-deep-space/30 scrollbar-hide cursor-grab active:cursor-grabbing select-none"
    >
      <button
        type="button"
        onClick={() => handleSelect(null)}
        className={cn(
          'relative inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium shrink-0 transition-colors',
          selected === null
            ? 'bg-white/[0.08] text-slate-100'
            : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.04]'
        )}
      >
        <LayoutGrid className="h-3 w-3" />
        Semua
        {selected === null && (
          <span className="absolute -bottom-px left-2 right-2 h-px bg-cyan-400/70 rounded-full" />
        )}
      </button>
      {categories.map((c) => {
        const isActive = selected === c.id
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => handleSelect(c.id)}
            className={cn(
              'relative inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium shrink-0 transition-colors',
              isActive
                ? 'bg-white/[0.08] text-slate-100'
                : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.04]'
            )}
          >
            <span
              className="h-[3px] w-[3px] rounded-full shrink-0"
              style={{ backgroundColor: c.color || '#64748b' }}
            />
            {c.name}
            {isActive && (
              <span className="absolute -bottom-px left-2 right-2 h-px bg-cyan-400/70 rounded-full" />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ==================== PRODUCT CARD (vertical mini-card, ~116px — refined V4) ====================

function ProductCard({ product, onClick }: { product: Product; onClick: () => void }) {
  const outOfStock = !product.hasVariants && product.stock <= 0
  const lowStock = !product.hasVariants && product.stock > 0 && product.stock <= 5

  // Stock state — explicit color: emerald=safe, amber=low, red=empty
  const stockState = product.hasVariants
    ? null
    : outOfStock
      ? { label: 'Stok habis', color: 'text-red-400', dot: 'bg-red-400' }
      : lowStock
        ? { label: `Stok ${product.stock}`, color: 'text-amber-400', dot: 'bg-amber-400' }
        : { label: `Stok ${product.stock}`, color: 'text-emerald-400/80', dot: 'bg-emerald-400/70' }

  return (
    <button
      onClick={onClick}
      disabled={outOfStock}
      className={cn(
        'group flex flex-col gap-1 p-2 rounded-lg border text-left transition-all w-full',
        'border-white/[0.05] bg-white/[0.02]',
        'hover:bg-white/[0.05] hover:border-white/[0.1] hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.25)]',
        'focus-visible:outline-none focus-visible:border-cyan-400/40 focus-visible:bg-white/[0.05]',
        outOfStock && 'opacity-45 cursor-not-allowed hover:bg-white/[0.02] hover:border-white/[0.05] hover:translate-y-0 hover:shadow-none'
      )}
    >
      {/* Image area — 1:1 square (aspect-square), full-width */}
      <div className="aspect-square w-full rounded-md overflow-hidden bg-white/[0.03] flex items-center justify-center ring-1 ring-white/[0.04] relative shrink-0">
        {product.image ? (
          <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-white/[0.06] to-white/[0.01] flex items-center justify-center">
            <PackageSearch className="h-7 w-7 text-slate-500" />
          </div>
        )}
        {/* Variant badge — overlaid top-right on image */}
        {product.hasVariants && (
          <span className="absolute top-1 right-1 inline-flex items-center gap-0.5 text-[9px] font-medium text-cyan-300 bg-cyan-500/15 backdrop-blur-sm px-1.5 py-0.5 rounded-md ring-1 ring-cyan-500/20">
            <Layers className="h-2.5 w-2.5" />
            {product._variantCount} Varian
          </span>
        )}
      </div>

      {/* Name + SKU — tight, no extra space */}
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-100 line-clamp-1 leading-tight" title={product.name}>
          {product.name}
        </p>
        {product.sku && (
          <p className="text-[9px] text-slate-500 font-mono truncate leading-tight mt-px" title={product.sku}>
            {product.sku}
          </p>
        )}
      </div>

      {/* Price + stock — bottom row, tight */}
      <div className="flex items-end justify-between gap-1 shrink-0">
        {product.hasVariants ? (
          <span className="text-[10px] text-slate-400 italic">Pilih varian</span>
        ) : (
          <span className="text-sm font-bold text-white tabular-nums leading-tight">
            {formatCurrency(product.price)}
          </span>
        )}
        {stockState && (
          <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium shrink-0 tabular-nums', stockState.color)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', stockState.dot)} />
            {stockState.label}
          </span>
        )}
      </div>
    </button>
  )
}

// ==================== CART PANEL (25% full-height, 5 sections incl. cart header) ====================

function CartPanel({ cart, customers, settings, selectedPromo, onSelectPromo, pointsToUse, onPointsChange, checkout, onCheckout, isMobile }: {
  cart: ReturnType<typeof usePosCart>
  customers: ReturnType<typeof usePosCustomers>
  settings: ReturnType<typeof usePosSettings>
  selectedPromo: { id: string; name: string; type: string; value: number } | null
  onSelectPromo: (p: { id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null } | null) => void
  pointsToUse: number
  onPointsChange: (v: string) => void
  checkout: ReturnType<typeof usePosCheckout>
  onCheckout: () => void
  isMobile?: boolean
}) {
  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-nebula to-deep-space/60">
      {/* ── Section 1: Cart header — gradient surface, icon tile + title + count + actions ── */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-white/[0.05] shrink-0 bg-gradient-to-r from-white/[0.03] to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 ring-1 ring-cyan-500/20 flex items-center justify-center shrink-0 shadow-sm">
            <ShoppingBag className="h-4 w-4 text-cyan-300" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-bold text-slate-100">Keranjang</span>
            {cart.cart.length > 0 && (
              <span className="bg-cyan-500/15 text-cyan-300 text-[10px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums ring-1 ring-cyan-500/20">{cart.cart.length}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Bersihkan — clear all cart items (only when cart has items) */}
          {cart.cart.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 gap-1 rounded-md hover:bg-red-500/10 text-slate-500 hover:text-red-400 text-[10px] font-medium"
                  title="Bersihkan keranjang"
                >
                  <Eraser className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Bersihkan</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-nebula border-white/[0.08]">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-slate-100">
                    <span className="h-7 w-7 rounded-md bg-red-500/15 ring-1 ring-red-500/20 flex items-center justify-center">
                      <Eraser className="h-3.5 w-3.5 text-red-400" />
                    </span>
                    Bersihkan Keranjang?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-slate-400">
                    Semua <span className="text-slate-200 font-medium">{cart.cart.length} item</span> di keranjang akan dihapus. Tindakan ini tidak dapat dibatalkan.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 rounded-lg h-9">Batal</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-500 hover:bg-red-400 text-white rounded-lg h-9 font-medium"
                    onClick={() => { cart.clearCart(); toast.success('Keranjang dibersihkan') }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Bersihkan
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {/* Pending list (Clock) — opens pending transactions drawer */}
          <Button
            variant="ghost"
            size="icon"
            className="relative h-7 w-7 rounded-md hover:bg-white/[0.06] text-slate-500 hover:text-slate-200"
            onClick={() => checkout.setPendingListOpen(true)}
            title="Transaksi tertunda"
          >
            <Clock className="h-3.5 w-3.5" />
            {checkout.pendingCount > 0 && (
              <Badge variant="secondary" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] justify-center bg-amber-500 text-white border border-nebula">{checkout.pendingCount}</Badge>
            )}
          </Button>
          {/* Reprint (Printer) — cetak ulang struk */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md hover:bg-white/[0.06] text-slate-500 hover:text-slate-200"
            onClick={checkout.handleReprint}
            title="Cetak ulang struk"
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Section 2: Customer (compact, p-2.5, border-b) ── */}
      <CustomerSelector customers={customers} />

      {/* ── Section 3: Items (flex-1, scroll) — card-based, not flat list ── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2.5 py-2.5 space-y-2">
          {cart.cart.length === 0 ? (
            /* V4 — purposeful empty cart state */
            <div className="flex flex-col items-center justify-center py-10 px-3 gap-3 text-center">
              <div className="h-12 w-12 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                <ShoppingCart className="h-5 w-5 text-slate-500" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-200">Keranjang kosong</p>
                <p className="text-[11px] text-slate-500 leading-relaxed max-w-[220px]">
                  Scan barcode atau pilih produk dari katalog di sebelah kiri
                </p>
              </div>
              {/* Quick actions — purposeful, not passive */}
              <div className="flex flex-col gap-1.5 w-full max-w-[240px] mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs rounded-md bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.06] text-slate-300 justify-center"
                  onClick={() => checkout.setPendingListOpen(true)}
                >
                  <Clock className="h-3.5 w-3.5 mr-1.5" />
                  Lihat Pesanan Tertunda
                  {checkout.pendingCount > 0 && (
                    <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 px-1 text-[9px] justify-center bg-amber-500/20 text-amber-300 border border-amber-500/20">{checkout.pendingCount}</Badge>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs rounded-md bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.06] text-slate-300 justify-center"
                  onClick={() => customers.setAddCustomerOpen(true)}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                  Tambah Customer
                </Button>
              </div>
              {/* Shortcut hint */}
              <div className="flex items-center gap-1.5 mt-2 text-[10px] text-slate-600">
                <ScanLine className="h-3 w-3" />
                <span>Tip: gunakan kolom pencarian untuk scan barcode</span>
              </div>
            </div>
          ) : (
            cart.cart.map((item) => (
              <CartItemRow key={cart.getCartKey(item.product.id, item.variant?.id || null)} item={item} cart={cart} manualDiscountEnabled={settings.settings.manualDiscountEnabled} />
            ))
          )}
        </div>
      </ScrollArea>

      {/* ── Section 4: Discount / Promo — elevated inner card ── */}
      <div className="border-t border-white/[0.05] px-2.5 pt-2.5 pb-2 shrink-0">
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2 space-y-2">
          <PromoSelector
            promos={settings.availablePromos}
            selected={selectedPromo}
            onSelect={onSelectPromo}
            subtotal={cart.subtotal}
          />

          {customers.selectedCustomer && settings.settings.loyaltyEnabled && (
            <div className="flex items-center gap-2 pt-1.5 border-t border-white/[0.04]">
              <span className="h-6 w-6 rounded-md bg-amber-500/10 ring-1 ring-amber-500/15 flex items-center justify-center shrink-0">
                <Coins className="h-3 w-3 text-amber-400" />
              </span>
              <Label className="text-[10px] text-slate-400 shrink-0 uppercase tracking-wide">Points ({customers.selectedCustomer.points})</Label>
              <Input type="number" value={pointsToUse} onChange={(e) => onPointsChange(e.target.value)} className="h-7 flex-1 text-xs bg-white/[0.04] border-white/[0.06] text-white rounded-md min-w-0 tabular-nums" max={cart.maxPointsToUse} />
              <span className="text-xs text-amber-300 shrink-0 tabular-nums font-medium">-{formatCurrency(cart.pointsDiscount)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 5: Summary + Action — receipt-style elevated card with accent total ── */}
      <div className="border-t border-white/[0.05] p-2.5 shrink-0">
        {/* Summary card — elevated surface */}
        <div className="rounded-xl bg-gradient-to-b from-white/[0.04] to-white/[0.02] border border-white/[0.06] p-2.5 space-y-1 text-xs shadow-md">
          {/* Subtotal row */}
          <div className="flex justify-between">
            <span className="text-slate-400">Subtotal</span>
            <span className="text-slate-200 tabular-nums">{formatCurrency(cart.subtotal)}</span>
          </div>
          {cart.manualDiscountTotal > 0 && (
            <div className="flex justify-between text-amber-300">
              <span className="flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-amber-400" />
                Diskon Manual
              </span>
              <span className="tabular-nums">-{formatCurrency(cart.manualDiscountTotal)}</span>
            </div>
          )}
          {cart.pointsDiscount > 0 && (
            <div className="flex justify-between text-amber-300">
              <span className="flex items-center gap-1">
                <Coins className="h-2.5 w-2.5" />
                Points
              </span>
              <span className="tabular-nums">-{formatCurrency(cart.pointsDiscount)}</span>
            </div>
          )}
          {selectedPromo && cart.promoDiscount > 0 && (
            <div className="flex justify-between text-amber-300">
              <span className="flex items-center gap-1">
                <Tag className="h-2.5 w-2.5" />
                {selectedPromo.name}
              </span>
              <span className="tabular-nums">-{formatCurrency(cart.promoDiscount)}</span>
            </div>
          )}
          {cart.ppnAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-400">Pajak ({settings.settings.ppnRate}%)</span>
              <span className="text-slate-200 tabular-nums">{formatCurrency(cart.ppnAmount)}</span>
            </div>
          )}

          {/* Total row — accent stripe + bold */}
          <div className="flex justify-between items-baseline mt-2 pt-2 border-t border-white/[0.06]">
            <span className="text-sm font-bold text-slate-100">Total</span>
            <span className="text-lg font-bold text-white tabular-nums tracking-tight">{formatCurrency(cart.total)}</span>
          </div>
        </div>

        {/* Action row — Tunda (secondary) + Bayar (dominant solid amber, 3 explicit states) */}
        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            className="flex-1 h-10 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-slate-300 text-xs font-medium shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={cart.cart.length === 0}
            onClick={checkout.handleHoldTransaction}
          >
            <History className="h-3.5 w-3.5 mr-1.5" />
            Tunda
          </Button>
          <Button
            className={cn(
              'flex-[2] h-10 rounded-lg font-semibold text-sm shrink-0 transition-all',
              // State 1: DISABLED (cart empty / below HPP) → muted, no amber
              (cart.cart.length === 0 || cart.hasBelowHpp) &&
                'bg-white/[0.06] hover:bg-white/[0.06] text-slate-500 cursor-not-allowed shadow-none',
              // State 2: READY → solid amber, subtle shadow + hover glow
              cart.cart.length > 0 && !cart.hasBelowHpp && !checkout.checkingOut &&
                'bg-amber-500 hover:bg-amber-400 text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] hover:shadow-[0_2px_12px_rgba(245,158,11,0.35)] hover:-translate-y-px',
              // State 3: PROCESSING → darker amber, spinner, no hover transform
              checkout.checkingOut &&
                'bg-amber-600 hover:bg-amber-600 text-white cursor-wait shadow-[0_1px_2px_rgba(0,0,0,0.3)]',
            )}
            disabled={cart.cart.length === 0 || cart.hasBelowHpp || checkout.checkingOut}
            onClick={onCheckout}
          >
            {checkout.checkingOut ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Memproses…
              </>
            ) : cart.hasBelowHpp ? (
              <>
                <AlertTriangle className="h-4 w-4 mr-2" />
                Harga di bawah HPP
              </>
            ) : (
              <>
                Bayar · <span className="tabular-nums ml-1">{formatCurrency(cart.total)}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ==================== CART ITEM ROW (card with thumbnail + depth, not flat) ====================

function CartItemRow({ item, cart, manualDiscountEnabled }: { item: CartItem; cart: ReturnType<typeof usePosCart>; manualDiscountEnabled: boolean }) {
  const key = cart.getCartKey(item.product.id, item.variant?.id || null)
  const isEditingQty = cart.editingQtyId === item.product.id
  const isEditingPrice = cart.editingPriceId === key
  const price = item.variant ? item.variant.price : item.product.price
  const effPrice = item.customPrice != null ? item.customPrice : price
  const stock = cart.getItemStock(item)
  const hasCustomPrice = item.customPrice != null && item.customPrice < price
  const lineTotal = effPrice * item.qty

  return (
    <div
      className={cn(
        'group relative flex gap-2.5 p-2 rounded-lg border transition-all',
        'bg-white/[0.025] border-white/[0.05] shadow-sm',
        'hover:bg-white/[0.04] hover:border-white/[0.1] hover:shadow-md hover:-translate-y-px',
        hasCustomPrice && 'border-amber-500/20 bg-amber-500/[0.03] hover:border-amber-500/30 hover:bg-amber-500/[0.05]'
      )}
    >
      {/* Custom price accent stripe — left edge when discount applied */}
      {hasCustomPrice && (
        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-amber-400/80" title="Harga custom" />
      )}

      {/* Thumbnail — product image or icon fallback, 1:1 square */}
      <div className="h-11 w-11 rounded-md overflow-hidden bg-white/[0.03] ring-1 ring-white/[0.05] flex items-center justify-center shrink-0">
        {item.product.image ? (
          <img src={item.product.image} alt={item.product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-white/[0.06] to-white/[0.01] flex items-center justify-center">
            <PackageSearch className="h-4 w-4 text-slate-500" />
          </div>
        )}
      </div>

      {/* Content — name/total row + details/controls row */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {/* Row 1 — product name (left) + line total (right) */}
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold text-slate-100 truncate leading-tight min-w-0" title={cart.getItemDisplayName(item)}>
            {cart.getItemDisplayName(item)}
          </p>
          <span className="text-xs font-bold text-white tabular-nums leading-tight shrink-0">
            {formatCurrency(lineTotal)}
          </span>
        </div>

        {/* Row 2 — variant + price/pc (left) + qty stepper + delete (right) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {item.variant && (
              <>
                <span className="text-[10px] text-slate-500 truncate max-w-[70px]" title={item.variant.name}>{item.variant.name}</span>
                <span className="text-slate-700 text-[10px] shrink-0">·</span>
              </>
            )}
            {/* SETTINGS CONTRACT: price-edit gated by outlet setting `manualDiscountEnabled`.
                When disabled, the per-item manual discount (customPrice) cannot be started.
                An in-progress edit (isEditingPrice) is still rendered so it can be confirmed/cancelled cleanly. */}
            {isEditingPrice ? (
              <Input
                ref={cart.priceInputRef}
                type="number"
                value={cart.editingPriceValue}
                onChange={(e) => cart.setEditingPriceValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') cart.confirmEditPrice(); if (e.key === 'Escape') cart.cancelEditPrice() }}
                onBlur={cart.confirmEditPrice}
                className="h-5 w-20 text-[10px] bg-white/[0.04] border-white/[0.06] text-white rounded px-1"
              />
            ) : manualDiscountEnabled ? (
              <button
                onClick={() => cart.startEditPrice(key, effPrice)}
                className={cn(
                  'inline-flex items-center gap-0.5 text-[10px] transition-colors hover:text-slate-200',
                  hasCustomPrice ? 'text-amber-400 font-medium' : 'text-slate-500'
                )}
                title="Edit harga"
              >
                {formatCurrency(effPrice)}/pc
                {hasCustomPrice && <span className="text-[9px] leading-none">●</span>}
                <Pencil className="h-2.5 w-2.5 opacity-40" />
              </button>
            ) : (
              <span className={cn('text-[10px]', hasCustomPrice ? 'text-amber-400 font-medium' : 'text-slate-500')} title="Diskon manual dinonaktifkan di Pengaturan">
                {formatCurrency(effPrice)}/pc
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Qty stepper [− h-5] N [+ h-5] */}
            {isEditingQty ? (
              <Input
                ref={cart.qtyInputRef}
                type="number"
                value={cart.editingQtyValue}
                onChange={(e) => cart.setEditingQtyValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') cart.confirmEditQty(); if (e.key === 'Escape') cart.cancelEditQty() }}
                onBlur={cart.confirmEditQty}
                className="h-5 w-12 text-xs bg-white/[0.04] border-white/[0.06] text-white rounded-md text-center"
              />
            ) : (
              <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-md p-0.5 ring-1 ring-white/[0.04]">
                <button
                  type="button"
                  onClick={() => cart.updateQty(item.product.id, Math.max(1, item.qty - 1), item.variant?.id || undefined)}
                  disabled={item.qty <= 1}
                  className="h-4 w-4 rounded-sm bg-white/[0.06] hover:bg-white/[0.14] text-slate-300 hover:text-white flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Kurangi"
                >
                  <Minus className="h-2.5 w-2.5" />
                </button>
                <button
                  onClick={() => cart.startEditQty(item.product.id, item.qty)}
                  className="text-[11px] font-bold text-white w-5 text-center tabular-nums hover:text-cyan-400 transition-colors rounded-sm"
                  title="Edit qty"
                >
                  {item.qty}
                </button>
                <button
                  type="button"
                  onClick={() => cart.updateQty(item.product.id, Math.min(stock, item.qty + 1), item.variant?.id || undefined)}
                  disabled={item.qty >= stock}
                  className="h-4 w-4 rounded-sm bg-white/[0.06] hover:bg-white/[0.14] text-slate-300 hover:text-white flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Tambah"
                >
                  <Plus className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
            {/* Delete — subtle by default, prominent on hover */}
            <button
              onClick={() => cart.removeFromCart(item.product.id, item.variant?.id || undefined)}
              className="h-5 w-5 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Hapus item"
              aria-label={`Hapus ${cart.getItemDisplayName(item)}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== CUSTOMER SELECTOR (detailed card with avatar, whatsapp, points) ====================

function CustomerSelector({ customers }: { customers: ReturnType<typeof usePosCustomers> }) {
  return (
    <div className="p-2.5 border-b border-white/[0.05] shrink-0">
      {customers.selectedCustomer ? (
        /* Selected customer card — detailed view with avatar, name, whatsapp, points */
        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
          <div className="flex items-center gap-2 min-w-0">
            {/* Avatar with initial — primary identity */}
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 ring-1 ring-cyan-500/20 flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-cyan-200">
                {customers.selectedCustomer.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-xs font-semibold text-white truncate leading-tight">{customers.selectedCustomer.name}</p>
                {customers.selectedCustomer.isLocal && (
                  <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 bg-amber-500/10 border-amber-500/20 text-amber-300 shrink-0">Offline</Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                {customers.selectedCustomer.whatsapp ? (
                  <span className="flex items-center gap-0.5 truncate tabular-nums" title={customers.selectedCustomer.whatsapp}>
                    <Phone className="h-2.5 w-2.5 shrink-0" />
                    {customers.selectedCustomer.whatsapp}
                  </span>
                ) : (
                  <span className="text-slate-600 italic">Tanpa kontak</span>
                )}
                <span className="text-slate-700 shrink-0">·</span>
                <span className="flex items-center gap-0.5 shrink-0 tabular-nums" title="Loyalty points">
                  <Coins className="h-2.5 w-2.5 text-amber-400/80" />
                  <span className="text-amber-300 font-medium">{customers.selectedCustomer.points}</span>
                </span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0" onClick={() => customers.setSelectedCustomer(null)} title="Hapus pelanggan">
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        /* No customer — search + add button */
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500 pointer-events-none" />
            <Input
              placeholder="Cari pelanggan…"
              value={customers.customerSearch}
              onChange={(e) => { customers.setCustomerSearch(e.target.value); customers.setCustomerDropdownOpen(true) }}
              className="h-8 pl-8 text-xs bg-white/[0.03] border-white/[0.06] text-white placeholder:text-slate-500 rounded-md focus-visible:border-cyan-400/30"
            />
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8 bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 hover:text-cyan-300 shrink-0" onClick={() => customers.setAddCustomerOpen(true)} title="Tambah pelanggan">
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      {/* Customer dropdown list — detailed rows with avatar, name, contact, points */}
      {customers.customerDropdownOpen && !customers.selectedCustomer && customers.filteredCustomers.length > 0 && (
        <div className="mt-1.5 border border-white/[0.06] rounded-md max-h-56 overflow-y-auto bg-nebula shadow-lg">
          {customers.filteredCustomers.slice(0, 8).map((c) => (
            <button
              key={c.id}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/[0.06] text-left first:rounded-t-md last:rounded-b-md transition-colors"
              onClick={() => { customers.setSelectedCustomer(c); customers.setCustomerDropdownOpen(false); customers.setCustomerSearch('') }}
            >
              {/* Mini avatar with initial */}
              <div className="h-6 w-6 rounded-full bg-white/[0.05] ring-1 ring-white/[0.06] flex items-center justify-center shrink-0">
                <span className="text-[10px] font-semibold text-slate-300">{c.name.charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-100 truncate leading-tight">{c.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500">
                  {c.whatsapp ? (
                    <span className="tabular-nums truncate">{c.whatsapp}</span>
                  ) : (
                    <span className="text-slate-600 italic">Tanpa kontak</span>
                  )}
                  <span className="text-slate-700 shrink-0">·</span>
                  <span className="flex items-center gap-0.5 shrink-0 tabular-nums">
                    <Coins className="h-2 w-2 text-amber-400/70" />
                    {c.points}
                  </span>
                </div>
              </div>
              {c.isLocal && <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 bg-amber-500/10 border-amber-500/20 text-amber-300 shrink-0">Offline</Badge>}
            </button>
          ))}
        </div>
      )}
      <ResponsiveDialog open={customers.addCustomerOpen} onOpenChange={customers.setAddCustomerOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-cyan-400" />
              Tambah Pelanggan
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Pelanggan baru akan tersinkron ke server saat online.</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Nama <span className="text-red-400">*</span></Label>
              <Input
                className="bg-white/[0.03] border-white/[0.06] text-white rounded-lg h-10 focus-visible:border-cyan-400/40 focus-visible:bg-white/[0.05] transition-colors"
                placeholder="Nama pelanggan"
                value={customers.newCustomer.name}
                onChange={(e) => customers.setNewCustomer({ ...customers.newCustomer, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">WhatsApp <span className="text-slate-500 font-normal">(opsional)</span></Label>
              <Input
                className="bg-white/[0.03] border-white/[0.06] text-white rounded-lg h-10 focus-visible:border-cyan-400/40 focus-visible:bg-white/[0.05] transition-colors tabular-nums"
                placeholder="08xxxxxxxxxx"
                value={customers.newCustomer.whatsapp}
                onChange={(e) => customers.setNewCustomer({ ...customers.newCustomer, whatsapp: e.target.value })}
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 rounded-lg h-10" onClick={() => customers.setAddCustomerOpen(false)}>Batal</Button>
            <Button
              className={cn(
                'rounded-lg h-10 font-medium transition-all',
                customers.addingCustomer
                  ? 'bg-cyan-600 hover:bg-cyan-600 text-white cursor-wait'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-white hover:shadow-[0_2px_12px_rgba(34,211,238,0.3)] hover:-translate-y-px'
              )}
              onClick={customers.handleAddCustomer}
              disabled={customers.addingCustomer}
            >
              {customers.addingCustomer && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Simpan Pelanggan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}

// ==================== PROMO SELECTOR (minimal, neutral Tag icon) ====================

function PromoSelector({ promos, selected, onSelect, subtotal }: {
  promos: Array<{ id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null }>
  selected: { id: string; name: string } | null
  onSelect: (p: { id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null } | null) => void
  subtotal: number
}) {
  if (promos.length === 0) return null
  return (
    <div className="flex items-center gap-2">
      <Tag className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <div className="relative flex-1 min-w-0">
        <select
          className="h-8 w-full text-xs rounded-md border border-white/[0.06] bg-white/[0.03] text-white pl-3 pr-8 appearance-none cursor-pointer focus:outline-none focus-visible:border-cyan-400/30"
          value={selected?.id || ''}
          onChange={(e) => {
            const p = promos.find(pp => pp.id === e.target.value)
            onSelect(p || null)
          }}
        >
          <option value="">Tanpa Promo</option>
          {promos.map((p) => (
            <option key={p.id} value={p.id} disabled={!!p.minPurchase && subtotal < p.minPurchase}>
              {p.name} ({p.type === 'PERCENTAGE' ? `${p.value}%` : formatCurrency(p.value)})
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
      </div>
    </div>
  )
}

// ==================== PAYMENT DIALOG BODY (V4 — distinct method states, premium CTA) ====================

function PaymentDialogBody({ total, paymentMethod, paidAmount, availableMethods, onSetPaymentMethod, onSetPaidAmount, checkingOut, onCheckout }: {
  total: number
  paymentMethod: string
  paidAmount: string
  availableMethods: Array<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>
  onSetPaymentMethod: (m: 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER') => void
  onSetPaidAmount: (a: string) => void
  checkingOut: boolean
  onCheckout: () => void
}) {
  const change = paymentMethod === 'CASH' ? Math.max(0, Number(paidAmount) - total) : 0
  const methodConfig: Record<string, { icon: typeof Banknote; label: string; desc: string; instruction: string }> = {
    CASH: { icon: HandCoins, label: 'Tunai', desc: 'Uang kontan', instruction: 'Terima pembayaran tunai dari pelanggan' },
    QRIS: { icon: QrCode, label: 'QRIS', desc: 'Scan QR', instruction: 'Tampilkan QR code kepada pelanggan' },
    DEBIT: { icon: CreditCard, label: 'Debit', desc: 'Kartu debit', instruction: 'Tap atau masukkan kartu ke EDC' },
    TRANSFER: { icon: ArrowLeftRight, label: 'Transfer', desc: 'Bank transfer', instruction: 'Konfirmasi transfer masuk' },
  }
  const cashInsufficient = paymentMethod === 'CASH' && Number(paidAmount) < total
  const selectedCfg = methodConfig[paymentMethod]
  const SelectedIcon = selectedCfg?.icon || HandCoins
  return (
    <div className="space-y-4">
      {/* Unified Total + Method preview — icon + total amount + label/instruction */}
      <div className="flex flex-col items-center py-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
        <div className="h-14 w-14 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-2">
          <SelectedIcon className="h-7 w-7 text-slate-100" />
        </div>
        <p className="text-[10px] text-slate-400 uppercase tracking-wide">{selectedCfg?.label || paymentMethod}</p>
        <p className="text-2xl font-bold text-white mt-1 tabular-nums">{formatCurrency(total)}</p>
        <p className="text-[11px] text-slate-500 mt-1.5 text-center max-w-[240px] leading-relaxed">{selectedCfg?.instruction}</p>
      </div>

      {/* Method selection — 2-col cards, distinct selected state (thick border + bg + check icon) */}
      <div>
        <Label className="text-slate-400 text-[10px] uppercase tracking-wide">Metode Pembayaran</Label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {availableMethods.map((m) => {
            const cfg = methodConfig[m]
            const Icon = cfg?.icon || HandCoins
            const isActive = paymentMethod === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => onSetPaymentMethod(m)}
                className={cn(
                  'relative flex items-center gap-2.5 h-12 px-3 rounded-lg border transition-all text-left',
                  isActive
                    ? 'border-amber-500/60 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.2)]'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1]'
                )}
              >
                <span className={cn(
                  'h-8 w-8 rounded-md flex items-center justify-center shrink-0 transition-colors',
                  isActive ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.04] text-slate-400'
                )}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-xs font-medium leading-tight', isActive ? 'text-amber-200' : 'text-slate-200')}>{cfg?.label || m}</p>
                  <p className="text-[9px] text-slate-500 leading-tight mt-0.5">{cfg?.desc || ''}</p>
                </div>
                {isActive && (
                  <Check className="h-3.5 w-3.5 text-amber-400 shrink-0 absolute top-1.5 right-1.5" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Cash payment */}
      {paymentMethod === 'CASH' && (
        <div className="space-y-2">
          <Label className="text-slate-400 text-[10px] uppercase tracking-wide">Jumlah Bayar</Label>
          <Input
            type="number"
            value={paidAmount}
            onChange={(e) => onSetPaidAmount(e.target.value)}
            placeholder="0"
            autoFocus
            className={cn(
              'bg-white/[0.03] border-white/[0.06] text-white text-base h-10 rounded-lg tabular-nums',
              cashInsufficient && Number(paidAmount) > 0 && 'border-amber-500/40 focus-visible:border-amber-500/60'
            )}
          />
          <div className="flex gap-1.5 flex-wrap">
            {[total, 50000, 100000, 150000].filter((v, i, a) => a.indexOf(v) === i).map((amt) => (
              <Button
                key={amt}
                variant="outline"
                size="sm"
                className="text-xs bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.06] text-slate-300 rounded-md h-7"
                onClick={() => onSetPaidAmount(String(amt))}
              >
                {formatCurrency(amt)}
              </Button>
            ))}
          </div>
          {Number(paidAmount) > 0 && (
            <div className={cn(
              'flex justify-between items-center mt-2 px-3 py-2 rounded-md',
              cashInsufficient ? 'bg-amber-500/10' : 'bg-emerald-500/10'
            )}>
              <span className={cn('text-xs', cashInsufficient ? 'text-amber-300' : 'text-emerald-300')}>
                {cashInsufficient ? 'Kurang' : 'Kembalian'}
              </span>
              <span className={cn('font-bold tabular-nums text-sm', cashInsufficient ? 'text-amber-400' : 'text-emerald-400')}>
                {formatCurrency(cashInsufficient ? total - Number(paidAmount) : change)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Proses Pembayaran — 3 states: disabled muted / ready amber / processing darker amber */}
      <Button
        className={cn(
          'w-full font-semibold rounded-lg h-11 transition-all',
          checkingOut
            ? 'bg-amber-600 hover:bg-amber-600 text-white cursor-wait'
            : 'bg-amber-500 hover:bg-amber-400 text-white hover:shadow-[0_2px_12px_rgba(245,158,11,0.35)] hover:-translate-y-px',
          (checkingOut || cashInsufficient) && !checkingOut && 'opacity-60 cursor-not-allowed hover:translate-y-0 hover:shadow-none',
        )}
        disabled={checkingOut || cashInsufficient}
        onClick={onCheckout}
      >
        {checkingOut ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Memproses Pembayaran…
          </>
        ) : (
          'Proses Pembayaran'
        )}
      </Button>
    </div>
  )
}

// ==================== PR 4: Pending Row (quiet neutral) ====================

function PendingRow({ pending, onResume, onDelete }: {
  pending: PendingTransactionRow
  onResume: () => void
  onDelete: () => void
}) {
  const itemCount = pending.items.reduce((s, i) => s + i.qty, 0)
  const time = new Date(pending.createdAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  const initial = (pending.customerName || 'W').charAt(0).toUpperCase()
  return (
    <div className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-b-0">
      <div className="h-8 w-8 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0">
        <span className="text-xs font-semibold text-slate-200">{initial}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white truncate leading-tight">{pending.customerName || 'Walk-in'}</p>
        <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{itemCount} item · {formatCurrency(pending.subtotal)} · {time}</p>
        {pending.note && <p className="text-[10px] text-slate-400 italic mt-0.5 truncate">Catatan: {pending.note}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" className="h-7 px-2 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-slate-100 text-xs" onClick={onResume}>Lanjutkan</Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-red-400 hover:bg-red-500/10" onClick={onDelete} title="Hapus">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ==================== PR 4: Last Receipt → CartItem converter (for reprint) ====================

function lastReceiptToCartItems(last: LastReceiptRow): CartItem[] {
  return last.cart.map((item) => ({
    product: {
      ...item.product,
      variants: [] as ProductVariant[],
    } as Product,
    variant: item.variant ? { ...item.variant } as ProductVariant : null,
    qty: item.qty,
    customPrice: item.customPrice,
  }))
}
