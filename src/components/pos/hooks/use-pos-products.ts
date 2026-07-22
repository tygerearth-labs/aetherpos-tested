/**
 * usePosProducts() — Product browsing, search, category filter, barcode detection, and variant selection for POS.
 *
 * Extracted from pos-page.tsx Phase 1A modularization.
 * Original lines: 67-116 (interfaces), 226-233 + 427-432 (states),
 *                 763-770 (categories), 773-835 (fetchProducts),
 *                 838-890 (debounce + barcode effects),
 *                 904-994 (search/category handlers),
 *                 1236-1288 (variant picker)
 *
 * @phase 1A — Move code without changing meaning
 * @boundary COCKPIT only — no engine imports
 */

'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { localDB } from '@/lib/local-db'

// ==================== INTERFACES (moved from pos-page.tsx) ====================

export interface ProductVariant {
  id: string
  name: string
  sku: string | null
  price: number
  hpp: number
  stock: number
}

export interface Product {
  id: string
  name: string
  price: number
  stock: number
  hpp: number
  sku: string | null
  barcode: string | null
  categoryId: string | null
  image: string | null
  hasVariants: boolean
  _variantCount: number
  variants: ProductVariant[]
}

export interface Category {
  id: string
  name: string
  color: string
}

export interface VariantPickerState {
  product: Product
  open: boolean
  variants: ProductVariant[]
  loading: boolean
}

// Re-export CartItem for type dependencies (owned by usePosCart, but referenced here)
export interface CartItem {
  product: Product
  variant: ProductVariant | null
  qty: number
  customPrice: number | null
}

// ==================== CONSTANTS ====================

const PRODUCTS_PER_PAGE = 24

// ==================== HOOK OPTIONS ====================

interface UsePosProductsOptions {
  /** Callback to add item to cart — provided by usePosCart */
  onAddToCart: (product: Product, qty?: number, variant?: ProductVariant) => void
  /** Callback to open variant picker with specific product */
  onOpenVariantPicker: (product: Product) => void
}

// ==================== HOOK RETURN ====================

interface UsePosProductsReturn {
  // State
  products: Product[]
  categories: Category[]
  productSearch: string
  productsLoading: boolean
  productPage: number
  totalProductPages: number
  selectedCategoryId: string | null
  variantPicker: VariantPickerState

  // Refs (exposed for parent coordination if needed)
  lastInputTimeRef: React.RefObject<number>
  inputCharCountRef: React.RefObject<number>
  barcodeDetectedRef: React.RefObject<boolean>

  // Actions
  setProductSearch: (value: string) => void
  setProductPage: (page: number) => void
  setSelectedCategoryId: (categoryId: string | null) => void
  setVariantPicker: (state: VariantPickerState) => void
  handleSearchChange: (value: string) => void
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => Promise<void>
  handleCategorySelect: (categoryId: string | null) => void
  openVariantPicker: (product: Product) => Promise<void>
  handleVariantSelect: (variant: ProductVariant) => void
  fetchProducts: (search: string, page: number, categoryId: string | null) => Promise<void>
}

// ==================== HOOK IMPLEMENTATION ====================

