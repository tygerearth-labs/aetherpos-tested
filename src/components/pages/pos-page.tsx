'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter } from '@/components/ui/responsive-dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Package,
  Banknote,
  QrCode,
  Loader2,
  Check,
  X,
  User,
  UserPlus,
  Coins,
  CreditCard,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
  RefreshCw,
  CloudOff,
  Database,
  ArrowDownToLine,
  LayoutGrid,
  ReceiptText,
  AlertCircle,
  Store,
  Tag,
  Layers,
  ClockArrowDown,
  Play,
  Clock,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB, type CachedProduct, type CachedCategory, type CachedCustomer, type PendingTransaction } from '@/lib/local-db'
import { syncAllData, getAllSyncTimes, syncSettingsFromServer, getCachedSettings } from '@/lib/sync-service'
import { cn } from '@/lib/utils'
import { useSession } from 'next-auth/react'
import { usePageStore } from '@/hooks/use-page-store'

// ==================== TYPES ====================

interface ProductVariant {
  id: string
  name: string
  sku: string | null
  price: number
  hpp: number
  stock: number
}

interface Product {
  id: string
  name: string
  price: number
  stock: number
  sku: string | null
  barcode: string | null
  categoryId: string | null
  image: string | null
  hasVariants: boolean
  _variantCount: number
  variants: ProductVariant[]
}

interface Category {
  id: string
  name: string
  color: string
}

interface Customer {
  id: string
  name: string
  whatsapp: string
  points: number
}

interface CartItem {
  product: Product
  variant: ProductVariant | null
  qty: number
}

interface VariantPickerState {
  product: Product
  open: boolean
  variants: ProductVariant[]
  loading: boolean
}

interface CheckoutResult {
  success: boolean
  invoiceNumber: string
  message?: string
  syncError?: string
}

interface OutletSettings {
  paymentMethods: string
  loyaltyEnabled: boolean
  loyaltyPointsPerAmount: number
  loyaltyPointValue: number
  receiptBusinessName: string
  receiptAddress: string
  receiptPhone: string
  receiptFooter: string
  receiptLogo: string
  themePrimaryColor: string
  ppnEnabled: boolean
  ppnRate: number
}

interface OutletInfo {
  id: string
  name: string
  address: string | null
  phone: string | null
}

interface UserOutlet {
  id: string
  name: string
  address: string | null
  phone: string | null
  isPrimary: boolean
}

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
  zinc: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', border: 'border-zinc-500/20', activeBg: 'bg-zinc-500/20' },
}

const QUICK_NOMINALS = [5000, 10000, 20000, 50000, 100000, 200000, 500000]

// ==================== MAIN COMPONENT ====================

