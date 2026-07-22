'use client'

/**
 * POSDesktopLayout — Desktop two-column layout for POS page
 *
 * Extracted from pos-page.tsx (lines 583-814)
 * Renders the desktop view with product browser on left (3/5) and cart panel on right (2/5).
 *
 * This is a PURE LAYOUT COMPONENT — no business logic, no state management.
 * All state flows through props from parent.
 *
 * @module components/pos/components/POSDesktopLayout
 */

import React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search,
  ShoppingCart,
  ClockArrowDown,
  User,
  UserPlus,
  X,
  Check,
} from 'lucide-react'

// Sub-components
import CategoryFilter from './CategoryFilter'
import ProductGrid, { Pagination } from './ProductGrid'
import CartItemList from './CartItemList'
import CartSummary from './CartSummary'

// ==================== TYPES ====================

/** Customer data shape for inline selector */
export interface DesktopCustomerData {
  id: string
  name: string
  whatsapp: string
  points: number
}

/** Filtered customer item for dropdown */
export interface FilteredCustomerItem {
  id: string
  name: string
  whatsapp: string
  points: number
}

/** Theme colors object */
export interface ThemeColors {
  [key: string]: any
}

/** Props for POSDesktopLayout */
export interface POSDesktopLayoutProps {
  // === SEARCH ===
  searchInputRef: React.RefObject<HTMLInputElement>
  productSearch: string
  onSearchChange: (value: string) => void
  onSearchKeyDown: (e: React.KeyboardEvent) => void

  // === PRODUCTS ===
  products: any[]
  productsLoading: boolean
  selectedCategoryId: string | null
  categories: Array<{ id: string; name: string; color: string }>
  cart: any[]
  productPage: number
  totalProductPages: number | boolean
  productSearchActive: string
  onCategorySelect: (id: string | null) => void
  onAddToCart: (product: any) => void
  onOpenVariantPicker: (product: any) => void
  getItemPrice: (item: any) => number
  getCartKey: (productId: string, variantId: string | null) => string
  onProductPagePrev: () => void
  onProductPageNext: () => void

  // === CART ===
  cartItems: any[]
  subtotal: number
  total: number
  change: number
  manualDiscountTotal: number
  pointsDiscount: number
  ppnAmount: number
  hasBelowHpp: boolean
  belowHppItems: any[]
  maxPointsToUse: number
  pointsToUse: number
  editingQtyId: string | null
  editingQtyValue: number
  editingPriceId: string | null
  editingPriceValue: number
  priceInputRef: React.RefObject<HTMLInputElement>
  qtyInputRef: React.RefObject<HTMLInputElement>
  onUpdateQty: (productId: string, qty: number, variantId?: string) => void
  onRemoveFromCart: (productId: string, variantId?: string) => void
  onStartEditQty: (itemKey: string, value: number) => void
  onConfirmEditQty: () => void
  onCancelEditQty: () => void
  onStartEditPrice: (itemKey: string, value: number) => void
  onConfirmEditPrice: () => void
  onCancelEditPrice: () => void

  // === CUSTOMER (desktop inline version) ===
  selectedCustomer: DesktopCustomerData | null
  customerSearch: string
  filteredCustomers: FilteredCustomerItem[]
  customerDropdownOpen: boolean
  onCustomerSearchChange: (value: string) => void
  onCustomerDropdownOpen: (open: boolean) => void
  onSelectCustomer: (customer: any) => void
  onClearCustomer: () => void
  onAddCustomerOpen: () => void
  onSetPointsToUse: (points: number) => void

  // === CHECKOUT/ACTIONS ===
  paidAmount: string
  isProcessing: boolean
  promoDiscount: number
  selectedPromo: { id: string; name: string; type: string; discount: number; description: string } | null
  promoName?: string | null
  onHoldTransaction: () => void
  openPaymentDialog: () => void
  handlePointsChange: (val: string) => void
  setPaidAmount: (amount: string) => void

