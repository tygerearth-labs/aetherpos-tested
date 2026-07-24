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
 * V2 LAYOUT (POS-LAYOUT-V2) — operational interaction model:
 *   - Fixed 2-row mission-control header (search dominant, utilities tiny)
 *   - Compact horizontal product rows (48px thumb or initials, NOT tall cards)
 *   - Cart panel with 5 structured sections filling vertical space
 *   - Amber for price/CTA only; cyan for sync/status only; flat, sharp, dense
 *
 * @boundary COCKPIT only — no engine imports
 */

import { useState, useEffect, useCallback } from 'react'
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
import { ReceiptDialog } from '@/components/pos/receipt-dialog'
import {
  Search, Plus, Minus, Trash2, ShoppingCart, Package, Loader2, Check, X,
  User, UserPlus, Coins, Wifi, WifiOff, RefreshCw, CloudOff, Tag, AlertTriangle,
  ChevronLeft, ChevronRight, Pencil, Pause, Clock, Printer,
  LayoutGrid, Layers, Banknote, QrCode, CreditCard, ArrowLeftRight,
  ChevronDown,
} from 'lucide-react'
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

const PRODUCTS_PER_PAGE = 24

export default function PosPage() {
  const isMobile = useIsMobile()
  const { currentPage } = usePageStore()

  // ── Shared state (owned by orchestrator) ──
  const [selectedPromo, setSelectedPromo] = useState<{ id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null } | null>(null)
  const [pointsToUse, setPointsToUse] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>('CASH')
  const [paidAmount, setPaidAmount] = useState('')

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

  return (
    <div className="flex flex-col h-full bg-deep-space">
      {/* ═══════════════════════════════════════════════════════════
          HEADER — Mission Control (fixed 2-row, no scroll)
          Row 1: search (dominant) + tiny utility cluster
          Row 2: segmented category chips
          ═══════════════════════════════════════════════════════════ */}
      <div className="shrink-0 bg-nebula/80 backdrop-blur-xl border-b border-white/[0.04]">
        {/* Row 1 — main bar */}
        <div className="flex items-center gap-2 h-14 px-3">
          {/* Search — dominant */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
            <Input
              placeholder="Cari produk, SKU, atau barcode…"
              value={products.productSearch}
              onChange={(e) => products.handleSearchChange(e.target.value)}
              onKeyDown={products.handleSearchKeyDown}
              className="pl-10 h-10 bg-white/[0.03] border-white/[0.06] text-white placeholder:text-slate-500 rounded-lg focus-visible:border-cyan-500/40"
            />
          </div>

          {/* Utility cluster — small, secondary */}
          <div className="flex items-center gap-1 shrink-0">
            <SyncButton sync={sync} />

            {/* Tunda — icon-only */}
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8 rounded-md hover:bg-white/[0.06] text-slate-400 hover:text-slate-200"
              onClick={() => checkout.setPendingListOpen(true)}
              title="Transaksi tertunda"
            >
              <Clock className="h-4 w-4" />
              {checkout.pendingCount > 0 && (
                <Badge variant="secondary" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] justify-center bg-amber-500 text-white border border-nebula">{checkout.pendingCount}</Badge>
              )}
            </Button>

            {/* Cetak Ulang — icon-only */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md hover:bg-white/[0.06] text-slate-400 hover:text-slate-200"
              onClick={checkout.handleReprint}
              title="Cetak ulang struk"
            >
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Row 2 — segmented category chips */}
        <CategoryFilter
          categories={products.categories}
          selected={products.selectedCategoryId}
          onSelect={products.handleCategorySelect}
        />
      </div>

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm shrink-0">
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>Mode Offline — transaksi tersimpan lokal dan akan disinkronkan saat online</span>
        </div>
      )}

      {/* ── Deleted product warnings ── */}
      {cart.deletedCartWarnings.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-sm shrink-0">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Produk dalam keranjang tidak lagi tersedia:</p>
            <p className="text-xs">{cart.deletedCartWarnings.join(', ')}</p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MAIN CONTENT — products (left) + cart (right, desktop)
          ═══════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: products ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Product grid — the only thing that scrolls */}
          <ScrollArea className="flex-1">
            {products.productsLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : products.products.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
                <div className="h-12 w-12 rounded-lg bg-white/[0.03] flex items-center justify-center">
                  <Package className="h-6 w-6 text-slate-600" />
                </div>
                <p className="text-sm">Tidak ada produk ditemukan</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 p-3">
                {products.products.map((product) => (
                  <ProductCard key={product.id} product={product} onClick={() => handleProductClick(product)} />
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Pagination */}
          {products.totalProductPages > 1 && (
            <div className="flex items-center justify-center gap-2 p-2 border-t border-white/[0.04] bg-nebula/40 shrink-0">
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

        {/* ── Right: cart (desktop) / hidden on mobile ── */}
        {!isMobile && (
          <div className="w-[360px] border-l border-white/[0.06] flex flex-col bg-nebula shrink-0">
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
      </div>

      {/* ── Mobile cart bar (in-flow, full-width amber) ── */}
      {isMobile && cart.cart.length > 0 && (
        <div className="p-3 border-t border-white/[0.06] bg-nebula/80 backdrop-blur-xl mobile-safe-bottom shrink-0">
          <Button
            className="w-full bg-amber-500 hover:bg-amber-400 text-white rounded-lg h-12 font-semibold transition-colors flex items-center px-4"
            onClick={() => checkout.setMobileCartOpen(true)}
          >
            <span className="flex-1 text-left text-sm">Bayar · {cart.cart.length} item</span>
            <span className="text-sm tabular-nums">{formatCurrency(cart.total)}</span>
            <ChevronRight className="h-4 w-4 ml-2 opacity-80 shrink-0" />
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
          VARIANT PICKER — compact operational rows
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
                      'flex items-center justify-between w-full text-left p-3 rounded-lg border transition-colors',
                      'border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.08]',
                      out && 'opacity-50 cursor-not-allowed hover:bg-white/[0.02] hover:border-white/[0.04]'
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
                    <span className="text-sm font-semibold text-amber-400 tabular-nums shrink-0 ml-3">{formatCurrency(v.price)}</span>
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
              <Pause className="h-4 w-4 text-cyan-400" />
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
              className="bg-white/[0.03] border-white/[0.06] text-white placeholder:text-slate-500 rounded-lg resize-none h-20"
            />
            <div className="flex items-center gap-2 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <ShoppingCart className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <p className="text-xs text-slate-400">
                {cart.cart.length} item — <span className="text-slate-200 font-medium">{formatCurrency(cart.total)}</span> akan disimpan dan dapat dilanjutkan nanti.
              </p>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 rounded-lg h-10" onClick={() => checkout.setHoldNoteOpen(false)}>Batal</Button>
            <Button className="bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.06] text-slate-200 rounded-lg h-10" onClick={checkout.confirmHoldTransaction}>
              <Pause className="h-3.5 w-3.5 mr-2" />
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
              <Clock className="h-4 w-4 text-cyan-400" />
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

// ==================== SYNC BUTTON (tiny status pill) ====================

function SyncButton({ sync }: { sync: ReturnType<typeof usePosSync> }) {
  // V2 color discipline: cyan=synced, blue=syncing, red=offline, orange=failed/conflict
  // (amber reserved for price/CTA only)
  const config = {
    synced:   { dot: 'bg-cyan-400',           label: 'Synced',  spin: false },
    syncing:  { dot: 'bg-blue-400 animate-pulse', label: 'Sync…',  spin: true },
    offline:  { dot: 'bg-red-400',            label: 'Offline', spin: false },
    failed:   { dot: 'bg-orange-400',         label: `${sync.unsyncedCount} pending`, spin: false },
    conflict: { dot: 'bg-orange-400',         label: 'Conflict', spin: false },
  }[sync.syncStatus]

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 gap-1.5 rounded-md hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 shrink-0"
      onClick={sync.handleSync}
      disabled={sync.syncing || !sync.isOnline}
      title="Sinkronkan"
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', config.dot)} />
      <RefreshCw className={cn('h-3 w-3', config.spin && 'animate-spin')} />
      <span className="text-[10px] font-medium hidden sm:inline">{config.label}</span>
    </Button>
  )
}

// ==================== CATEGORY FILTER (segmented chips) ====================

function CategoryFilter({ categories, selected, onSelect }: {
  categories: Array<{ id: string; name: string; color: string }>
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <div className="flex items-center gap-1.5 h-11 px-3 overflow-x-auto border-t border-white/[0.04] bg-nebula/40 scrollbar-hide">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium shrink-0 transition-colors',
          selected === null
            ? 'bg-white/[0.08] text-white'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Semua
      </button>
      {categories.map((c) => {
        const isActive = selected === c.id
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium shrink-0 transition-colors',
              isActive
                ? 'bg-white/[0.08] text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            )}
          >
            <span
              className="h-[3px] w-[3px] rounded-full shrink-0"
              style={{ backgroundColor: c.color || '#64748b' }}
            />
            {c.name}
          </button>
        )
      })}
    </div>
  )
}

// ==================== PRODUCT CARD (compact horizontal row) ====================

function ProductCard({ product, onClick }: { product: Product; onClick: () => void }) {
  const outOfStock = !product.hasVariants && product.stock <= 0
  const lowStock = !product.hasVariants && product.stock > 0 && product.stock <= 5
  const initials = product.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')

  return (
    <button
      onClick={onClick}
      disabled={outOfStock}
      className={cn(
        'flex items-center gap-3 p-2 rounded-lg border text-left transition-colors w-full',
        'border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.08]',
        outOfStock && 'opacity-50 cursor-not-allowed hover:bg-white/[0.02] hover:border-white/[0.04]'
      )}
    >
      {/* Thumbnail — 48px (h-12 w-12). Image or initials, no big empty box. */}
      <div className="h-12 w-12 rounded-md shrink-0 overflow-hidden bg-white/[0.04] flex items-center justify-center">
        {product.image ? (
          <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs font-semibold text-slate-300 select-none">{initials || '?'}</span>
        )}
      </div>

      {/* Text column — name + stock */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {product.sku && (
          <span className="text-[10px] text-slate-500 font-mono truncate leading-tight">{product.sku}</span>
        )}
        <p className="text-xs font-medium text-slate-100 truncate leading-tight">{product.name}</p>
        {product.hasVariants ? (
          <span className="text-[10px] text-cyan-400 inline-flex items-center gap-1 leading-tight">
            <Layers className="h-2.5 w-2.5" />
            {product._variantCount} varian
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] leading-tight">
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              outOfStock ? 'bg-red-400' : lowStock ? 'bg-orange-400' : 'bg-emerald-400'
            )} />
            <span className={outOfStock ? 'text-red-400' : 'text-slate-500'}>
              {outOfStock ? 'Habis' : `Stok ${product.stock}`}
            </span>
          </span>
        )}
      </div>

      {/* Price column — amber, flat, tabular */}
      <div className="shrink-0 text-right">
        {product.hasVariants ? (
          <span className="text-[10px] text-cyan-400 inline-flex items-center gap-1">
            <Layers className="h-3 w-3" />
            Pilih Varian
          </span>
        ) : (
          <p className="text-sm font-semibold text-amber-400 tabular-nums leading-tight">
            {formatCurrency(product.price)}
          </p>
        )}
      </div>
    </button>
  )
}

// ==================== CART PANEL (5 structured sections) ====================

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
    <div className="flex flex-col h-full bg-nebula">
      {/* ── Section 1: Customer (compact, p-3, border-b) ── */}
      <CustomerSelector customers={customers} />

      {/* ── Section 2: Items (flex-1, scroll) ── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3">
          {cart.cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-600">
              <ShoppingCart className="h-8 w-8 text-slate-600" />
              <p className="text-xs text-slate-500">Keranjang kosong</p>
            </div>
          ) : (
            cart.cart.map((item) => (
              <CartItemRow key={cart.getCartKey(item.product.id, item.variant?.id || null)} item={item} cart={cart} />
            ))
          )}
        </div>
      </ScrollArea>

      {/* ── Section 3: Discount / Promo (p-3, border-t, compact) ── */}
      <div className="border-t border-white/[0.06] p-3 space-y-2 shrink-0">
        <PromoSelector
          promos={settings.availablePromos}
          selected={selectedPromo}
          onSelect={onSelectPromo}
          subtotal={cart.subtotal}
        />

        {customers.selectedCustomer && settings.settings.loyaltyEnabled && (
          <div className="flex items-center gap-2">
            <Coins className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <Label className="text-xs text-slate-400 shrink-0">Points ({customers.selectedCustomer.points})</Label>
            <Input type="number" value={pointsToUse} onChange={(e) => onPointsChange(e.target.value)} className="h-7 flex-1 text-xs bg-white/[0.03] border-white/[0.06] text-white rounded-md min-w-0" max={cart.maxPointsToUse} />
            <span className="text-xs text-emerald-400 shrink-0 tabular-nums">-{formatCurrency(cart.pointsDiscount)}</span>
          </div>
        )}
      </div>

      {/* ── Section 4: Summary (p-3, border-t, dense) ── */}
      <div className="border-t border-white/[0.06] p-3 space-y-1 text-xs shrink-0">
        <div className="flex justify-between">
          <span className="text-slate-400">Subtotal</span>
          <span className="text-slate-200 tabular-nums">{formatCurrency(cart.subtotal)}</span>
        </div>
        {cart.manualDiscountTotal > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Diskon Manual</span>
            <span className="tabular-nums">-{formatCurrency(cart.manualDiscountTotal)}</span>
          </div>
        )}
        {cart.pointsDiscount > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Points</span>
            <span className="tabular-nums">-{formatCurrency(cart.pointsDiscount)}</span>
          </div>
        )}
        {selectedPromo && cart.promoDiscount > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Promo ({selectedPromo.name})</span>
            <span className="tabular-nums">-{formatCurrency(cart.promoDiscount)}</span>
          </div>
        )}
        {cart.ppnAmount > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-400">Pajak ({settings.settings.ppnRate}%)</span>
            <span className="text-slate-200 tabular-nums">{formatCurrency(cart.ppnAmount)}</span>
          </div>
        )}
        <Separator className="bg-white/[0.06] my-2" />
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-bold text-white">Total</span>
          <span className="text-base font-bold text-amber-400 tabular-nums">{formatCurrency(cart.total)}</span>
        </div>
      </div>

      {/* ── Section 5: Action row (p-3, border-t, Tunda + Bayar) ── */}
      <div className="border-t border-white/[0.06] p-3 flex gap-2 shrink-0">
        {/* Tunda — secondary, ~1/3 width */}
        <Button
          variant="outline"
          className="flex-1 h-11 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-slate-300 text-sm font-medium shrink-0"
          disabled={cart.cart.length === 0}
          onClick={checkout.handleHoldTransaction}
        >
          <Pause className="h-4 w-4 mr-1.5" />
          Tunda
        </Button>

        {/* Bayar — dominant CTA, ~2/3 width, solid amber */}
        <Button
          className="flex-[2] h-11 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm shrink-0 disabled:opacity-50 transition-colors"
          disabled={cart.cart.length === 0 || cart.hasBelowHpp}
          onClick={onCheckout}
        >
          {cart.hasBelowHpp ? (
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
  )
}

// ==================== CART ITEM ROW (compact operational) ====================

function CartItemRow({ item, cart }: { item: CartItem; cart: ReturnType<typeof usePosCart> }) {
  const key = cart.getCartKey(item.product.id, item.variant?.id || null)
  const isEditingQty = cart.editingQtyId === item.product.id
  const isEditingPrice = cart.editingPriceId === key
  const price = item.variant ? item.variant.price : item.product.price
  const effPrice = item.customPrice != null ? item.customPrice : price
  const stock = cart.getItemStock(item)

  return (
    <div className="flex items-start gap-2 py-2 border-b border-white/[0.04] last:border-b-0">
      {/* Left: name + sub-line (variant · price/pc) */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-100 truncate leading-tight">{cart.getItemDisplayName(item)}</p>
        <div className="flex items-center gap-1 mt-0.5">
          {item.variant && (
            <>
              <span className="text-[10px] text-slate-500 truncate">{item.variant.name}</span>
              <span className="text-slate-600 text-[10px]">·</span>
            </>
          )}
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
          ) : (
            <button
              onClick={() => cart.startEditPrice(key, effPrice)}
              className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
              title="Edit harga"
            >
              {formatCurrency(effPrice)}/pc <Pencil className="h-2.5 w-2.5 opacity-50" />
            </button>
          )}
        </div>
      </div>

      {/* Middle: qty stepper [−] N [+] */}
      <div className="shrink-0 flex items-center">
        {isEditingQty ? (
          <Input
            ref={cart.qtyInputRef}
            type="number"
            value={cart.editingQtyValue}
            onChange={(e) => cart.setEditingQtyValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') cart.confirmEditQty(); if (e.key === 'Escape') cart.cancelEditQty() }}
            onBlur={cart.confirmEditQty}
            className="h-6 w-12 text-xs bg-white/[0.04] border-white/[0.06] text-white rounded-md text-center"
          />
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => cart.updateQty(item.product.id, Math.max(1, item.qty - 1), item.variant?.id || undefined)}
              disabled={item.qty <= 1}
              className="h-6 w-6 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Kurangi"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              onClick={() => cart.startEditQty(item.product.id, item.qty)}
              className="text-xs font-medium text-white w-5 text-center tabular-nums hover:text-cyan-400 transition-colors"
              title="Edit qty"
            >
              {item.qty}
            </button>
            <button
              type="button"
              onClick={() => cart.updateQty(item.product.id, Math.min(stock, item.qty + 1), item.variant?.id || undefined)}
              disabled={item.qty >= stock}
              className="h-6 w-6 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Tambah"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Right: line total (amber) + delete */}
      <div className="shrink-0 flex flex-col items-end gap-1">
        <span className="text-xs font-semibold text-amber-400 tabular-nums leading-tight">{formatCurrency(effPrice * item.qty)}</span>
        <button
          onClick={() => cart.removeFromCart(item.product.id, item.variant?.id || undefined)}
          className="text-slate-500 hover:text-red-400 transition-colors p-0.5"
          title="Hapus"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ==================== CUSTOMER SELECTOR (compact) ====================

function CustomerSelector({ customers }: { customers: ReturnType<typeof usePosCustomers> }) {
  return (
    <div className="p-3 border-b border-white/[0.06] shrink-0">
      {customers.selectedCustomer ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-md bg-white/[0.06] flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-slate-300" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate leading-tight">{customers.selectedCustomer.name}</p>
              <p className="text-[10px] text-slate-400 flex items-center gap-1 leading-tight">
                <Coins className="h-2.5 w-2.5 text-amber-400" />
                {customers.selectedCustomer.points} points
                {customers.selectedCustomer.isLocal && <Badge variant="outline" className="ml-1 text-[9px] py-0 px-1 h-3.5 bg-white/[0.04] border-white/[0.06] text-slate-300">Offline</Badge>}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-white hover:bg-white/[0.06] shrink-0" onClick={() => customers.setSelectedCustomer(null)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            placeholder="Cari pelanggan…"
            value={customers.customerSearch}
            onChange={(e) => { customers.setCustomerSearch(e.target.value); customers.setCustomerDropdownOpen(true) }}
            className="h-8 text-xs bg-white/[0.03] border-white/[0.06] text-white placeholder:text-slate-500 rounded-md"
          />
          <Button variant="outline" size="icon" className="h-8 w-8 bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 shrink-0" onClick={() => customers.setAddCustomerOpen(true)} title="Tambah pelanggan">
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      {customers.customerDropdownOpen && !customers.selectedCustomer && customers.filteredCustomers.length > 0 && (
        <div className="mt-1.5 border border-white/[0.06] rounded-md max-h-40 overflow-y-auto bg-nebula">
          {customers.filteredCustomers.slice(0, 8).map((c) => (
            <button
              key={c.id}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/[0.06] text-left text-slate-200 first:rounded-t-md last:rounded-b-md transition-colors"
              onClick={() => { customers.setSelectedCustomer(c); customers.setCustomerDropdownOpen(false); customers.setCustomerSearch('') }}
            >
              <span className="text-xs">{c.name}</span>
              {c.isLocal && <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 bg-white/[0.04] border-white/[0.06] text-slate-300">Offline</Badge>}
            </button>
          ))}
        </div>
      )}
      <ResponsiveDialog open={customers.addCustomerOpen} onOpenChange={customers.setAddCustomerOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Tambah Pelanggan</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-slate-300">Nama *</Label>
              <Input className="bg-white/[0.03] border-white/[0.06] text-white" value={customers.newCustomer.name} onChange={(e) => customers.setNewCustomer({ ...customers.newCustomer, name: e.target.value })} />
            </div>
            <div>
              <Label className="text-slate-300">WhatsApp</Label>
              <Input className="bg-white/[0.03] border-white/[0.06] text-white" value={customers.newCustomer.whatsapp} onChange={(e) => customers.setNewCustomer({ ...customers.newCustomer, whatsapp: e.target.value })} />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 rounded-lg h-10" onClick={() => customers.setAddCustomerOpen(false)}>Batal</Button>
            <Button className="bg-amber-500 hover:bg-amber-400 text-white rounded-lg h-10" onClick={customers.handleAddCustomer} disabled={customers.addingCustomer}>
              {customers.addingCustomer && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Simpan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}

// ==================== PROMO SELECTOR (minimal) ====================

function PromoSelector({ promos, selected, onSelect, subtotal }: {
  promos: Array<{ id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null }>
  selected: { id: string; name: string } | null
  onSelect: (p: { id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null } | null) => void
  subtotal: number
}) {
  if (promos.length === 0) return null
  return (
    <div className="flex items-center gap-2">
      <Tag className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
      <div className="relative flex-1 min-w-0">
        <select
          className="h-8 w-full text-xs rounded-md border border-white/[0.06] bg-white/[0.03] text-white pl-3 pr-8 appearance-none cursor-pointer focus:outline-none focus-visible:border-cyan-500/40"
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

// ==================== PAYMENT DIALOG BODY (operational) ====================

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
  const methodConfig: Record<string, { icon: typeof Banknote; label: string }> = {
    CASH: { icon: Banknote, label: 'Tunai' },
    QRIS: { icon: QrCode, label: 'QRIS' },
    DEBIT: { icon: CreditCard, label: 'Debit' },
    TRANSFER: { icon: ArrowLeftRight, label: 'Transfer' },
  }
  return (
    <div className="space-y-4">
      {/* Total display — flat amber on subtle bg */}
      <div className="text-center py-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Total Pembayaran</p>
        <p className="text-2xl font-bold text-amber-400 mt-1 tabular-nums">{formatCurrency(total)}</p>
      </div>

      {/* Method selection — 2-col compact cards */}
      <div>
        <Label className="text-slate-400 text-[10px] uppercase tracking-wide">Metode Pembayaran</Label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {availableMethods.map((m) => {
            const cfg = methodConfig[m]
            const Icon = cfg?.icon || Banknote
            const isActive = paymentMethod === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => onSetPaymentMethod(m)}
                className={cn(
                  'flex items-center justify-center gap-2 h-12 rounded-lg border transition-colors',
                  isActive
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] text-slate-300 hover:text-white'
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="text-xs font-medium">{cfg?.label || m}</span>
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
            className="bg-white/[0.03] border-white/[0.06] text-white text-base h-10 rounded-lg tabular-nums"
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
            <div className="flex justify-between items-center mt-2 px-3 py-2 rounded-md bg-emerald-500/10">
              <span className="text-xs text-emerald-300">Kembalian</span>
              <span className="font-bold text-emerald-400 tabular-nums text-sm">{formatCurrency(change)}</span>
            </div>
          )}
        </div>
      )}

      {/* Process button — solid amber, matches Bayar */}
      <Button
        className="w-full bg-amber-500 hover:bg-amber-400 text-white font-semibold rounded-lg h-11 transition-colors disabled:opacity-50"
        disabled={checkingOut || (paymentMethod === 'CASH' && Number(paidAmount) < total)}
        onClick={onCheckout}
      >
        {checkingOut ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Memproses…
          </>
        ) : (
          'Proses Pembayaran'
        )}
      </Button>
    </div>
  )
}

// ==================== PR 4: Pending Row (compact operational) ====================

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
        {pending.note && <p className="text-[10px] text-amber-400 mt-0.5 truncate">Catatan: {pending.note}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" className="h-7 px-2 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs" onClick={onResume}>Lanjutkan</Button>
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