export default function PosPage() {
  const { data: session } = useSession()
  const isMobile = useIsMobile()
  const { currentPage } = usePageStore()

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncingRef = useRef(false)
  const checkoutSyncRef = useRef(false)
  const receiptContentRef = useRef<HTMLDivElement>(null)
  const initialSyncDone = useRef(false)
  const lastInputTimeRef = useRef<number>(0)
  const inputCharCountRef = useRef<number>(0)
  const barcodeDetectedRef = useRef(false)

  // Offline / Online state (MUST be declared before useEffects that depend on it)
  const [isOnline, setIsOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [dataSyncing, setDataSyncing] = useState(false)
  const [lastSyncTimes, setLastSyncTimes] = useState<{ products: number | null; categories: number | null; customers: number | null; promos: number | null }>({ products: null, categories: null, customers: null, promos: null })

  // Products & Categories
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productsLoading, setProductsLoading] = useState(true)
  const [productPage, setProductPage] = useState(1)
  const [totalProductPages, setTotalProductPages] = useState(1)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)

  // Settings (full outlet settings)
  const [settings, setSettings] = useState<OutletSettings>({
    paymentMethods: 'CASH,QRIS',
    loyaltyEnabled: true,
    loyaltyPointsPerAmount: 10000,
    loyaltyPointValue: 100,
    receiptBusinessName: 'Aether POS',
    receiptAddress: '',
    receiptPhone: '',
    receiptFooter: 'Terima kasih atas kunjungan Anda!',
    receiptLogo: '',
    themePrimaryColor: 'emerald',
    ppnEnabled: false,
    ppnRate: 11,
  })

  // Outlet info (from settings API)
  const [outletInfo, setOutletInfo] = useState<OutletInfo | null>(null)
  const [userOutlets, setUserOutlets] = useState<UserOutlet[]>([])
  const [outletsLoading, setOutletsLoading] = useState(false)

  const availablePaymentMethods = useMemo(() => {
    return settings.paymentMethods.split(',').map(m => m.trim().toUpperCase()).filter(Boolean) as Array<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>
  }, [settings.paymentMethods])

  // Fetch settings (online: from API + cache to IndexedDB, offline: from IndexedDB cache)
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (isOnline) {
          const res = await fetch('/api/settings')
          if (res.ok) {
            const data = await res.json()
            setSettings({
              paymentMethods: data.paymentMethods || 'CASH,QRIS',
              loyaltyEnabled: data.loyaltyEnabled ?? true,
              loyaltyPointsPerAmount: data.loyaltyPointsPerAmount || 10000,
              loyaltyPointValue: data.loyaltyPointValue || 100,
              receiptBusinessName: data.receiptBusinessName || 'Aether POS',
              receiptAddress: data.receiptAddress || '',
              receiptPhone: data.receiptPhone || '',
              receiptFooter: data.receiptFooter || 'Terima kasih atas kunjungan Anda!',
              receiptLogo: data.receiptLogo || '',
              themePrimaryColor: data.themePrimaryColor || 'emerald',
              ppnEnabled: data.ppnEnabled ?? false,
              ppnRate: data.ppnRate || 11,
            })
            // Extract outlet info from settings response
            if (data.outlet) {
              setOutletInfo({
                id: data.outlet.id,
                name: data.outlet.name,
                address: data.outlet.address,
                phone: data.outlet.phone,
              })
            }
            // Cache settings for offline use
            syncSettingsFromServer()
          }
        } else {
          // Offline: load from IndexedDB cache
          const cached = await getCachedSettings()
          if (cached) {
            setSettings({
              paymentMethods: (cached.paymentMethods as string) || 'CASH,QRIS',
              loyaltyEnabled: (cached.loyaltyEnabled as boolean) ?? true,
              loyaltyPointsPerAmount: (cached.loyaltyPointsPerAmount as number) || 10000,
              loyaltyPointValue: (cached.loyaltyPointValue as number) || 100,
              receiptBusinessName: (cached.receiptBusinessName as string) || 'Aether POS',
              receiptAddress: (cached.receiptAddress as string) || '',
              receiptPhone: (cached.receiptPhone as string) || '',
              receiptFooter: (cached.receiptFooter as string) || 'Terima kasih atas kunjungan Anda!',
              receiptLogo: (cached.receiptLogo as string) || '',
              themePrimaryColor: (cached.themePrimaryColor as string) || 'emerald',
              ppnEnabled: (cached.ppnEnabled as boolean) ?? false,
              ppnRate: (cached.ppnRate as number) || 11,
            })
            // Extract outlet info from cached settings
            const cachedOutlet = cached.outlet as { id: string; name: string; address: string | null; phone: string | null } | undefined
            if (cachedOutlet) {
              setOutletInfo({
                id: cachedOutlet.id,
                name: cachedOutlet.name,
                address: cachedOutlet.address,
                phone: cachedOutlet.phone,
              })
            }
          }
        }
      } catch { /* use defaults */ }
    }
    fetchSettings()
  }, [isOnline])

  // Re-fetch settings when returning to POS page
  useEffect(() => {
    if (currentPage === 'pos') {
      const refetchSettings = async () => {
        try {
          if (isOnline) {
            const res = await fetch('/api/settings')
            if (res.ok) {
              const data = await res.json()
              setSettings({
                paymentMethods: data.paymentMethods || 'CASH,QRIS',
                loyaltyEnabled: data.loyaltyEnabled ?? true,
                loyaltyPointsPerAmount: data.loyaltyPointsPerAmount || 10000,
                loyaltyPointValue: data.loyaltyPointValue || 100,
                receiptBusinessName: data.receiptBusinessName || 'Aether POS',
                receiptAddress: data.receiptAddress || '',
                receiptPhone: data.receiptPhone || '',
                receiptFooter: data.receiptFooter || 'Terima kasih atas kunjungan Anda!',
                receiptLogo: data.receiptLogo || '',
                themePrimaryColor: data.themePrimaryColor || 'emerald',
                ppnEnabled: data.ppnEnabled ?? false,
                ppnRate: data.ppnRate || 11,
              })
            }
          }
        } catch { /* silent */ }
      }
      refetchSettings()
    }
  }, [currentPage, isOnline])

  // Fetch user's outlets (enterprise multi-outlet support)
  useEffect(() => {
    const fetchOutlets = async () => {
      if (!isOnline) return
      try {
        const res = await fetch('/api/outlets')
        if (res.ok) {
          const data = await res.json()
          if (data.outlets && Array.isArray(data.outlets)) {
            setUserOutlets(data.outlets.map((o: Record<string, unknown>) => ({
              id: o.id as string,
              name: o.name as string,
              address: (o.address as string) || null,
              phone: (o.phone as string) || null,
              isPrimary: (o.isPrimary as boolean) || false,
            })))
          }
        }
      } catch { /* silent - outlets list is non-critical */ }
      finally {
        setOutletsLoading(false)
      }
    }
    setOutletsLoading(true)
    fetchOutlets()
  }, [isOnline])

  // Customers
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [addCustomerOpen, setAddCustomerOpen] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', whatsapp: '' })
  const [addingCustomer, setAddingCustomer] = useState(false)

  // Cart
  const [cart, setCart] = useState<CartItem[]>([])
  const [pointsToUse, setPointsToUse] = useState(0)

  // Variant picker
  const [variantPicker, setVariantPicker] = useState<VariantPickerState>({
    product: null as unknown as Product,
    open: false,
    variants: [],
    loading: false,
  })

  // Promo
  const [selectedPromo, setSelectedPromo] = useState<{ id: string; name: string; type: string; discount: number; description: string } | null>(null)
  const [promoDiscount, setPromoDiscount] = useState(0)
  const [promoLoading, setPromoLoading] = useState(false)
  const [availablePromos, setAvailablePromos] = useState<Array<{ id: string; name: string; type: string; description: string }>>([])

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>('CASH')
  const [paidAmount, setPaidAmount] = useState('')

  // Reset payment method if not in available methods
  useEffect(() => {
    if (availablePaymentMethods.length > 0 && !availablePaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(availablePaymentMethods[0])
    }
  }, [availablePaymentMethods, paymentMethod])

  // Fetch available promos
  useEffect(() => {
    const fetchPromos = async () => {
      try {
        const res = await fetch('/api/settings/promos?active=true')
        if (res.ok) {
          const data = await res.json()
          setAvailablePromos(data.promos || [])
        }
      } catch { /* silent */ }
    }
    if (isOnline) fetchPromos()
  }, [isOnline])

  // Calculate promo when cart changes
  useEffect(() => {
    if (cart.length === 0) {
      setSelectedPromo(null)
      setPromoDiscount(0)
      return
    }
    const calculatePromo = async () => {
      setPromoLoading(true)
      try {
        const cartSubtotal = cart.reduce((sum, item) => sum + getItemPrice(item) * item.qty, 0)
        const res = await fetch('/api/promos/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: cart.map(item => ({
              productId: item.product.id,
              productName: getItemDisplayName(item),
              price: getItemPrice(item),
              qty: item.qty,
              subtotal: getItemPrice(item) * item.qty,
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
  }, [cart])

  // Checkout
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null)
  const [editingQtyValue, setEditingQtyValue] = useState('')
  const qtyInputRef = useRef<HTMLInputElement>(null)

  // Pending Transactions
  const [pendingListOpen, setPendingListOpen] = useState(false)
  const [holdNoteDialog, setHoldNoteDialog] = useState(false)
  const [pendingNote, setPendingNote] = useState('')
  const pendingCount = useLiveQuery(
    () => localDB.pendingTransactions.count(),
    []
  ) ?? 0

  // ── Inline QTY Edit Handlers ──
  const startEditQty = (productId: string, currentQty: number) => {
    setEditingQtyId(productId)
    setEditingQtyValue(String(currentQty))
    setTimeout(() => qtyInputRef.current?.focus(), 50)
  }

  const confirmEditQty = () => {
    if (!editingQtyId) return
    const val = parseInt(editingQtyValue, 10)
    if (isNaN(val) || val <= 0) {
      removeFromCart(editingQtyId)
    } else {
      updateQty(editingQtyId, val)
    }
    setEditingQtyId(null)
    setEditingQtyValue('')
  }

  const cancelEditQty = () => {
    setEditingQtyId(null)
    setEditingQtyValue('')
  }

  // Online/offline detection
  useEffect(() => {
    setIsOnline(navigator.onLine)
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Live queries for unsynced transactions
  const unsyncedCount = useLiveQuery(
    () => localDB.transactions.where('isSynced').equals(0).count(),
    []
  ) ?? 0

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && initialSyncDone.current && !syncingRef.current && !checkoutSyncRef.current) {
      syncingRef.current = true
      const timer = setTimeout(async () => {
        try {
          const pending = await localDB.transactions.where('isSynced').equals(0).toArray()
          if (pending.length > 0) {
            const res = await fetch('/api/transactions/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transactions: pending }),
            })
            const data = await res.json()
            if (res.ok && data.synced > 0) {
              for (const result of data.results || []) {
                if (result.success) {
                  await localDB.transactions.update(result.localId, {
                    isSynced: 1,
                    syncedAt: Date.now(),
                    invoiceNumber: result.invoiceNumber,
                    serverTransactionId: result.serverId,
                  })
                }
              }
              toast.success(`${data.synced} transaction(s) auto-synced!`)
            }
          }

          setDataSyncing(true)
          const result = await syncAllData()
          syncSettingsFromServer() // cache settings for offline (fire-and-forget)
          fetchProducts(productSearch, productPage, selectedCategoryId)
          loadCategoriesFromCache()
          loadCustomersFromCache()
          const times = await getAllSyncTimes()
          setLastSyncTimes(times)
          setDataSyncing(false)
        } catch {
          setDataSyncing(false)
        } finally {
          syncingRef.current = false
        }
      }, 2000)
      return () => { clearTimeout(timer); syncingRef.current = false }
    }
  }, [isOnline])

  // Initial sync on mount
  useEffect(() => {
    if (isOnline && !initialSyncDone.current) {
      initialSyncDone.current = true
      const doInitialSync = async () => {
        setDataSyncing(true)
        try {
          const result = await syncAllData()
          syncSettingsFromServer() // cache settings for offline (fire-and-forget)
          fetchProducts(productSearch, productPage, selectedCategoryId)
          loadCategoriesFromCache()
          loadCustomersFromCache()
          const times = await getAllSyncTimes()
          setLastSyncTimes(times)
          if (result.products.count > 0 || result.customers.count > 0) {
            toast.success(`Data synced: ${result.products.count} produk, ${result.categories.count} kategori, ${result.customers.count} customer`)
          }
        } catch {
          fetchProducts(productSearch, productPage, selectedCategoryId)
          loadCategoriesFromCache()
          loadCustomersFromCache()
        } finally {
          setDataSyncing(false)
        }
      }
      doInitialSync()
    } else if (!isOnline && !initialSyncDone.current) {
      initialSyncDone.current = true
      fetchProducts(productSearch, productPage, selectedCategoryId)
      loadCategoriesFromCache()
      loadCustomersFromCache()
      getAllSyncTimes().then(setLastSyncTimes)
    }
  }, [isOnline])

  // Auto-focus search
  useEffect(() => {
    if (searchInputRef.current) searchInputRef.current.focus()
  }, [])

  // ==================== DATA LOADING ====================

  const loadCategoriesFromCache = useCallback(async () => {
    try {
      const cached = await localDB.categories.toArray()
      setCategories(cached as unknown as Category[])
    } catch { /* silent */ }
  }, [])

  useEffect(() => { loadCategoriesFromCache() }, [loadCategoriesFromCache])

  const fetchProducts = useCallback(async (search: string, page: number, categoryId: string | null) => {
    setProductsLoading(true)
    try {
      const allProducts = await localDB.products.toArray()

      let filtered = allProducts

      // Category filter
      if (categoryId) {
        filtered = filtered.filter(p => p.categoryId === categoryId)
      }

      // Search filter — also match variant SKUs
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.sku && p.sku.toLowerCase().includes(q)) ||
            (p.barcode && p.barcode.toLowerCase().includes(q)) ||
            // Match variant SKU or variant name
            (p.hasVariants && p.variants && p.variants.some((v: any) =>
              (v.sku && v.sku.toLowerCase().includes(q)) ||
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

  // Debounced fetch
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    const timer = setTimeout(() => {
      fetchProducts(productSearch, productPage, selectedCategoryId)
    }, productSearch ? 200 : 0)
    debounceTimerRef.current = timer
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [productSearch, productPage, selectedCategoryId, fetchProducts])

  // Auto-add product when barcode scanning is detected and exactly 1 match found
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
            addToCart(product, 1, matchingVariant as ProductVariant)
            toast.success(`${product.name} - ${matchingVariant.name} ditambahkan`)
          } else {
            openVariantPicker(product)
          }
        } else if (product.stock > 0) {
          addToCart(product)
          toast.success(`${product.name} ditambahkan`)
        }
        setProductSearch('')
        barcodeDetectedRef.current = false
        inputCharCountRef.current = 0
      }
    }
  }, [products, productsLoading, productSearch])

  const loadCustomersFromCache = useCallback(async () => {
    try {
      const cached = await localDB.customers.toArray()
      setCustomers(cached as unknown as Customer[])
    } catch { /* silent */ }
  }, [])

  useEffect(() => { loadCustomersFromCache() }, [loadCustomersFromCache])

  // ==================== HANDLERS ====================

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
              addToCart(product, 1, matchingVariant as ProductVariant)
              setProductSearch('')
              toast.success(`${product.name} - ${matchingVariant.name} ditambahkan`)
              return
            }
            openVariantPicker(product)
            setProductSearch('')
            return
          }
          if (product.stock > 0) {
            addToCart(product)
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
          openVariantPicker(product)
          setProductSearch('')
        } else if (product.stock > 0) {
          addToCart(product)
          setProductSearch('')
          toast.success(`${product.name} ditambahkan`)
        }
      }
    }
  }

  const handleCategorySelect = (categoryId: string | null) => {
    setSelectedCategoryId(categoryId)
    setProductPage(1)
  }

  // Customer dropdown
  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 20)
    const q = customerSearch.toLowerCase()
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.whatsapp.includes(q)
    )
  }, [customers, customerSearch])

  // ==================== CART LOGIC ====================

  // Helper: get effective price for a cart item (variant price if present, otherwise product price)
  const getItemPrice = (item: CartItem) => item.variant ? item.variant.price : item.product.price
  // Helper: get effective stock for a cart item
  const getItemStock = (item: CartItem) => item.variant ? item.variant.stock : item.product.stock
  // Helper: generate cart key for unique identification
  const getCartKey = (productId: string, variantId: string | null) => variantId ? `${productId}_${variantId}` : productId
  // Helper: get item display name
  const getItemDisplayName = (item: CartItem) => item.variant ? `${item.product.name} - ${item.variant.name}` : item.product.name

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + getItemPrice(item) * item.qty, 0), [cart])
  const maxPointsToUse = selectedCustomer ? selectedCustomer.points : 0
  const pointsDiscount = pointsToUse * settings.loyaltyPointValue
  const ppnAmount = settings.ppnEnabled ? Math.round(subtotal * settings.ppnRate / 100) : 0
  const total = Math.max(0, subtotal - pointsDiscount - promoDiscount + ppnAmount)
  const change = paymentMethod === 'CASH' ? Math.max(0, Number(paidAmount) - total) : 0

  const addToCart = (product: Product, qty: number = 1, variant?: ProductVariant) => {
    if (variant) {
      if (variant.stock <= 0) return
      if (qty <= 0) return
      const key = getCartKey(product.id, variant.id)
      setCart((prev) => {
        const existing = prev.find((item) => getCartKey(item.product.id, item.variant?.id || null) === key)
        if (existing) {
          const newQty = existing.qty + qty
          if (newQty > variant.stock) { toast.warning('Stok tidak cukup'); return prev }
          return prev.map((item) => getCartKey(item.product.id, item.variant?.id || null) === key ? { ...item, qty: newQty } : item)
        }
        if (qty > variant.stock) { toast.warning('Stok tidak cukup'); return prev }
        return [...prev, { product, variant, qty }]
      })
    } else {
      if (product.stock <= 0) return
      if (qty <= 0) return
      setCart((prev) => {
        const existing = prev.find((item) => !item.variant && item.product.id === product.id)
        if (existing) {
          const newQty = existing.qty + qty
          if (newQty > product.stock) { toast.warning('Stok tidak cukup'); return prev }
          return prev.map((item) => item.product.id === product.id && !item.variant ? { ...item, qty: newQty } : item)
        }
        if (qty > product.stock) { toast.warning('Stok tidak cukup'); return prev }
        return [...prev, { product, variant: null, qty }]
      })
    }
  }

  const updateQty = (productId: string, newQty: number, variantId?: string) => {
    if (newQty <= 0) { removeFromCart(productId, variantId); return }
    const key = getCartKey(productId, variantId || null)
    const item = cart.find((i) => getCartKey(i.product.id, i.variant?.id || null) === key)
    if (item && newQty > getItemStock(item)) { toast.warning('Stok tidak cukup'); return }
    setCart((prev) => prev.map((i) => (getCartKey(i.product.id, i.variant?.id || null) === key ? { ...i, qty: newQty } : i)))
  }

  const removeFromCart = (productId: string, variantId?: string) => {
    const key = getCartKey(productId, variantId || null)
    setCart((prev) => prev.filter((i) => getCartKey(i.product.id, i.variant?.id || null) !== key))
  }

  const clearCart = () => {
    setCart([])
    setPointsToUse(0)
    setPaidAmount('')
    if (availablePaymentMethods.includes('CASH')) setPaymentMethod('CASH')
    setSelectedCustomer(null)
    setCheckoutResult(null)
    setSelectedPromo(null)
    setPromoDiscount(0)
  }

  const handlePointsChange = (value: string) => {
    setPointsToUse(Math.min(Number(value) || 0, maxPointsToUse))
  }

  // ==================== PENDING TRANSACTIONS ====================

  const handleHoldTransaction = async () => {
    if (cart.length === 0) return
    setPendingNote('')
    setHoldNoteDialog(true)
  }

  const confirmHoldTransaction = async () => {
    try {
      const userName = session?.user?.name || 'Unknown'
      const userId = (session?.user as any)?.id || ''
      await localDB.pendingTransactions.add({
        items: cart.map(item => ({
          product: item.product,
          variant: item.variant,
          qty: item.qty,
        })),
        customerId: selectedCustomer?.id || null,
        customerName: selectedCustomer?.name || null,
        customerPhone: selectedCustomer?.whatsapp || null,
        note: pendingNote.trim(),
        subtotal,
        createdAt: Date.now(),
        userId,
        userName,
      })
      clearCart()
      setMobileCartOpen(false)
      setHoldNoteDialog(false)
      setPendingNote('')
      toast.success('Transaksi ditunda')
    } catch {
      toast.error('Gagal menunda transaksi')
    }
  }

  const handleResumePending = async (pending: PendingTransaction) => {
    if (cart.length > 0) {
      // If current cart has items, hold it first
      try {
        const userName = session?.user?.name || 'Unknown'
        const userId = (session?.user as any)?.id || ''
        await localDB.pendingTransactions.add({
          items: cart.map(item => ({
            product: item.product,
            variant: item.variant,
            qty: item.qty,
          })),
          customerId: selectedCustomer?.id || null,
          customerName: selectedCustomer?.name || null,
          customerPhone: selectedCustomer?.whatsapp || null,
          note: '',
          subtotal,
          createdAt: Date.now(),
          userId,
          userName,
        })
      } catch { /* silent */ }
    }

    // Load pending items into cart
    try {
      const items = pending.items as Array<{ product: Product; variant: ProductVariant | null; qty: number }>
      setCart(items)
      if (pending.customerId && pending.customerName) {
        const customer = customers.find(c => c.id === pending.customerId)
        if (customer) {
          setSelectedCustomer(customer)
        } else {
          setSelectedCustomer({ id: pending.customerId, name: pending.customerName, whatsapp: '', points: 0 })
        }
      } else {
        setSelectedCustomer(null)
      }
      setPointsToUse(0)
      setPaidAmount('')
      setSelectedPromo(null)
      setPromoDiscount(0)

      // Delete the pending transaction
      if (pending.id) {
        await localDB.pendingTransactions.delete(pending.id)
      }

      setPendingListOpen(false)
      setMobileCartOpen(false)
      toast.success('Transaksi dilanjutkan')
    } catch {
      toast.error('Gagal melanjutkan transaksi')
    }
  }

  const handleDeletePending = async (id: number) => {
    try {
      await localDB.pendingTransactions.delete(id)
      toast.success('Transaksi pending dihapus')
    } catch {
      toast.error('Gagal menghapus transaksi pending')
    }
  }

  // ==================== VARIANT PICKER ====================

  const openVariantPicker = async (product: Product) => {
    // Optimization: check if product already has variants loaded from cache
    const cachedVariants = product.variants && product.variants.length > 0 ? product.variants : null

    // If only 1 in-stock variant, add directly without opening picker
    if (cachedVariants) {
      const availableVariants = cachedVariants.filter(v => v.stock > 0)
      if (availableVariants.length === 1) {
        addToCart(product, 1, availableVariants[0])
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
          addToCart(product, 1, availableVariants[0])
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

  const handleVariantSelect = (variant: ProductVariant) => {
    if (variant.stock <= 0) return
    addToCart(variantPicker.product, 1, variant)
    setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })
    toast.success(`${variantPicker.product.name} - ${variant.name} ditambahkan`)
  }

  // ==================== QUICK NOMINAL ====================

  const getQuickNominals = useMemo(() => {
    if (total <= 0) return QUICK_NOMINALS
    // Generate smart nominals around the total
    const roundedUp = Math.ceil(total / 10000) * 10000
    const roundedDown = Math.floor(total / 10000) * 10000
    const exact = total

    const nominals = new Set<number>()
    nominals.add(Math.round(exact))
    if (roundedUp > exact) nominals.add(roundedUp)
    if (roundedDown > 0 && roundedDown >= exact) nominals.add(roundedDown)

    // Add common denominations above total
    for (const n of QUICK_NOMINALS) {
      if (n >= total) nominals.add(n)
    }

    return Array.from(nominals).sort((a, b) => a - b).slice(0, 6)
  }, [total])

  // ==================== CUSTOMER CREATION ====================

  const handleAddCustomer = async () => {
    if (!newCustomer.name.trim() || !newCustomer.whatsapp.trim()) {
      toast.error('Nama dan nomor WhatsApp wajib diisi')
      return
    }
    const phone = newCustomer.whatsapp.replace(/[^0-9]/g, '')
    if (phone.length < 8) {
      toast.error('Nomor WhatsApp tidak valid')
      return
    }
    setAddingCustomer(true)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCustomer.name.trim(), whatsapp: phone }),
      })
      if (res.ok) {
        const customer = await res.json()
        toast.success(`Customer ${customer.name} berhasil ditambahkan`)
        setAddCustomerOpen(false)
        setNewCustomer({ name: '', whatsapp: '' })
        setSelectedCustomer({ id: customer.id, name: customer.name, whatsapp: customer.whatsapp, points: 0 })
        setCustomerSearch('')
        setCustomerDropdownOpen(false)
        // Refresh local cache
        loadCustomersFromCache()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menambahkan customer')
      }
    } catch {
      toast.error('Gagal menambahkan customer')
    } finally {
      setAddingCustomer(false)
    }
  }

  // ==================== CHECKOUT ====================

  const handleCheckout = async () => {
    if (cart.length === 0) return
    if (paymentMethod === 'CASH' && Number(paidAmount) < total) {
      toast.error('Jumlah bayar kurang dari total')
      return
    }
    setCheckingOut(true)
    try {
      const checkoutPayload = {
        customerId: selectedCustomer?.id || null,
        items: cart.map((item) => ({
          productId: item.product.id,
          productName: item.product.name,
          price: getItemPrice(item),
          qty: item.qty,
          subtotal: getItemPrice(item) * item.qty,
          variantId: item.variant?.id || null,
          variantName: item.variant?.name || null,
        })),
        subtotal,
        discount: pointsDiscount + promoDiscount,
        pointsUsed: pointsToUse,
        taxAmount: ppnAmount,
        total,
        paymentMethod,
        paidAmount: paymentMethod === 'CASH' ? Number(paidAmount) : total,
        change: paymentMethod === 'CASH' ? change : 0,
        promoId: selectedPromo?.id || null,
        promoDiscount,
      }

      // STEP 1: Save to IndexedDB first
      const localId = await localDB.transactions.add({
        payload: checkoutPayload,
        isSynced: 0,
        createdAt: Date.now(),
        retryCount: 0,
      })

      // STEP 1b: Decrement stock locally in IndexedDB to prevent overselling while offline (parallel)
      await Promise.all(cart.map(item =>
        localDB.products
          .where('id')
          .equals(item.product.id)
          .modify((p: any) => {
            if (item.variant) {
              const v = p.variants?.find((v: any) => v.id === item.variant!.id)
              if (v) {
                v.stock = Math.max(0, (v.stock || 0) - item.qty)
              }
            } else {
              p.stock = Math.max(0, (p.stock || 0) - item.qty)
            }
            p.updatedAt = new Date().toISOString()
          })
      ))

      // STEP 2: If online, sync immediately
      if (isOnline) {
        checkoutSyncRef.current = true
        try {
          const unsyncedTx = await localDB.transactions.get(localId)
          if (unsyncedTx) {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 20000)
            try {
              const syncRes = await fetch('/api/transactions/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transactions: [unsyncedTx] }),
                signal: controller.signal,
              })
              clearTimeout(timeoutId)
              const syncData = await syncRes.json()
              if (syncRes.ok && syncData.synced > 0) {
                await localDB.transactions.update(localId, {
                  isSynced: 1,
                  syncedAt: Date.now(),
                  invoiceNumber: syncData.results?.[0]?.invoiceNumber,
                  serverTransactionId: syncData.results?.[0]?.serverId,
                })
                const invoiceNum = syncData.results?.[0]?.invoiceNumber || `OFF-${Date.now().toString(36).toUpperCase()}`
                setCheckoutResult({ success: true, invoiceNumber: invoiceNum })
                toast.success(`Pembayaran berhasil! Invoice: ${invoiceNum}`)
              } else {
                const error = syncData.results?.[0]?.error || syncData.error || 'Gagal sync ke server'
                const invoiceNum = `OFF-${Date.now().toString(36).toUpperCase()}`
                setCheckoutResult({ success: true, invoiceNumber: invoiceNum, message: 'Tersimpan lokal', syncError: error })
                toast.warning('Tersimpan lokal — akan sync otomatis', { description: error })
              }
            } catch (syncErr) {
              clearTimeout(timeoutId)
              console.error('Immediate sync failed:', syncErr)
              const invoiceNum = `OFF-${Date.now().toString(36).toUpperCase()}`
              setCheckoutResult({ success: true, invoiceNumber: invoiceNum, message: 'Tersimpan offline', syncError: 'Tidak dapat terhubung ke server' })
              toast.warning('Tersimpan offline — akan sync otomatis')
            }
          }
        } finally {
          checkoutSyncRef.current = false
        }
      } else {
        const invoiceNum = `OFF-${Date.now().toString(36).toUpperCase()}`
        setCheckoutResult({ success: true, invoiceNumber: invoiceNum, message: 'Transaksi offline' })
        toast.warning('Offline — transaksi tersimpan lokal', { duration: 5000 })
      }

      setCheckoutOpen(false)
      setReceiptOpen(true)
      fetchProducts(productSearch, productPage, selectedCategoryId)
      loadCustomersFromCache()
    } catch {
      toast.error('Checkout gagal')
    } finally {
      setCheckingOut(false)
    }
  }

  const openCheckoutDialog = () => {
    if (cart.length === 0) return
    setCheckoutResult(null)
    setCheckoutOpen(true)
  }

  // ==================== RECEIPT PRINTING ====================

  // Receipt CSS — embedded in content for both preview + print consistency
  const RECEIPT_CSS = `
    /* Thermal-printer optimized: pure black, no gray dithering, no font smoothing */
    .r-center{text-align:center}.r-right{text-align:right}
    .r-row{display:flex;justify-content:space-between;align-items:baseline}
    .r-row-items{display:flex;align-items:baseline}
    .r-bold{font-weight:700}.r-semibold{font-weight:600}.r-medium{font-weight:500}
    .r-space>*+*{margin-top:4px}.r-space-sm>*+*{margin-top:2px}.r-space-md>*+*{margin-top:6px}.r-space-lg>*+*{margin-top:8px}
    .r-py{padding-top:6px;padding-bottom:6px}.r-my{margin-top:6px;margin-bottom:6px}
    .r-sep{border:none;border-top:1px dashed #000;margin:6px 0}
    .r-sep-double{border:none;border-top:2px dashed #000;margin:6px 0}
    .r-label{color:#000;font-size:9.5px;font-weight:400}.r-value{color:#000;font-weight:600;font-size:10px}
    .r-value-bold{color:#000;font-weight:700}.r-muted{color:#000;font-size:9px;font-weight:400}
    .r-success{color:#000;font-weight:600}.r-warning{color:#000;font-weight:600}
    .r-upper{text-transform:uppercase;letter-spacing:0.5px}
    .r-lg{font-size:12px}.r-sm{font-size:9px}.r-xs{font-size:8.5px}
    .r-w8{width:28px;text-align:center;flex-shrink:0}.r-w16{width:60px;text-align:right;flex-shrink:0}
    .r-w20{width:72px;text-align:right;flex-shrink:0}.r-flex1{flex:1;min-width:0}.r-gap{gap:2px}
    .r-logo{max-width:40px;max-height:40px;object-fit:contain}
    .r-item-name{font-weight:600;font-size:10px;color:#000}
    .r-item-variant{font-size:8.5px;color:#000;font-weight:400}
    .r-item-price{font-size:9px;color:#000;font-weight:400}
    .r-total-row{font-size:11px}.r-footer{color:#000;font-size:8.5px;font-weight:400}
    .r-wrap{font-family:'Courier New',Courier,monospace;width:100%;color:#000;font-size:10px;line-height:1.5;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:auto}
  `

  const handleReceiptPrint = () => {
    const content = receiptContentRef.current?.innerHTML
    if (!content) return
    const win = window.open('', '_blank', 'width=320,height=800')
    if (!win) { toast.error('Gagal membuka jendela cetak'); return }
    win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: 72mm; margin: 0 auto; padding: 10px 8px; }
        ${RECEIPT_CSS}
        @media print {
          body { margin: 0; padding: 6px 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { margin: 0; size: 80mm auto; }
          /* Force crisp text on thermal — disable sub-pixel rendering */
          body, .r-wrap { -webkit-font-smoothing: none; -moz-osx-font-smoothing: unset; }
          .r-sep { border-top: 1px dashed #000; }
        }
      </style>
    </head><body>${content}</body></html>`)
    win.document.close()
    setTimeout(() => { win.print(); setTimeout(() => win.close(), 500) }, 250)
    setReceiptOpen(false)
    clearCart()
  }

  const handleReceiptSkip = () => {
    setReceiptOpen(false)
    clearCart()
  }

  // ==================== SYNC ====================

  const handleSync = async () => {
    if (syncing || unsyncedCount === 0) return
    setSyncing(true)
    try {
      const pending = await localDB.transactions.where('isSynced').equals(0).toArray()
      if (pending.length === 0) { toast.info('Tidak ada transaksi pending'); return }

      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: pending }),
      })
      const data = await res.json()

      if (res.ok) {
        for (const result of data.results || []) {
          if (result.success) {
            await localDB.transactions.update(result.localId, {
              isSynced: 1, syncedAt: Date.now(),
              invoiceNumber: result.invoiceNumber, serverTransactionId: result.serverId,
            })
          } else {
            const existing = await localDB.transactions.get(result.localId)
            await localDB.transactions.update(result.localId, {
              retryCount: (existing?.retryCount || 0) + 1, lastError: result.error,
            })
          }
        }
        if (data.synced > 0) {
          toast.success(`${data.synced} transaksi berhasil disync!`)
          fetchProducts(productSearch, productPage, selectedCategoryId)
          loadCustomersFromCache()
        }
        if (data.failed > 0) {
          toast.error(`${data.failed} transaksi gagal sync`, { description: 'Periksa stok produk.' })
        }
      } else {
        toast.error('Sync gagal — server error')
      }
    } catch {
      toast.error('Sync gagal — tidak ada koneksi internet')
    } finally {
      setSyncing(false)
    }
  }

  // ==================== RECEIPT CONTENT ====================

  const formatReceiptDateTime = () => {
    const now = new Date()
    return `${now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
  }

  const isOfflineReceipt = checkoutResult?.invoiceNumber?.startsWith('OFF-')

  // ==================== THEME COLORS ====================

  const themeColors = CATEGORY_COLORS[settings.themePrimaryColor] || CATEGORY_COLORS.emerald

  // ==================== RENDER HELPERS ====================

  const renderCategoryChips = () => (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide px-1">
      <button
        onClick={() => handleCategorySelect(null)}
        className={`shrink-0 px-3 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-[11px] font-medium border transition-all backdrop-blur-sm ${
          !selectedCategoryId
            ? `${themeColors.activeBg} ${themeColors.text} ${themeColors.border} shadow-sm`
            : 'bg-zinc-900/60 border-zinc-800/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
        }`}
      >
        <LayoutGrid className="inline h-3 w-3 mr-1 -mt-0.5" />
        Semua
      </button>
      {categories.map((cat) => {
        const colors = CATEGORY_COLORS[cat.color] || CATEGORY_COLORS.zinc
        const isActive = selectedCategoryId === cat.id
        return (
          <button
            key={cat.id}
            onClick={() => handleCategorySelect(cat.id)}
            className={`shrink-0 px-3 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-[11px] font-medium border transition-all backdrop-blur-sm ${
              isActive
                ? `${colors.activeBg} ${colors.text} ${colors.border} shadow-sm`
                : 'bg-zinc-900/60 border-zinc-800/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
            }`}
          >
            {cat.name}
          </button>
        )
      })}
    </div>
  )

  const renderProductGrid = () => {
    if (productsLoading) {
      return Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-[88px] md:h-[72px] rounded-xl bg-zinc-800/20 animate-pulse" />
      ))
    }

    if (products.length === 0) {
      return (
        <div className="col-span-full text-center py-12">
          <Package className="h-10 w-10 text-zinc-700 mx-auto mb-2" />
          <p className="text-xs text-zinc-500">
            {selectedCategoryId ? 'Tidak ada produk di kategori ini' : 'Tidak ada produk ditemukan'}
          </p>
        </div>
      )
    }

    // Products are already sorted by stock in fetchProducts, no need to re-sort here
    return products.map((product) => {
      // For variant products, check if any variant is in cart
      const cartItemsForProduct = cart.filter((i) => i.product.id === product.id)
      const hasCartItems = cartItemsForProduct.length > 0
      const isVariantProduct = product.hasVariants && product._variantCount > 0

      // For non-variant products, find the single cart item (without variant)
      const cartItem = !isVariantProduct ? cart.find((i) => i.product.id === product.id && !i.variant) : null
      const outOfStock = isVariantProduct
        ? product.variants.length > 0 && product.variants.every(v => v.stock <= 0)
        : product.stock <= 0
      const catColor = product.categoryId && categories.find(c => c.id === product.categoryId)?.color
      const accentColor = catColor ? (CATEGORY_COLORS[catColor] || themeColors) : themeColors
      const lowStock = product.stock > 0 && product.stock <= 5

      // Price display for variant products: show range
      const displayPrice = isVariantProduct
        ? (product.variants && product.variants.length > 0
          ? (() => {
              const prices = product.variants.map(v => v.price)
              const min = Math.min(...prices)
              const max = Math.max(...prices)
              return min === max ? formatCurrency(min) : `${formatCurrency(min)} - ${formatCurrency(max)}`
            })()
          : formatCurrency(product.price))
        : formatCurrency(product.price)

      const totalCartQty = isVariantProduct
        ? cartItemsForProduct.reduce((sum, ci) => sum + ci.qty, 0)
        : (cartItem?.qty || 0)

      return (
        <div
          key={product.id}
          className={cn(
            'relative group min-h-[68px] md:min-h-0 rounded-2xl md:rounded-xl border text-left transition-all duration-200',
            outOfStock
              ? 'opacity-40 cursor-not-allowed border-zinc-800/40 bg-zinc-900/30 p-2.5 md:p-3'
              : hasCartItems
              ? `${accentColor.border} ${accentColor.bg} ring-1 ring-inset ${accentColor.border.replace('border-', 'ring-')} cursor-pointer active:scale-[0.98]`
              : 'border-zinc-800/50 bg-zinc-900/60 hover:border-zinc-700/60 hover:bg-zinc-800/50 hover:shadow-lg hover:shadow-black/20 backdrop-blur-sm cursor-pointer active:scale-[0.98]'
          )}
        >
          {/* Entire card is clickable */}
          {!outOfStock && (
            <button
              className="absolute inset-0 z-[2] rounded-2xl md:rounded-xl"
              onClick={() => isVariantProduct ? openVariantPicker(product) : addToCart(product)}
            />
          )}
          {/* Qty bubble badge */}
          {hasCartItems && !outOfStock && (
            <div className="absolute -top-1.5 -right-1.5 z-[3] flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full theme-bg text-white text-[10px] font-bold shadow-lg theme-shadow pointer-events-none">
              {totalCartQty}
            </div>
          )}
          <div className={cn(
            'relative z-[1] pointer-events-none',
            'p-2.5 md:p-3'
          )}>
            <div className="flex items-start justify-between gap-1 mb-1 md:mb-1.5">
              <p className="text-[11px] md:text-xs font-medium text-zinc-200 truncate">{product.name}</p>
              {isVariantProduct && (
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  <Layers className="h-2.5 w-2.5" />
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
                    const availableCount = product.variants.filter(v => v.stock > 0).length
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
                      : 'bg-zinc-800/80 text-zinc-500'
                  )}>
                    <span className={cn('w-1 h-1 rounded-full', lowStock ? 'bg-amber-400' : 'bg-zinc-600')} />
                    {product.stock}
                  </span>
                )}
              </div>
          </div>
        </div>
      )
    })
  }

  const renderPagination = () => {
    if (totalProductPages <= 1 && !productSearch) return null
    return (
      <div className="flex items-center justify-between px-1 py-2">
        <Button variant="outline" size="sm" onClick={() => setProductPage(p => Math.max(1, p - 1))} disabled={productPage <= 1 || productsLoading}
          className="bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 h-7 text-xs">
          <ChevronLeft className="h-3 w-3 mr-1" /> Prev
        </Button>
        <span className="text-[11px] text-zinc-500 font-medium">{productPage}/{totalProductPages}</span>
        <Button variant="outline" size="sm" onClick={() => setProductPage(p => Math.min(totalProductPages, p + 1))} disabled={productPage >= totalProductPages || productsLoading}
          className="bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 h-7 text-xs">
          Next <ChevronRight className="h-3 w-3 ml-1" />
        </Button>
      </div>
    )
  }

  const renderPaymentButtons = (compact = false) => {
    if (availablePaymentMethods.length === 0) return null
    return (
      <div className="flex gap-2">
        {availablePaymentMethods.map(method => {
          const icons: Record<string, React.ReactNode> = { CASH: <Banknote className="h-3.5 w-3.5" />, QRIS: <QrCode className="h-3.5 w-3.5" />, DEBIT: <CreditCard className="h-3.5 w-3.5" />, TRANSFER: <ArrowRightLeft className="h-3.5 w-3.5" /> }
          const isActive = paymentMethod === method
          return (
            <button key={method} onClick={() => setPaymentMethod(method as 'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 rounded-full border text-xs font-medium transition-all duration-150',
                compact ? 'h-9 py-2' : 'h-10 py-2.5',
                isActive
                  ? `${themeColors.activeBg} ${themeColors.text} ${themeColors.border} shadow-sm ring-1 ring-inset ${themeColors.border.replace('border-', 'ring-')}`
                  : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 hover:border-zinc-600'
              )}>
              {icons[method]} {method}
            </button>
          )
        })}
      </div>
    )
  }

  const renderCustomerSelector = (isMobile = false) => (
    <div className={isMobile ? 'bg-zinc-900/80 border border-zinc-800/60 rounded-2xl p-3.5 space-y-2' : 'border-b border-zinc-800 px-4 py-3'}>
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-zinc-500 font-medium tracking-wide uppercase">Customer</Label>
        <button onClick={() => setAddCustomerOpen(true)} className="text-[10px] theme-text hover:theme-text font-semibold flex items-center gap-1 transition-colors">
          <UserPlus className="h-3 w-3" /> Tambah Baru
        </button>
      </div>
      <div className="relative">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
        <Input
          placeholder={selectedCustomer ? selectedCustomer.name : 'Cari customer (walk-in jika kosong)'}
          value={customerSearch}
          onChange={(e) => { setCustomerSearch(e.target.value); setCustomerDropdownOpen(true) }}
          onFocus={() => setCustomerDropdownOpen(true)}
          className="pl-10 pr-8 h-10 text-sm bg-zinc-800/50 border-zinc-700/60 text-zinc-100 placeholder:text-zinc-500 rounded-xl backdrop-blur-sm"
        />
        {selectedCustomer && (
          <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setPointsToUse(0) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {customerDropdownOpen && filteredCustomers.length > 0 && !selectedCustomer && (
        <div className={`absolute z-30 ${isMobile ? 'w-[calc(100%-1.75rem)]' : 'w-full'} mt-1 bg-zinc-900 border border-zinc-700/60 rounded-2xl shadow-2xl shadow-black/40 max-h-44 overflow-y-auto backdrop-blur-xl`}>
          {filteredCustomers.map((customer) => (
            <button key={customer.id} onClick={() => { setSelectedCustomer(customer); setCustomerSearch(''); setCustomerDropdownOpen(false); setPointsToUse(0) }}
              className="w-full text-left px-4 py-2.5 hover:bg-zinc-800/80 border-b border-zinc-800/40 last:border-0 transition-colors first:rounded-t-2xl last:rounded-b-2xl">
              <p className="text-xs text-zinc-200 font-medium">{customer.name}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">{customer.whatsapp} · <span className="text-amber-400">{customer.points} pts</span></p>
            </button>
          ))}
        </div>
      )}
      {selectedCustomer && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl theme-bg-very-light border theme-border-light">
            <User className="h-3 w-3 theme-text" />
            <span className="text-[11px] theme-text font-medium">{selectedCustomer.name}</span>
          </div>
          {selectedCustomer.points > 0 && (
            <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px] rounded-lg">
              <Coins className="mr-1 h-2.5 w-2.5" />
              {selectedCustomer.points} poin
            </Badge>
          )}
        </div>
      )}
    </div>
  )

  // ==================== RECEIPT RENDERER ====================

  const renderReceiptContent = () => {
    if (!checkoutResult) return null
    return (
      <div ref={receiptContentRef}>
        <style dangerouslySetInnerHTML={{ __html: RECEIPT_CSS }} />
        <div className="r-wrap">
        {/* Header — Business Info */}
        <div className="r-center r-space-lg">
          {settings.receiptLogo && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
              <img
                src={settings.receiptLogo}
                alt="Logo"
                className="r-logo"
                crossOrigin="anonymous"
              />
            </div>
          )}
          <p className="r-bold r-lg">{settings.receiptBusinessName}</p>
          {settings.receiptAddress && <p className="r-muted">{settings.receiptAddress}</p>}
          {settings.receiptPhone && <p className="r-muted">{settings.receiptPhone}</p>}
        </div>

        <hr className="r-sep" />

        {/* Transaction Info */}
        <div className="r-space-sm">
          <div className="r-row"><span className="r-label">No. Invoice</span><span className="r-value-bold">{checkoutResult.invoiceNumber}</span></div>
          <div className="r-row"><span className="r-label">Tanggal</span><span className="r-value">{formatReceiptDateTime()}</span></div>
          <div className="r-row"><span className="r-label">Customer</span><span className="r-value">{selectedCustomer ? selectedCustomer.name : 'Walk-in'}</span></div>
          {isOfflineReceipt && <div className="r-row"><span className="r-warning r-sm">Status</span><span className="r-warning r-semibold r-sm">Offline — Pending Sync</span></div>}
        </div>

        <hr className="r-sep" />

        {/* Items Table Header */}
        <div className="r-row-items r-py r-upper">
          <span className="r-flex1 r-semibold r-sm">Item</span>
          <span className="r-w8 r-semibold r-sm">Qty</span>
          <span className="r-w20 r-semibold r-sm">Subtotal</span>
        </div>
        <hr className="r-sep" />

        {/* Items */}
        <div className="r-space-md">
          {cart.map((item) => (
            <div key={getCartKey(item.product.id, item.variant?.id || null)} className="r-space-sm">
              <p className="r-item-name">{item.product.name}</p>
              {item.variant && <p className="r-item-variant">{item.variant.name}</p>}
              <div className="r-row-items r-gap">
                <span className="r-flex1 r-item-price">@ {formatCurrency(getItemPrice(item))}</span>
                <span className="r-w8 r-value">{item.qty}</span>
                <span className="r-w20 r-value-bold">{formatCurrency(getItemPrice(item) * item.qty)}</span>
              </div>
            </div>
          ))}
        </div>

        <hr className="r-sep" />

        {/* Totals */}
        <div className="r-space-sm">
          <div className="r-row"><span className="r-label">Subtotal</span><span className="r-value">{formatCurrency(subtotal)}</span></div>
          {pointsDiscount > 0 && <div className="r-row"><span className="r-success r-medium">Poin Diskon</span><span className="r-success r-bold">-{formatCurrency(pointsDiscount)}</span></div>}
          {promoDiscount > 0 && selectedPromo && <div className="r-row"><span className="r-warning r-medium">Promo ({selectedPromo.name})</span><span className="r-warning r-bold">-{formatCurrency(promoDiscount)}</span></div>}
          {ppnAmount > 0 && <div className="r-row"><span className="r-label">PPN ({settings.ppnRate}%)</span><span className="r-value">+{formatCurrency(ppnAmount)}</span></div>}
        </div>

        <hr className="r-sep-double" />

        <div className="r-row r-total-row r-bold r-my">
          <span>TOTAL</span>
          <span>{formatCurrency(total)}</span>
        </div>

        <hr className="r-sep" />

        {/* Payment */}
        <div className="r-space-sm">
          <div className="r-row"><span className="r-label">Pembayaran</span><span className="r-semibold r-upper r-sm">{paymentMethod}</span></div>
          <div className="r-row"><span className="r-label">Dibayar</span><span className="r-value">{formatCurrency(paymentMethod === 'CASH' ? Number(paidAmount) : total)}</span></div>
          {paymentMethod === 'CASH' && change > 0 && <div className="r-row r-bold"><span>Kembalian</span><span>{formatCurrency(change)}</span></div>}
        </div>

        {/* Footer */}
        {settings.receiptFooter && (
          <>
            <hr className="r-sep" />
            <div className="r-center r-py">
              <p className="r-footer">{settings.receiptFooter}</p>
            </div>
          </>
        )}
        </div>
      </div>
    )
  }

  // ==================== MAIN RENDER ====================

  return (
    <div className="space-y-3 md:flex md:flex-col md:h-full md:gap-3 md:space-y-0 md:overflow-hidden">
      {/* Header — Mobile Compact */}
      <div className="md:hidden flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {outletInfo ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] font-semibold text-zinc-300 min-w-0">
              <Store className="h-3.5 w-3.5 theme-text shrink-0" />
              <span className="truncate">{outletInfo.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] font-medium text-zinc-600">
              <Store className="h-3.5 w-3.5" />
              <span>No outlet</span>
            </div>
          )}
          <div className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-[10px] font-medium border shrink-0 ${
            isOnline ? 'theme-bg-very-light theme-border-light theme-text' : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          </div>
          {unsyncedCount > 0 && (
            <button onClick={handleSync} disabled={isOnline}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-medium shrink-0 disabled:opacity-40">
              {isOnline ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {unsyncedCount}
            </button>
          )}
        </div>
        <button onClick={async () => {
          if (dataSyncing || !isOnline) return
          setDataSyncing(true)
          try {
            const result = await syncAllData()
            fetchProducts(productSearch, productPage, selectedCategoryId)
            loadCategoriesFromCache()
            loadCustomersFromCache()
            const times = await getAllSyncTimes()
            setLastSyncTimes(times)
            toast.success(`Data direfresh: ${result.products.count} produk, ${result.customers.count} customer`)
          } catch { toast.error('Gagal refresh data') }
          finally { setDataSyncing(false) }
        }} disabled={dataSyncing || !isOnline}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 text-[10px] font-medium shrink-0 disabled:opacity-50">
          {dataSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" />}
        </button>
      </div>

      {/* Header — Desktop Full */}
      <div className="hidden md:flex md:items-center md:justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-zinc-100">Point of Sale</h1>
            <p className="text-[11px] text-zinc-500">Proses transaksi & terima pembayaran</p>
          </div>

          {/* Outlet Selector */}
          {userOutlets.length > 1 ? (
            <Select
              value={outletInfo?.id || ''}
              onValueChange={(value) => {
                const selectedOutlet = userOutlets.find(o => o.id === value)
                if (selectedOutlet && selectedOutlet.id !== outletInfo?.id) {
                  toast.info(`Switching to "${selectedOutlet.name}"...`, {
                    description: 'Data will reload for the selected outlet.',
                    duration: 3000,
                  })
                  setOutletInfo({
                    id: selectedOutlet.id,
                    name: selectedOutlet.name,
                    address: selectedOutlet.address,
                    phone: selectedOutlet.phone,
                  })
                }
              }}
            >
              <SelectTrigger className="w-auto min-w-[180px] max-w-[220px] h-8 bg-zinc-900 border-zinc-700 text-zinc-200 text-xs rounded-lg gap-1.5 pr-2">
                <Store className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                <SelectValue placeholder={outletsLoading ? 'Loading...' : 'Select outlet'} />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {userOutlets.map((outlet) => (
                  <SelectItem key={outlet.id} value={outlet.id} className="text-xs text-zinc-200 focus:bg-zinc-800 focus:text-zinc-100">
                    <div className="flex items-center gap-2">
                      <Store className="h-3.5 w-3.5 text-zinc-500" />
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
          ) : outletInfo ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800/80 border border-zinc-700 text-[11px] font-medium text-zinc-400">
              <Store className="h-3 w-3" />
              <span>{outletInfo.name}</span>
            </div>
          ) : !outletsLoading ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800/50 border border-zinc-800 text-[11px] font-medium text-zinc-600">
              <Store className="h-3 w-3" />
              <span>No outlet</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Connection */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
            isOnline ? 'theme-bg-very-light theme-border-light theme-text' : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {isOnline ? <><Wifi className="h-3 w-3" /><span>Online</span></> : <><WifiOff className="h-3 w-3" /><span>Offline</span></>}
          </div>

          {/* Data sync */}
          {lastSyncTimes.products ? (
            <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
              dataSyncing ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-zinc-800/80 border-zinc-700 text-zinc-500'
            }`}>
              {dataSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
              <span>{dataSyncing ? 'Syncing...' : 'Cached'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium">
              <Database className="h-3 w-3" /><span>No cache</span>
            </div>
          )}

          {/* Unsynced */}
          {unsyncedCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium">
              <CloudOff className="h-3 w-3" /><span>{unsyncedCount} pending</span>
            </div>
          )}

          {/* Buttons */}
          <Button onClick={async () => {
            if (dataSyncing || !isOnline) return
            setDataSyncing(true)
            try {
              const result = await syncAllData()
              fetchProducts(productSearch, productPage, selectedCategoryId)
              loadCategoriesFromCache()
              loadCustomersFromCache()
              const times = await getAllSyncTimes()
              setLastSyncTimes(times)
              toast.success(`Data direfresh: ${result.products.count} produk, ${result.customers.count} customer`)
            } catch { toast.error('Gagal refresh data') }
            finally { setDataSyncing(false) }
          }} disabled={dataSyncing || !isOnline} variant="outline" size="sm"
            className="bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-50 h-7 text-xs gap-1.5">
            {dataSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" />}
            Refresh
          </Button>

          {unsyncedCount > 0 && (
            <Button onClick={handleSync} disabled={isOnline} variant="outline" size="sm"
              className="bg-amber-600/20 border-amber-500/30 text-amber-400 hover:bg-amber-600/30 disabled:opacity-40 h-7 text-xs gap-1.5">
              {isOnline ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync {unsyncedCount}
            </Button>
          )}
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden md:grid md:grid-cols-5 gap-3 flex-1 min-h-0">
        {/* Products - Left */}
        <div className="md:col-span-3 flex flex-col min-h-0">
          {/* Search */}
          <div className="relative mb-3 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <Input
              ref={searchInputRef}
              placeholder="Scan barcode atau cari produk..."
              value={productSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="pl-10 h-10 text-sm bg-zinc-900/80 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl"
            />
          </div>

          {/* Category Chips */}
          <div className="shrink-0">{renderCategoryChips()}</div>

          {/* Product Grid — scrollable middle (pt-2 for badge clearance) */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-2">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 pb-2">
              {renderProductGrid()}
            </div>
          </div>

          {/* Pagination — fixed bottom */}
          <div className="shrink-0">{renderPagination()}</div>
        </div>

        {/* Cart - Right — Redesigned */}
        <div className="md:col-span-2 flex flex-col h-full bg-zinc-950 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl shadow-black/20">
          {/* Cart Header */}
          <div className="px-4 py-3 border-b border-zinc-800/60 bg-gradient-to-b from-zinc-900/50 to-transparent shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl theme-gradient-subtle flex items-center justify-center border theme-border-light">
                  <ShoppingCart className="h-4 w-4 theme-text" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-zinc-100 leading-tight">Keranjang</h2>
                  {cart.length > 0 && <p className="text-[10px] text-zinc-500 leading-tight">{cart.length} produk · {cart.reduce((s, i) => s + i.qty, 0)} item</p>}
                </div>
              </div>
              {cart.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPendingListOpen(true)} className="relative h-7 px-2.5 rounded-lg text-[10px] font-semibold text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 transition-all">
                    <Clock className="h-3 w-3" />
                    {pendingCount > 0 && <span className="ml-1">{pendingCount}</span>}
                  </button>
                  <button onClick={clearCart} className="h-7 px-2.5 rounded-lg text-[10px] font-semibold text-zinc-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all">
                    Hapus Semua
                  </button>
                </div>
              )}
              {cart.length === 0 && pendingCount > 0 && (
                <button onClick={() => setPendingListOpen(true)} className="relative h-7 px-2.5 rounded-lg text-[10px] font-semibold text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 transition-all">
                  <Clock className="h-3 w-3" />
                  <span className="ml-1">{pendingCount} pending</span>
                </button>
              )}
            </div>
          </div>

          {/* Customer Selector — embedded at top of scrollable area */}
          <div className="shrink-0 px-4 pt-3 pb-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Customer</span>
              <button onClick={() => setAddCustomerOpen(true)} className="text-[10px] theme-text hover:theme-text font-semibold flex items-center gap-0.5 transition-colors">
                <UserPlus className="h-2.5 w-2.5" /> Baru
              </button>
            </div>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
              <Input
                placeholder={selectedCustomer ? selectedCustomer.name : 'Tambah customer (opsional)'}
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setCustomerDropdownOpen(true) }}
                onFocus={() => setCustomerDropdownOpen(true)}
                className="pl-9 pr-8 h-9 text-xs bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 rounded-xl"
              />
              {selectedCustomer && (
                <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setPointsToUse(0) }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
            {customerDropdownOpen && filteredCustomers.length > 0 && !selectedCustomer && (
              <div className="absolute z-30 w-full mt-1 bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl shadow-black/50 max-h-40 overflow-y-auto">
                {filteredCustomers.map((customer) => (
                  <button key={customer.id} onClick={() => { setSelectedCustomer(customer); setCustomerSearch(''); setCustomerDropdownOpen(false); setPointsToUse(0) }}
                    className="w-full text-left px-3.5 py-2 hover:bg-zinc-800/80 border-b border-zinc-800/30 last:border-0 transition-colors">
                    <p className="text-xs text-zinc-200 font-medium">{customer.name}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">{customer.whatsapp} · <span className="text-amber-400">{customer.points} pts</span></p>
                  </button>
                ))}
              </div>
            )}
            {selectedCustomer && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg theme-bg-very-light border theme-border-light">
                  <User className="h-2.5 w-2.5 theme-text" />
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
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-zinc-800/60 to-zinc-900 border border-zinc-800/40 flex items-center justify-center mb-4">
                  <ShoppingCart className="h-8 w-8 text-zinc-700/60" />
                </div>
                <p className="text-sm font-medium text-zinc-500">Keranjang Kosong</p>
                <p className="text-[11px] text-zinc-600 mt-1">Pilih produk dari kiri untuk memulai</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {cart.map((item) => {
                  const itemKey = getCartKey(item.product.id, item.variant?.id || null)
                  const itemTotal = getItemPrice(item) * item.qty
                  return (
                  <div key={itemKey} className="group flex items-center gap-2.5 p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800/40 hover:border-zinc-700/60 transition-all duration-150">
                    {/* Product Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-100 truncate leading-tight">{item.product.name}</p>
                      {item.variant && (
                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/15">
                          <span className="text-[9px] font-medium text-violet-400 leading-tight">{item.variant.name}</span>
                        </span>
                      )}
                      <p className="text-[10px] text-zinc-500 mt-1">
                        {formatCurrency(getItemPrice(item))} × {item.qty}
                      </p>
                    </div>

                    {/* Item Total */}
                    <p className="text-xs font-bold theme-text shrink-0 tabular-nums mr-1">{formatCurrency(itemTotal)}</p>

                    {/* Qty Controls */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button className="h-7 w-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all active:scale-90"
                        onClick={() => updateQty(item.product.id, item.qty - 1, item.variant?.id)}><Minus className="h-3 w-3" /></button>
                      {editingQtyId === itemKey ? (
                        <input
                          ref={qtyInputRef}
                          type="number"
                          min="0"
                          max={getItemStock(item)}
                          value={editingQtyValue}
                          onChange={(e) => setEditingQtyValue(e.target.value)}
                          onBlur={confirmEditQty}
                          onKeyDown={(e) => { if (e.key === 'Enter') confirmEditQty(); if (e.key === 'Escape') cancelEditQty() }}
                          className="text-xs text-zinc-100 w-8 text-center font-bold bg-zinc-800 border border-zinc-700 rounded-lg h-7 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        <span
                          className="text-xs text-zinc-100 w-6 text-center font-bold cursor-pointer hover:theme-text transition-colors"
                          onClick={() => startEditQty(itemKey, item.qty)}
                          title="Klik untuk edit qty"
                        >{item.qty}</span>
                      )}
                      <button className="h-7 w-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all active:scale-90"
                        onClick={() => updateQty(item.product.id, item.qty + 1, item.variant?.id)}><Plus className="h-3 w-3" /></button>
                    </div>

                    {/* Delete — shown on hover */}
                    <button className="h-6 w-6 flex items-center justify-center rounded-md text-zinc-700 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                      onClick={() => removeFromCart(item.product.id, item.variant?.id)}><Trash2 className="h-3 w-3" /></button>
                  </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Summary & Payment — fixed bottom */}
          <div className="shrink-0 border-t border-zinc-800/60 bg-gradient-to-t from-zinc-950 to-zinc-900/80 overflow-y-auto overscroll-contain max-h-[45%]">
            <div className="p-4 space-y-3">
            {/* Totals */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-zinc-400"><span>Subtotal</span><span className="text-zinc-200 tabular-nums">{formatCurrency(subtotal)}</span></div>
              {settings.loyaltyEnabled && selectedCustomer && maxPointsToUse > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400 flex items-center gap-1.5"><Coins className="h-3 w-3" /> Pakai Poin</span>
                  <Input type="number" min="0" max={maxPointsToUse} value={pointsToUse || ''} onChange={(e) => handlePointsChange(e.target.value)}
                    placeholder="0" className="w-20 h-7 text-right text-[11px] bg-zinc-800 border-zinc-700 text-zinc-100 rounded-lg" />
                </div>
              )}
              {pointsDiscount > 0 && (
                <div className="flex justify-between theme-text"><span className="flex items-center gap-1.5"><Coins className="h-3 w-3" /> Diskon Poin</span><span className="tabular-nums">-{formatCurrency(pointsDiscount)}</span></div>
              )}
              {promoDiscount > 0 && selectedPromo && (
                <div className="flex justify-between text-amber-400">
                  <span className="flex items-center gap-1.5"><Tag className="h-3 w-3" /> {selectedPromo.name}</span>
                  <span className="tabular-nums">-{formatCurrency(promoDiscount)}</span>
                </div>
              )}
              {ppnAmount > 0 && (
                <div className="flex justify-between text-sky-300"><span>PPN ({settings.ppnRate}%)</span><span className="tabular-nums">+{formatCurrency(ppnAmount)}</span></div>
              )}
              <Separator className="bg-zinc-800/80" />
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-black text-zinc-100">Total</span>
                <span className="text-lg font-black text-zinc-50 tabular-nums">{formatCurrency(total)}</span>
              </div>
            </div>

            {/* Payment Methods */}
            {renderPaymentButtons(false)}

            {/* Cash Payment */}
            {paymentMethod === 'CASH' && (
              <div className="space-y-2.5">
                <div className="relative">
                  <Label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Jumlah Bayar</Label>
                  <Input type="number" min="0" step="any" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)}
                    placeholder="0" className="mt-1.5 h-11 text-base font-bold bg-zinc-800/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 rounded-xl text-right pr-14 tabular-nums" />
                  <span className="absolute right-3 top-[calc(50%+8px)] -translate-y-1/2 text-xs text-zinc-500 font-medium">Rp</span>
                </div>
                {Number(paidAmount) >= total && total > 0 && (
                  <div className="flex items-center justify-between text-xs theme-bg-very-light border theme-border-light rounded-xl px-3.5 py-2.5">
                    <span className="theme-text font-medium">Kembalian</span>
                    <span className="theme-text font-bold text-sm tabular-nums">{formatCurrency(change)}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {getQuickNominals.map((nom) => (
                    <button key={nom} onClick={() => setPaidAmount(String(nom))}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                        Number(paidAmount) === nom
                          ? `${themeColors.activeBg} ${themeColors.text} ${themeColors.border} shadow-sm`
                          : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                      }`}>
                      {nom >= 1000 ? `${nom / 1000}K` : nom}
                    </button>
                  ))}
                  {total > 0 && (
                    <button onClick={() => setPaidAmount(String(Math.ceil(total / 1000) * 1000))}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border bg-amber-500/5 border-amber-500/20 text-amber-400 hover:bg-amber-500/10 transition-all">
                      Uang Pas
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* QRIS Payment */}
            {paymentMethod === 'QRIS' && (
              <div className="p-5 rounded-xl bg-zinc-900 border border-zinc-800/60 text-center">
                <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                  <QrCode className="h-8 w-8 text-zinc-600" />
                </div>
                <p className="text-xs text-zinc-400">Scan QRIS untuk bayar</p>
                <p className="text-base font-black text-zinc-200 mt-1 tabular-nums">{formatCurrency(total)}</p>
              </div>
            )}

            {/* DEBIT Payment */}
            {paymentMethod === 'DEBIT' && (
              <div className="p-5 rounded-xl bg-zinc-900 border border-zinc-800/60 text-center">
                <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                  <CreditCard className="h-8 w-8 text-zinc-600" />
                </div>
                <p className="text-xs text-zinc-400">Tap atau gesek kartu debit</p>
                <p className="text-base font-black text-zinc-200 mt-1 tabular-nums">{formatCurrency(total)}</p>
              </div>
            )}

            {/* TRANSFER Payment */}
            {paymentMethod === 'TRANSFER' && (
              <div className="p-5 rounded-xl bg-zinc-900 border border-zinc-800/60 text-center">
                <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                  <ArrowRightLeft className="h-8 w-8 text-orange-500/40" />
                </div>
                <p className="text-xs text-zinc-400">Mohon transfer ke rekening outlet</p>
                <p className="text-base font-black text-zinc-200 mt-1 tabular-nums">{formatCurrency(total)}</p>
              </div>
            )}

            {/* Checkout Button */}
            <div className="flex gap-2">
              {cart.length > 0 && (
                <Button onClick={handleHoldTransaction} variant="outline"
                  className="h-12 px-4 font-semibold text-sm rounded-xl border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-all shrink-0">
                  <ClockArrowDown className="mr-1.5 h-4 w-4" />
                  Tunda
                </Button>
              )}
              <Button onClick={openCheckoutDialog} disabled={cart.length === 0 || checkingOut}
                className={`flex-1 h-12 font-bold text-sm rounded-xl transition-all ${
                  cart.length > 0
                    ? `theme-gradient hover:theme-hover text-white shadow-lg theme-shadow hover:theme-shadow active:scale-[0.99]`
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}>
                {checkingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {checkingOut ? 'Memproses...' : 'Proses Pembayaran'}
              </Button>
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Layout — Product view + floating cart */}
      <div className="md:hidden shrink-0">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            ref={searchInputRef}
            placeholder="Cari produk..."
            value={productSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="pl-10 h-11 text-sm bg-zinc-900/80 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 rounded-xl"
          />
        </div>
        {renderCategoryChips()}
        <div className="grid grid-cols-2 gap-2.5 pt-2 pb-2">{renderProductGrid()}</div>
        <div className="pb-8">{renderPagination()}</div>
      </div>

      {/* Floating Pending Button — Mobile only, visible when there are pending tx and cart is empty */}
      {isMobile && pendingCount > 0 && cart.length === 0 && (
        <button
          onClick={() => setPendingListOpen(true)}
          className="md:hidden fixed bottom-20 right-4 z-50 flex items-center gap-2.5 h-12 pl-3.5 pr-4 rounded-2xl bg-zinc-800 border border-zinc-700/80 text-zinc-100 shadow-2xl shadow-black/30 hover:bg-zinc-700 active:scale-95 transition-all duration-150"
        >
          <div className="relative">
            <Clock className="h-5 w-5 text-amber-400" />
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center shadow-sm px-1">{pendingCount}</span>
          </div>
          <span className="text-xs font-semibold">Pending</span>
        </button>
      )}

      {/* Floating Cart Button — Mobile only, outside scroll area to prevent clipping */}
      {cart.length > 0 && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="md:hidden fixed bottom-20 right-4 z-50 flex items-center gap-3 h-14 pl-4 pr-5 rounded-2xl theme-gradient text-white shadow-2xl theme-shadow hover:theme-shadow active:scale-95 transition-all duration-150"
        >
          <div className="relative">
            <ShoppingCart className="h-5 w-5" />
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 rounded-full bg-white theme-bg-dark text-[9px] font-bold flex items-center justify-center shadow-sm px-1">{cart.reduce((s, i) => s + i.qty, 0)}</span>
          </div>
          <div className="flex flex-col items-start leading-tight">
            <span className="text-[10px] font-medium theme-text-light">{cart.length} produk</span>
            <span className="text-sm font-bold">{formatCurrency(total)}</span>
          </div>
        </button>
      )}

      {/* ── Mobile Cart Sheet — Redesigned ── */}
      <Sheet open={mobileCartOpen} onOpenChange={(open) => { if (!open) setMobileCartOpen(false) }}>
        <SheetContent side="bottom" className="bg-zinc-950 border-zinc-800/80 rounded-t-[28px] h-[88vh] max-h-[88vh] overflow-hidden flex flex-col px-0 gap-0">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-zinc-700/60" />
          </div>

          {/* Header */}
          <div className="px-5 pb-3 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl theme-gradient-subtle flex items-center justify-center border theme-border-light">
                  <ShoppingCart className="h-4 w-4 theme-text" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-zinc-100 leading-tight">Keranjang</h2>
                  {cart.length > 0 && <p className="text-[10px] text-zinc-500">{cart.length} produk · {cart.reduce((s, i) => s + i.qty, 0)} item</p>}
                </div>
              </div>
              {cart.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPendingListOpen(true)} className="relative h-8 px-2.5 rounded-lg text-[11px] font-semibold text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 border border-zinc-800 hover:border-amber-500/20 transition-all">
                    <Clock className="h-3.5 w-3.5" />
                    {pendingCount > 0 && <span className="ml-1">{pendingCount}</span>}
                  </button>
                  <button onClick={clearCart} className="h-8 px-3 rounded-lg text-[11px] font-semibold text-zinc-500 hover:text-red-400 hover:bg-red-500/10 border border-zinc-800 hover:border-red-500/20 transition-all">
                    Hapus Semua
                  </button>
                </div>
              )}
              {cart.length === 0 && pendingCount > 0 && (
                <button onClick={() => setPendingListOpen(true)} className="h-8 px-3 rounded-lg text-[11px] font-semibold text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 border border-zinc-800 hover:border-amber-500/20 transition-all">
                  <Clock className="h-3.5 w-3.5 mr-1" />
                  {pendingCount} pending
                </button>
              )}
            </div>
          </div>

          {/* Customer selector — compact */}
          <div className="shrink-0 px-5 pb-2">{renderCustomerSelector(true)}</div>

          {/* Scrollable items */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-zinc-800/60 to-zinc-900 border border-zinc-800/40 flex items-center justify-center mb-4">
                  <ShoppingCart className="h-8 w-8 text-zinc-700/60" />
                </div>
                <p className="text-sm font-medium text-zinc-500">Keranjang Kosong</p>
                <p className="text-[11px] text-zinc-600 mt-1">Pilih produk untuk memulai</p>
              </div>
            ) : (
              <div className="space-y-2 pb-2">
                {cart.map((item) => {
                  const itemKey = getCartKey(item.product.id, item.variant?.id || null)
                  const itemTotal = getItemPrice(item) * item.qty
                  return (
                  <div key={itemKey} className="flex items-center gap-3 p-3 rounded-2xl bg-zinc-900/70 border border-zinc-800/50">
                    {/* Product Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-zinc-100 font-semibold truncate leading-tight">{item.product.name}</p>
                      {item.variant && (
                        <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/15">
                          <span className="text-[9px] font-semibold text-violet-400 leading-tight">{item.variant.name}</span>
                        </span>
                      )}
                      <p className="text-[11px] text-zinc-500 mt-1">
                        {formatCurrency(getItemPrice(item))} × {item.qty}
                      </p>
                    </div>

                    {/* Qty Controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button className="h-9 w-9 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-all active:scale-95"
                        onClick={() => updateQty(item.product.id, item.qty - 1, item.variant?.id)}><Minus className="h-4 w-4" /></button>
                      {editingQtyId === itemKey ? (
                        <input
                          ref={qtyInputRef}
                          type="number"
                          min="0"
                          max={getItemStock(item)}
                          value={editingQtyValue}
                          onChange={(e) => setEditingQtyValue(e.target.value)}
                          onBlur={confirmEditQty}
                          onKeyDown={(e) => { if (e.key === 'Enter') confirmEditQty(); if (e.key === 'Escape') cancelEditQty() }}
                          className="text-sm text-zinc-100 w-14 text-center font-bold bg-zinc-800 border border-zinc-700 rounded-xl h-9 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        <span
                          className="text-sm w-8 text-center text-zinc-100 font-bold cursor-pointer hover:theme-text transition-colors"
                          onClick={() => startEditQty(itemKey, item.qty)}
                        >{item.qty}</span>
                      )}
                      <button className="h-9 w-9 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-all active:scale-95"
                        onClick={() => updateQty(item.product.id, item.qty + 1, item.variant?.id)}><Plus className="h-4 w-4" /></button>
                    </div>

                    {/* Item Total + Delete */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="text-sm font-bold theme-text tabular-nums">{formatCurrency(itemTotal)}</p>
                      <button className="h-6 w-6 flex items-center justify-center rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        onClick={() => removeFromCart(item.product.id, item.variant?.id)}><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Sticky footer: Total + Bayar */}
          {cart.length > 0 && (
            <div className="shrink-0 border-t border-zinc-800/60 bg-gradient-to-t from-zinc-950 to-zinc-900/50 px-5 pt-3.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {/* Discount info (compact) */}
              {(pointsDiscount > 0 || promoDiscount > 0 || ppnAmount > 0) && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2.5">
                  {pointsDiscount > 0 && (
                    <span className="text-[11px] theme-text font-medium flex items-center gap-1"><Coins className="h-3 w-3" /> -{formatCurrency(pointsDiscount)}</span>
                  )}
                  {promoDiscount > 0 && selectedPromo && (
                    <span className="text-[11px] text-amber-400 font-medium flex items-center gap-1"><Tag className="h-3 w-3" /> -{formatCurrency(promoDiscount)}</span>
                  )}
                  {ppnAmount > 0 && (
                    <span className="text-[11px] text-sky-300 font-medium">PPN: +{formatCurrency(ppnAmount)}</span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold leading-tight">Total</p>
                  <p className="text-2xl font-black text-zinc-50 leading-tight tabular-nums">{formatCurrency(total)}</p>
                </div>
                <Button onClick={handleHoldTransaction} variant="outline"
                  className="h-12 px-3 font-semibold text-xs rounded-2xl border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-all shrink-0">
                  <ClockArrowDown className="h-4 w-4" />
                </Button>
                <Button onClick={openCheckoutDialog}
                  className="h-12 px-8 font-bold text-sm rounded-2xl theme-gradient hover:theme-hover text-white shadow-lg theme-shadow transition-all active:scale-[0.98] shrink-0">
                  Bayar <ChevronRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Mobile Checkout Sheet (Payment Flow) ── */}
      {isMobile ? (
        <Sheet open={checkoutOpen} onOpenChange={(open) => { if (!open) setCheckoutOpen(false) }}>
          <SheetContent side="bottom" className="bg-zinc-950 border-zinc-800 rounded-t-3xl h-[92vh] max-h-[92vh] overflow-hidden flex flex-col px-0 gap-0">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-zinc-700" />
            </div>
            <SheetHeader className="px-5 pb-3 shrink-0">
              <SheetTitle className="text-zinc-100 text-base font-bold flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg theme-bg-subtle flex items-center justify-center">
                  <Banknote className="h-4 w-4 theme-text" />
                </div>
                Pembayaran
                <span className="ml-auto text-[11px] font-medium text-zinc-500 bg-zinc-800 px-2.5 py-0.5 rounded-full">{cart.reduce((s, i) => s + i.qty, 0)} item</span>
              </SheetTitle>
            </SheetHeader>

            {/* Scrollable content */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 space-y-4 pb-2">
              {/* Order summary */}
              <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-3.5">
                <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wide mb-2">Ringkasan Pesanan</p>
                <div className="space-y-1.5 text-xs">
                  {cart.map((item) => (
                    <div key={getCartKey(item.product.id, item.variant?.id || null)} className="flex justify-between text-zinc-300">
                      <span className="truncate mr-2">{item.variant ? `${item.product.name} (${item.variant.name})` : item.product.name} <span className="text-zinc-500">×{item.qty}</span></span>
                      <span className="font-medium shrink-0">{formatCurrency(getItemPrice(item) * item.qty)}</span>
                    </div>
                  ))}
                  <Separator className="bg-zinc-800 !my-2" />
                  <div className="flex justify-between text-zinc-400"><span>Subtotal</span><span className="text-zinc-200">{formatCurrency(subtotal)}</span></div>
                  {settings.loyaltyEnabled && selectedCustomer && maxPointsToUse > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-400 flex items-center gap-1 shrink-0"><Coins className="h-3 w-3" /> Pakai Poin</span>
                      <Input type="number" min="0" max={maxPointsToUse} value={pointsToUse || ''} onChange={(e) => handlePointsChange(e.target.value)}
                        placeholder="0" className="w-24 h-8 text-right text-xs bg-zinc-800 border-zinc-700 text-zinc-100 rounded-lg" />
                    </div>
                  )}
                  {pointsDiscount > 0 && <div className="flex justify-between theme-text"><span>Diskon Poin</span><span>-{formatCurrency(pointsDiscount)}</span></div>}
                  {promoDiscount > 0 && selectedPromo && (
                    <div className="flex justify-between text-amber-400">
                      <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {selectedPromo.name}</span>
                      <span>-{formatCurrency(promoDiscount)}</span>
                    </div>
                  )}
                  {ppnAmount > 0 && <div className="flex justify-between text-sky-300 font-medium"><span>PPN ({settings.ppnRate}%)</span><span>+{formatCurrency(ppnAmount)}</span></div>}
                  <Separator className="bg-zinc-800 !my-2" />
                  <div className="flex justify-between text-base font-black text-zinc-100"><span>Total</span><span>{formatCurrency(total)}</span></div>
                </div>
                {selectedCustomer && (
                  <div className="mt-2 pt-2 border-t border-zinc-800/60 text-[11px] text-zinc-500">
                    👤 {selectedCustomer.name}
                  </div>
                )}
              </div>

              {/* Payment method */}
              <div>
                <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wide mb-2">Metode Pembayaran</p>
                {renderPaymentButtons(false)}
              </div>

              {/* Cash payment section */}
              {paymentMethod === 'CASH' && (
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] text-zinc-500 font-medium mb-1.5">Jumlah Bayar</p>
                    <Input type="number" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} placeholder="Masukkan jumlah"
                      className="h-12 text-base bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 rounded-xl text-right font-bold" />
                  </div>
                  {Number(paidAmount) >= total && total > 0 && (
                    <div className="flex justify-between items-center text-sm theme-bg-very-light border theme-border-light rounded-xl px-4 py-3">
                      <span className="theme-text font-medium">Kembalian</span>
                      <span className="theme-text font-black text-lg">{formatCurrency(change)}</span>
                    </div>
                  )}
                  <div>
                    <p className="text-[11px] text-zinc-500 font-medium mb-2">Nominal Cepat</p>
                    <div className="grid grid-cols-3 gap-2">
                      {getQuickNominals.map((nom) => (
                        <button key={nom} onClick={() => setPaidAmount(String(nom))}
                          className={cn(
                            'py-3 rounded-xl text-sm font-bold border transition-all active:scale-95',
                            Number(paidAmount) === nom
                              ? 'theme-bg-subtle theme-text theme-border-medium shadow-sm'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 active:bg-zinc-800'
                          )}>
                          {nom >= 1000 ? `${(nom / 1000)}K` : nom}
                        </button>
                      ))}
                      {total > 0 && (
                        <button onClick={() => setPaidAmount(String(Math.ceil(total / 1000) * 1000))}
                          className="py-3 rounded-xl text-sm font-bold border bg-zinc-900 border-zinc-800 text-amber-400 hover:border-amber-500/30 transition-all active:scale-95">
                          Uang Pas
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Non-cash info */}
              {paymentMethod !== 'CASH' && (
                <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-4 text-center">
                  <p className="text-xs text-zinc-400">Pembayaran <span className="font-bold text-zinc-200 uppercase">{paymentMethod}</span></p>
                  <p className="text-2xl font-black text-zinc-100 mt-1">{formatCurrency(total)}</p>
                </div>
              )}
            </div>

            {/* Sticky confirm footer */}
            <SheetFooter className="shrink-0 flex-row gap-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] px-5 border-t border-zinc-800">
              <Button variant="ghost" onClick={() => setCheckoutOpen(false)}
                className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 text-sm font-medium rounded-2xl h-12">
                Kembali
              </Button>
              <Button onClick={handleCheckout}
                disabled={checkingOut || (paymentMethod === 'CASH' && Number(paidAmount) < total)}
                className="flex-1 theme-bg theme-hover text-white text-sm font-bold h-12 rounded-2xl shadow-lg theme-shadow transition-all active:scale-[0.98]">
                {checkingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {checkingOut ? 'Memproses...' : `Konfirmasi ${formatCurrency(total)}`}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={checkoutOpen} onOpenChange={(open) => { if (!open) setCheckoutOpen(false) }}>
          <DialogContent className="bg-zinc-900 border-zinc-800 max-w-md rounded-2xl">
            <DialogHeader className="pb-2">
              <DialogTitle className="text-zinc-100 text-sm font-bold">Konfirmasi Pembayaran</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1 text-xs">
                {cart.map((item) => (
                  <div key={getCartKey(item.product.id, item.variant?.id || null)} className="flex justify-between text-zinc-300 py-0.5">
                    <span>{item.variant ? `${item.product.name} (${item.variant.name})` : item.product.name} × {item.qty}</span>
                    <span className="font-medium">{formatCurrency(getItemPrice(item) * item.qty)}</span>
                  </div>
                ))}
                <Separator className="bg-zinc-800 my-1.5" />
                <div className="flex justify-between text-zinc-400"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
                {pointsDiscount > 0 && <div className="flex justify-between theme-text"><span>Diskon Poin</span><span>-{formatCurrency(pointsDiscount)}</span></div>}
                {promoDiscount > 0 && selectedPromo && (
                  <div className="flex justify-between text-amber-400 text-xs">
                    <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> Promo: {selectedPromo.name}</span>
                    <span>-{formatCurrency(promoDiscount)}</span>
                  </div>
                )}
                {ppnAmount > 0 && <div className="flex justify-between text-sky-300 text-xs font-medium"><span>PPN ({settings.ppnRate}%)</span><span>+{formatCurrency(ppnAmount)}</span></div>}
                <div className="flex justify-between text-sm font-black text-zinc-100 pt-0.5"><span>Total</span><span>{formatCurrency(total)}</span></div>
              </div>

              <Separator className="bg-zinc-800" />

              <div className="text-xs space-y-1">
                <div className="flex justify-between text-zinc-400"><span>Metode</span><span className="text-zinc-200 font-medium uppercase">{paymentMethod}</span></div>
                {paymentMethod === 'CASH' && (
                  <>
                    <div className="flex justify-between text-zinc-400"><span>Dibayar</span><span className="text-zinc-200">{formatCurrency(Number(paidAmount))}</span></div>
                    <div className="flex justify-between theme-text font-bold"><span>Kembalian</span><span>{formatCurrency(change)}</span></div>
                  </>
                )}
                {(paymentMethod === 'QRIS' || paymentMethod === 'DEBIT' || paymentMethod === 'TRANSFER') && (
                  <div className="flex justify-between text-zinc-400"><span>Dibayar</span><span className="text-zinc-200">{formatCurrency(total)}</span></div>
                )}
              </div>

              <p className="text-[11px] text-zinc-500">Customer: {selectedCustomer ? selectedCustomer.name : 'Walk-in'}</p>
            </div>
            <DialogFooter className="gap-2 pt-1">
              <Button variant="ghost" onClick={() => setCheckoutOpen(false)} className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 text-xs rounded-xl">Batal</Button>
              <Button onClick={handleCheckout} disabled={checkingOut || (paymentMethod === 'CASH' && Number(paidAmount) < total)}
                className="theme-bg theme-hover text-white text-xs rounded-xl font-bold">
                {checkingOut && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />} Konfirmasi
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Receipt Dialog */}
      <Dialog open={receiptOpen} onOpenChange={(open) => { if (!open) handleReceiptSkip() }}>
        <DialogContent className="bg-white border-zinc-200 max-w-md p-0 overflow-hidden rounded-2xl">
          {checkoutResult && (
            <>
              <DialogHeader className="sr-only"><DialogTitle>Struk - {checkoutResult.invoiceNumber}</DialogTitle></DialogHeader>
              <ScrollArea className="max-h-[80vh]">
                <div className="p-5">
                  {/* Status badge */}
                  <div className="flex items-center justify-center gap-2 mb-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isOfflineReceipt ? 'bg-amber-100' : 'theme-bg-very-light'}`}>
                      {isOfflineReceipt ? <CloudOff className="h-4 w-4 text-amber-600" /> : <Check className="h-4 w-4 theme-text-medium" />}
                    </div>
                    <div className="text-left">
                      <p className={`text-xs font-bold ${isOfflineReceipt ? 'text-amber-700' : 'theme-text-medium'}`}>
                        {isOfflineReceipt ? 'Tersimpan Offline' : 'Pembayaran Berhasil'}
                      </p>
                      <p className="text-[10px] text-zinc-500">{checkoutResult.invoiceNumber}</p>
                    </div>
                  </div>

                  {/* Sync error warning */}
                  {checkoutResult.syncError && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 mb-3">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[11px] text-amber-700 font-medium">Gagal sync ke server</p>
                        <p className="text-[10px] text-amber-600">{checkoutResult.syncError}</p>
                      </div>
                    </div>
                  )}

                  {/* Receipt content — thermal preview */}
                  <div className="bg-white border border-zinc-200 rounded-lg shadow-inner mx-auto max-w-[280px] p-3 overflow-hidden">
                    {renderReceiptContent()}
                  </div>
                </div>
              </ScrollArea>
              <DialogFooter className="flex gap-2 p-3 border-t border-zinc-200 bg-zinc-50 rounded-b-2xl">
                <Button onClick={handleReceiptPrint} className="flex-1 theme-bg theme-hover text-white text-sm font-medium rounded-xl h-10">
                  <ReceiptText className="mr-1.5 h-4 w-4" /> Cetak Struk
                </Button>
                <Button variant="outline" onClick={handleReceiptSkip} className="flex-1 border-zinc-300 text-zinc-600 hover:bg-zinc-100 text-sm rounded-xl h-10">
                  Selesai
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Variant Picker Dialog */}
      <ResponsiveDialog open={variantPicker.open} onOpenChange={(open) => {
        if (!open) setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })
      }}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-violet-500/20 flex items-center justify-center">
                <Layers className="h-3.5 w-3.5 text-violet-400" />
              </div>
              Pilih Varian
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-xs text-zinc-500">
              {variantPicker.product?.name || 'Produk'}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2">
            {variantPicker.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
              </div>
            ) : variantPicker.variants.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-8 w-8 text-zinc-700 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">Tidak ada varian tersedia</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {[...variantPicker.variants].sort((a, b) => {
                  // In-stock first, then by name
                  const aOk = a.stock > 0 ? 0 : 1
                  const bOk = b.stock > 0 ? 0 : 1
                  if (aOk !== bOk) return aOk - bOk
                  return a.name.localeCompare(b.name)
                }).map((variant) => {
                  const isOutOfStock = variant.stock <= 0
                  const cartKey = getCartKey(variantPicker.product.id, variant.id)
                  const existingItem = cart.find((i) => getCartKey(i.product.id, i.variant?.id || null) === cartKey)
                  return (
                    <button
                      key={variant.id}
                      onClick={() => handleVariantSelect(variant)}
                      disabled={isOutOfStock}
                      className={cn(
                        'w-full text-left flex items-center justify-between gap-3 p-3 rounded-xl border transition-all',
                        isOutOfStock
                          ? 'opacity-40 cursor-not-allowed bg-zinc-900/30 border-zinc-800/40'
                          : 'bg-zinc-800/50 border-zinc-700/50 hover:border-violet-500/40 hover:bg-violet-500/5 active:scale-[0.99] cursor-pointer'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-xs font-medium', isOutOfStock ? 'text-zinc-600' : 'text-zinc-200')}>{variant.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {variant.sku && (
                            <span className="text-[10px] text-zinc-600 font-mono">{variant.sku}</span>
                          )}
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-md font-medium',
                            isOutOfStock
                              ? 'bg-red-500/10 text-red-400'
                              : variant.stock <= 5
                                ? 'bg-amber-500/10 text-amber-400'
                                : 'bg-zinc-800 text-zinc-500'
                          )}>
                            Stok: {variant.stock}
                          </span>
                          {existingItem && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium theme-bg-very-light theme-text">
                              ×{existingItem.qty}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <p className={cn('text-sm font-bold', isOutOfStock ? 'text-zinc-600' : 'text-violet-400')}>
                          {formatCurrency(variant.price)}
                        </p>
                        {existingItem && !isOutOfStock && (
                          <div className="flex items-center gap-0.5 ml-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); updateQty(variantPicker.product.id, existingItem.qty - 1, variant.id) }}
                              className="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700/50 flex items-center justify-center text-zinc-400 hover:bg-red-500/20 hover:text-red-400 transition-all active:scale-95"
                            >
                              {existingItem.qty === 1 ? <Trash2 className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                            </button>
                            <span className="text-[11px] font-bold text-zinc-200 w-5 text-center">{existingItem.qty}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); updateQty(variantPicker.product.id, existingItem.qty + 1, variant.id) }}
                              disabled={existingItem.qty >= variant.stock}
                              className="w-6 h-6 rounded-md bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-400 hover:bg-violet-500/30 transition-all active:scale-95 disabled:opacity-30"
                            >
                              <Plus className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 text-xs rounded-xl">Tutup</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Add Customer Dialog */}
      <ResponsiveDialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <UserPlus className="h-4 w-4 theme-text" /> Tambah Customer Baru
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Nama *</Label>
              <Input value={newCustomer.name} onChange={(e) => setNewCustomer(p => ({ ...p, name: e.target.value }))}
                placeholder="Nama customer" className="h-9 text-sm bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">No. WhatsApp *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-zinc-500 font-medium">+62</span>
                <Input value={newCustomer.whatsapp} onChange={(e) => setNewCustomer(p => ({ ...p, whatsapp: e.target.value.replace(/[^0-9]/g, '') }))}
                  placeholder="81234567890" className="h-9 text-sm bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 rounded-lg pl-12" />
              </div>
              <p className="text-[10px] text-zinc-600">Format: 81234567890 (tanpa 0 di depan). WhatsApp digunakan sebagai ID unik.</p>
            </div>
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setAddCustomerOpen(false)} className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 text-xs rounded-xl">Batal</Button>
            <Button onClick={handleAddCustomer} disabled={addingCustomer || !newCustomer.name.trim() || !newCustomer.whatsapp.trim()}
              className="theme-bg theme-hover text-white text-xs rounded-xl font-medium">
              {addingCustomer && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />} Simpan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Hold Note Dialog */}
      <ResponsiveDialog open={holdNoteDialog} onOpenChange={setHoldNoteDialog}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <ClockArrowDown className="h-4 w-4 text-amber-400" /> Tunda Transaksi
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-xs text-zinc-500">
              Tambahkan catatan untuk memudahkan identifikasi transaksi ini
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2">
            <Label className="text-[11px] text-zinc-400 font-medium">Catatan (opsional)</Label>
            <Input
              value={pendingNote}
              onChange={(e) => setPendingNote(e.target.value)}
              placeholder="cth: Bapak baju merah, nanti sore"
              className="mt-1.5 h-10 text-sm bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 rounded-xl"
              onKeyDown={(e) => { if (e.key === 'Enter') confirmHoldTransaction() }}
              autoFocus
            />
          </div>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setHoldNoteDialog(false)}
              className="h-9 text-xs rounded-xl text-zinc-400 hover:text-zinc-200">
              Batal
            </Button>
            <Button onClick={confirmHoldTransaction}
              className="h-9 text-xs font-semibold rounded-xl theme-bg hover:theme-hover text-white">
              Tunda
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Pending Transactions List Dialog */}
      <ResponsiveDialog open={pendingListOpen} onOpenChange={setPendingListOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-md rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-400" /> Transaksi Pending
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-1 bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] px-1.5">{pendingCount}</Badge>
              )}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <PendingListContent
            onResume={handleResumePending}
            onDelete={handleDeletePending}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}