  // === SETTINGS ===
  themeColors: ThemeColors
  formatCurrency: (amount: number) => string
  ppnEnabled: boolean
  loyaltyEnabled: boolean
  ppnRate?: number
  customerPoints?: number
  loyaltyPointValue?: number
  manualDiscountEnabled: boolean
  batchInfo: Record<string, any>

  // === SYNC STATUS ===
  pendingCount: number
  onPendingListOpen: () => void
  onClearCart: () => void
}

// ==================== COMPONENT ====================

/**
 * POSDesktopLayout — Two-column desktop POS layout
 *
 * Renders:
 * - **Left Panel (3/5)**: Product browser with search, category filter, product grid, pagination
 * - **Right Panel (2/5)**: Cart panel with header, inline customer selector, cart items, summary, action buttons
 *
 * @example
 * ```tsx
 * <POSDesktopLayout
 *   searchInputRef={searchInputRef}
 *   productSearch={productsHook.productSearch}
 *   onSearchChange={(v) => productsHook.handleSearchChange(v)}
 *   onSearchKeyDown={productsHook.handleSearchKeyDown}
 *   products={productsHook.products}
 *   productsLoading={productsHook.productsLoading}
 *   selectedCategoryId={productsHook.selectedCategoryId}
 *   categories={productsHook.categories}
 *   cart={cartHook.cart}
 *   productPage={productsHook.productPage}
 *   totalProductPages={productsHook.totalProductPages}
 *   productSearchActive={productsHook.productSearch}
 *   onCategorySelect={(id) => productsHook.handleCategorySelect(id)}
 *   onAddToCart={cartHook.addToCart}
 *   onOpenVariantPicker={productsHook.openVariantPicker}
 *   getItemPrice={cartHook.getItemPrice}
 *   getCartKey={cartHook.getCartKey}
 *   onProductPagePrev={() => productsHook.setProductPage(p => Math.max(1, p - 1))}
 *   onProductPageNext={() => productsHook.setProductPage(p => Math.min(productsHook.totalProductPages, p + 1))}
 *   cartItems={cartHook.cart}
 *   subtotal={cartHook.subtotal}
 *   total={cartHook.total}
 *   change={cartHook.change}
 *   manualDiscountTotal={cartHook.manualDiscountTotal}
 *   pointsDiscount={cartHook.pointsDiscount}
 *   ppnAmount={cartHook.ppnAmount}
 *   hasBelowHpp={cartHook.hasBelowHpp}
 *   belowHppItems={cartHook.belowHppItems}
 *   maxPointsToUse={cartHook.maxPointsToUse}
 *   pointsToUse={cartHook.pointsToUse}
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
 *   selectedCustomer={customersHook.selectedCustomer}
 *   customerSearch={customersHook.customerSearch}
 *   filteredCustomers={customersHook.filteredCustomers}
 *   customerDropdownOpen={customersHook.customerDropdownOpen}
 *   onCustomerSearchChange={(v) => customersHook.setCustomerSearch(v)}
 *   onCustomerDropdownOpen={(open) => customersHook.setCustomerDropdownOpen(open)}
 *   onSelectCustomer={(c) => customersHook.setSelectedCustomer(c)}
 *   onClearCustomer={() => { customersHook.setSelectedCustomer(null); customersHook.setCustomerSearch(''); cartHook.setPointsToUse(0) }}
 *   onAddCustomerOpen={() => customersHook.setAddCustomerOpen(true)}
 *   onSetPointsToUse={cartHook.setPointsToUse}
 *   paidAmount={checkoutHook.paidAmount}
 *   isProcessing={checkoutHook.isProcessing}
 *   promoDiscount={promoDiscount}
 *   selectedPromo={selectedPromo}
 *   promoName={selectedPromo?.name}
 *   onHoldTransaction={checkoutHook.handleHoldTransaction}
 *   openPaymentDialog={checkoutHook.openPaymentDialog}
 *   handlePointsChange={checkoutHook.handlePointsChange}
 *   setPaidAmount={checkoutHook.setPaidAmount}
 *   themeColors={themeColors}
 *   formatCurrency={formatCurrency}
 *   ppnEnabled={settingsHook.settings.ppnEnabled}
 *   loyaltyEnabled={settingsHook.settings.loyaltyEnabled}
 *   ppnRate={settingsHook.settings.ppnRate}
 *   customerPoints={customersHook.selectedCustomer?.points}
 *   loyaltyPointValue={settingsHook.settings.loyaltyPointValue}
 *   manualDiscountEnabled={settingsHook.settings.manualDiscountEnabled}
 *   batchInfo={batchInfo}
 *   pendingCount={pendingCount}
 *   onPendingListOpen={() => sync.setPendingListOpen(true)}
 *   onClearCart={cartHook.clearCart}
 * />
 * ```
 */