export function usePosProducts(options: UsePosProductsOptions): UsePosProductsReturn {
  const { onAddToCart, onOpenVariantPicker } = options

  // ── State (originally lines 226-233, 427-432) ──
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productsLoading, setProductsLoading] = useState(true)
  const [productPage, setProductPage] = useState(1)
  const [totalProductPages, setTotalProductPages] = useState(1)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [variantPicker, setVariantPicker] = useState<VariantPickerState>({
    product: null as unknown as Product,
    open: false,
    variants: [],
    loading: false,
  })

  // ── Refs for barcode detection (originally lines 190-192) ──
  const lastInputTimeRef = useRef<number>(0)
  const inputCharCountRef = useRef<number>(0)
  const barcodeDetectedRef = useRef(false)

  // Shared debounce timer ref (should be coordinated by parent or passed in)
  // For now, we maintain our own ref since the original code did so
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load categories from IndexedDB cache (originally lines 763-770) ──
  const loadCategoriesFromCache = useCallback(async () => {
    try {
      const cached = await localDB.categories.toArray()
      setCategories(cached as unknown as Category[])
    } catch { /* silent */ }
  }, [])

  useEffect(() => { loadCategoriesFromCache() }, [loadCategoriesFromCache])

  // ── Fetch products from IndexedDB with filtering/pagination/sort (originally lines 773-835) ──
  const fetchProducts = useCallback(async (search: string, page: number, categoryId: string | null) => {
    setProductsLoading(true)
    try {
      const allProducts = await localDB.products.toArray()

      let filtered = allProducts

      // Category filter
      if (categoryId) {
        filtered = filtered.filter(p => p.categoryId === categoryId)
      }

      // Search filter — also match variant SKUs, barcodes, unit, and category name
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.sku && p.sku.toLowerCase().includes(q)) ||
            (p.barcode && p.barcode.toLowerCase().includes(q)) ||
            (p.unit && p.unit.toLowerCase().includes(q)) ||
            (p.categoryName && p.categoryName.toLowerCase().includes(q)) ||
            // Match variant SKU, barcode, or name
            (p.hasVariants && p.variants && p.variants.some((v: any) =>
              (v.sku && v.sku.toLowerCase().includes(q)) ||
              (v.barcode && v.barcode.toLowerCase().includes(q)) ||
              v.name.toLowerCase().includes(q)
            ))
        )
      }

      // Helper: get aggregated stock (variant-aware)
      const getAggStock = (p: typeof filtered[number]) => {
        if (p.hasVariants && p.variants && p.variants.length > 0) {
          return p.variants.reduce((s: number, v: any) => s + (v.stock || 0), 0)
        }
        return p.stock || 0
      }

      // Sort: in-stock first (highest stock on top), out-of-stock at the bottom
      filtered.sort((a, b) => {
        const aStock = getAggStock(a)
        const bStock = getAggStock(b)
        const aInStock = aStock > 0
        const bInStock = bStock > 0
        if (aInStock !== bInStock) return aInStock ? -1 : 1
        // Within same stock status: highest stock first, then alphabetical
        const stockDiff = bStock - aStock
        if (stockDiff !== 0) return stockDiff
        return a.name.localeCompare(b.name)
      })

      const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE))
      const skip = (page - 1) * PRODUCTS_PER_PAGE
      const paged = filtered.slice(skip, skip + PRODUCTS_PER_PAGE)

      setProducts(paged)
      setTotalProductPages(totalPages)
    } catch {
      toast.error('Failed to load products')
    } finally {
      setProductsLoading(false)
    }
  }, [])

  // ── Debounced fetch effect (originally lines 838-845) ──
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    const timer = setTimeout(() => {
      fetchProducts(productSearch, productPage, selectedCategoryId)
    }, productSearch ? 200 : 0)
    debounceTimerRef.current = timer
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [productSearch, productPage, selectedCategoryId, fetchProducts])

  // ── Auto-add product when barcode detected and exactly 1 match (originally lines 848-890) ──
  useEffect(() => {
    if (
      barcodeDetectedRef.current &&
      products.length === 1 &&
      !productsLoading &&
      productSearch.trim().length >= 4
    ) {
      const product = products[0] as Product

      // Check for exact barcode/sku match (not just partial search match)
      const search = productSearch.trim().toLowerCase()
      const isExactMatch =
        (product.barcode && product.barcode.toLowerCase() === search) ||
        (product.sku && product.sku.toLowerCase() === search) ||
        (product.hasVariants && product.variants && product.variants.some((v: any) =>
          (v.sku && v.sku.toLowerCase() === search) || (v.barcode && v.barcode.toLowerCase() === search)
        )) ||
        product.name.toLowerCase() === search

      if (isExactMatch) {
        if (product.hasVariants) {
          const matchingVariant = product.variants?.find((v: any) =>
            (v.sku && v.sku.toLowerCase() === search) || (v.barcode && v.barcode.toLowerCase() === search)
          )
          if (matchingVariant) {
            onAddToCart(product, 1, matchingVariant)
            toast.success(`${product.name} - ${matchingVariant.name} ditambahkan`)
          } else {
            onOpenVariantPicker(product)
          }
        } else if (product.stock > 0) {
          onAddToCart(product)
          toast.success(`${product.name} ditambahkan`)
        }

        setProductSearch('')
        barcodeDetectedRef.current = false
        inputCharCountRef.current = 0
      }
    }
  }, [products, productsLoading, productSearch, onAddToCart, onOpenVariantPicker])

  // ── Handler: Search input change with barcode detection (originally lines 904-936) ──
  const handleSearchChange = (value: string) => {
    const now = Date.now()
    const prevLen = productSearch.length

    if (prevLen < value.length) {
      // Characters were added
      const charsAdded = value.length - prevLen
      if (charsAdded === 1) {
        const timeSinceLastInput = now - lastInputTimeRef.current
        if (timeSinceLastInput > 0 && timeSinceLastInput < 80) {
          inputCharCountRef.current++
          if (inputCharCountRef.current >= 3) {
            barcodeDetectedRef.current = true
          }
        } else {
          inputCharCountRef.current = 1
          barcodeDetectedRef.current = false
        }
      } else if (charsAdded > 1) {
        // Multiple chars pasted at once - treat as barcode
        barcodeDetectedRef.current = true
        inputCharCountRef.current = charsAdded
      }
    } else {
      // Characters were deleted - reset barcode detection
      inputCharCountRef.current = 0
      barcodeDetectedRef.current = false
    }

    lastInputTimeRef.current = now
    setProductSearch(value)
    setProductPage(1)
  }

  // ── Handler: Search key down (Enter for barcode/SKU lookup) (originally lines 938-989) ──
  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && productSearch.trim()) {
      const search = productSearch.trim()

      // Try direct barcode/SKU lookup from IndexedDB first (fast, no debounce)
      try {
        const allProducts = await localDB.products.toArray()
        // Check exact barcode match on product level
        const exactMatch = allProducts.find((p: any) =>
          p.barcode === search || p.sku === search ||
          (p.hasVariants && p.variants && p.variants.some((v: any) => v.sku === search))
        )
        if (exactMatch) {
          const product = exactMatch as unknown as Product
          if (product.hasVariants) {
            const matchingVariant = product.variants?.find((v: any) => v.sku === search)
            if (matchingVariant) {
              onAddToCart(product, 1, matchingVariant)
              setProductSearch('')
              toast.success(`${product.name} - ${matchingVariant.name} ditambahkan`)
              return
            }
            onOpenVariantPicker(product)
            setProductSearch('')
            return
          }
          if (product.stock > 0) {
            onAddToCart(product)
            setProductSearch('')
            toast.success(`${product.name} ditambahkan`)
            return
          }
          toast.error('Stok produk habis')
          setProductSearch('')
          return
        }
      } catch { /* fallback to UI list */ }

      // Fallback: check currently filtered products (for manual search + Enter)
      if (products.length === 1 && !productsLoading) {
        const product = products[0] as Product
        if (product.hasVariants) {
          onOpenVariantPicker(product)
          setProductSearch('')
        } else if (product.stock > 0) {
          onAddToCart(product)
          setProductSearch('')
          toast.success(`${product.name} ditambahkan`)
        }
      }
    }
  }

  // ── Handler: Category select (originally lines 991-994) ──
  const handleCategorySelect = (categoryId: string | null) => {
    setSelectedCategoryId(categoryId)
    setProductPage(1)
  }

  // ── Variant Picker: Open (originally lines 1238-1281) ──
  const openVariantPicker = async (product: Product) => {
    // Optimization: check if product already has variants loaded from cache
    const cachedVariants = product.variants && product.variants.length > 0 ? product.variants : null

    // If only 1 in-stock variant, add directly without opening picker
    if (cachedVariants) {
      const availableVariants = cachedVariants.filter(v => v.stock > 0)
      if (availableVariants.length === 1) {
        onAddToCart(product, 1, availableVariants[0])
        toast.success(`${product.name} - ${availableVariants[0].name} ditambahkan`)
        return
      }
      // Multiple variants — open picker with cached data (no loading)
      setVariantPicker({ product, open: true, variants: cachedVariants, loading: false })
      return
    }

    // No cached variants — fetch from API
    setVariantPicker({ product, open: true, variants: [], loading: true })
    try {
      const res = await fetch(`/api/products/${product.id}/variants`)
      if (res.ok) {
        const data = await res.json()
        const variants = data || []

        // If only 1 in-stock variant, add directly and close picker
        const availableVariants = variants.filter((v: ProductVariant) => v.stock > 0)
        if (availableVariants.length === 1) {
          setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })
          onAddToCart(product, 1, availableVariants[0])
          toast.success(`${product.name} - ${availableVariants[0].name} ditambahkan`)
          return
        }

        setVariantPicker((prev) => ({ ...prev, variants, loading: false }))
      } else {
        setVariantPicker((prev) => ({ ...prev, variants: [], loading: false }))
        toast.error('Gagal memuat varian')
      }
    } catch {
      setVariantPicker((prev) => ({ ...prev, variants: [], loading: false }))
      toast.error('Gagal memuat varian')
    }
  }

  // ── Variant Picker: Select variant (originally lines 1283-1288) ──
  const handleVariantSelect = (variant: ProductVariant) => {
    if (variant.stock <= 0) return
    onAddToCart(variantPicker.product, 1, variant)
    setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })
    toast.success(`${variantPicker.product.name} - ${variant.name} ditambahkan`)
  }

  return {
    // State
    products,
    categories,
    productSearch,
    productsLoading,
    productPage,
    totalProductPages,
    selectedCategoryId,
    variantPicker,

    // Refs
    lastInputTimeRef,
    inputCharCountRef,
    barcodeDetectedRef,

    // Setters
    setProductSearch,
    setProductPage,
    setSelectedCategoryId,
    setVariantPicker,

    // Handlers
    handleSearchChange,
    handleSearchKeyDown,
    handleCategorySelect,
    openVariantPicker,
    handleVariantSelect,
    fetchProducts,
  }
}
