'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter } from '@/components/ui/responsive-dialog'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { Separator } from '@/components/ui/separator'
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Package,
  Loader2,
  Check,
  X,
  User,
  UserPlus,
  Coins,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Wifi,
  WifiOff,
  RefreshCw,
  CloudOff,
  Database,
  ArrowDownToLine,
  LayoutGrid,
  Store,
  Tag,
  Layers,
  ClockArrowDown,
  Clock,
  MessageSquare,
  Pencil,
  AlertTriangle,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB, type PendingTransaction, type OfflineTransaction } from '@/lib/local-db'
import { syncAllData, getAllSyncTimes, syncSettingsFromServer, getCachedSettings } from '@/lib/sync-service'
import { cn } from '@/lib/utils'
import { useSession } from 'next-auth/react'
import { usePageStore } from '@/hooks/use-page-store'
import { PaymentDialog } from '@/components/pos/payment-dialog'
import { ReceiptDialog } from '@/components/pos/receipt-dialog'

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
  hpp: number
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
  customPrice: number | null // Override unit price (null = use original)
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
  manualDiscountEnabled: boolean
  receiptDoublePrintEnabled: boolean
  receiptMerchantCopyEnabled: boolean
  receiptCustomerCopyEnabled: boolean
  receiptBatchOrderEnabled: boolean
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
  zinc: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20', activeBg: 'bg-slate-500/20' },
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
  const initialSyncDone = useRef(false)
  const lastInputTimeRef = useRef<number>(0)
  const inputCharCountRef = useRef<number>(0)
  const barcodeDetectedRef = useRef(false)

  // Offline / Online state (MUST be declared before useEffects that depend on it)
  const [isOnline, setIsOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [dataSyncing, setDataSyncing] = useState(false)
  const [lastSyncTimes, setLastSyncTimes] = useState<{ products: number | null; categories: number | null; customers: number | null; promos: number | null }>({ products: null, categories: null, customers: null, promos: null })
  const [syncAgeSec, setSyncAgeSec] = useState(0) // ticks every 30s to recompute stale display

  // Relative time formatter
  const timeAgo = useCallback((ts: number | null): string | null => {
    if (!ts) return null
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 60) return 'baru'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m`
    const hrs = Math.floor(min / 60)
    if (hrs < 24) return `${hrs}j`
    const days = Math.floor(hrs / 24)
    return `${days}h`
  }, [])

  // Whether product sync is considered stale (> 10 min)
  const isSyncStale = useMemo(() => {
    if (!lastSyncTimes.products || dataSyncing) return false
    return (Date.now() - lastSyncTimes.products) > 10 * 60 * 1000
  }, [lastSyncTimes.products, dataSyncing, syncAgeSec])

  // Tick every 30s to recompute stale state
  useEffect(() => {
    const iv = setInterval(() => setSyncAgeSec(s => s + 1), 30_000)
    return () => clearInterval(iv)
  }, [])

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
    manualDiscountEnabled: false,
    receiptDoublePrintEnabled: false,
    receiptMerchantCopyEnabled: true,
    receiptCustomerCopyEnabled: true,
    receiptBatchOrderEnabled: false,
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
              manualDiscountEnabled: data.manualDiscountEnabled ?? false,
              receiptDoublePrintEnabled: data.receiptDoublePrintEnabled ?? false,
              receiptMerchantCopyEnabled: data.receiptMerchantCopyEnabled ?? true,
              receiptCustomerCopyEnabled: data.receiptCustomerCopyEnabled ?? true,
              receiptBatchOrderEnabled: data.receiptBatchOrderEnabled ?? false,
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
              manualDiscountEnabled: (cached.manualDiscountEnabled as boolean) ?? false,
              receiptDoublePrintEnabled: (cached.receiptDoublePrintEnabled as boolean) ?? false,
              receiptMerchantCopyEnabled: (cached.receiptMerchantCopyEnabled as boolean) ?? true,
              receiptCustomerCopyEnabled: (cached.receiptCustomerCopyEnabled as boolean) ?? true,
              receiptBatchOrderEnabled: (cached.receiptBatchOrderEnabled as boolean) ?? false,
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
                manualDiscountEnabled: data.manualDiscountEnabled ?? false,
                receiptDoublePrintEnabled: data.receiptDoublePrintEnabled ?? false,
                receiptMerchantCopyEnabled: data.receiptMerchantCopyEnabled ?? true,
                receiptCustomerCopyEnabled: data.receiptCustomerCopyEnabled ?? true,
                receiptBatchOrderEnabled: data.receiptBatchOrderEnabled ?? false,
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
     
    void fetchOutlets()
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

  // Batch info for cart items (FEFO preview)
  const [batchInfo, setBatchInfo] = useState<Record<string, { batchNumber: string | null; expiredDate: string | null; daysUntilExpiry: number | null }>>({})
  const batchFetchedRef = useRef<Set<string>>(new Set())

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

  // Fetch batch info for new cart items
  useEffect(() => {
    if (cart.length === 0) {
      setBatchInfo({})
      batchFetchedRef.current.clear()
      return
    }
    const toFetch: string[] = []
    for (const item of cart) {
      const key = `${item.product.id}::${item.variant?.id || 'base'}`
      if (!batchFetchedRef.current.has(key)) {
        toFetch.push(key)
        batchFetchedRef.current.add(key)
      }
    }
    if (toFetch.length === 0) return
    try {
    toFetch.forEach(key => {
      const [pid, vid] = key.split('::')
      const variantId = vid === 'base' ? undefined : vid
      const params = new URLSearchParams({ productId: pid })
      if (variantId) params.set('variantId', variantId)
      fetch(`/api/inventory/batches/pos-preview?${params}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data || !data.hasBatches || data.items.length === 0) return
          // Show the most urgent batch (smallest daysUntilExpiry, or first item)
          const sorted = [...data.items].sort((a, b) => {
            if (a.daysUntilExpiry == null && b.daysUntilExpiry == null) return 0
            if (a.daysUntilExpiry == null) return 1
            if (b.daysUntilExpiry == null) return -1
            return a.daysUntilExpiry - b.daysUntilExpiry
          })
          const mostUrgent = sorted[0]
          setBatchInfo(prev => ({
            ...prev,
            [key]: {
              batchNumber: mostUrgent.batchNumber,
              expiredDate: mostUrgent.expiredDate,
              daysUntilExpiry: mostUrgent.daysUntilExpiry,
            },
          }))
        })
        .catch(() => { /* silent */ })
    })
    } catch { /* guard against unexpected errors in batch fetch setup */ }
  }, [cart])

  // Checkout / Dialog state — NEW FLOW
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null)
  const [editingQtyValue, setEditingQtyValue] = useState('')
  const qtyInputRef = useRef<HTMLInputElement>(null)
  // Price editing state
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [editingPriceValue, setEditingPriceValue] = useState('')
  const priceInputRef = useRef<HTMLInputElement>(null)
  const [holdNote, setHoldNote] = useState('')
  const [holdNoteOpen, setHoldNoteOpen] = useState(false)

  // Pending Transactions
  const [pendingListOpen, setPendingListOpen] = useState(false)
  const [offlineListOpen, setOfflineListOpen] = useState(false)
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

  // ── Inline Price Edit Handlers ──
  const startEditPrice = (itemKey: string, currentPrice: number) => {
    setEditingPriceId(itemKey)
    setEditingPriceValue(String(currentPrice))
  }

  const confirmEditPrice = () => {
    if (!editingPriceId) return
    const val = parseInt(editingPriceValue, 10)
    updateItemPrice(editingPriceId, isNaN(val) || val < 0 ? null : val)
    setEditingPriceId(null)
  }

  const cancelEditPrice = () => {
    setEditingPriceId(null)
  }

  // Auto-focus price input when editing starts
  useEffect(() => {
    if (editingPriceId) {
      setTimeout(() => priceInputRef.current?.select(), 50)
    }
  }, [editingPriceId])

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
            if (res.ok) {
              let synced = 0
              for (const result of data.results || []) {
                if (result.success) {
                  await localDB.transactions.update(result.localId, {
                    isSynced: 1,
                    syncedAt: Date.now(),
                    invoiceNumber: result.invoiceNumber,
                    serverTransactionId: result.serverId,
                  })
                  synced++
                } else {
                  const existing = await localDB.transactions.get(result.localId)
                  await localDB.transactions.update(result.localId, {
                    retryCount: (existing?.retryCount || 0) + 1,
                    lastError: result.error,
                  })
                }
              }
              if (synced > 0) {
                toast.success(`${synced} transaction(s) auto-synced!`)
                 
                fetchProducts(productSearch, productPage, selectedCategoryId)
                 
                loadCustomersFromCache()
              }
              if (data.failed > 0) {
                toast.warning(`${data.failed} transaksi gagal sync`, { description: 'Buka menu "Offline" untuk detail.' })
              }
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
          setSyncAgeSec(0)
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
          setSyncAgeSec(0)
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

  // Helper: get effective unit price for a cart item (customPrice if set, else original)
  const getEffectivePrice = (item: CartItem) => item.customPrice != null ? item.customPrice : getItemPrice(item)
  // Helper: get HPP for a cart item (variant hpp if variant, else product hpp)
  const getItemHpp = (item: CartItem) => item.variant ? item.variant.hpp : item.product.hpp

  // Check if any item has custom price below HPP (cost price)
  const belowHppItems = useMemo(() => {
    const result: Array<{ name: string; customPrice: number; hpp: number; loss: number }> = []
    for (const item of cart) {
      if (item.customPrice != null && item.customPrice < getItemHpp(item)) {
        result.push({
          name: getItemDisplayName(item),
          customPrice: item.customPrice,
          hpp: getItemHpp(item),
          loss: Math.round((getItemHpp(item) - item.customPrice) * item.qty),
        })
      }
    }
    return result
  }, [cart])

  const hasBelowHpp = belowHppItems.length > 0
  const belowHppTotalLoss = belowHppItems.reduce((s, i) => s + i.loss, 0)

  // Show warning toast when price drops below HPP
  const prevBelowHppRef = useRef<boolean>(false)
  useEffect(() => {
    if (hasBelowHpp && !prevBelowHppRef.current) {
      toast.warning(
        `⚠️ Harga di bawah HPP untuk ${belowHppItems.length} item! Rugi: -${formatCurrency(belowHppTotalLoss)}`,
        { duration: 4000, id: 'below-hpp-warning' }
      )
    }
    prevBelowHppRef.current = hasBelowHpp
  }, [hasBelowHpp, belowHppItems.length, belowHppTotalLoss])

  const manualDiscountTotal = useMemo(() => cart.reduce((sum, item) => {
    const origPrice = getItemPrice(item)
    const effPrice = getEffectivePrice(item)
    return sum + Math.round((origPrice - effPrice) * item.qty)
  }, 0), [cart])

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + getItemPrice(item) * item.qty, 0), [cart])
  const maxPointsToUse = selectedCustomer ? selectedCustomer.points : 0
  const pointsDiscount = pointsToUse * settings.loyaltyPointValue
  const ppnAmount = settings.ppnEnabled ? Math.round(subtotal * settings.ppnRate / 100) : 0
  const total = Math.max(0, subtotal - manualDiscountTotal - pointsDiscount - promoDiscount + ppnAmount)
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
        return [...prev, { product, variant, qty, customPrice: null }]
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
        return [...prev, { product, variant: null, qty, customPrice: null }]
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

  const updateItemPrice = (productId: string, newPrice: number | null, variantId?: string) => {
    const key = getCartKey(productId, variantId || null)
    const item = cart.find((i) => getCartKey(i.product.id, i.variant?.id || null) === key)
    if (!item) return
    const originalPrice = getItemPrice(item)
    // If same as original, clear custom price
    const finalPrice = newPrice === null || newPrice >= originalPrice ? null : newPrice
    setCart((prev) => prev.map((i) => (getCartKey(i.product.id, i.variant?.id || null) === key ? { ...i, customPrice: finalPrice } : i)))
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
    // Show note dialog first
    setHoldNoteOpen(true)
  }

  const confirmHoldTransaction = async () => {
    setHoldNoteOpen(false)
    try {
      const userName = session?.user?.name || 'Unknown'
      const userId = (session?.user as any)?.id || ''
      await localDB.pendingTransactions.add({
        items: cart.map(item => ({
          product: item.product,
          variant: item.variant,
          qty: item.qty,
          customPrice: item.customPrice,
        })),
        customerId: selectedCustomer?.id || null,
        customerName: selectedCustomer?.name || null,
        note: holdNote.trim(),
        subtotal,
        createdAt: Date.now(),
        userId,
        userName,
      })
      setHoldNote('')
      clearCart()
      setMobileCartOpen(false)
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
            customPrice: item.customPrice,
          })),
          customerId: selectedCustomer?.id || null,
          customerName: selectedCustomer?.name || null,
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
      const items = pending.items as Array<{ product: Product; variant: ProductVariant | null; qty: number; customPrice?: number | null }>
      setCart(items.map(item => ({ ...item, customPrice: item.customPrice ?? null })))
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
          itemDiscount: item.customPrice != null ? Math.round((getItemPrice(item) - item.customPrice) * item.qty) : 0,
        })),
        subtotal,
        discount: manualDiscountTotal + pointsDiscount + promoDiscount,
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

      // NEW FLOW: close payment dialog, open receipt dialog
      setPaymentDialogOpen(false)
      setReceiptDialogOpen(true)
      fetchProducts(productSearch, productPage, selectedCategoryId)
      loadCustomersFromCache()
    } catch {
      toast.error('Checkout gagal')
    } finally {
      setCheckingOut(false)
    }
  }

  // Open payment dialog — replaces old openCheckoutDialog
  const openPaymentDialog = () => {
    if (cart.length === 0) return
    if (hasBelowHpp) {
      toast.error('Harga diskon di bawah HPP. Sesuaikan harga atau konfirmasi owner.', { duration: 3000, id: 'below-hpp-block' })
      return
    }
    setCheckoutResult(null)
    setPaidAmount('')
    setPaymentDialogOpen(true)
    setMobileCartOpen(false)
  }

  // Receipt finish — called when receipt dialog is dismissed
  const handleReceiptFinish = () => {
    setReceiptDialogOpen(false)
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
            : 'aether-card text-slate-500 hover:text-slate-300'
        }`}
      >
        <LayoutGrid className="inline h-3 w-3 mr-1 -mt-0.5" strokeWidth={1.5} />
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
                : 'aether-card text-slate-500 hover:text-slate-300'
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
        <div key={i} className="h-[88px] md:h-[72px] rounded-xl aether-shimmer" />
      ))
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

    return products.map((product) => {
      const cartItemsForProduct = cart.filter((i) => i.product.id === product.id)
      const hasCartItems = cartItemsForProduct.length > 0
      const isVariantProduct = product.hasVariants && product._variantCount > 0

      const cartItem = !isVariantProduct ? cart.find((i) => i.product.id === product.id && !i.variant) : null
      const outOfStock = isVariantProduct
        ? product.variants.length > 0 && product.variants.every(v => v.stock <= 0)
        : product.stock <= 0
      const catColor = product.categoryId && categories.find(c => c.id === product.categoryId)?.color
      const accentColor = catColor ? (CATEGORY_COLORS[catColor] || themeColors) : themeColors
      const lowStock = product.stock > 0 && product.stock <= 5

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
              ? 'opacity-40 cursor-not-allowed aether-card p-2.5 md:p-3'
              : hasCartItems
              ? `${accentColor.border} ${accentColor.bg} ring-1 ring-inset ${accentColor.border.replace('border-', 'ring-')} cursor-pointer active:scale-[0.98]`
              : 'aether-card cursor-pointer active:scale-[0.98]'
          )}
        >
          {!outOfStock && (
            <button
              className="absolute inset-0 z-[2] rounded-2xl md:rounded-xl"
              onClick={() => isVariantProduct ? openVariantPicker(product) : addToCart(product)}
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
    })
  }

  const renderPagination = () => {
    if (totalProductPages <= 1 && !productSearch) return null
    return (
      <div className="flex items-center justify-between px-1 py-2">
        <Button variant="outline" size="sm" onClick={() => setProductPage(p => Math.max(1, p - 1))} disabled={productPage <= 1 || productsLoading}
          className="bg-nebula border-white/[0.06] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 h-7 text-xs">
          <ChevronLeft className="h-3 w-3 mr-1" strokeWidth={1.5} /> Prev
        </Button>
        <span className="text-[11px] text-slate-500 font-medium">{productPage}/{totalProductPages}</span>
        <Button variant="outline" size="sm" onClick={() => setProductPage(p => Math.min(totalProductPages, p + 1))} disabled={productPage >= totalProductPages || productsLoading}
          className="bg-nebula border-white/[0.06] text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 h-7 text-xs">
          Next <ChevronRight className="h-3 w-3 ml-1" strokeWidth={1.5} />
        </Button>
      </div>
    )
  }

  // Customer selector for mobile cart sheet
  const renderCustomerSelector = (isMobile = false) => (
    <div className={isMobile ? 'aether-card rounded-2xl p-3.5 space-y-2' : 'border-b border-white/[0.06] px-4 py-3'}>
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-slate-500 font-medium tracking-wide uppercase">Customer</Label>
        <button onClick={() => setAddCustomerOpen(true)} className="text-[10px] theme-text hover:theme-text font-semibold flex items-center gap-1 transition-colors">
          <UserPlus className="h-3 w-3" strokeWidth={1.5} /> Tambah Baru
        </button>
      </div>
      <div className="relative">
        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" strokeWidth={1.5} />
        <Input
          placeholder={selectedCustomer ? selectedCustomer.name : 'Cari customer (walk-in jika kosong)'}
          value={customerSearch}
          onChange={(e) => { setCustomerSearch(e.target.value); setCustomerDropdownOpen(true) }}
          onFocus={() => setCustomerDropdownOpen(true)}
          className="pl-10 pr-8 h-10 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl backdrop-blur-sm"
        />
        {selectedCustomer && (
          <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setPointsToUse(0) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors">
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}
      </div>
      {customerDropdownOpen && filteredCustomers.length > 0 && !selectedCustomer && (
        <div className={`absolute z-30 ${isMobile ? 'w-[calc(100%-1.75rem)]' : 'w-full'} mt-1 aether-card-elevated rounded-2xl max-h-44 overflow-y-auto`}>
          {filteredCustomers.map((customer) => (
            <button key={customer.id} onClick={() => { setSelectedCustomer(customer); setCustomerSearch(''); setCustomerDropdownOpen(false); setPointsToUse(0) }}
              className="w-full text-left px-4 py-2.5 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0 transition-colors first:rounded-t-2xl last:rounded-b-2xl">
              <p className="text-xs text-slate-200 font-medium">{customer.name}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{customer.whatsapp} · <span className="text-amber-400">{customer.points} pts</span></p>
            </button>
          ))}
        </div>
      )}
      {selectedCustomer && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl theme-bg-very-light border theme-border-light">
            <User className="h-3 w-3 theme-text" strokeWidth={1.5} />
            <span className="text-[11px] theme-text font-medium">{selectedCustomer.name}</span>
          </div>
          {selectedCustomer.points > 0 && (
            <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px] rounded-lg">
              <Coins className="mr-1 h-2.5 w-2.5" strokeWidth={1.5} />
              {selectedCustomer.points} poin
            </Badge>
          )}
        </div>
      )}
    </div>
  )

  // Cart items — mobile card-style layout (dedicated, not shared)
  const renderCartItemsMobile = () => {
    if (cart.length === 0) return null
    return (
      <div className="space-y-3 pb-4">
        {cart.map((item) => {
          const itemKey = getCartKey(item.product.id, item.variant?.id || null)
          const itemTotal = getEffectivePrice(item) * item.qty
          return (
            <div key={itemKey} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              {/* Top: Image + Name + Delete */}
              <div className="flex items-center gap-3 mb-3">
                {/* Image */}
                {item.product.image ? (
                  <div className="w-12 h-12 rounded-xl bg-white/[0.03] shrink-0 overflow-hidden relative">
                    <img
                      src={item.product.image}
                      alt={item.product.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        const fb = e.currentTarget.parentElement?.querySelector('.img-fb')
                        if (fb) fb.setAttribute('style', 'display:flex')
                      }}
                    />
                    <div className="img-fb absolute inset-0 items-center justify-center bg-white/[0.03] hidden">
                      <Package className="h-5 w-5 text-slate-600" strokeWidth={1.5} />
                    </div>
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center shrink-0">
                    <Package className="h-5 w-5 text-slate-600" strokeWidth={1.5} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-white truncate">{item.product.name}</p>
                  {item.variant && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/15 mt-1">
                      <span className="text-[10px] font-medium text-violet-400">{item.variant.name}</span>
                    </span>
                  )}
                  {(() => {
                    const bKey = `${item.product.id}::${item.variant?.id || 'base'}`
                    const bInfo = batchInfo[bKey]
                    if (!bInfo || !bInfo.batchNumber) return null
                    const d = bInfo.daysUntilExpiry
                    if (d == null) return null
                    if (d <= 7) return <span className="text-[10px] text-rose-400 leading-tight">🔴 Exp {d} hari</span>
                    if (d <= 30) return <span className="text-[10px] text-amber-400 leading-tight">🟠 Exp {d} hari</span>
                    return <span className="text-[10px] text-emerald-400 leading-tight">🟢 Batch: {bInfo.batchNumber}</span>
                  })()}
                </div>
                <button
                  onClick={() => removeFromCart(item.product.id, item.variant?.id)}
                  className="h-9 w-9 flex items-center justify-center rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all active:scale-95"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>

              {/* Bottom: Price + Qty + Total */}
              <div className="flex items-center justify-between gap-3">
                {/* Price info */}
                <div className="min-w-0">
                  {editingPriceId === itemKey ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500">Rp</span>
                      <input
                        ref={priceInputRef}
                        type="number"
                        min="0"
                        value={editingPriceValue}
                        onChange={(e) => setEditingPriceValue(e.target.value)}
                        onBlur={confirmEditPrice}
                        onKeyDown={(e) => { if (e.key === 'Enter') confirmEditPrice(); if (e.key === 'Escape') cancelEditPrice() }}
                        className="flex-1 h-8 text-sm font-bold bg-white/[0.04] border border-amber-500/25 text-amber-400 rounded-lg outline-none text-right min-w-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  ) : settings.manualDiscountEnabled ? (
                    <button onClick={() => startEditPrice(itemKey, getEffectivePrice(item))} className="text-left">
                      {item.customPrice != null && (
                        <span className="block text-[11px] text-slate-500 line-through">{formatCurrency(getItemPrice(item))}</span>
                      )}
                      <div className="flex items-center gap-1">
                        <span className={cn('text-[13px] font-medium', item.customPrice != null ? 'text-amber-400' : 'text-slate-300')}>@{formatCurrency(getEffectivePrice(item))}</span>
                        <Pencil className="h-3 w-3 text-slate-500" strokeWidth={1.5} />
                      </div>
                    </button>
                  ) : (
                    <span className="text-[13px] text-slate-400">@{formatCurrency(getItemPrice(item))}</span>
                  )}
                  <span className="text-[11px] text-slate-500 mt-0.5 block">× {item.qty} item</span>
                </div>

                {/* Qty stepper — LARGE touch targets */}
                <div className="flex items-center gap-1">
                  <button
                    className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all"
                    onClick={() => updateQty(item.product.id, item.qty - 1, item.variant?.id)}
                  >
                    <Minus className="h-4 w-4" strokeWidth={1.5} />
                  </button>
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
                      className="w-12 h-10 text-[15px] font-bold text-white text-center bg-white/[0.04] border border-white/[0.08] rounded-xl outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  ) : (
                    <span
                      className="w-12 text-center text-[15px] font-bold text-white cursor-pointer hover:theme-text transition-colors"
                      onClick={() => startEditQty(itemKey, item.qty)}
                    >{item.qty}</span>
                  )}
                  <button
                    className="h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all"
                    onClick={() => updateQty(item.product.id, item.qty + 1, item.variant?.id)}
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>

                {/* Total */}
                <p className="text-[15px] font-bold theme-text shrink-0 tabular-nums">{formatCurrency(itemTotal)}</p>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Cart items list — shared between desktop and mobile
  const renderCartItems = (compact = false) => {
    if (cart.length === 0) return null
    return (
      <div className={compact ? 'space-y-2 pb-2' : 'space-y-1.5'}>
        {cart.map((item) => {
          const itemKey = getCartKey(item.product.id, item.variant?.id || null)
          const itemTotal = getEffectivePrice(item) * item.qty
          return (
            <div key={itemKey} className={cn(
              'group flex items-center gap-2.5 rounded-xl aether-card transition-all duration-150',
              compact ? 'p-3' : 'p-2.5'
            )}>
              {/* Product Image */}
              {item.product.image ? (
                <div className={cn(
                  'shrink-0 relative rounded-lg overflow-hidden bg-white/[0.03]',
                  compact ? 'w-11 h-11' : 'w-9 h-9'
                )}>
                  <img
                    src={item.product.image}
                    alt={item.product.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                      const fb = e.currentTarget.parentElement?.querySelector('.img-fallback')
                      if (fb) fb.setAttribute('style', 'display:flex')
                    }}
                  />
                  <div className="img-fallback absolute inset-0 items-center justify-center bg-white/[0.03] hidden">
                    <Package className="h-3.5 w-3.5 text-slate-700" strokeWidth={1.5} />
                  </div>
                </div>
              ) : (
                <div className={cn(
                  'shrink-0 rounded-lg bg-white/[0.03] flex items-center justify-center',
                  compact ? 'w-11 h-11' : 'w-9 h-9'
                )}>
                  <Package className="h-3.5 w-3.5 text-slate-700" strokeWidth={1.5} />
                </div>
              )}
              {/* Product Info */}
              <div className="flex-1 min-w-0">
                <p className={cn('font-semibold text-white truncate leading-tight', compact ? 'text-[13px]' : 'text-xs')}>{item.product.name}</p>
                {item.variant && (
                  <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/15">
                    <span className="text-[9px] font-medium text-violet-400 leading-tight">{item.variant.name}</span>
                  </span>
                )}
                {(() => {
                  const bKey = `${item.product.id}::${item.variant?.id || 'base'}`
                  const bInfo = batchInfo[bKey]
                  if (!bInfo || !bInfo.batchNumber) return null
                  const d = bInfo.daysUntilExpiry
                  if (d == null) return null
                  if (d <= 7) return <span className="text-[10px] text-rose-400 leading-tight">🔴 Exp {d} hari</span>
                  if (d <= 30) return <span className="text-[10px] text-amber-400 leading-tight">🟠 Exp {d} hari</span>
                  return <span className="text-[10px] text-emerald-400 leading-tight">🟢 Batch: {bInfo.batchNumber}</span>
                })()}
                {/* Price — editable when manual discount enabled */}
                {settings.manualDiscountEnabled ? (
                  editingPriceId === itemKey ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-slate-500">Rp</span>
                      <input
                        ref={priceInputRef}
                        type="number"
                        min="0"
                        value={editingPriceValue}
                        onChange={(e) => setEditingPriceValue(e.target.value)}
                        onBlur={confirmEditPrice}
                        onKeyDown={(e) => { if (e.key === 'Enter') confirmEditPrice(); if (e.key === 'Escape') cancelEditPrice() }}
                        className={cn(
                          'flex-1 h-6 text-xs font-bold bg-white/[0.04] border border-amber-500/25 text-amber-400 rounded-md outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                          compact ? 'min-w-0' : 'min-w-0'
                        )}
                      />
                      <span className={cn('text-slate-600', compact ? 'text-[11px]' : 'text-[10px]')}>× {item.qty}</span>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1.5 mt-1 group/price"
                      onClick={() => startEditPrice(itemKey, getEffectivePrice(item))}
                    >
                      {item.customPrice != null && (
                        <span className={cn('line-through text-slate-600', compact ? 'text-[10px]' : 'text-[9px]')}>
                          {formatCurrency(getItemPrice(item))}
                        </span>
                      )}
                      <span className={cn(
                        'font-medium tabular-nums',
                        compact ? 'text-[11px]' : 'text-[10px]',
                        item.customPrice != null ? 'text-amber-400' : 'text-slate-500'
                      )}>
                        {formatCurrency(getEffectivePrice(item))} × {item.qty}
                      </span>
                      <Pencil className="h-2.5 w-2.5 text-slate-600 opacity-60 hover:opacity-100 transition-opacity" strokeWidth={2} />
                    </button>
                  )
                ) : (
                  <p className={cn('text-slate-500 mt-1', compact ? 'text-[11px]' : 'text-[10px]')}>
                    {formatCurrency(getItemPrice(item))} × {item.qty}
                  </p>
                )}
              </div>

              {/* Item Total */}
              <p className={cn('font-bold theme-text shrink-0 tabular-nums', compact ? 'text-sm' : 'text-xs mr-1')}>{formatCurrency(itemTotal)}</p>

              {/* Qty Controls */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button className={cn(
                  'flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] transition-all active:scale-90',
                  compact ? 'h-9 w-9' : 'h-8 w-8'
                )} onClick={() => updateQty(item.product.id, item.qty - 1, item.variant?.id)}>
                  <Minus className={compact ? 'h-4 w-4' : 'h-3.5 w-3.5'} strokeWidth={1.5} />
                </button>
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
                    className={cn(
                      'text-white text-center font-bold bg-white/[0.04] border border-white/[0.08] rounded-lg outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                      compact ? 'text-sm w-14 h-9' : 'text-xs w-10 h-8'
                    )}
                  />
                ) : (
                  <span
                    className={cn('text-white text-center font-bold cursor-pointer hover:theme-text transition-colors', compact ? 'text-sm w-8' : 'text-xs w-8')}
                    onClick={() => startEditQty(itemKey, item.qty)}
                    title="Klik untuk edit qty"
                  >{item.qty}</span>
                )}
                <button className={cn(
                  'flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] transition-all active:scale-90',
                  compact ? 'h-9 w-9' : 'h-8 w-8'
                )} onClick={() => updateQty(item.product.id, item.qty + 1, item.variant?.id)}>
                  <Plus className={compact ? 'h-4 w-4' : 'h-3.5 w-3.5'} strokeWidth={1.5} />
                </button>
              </div>

              {/* Delete */}
              <button className={cn(
                'flex items-center justify-center rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0',
                compact ? 'h-6 w-6' : 'h-7 w-7'
              )} onClick={() => removeFromCart(item.product.id, item.variant?.id)}>
                <Trash2 className="h-3 w-3" strokeWidth={1.5} />
              </button>
            </div>
          )
        })}
      </div>
    )
  }

  // Cart summary — shared totals display
  const renderCartSummary = () => (
    <div className="space-y-1.5 text-xs">
      {/* Below-HPP warning banner */}
      {hasBelowHpp && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-red-400 leading-tight">
              Harga di bawah HPP!
            </p>
            <div className="mt-1 space-y-0.5">
              {belowHppItems.map((item) => (
                <div key={item.name} className="flex items-center justify-between text-[10px]">
                  <span className="text-red-300 truncate">{item.name}</span>
                  <span className="text-red-400 font-medium tabular-nums shrink-0 ml-2">
                    {formatCurrency(item.customPrice)} &lt; HPP {formatCurrency(item.hpp)}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-red-300/80 mt-1 font-medium">
              Total kerugian: -{formatCurrency(belowHppTotalLoss)}
            </p>
            <p className="text-[10px] text-red-400/60 mt-0.5">
              Pembayaran dinonaktifkan. Sesuaikan harga atau konfirmasi owner.
            </p>
          </div>
        </div>
      )}
      <div className="flex justify-between text-slate-400"><span>Subtotal</span><span className="text-slate-200 tabular-nums">{formatCurrency(subtotal)}</span></div>
      {settings.loyaltyEnabled && selectedCustomer && maxPointsToUse > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-slate-400 flex items-center gap-1.5"><Coins className="h-3 w-3" strokeWidth={1.5} /> Pakai Poin</span>
          <Input type="number" min="0" max={maxPointsToUse} value={pointsToUse || ''} onChange={(e) => handlePointsChange(e.target.value)}
            placeholder="0" className="w-20 h-7 text-right text-[11px] bg-white/[0.04] border-white/[0.08] text-white rounded-lg" />
        </div>
      )}
      {pointsDiscount > 0 && (
        <div className="flex justify-between theme-text"><span className="flex items-center gap-1.5"><Coins className="h-3 w-3" strokeWidth={1.5} /> Diskon Poin</span><span className="tabular-nums">-{formatCurrency(pointsDiscount)}</span></div>
      )}
      {promoDiscount > 0 && selectedPromo && (
        <div className="flex justify-between text-amber-400">
          <span className="flex items-center gap-1.5"><Tag className="h-3 w-3" strokeWidth={1.5} /> {selectedPromo.name}</span>
          <span className="tabular-nums">-{formatCurrency(promoDiscount)}</span>
        </div>
      )}
      {manualDiscountTotal > 0 && (
        <div className="flex justify-between text-amber-400">
          <span className="flex items-center gap-1.5"><Tag className="h-3 w-3" strokeWidth={1.5} /> Diskon Manual</span>
          <span className="tabular-nums">-{formatCurrency(manualDiscountTotal)}</span>
        </div>
      )}
      {ppnAmount > 0 && (
        <div className="flex justify-between text-sky-300"><span>PPN ({settings.ppnRate}%)</span><span className="tabular-nums">+{formatCurrency(ppnAmount)}</span></div>
      )}
      <Separator className="bg-white/[0.04]" />
      <div className="flex justify-between items-baseline">
        <span className="text-sm font-black text-white">Total</span>
        <span className="text-lg font-black text-white tabular-nums">{formatCurrency(total)}</span>
      </div>
    </div>
  )

  // ==================== MAIN RENDER ====================

  return (
    <div className="space-y-3 md:flex md:flex-col md:h-full md:gap-3 md:space-y-0 md:overflow-hidden">
      {/* Header — Mobile Compact */}
      <div className="md:hidden flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {outletInfo ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl aether-card text-[11px] font-semibold text-slate-300 min-w-0">
              <Store className="h-3.5 w-3.5 theme-text shrink-0" strokeWidth={1.5} />
              <span className="truncate">{outletInfo.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl aether-card text-[11px] font-medium text-slate-600">
              <Store className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>No outlet</span>
            </div>
          )}
          <div className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-[10px] font-medium border shrink-0 ${
            isOnline ? 'theme-bg-very-light theme-border-light theme-text' : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {isOnline ? <Wifi className="h-3 w-3" strokeWidth={1.5} /> : <WifiOff className="h-3 w-3" strokeWidth={1.5} />}
          </div>
          {unsyncedCount > 0 && (
            <button onClick={() => setOfflineListOpen(true)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-medium shrink-0 hover:bg-amber-500/15 active:scale-95 transition-all">
              <CloudOff className="h-3 w-3" strokeWidth={1.5} />
              {unsyncedCount}
            </button>
          )}
          {/* Sync timestamp badge — mobile */}
          {lastSyncTimes.products && !dataSyncing && (
            <div className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-[10px] font-medium border shrink-0 transition-colors ${
              isSyncStale
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse-slow'
                : 'aether-card text-slate-500'
            }`}>
              <Database className="h-2.5 w-2.5" strokeWidth={1.5} />
              {timeAgo(lastSyncTimes.products)}
            </div>
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
            setSyncAgeSec(0)
            toast.success(`Data direfresh: ${result.products.count} produk, ${result.customers.count} customer`)
          } catch { toast.error('Gagal refresh data') }
          finally { setDataSyncing(false) }
        }} disabled={dataSyncing || !isOnline}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-medium shrink-0 transition-all disabled:opacity-50',
            isSyncStale && !dataSyncing
              ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300 active:scale-95 shadow-[0_0_6px_rgba(245,158,11,0.15)]'
              : 'aether-card text-slate-500'
          )}>
          {dataSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" strokeWidth={1.5} />}
        </button>
      </div>

      {/* Header — Desktop Full */}
      <div className="hidden md:flex md:items-center md:justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Point of Sale</h1>
            <p className="text-[11px] text-slate-500">Proses transaksi & terima pembayaran</p>
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
              <SelectTrigger className="w-auto min-w-[180px] max-w-[220px] h-8 bg-nebula border-white/[0.08] text-slate-200 text-xs rounded-lg gap-1.5 pr-2">
                <Store className="h-3.5 w-3.5 text-slate-500 shrink-0" strokeWidth={1.5} />
                <SelectValue placeholder={outletsLoading ? 'Loading...' : 'Select outlet'} />
              </SelectTrigger>
              <SelectContent className="bg-nebula border-white/[0.08]">
                {userOutlets.map((outlet) => (
                  <SelectItem key={outlet.id} value={outlet.id} className="text-xs text-slate-200 focus:bg-white/[0.04] focus:text-white">
                    <div className="flex items-center gap-2">
                      <Store className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.5} />
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
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-medium text-slate-400">
              <Store className="h-3 w-3" strokeWidth={1.5} />
              <span>{outletInfo.name}</span>
            </div>
          ) : !outletsLoading ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/[0.06] text-[11px] font-medium text-slate-600">
              <Store className="h-3 w-3" strokeWidth={1.5} />
              <span>No outlet</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Connection */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
            isOnline ? 'theme-bg-very-light theme-border-light theme-text' : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            {isOnline ? <><Wifi className="h-3 w-3" strokeWidth={1.5} /><span>Online</span></> : <><WifiOff className="h-3 w-3" strokeWidth={1.5} /><span>Offline</span></>}
          </div>

          {/* Data sync badge — shows timestamp, pulses when stale */}
          {lastSyncTimes.products ? (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              dataSyncing
                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                : isSyncStale
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse-slow'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-500'
            }`}>
              {dataSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" strokeWidth={1.5} />}
              <span>{dataSyncing ? 'Syncing...' : timeAgo(lastSyncTimes.products)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium">
              <Database className="h-3 w-3" strokeWidth={1.5} /><span>No cache</span>
            </div>
          )}

          {/* Unsynced */}
          {unsyncedCount > 0 && (
            <button onClick={() => setOfflineListOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-medium hover:bg-amber-500/15 transition-all cursor-pointer">
              <CloudOff className="h-3 w-3" strokeWidth={1.5} /><span>{unsyncedCount} pending</span>
            </button>
          )}

          {/* Sync / Refresh button — glows when stale */}
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
              setSyncAgeSec(0) // reset stale tick
              toast.success(`Data direfresh: ${result.products.count} produk, ${result.customers.count} customer`)
            } catch { toast.error('Gagal refresh data') }
            finally { setDataSyncing(false) }
          }} disabled={dataSyncing || !isOnline} variant="outline" size="sm"
            className={cn(
              'h-7 text-xs gap-1.5 transition-all',
              isSyncStale && !dataSyncing
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200 shadow-[0_0_8px_rgba(245,158,11,0.15)]'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200',
              'disabled:opacity-50'
            )}>
            {dataSyncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" strokeWidth={1.5} />}
            Sync
          </Button>

          {unsyncedCount > 0 && (
            <Button onClick={() => setOfflineListOpen(true)} variant="outline" size="sm"
              className="bg-amber-600/20 border-amber-500/30 text-amber-400 hover:bg-amber-600/30 h-7 text-xs gap-1.5">
              <CloudOff className="h-3 w-3" strokeWidth={1.5} />
              {unsyncedCount} Offline
            </Button>
          )}
        </div>
      </div>

      {/* Desktop Layout */}
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
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="pl-10 h-10 text-sm bg-nebula/80 border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl"
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
                  {cart.length > 0 && <p className="text-[10px] text-slate-500 leading-tight">{cart.length} produk · {cart.reduce((s, i) => s + i.qty, 0)} item</p>}
                </div>
              </div>
              {cart.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPendingListOpen(true)} className={cn(
                    "relative flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-semibold transition-all",
                    pendingCount > 0
                      ? "text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15"
                      : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20"
                  )}>
                    <ClockArrowDown className="h-3 w-3" strokeWidth={1.5} />
                    {pendingCount > 0 && <span>{pendingCount}</span>}
                  </button>
                  <button onClick={clearCart} className="h-7 px-2.5 rounded-lg text-[10px] font-semibold text-slate-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all">
                    Hapus Semua
                  </button>
                </div>
              )}
              {cart.length === 0 && pendingCount > 0 && (
                <button onClick={() => setPendingListOpen(true)} className="relative flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-all">
                  <ClockArrowDown className="h-3 w-3" strokeWidth={1.5} />
                  <span>{pendingCount} pending</span>
                </button>
              )}
            </div>
          </div>

          {/* Customer Selector — embedded at top of scrollable area */}
          <div className="shrink-0 px-4 pt-3 pb-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Customer</span>
              <button onClick={() => setAddCustomerOpen(true)} className="text-[10px] theme-text hover:theme-text font-semibold flex items-center gap-0.5 transition-colors">
                <UserPlus className="h-2.5 w-2.5" strokeWidth={1.5} /> Baru
              </button>
            </div>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" strokeWidth={1.5} />
              <Input
                placeholder={selectedCustomer ? selectedCustomer.name : 'Tambah customer (opsional)'}
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setCustomerDropdownOpen(true) }}
                onFocus={() => setCustomerDropdownOpen(true)}
                className="pl-9 pr-8 h-9 text-xs bg-nebula border-white/[0.06] text-white placeholder:text-slate-600 rounded-xl"
              />
              {selectedCustomer && (
                <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); setPointsToUse(0) }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-white/[0.04] text-slate-400 hover:text-slate-200 transition-colors">
                  <X className="h-2.5 w-2.5" strokeWidth={1.5} />
                </button>
              )}
            </div>
            {customerDropdownOpen && filteredCustomers.length > 0 && !selectedCustomer && (
              <div className="absolute z-30 w-full mt-1 bg-nebula border border-white/[0.08] rounded-xl shadow-2xl shadow-black/50 max-h-40 overflow-y-auto">
                {filteredCustomers.map((customer) => (
                  <button key={customer.id} onClick={() => { setSelectedCustomer(customer); setCustomerSearch(''); setCustomerDropdownOpen(false); setPointsToUse(0) }}
                    className="w-full text-left px-3.5 py-2 hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0 transition-colors">
                    <p className="text-xs text-slate-200 font-medium">{customer.name}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{customer.whatsapp} · <span className="text-amber-400">{customer.points} pts</span></p>
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
              renderCartItems(false)
            )}
          </div>

          {/* Summary & Action Buttons — fixed bottom (NO inline payment) */}
          {cart.length > 0 && (
            <div className="shrink-0 border-t border-white/[0.06] bg-gradient-to-t from-deep-space to-nebula/80 p-4 space-y-3">
              {renderCartSummary()}
              <div className="flex gap-2">
                <Button onClick={handleHoldTransaction} variant="outline"
                  className="h-11 px-4 font-semibold text-sm rounded-xl border-white/[0.08] text-slate-300 hover:bg-white/[0.04] hover:text-white transition-all shrink-0">
                  <ClockArrowDown className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                  Tunda
                </Button>
                <Button onClick={openPaymentDialog} disabled={cart.length === 0 || hasBelowHpp}
                  className={`flex-1 h-11 font-bold text-sm rounded-xl transition-all ${
                    cart.length > 0 && !hasBelowHpp
                      ? 'theme-gradient hover:theme-hover text-white shadow-lg theme-shadow hover:theme-shadow active:scale-[0.99]'
                      : 'bg-white/[0.04] text-slate-500 cursor-not-allowed'
                  }`}>
                  <Check className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                  {hasBelowHpp ? 'Harga di bawah HPP' : 'Proses Bayar'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Layout — Product view + floating cart */}
      <div className="md:hidden shrink-0">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" strokeWidth={1.5} />
          <Input
            ref={searchInputRef}
            placeholder="Cari produk..."
            value={productSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="pl-10 h-11 text-sm bg-nebula/80 border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl"
          />
        </div>
        {renderCategoryChips()}
        <div className="grid grid-cols-2 gap-2.5 pt-2 pb-2">{renderProductGrid()}</div>
        <div className="pb-8">{renderPagination()}</div>
      </div>

      {/* Tablet Layout — Product grid + Sticky Cart Bar (md to < lg) */}
      <div className="hidden md:flex lg:hidden flex-col flex-1 min-h-0 overflow-hidden">
        {/* Search */}
        <div className="relative mb-3 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" strokeWidth={1.5} />
          <Input
            placeholder="Scan barcode atau cari produk..."
            value={productSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="pl-10 h-10 text-sm bg-nebula/80 border-white/[0.06] text-white placeholder:text-slate-500 rounded-xl"
          />
        </div>

        {/* Category Chips */}
        <div className="shrink-0">{renderCategoryChips()}</div>

        {/* Product Grid — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pt-2 pb-24">
          <div className="grid grid-cols-3 xl:grid-cols-4 gap-2.5 pb-2">
            {renderProductGrid()}
          </div>
          {renderPagination()}
        </div>

        {/* Sticky Cart Bar at bottom (tablet) */}
        {cart.length > 0 ? (
          <div className="fixed bottom-16 left-0 right-0 z-30 px-4 pb-safe">
            <div className="max-w-2xl mx-auto rounded-2xl border border-white/[0.08] bg-deep-space/95 backdrop-blur-xl shadow-2xl shadow-black/40 p-3">
              <button onClick={() => setMobileCartOpen(true)} className="w-full flex items-center gap-3">
                <div className="relative">
                  <ShoppingCart className="h-5 w-5 theme-text" strokeWidth={1.5} />
                  <span className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-theme-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {cart.reduce((s, i) => s + i.qty, 0)}
                  </span>
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[13px] font-semibold text-white">{cart.length} produk dalam keranjang</p>
                  <p className="text-[11px] text-slate-400">{formatCurrency(subtotal)}{promoDiscount > 0 ? ` · -${formatCurrency(promoDiscount)}` : ''}{manualDiscountTotal > 0 ? ` · -${formatCurrency(manualDiscountTotal)}` : ''}</p>
                </div>
                <div className="text-right mr-1">
                  <p className="text-lg font-black text-white tabular-nums">{formatCurrency(total)}</p>
                </div>
                <ChevronUp className="h-5 w-5 text-slate-400 shrink-0" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        ) : pendingCount > 0 ? (
          <div className="fixed bottom-16 left-0 right-0 z-30 px-4 pb-safe">
            <div className="max-w-2xl mx-auto rounded-2xl border border-amber-500/20 bg-deep-space/95 backdrop-blur-xl shadow-2xl shadow-black/40 p-3">
              <button onClick={() => setPendingListOpen(true)} className="w-full flex items-center gap-3">
                <div className="relative">
                  <ClockArrowDown className="h-5 w-5 text-amber-400" strokeWidth={1.5} />
                  <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">{pendingCount}</span>
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[13px] font-semibold text-white">{pendingCount} transaksi pending</p>
                  <p className="text-[11px] text-slate-400">Tap untuk melihat</p>
                </div>
                <ChevronUp className="h-5 w-5 text-slate-400 shrink-0" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Floating Pending Button — Mobile only */}
      {pendingCount > 0 && cart.length === 0 && (
        <button
          onClick={() => setPendingListOpen(true)}
          className="md:hidden fixed bottom-20 right-4 z-50 flex items-center gap-2.5 h-12 pl-3.5 pr-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-2xl shadow-black/30 hover:bg-amber-500/15 active:scale-95 transition-all duration-150"
        >
          <div className="relative">
            <ClockArrowDown className="h-5 w-5" strokeWidth={1.5} />
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center shadow-sm px-1">{pendingCount}</span>
          </div>
          <span className="text-xs font-semibold">Pending</span>
        </button>
      )}

      {/* Floating Cart Button — Mobile + Tablet */}
      {cart.length > 0 && (
        <button
          onClick={() => setMobileCartOpen(true)}
          className="lg:hidden fixed bottom-20 right-4 z-50 flex items-center gap-3 h-[56px] pl-4 pr-5 rounded-2xl theme-gradient text-white shadow-2xl shadow-black/40 ring-1 ring-white/10 hover:ring-white/20 active:scale-95 transition-all duration-150"
        >
          <div className="relative">
            <ShoppingCart className="h-5 w-5" strokeWidth={1.5} />
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 rounded-full bg-white theme-bg-dark text-[9px] font-bold flex items-center justify-center shadow-sm px-1">{cart.reduce((s, i) => s + i.qty, 0)}</span>
          </div>
          <div className="flex flex-col items-start leading-tight">
            <span className="text-[10px] font-medium theme-text-dim">{cart.length} produk</span>
            <span className="text-[15px] font-black tabular-nums">{formatCurrency(total)}</span>
          </div>
        </button>
      )}

      {/* ── Mobile Cart Sheet ── */}
      <Sheet open={mobileCartOpen} onOpenChange={(open) => { if (!open) setMobileCartOpen(false) }}>
        <SheetContent side="bottom" className="bg-deep-space border-white/[0.06] rounded-t-[28px] h-[92vh] max-h-[92vh] overflow-hidden flex flex-col px-0 gap-0">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-white/[0.06]" />
          </div>

          {/* Header */}
          <div className="px-5 pb-3 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl theme-gradient-subtle flex items-center justify-center border theme-border-light">
                  <ShoppingCart className="h-4 w-4 theme-text" strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-white leading-tight">Keranjang</h2>
                  {cart.length > 0 && <p className="text-[10px] text-slate-500">{cart.length} produk · {cart.reduce((s, i) => s + i.qty, 0)} item</p>}
                </div>
              </div>
              {cart.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPendingListOpen(true)} className={cn(
                    "relative flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-semibold transition-all",
                    pendingCount > 0
                      ? "text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15"
                      : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 border border-white/[0.06] hover:border-amber-500/20"
                  )}>
                    <ClockArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {pendingCount > 0 && <span>{pendingCount}</span>}
                  </button>
                  <button onClick={clearCart} className="h-8 px-3 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-red-400 hover:bg-red-500/10 border border-white/[0.06] hover:border-red-500/20 transition-all">
                    Hapus Semua
                  </button>
                </div>
              )}
              {cart.length === 0 && pendingCount > 0 && (
                <button onClick={() => setPendingListOpen(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-all">
                  <ClockArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {pendingCount} pending
                </button>
              )}
            </div>
          </div>

          {/* Customer selector */}
          <div className="shrink-0 px-5 pb-3">{renderCustomerSelector(true)}</div>

          {/* Scrollable items */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-white/[0.04] to-nebula border border-white/[0.04] flex items-center justify-center mb-4">
                  <ShoppingCart className="h-8 w-8 text-slate-700/60" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-medium text-slate-500">Keranjang Kosong</p>
                <p className="text-[11px] text-slate-600 mt-1">Pilih produk untuk memulai</p>
              </div>
            ) : (
              renderCartItemsMobile()
            )}
          </div>

          {/* Sticky footer: Summary + Tunda / Proses Bayar */}
          {cart.length > 0 && (
            <div className="shrink-0 border-t border-white/[0.06] bg-deep-space px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
              {/* HPP warning */}
              {hasBelowHpp && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" strokeWidth={2} />
                  <span className="text-[12px] text-red-400 font-medium">Harga di bawah HPP! Kerugian: -{formatCurrency(belowHppTotalLoss)}</span>
                </div>
              )}
              {/* Summary lines */}
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal</span>
                  <span className="text-slate-200 tabular-nums font-medium">{formatCurrency(subtotal)}</span>
                </div>
                {(pointsDiscount > 0 || promoDiscount > 0 || manualDiscountTotal > 0) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {manualDiscountTotal > 0 && (
                      <span className="text-[12px] text-amber-400 font-medium flex items-center gap-1"><Tag className="h-3 w-3" strokeWidth={1.5} /> Diskon Manual -{formatCurrency(manualDiscountTotal)}</span>
                    )}
                    {pointsDiscount > 0 && (
                      <span className="text-[12px] theme-text font-medium flex items-center gap-1"><Coins className="h-3 w-3" strokeWidth={1.5} /> -{formatCurrency(pointsDiscount)}</span>
                    )}
                    {promoDiscount > 0 && selectedPromo && (
                      <span className="text-[12px] text-amber-400 font-medium flex items-center gap-1"><Tag className="h-3 w-3" strokeWidth={1.5} /> {selectedPromo.name} -{formatCurrency(promoDiscount)}</span>
                    )}
                    {ppnAmount > 0 && (
                      <span className="text-[12px] text-sky-300 font-medium">PPN +{formatCurrency(ppnAmount)}</span>
                    )}
                  </div>
                )}
                <div className="border-t border-white/[0.04] pt-2" />
                <div className="flex justify-between items-baseline">
                  <span className="text-sm font-bold text-white">Total</span>
                  <span className="text-xl font-black text-white tabular-nums">{formatCurrency(total)}</span>
                </div>
              </div>
              {/* Action buttons */}
              <div className="flex gap-2.5 pt-1">
                <Button onClick={handleHoldTransaction} variant="outline"
                  className="h-12 px-4 font-semibold text-xs rounded-2xl border-white/[0.08] text-slate-300 hover:bg-white/[0.04] hover:text-white transition-all shrink-0">
                  <ClockArrowDown className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
                  Tunda
                </Button>
                <Button onClick={openPaymentDialog} disabled={hasBelowHpp}
                  className={cn(
                    'flex-1 h-12 font-bold text-sm rounded-2xl shadow-lg theme-shadow transition-all active:scale-[0.98]',
                    hasBelowHpp
                      ? 'bg-white/[0.04] text-slate-500 cursor-not-allowed border border-white/[0.06]'
                      : 'theme-gradient hover:theme-hover text-white'
                  )}>
                  {hasBelowHpp ? (
                    <><AlertTriangle className="mr-1.5 h-4 w-4" strokeWidth={1.5} /> Harga di bawah HPP</>
                  ) : (
                    <><Check className="mr-1.5 h-4 w-4" strokeWidth={1.5} /> Proses Bayar</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ═══════════════════════════════════════════════════════════════
          NEW FLOW: Payment Dialog & Receipt Dialog
          ═══════════════════════════════════════════════════════════════ */}

      {/* Payment Dialog */}
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        cart={cart}
        subtotal={subtotal}
        pointsDiscount={pointsDiscount}
        promoDiscount={promoDiscount}
        manualDiscountTotal={manualDiscountTotal}
        ppnAmount={ppnAmount}
        total={total}
        selectedCustomer={selectedCustomer}
        maxPointsToUse={maxPointsToUse}
        pointsToUse={pointsToUse}
        onPointsChange={handlePointsChange}
        selectedPromo={selectedPromo}
        paymentMethod={paymentMethod}
        onPaymentMethodChange={setPaymentMethod}
        paidAmount={paidAmount}
        onPaidAmountChange={setPaidAmount}
        change={change}
        availablePaymentMethods={availablePaymentMethods}
        themeColors={themeColors}
        quickNominals={getQuickNominals}
        ppnRate={settings.ppnRate}
        onCheckout={handleCheckout}
        checkingOut={checkingOut}
      />

      {/* Receipt Dialog */}
      <ReceiptDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        cart={cart}
        subtotal={subtotal}
        pointsDiscount={pointsDiscount}
        promoDiscount={promoDiscount}
        manualDiscountTotal={manualDiscountTotal}
        ppnAmount={ppnAmount}
        total={total}
        paymentMethod={paymentMethod}
        paidAmount={paidAmount}
        change={change}
        selectedCustomer={selectedCustomer}
        selectedPromo={selectedPromo}
        checkoutResult={checkoutResult}
        settings={settings}
        onFinish={handleReceiptFinish}
      />

      {/* Variant Picker Dialog */}
      <ResponsiveDialog open={variantPicker.open} onOpenChange={(open) => {
        if (!open) setVariantPicker({ product: null as unknown as Product, open: false, variants: [], loading: false })
      }}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-violet-500/20 flex items-center justify-center">
                <Layers className="h-3.5 w-3.5 text-violet-400" strokeWidth={1.5} />
              </div>
              Pilih Varian
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-xs text-slate-500">
              {variantPicker.product?.name || 'Produk'}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2">
            {variantPicker.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
              </div>
            ) : variantPicker.variants.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-8 w-8 text-slate-700 mx-auto mb-2" strokeWidth={1.5} />
                <p className="text-xs text-slate-500">Tidak ada varian tersedia</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {[...variantPicker.variants].sort((a, b) => {
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
                          ? 'opacity-40 cursor-not-allowed bg-white/[0.02] border-white/[0.04]'
                          : 'bg-white/[0.03] border-white/[0.08] hover:border-violet-500/40 hover:bg-violet-500/5 active:scale-[0.99] cursor-pointer'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-xs font-medium', isOutOfStock ? 'text-slate-600' : 'text-slate-200')}>{variant.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {variant.sku && (
                            <span className="text-[10px] text-slate-600 font-mono">{variant.sku}</span>
                          )}
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-md font-medium',
                            isOutOfStock
                              ? 'bg-red-500/10 text-red-400'
                              : variant.stock <= 5
                                ? 'bg-amber-500/10 text-amber-400'
                                : 'bg-white/[0.04] text-slate-500'
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
                        <p className={cn('text-sm font-bold', isOutOfStock ? 'text-slate-600' : 'text-violet-400')}>
                          {formatCurrency(variant.price)}
                        </p>
                        {existingItem && !isOutOfStock && (
                          <div className="flex items-center gap-0.5 ml-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); updateQty(variantPicker.product.id, existingItem.qty - 1, variant.id) }}
                              className="w-6 h-6 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-all active:scale-95"
                            >
                              {existingItem.qty === 1 ? <Trash2 className="h-2.5 w-2.5" strokeWidth={1.5} /> : <Minus className="h-2.5 w-2.5" strokeWidth={1.5} />}
                            </button>
                            <span className="text-[11px] font-bold text-slate-200 w-5 text-center">{existingItem.qty}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); updateQty(variantPicker.product.id, existingItem.qty + 1, variant.id) }}
                              disabled={existingItem.qty >= variant.stock}
                              className="w-6 h-6 rounded-md bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-400 hover:bg-violet-500/30 transition-all active:scale-95 disabled:opacity-30"
                            >
                              <Plus className="h-2.5 w-2.5" strokeWidth={1.5} />
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
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] text-xs rounded-xl">Tutup</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Add Customer Dialog */}
      <ResponsiveDialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <UserPlus className="h-4 w-4 theme-text" strokeWidth={1.5} /> Tambah Customer Baru
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-300">Nama *</Label>
              <Input value={newCustomer.name} onChange={(e) => setNewCustomer(p => ({ ...p, name: e.target.value }))}
                placeholder="Nama customer" className="h-9 text-sm bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-300">No. WhatsApp *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 font-medium">+62</span>
                <Input value={newCustomer.whatsapp} onChange={(e) => setNewCustomer(p => ({ ...p, whatsapp: e.target.value.replace(/[^0-9]/g, '') }))}
                  placeholder="81234567890" className="h-9 text-sm bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 rounded-lg pl-12" />
              </div>
              <p className="text-[10px] text-slate-600">Format: 81234567890 (tanpa 0 di depan). WhatsApp digunakan sebagai ID unik.</p>
            </div>
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setAddCustomerOpen(false)} className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] text-xs rounded-xl">Batal</Button>
            <Button onClick={handleAddCustomer} disabled={addingCustomer || !newCustomer.name.trim() || !newCustomer.whatsapp.trim()}
              className="theme-bg theme-hover text-white text-xs rounded-xl font-medium">
              {addingCustomer && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />} Simpan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Offline Transactions Sync Dialog */}
      <ResponsiveDialog open={offlineListOpen} onOpenChange={setOfflineListOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-lg rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-base font-bold text-white flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                <CloudOff className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  Transaksi Offline
                  {unsyncedCount > 0 && (
                    <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] px-2 py-0.5 h-5 font-semibold">{unsyncedCount} belum sync</Badge>
                  )}
                </div>
              </div>
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-400 flex items-center gap-2 pt-1">
              <span className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                isOnline ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]"
              )} />
              <span className={cn("font-medium", isOnline ? "text-emerald-400" : "text-red-400")}>{isOnline ? 'Online' : 'Offline'}</span>
              <span className="text-slate-600">—</span>
              <span className="text-slate-500">Transaksi yang belum berhasil disinkronkan ke server</span>
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <OfflineSyncContent
            isOnline={isOnline}
            onSynced={() => {
              fetchProducts(productSearch, productPage, selectedCategoryId)
              loadCustomersFromCache()
            }}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Pending Transactions List Dialog */}
      <ResponsiveDialog open={pendingListOpen} onOpenChange={setPendingListOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                <ClockArrowDown className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  Transaksi Ditunda
                </div>
                <p className="text-[10px] text-slate-500 font-normal mt-0.5">Transaksi yang sedang berjalan bisa ditunda lalu dilanjutkan kembali</p>
              </div>
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-400 flex items-center gap-2 pt-1">
              Keranjang yang ditunda bisa dilanjutkan kapan saja
              {pendingCount > 0 && (
                <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] px-2 py-0.5 h-5 font-semibold">{pendingCount}</Badge>
              )}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <PendingListContent
            onResume={handleResumePending}
            onDelete={handleDeletePending}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Hold Note Dialog */}
      <ResponsiveDialog open={holdNoteOpen} onOpenChange={setHoldNoteOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-sm rounded-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-amber-400" strokeWidth={1.5} /> Catatan Tunda
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-[11px] text-slate-500">
              Tambahkan catatan opsional untuk transaksi ini
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-2">
            <textarea
              value={holdNote}
              onChange={(e) => setHoldNote(e.target.value)}
              placeholder="Contoh: customer minta ditunda, menunggu pembayaran..."
              rows={3}
              autoFocus
              className="w-full bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-slate-600 text-sm rounded-xl px-3.5 py-2.5 resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/50 focus-visible:border-cyan-500/30 transition-all"
            />
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => { setHoldNoteOpen(false); setHoldNote('') }}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] text-xs rounded-xl">
              Batal
            </Button>
            <Button onClick={confirmHoldTransaction}
              className="theme-bg hover:theme-hover text-white text-xs rounded-xl font-medium">
              <ClockArrowDown className="mr-1.5 h-3 w-3" strokeWidth={1.5} />
              Tunda Transaksi
            </Button>
          </ResponsiveDialogFooter>
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
        <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
      </div>
    )
  }

  if (pendingList.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3.5 border border-white/[0.06]">
          <ClockArrowDown className="h-7 w-7 text-slate-600" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-white font-bold">Belum Ada yang Ditunda</p>
        <p className="text-[11px] text-slate-500 mt-1.5 max-w-[220px] mx-auto leading-relaxed">
          Saat melayani pelanggan, Anda bisa menunda transaksi yang sedang berjalan lalu melanjutkannya nanti.
        </p>
        <div className="mt-4 mx-auto max-w-[260px] px-3 py-2.5 rounded-xl bg-amber-500/[0.06] border border-amber-500/[0.08]">
          <p className="text-[10px] text-amber-400/80 leading-relaxed text-left">
            💡 <span className="font-medium text-amber-400">Tip:</span> Gunakan tombol <span className="font-semibold text-white">Tunda</span> di keranjang untuk menahan sementara pesanan ini.
          </p>
        </div>
      </div>
    )
  }

  const formatRelativeTime = (ts: number) => {
    const diff = Date.now() - ts
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'Baru saja'
    if (minutes < 60) return `${minutes} menit lalu`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} jam lalu`
    const days = Math.floor(hours / 24)
    return `${days} hari lalu`
  }

  return (
    <div className="space-y-2.5 py-2 max-h-[60vh] overflow-y-auto">
      {pendingList.map((pending) => {
        const items = pending.items as Array<{ product: { name: string; image: string | null }; variant: { name: string } | null; qty: number }>
        const totalItems = items.reduce((s, i) => s + i.qty, 0)

        return (
          <div key={pending.id} className="relative rounded-xl border border-white/[0.06] bg-white/[0.02] border-l-[3px] border-l-amber-500/30 p-3.5 space-y-3">
            {/* Delete button overlay top-right */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(pending.id!)}
              className="absolute top-2.5 right-2.5 h-6 w-6 px-0 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </Button>

            {/* Header: time + user + item count | subtotal */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" strokeWidth={1.5} />
                    {formatRelativeTime(pending.createdAt)}
                  </span>
                  <Badge variant="secondary" className="bg-white/[0.06] text-slate-400 border-white/[0.08] text-[9px] px-1.5 py-0 h-4 font-normal">
                    {pending.userName}
                  </Badge>
                  <Badge variant="secondary" className="bg-white/[0.06] text-slate-400 border-white/[0.08] text-[9px] px-1.5 py-0 h-4 font-normal">
                    {totalItems} item
                  </Badge>
                </div>
              </div>
              <div className="shrink-0">
                <p className="text-sm font-bold text-white tabular-nums">{formatCurrency(pending.subtotal)}</p>
              </div>
            </div>

            {/* Items preview — mini receipt look */}
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] border-l-2 border-l-white/[0.06] overflow-hidden">
              <div className="space-y-0.5 px-3 py-2">
                {items.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex items-baseline gap-2 text-[11px]">
                    <span className="font-mono text-slate-500 w-5 text-right shrink-0">{item.qty}×</span>
                    <span className="text-slate-300 truncate">{item.product.name}</span>
                    {item.variant && (
                      <span className="text-slate-600 text-[10px] truncate">{item.variant.name}</span>
                    )}
                  </div>
                ))}
                {items.length > 3 && (
                  <p className="text-[10px] text-slate-600 pl-7">+{items.length - 3} item lainnya</p>
                )}
              </div>
            </div>

            {/* Note — chat bubble style */}
            {pending.note && (
              <div className="flex items-start gap-1.5">
                <MessageSquare className="h-3 w-3 text-slate-600 shrink-0 mt-0.5" strokeWidth={1.5} />
                <div className="rounded-xl rounded-tl-sm bg-white/[0.03] border border-white/[0.05] px-3 py-2 max-w-full">
                  <p className="text-[11px] text-slate-400 leading-relaxed">{pending.note}</p>
                </div>
              </div>
            )}

            {/* Customer */}
            {pending.customerName && (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <User className="h-3 w-3 text-slate-500" strokeWidth={1.5} />
                <span className="font-medium text-slate-300">{pending.customerName}</span>
              </div>
            )}

            {/* Action — full width resume button */}
            <Button size="sm" onClick={() => onResume(pending)}
              className="w-full h-8.5 text-[11px] font-medium rounded-xl theme-bg hover:theme-hover text-white transition-colors">
              <ShoppingCart className="mr-1.5 h-3 w-3" strokeWidth={1.5} /> Lanjutkan ke Keranjang
            </Button>
          </div>
        )
      })}
    </div>
  )
}

