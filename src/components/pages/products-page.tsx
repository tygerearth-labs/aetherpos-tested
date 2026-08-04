'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { Pagination } from '@/components/shared/pagination'
import { SortableTableHead, nextSortState } from '@/components/shared/sortable-header'
import { SameDayBadge } from '@/components/shared/same-day-badge'
import { StatusIconPopover, PopoverContentBody } from '@/components/shared/status-icon-popover'
import { RowActionsMenu } from '@/components/shared/row-actions-menu'
import { StockStatusBadge, stockValueColorClass } from '@/components/shared/stock-status-badge'
import { useRowHighlight } from '@/hooks/use-row-highlight'
import { BarcodeScannerDialog, type LookupResult } from '@/components/shared/barcode-scanner-dialog'
import { formatRelativeDateTime, getSameDayBadge } from '@/lib/relative-date'
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
  Beaker,
  Info,
  Boxes,
  HelpCircle,
  Lightbulb,
  FolderInput,
} from 'lucide-react'
// Collapsible removed — analytics section removed in redesign
import { ProGate } from '@/components/shared/pro-gate'
import { useBulkWorker } from '@/components/bulk-engine/bulk-worker-context'
import { useMigrationProcessor } from '@/components/migration/migration-context'

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
  hasComposition?: boolean
  _variantCount?: number
  _maxPrice?: number
  _lastChangedAt?: string  // ISO timestamp = max(updatedAt, latestVariantUpdatedAt)
  createdAt?: string
  updatedAt?: string
  variants?: Array<{
    id: string
    name: string
    sku: string | null
    barcode: string | null
    price: number
    hpp: number
    stock: number
    updatedAt?: string
  }>
}

interface ProductStats {
  total: number
  totalQty: number
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

// Column-sort state for the new sortable table headers.
// sortBy = null means "use the legacy `sort` Select dropdown".
// When sortBy is set, it overrides `sort` and the Select is hidden.
type ColumnSortBy = 'name' | 'category' | 'sku' | 'hpp' | 'price' | 'stock' | 'lastChangedAt'
type ColumnSortOrder = 'asc' | 'desc'

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

type MovementFilterTab = 'all' | 'restock' | 'sale' | 'void' | 'adjustment' | 'transfer'

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
    zinc: { bg: 'bg-zinc-500/10', text: 'text-slate-300', border: 'border-zinc-500/20', dot: 'bg-zinc-400', chipBg: 'bg-zinc-500/5 border-zinc-500/20 hover:bg-zinc-500/10' },
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

// Detect if a RESTOCK log is from a void transaction
function isVoidRestock(details?: Record<string, unknown>): boolean {
  return !!(details?.reason && typeof details.reason === 'string' && details.reason.includes('Void'))
}

function getActionBadge(action: string, details?: Record<string, unknown>) {
  // Transfer detection
  const isTransfer = action === 'ADJUSTMENT' && (details?.action === 'TRANSFER_SENT' || details?.action === 'TRANSFER_IN')
  // Show restock badge for stock-related bulk updates
  if (action === 'BULK_UPDATE' && hasStockChange(details)) {
    return <Badge className="theme-bg-very-light theme-border-light theme-text text-[10px]">Restock</Badge>
  }
  switch (action) {
    case 'CREATE':
      return <Badge className="bg-blue-500/10 border-blue-500/20 text-blue-400 text-[10px]">Create</Badge>
    case 'RESTOCK':
      if (isVoidRestock(details)) {
        return <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px]">Void Restore</Badge>
      }
      return <Badge className="theme-bg-very-light theme-border-light theme-text text-[10px]">Restock</Badge>
    case 'SALE':
      return <Badge className="bg-amber-500/10 border-amber-500/20 text-amber-400 text-[10px]">Penjualan</Badge>
    case 'UPDATE':
      return <Badge className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px]">Update</Badge>
    case 'DELETE':
      return <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[10px]">Hapus</Badge>
    case 'ADJUSTMENT':
      if (isTransfer) {
        return <Badge className="bg-sky-500/10 border-sky-500/20 text-sky-400 text-[10px]">Transfer</Badge>
      }
      return <Badge className="bg-orange-500/10 border-orange-500/20 text-orange-400 text-[10px]">Penyesuaian</Badge>
    case 'BULK_UPDATE':
      return <Badge className="bg-cyan-500/10 border-cyan-500/20 text-cyan-400 text-[10px]">Bulk Update</Badge>
    default:
      return <Badge className="bg-zinc-500/10 border-zinc-500/20 text-slate-400 text-[10px]">{action}</Badge>
  }
}

function getActionDescription(action: string, details: Record<string, unknown>): string {
  const variantName = details.variantName as string | undefined
  const variantLabel = variantName ? ` [${variantName}]` : ''
  const parentName = details.parentProductName as string | undefined
  const parentLabel = parentName ? ` (${parentName})` : ''

  switch (action) {
    case 'CREATE': {
      if (details.action === 'TRANSFER_IN_NEW') {
        return `Produk baru dari transfer ${details.transferNumber || ''} — Stok awal: ${formatNumber(Number(details.initialStock) || 0)}`
      }
      return `Produk dibuat — Harga: ${formatCurrency(Number(details.price) || 0)}, Stok awal: ${formatNumber(Number(details.stock) || 0)}`
    }
    case 'RESTOCK': {
      // Void restore — show invoice, reason, and who voided
      if (isVoidRestock(details)) {
        const reason = (details.reason as string) || ''
        const invoiceMatch = reason.match(/(INV-[\w-]+)/)
        const invoiceLabel = invoiceMatch ? invoiceMatch[1] : ''
        const qty = Number(details.quantityAdded) || 0
        const prev = Number(details.previousStock)
        const next = Number(details.newStock)
        const hasStock = !isNaN(prev) && !isNaN(next)

        const parts: string[] = []
        if (invoiceLabel) parts.push(`Void ${invoiceLabel}`)
        else parts.push('Void transaksi')
        parts.push(`Stok dikembalikan +${formatNumber(qty)} unit`)
        if (hasStock) parts.push(`Stok: ${formatNumber(prev)} → ${formatNumber(next)}`)
        if (details.productName) parts.push(`(${details.productName as string})`)

        return parts.join(' — ') + variantLabel
      }
      if (details.action === 'TRANSFER_IN') {
        const totalVal = Number(details.totalValue)
        const valueInfo = totalVal > 0 ? ` — Nilai: ${formatCurrency(totalVal)}` : ''
        return `+${formatNumber(Number(details.quantityAdded) || 0)} dari transfer ${details.transferNumber || ''} (${details.fromOutlet || 'outlet lain'}) — Stok: ${formatNumber(Number(details.previousStock) || 0)} → ${formatNumber(Number(details.newStock) || 0)}${valueInfo}`
      }
      // Migration opening stock
      if (details.reason === 'Stok awal migrasi') {
        const initStock = Number(details.initialStock) || 0
        return `Stok awal migrasi: ${formatNumber(initStock)} unit${variantLabel}`
      }
      const totalVal = Number(details.totalValue)
      const valueInfo = totalVal > 0 ? ` — Nilai: ${formatCurrency(totalVal)}` : ''
      return `Restock +${formatNumber(Number(details.quantityAdded) || 0)} unit${variantLabel} (Stok: ${formatNumber(Number(details.previousStock) || 0)} → ${formatNumber(Number(details.newStock) || 0)})${valueInfo}`
    }
    case 'SALE': {
      const qty = Number(details.quantitySold) || Number(details.qty) || 0
      const sub = Number(details.subtotal) || 0
      const price = Number(details.price) || 0
      const invoice = (details.invoiceNumber as string) || ''
      const prev = Number(details.previousStock)
      const next = Number(details.newStock)
      const hasStock = !isNaN(prev) && !isNaN(next)

      const parts: string[] = []
      if (invoice) parts.push(invoice)
      parts.push(`Terjual ${formatNumber(qty)} unit`)
      if (price > 0) parts.push(`@ ${formatCurrency(price)}`)
      if (sub > 0) parts.push(`Total ${formatCurrency(sub)}`)
      if (hasStock) parts.push(`Stok: ${formatNumber(prev)} → ${formatNumber(next)}`)

      return parts.join(' — ') + variantLabel
    }
    case 'UPDATE':
      if (details.variantCount !== undefined) {
        return `Produk diperbarui — ${Number(details.variantCount)} varian`
      }
      if (details.changes && typeof details.changes === 'object') {
        const changes = details.changes as Record<string, { from: unknown; to: unknown }>
        const parts: string[] = []
        if (changes.stock) {
          const diff = Number(changes.stock.to) - Number(changes.stock.from)
          parts.push(`Stok: ${formatNumber(Number(changes.stock.from))} → ${formatNumber(Number(changes.stock.to))} (${diff >= 0 ? '+' : ''}${formatNumber(diff)})`)
        }
        if (changes.price) parts.push(`Harga: ${formatCurrency(Number(changes.price.from))} → ${formatCurrency(Number(changes.price.to))}`)
        if (parts.length > 0) return parts.join(', ')
      }
      if (variantName) {
        return `Varian "${variantName}" diperbarui`
      }
      return 'Detail produk diperbarui'
    case 'DELETE':
      return 'Produk dihapus'
    case 'ADJUSTMENT': {
      if (details.action === 'TRANSFER_SENT') {
        const qty = Number(details.quantity) || 0
        const prev = Number(details.previousStock)
        const next = Number(details.newStock)
        const totalVal = Number(details.totalValue)
        const stockInfo = !isNaN(prev) && !isNaN(next) ? ` (${formatNumber(prev)} → ${formatNumber(next)})` : ''
        const valueInfo = totalVal > 0 ? ` — ${formatCurrency(totalVal)}` : ''
        return `Transfer keluar ${formatNumber(qty)} unit${variantLabel} ke ${details.toOutlet || 'outlet lain'} — TRF ${details.transferNumber || ''}${stockInfo}${valueInfo}`
      }
      if (details.action === 'TRANSFER_IN') {
        const added = Number(details.quantityAdded) || 0
        const totalVal = Number(details.totalValue)
        const valueInfo = totalVal > 0 ? ` — ${formatCurrency(totalVal)}` : ''
        return `+${formatNumber(added)} unit${variantLabel} dari transfer ${details.transferNumber || ''} (${details.fromOutlet || 'outlet lain'})${valueInfo}`
      }
      const prev = Number(details.previousStock)
      const next = Number(details.newStock)
      const diff = next - prev
      if (!isNaN(prev) && !isNaN(next)) {
        return `Penyesuaian stok: ${formatNumber(prev)} → ${formatNumber(next)} (${diff >= 0 ? '+' : ''}${formatNumber(diff)})${details.reason ? ` — ${details.reason}` : ''}`
      }
      return `Penyesuaian stok${variantLabel}${details.reason ? ` — ${details.reason}` : ' — Tanpa alasan'}`
    }
    case 'BULK_UPDATE': {
      const bulkVariantName = details.variantName as string | undefined
      const bulkVariantLabel = bulkVariantName ? ` [${bulkVariantName}]` : ''
      const stockDiff = getStockDiff(details)
      if (stockDiff) {
        const diff = stockDiff.to - stockDiff.from
        const hpp = Number(details.hpp)
        const hppInfo = hpp > 0 ? ` — Nilai: ${formatCurrency(diff * hpp)}` : ''
        return `Bulk stok: ${formatNumber(stockDiff.from)} → ${formatNumber(stockDiff.to)} (${diff >= 0 ? '+' : ''}${formatNumber(diff)})${hppInfo}${bulkVariantLabel}${parentLabel}`
      }
      // Check for price changes (top-level or under changes)
      const priceObj = (details.price || (details.changes as Record<string, unknown>)?.price) as { from: number; to: number } | undefined
      if (priceObj && typeof priceObj === 'object') {
        return `Bulk harga: ${formatCurrency(priceObj.from)} → ${formatCurrency(priceObj.to)}${bulkVariantLabel}${parentLabel}`
      }
      return 'Bulk update diterapkan'
    }
    default:
      return 'Aksi dilakukan'
  }
}

