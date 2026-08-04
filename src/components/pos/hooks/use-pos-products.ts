/**
 * usePosProducts() — Product browsing, search, barcode detection, and variant
 * selection for POS.
 *
 * PR 2 — Variant On-Demand:
 *   - Mount: fetch 24 featured PARENT products only (no variant preload)
 *   - Search: backend search parent products only
 *   - Click non-variant → add directly to cart
 *   - Click variant parent → GET /api/pos/products/:id/variants → picker
 *   - Exact variant SKU/barcode → bypass picker → add matched variant directly
 *
 * PR 3 — Offline:
 *   - Online: backend response → render → save working set to Dexie (posProducts)
 *   - Offline: Dexie data → search cached products → open cached variants
 *
 * @boundary COCKPIT only — no engine imports
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { tryGetPosDB, cacheProducts, cacheVariants, type CachedPosProduct, type CachedPosVariant } from '@/lib/pos/pos-db'

// ==================== INTERFACES ====================

export interface ProductVariant {
  id: string
  name: string
  sku: string | null
  barcode: string | null
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
  categoryName: string | null
  image: string | null
  unit: string
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
  onAddToCart: (product: Product, qty?: number, variant?: ProductVariant) => void
  onOpenVariantPicker: (product: Product) => void
  isOnline: boolean
  /** Page size for product pagination. Defaults to 24. Pass 10 on mobile for a
   *  denser, scrollable single-screen experience. */
  pageSize?: number
}

// ==================== HOOK RETURN ====================

interface UsePosProductsReturn {
  products: Product[]
  outOfStockProducts: Product[]
  categories: Category[]
  productSearch: string
  productsLoading: boolean
  productPage: number
  totalProductPages: number
  selectedCategoryId: string | null
  variantPicker: VariantPickerState
  lastInputTimeRef: React.RefObject<number>
  inputCharCountRef: React.RefObject<number>
  barcodeDetectedRef: React.RefObject<boolean>
  setProductSearch: (value: string) => void
  setProductPage: (page: number) => void
  setSelectedCategoryId: (categoryId: string | null) => void
  setVariantPicker: (state: VariantPickerState) => void
  handleSearchChange: (value: string) => void
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => Promise<void>
  /** Camera/barcode scanner result handler — looks up the code and adds to cart. */
  handleScanResult: (code: string) => Promise<void>
  handleCategorySelect: (categoryId: string | null) => void
  openVariantPicker: (product: Product) => Promise<void>
  handleVariantSelect: (variant: ProductVariant) => void
  fetchFeatured: () => Promise<void>
  refreshProducts: () => Promise<void>
  /** Patch the React product-grid state from updatedStock (no network refetch).
   *  Used after checkout when the sync response included updatedStock and the
   *  Dexie cache was already patched. Without this, the UI shows stale stock
   *  because the product grid uses useState (not useLiveQuery). */
  patchProductStock: (stock: { products: Record<string, number>; variants: Record<string, number> }) => void
}

// ==================== HOOK IMPLEMENTATION ====================

