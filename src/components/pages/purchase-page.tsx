'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber, formatDate } from '@/lib/format'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogDescription,
} from '@/components/ui/responsive-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Pagination } from '@/components/shared/pagination'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Plus,
  Search,
  Eye,
  Trash2,
  Loader2,
  ShoppingCart,
  Package,
  PackagePlus,
  PackageOpen,
  X,
  Tags,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Scale,
  Edit3,
  Pencil,
  FileText,
  Banknote,
  Info,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  Copy,
  Activity,
  ArrowUpDown,
  Link2,
  ScanBarcode,
  Upload,
  FileSpreadsheet,
  ClipboardPaste,
  Download,
  RotateCcw,
  Archive,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

interface InventoryItemOption {
  id: string
  name: string
  sku: string | null
  baseUnit: string
  stock: number
  active: boolean
  /** True if this is a pending item not yet saved to DB */
  _isNew?: boolean
}

interface PurchaseOrderItem {
  inventoryItemId: string
  inventoryItemName: string
  inventoryItemSku: string | null
  baseUnit: string
  qty: string
  unit: string
  baseQty: string
  pricePerItem: string  // harga per unit pembelian (e.g., 72000 per ekor)
}

interface PurchaseOrder {
  id: string
  orderNumber: string
  date: string
  notes: string | null
  totalCost: number
  itemCount?: number
  _count?: { items: number }
  items?: PurchaseOrderItemDetail[]
  createdAt: string
  updatedAt?: string
  supplierName?: string | null
  createdByName?: string
  hasLinkedItems?: boolean
  supplier?: { id: string; name: string; phone: string | null; address: string | null } | null
  createdBy?: { id: string; name: string; email: string } | null
}

interface PurchaseOrderItemDetail {
  id: string
  inventoryItemId: string
  name: string
  inventoryItem: { id: string; name: string; sku: string | null; baseUnit: string } | null
  purchaseQty: number
  purchaseUnit: string
  baseQty: number
  baseUnit: string
  totalCost: number
  unitCost: number
}

interface InventoryCategory {
  id: string
  name: string
  color: string
  _count?: { items: number }
}

interface InventoryItem {
  id: string
  name: string
  sku: string | null
  baseUnit: string
  categoryId: string | null
  category?: { id: string; name: string; color: string } | null
  stock: number
  avgCost: number
  lowStockAlert: number
  status?: string // ACTIVE, ARCHIVED
  _count?: { compositions: number; purchaseItems: number }
}

interface InventoryStats {
  totalItems: number
  totalValue: number
  lowStockCount: number
}

interface LinkedProduct {
  id: string
  productId: string
  productName: string
  productSku: string | null
  productImage: string | null
  productPrice: number
  productStock: number
  variantId: string | null
  variantName: string | null
  variantPrice: number | null
  qty: number
  yieldPerBatch: number
  baseUnit: string
}

interface InventoryMovementRow {
  id: string
  type: string
  quantity: number
  previousStock: number
  newStock: number
  referenceId: string | null
  referenceType: string | null
  notes: string | null
  createdAt: string
  userName: string | null
}

interface InventoryItemDetail {
  id: string
  name: string
  sku: string | null
  baseUnit: string
  stock: number
  avgCost: number
  lowStockAlert: number
  status: string
  category: { id: string; name: string; color: string } | null
  _count: { compositions: number; purchaseItems: number; movements: number }
  linkedProducts: LinkedProduct[]
  movements: InventoryMovementRow[]
  movementPagination: { page: number; totalPages: number; total: number }
}

interface InventoryListResponse {
  items: InventoryItem[]
  totalPages: number
  stats: InventoryStats
}

interface PurchaseSummary {
  totalPurchaseNominal: number
  totalPurchaseCount: number
  totalInventoryNominal: number
  totalInventoryItems: number
  totalRevenue: number
  totalTxCount: number
  monthPurchaseNominal: number
  monthPurchaseCount: number
  monthRevenue: number
  monthTxCount: number
  overallRatio: number
  monthRatio: number
}

const PRODUCT_UNIT_OPTIONS = ['pcs', 'box', 'pack', 'cup', 'botol', 'porsi', 'gelas', 'bungkus', 'liter', 'kg', 'gram', 'meter']
const BASE_UNIT_OPTIONS = ['gr', 'kg', 'ml', 'liter', 'meter', 'cm', 'pcs', 'box', 'pack', 'lembar', 'yard', 'lbr']

const CATEGORY_COLORS = [
  'zinc', 'emerald', 'amber', 'rose', 'violet', 'sky',
  'cyan', 'orange', 'lime', 'teal', 'fuchsia', 'pink',
] as const