function getActionRowBg(action: string, details?: Record<string, unknown>): string {
  // Stock-related bulk updates get restock color
  if (action === 'BULK_UPDATE' && hasStockChange(details)) {
    return 'theme-bg-ultra-light rounded'
  }
  // Void restores get red-tinted background
  if (action === 'RESTOCK' && isVoidRestock(details)) {
    return 'bg-red-500/5 rounded'
  }
  switch (action) {
    case 'RESTOCK':
      return 'theme-bg-ultra-light rounded'
    case 'SALE':
      return 'bg-amber-500/5 rounded'
    case 'ADJUSTMENT':
      if (details?.action === 'TRANSFER_SENT' || details?.action === 'TRANSFER_IN') {
        return 'bg-sky-500/5 rounded'
      }
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
  const { openDialog: openBulkDialog } = useBulkWorker()
  // MIG-PARTIAL: permanent entry point to the Migration Wizard from the
  // Products page. Keeps the wizard reachable after the dashboard partial
  // card is dismissed. Opens with entryMode=PARTIAL so the wizard shows the
  // "Migrasi Data Lanjutan" header + duplicate-preview helper copy.
  const { openWizard: openMigrationWizard } = useMigrationProcessor()

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortOption>('newest')
  // New column-sort state. Default = lastChangedAt desc (most recent on top).
  // This overrides the legacy `sort` Select when set.
  const [columnSortBy, setColumnSortBy] = useState<ColumnSortBy>('lastChangedAt')
  const [columnSortOrder, setColumnSortOrder] = useState<ColumnSortOrder>('desc')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [restockOpen, setRestockOpen] = useState(false)
  const [restockProduct, setRestockProduct] = useState<Product | null>(null)
  const [restockQty, setRestockQty] = useState('')
  const [restocking, setRestocking] = useState(false)
  const [variantRestocks, setVariantRestocks] = useState<Array<{ id: string; name: string; stock: number; quantity: string }>>([])

  // Stock adjustment state
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null)
  const [adjustNewStock, setAdjustNewStock] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustVariantStocks, setAdjustVariantStocks] = useState<Record<string, string>>({})

  // Detail sheet state
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailData, setDetailData] = useState<MovementResponse | null>(null)
  const [detailPage, setDetailPage] = useState(1)
  const [movementFilter, setMovementFilter] = useState<MovementFilterTab>('all')

  // Variant-focus state — set when a barcode scan resolves to a specific
  // variant. Highlights (ring) and scrolls the matched variant row into view
  // inside the detail sheet. Cleared when the detail sheet closes.
  const [focusedVariantId, setFocusedVariantId] = useState<string | null>(null)

  // Bulk edit state
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0) // Force refresh counter for table
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false)
  const [bulkPriceType, setBulkPriceType] = useState<'percent' | 'fixed'>('percent')
  const [bulkPriceValue, setBulkPriceValue] = useState('')
  const [bulkPriceQuick, setBulkPriceQuick] = useState('')
  const [bulkPriceSubmitting, setBulkPriceSubmitting] = useState(false)
  // Temporary row highlight for scan/create/edit/sync results (spec point 3 + 6).
  // Auto-fades after 2.5s. Pure UI — no backend interaction.
  const rowHighlight = useRowHighlight<string>({ durationMs: 2500 })

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

  // Count variant products in current selection (for bulk edit info)
  const selectedVariantCount = useMemo(() => {
    if (selectAllMode) return products.filter(p => p.hasVariants).length
    return products.filter(p => selectedIds.has(p.id) && p.hasVariants).length
  }, [products, selectedIds, selectAllMode])

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
  const [categorySectionOpen, setCategorySectionOpen] = useState(false)
  const categoryScrollRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)

  // Drag-to-scroll for category chips
  const handleCategoryMouseDown = useCallback((e: React.MouseEvent) => {
    if (!categoryScrollRef.current) return
    isDragging.current = true
    startX.current = e.pageX - categoryScrollRef.current.offsetLeft
    scrollLeft.current = categoryScrollRef.current.scrollLeft
  }, [])
  const handleCategoryMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || !categoryScrollRef.current) return
    e.preventDefault()
    const x = e.pageX - categoryScrollRef.current.offsetLeft
    const walk = (x - startX.current) * 1.5
    categoryScrollRef.current.scrollLeft = scrollLeft.current - walk
  }, [])
  const handleCategoryMouseUp = useCallback(() => { isDragging.current = false }, [])
  const handleCategoryTouchStart = useCallback((e: React.TouchEvent) => {
    if (!categoryScrollRef.current) return
    startX.current = e.touches[0].pageX - categoryScrollRef.current.offsetLeft
    scrollLeft.current = categoryScrollRef.current.scrollLeft
  }, [])
  const handleCategoryTouchMove = useCallback((e: React.TouchEvent) => {
    if (!categoryScrollRef.current) return
    const x = e.touches[0].pageX - categoryScrollRef.current.offsetLeft
    const walk = (x - startX.current) * 1.5
    categoryScrollRef.current.scrollLeft = scrollLeft.current - walk
  }, [])
  const [featureHelpOpen, setFeatureHelpOpen] = useState(false)
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [editCategory, setEditCategory] = useState<Category | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryColor, setCategoryColor] = useState<string>('zinc')
  const [categorySaving, setCategorySaving] = useState(false)
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null)
  const [deleteCategoryProductCount, setDeleteCategoryProductCount] = useState(0)
  const [categoryDeleting, setCategoryDeleting] = useState(false)

  // Bulk category delete state
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(new Set())
  const [bulkDeletingCats, setBulkDeletingCats] = useState(false)
  const [bulkCatDeleteOpen, setBulkCatDeleteOpen] = useState(false)

  // Analytics stats from API (all products, not just current page)
  const [stats, setStats] = useState<ProductStats>({ total: 0, totalQty: 0, categories: 0, lowStock: 0, inventoryValue: 0 })

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
     
    void fetchCategories()
  }, [fetchCategories])

  // FIX-102 (P0): Added optional `bustCache` parameter. When true, appends a timestamp
  // query parameter to bypass browser HTTP cache. This is critical after stock mutations
  // (restock, adjust, sale, void) because even with reduced CACHE.SHORT (5s), we need
  // immediate fresh data — not "fresh within 5 seconds".
  const fetchProducts = useCallback(async (bustCache = false) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('search', search)
      // Column-sort API overrides the legacy `sort` Select when active.
      // (columnSortBy is always set — defaults to 'lastChangedAt'.)
      if (columnSortBy) {
        params.set('sortBy', columnSortBy)
        params.set('sortOrder', columnSortOrder)
      } else if (sort !== 'newest') {
        params.set('sort', sort)
      }
      if (activeCategoryId) params.set('categoryId', activeCategoryId)
      // Cache-busting: unique param forces browser to skip HTTP cache
      if (bustCache) params.set('_t', Date.now().toString())
      const res = await fetch(`/api/products?${params}`)
      if (res.ok) {
        const data: ProductListResponse = await res.json()
        setProducts(data.products)
        setTotalPages(data.totalPages)
        if (data.stats) {
          setStats(data.stats)
        }
      } else {
        toast.error('Gagal memuat produk')
      }
    } catch {
      toast.error('Gagal memuat produk')
    } finally {
      setLoading(false)
    }
  }, [page, search, sort, activeCategoryId, columnSortBy, columnSortOrder])

  useEffect(() => {
     
    void fetchProducts()
  }, [fetchProducts])

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, sort, activeCategoryId, columnSortBy, columnSortOrder])

  // Sort header click handler — toggle asc/desc when same column, else asc.
  const handleColumnSort = useCallback((columnId: string) => {
    const next = nextSortState(columnSortBy, columnSortOrder, columnId)
    setColumnSortBy(next.sortBy as ColumnSortBy)
    setColumnSortOrder(next.sortOrder)
    setPage(1)
  }, [columnSortBy, columnSortOrder])

  const fetchDetail = useCallback(async (product: Product, pageNum: number) => {
    setDetailLoading(true)
    try {
      const params = new URLSearchParams({ page: String(pageNum), limit: '20' })
      const res = await fetch(`/api/products/${product.id}/movement?${params}`)
      if (res.ok) {
        const data: MovementResponse = await res.json()
        setDetailData(data)
        // Keep detailProduct in sync with fresh data from API
        if (data.product) {
          setDetailProduct(prev => prev ? {
            ...prev,
            name: data.product.name,
            sku: data.product.sku || prev.sku,
            stock: data.product.stock,
            price: data.product.price,
            hpp: data.product.hpp,
            lowStockAlert: data.product.lowStockAlert,
            image: data.product.image || prev.image,
            hasVariants: data.product.hasVariants,
          } : prev)
        }
      } else {
        toast.error('Gagal memuat detail produk')
      }
    } catch {
      toast.error('Gagal memuat detail produk')
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
       
      void fetchDetail(detailProduct, detailPage)
    }
  }, [detailOpen, detailProduct, detailPage, fetchDetail])

  // ─────────────────────────────────────────────────────────────────────────
  // Barcode scanner — full-pipeline mode (Task ID: 3-product).
  //
  // Flow: scan product/variant barcode → resolve via /api/pos/products/lookup
  // → on FOUND, fetch full product detail → open detail sheet → if a variant
  // was matched, focus (ring + scrollIntoView) that variant row. closeOnSuccess
  // is true so the scanner auto-closes ONLY on a successful open-detail action.
  // NOT_FOUND / lookup error / action error keeps the scanner open so the
  // operator can re-scan.
  // ─────────────────────────────────────────────────────────────────────────

  // Wrap the Sheet's onOpenChange so closing the detail clears the variant
  // focus highlight (prevents a stale highlight if the same variant is
  // scanned again later).
  const handleDetailOpenChange = useCallback((open: boolean) => {
    setDetailOpen(open)
    if (!open) {
      setFocusedVariantId(null)
    }
  }, [])

  // Resolver: maps a barcode/SKU string to a LookupResult. Reuses the same
  // /api/pos/products/lookup endpoint as the POS (exact-match priority:
  // variant barcode → product barcode → variant SKU → product SKU).
  const resolveBarcode = useCallback(async (code: string): Promise<LookupResult> => {
    const trimmed = code.trim()
    if (!trimmed) return { status: 'NOT_FOUND', barcode: code }
    try {
      const res = await fetch(`/api/pos/products/lookup?code=${encodeURIComponent(trimmed)}`)
      if (res.ok) {
        const data = await res.json()
        if (data && data.product && data.product.id) {
          const matchedVariantId: string | null =
            typeof data.matchedVariantId === 'string' && data.matchedVariantId
              ? data.matchedVariantId
              : null
          return {
            status: 'FOUND',
            entityType: matchedVariantId ? 'VARIANT' : 'PRODUCT',
            productId: data.product.id as string,
            variantId: matchedVariantId ?? undefined,
            barcode: trimmed,
          }
        }
      }
    } catch {
      // Swallow — fall through to NOT_FOUND so the dialog shows its
      // standard "Barcode ... terbaca, tetapi belum terdaftar." toast and
      // stays open for re-scan.
    }
    return { status: 'NOT_FOUND', barcode: trimmed }
  }, [])

  // Context-action: takes a FOUND LookupResult → opens the product detail
  // sheet (and focuses the matched variant if any). Returns true on success
  // so the scanner auto-closes (closeOnSuccess is set). Returns false on
  // NOT_FOUND / fetch error so the scanner stays open.
  const handleScanContextAction = useCallback(async (lookup: LookupResult): Promise<boolean> => {
    if (lookup.status !== 'FOUND' || !lookup.productId) {
      // NOT_FOUND — the dialog already shows the "belum terdaftar" toast.
      return false
    }
    try {
      // Fetch the FULL product (with variants + category) for the detail
      // sheet. The lookup endpoint returns a PosProduct (POS-shape); the
      // detail sheet needs a Product (catalog-shape) including variants.
      // GET /api/products/[id] returns the product directly.
      const res = await fetch(`/api/products/${lookup.productId}`)
      if (!res.ok) {
        toast.error('Gagal memuat detail produk')
        return false
      }
      const data = await res.json()
      const product = data as Product
      if (!product || !product.id) {
        toast.error('Produk tidak ditemukan')
        return false
      }

      // Clear the search box so the product grid isn't filtered when the
      // detail sheet closes — the operator just scanned a specific item
      // and we want the grid to remain in its default state afterwards.
      setSearch('')
      setPage(1)

      // Set the variant focus BEFORE opening the detail so the highlight
      // is applied as soon as the variant list renders. The scroll-into-
      // view effect (below) handles the actual scroll once detailData
      // arrives from /api/products/[id]/movement.
      setFocusedVariantId(lookup.variantId ?? null)

      openDetail(product)

      // Temporary row highlight for scan result (spec point 3 + 6).
      rowHighlight.highlight(product.id)

      toast.success(`${product.name} ditemukan`)
      return true
    } catch (err) {
      console.error('[products-page] scan context action error:', err)
      toast.error('Gagal membuka detail produk')
      return false
    }
    // openDetail is a stable closure that only calls state setters — it does
    // not need to be a dep (and omitting it avoids a TDZ issue since it is
    // defined just above this useCallback).
  }, [])

  // Minimal onResult fallback — only used if the resolver is somehow not
  // wired. With the resolver wired, the dialog's full-pipeline path calls
  // onContextAction and does NOT call onResult. Returning false keeps the
  // dialog open (safe default for the no-resolver edge case).
  const handleScanResult = useCallback((_value: string): false => {
    return false
  }, [])

  // Scroll-into-view for the focused variant. Fires when focusedVariantId
  // is set, the detail sheet is open, and detailData has loaded (so the
  // variant list is rendered). Uses a data-attribute selector.
  useEffect(() => {
    if (!focusedVariantId || !detailOpen || !detailData) return
    // Small delay so the variant list DOM is committed before measuring.
    const t = setTimeout(() => {
      const el = document.querySelector(
        `[data-variant-id="${focusedVariantId}"]`,
      ) as HTMLElement | null
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 250)
    return () => clearTimeout(t)
  }, [focusedVariantId, detailOpen, detailData])

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
        toast.success('Produk berhasil dihapus')
        fetchProducts(true) // FIX-102: bust cache after product deletion
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Gagal menghapus produk')
      }
    } catch {
      toast.error('Gagal menghapus produk')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const handleRestock = async () => {
    if (!restockProduct) return

    if (restockProduct.hasVariants) {
      const variantData = variantRestocks.filter(v => v.quantity && Number(v.quantity) > 0)
      if (variantData.length === 0) {
        toast.error('Masukkan jumlah restock untuk minimal satu varian')
        return
      }
      setRestocking(true)
      try {
        const res = await fetch(`/api/products/${restockProduct.id}/restock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variants: variantData.map(v => ({ id: v.id, quantity: Number(v.quantity) })) }),
        })
        if (res.ok) {
          toast.success(`Restok ${restockProduct.name} (${variantData.length} varian)`)
          fetchProducts(true) // FIX-102: bust cache after stock mutation
          if (detailOpen && detailProduct?.id === restockProduct.id) {
            fetchDetail(restockProduct, detailPage)
          }
          rowHighlight.highlight(restockProduct.id) // spec point 6: selesai sync
          setRestockOpen(false)
          setRestockQty('')
          setRestockProduct(null)
          setVariantRestocks([])
        } else {
          const data = await res.json().catch(() => ({}))
          toast.error(data.error || 'Gagal restock')
        }
      } catch {
        toast.error('Gagal restock')
      } finally {
        setRestocking(false)
      }
    } else {
      if (!restockQty || Number(restockQty) <= 0) return
      setRestocking(true)
      try {
        const res = await fetch(`/api/products/${restockProduct.id}/restock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: Number(restockQty) }),
        })
        if (res.ok) {
          toast.success(`Restok ${restockProduct.name} +${restockQty}`)
          fetchProducts(true) // FIX-102: bust cache after stock mutation
          if (detailOpen && detailProduct?.id === restockProduct.id) {
            fetchDetail({ ...restockProduct, stock: restockProduct.stock + Number(restockQty) }, detailPage)
          }
          rowHighlight.highlight(restockProduct.id) // spec point 6: selesai sync
          setRestockOpen(false)
          setRestockQty('')
          setRestockProduct(null)
        } else {
          const data = await res.json().catch(() => ({}))
          toast.error(data.error || 'Gagal restock')
        }
      } catch {
        toast.error('Gagal restock')
      } finally {
        setRestocking(false)
      }
    }
  }

  const handleAdjust = async () => {
    if (!adjustProduct) return

    if (adjustProduct.hasVariants) {
      // Variant adjustment flow
      const variants = Object.entries(adjustVariantStocks)
        .filter(([, val]) => val !== '' && Number(val) >= 0)
        .map(([id, newStock]) => ({ id, newStock: Number(newStock) }))

      if (variants.length === 0) {
        toast.error('Masukkan stok baru untuk minimal satu varian')
        return
      }

      setAdjusting(true)
      try {
        const res = await fetch(`/api/products/${adjustProduct.id}/adjust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variants, reason: adjustReason || undefined }),
        })
        if (res.ok) {
          toast.success(`Stok varian disesuaikan`)
          fetchProducts(true) // FIX-102: bust cache after stock mutation
          if (detailOpen && detailProduct?.id === adjustProduct.id) {
            fetchDetail(detailProduct, detailPage)
          }
          rowHighlight.highlight(adjustProduct.id) // spec point 6: selesai sync
        } else {
          const data = await res.json().catch(() => ({}))
          toast.error(data.error || 'Gagal menyesuaikan stok varian')
        }
      } catch {
        toast.error('Gagal menyesuaikan stok varian')
      } finally {
        setAdjusting(false)
        setAdjustOpen(false)
        setAdjustNewStock('')
        setAdjustReason('')
        setAdjustVariantStocks({})
        setAdjustProduct(null)
      }
    } else {
      // Non-variant flow
      if (adjustNewStock === '' || Number(adjustNewStock) < 0) return
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
          fetchProducts(true) // FIX-102: bust cache after stock mutation
          if (detailOpen && detailProduct?.id === adjustProduct.id) {
            fetchDetail({ ...adjustProduct, stock: newStock }, detailPage)
          }
          rowHighlight.highlight(adjustProduct.id) // spec point 6: selesai sync
        } else {
          const errData = await res.json().catch(() => ({}))
          toast.error(errData.error || 'Gagal menyesuaikan stok')
        }
      } catch {
        toast.error('Gagal menyesuaikan stok')
      } finally {
        setAdjusting(false)
        setAdjustOpen(false)
        setAdjustNewStock('')
        setAdjustReason('')
        setAdjustVariantStocks({})
        setAdjustProduct(null)
      }
    }
  }

  // Helper to open adjust dialog with proper initialization
  const openAdjustDialog = (product: Product, variants?: Array<{ id: string; name: string; stock: number }>) => {
    setAdjustProduct(product)
    setAdjustNewStock('')
    setAdjustReason('')
    // Initialize variant stock inputs from current variant stocks
    const vStocks: Record<string, string> = {}
    if (variants && variants.length > 0) {
      for (const v of variants) {
        vStocks[v.id] = String(v.stock)
      }
    } else if (product.variants && product.variants.length > 0) {
      for (const v of product.variants) {
        vStocks[v.id] = String(v.stock)
      }
    }
    setAdjustVariantStocks(vStocks)
    setAdjustOpen(true)
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
        toast.error('Nilai tidak valid')
        return
      }
      const res = await fetch('/api/products/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: Array.from(selectedIds),
          priceAdjustment: { type: bulkPriceType, value },
          selectAllMode,
          filter: {
            search: search || undefined,
            categoryId: activeCategoryId || undefined,
          },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Harga diperbarui untuk ${data.updated} produk`)
        setBulkPriceOpen(false)
        setBulkPriceValue('')
        setBulkPriceQuick('')
        setSelectedIds(new Set())
        setBulkMode(false)
        setSelectAllMode(false)
        await forceRefresh()
      } else {
        toast.error('Gagal memperbarui harga')
      }
    } catch {
      toast.error('Gagal memperbarui harga')
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
        toast.error('Nilai tidak valid')
        return
      }
      const res = await fetch('/api/products/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: Array.from(selectedIds),
          stockAdjustment: { type: bulkStockType, value },
          selectAllMode,
          filter: {
            search: search || undefined,
            categoryId: activeCategoryId || undefined,
          },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Stok diperbarui untuk ${data.updated} produk`)
        setBulkStockOpen(false)
        setBulkStockValue('')
        setSelectedIds(new Set())
        setBulkMode(false)
        setSelectAllMode(false)
        await forceRefresh()
      } else {
        toast.error('Gagal memperbarui stok')
      }
    } catch {
      toast.error('Gagal memperbarui stok')
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
          filter: {
            search: search || undefined,
            categoryId: activeCategoryId || undefined,
          },
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
        await forceRefresh()
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

  // Force refresh helper - increments refreshKey and fetches products with cache-bust
  const forceRefresh = useCallback(async () => {
    setRefreshKey((prev) => prev + 1)
    await fetchProducts(true) // FIX-102: bust cache to get fresh post-mutation data
  }, [fetchProducts])

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
        await forceRefresh()
        const total = data.created + (data.variantsCreated || 0)
        toast.success(`${total} produk berhasil ditambahkan`)
      } else {
        const data = await res.json()
        // Fix Bug #11: Show details message for better debugging
        toast.error(data.details || data.error || 'Gagal upload file')
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
        await forceRefresh()
        fetchCategories()
        const total = data.updated + (data.variantsUpdated || 0)
        toast.success(`${total} produk berhasil diperbarui`)
      } else {
        const data = await res.json()
        // Fix Bug #11: Show details message for better debugging
        toast.error(data.details || data.error || 'Gagal update file')
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
          // Send current filter params so the API deletes only matching products
          filter: {
            search: search || undefined,
            categoryId: activeCategoryId || undefined,
          },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`${data.deletedCount} produk berhasil dihapus`)
        setBulkDeleteOpen(false)
        setSelectedIds(new Set())
        setBulkMode(false)
        setSelectAllMode(false)
        await forceRefresh()
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
        fetchProducts(true) // FIX-102: bust cache after category delete (filter changed)
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Gagal menghapus kategori')
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

  // Bulk category delete handlers
  const toggleCatSelect = (catId: string) => {
    setSelectedCatIds(prev => {
      const next = new Set(prev)
      if (next.has(catId)) {
        next.delete(catId)
      } else {
        next.add(catId)
      }
      return next
    })
  }

  const toggleSelectAllCats = () => {
    if (selectedCatIds.size === categories.length) {
      setSelectedCatIds(new Set())
    } else {
      setSelectedCatIds(new Set(categories.map(c => c.id)))
    }
  }

  const handleBulkDeleteCategories = async () => {
    if (selectedCatIds.size === 0) return
    setBulkDeletingCats(true)
    try {
      // Single bulk endpoint — emits ONE BULK_BATCH audit log for the whole
      // batch instead of N per-row logs (1 delete = 1 log spam fixed).
      const catIds = Array.from(selectedCatIds)
      const res = await fetch('/api/categories/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryIds: catIds }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || 'Failed to bulk delete categories')
      }
      const data = await res.json().catch(() => ({}))
      const deleted = data?.deletedCount ?? catIds.length
      toast.success(`${deleted} kategori berhasil dihapus`)
      const hadActive = selectedCatIds.has(activeCategoryId || '')
      setSelectedCatIds(new Set())
      setBulkCatDeleteOpen(false)
      if (hadActive) setActiveCategoryId(null)
      void fetchCategories()
      void fetchProducts(true) // FIX-102: bust cache after bulk category delete
    } catch {
      toast.error('Gagal menghapus beberapa kategori')
    } finally {
      setBulkDeletingCats(false)
    }
  }

  // Filtered movements — include stock-related BULK_UPDATE in restock filter
  const filteredMovements = useMemo(() => {
    if (!detailData) return []
    return detailData.movements.filter((m) => {
      if (movementFilter === 'all') return true
      if (movementFilter === 'restock') {
        if (m.action === 'RESTOCK' && !isVoidRestock(m.details)) return true
        if (m.action === 'BULK_UPDATE' && hasStockChange(m.details)) return true
        return false
      }
      if (movementFilter === 'sale') return m.action === 'SALE'
      if (movementFilter === 'void') {
        // Show void RESTOCK logs
        if (m.action === 'RESTOCK' && isVoidRestock(m.details)) return true
        return false
      }
      if (movementFilter === 'adjustment') {
        // Show only manual adjustments, not transfer-related
        if (m.action !== 'ADJUSTMENT') return false
        if (m.details?.action === 'TRANSFER_SENT' || m.details?.action === 'TRANSFER_IN') return false
        return true
      }
      if (movementFilter === 'transfer') {
        return m.action === 'ADJUSTMENT' && (m.details?.action === 'TRANSFER_SENT' || m.details?.action === 'TRANSFER_IN')
      }
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
          <h1 className="text-xl font-bold text-white tracking-tight">Produk</h1>
          <p className="text-sm text-slate-500 mt-0.5">Kelola inventori produk kamu</p>
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
                  : 'bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] h-9 text-xs font-medium shrink-0'
              }
            >
              <ListChecks className="mr-1.5 h-3.5 w-3.5" />
              {bulkMode ? 'Edit Massal Aktif' : 'Edit Massal'}
            </Button>
          )}
          <Button
              variant="outline"
              onClick={() => setBatchBarcodeOpen(true)}
              className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] h-9 text-xs font-medium shrink-0"
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Cetak Barcode
            </Button>
          {/* Excel Actions Dropdown — Export + Bulk Engine V2 items */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/[0.12] hover:border-emerald-500/30 h-9 text-xs font-medium gap-1.5 transition-all shrink-0"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px] rounded-xl border-white/[0.08] bg-nebula p-1.5 shadow-2xl shadow-black/60">
              <div className="px-2.5 py-1.5 mb-0.5">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Aksi Excel</p>
              </div>
              {/* MIG-PARTIAL: permanent Migration Wizard entry — Import & Migration.
                  Always reachable here even after the dashboard partial card is dismissed. */}
              <DropdownMenuItem
                onClick={() => openMigrationWizard('PARTIAL')}
                className="flex items-center gap-3 px-2.5 py-2.5 text-xs text-slate-300 hover:bg-white/[0.05] hover:text-white rounded-lg cursor-pointer focus:bg-white/[0.05] focus:text-white group"
              >
                <FolderInput className="h-4 w-4 text-slate-500 group-hover:text-sky-400 transition-colors" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">Import &amp; Migration</p>
                  <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors">Migrasi bertahap dari POS lama (Wizard)</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/[0.06] my-1" />
              <DropdownMenuItem
                onClick={handleExportExcel}
                disabled={exporting}
                className="flex items-center gap-3 px-2.5 py-2.5 text-xs text-slate-300 hover:bg-white/[0.05] hover:text-white rounded-lg cursor-pointer focus:bg-white/[0.05] focus:text-white group"
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Download className="h-4 w-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />}
                <div className="flex-1 min-w-0">
                  <p className="font-medium">Export Excel</p>
                  <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors">Download semua data produk</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/[0.06] my-1" />
              <DropdownMenuItem
                onClick={() => openBulkDialog('product:add')}
                className="flex items-center gap-3 px-2.5 py-2.5 text-xs text-slate-300 hover:bg-white/[0.05] hover:text-white rounded-lg cursor-pointer focus:bg-white/[0.05] focus:text-white group"
              >
                <Upload className="h-4 w-4 text-slate-500 group-hover:text-amber-400 transition-colors" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">Tambah Excel</p>
                  <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors">Bulk Engine V2 — tambah produk massal</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/[0.06] my-1" />
              <DropdownMenuItem
                onClick={() => openBulkDialog('product:edit')}
                className="flex items-center gap-3 px-2.5 py-2.5 text-xs text-slate-300 hover:bg-white/[0.05] hover:text-white rounded-lg cursor-pointer focus:bg-white/[0.05] focus:text-white group"
              >
                <FilePenLine className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition-colors" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">Edit Excel</p>
                  <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors">Bulk Engine V2 — update produk yang sudah ada</p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={handleAdd} className="theme-bg theme-hover text-white h-9 text-xs font-medium shadow-lg theme-shadow shrink-0">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Tambah Produk
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {!loading && stats.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
          {/* Total Produk & Qty — merged */}
          <Popover>
            <PopoverTrigger asChild>
              <div className="relative rounded-xl border border-white/[0.06] bg-nebula p-4 space-y-3 overflow-hidden group cursor-pointer hover:border-white/[0.1] transition-colors">
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-500 via-emerald-500 to-cyan-500/40" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Produk & Stok</span>
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Package className="h-4 w-4 text-emerald-400" />
                  </div>
                </div>
                <div className="flex items-end gap-3">
                  <div>
                    <p className="text-[10px] text-slate-500 leading-none">SKU</p>
                    <p className="text-2xl font-bold text-white tracking-tight mt-0.5">{formatNumber(stats.total)}</p>
                  </div>
                  <div className="w-px h-8 bg-white/[0.06] mb-0.5" />
                  <div>
                    <p className="text-[10px] text-slate-500 leading-none">Qty</p>
                    <p className="text-2xl font-bold text-emerald-400 tracking-tight mt-0.5">{formatNumber(stats.totalQty)}</p>
                  </div>
                </div>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Info className="h-3 w-3 text-slate-500" />
                </div>
              </div>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="center" className="w-64 rounded-xl border-white/[0.08] bg-nebula p-3.5 shadow-2xl shadow-black/60">
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-emerald-500/10 flex items-center justify-center">
                    <Package className="h-3 w-3 text-emerald-400" />
                  </div>
                  <span className="text-xs font-semibold text-white">Produk & Stok</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed"><strong className="text-slate-200">SKU ({formatNumber(stats.total)})</strong> — jumlah produk unik yang terdaftar, termasuk produk dengan varian.</p>
                <p className="text-[11px] text-slate-400 leading-relaxed"><strong className="text-emerald-400">Qty ({formatNumber(stats.totalQty)})</strong> — total kuantitas stok dari semua produk. Varian dijumlahkan.</p>
              </div>
            </PopoverContent>
          </Popover>

          {/* Total Categories */}
          <Popover>
            <PopoverTrigger asChild>
              <div className="relative rounded-xl border border-white/[0.06] bg-nebula p-4 space-y-3 overflow-hidden group cursor-pointer hover:border-white/[0.1] transition-colors">
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 to-violet-500/40" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Kategori</span>
                  <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <Tags className="h-4 w-4 text-violet-400" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-white tracking-tight">{formatNumber(stats.categories)}</p>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Info className="h-3 w-3 text-slate-500" />
                </div>
              </div>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="center" className="w-64 rounded-xl border-white/[0.08] bg-nebula p-3.5 shadow-2xl shadow-black/60">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-violet-500/10 flex items-center justify-center">
                    <Tags className="h-3 w-3 text-violet-400" />
                  </div>
                  <span className="text-xs font-semibold text-white">Kategori</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">Jumlah <strong className="text-slate-200">grup kategori</strong> aktif. Gunakan kategori untuk mengelompokkan dan memfilter produk di POS.</p>
              </div>
            </PopoverContent>
          </Popover>

          {/* Low Stock Items */}
          <Popover>
            <PopoverTrigger asChild>
              <div className="relative rounded-xl border border-white/[0.06] bg-nebula p-4 space-y-3 overflow-hidden group cursor-pointer hover:border-white/[0.1] transition-colors">
                <div className={`absolute top-0 left-0 right-0 h-0.5 ${stats.lowStock > 0 ? 'bg-gradient-to-r from-amber-500 to-amber-500/40' : 'theme-gradient'}`} />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Stok Rendah</span>
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${stats.lowStock > 0 ? 'bg-amber-500/10' : 'theme-bg-very-light'}`}>
                    <AlertTriangle className={`h-4 w-4 ${stats.lowStock > 0 ? 'text-amber-400' : 'theme-text'}`} />
                  </div>
                </div>
                <p className={`text-2xl font-bold tracking-tight ${stats.lowStock > 0 ? 'text-amber-400' : 'text-white'}`}>
                  {formatNumber(stats.lowStock)}
                </p>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Info className="h-3 w-3 text-slate-500" />
                </div>
              </div>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="center" className="w-64 rounded-xl border-white/[0.08] bg-nebula p-3.5 shadow-2xl shadow-black/60">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-amber-500/10 flex items-center justify-center">
                    <AlertTriangle className="h-3 w-3 text-amber-400" />
                  </div>
                  <span className="text-xs font-semibold text-white">Stok Rendah</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">Produk dengan stok <strong className="text-slate-200">di bawah atau sama dengan</strong> batas peringatan (low stock alert) yang ditentukan per produk.</p>
              </div>
            </PopoverContent>
          </Popover>

          {/* Total Inventory Value */}
          <Popover>
            <PopoverTrigger asChild>
              <div className="relative rounded-xl border border-white/[0.06] bg-nebula p-4 space-y-3 overflow-hidden group cursor-pointer hover:border-white/[0.1] transition-colors">
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-500 to-sky-500/40" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Value Produk</span>
                  <div className="h-8 w-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
                    <DollarSign className="h-4 w-4 text-sky-400" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-white tracking-tight">{formatCurrency(stats.inventoryValue)}</p>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Info className="h-3 w-3 text-slate-500" />
                </div>
              </div>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="center" className="w-64 rounded-xl border-white/[0.08] bg-nebula p-3.5 shadow-2xl shadow-black/60">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-sky-500/10 flex items-center justify-center">
                    <DollarSign className="h-3 w-3 text-sky-400" />
                  </div>
                  <span className="text-xs font-semibold text-white">Value Produk</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">Estimasi <strong className="text-slate-200">nilai inventori</strong> berdasarkan harga jual × stok. Ini bukan HPP — gunakan untuk gambaran nilai jual potensial.</p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Category Section */}
      <div className="rounded-xl border border-white/[0.06] bg-nebula/60 overflow-hidden">
        <button
          onClick={() => setCategorySectionOpen(!categorySectionOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Tags className="h-3.5 w-3.5 text-violet-400" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-200">Kategori</span>
                {!categoriesLoading && categories.length > 0 && (
                  <Badge variant="secondary" className="bg-white/[0.06] text-slate-500 border-0 text-[10px] px-1.5 py-0 h-4">{categories.length}</Badge>
                )}
                {activeCategoryId && (
                  <Badge className="theme-bg-very-light theme-border-light theme-text text-[10px] px-1.5 py-0 h-4">
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
              <p className="text-[10px] text-slate-500 mt-0.5">Kelompokkan produk untuk filter cepat di POS</p>
            </div>
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
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
            )}
          </div>
        </button>

        {categorySectionOpen && (
          <div className="px-4 pb-3 space-y-2">
            {/* Select All & Bulk Actions */}
            {!categoriesLoading && categories.length > 0 && (
              <>
                {/* Select All Row */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer group select-none">
                    <Checkbox
                      checked={categories.length > 0 && selectedCatIds.size === categories.length}
                      onCheckedChange={toggleSelectAllCats}
                      className="h-3.5 w-3.5 border-white/20 data-[state=checked]:bg-violet-500 data-[state=checked]:border-violet-500"
                    />
                    <span className="text-[10px] text-slate-500 group-hover:text-slate-300 transition-colors">
                      {selectedCatIds.size === categories.length && selectedCatIds.size > 0
                        ? 'Batalkan semua'
                        : 'Pilih Semua'}
                    </span>
                  </label>
                  {selectedCatIds.size > 0 && (
                    <span className="text-[10px] text-violet-400 font-medium">
                      {selectedCatIds.size} dipilih
                    </span>
                  )}
                </div>

                {/* Bulk Action Bar */}
                {selectedCatIds.size > 0 && (
                  <div className="flex items-center justify-between bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded bg-red-500/20 flex items-center justify-center">
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </div>
                      <span className="text-[11px] text-red-300 font-medium">
                        {selectedCatIds.size} kategori dipilih
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedCatIds(new Set())}
                        className="h-6 text-[10px] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] px-2"
                      >
                        Batal
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setBulkCatDeleteOpen(true)}
                        disabled={bulkDeletingCats}
                        className="h-6 text-[10px] bg-red-500 hover:bg-red-600 text-white px-2.5"
                      >
                        {bulkDeletingCats ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1 h-3 w-3" />
                        )}
                        Hapus
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {categoriesLoading ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-28 bg-white/[0.04] rounded-full flex-shrink-0" />
                ))}
              </div>
            ) : categories.length === 0 ? (
              <p className="text-[11px] text-slate-500 py-2">Belum ada kategori. Klik "Tambah" untuk membuat kategori baru.</p>
            ) : (
              <div
                ref={categoryScrollRef}
                className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide cursor-grab active:cursor-grabbing select-none"
                onMouseDown={handleCategoryMouseDown}
                onMouseMove={handleCategoryMouseMove}
                onMouseUp={handleCategoryMouseUp}
                onMouseLeave={handleCategoryMouseUp}
                onTouchStart={handleCategoryTouchStart}
                onTouchMove={handleCategoryTouchMove}
              >
                {categories.map((cat) => {
                  const colors = getColorClasses(cat.color)
                  const isActive = activeCategoryId === cat.id
                  const isSelected = selectedCatIds.has(cat.id)
                  return (
                    <div
                      key={cat.id}
                      className={`group flex items-center gap-1.5 rounded-full border px-3 py-1.5 flex-shrink-0 cursor-pointer transition-all duration-150 ${
                        isSelected
                          ? 'bg-violet-500/15 border-violet-500/40 ring-1 ring-violet-500/30'
                          : isActive
                            ? `${colors.chipBg} ${colors.text} ring-1 ${colors.border} shadow-sm`
                            : 'bg-white/[0.03] border-white/[0.04] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] hover:border-white/[0.06]'
                      }`}
                      onClick={() => {
                        if (isSelected) {
                          toggleCatSelect(cat.id)
                        } else {
                          setActiveCategoryId(isActive ? null : cat.id)
                        }
                      }}
                    >
                      {/* Selection Checkbox */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleCatSelect(cat.id) }}
                        className={`flex-shrink-0 h-3.5 w-3.5 rounded border flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-violet-500 border-violet-500'
                            : 'border-white/20 hover:border-white/40'
                        }`}
                      >
                        {isSelected && (
                          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>

                      <div className={`h-2 w-2 rounded-full flex-shrink-0 transition-colors ${getColorDotClasses(cat.color)}`} />
                      <span className="text-[11px] font-medium whitespace-nowrap">{cat.name}</span>
                      <span className="text-[10px] opacity-50">{cat._count?.products || 0}</span>
                      <div className="flex items-center gap-0.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <button
                          onClick={(e) => { e.stopPropagation(); openCategoryDialog(cat) }}
                          className="hover:theme-text text-slate-500 hover:bg-white/[0.04]/80 rounded p-0.5"
                          title="Edit"
                        >
                          <Edit className="h-2.5 w-2.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openDeleteCategory(cat) }}
                          className="hover:text-red-400 text-slate-500 hover:bg-white/[0.04]/80 rounded p-0.5"
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

      {/* Feature Instructions — Linear / Stripe / Mercury Style */}
      <div className={cn(
        "rounded-lg border transition-all duration-200",
        featureHelpOpen
          ? "bg-white/[0.03] border-white/[0.08]"
          : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.1]"
      )}>
        <button
          onClick={() => setFeatureHelpOpen(prev => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 text-left group"
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-white/[0.04]">
              <Lightbulb className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-200 transition-colors" />
            </div>
            <div>
              <span className="text-xs font-medium text-slate-200 group-hover:text-white transition-colors">Panduan Fitur Produk</span>
              <p className="text-[11px] text-slate-500 mt-px">6 fitur penting untuk kelola produk</p>
            </div>
          </div>
          <ChevronDown className={cn(
            'h-4 w-4 text-slate-500 transition-transform duration-200',
            featureHelpOpen ? 'rotate-180 text-slate-300' : ''
          )} />
        </button>
        {featureHelpOpen && (
          <div className="px-4 pb-4 pt-0">
            <div className="h-px bg-white/[0.06] -mx-4 mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-white/[0.04] rounded-lg overflow-hidden">
              {[
                { icon: <FileSpreadsheet className="h-4 w-4" />, label: 'Excel Dropdown', desc: 'Kumpulan aksi Excel dalam satu menu untuk export, upload, dan edit massal.' },
                { icon: <ListChecks className="h-4 w-4" />, label: 'Edit Massal', desc: 'Centang beberapa produk lalu ubah harga, stok, atau kategori bersamaan.' },
                { icon: <Printer className="h-4 w-4" />, label: 'Cetak Barcode', desc: 'Pilih produk lalu cetak barcode dalam format siap tempel ke label.' },
                { icon: <ScanBarcode className="h-4 w-4" />, label: 'Barcode & SKU', desc: 'Setiap produk bisa punya SKU manual. Scan langsung tambah ke keranjang.' },
                { icon: <Tags className="h-4 w-4" />, label: 'Kategori', desc: 'Klik kategori di atas untuk filter. Di POS muncul sebagai tab filter.' },
                { icon: <AlertTriangle className="h-4 w-4" />, label: 'Stok Rendah', desc: 'Atur peringatan stok rendah. Produk ditandai kuning jika stok ≤ batas.' },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-3 bg-deep-space px-4 py-3 group/feature hover:bg-white/[0.02] transition-colors">
                  <div className="flex-shrink-0 w-8 h-8 rounded-md bg-white/[0.04] flex items-center justify-center text-slate-400 group-hover/feature:text-slate-200 transition-colors mt-px">
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 group-hover/feature:text-white transition-colors">{item.label}</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Search & Sort */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <Input
            placeholder="Cari nama, SKU, barcode, kategori, varian..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-20 h-9 text-xs bg-white/[0.04] border-white/[0.04] text-white placeholder:text-slate-500 rounded-lg focus-visible:ring-white/[0.06]"
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {search && (
              <button
                onClick={() => setSearch('')}
                className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                aria-label="Hapus pencarian"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setScannerOpen(true)}
              className="h-6 px-1.5 rounded-md flex items-center gap-1 text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
              title="Scan barcode dengan kamera"
              aria-label="Scan barcode"
            >
              <ScanBarcode className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Scan</span>
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 bg-nebula rounded-lg" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-nebula p-8 text-center">
            <Package className="mx-auto h-8 w-8 text-slate-700 mb-2" />
            <p className="text-sm text-slate-500">Tidak ada produk ditemukan</p>
          </div>
        ) : (
          <div key={`table-${refreshKey}`} className="rounded-xl border border-white/[0.06] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent bg-nebula/80">
                  {bulkMode && (
                    <TableHead className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider w-10">
                      <Checkbox
                        checked={selectedIds.size === products.length && products.length > 0}
                        onCheckedChange={toggleSelectAll}
                        className="border-white/[0.06] data-[state=checked]:theme-bg data-[state=checked]:theme-border"
                      />
                    </TableHead>
                  )}
                  <SortableTableHead
                    activeSortBy={columnSortBy}
                    activeSortOrder={columnSortOrder}
                    columnId="name"
                    onSort={handleColumnSort}
                    className="min-w-[220px]"
                  >
                    Nama
                  </SortableTableHead>
                  <SortableTableHead
                    activeSortBy={columnSortBy}
                    activeSortOrder={columnSortOrder}
                    columnId="category"
                    onSort={handleColumnSort}
                    className="w-[140px]"
                  >
                    Kategori
                  </SortableTableHead>
                  <SortableTableHead
                    activeSortBy={columnSortBy}
                    activeSortOrder={columnSortOrder}
                    columnId="sku"
                    onSort={handleColumnSort}
                    className="w-[120px]"
                  >
                    SKU
                  </SortableTableHead>
                  <TableHead className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider w-[80px]">Satuan</TableHead>
                  {isOwner && (
                    <SortableTableHead
                      activeSortBy={columnSortBy}
                      activeSortOrder={columnSortOrder}
                      columnId="hpp"
                      onSort={handleColumnSort}
                      align="right"
                      className="w-[120px]"
                    >
                      HPP
                    </SortableTableHead>
                  )}
                  <SortableTableHead
                    activeSortBy={columnSortBy}
                    activeSortOrder={columnSortOrder}
                    columnId="price"
                    onSort={handleColumnSort}
                    align="right"
                    className="w-[140px]"
                  >
                    Harga
                  </SortableTableHead>
                  <SortableTableHead
                    activeSortBy={columnSortBy}
                    activeSortOrder={columnSortOrder}
                    columnId="stock"
                    onSort={handleColumnSort}
                    align="right"
                    className="w-[100px]"
                  >
                    Stok
                  </SortableTableHead>
                  <SortableTableHead
                    activeSortBy={columnSortBy}
                    activeSortOrder={columnSortOrder}
                    columnId="lastChangedAt"
                    onSort={handleColumnSort}
                    align="right"
                    className="w-[140px]"
                  >
                    Terakhir Diubah
                  </SortableTableHead>
                  <TableHead className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider text-right w-[96px]">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const isOutOfStock = product.stock === 0
                  const isLowStock = product.stock > 0 && product.stock <= product.lowStockAlert
                  const isSelected = selectedIds.has(product.id)
                  // Same-day highlight: priority 1 = created today, 2 = changed today.
                  const sameDayBadge = getSameDayBadge(product.createdAt ?? product._lastChangedAt, product._lastChangedAt)

                  // CANONICAL ROW STRUCTURE (spec point 1 + 3):
                  // - Every row uses the SAME base class — no conditional tints.
                  // - No left vertical accent bars.
                  // - No full-row warning backgrounds.
                  // - Stock state is communicated ONLY via:
                  //     1. The numeric stock value's color (red/amber/slate)
                  //     2. A compact StockStatusBadge in the Stok cell
                  // - Temporary emerald tint (from useRowHighlight) for scan/create/edit/sync.
                  const rowClass = cn(
                    'border-white/[0.06] hover:bg-white/[0.03] transition-colors duration-300',
                    rowHighlight.classNameFor(product.id),
                  )

                  return (
                    <TableRow key={product.id} className={rowClass}>
                      {bulkMode && (
                        <TableCell className="w-10 py-3 px-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(product.id)}
                            className="border-white/[0.06] data-[state=checked]:theme-bg data-[state=checked]:theme-border"
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-xs text-white font-medium py-3 px-3">
                        <div className="flex items-center gap-2">
                          {product.image ? (
                            <div className="h-8 w-8 rounded-lg bg-white/[0.04] overflow-hidden flex-shrink-0">
                              <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                            </div>
                          ) : (
                            <div className="h-8 w-8 rounded-lg bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                              <Package className="h-3.5 w-3.5 text-slate-600" />
                            </div>
                          )}
                          <div className="flex flex-col gap-0.5 min-w-0">
                            {/* Nama dominan + inline status icons (spec point 2 + 5).
                                "Update" badge removed — "Terakhir Diubah" column already shows it.
                                "Baru" (created today) badge kept as text — it's high-signal for new items.
                                Max 3 visible status icons enforced by conditional rendering below. */}
                            <span className="flex items-center gap-1 flex-wrap">
                              <span className="truncate max-w-[200px]">{product.name}</span>
                              {sameDayBadge === 'new' && <SameDayBadge variant="new" />}
                              {product.hasVariants && product._variantCount != null && product._variantCount > 0 && (
                                <StatusIconPopover
                                  ariaLabel={`${product._variantCount} varian`}
                                  icon={<Layers className="h-3 w-3" />}
                                  tooltip={`${product._variantCount} varian`}
                                  popoverContent={
                                    <PopoverContentBody title={`${product._variantCount} Varian`}>
                                      Produk ini memiliki {product._variantCount} varian dengan harga/stok terpisah.
                                    </PopoverContentBody>
                                  }
                                  trailing={<span className="text-[10px] font-semibold tabular-nums">{product._variantCount}</span>}
                                  tone="violet"
                                />
                              )}
                              {product.hasComposition && (
                                <>
                                  <StatusIconPopover
                                    ariaLabel="Komposisi"
                                    icon={<Beaker className="h-3 w-3" />}
                                    tooltip="Komposisi"
                                    popoverContent={
                                      <PopoverContentBody title="Komposisi">
                                        Produk menggunakan inventory sebagai bahan.
                                      </PopoverContentBody>
                                    }
                                    tone="sky"
                                  />
                                  <StatusIconPopover
                                    ariaLabel="Stok otomatis"
                                    icon={<RefreshCw className="h-3 w-3" />}
                                    tooltip="Stok Otomatis"
                                    popoverContent={
                                      <PopoverContentBody title="Stok Otomatis">
                                        Stok dihitung otomatis dari inventory. Restock manual dinonaktifkan.
                                      </PopoverContentBody>
                                    }
                                    tone="emerald"
                                  />
                                </>
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
                          <span className="text-[11px] text-slate-600 italic">Tanpa kategori</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 font-mono py-3 px-3">{product.sku || '-'}</TableCell>
                      <TableCell className="text-xs py-3 px-3">
                        <Badge className="bg-sky-500/10 border-sky-500/20 text-sky-400 text-[10px] px-1.5 py-0">
                          {product.unit || 'pcs'}
                        </Badge>
                      </TableCell>
                      {isOwner && (
                        <TableCell className="text-xs text-slate-400 text-right py-3 px-3 tabular-nums">{formatCurrency(product.hpp)}</TableCell>
                      )}
                      <TableCell className="text-xs text-white font-medium text-right py-3 px-3 tabular-nums">
                        {product.hasVariants && product._maxPrice && product._maxPrice !== product.price
                          ? <>{formatCurrency(product.price)}<span className="text-slate-500"> ~ </span>{formatCurrency(product._maxPrice)}</>
                          : formatCurrency(product.price)
                        }
                      </TableCell>
                      <TableCell className="text-xs text-right py-3 px-3">
                        {/* Stok cell: numeric value (colored by status) + compact StockStatusBadge.
                            NO "Tersedia"/"Aman" badge (spec point 2). */}
                        <div className="flex items-center justify-end gap-1.5">
                          <span className={cn('tabular-nums font-medium', stockValueColorClass(product.stock, product.lowStockAlert))}>
                            {formatNumber(product.stock)}
                          </span>
                          <StockStatusBadge stock={product.stock} lowThreshold={product.lowStockAlert} />
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px] text-slate-400 text-right py-3 px-3 tabular-nums whitespace-nowrap">
                        {formatRelativeDateTime(product._lastChangedAt)}
                      </TableCell>
                      <TableCell className="text-right py-3 px-3">
                        <div className="flex items-center justify-end opacity-60 group-hover:opacity-100 transition-opacity">
                          <RowActionsMenu
                            size="sm"
                            primaryAction={{
                              label: 'Lihat Detail',
                              icon: <Eye className="h-3.5 w-3.5" />,
                              onClick: () => openDetail(product),
                            }}
                            items={[
                              {
                                label: 'Edit',
                                icon: <Edit className="h-3.5 w-3.5" />,
                                onClick: () => handleEdit(product),
                              },
                              {
                                label: 'Restock',
                                icon: <RefreshCw className="h-3.5 w-3.5" />,
                                onClick: () => {
                                  setRestockProduct(product)
                                  setRestockQty('')
                                  setVariantRestocks([])
                                  setRestockOpen(true)
                                },
                                disabled: product.hasComposition,
                                title: product.hasComposition
                                  ? 'Stok dihitung otomatis dari inventory'
                                  : undefined,
                              },
                              {
                                label: 'Sync / Adjust Stok',
                                icon: <FilePenLine className="h-3.5 w-3.5" />,
                                onClick: () => openAdjustDialog(product),
                                disabled: product.hasComposition,
                                title: product.hasComposition
                                  ? 'Stok dihitung otomatis dari inventory'
                                  : undefined,
                              },
                              {
                                label: 'Lihat / Cetak Barcode',
                                icon: <ScanBarcode className="h-3.5 w-3.5" />,
                                onClick: () => setBatchBarcodeOpen(true),
                              },
                            ]}
                            dangerItems={[
                              {
                                label: 'Hapus',
                                icon: <Trash2 className="h-3.5 w-3.5" />,
                                onClick: () => setDeleteId(product.id),
                              },
                            ]}
                          />
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
        {/* Sticky Selection Header for Bulk Mode */}
        {bulkMode && !loading && products.length > 0 && (
          <div className="sticky top-0 z-30 -mx-4 -mt-4 mb-3 px-4 py-3 bg-nebula/95 backdrop-blur-sm border-b border-white/[0.06] rounded-b-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={selectAllMode ? () => { setSelectAllMode(false); setSelectedIds(new Set()) } : toggleSelectAll}
                  className="flex items-center justify-center h-11 w-11 -ml-2 rounded-lg hover:bg-white/[0.04] active:bg-white/[0.06] transition-colors"
                >
                  <Checkbox
                    checked={selectAllMode || (selectedIds.size === products.length && products.length > 0)}
                    className="h-5 w-5 border-2 border-white/[0.15] data-[state=checked]:theme-bg data-[state=checked]:theme-border pointer-events-none"
                  />
                </button>
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-slate-200">
                    {selectAllMode 
                      ? `Semua ${stats.total} produk`
                      : `${selectedIds.size} dari ${products.length} di halaman ini`
                    }
                  </span>
                  {!selectAllMode && (
                    <span className="text-[10px] text-slate-500">Total {stats.total} produk</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!selectAllMode && stats.total > products.length && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleSelectAll}
                    className="h-8 text-[11px] px-2.5 theme-text hover:theme-bg-very-light border border-theme-border-light/50 rounded-lg gap-1.5"
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    Pilih Semua
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setSelectedIds(new Set()); setSelectAllMode(false) }}
                  className="h-8 text-[11px] px-2.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                >
                  Batal
                </Button>
              </div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-nebula border border-white/[0.06] p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="h-10 w-10 bg-white/[0.04] rounded-lg flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-3/4 bg-white/[0.04] rounded" />
                    <Skeleton className="h-3 w-1/2 bg-white/[0.04] rounded" />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <Skeleton className="h-3 w-16 bg-white/[0.04] rounded" />
                  <Skeleton className="h-5 w-24 bg-white/[0.04] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-nebula p-8 text-center">
            <Package className="mx-auto h-8 w-8 text-slate-600 mb-2" />
            <p className="text-sm text-slate-500">Tidak ada produk ditemukan</p>
          </div>
        ) : (
          <div key={`cards-${refreshKey}`} className="space-y-3">
            {products.map((product) => {
              const isOutOfStock = product.stock === 0
              const isLowStock = product.stock > 0 && product.stock <= product.lowStockAlert
              const isSelected = selectedIds.has(product.id)
              // Same-day highlight (spec point 4) — was missing on mobile.
              const sameDayBadge = getSameDayBadge(product.createdAt ?? product._lastChangedAt, product._lastChangedAt)

              // CANONICAL CARD STRUCTURE (spec point 1 + 3):
              // - Same border + bg for all cards — no stock-state tints.
              // - No left accent bars.
              // - Selected state keeps its emerald ring (selection is a user action, not a status).
              // - Temporary emerald tint for scan/create/edit/sync.
              const cardBorder = isSelected
                ? 'border-emerald-500/40 ring-1 ring-emerald-500/15'
                : 'border-white/[0.06]'
              const cardBg = isSelected
                ? 'bg-emerald-500/[0.02]'
                : rowHighlight.highlightedId === product.id
                  ? 'bg-emerald-500/[0.06]'
                  : 'bg-nebula'

              return (
                <div
                  key={product.id}
                  className={cn(
                    'relative rounded-xl border p-4 transition-colors duration-300',
                    cardBg,
                    cardBorder,
                    isSelected ? 'shadow-sm shadow-emerald-500/5' : '',
                    'active:bg-white/[0.04]',
                  )}
                >
                  {/* Main: Image + Info row */}
                  <div className="flex items-start gap-3 mb-3">
                    {/* Left side: Checkbox or Thumbnail */}
                    <div className="flex-shrink-0">
                      {bulkMode ? (
                        <button
                          type="button"
                          onClick={() => toggleSelect(product.id)}
                          className={`relative flex items-center justify-center h-12 w-12 rounded-xl transition-all duration-200 ${isSelected ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30' : 'bg-white/[0.03] hover:bg-white/[0.05]'}`}
                        >
                          <div className={cn(
                            "transition-all duration-200",
                            isSelected ? "scale-100 opacity-100" : "scale-90 opacity-70"
                          )}>
                            {isSelected ? (
                              <div className="rounded-full bg-emerald-500 p-0.5">
                                <CheckCircle2 className="h-6 w-6 text-white" />
                              </div>
                            ) : (
                              <div className="h-6 w-6 rounded-md border-2 border-white/[0.12]" />
                            )}
                          </div>
                        </button>
                      ) : product.image ? (
                        <div className="h-12 w-12 rounded-xl bg-white/[0.04] overflow-hidden ring-1 ring-white/[0.04]">
                          <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                        </div>
                      ) : (
                        <div className="h-12 w-12 rounded-xl bg-white/[0.04] flex items-center justify-center ring-1 ring-white/[0.04]">
                          <Package className="h-5 w-5 text-slate-600" />
                        </div>
                      )}
                    </div>

                    {/* Info Content */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-1.5 pl-0.5">
                      {/* Product Name Row */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="text-[15px] font-semibold text-white truncate leading-snug block">
                            {product.name}
                          </span>
                          {/* Inline status icons (spec point 2 + 5).
                              "Update" badge removed — "Terakhir Diubah" column already shows it.
                              "Baru" (created today) badge kept as text — high-signal for new items.
                              NO stock badge here (stock badge renders in the right-side compact slot). */}
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {sameDayBadge === 'new' && <SameDayBadge variant="new" />}
                            {product.hasVariants && product._variantCount != null && product._variantCount > 0 && (
                              <StatusIconPopover
                                ariaLabel={`${product._variantCount} varian`}
                                icon={<Layers className="h-3.5 w-3.5" />}
                                tooltip={`${product._variantCount} varian`}
                                popoverContent={
                                  <PopoverContentBody title={`${product._variantCount} Varian`}>
                                    Produk ini memiliki {product._variantCount} varian dengan harga/stok terpisah.
                                  </PopoverContentBody>
                                }
                                trailing={<span className="text-[11px] font-semibold tabular-nums">{product._variantCount}</span>}
                                tone="violet"
                              />
                            )}
                            {product.hasComposition && (
                              <>
                                <StatusIconPopover
                                  ariaLabel="Komposisi"
                                  icon={<Beaker className="h-3.5 w-3.5" />}
                                  tooltip="Komposisi"
                                  popoverContent={
                                    <PopoverContentBody title="Komposisi">
                                      Produk menggunakan inventory sebagai bahan.
                                    </PopoverContentBody>
                                  }
                                  tone="sky"
                                />
                                <StatusIconPopover
                                  ariaLabel="Stok otomatis"
                                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                                  tooltip="Stok Otomatis"
                                  popoverContent={
                                    <PopoverContentBody title="Stok Otomatis">
                                      Stok dihitung otomatis dari inventory. Restock manual dinonaktifkan.
                                    </PopoverContentBody>
                                  }
                                  tone="emerald"
                                />
                              </>
                            )}
                          </div>
                        </div>
                        {/* Compact StockStatusBadge (spec point 2) — NO "Tersedia"/"Aman" */}
                        <StockStatusBadge stock={product.stock} lowThreshold={product.lowStockAlert} className="ml-2 !text-[10px] !px-2 !py-0.5" />
                      </div>
                      {/* Category + SKU + Unit Row */}
                      <div className="flex items-center gap-2 mt-1">
                        {product.category ? (
                          <div className="flex items-center gap-1.5 bg-white/[0.03] rounded-lg px-2 py-1">
                            <div className={`h-2 w-2 rounded-full flex-shrink-0 ${getColorDotClasses(product.category.color)}`} />
                            <span className={`text-[11px] font-medium ${getColorClasses(product.category.color).text}`}>
                              {product.category.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-600 italic">Tanpa kategori</span>
                        )}
                        {product.sku && (
                          <span className="text-[11px] text-slate-500 font-mono bg-white/[0.02] rounded-lg px-2 py-1">{product.sku}</span>
                        )}
                        <Badge className="bg-sky-500/10 border-sky-500/20 text-sky-400 text-[11px] px-2 py-1 rounded-lg ml-auto font-medium">
                          {product.unit || 'pcs'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Price + Stock Row */}
                  <div className="flex items-end justify-between gap-3 mt-3 pt-3 border-t border-white/[0.04]">
                    <div className="flex flex-col gap-1">
                      {/* Price Display */}
                      <div className="flex items-baseline gap-2">
                        {isOwner && (
                          <span className="text-[11px] text-slate-500">
                            HPP <span className="font-mono">{formatCurrency(product.hpp)}</span>
                          </span>
                        )}
                        <span className="text-base font-bold text-white tabular-nums">
                          {product.hasVariants && product._maxPrice && product._maxPrice !== product.price
                            ? <>{formatCurrency(product.price)}<span className="text-slate-500 text-xs font-normal mx-0.5">~</span><span className="text-sm">{formatCurrency(product._maxPrice)}</span></>
                            : formatCurrency(product.price)
                          }
                        </span>
                      </div>
                      {/* Stock Display — colored number per status (spec point 3). No background tint. */}
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold text-sm tabular-nums bg-white/[0.04]",
                          stockValueColorClass(product.stock, product.lowStockAlert),
                        )}>
                          <Package className="h-3.5 w-3.5" />
                          {formatNumber(product.stock)}
                        </div>
                        <span className="text-[11px] text-slate-500">unit</span>
                      </div>
                    </div>
                    
                    {/* Action Menu - Slim pattern: primary View + kebab dropdown */}
                    <RowActionsMenu
                      size="md"
                      primaryAction={{
                        label: 'Lihat Detail',
                        icon: <Eye className="h-4 w-4" />,
                        onClick: () => openDetail(product),
                      }}
                      items={[
                        {
                          label: 'Edit',
                          icon: <Edit className="h-3.5 w-3.5" />,
                          onClick: () => handleEdit(product),
                        },
                        {
                          label: 'Restock',
                          icon: <RefreshCw className="h-3.5 w-3.5" />,
                          onClick: () => {
                            setRestockProduct(product)
                            setRestockQty('')
                            setVariantRestocks([])
                            setRestockOpen(true)
                          },
                          disabled: product.hasComposition,
                          title: product.hasComposition
                            ? 'Stok dihitung otomatis dari inventory'
                            : undefined,
                        },
                        {
                          label: 'Sync / Adjust Stok',
                          icon: <FilePenLine className="h-3.5 w-3.5" />,
                          onClick: () => openAdjustDialog(product),
                          disabled: product.hasComposition,
                          title: product.hasComposition
                            ? 'Stok dihitung otomatis dari inventory'
                            : undefined,
                        },
                        {
                          label: 'Lihat / Cetak Barcode',
                          icon: <ScanBarcode className="h-3.5 w-3.5" />,
                          onClick: () => setBatchBarcodeOpen(true),
                        },
                      ]}
                      dangerItems={[
                        {
                          label: 'Hapus',
                          icon: <Trash2 className="h-3.5 w-3.5" />,
                          onClick: () => setDeleteId(product.id),
                        },
                      ]}
                    />
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
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 z-40 md:z-50 border-t border-white/[0.04] bg-nebula/95 backdrop-blur-sm p-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full theme-bg shrink-0" />
                <span className="text-xs text-slate-300 whitespace-nowrap">
                  <span className="font-semibold theme-text">{selectedIds.size}</span> dipilih
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSelectedIds(new Set()); setSelectAllMode(false) }}
                className="text-slate-500 hover:text-slate-300 h-7 text-[11px] px-2"
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
                  className="text-slate-500 hover:text-slate-300 h-7 text-[11px] px-2 border border-white/[0.04]"
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
        onSaved={() => {
          fetchProducts(true) // FIX-102: bust cache after create/edit product
          fetchCategories()
          // Refresh detail sheet if open for the same product
          if (detailOpen && detailProduct) {
            fetchDetail(detailProduct, detailPage)
          }
          // spec point 6: selesai create / selesai edit
          // (For edit, we know the id. For create, the new product appears at
          // the top of the list with a "Baru" badge that already serves as a
          // visual cue, so we don't need to highlight a specific row.)
          if (editProduct?.id) rowHighlight.highlight(editProduct.id)
        }}
      />

      {/* Category Create/Edit Dialog */}
      <ResponsiveDialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">
              {editCategory ? 'Edit Kategori' : 'Tambah Kategori'}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              {editCategory ? 'Ubah nama dan warna kategori' : 'Buat kategori baru untuk mengelompokkan produk'}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Nama Kategori *</Label>
              <Input
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="Contoh: Minuman, Makanan, Snack"
                className="h-8 text-xs bg-white/[0.04] border-white/[0.04] text-white placeholder:text-slate-500"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCategorySave() }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Warna</Label>
              <div className="flex flex-wrap gap-2 pt-1">
                {CATEGORY_COLORS.map((color) => {
                  const isSelected = categoryColor === color
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCategoryColor(color)}
                      className={`h-7 w-7 rounded-full ${getColorDotClasses(color)} transition-all ${
                        isSelected ? 'ring-2 ring-offset-2 ring-offset-deep-space ring-white/50 scale-110' : 'hover:scale-105 opacity-70 hover:opacity-100'
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
              className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs"
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
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-sm font-semibold">Hapus Kategori</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              {deleteCategoryProductCount > 0 ? (
                <>
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Perhatian!
                  </span>
                  <br />
                  Kategori ini memiliki <span className="text-slate-200 font-medium">{deleteCategoryProductCount} produk</span>. Produk akan dikembalikan ke status tanpa kategori.
                </>
              ) : (
                'Apakah Anda yakin ingin menghapus kategori ini? Tindakan ini tidak dapat dibatalkan.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs">
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

      {/* Bulk Category Delete Confirmation */}
      <AlertDialog open={bulkCatDeleteOpen} onOpenChange={(open) => { if (!open) setBulkCatDeleteOpen(false) }}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-sm font-semibold">Hapus {selectedCatIds.size} Kategori?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Perhatian!
              </span>
              <br />
              Anda akan menghapus <span className="text-slate-200 font-medium">{selectedCatIds.size} kategori</span> sekaligus. Produk yang terkait dengan kategori ini akan dikembalikan ke status tanpa kategori. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs" onClick={() => setBulkCatDeleteOpen(false)}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDeleteCategories}
              disabled={bulkDeletingCats}
              className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs"
            >
              {bulkDeletingCats && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Hapus Semua
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-sm font-semibold">Hapus Produk?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              Produk yang dihapus tidak dapat dikembalikan. Semua data produk (termasuk varian & stok) akan hilang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs"
            >
              {deleting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restock Dialog */}
      <ResponsiveDialog open={restockOpen} onOpenChange={(open) => { if (!open) { setRestockOpen(false); setVariantRestocks([]) } else { setRestockOpen(true) } }}>
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">
              Restock: {restockProduct?.name}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            {!restockProduct?.hasVariants ? (
              <>
                <div className="text-xs text-slate-400">
                  Stok saat ini: <span className="text-slate-200 font-medium">{restockProduct?.stock}</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-xs">Jumlah ditambahkan</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Masukkan jumlah"
                    value={restockQty}
                    onChange={(e) => setRestockQty(e.target.value)}
                    className="h-8 text-xs bg-white/[0.04] border-white/[0.04] text-white placeholder:text-slate-500"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-slate-400 mb-2">
                  Masukkan jumlah restock untuk setiap varian:
                </div>
                <div className="space-y-2.5 max-h-64 overflow-y-auto">
                  {restockProduct?.variants?.map((v) => (
                    <div key={v.id} className="space-y-1 p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.04]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-200 font-medium">{v.name}</span>
                        <span className="text-[10px] text-slate-500">Stok: {v.stock}</span>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={variantRestocks.find(vr => vr.id === v.id)?.quantity || ''}
                        onChange={(e) => {
                          setVariantRestocks(prev => {
                            const existing = prev.find(vr => vr.id === v.id)
                            if (existing) {
                              return prev.map(vr => vr.id === v.id ? { ...vr, quantity: e.target.value } : vr)
                            }
                            return [...prev, { id: v.id, name: v.name, stock: v.stock, quantity: e.target.value }]
                          })
                        }}
                        className="h-7 text-xs bg-white/[0.04] border-white/[0.04] text-white placeholder:text-slate-500"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => { setRestockOpen(false); setVariantRestocks([]) }}
              className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleRestock}
              disabled={restocking || (!restockProduct?.hasVariants ? (!restockQty || Number(restockQty) <= 0) : variantRestocks.filter(v => v.quantity && Number(v.quantity) > 0).length === 0)}
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
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">
              Penyesuaian Stok: {adjustProduct?.name}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            {adjustProduct?.hasVariants ? (
              <>
                <div className="text-xs text-slate-400">
                  Sesuaikan stok per varian. Stok parent akan dihitung otomatis.
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(adjustProduct?.variants || []).map((v) => (
                    <div key={v.id} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-slate-300 text-xs">{v.name}</Label>
                        <span className="text-[11px] text-slate-500">Saat ini: {v.stock}</span>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        placeholder={`Stok baru untuk ${v.name}`}
                        value={adjustVariantStocks[v.id] || ''}
                        onChange={(e) => setAdjustVariantStocks((prev) => ({ ...prev, [v.id]: e.target.value }))}
                        className="h-8 text-xs bg-white/[0.04] border-white/[0.04] text-white placeholder:text-slate-500"
                      />
                      {adjustVariantStocks[v.id] && (
                        <div className="text-[11px] text-slate-500">
                          {(() => {
                            const diff = Number(adjustVariantStocks[v.id]) - v.stock
                            return diff > 0
                              ? <span className="theme-text">+{diff} (bertambah)</span>
                              : diff < 0
                              ? <span className="text-red-400">{diff} (berkurang)</span>
                              : <span>Tidak berubah</span>
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-slate-400">
                  Stok saat ini: <span className="text-slate-200 font-medium">{adjustProduct?.stock}</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300 text-xs">Stok baru</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="Masukkan stok baru"
                    value={adjustNewStock}
                    onChange={(e) => setAdjustNewStock(e.target.value)}
                    className="h-8 text-xs bg-white/[0.04] border-white/[0.04] text-white placeholder:text-slate-500"
                  />
                  {adjustNewStock !== '' && adjustProduct && (
                    <div className="text-[11px] text-slate-500">
                      {(() => {
                        const diff = Number(adjustNewStock) - adjustProduct.stock
                        return diff > 0
                          ? <span className="theme-text">+{diff} (bertambah)</span>
                          : diff < 0
                          ? <span className="text-red-400">{diff} (berkurang)</span>
                          : <span className="text-slate-500">Tidak berubah</span>
                      })()}
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Alasan <span className="text-slate-600">(opsional)</span></Label>
              <Input
                placeholder="Misal: stok hilang, salah hitung, dll"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                className="h-8 text-xs bg-white/[0.04] border-white/[0.04] text-white placeholder:text-slate-500"
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAdjustOpen(false)}
              className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleAdjust}
              disabled={adjusting || (adjustProduct?.hasVariants
                ? Object.values(adjustVariantStocks).every((v) => v === '' || Number(v) < 0)
                : adjustNewStock === '' || Number(adjustNewStock) < 0)}
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
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Hapus {selectAllMode ? `${stats.total}` : selectedIds.size} Produk?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-sm">
              {selectAllMode
                ? `Semua ${stats.total} produk (sesuai filter) akan dihapus secara permanen beserta semua variannya. Tindakan ini tidak bisa dibatalkan.`
                : `${selectedIds.size} produk yang dipilih akan dihapus secara permanen beserta semua variannya. Tindakan ini tidak bisa dibatalkan.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04]">
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
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">Ubah Harga Massal</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
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
                    : 'bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white h-7 text-xs'
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
                    : 'bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white h-7 text-xs'
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
                        : 'bg-white/[0.04] border-white/[0.04] text-slate-400 hover:text-slate-200 h-7 text-xs'
                    }
                  >
                    {q}%
                  </Button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">
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
                className="h-8 text-xs bg-white/[0.04] border-white/[0.04] text-white placeholder:text-slate-500"
              />
              {selectedVariantCount > 0 && (
                <p className="text-[10px] text-sky-400/80 flex items-center gap-1">
                  <Layers className="h-2.5 w-2.5" />
                  {selectedVariantCount} produk variant — semua varian akan ikut diubah harganya
                </p>
              )}
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkPriceOpen(false)}
              className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs"
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
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">Ubah Stok Massal</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
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
                    : 'bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white h-7 text-xs'
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
                    : 'bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white h-7 text-xs'
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
                    : 'bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white h-7 text-xs'
                }
              >
                Set
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">
                {bulkStockType === 'set' ? 'Jumlah stok baru' : `Jumlah yang akan ditambah/dikurangi`}
              </Label>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={bulkStockValue}
                onChange={(e) => setBulkStockValue(e.target.value)}
                className="h-8 text-xs bg-white/[0.04] border-white/[0.04] text-white placeholder:text-slate-500"
              />
              {selectedVariantCount > 0 && (
                <p className="text-[10px] text-sky-400/80 flex items-center gap-1">
                  <Layers className="h-2.5 w-2.5" />
                  {selectedVariantCount} produk variant — stok semua varian akan ikut diubah, lalu stok parent dihitung ulang
                </p>
              )}
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkStockOpen(false)}
              className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs"
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
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">Ubah Kategori Massal</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Mengubah kategori untuk {selectedIds.size} produk
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Pilih Kategori</Label>
              {categoriesLoading ? (
                <Skeleton className="h-8 bg-white/[0.04] rounded" />
              ) : (
                <Select value={bulkCategoryId} onValueChange={setBulkCategoryId}>
                  <SelectTrigger className="h-8 text-xs bg-white/[0.04] border-white/[0.04] text-white">
                    <SelectValue placeholder="Pilih kategori..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white/[0.04] border-white/[0.04]">
                    {categories.map((cat) => (
                      <SelectItem
                        key={cat.id}
                        value={cat.id}
                        className="text-slate-200 focus:bg-white/[0.04] focus:text-white"
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
              <p className="text-[11px] text-slate-500">Kategori baru akan diterapkan ke semua produk yang dipilih.</p>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkCategoryOpen(false)}
              className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs"
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
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">Upload Produk Excel</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
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
                      <p className="text-xs text-slate-200 font-medium truncate max-w-[200px]">{uploadFile?.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {(uploadFile?.size ? (uploadFile.size / 1024).toFixed(1) : '0')} KB
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{uploadPhase}</span>
                      <span className="text-slate-300 font-medium tabular-nums">{uploadProgress}%</span>
                    </div>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.04]">
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
                            : 'text-slate-600'
                        }`}
                      >
                        {uploadProgress >= step.threshold ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <div className="h-3 w-3 rounded-full border border-white/[0.04]" />
                        )}
                        <span className="hidden sm:inline">{step.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Cancel hint */}
                  <p className="text-center text-[11px] text-slate-600">
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
                    className="w-full bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] h-9 text-xs"
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
                        : 'border-white/[0.04] hover:border-white/[0.06]'
                    }`}
                  >
                    {uploadFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 theme-text" />
                        <span className="text-xs text-slate-200">{uploadFile.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setUploadFile(null)}
                          className="h-6 w-6 p-0 text-slate-500 hover:text-red-400"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto mb-2 text-slate-600" />
                        <p className="text-xs text-slate-400">Drag & drop file Excel/CSV di sini</p>
                        <p className="text-[11px] text-slate-500 mt-1">atau</p>
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
                      <div className="w-full text-center py-2 rounded-md bg-white/[0.04] border border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] cursor-pointer text-xs">
                        Pilih File
                      </div>
                    </label>
                  )}

                  <div className="space-y-1">
                    <p className="text-[11px] text-slate-500 font-medium">Kolom yang dibutuhkan:</p>
                    <p className="text-[11px] text-slate-400">Nama (wajib), Harga Jual (wajib), SKU, HPP, Stok, Satuan, Kategori</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3 py-1">
              {/* Result summary */}
              <div className="rounded-lg border border-white/[0.06] bg-nebula/50 p-3 space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">Hasil Upload</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 theme-text" />
                    <span className="text-slate-300">
                      <span className="font-semibold theme-text">{uploadResult.created}</span> produk berhasil ditambahkan
                    </span>
                  </div>
                  {(uploadResult.variantsCreated || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <Layers className="h-3.5 w-3.5 theme-text" />
                      <span className="text-slate-300">
                        <span className="font-semibold theme-text">{uploadResult.variantsCreated}</span> varian berhasil ditambahkan
                      </span>
                    </div>
                  )}
                  {(uploadResult.skipped || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-slate-300">
                        <span className="font-semibold text-amber-400">{uploadResult.skipped}</span> produk dilewati (sudah ada)
                      </span>
                    </div>
                  )}
                  {(uploadResult.variantsSkipped || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-slate-300">
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
                          <p key={i} className="text-[11px] text-slate-500 pl-5">• {err}</p>
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
                  className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs disabled:opacity-50"
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
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">Edit Produk Excel</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
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
                      <p className="text-xs text-slate-200 font-medium truncate max-w-[200px]">{editExcelFile?.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {(editExcelFile?.size ? (editExcelFile.size / 1024).toFixed(1) : '0')} KB
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{editExcelPhase}</span>
                      <span className="text-slate-300 font-medium tabular-nums">{editExcelProgress}%</span>
                    </div>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.04]">
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
                            : 'text-slate-600'
                        }`}
                      >
                        {editExcelProgress >= step.threshold ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <div className="h-3 w-3 rounded-full border border-white/[0.04]" />
                        )}
                        <span className="hidden sm:inline">{step.label}</span>
                      </div>
                    ))}
                  </div>

                  <p className="text-center text-[11px] text-slate-600">
                    Mohon tunggu, jangan tutup halaman ini
                  </p>
                </div>
              ) : (
                <>
                  {/* Step instructions */}
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 space-y-2">
                    <p className="text-[11px] text-slate-400 font-medium">Langkah-langkah:</p>
                    <div className="space-y-1.5">
                      <div className="flex items-start gap-2 text-[11px] text-slate-300">
                        <span className="flex-shrink-0 h-4 w-4 rounded-full theme-bg-very-light border theme-border-light flex items-center justify-center text-[10px] theme-text font-bold">1</span>
                        <span>Download template edit berisi data produk saat ini</span>
                      </div>
                      <div className="flex items-start gap-2 text-[11px] text-slate-300">
                        <span className="flex-shrink-0 h-4 w-4 rounded-full theme-bg-very-light border theme-border-light flex items-center justify-center text-[10px] theme-text font-bold">2</span>
                        <span>Edit data di Excel sesuai kebutuhan</span>
                      </div>
                      <div className="flex items-start gap-2 text-[11px] text-slate-300">
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
                    className="w-full bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] h-9 text-xs disabled:opacity-50"
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
                        : 'border-white/[0.04] hover:border-white/[0.06]'
                    }`}
                  >
                    {editExcelFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 theme-text" />
                        <span className="text-xs text-slate-200">{editExcelFile.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditExcelFile(null)}
                          className="h-6 w-6 p-0 text-slate-500 hover:text-red-400"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto mb-2 text-slate-600" />
                        <p className="text-xs text-slate-400">Drag & drop file Excel/CSV di sini</p>
                        <p className="text-[11px] text-slate-500 mt-1">atau</p>
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
                      <div className="w-full text-center py-2 rounded-md bg-white/[0.04] border border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] cursor-pointer text-xs">
                        Pilih File
                      </div>
                    </label>
                  )}

                  <div className="space-y-1">
                    <p className="text-[11px] text-slate-500 font-medium">Kolom yang diperbarui:</p>
                    <p className="text-[11px] text-slate-400">Hanya kolom yang diisi (tidak kosong) akan diperbarui. ID digunakan untuk pencocokan.</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3 py-1">
              {/* Result summary */}
              <div className="rounded-lg border border-white/[0.06] bg-nebula/50 p-3 space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">Hasil Update</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 theme-text" />
                    <span className="text-slate-300">
                      <span className="font-semibold theme-text">{editExcelResult.updated}</span> produk berhasil diperbarui
                    </span>
                  </div>
                  {(editExcelResult.variantsUpdated || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <Layers className="h-3.5 w-3.5 theme-text" />
                      <span className="text-slate-300">
                        <span className="font-semibold theme-text">{editExcelResult.variantsUpdated}</span> varian berhasil diperbarui
                      </span>
                    </div>
                  )}
                  {(editExcelResult.notFound || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-slate-300">
                        <span className="font-semibold text-amber-400">{editExcelResult.notFound}</span> produk tidak ditemukan
                      </span>
                    </div>
                  )}
                  {(editExcelResult.variantsNotFound || 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-slate-300">
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
                          <p key={i} className="text-[11px] text-slate-500 pl-5">• {err}</p>
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
                  className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs disabled:opacity-50"
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
      <Sheet open={detailOpen} onOpenChange={handleDetailOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg bg-nebula border-white/[0.06] p-0 overflow-hidden"
        >
          {detailProduct && (
            <>
              <SheetHeader className="p-4 pb-3">
                <SheetTitle className="text-white text-sm font-semibold">
                  {detailProduct.name}
                </SheetTitle>
                <SheetDescription className="text-slate-500 text-[11px]">
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

              <ScrollArea className="h-[calc(100dvh-64px)]">
                <div className="px-4 pb-4 space-y-4">
                  {detailLoading && !detailData ? (
                    <div className="space-y-3">
                      <Skeleton className="h-16 bg-white/[0.04] rounded" />
                      <Skeleton className="h-48 bg-white/[0.04] rounded" />
                    </div>
                  ) : detailData ? (
                    <>
                      {/* Product Info Card */}
                      <div className="rounded-lg border border-white/[0.06] bg-nebula/50 p-3 space-y-2">
                        <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5 theme-text" />
                          Product Info
                        </h3>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-slate-500 text-[11px]">SKU</span>
                            <p className="text-slate-200 font-mono">{detailData.product.sku || '-'}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 text-[11px]">Stock</span>
                            <p className={
                              detailData.product.stock <= detailData.product.lowStockAlert
                                ? 'text-red-400'
                                : 'text-slate-200'
                            }>
                              {formatNumber(detailData.product.stock)}
                              {detailData.product.hasComposition && (
                                <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] text-emerald-400 align-middle">
                                  <RefreshCw className="h-2 w-2" /> auto
                                </span>
                              )}
                            </p>
                          </div>
                          {detailData.product.hasComposition ? (
                            <div className="col-span-2 mt-0.5 flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5">
                              <RefreshCw className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                              <span className="text-[10px] text-emerald-300 leading-tight">
                                Stok dihitung otomatis dari inventory. Restock & Penyesuaian dinonaktifkan — ubah stok inventory item terkait.
                              </span>
                            </div>
                          ) : (
                            <div className="col-span-2 flex gap-1.5 mt-0.5">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] px-2 theme-bg-very-light theme-text border theme-border-light hover:theme-bg-subtle"
                                onClick={() => {
                                  setRestockProduct(detailData.product as unknown as Product)
                                  setRestockQty('')
                                  setVariantRestocks([])
                                  setRestockOpen(true)
                                }}
                              >
                                <RefreshCw className="h-2.5 w-2.5 mr-0.5" /> Restock
                              </Button>
                              {(
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-[10px] px-2 bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20"
                                  onClick={() => {
                                    // Use detailData.product as the base since it has fresh variants data
                                    const productForAdjust = detailProduct ? {
                                      ...detailProduct,
                                      variants: detailData?.product.variants || detailProduct.variants
                                    } : detailData.product as unknown as Product
                                    openAdjustDialog(productForAdjust, detailData?.product.variants)
                                  }}
                                >
                                  <FilePenLine className="h-2.5 w-2.5 mr-0.5" /> Penyesuaian
                                </Button>
                              )}
                            </div>
                          )}
                          {isOwner && (
                            <div>
                              <span className="text-slate-500 text-[11px]">HPP</span>
                              <p className="text-slate-200">{formatCurrency(detailData.product.hpp)}</p>
                            </div>
                          )}
                          <div>
                            <span className="text-slate-500 text-[11px]">Price</span>
                            <p className="text-slate-200">
                              {detailData.product._maxPrice && detailData.product._maxPrice !== detailData.product.price
                                ? <>{formatCurrency(detailData.product.price)}<span className="text-slate-500 text-[10px]"> ~ </span>{formatCurrency(detailData.product._maxPrice)}</>
                                : formatCurrency(detailData.product.price)
                              }
                            </p>
                          </div>
                          {detailData.product.bruto > 0 && (
                            <div>
                              <span className="text-slate-500 text-[11px]">Bruto</span>
                              <p className="text-slate-200">{formatNumber(detailData.product.bruto)}g</p>
                            </div>
                          )}
                          {detailData.product.netto > 0 && (
                            <div>
                              <span className="text-slate-500 text-[11px]">Netto</span>
                              <p className="text-slate-200">{formatNumber(detailData.product.netto)}g</p>
                            </div>
                          )}
                          <div>
                            <span className="text-slate-500 text-[11px]">Low Stock Alert</span>
                            <p className="text-slate-200">{formatNumber(detailData.product.lowStockAlert)}</p>
                          </div>
                        </div>
                      </div>

                      {/* Barcode Card — Non-variant product (compact on mobile)
                          AETHER BARCODE CONTRACT: encoded value + generator unchanged.
                          Only the visual preview is shrunk so it stops dominating the sheet. */}
                      {!detailData.product.hasVariants && detailData.product.barcode && (
                        <div className="rounded-lg border border-white/[0.06] bg-nebula/50 p-2.5 sm:p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                              <ScanBarcode className="h-3.5 w-3.5 theme-text" />
                              Barcode
                            </h3>
                            {/* Source indicator — compact pill, not a long paragraph */}
                            <span className={cn(
                              'text-[9px] px-1.5 py-0.5 rounded-md font-medium shrink-0',
                              detailData.product.barcode.startsWith('AET-')
                                ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
                                : 'bg-white/[0.05] text-slate-400 ring-1 ring-white/[0.06]'
                            )}>
                              {detailData.product.barcode.startsWith('AET-') ? 'Otomatis' : 'Manual'}
                            </span>
                          </div>
                          {/* Compact barcode preview — max 150px tall, print button BELOW bars (not overlaying) */}
                          <div className="flex flex-col items-center bg-white rounded-md p-2 max-h-[150px] overflow-hidden">
                            <BarcodeDisplay
                              value={detailData.product.barcode}
                              width={2}
                              height={50}
                              fontSize={11}
                              margin={2}
                              showPrint
                              label={detailData.product.name}
                              priceLabel={formatCurrency(detailData.product.price || 0)}
                            />
                          </div>
                        </div>
                      )}

                      {/* Barcode Card — Variant product: 1 active barcode + collapsible list for the rest.
                          Generator + encoded values unchanged. */}
                      {detailData.product.hasVariants && detailData.product.variants && detailData.product.variants.some((v: any) => v.barcode) && (
                        <VariantBarcodeCard
                          productName={detailData.product.name}
                          variants={detailData.product.variants}
                        />
                      )}

                      {/* Variant List Card */}
                      {detailData.product.hasVariants && detailData.product.variants && detailData.product.variants.length > 0 && (
                        <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-3 space-y-2">
                          <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 text-violet-400" />
                            Varian ({detailData.product.variants.length})
                          </h3>
                          {/* Table header */}
                          <div className="grid grid-cols-4 gap-1 px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                            <div className="col-span-1">Nama / SKU</div>
                            <div className="text-right">HPP</div>
                            <div className="text-right">Harga</div>
                            <div className="text-right">Stok</div>
                          </div>
                          <div className="space-y-1">
                            {detailData.product.variants.map((v: any) => {
                              const isOutOfStock = v.stock <= 0
                              const isLowStock = v.stock > 0 && v.stock <= (detailData.product.lowStockAlert || 10)
                              const isFocused = focusedVariantId === v.id
                              return (
                                <div
                                  key={v.id}
                                  data-variant-id={v.id}
                                  className={cn(
                                    'rounded-lg px-2.5 py-2 transition-all',
                                    isFocused
                                      ? 'bg-violet-500/10 ring-2 ring-violet-500/70 shadow-[0_0_0_1px_rgba(139,92,246,0.4)]'
                                      : 'bg-white/[0.03] ring-1 ring-transparent',
                                  )}
                                >
                                  <div className="grid grid-cols-4 gap-1 items-center">
                                    <div className="min-w-0 col-span-1">
                                      <p className="text-xs font-medium text-slate-200 truncate">{v.name}</p>
                                      {v.sku && <p className="text-[10px] text-slate-600 font-mono truncate">{v.sku}</p>}
                                    </div>
                                    <div className="text-right col-span-1">
                                      {isOwner && (
                                        <p className="text-[11px] text-slate-500">{formatCurrency(v.hpp)}</p>
                                      )}
                                    </div>
                                    <div className="text-right col-span-1">
                                      <p className="text-xs font-medium text-slate-200">{formatCurrency(v.price)}</p>
                                    </div>
                                    <div className="text-right col-span-1">
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${isOutOfStock ? 'bg-red-500/10 text-red-400' : isLowStock ? 'bg-amber-500/10 text-amber-400' : 'bg-white/[0.04] text-slate-500'}`}>
                                        {formatNumber(v.stock)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Stock Aging (Pro feature) */}
                      {isPro && (
                        <div className="rounded-lg border border-white/[0.06] bg-nebula/50 p-3 space-y-2">
                          <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-amber-400" />
                            Stock Aging
                          </h3>
                          {stockAgingDays === null ? (
                            <p className="text-xs text-slate-500">Belum ada data restock</p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="text-xs text-slate-300">
                                Terakhir restok: <span className="font-semibold text-white">{stockAgingDays} hari yang lalu</span>
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
                      <div className="rounded-lg border border-white/[0.06] bg-nebula/50 p-3 space-y-2">
                        <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <BarChart3 className="h-3.5 w-3.5 theme-text" />
                          Summary
                        </h3>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded bg-white/[0.03] p-2.5">
                            <div className="flex items-center gap-1.5 text-slate-500 mb-0.5">
                              <ShoppingCart className="h-3 w-3" />
                              <span className="text-[11px]">Total Terjual</span>
                            </div>
                            <p className="text-sm font-semibold text-white">
                              {formatNumber(detailData.summary.totalSold)}
                            </p>
                          </div>
                          <div className="rounded bg-white/[0.03] p-2.5">
                            <div className="flex items-center gap-1.5 text-slate-500 mb-0.5">
                              <TrendingUp className="h-3 w-3" />
                              <span className="text-[11px]">Total Restock</span>
                            </div>
                            <p className="text-sm font-semibold theme-text">
                              +{formatNumber(detailData.summary.totalRestocked)}
                            </p>
                          </div>
                          <div className="rounded bg-white/[0.03] p-2.5">
                            <div className="flex items-center gap-1.5 text-slate-500 mb-0.5">
                              <Package className="h-3 w-3" />
                              <span className="text-[11px]">Stock Saat Ini</span>
                            </div>
                            <p className="text-sm font-semibold text-white">
                              {formatNumber(detailData.summary.currentStock)}
                            </p>
                          </div>
                          <div className="rounded bg-white/[0.03] p-2.5">
                            <div className="flex items-center gap-1.5 text-slate-500 mb-0.5">
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
                      <div className="rounded-lg border border-white/[0.06] bg-nebula/50 p-3 space-y-2">
                        <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 theme-text" />
                          Movement History
                        </h3>

                        <Tabs value={movementFilter} onValueChange={(v) => setMovementFilter(v as MovementFilterTab)}>
                          <TabsList className="bg-white/[0.04] border-white/[0.04] h-7">
                            <TabsTrigger value="all" className="text-[11px] h-5 px-2.5 data-[state=active]:bg-white/[0.04] data-[state=active]:text-white text-slate-400">
                              Semua
                            </TabsTrigger>
                            <TabsTrigger value="restock" className="text-[11px] h-5 px-2.5 data-[state=active]:theme-bg-subtle data-[state=active]:theme-text text-slate-400">
                              Restock
                            </TabsTrigger>
                            <TabsTrigger value="sale" className="text-[11px] h-5 px-2.5 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400 text-slate-400">
                              Penjualan
                            </TabsTrigger>
                            <TabsTrigger value="void" className="text-[11px] h-5 px-2.5 data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400 text-slate-400">
                              Void
                            </TabsTrigger>
                            <TabsTrigger value="transfer" className="text-[11px] h-5 px-2.5 data-[state=active]:bg-sky-500/20 data-[state=active]:text-sky-400 text-slate-400">
                              Transfer
                            </TabsTrigger>
                            <TabsTrigger value="adjustment" className="text-[11px] h-5 px-2.5 data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400 text-slate-400">
                              Penyesuaian
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>

                        {filteredMovements.length === 0 ? (
                          <div className="py-6 text-center text-slate-500 text-xs">
                            No movement history for this filter
                          </div>
                        ) : (
                          <div className="space-y-0">
                            {filteredMovements.map((log, idx) => (
                              <div key={log.id}>
                                {idx > 0 && <Separator className="bg-white/[0.04] my-1.5" />}
                                <div className={`flex items-start gap-2 py-2 px-2 ${getActionRowBg(log.action, log.details)}`}>
                                  <div className="flex-shrink-0 pt-0.5">
                                    {getActionBadge(log.action, log.details)}
                                  </div>
                                  <div className="flex-1 min-w-0 space-y-0.5">
                                    <p className="text-xs text-slate-200">
                                      {getActionDescription(log.action, log.details)}
                                    </p>
                                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
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
                          <div className="pt-2 border-t border-white/[0.06]">
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

      {/* Barcode Scanner Dialog — shared camera scan UI.
          Full-pipeline mode (Task ID: 3-product): resolver + onContextAction
          + closeOnSuccess. Scan a product/variant barcode → resolve via
          /api/pos/products/lookup → on FOUND, open the product detail sheet
          and focus the matched variant. NOT_FOUND / errors keep the scanner
          open for re-scan. */}
      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        resolver={resolveBarcode}
        onContextAction={handleScanContextAction}
        onResult={handleScanResult}
        closeOnSuccess
        title="Scan Barcode Produk"
        inputPlaceholder="Ketik barcode / SKU produk..."
      />
    </div>
  )
}

// ============================================================================
// VariantBarcodeCard — compact mobile barcode card for variant products.
// Shows ONE active barcode (the first variant with a barcode) in a 150px-max
// preview, and collapses the remaining variants behind a "Lihat barcode varian
// lainnya" toggle so the card stops dominating the mobile detail sheet.
//
// AETHER BARCODE CONTRACT: the BarcodeDisplay component, the encoded value,
// and the print label are all unchanged — only the layout/visibility is reshaped.
// ============================================================================
function VariantBarcodeCard({
  productName,
  variants,
}: {
  productName: string
  variants: Array<{ id: string; name: string; barcode: string; price?: number }>
}) {
  const withBarcode = variants.filter((v) => v.barcode)
  // Active = first variant with a barcode. The rest are collapsible.
  const [activeId, setActiveId] = useState<string>(withBarcode[0]?.id ?? '')
  const [expanded, setExpanded] = useState(false)

  if (withBarcode.length === 0) return null

  const active = withBarcode.find((v) => v.id === activeId) ?? withBarcode[0]
  const rest = withBarcode.filter((v) => v.id !== active.id)

  return (
    <div className="rounded-lg border border-white/[0.06] bg-nebula/50 p-2.5 sm:p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <ScanBarcode className="h-3.5 w-3.5 theme-text" />
          Barcode Varian
        </h3>
        <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-white/[0.05] text-slate-400 ring-1 ring-white/[0.06] shrink-0 tabular-nums">
          {withBarcode.length} varian
        </span>
      </div>

      {/* Compact active barcode preview — max 150px tall, print button BELOW bars */}
      <div className="flex flex-col items-center bg-white rounded-md p-2 max-h-[150px] overflow-hidden">
        <p className="text-[10px] font-semibold text-zinc-700 text-center leading-tight mb-0.5 truncate max-w-full">
          {active.name}
        </p>
        <BarcodeDisplay
          value={active.barcode}
          width={2}
          height={50}
          displayValue={false}
          margin={2}
          showPrint
          label={`${productName} — ${active.name}`}
          priceLabel={formatCurrency(active.price || 0)}
        />
        <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{active.barcode}</p>
      </div>

      {/* Variant switcher — pills to swap the active barcode without expanding the list */}
      {withBarcode.length > 1 && (
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide -mx-0.5 px-0.5 py-0.5">
          {withBarcode.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setActiveId(v.id)}
              className={cn(
                'shrink-0 text-[10px] px-2 py-1 rounded-md transition-colors min-w-[44px] min-h-[28px]',
                v.id === active.id
                  ? 'bg-[var(--theme-500)]/15 text-[var(--theme-300)] ring-1 ring-[var(--theme-500)]/30 font-medium'
                  : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200 ring-1 ring-white/[0.05]'
              )}
              title={v.name}
            >
              <span className="truncate max-w-[80px] inline-block align-middle">{v.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Collapsible "Lihat barcode varian lainnya" — shows each remaining variant's
          barcode in its own compact preview. Off by default to save vertical space. */}
      {rest.length > 0 && (
        <div className="border-t border-white/[0.05] pt-1.5">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center justify-between w-full text-[10px] text-slate-400 hover:text-slate-200 transition-colors min-h-[28px]"
            aria-expanded={expanded}
          >
            <span className="flex items-center gap-1">
              <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
              {expanded
                ? 'Sembunyikan barcode varian lainnya'
                : `Lihat barcode varian lainnya (${rest.length})`}
            </span>
          </button>
          {expanded && (
            <div className="mt-1.5 space-y-1.5">
              {rest.map((v) => (
                <div
                  key={v.id}
                  className="flex flex-col items-center bg-white rounded-md p-2 max-h-[150px] overflow-hidden"
                >
                  <p className="text-[10px] font-semibold text-zinc-700 text-center leading-tight mb-0.5 truncate max-w-full">
                    {v.name}
                  </p>
                  <BarcodeDisplay
                    value={v.barcode}
                    width={2}
                    height={50}
                    displayValue={false}
                    margin={2}
                    showPrint
                    label={`${productName} — ${v.name}`}
                    priceLabel={formatCurrency(v.price || 0)}
                  />
                  <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{v.barcode}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