export function usePosProducts(options: UsePosProductsOptions): UsePosProductsReturn {
  const { onAddToCart, onOpenVariantPicker, isOnline } = options
  const pageSize = options.pageSize ?? PRODUCTS_PER_PAGE

  const [products, setProducts] = useState<Product[]>([])
  const [outOfStockProducts, setOutOfStockProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productsLoading, setProductsLoading] = useState(true)
  const [productPage, setProductPage] = useState(1)
  const [totalProductPages, setTotalProductPages] = useState(1)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [variantPicker, setVariantPicker] = useState<VariantPickerState>({
    product: null as unknown as Product, open: false, variants: [], loading: false,
  })

  const lastInputTimeRef = useRef<number>(0)
  const inputCharCountRef = useRef<number>(0)
  const barcodeDetectedRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load categories (online: /api/categories; offline: Dexie) ──
  const loadCategories = useCallback(async () => {
    try {
      if (isOnline) {
        const res = await fetch('/api/categories')
        if (res.ok) {
          const data = await res.json()
          const cats: Category[] = (data.categories || []).map((c: Record<string, unknown>) => ({
            id: c.id as string, name: c.name as string, color: (c.color as string) || 'zinc',
          }))
          setCategories(cats)
          // Cache to posDB
          const db = tryGetPosDB()
          if (db && cats.length > 0) {
            await db.categories.clear()
            await db.categories.bulkPut(cats.map(c => ({ ...c, cachedAt: Date.now() })))
          }
        }
      } else {
        const db = tryGetPosDB()
        if (db) {
          const cached = await db.categories.toArray()
          setCategories(cached.map(c => ({ id: c.id, name: c.name, color: c.color })))
        }
      }
    } catch { /* silent */ }
  }, [isOnline])

  useEffect(() => { loadCategories() }, [loadCategories])

  // ── PR 2: Fetch featured parent products (24, no variant preload) ──
  const fetchFeatured = useCallback(async () => {
    setProductsLoading(true)
    try {
      if (isOnline) {
        const res = await fetch(`/api/pos/products/featured?limit=${pageSize}`)
        if (res.ok) {
          const data = await res.json()
          const prods: Product[] = (data.products || []).map(mapApiProduct)
          setProducts(prods.slice(0, pageSize))
          // Out-of-stock products (from backend) for the "Stok Habis" section
          const oos: Product[] = (data.outOfStockProducts || []).map(mapApiProduct)
          setOutOfStockProducts(oos.slice(0, 8))
          setTotalProductPages(1)
          // PR 3: cache working set to Dexie
          await cacheProducts(prods.map(toCachedPosProduct), 'featured')
        }
      } else {
        // Offline: read from Dexie posProducts
        const db = tryGetPosDB()
        if (db) {
          const cached = await db.posProducts.toArray()
          const prods = cached.map(fromCachedPosProduct)
          // Split: in-stock in main list, out-of-stock separately
          const inStock = prods.filter(p => p.hasVariants || p.stock > 0)
          const oos = prods.filter(p => !p.hasVariants && p.stock <= 0)
          inStock.sort((a, b) => a.name.localeCompare(b.name))
          oos.sort((a, b) => a.name.localeCompare(b.name))
          setProducts(inStock.slice(0, pageSize))
          setOutOfStockProducts(oos.slice(0, 8))
          setTotalProductPages(1)
        }
      }
    } catch {
      toast.error('Gagal memuat produk')
    } finally {
      setProductsLoading(false)
    }
  }, [isOnline, pageSize])

  // ── PR 2: Backend search (parent products only) ──
  const fetchSearch = useCallback(async (search: string, page: number, categoryId: string | null) => {
    setProductsLoading(true)
    try {
      if (isOnline) {
        const params = new URLSearchParams()
        if (search.trim()) params.set('q', search.trim())
        params.set('limit', String(pageSize))
        params.set('page', String(page))
        if (categoryId) params.set('categoryId', categoryId)
        const res = await fetch(`/api/pos/products/search?${params}`)
        if (res.ok) {
          const data = await res.json()
          const prods: Product[] = (data.products || []).map(mapApiProduct)
          // Split search results: in-stock in main list, out-of-stock separately
          const inStock = prods.filter(p => p.hasVariants || p.stock > 0)
          const oos = prods.filter(p => !p.hasVariants && p.stock <= 0)
          setProducts(inStock)
          setOutOfStockProducts(oos.slice(0, 8))
          setTotalProductPages(data.totalPages || 1)
          // PR 3: cache search results to Dexie
          await cacheProducts(prods.map(toCachedPosProduct), 'search')
        }
      } else {
        // Offline: search cached posProducts
        const db = tryGetPosDB()
        if (db) {
          let cached = await db.posProducts.toArray()
          if (categoryId) cached = cached.filter(p => p.categoryId === categoryId)
          if (search.trim()) {
            const q = search.trim().toLowerCase()
            cached = cached.filter(p =>
              p.name.toLowerCase().includes(q) ||
              (p.sku && p.sku.toLowerCase().includes(q)) ||
              (p.barcode && p.barcode.toLowerCase().includes(q)) ||
              (p.categoryName && p.categoryName.toLowerCase().includes(q))
            )
          }
          const total = cached.length
          const totalPages = Math.max(1, Math.ceil(total / pageSize))
          const skip = (page - 1) * pageSize
          const pageItems = cached.slice(skip, skip + pageSize).map(fromCachedPosProduct)
          const inStock = pageItems.filter(p => p.hasVariants || p.stock > 0)
          const oos = pageItems.filter(p => !p.hasVariants && p.stock <= 0)
          setProducts(inStock)
          setOutOfStockProducts(oos.slice(0, 8))
          setTotalProductPages(totalPages)
        }
      }
    } catch {
      toast.error('Gagal mencari produk')
    } finally {
      setProductsLoading(false)
    }
  }, [isOnline, pageSize])

  // ── Debounced fetch effect ──
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    const timer = setTimeout(() => {
      if (productSearch.trim() || selectedCategoryId) {
        fetchSearch(productSearch, productPage, selectedCategoryId)
      } else {
        fetchFeatured()
      }
    }, productSearch ? 300 : 0)
    debounceTimerRef.current = timer
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [productSearch, productPage, selectedCategoryId, fetchFeatured, fetchSearch])

  // ── PR 2: Barcode/SKU exact lookup (bypass picker for variant match) ──
  const lookupProduct = useCallback(async (code: string): Promise<{ product: Product | null; matchedVariantId: string | null }> => {
    if (isOnline) {
      try {
        const res = await fetch(`/api/pos/products/lookup?code=${encodeURIComponent(code)}`)
        if (res.ok) {
          const data = await res.json()
          if (data.product) {
            const product = mapApiProduct(data.product)
            // Cache the looked-up product
            await cacheProducts([toCachedPosProduct(product)], 'lookup')
            return { product, matchedVariantId: data.matchedVariantId || null }
          }
        }
      } catch { /* fall through to offline */ }
    }
    // Offline: search cached posProducts + posVariants
    // Priority per AETHER CAMERA BARCODE SCANNER contract:
    //   1. Variant.barcode  2. Product.barcode  3. Variant.sku  4. Product.sku
    const db = tryGetPosDB()
    if (db) {
      const cached = await db.posProducts.toArray()
      const variants = await db.posVariants.toArray()
      // #1: Variant barcode
      let vMatch = variants.find(v => v.barcode === code)
      if (vMatch) {
        const parent = cached.find(p => p.id === vMatch.productId)
        if (parent) return { product: fromCachedPosProduct(parent), matchedVariantId: vMatch.id }
      }
      // #2: Product barcode
      let prodMatch = cached.find(p => p.barcode === code)
      if (prodMatch) return { product: fromCachedPosProduct(prodMatch), matchedVariantId: null }
      // #3: Variant sku
      vMatch = variants.find(v => v.sku === code)
      if (vMatch) {
        const parent = cached.find(p => p.id === vMatch.productId)
        if (parent) return { product: fromCachedPosProduct(parent), matchedVariantId: vMatch.id }
      }
      // #4: Product sku
      prodMatch = cached.find(p => p.sku === code)
      if (prodMatch) return { product: fromCachedPosProduct(prodMatch), matchedVariantId: null }
    }
    return { product: null, matchedVariantId: null }
  }, [isOnline])

  // ── Barcode detection handler ──
  const handleSearchChange = (value: string) => {
    const now = Date.now()
    const prevLen = productSearch.length
    if (prevLen < value.length) {
      const charsAdded = value.length - prevLen
      if (charsAdded === 1) {
        const timeSinceLastInput = now - lastInputTimeRef.current
        if (timeSinceLastInput > 0 && timeSinceLastInput < 80) {
          inputCharCountRef.current++
          if (inputCharCountRef.current >= 3) barcodeDetectedRef.current = true
        } else {
          inputCharCountRef.current = 1
          barcodeDetectedRef.current = false
        }
      } else if (charsAdded > 1) {
        barcodeDetectedRef.current = true
        inputCharCountRef.current = charsAdded
      }
    } else {
      inputCharCountRef.current = 0
      barcodeDetectedRef.current = false
    }
    lastInputTimeRef.current = now
    setProductSearch(value)
    setProductPage(1)
  }

  // ── Enter key: exact barcode/SKU lookup ──
  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && productSearch.trim()) {
      const code = productSearch.trim()
      const { product, matchedVariantId } = await lookupProduct(code)
      if (product) {
        if (matchedVariantId) {
          // PR 2: exact variant match → bypass picker, add directly
          // Fetch variant detail (online: /api/pos/products/:id/variants; offline: Dexie)
          const variants = await fetchVariants(product.id)
          const variant = variants.find(v => v.id === matchedVariantId)
          if (variant && variant.stock > 0) {
            onAddToCart(product, 1, variant)
            toast.success(`${product.name} - ${variant.name} ditambahkan`)
          } else {
            toast.error('Stok varian habis')
          }
        } else if (product.hasVariants) {
          // Parent barcode match but has variants → open picker
          onOpenVariantPicker(product)
        } else if (product.stock > 0) {
          onAddToCart(product)
          toast.success(`${product.name} ditambahkan`)
        } else {
          toast.error('Stok produk habis')
        }
        setProductSearch('')
      } else if (products.length === 1 && !productsLoading) {
        // Fallback: single filtered result
        const p = products[0]
        if (p.hasVariants) {
          onOpenVariantPicker(p)
        } else if (p.stock > 0) {
          onAddToCart(p)
          toast.success(`${p.name} ditambahkan`)
        }
        setProductSearch('')
      }
    }
  }

  // ── Auto-add on barcode detection (single match) ──
  useEffect(() => {
    if (barcodeDetectedRef.current && products.length === 1 && !productsLoading && productSearch.trim().length >= 4) {
      const product = products[0]
      const search = productSearch.trim().toLowerCase()
      const isExactMatch =
        (product.barcode && product.barcode.toLowerCase() === search) ||
        (product.sku && product.sku.toLowerCase() === search) ||
        product.name.toLowerCase() === search
      if (isExactMatch) {
        if (product.hasVariants) {
          // Variant parent exact match → need variant lookup
          lookupProduct(productSearch.trim()).then(({ matchedVariantId }) => {
            if (matchedVariantId) {
              fetchVariants(product.id).then(variants => {
                const v = variants.find(vv => vv.id === matchedVariantId)
                if (v && v.stock > 0) {
                  onAddToCart(product, 1, v)
                  toast.success(`${product.name} - ${v.name} ditambahkan`)
                }
              })
            } else {
              onOpenVariantPicker(product)
            }
          })
        } else if (product.stock > 0) {
          onAddToCart(product)
          toast.success(`${product.name} ditambahkan`)
        }
        setProductSearch('')
        barcodeDetectedRef.current = false
        inputCharCountRef.current = 0
      }
    }
  }, [products, productsLoading, productSearch, onAddToCart, onOpenVariantPicker, lookupProduct])

  // ── PR 2: Fetch variants on-demand (for picker) ──
  const fetchVariants = useCallback(async (productId: string): Promise<ProductVariant[]> => {
    // Check Dexie cache first
    const db = tryGetPosDB()
    if (db) {
      const cached = await db.posVariants.where('productId').equals(productId).toArray()
      if (cached.length > 0) {
        return cached.map(fromCachedPosVariant)
      }
    }
    // Fetch from API
    if (isOnline) {
      try {
        const res = await fetch(`/api/pos/products/${productId}/variants`)
        if (res.ok) {
          const data = await res.json()
          const variants: ProductVariant[] = (data.variants || []).map(mapApiVariant)
          // Cache to Dexie
          await cacheVariants(productId, variants.map(toCachedPosVariant))
          return variants
        }
      } catch { /* fall through */ }
    }
    return []
  }, [isOnline])

  // ── PR 2: Open variant picker (on-demand fetch) ──
  const openVariantPicker = useCallback(async (product: Product) => {
    setVariantPicker({ product, open: true, variants: [], loading: true })
    const variants = await fetchVariants(product.id)
    // If only 1 in-stock variant, add directly without opening picker
    const available = variants.filter(v => v.stock > 0)
    if (available.length === 1) {
      setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })
      onAddToCart(product, 1, available[0])
      toast.success(`${product.name} - ${available[0].name} ditambahkan`)
      return
    }
    setVariantPicker((prev) => ({ ...prev, variants, loading: false }))
  }, [fetchVariants, onAddToCart])

  // ── Variant select ──
  const handleVariantSelect = (variant: ProductVariant) => {
    if (variant.stock <= 0) return
    onAddToCart(variantPicker.product, 1, variant)
    setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })
    toast.success(`${variantPicker.product.name} - ${variant.name} ditambahkan`)
  }

  const handleCategorySelect = (categoryId: string | null) => {
    setSelectedCategoryId(categoryId)
    setProductPage(1)
  }

  const refreshProducts = useCallback(async () => {
    if (productSearch.trim() || selectedCategoryId) {
      await fetchSearch(productSearch, productPage, selectedCategoryId)
    } else {
      await fetchFeatured()
    }
  }, [productSearch, productPage, selectedCategoryId, fetchFeatured, fetchSearch])

  /**
   * Patch the React product-grid state from the sync response's updatedStock.
   *
   * This is the UI half of the Phase 2 optimization (rule 10). The sync route
   * returns updatedStock → doSyncOutbox patches Dexie → THIS function patches
   * the React `products` state so the grid reflects the new stock immediately,
   * without a full catalog refetch (which was the 200-400ms slow path).
   *
   * What it patches:
   *  - products[]: simple-product stock (productId in stock.products)
   *  - products[]: variant-parent stock (recalculated as SUM of variant stock
   *    from stock.variants — matches the server's variant-parent recalculation)
   *  - outOfStockProducts[]: moved to products if stock rose above 0, or vice
   *    versa (keeps the "Stok habis" grid consistent)
   *
   * What it does NOT do:
   *  - No network fetch (pure local state update — O(n) in products.length)
   *  - No Dexie write (doSyncOutbox already did that)
   *  - No category/search refilter (the grid is already showing these products;
   *    only their stock field changes)
   */
  const patchProductStock = useCallback((stock: { products: Record<string, number>; variants: Record<string, number> }) => {
    const prodEntries = Object.entries(stock.products || {})
    const varEntries = Object.entries(stock.variants || {})
    if (prodEntries.length === 0 && varEntries.length === 0) return

    // Build a map of variantId → stock for variant-parent recalculation
    const varStockMap = new Map<string, number>(varEntries)

    setProducts(prev => prev.map(p => {
      // Simple product: direct stock patch
      if (stock.products[p.id] != null) {
        return { ...p, stock: stock.products[p.id] }
      }
      // Variant parent: recalc stock as SUM of its variants' patched stock.
      // Only recalc if at least one variant was patched (otherwise leave as-is;
      // the parent's variants weren't in this transaction).
      if (p.hasVariants && p.variants && p.variants.length > 0) {
        const patchedVariants = p.variants.filter(v => varStockMap.has(v.id))
        if (patchedVariants.length > 0) {
          // Merge patched variant stock with existing variant stock
          const updatedVariants = p.variants.map(v =>
            varStockMap.has(v.id) ? { ...v, stock: varStockMap.get(v.id)! } : v
          )
          const newParentStock = updatedVariants.reduce((sum, v) => sum + v.stock, 0)
          return { ...p, stock: newParentStock, variants: updatedVariants }
        }
      }
      return p
    }))

    // Also patch outOfStockProducts (in case stock rose above 0)
    if (prodEntries.length > 0) {
      setOutOfStockProducts(prev => prev.map(p => {
        if (stock.products[p.id] != null) {
          return { ...p, stock: stock.products[p.id] }
        }
        return p
      }))
    }
  }, [])

  // ── Phase 7 resolver: exact barcode/SKU lookup → structured LookupResult ──
  // Used by BarcodeScannerDialog for telemetry + Phase 8 context-action pipeline.
  // Returns { status, entityType, productId, variantId?, barcode }.
  const resolveBarcode = useCallback(async (code: string): Promise<{
    status: 'FOUND' | 'NOT_FOUND'
    entityType?: 'PRODUCT' | 'VARIANT'
    productId?: string
    variantId?: string
    barcode: string
  }> => {
    const trimmed = code.trim()
    if (!trimmed) return { status: 'NOT_FOUND', barcode: code }
    const { product, matchedVariantId } = await lookupProduct(trimmed)
    if (!product) return { status: 'NOT_FOUND', barcode: trimmed }
    return {
      status: 'FOUND',
      entityType: matchedVariantId ? 'VARIANT' : 'PRODUCT',
      productId: product.id,
      variantId: matchedVariantId ?? undefined,
      barcode: trimmed,
    }
  }, [lookupProduct])

  // ── Phase 8 context-action: take a LookupResult → add to cart + toast ──
  // Used by BarcodeScannerDialog's onContextAction prop. Returns `true` when
  // the item was added to cart (or the variant picker was opened as a clean
  // handoff), so the dialog can auto-close on success when `closeOnSuccess`
  // is set. Returns `false` (without throwing) on out-of-stock / not-found so
  // the dialog stays open for re-scan.
  const applyLookupToCart = useCallback(async (lookup: {
    status: 'FOUND' | 'NOT_FOUND'
    entityType?: 'PRODUCT' | 'VARIANT'
    productId?: string
    variantId?: string
    barcode: string
  }): Promise<boolean> => {
    if (lookup.status !== 'FOUND' || !lookup.productId) return false
    // Re-fetch the full product (resolver only returned id + entityType).
    const { product, matchedVariantId } = await lookupProduct(lookup.barcode)
    if (!product) {
      // LOOKUP ERROR — keep scanner open.
      toast.error('Produk tidak ditemukan')
      return false
    }
    const effectiveVariantId = lookup.variantId ?? matchedVariantId
    if (effectiveVariantId) {
      const variants = await fetchVariants(product.id)
      const variant = variants.find(v => v.id === effectiveVariantId)
      if (variant && variant.stock > 0) {
        onAddToCart(product, 1, variant)
        toast.success(`${product.name} - ${variant.name} ditambahkan`)
        setProductSearch('')
        return true
      }
      // CART ACTION ERROR (out of stock) — keep scanner open.
      toast.error('Stok varian habis')
      return false
    } else if (product.hasVariants) {
      // No specific variant matched — hand off to the variant picker.
      // Treated as success for the scanner (clean focus handoff); the
      // operator completes the add-to-cart in the picker.
      onOpenVariantPicker(product)
      setProductSearch('')
      return true
    } else if (product.stock > 0) {
      onAddToCart(product)
      toast.success(`${product.name} ditambahkan`)
      setProductSearch('')
      return true
    } else {
      // CART ACTION ERROR (out of stock) — keep scanner open.
      toast.error('Stok produk habis')
      return false
    }
  }, [lookupProduct, fetchVariants, onAddToCart, onOpenVariantPicker])

  // ── Camera scanner result: exact barcode/SKU lookup → add to cart ──
  // Legacy path — does the full pipeline inline. Kept for backward compat
  // (e.g. if a parent wires only onResult without resolver + onContextAction).
  // POS now uses resolveBarcode + applyLookupToCart via the dialog's full
  // pipeline mode, but handleScanResult remains the simple-path fallback.
  const handleScanResult = useCallback(async (code: string) => {
    const trimmed = code.trim()
    if (!trimmed) return
    const lookup = await resolveBarcode(trimmed)
    await applyLookupToCart(lookup)
  }, [resolveBarcode, applyLookupToCart])

  return {
    products, outOfStockProducts, categories, productSearch, productsLoading, productPage, totalProductPages,
    selectedCategoryId, variantPicker,
    lastInputTimeRef, inputCharCountRef, barcodeDetectedRef,
    setProductSearch, setProductPage, setSelectedCategoryId, setVariantPicker,
    handleSearchChange, handleSearchKeyDown, handleScanResult, handleCategorySelect,
    openVariantPicker, handleVariantSelect, fetchFeatured, refreshProducts, patchProductStock,
    // Exposed for BarcodeScannerDialog full-pipeline mode (Phases 7 + 8):
    //   resolveBarcode → resolver (Phase 7 lookup contract)
    //   applyLookupToCart → onContextAction (Phase 8 POS adapter)
    //   lookupProduct → test-mode resolver (Phase 6)
    resolveBarcode, applyLookupToCart, lookupProduct,
  }
}