function getCategoryColorClasses(color: string) {
  const map: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    zinc: { bg: 'bg-zinc-500/10', text: 'text-slate-300', border: 'border-zinc-500/20', dot: 'bg-zinc-400' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-400' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-400' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', dot: 'bg-rose-400' },
    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', dot: 'bg-violet-400' },
    sky: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/20', dot: 'bg-sky-400' },
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', dot: 'bg-cyan-400' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20', dot: 'bg-orange-400' },
    lime: { bg: 'bg-lime-500/10', text: 'text-lime-400', border: 'border-lime-500/20', dot: 'bg-lime-400' },
    teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/20', dot: 'bg-teal-400' },
    fuchsia: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-400', border: 'border-fuchsia-500/20', dot: 'bg-fuchsia-400' },
    pink: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/20', dot: 'bg-pink-400' },
  }
  return map[color] || map['zinc']
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
}
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] } },
}

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════
export default function PurchasePage() {
  const { data: session } = useSession()

  // ── Tab ──
  const [tab, setTab] = useState<string>('purchase')

  // ── Guide panels ──
  const [showPurchaseGuide, setShowPurchaseGuide] = useState(true)
  const [showPurchaseDialogGuide, setShowPurchaseDialogGuide] = useState(true)
  const [showInventoryGuide, setShowInventoryGuide] = useState(true)

  // ══════════════════════════════════════════════════════════
  // TAB 1: PEMBELIAN (Purchase Orders)
  // ══════════════════════════════════════════════════════════

  // Purchase list
  const [poList, setPoList] = useState<PurchaseOrder[]>([])
  const [poLoading, setPoLoading] = useState(true)
  const [poSearch, setPoSearch] = useState('')
  const [poDebouncedSearch, setPoDebouncedSearch] = useState('')
  const [poPage, setPoPage] = useState(1)
  const [poTotalPages, setPoTotalPages] = useState(1)

  // Purchase detail dialog
  const [poDetailOpen, setPoDetailOpen] = useState(false)
  const [poDetailData, setPoDetailData] = useState<PurchaseOrder | null>(null)
  const [poDetailLoading, setPoDetailLoading] = useState(false)
  const [poDetailHasLinked, setPoDetailHasLinked] = useState(false)

  // Purchase create dialog
  const [poCreateOpen, setPoCreateOpen] = useState(false)
  const [poCreateLoading, setPoCreateLoading] = useState(false)
  const [poCreateNotes, setPoCreateNotes] = useState('')
  const [poCreateItems, setPoCreateItems] = useState<PurchaseOrderItem[]>([
    { inventoryItemId: '', inventoryItemName: '', baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' },
  ])

  // Item picker for purchase dialog (pre-loaded)
  const [poItemOptions, setPoItemOptions] = useState<InventoryItemOption[]>([])
  const [poItemOptionsLoading, setPoItemOptionsLoading] = useState(false)
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [activeItemSearchIdx, setActiveItemSearchIdx] = useState<number | null>(null)
  const [itemPickerFilter, setItemPickerFilter] = useState('')
  const invItemSearchRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const invItemEditSearchRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // Quick add new item from purchase dialog
  const [showQuickAddItem, setShowQuickAddItem] = useState(false)
  const [quickItemName, setQuickItemName] = useState('')
  const [quickItemSku, setQuickItemSku] = useState('')
  const [quickItemUnit, setQuickItemUnit] = useState('')
  const [quickItemCreating, setQuickItemCreating] = useState(false)
  const pendingCounterRef = useRef(0)
  // Queue for batch smart-input: names waiting to be created via Quick Add form
  const [quickAddQueue, setQuickAddQueue] = useState<string[]>([])
  // Target index where the Quick Add item should be placed
  const [quickAddTargetIdx, setQuickAddTargetIdx] = useState<number>(0)

  // Smart input (batch add by comma-separated names)
  const [smartInput, setSmartInput] = useState('')
  const [showInactiveItems, setShowInactiveItems] = useState(false)
  // Barcode scan detection (timing-based, like POS page)
  const smartInputLastCharTimeRef = useRef(0)
  const smartInputCharCountRef = useRef(0)
  const smartInputScanDetectedRef = useRef(false)
  const [scanModeActive, setScanModeActive] = useState(false) // visual indicator

  // Supplier selector for purchase dialog
  const [supplierOptions, setSupplierOptions] = useState<Array<{ id: string; name: string }>>([])
  const [poCreateSupplierId, setPoCreateSupplierId] = useState('')

  // Excel import
  const [showImportPreview, setShowImportPreview] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importPosting, setImportPosting] = useState(false)
  const [importSupplierId, setImportSupplierId] = useState('')
  const [importPreviewData, setImportPreviewData] = useState<Array<{
    row: number; name: string; sku: string | null; purchaseUnit: string;
    qty: number; baseQty: number; baseUnit: string; pricePerUnit: number;
    matchedItemId: string | null; matchedItemName: string | null;
    matchedItemSku: string | null; matchedItemUnit: string | null;
    isNew: boolean; isArchived: boolean;
    archivedItemId: string | null; archivedItemName: string | null;
    error?: string;
  }> | null>(null)
  const importFileRef = useRef<HTMLInputElement | null>(null)

  const smartInputRef = useRef<HTMLInputElement>(null)



  // Purchase delete
  const [deletePoId, setDeletePoId] = useState<string | null>(null)
  const [deletingPo, setDeletingPo] = useState(false)

  // Purchase edit dialog
  const [poEditOpen, setPoEditOpen] = useState(false)
  const [poEditId, setPoEditId] = useState<string | null>(null)
  const [poEditLoading, setPoEditLoading] = useState(false)
  const [poEditNotes, setPoEditNotes] = useState('')
  const [poEditItems, setPoEditItems] = useState<PurchaseOrderItem[]>([
    { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' },
  ])

  // ══════════════════════════════════════════════════════════
  // TAB 2: INVENTORY ITEMS (Inventory Items)
  // ══════════════════════════════════════════════════════════

  const [invList, setInvList] = useState<InventoryItem[]>([])
  const [invLoading, setInvLoading] = useState(true)
  const [invSearch, setInvSearch] = useState('')
  const [invDebouncedSearch, setInvDebouncedSearch] = useState('')
  const [invCategoryFilter, setInvCategoryFilter] = useState<string>('all')
  const [invPage, setInvPage] = useState(1)
  const [invTotalPages, setInvTotalPages] = useState(1)
  const invPerPage = 20
  const [invStats, setInvStats] = useState<InventoryStats>({ totalItems: 0, totalValue: 0, lowStockCount: 0 })

  // Inventory item form dialog
  const [invFormOpen, setInvFormOpen] = useState(false)
  const [invFormEdit, setInvFormEdit] = useState<InventoryItem | null>(null)
  const [invFormLoading, setInvFormLoading] = useState(false)
  const [invFormName, setInvFormName] = useState('')
  const [invFormSku, setInvFormSku] = useState('')
  const [invFormBaseUnit, setInvFormBaseUnit] = useState('kg')
  const [invFormCategory, setInvFormCategory] = useState('')
  const [invFormLowStock, setInvFormLowStock] = useState('0')
  const [invFormInitialStock, setInvFormInitialStock] = useState('')
  const [invFormAvgCost, setInvFormAvgCost] = useState('')

  // Inventory detail dialog
  const [invDetailOpen, setInvDetailOpen] = useState(false)
  const [invDetailData, setInvDetailData] = useState<InventoryItemDetail | null>(null)
  const [invDetailLoading, setInvDetailLoading] = useState(false)
  const [invDetailError, setInvDetailError] = useState<string | null>(null)
  const [invDetailTab, setInvDetailTab] = useState('products')
  const [invDetailMovementPage, setInvDetailMovementPage] = useState(1)

  // Inventory delete / archive
  const [deleteInvId, setDeleteInvId] = useState<string | null>(null)
  const [archivingInv, setArchivingInv] = useState(false)
  const [invDeleteBlocked, setInvDeleteBlocked] = useState<{
    blockType?: 'hasHistory' | 'compositions' | 'purchaseItems'
    message?: string
    blockers?: string[]
    suggestion?: string
    compositionCount?: number
    purchaseItemCount?: number
    linkedProducts: Array<{ productId: string; productName: string; variantName: string | null; qty: number; baseUnit: string }>
  } | null>(null)

  // Categories
  const [categories, setCategories] = useState<InventoryCategory[]>([])
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [catFormName, setCatFormName] = useState('')
  const [catFormColor, setCatFormColor] = useState('emerald')
  const [catFormLoading, setCatFormLoading] = useState(false)
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null)
  const [deletingCat, setDeletingCat] = useState(false)

  // Purchase summary (ratio)
  const [purchaseSummary, setPurchaseSummary] = useState<PurchaseSummary | null>(null)
  const [infoExpanded, setInfoExpanded] = useState(false)
  const [invInfoExpanded, setInvInfoExpanded] = useState(false)

  // Post as Product feature
  const [selectedInvIds, setSelectedInvIds] = useState<Set<string>>(new Set())
  const [postProductOpen, setPostProductOpen] = useState(false)
  const [postMode, setPostMode] = useState<'select'|'composition'|'retail'>('select')
  const [postStep, setPostStep] = useState<1|2|3>(1)
  const [postProductName, setPostProductName] = useState('')
  const [postProductPrice, setPostProductPrice] = useState('')
  const [postProductCategory, setPostProductCategory] = useState('')
  const [postProductUnit, setPostProductUnit] = useState('pcs')
  const [postHasVariants, setPostHasVariants] = useState(false)
  const [postProductSubmitting, setPostProductSubmitting] = useState(false)
  const [postProductCategories, setPostProductCategories] = useState<Array<{id:string;name:string}>>([])

  // Per-inventory-item qty adjustment for composition (Step 1): invItemId → qty string
  const [postCompQty, setPostCompQty] = useState<Record<string, string>>({})

  // Variant definitions for Step 2
  const [postVariants, setPostVariants] = useState<Array<{ name: string; price: string }>>([])

  // Per-variant composition qty overrides: variantIndex → invItemId → qty string
  const [postVariantCompQty, setPostVariantCompQty] = useState<Record<number, Record<string, string>>>({})

  // Retail mode: per-item price overrides & comp qty (1 per item by default)
  const [retailPrices, setRetailPrices] = useState<Record<string, string>>({})
  const [retailQtyPerProduct, setRetailQtyPerProduct] = useState<Record<string, string>>({})
  const [retailBulkPrice, setRetailBulkPrice] = useState('')
  const [retailUseBulkPrice, setRetailUseBulkPrice] = useState(true)
  const [retailCategory, setRetailCategory] = useState('')
  const [retailSubmitting, setRetailSubmitting] = useState(false)

  // ══════════════════════════════════════════════════════════
  // Fetch: Purchase Orders
  // ══════════════════════════════════════════════════════════
  const fetchPurchaseOrders = useCallback(async () => {
    setPoLoading(true)
    try {
      const params = new URLSearchParams({ page: String(poPage), search: poDebouncedSearch })
      const res = await fetch(`/api/purchases?${params}`)
      if (res.ok) {
        const data = await res.json()
        setPoList(data.orders || [])
        setPoTotalPages(data.totalPages || 1)
      }
    } catch {
      toast.error('Gagal memuat data pembelian')
    } finally {
      setPoLoading(false)
    }
  }, [poPage, poDebouncedSearch])

  useEffect(() => {
    if (tab === 'purchase') void fetchPurchaseOrders()
  }, [tab, fetchPurchaseOrders])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setPoDebouncedSearch(poSearch), 300)
    return () => clearTimeout(t)
  }, [poSearch])

  // ══════════════════════════════════════════════════════════
  // Fetch: Inventory Items
  // ══════════════════════════════════════════════════════════
  const fetchInventoryItems = useCallback(async () => {
    setInvLoading(true)
    try {
      const params = new URLSearchParams({
        search: invDebouncedSearch,
        categoryId: invCategoryFilter === 'all' ? '' : invCategoryFilter,
        activeOnly: String(!showInactiveItems),
      })
      const res = await fetch(`/api/inventory/items?${params}`)
      if (res.ok) {
        const data = await res.json()
        const allItems: InventoryItem[] = data.items || []
        // Client-side pagination
        const totalItems = allItems.length
        const totalPages = Math.max(1, Math.ceil(totalItems / invPerPage))
        const start = (invPage - 1) * invPerPage
        const pageItems = allItems.slice(start, start + invPerPage)
        setInvList(pageItems)
        setInvTotalPages(totalPages)
        // Client-side stats
        const totalValue = allItems.reduce((sum, i) => sum + i.stock * i.avgCost, 0)
        const lowStockCount = allItems.filter(i => i.stock <= i.lowStockAlert).length
        setInvStats({ totalItems, totalValue, lowStockCount })
      }
    } catch {
      toast.error('Gagal memuat data inventory')
    } finally {
      setInvLoading(false)
    }
  }, [invPage, invDebouncedSearch, invCategoryFilter, showInactiveItems])

  useEffect(() => {
    if (tab === 'inventory') void fetchInventoryItems()
  }, [tab, fetchInventoryItems])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setInvDebouncedSearch(invSearch), 300)
    return () => clearTimeout(t)
  }, [invSearch])



  // ══════════════════════════════════════════════════════════
  // Fetch: Categories
  // ══════════════════════════════════════════════════════════
  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/categories')
      if (res.ok) {
        const data = await res.json()
        setCategories(data.categories || data || [])
      }
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    void fetchCategories()
  }, [fetchCategories])

  // ══════════════════════════════════════════════════════════
  // Fetch: Purchase Summary (ratio)
  // ══════════════════════════════════════════════════════════
  const fetchPurchaseSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/purchases/summary')
      if (res.ok) {
        const data = await res.json()
        setPurchaseSummary(data)
      }
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    if (tab === 'purchase') void fetchPurchaseSummary()
  }, [tab, fetchPurchaseSummary])

  // ══════════════════════════════════════════════════════════
  // Fetch: Product Categories (for Post as Product)
  // ══════════════════════════════════════════════════════════
  const fetchProductCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories')
      if (res.ok) {
        const data = await res.json()
        setPostProductCategories((data.categories || []).map((c: {id:string;name:string}) => ({ id: c.id, name: c.name })))
      }
    } catch { /* silent */ }
  }, [])

  // ══════════════════════════════════════════════════════════
  // Fetch: Pre-load item options for purchase dialog
  // ══════════════════════════════════════════════════════════
  const fetchPoItemOptions = useCallback(async () => {
    setPoItemOptionsLoading(true)
    try {
      // PO item picker: ALWAYS only show active items — archived items cannot be used in new purchases
      const res = await fetch('/api/inventory/items?limit=200&activeOnly=true')
      if (res.ok) {
        const data = await res.json()
        setPoItemOptions((data.items || []).map((i: { id: string; name: string; sku: string | null; baseUnit: string; stock: number; active?: boolean }) => ({
          id: i.id,
          name: i.name,
          sku: i.sku || null,
          baseUnit: i.baseUnit,
          stock: i.stock ?? 0,
          active: i.active !== false,
        })))
      }
    } catch {
      // silent
    } finally {
      setPoItemOptionsLoading(false)
    }
  }, [])

  // Pre-load items when purchase dialog opens
  useEffect(() => {
    if (poCreateOpen) {
      pendingCounterRef.current = 0
      fetchPoItemOptions()
      setShowItemPicker(false)
      setActiveItemSearchIdx(null)
      setItemPickerFilter('')
      setShowQuickAddItem(false)
    }
  }, [poCreateOpen, fetchPoItemOptions])

  // Client-side filter for item picker
  const filteredItemOptions = useMemo(() => {
    const q = itemPickerFilter.trim().toLowerCase()
    if (!q) return poItemOptions
    return poItemOptions.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.sku && i.sku.toLowerCase().includes(q))
    )
  }, [poItemOptions, itemPickerFilter])

  // Close picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (activeItemSearchIdx === null) return
      const el = invItemSearchRefs.current[activeItemSearchIdx]
      if (el && !el.contains(e.target as Node)) {
        setShowItemPicker(false)
        setShowQuickAddItem(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [activeItemSearchIdx])

  // ══════════════════════════════════════════════════════════
  // Purchase Order: Detail
  // ══════════════════════════════════════════════════════════
  // Detail error state
  const [poDetailError, setPoDetailError] = useState<string | null>(null)

  const openPoDetail = async (po: PurchaseOrder) => {
    setPoDetailOpen(true)
    setPoDetailData(null)
    setPoDetailError(null)
    setPoDetailLoading(true)
    setPoDetailHasLinked(!!po.hasLinkedItems)
    try {
      const res = await fetch(`/api/purchases/${po.id}`)
      if (res.ok) {
        const data = await res.json()
        setPoDetailData(data)
      } else {
        const data = await res.json().catch(() => ({}))
        setPoDetailError(data.error || 'Gagal memuat detail pembelian')
      }
    } catch {
      setPoDetailError('Gagal memuat detail pembelian')
    } finally {
      setPoDetailLoading(false)
    }
  }

  // ══════════════════════════════════════════════════════════
  // Purchase Order: Edit
  // ══════════════════════════════════════════════════════════
  const openPoEdit = (po: PurchaseOrder) => {
    if (!po.items || po.items.length === 0) {
      toast.error('Tidak ada item untuk diedit')
      return
    }
    setPoEditId(po.id)
    setPoEditNotes(po.notes || '')
    // Convert existing items to PurchaseOrderItem format
    const editItems: PurchaseOrderItem[] = po.items.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      inventoryItemName: item.inventoryItem?.name || item.name || '',
      inventoryItemSku: item.inventoryItem?.sku || null,
      baseUnit: item.baseUnit,
      qty: String(item.purchaseQty),
      unit: item.purchaseUnit,
      // Derive baseQty: baseQty = totalBaseQty / purchaseQty if possible
      baseQty: item.purchaseQty > 0 ? String(item.baseQty / item.purchaseQty) : String(item.baseQty),
      // Derive pricePerItem: totalCost / purchaseQty
      pricePerItem: item.purchaseQty > 0 ? String(item.totalCost / item.purchaseQty) : String(item.unitCost * item.baseQty),
    }))
    setPoEditItems(editItems)
    setPoEditOpen(true)
    setPoDetailOpen(false)
    // Pre-load item options
    fetchPoItemOptions()
  }

  const handleUpdatePoEditItem = (idx: number, field: keyof PurchaseOrderItem, value: string) => {
    setPoEditItems(prev => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  }

  const handleRemovePoEditItem = (idx: number) => {
    if (poEditItems.length <= 1) return
    setPoEditItems(prev => prev.filter((_, i) => i !== idx))
  }

  const handleAddPoEditItem = () => {
    setPoEditItems(prev => [
      ...prev,
      { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' },
    ])
  }

  const poEditTotalCost = useMemo(() => {
    return poEditItems.reduce((sum, i) => {
      const qty = parseFloat(i.qty) || 0
      const price = parseFloat(i.pricePerItem) || 0
      return sum + (price * qty)
    }, 0)
  }, [poEditItems])

  const handlePoEditSubmit = async () => {
    if (!poEditId) return
    const validItems = poEditItems.filter(i => i.inventoryItemId)
    if (validItems.length === 0) {
      toast.error('Pilih minimal 1 item')
      return
    }
    for (let idx = 0; idx < poEditItems.length; idx++) {
      const i = poEditItems[idx]
      if (!i.inventoryItemId) continue
      const purchaseQty = parseFloat(i.qty) || 0
      const isiPerUnit = parseFloat(i.baseQty) || 0
      const pricePerItem = parseFloat(i.pricePerItem) || 0
      if (purchaseQty <= 0) {
        toast.error(`Item baris ${idx + 1}: jumlah harus lebih dari 0`)
        return
      }
      if (isiPerUnit <= 0) {
        toast.error(`Item baris ${idx + 1}: isi per unit harus lebih dari 0`)
        return
      }
      if (pricePerItem <= 0) {
        toast.error(`Item baris ${idx + 1}: harga harus lebih dari 0`)
        return
      }
    }
    setPoEditLoading(true)
    try {
      const res = await fetch(`/api/purchases/${poEditId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: poEditNotes || undefined,
          items: validItems.map(i => {
            const purchaseQty = parseFloat(i.qty) || 0
            const isiPerUnit = parseFloat(i.baseQty) || 0
            const pricePerItem = parseFloat(i.pricePerItem) || 0
            const totalCost = pricePerItem * purchaseQty
            const totalBaseQty = purchaseQty * isiPerUnit
            const unitCost = totalBaseQty > 0 ? totalCost / totalBaseQty : 0
            return {
              inventoryItemId: i.inventoryItemId,
              purchaseQty,
              purchaseUnit: i.unit || '',
              baseQty: totalBaseQty,
              baseUnit: i.baseUnit,
              unitCost,
              totalCost,
            }
          }),
        }),
      })
      if (res.ok) {
        toast.success('Pembelian berhasil diperbarui')
        setPoEditOpen(false)
        void fetchPurchaseOrders()
        void fetchInventoryItems()
        void fetchPurchaseSummary()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal mengedit pembelian')
      }
    } catch {
      toast.error('Gagal mengedit pembelian')
    } finally {
      setPoEditLoading(false)
    }
  }

  // ══════════════════════════════════════════════════════════
  // Purchase Order: Create
  // ══════════════════════════════════════════════════════════
  const handlePoCreateSubmit = async () => {
    const validItems = poCreateItems.filter(i => i.inventoryItemId)
    if (validItems.length === 0) {
      toast.error('Pilih minimal 1 item')
      return
    }
    // Frontend validation: check qty and baseQty
    for (let idx = 0; idx < poCreateItems.length; idx++) {
      const i = poCreateItems[idx]
      if (!i.inventoryItemId) continue
      const purchaseQty = parseFloat(i.qty) || 0
      const isiPerUnit = parseFloat(i.baseQty) || 0
      const pricePerItem = parseFloat(i.pricePerItem) || 0
      if (purchaseQty <= 0) {
        toast.error(`Item baris ${idx + 1}: jumlah harus lebih dari 0`)
        return
      }
      if (isiPerUnit <= 0) {
        toast.error(`Item baris ${idx + 1}: isi per unit harus lebih dari 0`)
        return
      }
      if (pricePerItem <= 0) {
        toast.error(`Item baris ${idx + 1}: harga harus lebih dari 0`)
        return
      }
    }

    // ── Step 1: Create any pending items in DB first ──
    const pendingItems = validItems.filter(i => i.inventoryItemId.startsWith('__pending_'))
    const idMap = new Map<string, string>() // tempId → realId

    if (pendingItems.length > 0) {
      setPoCreateLoading(true)
      toast.loading(`Membuat ${pendingItems.length} item baru di inventory...`, { id: 'pending-create' })
      for (const pItem of pendingItems) {
        // Find the option to get full details (sku, baseUnit)
        const opt = poItemOptions.find(o => o.id === pItem.inventoryItemId)
        try {
          const res = await fetch('/api/inventory/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: pItem.inventoryItemName,
              sku: opt?.sku || undefined,
              baseUnit: pItem.baseUnit,
              stock: 0,
              avgCost: 0,
            }),
          })
          if (res.ok) {
            const data = await res.json()
            idMap.set(pItem.inventoryItemId, data.id)
          } else {
            const err = await res.json()
            toast.error(err.error || `Gagal membuat item "${pItem.inventoryItemName}"`)
            toast.dismiss('pending-create')
            setPoCreateLoading(false)
            return
          }
        } catch {
          toast.error(`Gagal membuat item "${pItem.inventoryItemName}"`)
          toast.dismiss('pending-create')
          setPoCreateLoading(false)
          return
        }
      }
      toast.dismiss('pending-create')
    }

    // ── Step 2: Submit purchase with real IDs ──
    if (!pendingItems.length) setPoCreateLoading(true)
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: poCreateSupplierId || undefined,
          notes: poCreateNotes || undefined,
          items: validItems.map(i => {
            const purchaseQty = parseFloat(i.qty) || 0
            const isiPerUnit = parseFloat(i.baseQty) || 0
            const pricePerItem = parseFloat(i.pricePerItem) || 0
            const totalCost = pricePerItem * purchaseQty
            const totalBaseQty = purchaseQty * isiPerUnit
            const unitCost = totalBaseQty > 0 ? totalCost / totalBaseQty : 0
            return {
              inventoryItemId: idMap.get(i.inventoryItemId) || i.inventoryItemId,
              purchaseQty,
              purchaseUnit: i.unit || '',
              baseQty: totalBaseQty,
              baseUnit: i.baseUnit,
              unitCost,
              totalCost,
            }
          }),
        }),
      })
      if (res.ok) {
        toast.success('Pembelian berhasil dibuat')
        setPoCreateOpen(false)
        resetPoCreateForm()
        void fetchPurchaseOrders()
        void fetchInventoryItems()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal membuat pembelian')
        // Cleanup: delete orphaned pending items if PO creation failed
        if (idMap.size > 0) {
          for (const [, realId] of idMap) {
            try { await fetch(`/api/inventory/items/${realId}`, { method: 'DELETE' }) } catch { /* ignore cleanup errors */ }
          }
          toast.info(`${idMap.size} item baru dibatalkan karena pembelian gagal`)
        }
      }
    } catch {
      toast.error('Gagal membuat pembelian')
      // Cleanup: delete orphaned pending items on network error
      if (idMap.size > 0) {
        for (const [, realId] of idMap) {
          try { await fetch(`/api/inventory/items/${realId}`, { method: 'DELETE' }) } catch { /* ignore cleanup errors */ }
        }
      }
    } finally {
      setPoCreateLoading(false)
    }
  }

  const resetPoCreateForm = () => {
    setPoCreateNotes('')
    setPoCreateSupplierId('')
    setPoCreateItems([{ inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' }])
    setShowItemPicker(false)
    setActiveItemSearchIdx(null)
    setItemPickerFilter('')
    setShowQuickAddItem(false)
    setSmartInput('')
    smartInputScanDetectedRef.current = false
    smartInputCharCountRef.current = 0
    setScanModeActive(false)
    pendingCounterRef.current = 0
    setQuickAddQueue([])
    setQuickAddTargetIdx(0)
    setShowImportPreview(false)
    setImportPreviewData(null)
  }

  // Fetch suppliers for purchase dialog dropdown
  const fetchSuppliers = async () => {
    try {
      const res = await fetch('/api/suppliers')
      if (res.ok) {
        const data = await res.json()
        setSupplierOptions(data.suppliers || [])
      }
    } catch { /* silent */ }
  }

  // Open purchase create dialog with supplier fetch
  const openPoCreate = () => {
    setPoCreateOpen(true)
    void fetchSuppliers()
  }

  // Handle Excel file import
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportLoading(true)
    setShowImportPreview(true)
    setImportSupplierId('')
    void fetchSuppliers() // Pre-fetch suppliers for preview dialog
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/purchases/import-excel', {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        setImportPreviewData(data.items || [])
        if (data.items.length === 0) {
          toast.error('Tidak ada data yang bisa diproses dari file')
        }
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal membaca file')
        setShowImportPreview(false)
      }
    } catch {
      toast.error('Gagal mengupload file')
      setShowImportPreview(false)
    } finally {
      setImportLoading(false)
      // Reset file input
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }

  // Apply import preview items to purchase form
  const handleApplyImport = () => {
    if (!importPreviewData) return
    const newItems: PurchaseOrderItem[] = []
    const newOptions: InventoryItemOption[] = []
    importPreviewData.forEach((item, idx) => {
      if (item.error) return
      const itemId = item.matchedItemId || item.archivedItemId || `__pending_${item.name}_${item.sku || ''}_${idx}_${Date.now()}`
      newItems.push({
        inventoryItemId: itemId,
        inventoryItemName: item.name,
        inventoryItemSku: item.matchedItemSku || item.sku,
        baseUnit: item.baseUnit || item.matchedItemUnit || '',
        qty: String(item.qty || 1),
        unit: item.purchaseUnit || '',
        baseQty: String(item.baseQty || 1),
        pricePerItem: String(item.pricePerUnit || 0),
      })
      // Add new items to poItemOptions so pending creation works
      if (item.isNew && !item.matchedItemId && !item.isArchived) {
        newOptions.push({
          id: itemId,
          name: item.name,
          sku: item.sku || null,
          baseUnit: item.baseUnit || item.matchedItemUnit || 'pcs',
          stock: 0,
          active: true,
          _isNew: true,
        })
      }
    })
    if (newItems.length > 0) {
      if (newOptions.length > 0) {
        setPoItemOptions(prev => [...newOptions, ...prev])
      }
      setPoCreateItems(newItems)
      setShowImportPreview(false)
      setImportPreviewData(null)
      setPoCreateOpen(true)
      void fetchSuppliers()
      toast.success(`${newItems.length} item berhasil ditambahkan ke pembelian`)
    }
  }

  // Direct posting from import preview (creates new items + PO in one shot)
  const handleImportPost = async () => {
    if (!importPreviewData) return
    const validItems = importPreviewData.filter(i => !i.error)
    if (validItems.length === 0) return

    setImportPosting(true)
    const idMap = new Map<string, string>() // tempKey → real inventory item ID

    try {
      // Step 1: Restore archived items
      const archivedItems = validItems.filter(i => i.isArchived && i.archivedItemId)
      if (archivedItems.length > 0) {
        toast.loading(`Mengaktifkan kembali ${archivedItems.length} item nonaktif...`, { id: 'import-pending-restore' })
        for (const item of archivedItems) {
          try {
            const res = await fetch(`/api/inventory/items/${item.archivedItemId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'restore' }),
            })
            if (res.ok) {
              idMap.set(`import_row_${item.row}`, item.archivedItemId!)
            } else {
              const err = await res.json()
              toast.error(err.error || `Gagal mengaktifkan item "${item.name}"`)
              toast.dismiss('import-pending-restore')
              setImportPosting(false)
              return
            }
          } catch {
            toast.error(`Gagal mengaktifkan item "${item.name}"`)
            toast.dismiss('import-pending-restore')
            setImportPosting(false)
            return
          }
        }
        toast.dismiss('import-pending-restore')
        toast.success(`${archivedItems.length} item nonaktif berhasil diaktifkan kembali`)
      }

      // Step 2: Create new inventory items for unmatched items
      const newItems = validItems.filter(i => i.isNew && !i.matchedItemId && !i.isArchived)
      if (newItems.length > 0) {
        toast.loading(`Membuat ${newItems.length} item baru di inventory...`, { id: 'import-pending-create' })
        for (const item of newItems) {
          try {
            const res = await fetch('/api/inventory/items', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: item.name,
                sku: item.sku || undefined,
                baseUnit: item.baseUnit || item.matchedItemUnit || 'pcs',
                stock: 0,
                avgCost: 0,
              }),
            })
            if (res.ok) {
              const data = await res.json()
              idMap.set(`import_row_${item.row}`, data.id)
            } else {
              const err = await res.json()
              toast.error(err.error || `Gagal membuat item "${item.name}"`)
              toast.dismiss('import-pending-create')
              setImportPosting(false)
              return
            }
          } catch {
            toast.error(`Gagal membuat item "${item.name}"`)
            toast.dismiss('import-pending-create')
            setImportPosting(false)
            return
          }
        }
        toast.dismiss('import-pending-create')
      }

      // Step 2: Build purchase items and create PO
      const purchaseItems = validItems.map(item => {
        let itemId = item.matchedItemId || idMap.get(`import_row_${item.row}`) || ''
        const baseQtyVal = item.baseQty || 1
        const qtyVal = item.qty || 0
        const pricePerUnit = item.pricePerUnit || 0
        const totalCost = pricePerUnit * qtyVal
        const totalBaseQty = qtyVal * baseQtyVal
        const unitCost = totalBaseQty > 0 ? totalCost / totalBaseQty : 0

        return {
          inventoryItemId: itemId,
          purchaseQty: qtyVal,
          purchaseUnit: item.purchaseUnit || '',
          baseQty: totalBaseQty,
          baseUnit: item.baseUnit || item.matchedItemUnit || '',
          unitCost,
          totalCost,
        }
      })

      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: importSupplierId || undefined,
          items: purchaseItems,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success(`Pembelian berhasil dibuat! ${data.orderNumber} (${validItems.length} item, ${formatCurrency(data.totalCost)})`)
        setShowImportPreview(false)
        setImportPreviewData(null)
        setImportSupplierId('')
        void fetchPurchaseOrders()
        void fetchInventoryItems()
        void fetchPurchaseSummary()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal membuat pembelian')
        // Cleanup: delete orphaned new inventory items
        if (idMap.size > 0) {
          for (const [, realId] of idMap) {
            try { await fetch(`/api/inventory/items/${realId}`, { method: 'DELETE' }) } catch { /* ignore */ }
          }
          toast.info(`${idMap.size} item baru dibatalkan karena pembelian gagal`)
        }
      }
    } catch {
      toast.error('Gagal membuat pembelian')
      if (idMap.size > 0) {
        for (const [, realId] of idMap) {
          try { await fetch(`/api/inventory/items/${realId}`, { method: 'DELETE' }) } catch { /* ignore */ }
        }
      }
    } finally {
      setImportPosting(false)
    }
  }

  const handleAddPoItem = () => {
    setPoCreateItems(prev => [
      ...prev,
      { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' },
    ])
  }

  const handleRemovePoItem = (idx: number) => {
    if (poCreateItems.length <= 1) return
    setPoCreateItems(prev => prev.filter((_, i) => i !== idx))
  }

  const handleUpdatePoItem = (idx: number, field: keyof PurchaseOrderItem, value: string) => {
    setPoCreateItems(prev => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  }

  const handleSelectInvItem = (idx: number, item: InventoryItemOption) => {
    setPoCreateItems(prev => prev.map((it, i) =>
      i === idx
        ? { ...it, inventoryItemId: item.id, inventoryItemName: item.name, inventoryItemSku: item.sku, baseUnit: item.baseUnit }
        : it
    ))
    setShowItemPicker(false)
    setActiveItemSearchIdx(null)
    setItemPickerFilter('')
  }

  const handleSelectInvItemForEdit = (idx: number, item: InventoryItemOption) => {
    setPoEditItems(prev => prev.map((it, i) =>
      i === idx
        ? { ...it, inventoryItemId: item.id, inventoryItemName: item.name, inventoryItemSku: item.sku, baseUnit: item.baseUnit }
        : it
    ))
    setShowItemPicker(false)
    setActiveItemSearchIdx(null)
    setItemPickerFilter('')
  }

  // Quick add new inventory item from purchase dialog (PENDING — not saved to DB until Simpan)
  const handleQuickAddItem = (targetIdx: number) => {
    if (!quickItemName.trim()) {
      toast.error('Nama item wajib diisi')
      return
    }
    if (!quickItemSku.trim()) {
      toast.error('SKU wajib diisi untuk item baru')
      return
    }
    if (!quickItemUnit) {
      toast.error('Pilih satuan (base unit) untuk item baru')
      return
    }
    // Check duplicate SKU
    const duplicateSku = poItemOptions.find(i => i.sku && i.sku.toLowerCase() === quickItemSku.trim().toLowerCase())
    if (duplicateSku) {
      toast.error(`SKU "${quickItemSku.trim()}" sudah digunakan oleh "${duplicateSku.name}"`)
      return
    }
    pendingCounterRef.current++
    const tempId = `__pending_${pendingCounterRef.current}_${Date.now()}`
    const newItem: InventoryItemOption = {
      id: tempId,
      name: quickItemName.trim(),
      sku: quickItemSku.trim(),
      baseUnit: quickItemUnit,
      stock: 0,
      active: true,
      _isNew: true,
    }
    setPoItemOptions(prev => [newItem, ...prev])
    handleSelectInvItem(targetIdx, newItem)

    // Check if there are more items in queue (batch smart input)
    const remaining = quickAddQueue.length > 1 ? quickAddQueue.slice(1) : []
    if (remaining.length > 0) {
      // Advance queue: load next name
      setQuickAddQueue(remaining)
      setQuickItemName(remaining[0])
      setQuickItemSku('')
      setQuickItemUnit('')
      // Find next empty slot or add new row
      const nextEmpty = poCreateItems.findIndex(i => !i.inventoryItemId)
      if (nextEmpty >= 0) {
        setQuickAddTargetIdx(nextEmpty)
      } else {
        setPoCreateItems(prev => [...prev, { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' }])
        setQuickAddTargetIdx(poCreateItems.length)
      }
      toast.success(`Item "${newItem.name}" ditambahkan — lanjut ${remaining.length} item lagi`)
    } else {
      // Queue empty — close form
      setShowQuickAddItem(false)
      setQuickItemName('')
      setQuickItemSku('')
      setQuickItemUnit('')
      setQuickAddQueue([])
      toast.success('Item baru ditambahkan (pending)')
    }
  }

  // ── Smart Input: Scan detection (timing-based like POS) ──
  // Barcode scanner = hardware yang kirim karakter satu-satu sangat cepat (< 80ms per char)
  // Paste / ketik manual = TIDAK dianggap scan, user tekan Enter sendiri
  const handleSmartInputChange = (value: string) => {
    const now = Date.now()
    const prevLen = smartInput.length

    if (prevLen < value.length) {
      const charsAdded = value.length - prevLen
      if (charsAdded === 1) {
        // Satu karakter ditambahkan — cek apakah kecepatannya kayak barcode scanner
        const timeSince = now - smartInputLastCharTimeRef.current
        if (timeSince > 0 && timeSince < 80) {
          smartInputCharCountRef.current++
          if (smartInputCharCountRef.current >= 4) {
            smartInputScanDetectedRef.current = true
          }
        } else {
          smartInputCharCountRef.current = 1
          smartInputScanDetectedRef.current = false
        }
      }
      // Paste (charsAdded > 1) — JANGAN anggap scan.
      // Biarkan user tekan Enter. Paste "Kopi Susu" atau "SMAHS7127" sama-sama treated sebagai text.
    } else {
      smartInputCharCountRef.current = 0
      smartInputScanDetectedRef.current = false
    }

    smartInputLastCharTimeRef.current = now
    setSmartInput(value)
  }

  // Auto-process barcode scan (no Enter needed) — scans one item at a time
  useEffect(() => {
    if (!smartInputScanDetectedRef.current || !smartInput.trim()) return
    const query = smartInput.trim().toLowerCase()

    // Only auto-process if no comma/semicolon (pure scan, not multi-text)
    if (query.includes(',') || query.includes(';') || query.includes('\n')) return

    // Try exact SKU match (skip pending items — they have no real DB SKU)
    const skuMatch = poItemOptions.find(i => !i._isNew && i.sku && i.sku.toLowerCase() === query)
    if (skuMatch) {
      // Check if already in items list → increment qty
      const existingIdx = poCreateItems.findIndex(i => i.inventoryItemId === skuMatch.id)
      if (existingIdx >= 0) {
        const currentQty = parseFloat(poCreateItems[existingIdx].qty) || 0
        handleUpdatePoItem(existingIdx, 'qty', String(currentQty + 1))
        toast.success(`${skuMatch.name} qty +1 (scan)`)
      } else {
        // Find first empty slot or append
        const emptyIdx = poCreateItems.findIndex(i => !i.inventoryItemId)
        if (emptyIdx >= 0) {
          handleSelectInvItem(emptyIdx, skuMatch)
        } else {
          setPoCreateItems(prev => [...prev, { inventoryItemId: skuMatch.id, inventoryItemName: skuMatch.name, inventoryItemSku: skuMatch.sku, baseUnit: skuMatch.baseUnit, qty: '1', unit: '', baseQty: '0', pricePerItem: '0' }])
        }
        toast.success(`${skuMatch.name} ditambahkan (scan)`)
      }
      setSmartInput('')
      smartInputScanDetectedRef.current = false
      smartInputCharCountRef.current = 0
      // Re-focus for next scan
      setTimeout(() => smartInputRef.current?.focus(), 50)
      return
    }

    // No match — flash warning, let user handle manually
    setScanModeActive(true)
    toast.warning(`SKU "${smartInput.trim()}" tidak ditemukan`)
    setSmartInput('')
    smartInputScanDetectedRef.current = false
    smartInputCharCountRef.current = 0
    setTimeout(() => smartInputRef.current?.focus(), 50)
    const timer = setTimeout(() => setScanModeActive(false), 1500)
    return () => clearTimeout(timer)
  }, [smartInput, poItemOptions])

  // Smart input: Enter key — parse comma-separated names and create item rows
  const handleSmartInputSubmit = () => {
    const text = smartInput.trim()
    if (!text) return

    // Reset scan state
    smartInputScanDetectedRef.current = false
    smartInputCharCountRef.current = 0

    // Split by comma, semicolon, or newline
    const names = text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
    if (names.length === 0) return

    // ── Single item mode ──
    if (names.length === 1) {
      const query = names[0].toLowerCase()
      // Try exact SKU match first
      const skuMatch = poItemOptions.find(i => i.sku && i.sku.toLowerCase() === query)
      if (skuMatch) {
        const existingIdx = poCreateItems.findIndex(i => i.inventoryItemId === skuMatch.id)
        if (existingIdx >= 0) {
          const currentQty = parseFloat(poCreateItems[existingIdx].qty) || 0
          handleUpdatePoItem(existingIdx, 'qty', String(currentQty + 1))
        } else {
          const emptyIdx = poCreateItems.findIndex(i => !i.inventoryItemId)
          if (emptyIdx >= 0) {
            handleSelectInvItem(emptyIdx, skuMatch)
          } else {
            setPoCreateItems(prev => [...prev, { inventoryItemId: skuMatch.id, inventoryItemName: skuMatch.name, inventoryItemSku: skuMatch.sku, baseUnit: skuMatch.baseUnit, qty: '1', unit: '', baseQty: '0', pricePerItem: '0' }])
          }
        }
        setSmartInput('')
        toast.success(`${skuMatch.name} ditambahkan`)
        return
      }

      // Try exact name match
      const nameMatch = poItemOptions.find(i => i.name.toLowerCase() === query)
      if (nameMatch) {
        const existingIdx = poCreateItems.findIndex(i => i.inventoryItemId === nameMatch.id)
        if (existingIdx >= 0) {
          const currentQty = parseFloat(poCreateItems[existingIdx].qty) || 0
          handleUpdatePoItem(existingIdx, 'qty', String(currentQty + 1))
        } else {
          const emptyIdx = poCreateItems.findIndex(i => !i.inventoryItemId)
          if (emptyIdx >= 0) {
            handleSelectInvItem(emptyIdx, nameMatch)
          } else {
            setPoCreateItems(prev => [...prev, { inventoryItemId: nameMatch.id, inventoryItemName: nameMatch.name, inventoryItemSku: nameMatch.sku, baseUnit: nameMatch.baseUnit, qty: '1', unit: '', baseQty: '0', pricePerItem: '0' }])
          }
        }
        setSmartInput('')
        toast.success(`${nameMatch.name} ditambahkan`)
        return
      }

      // Single item not found — open Quick Add form so user must set SKU + unit
      setSmartInput('')
      const emptyIdx = poCreateItems.findIndex(i => !i.inventoryItemId)
      const targetIdx = emptyIdx >= 0 ? emptyIdx : poCreateItems.length
      if (emptyIdx < 0) {
        setPoCreateItems(prev => [...prev, { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' }])
      }
      setQuickAddTargetIdx(targetIdx)
      setQuickAddQueue([names[0]])
      setQuickItemName(names[0])
      setQuickItemSku('')
      setQuickItemUnit('')
      setShowQuickAddItem(true)
      toast.info(`Item "${names[0]}" belum ada — isi SKU & satuan`)
      return
    }

    // ── Batch mode: auto-match existing, queue unmatched for Quick Add ──
    setSmartInput('')

    const matchedItems: PurchaseOrderItem[] = []
    const unmatchedNames: string[] = []

    for (const name of names) {
      const query = name.toLowerCase()
      // Skip if already added (duplicate in same batch)
      if (matchedItems.some(i => i.inventoryItemName.toLowerCase() === query) || unmatchedNames.some(n => n.toLowerCase() === query)) continue

      const matched = poItemOptions.find(i => i.sku && i.sku.toLowerCase() === query)
        || poItemOptions.find(i => i.name.toLowerCase() === query)
      if (matched) {
        matchedItems.push({ inventoryItemId: matched.id, inventoryItemName: matched.name, inventoryItemSku: matched.sku, baseUnit: matched.baseUnit, qty: '1', unit: '', baseQty: '0', pricePerItem: '0' })
      } else {
        unmatchedNames.push(name)
      }
    }

    // Add matched items immediately (they already have SKU & unit)
    if (matchedItems.length > 0) {
      const emptySlots = poCreateItems.filter(i => !i.inventoryItemId).length
      if (emptySlots >= matchedItems.length) {
        let slotIdx = 0
        setPoCreateItems(prev => prev.map(item => {
          if (!item.inventoryItemId && slotIdx < matchedItems.length) {
            const newItem = matchedItems[slotIdx]
            slotIdx++
            return newItem
          }
          return item
        }))
      } else {
        setPoCreateItems(prev => [...prev.filter(i => i.inventoryItemId), ...matchedItems])
      }
    }

    // Unmatched items → open Quick Add form with queue
    if (unmatchedNames.length > 0) {
      const targetIdx = poCreateItems.findIndex(i => !i.inventoryItemId)
      const actualTarget = targetIdx >= 0 ? targetIdx : poCreateItems.length
      if (targetIdx < 0) {
        setPoCreateItems(prev => [...prev, { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' }])
      }
      setQuickAddTargetIdx(actualTarget)
      setQuickAddQueue(unmatchedNames)
      setQuickItemName(unmatchedNames[0])
      setQuickItemSku('')
      setQuickItemUnit('')
      setShowQuickAddItem(true)
      if (matchedItems.length > 0) {
        toast.info(`${matchedItems.length} item cocok ditambahkan — isi SKU & satuan untuk ${unmatchedNames.length} item baru`)
      } else {
        toast.info(`${unmatchedNames.length} item baru — isi SKU & satuan satu per satu`)
      }
    } else {
      toast.success(`${matchedItems.length} item cocok dan ditambahkan`)
    }
  }

  const poTotalCost = useMemo(() => {
    return poCreateItems.reduce((sum, i) => {
      const qty = parseFloat(i.qty) || 0
      const price = parseFloat(i.pricePerItem) || 0
      return sum + (price * qty)
    }, 0)
  }, [poCreateItems])

  // ══════════════════════════════════════════════════════════
  // Purchase Order: Delete
  // ══════════════════════════════════════════════════════════
  const handleDeletePo = async () => {
    if (!deletePoId) return
    setDeletingPo(true)
    try {
      const res = await fetch(`/api/purchases/${deletePoId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Pembelian berhasil dihapus')
        setDeletePoId(null)
        setPoDetailOpen(false)
        void fetchPurchaseOrders()
        void fetchInventoryItems()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menghapus pembelian')
      }
    } catch {
      toast.error('Gagal menghapus pembelian')
    } finally {
      setDeletingPo(false)
    }
  }

  // ══════════════════════════════════════════════════════════
  // Inventory Item CRUD
  // ══════════════════════════════════════════════════════════
  const openInvForm = (item?: InventoryItem) => {
    if (item) {
      setInvFormEdit(item)
      setInvFormName(item.name)
      setInvFormSku(item.sku || '')
      setInvFormBaseUnit(item.baseUnit)
      setInvFormCategory(item.categoryId || '')
      setInvFormLowStock(String(item.lowStockAlert))
      setInvFormInitialStock('')
      setInvFormAvgCost('')
    } else {
      setInvFormEdit(null)
      setInvFormName('')
      setInvFormSku('')
      setInvFormBaseUnit('kg')
      setInvFormCategory('')
      setInvFormLowStock('0')
      setInvFormInitialStock('')
      setInvFormAvgCost('')
    }
    setInvFormOpen(true)
  }

  const handleInvFormSubmit = async () => {
    if (!invFormName.trim()) {
      toast.error('Nama item wajib diisi')
      return
    }
    setInvFormLoading(true)
    try {
      const isEdit = !!invFormEdit
      const url = isEdit ? `/api/inventory/items/${invFormEdit!.id}` : '/api/inventory/items'
      const method = isEdit ? 'PUT' : 'POST'
      const catId = invFormCategory && invFormCategory !== '__none__' ? invFormCategory : undefined
      const body: Record<string, unknown> = {
        name: invFormName,
        sku: invFormSku || undefined,
        baseUnit: invFormBaseUnit,
        categoryId: catId,
        lowStockAlert: parseFloat(invFormLowStock) || 0,
      }
      if (!isEdit) {
        body.stock = parseFloat(invFormInitialStock) || 0
        body.avgCost = parseFloat(invFormAvgCost) || 0
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        toast.success(isEdit ? 'Item berhasil diperbarui' : 'Item berhasil ditambahkan')
        setInvFormOpen(false)
        void fetchInventoryItems()
        void fetchCategories()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menyimpan item')
      }
    } catch {
      toast.error('Gagal menyimpan item')
    } finally {
      setInvFormLoading(false)
    }
  }

  const handleDeleteInv = async () => {
    if (!deleteInvId) return
    setArchivingInv(true)
    try {
      const res = await fetch(`/api/inventory/items/${deleteInvId}`, { method: 'DELETE' })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data.blocked) {
          setInvDeleteBlocked({
            blockType: data.blockType || 'hasHistory',
            message: data.message,
            blockers: data.blockers || [],
            suggestion: data.suggestion,
            linkedProducts: data.linkedProducts || [],
          })
        } else {
          toast.success('Item berhasil dihapus')
          setDeleteInvId(null)
          setInvDeleteBlocked(null)
          void fetchInventoryItems()
        }
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Gagal menghapus item')
      }
    } catch {
      toast.error('Gagal menghapus item')
    } finally {
      setArchivingInv(false)
    }
  }

  const handleArchiveInv = async (id: string) => {
    setArchivingInv(true)
    try {
      const res = await fetch(`/api/inventory/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive' }),
      })
      if (res.ok) {
        toast.success('Item dinonaktifkan')
        setDeleteInvId(null)
        setInvDeleteBlocked(null)
        void fetchInventoryItems()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Gagal menonaktifkan item')
      }
    } catch {
      toast.error('Gagal menonaktifkan item')
    } finally {
      setArchivingInv(false)
    }
  }

  const handleRestoreInv = async (id: string) => {
    setArchivingInv(true)
    try {
      const res = await fetch(`/api/inventory/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore' }),
      })
      if (res.ok) {
        toast.success('Item diaktifkan kembali')
        void fetchInventoryItems()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Gagal mengaktifkan item')
      }
    } catch {
      toast.error('Gagal mengaktifkan item')
    } finally {
      setArchivingInv(false)
    }
  }



  // ══════════════════════════════════════════════════════════
  // Inventory Detail
  // ══════════════════════════════════════════════════════════
  const openInvDetail = async (item: InventoryItem) => {
    setInvDetailOpen(true)
    setInvDetailData(null)
    setInvDetailError(null)
    setInvDetailLoading(true)
    setInvDetailTab('products')
    setInvDetailMovementPage(1)
    try {
      const res = await fetch(`/api/inventory/items/${item.id}?page=1`)
      if (res.ok) {
        const data = await res.json()
        setInvDetailData(data)
      } else {
        const data = await res.json().catch(() => ({}))
        setInvDetailError(data.error || 'Gagal memuat detail item')
      }
    } catch {
      setInvDetailError('Gagal memuat detail item')
    } finally {
      setInvDetailLoading(false)
    }
  }

  const fetchInvDetailMovements = async (itemId: string, page: number) => {
    if (!invDetailData) return
    try {
      const res = await fetch(`/api/inventory/items/${itemId}?page=${page}`)
      if (res.ok) {
        const data = await res.json()
        setInvDetailData((prev) => prev ? { ...prev, movements: data.movements, movementPagination: data.movementPagination } : null)
      }
    } catch { /* ignore pagination fetch errors */ }
  }

  // ══════════════════════════════════════════════════════════
  // Category CRUD
  // ══════════════════════════════════════════════════════════
  const handleCategorySubmit = async () => {
    if (!catFormName.trim()) {
      toast.error('Nama kategori wajib diisi')
      return
    }
    setCatFormLoading(true)
    try {
      const res = await fetch('/api/inventory/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: catFormName, color: catFormColor }),
      })
      if (res.ok) {
        toast.success('Kategori berhasil ditambahkan')
        setCatFormName('')
        void fetchCategories()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menambahkan kategori')
      }
    } catch {
      toast.error('Gagal menambahkan kategori')
    } finally {
      setCatFormLoading(false)
    }
  }

  const handleDeleteCategory = async () => {
    if (!deleteCatId) return
    setDeletingCat(true)
    try {
      const res = await fetch(`/api/inventory/categories/${deleteCatId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Kategori berhasil dihapus')
        setDeleteCatId(null)
        if (invCategoryFilter === deleteCatId) setInvCategoryFilter('all')
        void fetchCategories()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menghapus kategori')
      }
    } catch {
      toast.error('Gagal menghapus kategori')
    } finally {
      setDeletingCat(false)
    }
  }

  // ══════════════════════════════════════════════════════════
  // Post as Product: handlers
  // ══════════════════════════════════════════════════════════
  const selectedInvItems = useMemo(() => {
    return invList.filter(i => selectedInvIds.has(i.id))
  }, [invList, selectedInvIds])

  // Auto HPP from composition = sum(qty × avgCost)
  const postEstimatedHpp = useMemo(() => {
    return selectedInvItems.reduce((sum, i) => {
      const qty = parseFloat(postCompQty[i.id]) || 0
      return sum + (qty * i.avgCost)
    }, 0)
  }, [selectedInvItems, postCompQty])

  // Max possible stock = min(inventoryStock / compQty) across all items
  const postMaxStock = useMemo(() => {
    let maxUnits = Infinity
    for (const item of selectedInvItems) {
      const compQty = parseFloat(postCompQty[item.id]) || 0
      if (compQty <= 0) continue
      const possible = Math.floor(item.stock / compQty)
      if (possible < maxUnits) maxUnits = possible
    }
    return maxUnits
  }, [selectedInvItems, postCompQty])

  // Per-variant HPP calculation
  const getVariantHpp = (variantIndex: number): number => {
    const compQtyMap = postVariantCompQty[variantIndex] || {}
    return selectedInvItems.reduce((sum, i) => {
      const qty = parseFloat(compQtyMap[i.id]) || 0
      return sum + (qty * i.avgCost)
    }, 0)
  }

  // Per-variant max stock
  const getVariantMaxStock = (variantIndex: number): number => {
    const compQtyMap = postVariantCompQty[variantIndex] || {}
    let maxUnits = Infinity
    for (const item of selectedInvItems) {
      const compQty = parseFloat(compQtyMap[item.id]) || 0
      if (compQty <= 0) continue
      const possible = Math.floor(item.stock / compQty)
      if (possible < maxUnits) maxUnits = possible
    }
    return maxUnits
  }

  const resetPostProductForm = () => {
    setPostMode('select')
    setPostStep(1)
    setPostProductName('')
    setPostProductPrice('')
    setPostProductCategory('')
    setPostProductUnit('pcs')
    setPostHasVariants(false)
    setPostProductSubmitting(false)
    setSelectedInvIds(new Set())
    setPostCompQty({})
    setPostVariants([])
    setPostVariantCompQty({})
    setRetailPrices({})
    setRetailQtyPerProduct({})
    setRetailBulkPrice('')
    setRetailUseBulkPrice(true)
    setRetailCategory('')
    setRetailSubmitting(false)
  }

  const handlePostProductSubmit = async () => {
    if (!postProductName.trim() || !postProductPrice) return
    setPostProductSubmitting(true)
    try {
      const selectedItems = invList.filter(i => selectedInvIds.has(i.id))
      const productPayload: Record<string, unknown> = {
        name: postProductName.trim(),
        price: parseFloat(postProductPrice) || 0,
        hpp: postEstimatedHpp,
        categoryId: postProductCategory || undefined,
        unit: postProductUnit,
        hasComposition: true,
      }

      if (postHasVariants && postVariants.length > 0) {
        productPayload.hasVariants = true
        // Auto-calculate stock per variant from composition
        const variantStocks = postVariants.map((_, vi) => {
          const ms = getVariantMaxStock(vi)
          return ms === Infinity ? 0 : ms
        })
        productPayload.variants = postVariants.map((v, vi) => ({
          name: v.name,
          price: parseFloat(v.price) || parseFloat(postProductPrice) || 0,
          hpp: getVariantHpp(vi),
          stock: variantStocks[vi],
        }))
        // Parent stock = sum of all variant stocks
        productPayload.stock = variantStocks.reduce((s, v) => s + v, 0)
      } else {
        // Non-variant: auto stock from composition
        productPayload.stock = postMaxStock === Infinity ? 0 : postMaxStock
      }

      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productPayload),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Gagal membuat produk')
        return
      }

      const product = await res.json()

      // Set composition via API
      if (postHasVariants && postVariants.length > 0 && product.variants) {
        const variantCompositions: Record<string, Array<{ inventoryItemId: string; qty: number; baseUnit: string }>> = {}
        for (let vi = 0; vi < product.variants.length; vi++) {
          const variant = product.variants[vi]
          const compQtyMap = postVariantCompQty[vi] || postCompQty
          variantCompositions[variant.id] = selectedItems.map(item => ({
            inventoryItemId: item.id,
            qty: parseFloat(compQtyMap[item.id]) || parseFloat(postCompQty[item.id]) || 0,
            baseUnit: item.baseUnit,
          }))
        }
        await fetch(`/api/products/${product.id}/composition`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hasComposition: true, variantCompositions }),
        })
      } else {
        await fetch(`/api/products/${product.id}/composition`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hasComposition: true,
            compositions: selectedItems.map(item => ({
              inventoryItemId: item.id,
              qty: parseFloat(postCompQty[item.id]) || 0,
              baseUnit: item.baseUnit,
            })),
          }),
        })
      }

      toast.success(`Produk "${postProductName}" berhasil dibuat dari ${selectedItems.length} item`)
      setPostProductOpen(false)
      resetPostProductForm()
      void fetchInventoryItems()
    } catch {
      toast.error('Gagal membuat produk')
    } finally {
      setPostProductSubmitting(false)
    }
  }

  // Retail mode submit: each inventory item → 1 product with 1:1 composition
  const handleRetailSubmit = async () => {
    if (retailUseBulkPrice && !retailBulkPrice) {
      toast.error('Isi harga jual bulk atau aktifkan harga per item')
      return
    }
    setRetailSubmitting(true)
    const items = invList.filter(i => selectedInvIds.has(i.id))
    let created = 0
    let failed = 0

    for (const item of items) {
      const price = retailUseBulkPrice
        ? (parseFloat(retailBulkPrice) || 0)
        : (parseFloat(retailPrices[item.id]) || 0)
      if (price <= 0) { failed++; continue }

      const compQty = parseFloat(retailQtyPerProduct[item.id]) || 1
      const hpp = compQty * item.avgCost
      const maxStock = compQty > 0 ? Math.floor(item.stock / compQty) : 0

      try {
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.name,
            price,
            hpp,
            stock: maxStock,
            unit: item.baseUnit,
            categoryId: retailCategory || undefined,
            hasComposition: true,
          }),
        })
        if (!res.ok) { failed++; continue }
        const product = await res.json()

        // Set 1:1 composition
        await fetch(`/api/products/${product.id}/composition`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hasComposition: true,
            compositions: [{ inventoryItemId: item.id, qty: compQty, baseUnit: item.baseUnit }],
          }),
        })
        created++
      } catch {
        failed++
      }
    }

    if (created > 0) {
      toast.success(`${created} produk berhasil dibuat dari ${items.length} item${failed > 0 ? ` (${failed} gagal)` : ''}`)
      setPostProductOpen(false)
      resetPostProductForm()
      void fetchInventoryItems()
    } else {
      toast.error(`Gagal membuat semua produk (${failed} gagal)`)
    }
    setRetailSubmitting(false)
  }

  // Toggle inventory item selection
  const toggleInvSelect = (id: string) => {
    const next = new Set(selectedInvIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedInvIds(next)
  }

  const toggleSelectAllInv = () => {
    if (invList.every(i => selectedInvIds.has(i.id))) {
      setSelectedInvIds(new Set())
    } else {
      setSelectedInvIds(new Set(invList.map(i => i.id)))
    }
  }

  // ══════════════════════════════════════════════════════════
  // Render helpers
  // ══════════════════════════════════════════════════════════

  const inputClass = 'bg-white/[0.04] border-white/[0.04] text-white text-xs h-9 rounded-lg placeholder:text-slate-500'
  const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium'

  // ══════════════════════════════════════════════════════════
  // Loading skeleton
  // ══════════════════════════════════════════════════════════
  if (poLoading && tab === 'purchase') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-56 bg-white/[0.04]" />
        <Skeleton className="h-10 w-full bg-nebula rounded-lg" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 bg-nebula rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (invLoading && tab === 'inventory') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-56 bg-white/[0.04]" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 bg-nebula rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-10 w-full bg-nebula rounded-lg" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 bg-nebula rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <motion.div className="space-y-4" variants={containerVariants} initial="hidden" animate="visible">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 theme-text" />
            Purchase &amp; Inventory
          </h1>
          <p className="text-sm text-slate-500">Kelola pembelian stok item dan inventory</p>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div variants={itemVariants}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-white/[0.04] border border-white/[0.06] h-9 p-0.5 rounded-lg">
            <TabsTrigger
              value="purchase"
              className="text-xs font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 px-3 gap-1.5"
            >
              <ShoppingCart className="h-3 w-3" />
              Pembelian
            </TabsTrigger>
            <TabsTrigger
              value="inventory"
              className="text-xs font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 px-3 gap-1.5"
            >
              <PackagePlus className="h-3 w-3" />
              Inventory Items
            </TabsTrigger>
          </TabsList>

          {/* ══════════════════════════════════════════════════════ */}
          {/* TAB 1: PEMBELIAN                                     */}
          {/* ══════════════════════════════════════════════════════ */}
          <TabsContent value="purchase" className="mt-4 space-y-4">
            {/* Top bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <Input
                  value={poSearch}
                  onChange={(e) => { setPoSearch(e.target.value); setPoPage(1) }}
                  placeholder="Cari No. PO..."
                  className={cn(inputClass, 'pl-8')}
                />
              </div>
              <Button
                size="sm"
                onClick={() => { resetPoCreateForm(); openPoCreate() }}
                className="theme-bg theme-hover text-white text-xs font-medium h-8 px-3 rounded-lg gap-1.5 shrink-0 w-full sm:w-auto"
              >
                <Plus className="h-3.5 w-3.5" />
                Buat Pembelian
              </Button>
            </div>

            {/* Compact Summary Row */}
            {purchaseSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                  <p className="text-[10px] text-slate-500 mb-1">Total Pembelian</p>
                  <p className="text-sm font-bold text-white">{formatCurrency(purchaseSummary.totalPurchaseNominal)}</p>
                  <p className="text-[10px] text-slate-600">{purchaseSummary.totalPurchaseCount} transaksi</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                  <p className="text-[10px] text-slate-500 mb-1">Nilai Inventory</p>
                  <p className="text-sm font-bold text-white">{formatCurrency(purchaseSummary.totalInventoryNominal)}</p>
                  <p className="text-[10px] text-slate-600">{purchaseSummary.totalInventoryItems} jenis item</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                  <p className="text-[10px] text-slate-500 mb-1">Rasio Bulan Ini</p>
                  <p className={cn('text-sm font-bold', purchaseSummary.monthRatio > 70 ? 'text-amber-400' : 'text-emerald-400')}>{purchaseSummary.monthRatio}%</p>
                  <p className="text-[10px] text-slate-600">pembelian / revenue</p>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                  <p className="text-[10px] text-slate-500 mb-1">Rasio Total</p>
                  <p className={cn('text-sm font-bold', purchaseSummary.overallRatio > 70 ? 'text-amber-400' : 'text-emerald-400')}>{purchaseSummary.overallRatio}%</p>
                  <p className="text-[10px] text-slate-600">pembelian / revenue</p>
                </div>
              </div>
            )}

            {/* Panduan Alur Pembelian */}
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
              <button
                className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-white/[0.02] transition-colors"
                onClick={() => setShowPurchaseGuide(prev => !prev)}
              >
                <div className="flex items-center gap-2">
                  <Info className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span className="text-[11px] text-slate-400 font-medium">Panduan Pembelian & Inventory</span>
                </div>
                <ChevronDown className={cn('h-3 w-3 text-slate-600 transition-transform duration-200', showPurchaseGuide && 'rotate-180')} />
              </button>
              {showPurchaseGuide && (
                <div className="px-3 pb-3 space-y-3 border-t border-white/[0.04] pt-3">
                  {/* Step 1 */}
                  <div className="flex gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">1</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium mb-0.5">Tambah Item ke Pembelian</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Klik <span className="text-white bg-white/[0.06] px-1 py-0.5 rounded text-[9px] font-mono">Buat Pembelian</span> lalu gunakan input bar untuk mencari item. Ketik nama item, scan barcode, atau pisahkan beberapa item dengan <span className="text-white bg-white/[0.06] px-1 py-0.5 rounded text-[9px] font-mono">koma</span>.
                      </p>
                    </div>
                  </div>
                  {/* Step 2 */}
                  <div className="flex gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">2</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium mb-0.5">Item Baru? Isi SKU &amp; Satuan</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Jika item <span className="text-amber-400">belum ada di inventory</span>, form akan muncul otomatis. Kamu <span className="text-white">wajib isi SKU</span> (kode unik) dan <span className="text-white">pilih satuan</span> (kg, gr, ml, liter, pcs, dll). Item ini berstatus <span className="text-amber-400">pending</span> — belum tersimpan sampai pembelian disimpan.
                      </p>
                    </div>
                  </div>
                  {/* Step 3 */}
                  <div className="flex gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">3</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium mb-0.5">Isi Detail Pembelian</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Untuk tiap item, isi:
                      </p>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-2 py-1.5">
                          <p className="text-[9px] text-slate-600 uppercase tracking-wider">Satuan Beli</p>
                          <p className="text-[10px] text-slate-400">Cth: <span className="text-white">sak</span>, <span className="text-white">ekor</span>, <span className="text-white">karung</span></p>
                        </div>
                        <div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-2 py-1.5">
                          <p className="text-[9px] text-slate-600 uppercase tracking-wider">Jumlah</p>
                          <p className="text-[10px] text-slate-400">Berapa <span className="text-white">satuan beli</span> yang dibeli</p>
                        </div>
                        <div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-2 py-1.5">
                          <p className="text-[9px] text-slate-600 uppercase tracking-wider">Isi / Unit</p>
                          <p className="text-[10px] text-slate-400">Isi per 1 satuan beli (dalam <span className="text-white">base unit</span>)</p>
                        </div>
                        <div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-2 py-1.5">
                          <p className="text-[9px] text-slate-600 uppercase tracking-wider">Harga / Unit</p>
                          <p className="text-[10px] text-slate-400">Harga per 1 <span className="text-white">satuan beli</span> (Rp)</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Step 4 */}
                  <div className="flex gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">4</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium mb-0.5">Simpan &amp; Stok Otomatis Masuk</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Klik <span className="text-white bg-white/[0.06] px-1 py-0.5 rounded text-[9px] font-mono">Simpan Pembelian</span>. Stok otomatis bertambah dan <span className="text-white">HPP dihitung otomatis</span>.
                      </p>
                      <div className="mt-1.5 rounded-md bg-amber-500/[0.04] border border-amber-500/10 px-2.5 py-2">
                        <p className="text-[10px] text-amber-400/80 font-medium mb-0.5">📐 Rumus HPP</p>
                        <p className="text-[10px] text-slate-500 font-mono">HPP = Harga per Satuan Beli ÷ Isi per Unit</p>
                        <p className="text-[10px] text-slate-600 mt-1">Cth: Beli 1 sak @ Rp90.000, isi 25kg → HPP = Rp90.000 ÷ 25 = <span className="text-amber-400">Rp3.600/kg</span></p>
                      </div>
                    </div>
                  </div>
                  {/* Tips */}
                  <div className="rounded-md bg-white/[0.02] border border-white/[0.04] px-2.5 py-2">
                    <p className="text-[10px] text-slate-600 mb-1 font-medium uppercase tracking-wider">Tips</p>
                    <ul className="text-[10px] text-slate-500 space-y-0.5">
                      <li>• Scan barcode langsung dari input bar — tidak perlu tekan Enter</li>
                      <li>• Ketik beberapa nama pisah <span className="text-white">koma</span> untuk tambah banyak item sekaligus</li>
                      <li>• Item baru muncul dengan badge <span className="text-amber-400">Baru</span> — bisa di-ganti sebelum simpan</li>
                      <li>• Pembelian yang sudah terkait produk tidak bisa dihapus</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block">
              <Card className="bg-nebula border-white/[0.06] overflow-hidden rounded-xl">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/[0.06] hover:bg-transparent">
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">No. PO</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Supplier</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Tanggal</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Jumlah Item</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Total Biaya</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poList.length === 0 ? (
                      <TableRow className="border-white/[0.04] hover:bg-transparent">
                        <TableCell colSpan={6} className="text-center py-16">
                          <div className="flex flex-col items-center">
                            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-3">
                              <ShoppingCart className="h-6 w-6 text-slate-600" />
                            </div>
                            <p className="text-sm text-slate-400 mb-1">Belum ada pembelian</p>
                            <p className="text-xs text-slate-600 mb-4">Catat pembelian pertama untuk mulai melacak stok</p>
                            <Button
                              size="sm"
                              onClick={() => { resetPoCreateForm(); openPoCreate() }}
                              className="theme-bg theme-hover text-white text-xs h-8 px-4 rounded-lg gap-1.5"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Buat Pembelian
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      poList.map((po) => (
                        <TableRow key={po.id} className="border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                          <TableCell className="text-xs text-slate-200 font-medium font-mono">{po.orderNumber}</TableCell>
                          <TableCell className="text-xs text-slate-400">{po.supplierName || '-'}</TableCell>
                          <TableCell className="text-xs text-slate-400">{formatDate(po.createdAt)}</TableCell>
                          <TableCell className="text-xs text-slate-300 text-right">{po.itemCount ?? po._count?.items ?? 0}</TableCell>
                          <TableCell className="text-xs text-emerald-400 text-right font-medium">{formatCurrency(po.totalCost)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                                onClick={() => openPoDetail(po)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                                onClick={() => openPoEdit(po)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {session?.user?.role === 'OWNER' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className={cn("h-7 px-2 hover:text-red-300 hover:bg-red-500/[0.06]", po.hasLinkedItems ? "opacity-50 cursor-not-allowed text-red-400/50" : "text-red-400")}
                                onClick={() => setDeletePoId(po.id)}
                                disabled={po.hasLinkedItems}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-2">
              {poList.length === 0 ? (
                <Card className="bg-nebula border-white/[0.06] rounded-xl">
                  <CardContent className="py-12 text-center">
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-3">
                        <ShoppingCart className="h-6 w-6 text-slate-600" />
                      </div>
                      <p className="text-sm text-slate-400 mb-1">Belum ada pembelian</p>
                      <p className="text-xs text-slate-600 mb-4">Catat pembelian pertama untuk mulai melacak stok</p>
                      <Button
                        size="sm"
                        onClick={() => { resetPoCreateForm(); openPoCreate() }}
                        className="theme-bg theme-hover text-white text-xs h-8 px-4 rounded-lg gap-1.5"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Buat Pembelian
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <AnimatePresence>
                  {poList.map((po) => (
                    <motion.div
                      key={po.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Card className="bg-nebula border-white/[0.06] rounded-xl hover:border-white/[0.1] transition-colors">
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-white font-medium font-mono truncate">{po.orderNumber}</span>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <span className="text-[11px] text-emerald-400 font-medium mr-1">{formatCurrency(po.totalCost)}</span>
                              <button
                                className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
                                onClick={() => openPoDetail(po)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button
                                className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
                                onClick={() => openPoEdit(po)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {session?.user?.role === 'OWNER' && (
                              <button
                                className={cn(
                                  "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
                                  po.hasLinkedItems
                                    ? "text-red-400/30 cursor-not-allowed"
                                    : "text-slate-500 hover:text-red-400 hover:bg-red-500/[0.06]"
                                )}
                                onClick={() => !po.hasLinkedItems && setDeletePoId(po.id)}
                                disabled={po.hasLinkedItems}
                                title={po.hasLinkedItems ? 'Item terkait produk — tidak bisa dihapus' : 'Hapus'}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[11px]">{po.supplierName || '-'}</span>
                            <span className="text-[11px]">{formatDate(po.createdAt)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <Package className="h-3 w-3" />
                            <span className="text-[11px]">{po.itemCount ?? po._count?.items ?? 0} item</span>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Pagination */}
            <Pagination currentPage={poPage} totalPages={poTotalPages} onPageChange={setPoPage} />
          </TabsContent>

          {/* ══════════════════════════════════════════════════════ */}
          {/* TAB 2: INVENTORY ITEMS                                */}
          {/* ══════════════════════════════════════════════════════ */}
          <TabsContent value="inventory" className="mt-4 space-y-4">
            {/* Top bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <Input
                  value={invSearch}
                  onChange={(e) => { setInvSearch(e.target.value); setInvPage(1) }}
                  placeholder="Cari item..."
                  className={cn(inputClass, 'pl-8')}
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-[10px] gap-1 text-slate-400 hover:text-white hover:bg-white/[0.04] border border-white/[0.06] shrink-0"
                  onClick={() => setCategoryDialogOpen(true)}
                >
                  <Tags className="h-3 w-3" />
                  <span className="hidden sm:inline">Kategori</span>
                </Button>
                <Select value={invCategoryFilter} onValueChange={(v) => { setInvCategoryFilter(v); setInvPage(1) }}>
                  <SelectTrigger className="bg-white/[0.04] border-white/[0.06] text-white text-xs h-8 w-[120px] rounded-lg">
                    <SelectValue placeholder="Semua" />
                  </SelectTrigger>
                  <SelectContent className="bg-nebula border-white/[0.06]">
                    <SelectItem value="all" className="text-slate-200 text-xs">Semua Kategori</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-slate-200 text-xs">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 text-[10px] gap-1 border shrink-0',
                    showInactiveItems
                      ? 'text-amber-400 hover:text-amber-300 bg-amber-500/[0.06] border-amber-500/20'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border-white/[0.06]',
                  )}
                  onClick={() => { setShowInactiveItems(!showInactiveItems); setInvPage(1) }}
                >
                  <Archive className="h-3 w-3" />
                  <span className="hidden sm:inline">{showInactiveItems ? 'Sembunyikan Nonaktif' : 'Tampilkan Nonaktif'}</span>
                </Button>
                {selectedInvIds.size > 0 && (
                  <Button
                    size="sm"
                    onClick={() => { setPostStep(1); setPostProductOpen(true); void fetchProductCategories() }}
                    className="theme-bg theme-hover text-white text-xs font-medium h-8 px-3 rounded-lg gap-1.5 shrink-0"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Post Produk</span>
                    <span className="sm:hidden">Post</span>
                    <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-[10px]">{selectedInvIds.size}</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Compact Stats Row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                <p className="text-[10px] text-slate-500 mb-0.5">Total Item</p>
                <p className="text-sm font-bold text-white">{formatNumber(invStats.totalItems)}</p>
              </div>
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                <p className="text-[10px] text-slate-500 mb-0.5">Total Nilai</p>
                <p className="text-sm font-bold text-white">{formatCurrency(invStats.totalValue)}</p>
              </div>
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                <p className="text-[10px] text-slate-500 mb-0.5">Stok Rendah</p>
                <p className={cn('text-sm font-bold', invStats.lowStockCount > 0 ? 'text-amber-400' : 'text-white')}>{formatNumber(invStats.lowStockCount)}</p>
              </div>
            </div>

            {/* Panduan Alur Inventory */}
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
              <button
                className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-white/[0.02] transition-colors"
                onClick={() => setShowInventoryGuide(prev => !prev)}
              >
                <div className="flex items-center gap-2">
                  <Info className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span className="text-[11px] text-slate-400 font-medium">Panduan Inventory &amp; Produk</span>
                </div>
                <ChevronDown className={cn('h-3 w-3 text-slate-600 transition-transform duration-200', showInventoryGuide && 'rotate-180')} />
              </button>
              {showInventoryGuide && (
                <div className="px-3 pb-3 space-y-3 border-t border-white/[0.04] pt-3">
                  {/* Apa itu Inventory Item */}
                  <div className="flex gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Package className="h-2.5 w-2.5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium mb-0.5">Apa itu Inventory Item?</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Inventory item adalah <span className="text-white">bahan baku atau stok toko</span> yang kamu beli dari supplier. Setiap item punya <span className="text-white">SKU</span> (kode unik), <span className="text-white">base unit</span> (satuan dasar: kg, gr, ml, pcs), <span className="text-white">stok</span>, dan <span className="text-white">HPP</span> (Harga Pokok Penjualan).
                      </p>
                    </div>
                  </div>
                  {/* Cara Stok Masuk */}
                  <div className="flex gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">1</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium mb-0.5">Cara Stok Masuk</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Stok bertambah otomatis saat kamu <span className="text-emerald-400">menyimpan pembelian</span> di tab Pembelian. HPP dihitung otomatis dari rata-rata harga beli. Semua item baru akan otomatis tercatat di inventory saat pembelian disimpan.
                      </p>
                    </div>
                  </div>
                  {/* Post ke Produk */}
                  <div className="flex gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">2</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium mb-0.5">Post ke Produk Jual</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed mb-1.5">
                        Inventory item bisa dijadikan <span className="text-white">produk jual</span> dengan memilih item → klik <span className="text-white bg-white/[0.06] px-1 py-0.5 rounded text-[9px] font-mono">Post Produk</span>. Ada 2 mode:
                      </p>
                      <div className="space-y-1.5">
                        <div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-2.5 py-1.5">
                          <p className="text-[10px] text-white font-medium">🍳 Komposisi (F&amp;B)</p>
                          <p className="text-[10px] text-slate-500">Beberapa item inventory → <span className="text-slate-300">1 produk</span>. Cth: Tepung 200gr + Gula 50gr + Telur 2pcs → Kue Bolu</p>
                        </div>
                        <div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-2.5 py-1.5">
                          <p className="text-[10px] text-white font-medium">🛒 Satu-satu (Ritel)</p>
                          <p className="text-[10px] text-slate-500">1 item inventory → <span className="text-slate-300">1 produk</span> langsung. Cth: Susu UHT 1L → produk Susu UHT 1L dengan harga jual sendiri</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Kategori */}
                  <div className="flex gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">3</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium mb-0.5">Kategori &amp; Low Stock Alert</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Gunakan <span className="text-white">Kategori</span> untuk mengelompokkan item (Bahan Pokok, Minuman, Bumbu, dll). Set <span className="text-white">Low Stock Alert</span> agar item yang stoknya menipis ditandai <span className="text-red-400">merah</span> di tabel.
                      </p>
                    </div>
                  </div>
                  {/* Catatan */}
                  <div className="rounded-md bg-white/[0.02] border border-white/[0.04] px-2.5 py-2">
                    <p className="text-[10px] text-slate-600 mb-1 font-medium uppercase tracking-wider">Catatan Penting</p>
                    <ul className="text-[10px] text-slate-500 space-y-0.5">
                      <li>• Kolom <span className="text-white">Digunakan</span> menunjukkan berapa komposisi produk yang memakai item ini</li>
                      <li>• Item yang sudah dipakai di komposisi <span className="text-amber-400">tidak bisa dihapus</span> (harus hapus komposisi dulu)</li>
                      <li>• HPP selalu dihitung otomatis dari pembelian — tidak bisa di-edit manual</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Selection action bar */}
            {selectedInvIds.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/10"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-slate-300 font-medium">
                    <span className="text-emerald-400">{selectedInvIds.size}</span> item terpilih
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
                    onClick={() => setSelectedInvIds(new Set())}
                  >
                    Batal
                  </button>
                  <Button
                    size="sm"
                    onClick={() => { setPostStep(1); setPostProductOpen(true); void fetchProductCategories() }}
                    className="h-7 text-[11px] theme-bg theme-hover text-white px-3 gap-1.5 rounded-lg"
                  >
                    <Sparkles className="h-3 w-3" />
                    Post Produk
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Desktop Table */}
            <div className="hidden md:block">
              <Card className="bg-nebula border-white/[0.06] overflow-hidden rounded-xl">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/[0.06] hover:bg-transparent">
                      <TableHead className="w-10">
                        <Checkbox
                          checked={invList.length > 0 && invList.every(i => selectedInvIds.has(i.id)) ? true : invList.length > 0 ? 'indeterminate' : false}
                          onCheckedChange={() => toggleSelectAllInv()}
                          className="h-4 w-4"
                        />
                      </TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider min-w-[200px]">Nama</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider w-[120px]">Kategori</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right w-[130px]">Stok</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right w-[140px]">HPP Satuan</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right w-[140px]">Total Nilai</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right w-[80px]">Digunakan</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right w-[80px]">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invList.length === 0 ? (
                      <TableRow className="border-white/[0.04] hover:bg-transparent">
                        <TableCell colSpan={8} className="text-center py-16">
                          <div className="flex flex-col items-center">
                            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-3">
                              <PackagePlus className="h-6 w-6 text-slate-600" />
                            </div>
                            <p className="text-sm text-slate-400 mb-1">Belum ada item inventory</p>
                            <p className="text-xs text-slate-600 mb-4">Buat pembelian pertama untuk menambah item ke inventory</p>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => { resetPoCreateForm(); openPoCreate() }}
                                className="theme-bg theme-hover text-white text-xs h-8 px-4 rounded-lg gap-1.5"
                              >
                                <ShoppingCart className="h-3.5 w-3.5" />
                                Buat Pembelian
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      invList.map((item) => {
                        const isLow = item.stock <= item.lowStockAlert
                        const isSelected = selectedInvIds.has(item.id)
                        const colorClasses = item.category ? getCategoryColorClasses(item.category.color) : null
                        return (
                          <TableRow key={item.id} className={cn(
                            'border-white/[0.04] hover:bg-transparent',
                            isSelected && 'bg-emerald-500/[0.04]',
                            item.status === 'ARCHIVED' && 'opacity-50',
                          )}>
                            <TableCell>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleInvSelect(item.id)}
                                className="h-4 w-4"
                              />
                            </TableCell>
                            <TableCell className="text-xs text-slate-200 font-medium">
                              <div className="flex items-center gap-1.5">
                                {item.name}
                                {item.status === 'ARCHIVED' && (
                                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-amber-500/15 text-amber-400 border-amber-500/20">Nonaktif</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {item.category && colorClasses ? (
                                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 leading-none border font-medium', colorClasses.bg, colorClasses.text, colorClasses.border)}>
                                  {item.category.name}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-slate-500">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right font-medium">
                              <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-md tabular-nums', isLow ? 'text-red-400' : 'text-slate-200')}>
                                {formatNumber(item.stock)}
                                <span className="text-slate-500 font-normal">{item.baseUnit}</span>
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-slate-400 text-right">{formatCurrency(item.avgCost)}/{item.baseUnit}</TableCell>
                            <TableCell className="text-xs text-emerald-400 text-right font-medium">{formatCurrency(item.stock * item.avgCost)}</TableCell>
                            <TableCell className="text-xs text-slate-400 text-right">{item._count?.compositions ?? 0}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                                  onClick={() => openInvDetail(item)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                                  onClick={() => openInvForm(item)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={cn(
                                    'h-7 px-2',
                                    item.status === 'ARCHIVED'
                                      ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/[0.06]'
                                      : 'text-slate-400 hover:text-red-400 hover:bg-red-500/[0.06]',
                                  )}
                                  onClick={() => {
                                    if (item.status === 'ARCHIVED') {
                                      handleRestoreInv(item.id)
                                    } else {
                                      setDeleteInvId(item.id)
                                    }
                                  }}
                                >
                                  {item.status === 'ARCHIVED' ? (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-2">
              {invList.length === 0 ? (
                <Card className="bg-nebula border-white/[0.06]">
                  <CardContent className="py-12 text-center">
                    <div className="flex flex-col items-center">
                      <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-3">
                        <PackagePlus className="h-6 w-6 text-slate-600" />
                      </div>
                      <p className="text-sm text-slate-400 mb-1">Belum ada item inventory</p>
                      <p className="text-xs text-slate-600 mb-4">Buat pembelian pertama untuk menambah item ke inventory</p>
                      <Button
                        size="sm"
                        onClick={() => { resetPoCreateForm(); openPoCreate() }}
                        className="theme-bg theme-hover text-white text-xs h-8 px-4 rounded-lg gap-1.5"
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                        Buat Pembelian
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <AnimatePresence>
                  {invList.map((item) => {
                    const isLow = item.stock <= item.lowStockAlert
                    const isSelected = selectedInvIds.has(item.id)
                    const colorClasses = item.category ? getCategoryColorClasses(item.category.color) : null
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Card className={cn('bg-nebula border-white/[0.06] transition-all', isSelected && 'border-emerald-500/40 ring-1 ring-emerald-500/10')}>
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2 min-w-0">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleInvSelect(item.id)}
                                  className="h-4 w-4 mt-0.5 shrink-0"
                                />
                                <div className="min-w-0">
                                  <p className="text-xs text-slate-200 font-medium truncate">{item.name}</p>
                                  {item.category && colorClasses && (
                                    <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 leading-none border font-medium mt-1', colorClasses.bg, colorClasses.text, colorClasses.border)}>
                                      {item.category.name}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <span
                                className={cn(
                                  'flex items-center gap-1 px-2.5 py-1.5 rounded-lg tabular-nums shrink-0',
                                  isLow ? 'text-red-400' : 'text-white'
                                )}
                              >
                                <span className="font-bold">{formatNumber(item.stock)}</span>
                                <span className="text-[10px] text-slate-400 font-normal">{item.baseUnit}</span>
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-500">
                              <span className="text-[11px]">HPP: {formatCurrency(item.avgCost)}/{item.baseUnit}</span>
                              <span className="text-[11px] text-emerald-400 font-medium">{formatCurrency(item.stock * item.avgCost)}</span>
                            </div>
                            <div className="flex items-center gap-1 pt-1 border-t border-white/[0.04]">
                              <Button
                                size="sm"
                                className="flex-1 h-7 text-[10px] gap-1 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                                onClick={() => openInvDetail(item)}
                              >
                                <Eye className="h-3 w-3" />
                                Detail
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                                onClick={() => openInvForm(item)}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                className={cn(
                                  'h-7 px-2',
                                  item.status === 'ARCHIVED'
                                    ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/[0.06]'
                                    : 'text-slate-400 hover:text-red-400 hover:bg-red-500/[0.06]',
                                )}
                                onClick={() => {
                                  if (item.status === 'ARCHIVED') {
                                    handleRestoreInv(item.id)
                                  } else {
                                    setDeleteInvId(item.id)
                                  }
                                }}
                              >
                                {item.status === 'ARCHIVED' ? (
                                  <RotateCcw className="h-3 w-3" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              )}
            </div>

            {/* Pagination */}
            <Pagination currentPage={invPage} totalPages={invTotalPages} onPageChange={setInvPage} />
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* DIALOGS                                                      */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* ── Purchase Order Detail Dialog ── */}
      <ResponsiveDialog open={poDetailOpen} onOpenChange={setPoDetailOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">Detail Pembelian</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              {poDetailData?.orderNumber || '-'}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {poDetailLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-10 bg-white/[0.04] rounded-xl" />
              <Skeleton className="h-20 bg-white/[0.04] rounded-xl" />
              <Skeleton className="h-10 bg-white/[0.04] rounded-xl" />
            </div>
          ) : poDetailError ? (
            <div className="py-8 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-400/60 mx-auto mb-2" />
              <p className="text-xs text-slate-400">{poDetailError}</p>
              <Button
                size="sm"
                variant="ghost"
                className="mt-3 h-8 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
                onClick={() => { setPoDetailOpen(false) }}
              >
                Tutup
              </Button>
            </div>
          ) : poDetailData ? (
            <div className="space-y-4 mt-2">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Tanggal</p>
                  <p className="text-xs text-slate-200 font-medium">{formatDate(poDetailData.createdAt)}</p>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Dibuat Oleh</p>
                  <p className="text-xs text-slate-200 font-medium">{poDetailData.createdBy?.name || poDetailData.createdByName || session?.user?.name || 'Admin'}</p>
                </div>
              </div>

              {/* Supplier info card */}
              {poDetailData.supplier && (
                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04] space-y-1.5">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Supplier</p>
                  <p className="text-xs text-slate-200 font-medium">{poDetailData.supplier.name}</p>
                  {poDetailData.supplier.phone && (
                    <p className="text-[11px] text-slate-400">{poDetailData.supplier.phone}</p>
                  )}
                </div>
              )}

              {poDetailData.notes && (
                <div className="flex items-start gap-2 text-slate-400">
                  <span className="text-[10px] text-slate-500 shrink-0">Catatan:</span>
                  <span className="text-xs">{poDetailData.notes}</span>
                </div>
              )}

              {/* Items */}
              <div>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-2">
                  Daftar Item ({poDetailData.items?.length || 0})
                </p>
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                  {poDetailData.items && poDetailData.items.length > 0 ? (
                    poDetailData.items.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                      >
                        <span className="w-5 h-5 rounded-md bg-white/[0.06] flex items-center justify-center text-[10px] text-slate-500 font-medium shrink-0">{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-200 font-medium truncate">{item.inventoryItem?.name || item.name || 'Item dihapus'}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-slate-500">
                              {formatNumber(item.purchaseQty)} {item.purchaseUnit || '-'} = {formatNumber(item.baseQty)} {item.baseUnit || '-'}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-white font-medium">{formatCurrency(item.totalCost)}</p>
                          <p className="text-[10px] text-amber-400/70">{formatCurrency(item.unitCost)}/{item.baseUnit || '-'}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 text-center py-4">Tidak ada item</p>
                  )}
                </div>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                <span className="text-xs text-slate-400">Total Biaya</span>
                <span className="text-sm font-bold text-emerald-400">{formatCurrency(poDetailData.totalCost)}</span>
              </div>

              {/* Updated timestamp */}
              {poDetailData.updatedAt && poDetailData.updatedAt !== poDetailData.createdAt && (
                <p className="text-[10px] text-slate-600 text-center">
                  Diperbarui: {formatDate(poDetailData.updatedAt)}
                </p>
              )}

              {/* Actions — Owner only */}
              {session?.user?.role === 'OWNER' && (
              <div>
                <div className="flex gap-2 pt-2 border-t border-white/[0.04]">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 h-8 text-xs gap-1.5 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                    onClick={() => { openPoEdit(poDetailData!) }}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "flex-1 h-8 text-xs gap-1.5",
                      poDetailHasLinked
                        ? "text-red-400/40 cursor-not-allowed"
                        : "text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                    )}
                    onClick={() => { if (!poDetailHasLinked) setDeletePoId(poDetailData!.id) }}
                    disabled={poDetailHasLinked}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Hapus
                  </Button>
                </div>
                {poDetailHasLinked && (
                  <p className="text-[10px] text-amber-400/70 text-center -mt-1">
                    ⚠ Item terkait produk — hapus pembelian bisa mengubah komposisi
                  </p>
                )}
              </div>
              )}
            </div>
          ) : null}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Create Purchase Order Dialog (Redesigned) ── */}
      <ResponsiveDialog
        open={poCreateOpen}
        onOpenChange={(open) => {
          if (!open) resetPoCreateForm()
          setPoCreateOpen(open)
        }}
      >
        <ResponsiveDialogContent className="sm:max-w-2xl flex flex-col max-h-[90vh]">
          {/* ── Rich Header with Purpose ── */}
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl theme-bg-ultra-light flex items-center justify-center">
                <ShoppingCart className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <span>Catat Pembelian Stok</span>
                <p className="text-[11px] text-slate-500 font-normal mt-0.5 leading-snug">
                  Catat barang yang kamu beli dari supplier. Stok &amp; HPP otomatis terupdate di inventory.
                </p>
              </div>
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <div className="space-y-4 mt-1 flex-1 overflow-y-auto">

            {/* ══════════════════════════════════════════════════════ */}
            {/* STEP-BY-STEP GUIDE (collapsible)                      */}
            {/* ══════════════════════════════════════════════════════ */}
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
                onClick={() => setShowPurchaseDialogGuide(prev => !prev)}
              >
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Info className="h-3 w-3 text-emerald-400" />
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">Panduan 3 Langkah</span>
                </div>
                <ChevronDown className={cn('h-3.5 w-3.5 text-slate-600 transition-transform duration-200', showPurchaseDialogGuide && 'rotate-180')} />
              </button>

              {showPurchaseDialogGuide && (
                <div className="px-3.5 pb-3.5 space-y-2.5 border-t border-white/[0.04] pt-3">
                  {/* Step 1 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">1</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium">Cari atau ketik nama barang</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Ketik nama item di kolom pencarian. Jika barang <span className="text-amber-400">belum ada</span>, sistem akan otomatis meminta SKU dan satuan — item baru langsung tercatat saat pembelian disimpan.
                      </p>
                    </div>
                  </div>
                  {/* Step 2 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">2</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium">Isi detail pembelian tiap item</p>
                      <div className="text-[10px] text-slate-500 leading-relaxed mt-0.5 space-y-1">
                        <div className="flex items-start gap-1.5">
                          <span className="text-emerald-400/60 shrink-0">•</span>
                          <span><span className="text-white font-medium">Satuan Beli</span> — Cara supplier menjual (cth: sak, karung, dus, ekor)</span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <span className="text-emerald-400/60 shrink-0">•</span>
                          <span><span className="text-white font-medium">Jumlah</span> — Berapa satuan beli yang dipesan (cth: 5 sak)</span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <span className="text-emerald-400/60 shrink-0">•</span>
                          <span><span className="text-white font-medium">Isi per Satuan</span> — Isi dalam satuan dasar (cth: 1 sak = 25 kg)</span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <span className="text-emerald-400/60 shrink-0">•</span>
                          <span><span className="text-white font-medium">Harga per Satuan Beli</span> — Harga dari supplier per satuan beli (cth: Rp320.000/sak)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Step 3 */}
                  <div className="flex gap-2.5">
                    <div className="w-5 h-5 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[9px] text-emerald-400 font-bold">3</span>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-300 font-medium">Klik "Simpan Pembelian"</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Stok otomatis bertambah di inventory. HPP (Harga Pokok) dihitung rata-rata dari semua pembelian. Item baru otomatis tercatat.
                      </p>
                    </div>
                  </div>
                  {/* Quick example */}
                  <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] px-3 py-2.5">
                    <p className="text-[10px] text-slate-500 font-medium mb-1.5">💡 Contoh: Beli Tepung Segitiga</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                      <div className="flex items-center justify-between text-slate-500">
                        <span>Satuan Beli</span>
                        <span className="text-white font-mono">sak</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-500">
                        <span>Jumlah</span>
                        <span className="text-white font-mono">10</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-500">
                        <span>Isi per sak</span>
                        <span className="text-white font-mono">25 kg</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-500">
                        <span>Harga/sak</span>
                        <span className="text-white font-mono">Rp320.000</span>
                      </div>
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-white/[0.04] text-[10px] text-slate-500 space-y-0.5">
                      <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span className="text-slate-300 font-medium">Rp3.200.000</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Stok masuk</span>
                        <span className="text-emerald-400 font-medium">250 kg</span>
                      </div>
                      <div className="flex justify-between">
                        <span>HPP otomatis</span>
                        <span className="text-amber-400 font-medium">Rp12.800/kg</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ══════════════════════════════════════════════════════ */}
            {/* CATATAN                                                  */}
            {/* ══════════════════════════════════════════════════════ */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3 w-3 text-slate-500" />
                <label className="text-[11px] text-slate-300 font-medium">Catatan Pembelian</label>
                <span className="text-[10px] text-slate-600">(opsional)</span>
              </div>
              <Textarea
                value={poCreateNotes}
                onChange={(e) => setPoCreateNotes(e.target.value)}
                placeholder="Cth: Bayar tempo 7 hari, dari PT Bogasari, invoice #INV-001..."
                className="bg-white/[0.04] border-white/[0.04] text-white text-xs min-h-[40px] rounded-lg resize-none placeholder:text-slate-500"
              />
            </div>

            {/* ══════════════════════════════════════════════════════ */}
            {/* SUPPLIER                                                 */}
            {/* ══════════════════════════════════════════════════════ */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Package className="h-3 w-3 text-slate-500" />
                <label className="text-[11px] text-slate-300 font-medium">Supplier</label>
                <span className="text-[10px] text-slate-600">(opsional)</span>
              </div>
              <div className="flex gap-2">
                <Select
                  value={poCreateSupplierId}
                  onValueChange={setPoCreateSupplierId}
                >
                  <SelectTrigger className="flex-1 bg-white/[0.04] border-white/[0.04] text-white text-xs h-9">
                    <SelectValue placeholder="Pilih supplier..." />
                  </SelectTrigger>
                  <SelectContent>
                    {supplierOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {poCreateSupplierId && (
                  <button
                    className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.04] flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0"
                    onClick={() => setPoCreateSupplierId('')}
                    title="Hapus supplier"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <Separator className="bg-white/[0.06]" />

            {/* ══════════════════════════════════════════════════════ */}
            {/* DAFTAR ITEM                                              */}
            {/* ══════════════════════════════════════════════════════ */}
            <div className="space-y-3">
              {/* ── Section Label ── */}
              <div className="flex items-center gap-2">
                <Package className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[11px] text-slate-400 font-medium">Daftar Barang yang Dibeli</span>
              </div>

              {/* ── Smart Input Bar ── */}
              <div className="relative">
                <ScanBarcode className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                <input
                  ref={smartInputRef}
                  value={smartInput}
                  onChange={(e) => handleSmartInputChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSmartInputSubmit() }}
                  placeholder="Ketik nama barang / scan barcode — pisahkan dengan koma: Gula, Tepung, Minyak"
                  className={cn(inputClass, 'pl-8 pr-2 h-9')}
                />
              </div>

              {/* ── Import / Paste Actions ── */}
              <div className="flex gap-2">
                <input
                  ref={(el) => { importFileRef.current = el }}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleImportExcel}
                />
                <button
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/[0.04] border border-white/[0.04] text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors text-[11px]"
                  onClick={() => importFileRef.current?.click()}
                  disabled={importLoading}
                >
                  {importLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  )}
                  {importLoading ? 'Membaca...' : 'Import Excel / CSV'}
                </button>
                <button
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.04] text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors text-[11px]"
                  onClick={() => {
                    const a = document.createElement('a')
                    a.href = '/api/purchases/import-excel/template'
                    a.download = 'template-pembelian-aether-pos.xlsx'
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                  }}
                  title="Download template Excel untuk import pembelian"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.04] text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors text-[11px]"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText()
                      if (text && text.includes('\t')) {
                        // Tab-separated = likely Excel paste
                        const lines = text.trim().split('\n').filter(l => l.trim())
                        const items = lines.map(line => {
                          const cols = line.split('\t').map(c => c.trim())
                          return cols.join(', ')
                        }).filter(Boolean).join(', ')
                        if (items) {
                          setSmartInput(items)
                          toast.info(`${lines.length} baris dari clipboard — tekan Enter untuk proses`)
                        }
                      } else if (text) {
                        setSmartInput(text)
                        toast.info('Data dari clipboard — tekan Enter untuk proses')
                      }
                    } catch {
                      toast.error('Gagal membaca clipboard')
                    }
                  }}
                  title="Tempel dari Excel / spreadsheet"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* ── Quick Add Inline Form (for new items from smart input) ── */}
              {showQuickAddItem && (
                <div className="rounded-xl bg-amber-500/[0.04] border border-amber-500/10 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-amber-500/10 flex items-center justify-center">
                        <PackageOpen className="h-3 w-3 text-amber-400" />
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-300 font-medium">Registrasi Barang Baru</span>
                        <p className="text-[10px] text-slate-500 mt-0.5">Barang belum ada di inventory — isi data untuk membuat baru</p>
                      </div>
                    </div>
                    <button
                      className="w-6 h-6 rounded-md hover:bg-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                      onClick={() => { setShowQuickAddItem(false); setQuickAddQueue([]); setQuickItemName(''); setQuickItemSku(''); setQuickItemUnit('') }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {/* Queue indicator */}
                  {quickAddQueue.length > 1 && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-500/[0.06] border border-amber-500/10">
                      <Activity className="h-3 w-3 text-amber-400 shrink-0" />
                      <span className="text-[10px] text-amber-300 font-medium">
                        Item {quickAddQueue.indexOf(quickItemName) + 1} dari {quickAddQueue.length} yang perlu didaftarkan
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {/* Nama item */}
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">Nama Barang <span className="text-amber-400">*</span></label>
                      <input
                        autoFocus
                        value={quickItemName}
                        onChange={(e) => setQuickItemName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAddItem(quickAddTargetIdx) }}
                        placeholder="cth: Tepung Segitiga Biru"
                        className="w-full bg-white/[0.04] border border-white/[0.08] text-white text-xs h-8 rounded-lg px-2.5 outline-none focus:border-emerald-500/40 placeholder:text-slate-500"
                      />
                    </div>
                    {/* SKU */}
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">SKU (Kode Unik) <span className="text-amber-400">*</span></label>
                      <input
                        value={quickItemSku}
                        onChange={(e) => setQuickItemSku(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAddItem(quickAddTargetIdx) }}
                        placeholder="cth: TP-SGB-001"
                        className="w-full bg-white/[0.04] border border-white/[0.08] text-white text-xs h-8 rounded-lg px-2.5 outline-none focus:border-emerald-500/40 placeholder:text-slate-500 font-mono"
                      />
                    </div>
                    {/* Satuan (Base Unit) */}
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">Satuan Dasar <span className="text-amber-400">*</span></label>
                      <Select value={quickItemUnit} onValueChange={setQuickItemUnit}>
                        <SelectTrigger className="h-8 text-xs bg-white/[0.04] border-white/[0.08] text-white rounded-lg px-2.5">
                          <SelectValue placeholder="Pilih satuan..." />
                        </SelectTrigger>
                        <SelectContent className="bg-nebula border-white/[0.06]">
                          {BASE_UNIT_OPTIONS.map((u) => (
                            <SelectItem key={u} value={u} className="text-slate-200 text-xs">{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <button
                    className="w-full h-8 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    onClick={() => handleQuickAddItem(quickAddTargetIdx)}
                    disabled={!quickItemName.trim() || !quickItemSku.trim() || !quickItemUnit}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    {quickAddQueue.length > 1 ? 'Daftarkan & Lanjut ke Berikutnya' : 'Daftarkan & Tambahkan ke Pembelian'}
                  </button>
                  {/* Skip button for queue */}
                  {quickAddQueue.length > 1 && (
                    <button
                      className="w-full h-7 rounded-lg text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
                      onClick={() => {
                        const remaining = quickAddQueue.slice(1)
                        if (remaining.length > 0) {
                          setQuickAddQueue(remaining)
                          setQuickItemName(remaining[0])
                          setQuickItemSku('')
                          setQuickItemUnit('')
                          const nextEmpty = poCreateItems.findIndex(i => !i.inventoryItemId)
                          if (nextEmpty >= 0) {
                            setQuickAddTargetIdx(nextEmpty)
                          } else {
                            setPoCreateItems(prev => [...prev, { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' }])
                            setQuickAddTargetIdx(poCreateItems.length)
                          }
                        } else {
                          setShowQuickAddItem(false)
                          setQuickAddQueue([])
                        }
                      }}
                    >
                      Lewati item ini
                    </button>
                  )}
                </div>
              )}

              {/* ── Item Count Badge ── */}
              {poCreateItems.length > 1 && (
                <div className="flex items-center gap-2">
                  <Package className="h-3 w-3 text-slate-500" />
                  <span className="text-[11px] text-slate-400 font-medium">
                    <span className="text-emerald-400">{poCreateItems.filter(i => i.inventoryItemId).length}</span> dari {poCreateItems.length} item sudah dipilih
                  </span>
                </div>
              )}

              {/* ── Item Rows ── */}
              <div className="space-y-2.5">
                {poCreateItems.map((item, idx) => (
                  <div
                    key={idx}
                    id={`po-item-${idx}`}
                    className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] space-y-2.5"
                  >
                    {/* Item picker / selected display */}
                    <div className="relative" ref={(el) => { invItemSearchRefs.current[idx] = el }}>
                      {item.inventoryItemId ? (
                        <div className={cn(
                          "flex items-center gap-2 rounded-lg px-2.5 h-9 border",
                          item.inventoryItemId.startsWith('__pending_')
                            ? "bg-amber-500/[0.06] border-amber-500/10"
                            : "bg-emerald-500/[0.06] border-emerald-500/10"
                        )}>
                          <CheckCircle2 className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            item.inventoryItemId.startsWith('__pending_') ? "text-amber-400" : "text-emerald-400"
                          )} />
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className={cn(
                              "text-xs truncate font-medium",
                              item.inventoryItemId.startsWith('__pending_') ? "text-amber-300" : "text-emerald-300"
                            )}>{item.inventoryItemName}</span>
                            {item.inventoryItemId.startsWith('__pending_') && (
                              <span className="text-[9px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded font-medium shrink-0">Baru</span>
                            )}
                            {item.inventoryItemSku && (
                              <span className="text-[10px] text-emerald-400/50 bg-emerald-500/10 px-1 py-0.5 rounded font-mono shrink-0">{item.inventoryItemSku}</span>
                            )}
                          </div>
                          {poCreateItems.length > 1 && (
                            <button
                              className="w-5 h-5 rounded bg-red-500/10 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/20 transition-colors mr-0.5"
                              onClick={() => handleRemovePoItem(idx)}
                              title="Hapus item ini"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            className="w-5 h-5 rounded hover:bg-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white"
                            onClick={() => {
                              handleUpdatePoItem(idx, 'inventoryItemId', '')
                              handleUpdatePoItem(idx, 'inventoryItemName', '')
                              handleUpdatePoItem(idx, 'inventoryItemSku', null)
                              handleUpdatePoItem(idx, 'baseUnit', '')
                            }}
                            title="Ganti item"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="w-full flex items-center gap-2 rounded-lg px-3 h-9 border border-dashed border-white/[0.06] text-slate-600"
                        >
                          <ScanBarcode className="h-3 w-3 shrink-0" />
                          <span className="text-[11px]">Gunakan kolom pencarian di atas untuk cari / scan barang</span>
                        </div>
                      )}
                    </div>

                    {/* Compact fields: 2-column layout with better labels */}
                    {item.inventoryItemId && (
                      <div className="space-y-2 pl-0.5">
                        <div className="grid grid-cols-2 gap-2">
                          {/* Satuan Beli */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Satuan Beli
                              <span className="text-slate-600 font-normal ml-1">(cth: sak, karung, dus)</span>
                            </label>
                            <Input
                              value={item.unit}
                              onChange={(e) => handleUpdatePoItem(idx, 'unit', e.target.value)}
                              className={inputClass}
                              placeholder="cth: sak"
                            />
                          </div>
                          {/* Jumlah */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Jumlah Beli
                              <span className="text-slate-600 font-normal ml-1">(berapa {item.unit || 'satuan'})</span>
                            </label>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={item.qty}
                              onChange={(e) => handleUpdatePoItem(idx, 'qty', e.target.value)}
                              className={cn(inputClass, 'text-center')}
                              placeholder="1"
                            />
                          </div>
                          {/* Isi per 1 Satuan Beli */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Isi dalam 1 {item.unit || 'satuan beli'}
                              <span className="text-slate-600 font-normal ml-1">(dalam {item.baseUnit || 'satuan dasar'})</span>
                            </label>
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                value={item.baseQty}
                                onChange={(e) => handleUpdatePoItem(idx, 'baseQty', e.target.value)}
                                className={cn(inputClass, 'pr-10 text-center')}
                                placeholder="1"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none">{item.baseUnit || 'kg'}</span>
                            </div>
                          </div>
                          {/* Harga per Satuan Beli */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Harga per {item.unit || 'satuan'}
                              <span className="text-slate-600 font-normal ml-1">(Rp dari supplier)</span>
                            </label>
                            <Input
                              type="number"
                              min="0"
                              value={item.pricePerItem}
                              onChange={(e) => handleUpdatePoItem(idx, 'pricePerItem', e.target.value)}
                              className={inputClass}
                              placeholder="cth: 320000"
                            />
                          </div>
                        </div>

                        {/* Consolidated summary line — enriched */}
                        {(parseFloat(item.qty) > 0 && parseFloat(item.pricePerItem) > 0 && parseFloat(item.baseQty) > 0) ? (
                          <div className="bg-emerald-500/[0.04] rounded-lg px-3 py-2.5 text-[10px] text-slate-400 space-y-1 border border-emerald-500/[0.06]">
                            <div className="flex items-center justify-between">
                              <span>{item.qty} {item.unit} × {formatCurrency(parseFloat(item.pricePerItem))}</span>
                              <span className="text-white font-semibold">{formatCurrency((parseFloat(item.pricePerItem) || 0) * (parseFloat(item.qty) || 0))}</span>
                            </div>
                            <div className="flex items-center justify-between pt-0.5 border-t border-emerald-500/[0.06]">
                              <div className="flex items-center gap-3">
                                <span>📦 Stok masuk: <span className="text-emerald-400 font-medium">{formatNumber(parseFloat(item.qty) * parseFloat(item.baseQty))} {item.baseUnit}</span></span>
                              </div>
                              <span>📊 HPP: <span className="text-amber-400 font-medium">Rp{formatNumber(Math.round((parseFloat(item.pricePerItem) || 0) / (parseFloat(item.baseQty) || 0)))}/{item.baseUnit}</span></span>
                            </div>
                          </div>
                        ) : (parseFloat(item.qty) > 0 && parseFloat(item.pricePerItem) > 0) ? (
                          <div className="text-[10px] text-slate-500 px-1">
                            {item.qty} {item.unit || 'unit'} × {formatCurrency(parseFloat(item.pricePerItem))} = <span className="text-slate-300 font-medium">{formatCurrency((parseFloat(item.pricePerItem) || 0) * (parseFloat(item.qty) || 0))}</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}

                {/* ── Tambah Item Lain button ── */}
                <button
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-white/[0.08] text-slate-500 hover:text-slate-300 hover:border-white/[0.15] transition-colors text-xs"
                  onClick={handleAddPoItem}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Tambah Barang Lain
                </button>
              </div>
            </div>
          </div>

          {/* ── Sticky Total Biaya + Footer ── */}
          <div className="pt-3 mt-auto border-t border-white/[0.06]">
            <div className="bg-emerald-500/[0.06] rounded-xl p-3.5 border border-emerald-500/[0.1] mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-slate-400">Total Pembelian</span>
                </div>
                <span className="text-lg font-bold text-emerald-400">{formatCurrency(poTotalCost)}</span>
              </div>
              {poCreateItems.filter(i => i.inventoryItemId).length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-slate-500">
                    {poCreateItems.filter(i => i.inventoryItemId).length} barang akan dicatat
                  </p>
                  {poCreateItems.some(i => i.inventoryItemId.startsWith('__pending_')) && (
                    <p className="text-[10px] text-amber-400/70 flex items-center gap-1">
                      <PackageOpen className="h-3 w-3" />
                      Barang baru otomatis terdaftar di inventory saat disimpan
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1 h-10 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
                onClick={() => setPoCreateOpen(false)}
              >
                Batal
              </Button>
              <Button
                className="flex-1 h-10 text-xs theme-bg theme-hover text-white font-medium"
                disabled={poCreateLoading || poCreateItems.filter(i => i.inventoryItemId).length === 0}
                onClick={handlePoCreateSubmit}
              >
                {poCreateLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Simpan Pembelian
              </Button>
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Import Excel Preview Dialog ── */}
      <ResponsiveDialog open={showImportPreview} onOpenChange={(open) => { if (!open) { setShowImportPreview(false); setImportPreviewData(null) } }}>
        <ResponsiveDialogContent className="sm:max-w-2xl flex flex-col max-h-[85vh]">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <span>Preview Import Excel</span>
                <p className="text-[11px] text-slate-500 font-normal mt-0.5">
                  {importPreviewData
                    ? (() => {
                        const valid = importPreviewData.filter(i => !i.error)
                        const newCount = valid.filter(i => i.isNew).length
                        const archCount = valid.filter(i => i.isArchived).length
                        const parts: string[] = []
                        parts.push(`${valid.length} item ditemukan`)
                        if (newCount > 0) parts.push(`${newCount} barang baru`)
                        if (archCount > 0) parts.push(`${archCount} item nonaktif`)
                        return parts.join(', ')
                      })()
                    : 'Membaca file...'}
                </p>
              </div>
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs sr-only">
              Preview item dari file Excel sebelum membuat pembelian
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {/* Summary bar */}
          {importPreviewData && (
            <div className="flex items-center gap-3 px-1 mt-1">
              {(() => {
                const valid = importPreviewData.filter(i => !i.error)
                const totalCost = valid.reduce((sum, i) => sum + ((i.qty || 0) * (i.pricePerUnit || 0)), 0)
                const errorCount = importPreviewData.filter(i => i.error).length
                return (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Package className="h-3 w-3" />
                      <span>{valid.length} item</span>
                    </div>
                    {totalCost > 0 && (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                        <Banknote className="h-3 w-3" />
                        <span className="font-mono">{formatCurrency(totalCost)}</span>
                      </div>
                    )}
                    {errorCount > 0 && (
                      <div className="flex items-center gap-1.5 text-[11px] text-red-400">
                        <AlertTriangle className="h-3 w-3" />
                        <span>{errorCount} error</span>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {/* Supplier selector */}
          {importPreviewData && importPreviewData.filter(i => !i.error).length > 0 && (
            <div className="mt-2">
              <Label className="text-[11px] text-slate-400 mb-1.5 block">Supplier (opsional)</Label>
              <Select value={importSupplierId} onValueChange={setImportSupplierId}>
                <SelectTrigger className="h-9 text-xs bg-white/[0.03] border-white/[0.08]">
                  <SelectValue placeholder="Pilih supplier..." />
                </SelectTrigger>
                <SelectContent>
                  {supplierOptions.map(s => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Items list */}
          <div className="flex-1 overflow-y-auto space-y-1.5 mt-2">
            {importLoading && !importPreviewData && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
                <span className="text-xs text-slate-400 ml-2">Membaca file Excel...</span>
              </div>
            )}
            {importPreviewData && importPreviewData.map((item) => {
              const itemTotal = (item.qty || 0) * (item.pricePerUnit || 0)
              return (
                <div
                  key={item.row}
                  className={cn(
                    'rounded-lg border p-2.5 text-xs',
                    item.error
                      ? 'border-red-500/20 bg-red-500/[0.04]'
                      : item.isArchived
                        ? 'border-amber-500/20 bg-amber-500/[0.04]'
                        : item.isNew
                          ? 'border-amber-500/20 bg-amber-500/[0.04]'
                          : 'border-white/[0.04] bg-white/[0.02]'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-[10px] text-slate-600 shrink-0">#{item.row}</span>
                      <span className="text-xs text-slate-200 font-medium truncate">{item.name}</span>
                      {item.sku && <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-white/[0.1] text-slate-500 shrink-0">{item.sku}</Badge>}
                      {item.isArchived ? (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 bg-amber-500/15 text-amber-400 border-amber-500/20 shrink-0">⚠️ Nonaktif</Badge>
                      ) : item.isNew ? (
                        <Badge className="text-[9px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-400 border-amber-500/20 shrink-0">Baru</Badge>
                      ) : item.matchedItemName ? (
                        <Badge className="text-[9px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shrink-0">Match</Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      {item.qty > 0 && (
                        <span className="text-[11px] text-slate-300">
                          {item.qty}{item.purchaseUnit ? ` ${item.purchaseUnit}` : ''}
                          {item.baseQty > 0 && item.baseQty !== 1 && item.baseUnit ? (
                            <span className="text-slate-500"> → {item.qty * item.baseQty} {item.baseUnit}</span>
                          ) : null}
                        </span>
                      )}
                      {item.pricePerUnit > 0 && (
                        <span className="text-[11px] text-slate-400 font-mono">{formatCurrency(item.pricePerUnit)}</span>
                      )}
                      {itemTotal > 0 && (
                        <span className="text-[11px] text-emerald-400 font-mono font-medium">{formatCurrency(itemTotal)}</span>
                      )}
                    </div>
                  </div>
                  {item.error && (
                    <p className="text-[10px] text-red-400/80 mt-1">{item.error}</p>
                  )}
                  {item.isArchived && (
                    <p className="text-[10px] text-amber-400/80 mt-1">
                      Item ini sudah pernah ada dan saat ini berstatus <strong>Nonaktif</strong>. Saat import, item akan otomatis diaktifkan kembali.
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Footer buttons */}
          <div className="pt-3 mt-auto border-t border-white/[0.06] space-y-2">
            <Button
              className="w-full h-10 text-xs theme-bg theme-hover text-white font-medium"
              disabled={!importPreviewData || importPreviewData.filter(i => !i.error).length === 0 || importPosting}
              onClick={handleImportPost}
            >
              {importPosting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              {importPosting
                ? 'Memproses...'
                : `Posting ${importPreviewData ? importPreviewData.filter(i => !i.error).length : 0} Item`}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1 h-9 text-[11px] text-slate-400 hover:text-white"
                onClick={() => { setShowImportPreview(false); setImportPreviewData(null) }}
              >
                Batal
              </Button>
              <Button
                variant="ghost"
                className="flex-1 h-9 text-[11px] text-slate-400 hover:text-white"
                disabled={!importPreviewData || importPreviewData.filter(i => !i.error).length === 0 || importPosting}
                onClick={handleApplyImport}
              >
                <ClipboardPaste className="h-3 w-3 mr-1" />
                Terapkan ke Form
              </Button>
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Edit Purchase Order Dialog ── */}
      <ResponsiveDialog
        open={poEditOpen}
        onOpenChange={(open) => { if (!open) setPoEditOpen(false) }}
      >
        <ResponsiveDialogContent className="sm:max-w-2xl flex flex-col max-h-[90vh]">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base flex items-center gap-2">
              <Edit3 className="h-4 w-4 text-emerald-400" />
              Edit Pembelian
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Ubah detail pembelian item
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="space-y-4 mt-2 flex-1 overflow-y-auto">
            {/* Catatan */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3 w-3 text-slate-500" />
                <label className="text-[11px] text-slate-300 font-medium">Catatan</label>
                <span className="text-[10px] text-slate-600">(opsional)</span>
              </div>
              <Textarea
                value={poEditNotes}
                onChange={(e) => setPoEditNotes(e.target.value)}
                placeholder="Cth: Bayar tempo 7 hari..."
                className="bg-white/[0.04] border-white/[0.04] text-white text-xs min-h-[48px] rounded-lg resize-none placeholder:text-slate-500"
              />
            </div>

            <Separator className="bg-white/[0.06]" />

            {/* Items */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 px-1">
                <Package className="h-3 w-3 text-slate-500" />
                <span className="text-[11px] text-slate-300 font-medium">Item Pembelian</span>
                {poEditItems.filter(i => i.inventoryItemId).length > 0 && (
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full font-medium">
                    {poEditItems.filter(i => i.inventoryItemId).length}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {poEditItems.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] space-y-2.5">
                    {/* Item picker / selected display */}
                    <div className="relative" ref={(el) => { invItemEditSearchRefs.current[idx] = el }}>
                      {item.inventoryItemId ? (
                        <div className="flex items-center gap-2 bg-emerald-500/[0.06] rounded-lg px-2.5 h-9 border border-emerald-500/10">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span className="text-xs text-emerald-300 truncate flex-1 font-medium">{item.inventoryItemName}</span>
                          {item.inventoryItemSku && (
                            <span className="text-[9px] font-mono text-emerald-400/60 bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">{item.inventoryItemSku}</span>
                          )}
                          {poEditItems.length > 1 && (
                            <button
                              className="w-5 h-5 rounded bg-red-500/10 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/20 transition-colors mr-0.5"
                              onClick={() => handleRemovePoEditItem(idx)}
                              title="Hapus item ini"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            className="w-5 h-5 rounded hover:bg-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white"
                            onClick={() => {
                              handleUpdatePoEditItem(idx, 'inventoryItemId', '')
                              handleUpdatePoEditItem(idx, 'inventoryItemName', '')
                              handleUpdatePoEditItem(idx, 'inventoryItemSku', 'null')
                              handleUpdatePoEditItem(idx, 'baseUnit', '')
                            }}
                            title="Ganti item"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="w-full flex items-center gap-2.5 bg-white/[0.04] rounded-lg px-3 h-10 text-left hover:bg-white/[0.06] transition-colors border border-dashed border-white/[0.08]"
                            onClick={() => { setActiveItemSearchIdx(idx); setShowItemPicker(true); setItemPickerFilter(''); setShowQuickAddItem(false) }}
                          >
                            <Package className="h-4 w-4 text-slate-500 shrink-0" />
                            <div className="flex-1">
                              <span className="text-xs text-slate-400">Tap untuk pilih item...</span>
                            </div>
                            <ArrowRight className="h-3 w-3 text-slate-600" />
                          </button>

                          {/* Picker dropdown (reuses same state) */}
                          {activeItemSearchIdx === idx && showItemPicker && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-nebula border border-white/[0.06] rounded-lg shadow-xl z-50 max-h-[70vh] flex flex-col">
                              <div className="p-2 border-b border-white/[0.06]">
                                <div className="relative">
                                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
                                  <input
                                    autoFocus
                                    value={itemPickerFilter}
                                    onChange={(e) => { setItemPickerFilter(e.target.value); setShowQuickAddItem(false) }}
                                    placeholder="Ketik nama item untuk filter..."
                                    className="w-full bg-white/[0.04] border-white/[0.04] text-white text-xs h-8 rounded-md pl-8 pr-2 outline-none placeholder:text-slate-500"
                                  />
                                </div>
                              </div>
                              {poItemOptionsLoading ? (
                                <div className="flex items-center justify-center gap-2 py-4 text-slate-500">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span className="text-[10px]">Memuat daftar item...</span>
                                </div>
                              ) : filteredItemOptions.length === 0 && !showQuickAddItem ? (
                                <div className="py-6 text-center px-3">
                                  <Package className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                                  <p className="text-[11px] text-slate-400 mb-3">Tidak ada item yang cocok</p>
                                </div>
                              ) : !showQuickAddItem ? (
                                <div className="max-h-[180px] overflow-y-auto flex-1 min-h-0">
                                  {filteredItemOptions.filter(r => !r._isNew).map((r) => (
                                    <button
                                      key={r.id}
                                      className={cn("w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors", !r.active && "opacity-50")}
                                      onClick={() => handleSelectInvItemForEdit(idx, r)}
                                    >
                                      <Package className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs text-slate-200 truncate">{r.name}</p>
                                        <p className="text-[10px] text-slate-500">Stok: {formatNumber(r.stock)} {r.baseUnit}</p>
                                      </div>
                                      {r.sku && (
                                        <span className="text-[9px] font-mono text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded shrink-0">{r.sku}</span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Compact fields: 2-column layout */}
                    {item.inventoryItemId && (
                      <div className="space-y-2 pl-0.5">
                        <div className="grid grid-cols-2 gap-2">
                          {/* Satuan Beli */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">Satuan Beli</label>
                            <Input
                              value={item.unit}
                              onChange={(e) => handleUpdatePoEditItem(idx, 'unit', e.target.value)}
                              className={inputClass}
                              placeholder="Cth: sak, ekor"
                            />
                          </div>
                          {/* Jumlah */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">Jumlah</label>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={item.qty}
                              onChange={(e) => handleUpdatePoEditItem(idx, 'qty', e.target.value)}
                              className={cn(inputClass, 'text-center')}
                              placeholder="1"
                            />
                          </div>
                          {/* Isi per 1 Satuan Beli */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">Isi per 1 {item.unit || 'unit'}</label>
                            <div className="relative">
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                value={item.baseQty}
                                onChange={(e) => handleUpdatePoEditItem(idx, 'baseQty', e.target.value)}
                                className={cn(inputClass, 'pr-10 text-center')}
                                placeholder="1"
                              />
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none">{item.baseUnit || 'kg'}</span>
                            </div>
                          </div>
                          {/* Harga per Satuan Beli */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">Harga per {item.unit || 'unit'} (Rp)</label>
                            <Input
                              type="number"
                              min="0"
                              value={item.pricePerItem}
                              onChange={(e) => handleUpdatePoEditItem(idx, 'pricePerItem', e.target.value)}
                              className={inputClass}
                              placeholder="72000"
                            />
                          </div>
                        </div>

                        {/* Consolidated summary line */}
                        {(parseFloat(item.qty) > 0 && parseFloat(item.pricePerItem) > 0 && parseFloat(item.baseQty) > 0) ? (
                          <div className="bg-white/[0.03] rounded-md px-2.5 py-2 text-[10px] text-slate-400 space-y-0.5 border border-white/[0.03]">
                            <div className="flex items-center justify-between">
                              <span>{item.qty} {item.unit} × {formatCurrency(parseFloat(item.pricePerItem))}</span>
                              <span className="text-white font-medium">{formatCurrency((parseFloat(item.pricePerItem) || 0) * (parseFloat(item.qty) || 0))}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Stok masuk: <span className="text-slate-300">{formatNumber(parseFloat(item.qty) * parseFloat(item.baseQty))} {item.baseUnit}</span></span>
                              <span>HPP: <span className="text-amber-400/80 font-medium">Rp{formatNumber(Math.round((parseFloat(item.pricePerItem) || 0) / (parseFloat(item.baseQty) || 0)))}/{item.baseUnit}</span></span>
                            </div>
                          </div>
                        ) : (parseFloat(item.qty) > 0 && parseFloat(item.pricePerItem) > 0) ? (
                          <div className="text-[10px] text-slate-500 px-1">
                            {item.qty} {item.unit || 'unit'} × {formatCurrency(parseFloat(item.pricePerItem))} = <span className="text-slate-300 font-medium">{formatCurrency((parseFloat(item.pricePerItem) || 0) * (parseFloat(item.qty) || 0))}</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-white/[0.08] text-slate-500 hover:text-slate-300 hover:border-white/[0.15] transition-colors text-xs"
                  onClick={handleAddPoEditItem}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Tambah Item Lain
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="pt-3 mt-auto border-t border-white/[0.06]">
            <div className="bg-emerald-500/[0.06] rounded-lg p-3 border border-emerald-500/[0.1] mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Banknote className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-xs text-slate-400">Total Pembelian</span>
                </div>
                <span className="text-lg font-bold text-emerald-400">{formatCurrency(poEditTotalCost)}</span>
              </div>
              <p className="text-[9px] text-amber-500/60 mt-1">
                ⚠ Stok item akan dikurangi lalu ditambah ulang sesuai perubahan
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1 h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
                onClick={() => setPoEditOpen(false)}
              >
                Batal
              </Button>
              <Button
                className="flex-1 h-9 text-xs theme-bg theme-hover text-white"
                disabled={poEditLoading || poEditItems.filter(i => i.inventoryItemId).length === 0}
                onClick={handlePoEditSubmit}
              >
                {poEditLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Simpan Perubahan
              </Button>
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Delete Purchase Order Alert ── */}
      <AlertDialog open={!!deletePoId} onOpenChange={(open) => { if (!open) setDeletePoId(null) }}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Hapus Pembelian?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Pembelian yang dihapus tidak dapat dikembalikan. Stok item yang sudah masuk dari pembelian ini juga akan dikurangi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-white/[0.04]">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"
              onClick={handleDeletePo}
              disabled={deletingPo}
            >
              {deletingPo ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* INVENTORY ITEM DIALOGS                                       */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* Create/Edit Inventory Item Dialog */}
      <ResponsiveDialog open={invFormOpen} onOpenChange={setInvFormOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">
              {invFormEdit ? 'Edit Item' : 'Tambah Item Baru'}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label className={labelClass}>Nama *</Label>
              <Input
                value={invFormName}
                onChange={(e) => setInvFormName(e.target.value)}
                placeholder="Nama item"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className={labelClass}>SKU</Label>
                <Input
                  value={invFormSku}
                  onChange={(e) => setInvFormSku(e.target.value)}
                  placeholder="SKU (opsional)"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={labelClass}>Base Unit</Label>
                <Select value={invFormBaseUnit} onValueChange={setInvFormBaseUnit}>
                  <SelectTrigger className={inputClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-nebula border-white/[0.06]">
                    {BASE_UNIT_OPTIONS.map((u) => (
                      <SelectItem key={u} value={u} className="text-slate-200 text-xs">
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className={labelClass}>Kategori</Label>
                <Select value={invFormCategory} onValueChange={setInvFormCategory}>
                  <SelectTrigger className={inputClass}>
                    <SelectValue placeholder="Pilih kategori" />
                  </SelectTrigger>
                  <SelectContent className="bg-nebula border-white/[0.06]">
                    <SelectItem value="__none__" className="text-slate-200 text-xs">Tanpa Kategori</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-slate-200 text-xs">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className={labelClass}>Low Stock Alert</Label>
                <Input
                  type="number"
                  min="0"
                  value={invFormLowStock}
                  onChange={(e) => setInvFormLowStock(e.target.value)}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Create-only fields */}
            {!invFormEdit && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className={labelClass}>Stok Awal</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={invFormInitialStock}
                    onChange={(e) => setInvFormInitialStock(e.target.value)}
                    className={inputClass}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className={labelClass}>HPP Satuan (Rp)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={invFormAvgCost}
                    onChange={(e) => setInvFormAvgCost(e.target.value)}
                    className={inputClass}
                    placeholder="0"
                  />
                </div>
              </div>
            )}
          </div>
          <ResponsiveDialogFooter className="mt-4 gap-2">
            <Button
              variant="ghost"
              className="flex-1 h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
              onClick={() => setInvFormOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="flex-1 h-9 text-xs theme-bg theme-hover text-white"
              disabled={invFormLoading}
              onClick={handleInvFormSubmit}
            >
              {invFormLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Simpan'}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete / Archive Inventory Item Alert */}
      <AlertDialog open={!!deleteInvId} onOpenChange={(open) => { if (!open) { setDeleteInvId(null); setInvDeleteBlocked(null) } }}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {invDeleteBlocked?.blockType === 'hasHistory' ? '🚫 Item Tidak Dapat Dihapus' : 'Hapus Item?'}
            </AlertDialogTitle>
            {!invDeleteBlocked ? (
              <AlertDialogDescription className="text-slate-400">
                Item yang dihapus tidak dapat dikembalikan.
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>

          {/* Blocked: has business history → suggest archive */}
          {invDeleteBlocked && invDeleteBlocked.blockType === 'hasHistory' && (
            <div className="space-y-3 my-2">
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="text-amber-300 font-medium">{invDeleteBlocked.message}</p>
                  <div className="mt-2 space-y-1">
                    {invDeleteBlocked.blockers?.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-slate-400 text-xs">
                        <span className="text-slate-600">•</span> {b}
                      </div>
                    ))}
                  </div>
                  <p className="text-slate-400 text-xs mt-2.5 leading-relaxed italic">
                    {invDeleteBlocked.suggestion}
                  </p>
                </div>
              </div>
            </div>
          )}

          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-white/[0.04]">Batal</AlertDialogCancel>
            {invDeleteBlocked?.blockType === 'hasHistory' ? (
              <AlertDialogAction
                className="bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20"
                onClick={() => { if (deleteInvId) handleArchiveInv(deleteInvId) }}
                disabled={archivingInv}
              >
                {archivingInv ? <Loader2 className="h-4 w-4 animate-spin" /> : '🚫 Nonaktifkan'}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"
                onClick={() => handleDeleteInv()}
                disabled={archivingInv}
              >
                {archivingInv ? <Loader2 className="h-4 w-4 animate-spin" /> : '🗑 Hapus'}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* CATEGORY DIALOGS                                               */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* Category Management Dialog */}
      <ResponsiveDialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">Kelola Kategori</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Kategori untuk mengelompokkan item inventory
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 mt-2">
            {/* Add form */}
            <div className="flex items-center gap-2">
              <Input
                value={catFormName}
                onChange={(e) => setCatFormName(e.target.value)}
                placeholder="Nama kategori baru"
                className={cn(inputClass, 'flex-1')}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCategorySubmit() }}
              />
              <Select value={catFormColor} onValueChange={setCatFormColor}>
                <SelectTrigger className={cn(inputClass, 'w-20')}>
                  <div className="flex items-center gap-1.5">
                    <span className={cn('w-2.5 h-2.5 rounded-full', getCategoryColorClasses(catFormColor).dot)} />
                    <span className="text-[10px] text-slate-400">{catFormColor}</span>
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-nebula border-white/[0.06]">
                  {CATEGORY_COLORS.map((c) => (
                    <SelectItem key={c} value={c} className="text-slate-200 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={cn('w-2.5 h-2.5 rounded-full', getCategoryColorClasses(c).dot)} />
                        {c}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-9 px-3 theme-bg theme-hover text-white text-xs shrink-0"
                disabled={catFormLoading}
                onClick={handleCategorySubmit}
              >
                {catFormLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              </Button>
            </div>

            {/* Category list */}
            {categories.length === 0 ? (
              <div className="py-8 text-center">
                <Tags className="h-6 w-6 text-slate-600 mx-auto mb-1.5" />
                <p className="text-xs text-slate-500">Belum ada kategori</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                {categories.map((c) => {
                  const cc = getCategoryColorClasses(c.color)
                  return (
                    <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <span className={cn('w-3 h-3 rounded-full shrink-0', cc.dot)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-200 font-medium truncate">{c.name}</p>
                        {c._count && c._count.items > 0 && (
                          <p className="text-[10px] text-slate-500">{c._count.items} item</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06] shrink-0"
                        onClick={() => setDeleteCatId(c.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete Category Alert */}
      <AlertDialog open={!!deleteCatId} onOpenChange={(open) => { if (!open) setDeleteCatId(null) }}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Hapus Kategori?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Kategori yang dihapus tidak dapat dikembalikan. Item dalam kategori ini akan menjadi tanpa kategori.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-white/[0.04]">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"
              onClick={handleDeleteCategory}
              disabled={deletingCat}
            >
              {deletingCat ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* POST SEBAGAI PRODUK DIALOG                                    */}
      {/* ══════════════════════════════════════════════════════════ */}
      <ResponsiveDialog
        open={postProductOpen}
        onOpenChange={(open) => { if (!open) { setPostProductOpen(false); resetPostProductForm() } }}
      >
        <ResponsiveDialogContent className={cn("flex flex-col max-h-[90vh]", postMode === 'retail' ? 'sm:max-w-3xl' : 'sm:max-w-2xl')}>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              {postMode === 'select' && 'Post sebagai Produk'}
              {postMode === 'composition' && 'Post — Komposisi (F&B)'}
              {postMode === 'retail' && `Post — Satu-satu (Ritel)`}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              {postMode === 'select' && 'Pilih mode konversi item inventory menjadi produk'}
              {postMode === 'composition' && postStep === 1 && 'Atur jumlah pemakaian tiap item'}
              {postMode === 'composition' && postStep === 2 && 'Isi detail produk dan atur varian'}
              {postMode === 'composition' && postStep === 3 && 'Review sebelum membuat produk'}
              {postMode === 'retail' && `${selectedInvIds.size} item akan masing-masing menjadi 1 produk terpisah`}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="mt-3 flex-1 overflow-y-auto">
            {/* ═══ MODE SELECTOR ═══ */}
            {postMode === 'select' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* F&B Composition */}
                <button
                  className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] text-left transition-colors group"
                  onClick={() => setPostMode('composition')}
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <span className="text-lg">🍳</span>
                    </div>
                    <div>
                      <p className="text-sm text-white font-medium group-hover:text-emerald-300 transition-colors">Komposisi (F&B)</p>
                      <p className="text-[10px] text-slate-500">Banyak item → 1 produk</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Gabungkan beberapa bahan baku menjadi satu produk. Cth: kopi + susu + gula → <span className="text-emerald-400/70">Kopi Susu</span>
                  </p>
                  <div className="flex items-center gap-1.5 mt-3 text-[10px] text-slate-500">
                    <Package className="h-3 w-3" />
                    <span>{selectedInvIds.size} item terpilih</span>
                    <ArrowRight className="h-2.5 w-2.5 ml-auto" />
                  </div>
                </button>

                {/* Retail 1:1 */}
                <button
                  className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] text-left transition-colors group"
                  onClick={() => setPostMode('retail')}
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <span className="text-lg">🛒</span>
                    </div>
                    <div>
                      <p className="text-sm text-white font-medium group-hover:text-violet-300 transition-colors">Satu-satu (Ritel)</p>
                      <p className="text-[10px] text-slate-500">1 item → 1 produk</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Setiap item inventory jadi produk jualan terpisah. Cth: <span className="text-violet-400/70">Teh Poci</span>, <span className="text-violet-400/70">Gula Pasir</span>, masing-masing 1 produk
                  </p>
                  <div className="flex items-center gap-1.5 mt-3 text-[10px] text-slate-500">
                    <Package className="h-3 w-3" />
                    <span>{selectedInvIds.size} item → {selectedInvIds.size} produk</span>
                    <ArrowRight className="h-2.5 w-2.5 ml-auto" />
                  </div>
                </button>
              </div>
            )}

            {/* ═══ RETAIL MODE ═══ */}
            {postMode === 'retail' && (
              <div className="space-y-4">
                {/* Bulk settings */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className={labelClass}>Kategori Produk</Label>
                    <Select value={retailCategory} onValueChange={setRetailCategory}>
                      <SelectTrigger className={cn(inputClass, 'h-9')}>
                        <SelectValue placeholder="Pilih kategori (opsional)" />
                      </SelectTrigger>
                      <SelectContent className="bg-nebula border-white/[0.06]">
                        {postProductCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-slate-200 text-xs">{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className={labelClass}>Harga Jual</Label>
                      <button
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 font-medium"
                        onClick={() => setRetailUseBulkPrice(!retailUseBulkPrice)}
                      >
                        {retailUseBulkPrice ? '→ Harga per item' : '→ Harga bulk'}
                      </button>
                    </div>
                    {retailUseBulkPrice ? (
                      <Input
                        type="number"
                        min="0"
                        value={retailBulkPrice}
                        onChange={(e) => setRetailBulkPrice(e.target.value)}
                        className={inputClass}
                        placeholder="Harga sama untuk semua produk"
                      />
                    ) : (
                      <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] px-3 py-2">
                        <p className="text-[10px] text-slate-400">Isi harga di kolom masing-masing item di bawah</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Items table */}
                <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                  <div className="max-h-[360px] overflow-y-auto">
                    {selectedInvItems.map((item, i) => {
                      const qty = parseFloat(retailQtyPerProduct[item.id]) || 1
                      const hpp = qty * item.avgCost
                      const price = retailUseBulkPrice
                        ? (parseFloat(retailBulkPrice) || 0)
                        : (parseFloat(retailPrices[item.id]) || 0)
                      const margin = price - hpp
                      const maxStock = qty > 0 ? Math.floor(item.stock / qty) : 0
                      return (
                        <div key={item.id} className={cn("p-3 space-y-2 border-b border-white/[0.04] last:border-0", i % 2 === 1 && 'bg-white/[0.01]')}>
                          <div className="flex items-center gap-2.5">
                            <span className="text-[10px] text-slate-500 w-5 text-right shrink-0">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-white font-medium truncate">{item.name}</p>
                              <p className="text-[10px] text-slate-500">
                                HPP item: {formatCurrency(item.avgCost)}/{item.baseUnit} · Stok: {formatNumber(item.stock)} {item.baseUnit}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 pl-7">
                            {/* Qty per product */}
                            <div className="flex items-center gap-1 shrink-0">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={retailQtyPerProduct[item.id] || ''}
                                onChange={(e) => setRetailQtyPerProduct(p => ({ ...p, [item.id]: e.target.value }))}
                                className="bg-white/[0.04] border-white/[0.04] text-white text-[11px] h-7 w-16 rounded-md px-2 text-right outline-none placeholder:text-slate-500"
                                placeholder="1"
                              />
                              <span className="text-[10px] text-slate-500 w-10">{item.baseUnit}/produk</span>
                            </div>
                            {/* Price (if not bulk) */}
                            {!retailUseBulkPrice && (
                              <div className="flex items-center gap-1 shrink-0">
                                <input
                                  type="number"
                                  min="0"
                                  value={retailPrices[item.id] || ''}
                                  onChange={(e) => setRetailPrices(p => ({ ...p, [item.id]: e.target.value }))}
                                  className="bg-white/[0.04] border-white/[0.04] text-white text-[11px] h-7 w-24 rounded-md px-2 text-right outline-none placeholder:text-slate-500"
                                  placeholder="0"
                                />
                                <span className="text-[10px] text-slate-500">Rp</span>
                              </div>
                            )}
                            <div className="flex-1" />
                            {/* Summary badges */}
                            <div className="flex items-center gap-2 shrink-0">
                              {price > 0 && (
                                <span className={cn("text-[10px] font-medium", margin >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                  Margin {formatCurrency(margin)}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded">
                                HPP {formatCurrency(hpp)}
                              </span>
                              <span className="text-[10px] text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded">
                                Stok ~{formatNumber(maxStock)}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Summary */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04] text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Produk</p>
                    <p className="text-sm font-bold text-white">{selectedInvItems.length}</p>
                  </div>
                  <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04] text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Harga</p>
                    <p className="text-sm font-bold text-emerald-400">
                      {retailUseBulkPrice
                        ? (retailBulkPrice ? formatCurrency(parseFloat(retailBulkPrice)) : '-')
                        : `${retailPrices && Object.values(retailPrices).filter(v => v).length}/${selectedInvItems.length}`}
                    </p>
                  </div>
                  <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04] text-center">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Komposisi</p>
                    <p className="text-sm font-bold text-violet-400">1:1</p>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ COMPOSITION MODE (existing 3-step wizard) ═══ */}
            {postMode === 'composition' && (
              <div className="space-y-0">
                {/* Step indicators */}
                <div className="flex items-center gap-1.5 px-1 mb-3">
                  {[1, 2, 3].map(s => (
                    <div key={s} className="flex items-center gap-1.5">
                      <span className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center font-medium text-[9px] transition-colors',
                        postStep >= s ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.06] text-slate-500'
                      )}>
                        {postStep > s ? <CheckCircle2 className="h-3 w-3" /> : s}
                      </span>
                      {s < 3 && <ArrowRight className="h-2 w-2 text-slate-600" />}
                    </div>
                  ))}
                </div>

            {/* Step 1: Composition qty per item */}
            {postStep === 1 && (
              <div className="space-y-3">
                {selectedInvItems.length === 0 ? (
                  <div className="py-8 text-center">
                    <Package className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">Tidak ada item terpilih</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
                      {selectedInvItems.map((item) => {
                        const qty = parseFloat(postCompQty[item.id]) || 0
                        const subtotal = qty * item.avgCost
                        const maxFromItem = qty > 0 ? Math.floor(item.stock / qty) : 0
                        return (
                          <div key={item.id} className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs text-slate-200 font-medium truncate">{item.name}</p>
                                <p className="text-[10px] text-slate-500">
                                  Stok: {formatNumber(item.stock)} {item.baseUnit} · Rp {formatNumber(item.avgCost)}/{item.baseUnit}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={postCompQty[item.id] || ''}
                                  onChange={(e) => setPostCompQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-8 w-24 rounded-md px-2.5 text-right outline-none placeholder:text-slate-500"
                                  placeholder="0"
                                />
                                <span className="text-[10px] text-slate-500 w-10">{item.baseUnit}</span>
                              </div>
                            </div>
                            {qty > 0 && (
                              <div className="flex items-center justify-between pl-0.5">
                                <span className="text-[10px] text-slate-500">
                                  Subtotal · maks ~<span className="text-slate-300 font-medium">{formatNumber(maxFromItem)}</span> produk
                                </span>
                                <span className="text-[11px] text-amber-400/80 font-medium">{formatCurrency(subtotal)}</span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/[0.06]">
                      <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04]">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Estimasi HPP / produk</p>
                        <p className="text-xs font-bold text-emerald-400">{formatCurrency(postEstimatedHpp)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04]">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Stok awal (otomatis)</p>
                        <p className="text-xs font-bold text-slate-200">
                          {postMaxStock === Infinity ? '~' : formatNumber(postMaxStock)} {postProductUnit}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 2: Product details + variants */}
            {postStep === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className={labelClass}>Nama Produk *</Label>
                    <Input
                      value={postProductName}
                      onChange={(e) => setPostProductName(e.target.value)}
                      className={inputClass}
                      placeholder="Cth: Nasi Goreng Spesial"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className={labelClass}>Harga Jual *</Label>
                    <Input
                      type="number"
                      min="0"
                      value={postProductPrice}
                      onChange={(e) => setPostProductPrice(e.target.value)}
                      className={inputClass}
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className={labelClass}>Satuan</Label>
                    <Select value={postProductUnit} onValueChange={setPostProductUnit}>
                      <SelectTrigger className={cn(inputClass, 'h-9')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-nebula border-white/[0.06]">
                        {PRODUCT_UNIT_OPTIONS.map((u) => (
                          <SelectItem key={u} value={u} className="text-slate-200 text-xs">{u}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className={labelClass}>Kategori Produk</Label>
                    <Select value={postProductCategory} onValueChange={setPostProductCategory}>
                      <SelectTrigger className={cn(inputClass, 'h-9')}>
                        <SelectValue placeholder="Pilih kategori (opsional)" />
                      </SelectTrigger>
                      <SelectContent className="bg-nebula border-white/[0.06]">
                        {postProductCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-slate-200 text-xs">{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.04]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-slate-400">HPP Otomatis (dari komposisi)</span>
                    <span className="text-xs font-bold text-emerald-400">{formatCurrency(postEstimatedHpp)}</span>
                  </div>
                  <p className="text-[10px] text-slate-600">Dihitung dari total qty × HPP item. HPP akan otomatis terupdate saat ada pembelian baru.</p>
                </div>

                {/* Variant toggle — always visible */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <div>
                    <p className="text-xs text-slate-200 font-medium">Aktifkan Varian</p>
                    <p className="text-[10px] text-slate-500">Buat varian dengan komposisi berbeda (cth: L, M)</p>
                  </div>
                  <Switch
                    checked={postHasVariants}
                    onCheckedChange={(checked) => { setPostHasVariants(checked); if (!checked) { setPostVariants([]); setPostVariantCompQty({}) } }}
                  />
                </div>

                {/* Variant definitions */}
                {postHasVariants && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-slate-300 font-medium">Daftar Varian</p>
                      <button
                        className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 font-medium"
                        onClick={() => {
                          const newIdx = postVariants.length
                          setPostVariants(prev => [...prev, { name: '', price: postProductPrice || '' }])
                          // Pre-fill compQty from base postCompQty
                          const baseMap: Record<string, string> = {}
                          for (const item of selectedInvItems) {
                            baseMap[item.id] = postCompQty[item.id] || ''
                          }
                          setPostVariantCompQty(prev => ({ ...prev, [newIdx]: baseMap }))
                        }}
                      >
                        <Plus className="h-3 w-3" />
                        Tambah Varian
                      </button>
                    </div>

                    {postVariants.length === 0 ? (
                      <div className="py-4 text-center">
                        <p className="text-[11px] text-slate-500">Belum ada varian. Klik "Tambah Varian" untuk menambahkan.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[300px] overflow-y-auto">
                        {postVariants.map((variant, vi) => {
                          const variantHpp = getVariantHpp(vi)
                          const variantMaxStock = getVariantMaxStock(vi)
                          const variantPrice = parseFloat(variant.price) || 0
                          const variantMargin = variantPrice - variantHpp
                          return (
                            <div key={vi} className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 space-y-2.5">
                              {/* Variant header */}
                              <div className="flex items-center gap-2">
                                <input
                                  value={variant.name}
                                  onChange={(e) => setPostVariants(prev => prev.map((v, i) => i === vi ? { ...v, name: e.target.value } : v))}
                                  className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-8 w-24 rounded-md px-2.5 outline-none placeholder:text-slate-500"
                                  placeholder="Nama varian"
                                />
                                <span className="text-[10px] text-slate-500">Harga:</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={variant.price}
                                  onChange={(e) => setPostVariants(prev => prev.map((v, i) => i === vi ? { ...v, name: v.name, price: e.target.value } : v))}
                                  className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-8 w-28 rounded-md px-2.5 text-right outline-none placeholder:text-slate-500"
                                  placeholder="0"
                                />
                                <div className="flex-1" />
                                <button
                                  className="w-6 h-6 rounded flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                                  onClick={() => {
                                    setPostVariants(prev => prev.filter((_, i) => i !== vi))
                                    setPostVariantCompQty(prev => {
                                      const next: Record<number, Record<string, string>> = {}
                                      let idx = 0
                                      for (const [k, v] of Object.entries(prev)) {
                                        if (parseInt(k) === vi) continue
                                        next[idx] = v
                                        idx++
                                      }
                                      return next
                                    })
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>

                              {/* Per-variant composition */}
                              <div className="space-y-1.5 pl-0.5">
                                {selectedInvItems.map((item) => {
                                  const compQtyMap = postVariantCompQty[vi] || {}
                                  return (
                                    <div key={item.id} className="flex items-center gap-2">
                                      <span className="text-[11px] text-slate-400 truncate flex-1 min-w-0">{item.name}</span>
                                      <input
                                        type="number"
                                        step="any"
                                        min="0"
                                        value={compQtyMap[item.id] || ''}
                                        onChange={(e) => setPostVariantCompQty(prev => ({
                                          ...prev,
                                          [vi]: { ...(prev[vi] || {}), [item.id]: e.target.value }
                                        }))}
                                        className="bg-white/[0.04] border-white/[0.04] text-white text-[11px] h-7 w-20 rounded-md px-2 text-right outline-none placeholder:text-slate-500"
                                        placeholder="0"
                                      />
                                      <span className="text-[10px] text-slate-500 w-10">{item.baseUnit}</span>
                                    </div>
                                  )
                                })}
                              </div>

                              {/* Variant summary */}
                              <div className="flex items-center gap-3 text-[10px] pt-1.5 border-t border-white/[0.04]">
                                <span className="text-slate-500">HPP: <span className="text-emerald-400 font-medium">{formatCurrency(variantHpp)}</span></span>
                                <span className="text-slate-500">Maks stok: <span className="text-slate-300 font-medium">{variantMaxStock === Infinity ? '~' : formatNumber(variantMaxStock)}</span></span>
                                {variantPrice > 0 && (
                                  <span className="text-slate-500">Margin: <span className={cn('font-medium', variantMargin >= 0 ? 'text-emerald-400' : 'text-red-400')}>{formatCurrency(variantMargin)}</span></span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Review & Confirm */}
            {postStep === 3 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.04]">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Nama Produk</p>
                    <p className="text-xs text-white font-medium">{postProductName}</p>
                  </div>
                  <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.04]">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Harga Jual</p>
                    <p className="text-xs text-emerald-400 font-bold">{formatCurrency(parseFloat(postProductPrice) || 0)}</p>
                  </div>
                </div>

                {postHasVariants && postVariants.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Varian & Komposisi</p>
                    {postVariants.map((variant, vi) => {
                      const vHpp = getVariantHpp(vi)
                      const vPrice = parseFloat(variant.price) || 0
                      const vMargin = vPrice - vHpp
                      const compQtyMap = postVariantCompQty[vi] || {}
                      return (
                        <div key={vi} className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-white font-medium">{variant.name || '(tanpa nama)'}</p>
                            <p className="text-xs text-emerald-400 font-bold">{formatCurrency(vPrice)}</p>
                          </div>
                          <div className="space-y-1">
                            {selectedInvItems.map(item => {
                              const qty = parseFloat(compQtyMap[item.id]) || parseFloat(postCompQty[item.id]) || 0
                              if (qty <= 0) return null
                              return (
                                <div key={item.id} className="flex items-center justify-between py-1 border-b border-white/[0.03] last:border-0">
                                  <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    <span className="text-[11px] text-slate-300">{item.name}</span>
                                  </div>
                                  <span className="text-[10px] text-slate-500">
                                    {formatNumber(qty)} {item.baseUnit} × {formatCurrency(item.avgCost)} = <span className="text-slate-300">{formatCurrency(qty * item.avgCost)}</span>
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                          <div className="flex items-center gap-3 text-[10px] pt-1.5 border-t border-white/[0.04]">
                            <span className="text-slate-500">HPP: <span className="text-emerald-400 font-medium">{formatCurrency(vHpp)}</span></span>
                            <span className="text-slate-500">Margin: <span className={cn('font-medium', vMargin >= 0 ? 'text-emerald-400' : 'text-red-400')}>{formatCurrency(vMargin)}</span></span>
                            <span className="text-slate-500">Stok awal: <span className="text-emerald-400 font-medium">{getVariantMaxStock(vi) === Infinity ? '~' : formatNumber(getVariantMaxStock(vi))}</span></span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.04]">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Komposisi Item</p>
                    <div className="space-y-1.5 mt-2">
                      {selectedInvItems.map((item) => {
                        const qty = parseFloat(postCompQty[item.id]) || 0
                        if (qty <= 0) return null
                        return (
                          <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              <span className="text-xs text-slate-200">{item.name}</span>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {formatNumber(qty)} {item.baseUnit} × {formatCurrency(item.avgCost)} = <span className="text-slate-300">{formatCurrency(qty * item.avgCost)}</span>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Bottom summary — only for non-variant products (variant summary is per-variant above) */}
                {!postHasVariants && (
                  <>
                    <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                      <span className="text-xs text-slate-400">Total HPP</span>
                      <span className="text-sm font-bold text-emerald-400">{formatCurrency(postEstimatedHpp)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Margin</span>
                      <span className={cn('text-sm font-bold', (parseFloat(postProductPrice) || 0) - postEstimatedHpp >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {formatCurrency((parseFloat(postProductPrice) || 0) - postEstimatedHpp)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Stok awal (otomatis)</span>
                      <span className="text-xs font-bold text-emerald-400">
                        {postMaxStock === Infinity ? '~' : formatNumber(postMaxStock)} {postProductUnit}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
              </div>
            )}
          </div>

          {/* ═══ FOOTER ═══ */}
          <ResponsiveDialogFooter className="mt-4 gap-2">
            {/* Mode selector: only Batal */}
            {postMode === 'select' && (
              <Button
                variant="ghost"
                className="h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
                onClick={() => { setPostProductOpen(false); resetPostProductForm() }}
              >
                Batal
              </Button>
            )}

            {/* Retail mode footer */}
            {postMode === 'retail' && (
              <>
                <Button
                  variant="ghost"
                  className="h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04] gap-1"
                  onClick={() => setPostMode('select')}
                >
                  <ArrowLeft className="h-3 w-3" />
                  Kembali
                </Button>
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  className="h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
                  onClick={() => { setPostProductOpen(false); resetPostProductForm() }}
                >
                  Batal
                </Button>
                <Button
                  className="h-9 text-xs bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 gap-1 disabled:opacity-50"
                  disabled={retailSubmitting || (retailUseBulkPrice && !retailBulkPrice) || selectedInvItems.length === 0}
                  onClick={handleRetailSubmit}
                >
                  {retailSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Buat {selectedInvItems.length} Produk
                </Button>
              </>
            )}

            {/* Composition mode footer */}
            {postMode === 'composition' && (
              <>
                {postStep > 1 && (
                  <Button
                    variant="ghost"
                    className="h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04] gap-1"
                    onClick={() => setPostStep((postStep - 1) as 1|2|3)}
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Kembali
                  </Button>
                )}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  className="h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
                  onClick={() => { setPostProductOpen(false); resetPostProductForm() }}
                >
                  Batal
                </Button>
                {postStep < 3 ? (
                  <Button
                    className="h-9 text-xs theme-bg theme-hover text-white gap-1"
                    onClick={() => {
                      if (postStep === 1) {
                        const hasQty = selectedInvItems.some(i => (parseFloat(postCompQty[i.id]) || 0) > 0)
                        if (!hasQty) { toast.error('Isi jumlah pemakaian minimal 1 item'); return }
                      }
                      if (postStep === 2) {
                        if (!postProductName.trim()) { toast.error('Nama produk wajib diisi'); return }
                        if (!postProductPrice) { toast.error('Harga jual wajib diisi'); return }
                        if (postHasVariants) {
                          const missing = postVariants.some(v => !v.name.trim())
                          if (missing) { toast.error('Nama varian wajib diisi untuk semua varian'); return }
                        }
                      }
                      setPostStep((postStep + 1) as 1|2|3)
                    }}
                    disabled={postStep === 1 && selectedInvItems.length === 0}
                  >
                    Lanjut
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                ) : (
                  <Button
                    className="h-9 text-xs theme-bg theme-hover text-white gap-1"
                    disabled={postProductSubmitting || !postProductName.trim() || !postProductPrice}
                    onClick={handlePostProductSubmit}
                  >
                    {postProductSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Buat Produk
                  </Button>
                )}
              </>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Inventory Item Detail Dialog ── */}
      <ResponsiveDialog open={invDetailOpen} onOpenChange={setInvDetailOpen}>
        <ResponsiveDialogContent className="sm:max-w-xl">
          <ResponsiveDialogHeader>
            <div className="flex items-center justify-between pr-8">
              <div className="min-w-0">
                <ResponsiveDialogTitle className="text-white text-base truncate">Detail Item</ResponsiveDialogTitle>
                <ResponsiveDialogDescription className="text-slate-400 text-xs truncate flex items-center gap-1.5">
                  {invDetailData?.name || '-'}
                  {invDetailData?.status === 'ARCHIVED' && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-amber-500/15 text-amber-400 border-amber-500/20 shrink-0">Nonaktif</Badge>
                  )}
                </ResponsiveDialogDescription>
              </div>
              {invDetailData && (
                <div className="flex items-center gap-1 shrink-0">
                  {invDetailData.status === 'ARCHIVED' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-slate-400 hover:text-amber-400 hover:bg-amber-500/[0.06]"
                      onClick={() => { handleRestoreInv(invDetailData.id); setInvDetailOpen(false) }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                        onClick={() => { openInvForm(invDetailData); setInvDetailOpen(false) }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-slate-400 hover:text-red-400 hover:bg-red-500/[0.06]"
                        onClick={() => { setDeleteInvId(invDetailData.id); setInvDetailOpen(false) }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </ResponsiveDialogHeader>

          {invDetailLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-16 bg-white/[0.04] rounded-xl" />
              <Skeleton className="h-24 bg-white/[0.04] rounded-xl" />
              <Skeleton className="h-16 bg-white/[0.04] rounded-xl" />
            </div>
          ) : invDetailError ? (
            <div className="py-8 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-400/60 mx-auto mb-2" />
              <p className="text-xs text-slate-400">{invDetailError}</p>
              <Button size="sm" variant="ghost" className="mt-3 h-8 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]" onClick={() => setInvDetailOpen(false)}>
                Tutup
              </Button>
            </div>
          ) : invDetailData ? (
            <div className="space-y-4 mt-2 min-w-0 overflow-hidden">
              {/* Info cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Stok Saat Ini</p>
                  <p className={cn('text-lg font-bold', invDetailData.stock <= invDetailData.lowStockAlert ? 'text-red-400' : 'text-white')}>
                    {formatNumber(invDetailData.stock)} <span className="text-xs font-normal text-slate-400">{invDetailData.baseUnit}</span>
                  </p>
                </div>
                <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">HPP Rata-rata</p>
                  <p className="text-lg font-bold text-emerald-400">{formatCurrency(invDetailData.avgCost)}</p>
                  <p className="text-[10px] text-slate-500">per {invDetailData.baseUnit}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04] text-center">
                  <p className="text-sm font-bold text-white">{formatCurrency(invDetailData.stock * invDetailData.avgCost)}</p>
                  <p className="text-[10px] text-slate-500">Total Nilai</p>
                </div>
                <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04] text-center">
                  <p className="text-sm font-bold text-white">{invDetailData._count.compositions}</p>
                  <p className="text-[10px] text-slate-500">Komposisi</p>
                </div>
                <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04] text-center">
                  <p className="text-sm font-bold text-white">{invDetailData._count.movements}</p>
                  <p className="text-[10px] text-slate-500">Movement</p>
                </div>
              </div>

              {/* Detail fields */}
              <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">SKU</span>
                  <span className="text-xs text-slate-200 font-mono">{invDetailData.sku || '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Satuan Dasar</span>
                  <span className="text-xs text-slate-200">{invDetailData.baseUnit}</span>
                </div>
                {invDetailData.category && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Kategori</span>
                    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 leading-none border font-medium', getCategoryColorClasses(invDetailData.category.color)?.bg, getCategoryColorClasses(invDetailData.category.color)?.text, getCategoryColorClasses(invDetailData.category.color)?.border)}>
                      {invDetailData.category.name}
                    </Badge>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Low Stock Alert</span>
                  <span className="text-xs text-slate-200">{formatNumber(invDetailData.lowStockAlert)} {invDetailData.baseUnit}</span>
                </div>
              </div>

              {/* Tabs: Produk Terkait & Movement */}
              <Tabs value={invDetailTab} onValueChange={setInvDetailTab} className="w-full min-w-0">
                <TabsList className="bg-white/[0.04] h-8 w-full grid grid-cols-2 min-w-0">
                  <TabsTrigger value="products" className="text-[10px] h-7 gap-1 data-[state=active]:bg-white/[0.08] text-slate-400 data-[state=active]:text-white">
                    <Link2 className="h-3 w-3" />
                    Produk Terkait ({invDetailData.linkedProducts.length})
                  </TabsTrigger>
                  <TabsTrigger value="movements" className="text-[10px] h-7 gap-1 data-[state=active]:bg-white/[0.08] text-slate-400 data-[state=active]:text-white">
                    <Activity className="h-3 w-3" />
                    Movement ({invDetailData._count.movements})
                  </TabsTrigger>
                </TabsList>

                {/* Linked Products Tab */}
                <TabsContent value="products" className="mt-3">
                  {invDetailData.linkedProducts.length === 0 ? (
                    <div className="py-8 text-center">
                      <Link2 className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs text-slate-500">Item ini belum ditautkan ke produk manapun.</p>
                      <p className="text-[10px] text-slate-600 mt-1">Gunakan komposisi di form produk untuk menautkan.</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto overflow-x-hidden pr-1">
                      {invDetailData.linkedProducts.map((lp) => (
                        <div key={lp.id} className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.04]">
                          <div className="min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-slate-200 font-medium truncate">
                                {lp.productName}
                                {lp.variantName && <span className="text-slate-400 font-normal"> ({lp.variantName})</span>}
                              </p>
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 leading-none border border-sky-500/20 text-sky-400 bg-sky-500/[0.06] shrink-0">
                                Komposisi
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                              <span className="text-[10px] text-slate-500">
                                Pakai: <span className="text-sky-400 font-medium">{formatNumber(lp.qty)}</span> {lp.baseUnit}
                                {lp.yieldPerBatch > 1 && <span className="text-violet-400"> / {lp.yieldPerBatch} unit</span>}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                Harga: <span className="text-emerald-400 font-medium">{formatCurrency(lp.variantPrice || lp.productPrice)}</span>
                              </span>
                              <span className="text-[10px] text-slate-500">
                                Stok: <span className="text-white font-medium">{lp.productStock}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Movements Tab */}
                <TabsContent value="movements" className="mt-3">
                  {invDetailData.movements.length === 0 ? (
                    <div className="py-8 text-center">
                      <Activity className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs text-slate-500">Belum ada riwayat pergerakan stok.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto overflow-x-hidden pr-1">
                      {invDetailData.movements.map((m) => (
                        <div key={m.id} className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-white/[0.02] border border-white/[0.03] min-w-0">
                          <div className={cn(
                            'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                            m.quantity > 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'
                          )}>
                            <ArrowUpDown className={cn('h-3.5 w-3.5', m.quantity > 0 ? 'text-emerald-400' : 'text-red-400')} />
                          </div>
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-200 font-medium truncate">
                                {m.type === 'PURCHASE' ? 'Pembelian' :
                                 m.type === 'CONSUMPTION' ? 'Konsumsi' :
                                 m.type === 'ADJUSTMENT' ? 'Penyesuaian' :
                                 m.type === 'TRANSFER_OUT' ? 'Transfer Keluar' :
                                 m.type === 'TRANSFER_IN' ? 'Transfer Masuk' :
                                 m.type}
                              </span>
                              <span className={cn('text-xs font-bold tabular-nums shrink-0', m.quantity > 0 ? 'text-emerald-400' : 'text-red-400')}>
                                {m.quantity > 0 ? '+' : ''}{formatNumber(m.quantity)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-500 shrink-0">
                                {formatNumber(m.previousStock)} → {formatNumber(m.newStock)}
                              </span>
                              {m.userName && (
                                <span className="text-[10px] text-slate-600 truncate">• {m.userName}</span>
                              )}
                            </div>
                            {m.notes && (
                              <p className="text-[10px] text-slate-500 mt-0.5 truncate">{m.notes}</p>
                            )}
                            <p className="text-[9px] text-slate-600 mt-0.5">{formatDate(m.createdAt)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Movement pagination */}
                  {invDetailData.movementPagination && invDetailData.movementPagination.totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-3 pt-3 border-t border-white/[0.04]">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[10px] text-slate-400 hover:text-white hover:bg-white/[0.04]"
                        disabled={invDetailMovementPage <= 1}
                        onClick={() => {
                          const p = invDetailMovementPage - 1
                          setInvDetailMovementPage(p)
                          void fetchInvDetailMovements(invDetailData.id, p)
                        }}
                      >
                        Prev
                      </Button>
                      <span className="text-[10px] text-slate-500">
                        {invDetailMovementPage} / {invDetailData.movementPagination.totalPages}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[10px] text-slate-400 hover:text-white hover:bg-white/[0.04]"
                        disabled={invDetailMovementPage >= invDetailData.movementPagination.totalPages}
                        onClick={() => {
                          const p = invDetailMovementPage + 1
                          setInvDetailMovementPage(p)
                          void fetchInvDetailMovements(invDetailData.id, p)
                        }}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          ) : null}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </motion.div>
  )
}