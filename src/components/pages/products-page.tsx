'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber, formatDate } from '@/lib/format'
import { usePlan } from '@/hooks/use-plan'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/shared/pagination'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Plus,
  Search,
  Edit,
  Trash2,
  RefreshCw,
  Loader2,
  Eye,
  ArrowUpDown,
  Package,
  TrendingUp,
  // TrendingDown removed — unused after redesign
  DollarSign,
  BarChart3,
  Clock,
  User,
  ShoppingCart,
  ListChecks,
  Tag,
  X,
  AlertTriangle,
  PackageX,
  ChevronDown,
  ChevronRight,
  Tags,
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Layers,
  FilePenLine,
  ScanBarcode,
  Printer,
} from 'lucide-react'
// Collapsible removed — analytics section removed in redesign
import { ProGate } from '@/components/shared/pro-gate'
import ProductFormDialog from './product-form-dialog'
import dynamic from 'next/dynamic'

const BarcodeDisplay = dynamic(() => import('@/components/shared/barcode-display'), { ssr: false })
const BatchBarcodeDialog = dynamic(() => import('@/components/shared/batch-barcode-dialog'), { ssr: false })

interface Category {
  id: string
  name: string
  color: string
  _count?: { products: number }
}

interface Product {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  hpp: number
  price: number
  bruto: number
  netto: number
  stock: number
  lowStockAlert: number
  image: string | null
  categoryId: string | null
  category?: { id: string; name: string; color: string } | null
  unit: string
  hasVariants?: boolean
  _variantCount?: number
  _maxPrice?: number
  variants?: Array<{
    id: string
    name: string
    sku: string | null
    barcode: string | null
    price: number
    hpp: number
    stock: number
  }>
}

interface ProductStats {
  total: number
  categories: number
  lowStock: number
  inventoryValue: number
}

interface ProductListResponse {
  products: Product[]
  totalPages: number
  stats: ProductStats
}

type SortOption = 'newest' | 'best-selling' | 'low-stock' | 'most-stock'

interface MovementLog {
  id: string
  action: string
  entityType: string
  details: Record<string, unknown>
  user: {
    id: string
    name: string | null
    email: string | null
    role: string
  }
  createdAt: string
}

interface MovementResponse {
  product: Product
  summary: {
    totalSold: number
    totalRestocked: number
    currentStock: number
    revenue: number
    lastRestockDate: string | null
  }
  movements: MovementLog[]
  totalPages: number
  totalLogs: number
}

type MovementFilterTab = 'all' | 'restock' | 'sale' | 'adjustment'

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Terbaru' },
  { value: 'best-selling', label: 'Terlaris' },
  { value: 'low-stock', label: 'Stock Menipis' },
  { value: 'most-stock', label: 'Stock Terbanyak' },
]

const CATEGORY_COLORS = [
  'zinc', 'emerald', 'amber', 'rose', 'violet', 'sky',
  'cyan', 'orange', 'lime', 'teal', 'fuchsia', 'pink', 'indigo',
] as const

type CategoryColor = (typeof CATEGORY_COLORS)[number]

function getColorClasses(color: string) {
  const map: Record<string, { bg: string; text: string; border: string; dot: string; chipBg: string }> = {
    zinc: { bg: 'bg-zinc-500/10', text: 'text-zinc-300', border: 'border-zinc-500/20', dot: 'bg-zinc-400', chipBg: 'bg-zinc-500/5 border-zinc-500/20 hover:bg-zinc-500/10' },
    emerald: { bg: 'theme-bg-very-light', text: 'theme-text', border: 'theme-border-light', dot: 'theme-bg-light', chipBg: 'theme-bg-ultra-light theme-border-light hover:theme-bg-very-light' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-400', chipBg: 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', dot: 'bg-rose-400', chipBg: 'bg-rose-500/5 border-rose-500/20 hover:bg-rose-500/10' },
    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', dot: 'bg-violet-400', chipBg: 'bg-violet-500/5 border-violet-500/20 hover:bg-violet-500/10' },
    sky: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/20', dot: 'bg-sky-400', chipBg: 'bg-sky-500/5 border-sky-500/20 hover:bg-sky-500/10' },
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', dot: 'bg-cyan-400', chipBg: 'bg-cyan-500/5 border-cyan-500/20 hover:bg-cyan-500/10' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20', dot: 'bg-orange-400', chipBg: 'bg-orange-500/5 border-orange-500/20 hover:bg-orange-500/10' },
    lime: { bg: 'bg-lime-500/10', text: 'text-lime-400', border: 'border-lime-500/20', dot: 'bg-lime-400', chipBg: 'bg-lime-500/5 border-lime-500/20 hover:bg-lime-500/10' },
    teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/20', dot: 'bg-teal-400', chipBg: 'bg-teal-500/5 border-teal-500/20 hover:bg-teal-500/10' },
    fuchsia: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-400', border: 'border-fuchsia-500/20', dot: 'bg-fuchsia-400', chipBg: 'bg-fuchsia-500/5 border-fuchsia-500/20 hover:bg-fuchsia-500/10' },
    pink: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/20', dot: 'bg-pink-400', chipBg: 'bg-pink-500/5 border-pink-500/20 hover:bg-pink-500/10' },
    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20', dot: 'bg-indigo-400', chipBg: 'bg-indigo-500/5 border-indigo-500/20 hover:bg-indigo-500/10' },
  }
  return map[color] || map['zinc']
}

function getColorDotClasses(color: string): string {
  const map: Record<string, string> = {
    zinc: 'bg-zinc-400', emerald: 'theme-bg-light', amber: 'bg-amber-400', rose: 'bg-rose-400',
    violet: 'bg-violet-400', sky: 'bg-sky-400', cyan: 'bg-cyan-400', orange: 'bg-orange-400',
    lime: 'bg-lime-400', teal: 'bg-teal-400', fuchsia: 'bg-fuchsia-400', pink: 'bg-pink-400',
    indigo: 'bg-indigo-400',
  }
  return map[color] || 'bg-zinc-400'
}

function hasStockChange(details?: Record<string, unknown>): boolean {
  if (!details) return false
  // PRODUCT_VARIANT logs store stock at top level
  if (details.stock && typeof details.stock === 'object') return true
  // Parent product BULK_UPDATE logs store stock under changes.stock
  const changes = details.changes as Record<string, unknown> | undefined
  if (changes && typeof changes === 'object' && changes.stock) return true
  return false
}

function getStockDiff(details: Record<string, unknown>): { from: number; to: number } | null {
  // PRODUCT_VARIANT logs store stock at top level
  if (details.stock && typeof details.stock === 'object') {
    return details.stock as { from: number; to: number }
  }
  // Parent product BULK_UPDATE logs store stock under changes.stock
  const changes = details.changes as Record<string, { from: number; to: number }> | undefined
  if (changes && typeof changes === 'object' && changes.stock) {
    return changes.stock
  }
  return null
}

function getActionBadge(action: string, details?: Record<string, unknown>) {
  // Show restock badge for stock-related bulk updates
  if (action === 'BULK_UPDATE' && hasStockChange(details)) {
    return <Badge className="theme-bg-very-light theme-border-light theme-text text-[10px]">Restock</Badge>
  }
  switch (action) {
    case 'CREATE':
      return <Badge className="bg-blue-500/10 border-blue-500/20 text-blue-400 text-[10px]">Create</Badge>
    case 'RESTOCK':
      return <Badge className="theme-bg-very-light theme-border-light theme-text text-[10px]">Restock</Badge>
    case 'SALE':
      return <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">Sale</Badge>
    case 'UPDATE':
      return <Badge className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px]">Update</Badge>
    case 'DELETE':
      return <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px]">Delete</Badge>
    case 'ADJUSTMENT':
      return <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 text-[10px]">Adjustment</Badge>
    case 'BULK_UPDATE':
      return <Badge className="bg-cyan-500/10 border-cyan-500/20 text-cyan-400 text-[10px]">Bulk Update</Badge>
    default:
      return <Badge className="bg-zinc-500/10 border-zinc-500/20 text-zinc-400 text-[10px]">{action}</Badge>
  }
}

function getActionDescription(action: string, details: Record<string, unknown>): string {
  const variantName = details.variantName as string | undefined
  const variantLabel = variantName ? ` [${variantName}]` : ''
  const parentName = details.parentProductName as string | undefined
  const parentLabel = parentName ? ` (${parentName})` : ''

  switch (action) {
    case 'CREATE':
      return `Product created — Price: ${formatCurrency(Number(details.price) || 0)}, Stock: ${formatNumber(Number(details.stock) || 0)}`
    case 'RESTOCK':
      return `+${formatNumber(Number(details.quantityAdded) || 0)} units${variantLabel} (Stock: ${formatNumber(Number(details.previousStock) || 0)} → ${formatNumber(Number(details.newStock) || 0)})`
    case 'SALE':
      return `Sold ${formatNumber(Number(details.quantitySold) || Number(details.qty) || 0)} units${variantLabel} — ${formatCurrency(Number(details.subtotal) || 0)}`
    case 'UPDATE':
      if (details.variantCount !== undefined) {
        return `Product updated — ${Number(details.variantCount)} variant(s)`
      }
      if (details.changes && typeof details.changes === 'object') {
        const changes = details.changes as Record<string, { from: unknown; to: unknown }>
        const parts: string[] = []
        if (changes.stock) {
          const diff = Number(changes.stock.to) - Number(changes.stock.from)
          parts.push(`Stock: ${formatNumber(Number(changes.stock.from))} → ${formatNumber(Number(changes.stock.to))} (${diff >= 0 ? '+' : ''}${formatNumber(diff)})`)
        }
        if (changes.price) parts.push(`Price: ${formatCurrency(Number(changes.price.from))} → ${formatCurrency(Number(changes.price.to))}`)
        if (parts.length > 0) return parts.join(', ')
      }
      if (variantName) {
        return `Variant "${variantName}" updated`
      }
      return 'Product details updated'
    case 'DELETE':
      return 'Product deleted'
    case 'ADJUSTMENT': {
      const prev = Number(details.previousStock)
      const next = Number(details.newStock)
      const diff = next - prev
      if (!isNaN(prev) && !isNaN(next)) {
        return `Penyesuaian stok: ${formatNumber(prev)} → ${formatNumber(next)} (${diff >= 0 ? '+' : ''}${formatNumber(diff)})${details.reason ? ` — ${details.reason}` : ''}`
      }
      return `Stock adjusted${variantLabel} — ${details.reason || 'No reason'}`
    }
    case 'BULK_UPDATE': {
      const stockDiff = getStockDiff(details)
      if (stockDiff) {
        const diff = stockDiff.to - stockDiff.from
        return `Bulk stock: ${formatNumber(stockDiff.from)} → ${formatNumber(stockDiff.to)} (${diff >= 0 ? '+' : ''}${formatNumber(diff)})${parentLabel}`
      }
      // Check for price changes (top-level or under changes)
      const priceObj = (details.price || (details.changes as Record<string, unknown>)?.price) as { from: number; to: number } | undefined
      if (priceObj && typeof priceObj === 'object') {
        return `Bulk price: ${formatCurrency(priceObj.from)} → ${formatCurrency(priceObj.to)}${parentLabel}`
      }
      return 'Bulk update applied'
    }
    default:
      return 'Action performed'
  }
}