// ==================== MAPPERS ====================

function mapApiProduct(p: Record<string, unknown>): Product {
  return {
    id: p.id as string,
    name: p.name as string,
    price: Number(p.price) || 0,
    stock: Number(p.stock) || 0,
    hpp: Number(p.hpp) || 0,
    sku: (p.sku as string) || null,
    barcode: (p.barcode as string) || null,
    categoryId: (p.categoryId as string) || null,
    categoryName: (p.categoryName as string) || null,
    image: (p.image as string) || null,
    unit: (p.unit as string) || 'pcs',
    hasVariants: Boolean(p.hasVariants),
    _variantCount: Number(p._variantCount) || 0,
    variants: Array.isArray(p.variants) ? (p.variants as unknown[]).map(mapApiVariant) : [],
  }
}

function mapApiVariant(v: Record<string, unknown>): ProductVariant {
  return {
    id: v.id as string,
    name: v.name as string,
    sku: (v.sku as string) || null,
    barcode: (v.barcode as string) || null,
    price: Number(v.price) || 0,
    hpp: Number(v.hpp) || 0,
    stock: Number(v.stock) || 0,
  }
}

function toCachedPosProduct(p: Product): CachedPosProduct {
  return {
    id: p.id, name: p.name, price: p.price, stock: p.stock, hpp: p.hpp,
    sku: p.sku, barcode: p.barcode, categoryId: p.categoryId, categoryName: p.categoryName,
    image: p.image, unit: p.unit, hasVariants: p.hasVariants, _variantCount: p._variantCount,
    variants: [] as never[], cachedAt: Date.now(),
  }
}

function fromCachedPosProduct(c: CachedPosProduct): Product {
  return {
    id: c.id, name: c.name, price: c.price, stock: c.stock, hpp: c.hpp,
    sku: c.sku, barcode: c.barcode, categoryId: c.categoryId, categoryName: c.categoryName,
    image: c.image, unit: c.unit, hasVariants: c.hasVariants, _variantCount: c._variantCount,
    variants: [],
  }
}

function toCachedPosVariant(v: ProductVariant): CachedPosVariant {
  return {
    id: v.id, name: v.name, sku: v.sku, barcode: v.barcode,
    price: v.price, hpp: v.hpp, stock: v.stock, cachedAt: Date.now(),
  }
}

function fromCachedPosVariant(c: CachedPosVariant): ProductVariant {
  return {
    id: c.id, name: c.name, sku: c.sku, barcode: c.barcode,
    price: c.price, hpp: c.hpp, stock: c.stock,
  }
}