export default function POSDesktopLayout({
  // SEARCH
  searchInputRef,
  productSearch,
  onSearchChange,
  onSearchKeyDown,

  // PRODUCTS
  products,
  productsLoading,
  selectedCategoryId,
  categories,
  cart,
  productPage,
  totalProductPages,
  productSearchActive,
  onCategorySelect,
  onAddToCart,
  onOpenVariantPicker,
  getItemPrice,
  getCartKey,
  onProductPagePrev,
  onProductPageNext,

  // CART
  cartItems,
  subtotal,
  total,
  change,
  manualDiscountTotal,
  pointsDiscount,
  ppnAmount,
  hasBelowHpp,
  belowHppItems,
  maxPointsToUse,
  pointsToUse,
  editingQtyId,
  editingQtyValue,
  editingPriceId,
  editingPriceValue,
  priceInputRef,
  qtyInputRef,
  onUpdateQty,
  onRemoveFromCart,
  onStartEditQty,
  onConfirmEditQty,
  onCancelEditQty,
  onStartEditPrice,
  onConfirmEditPrice,
  onCancelEditPrice,

  // CUSTOMER
  selectedCustomer,
  customerSearch,
  filteredCustomers,
  customerDropdownOpen,
  onCustomerSearchChange,
  onCustomerDropdownOpen,
  onSelectCustomer,
  onClearCustomer,
  onAddCustomerOpen,
  onSetPointsToUse,

  // CHECKOUT/ACTIONS
  paidAmount,
  isProcessing,
  promoDiscount,
  selectedPromo,
  promoName,
  onHoldTransaction,
  openPaymentDialog,
  handlePointsChange,
  setPaidAmount,

  // SETTINGS
  themeColors,
  formatCurrency,
  ppnEnabled,
  loyaltyEnabled,
  ppnRate,
  customerPoints,
  loyaltyPointValue,
  manualDiscountEnabled,
  batchInfo,

  // SYNC STATUS
  pendingCount,
  onPendingListOpen,
  onClearCart,
}: POSDesktopLayoutProps) {
  return (
    /* ══════ DESKTOP LAYOUT ══════ */
    <div className="hidden lg:grid lg:grid-cols-5 gap-3 flex-1 min-h-0">
      {/* Products - Left (3/5) */}
      <div className="lg:col-span-3 flex flex-col min-h-0">
        {/* Search */}
        <div className="relative mb-3 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" strokeWidth={1.5} />
          <Input
            ref={searchInputRef}
            placeholder="Scan barcode atau cari produk..."
            value={productSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="pl-10 h-10 text-sm bg-nebula/80 border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl"
          />
        </div>

        {/* Category Chips */}
        <div className="shrink-0">
          <CategoryFilter
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onSelect={onCategorySelect}
            themeColors={themeColors}
          />
        </div>

        {/* Product Grid — scrollable middle (pt-2 for badge clearance) */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-2">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 pb-2">
            <ProductGrid
              products={products}
              productsLoading={productsLoading}
              selectedCategoryId={selectedCategoryId}
              cart={cart}
              categories={categories}
              onAddToCart={onAddToCart}
              onOpenVariantPicker={onOpenVariantPicker}
              getItemPrice={getItemPrice}
              getCartKey={getCartKey}
              themeColors={themeColors}
              formatCurrency={formatCurrency}
            />
          </div>
        </div>

        {/* Pagination — fixed bottom */}
        <div className="shrink-0">
          <Pagination
            currentPage={productPage}
            totalPages={totalProductPages}
            hasSearch={!!productSearchActive}
            loading={productsLoading}
            onPrev={onProductPagePrev}
            onNext={onProductPageNext}
          />
        </div>
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
                {cart.length > 0 && (
                  <p className="text-[10px] text-slate-500 leading-tight">
                    {cart.length} produk · {cart.reduce((s, i) => s + i.qty, 0)} item
                  </p>
                )}
              </div>
            </div>
            {cart.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onPendingListOpen}
                  className={cn(
                    "relative flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-semibold transition-all",
                    pendingCount > 0
                      ? "text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15"
                      : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20"
                  )}
                >
                  <ClockArrowDown className="h-3 w-3" strokeWidth={1.5} />
                  {pendingCount > 0 && <span>{pendingCount}</span>}
                </button>
                <button
                  onClick={onClearCart}
                  className="h-7 px-2.5 rounded-lg text-[10px] font-semibold text-slate-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all"
                >
                  Hapus Semua
                </button>
              </div>
            )}
            {cart.length === 0 && pendingCount > 0 && (
              <button
                onClick={onPendingListOpen}
                className="relative flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-all"
              >
                <ClockArrowDown className="h-3 w-3" strokeWidth={1.5} />
                <span>{pendingCount} pending</span>
              </button>
            )}
          </div>
        </div>

        {/* Customer Selector — embedded at top of scrollable area */}
        <div className="shrink-0 px-4 pt-3 pb-1 relative">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
              Customer
            </span>
            <button
              onClick={onAddCustomerOpen}
              className="text-[10px] theme-text hover:theme-text font-semibold flex items-center gap-0.5 transition-colors"
            >
              <UserPlus className="h-2.5 w-2.5" strokeWidth={1.5} /> Baru
            </button>
          </div>
          <div className="relative">
            <User
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500"
              strokeWidth={1.5}
            />
            <Input
              placeholder={selectedCustomer ? selectedCustomer.name : 'Tambah customer (opsional)'}
              value={customerSearch}
              onChange={(e) => {
                onCustomerSearchChange(e.target.value)
                onCustomerDropdownOpen(true)
              }}
              onFocus={() => onCustomerDropdownOpen(true)}
              className="pl-9 pr-8 h-9 text-xs bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 rounded-xl"
            />
            {selectedCustomer && (
              <button
                onClick={onClearCustomer}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-white/[0.04] text-slate-400 hover:text-slate-200 transition-colors"
              >
                <X className="h-2.5 w-2.5" strokeWidth={1.5} />
              </button>
            )}
          </div>
          {customerDropdownOpen && filteredCustomers.length > 0 && !selectedCustomer && (
            <div className="absolute z-30 w-full mt-1 bg-nebula border border-white/[0.08] rounded-xl shadow-2xl shadow-black/50 max-h-40 overflow-y-auto">
              {filteredCustomers.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() => {
                    onSelectCustomer(customer)
                    onCustomerDropdownOpen(false)
                    onSetPointsToUse(0)
                  }}
                  className="w-full text-left px-3.5 py-2 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0 transition-colors"
                >
                  <p className="text-xs text-slate-200 font-medium">{customer.name}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {customer.whatsapp} · <span className="text-amber-400">{customer.points} pts</span>
                  </p>
                </button>
              ))}
            </div>
          )}
          {selectedCustomer && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg theme-bg-very-light border theme-border-light">
                <User className="h-2.5 w-2.5 theme-text" strokeWidth={1.5} />
                <span className="text-[10px] theme-text font-medium">{selectedCustomer.name}</span>
              </div>
              {selectedCustomer.points > 0 && (
                <span className="text-[10px] text-amber-400 font-medium">{selectedCustomer.points} pts</span>
              )}
            </div>
          )}
        </div>

        {/* Items — scrollable middle */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-white/[0.04] to-nebula border border-white/[0.04] flex items-center justify-center mb-4">
                <ShoppingCart className="h-8 w-8 text-slate-700/60" strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-slate-500">Keranjang Kosong</p>
              <p className="text-[11px] text-slate-600 mt-1">Pilih produk dari kiri untuk memulai</p>
            </div>
          ) : (
            <CartItemList
              cart={cart}
              compact={false}
              getCartKey={getCartKey}
              getItemPrice={getItemPrice}
              getEffectivePrice={(item: any) => item.customPrice ?? getItemPrice(item)}
              getItemStock={(item: any) => {
                if (item.variant) {
                  const v = item.product.variants?.find((v: any) => v.id === item.variant.id)
                  return v?.stock ?? 999
                }
                return item.product.stock ?? 999
              }}
              editingQtyId={editingQtyId}
              editingQtyValue={editingQtyValue}
              editingPriceId={editingPriceId}
              editingPriceValue={editingPriceValue}
              priceInputRef={priceInputRef}
              qtyInputRef={qtyInputRef}
              onUpdateQty={onUpdateQty}
              onRemoveFromCart={onRemoveFromCart}
              onStartEditQty={onStartEditQty}
              onConfirmEditQty={onConfirmEditQty}
              onCancelEditQty={onCancelEditQty}
              onStartEditPrice={onStartEditPrice}
              onConfirmEditPrice={onConfirmEditPrice}
              onCancelEditPrice={onCancelEditPrice}
              formatCurrency={formatCurrency}
              batchInfo={batchInfo}
              manualDiscountEnabled={manualDiscountEnabled}
            />
          )}
        </div>

        {/* Summary & Action Buttons — fixed bottom (NO inline payment) */}
        {cart.length > 0 && (
          <div className="shrink-0 border-t border-white/[0.06] bg-gradient-to-t from-deep-space to-nebula/80 p-4 space-y-3">
            <CartSummary
              subtotal={subtotal}
              manualDiscountTotal={manualDiscountTotal}
              pointsDiscount={pointsDiscount}
              promoDiscount={promoDiscount}
              ppnAmount={ppnAmount}
              total={total}
              paidAmount={paidAmount}
              change={change}
              hasBelowHpp={hasBelowHpp}
              belowHppItems={belowHppItems}
              maxPointsToUse={maxPointsToUse}
              pointsToUse={pointsToUse}
              ppnEnabled={ppnEnabled}
              loyaltyEnabled={loyaltyEnabled}
              ppnRate={ppnRate}
              customerPoints={customerPoints}
              loyaltyPointValue={loyaltyPointValue}
              promoName={promoName}
              onSetPointsToUse={(val) => handlePointsChange(String(val))}
              onSetPaidAmount={setPaidAmount}
              formatCurrency={formatCurrency}
            />
            <div className="flex gap-2">
              <Button
                onClick={onHoldTransaction}
                variant="outline"
                className="h-11 px-4 font-semibold text-sm rounded-xl border-white/[0.08] text-slate-300 hover:bg-white/[0.04] hover:text-white transition-all shrink-0"
              >
                <ClockArrowDown className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                Tunda
              </Button>
              <Button
                onClick={openPaymentDialog}
                disabled={cart.length === 0 || hasBelowHpp}
                className={`flex-1 h-11 font-bold text-sm rounded-xl transition-all ${
                  cart.length > 0 && !hasBelowHpp
                    ? 'theme-gradient hover:theme-hover text-white shadow-lg theme-shadow hover:theme-shadow active:scale-[0.99]'
                    : 'bg-white/[0.04] text-slate-500 cursor-not-allowed'
                }`}
              >
                <Check className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                {hasBelowHpp ? 'Harga di bawah HPP' : 'Proses Bayar'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