// ==================== PENDING LIST SUB-COMPONENT ====================

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
        <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
      </div>
    )
  }

  if (pendingList.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 flex items-center justify-center mx-auto mb-3">
          <Clock className="h-5 w-5 text-zinc-600" />
        </div>
        <p className="text-sm text-zinc-400 font-medium">Belum ada transaksi pending</p>
        <p className="text-[11px] text-zinc-600 mt-1">Tunda transaksi untuk melayani customer lain</p>
      </div>
    )
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto">
      {pendingList.map((pending) => {
        const items = pending.items as Array<{ product: { name: string; image: string | null }; variant: { name: string } | null; qty: number }>
        const totalItems = items.reduce((s, i) => s + i.qty, 0)

        return (
          <div key={pending.id} className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-3.5 space-y-2.5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <ClockArrowDown className="h-3.5 w-3.5 text-amber-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-200">{totalItems} item</p>
                  <p className="text-[10px] text-zinc-500">{formatTime(pending.createdAt)} · {pending.userName}</p>
                </div>
              </div>
              <p className="text-sm font-bold text-zinc-100 tabular-nums">{formatCurrency(pending.subtotal)}</p>
            </div>

            {/* Note */}
            {pending.note && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <p className="text-[11px] text-amber-300 font-medium leading-relaxed">{pending.note}</p>
              </div>
            )}

            {/* Customer info */}
            {(pending.customerName || pending.customerPhone) && (
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                <User className="h-3 w-3 text-zinc-500" />
                <span>{pending.customerName || '-'}</span>
                {pending.customerPhone && (
                  <span className="text-zinc-500 ml-1">· {pending.customerPhone}</span>
                )}
              </div>
            )}

            {/* Items preview */}
            <div className="flex flex-wrap gap-1">
              {items.slice(0, 3).map((item, idx) => (
                <span key={idx} className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-md truncate max-w-[140px]">
                  {item.variant ? `${item.product.name} (${item.variant.name})` : item.product.name} ×{item.qty}
                </span>
              ))}
              {items.length > 3 && (
                <span className="text-[10px] bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded-md">
                  +{items.length - 3} lainnya
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => onResume(pending)}
                className="flex-1 h-8 text-[11px] font-medium rounded-lg theme-bg hover:theme-hover text-white transition-colors">
                <Play className="mr-1.5 h-3 w-3" /> Lanjutkan
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(pending.id!)}
                className="h-8 px-3 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}