function getActionRowBg(action: string, details?: Record<string, unknown>): string {
  // Stock-related bulk updates get restock color
  if (action === 'BULK_UPDATE' && hasStockChange(details)) {
    return 'theme-bg-ultra-light rounded'
  }
  switch (action) {
    case 'RESTOCK':
      return 'theme-bg-ultra-light rounded'
    case 'SALE':
      return 'bg-amber-500/5 rounded'
    case 'ADJUSTMENT':
      return 'bg-orange-500/5 rounded'
    default:
      return ''
  }
}

export default function ProductsPage() {
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'
  const { plan } = usePlan()
  const isPro = plan?.type === 'pro' || plan?.type === 'enterprise'

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortOption>('newest')
  const [formOpen, setFormOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [restockOpen, setRestockOpen] = useState(false)
  const [restockProduct, setRestockProduct] = useState<Product | null>(null)
  const [restockQty, setRestockQty] = useState('')
  const [restocking, setRestocking] = useState(false)

  // Stock adjustment state
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null)
  const [adjustNewStock, setAdjustNewStock] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)

  // Detail sheet state
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailData, setDetailData] = useState<MovementResponse | null>(null)
  const [detailPage, setDetailPage] = useState(1)
  const [movementFilter, setMovementFilter] = useState<MovementFilterTab>('all')

  // Bulk edit state
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false)
  const [bulkPriceType, setBulkPriceType] = useState<'percent' | 'fixed'>('percent')
  const [bulkPriceValue, setBulkPriceValue] = useState('')
  const [bulkPriceQuick, setBulkPriceQuick] = useState('')
  const [bulkPriceSubmitting, setBulkPriceSubmitting] = useState(false)

  const [bulkStockOpen, setBulkStockOpen] = useState(false)
  const [bulkStockType, setBulkStockType] = useState<'add' | 'subtract' | 'set'>('add')
  const [bulkStockValue, setBulkStockValue] = useState('')
  const [bulkStockSubmitting, setBulkStockSubmitting] = useState(false)

  // Bulk category change state
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false)
  const [bulkCategoryId, setBulkCategoryId] = useState<string>('')
  const [bulkCategorySubmitting, setBulkCategorySubmitting] = useState(false)

  // Bulk delete state
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteSubmitting, setBulkDeleteSubmitting] = useState(false)

  // Select all mode (cross-page selection)
  const [selectAllMode, setSelectAllMode] = useState(false)

  // Bulk upload Excel state
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadPhase, setUploadPhase] = useState('')
  const [uploadResult, setUploadResult] = useState<{
    created: number
    skipped: number
    variantsCreated: number
    variantsSkipped: number
    errors: string[]
  } | null>(null)
  const [uploadDragOver, setUploadDragOver] = useState(false)

  // Export Excel state
  const [exporting, setExporting] = useState(false)

  // Edit Excel state
  const [editExcelOpen, setEditExcelOpen] = useState(false)
  const [editExcelFile, setEditExcelFile] = useState<File | null>(null)
  const [editExcelUploading, setEditExcelUploading] = useState(false)
  const [editExcelProgress, setEditExcelProgress] = useState(0)
  const [editExcelPhase, setEditExcelPhase] = useState('')
  const [batchBarcodeOpen, setBatchBarcodeOpen] = useState(false)
  const [editExcelResult, setEditExcelResult] = useState<{
    updated: number
    notFound: number
    variantsUpdated: number
    variantsNotFound: number
    errors: string[]
  } | null>(null)
  const [editExcelDragOver, setEditExcelDragOver] = useState(false)
  const editExcelProgressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Category management state
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [categorySectionOpen, setCategorySectionOpen] = useState(true)
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [editCategory, setEditCategory] = useState<Category | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryColor, setCategoryColor] = useState<string>('zinc')
  const [categorySaving, setCategorySaving] = useState(false)
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null)
  const [deleteCategoryProductCount, setDeleteCategoryProductCount] = useState(0)
  const [categoryDeleting, setCategoryDeleting] = useState(false)

  // Analytics stats from API (all products, not just current page)
  const [stats, setStats] = useState<ProductStats>({ total: 0, categories: 0, lowStock: 0, inventoryValue: 0 })

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories')
      if (res.ok) {
        const data = await res.json()
        setCategories(data.categories || [])
      }
    } catch {
      // silently fail
    } finally {
      setCategoriesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('search', search)
      if (sort !== 'newest') params.set('sort', sort)
      if (activeCategoryId) params.set('categoryId', activeCategoryId)
      const res = await fetch(`/api/products?${params}`)
      if (res.ok) {
        const data: ProductListResponse = await res.json()
        setProducts(data.products)
        setTotalPages(data.totalPages)
        if (data.stats) {
          setStats(data.stats)
        }
      } else {
        toast.error('Failed to load products')
      }
    } catch {
      toast.error('Failed to load products')
    } finally {
      setLoading(false)
    }
  }, [page, search, sort, activeCategoryId])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, sort, activeCategoryId])

  const fetchDetail = useCallback(async (product: Product, pageNum: number) => {
    setDetailLoading(true)
    try {
      const params = new URLSearchParams({ page: String(pageNum), limit: '20' })
      const res = await fetch(`/api/products/${product.id}/movement?${params}`)
      if (res.ok) {
        const data: MovementResponse = await res.json()
        setDetailData(data)
      } else {
        toast.error('Failed to load product details')
      }
    } catch {
      toast.error('Failed to load product details')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const openDetail = (product: Product) => {
    setDetailProduct(product)
    setDetailPage(1)
    setDetailData(null)
    setMovementFilter('all')
    setDetailOpen(true)
  }

  useEffect(() => {
    if (detailOpen && detailProduct) {
      fetchDetail(detailProduct, detailPage)
    }
  }, [detailOpen, detailProduct, detailPage, fetchDetail])

  const handleEdit = (product: Product) => {
    setEditProduct(product)
    setFormOpen(true)
  }

  const handleAdd = () => {
    setEditProduct(null)
    setFormOpen(true)
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/products/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Product deleted')
        fetchProducts()
      } else {
        toast.error('Failed to delete product')
      }
    } catch {
      toast.error('Failed to delete product')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const handleRestock = async () => {
    if (!restockProduct || !restockQty || Number(restockQty) <= 0) return
    if (restockProduct.hasVariants) {
      toast.error('Produk dengan varian tidak bisa di-restock langsung. Gunakan edit produk untuk mengubah stok varian.')
      setRestockOpen(false)
      return
    }
    setRestocking(true)
    try {
      const res = await fetch(`/api/products/${restockProduct.id}/restock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: Number(restockQty) }),
      })
      if (res.ok) {
        toast.success(`Restocked ${restockProduct.name} +${restockQty}`)
        fetchProducts()
        if (detailOpen && detailProduct?.id === restockProduct.id) {
          fetchDetail({ ...restockProduct, stock: restockProduct.stock + Number(restockQty) }, detailPage)
        }
      } else {
        toast.error('Failed to restock')
      }
    } catch {
      toast.error('Failed to restock')
    } finally {
      setRestocking(false)
      setRestockOpen(false)
      setRestockQty('')
      setRestockProduct(null)
    }
  }

  const handleAdjust = async () => {
    if (!adjustProduct || adjustNewStock === '' || Number(adjustNewStock) < 0) return
    if (adjustProduct.hasVariants) {
      toast.error('Produk dengan varian tidak bisa di-penyesuaian langsung. Gunakan edit produk.')
      setAdjustOpen(false)
      return
    }
    const newStock = Number(adjustNewStock)
    const oldStock = adjustProduct.stock
    setAdjusting(true)
    try {
      const res = await fetch(`/api/products/${adjustProduct.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStock, reason: adjustReason || undefined }),
      })
      if (res.ok) {
        const diff = newStock - oldStock
        const diffStr = diff >= 0 ? `+${diff}` : `${diff}`
        toast.success(`Stok disesuaikan: ${oldStock} → ${newStock} (${diffStr})`)
        fetchProducts()
        if (detailOpen && detailProduct?.id === adjustProduct.id) {
          fetchDetail({ ...adjustProduct, stock: newStock }, detailPage)
        }
      } else {
        toast.error('Gagal menyesuaikan stok')
      }
    } catch {
      toast.error('Gagal menyesuaikan stok')
    } finally {
      setAdjusting(false)
      setAdjustOpen(false)
      setAdjustNewStock('')
      setAdjustReason('')
      setAdjustProduct(null)
    }
  }

  // Bulk edit handlers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(products.map((p) => p.id)))
    }
  }

  const handleBulkPrice = async () => {
    if (selectedIds.size === 0 || !bulkPriceValue) return
    setBulkPriceSubmitting(true)
    try {
      const value = Number(bulkPriceValue)
      if (isNaN(value)) {
        toast.error('Invalid value')
        return
      }
      const res = await fetch('/api/products/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: Array.from(selectedIds),
          priceAdjustment: { type: bulkPriceType, value },
          selectAllMode,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Updated ${data.updated} product prices`)
        setBulkPriceOpen(false)
        setBulkPriceValue('')
        setBulkPriceQuick('')
        setSelectedIds(new Set())
        setBulkMode(false)
        setSelectAllMode(false)
        fetchProducts()
      } else {
        toast.error('Failed to update prices')
      }
    } catch {
      toast.error('Failed to update prices')
    } finally {
      setBulkPriceSubmitting(false)
    }
  }

  const handleBulkStock = async () => {
    if (selectedIds.size === 0 || !bulkStockValue) return
    setBulkStockSubmitting(true)
    try {
      const value = Number(bulkStockValue)
      if (isNaN(value)) {
        toast.error('Invalid value')
        return
      }
      const res = await fetch('/api/products/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: Array.from(selectedIds),
          stockAdjustment: { type: bulkStockType, value },
          selectAllMode,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Updated stock for ${data.updated} products`)
        setBulkStockOpen(false)
        setBulkStockValue('')
        setSelectedIds(new Set())
        setBulkMode(false)
        setSelectAllMode(false)
        fetchProducts()
      } else {
        toast.error('Failed to update stock')
      }
    } catch {
      toast.error('Failed to update stock')
    } finally {
      setBulkStockSubmitting(false)
    }
  }

  const handleBulkCategory = async () => {
    if (selectedIds.size === 0 || !bulkCategoryId) return
    setBulkCategorySubmitting(true)
    try {
      const res = await fetch('/api/products/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: Array.from(selectedIds),
          categoryId: bulkCategoryId,
          selectAllMode,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Kategori diperbarui untuk ${data.updated} produk`)
        setBulkCategoryOpen(false)
        setBulkCategoryId('')
        setSelectedIds(new Set())
        setBulkMode(false)
        setSelectAllMode(false)
        fetchProducts()
        fetchCategories()
      } else {
        toast.error('Gagal mengubah kategori')
      }
    } catch {
      toast.error('Gagal mengubah kategori')
    } finally {
      setBulkCategorySubmitting(false)
    }
  }

  // Select all products across all pages (for current filter)
  const handleSelectAll = async () => {
    setSelectAllMode(true)
    // Mark all current page items as selected
    setSelectedIds(new Set(products.map((p) => p.id)))
    toast.info(`Semua ${stats.total} produk dipilih`)
  }

  // Bulk delete handler
  // Simulated progress for bulk upload
  const uploadProgressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const handleBulkUpload = useCallback(async () => {
    if (!uploadFile) return
    setUploading(true)
    setUploadProgress(0)
    setUploadPhase('Mempersiapkan upload...')

    // Simulated progress phases
    // Phase 1: 0-25% — uploading file (fast)
    // Phase 2: 25-60% — parsing & validating data (medium)
    // Phase 3: 60-90% — saving products to database (slower)
    // Phase 4: 90-100% — finishing up (snap on response)
    let progress = 0

    uploadProgressRef.current = setInterval(() => {
      progress += Math.random() * 3 + 0.5
      if (progress > 90) progress = 90
      setUploadProgress(Math.round(progress))

      if (progress < 25) {
        setUploadPhase('Mengupload file...')
      } else if (progress < 60) {
        setUploadPhase('Memproses data produk...')
      } else {
        setUploadPhase('Menyimpan ke database...')
      }
    }, 200)

    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      const res = await fetch('/api/products/bulk-upload', {
        method: 'POST',
        body: formData,
      })

      // Clear interval and snap to 100%
      if (uploadProgressRef.current) {
        clearInterval(uploadProgressRef.current)
        uploadProgressRef.current = null
      }
      setUploadProgress(95)
      setUploadPhase('Menyelesaikan...')

      if (res.ok) {
        const data = await res.json()
        setUploadProgress(100)
        setUploadPhase('Selesai!')
        // Small delay to show 100% before switching to result
        await new Promise((r) => setTimeout(r, 400))
        setUploadResult(data)
        fetchProducts()
        const total = data.created + (data.variantsCreated || 0)
        toast.success(`${total} produk berhasil ditambahkan`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal upload file')
      }
    } catch {
      toast.error('Gagal upload file')
    } finally {
      if (uploadProgressRef.current) {
        clearInterval(uploadProgressRef.current)
        uploadProgressRef.current = null
      }
      setUploading(false)
      setUploadProgress(0)
      setUploadPhase('')
    }
  }, [uploadFile, fetchProducts])

  const handleExportExcel = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/products/export')
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Gagal mengekspor produk')
        return
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `produk-export-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      toast.success('Produk berhasil diekspor')
    } catch {
      toast.error('Gagal mengekspor produk')
    } finally {
      setExporting(false)
    }
  }

  const handleBulkUpdateExcel = useCallback(async () => {
    if (!editExcelFile) return
    setEditExcelUploading(true)
    setEditExcelProgress(0)
    setEditExcelPhase('Mempersiapkan upload...')

    let progress = 0

    editExcelProgressRef.current = setInterval(() => {
      progress += Math.random() * 3 + 0.5
      if (progress > 90) progress = 90
      setEditExcelProgress(Math.round(progress))

      if (progress < 25) {
        setEditExcelPhase('Mengupload file...')
      } else if (progress < 60) {
        setEditExcelPhase('Memproses data produk...')
      } else {
        setEditExcelPhase('Memperbarui database...')
      }
    }, 200)

    try {
      const formData = new FormData()
      formData.append('file', editExcelFile)
      const res = await fetch('/api/products/bulk-update-excel', {
        method: 'POST',
        body: formData,
      })

      if (editExcelProgressRef.current) {
        clearInterval(editExcelProgressRef.current)
        editExcelProgressRef.current = null
      }
      setEditExcelProgress(95)
      setEditExcelPhase('Menyelesaikan...')

      if (res.ok) {
        const data = await res.json()
        setEditExcelProgress(100)
        setEditExcelPhase('Selesai!')
        await new Promise((r) => setTimeout(r, 400))
        setEditExcelResult(data)
        fetchProducts()
        fetchCategories()
        const total = data.updated + (data.variantsUpdated || 0)
        toast.success(`${total} produk berhasil diperbarui`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal update file')
      }
    } catch {
      toast.error('Gagal update file')
    } finally {
      if (editExcelProgressRef.current) {
        clearInterval(editExcelProgressRef.current)
        editExcelProgressRef.current = null
      }
      setEditExcelUploading(false)
      setEditExcelProgress(0)
      setEditExcelPhase('')
    }
  }, [editExcelFile, fetchProducts, fetchCategories])

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    setBulkDeleteSubmitting(true)
    try {
      const res = await fetch('/api/products/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: Array.from(selectedIds),
          selectAllMode,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`${data.deletedCount} produk berhasil dihapus`)
        setBulkDeleteOpen(false)
        setSelectedIds(new Set())
        setBulkMode(false)
        setSelectAllMode(false)
        fetchProducts()
        fetchCategories()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menghapus produk')
      }
    } catch {
      toast.error('Gagal menghapus produk')
    } finally {
      setBulkDeleteSubmitting(false)
    }
  }

  // Category CRUD handlers
  const openCategoryDialog = (cat: Category | null = null) => {
    setEditCategory(cat)
    setCategoryName(cat ? cat.name : '')
    setCategoryColor(cat ? cat.color : 'zinc')
    setCategoryDialogOpen(true)
  }

  const handleCategorySave = async () => {
    if (!categoryName.trim()) {
      toast.error('Nama kategori wajib diisi')
      return
    }
    setCategorySaving(true)
    try {
      const url = editCategory ? `/api/categories/${editCategory.id}` : '/api/categories'
      const method = editCategory ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: categoryName.trim(), color: categoryColor }),
      })
      if (res.ok) {
        toast.success(editCategory ? 'Kategori diperbarui' : 'Kategori ditambahkan')
        setCategoryDialogOpen(false)
        fetchCategories()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menyimpan kategori')
      }
    } catch {
      toast.error('Gagal menyimpan kategori')
    } finally {
      setCategorySaving(false)
    }
  }

  const handleCategoryDelete = async () => {
    if (!deleteCategoryId) return
    setCategoryDeleting(true)
    try {
      const res = await fetch(`/api/categories/${deleteCategoryId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Kategori dihapus')
        if (activeCategoryId === deleteCategoryId) {
          setActiveCategoryId(null)
        }
        fetchCategories()
        fetchProducts()
      } else {
        toast.error('Gagal menghapus kategori')
      }
    } catch {
      toast.error('Gagal menghapus kategori')
    } finally {
      setCategoryDeleting(false)
      setDeleteCategoryId(null)
    }
  }

  const openDeleteCategory = (cat: Category) => {
    setDeleteCategoryId(cat.id)
    setDeleteCategoryProductCount(cat._count?.products || 0)
  }

  // Filtered movements — include stock-related BULK_UPDATE in restock filter
  const filteredMovements = useMemo(() => {
    if (!detailData) return []
    return detailData.movements.filter((m) => {
      if (movementFilter === 'all') return true
      if (movementFilter === 'restock') {
        if (m.action === 'RESTOCK') return true
        if (m.action === 'BULK_UPDATE' && hasStockChange(m.details)) return true
        return false
      }
      if (movementFilter === 'sale') return m.action === 'SALE'
      if (movementFilter === 'adjustment') return m.action === 'ADJUSTMENT'
      return true
    })
  }, [detailData, movementFilter])

  // Analytics collapsible state removed — section removed in redesign

  // Stock aging calculation
  const stockAgingDays = useMemo(() => {
    if (!detailData?.summary.lastRestockDate) return null
    const lastDate = new Date(detailData.summary.lastRestockDate)
    const now = new Date()
    const diff = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
    return diff
  }, [detailData])

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Produk</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Kelola inventori produk kamu</p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 sm:overflow-visible sm:mx-0 sm:px-0 sm:flex-wrap">
          {isPro && isOwner && (
            <Button
              variant={bulkMode ? 'default' : 'outline'}
              onClick={() => {
                setBulkMode(!bulkMode)
                setSelectedIds(new Set())
                setSelectAllMode(false)
              }}
              className={
                bulkMode
                  ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500 h-9 text-xs font-medium shrink-0'
                  : 'bg-zinc-800/80 border-zinc-700/80 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 h-9 text-xs font-medium shrink-0'
              }
            >
              <ListChecks className="mr-1.5 h-3.5 w-3.5" />
              {bulkMode ? 'Edit Massal Aktif' : 'Edit Massal'}
            </Button>
          )}
          <Button onClick={handleExportExcel} disabled={exporting}
              className="bg-zinc-800/80 border-zinc-700/80 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 h-9 text-xs font-medium disabled:opacity-50 shrink-0"
            >
              {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              Export Excel
            </Button>
            <Button
              variant="outline"
              onClick={() => setBatchBarcodeOpen(true)}
              className="bg-zinc-800/80 border-zinc-700/80 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 h-9 text-xs font-medium shrink-0"
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Cetak Barcode
            </Button>
          <ProGate feature="bulkUpload" label="Upload Excel" description="Upload produk massal via file Excel" variant="inline">
            <Button
              variant="outline"
              onClick={() => {
                setUploadOpen(true)
                setUploadFile(null)
                setUploadResult(null)
              }}
              className="bg-zinc-800/80 border-zinc-700/80 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 h-9 text-xs font-medium shrink-0"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Upload Excel
            </Button>
          </ProGate>
          <ProGate feature="bulkUpload" label="Edit Excel" description="Update produk massal via file Excel" variant="inline">
            <Button
              variant="outline"
              onClick={() => {
                setEditExcelOpen(true)
                setEditExcelFile(null)
                setEditExcelResult(null)
                setEditExcelProgress(0)
                setEditExcelPhase('')
              }}
              className="bg-zinc-800/80 border-zinc-700/80 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 h-9 text-xs font-medium shrink-0"
            >
              <FilePenLine className="mr-1.5 h-3.5 w-3.5" />
              Edit Excel
            </Button>
          </ProGate>
          <Button onClick={handleAdd} className="theme-bg theme-hover text-white h-9 text-xs font-medium shadow-lg theme-shadow shrink-0">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Tambah Produk
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {!loading && stats.total > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Total Products */}
          <div className="relative rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3 overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-0.5 theme-gradient" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Total Produk</span>
              <div className="h-8 w-8 rounded-lg theme-bg-very-light flex items-center justify-center">
                <Package className="h-4 w-4 theme-text" />
              </div>
            </div>
            <p className="text-2xl font-bold text-zinc-100 tracking-tight">{formatNumber(stats.total)}</p>
          </div>

          {/* Total Categories */}
          <div className="relative rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3 overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 to-violet-500/40" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Kategori</span>
              <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Tags className="h-4 w-4 text-violet-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-zinc-100 tracking-tight">{formatNumber(stats.categories)}</p>
          </div>

          {/* Low Stock Items */}
          <div className="relative rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3 overflow-hidden group">
            <div className={`absolute top-0 left-0 right-0 h-0.5 ${stats.lowStock > 0 ? 'bg-gradient-to-r from-amber-500 to-amber-500/40' : 'theme-gradient'}`} />
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Stok Rendah</span>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${stats.lowStock > 0 ? 'bg-amber-500/10' : 'theme-bg-very-light'}`}>
                <AlertTriangle className={`h-4 w-4 ${stats.lowStock > 0 ? 'text-amber-400' : 'theme-text'}`} />
              </div>
            </div>
            <p className={`text-2xl font-bold tracking-tight ${stats.lowStock > 0 ? 'text-amber-400' : 'text-zinc-100'}`}>
              {formatNumber(stats.lowStock)}
            </p>
          </div>

          {/* Total Inventory Value */}
          <div className="relative rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3 overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-500 to-sky-500/40" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Nilai Inventori</span>
              <div className="h-8 w-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-sky-400" />
              </div>
            </div>
            <p className="text-2xl font-bold text-zinc-100 tracking-tight">{formatCurrency(stats.inventoryValue)}</p>
          </div>
        </div>
      )}

      {/* Category Management Section */}
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden">
        <button
          onClick={() => setCategorySectionOpen(!categorySectionOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-6 w-6 rounded-md bg-violet-500/10 flex items-center justify-center">
              <Tags className="h-3 w-3 text-violet-400" />
            </div>
            <span className="text-xs font-semibold text-zinc-200">Kategori</span>
            {!categoriesLoading && categories.length > 0 && (
              <span className="text-[11px] text-zinc-500">({categories.length})</span>
            )}
            {activeCategoryId && (
              <Badge className="theme-bg-very-light theme-border-light theme-text text-[10px] px-1.5 py-0 ml-1">
                Filter aktif
                <button
                  onClick={(e) => { e.stopPropagation(); setActiveCategoryId(null) }}
                  className="ml-1 hover:theme-text"
                >
                  <X className="h-2.5 w-2.5 inline" />
                </button>
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={(e) => { e.stopPropagation(); openCategoryDialog(null) }}
              className="theme-bg theme-hover text-white h-7 text-[11px] px-2.5 rounded-lg"
            >
              <Plus className="mr-1 h-3 w-3" />
              Tambah
            </Button>
            {categorySectionOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
            )}
          </div>
        </button>

        {categorySectionOpen && (
          <div className="px-4 pb-3">
            {categoriesLoading ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-28 bg-zinc-800 rounded-full flex-shrink-0" />
                ))}
              </div>
            ) : categories.length === 0 ? (
              <p className="text-[11px] text-zinc-500 py-2">Belum ada kategori. Klik "Tambah" untuk membuat kategori baru.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                {categories.map((cat) => {
                  const colors = getColorClasses(cat.color)
                  const isActive = activeCategoryId === cat.id
                  return (
                    <div
                      key={cat.id}
                      className={`group flex items-center gap-1.5 rounded-full border px-3 py-1.5 flex-shrink-0 cursor-pointer transition-all duration-150 ${
                        isActive
                          ? `${colors.chipBg} ${colors.text} ring-1 ${colors.border} shadow-sm`
                          : 'bg-zinc-800/40 border-zinc-700/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 hover:border-zinc-600'
                      }`}
                      onClick={() => setActiveCategoryId(isActive ? null : cat.id)}
                    >
                      <div className={`h-2 w-2 rounded-full flex-shrink-0 transition-colors ${getColorDotClasses(cat.color)}`} />
                      <span className="text-[11px] font-medium whitespace-nowrap">{cat.name}</span>
                      <span className="text-[10px] opacity-50">{cat._count?.products || 0}</span>
                      <div className="flex items-center gap-0.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button
                          onClick={(e) => { e.stopPropagation(); openCategoryDialog(cat) }}
                          className="hover:theme-text text-zinc-500 hover:bg-zinc-700/80 rounded p-0.5"
                          title="Edit"
                        >
                          <Edit className="h-2.5 w-2.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openDeleteCategory(cat) }}
                          className="hover:text-red-400 text-zinc-500 hover:bg-zinc-700/80 rounded p-0.5"
                          title="Hapus"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search & Sort */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <Input
            placeholder="Cari produk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs bg-zinc-800/60 border-zinc-700/80 text-zinc-100 placeholder:text-zinc-500 rounded-lg focus-visible:ring-zinc-600"
          />
        </div>
        <Select value={sort} onValueChange={(val) => setSort(val as SortOption)}>
          <SelectTrigger className="w-full sm:w-[180px] h-9 text-xs bg-zinc-800/60 border-zinc-700/80 text-zinc-100 rounded-lg">
            <ArrowUpDown className="mr-2 h-3.5 w-3.5 text-zinc-500" />
            <SelectValue placeholder="Urutkan" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            {SORT_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-zinc-200 focus:bg-zinc-700 focus:text-zinc-100"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 bg-zinc-900 rounded-lg" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900 p-8 text-center">
            <Package className="mx-auto h-8 w-8 text-zinc-700 mb-2" />
            <p className="text-sm text-zinc-500">Tidak ada produk ditemukan</p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800/80 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800/80 hover:bg-transparent bg-zinc-900/80">
                  {bulkMode && (
                    <TableHead className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider w-10">
                      <Checkbox
                        checked={selectedIds.size === products.length && products.length > 0}
                        onCheckedChange={toggleSelectAll}
                        className="border-zinc-600 data-[state=checked]:theme-bg data-[state=checked]:theme-border"
                      />
                    </TableHead>
                  )}
                  <TableHead
                    className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-zinc-300 transition-colors"
                    onClick={() => setSort(prev => prev === 'newest' ? 'newest' : 'newest')}
                  >
                    <span className="inline-flex items-center gap-1">Nama</span>
                  </TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Kategori</TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">SKU</TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Satuan</TableHead>
                  {isOwner && (
                    <TableHead className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider text-right">HPP</TableHead>
                  )}
                  <TableHead
                    className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider text-right cursor-pointer select-none hover:text-zinc-300 transition-colors"
                    onClick={() => setSort(prev => prev === 'most-stock' ? 'newest' : 'most-stock')}
                  >
                    <span className="inline-flex items-center gap-1">Harga</span>
                  </TableHead>
                  <TableHead
                    className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider text-right cursor-pointer select-none hover:text-zinc-300 transition-colors"
                    onClick={() => setSort(prev => prev === 'low-stock' ? 'most-stock' : 'low-stock')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Stok
                      {sort === 'low-stock' && <span className="theme-text">↑</span>}
                      {sort === 'most-stock' && <span className="text-amber-400">↓</span>}
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider text-right w-[130px] cursor-pointer select-none hover:text-zinc-300 transition-colors"
                    onClick={() => setSort(prev => prev === 'best-selling' ? 'newest' : 'best-selling')}
                  >
                    <span className="inline-flex items-center gap-1">
                      Aksi
                      {sort === 'best-selling' && <span className="theme-text">🔥</span>}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const isOutOfStock = product.stock === 0
                  const isLowStock = product.stock > 0 && product.stock <= product.lowStockAlert
                  const isSelected = selectedIds.has(product.id)

                  let rowClass = 'border-zinc-800/60 hover:bg-zinc-800/40 transition-colors'
                  if (isPro) {
                    if (isOutOfStock) {
                      rowClass = 'border-zinc-800/60 bg-red-500/[0.03] hover:bg-red-500/[0.06] transition-colors'
                    } else if (isLowStock) {
                      rowClass = 'border-zinc-800/60 bg-amber-500/[0.03] hover:bg-amber-500/[0.06] transition-colors'
                    }
                  }

                  return (
                    <TableRow key={product.id} className={rowClass}>
                      {bulkMode && (
                        <TableCell className="w-10 py-3 px-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(product.id)}
                            className="border-zinc-600 data-[state=checked]:theme-bg data-[state=checked]:theme-border"
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-xs text-zinc-100 font-medium py-3 px-3">
                        <div className="flex items-center gap-2">
                          {product.image ? (
                            <div className="h-8 w-8 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0">
                              <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                            </div>
                          ) : (
                            <div className="h-8 w-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                              <Package className="h-3.5 w-3.5 text-zinc-600" />
                            </div>
                          )}
                          <div className="flex flex-col gap-0.5">
                            <span className="flex items-center gap-1.5">
                              {isPro && isOutOfStock && (
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                                </span>
                              )}
                              {isPro && isLowStock && !isOutOfStock && (
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
                                </span>
                              )}
                              {product.name}
                              {product.hasVariants && product._variantCount != null && product._variantCount > 0 && (
                                <Badge className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px] px-1.5 py-0 ml-1.5 inline-flex items-center gap-0.5">
                                  <Layers className="h-2.5 w-2.5" />
                                  {product._variantCount} varian
                                </Badge>
                              )}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs py-3 px-3">
                        {product.category ? (
                          <div className="flex items-center gap-1.5">
                            <div className={`h-2 w-2 rounded-full flex-shrink-0 ${getColorDotClasses(product.category.color)}`} />
                            <span className={`text-[11px] font-medium ${getColorClasses(product.category.color).text}`}>
                              {product.category.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-zinc-600">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500 font-mono py-3 px-3">{product.sku || '-'}</TableCell>
                      <TableCell className="text-xs py-3 px-3">
                        <Badge className="bg-sky-500/10 border-sky-500/20 text-sky-400 text-[10px] px-1.5 py-0">
                          {product.unit || 'pcs'}
                        </Badge>
                      </TableCell>
                      {isOwner && (
                        <TableCell className="text-xs text-zinc-400 text-right py-3 px-3">{formatCurrency(product.hpp)}</TableCell>
                      )}
                      <TableCell className="text-xs text-zinc-100 font-medium text-right py-3 px-3">
                        {product.hasVariants && product._maxPrice && product._maxPrice !== product.price
                          ? <>{formatCurrency(product.price)}<span className="text-zinc-500"> ~ </span>{formatCurrency(product._maxPrice)}</>
                          : formatCurrency(product.price)
                        }
                      </TableCell>
                      <TableCell className="text-xs text-right py-3 px-3">
                        {isPro ? (
                          <div className="flex items-center justify-end gap-1.5">
                            {isOutOfStock ? (
                              <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px] px-2 py-0.5">
                                <PackageX className="mr-0.5 h-2.5 w-2.5" />
                                HABIS
                              </Badge>
                            ) : isLowStock ? (
                              <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px] px-2 py-0.5">
                                {formatNumber(product.stock)}
                              </Badge>
                            ) : (
                              <span className="text-zinc-200">{formatNumber(product.stock)}</span>
                            )}
                          </div>
                        ) : product.stock <= product.lowStockAlert ? (
                          <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px] px-2 py-0.5">
                            {formatNumber(product.stock)}
                          </Badge>
                        ) : (
                          <span className="text-zinc-200">{formatNumber(product.stock)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right py-3 px-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-zinc-500 hover:text-sky-400 hover:bg-sky-500/10 rounded-lg"
                            onClick={() => openDetail(product)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-7 w-7 rounded-lg ${product.hasVariants ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-500 hover:theme-text hover:theme-bg-very-light'}`}
                            onClick={() => {
                              if (product.hasVariants) {
                                toast.info('Produk varian tidak bisa di-restock langsung. Gunakan edit produk.')
                                return
                              }
                              setRestockProduct(product)
                              setRestockQty('')
                              setRestockOpen(true)
                            }}
                            disabled={!!product.hasVariants}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg"
                            onClick={() => handleEdit(product)}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                            onClick={() => setDeleteId(product.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden">
        {/* Mobile bulk select-all bar */}
        {bulkMode && !loading && products.length > 0 && (
          <div className="flex items-center gap-2 mb-3 px-1">
            <Checkbox
              checked={selectAllMode || (selectedIds.size === products.length && products.length > 0)}
              onCheckedChange={selectAllMode ? () => { setSelectAllMode(false); setSelectedIds(new Set()) } : toggleSelectAll}
              className="border-zinc-600 data-[state=checked]:theme-bg data-[state=checked]:theme-border"
            />
            <span className="text-[11px] text-zinc-400">
              {selectAllMode
                ? <><span className="theme-text font-medium">Semua {stats.total}</span> produk dipilih</>
                : selectedIds.size === products.length
                  ? <><span className="theme-text font-medium">Semua di halaman</span> dipilih</>
                  : <>{selectedIds.size}/{products.length} dipilih</>
              }
            </span>
            {!selectAllMode && stats.total > products.length && (
              <button
                onClick={handleSelectAll}
                className="text-[10px] theme-text hover:theme-text ml-auto"
              >
                Pilih semua ({stats.total})
              </button>
            )}
          </div>
        )}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-zinc-900 border border-zinc-800/60 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="h-10 w-10 bg-zinc-800 rounded-lg flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-3/4 bg-zinc-800 rounded" />
                    <Skeleton className="h-3 w-1/2 bg-zinc-800 rounded" />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <Skeleton className="h-3 w-16 bg-zinc-800 rounded" />
                  <Skeleton className="h-5 w-24 bg-zinc-800 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-8 text-center">
            <Package className="mx-auto h-8 w-8 text-zinc-600 mb-2" />
            <p className="text-sm text-zinc-500">Tidak ada produk ditemukan</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {products.map((product) => {
              const isOutOfStock = product.stock === 0
              const isLowStock = product.stock > 0 && product.stock <= product.lowStockAlert

              let cardBorder = 'border-zinc-800/60'
              if (isPro) {
                if (isOutOfStock) cardBorder = 'border-red-500/20'
                else if (isLowStock) cardBorder = 'border-amber-500/20'
              }

              let cardBg = 'bg-zinc-900'
              if (isPro) {
                if (isOutOfStock) cardBg = 'bg-red-500/[0.03]'
                else if (isLowStock) cardBg = 'bg-amber-500/[0.03]'
              }

              return (
                <div
                  key={product.id}
                  className={`rounded-xl ${cardBg} border ${cardBorder} p-4 transition-colors active:bg-zinc-800/80`}
                >
                  {/* Main: Image + Info row */}
                  <div className="flex items-start gap-3 mb-3">
                    {/* Thumbnail */}
                    <div className="flex-shrink-0">
                      {bulkMode ? (
                        <div className="flex flex-col items-center gap-1.5">
                          <Checkbox
                            checked={selectedIds.has(product.id)}
                            onCheckedChange={() => toggleSelect(product.id)}
                            className="border-zinc-600 data-[state=checked]:theme-bg data-[state=checked]:theme-border"
                          />
                          {product.image ? (
                            <div className="h-10 w-10 rounded-lg bg-zinc-800 overflow-hidden">
                              <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                            </div>
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-zinc-800/60 flex items-center justify-center">
                              <Package className="h-4 w-4 text-zinc-600" />
                            </div>
                          )}
                        </div>
                      ) : product.image ? (
                        <div className="h-11 w-11 rounded-lg bg-zinc-800 overflow-hidden">
                          <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                        </div>
                      ) : (
                        <div className="h-11 w-11 rounded-lg bg-zinc-800/60 flex items-center justify-center">
                          <Package className="h-4.5 w-4.5 text-zinc-600" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-zinc-100 truncate leading-tight">
                          {product.name}
                          {product.hasVariants && product._variantCount != null && product._variantCount > 0 && (
                            <Badge className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px] px-1.5 py-0 ml-1.5 inline-flex items-center gap-0.5">
                              <Layers className="h-2.5 w-2.5" />
                              {product._variantCount} varian
                            </Badge>
                          )}
                        </span>
                        {isPro && (
                          <div className="flex-shrink-0">
                            {isOutOfStock ? (
                              <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px] px-1.5 py-0">
                                <PackageX className="mr-0.5 h-2.5 w-2.5" />
                                HABIS
                              </Badge>
                            ) : isLowStock ? (
                              <span className="relative flex h-2 w-2 mt-1">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                      {/* Category + Unit */}
                      <div className="flex items-center gap-1.5 mt-1">
                        {product.category ? (
                          <div className="flex items-center gap-1 bg-zinc-800/40 rounded-md px-1.5 py-0.5">
                            <div className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${getColorDotClasses(product.category.color)}`} />
                            <span className={`text-[10px] font-medium ${getColorClasses(product.category.color).text}`}>
                              {product.category.name}
                            </span>
                          </div>
                        ) : null}
                        {product.sku && (
                          <span className="text-[10px] text-zinc-600 font-mono">{product.sku}</span>
                        )}
                        <Badge className="bg-sky-500/10 border-sky-500/20 text-sky-400 text-[10px] px-1.5 py-0 ml-auto">
                          {product.unit || 'pcs'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Price + Stock + Actions row */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      {isOwner && (
                        <span className="text-[10px] text-zinc-500">
                          HPP {formatCurrency(product.hpp)}
                        </span>
                      )}
                      <span className="text-sm font-bold text-zinc-100">
                        {product.hasVariants && product._maxPrice && product._maxPrice !== product.price
                          ? <>{formatCurrency(product.price)}<span className="text-zinc-500 text-xs"> ~ </span><span className="text-xs">{formatCurrency(product._maxPrice)}</span></>
                          : formatCurrency(product.price)
                        }
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isPro ? (
                        isOutOfStock ? null : (
                          <Badge
                            className={
                              isLowStock
                                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 text-[11px] px-2 py-0.5 font-medium'
                                : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 text-[11px] px-2 py-0.5 font-medium'
                            }
                          >
                            {formatNumber(product.stock)}
                          </Badge>
                        )
                      ) : (
                        <Badge
                          className={
                            product.stock <= product.lowStockAlert
                              ? 'bg-red-500/10 border-red-500/20 text-red-400 text-[11px] px-2 py-0.5 font-medium'
                              : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 text-[11px] px-2 py-0.5 font-medium'
                          }
                        >
                          {formatNumber(product.stock)}
                        </Badge>
                      )}
                      {/* Action buttons - compact */}
                      <div className="flex items-center gap-0.5 bg-zinc-800/40 rounded-lg p-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-500 hover:text-sky-400 hover:bg-sky-500/10 rounded-md"
                          onClick={() => openDetail(product)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 rounded-md ${product.hasVariants ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-500 hover:theme-text hover:theme-bg-very-light'}`}
                          onClick={() => {
                            if (product.hasVariants) {
                              toast.info('Produk varian tidak bisa di-restock langsung. Gunakan edit produk.')
                              return
                            }
                            setRestockProduct(product)
                            setRestockQty('')
                            setRestockOpen(true)
                          }}
                          disabled={!!product.hasVariants}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 rounded-md"
                          onClick={() => handleEdit(product)}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-md"
                          onClick={() => setDeleteId(product.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      {/* Floating Bulk Edit Bar */}
      {bulkMode && selectedIds.size > 0 && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 z-40 md:z-50 border-t border-zinc-700 bg-zinc-900/95 backdrop-blur-sm p-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full theme-bg shrink-0" />
                <span className="text-xs text-zinc-300 whitespace-nowrap">
                  <span className="font-semibold theme-text">{selectedIds.size}</span> dipilih
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSelectedIds(new Set()); setSelectAllMode(false) }}
                className="text-zinc-500 hover:text-zinc-300 h-7 text-[11px] px-2"
              >
                <X className="mr-1 h-3 w-3" />
                Batal
              </Button>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
              {!selectAllMode && stats.total > products.length && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleSelectAll}
                  className="text-zinc-500 hover:text-zinc-300 h-7 text-[11px] px-2 border border-zinc-700"
                >
                  <ListChecks className="mr-1 h-3 w-3" />
                  Pilih Semua ({stats.total})
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                className="bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 h-7 text-xs"
              >
                <Trash2 className="mr-1.5 h-3 w-3" />
                Hapus
              </Button>
              <Button
                size="sm"
                onClick={() => setBulkPriceOpen(true)}
                className="bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 h-7 text-xs"
              >
                <Tag className="mr-1.5 h-3 w-3" />
                Harga
              </Button>
              <Button
                size="sm"
                onClick={() => setBulkStockOpen(true)}
                className="bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/20 h-7 text-xs"
              >
                <Package className="mr-1.5 h-3 w-3" />
                Stok
              </Button>
              <Button
                size="sm"
                onClick={() => { setBulkCategoryOpen(true); setBulkCategoryId('') }}
                className="bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 h-7 text-xs"
              >
                <Tags className="mr-1.5 h-3 w-3" />
                Kategori
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Product Form Dialog */}
      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editProduct}
        onSaved={() => { fetchProducts(); fetchCategories() }}
      />

      {/* Category Create/Edit Dialog */}
      <ResponsiveDialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-zinc-100 text-sm font-semibold">
              {editCategory ? 'Edit Kategori' : 'Tambah Kategori'}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-zinc-400 text-xs">
              {editCategory ? 'Ubah nama dan warna kategori' : 'Buat kategori baru untuk mengelompokkan produk'}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs">Nama Kategori *</Label>
              <Input
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="Contoh: Minuman, Makanan, Snack"
                className="h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCategorySave() }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs">Warna</Label>
              <div className="flex flex-wrap gap-2 pt-1">
                {CATEGORY_COLORS.map((color) => {
                  const isSelected = categoryColor === color
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCategoryColor(color)}
                      className={`h-7 w-7 rounded-full ${getColorDotClasses(color)} transition-all ${
                        isSelected ? 'ring-2 ring-offset-2 ring-offset-zinc-900 ring-white/50 scale-110' : 'hover:scale-105 opacity-70 hover:opacity-100'
                      }`}
                      title={color}
                    />
                  )
                })}
              </div>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCategoryDialogOpen(false)}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleCategorySave}
              disabled={categorySaving || !categoryName.trim()}
              className="theme-bg theme-hover text-white h-8 text-xs"
            >
              {categorySaving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {editCategory ? 'Simpan' : 'Tambah'}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Category Delete Confirmation */}
      <AlertDialog open={!!deleteCategoryId} onOpenChange={(open) => !open && setDeleteCategoryId(null)}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100 text-sm font-semibold">Hapus Kategori</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs">
              {deleteCategoryProductCount > 0 ? (
                <>
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Perhatian!
                  </span>
                  <br />
                  Kategori ini memiliki <span className="text-zinc-200 font-medium">{deleteCategoryProductCount} produk</span>. Produk akan dikembalikan ke status tanpa kategori.
                </>
              ) : (
                'Apakah Anda yakin ingin menghapus kategori ini? Tindakan ini tidak dapat dibatalkan.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCategoryDelete}
              disabled={categoryDeleting}
              className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs"
            >
              {categoryDeleting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100 text-sm font-semibold">Delete Product</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs">
              Are you sure? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs"
            >
              {deleting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restock Dialog */}
      <ResponsiveDialog open={restockOpen} onOpenChange={setRestockOpen}>
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-zinc-100 text-sm font-semibold">
              Restock: {restockProduct?.name}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="text-xs text-zinc-400">
              Current stock: <span className="text-zinc-200 font-medium">{restockProduct?.stock}</span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs">Quantity to add</Label>
              <Input
                type="number"
                min="1"
                placeholder="Enter quantity"
                value={restockQty}
                onChange={(e) => setRestockQty(e.target.value)}
                className="h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRestockOpen(false)}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRestock}
              disabled={restocking || !restockQty || Number(restockQty) <= 0}
              className="theme-bg theme-hover text-white h-8 text-xs"
            >
              {restocking && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Restock
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Stock Adjustment Dialog */}
      <ResponsiveDialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-zinc-100 text-sm font-semibold">
              Penyesuaian Stok: {adjustProduct?.name}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="text-xs text-zinc-400">
              Stok saat ini: <span className="text-zinc-200 font-medium">{adjustProduct?.stock}</span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs">Stok baru</Label>
              <Input
                type="number"
                min="0"
                placeholder="Masukkan stok baru"
                value={adjustNewStock}
                onChange={(e) => setAdjustNewStock(e.target.value)}
                className="h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
              />
              {adjustNewStock !== '' && adjustProduct && (
                <div className="text-[11px] text-zinc-500">
                  {(() => {
                    const diff = Number(adjustNewStock) - adjustProduct.stock
                    return diff > 0
                      ? <span className="theme-text">+{diff} (bertambah)</span>
                      : diff < 0
                      ? <span className="text-red-400">{diff} (berkurang)</span>
                      : <span className="text-zinc-500">Tidak berubah</span>
                  })()}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs">Alasan <span className="text-zinc-600">(opsional)</span></Label>
              <Input
                placeholder="Misal: stok hilang, salah hitung, dll"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                className="h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAdjustOpen(false)}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleAdjust}
              disabled={adjusting || adjustNewStock === '' || Number(adjustNewStock) < 0}
              className="bg-orange-500 hover:bg-orange-600 text-white h-8 text-xs"
            >
              {adjusting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Sesuaikan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Hapus {selectAllMode ? `${stats.total}` : selectedIds.size} Produk?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-sm">
              {selectAllMode
                ? `Semua ${stats.total} produk (sesuai filter) akan dihapus secara permanen beserta semua variannya. Tindakan ini tidak bisa dibatalkan.`
                : `${selectedIds.size} produk yang dipilih akan dihapus secara permanen beserta semua variannya. Tindakan ini tidak bisa dibatalkan.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={bulkDeleteSubmitting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {bulkDeleteSubmitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Price Dialog */}
      <ResponsiveDialog open={bulkPriceOpen} onOpenChange={setBulkPriceOpen}>
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-zinc-100 text-sm font-semibold">Ubah Harga Massal</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-zinc-400 text-xs">
              Mengubah harga untuk {selectedIds.size} produk
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant={bulkPriceType === 'percent' ? 'default' : 'outline'}
                onClick={() => setBulkPriceType('percent')}
                className={
                  bulkPriceType === 'percent'
                    ? 'theme-bg theme-hover text-white theme-border h-7 text-xs'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 h-7 text-xs'
                }
              >
                Persen (%)
              </Button>
              <Button
                size="sm"
                variant={bulkPriceType === 'fixed' ? 'default' : 'outline'}
                onClick={() => setBulkPriceType('fixed')}
                className={
                  bulkPriceType === 'fixed'
                    ? 'theme-bg theme-hover text-white theme-border h-7 text-xs'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 h-7 text-xs'
                }
              >
                Nominal (Rp)
              </Button>
            </div>

            {/* Quick adjust buttons */}
            {bulkPriceType === 'percent' && (
              <div className="flex flex-wrap gap-1.5">
                {['+10', '+20', '+5', '-5', '-10', '-20'].map((q) => (
                  <Button
                    key={q}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setBulkPriceQuick(q)
                      setBulkPriceValue(q)
                    }}
                    className={
                      bulkPriceQuick === q
                        ? 'theme-bg-very-light theme-border-light theme-text hover:theme-bg-subtle h-7 text-xs'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 h-7 text-xs'
                    }
                  >
                    {q}%
                  </Button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs">
                {bulkPriceType === 'percent' ? 'Persentase (contoh: 10 atau -10)' : 'Jumlah nominal (contoh: 5000 atau -5000)'}
              </Label>
              <Input
                type="number"
                placeholder={bulkPriceType === 'percent' ? '10' : '5000'}
                value={bulkPriceValue}
                onChange={(e) => {
                  setBulkPriceValue(e.target.value)
                  setBulkPriceQuick('')
                }}
                className="h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkPriceOpen(false)}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleBulkPrice}
              disabled={bulkPriceSubmitting || !bulkPriceValue}
              className="theme-bg theme-hover text-white h-8 text-xs"
            >
              {bulkPriceSubmitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Terapkan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Bulk Stock Dialog */}
      <ResponsiveDialog open={bulkStockOpen} onOpenChange={setBulkStockOpen}>
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-zinc-100 text-sm font-semibold">Ubah Stok Massal</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-zinc-400 text-xs">
              Mengubah stok untuk {selectedIds.size} produk
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant={bulkStockType === 'add' ? 'default' : 'outline'}
                onClick={() => setBulkStockType('add')}
                className={
                  bulkStockType === 'add'
                    ? 'theme-bg theme-hover text-white theme-border h-7 text-xs'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 h-7 text-xs'
                }
              >
                Tambah
              </Button>
              <Button
                size="sm"
                variant={bulkStockType === 'subtract' ? 'default' : 'outline'}
                onClick={() => setBulkStockType('subtract')}
                className={
                  bulkStockType === 'subtract'
                    ? 'bg-red-500 hover:bg-red-600 text-white border-red-500 h-7 text-xs'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 h-7 text-xs'
                }
              >
                Kurangi
              </Button>
              <Button
                size="sm"
                variant={bulkStockType === 'set' ? 'default' : 'outline'}
                onClick={() => setBulkStockType('set')}
                className={
                  bulkStockType === 'set'
                    ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500 h-7 text-xs'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 h-7 text-xs'
                }
              >
                Set
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs">
                {bulkStockType === 'set' ? 'Jumlah stok baru' : `Jumlah yang akan ditambah/dikurangi`}
              </Label>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={bulkStockValue}
                onChange={(e) => setBulkStockValue(e.target.value)}
                className="h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkStockOpen(false)}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleBulkStock}
              disabled={bulkStockSubmitting || !bulkStockValue || Number(bulkStockValue) < 0}
              className="theme-bg theme-hover text-white h-8 text-xs"
            >
              {bulkStockSubmitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Terapkan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Bulk Category Change Dialog */}
      <ResponsiveDialog open={bulkCategoryOpen} onOpenChange={setBulkCategoryOpen}>
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-zinc-100 text-sm font-semibold">Ubah Kategori Massal</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-zinc-400 text-xs">
              Mengubah kategori untuk {selectedIds.size} produk
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-xs">Pilih Kategori</Label>
              {categoriesLoading ? (
                <Skeleton className="h-8 bg-zinc-800 rounded" />
              ) : (
                <Select value={bulkCategoryId} onValueChange={setBulkCategoryId}>
                  <SelectTrigger className="h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-100">
                    <SelectValue placeholder="Pilih kategori..." />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {categories.map((cat) => (
                      <SelectItem
                        key={cat.id}
                        value={cat.id}
                        className="text-zinc-200 focus:bg-zinc-700 focus:text-zinc-100"
                      >
                        <div className="flex items-center gap-2">
                          <div className={`h-2.5 w-2.5 rounded-full ${getColorDotClasses(cat.color)}`} />
                          {cat.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-zinc-500">Kategori baru akan diterapkan ke semua produk yang dipilih.</p>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkCategoryOpen(false)}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleBulkCategory}
              disabled={bulkCategorySubmitting || !bulkCategoryId}
              className="theme-bg theme-hover text-white h-8 text-xs"
            >
              {bulkCategorySubmitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Terapkan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Upload Excel Dialog */}
      <ResponsiveDialog open={uploadOpen} onOpenChange={(open) => {
        if (!open) {
          // Reset state on close
          setUploadFile(null)
          setUploadResult(null)
          setUploadProgress(0)
          setUploadPhase('')
          if (uploadProgressRef.current) {
            clearInterval(uploadProgressRef.current)
            uploadProgressRef.current = null
          }
        }
        setUploadOpen(open)
      }}>
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800" desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-zinc-100 text-sm font-semibold">Upload Produk Excel</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-zinc-400 text-xs">
              Upload file Excel (.xlsx/.xls) atau CSV untuk menambahkan produk secara massal (maks. 500 baris)
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {!uploadResult ? (
            <div className="space-y-3 py-1">
              {uploading ? (
                /* Progress UI during upload */
                <div className="space-y-4 py-2">
                  {/* Animated icon + file name */}
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative">
                      <div className="h-14 w-14 rounded-full theme-bg-very-light border theme-border-light flex items-center justify-center">
                        <FileSpreadsheet className="h-6 w-6 theme-text" />
                      </div>
                      {uploadProgress < 100 && (
                        <Loader2 className="absolute -bottom-0.5 -right-0.5 h-4 w-4 theme-text animate-spin" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-zinc-200 font-medium truncate max-w-[200px]">{uploadFile?.name}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        {(uploadFile?.size ? (uploadFile.size / 1024).toFixed(1) : '0')} KB
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">{uploadPhase}</span>
                      <span className="text-zinc-300 font-medium tabular-nums">{uploadProgress}%</span>
                    </div>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full theme-gradient-light transition-all duration-300 ease-out"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>

                  {/* Step indicators */}
                  <div className="flex items-center justify-between gap-1 px-1">
                    {[
                      { label: 'Upload', threshold: 25 },
                      { label: 'Proses', threshold: 60 },
                      { label: 'Simpan', threshold: 90 },
                      { label: 'Selesai', threshold: 100 },
                    ].map((step) => (
                      <div
                        key={step.label}
                        className={`flex items-center gap-1 text-[10px] transition-colors duration-200 ${
                          uploadProgress >= step.threshold
                            ? 'theme-text'
                            : 'text-zinc-600'
                        }`}
                      >
                        {uploadProgress >= step.threshold ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <div className="h-3 w-3 rounded-full border border-zinc-700" />
                        )}
                        <span className="hidden sm:inline">{step.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Cancel hint */}
                  <p className="text-center text-[11px] text-zinc-600">
                    Mohon tunggu, jangan tutup halaman ini
                  </p>
                </div>
              ) : (
                <>
                  {/* Download template */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      window.open('/api/products/bulk-upload/template', '_blank')
                    }}
                    className="w-full bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 h-9 text-xs"
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download Template Excel
                  </Button>

                  {/* Drag and drop area */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault()
                      setUploadDragOver(true)
                    }}
                    onDragLeave={() => setUploadDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setUploadDragOver(false)
                      const file = e.dataTransfer.files[0]
                      if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv'))) {
                        setUploadFile(file)
                      } else {
                        toast.error('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv')
                      }
                    }}
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                      uploadDragOver
                        ? 'theme-border theme-bg-ultra-light'
                        : uploadFile
                        ? 'theme-border-medium theme-bg-ultra-light'
                        : 'border-zinc-700 hover:border-zinc-600'
                    }`}
                  >
                    {uploadFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 theme-text" />
                        <span className="text-xs text-zinc-200">{uploadFile.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setUploadFile(null)}
                          className="h-6 w-6 p-0 text-zinc-500 hover:text-red-400"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
                        <p className="text-xs text-zinc-400">Drag & drop file Excel/CSV di sini</p>
                        <p className="text-[11px] text-zinc-500 mt-1">atau</p>
                      </>
                    )}
                  </div>

                  {!uploadFile && (
                    <label className="block">
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) setUploadFile(file)
                        }}
                        className="hidden"
                      />
                      <div className="w-full text-center py-2 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 cursor-pointer text-xs">
                        Pilih File
                      </div>
                    </label>
                  )}

                  <div className="space-y-1">
                    <p className="text-[11px] text-zinc-500 font-medium">Kolom yang dibutuhkan:</p>
                    <p className="text-[11px] text-zinc-400">Nama (wajib), Harga Jual (wajib), SKU, HPP, Stok, Satuan, Kategori</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3 py-1">
              {/* Result summary */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                <h3 className="text-xs font-semibold text-zinc-300">Hasil Upload</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 theme-text" />
                    <span className="text-zinc-300">
                      <span className="font-semibold theme-text">{uploadResult.created}</span> produk berhasil ditambahkan
                    </span>
                  </div>
                  {(uploadResult.variantsCreated || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <Layers className="h-3.5 w-3.5 theme-text" />
                      <span className="text-zinc-300">
                        <span className="font-semibold theme-text">{uploadResult.variantsCreated}</span> varian berhasil ditambahkan
                      </span>
                    </div>
                  )}
                  {(uploadResult.skipped || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-zinc-300">
                        <span className="font-semibold text-amber-400">{uploadResult.skipped}</span> produk dilewati (sudah ada)
                      </span>
                    </div>
                  )}
                  {(uploadResult.variantsSkipped || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-zinc-300">
                        <span className="font-semibold text-amber-400">{uploadResult.variantsSkipped}</span> varian dilewati
                      </span>
                    </div>
                  )}
                  {uploadResult.errors.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                        <span className="text-red-400 font-medium">{uploadResult.errors.length} error</span>
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {uploadResult.errors.map((err, i) => (
                          <p key={i} className="text-[11px] text-zinc-500 pl-5">• {err}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <ResponsiveDialogFooter>
            {!uploadResult ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setUploadOpen(false)}
                  disabled={uploading}
                  className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs disabled:opacity-50"
                >
                  Batal
                </Button>
                {!uploading ? (
                  <Button
                    type="button"
                    onClick={handleBulkUpload}
                    disabled={!uploadFile}
                    className="theme-bg theme-hover text-white h-8 text-xs"
                  >
                    Upload
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="theme-bg theme-hover text-white h-8 text-xs"
              >
                Selesai
              </Button>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Edit Excel Dialog */}
      <ResponsiveDialog open={editExcelOpen} onOpenChange={(open) => {
        if (!open) {
          setEditExcelFile(null)
          setEditExcelResult(null)
          setEditExcelProgress(0)
          setEditExcelPhase('')
          if (editExcelProgressRef.current) {
            clearInterval(editExcelProgressRef.current)
            editExcelProgressRef.current = null
          }
        }
        setEditExcelOpen(open)
      }}>
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800" desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-zinc-100 text-sm font-semibold">Edit Produk Excel</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-zinc-400 text-xs">
              Update produk massal via file Excel (maks. 500 baris)
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {!editExcelResult ? (
            <div className="space-y-3 py-1">
              {editExcelUploading ? (
                /* Progress UI during upload */
                <div className="space-y-4 py-2">
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative">
                      <div className="h-14 w-14 rounded-full theme-bg-very-light border theme-border-light flex items-center justify-center">
                        <FileSpreadsheet className="h-6 w-6 theme-text" />
                      </div>
                      {editExcelProgress < 100 && (
                        <Loader2 className="absolute -bottom-0.5 -right-0.5 h-4 w-4 theme-text animate-spin" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-zinc-200 font-medium truncate max-w-[200px]">{editExcelFile?.name}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        {(editExcelFile?.size ? (editExcelFile.size / 1024).toFixed(1) : '0')} KB
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">{editExcelPhase}</span>
                      <span className="text-zinc-300 font-medium tabular-nums">{editExcelProgress}%</span>
                    </div>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full theme-gradient-light transition-all duration-300 ease-out"
                        style={{ width: `${editExcelProgress}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-1 px-1">
                    {[
                      { label: 'Upload', threshold: 25 },
                      { label: 'Proses', threshold: 60 },
                      { label: 'Update', threshold: 90 },
                      { label: 'Selesai', threshold: 100 },
                    ].map((step) => (
                      <div
                        key={step.label}
                        className={`flex items-center gap-1 text-[10px] transition-colors duration-200 ${
                          editExcelProgress >= step.threshold
                            ? 'theme-text'
                            : 'text-zinc-600'
                        }`}
                      >
                        {editExcelProgress >= step.threshold ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <div className="h-3 w-3 rounded-full border border-zinc-700" />
                        )}
                        <span className="hidden sm:inline">{step.label}</span>
                      </div>
                    ))}
                  </div>

                  <p className="text-center text-[11px] text-zinc-600">
                    Mohon tunggu, jangan tutup halaman ini
                  </p>
                </div>
              ) : (
                <>
                  {/* Step instructions */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3 space-y-2">
                    <p className="text-[11px] text-zinc-400 font-medium">Langkah-langkah:</p>
                    <div className="space-y-1.5">
                      <div className="flex items-start gap-2 text-[11px] text-zinc-300">
                        <span className="flex-shrink-0 h-4 w-4 rounded-full theme-bg-very-light border theme-border-light flex items-center justify-center text-[10px] theme-text font-bold">1</span>
                        <span>Download template edit berisi data produk saat ini</span>
                      </div>
                      <div className="flex items-start gap-2 text-[11px] text-zinc-300">
                        <span className="flex-shrink-0 h-4 w-4 rounded-full theme-bg-very-light border theme-border-light flex items-center justify-center text-[10px] theme-text font-bold">2</span>
                        <span>Edit data di Excel sesuai kebutuhan</span>
                      </div>
                      <div className="flex items-start gap-2 text-[11px] text-zinc-300">
                        <span className="flex-shrink-0 h-4 w-4 rounded-full theme-bg-very-light border theme-border-light flex items-center justify-center text-[10px] theme-text font-bold">3</span>
                        <span>Upload file yang sudah diedit</span>
                      </div>
                    </div>
                  </div>

                  {/* Step 1: Download template edit */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExportExcel}
                    disabled={exporting}
                    className="w-full bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 h-9 text-xs disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    Download Template Edit
                  </Button>

                  {/* Step 2: Drag and drop area */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault()
                      setEditExcelDragOver(true)
                    }}
                    onDragLeave={() => setEditExcelDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setEditExcelDragOver(false)
                      const file = e.dataTransfer.files[0]
                      if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv'))) {
                        setEditExcelFile(file)
                      } else {
                        toast.error('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv')
                      }
                    }}
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                      editExcelDragOver
                        ? 'theme-border theme-bg-ultra-light'
                        : editExcelFile
                        ? 'theme-border-medium theme-bg-ultra-light'
                        : 'border-zinc-700 hover:border-zinc-600'
                    }`}
                  >
                    {editExcelFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 theme-text" />
                        <span className="text-xs text-zinc-200">{editExcelFile.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditExcelFile(null)}
                          className="h-6 w-6 p-0 text-zinc-500 hover:text-red-400"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
                        <p className="text-xs text-zinc-400">Drag & drop file Excel/CSV di sini</p>
                        <p className="text-[11px] text-zinc-500 mt-1">atau</p>
                      </>
                    )}
                  </div>

                  {!editExcelFile && (
                    <label className="block">
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) setEditExcelFile(file)
                        }}
                        className="hidden"
                      />
                      <div className="w-full text-center py-2 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 cursor-pointer text-xs">
                        Pilih File
                      </div>
                    </label>
                  )}

                  <div className="space-y-1">
                    <p className="text-[11px] text-zinc-500 font-medium">Kolom yang diperbarui:</p>
                    <p className="text-[11px] text-zinc-400">Hanya kolom yang diisi (tidak kosong) akan diperbarui. ID digunakan untuk pencocokan.</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3 py-1">
              {/* Result summary */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                <h3 className="text-xs font-semibold text-zinc-300">Hasil Update</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 theme-text" />
                    <span className="text-zinc-300">
                      <span className="font-semibold theme-text">{editExcelResult.updated}</span> produk berhasil diperbarui
                    </span>
                  </div>
                  {(editExcelResult.variantsUpdated || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <Layers className="h-3.5 w-3.5 theme-text" />
                      <span className="text-zinc-300">
                        <span className="font-semibold theme-text">{editExcelResult.variantsUpdated}</span> varian berhasil diperbarui
                      </span>
                    </div>
                  )}
                  {(editExcelResult.notFound || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-zinc-300">
                        <span className="font-semibold text-amber-400">{editExcelResult.notFound}</span> produk tidak ditemukan
                      </span>
                    </div>
                  )}
                  {(editExcelResult.variantsNotFound || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-zinc-300">
                        <span className="font-semibold text-amber-400">{editExcelResult.variantsNotFound}</span> varian tidak ditemukan
                      </span>
                    </div>
                  )}
                  {editExcelResult.errors.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                        <span className="text-red-400 font-medium">{editExcelResult.errors.length} error</span>
                      </div>
                      <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {editExcelResult.errors.map((err, i) => (
                          <p key={i} className="text-[11px] text-zinc-500 pl-5">• {err}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <ResponsiveDialogFooter>
            {!editExcelResult ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditExcelOpen(false)}
                  disabled={editExcelUploading}
                  className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs disabled:opacity-50"
                >
                  Batal
                </Button>
                {!editExcelUploading ? (
                  <Button
                    type="button"
                    onClick={handleBulkUpdateExcel}
                    disabled={!editExcelFile}
                    className="theme-bg theme-hover text-white h-8 text-xs"
                  >
                    Update Produk
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                type="button"
                onClick={() => setEditExcelOpen(false)}
                className="theme-bg theme-hover text-white h-8 text-xs"
              >
                Selesai
              </Button>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Product Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg bg-zinc-900 border-zinc-800 p-0 overflow-hidden"
        >
          {detailProduct && (
            <>
              <SheetHeader className="p-4 pb-3">
                <SheetTitle className="text-zinc-100 text-sm font-semibold">
                  {detailProduct.name}
                </SheetTitle>
                <SheetDescription className="text-zinc-500 text-[11px]">
                  {(detailData?.product.sku || detailProduct.sku) || 'No SKU'} • {(() => {
                    const p = detailData?.product || detailProduct
                    const price = p.price || 0
                    const maxP = p._maxPrice || 0
                    return maxP && maxP !== price
                      ? `${formatCurrency(price)} ~ ${formatCurrency(maxP)}`
                      : formatCurrency(price)
                  })()}
                </SheetDescription>
              </SheetHeader>

              <ScrollArea className="h-[calc(100vh-64px)]">
                <div className="px-4 pb-4 space-y-4">
                  {detailLoading && !detailData ? (
                    <div className="space-y-3">
                      <Skeleton className="h-16 bg-zinc-800 rounded" />
                      <Skeleton className="h-48 bg-zinc-800 rounded" />
                    </div>
                  ) : detailData ? (
                    <>
                      {/* Product Info Card */}
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5 theme-text" />
                          Product Info
                        </h3>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-zinc-500 text-[11px]">SKU</span>
                            <p className="text-zinc-200 font-mono">{detailData.product.sku || '-'}</p>
                          </div>
                          <div>
                            <span className="text-zinc-500 text-[11px]">Stock</span>
                            <p className={
                              detailData.product.stock <= detailData.product.lowStockAlert
                                ? 'text-red-400'
                                : 'text-zinc-200'
                            }>
                              {formatNumber(detailData.product.stock)}
                            </p>
                          </div>
                          {!detailData.product.hasVariants && (
                            <div className="col-span-2 flex gap-1.5 mt-0.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] px-2 theme-bg-very-light theme-text border theme-border-light hover:theme-bg-subtle"
                                onClick={() => {
                                  setRestockProduct(detailProduct!)
                                  setRestockQty('')
                                  setRestockOpen(true)
                                }}
                              >
                                <RefreshCw className="h-2.5 w-2.5 mr-0.5" /> Restock
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] px-2 bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20"
                                onClick={() => {
                                  setAdjustProduct(detailProduct!)
                                  setAdjustNewStock('')
                                  setAdjustReason('')
                                  setAdjustOpen(true)
                                }}
                              >
                                <FilePenLine className="h-2.5 w-2.5 mr-0.5" /> Penyesuaian
                              </Button>
                            </div>
                          )}
                          {isOwner && (
                            <div>
                              <span className="text-zinc-500 text-[11px]">HPP</span>
                              <p className="text-zinc-200">{formatCurrency(detailData.product.hpp)}</p>
                            </div>
                          )}
                          <div>
                            <span className="text-zinc-500 text-[11px]">Price</span>
                            <p className="text-zinc-200">
                              {detailData.product._maxPrice && detailData.product._maxPrice !== detailData.product.price
                                ? <>{formatCurrency(detailData.product.price)}<span className="text-zinc-500 text-[10px]"> ~ </span>{formatCurrency(detailData.product._maxPrice)}</>
                                : formatCurrency(detailData.product.price)
                              }
                            </p>
                          </div>
                          {detailData.product.bruto > 0 && (
                            <div>
                              <span className="text-zinc-500 text-[11px]">Bruto</span>
                              <p className="text-zinc-200">{formatNumber(detailData.product.bruto)}g</p>
                            </div>
                          )}
                          {detailData.product.netto > 0 && (
                            <div>
                              <span className="text-zinc-500 text-[11px]">Netto</span>
                              <p className="text-zinc-200">{formatNumber(detailData.product.netto)}g</p>
                            </div>
                          )}
                          <div>
                            <span className="text-zinc-500 text-[11px]">Low Stock Alert</span>
                            <p className="text-zinc-200">{formatNumber(detailData.product.lowStockAlert)}</p>
                          </div>
                        </div>
                      </div>

                      {/* Barcode Card */}
                      {detailData.product.barcode && (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                          <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                            <ScanBarcode className="h-3.5 w-3.5 theme-text" />
                            Barcode
                          </h3>
                          <div className="flex justify-center bg-white rounded-lg p-3">
                            <BarcodeDisplay
                              value={detailData.product.barcode}
                              width={2}
                              height={50}
                              fontSize={11}
                              margin={2}
                              showPrint
                              label={detailData.product.name}
                              priceLabel={(() => {
                                const p = detailData.product
                                const price = p.price || 0
                                const maxP = p._maxPrice || 0
                                return maxP && maxP !== price
                                  ? `${formatCurrency(price)} ~ ${formatCurrency(maxP)}`
                                  : formatCurrency(price)
                              })()}
                            />
                          </div>
                        </div>
                      )}

                      {/* Variant List Card */}
                      {detailData.product.hasVariants && detailData.product.variants && detailData.product.variants.length > 0 && (
                        <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-3 space-y-2">
                          <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 text-violet-400" />
                            Varian ({detailData.product.variants.length})
                          </h3>
                          {/* Table header */}
                          <div className="grid grid-cols-4 gap-1 px-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                            <div className="col-span-1">Nama / SKU</div>
                            <div className="text-right">HPP</div>
                            <div className="text-right">Harga</div>
                            <div className="text-right">Stok</div>
                          </div>
                          <div className="space-y-1">
                            {detailData.product.variants.map((v: any) => {
                              const isOutOfStock = v.stock <= 0
                              const isLowStock = v.stock > 0 && v.stock <= (detailData.product.lowStockAlert || 10)
                              return (
                                <div key={v.id} className="bg-zinc-800/40 rounded-lg px-2.5 py-2">
                                  <div className="grid grid-cols-4 gap-1 items-center">
                                    <div className="min-w-0 col-span-1">
                                      <p className="text-xs font-medium text-zinc-200 truncate">{v.name}</p>
                                      {v.sku && <p className="text-[10px] text-zinc-600 font-mono truncate">{v.sku}</p>}
                                    </div>
                                    <div className="text-right col-span-1">
                                      {isOwner && (
                                        <p className="text-[11px] text-zinc-500">{formatCurrency(v.hpp)}</p>
                                      )}
                                    </div>
                                    <div className="text-right col-span-1">
                                      <p className="text-xs font-medium text-zinc-200">{formatCurrency(v.price)}</p>
                                    </div>
                                    <div className="text-right col-span-1">
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${isOutOfStock ? 'bg-red-500/10 text-red-400' : isLowStock ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-800 text-zinc-500'}`}>
                                        {formatNumber(v.stock)}
                                      </span>
                                    </div>
                                  </div>
                                  {v.barcode && (
                                    <div className="mt-1.5 pt-1.5 border-t border-zinc-700/50 flex flex-col items-center">
                                      <div className="bg-white rounded p-1.5">
                                        <BarcodeDisplay
                                          value={v.barcode}
                                          width={1.5}
                                          height={35}
                                          fontSize={9}
                                          margin={1}
                                          showPrint
                                          label={`${detailData.product.name} - ${v.name}`}
                                          priceLabel={formatCurrency(v.price)}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Stock Aging (Pro feature) */}
                      {isPro && (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                          <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-amber-400" />
                            Stock Aging
                          </h3>
                          {stockAgingDays === null ? (
                            <p className="text-xs text-zinc-500">Belum ada data restock</p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="text-xs text-zinc-300">
                                Terakhir restok: <span className="font-semibold text-zinc-100">{stockAgingDays} hari yang lalu</span>
                              </p>
                              {stockAgingDays > 60 ? (
                                <div className="flex items-center gap-1.5 p-2 rounded bg-red-500/10 border border-red-500/20">
                                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                                  <span className="text-xs text-red-400 font-medium">Segera cuci gudang</span>
                                </div>
                              ) : stockAgingDays > 30 ? (
                                <div className="flex items-center gap-1.5 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                  <span className="text-xs text-amber-400 font-medium">Perlu evaluasi stok</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 p-2 rounded theme-bg-very-light border theme-border-light">
                                  <Package className="h-3.5 w-3.5 theme-text shrink-0" />
                                  <span className="text-xs theme-text font-medium">Stok masih segar</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Summary Stats Card */}
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                          <BarChart3 className="h-3.5 w-3.5 theme-text" />
                          Summary
                        </h3>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded bg-zinc-800/50 p-2.5">
                            <div className="flex items-center gap-1.5 text-zinc-500 mb-0.5">
                              <ShoppingCart className="h-3 w-3" />
                              <span className="text-[11px]">Total Terjual</span>
                            </div>
                            <p className="text-sm font-semibold text-zinc-100">
                              {formatNumber(detailData.summary.totalSold)}
                            </p>
                          </div>
                          <div className="rounded bg-zinc-800/50 p-2.5">
                            <div className="flex items-center gap-1.5 text-zinc-500 mb-0.5">
                              <TrendingUp className="h-3 w-3" />
                              <span className="text-[11px]">Total Restock</span>
                            </div>
                            <p className="text-sm font-semibold theme-text">
                              +{formatNumber(detailData.summary.totalRestocked)}
                            </p>
                          </div>
                          <div className="rounded bg-zinc-800/50 p-2.5">
                            <div className="flex items-center gap-1.5 text-zinc-500 mb-0.5">
                              <Package className="h-3 w-3" />
                              <span className="text-[11px]">Stock Saat Ini</span>
                            </div>
                            <p className="text-sm font-semibold text-zinc-100">
                              {formatNumber(detailData.summary.currentStock)}
                            </p>
                          </div>
                          <div className="rounded bg-zinc-800/50 p-2.5">
                            <div className="flex items-center gap-1.5 text-zinc-500 mb-0.5">
                              <DollarSign className="h-3 w-3" />
                              <span className="text-[11px]">Revenue</span>
                            </div>
                            <p className="text-sm font-semibold text-amber-400">
                              {formatCurrency(detailData.summary.revenue)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Movement History with Filter Tabs */}
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 theme-text" />
                          Movement History
                        </h3>

                        <Tabs value={movementFilter} onValueChange={(v) => setMovementFilter(v as MovementFilterTab)}>
                          <TabsList className="bg-zinc-800 border-zinc-700 h-7">
                            <TabsTrigger value="all" className="text-[11px] h-5 px-2.5 data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100 text-zinc-400">
                              Semua
                            </TabsTrigger>
                            <TabsTrigger value="restock" className="text-[11px] h-5 px-2.5 data-[state=active]:theme-bg-subtle data-[state=active]:theme-text text-zinc-400">
                              Restock
                            </TabsTrigger>
                            <TabsTrigger value="sale" className="text-[11px] h-5 px-2.5 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400 text-zinc-400">
                              Penjualan
                            </TabsTrigger>
                            <TabsTrigger value="adjustment" className="text-[11px] h-5 px-2.5 data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400 text-zinc-400">
                              Penyesuaian
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>

                        {filteredMovements.length === 0 ? (
                          <div className="py-6 text-center text-zinc-500 text-xs">
                            No movement history for this filter
                          </div>
                        ) : (
                          <div className="space-y-0">
                            {filteredMovements.map((log, idx) => (
                              <div key={log.id}>
                                {idx > 0 && <Separator className="bg-zinc-800 my-1.5" />}
                                <div className={`flex items-start gap-2 py-2 px-2 ${getActionRowBg(log.action, log.details)}`}>
                                  <div className="flex-shrink-0 pt-0.5">
                                    {getActionBadge(log.action, log.details)}
                                  </div>
                                  <div className="flex-1 min-w-0 space-y-0.5">
                                    <p className="text-xs text-zinc-200">
                                      {getActionDescription(log.action, log.details)}
                                    </p>
                                    <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                                      <span className="flex items-center gap-1">
                                        <User className="h-2.5 w-2.5" />
                                        {log.user?.name || log.user?.email || 'System'}
                                      </span>
                                      <span>{formatDate(log.createdAt)}</span>
                                      {(log.entityType === 'VARIANT' || log.entityType === 'PRODUCT_VARIANT') && (
                                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                          <Layers className="h-2 w-2" />
                                          Variant
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {detailData.totalPages > 1 && (
                          <div className="pt-2 border-t border-zinc-800">
                            <Pagination
                              currentPage={detailPage}
                              totalPages={detailData.totalPages}
                              onPageChange={setDetailPage}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Batch Barcode Print Dialog */}
      <BatchBarcodeDialog
        open={batchBarcodeOpen}
        onOpenChange={setBatchBarcodeOpen}
        categories={categories}
      />
    </div>
  )
}