// ==================== OFFLINE SYNC SUB-COMPONENT ====================

function OfflineSyncContent({
  isOnline,
  onSynced,
}: {
  isOnline: boolean
  onSynced: () => void
}) {
  const offlineList = useLiveQuery(
    async () => {
      const list = await localDB.transactions.where('isSynced').equals(0).toArray()
      return list.sort((a, b) => b.createdAt - a.createdAt)
    },
    []
  )
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set())
  const [syncingAll, setSyncingAll] = useState(false)

  const syncOne = async (tx: OfflineTransaction) => {
    if (!tx.id || syncingIds.has(tx.id)) return
    setSyncingIds(prev => new Set(prev).add(tx.id!))
    try {
      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [tx] }),
      })
      const data = await res.json()
      if (res.ok && data.results?.[0]?.success) {
        await localDB.transactions.update(tx.id, {
          isSynced: 1,
          syncedAt: Date.now(),
          invoiceNumber: data.results[0].invoiceNumber,
          serverTransactionId: data.results[0].serverId,
        })
        toast.success('Transaksi berhasil disync!')
        onSynced()
      } else {
        const error = data.results?.[0]?.error || data.error || 'Gagal sync'
        await localDB.transactions.update(tx.id, {
          retryCount: (tx.retryCount || 0) + 1,
          lastError: error,
        })
        toast.error('Sync gagal', { description: error })
      }
    } catch {
      await localDB.transactions.update(tx.id, {
        retryCount: (tx.retryCount || 0) + 1,
        lastError: 'Tidak ada koneksi internet',
      })
      toast.error('Sync gagal — tidak ada koneksi')
    } finally {
      setSyncingIds(prev => {
        const next = new Set(prev)
        next.delete(tx.id!)
        return next
      })
    }
  }

  const syncAll = async () => {
    if (!offlineList || offlineList.length === 0 || syncingAll) return
    setSyncingAll(true)
    try {
      const res = await fetch('/api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: offlineList }),
      })
      const data = await res.json()
      if (res.ok) {
        let synced = 0
        let failed = 0
        for (const result of data.results || []) {
          if (result.success) {
            await localDB.transactions.update(result.localId, {
              isSynced: 1,
              syncedAt: Date.now(),
              invoiceNumber: result.invoiceNumber,
              serverTransactionId: result.serverId,
            })
            synced++
          } else {
            const existing = await localDB.transactions.get(result.localId)
            await localDB.transactions.update(result.localId, {
              retryCount: (existing?.retryCount || 0) + 1,
              lastError: result.error,
            })
            failed++
          }
        }
        if (synced > 0) {
          toast.success(`${synced} transaksi berhasil disync!`)
          onSynced()
        }
        if (failed > 0) {
          toast.error(`${failed} transaksi gagal sync`, { description: 'Periksa stok produk.' })
        }
      } else {
        toast.error('Sync gagal — server error')
      }
    } catch {
      toast.error('Sync gagal — tidak ada koneksi internet')
    } finally {
      setSyncingAll(false)
    }
  }

  const deleteOne = async (id: number) => {
    await localDB.transactions.delete(id)
    toast.success('Transaksi offline dihapus')
  }

  const deleteAll = async () => {
    if (!offlineList) return
    for (const tx of offlineList) {
      if (tx.id) await localDB.transactions.delete(tx.id)
    }
    toast.success(`${offlineList.length} transaksi offline dihapus`)
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const getTxInfo = (tx: OfflineTransaction) => {
    const p = tx.payload
    const invoice = (tx.invoiceNumber as string) || (p.invoiceNumber as string) || `OFF-${tx.createdAt.toString(36).toUpperCase()}`
    const total = (p.total as number) || (p.subtotal as number) || 0
    const items = (p.items as Array<{ product?: { name: string }; variant?: { name: string }; qty: number }>) || []
    const itemCount = items.reduce((s, i) => s + (i.qty || 1), 0)
    return { invoice, total, itemCount }
  }

  if (!offlineList) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 text-slate-500 animate-spin" />
      </div>
    )
  }

  if (offlineList.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center mx-auto mb-3.5">
          <Check className="h-7 w-7 text-emerald-400" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-white font-bold">Semua Tersinkronisasi</p>
        <p className="text-xs text-slate-500 mt-1.5">Tidak ada transaksi yang perlu disinkronkan</p>
        <Separator className="mt-5 bg-white/[0.06]" />
      </div>
    )
  }

  const totalNominal = offlineList.reduce((s, tx) => {
    const p = tx.payload
    return s + ((p.total as number) || (p.subtotal as number) || 0)
  }, 0)

  return (
    <div className="space-y-3 py-2">
      {/* Offline warning banner */}
      {!isOnline && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/[0.15]">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <WifiOff className="h-4 w-4 text-red-400 shrink-0" strokeWidth={1.5} />
          <div className="min-w-0">
            <p className="text-[11px] text-red-400 font-bold leading-tight">Mode Offline Aktif</p>
            <p className="text-[10px] text-red-400/60 mt-0.5 leading-relaxed">Sinkronisasi otomatis akan dilakukan saat koneksi kembali</p>
          </div>
        </div>
      )}

      {/* Summary stats bar */}
      <div className="flex gap-2">
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
          <p className="text-[10px] text-slate-500">Transaksi</p>
          <p className="text-sm font-bold text-white tabular-nums">{offlineList.length}</p>
        </div>
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
          <p className="text-[10px] text-slate-500">Total Nominal</p>
          <p className="text-sm font-bold text-white tabular-nums">{formatCurrency(totalNominal)}</p>
        </div>
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
          <p className="text-[10px] text-slate-500">Status</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", isOnline ? "bg-emerald-400" : "bg-red-400")} />
            <span className={cn("text-xs font-semibold", isOnline ? "text-emerald-400" : "text-red-400")}>{isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Sticky bulk actions bar */}
      <div className="sticky top-0 z-10 -mx-1 px-1 pb-2 bg-nebula/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2">
          <Button
            size="sm"
            onClick={syncAll}
            disabled={syncingAll || !isOnline}
            className="h-8 text-[11px] font-medium rounded-lg theme-bg hover:theme-hover text-white transition-colors disabled:opacity-40"
          >
            {syncingAll ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" strokeWidth={1.5} />}
            Sinkronkan Semua
            {offlineList.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 bg-white/[0.15] text-white border-white/[0.2] text-[9px] px-1.5 py-0 h-4 font-semibold">
                {offlineList.length}
              </Badge>
            )}
          </Button>
          <button
            onClick={deleteAll}
            className="text-[11px] text-slate-500 hover:text-red-400 transition-colors font-medium shrink-0"
          >
            Hapus Semua
          </button>
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-2.5 max-h-[50vh] overflow-y-auto">
        {offlineList.map((tx) => {
          const { invoice, total, itemCount } = getTxInfo(tx)
          const isSyncing = syncingIds.has(tx.id!)
          const hasError = !!tx.lastError
          const borderColor = hasError ? 'border-l-red-500/40' : 'border-l-amber-500/40'

          return (
            <div key={tx.id} className={cn(
              "relative rounded-xl border border-white/[0.06] bg-white/[0.02] border-l-[3px] p-3.5 space-y-3",
              borderColor
            )}>
              {/* Delete button overlay top-right */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => deleteOne(tx.id!)}
                className="absolute top-2.5 right-2.5 h-6 w-6 px-0 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </Button>

              {/* Header: Invoice + OFFLINE tag + item count | Total */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-slate-200 font-mono truncate">{invoice}</p>
                    <Badge variant="secondary" className="bg-red-500/10 text-red-400 border-red-500/15 text-[8px] px-1.5 py-0 h-4 font-bold tracking-wider shrink-0">
                      OFFLINE
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Package className="h-2.5 w-2.5" strokeWidth={1.5} />
                      {itemCount} item
                    </span>
                    <span className="text-slate-700">·</span>
                    <span className="text-[10px] text-slate-600">{formatTime(tx.createdAt)}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  <p className="text-sm font-bold text-white tabular-nums">{formatCurrency(total)}</p>
                </div>
              </div>

              {/* Status section: retry badge + error */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[9px] px-1.5 py-0 h-4 font-semibold border",
                    (tx.retryCount || 0) > 2
                      ? "bg-red-500/10 text-red-400 border-red-500/15"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/15"
                  )}
                >
                  {tx.retryCount || 0}x retry
                </Badge>
                {tx.lastError && (
                  <span className="flex items-center gap-1 text-[10px] text-red-400/80 min-w-0">
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" strokeWidth={1.5} />
                    <span className="truncate" title={tx.lastError}>{tx.lastError}</span>
                  </span>
                )}
              </div>

              {/* Sync button — full width */}
              <Button
                size="sm"
                onClick={() => syncOne(tx)}
                disabled={isSyncing || !isOnline}
                className="w-full h-8 text-[11px] font-medium rounded-xl theme-bg hover:theme-hover text-white transition-colors disabled:opacity-40"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Menyinkronkan...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 h-3 w-3" strokeWidth={1.5} />
                    Sync Sekarang
                  </>
                )}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}