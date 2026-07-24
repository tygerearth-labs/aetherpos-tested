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
      {/* ── Header: search + pending + reprint + sync ── */}
      <div className="flex items-center gap-2 p-3 border-b border-white/[0.06] bg-nebula">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Cari produk, SKU, atau barcode..."
            value={products.productSearch}
            onChange={(e) => products.handleSearchChange(e.target.value)}
            onKeyDown={products.handleSearchKeyDown}
            className="pl-9 bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-500"
          />
        </div>
        {/* PR 4 — Pending orders */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 relative bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 hover:text-white"
          onClick={() => checkout.setPendingListOpen(true)}
          title="Transaksi tertunda"
        >
          <Clock className="h-3.5 w-3.5" />
          <span className="text-xs hidden sm:inline">Tunda</span>
          {checkout.pendingCount > 0 && (
            <Badge variant="secondary" className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[9px] justify-center bg-amber-500 text-white">{checkout.pendingCount}</Badge>
          )}
        </Button>
        {/* PR 4 — Reprint last receipt */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 hover:text-white"
          onClick={checkout.handleReprint}
          title="Cetak ulang struk terakhir"
        >
          <Printer className="h-3.5 w-3.5" />
          <span className="text-xs hidden sm:inline">Cetak Ulang</span>
        </Button>
        <SyncButton sync={sync} />
      </div>

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
          <CloudOff className="h-4 w-4" />
          <span>Mode Offline — transaksi tersimpan lokal dan akan disinkronkan saat online</span>
        </div>
      )}

      {/* ── Deleted product warnings ── */}
      {cart.deletedCartWarnings.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Produk dalam keranjang tidak lagi tersedia:</p>
            <p className="text-xs">{cart.deletedCartWarnings.join(', ')}</p>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: products ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Category filter */}
          <CategoryFilter
            categories={products.categories}
            selected={products.selectedCategoryId}
            onSelect={products.handleCategorySelect}
          />

          {/* Product grid */}
          <ScrollArea className="flex-1">
            {products.productsLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : products.products.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-2 text-slate-500">
                <Package className="h-10 w-10" />
                <p>Tidak ada produk</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 p-3">
                {products.products.map((product) => (
                  <ProductCard key={product.id} product={product} onClick={() => handleProductClick(product)} />
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Pagination */}
          {products.totalProductPages > 1 && (
            <div className="flex items-center justify-center gap-2 p-2 border-t border-white/[0.06]">
              <Button variant="outline" size="sm" className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300" onClick={() => products.setProductPage(Math.max(1, products.productPage - 1))} disabled={products.productPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-slate-400">{products.productPage} / {products.totalProductPages}</span>
              <Button variant="outline" size="sm" className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300" onClick={() => products.setProductPage(Math.min(products.totalProductPages, products.productPage + 1))} disabled={products.productPage === products.totalProductPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* ── Right: cart (desktop) / hidden on mobile ── */}
        {!isMobile && (
          <div className="w-96 border-l border-white/[0.06] flex flex-col bg-nebula">
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

      {/* ── Mobile cart button ── */}
      {isMobile && cart.cart.length > 0 && (
        <div className="p-3 border-t border-white/[0.06] bg-nebula">
          <Button className="w-full theme-bg hover:theme-hover text-white rounded-xl h-12" onClick={() => checkout.setMobileCartOpen(true)}>
            <ShoppingCart className="h-4 w-4 mr-2" />
            {cart.cart.length} item — {formatCurrency(cart.total)}
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

      {/* ── Variant picker ── */}
      <ResponsiveDialog open={products.variantPicker.open} onOpenChange={(o) => !o && products.setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Pilih Varian — {products.variantPicker.product?.name}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Pilih varian produk untuk ditambahkan ke keranjang</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {products.variantPicker.loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : (
            <div className="grid gap-2">
              {products.variantPicker.variants.map((v) => {
                const out = v.stock <= 0
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={out}
                    onClick={() => products.handleVariantSelect(v)}
                    className={cn(
                      'flex items-center justify-between w-full text-left bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 hover:bg-white/[0.06] hover:border-white/[0.1] transition-all',
                      out && 'opacity-40 cursor-not-allowed hover:bg-white/[0.03] hover:border-white/[0.06]'
                    )}
                  >
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-sm font-medium text-white truncate">{v.name}</span>
                      <span className="text-[10px] text-slate-500">{v.sku || '—'}</span>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="text-base font-bold theme-text">{formatCurrency(v.price)}</span>
                      <span className={cn('text-[10px]', out ? 'text-red-400' : 'text-emerald-400')}>Stok: {v.stock}</span>
                    </div>
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
            <ResponsiveDialogTitle>Tunda Transaksi</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Tambahkan catatan untuk transaksi yang ditunda (opsional).</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Catatan (mis. meja 5, customer nama..."
              value={checkout.holdNote}
              onChange={(e) => checkout.setHoldNote(e.target.value)}
              rows={3}
              className="bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-500"
            />
            <p className="text-xs text-slate-500 mt-2">
              {cart.cart.length} item — {formatCurrency(cart.total)} akan disimpan dan dapat dilanjutkan nanti.
            </p>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300" onClick={() => checkout.setHoldNoteOpen(false)}>Batal</Button>
            <Button className="theme-bg hover:theme-hover text-white" onClick={checkout.confirmHoldTransaction}>Tunda</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── PR 4: Pending transactions list drawer (Sheet, slides from right) ── */}
      <Sheet open={checkout.pendingListOpen} onOpenChange={checkout.setPendingListOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md bg-nebula border-white/[0.06] flex flex-col gap-0">
          <SheetHeader>
            <SheetTitle className="text-white">Transaksi Tertunda ({checkout.pendingList.length})</SheetTitle>
            <SheetDescription className="text-slate-400">Pilih transaksi untuk dilanjutkan atau dihapus.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
            {checkout.pendingList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-500">
                <Clock className="h-8 w-8" />
                <p className="text-sm">Tidak ada transaksi tertunda</p>
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

// ==================== SYNC BUTTON ====================

function SyncButton({ sync }: { sync: ReturnType<typeof usePosSync> }) {
  const config = {
    synced: { icon: Check, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Synced' },
    syncing: { icon: RefreshCw, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Syncing...', spin: true },
    offline: { icon: WifiOff, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Offline' },
    failed: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', label: `${sync.unsyncedCount} pending` },
    conflict: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'Conflict' },
  }[sync.syncStatus]

  const Icon = config.icon
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('gap-1.5 bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06]', config.bg, config.color)}
      onClick={sync.handleSync}
      disabled={sync.syncing || !sync.isOnline}
    >
      <Icon className={cn('h-3.5 w-3.5', config.spin && 'animate-spin')} />
      <span className="text-xs">{config.label}</span>
      {sync.lastSyncAt && sync.syncStatus === 'synced' && (
        <span className="text-xs text-slate-400">{sync.timeAgo(sync.lastSyncAt)}</span>
      )}
    </Button>
  )
}

// ==================== CATEGORY FILTER ====================

function CategoryFilter({ categories, selected, onSelect }: {
  categories: Array<{ id: string; name: string; color: string }>
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <div className="flex gap-1.5 p-2 overflow-x-auto border-b border-white/[0.06] scrollbar-hide">
      <Button
        variant={selected === null ? 'default' : 'outline'}
        size="sm"
        className={cn('rounded-full px-4 shrink-0', selected === null ? 'theme-bg hover:theme-hover text-white border-transparent' : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300')}
        onClick={() => onSelect(null)}
      >
        Semua
      </Button>
      {categories.map((c) => (
        <Button
          key={c.id}
          variant={selected === c.id ? 'default' : 'outline'}
          size="sm"
          className={cn('rounded-full px-4 shrink-0', selected === c.id ? 'theme-bg hover:theme-hover text-white border-transparent' : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300')}
          onClick={() => onSelect(c.id)}
        >
          {c.name}
        </Button>
      ))}
    </div>
  )
}

// ==================== PRODUCT CARD ====================

function ProductCard({ product, onClick }: { product: Product; onClick: () => void }) {
  const outOfStock = !product.hasVariants && product.stock <= 0
  return (
    <button
      onClick={onClick}
      disabled={outOfStock}
      className={cn(
        'flex flex-col gap-1.5 p-2.5 rounded-xl border text-left transition-all',
        'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1]',
        outOfStock && 'opacity-40 cursor-not-allowed hover:bg-white/[0.03] hover:border-white/[0.06]'
      )}
    >
      <div className="relative aspect-square rounded-lg bg-white/[0.04] flex items-center justify-center overflow-hidden">
        {product.image ? (
          <>
            <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
          </>
        ) : (
          <Package className="h-8 w-8 text-slate-600" />
        )}
        {outOfStock && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-red-500/15 text-red-400 text-[10px] font-semibold">
            Stok Habis
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-medium text-white line-clamp-2 leading-tight">{product.name}</p>
        {product.hasVariants ? (
          <span className="inline-flex self-start mt-0.5 px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[10px] theme-text font-medium">
            Pilih Varian ({product._variantCount})
          </span>
        ) : (
          <>
            <p className="text-sm font-bold theme-text">{formatCurrency(product.price)}</p>
            <p className="text-[10px] text-slate-500">Stok: {product.stock}</p>
          </>
        )}
      </div>
    </button>
  )
}

// ==================== CART PANEL ====================

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
      {/* Customer selector */}
      <CustomerSelector customers={customers} />

      {/* Cart items */}
      <ScrollArea className={cn('flex-1', isMobile && 'h-[40vh]')}>
        <div className="p-3 space-y-2">
          {cart.cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-500">
              <ShoppingCart className="h-8 w-8 text-slate-600" />
              <p className="text-sm">Keranjang kosong</p>
            </div>
          ) : (
            cart.cart.map((item) => (
              <CartItemRow key={cart.getCartKey(item.product.id, item.variant?.id || null)} item={item} cart={cart} />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Totals */}
      <div className="border-t border-white/[0.06] p-3 space-y-2 bg-nebula">
        {/* Promo selector */}
        <PromoSelector
          promos={settings.availablePromos}
          selected={selectedPromo}
          onSelect={onSelectPromo}
          subtotal={cart.subtotal}
        />

        {/* Points */}
        {customers.selectedCustomer && settings.settings.loyaltyEnabled && (
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-amber-500" />
            <Label className="text-xs text-slate-300">Points ({customers.selectedCustomer.points})</Label>
            <Input type="number" value={pointsToUse} onChange={(e) => onPointsChange(e.target.value)} className="h-7 text-xs bg-white/[0.04] border-white/[0.06] text-white" max={cart.maxPointsToUse} />
            <span className="text-xs text-slate-400">-{formatCurrency(cart.pointsDiscount)}</span>
          </div>
        )}

        <Separator className="bg-white/[0.06]" />

        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">Subtotal</span><span className="text-white">{formatCurrency(cart.subtotal)}</span></div>
          {cart.manualDiscountTotal > 0 && (
            <div className="flex justify-between text-emerald-400"><span>Diskon Manual</span><span>-{formatCurrency(cart.manualDiscountTotal)}</span></div>
          )}
          {cart.pointsDiscount > 0 && (
            <div className="flex justify-between text-emerald-400"><span>Points</span><span>-{formatCurrency(cart.pointsDiscount)}</span></div>
          )}
          {selectedPromo && cart.promoDiscount > 0 && (
            <div className="flex justify-between text-emerald-400"><span>Promo ({selectedPromo.name})</span><span>-{formatCurrency(cart.promoDiscount)}</span></div>
          )}
          {cart.ppnAmount > 0 && (
            <div className="flex justify-between"><span className="text-slate-400">Pajak ({settings.settings.ppnRate}%)</span><span className="text-white">{formatCurrency(cart.ppnAmount)}</span></div>
          )}
          <Separator className="bg-white/[0.06]" />
          <div className="flex justify-between text-lg font-bold"><span className="text-white">Total</span><span className="theme-text">{formatCurrency(cart.total)}</span></div>
        </div>

        <Button className="w-full theme-bg hover:theme-hover text-white rounded-xl h-11" size="lg" disabled={cart.cart.length === 0 || cart.hasBelowHpp} onClick={onCheckout}>
          {cart.hasBelowHpp ? 'Harga di bawah HPP' : `Bayar — ${formatCurrency(cart.total)}`}
        </Button>
        {/* PR 4 — Hold / Tunda */}
        <Button
          variant="outline"
          className="w-full bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300 hover:text-white rounded-xl"
          size="sm"
          disabled={cart.cart.length === 0}
          onClick={checkout.handleHoldTransaction}
        >
          <Pause className="h-3.5 w-3.5 mr-1.5" />
          Tunda Transaksi
        </Button>
      </div>
    </div>
  )
}

// ==================== CART ITEM ROW ====================

function CartItemRow({ item, cart }: { item: CartItem; cart: ReturnType<typeof usePosCart> }) {
  const key = cart.getCartKey(item.product.id, item.variant?.id || null)
  const isEditingQty = cart.editingQtyId === item.product.id
  const isEditingPrice = cart.editingPriceId === key
  const price = item.variant ? item.variant.price : item.product.price
  const effPrice = item.customPrice != null ? item.customPrice : price

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03]">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{cart.getItemDisplayName(item)}</p>
        <div className="flex items-center gap-2 mt-1">
          {isEditingQty ? (
            <Input
              ref={cart.qtyInputRef}
              type="number"
              value={cart.editingQtyValue}
              onChange={(e) => cart.setEditingQtyValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') cart.confirmEditQty(); if (e.key === 'Escape') cart.cancelEditQty() }}
              onBlur={cart.confirmEditQty}
              className="h-6 w-14 text-xs bg-white/[0.04] border-white/[0.06] text-white"
            />
          ) : (
            <button onClick={() => cart.startEditQty(item.product.id, item.qty)} className="text-xs text-slate-400 hover:text-white">
              {item.qty}x
            </button>
          )}
          {isEditingPrice ? (
            <Input
              ref={cart.priceInputRef}
              type="number"
              value={cart.editingPriceValue}
              onChange={(e) => cart.setEditingPriceValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') cart.confirmEditPrice(); if (e.key === 'Escape') cart.cancelEditPrice() }}
              onBlur={cart.confirmEditPrice}
              className="h-6 w-20 text-xs bg-white/[0.04] border-white/[0.06] text-white"
            />
          ) : (
            <button onClick={() => cart.startEditPrice(key, effPrice)} className="text-xs text-slate-400 hover:text-white flex items-center gap-0.5">
              {formatCurrency(effPrice)} <Pencil className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-medium text-white">{formatCurrency(effPrice * item.qty)}</span>
        <button onClick={() => cart.removeFromCart(item.product.id, item.variant?.id || undefined)} className="text-slate-500 hover:text-red-400">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ==================== CUSTOMER SELECTOR ====================

function CustomerSelector({ customers }: { customers: ReturnType<typeof usePosCustomers> }) {
  return (
    <div className="p-3 border-b border-white/[0.06]">
      {customers.selectedCustomer ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-slate-400" />
            <div>
              <p className="text-sm font-medium text-white">{customers.selectedCustomer.name}</p>
              <p className="text-xs text-slate-400">{customers.selectedCustomer.points} points {customers.selectedCustomer.isLocal && <Badge variant="outline" className="ml-1 text-xs bg-white/[0.04] border-white/[0.06] text-slate-300">Offline</Badge>}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white hover:bg-white/[0.06]" onClick={() => customers.setSelectedCustomer(null)}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            placeholder="Cari pelanggan..."
            value={customers.customerSearch}
            onChange={(e) => { customers.setCustomerSearch(e.target.value); customers.setCustomerDropdownOpen(true) }}
            className="h-8 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-500"
          />
          <Button variant="outline" size="sm" className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300" onClick={() => customers.setAddCustomerOpen(true)}><UserPlus className="h-3.5 w-3.5" /></Button>
        </div>
      )}
      {customers.customerDropdownOpen && !customers.selectedCustomer && customers.filteredCustomers.length > 0 && (
        <div className="mt-1 border border-white/[0.06] rounded-md max-h-40 overflow-y-auto bg-nebula">
          {customers.filteredCustomers.slice(0, 8).map((c) => (
            <button
              key={c.id}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/[0.06] text-left text-slate-200"
              onClick={() => { customers.setSelectedCustomer(c); customers.setCustomerDropdownOpen(false); customers.setCustomerSearch('') }}
            >
              <span className="text-sm">{c.name}</span>
              {c.isLocal && <Badge variant="outline" className="text-xs bg-white/[0.04] border-white/[0.06] text-slate-300">Offline</Badge>}
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
              <Input className="bg-white/[0.04] border-white/[0.06] text-white" value={customers.newCustomer.name} onChange={(e) => customers.setNewCustomer({ ...customers.newCustomer, name: e.target.value })} />
            </div>
            <div>
              <Label className="text-slate-300">WhatsApp</Label>
              <Input className="bg-white/[0.04] border-white/[0.06] text-white" value={customers.newCustomer.whatsapp} onChange={(e) => customers.setNewCustomer({ ...customers.newCustomer, whatsapp: e.target.value })} />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" className="bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300" onClick={() => customers.setAddCustomerOpen(false)}>Batal</Button>
            <Button className="theme-bg hover:theme-hover text-white" onClick={customers.handleAddCustomer} disabled={customers.addingCustomer}>
              {customers.addingCustomer && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Simpan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}

// ==================== PROMO SELECTOR ====================

function PromoSelector({ promos, selected, onSelect, subtotal }: {
  promos: Array<{ id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null }>
  selected: { id: string; name: string } | null
  onSelect: (p: { id: string; name: string; type: string; value: number; minPurchase?: number | null; maxDiscount?: number | null } | null) => void
  subtotal: number
}) {
  if (promos.length === 0) return null
  return (
    <div className="flex items-center gap-2">
      <Tag className="h-4 w-4 theme-text" />
      <select
        className="h-7 text-xs rounded-md border border-white/[0.06] bg-white/[0.04] text-white px-2 flex-1"
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
    </div>
  )
}

// ==================== PAYMENT DIALOG BODY ====================

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
  return (
    <div className="space-y-4">
      <div className="text-center py-4">
        <p className="text-sm text-slate-400">Total Pembayaran</p>
        <p className="text-3xl font-bold theme-text">{formatCurrency(total)}</p>
      </div>
      <div>
        <Label className="text-slate-300">Metode Pembayaran</Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {availableMethods.map((m) => (
            <Button
              key={m}
              variant={paymentMethod === m ? 'default' : 'outline'}
              size="sm"
              className={paymentMethod === m
                ? 'theme-bg hover:theme-hover text-white border-transparent'
                : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300'}
              onClick={() => onSetPaymentMethod(m)}
            >{m}</Button>
          ))}
        </div>
      </div>
      {paymentMethod === 'CASH' && (
        <div>
          <Label className="text-slate-300">Jumlah Bayar</Label>
          <Input type="number" value={paidAmount} onChange={(e) => onSetPaidAmount(e.target.value)} placeholder="0" autoFocus className="bg-white/[0.04] border-white/[0.06] text-white" />
          <div className="flex gap-1 mt-2">
            {[total, 50000, 100000, 150000].filter((v, i, a) => a.indexOf(v) === i).map((amt) => (
              <Button key={amt} variant="outline" size="sm" className="text-xs bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] text-slate-300" onClick={() => onSetPaidAmount(String(amt))}>{formatCurrency(amt)}</Button>
            ))}
          </div>
          {Number(paidAmount) > 0 && (
            <p className="text-sm mt-2 flex justify-between"><span className="text-slate-400">Kembalian</span><span className="font-medium text-white">{formatCurrency(change)}</span></p>
          )}
        </div>
      )}
      <Button className="w-full theme-bg hover:theme-hover text-white rounded-xl h-11" size="lg" disabled={checkingOut || (paymentMethod === 'CASH' && Number(paidAmount) < total)} onClick={onCheckout}>
        {checkingOut && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Proses Pembayaran
      </Button>
    </div>
  )
}

// ==================== PR 4: Pending Row ====================

function PendingRow({ pending, onResume, onDelete }: {
  pending: PendingTransactionRow
  onResume: () => void
  onDelete: () => void
}) {
  const itemCount = pending.items.reduce((s, i) => s + i.qty, 0)
  const time = new Date(pending.createdAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="flex items-start gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.03]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white truncate">{pending.customerName || 'Walk-in'}</p>
          <Badge variant="outline" className="text-xs bg-white/[0.06] border-white/[0.08] text-slate-300">{itemCount} item</Badge>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{formatCurrency(pending.subtotal)} — {time}</p>
        {pending.note && <p className="text-xs text-amber-400 mt-0.5 truncate">Catatan: {pending.note}</p>}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button size="sm" className="theme-bg hover:theme-hover text-white" onClick={onResume}>Lanjutkan</Button>
        <Button size="sm" variant="ghost" className="text-slate-500 hover:text-red-400 hover:bg-red-500/10" onClick={onDelete}>
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
