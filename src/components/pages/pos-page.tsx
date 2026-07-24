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
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog'
import {
  Search, Plus, Minus, Trash2, ShoppingCart, Package, Loader2, Check, X,
  User, UserPlus, Coins, Wifi, WifiOff, RefreshCw, CloudOff, Tag, AlertTriangle,
  ChevronLeft, ChevronRight, Pencil,
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
    <div className="flex flex-col h-full bg-background">
      {/* ── Header: search + sync ── */}
      <div className="flex items-center gap-2 p-3 border-b bg-card">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari produk, SKU, atau barcode..."
            value={products.productSearch}
            onChange={(e) => products.handleSearchChange(e.target.value)}
            onKeyDown={products.handleSearchKeyDown}
            className="pl-9"
          />
        </div>
        <SyncButton sync={sync} />
      </div>

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-600 text-sm">
          <CloudOff className="h-4 w-4" />
          <span>Mode Offline — transaksi tersimpan lokal dan akan disinkronkan saat online</span>
        </div>
      )}

      {/* ── Deleted product warnings ── */}
      {cart.deletedCartWarnings.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 text-sm">
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
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : products.products.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-2 text-muted-foreground">
                <Package className="h-10 w-10" />
                <p>Tidak ada produk</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-3">
                {products.products.map((product) => (
                  <ProductCard key={product.id} product={product} onClick={() => handleProductClick(product)} />
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Pagination */}
          {products.totalProductPages > 1 && (
            <div className="flex items-center justify-center gap-2 p-2 border-t">
              <Button variant="outline" size="sm" onClick={() => products.setProductPage(Math.max(1, products.productPage - 1))} disabled={products.productPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">{products.productPage} / {products.totalProductPages}</span>
              <Button variant="outline" size="sm" onClick={() => products.setProductPage(Math.min(products.totalProductPages, products.productPage + 1))} disabled={products.productPage === products.totalProductPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* ── Right: cart (desktop) / hidden on mobile ── */}
        {!isMobile && (
          <div className="w-96 border-l flex flex-col bg-card">
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
        <div className="p-3 border-t bg-card">
          <Button className="w-full" onClick={() => checkout.setMobileCartOpen(true)}>
            <ShoppingCart className="h-4 w-4 mr-2" />
            {cart.cart.length} item — {formatCurrency(cart.total)}
          </Button>
        </div>
      )}

      {/* ── Mobile cart sheet ── */}
      {isMobile && (
        <ResponsiveDialog open={checkout.mobileCartOpen} onOpenChange={checkout.setMobileCartOpen}>
          <ResponsiveDialogContent className="h-[90vh]">
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
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="grid gap-2">
              {products.variantPicker.variants.map((v) => (
                <Button
                  key={v.id}
                  variant="outline"
                  className="justify-between"
                  disabled={v.stock <= 0}
                  onClick={() => products.handleVariantSelect(v)}
                >
                  <span className="flex flex-col items-start">
                    <span>{v.name}</span>
                    <span className="text-xs text-muted-foreground">{v.sku || '—'}</span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="font-medium">{formatCurrency(v.price)}</span>
                    <span className={cn('text-xs', v.stock > 0 ? 'text-emerald-600' : 'text-red-500')}>Stok: {v.stock}</span>
                  </span>
                </Button>
              ))}
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

      {/* ── Receipt dialog ── */}
      <ResponsiveDialog open={checkout.receiptDialogOpen} onOpenChange={checkout.setReceiptDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Transaksi Berhasil</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="text-lg font-semibold">{checkout.checkoutResult?.invoiceNumber}</p>
            {checkout.checkoutResult?.message && (
              <p className="text-sm text-muted-foreground">{checkout.checkoutResult.message}</p>
            )}
            <p className="text-2xl font-bold">{formatCurrency(cart.total)}</p>
          </div>
          <ResponsiveDialogFooter>
            <Button className="w-full" onClick={checkout.handleReceiptFinish}>Selesai</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
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
    synced: { icon: Check, color: 'text-emerald-600', bg: 'bg-emerald-500/10', label: 'Synced' },
    syncing: { icon: RefreshCw, color: 'text-blue-600', bg: 'bg-blue-500/10', label: 'Syncing...', spin: true },
    offline: { icon: WifiOff, color: 'text-red-600', bg: 'bg-red-500/10', label: 'Offline' },
    failed: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-500/10', label: `${sync.unsyncedCount} pending` },
    conflict: { icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-500/10', label: 'Conflict' },
  }[sync.syncStatus]

  const Icon = config.icon
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('gap-1.5', config.bg, config.color)}
      onClick={sync.handleSync}
      disabled={sync.syncing || !sync.isOnline}
    >
      <Icon className={cn('h-3.5 w-3.5', config.spin && 'animate-spin')} />
      <span className="text-xs">{config.label}</span>
      {sync.lastSyncAt && sync.syncStatus === 'synced' && (
        <span className="text-xs text-muted-foreground">{sync.timeAgo(sync.lastSyncAt)}</span>
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
    <div className="flex gap-2 p-2 overflow-x-auto border-b">
      <Button variant={selected === null ? 'default' : 'outline'} size="sm" onClick={() => onSelect(null)}>Semua</Button>
      {categories.map((c) => (
        <Button key={c.id} variant={selected === c.id ? 'default' : 'outline'} size="sm" onClick={() => onSelect(c.id)}>{c.name}</Button>
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
        'flex flex-col gap-1.5 p-3 rounded-lg border text-left transition-colors',
        outOfStock ? 'opacity-50 cursor-not-allowed bg-muted' : 'hover:bg-accent hover:border-primary/30 bg-card'
      )}
    >
      <div className="aspect-square rounded-md bg-muted flex items-center justify-center overflow-hidden">
        {product.image ? (
          <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <Package className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium line-clamp-2 leading-tight">{product.name}</p>
        {product.hasVariants ? (
          <p className="text-xs text-primary">Pilih Varian ({product._variantCount})</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-primary">{formatCurrency(product.price)}</p>
            <p className={cn('text-xs', product.stock > 0 ? 'text-muted-foreground' : 'text-red-500')}>Stok: {product.stock}</p>
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
    <div className="flex flex-col h-full">
      {/* Customer selector */}
      <CustomerSelector customers={customers} />

      {/* Cart items */}
      <ScrollArea className={cn('flex-1', isMobile && 'h-[40vh]')}>
        <div className="p-3 space-y-2">
          {cart.cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
              <ShoppingCart className="h-8 w-8" />
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
      <div className="border-t p-3 space-y-2 bg-card">
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
            <Label className="text-xs">Points ({customers.selectedCustomer.points})</Label>
            <Input type="number" value={pointsToUse} onChange={(e) => onPointsChange(e.target.value)} className="h-7 text-xs" max={cart.maxPointsToUse} />
            <span className="text-xs text-muted-foreground">-{formatCurrency(cart.pointsDiscount)}</span>
          </div>
        )}

        <Separator />

        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(cart.subtotal)}</span></div>
          {cart.manualDiscountTotal > 0 && (
            <div className="flex justify-between text-emerald-600"><span>Diskon Manual</span><span>-{formatCurrency(cart.manualDiscountTotal)}</span></div>
          )}
          {cart.pointsDiscount > 0 && (
            <div className="flex justify-between text-emerald-600"><span>Points</span><span>-{formatCurrency(cart.pointsDiscount)}</span></div>
          )}
          {selectedPromo && cart.promoDiscount > 0 && (
            <div className="flex justify-between text-emerald-600"><span>Promo ({selectedPromo.name})</span><span>-{formatCurrency(cart.promoDiscount)}</span></div>
          )}
          {cart.ppnAmount > 0 && (
            <div className="flex justify-between"><span className="text-muted-foreground">Pajak ({settings.settings.ppnRate}%)</span><span>{formatCurrency(cart.ppnAmount)}</span></div>
          )}
          <Separator />
          <div className="flex justify-between text-base font-bold"><span>Total</span><span className="text-primary">{formatCurrency(cart.total)}</span></div>
        </div>

        <Button className="w-full" size="lg" disabled={cart.cart.length === 0 || cart.hasBelowHpp} onClick={onCheckout}>
          {cart.hasBelowHpp ? 'Harga di bawah HPP' : `Bayar — ${formatCurrency(cart.total)}`}
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
    <div className="flex items-start gap-2 p-2 rounded-md border bg-background">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{cart.getItemDisplayName(item)}</p>
        <div className="flex items-center gap-2 mt-1">
          {isEditingQty ? (
            <Input
              ref={cart.qtyInputRef}
              type="number"
              value={cart.editingQtyValue}
              onChange={(e) => cart.setEditingQtyValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') cart.confirmEditQty(); if (e.key === 'Escape') cart.cancelEditQty() }}
              onBlur={cart.confirmEditQty}
              className="h-6 w-14 text-xs"
            />
          ) : (
            <button onClick={() => cart.startEditQty(item.product.id, item.qty)} className="text-xs text-muted-foreground hover:text-foreground">
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
              className="h-6 w-20 text-xs"
            />
          ) : (
            <button onClick={() => cart.startEditPrice(key, effPrice)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              {formatCurrency(effPrice)} <Pencil className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-medium">{formatCurrency(effPrice * item.qty)}</span>
        <button onClick={() => cart.removeFromCart(item.product.id, item.variant?.id || undefined)} className="text-red-500 hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ==================== CUSTOMER SELECTOR ====================

function CustomerSelector({ customers }: { customers: ReturnType<typeof usePosCustomers> }) {
  return (
    <div className="p-3 border-b">
      {customers.selectedCustomer ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{customers.selectedCustomer.name}</p>
              <p className="text-xs text-muted-foreground">{customers.selectedCustomer.points} points {customers.selectedCustomer.isLocal && <Badge variant="outline" className="ml-1 text-xs">Offline</Badge>}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => customers.setSelectedCustomer(null)}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            placeholder="Cari pelanggan..."
            value={customers.customerSearch}
            onChange={(e) => { customers.setCustomerSearch(e.target.value); customers.setCustomerDropdownOpen(true) }}
            className="h-8 text-sm"
          />
          <Button variant="outline" size="sm" onClick={() => customers.setAddCustomerOpen(true)}><UserPlus className="h-3.5 w-3.5" /></Button>
        </div>
      )}
      {customers.customerDropdownOpen && !customers.selectedCustomer && customers.filteredCustomers.length > 0 && (
        <div className="mt-1 border rounded-md max-h-40 overflow-y-auto bg-popover">
          {customers.filteredCustomers.slice(0, 8).map((c) => (
            <button
              key={c.id}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent text-left"
              onClick={() => { customers.setSelectedCustomer(c); customers.setCustomerDropdownOpen(false); customers.setCustomerSearch('') }}
            >
              <span className="text-sm">{c.name}</span>
              {c.isLocal && <Badge variant="outline" className="text-xs">Offline</Badge>}
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
              <Label>Nama *</Label>
              <Input value={customers.newCustomer.name} onChange={(e) => customers.setNewCustomer({ ...customers.newCustomer, name: e.target.value })} />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input value={customers.newCustomer.whatsapp} onChange={(e) => customers.setNewCustomer({ ...customers.newCustomer, whatsapp: e.target.value })} />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => customers.setAddCustomerOpen(false)}>Batal</Button>
            <Button onClick={customers.handleAddCustomer} disabled={customers.addingCustomer}>
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
      <Tag className="h-4 w-4 text-primary" />
      <select
        className="h-7 text-xs rounded-md border bg-background px-2 flex-1"
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
        <p className="text-sm text-muted-foreground">Total Pembayaran</p>
        <p className="text-3xl font-bold text-primary">{formatCurrency(total)}</p>
      </div>
      <div>
        <Label>Metode Pembayaran</Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {availableMethods.map((m) => (
            <Button key={m} variant={paymentMethod === m ? 'default' : 'outline'} size="sm" onClick={() => onSetPaymentMethod(m)}>{m}</Button>
          ))}
        </div>
      </div>
      {paymentMethod === 'CASH' && (
        <div>
          <Label>Jumlah Bayar</Label>
          <Input type="number" value={paidAmount} onChange={(e) => onSetPaidAmount(e.target.value)} placeholder="0" autoFocus />
          <div className="flex gap-1 mt-2">
            {[total, 50000, 100000, 150000].filter((v, i, a) => a.indexOf(v) === i).map((amt) => (
              <Button key={amt} variant="outline" size="sm" className="text-xs" onClick={() => onSetPaidAmount(String(amt))}>{formatCurrency(amt)}</Button>
            ))}
          </div>
          {Number(paidAmount) > 0 && (
            <p className="text-sm mt-2 flex justify-between"><span className="text-muted-foreground">Kembalian</span><span className="font-medium">{formatCurrency(change)}</span></p>
          )}
        </div>
      )}
      <Button className="w-full" size="lg" disabled={checkingOut || (paymentMethod === 'CASH' && Number(paidAmount) < total)} onClick={onCheckout}>
        {checkingOut && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Proses Pembayaran
      </Button>
    </div>
  )
}
