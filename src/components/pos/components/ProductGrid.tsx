'use client'

import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Package, Layers, ChevronLeft, ChevronRight } from 'lucide-react'
import { CATEGORY_COLORS } from './CategoryFilter'
export type { CategoryData, ThemeColors } from './CategoryFilter'

/**
 * Props for ProductGrid component
 */
export interface ProductGridProps {
  /** Array of products to display */
  products: any[]
  /** Whether products are currently loading */
  productsLoading: boolean
  /** Currently selected category filter */
  selectedCategoryId: string | null
  /** Current cart items */
  cart: any[]
  /** Available categories for color lookup */
  categories: Array<{ id: string; color: string }>
  /** Callback to add a product to cart */
  onAddToCart: (product: any) => void
  /** Callback to open variant picker for variant products */
  onOpenVariantPicker: (product: any) => void
  /** Function to get the display price of an item */
  getItemPrice: (item: any) => number
  /** Function to generate a unique cart key */
  getCartKey: (productId: string, variantId: string | null) => string
  /** Theme color classes */
  themeColors: any
  /** Currency formatting function */
  formatCurrency: (amount: number) => string
}

/**
 * Props for Pagination component
 */
export interface PaginationProps {
  /** Current page number (1-based) */
  currentPage: number
  /** Total number of pages */
  totalPages: boolean | number
  /** Whether there is an active search */
  hasSearch: boolean
  /** Whether data is loading */
  loading: boolean
  /** Callback for previous page */
  onPrev: () => void
  /** Callback for next page */
  onNext: () => void
}

/**
 * ProductGrid - Responsive grid of product cards for POS
 *
 * Displays products in a grid layout with:
 * - Loading skeleton states
 * - Empty state with message
 * - Product cards showing image, name, price, stock info
 * - Cart quantity badges
 * - Variant indicators for products with variants
 * - Out-of-stock styling
 *
 * @example
 * ```tsx
 * <ProductGrid
 *   products={products}
 *   productsLoading={loading}
 *   selectedCategoryId={categoryId}
 *   cart={cartItems}
 *   categories={categories}
 *   onAddToCart={addToCart}
 *   onOpenVariantPicker={openVariantPicker}
 *   getItemPrice={getPrice}
 *   getCartKey={getKey}
 *   themeColors={colors}
 *   formatCurrency={formatCurrency}
 * />
 * ```
 */
export default function ProductGrid({
  products,
  productsLoading,
  selectedCategoryId,
  cart,
  categories,
  onAddToCart,
  onOpenVariantPicker,
  themeColors,
}: ProductGridProps) {
  // Use imported CATEGORY_COLORS
  const COLORS = CATEGORY_COLORS

  if (productsLoading) {
    return (
      <>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[88px] md:h-[72px] rounded-xl aether-shimmer" />
        ))}
      </>
    )
  }

  if (products.length === 0) {
    return (
      <div className="col-span-full text-center py-12">
        <Package className="h-10 w-10 text-slate-600 mx-auto mb-2" strokeWidth={1.5} />
        <p className="text-xs text-slate-500">
          {selectedCategoryId ? 'Tidak ada produk di kategori ini' : 'Tidak ada produk ditemukan'}
        </p>
      </div>
    )
  }

  return (
    <>
      {products.map((product) => {
        const cartItemsForProduct = cart.filter((i) => i.product.id === product.id)
        const hasCartItems = cartItemsForProduct.length > 0
        const isVariantProduct = product.hasVariants && product._variantCount > 0

        const cartItem = !isVariantProduct ? cart.find((i) => i.product.id === product.id && !i.variant) : null
        const outOfStock = isVariantProduct
          ? product.variants.length > 0 && product.variants.every((v: any) => v.stock <= 0)
          : product.stock <= 0
        const catColor = product.categoryId && categories.find((c) => c.id === product.categoryId)?.color
        const accentColor = catColor ? (COLORS[catColor] || themeColors) : themeColors
        const lowStock = product.stock > 0 && product.stock <= 5

        const displayPrice = isVariantProduct
          ? (product.variants && product.variants.length > 0
            ? (() => {
                const prices = product.variants.map((v: any) => v.price)
                const min = Math.min(...prices)
                const max = Math.max(...prices)
                return min === max ? formatCurrency(min) : `${formatCurrency(min)} - ${formatCurrency(max)}`
              })()
            : formatCurrency(product.price))
          : formatCurrency(product.price)

        const totalCartQty = isVariantProduct
          ? cartItemsForProduct.reduce((sum: number, ci: any) => sum + ci.qty, 0)
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
                onClick={() => isVariantProduct ? onOpenVariantPicker(product) : onAddToCart(product)}
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
                      const availableCount = product.variants.filter((v: any) => v.stock > 0).length
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
      })}
    </>
  )
}

/**
 * Pagination - Page navigation controls for product listing
 *
 * Shows previous/next buttons and current page indicator.
 * Only renders when there are multiple pages or when search is active.
 *
 * @example
 * ```tsx
 * <Pagination
 *   currentPage={page}
 *   totalPages={totalPages}
 *   hasSearch={!!searchQuery}
 *   loading={isLoading}
 *   onPrev={() => setPage(p => p - 1)}
 *   onNext={() => setPage(p => p + 1)}
 * />
 * ```
 */
export function Pagination({
  currentPage,
  totalPages,
  hasSearch,
  loading,
  onPrev,
  onNext,
}: PaginationProps) {
  // Handle totalPages as boolean or number
  const totalPageNum = typeof totalPages === 'boolean' ? 1 : totalPages
  
  if (totalPageNum <= 1 && !hasSearch) return null

  return (
    <div className="flex items-center justify-between px-1 py-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={currentPage <= 1 || loading}
        className="bg-nebula border-white/[0.06] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 h-7 text-xs"
      >
        <ChevronLeft className="h-3 w-3 mr-1" strokeWidth={1.5} /> Prev
      </Button>
      <span className="text-[11px] text-slate-500 font-medium">{currentPage}/{totalPageNum}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={currentPage >= totalPageNum || loading}
        className="bg-nebula border-white/[0.06] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 h-7 text-xs"
      >
        Next <ChevronRight className="h-3 w-3 ml-1" strokeWidth={1.5} />
      </Button>
    </div>
  )
}
