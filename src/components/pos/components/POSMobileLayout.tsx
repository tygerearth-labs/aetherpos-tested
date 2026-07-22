'use client'

import { type RefObject, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Search, ShoppingCart } from 'lucide-react'
import CategoryFilter from './CategoryFilter'
import ProductGrid, { Pagination } from './ProductGrid'

export interface POSMobileLayoutProps {
  // Search
  searchInputRef: RefObject<HTMLInputElement>
  productSearch: string
  onSearchChange: (value: string) => void
  onSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void

  // Products
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

  // Cart (for floating button)
  cartItems: any[]
  cartTotal: number
  cartItemCount: number
  onMobileCartOpen: () => void

  // Display
  themeColors: any
  formatCurrency: (amount: number) => string
}

export function POSMobileLayout({
  // Search
  searchInputRef,
  productSearch,
  onSearchChange,
  onSearchKeyDown,
  // Products
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
  // Cart (for floating button)
  cartItems,
  cartTotal,
  cartItemCount,
  onMobileCartOpen,
  // Display
  themeColors,
  formatCurrency,
}: POSMobileLayoutProps) {
  return (
    <>
      {/* ══════ MOBILE LAYOUT — Product view + floating cart ══════ */}
      <div className="md:hidden shrink-0">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" strokeWidth={1.5} />
          <Input
            ref={searchInputRef}
            placeholder="Cari produk..."
            value={productSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="pl-10 h-11 text-sm bg-nebula/80 border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl"
          />
        </div>
        <CategoryFilter
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          onSelect={onCategorySelect}
          themeColors={themeColors}
        />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-2 pb-20">
          <div className="grid grid-cols-2 gap-2.5 pb-2">
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

      {/* Mobile Floating Cart Button */}
      {cartItemCount > 0 && (
        <button
          onClick={onMobileCartOpen}
          className="md:hidden fixed bottom-4 right-4 z-40 flex items-center gap-2 h-12 pl-4 pr-5 theme-gradient rounded-2xl shadow-lg theme-shadow active:scale-[0.97] transition-transform"
        >
          <ShoppingCart className="h-5 w-5 text-white" strokeWidth={1.5} />
          <span className="text-sm font-bold text-white">{cartItemCount} item</span>
          <span className="text-sm font-bold text-white/90 tabular-nums">{formatCurrency(cartTotal)}</span>
          <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold text-white">
            {cartItems.reduce((s: number, i: any) => s + i.qty, 0)}
          </span>
        </button>
      )}
    </>
  )
}

export default POSMobileLayout
