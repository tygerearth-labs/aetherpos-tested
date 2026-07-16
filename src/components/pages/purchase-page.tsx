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
import { LockedDropdownItem } from '@/components/shared/locked-dropdown-item'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  BookOpen,
  Calculator,
  ChefHat,
  ShoppingBag,
  StickyNote,
  X,
  Tags,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Scale,
  Edit3,
  Pencil,
  FileText,
  FilePenLine,
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
  Timer,
  Clock,
  Flame,
  CalendarDays,
  Hash,
  TrendingDown,
  AlertCircle,
  XCircle,
  FolderInput,
  Ban,
  Lock,
  Lightbulb,
  Coins,
  Tag,
  ShieldCheck,
  ShieldAlert,
  ArrowRightLeft,
  Receipt,
  Check,
  Palette,
  FolderOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import SupplierSearchInput from '@/components/purchase/supplier-search-input'

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
  batch: string
  expiredDate: string
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
  // Legacy flags for backward compatibility
  hasLinkedItems?: boolean
  hasUsageHistory?: boolean
  // New granular flags for precise edit/delete control
  hasProductLinks?: boolean      // Only linked to products (no transfers/sales)
  hasTransferLinks?: boolean     // Has inter-outlet transfers
  hasTransactionLinks?: boolean  // Has sales transactions
  hasRealBusinessHistory?: boolean // Combined: transfers OR sales (blocks edit)
  supplier?: { id: string; name: string; phone: string | null; address: string | null } | null
  createdBy?: { id: string; name: string; email: string } | null
  _batchSummary?: {
    itemsWithBatch: number
    itemsWithExp: number
    expiredItems: number
    sampleBatch: string | null
    nearestExp: string | null
  } | null
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
  batch: string | null
  expiredDate: string | null
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
  updatedAt?: string
  _count?: {
    compositions: number
    purchaseItems: number
    movements: number
    inventoryTransferItems: number
    consumptionSnapshots: number
  }
}

// Delete Safety Status for inventory items
interface DeleteSafetyStatus {
  canDelete: boolean
  riskLevel: 'safe' | 'warning' | 'blocked'
  label: string
  description: string
  blockers: Array<{ type: string; label: string; icon: string }>
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

// ── Batch Intelligence Types ──
interface BatchTimelineEntry {
  id: string
  batchNumber: string | null
  status: string
  initialQty: number
  remainingQty: number
  baseUnit: string
  expiredDate: string | null
  daysUntilExpiry: number | null
  supplierName: string | null
  purchaseOrderNumber: string | null
  unitCost: number
  createdAt: string
}

interface BatchSearchResult {
  batch: {
    id: string
    batchNumber: string | null
    status: string
    initialQty: number
    remainingQty: number
    baseUnit: string
    expiredDate: string | null
    daysUntilExpiry: number | null
    inventoryItem: { id: string; name: string; sku: string | null; baseUnit: string }
  }
  purchaseOrder: {
    id: string
    orderNumber: string
    date: string
    supplierName: string | null
  } | null
  transactions: Array<{
    id: string
    invoiceNumber: string | null
    date: string
    qtyConsumed: number
    sourceProducts: string
  }>
}

interface WasteReportItem {
  id: string
  inventoryItemName: string
  batchNumber: string | null
  initialQty: number
  remainingQty: number
  baseUnit: string
  expiredDate: string | null
  unitCost: number
  totalLoss: number
}

interface DuplicateWarning {
  warning: boolean
  duplicate: {
    batchNumber: string
    remainingQty: number
    baseUnit: string
    expiredDate: string | null
    purchaseOrderNumber: string | null
  } | null
  message?: string
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

/**
 * Delete Safety Status Checker
 * 
 * Determines if an inventory item can be safely deleted based on its relations.
 * 
 * SAFE (can delete):
 * - No history at all
 * - Only MIGRATION data (initial stock upload)
 * 
 * WARNING (can delete with cleanup):
 * - Has auto-generated composition links (from product_stock mode)
 * 
 * BLOCKED (cannot delete, must archive):
 * - Has real purchase history
 * - Has transfer history between outlets
 * - Has sales/consumption transactions
 * - Has manual BOM/composition recipes
 */
/**
 * Delete Safety Status Checker
 * 
 * Determines if an inventory item can be safely deleted based on its relations.
 * LOGIC ALIGNED WITH BACKEND API (/api/inventory/items/[id] DELETE & /api/inventory/items/bulk-delete)
 * 
 * SAFE (can delete):
 * - No history at all (totalRelations === 0)
 * 
 * WARNING (can delete with cleanup):
 * - Only MIGRATION data (initial stock upload via movements)
 * - Only auto-generated composition links (from product_stock mode, qty=1)
 * - Combination of migration movements + auto compositions
 * 
 * BLOCKED (cannot delete, must archive):
 * - Has real purchase history (purchaseItems > 0)
 * - Has transfer history between outlets (inventoryTransferItems > 0)
 * - Has sales/consumption transactions (consumptionSnapshots > 0)
 * 
 * NOTE: Compositions alone do NOT block deletion because backend distinguishes:
 * - Auto 1:1 links (qty=1, from product_stock mode) → cleaned up on delete
 * - Manual BOM recipes (custom qty) → would block, but frontend can't distinguish
 *   → We treat compositions as "warning" to be consistent with backend behavior
 */
function getDeleteSafetyStatus(item: InventoryItem): DeleteSafetyStatus {
  const c = item._count || {}
  const compositions = c.compositions || 0
  const purchaseItems = c.purchaseItems || 0
  const movements = c.movements || 0
  const transferItems = c.inventoryTransferItems || 0
  const consumptionSnapshots = c.consumptionSnapshots || 0
  
  const blockers: Array<{ type: string; label: string; icon: string }> = []
  const warnings: Array<{ type: string; label: string; icon: string }> = []
  
  // ── DEFINITE BLOCKERS (real business history) ──
  if (purchaseItems > 0) {
    blockers.push({
      type: 'purchaseItems',
      label: `${purchaseItems} pembelian`,
      icon: 'ShoppingCart',
    })
  }
  
  if (transferItems > 0) {
    blockers.push({
      type: 'transferItems',
      label: `${transferItems} transfer`,
      icon: 'ArrowRightLeft',
    })
  }
  
  if (consumptionSnapshots > 0) {
    blockers.push({
      type: 'consumptionSnapshots',
      label: `${consumptionSnapshots} transaksi`,
      icon: 'Receipt',
    })
  }
  
  // ── SOFT WARNERS (data that will be cleaned up on delete) ──
  // Movements: Could be migration data (MIGRATION type) or real adjustments
  // Backend checks the referenceType, but frontend treats as warning
  if (movements > 0) {
    warnings.push({
      type: 'movements',
      label: `${movements} catatan stok`,
      icon: 'Activity',
    })
  }
  
  // Compositions: Could be auto 1:1 links (safe) or manual BOM (should block)
  // Since frontend can't distinguish, we treat as warning (consistent with backend
  // which allows deletion and cleans up auto-links)
  if (compositions > 0) {
    warnings.push({
      type: 'compositions',
      label: `${compositions} link produk`,
      icon: 'Package',
    })
  }
  
  // Determine status based on DEFIMATE BLOCKERS first
  const hasBlockers = blockers.length > 0
  const hasWarnings = warnings.length > 0
  const totalRelations = compositions + purchaseItems + movements + transferItems + consumptionSnapshots
  
  // ── CASE 1: No relations at all → SAFE ──
  if (totalRelations === 0) {
    return {
      canDelete: true,
      riskLevel: 'safe',
      label: 'Bisa Dihapus',
      description: 'Item tidak memiliki histori, aman untuk dihapus',
      blockers: [],
    }
  }
  
  // ── CASE 2: Has definite blockers (real business history) → BLOCKED ──
  if (hasBlockers) {
    return {
      canDelete: false,
      riskLevel: 'blocked',
      label: 'Tidak Bisa Dihapus',
      description: `Item memiliki histori bisnis: ${blockers.map(b => b.label).join(', ')}`,
      blockers,
    }
  }
  
  // ── CASE 3: Only soft warnings (migration data / auto links) → WARNING ──
  // This means only movements and/or compositions, no real business history
  // Backend WILL allow deletion and clean up this data
  if (hasWarnings) {
    return {
      canDelete: true,
      riskLevel: 'warning',
      label: 'Hapus + Bersihkan',
      description: `Item hanya memiliki data sistem (${warnings.map(w => w.label).join(', ')}) yang akan dibersihkan otomatis`,
      blockers: [],
    }
  }
  
  // Fallback (shouldn't reach here, but just in case)
  return {
    canDelete: true,
    riskLevel: 'safe',
    label: 'Bisa Dihapus',
    description: 'Item dapat dihapus',
    blockers: [],
  }
}

// Edit Block Status - determines if editing should be disabled for inventory items
interface EditBlockStatus {
  isBlocked: boolean
  reason: string | null
  blockType: 'archived' | 'hasSales' | 'hasTransfers' | null
}

function getEditBlockStatus(item: InventoryItem): EditBlockStatus {
  // Condition 1: Item is non-active (archived)
  if (item.status === 'ARCHIVED') {
    return {
      isBlocked: true,
      reason: 'Item non-aktif. Aktifkan kembali untuk mengedit.',
      blockType: 'archived',
    }
  }
  
  const c = item._count || {}
  const consumptionSnapshots = c.consumptionSnapshots || 0
  const transferItems = c.inventoryTransferItems || 0
  
  // Condition 2: Has sales transactions
  if (consumptionSnapshots > 0) {
    return {
      isBlocked: true,
      reason: `Item memiliki ${consumptionSnapshots} riwayat penjualan. Tidak bisa diedit.`,
      blockType: 'hasSales',
    }
  }
  
  // Condition 3: Has inter-outlet transfers
  if (transferItems > 0) {
    return {
      isBlocked: true,
      reason: `Item memiliki ${transferItems} riwayat transfer antar outlet. Tidak bisa diedit.`,
      blockType: 'hasTransfers',
    }
  }
  
  // Editing is allowed
  return {
    isBlocked: false,
    reason: null,
    blockType: null,
  }
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
  const isOwner = session?.user?.role === 'OWNER'

  // ── Tab ──
  const [tab, setTab] = useState<string>('purchase')

  // ── Guide panels (default hidden, with pulse highlight) ──
  const [showPurchaseGuide, setShowPurchaseGuide] = useState(false)
  const [showPurchaseDialogGuide, setShowPurchaseDialogGuide] = useState(false)
  const [showInventoryGuide, setShowInventoryGuide] = useState(false)

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
  const [poSortBy, setPoSortBy] = useState('createdAt-desc')

  // Purchase detail dialog
  const [poDetailOpen, setPoDetailOpen] = useState(false)
  const [poDetailData, setPoDetailData] = useState<PurchaseOrder | null>(null)
  const [poDetailLoading, setPoDetailLoading] = useState(false)
  const [poDetailHasLinked, setPoDetailHasLinked] = useState(false)
  const [poDetailHasUsageHistory, setPoDetailHasUsageHistory] = useState(false)
  // Track real business history for consistent edit/disable logic with table
  const [poDetailHasRealBusinessHistory, setPoDetailHasRealBusinessHistory] = useState(false)

  // Purchase create dialog
  const [poCreateOpen, setPoCreateOpen] = useState(false)
  const [poCreateLoading, setPoCreateLoading] = useState(false)
  const [poCreateNotes, setPoCreateNotes] = useState('')
  const [poCreateItems, setPoCreateItems] = useState<PurchaseOrderItem[]>([
    { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' },
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
  const [importProgress, setImportProgress] = useState({ step: 0, total: 0, label: '' })
  const [importSupplierId, setImportSupplierId] = useState('')
  const [importPreviewData, setImportPreviewData] = useState<Array<{
    row: number; name: string; sku: string | null; purchaseUnit: string;
    qty: number; baseQty: number; baseUnit: string; pricePerUnit: number;
    batch: string | null; expiredDate: string | null;
    matchedItemId: string | null; matchedItemName: string | null;
    matchedItemSku: string | null; matchedItemUnit: string | null;
    isNew: boolean; error?: string;
  }> | null>(null)
  const importFileRef = useRef<HTMLInputElement | null>(null)

  // Edit Excel state
  const [editExcelOpen, setEditExcelOpen] = useState(false)
  const [editExcelFile, setEditExcelFile] = useState<File | null>(null)
  const [editExcelUploading, setEditExcelUploading] = useState(false)
  const [editExcelResult, setEditExcelResult] = useState<{
    updated: number
    notFound: number
    errors: string[]
  } | null>(null)
  const [editExcelDragOver, setEditExcelDragOver] = useState(false)
  const [templateDownloadLoading, setTemplateDownloadLoading] = useState(false)

  // Bulk category change
  const [bulkCatOpen, setBulkCatOpen] = useState(false)
  const [bulkCatTarget, setBulkCatTarget] = useState<string>('')
  const [bulkCatLoading, setBulkCatLoading] = useState(false)

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
    { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' },
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
  const [invSortBy, setInvSortBy] = useState('name-asc')
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

  // Batch timeline for inventory detail
  const [batchTimeline, setBatchTimeline] = useState<BatchTimelineEntry[]>([])
  const [batchTimelineLoading, setBatchTimelineLoading] = useState(false)

  // Batch search
  const [batchSearchOpen, setBatchSearchOpen] = useState(false)
  const [batchSearchQuery, setBatchSearchQuery] = useState('')
  const [batchSearchResult, setBatchSearchResult] = useState<BatchSearchResult | null>(null)
  const [batchSearchLoading, setBatchSearchLoading] = useState(false)

  // Waste report
  const [wasteReportOpen, setWasteReportOpen] = useState(false)
  const [wasteReportData, setWasteReportData] = useState<{ totalLoss: number; items: WasteReportItem[] } | null>(null)
  const [wasteReportLoading, setWasteReportLoading] = useState(false)
  const [wasteReportStartDate, setWasteReportStartDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 6)
    return d.toISOString().split('T')[0]
  })
  const [wasteReportEndDate, setWasteReportEndDate] = useState(() => new Date().toISOString().split('T')[0])

  // Smart purchase warnings (keyed by item index)
  const [batchWarnings, setBatchWarnings] = useState<Record<number, DuplicateWarning>>({})
  const [expiredWarnings, setExpiredWarnings] = useState<Record<number, boolean>>({})

  // Inventory delete / archive
  const [deleteInvId, setDeleteInvId] = useState<string | null>(null)
  const [deleteInvLoading, setDeleteInvLoading] = useState(false)
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
  const [invBulkDeleteOpen, setInvBulkDeleteOpen] = useState(false)
  const [invBulkDeleting, setInvBulkDeleting] = useState(false)
  const [poExporting, setPoExporting] = useState(false)
  const [invExporting, setInvExporting] = useState(false)
  // Inventory edit Excel
  const [invEditExcelOpen, setInvEditExcelOpen] = useState(false)
  const [invEditExcelFile, setInvEditExcelFile] = useState<File | null>(null)
  const [invEditExcelUploading, setInvEditExcelUploading] = useState(false)
  const [invEditExcelProgress, setInvEditExcelProgress] = useState<string>('') // Progress message
  const [invEditExcelResult, setInvEditExcelResult] = useState<{
    updated: number; notFound: number; errors: string[]; warnings: string[]
  } | null>(null)
  const [invEditExcelDragOver, setInvEditExcelDragOver] = useState(false)

  // Categories
  const [categories, setCategories] = useState<InventoryCategory[]>([])
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [catFormName, setCatFormName] = useState('')
  const [catFormColor, setCatFormColor] = useState('emerald')
  const [catFormLoading, setCatFormLoading] = useState(false)
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null)
  const [deletingCat, setDeletingCat] = useState(false)
  // Category edit & bulk delete states
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(new Set())
  const [bulkDeleteCatsOpen, setBulkDeleteCatsOpen] = useState(false)
  const [bulkDeletingCats, setBulkDeletingCats] = useState(false)

  // Purchase summary (ratio)
  const [purchaseSummary, setPurchaseSummary] = useState<PurchaseSummary | null>(null)
  const [infoExpanded, setInfoExpanded] = useState(false)
  const [invInfoExpanded, setInvInfoExpanded] = useState(false)

  // Post as Product feature
  const [selectedInvIds, setSelectedInvIds] = useState<Set<string>>(new Set())
  const [allInvIds, setAllInvIds] = useState<string[]>([]) // All item IDs across pages for select-all
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
      const [sortField, sortOrder] = poSortBy.split('-')
      const params = new URLSearchParams({ page: String(poPage), search: poDebouncedSearch, sortBy: sortField, sortOrder })
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
  }, [poPage, poDebouncedSearch, poSortBy])

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
        // Client-side sort
        const [sortField, sortDir] = invSortBy.split('-')
        const sorted = [...allItems].sort((a, b) => {
          let cmp = 0
          if (sortField === 'name') cmp = a.name.localeCompare(b.name)
          else if (sortField === 'stock') cmp = a.stock - b.stock
          else if (sortField === 'value') cmp = (a.stock * a.avgCost) - (b.stock * b.avgCost)
          else if (sortField === 'updatedAt') cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          return sortDir === 'desc' ? -cmp : cmp
        })
        // Client-side pagination
        const totalItems = sorted.length
        const totalPages = Math.max(1, Math.ceil(totalItems / invPerPage))
        const start = (invPage - 1) * invPerPage
        const pageItems = sorted.slice(start, start + invPerPage)
        setInvList(pageItems)
        setInvTotalPages(totalPages)
        // Store all IDs for select-all functionality
        setAllInvIds(sorted.map(i => i.id))
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
  }, [invPage, invDebouncedSearch, invCategoryFilter, showInactiveItems, invSortBy])

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
      const activeParam = showInactiveItems ? 'false' : 'true'
      const res = await fetch(`/api/inventory/items?limit=200&activeOnly=${activeParam}`)
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
  }, [showInactiveItems])

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
    setPoDetailHasUsageHistory(!!po.hasUsageHistory)
    // Sync with table logic - use same hasRealBusinessHistory flag
    setPoDetailHasRealBusinessHistory(!!po.hasRealBusinessHistory)
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
      // Derive baseQty: baseQty = totalBaseQty / purchaseQty if possible (with rounding to avoid floating point issues)
      baseQty: item.purchaseQty > 0 ? String(Math.round((item.baseQty / item.purchaseQty) * 10000) / 10000) : String(item.baseQty),
      // Derive pricePerItem: totalCost / purchaseQty
      pricePerItem: item.purchaseQty > 0 ? String(Math.round((item.totalCost / item.purchaseQty) * 100) / 100) : String(item.unitCost * item.baseQty),
      batch: item.batch || '',
      expiredDate: item.expiredDate ? item.expiredDate.split('T')[0] : '',
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
      { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' },
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
              batch: i.batch?.trim() || undefined,
              expiredDate: i.expiredDate || undefined,
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
              batch: i.batch?.trim() || undefined,
              expiredDate: i.expiredDate || undefined,
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
    setPoCreateItems([{ inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' }])
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

  const handleCreateSupplierForCreate = async (name: string, phone?: string) => {
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone: phone?.trim() || undefined }),
      })
      if (res.ok) {
        const data = await res.json()
        const newSupplier = data.supplier || data
        setSupplierOptions(prev => [...prev, { id: newSupplier.id, name: newSupplier.name }])
        return { id: newSupplier.id, name: newSupplier.name }
      }
      const data = await res.json()
      toast.error(data.error || 'Gagal menambahkan supplier')
      return null
    } catch {
      toast.error('Gagal menambahkan supplier')
      return null
    }
  }

  const handleCreateSupplierForImport = async (name: string, phone?: string) => {
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone: phone?.trim() || undefined }),
      })
      if (res.ok) {
        const data = await res.json()
        const newSupplier = data.supplier || data
        setSupplierOptions(prev => [...prev, { id: newSupplier.id, name: newSupplier.name }])
        return { id: newSupplier.id, name: newSupplier.name }
      }
      const data = await res.json()
      toast.error(data.error || 'Gagal menambahkan supplier')
      return null
    } catch {
      toast.error('Gagal menambahkan supplier')
      return null
    }
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
        // Fix Bug #11: Show details message for better debugging
        toast.error(data.details || data.error || 'Gagal membaca file')
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
      const itemId = item.matchedItemId || `__pending_${item.name}_${item.sku || ''}_${idx}_${Date.now()}`
      newItems.push({
        inventoryItemId: itemId,
        inventoryItemName: item.name,
        inventoryItemSku: item.matchedItemSku || item.sku,
        baseUnit: item.baseUnit || item.matchedItemUnit || '',
        qty: String(item.qty || 1),
        unit: item.purchaseUnit || '',
        baseQty: String(item.baseQty || 1),
        pricePerItem: String(item.pricePerUnit || 0),
        batch: item.batch || '',
        expiredDate: item.expiredDate || '',
      })
      // Add new items to poItemOptions so pending creation works
      if (item.isNew && !item.matchedItemId) {
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
    const total = validItems.length

    // Animate progress while backend processes
    let progressTimer: ReturnType<typeof setInterval> | null = null
    let currentStep = 0
    const steps = total <= 10
      ? ['Menyimpan pembelian...']
      : ['Membuat item baru...', 'Menyimpan pembelian...']

    const startProgress = () => {
      setImportProgress({ step: 0, total, label: steps[0] })
      currentStep = 0
      progressTimer = setInterval(() => {
        currentStep = Math.min(currentStep + 1, total)
        const stepIdx = currentStep > total / 2 ? Math.min(1, steps.length - 1) : 0
        setImportProgress({ step: currentStep, total, label: steps[stepIdx] })
      }, total <= 20 ? 200 : 80)
    }
    const stopProgress = () => {
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
      setImportProgress({ step: total, total, label: '' })
    }

    try {
      startProgress()

      // Separate existing items vs new items
      const existingItems = validItems.filter(i => !i.isNew && i.matchedItemId)
      const newItems = validItems.filter(i => i.isNew && !i.matchedItemId)

      // Build purchase items (existing — already have IDs)
      const purchaseItems = existingItems.map(item => {
        const baseQtyVal = item.baseQty || 1
        const qtyVal = item.qty || 0
        const pricePerUnit = item.pricePerUnit || 0
        const totalCost = pricePerUnit * qtyVal
        const totalBaseQty = qtyVal * baseQtyVal
        const unitCost = totalBaseQty > 0 ? totalCost / totalBaseQty : 0

        return {
          inventoryItemId: item.matchedItemId!,
          purchaseQty: qtyVal,
          purchaseUnit: item.purchaseUnit || '',
          baseQty: totalBaseQty,
          baseUnit: item.baseUnit || item.matchedItemUnit || '',
          unitCost,
          totalCost,
          batch: item.batch?.trim() || undefined,
          expiredDate: item.expiredDate || undefined,
        }
      })

      // Build new items (no inventoryItemId — backend creates them)
      const newItemsPayload = newItems.map(item => {
        const baseQtyVal = item.baseQty || 1
        const qtyVal = item.qty || 0
        const pricePerUnit = item.pricePerUnit || 0
        const totalCost = pricePerUnit * qtyVal
        const totalBaseQty = qtyVal * baseQtyVal
        const unitCost = totalBaseQty > 0 ? totalCost / totalBaseQty : 0

        return {
          key: `import_row_${item.row}`,
          name: item.name,
          sku: item.sku || undefined,
          baseUnit: item.baseUnit || item.matchedItemUnit || 'pcs',
          purchaseQty: qtyVal,
          purchaseUnit: item.purchaseUnit || '',
          baseQty: totalBaseQty,
          unitCost,
          totalCost,
          batch: item.batch?.trim() || undefined,
          expiredDate: item.expiredDate || undefined,
        }
      })

      // ONE API CALL: backend creates new items + PO atomically
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: importSupplierId || undefined,
          items: purchaseItems,
          newItems: newItemsPayload.length > 0 ? newItemsPayload : undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        stopProgress()
        toast.success(`Pembelian berhasil! ${data.orderNumber} (${validItems.length} item, ${formatCurrency(data.totalCost)})`)
        setShowImportPreview(false)
        setImportPreviewData(null)
        setImportSupplierId('')
        void fetchPurchaseOrders()
        void fetchInventoryItems()
        void fetchPurchaseSummary()
      } else {
        stopProgress()
        const data = await res.json()
        toast.error(data.error || 'Gagal membuat pembelian')
      }
    } catch (err) {
      stopProgress()
      toast.error('Gagal membuat pembelian')
      console.error('[Import Post] Error:', err)
    } finally {
      setImportPosting(false)
    }
  }

  const handleAddPoItem = () => {
    setPoCreateItems(prev => [
      ...prev,
      { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' },
    ])
  }

  const handleRemovePoItem = (idx: number) => {
    if (poCreateItems.length <= 1) return
    setPoCreateItems(prev => prev.filter((_, i) => i !== idx))
  }

  const handleUpdatePoItem = (idx: number, field: keyof PurchaseOrderItem, value: string) => {
    setPoCreateItems(prev => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
    if (field === 'batch') checkDuplicateBatch(idx, value)
    if (field === 'expiredDate') checkExpiredDate(idx, value)
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
        setPoCreateItems(prev => [...prev, { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' }])
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
          setPoCreateItems(prev => [...prev, { inventoryItemId: skuMatch.id, inventoryItemName: skuMatch.name, inventoryItemSku: skuMatch.sku, baseUnit: skuMatch.baseUnit, qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' }])
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
            setPoCreateItems(prev => [...prev, { inventoryItemId: skuMatch.id, inventoryItemName: skuMatch.name, inventoryItemSku: skuMatch.sku, baseUnit: skuMatch.baseUnit, qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' }])
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
            setPoCreateItems(prev => [...prev, { inventoryItemId: nameMatch.id, inventoryItemName: nameMatch.name, inventoryItemSku: nameMatch.sku, baseUnit: nameMatch.baseUnit, qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' }])
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
        setPoCreateItems(prev => [...prev, { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' }])
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
        matchedItems.push({ inventoryItemId: matched.id, inventoryItemName: matched.name, inventoryItemSku: matched.sku, baseUnit: matched.baseUnit, qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' })
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
        setPoCreateItems(prev => [...prev, { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' }])
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
  const handleDeletePo = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault() // Prevent AlertDialogAction from auto-closing
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
        const data = await res.json().catch(() => ({}))
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

  // ══════════════════════════════════════════════════════════
  // Export helpers (fetch + blob download with error handling)
  // ══════════════════════════════════════════════════════════
  const downloadBlob = async (url: string, filename: string, loadingSetter: (v: boolean) => void) => {
    loadingSetter(true)
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || `Export gagal (${res.status})`)
        return
      }
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      // Delay cleanup to ensure browser finishes initiating the download
      setTimeout(() => {
        a.remove()
        URL.revokeObjectURL(blobUrl)
      }, 1000)
      toast.success('Export berhasil diunduh')
    } catch {
      toast.error('Gagal mengekspor. Coba lagi.')
    } finally {
      loadingSetter(false)
    }
  }

  const handlePoExport = () => {
    const params = new URLSearchParams()
    if (poDebouncedSearch) params.set('search', poDebouncedSearch)
    const qs = params.toString()
    const url = qs ? `/api/purchases/export?${qs}` : '/api/purchases/export'
    const filename = `purchase-export-${new Date().toISOString().slice(0, 10)}.xlsx`
    void downloadBlob(url, filename, setPoExporting)
  }

  const handleInvExport = () => {
    const filename = `inventory-export-${new Date().toISOString().slice(0, 10)}.xlsx`
    void downloadBlob('/api/inventory/items/export', filename, setInvExporting)
  }

  // Pre-fetch inventory item details when opening delete dialog
  // LOGIC FULLY ALIGNED WITH BACKEND API (/api/inventory/items/[id] DELETE & /api/inventory/items/bulk-delete POST)
  //
  // DEFINITE BLOCKERS (CANNOT delete - must use Archive):
  // - purchaseItems: Real purchase history from supplier
  // - inventoryTransferItems: Inter-outlet transfer history  
  // - consumptionSnapshots: Sales/consumption transactions
  // - realCompositions: Manual BOM recipes (qty != 1)
  // - realMovements: Non-migration stock adjustments
  //
  // SOFT WARNERS (CAN delete - backend will clean up):
  // - autoCompositions: Auto 1:1 product links (qty=1) - will be cascade deleted
  // - migrationMovements: Initial stock from migration - will be deleted
  const openDeleteInvDialog = async (id: string) => {
    setDeleteInvId(id)
    setInvDeleteBlocked(null)
    setDeleteInvLoading(true)
    try {
      const res = await fetch(`/api/inventory/items/${id}`)
      if (res.ok) {
        const data = await res.json()
        const counts = data._count || {}
        
        // DEFINITE BLOCKERS - Real business history that CANNOT be deleted
        const hasPurchaseItems = (counts.purchaseItems || 0) > 0
        const hasTransfers = (counts.inventoryTransferItems || 0) > 0
        const hasConsumption = (counts.consumptionSnapshots || 0) > 0
        
        // For compositions & movements, we need detailed analysis (like backend does)
        // But for pre-fetch optimization, we use simple heuristic:
        // - If ONLY has compositions (no other blockers) → let backend decide
        // - If has movements → let backend decide (could be migration)
        const hasCompositions = (counts.compositions || 0) > 0
        const hasMovements = (counts.movements || 0) > 0
        
        // Only block if DEFINITE BLOCKERS exist
        // Compositions and movements are handled by backend smart-delete logic
        const shouldBlock = hasPurchaseItems || hasTransfers || hasConsumption
        
        if (shouldBlock) {
          const blockers: string[] = []
          if (hasPurchaseItems) blockers.push(`${counts.purchaseItems} riwayat pembelian`)
          if (hasCompositions) blockers.push(`${counts.compositions} komposisi produk`)
          if (hasTransfers) blockers.push(`${counts.inventoryTransferItems} riwayat transfer`)
          if (hasConsumption) blockers.push(`${counts.consumptionSnapshots} riwayat konsumsi`)
          
          setInvDeleteBlocked({
            blockType: hasPurchaseItems ? 'hasPurchases' : 'hasHistory',
            message: hasPurchaseItems 
              ? 'Item ini sudah memiliki riwayat pembelian dan tidak dapat dihapus' 
              : 'Item ini memiliki histori bisnis dan tidak dapat dihapus',
            blockers,
            suggestion: hasPurchaseItems
              ? 'Gunakan "Nonaktifkan" untuk menyembunyikan item tanpa kehilangan data pembelian.'
              : 'Gunakan "Nonaktifkan" untuk menyembunyikan item tanpa menghapus data.',
            linkedProducts: [], // No longer blocking on linked products
          })
        }
        // Jika hanya ada compositions/movements (auto-links/migration) → IZINKAN hapus
        // Backend smart-delete logic akan membersihkan data otomatis
      }
    } catch {
      // Non-critical — dialog will still work, just without pre-fetched data
    } finally {
      setDeleteInvLoading(false)
    }
  }

  const handleDeleteInv = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault() // Prevent AlertDialogAction from auto-closing
    if (!deleteInvId) return
    setArchivingInv(true)
    const preFetchedLinked = invDeleteBlocked?.linkedProducts || []
    setInvDeleteBlocked(null)
    try {
      console.log('[Delete Item] Deleting inventory item:', deleteInvId)
      const res = await fetch(`/api/inventory/items/${deleteInvId}`, { method: 'DELETE' })
      console.log('[Delete Item] Response status:', res.status, res.statusText)
      
      if (res.ok) {
        const data = await res.json().catch((err) => {
          console.error('[Delete Item] Failed to parse response:', err)
          return {}
        })
        console.log('[Delete Item] Response data:', data)
        
        if (data.blocked) {
          console.log('[Delete Item] Item blocked:', data.blockers)
          setInvDeleteBlocked({
            blockType: data.blockType || 'hasHistory',
            message: data.message,
            blockers: data.blockers || [],
            suggestion: data.suggestion,
            linkedProducts: data.linkedProducts?.length > 0 ? data.linkedProducts : preFetchedLinked,
          })
        } else {
          toast.success('Item berhasil dihapus')
          setDeleteInvId(null)
          setInvDeleteBlocked(null)
          void fetchInventoryItems()
        }
      } else {
        const data = await res.json().catch((err) => {
          console.error('[Delete Item] Failed to parse error response:', err)
          return {}
        })
        console.error('[Delete Item] Error response:', data)
        toast.error(data.error || `Gagal menghapus item (HTTP ${res.status})`)
        setDeleteInvId(null)
        setInvDeleteBlocked(null)
      }
    } catch (err) {
      console.error('[Delete Item] Exception:', err)
      toast.error('Gagal menghapus item - koneksi gagal')
      setDeleteInvId(null)
      setInvDeleteBlocked(null)
    } finally {
      setArchivingInv(false)
    }
  }

  const handleArchiveInv = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault()
    if (!deleteInvId) return
    setArchivingInv(true)
    try {
      const res = await fetch(`/api/inventory/items/${deleteInvId}`, {
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

  const handleInvBulkDelete = async () => {
    if (selectedInvIds.size === 0) {
      console.warn('[Bulk Delete] No items selected!')
      toast.error('Tidak ada item yang dipilih')
      return
    }
    setInvBulkDeleting(true)
    try {
      const idsArray = Array.from(selectedInvIds)
      console.log('[Bulk Delete] Attempting to delete', idsArray.length, 'items:', idsArray)
      
      const res = await fetch('/api/inventory/items/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsArray }),
      })
      
      // Log status first for debugging - DETAILED LOGGING
      console.log('[Bulk Delete] HTTP Status:', res.status, res.statusText)
      console.log('[Bulk Delete] Response Headers:', Object.fromEntries(res.headers.entries()))
      
      const data = await res.json().catch((e) => {
        console.error('[Bulk Delete] Failed to parse response:', e)
        return { error: 'Gagal membaca response server' }
      })
      
      // DETAILED LOG - show full response
      console.log('[Bulk Delete] Full Response:', JSON.stringify({ 
        status: res.ok, 
        httpStatus: res.status,
        data: data 
      }, null, 2))
      
      if (res.ok) {
        if (data.blockedCount > 0 && data.deletedCount > 0) {
          // Partial success - some deleted, some blocked
          const blockedList = data.blockedItems?.slice(0, 3).join('; ') || ''
          const moreMsg = data.blockedCount > 3 ? ` +${data.blockedCount - 3} lainnya` : ''
          toast.warning(
            <div className="space-y-1">
              <p className="font-semibold">{data.deletedCount} dihapus, {data.blockedCount} dilewati</p>
              <p className="text-[11px] opacity-80">{blockedList}{moreMsg}</p>
            </div>,
            { duration: 5000 }
          )
        } else if (data.blockedCount > 0 && data.deletedCount === 0) {
          // All blocked
          toast.error(
            <div className="space-y-1">
              <p className="font-semibold">Semua item tidak dapat dihapus</p>
              <p className="text-[11px] opacity-80">Item memiliki histori bisnis (pembelian/transaksi). Gunakan Nonaktifkan.</p>
            </div>,
            { duration: 5000 }
          )
        } else if (data.deletedCount === 0 && data.blockedCount === 0) {
          // Nothing happened?
          toast.error('Tidak ada item yang dihapus. Coba refresh halaman.')
        } else {
          // All deleted successfully
          const msg = data.message || `${data.deletedCount} item berhasil dihapus`
          const hasMigrationCleaned = msg.includes('migrasi') || msg.includes('dibersihkan')
          toast.success(
            <div className="space-y-1">
              <p className="font-semibold">{data.deletedCount} item berhasil dihapus</p>
              {hasMigrationCleaned && <p className="text-[11px] opacity-80">Data stok awal & link otomatis dibersihkan</p>}
            </div>
          )
        }
        setInvBulkDeleteOpen(false)
        setSelectedInvIds(new Set())
        void fetchInventoryItems()
      } else {
        // HTTP error - show detailed error with HTTP status
        const errorMsg = data.error || data.details || data.message || `HTTP ${res.status}: Gagal menghapus`
        console.error('[Bulk Delete] Error:', { httpStatus: res.status, errorMsg, fullResponse: data })
        
        toast.error(
          <div className="space-y-1">
            <p className="font-semibold">Gagal menghapus item (HTTP {res.status})</p>
            <p className="text-[11px] opacity-80 break-all">{errorMsg}</p>
            <p className="text-[9px] opacity-60 mt-1">Detail: {JSON.stringify(data).slice(0, 200)}</p>
          </div>,
          { duration: 8000 }
        )
        
        // Keep dialog open so user can see error and retry
      }
    } catch (err) {
      console.error('[Bulk Delete] Exception:', err)
      toast.error('Gagal menghapus item. Periksa koneksi internet dan coba lagi.')
    } finally {
      setInvBulkDeleting(false)
    }
  }

  const handleBulkCategoryChange = async () => {
    if (selectedInvIds.size === 0) return
    setBulkCatLoading(true)
    try {
      const res = await fetch('/api/inventory/items/bulk-category', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedInvIds), categoryId: bulkCatTarget || null }),
      })
      if (res.ok) {
        const data = await res.json()
        const catName = bulkCatTarget ? categories.find(c => c.id === bulkCatTarget)?.name || 'kategori' : 'tanpa kategori'
        toast.success(`${data.updated} item dipindah ke ${catName}`)
        setBulkCatOpen(false)
        setBulkCatTarget('')
        setSelectedInvIds(new Set())
        void fetchInventoryItems()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Gagal mengubah kategori')
      }
    } catch {
      toast.error('Gagal mengubah kategori')
    } finally {
      setBulkCatLoading(false)
    }
  }

  const handleInvEditExcelUpload = async () => {
    if (!invEditExcelFile) return
    setInvEditExcelUploading(true)
    setInvEditExcelProgress('Mengupload & memvalidasi file...')
    setInvEditExcelResult(null)
    
    // Set timeout controller (90 seconds max - increased for large files)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 90000)
    
    try {
      const formData = new FormData()
      formData.append('file', invEditExcelFile)
      
      // Progressive status updates based on typical timing
      const progressSteps = [
        { delay: 1000, msg: 'Membaca file Excel...' },
        { delay: 3000, msg: 'Memvalidasi data (ID, stok, HPP)...' },
        { delay: 6000, msg: 'Mengupdate database (bulk mode)...' },
        { delay: 15000, msg: 'Masih memproses banyak item...' },
        { delay: 30000, msg: 'Hampir selesai...' },
      ]
      
      const timers = progressSteps.map(({ delay, msg }) => 
        setTimeout(() => {
          if (invEditExcelUploading) setInvEditExcelProgress(msg)
        }, delay)
      )
      
      const res = await fetch('/api/inventory/items/bulk-update-excel', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      
      // Clear all pending timers
      clearTimeout(timeoutId)
      timers.forEach(t => clearTimeout(t))
      
      const data = await res.json()
      
      if (res.ok) {
        setInvEditExcelProgress('Selesai!')
        
        // Show processing time if available
        const timeInfo = data.processingTimeMs && data.processingTimeMs > 1000 
          ? ` (${(data.processingTimeMs / 1000).toFixed(1)}s)` 
          : ''
        
        const warnings = data.warnings || []
        
        setInvEditExcelResult({ 
          updated: data.updated || 0, 
          notFound: data.notFound || 0, 
          errors: data.errors || [],
          warnings: warnings,
        })
        
        // Show toast with result summary
        if (data.updated > 0 && warnings.length > 0) {
          // Partial success - some updates, some read-only fields ignored
          toast.success(
            <div className="space-y-1.5">
              <p className="font-semibold">{data.updated} item berhasil diupdate{timeInfo}</p>
              <p className="text-[11px] text-amber-300/80">
                ⚠️ {warnings.length} kolom read-only diabaikan (Stok/HPP)
              </p>
            </div>,
            { duration: 6000 }
          )
        } else if (data.updated > 0) {
          toast.success(
            <div className="space-y-1">
              <p className="font-semibold">{data.updated} item berhasil diupdate{timeInfo}</p>
              {data.message && <p className="text-[11px] opacity-80">{data.message}</p>}
            </div>,
            { duration: 5000 }
          )
        } else if (warnings.length > 0 && data.errors.length === 0) {
          // Only read-only fields were changed
          toast.warning(
            <div className="space-y-1">
              <p className="font-semibold">Tidak ada perubahan tersimpan</p>
              <p className="text-[11px]">Kolom Stok & HPP bersifat read-only</p>
              <p className="text-[10px] opacity-70">Gunakan Stok Opname untuk ubah stok</p>
            </div>,
            { duration: 5000 }
          )
        } else if (data.errors.length > 0) {
          toast.error(`${data.errors.length} error ditemukan`)
        } else {
          toast.info(data.message || 'Tidak ada perubahan yang dilakukan')
        }
        
        void fetchInventoryItems()
      } else {
        // Handle specific error messages
        const errorMsg = typeof data === 'object' ? (data.details || data.error || data.message || '') : ''
        
        if (res.status === 403) {
          toast.error('Fitur ini hanya tersedia untuk akun Pro ke atas')
        } else if (res.status === 400) {
          toast.error(`Error file: ${errorMsg}`)
        } else if (res.status === 408) {
          toast.error(errorMsg || 'Timeout: Proses terlalu lama')
        } else if (res.status === 503) {
          toast.error('Database sibuk, silakan coba lagi dalam beberapa detik')
        } else {
          toast.error(errorMsg || 'Gagal mengupdate inventory')
        }
        
        setInvEditExcelProgress('')
      }
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('Upload error:', err)
      
      if (err instanceof DOMException && err.name === 'AbortError') {
        toast.error('Timeout: Proses melebihi batas waktu. Coba dengan file lebih keil (maks 200 baris).')
      } else {
        toast.error('Gagal mengupload file. Periksa koneksi internet dan coba lagi.')
      }
      
      setInvEditExcelProgress('')
    } finally {
      setInvEditExcelUploading(false)
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

  // ── Batch Timeline Fetch ──
  const fetchBatchTimeline = useCallback(async (inventoryItemId: string) => {
    setBatchTimelineLoading(true)
    try {
      const res = await fetch(`/api/inventory/batches?type=timeline&inventoryItemId=${inventoryItemId}`)
      if (res.ok) {
        const json = await res.json()
        setBatchTimeline(json.data ?? [])
      }
    } catch { /* ignore */ }
    finally { setBatchTimelineLoading(false) }
  }, [])

  // ── Batch Search ──
  const handleBatchSearch = useCallback(async () => {
    const q = batchSearchQuery.trim()
    if (!q) return
    setBatchSearchLoading(true)
    setBatchSearchResult(null)
    try {
      const res = await fetch(`/api/inventory/batches?type=search&batchNumber=${encodeURIComponent(q)}`)
      if (res.ok) {
        const json = await res.json()
        setBatchSearchResult(json.data ?? null)
      } else {
        toast.error('Batch tidak ditemukan')
      }
    } catch { toast.error('Gagal mencari batch') }
    finally { setBatchSearchLoading(false) }
  }, [batchSearchQuery])

  // ── Waste Report ──
  const fetchWasteReport = useCallback(async () => {
    setWasteReportLoading(true)
    try {
      const params = new URLSearchParams({ startDate: wasteReportStartDate, endDate: wasteReportEndDate })
      const res = await fetch(`/api/inventory/batches?type=waste-report&${params}`)
      if (res.ok) {
        const json = await res.json()
        setWasteReportData(json.data ?? null)
      }
    } catch { /* ignore */ }
    finally { setWasteReportLoading(false) }
  }, [wasteReportStartDate, wasteReportEndDate])

  // ── Smart Purchase: Duplicate Batch Check (debounced) ──
  const batchCheckTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const checkDuplicateBatch = useCallback((idx: number, batchNumber: string) => {
    if (batchCheckTimers.current[idx]) clearTimeout(batchCheckTimers.current[idx])
    if (!batchNumber.trim()) {
      setBatchWarnings(prev => { const n = { ...prev }; delete n[idx]; return n })
      return
    }
    batchCheckTimers.current[idx] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventory/batches?type=check-duplicate&batchNumber=${encodeURIComponent(batchNumber)}`)
        if (res.ok) {
          const json = await res.json()
          setBatchWarnings(prev => ({ ...prev, [idx]: json.data }))
        }
      } catch { /* ignore */ }
    }, 500)
  }, [])

  // ── Smart Purchase: Expired Date Check ──
  const checkExpiredDate = useCallback((idx: number, dateStr: string) => {
    if (!dateStr) {
      setExpiredWarnings(prev => { const n = { ...prev }; delete n[idx]; return n })
      return
    }
    const isPast = new Date(dateStr) < new Date(new Date().toISOString().split('T')[0])
    setExpiredWarnings(prev => ({ ...prev, [idx]: isPast }))
  }, [])

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

  // Start editing a category
  const startEditCategory = (cat: InventoryCategory) => {
    setEditingCatId(cat.id)
    setCatFormName(cat.name)
    setCatFormColor(cat.color)
  }

  // Cancel editing
  const cancelEditCategory = () => {
    setEditingCatId(null)
    setCatFormName('')
    setCatFormColor('emerald')
  }

  // Save edited category
  const handleEditCategorySave = async () => {
    if (!editingCatId || !catFormName.trim()) {
      toast.error('Nama kategori wajib diisi')
      return
    }
    setCatFormLoading(true)
    try {
      const res = await fetch(`/api/inventory/categories/${editingCatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: catFormName, color: catFormColor }),
      })
      if (res.ok) {
        toast.success('Kategori berhasil diperbarui')
        cancelEditCategory()
        void fetchCategories()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal memperbarui kategori')
      }
    } catch {
      toast.error('Gagal memperbarui kategori')
    } finally {
      setCatFormLoading(false)
    }
  }

  // Toggle category selection for bulk delete
  const toggleCatSelection = (catId: string) => {
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

  // Select/deselect all categories
  const toggleSelectAllCats = () => {
    if (selectedCatIds.size === categories.length) {
      setSelectedCatIds(new Set())
    } else {
      setSelectedCatIds(new Set(categories.map(c => c.id)))
    }
  }

  // Bulk delete categories
  const handleBulkDeleteCategories = async () => {
    if (selectedCatIds.size === 0) return
    setBulkDeletingCats(true)
    try {
      const deletePromises = Array.from(selectedCatIds).map(id =>
        fetch(`/api/inventory/categories/${id}`, { method: 'DELETE' })
      )
      const results = await Promise.all(deletePromises)
      const allOk = results.every(r => r.ok)
      if (allOk) {
        const deletedIds = Array.from(selectedCatIds)
        toast.success(`${selectedCatIds.size} kategori berhasil dihapus`)
        setSelectedCatIds(new Set())
        setBulkDeleteCatsOpen(false)
        if (deletedIds.some(id => id === invCategoryFilter)) {
          setInvCategoryFilter('all')
        }
        void fetchCategories()
      } else {
        toast.error('Beberapa kategori gagal dihapus')
      }
    } catch {
      toast.error('Gagal menghapus kategori')
    } finally {
      setBulkDeletingCats(false)
    }
  }

  // Reset category dialog state when opened/closed
  useEffect(() => {
    if (!categoryDialogOpen) {
      setEditingCatId(null)
      setSelectedCatIds(new Set())
      setCatFormName('')
      setCatFormColor('emerald')
    }
  }, [categoryDialogOpen])

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
    // Check if ALL items (across all pages) are selected
    if (allInvIds.length > 0 && allInvIds.every(id => selectedInvIds.has(id))) {
      // Deselect all
      setSelectedInvIds(new Set())
    } else {
      // Select all items across all pages
      setSelectedInvIds(new Set(allInvIds))
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
              Pembelian & Inventori
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
              <Select value={poSortBy} onValueChange={(v) => { setPoSortBy(v); setPoPage(1) }}>
                <SelectTrigger className="bg-white/[0.04] border-white/[0.06] text-white text-xs h-8 w-[140px] rounded-lg shrink-0">
                  <ArrowUpDown className="h-3 w-3 mr-1 text-slate-500" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-nebula border-white/[0.06]">
                  <SelectItem value="createdAt-desc" className="text-slate-200 text-xs">Terbaru</SelectItem>
                  <SelectItem value="createdAt-asc" className="text-slate-200 text-xs">Terlama</SelectItem>
                  <SelectItem value="totalCost-desc" className="text-slate-200 text-xs">Nominal Terbesar</SelectItem>
                  <SelectItem value="totalCost-asc" className="text-slate-200 text-xs">Nominal Terkecil</SelectItem>
                  <SelectItem value="orderNumber-asc" className="text-slate-200 text-xs">No. PO A-Z</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => { resetPoCreateForm(); openPoCreate() }}
                className="theme-bg theme-hover text-white text-xs font-medium h-8 px-3 rounded-lg gap-1.5 shrink-0 w-full sm:w-auto"
              >
                <Plus className="h-3.5 w-3.5" />
                Buat Pembelian
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] h-8 text-xs font-medium gap-1.5 shrink-0 w-full sm:w-auto rounded-lg">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    Excel
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px] rounded-xl border-white/[0.08] bg-nebula p-1 shadow-2xl shadow-black/60">
                  <DropdownMenuItem onClick={handlePoExport} disabled={poExporting} className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/[0.04] hover:text-white rounded-lg cursor-pointer focus:bg-white/[0.04] focus:text-white">
                    {poExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : <Download className="h-3.5 w-3.5 text-slate-500" />}
                    <div className="flex-1">
                      <span>Export Excel</span>
                      <p className="text-[10px] text-slate-600">{poExporting ? 'Mengunduh...' : 'Download data'}</p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/[0.06] my-1" />
                  <LockedDropdownItem
                    feature="bulkUpload"
                    icon={<FilePenLine className="h-3.5 w-3.5" />}
                    iconColor="text-slate-500"
                    iconHoverColor="group-hover:text-cyan-400"
                    title="Edit Excel"
                    subtitle="Update massal"
                    onClick={() => { setEditExcelOpen(true); setEditExcelFile(null); setEditExcelResult(null) }}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
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

            {/* Panduan Alur Pembelian — Linear / Stripe / Mercury Style */}
            <div className={cn(
              "rounded-lg border transition-all duration-200",
              showPurchaseGuide
                ? "bg-white/[0.03] border-white/[0.08]"
                : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.1]"
            )}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left group"
                onClick={() => setShowPurchaseGuide(prev => !prev)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-7 h-7 rounded-md bg-white/[0.04]">
                    <BookOpen className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-200 transition-colors" />
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-200 group-hover:text-white transition-colors">Panduan Pembelian</span>
                    <p className="text-[11px] text-slate-500 mt-px">4 langkah untuk mencatat pembelian</p>
                  </div>
                </div>
                <ChevronDown className={cn(
                  'h-4 w-4 text-slate-500 transition-transform duration-200',
                  showPurchaseGuide ? 'rotate-180 text-slate-300' : ''
                )} />
              </button>

              {showPurchaseGuide && (
                <div className="px-4 pb-4 space-y-0">
                  <div className="h-px bg-white/[0.06] -mx-4 mb-4" />

                  {/* Step 1 */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">1</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Tambah Item ke Pembelian</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Klik <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[11px] font-mono">Buat Pembelian</code> lalu gunakan input bar untuk mencari item. Ketik nama, scan barcode, atau pisahkan beberapa item dengan <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[11px] font-mono">koma</code>.
                      </p>
                    </div>
                  </div>
                  <div className="h-px bg-white/[0.04] -mx-4" />

                  {/* Step 2 */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">2</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Item Baru? Isi SKU &amp; Satuan</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Jika item belum ada di inventory, form akan muncul otomatis. Wajib isi <span className="text-slate-200 font-medium">SKU</span> (kode unik) dan <span className="text-slate-200 font-medium">pilih satuan</span> (kg, gr, ml, liter, pcs, dll). Item berstatus pending sampai pembelian disimpan.
                      </p>
                    </div>
                  </div>
                  <div className="h-px bg-white/[0.04] -mx-4" />

                  {/* Step 3 */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">3</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Isi Detail Pembelian</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">Untuk tiap item, isi kolom berikut:</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { label: 'Satuan Beli', desc: 'Cth: sak, ekor, dus' },
                          { label: 'Jumlah', desc: 'Jml satuan beli' },
                          { label: 'Isi / Unit', desc: 'Isi per satuan (base)' },
                          { label: 'Harga / Unit', desc: 'Harga per satuan beli' },
                        ].map((f) => (
                          <div key={f.label} className="rounded-md bg-white/[0.02] border border-white/[0.04] px-3 py-2">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">{f.label}</p>
                            <p className="text-[11px] text-slate-300 mt-0.5">{f.desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="h-px bg-white/[0.04] -mx-4" />

                  {/* Step 4 */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">4</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Simpan &amp; Stok Otomatis Masuk</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Klik <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[11px] font-mono">Simpan Pembelian</code>. Stok otomatis bertambah dan HPP dihitung otomatis.
                      </p>
                      {/* Formula — Stripe-style callout */}
                      <div className="mt-3 rounded-md bg-white/[0.02] border border-white/[0.06] border-l-2 border-l-amber-500/60 px-3 py-2.5">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium mb-1">Rumus HPP</p>
                        <code className="text-[11px] text-slate-300 font-mono">HPP = Harga per Satuan Beli ÷ Isi per Unit</code>
                        <p className="text-[11px] text-slate-500 mt-1.5">Contoh: 1 sak @ Rp90.000, isi 25kg → HPP = <span className="text-slate-200 font-medium">Rp3.600/kg</span></p>
                      </div>
                    </div>
                  </div>

                  {/* Tips — minimal list */}
                  <div className="mt-1 rounded-md bg-white/[0.02] border border-white/[0.06] px-3 py-2.5">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium mb-2">Tips</p>
                    <ul className="text-[11px] text-slate-400 space-y-1.5">
                      <li className="flex items-start gap-2">
                        <span className="text-slate-600 mt-1">—</span>
                        <span>Scan barcode langsung dari input bar, tidak perlu tekan Enter</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-slate-600 mt-1">—</span>
                        <span>Pisahkan beberapa nama item dengan <code className="px-1 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[10px] font-mono">koma</code> untuk tambah sekaligus</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-slate-600 mt-1">—</span>
                        <span>Item baru muncul dengan badge <span className="text-amber-400 font-medium">Baru</span>, bisa diganti sebelum simpan</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-red-400/70 mt-1">!</span>
                        <span>Pembelian yang sudah terkait produk <span className="text-slate-200 font-medium">tidak bisa dihapus</span></span>
                      </li>
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
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Batch / Exp</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Jumlah Item</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Total Biaya</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poList.length === 0 ? (
                      <TableRow className="border-white/[0.04] hover:bg-transparent">
                        <TableCell colSpan={7} className="text-center py-16">
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
                          <TableCell className="text-xs">
                            {po._batchSummary && (po._batchSummary.itemsWithBatch > 0 || po._batchSummary.itemsWithExp > 0) ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                {po._batchSummary.itemsWithBatch > 0 && (
                                  <span className="text-[9px] font-mono text-blue-400/70 bg-blue-500/10 px-1.5 py-0.5 rounded leading-none">
                                    B:{po._batchSummary.sampleBatch || `${po._batchSummary.itemsWithBatch}`}
                                  </span>
                                )}
                                {po._batchSummary.nearestExp && (
                                  <span className={cn(
                                    "text-[9px] px-1.5 py-0.5 rounded font-medium leading-none",
                                    po._batchSummary.expiredItems > 0
                                      ? "text-red-400 bg-red-500/10"
                                      : "text-amber-400/70 bg-amber-500/10"
                                  )}>
                                    Exp: {formatDate(po._batchSummary.nearestExp).split(' ')[0]}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-600">-</span>
                            )}
                          </TableCell>
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
                                className={cn(
                                  "h-7 px-2 transition-colors",
                                  po.hasRealBusinessHistory
                                    ? "text-slate-600 cursor-not-allowed"
                                    : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
                                )}
                                onClick={() => {
                                  if (po.hasRealBusinessHistory) {
                                    toast.error('Pembelian memiliki riwayat bisnis (transfer/penjualan) — tidak bisa diedit')
                                    return
                                  }
                                  openPoEdit(po)
                                }}
                                disabled={po.hasRealBusinessHistory}
                                title={
                                  po.hasRealBusinessHistory
                                    ? 'Ada riwayat transfer/penjualan'
                                    : 'Edit pembelian'
                                }
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {isOwner && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "h-7 px-2 hover:text-red-300 hover:bg-red-500/[0.06]",
                                  (po.hasRealBusinessHistory || po.hasUsageHistory) 
                                    ? "opacity-50 cursor-not-allowed text-red-400/50" 
                                    : po.hasProductLinks
                                      ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/[0.06]"
                                      : "text-red-400"
                                )}
                                onClick={() => {
                                  if (po.hasRealBusinessHistory || po.hasUsageHistory) {
                                    toast.error('Pembelian memiliki riwayat bisnis — tidak bisa dihapus')
                                    return
                                  }
                                  if (po.hasProductLinks) {
                                    toast.warning('Link ke produk akan dibersihkan otomatis')
                                  }
                                  setDeletePoId(po.id)
                                }}
                                disabled={po.hasRealBusinessHistory || po.hasUsageHistory}
                                title={
                                  (po.hasRealBusinessHistory || po.hasUsageHistory)
                                    ? 'Ada riwayat bisnis — tidak bisa dihapus'
                                    : po.hasProductLinks
                                      ? 'Hapus (link produk akan dibersihkan)'
                                      : 'Hapus pembelian'
                                }
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
            <div className="md:hidden space-y-3">
              {poList.length === 0 ? (
                <Card className="bg-nebula border-white/[0.06] rounded-xl">
                  <CardContent className="py-12 text-center">
                    <div className="flex flex-col items-center">
                      <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-3">
                        <ShoppingCart className="h-7 w-7 text-slate-600" />
                      </div>
                      <p className="text-sm text-slate-400 mb-1 font-medium">Belum ada pembelian</p>
                      <p className="text-xs text-slate-600 mb-4">Catat pembelian pertama untuk mulai melacak stok</p>
                      <Button
                        size="sm"
                        onClick={() => { resetPoCreateForm(); openPoCreate() }}
                        className="theme-bg theme-hover text-white text-xs h-9 px-5 rounded-lg gap-1.5"
                      >
                        <Plus className="h-4 w-4" />
                        Buat Pembelian
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <AnimatePresence>
                  {poList.map((po) => {
                    // Determine card accent based on expiry status
                    const hasExpiredItems = po._batchSummary?.expiredItems > 0
                    const hasExpiringSoon = po._batchSummary?.nearestExp && !hasExpiredItems
                    
                    return (
                    <motion.div
                      key={po.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.15 }}
                    >
                      {/* Compact Mobile Card - Single Row Layout */}
                      <div className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border transition-colors active:bg-white/[0.03]",
                        hasExpiredItems ? "bg-red-500/[0.04] border-red-500/20" : 
                        hasExpiringSoon ? "bg-amber-500/[0.03] border-amber-500/18" : 
                        "bg-white/[0.02] border-white/[0.06]"
                      )}>
                        {/* Icon */}
                        <div className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                          hasExpiredItems ? "bg-red-500/10" : hasExpiringSoon ? "bg-amber-500/10" : "bg-white/[0.04]"
                        )}>
                          <FileText className={cn(
                            "h-4 w-4",
                            hasExpiredItems ? "text-red-400" : hasExpiringSoon ? "text-amber-400" : "text-slate-500"
                          )} />
                        </div>

                        {/* Main Content - Flexible */}
                        <div className="flex-1 min-w-0">
                          {/* PO Number + Badges */}
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-white font-semibold font-mono truncate">{po.orderNumber}</span>
                            {po.hasProductLinks && (
                              <span className="inline-flex items-center px-1.5 py-0 rounded bg-violet-500/15 text-violet-400 text-[9px] font-bold shrink-0">
                                <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                                Produk
                              </span>
                            )}
                          </div>
                          {/* Supplier + Items + Date - Single Line */}
                          <div className="flex items-center gap-2 mt-0.5 text-slate-500">
                            <span className="text-[11px] truncate max-w-[100px]">{po.supplierName || '-'}</span>
                            <span className="text-[10px]">•</span>
                            <span className="text-[11px]">{po.itemCount ?? po._count?.items ?? 0} item</span>
                            <span className="text-[10px]">•</span>
                            <span className="text-[10px]">{formatDate(po.createdAt).split(' ')[0]}</span>
                          </div>
                        </div>

                        {/* Right Side - Price + Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <span className="text-sm font-bold text-emerald-400 tabular-nums block leading-tight">{formatCurrency(po.totalCost)}</span>
                            {po._batchSummary?.expiredItems > 0 && (
                              <span className="text-[9px] text-red-400 font-medium">Expired!</span>
                            )}
                          </div>
                          
                          {/* Action Buttons - Compact */}
                          <div className="flex items-center gap-0.5">
                            <button
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-sky-400 hover:bg-sky-500/10 transition-colors"
                              onClick={() => openPoDetail(po)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                                po.hasRealBusinessHistory
                                  ? "text-slate-700 cursor-not-allowed"
                                  : "text-slate-500 hover:text-white hover:bg-white/[0.06]"
                              )}
                              onClick={() => {
                                if (po.hasRealBusinessHistory) {
                                  toast.error('Pembelian memiliki riwayat bisnis — tidak bisa diedit')
                                  return
                                }
                                openPoEdit(po)
                              }}
                              disabled={po.hasRealBusinessHistory}
                              title={po.hasRealBusinessHistory ? 'Ada riwayat bisnis' : 'Edit'}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            {isOwner && (
                              <button
                                className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                                  (po.hasRealBusinessHistory || po.hasUsageHistory)
                                    ? "text-red-400/20 cursor-not-allowed"
                                    : po.hasProductLinks
                                      ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/[0.08]"
                                      : "text-slate-500 hover:text-red-400 hover:bg-red-500/[0.06]"
                                )}
                                onClick={() => {
                                  if (po.hasRealBusinessHistory || po.hasUsageHistory) {
                                    toast.error('Pembelian memiliki riwayat bisnis — tidak bisa dihapus')
                                    return
                                  }
                                  if (po.hasProductLinks) {
                                    toast.warning('Link ke produk akan dibersihkan otomatis')
                                  }
                                  setDeletePoId(po.id)
                                }}
                                disabled={po.hasRealBusinessHistory || po.hasUsageHistory}
                                title={
                                  (po.hasRealBusinessHistory || po.hasUsageHistory)
                                    ? 'Ada riwayat bisnis'
                                    : po.hasProductLinks
                                      ? 'Hapus (link dibersihkan)'
                                      : 'Hapus'
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
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
            {/* Enhanced Filter Bar */}
            <div className="space-y-3">
              {/* Search Row - Primary */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                <div className="relative flex-1 w-full group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-emerald-400 transition-colors" />
                  <Input
                    value={invSearch}
                    onChange={(e) => { setInvSearch(e.target.value); setInvPage(1); setSelectedInvIds(new Set()) }}
                    placeholder="Cari item berdasarkan nama atau SKU..."
                    className={cn(inputClass, 'pl-10 h-10 rounded-xl bg-white/[0.03] border-white/[0.08] focus:border-emerald-500/30 focus:bg-white/[0.05] transition-all')}
                  />
                </div>
                {/* Reset Filters Button - appears when filters active */}
                {(invSearch || invCategoryFilter !== 'all' || showInactiveItems) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setInvSearch(''); setInvCategoryFilter('all'); setShowInactiveItems(false); setInvPage(1); setSelectedInvIds(new Set()) }}
                    className="h-10 px-3 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/[0.08] border border-white/[0.06] hover:border-red-500/20 rounded-xl gap-1.5 shrink-0 transition-all"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Reset</span>
                  </Button>
                )}
              </div>
              
              {/* Filter Actions Row - Secondary */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Category Filter Group */}
                <div className="flex items-center gap-1.5 bg-white/[0.02] border border-white/[0.06] rounded-xl p-1 pr-2">
                  <span className="text-[10px] text-slate-600 uppercase tracking-wider pl-2 font-medium">Kategori</span>
                  <Select value={invCategoryFilter} onValueChange={(v) => { setInvCategoryFilter(v); setInvPage(1); setSelectedInvIds(new Set()) }}>
                    <SelectTrigger className="bg-white/[0.04] border-white/[0.06] text-white text-xs h-7 w-auto min-w-[100px] rounded-lg shadow-none focus:ring-0">
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
                </div>

                {/* Toggle Filters */}
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-7 text-[10px] gap-1.5 border rounded-lg shrink-0 transition-all',
                      showInactiveItems
                        ? 'text-amber-400 hover:text-amber-300 bg-amber-500/[0.1] border-amber-500/30 shadow-sm shadow-amber-500/5'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border-white/[0.06]',
                    )}
                    onClick={() => { setShowInactiveItems(!showInactiveItems); setInvPage(1); setSelectedInvIds(new Set()) }}
                  >
                    <Archive className="h-3 w-3" />
                    <span className="hidden sm:inline">{showInactiveItems ? 'Nonaktif Aktif' : 'Nonaktif'}</span>
                  </Button>
                </div>

                {/* Divider */}
                <div className="h-5 w-px bg-white/[0.06] hidden sm:block" />

                {/* Action Buttons */}
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px] gap-1.5 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/[0.08] border border-white/[0.06] hover:border-cyan-500/20 rounded-lg shrink-0 transition-all"
                    onClick={() => setCategoryDialogOpen(true)}
                  >
                    <Tags className="h-3 w-3" />
                    <span className="hidden md:inline">Kelola Kategori</span>
                  </Button>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px] gap-1.5 text-slate-400 hover:text-violet-400 hover:bg-violet-500/[0.08] border border-white/[0.06] hover:border-violet-500/20 rounded-lg shrink-0 transition-all"
                    onClick={() => { setBatchSearchOpen(true); setBatchSearchQuery(''); setBatchSearchResult(null) }}
                  >
                    <Hash className="h-3 w-3" />
                    <span className="hidden md:inline">Cari Batch</span>
                  </Button>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px] gap-1.5 text-slate-400 hover:text-orange-400 hover:bg-orange-500/[0.08] border border-white/[0.06] hover:border-orange-500/20 rounded-lg shrink-0 transition-all"
                    onClick={() => { setWasteReportOpen(true); setWasteReportData(null) }}
                  >
                    <Flame className="h-3 w-3" />
                    <span className="hidden md:inline">Waste Report</span>
                  </Button>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/[0.08] border border-white/[0.06] hover:border-emerald-500/20 rounded-lg shrink-0 transition-all">
                        <FileSpreadsheet className="h-3 w-3" />
                        <span className="hidden md:inline">Excel</span>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[200px] rounded-xl border-white/[0.08] bg-nebula p-1 shadow-2xl shadow-black/60">
                      <DropdownMenuItem onClick={handleInvExport} disabled={invExporting} className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-slate-300 hover:bg-white/[0.04] hover:text-white rounded-lg cursor-pointer focus:bg-white/[0.04] focus:text-white">
                        {invExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : <Download className="h-3.5 w-3.5 text-emerald-500" />}
                        <div className="flex-1">
                          <span>Export Excel</span>
                          <p className="text-[10px] text-slate-600">{invExporting ? 'Mengunduh...' : 'Download data inventory'}</p>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-white/[0.06] my-1" />
                      <LockedDropdownItem
                        feature="bulkUpload"
                        icon={<FilePenLine className="h-3.5 w-3.5" />}
                        iconColor="text-slate-500"
                        iconHoverColor="group-hover:text-cyan-400"
                        title="Edit Excel"
                        subtitle="Update massal via upload"
                        onClick={() => { setInvEditExcelOpen(true); setInvEditExcelFile(null); setInvEditExcelResult(null) }}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>

            {/* Enhanced Stats Cards */}
            <div className="grid grid-cols-3 gap-2.5">
              {/* Total Item Card */}
              <div className="group relative rounded-xl bg-gradient-to-br from-emerald-500/[0.08] to-transparent border border-emerald-500/10 hover:border-emerald-500/20 p-3.5 transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/5 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-start justify-between">
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider font-medium">Total Item</p>
                    <p className="text-lg font-bold text-white tabular-nums">{formatNumber(invStats.totalItems)}</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/15 transition-colors">
                    <Package className="h-4 w-4 text-emerald-400" />
                  </div>
                </div>
              </div>

              {/* Total Nilai Card */}
              <div className="group relative rounded-xl bg-gradient-to-br from-blue-500/[0.08] to-transparent border border-blue-500/10 hover:border-blue-500/20 p-3.5 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/5 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative flex items-start justify-between">
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider font-medium">Total Nilai</p>
                    <p className="text-sm font-bold text-white tabular-nums leading-tight">{formatCurrency(invStats.totalValue)}</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 group-hover:bg-blue-500/15 transition-colors">
                    <Banknote className="h-4 w-4 text-blue-400" />
                  </div>
                </div>
              </div>

              {/* Stok Rendah Card */}
              <div className={cn(
                'group relative rounded-xl bg-gradient-to-br p-3.5 transition-all duration-300 hover:shadow-lg overflow-hidden',
                invStats.lowStockCount > 0 
                  ? 'from-amber-500/[0.12] to-transparent border border-amber-500/20 hover:border-amber-500/30 hover:shadow-amber-500/10' 
                  : 'from-slate-500/[0.05] to-transparent border border-white/[0.06] hover:border-white/[0.1] hover:shadow-slate-500/5'
              )}>
                <div className={cn(
                  "absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity",
                  invStats.lowStockCount > 0 ? 'from-amber-500/8' : 'from-slate-500/5'
                )} />
                <div className="relative flex items-start justify-between">
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider font-medium">Stok Rendah</p>
                    <p className={cn('text-lg font-bold tabular-nums', invStats.lowStockCount > 0 ? 'text-amber-400' : 'text-white')}>{formatNumber(invStats.lowStockCount)}</p>
                  </div>
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                    invStats.lowStockCount > 0 ? 'bg-amber-500/15 group-hover:bg-amber-500/25' : 'bg-slate-500/10 group-hover:bg-slate-500/15'
                  )}>
                    {invStats.lowStockCount > 0 ? (
                      <AlertTriangle className="h-4 w-4 text-amber-400 animate-pulse" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-slate-400" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Panduan Inventory — Linear / Stripe / Mercury Style */}
            <div className={cn(
              "rounded-lg border transition-all duration-200",
              showInventoryGuide
                ? "bg-white/[0.03] border-white/[0.08]"
                : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.1]"
            )}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left group"
                onClick={() => setShowInventoryGuide(prev => !prev)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-7 h-7 rounded-md bg-white/[0.04]">
                    <PackageOpen className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-200 transition-colors" />
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-200 group-hover:text-white transition-colors">Panduan Inventory</span>
                    <p className="text-[11px] text-slate-500 mt-px">Kelola stok, kategori, dan kebijakan inventory</p>
                  </div>
                </div>
                <ChevronDown className={cn(
                  'h-4 w-4 text-slate-500 transition-transform duration-200',
                  showInventoryGuide ? 'rotate-180 text-slate-300' : ''
                )} />
              </button>

              {showInventoryGuide && (
                <div className="px-4 pb-4 space-y-0">
                  <div className="h-px bg-white/[0.06] -mx-4 mb-4" />

                  {/* Apa itu Inventory Item */}
                  <div className="flex gap-3 py-3">
                    <div className="flex-shrink-0 mt-px">
                      <Package className="h-4 w-4 text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Apa itu Inventory Item?</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Bahan baku atau stok toko yang kamu beli dari supplier. Setiap item punya <code className="px-1 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[10px] font-mono">SKU</code>, <code className="px-1 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[10px] font-mono">base unit</code>, <code className="px-1 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[10px] font-mono">stok</code>, dan <code className="px-1 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[10px] font-mono">HPP</code>.
                      </p>
                    </div>
                  </div>
                  <div className="h-px bg-white/[0.04] -mx-4" />

                  {/* Step 1 — Stok Masuk */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">1</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Cara Stok Masuk</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Stok bertambah otomatis saat kamu <span className="text-slate-200 font-medium">menyimpan pembelian</span> di tab Pembelian. HPP dihitung otomatis dari rata-rata harga beli.
                      </p>
                    </div>
                  </div>
                  <div className="h-px bg-white/[0.04] -mx-4" />

                  {/* Step 2 — Post ke Produk */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">2</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Post ke Produk Jual</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                        Inventory item bisa dijadikan <span className="text-slate-200 font-medium">produk jual</span> dengan klik <code className="px-1 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[10px] font-mono">Post Produk</code>. Ada 2 mode:
                      </p>
                      <div className="space-y-2">
                        <div className="rounded-md bg-white/[0.02] border border-white/[0.06] border-l-2 border-l-rose-500/50 px-3 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <ChefHat className="h-3.5 w-3.5 text-slate-400" />
                            <p className="text-[11px] font-medium text-slate-200">Komposisi (F&amp;B)</p>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">Beberapa inventory → 1 produk. Cth: Tepung 200gr + Gula 50gr → Kue Bolu</p>
                        </div>
                        <div className="rounded-md bg-white/[0.02] border border-white/[0.06] border-l-2 border-l-blue-500/50 px-3 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <ShoppingBag className="h-3.5 w-3.5 text-slate-400" />
                            <p className="text-[11px] font-medium text-slate-200">Satu-satu (Ritel)</p>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">1 inventory → 1 produk langsung. Cth: Susu UHT 1L → produk Susu UHT 1L</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="h-px bg-white/[0.04] -mx-4" />

                  {/* Step 3 — Kategori */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">3</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Kategori &amp; Low Stock Alert</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Gunakan <span className="text-slate-200 font-medium">Kategori</span> untuk mengelompokkan item. Set <span className="text-slate-200 font-medium">Low Stock Alert</span> agar item yang stoknya menipis ditandai merah.
                      </p>
                    </div>
                  </div>

                  {/* Kebijakan Hapus vs Nonaktifkan — Stripe-style callout */}
                  <div className="mt-3 rounded-md bg-white/[0.02] border border-white/[0.06] border-l-2 border-l-violet-500/50 px-3 py-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium mb-3">Kebijakan Hapus &amp; Nonaktifkan</p>
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          <p className="text-[11px] font-medium text-slate-200">Bisa dihapus</p>
                        </div>
                        <ul className="text-[11px] text-slate-400 space-y-1 ml-5">
                          <li>Item baru tanpa histori sama sekali</li>
                          <li>Item yang hanya punya stok awal migrasi</li>
                          <li>Data stok awal &amp; link akan dibersihkan</li>
                        </ul>
                      </div>
                      <div className="h-px bg-white/[0.04]" />
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <XCircle className="h-3 w-3 text-red-400" />
                          <p className="text-[11px] font-medium text-slate-200">Harus nonaktifkan</p>
                        </div>
                        <ul className="text-[11px] text-slate-400 space-y-1 ml-5">
                          <li>Item dengan riwayat pembelian</li>
                          <li>Item yang sudah terjual / terkonsumsi</li>
                          <li>Item dengan riwayat transfer</li>
                          <li>Item dengan komposisi/resep manual</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Catatan Penting */}
                  <div className="mt-3 rounded-md bg-white/[0.02] border border-white/[0.06] px-3 py-2.5">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium mb-2">Catatan</p>
                    <ul className="text-[11px] text-slate-400 space-y-1.5">
                      <li className="flex items-start gap-2">
                        <span className="text-slate-600 mt-0.5">—</span>
                        <span>Kolom <code className="px-1 py-0.5 rounded bg-white/[0.06] text-slate-200 text-[10px] font-mono">Digunakan</code> = jumlah produk yang memakai item ini</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-slate-600 mt-0.5">—</span>
                        <span>HPP selalu dihitung otomatis — tidak bisa di-edit manual</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-slate-600 mt-0.5">—</span>
                        <span>Item nonaktif tetap muncul di laporan tapi tersembunyi di tabel utama</span>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Selection action bar — floating */}
            {selectedInvIds.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between gap-2 p-2.5 rounded-xl bg-nebula/95 backdrop-blur-xl border border-emerald-500/20 shadow-2xl shadow-emerald-500/10 max-w-[calc(100vw-2rem)]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="text-xs text-slate-300 font-medium truncate">
                    <span className="text-emerald-400">{selectedInvIds.size}</span> item terpilih
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors px-1.5"
                    onClick={() => setSelectedInvIds(new Set())}
                  >
                    Batal
                  </button>
                  <Button
                    size="sm"
                    onClick={() => { setBulkCatOpen(true); setBulkCatTarget('') }}
                    className="h-7 text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 px-3 gap-1.5 rounded-lg border border-white/[0.06]"
                  >
                    <FolderInput className="h-3 w-3" />
                    <span className="hidden sm:inline">Pindah Kategori</span>
                    <span className="sm:hidden">Kategori</span>
                  </Button>
                  {isOwner && (
                    <Button
                      size="sm"
                      onClick={() => { setPostStep(1); setPostProductOpen(true); void fetchProductCategories() }}
                      className="h-7 text-[11px] theme-bg theme-hover text-white px-3 gap-1.5 rounded-lg"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span className="hidden sm:inline">Post ke Produk</span>
                      <span className="sm:hidden">Post</span>
                    </Button>
                  )}
                  {isOwner && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setInvBulkDeleteOpen(true)}
                      className="h-7 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/[0.06] px-3 gap-1.5 rounded-lg border border-red-500/10"
                    >
                      <Trash2 className="h-3 w-3" />
                      Hapus
                    </Button>
                  )}
                </div>
              </motion.div>
            )}

            {/* Enhanced Desktop Table */}

            <div className="hidden md:block">
              <Card className="bg-nebula border-white/[0.06] overflow-hidden rounded-xl">
                {/* Grouped Sort Filter Chips */}
                <div className="px-4 pt-4 pb-2 space-y-2">
                  <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium flex items-center gap-1.5">
                    <ArrowUpDown className="h-3 w-3" />
                    Urutkan berdasarkan
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Sort by Name */}
                    <div className="flex items-center gap-1 pr-2 border-r border-white/[0.06]">
                      <span className="text-[9px] text-slate-600 uppercase">Nama</span>
                      {[['name-asc', 'A-Z', 'ChevronsUpDown'], ['name-desc', 'Z-A', 'ChevronsUpDown']].map(([val, label, icon]) => (
                        <button
                          key={val}
                          onClick={() => { setInvSortBy(val); setInvPage(1); setSelectedInvIds(new Set()) }}
                          className={cn(
                            'shrink-0 px-2 py-1 rounded-md text-[10px] font-medium transition-all whitespace-nowrap flex items-center gap-1',
                            invSortBy === val
                              ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30 shadow-sm'
                              : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border border-transparent',
                          )}
                          title={`Urutkan ${label}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Sort by Stock */}
                    <div className="flex items-center gap-1 pr-2 border-r border-white/[0.06]">
                      <span className="text-[9px] text-slate-600 uppercase">Stok</span>
                      {[['stock-desc', 'Terbanyak', 'TrendingUp'], ['stock-asc', 'Terendah', 'TrendingDown']].map(([val, label, icon]) => (
                        <button
                          key={val}
                          onClick={() => { setInvSortBy(val); setInvPage(1); setSelectedInvIds(new Set()) }}
                          className={cn(
                            'shrink-0 px-2 py-1 rounded-md text-[10px] font-medium transition-all whitespace-nowrap flex items-center gap-1',
                            invSortBy === val
                              ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shadow-sm'
                              : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border border-transparent',
                          )}
                          title={`Urutkan: ${label}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Sort by Value */}
                    <div className="flex items-center gap-1 pr-2 border-r border-white/[0.06]">
                      <span className="text-[9px] text-slate-600 uppercase">Nilai</span>
                      {[['value-desc', 'Terbesar', 'TrendingUp'], ['value-asc', 'Terkecil', 'TrendingDown']].map(([val, label, icon]) => (
                        <button
                          key={val}
                          onClick={() => { setInvSortBy(val); setInvPage(1); setSelectedInvIds(new Set()) }}
                          className={cn(
                            'shrink-0 px-2 py-1 rounded-md text-[10px] font-medium transition-all whitespace-nowrap flex items-center gap-1',
                            invSortBy === val
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm'
                              : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border border-transparent',
                          )}
                          title={`Urutkan: ${label}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Sort by Date */}
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-600 uppercase">Waktu</span>
                      {[['updatedAt-desc', 'Terbaru', 'Clock'], ['updatedAt-asc', 'Terlama', 'Clock']].map(([val, label, icon]) => (
                        <button
                          key={val}
                          onClick={() => { setInvSortBy(val); setInvPage(1); setSelectedInvIds(new Set()) }}
                          className={cn(
                            'shrink-0 px-2 py-1 rounded-md text-[10px] font-medium transition-all whitespace-nowrap flex items-center gap-1',
                            invSortBy === val
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-sm'
                              : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border border-transparent',
                          )}
                          title={`Urutkan: ${label}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/[0.06] hover:bg-transparent bg-white/[0.02]">
                        <TableHead className="w-12 pl-4">
                          <div className="flex items-center gap-1.5">
                            <Checkbox
                              checked={allInvIds.length > 0 && allInvIds.every(id => selectedInvIds.has(id)) ? true : selectedInvIds.size > 0 ? 'indeterminate' : false}
                              onCheckedChange={() => toggleSelectAllInv()}
                              className="h-4 w-4"
                            />
                            {selectedInvIds.size > 0 && (
                              <span className="text-[10px] text-slate-500 font-medium tabular-nums">
                                {selectedInvIds.size}/{allInvIds.length}
                              </span>
                            )}
                          </div>
                        </TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider min-w-[220px]">Nama Item</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider w-[130px]">Kategori</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider text-right w-[140px]">Stok</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider text-right w-[150px]">HPP Satuan</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider text-right w-[150px]">Total Nilai</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider text-right w-[90px]">Digunakan</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider text-right w-[120px]">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invList.length === 0 ? (
                        <TableRow className="border-white/[0.04] hover:bg-transparent">
                          <TableCell colSpan={8} className="text-center py-20">
                            <div className="flex flex-col items-center max-w-xs mx-auto">
                              {/* Enhanced Empty State Illustration */}
                              <div className="relative w-20 h-20 mb-5">
                                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-emerald-500/10 to-blue-500/10 animate-pulse" />
                                <div className="relative w-full h-full rounded-3xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center">
                                  <PackagePlus className="h-9 w-9 text-slate-500" />
                                </div>
                                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                  <Plus className="h-3 w-3 text-emerald-400" />
                                </div>
                              </div>
                              <h3 className="text-base font-semibold text-white mb-1.5">Inventory Kosong</h3>
                              <p className="text-sm text-slate-400 mb-1 text-center leading-relaxed">Belum ada item di inventory</p>
                              <p className="text-xs text-slate-600 mb-5 text-center leading-relaxed">Buat pembelian pertama untuk mulai menambah stok dan bahan baku</p>
                              <Button
                                size="sm"
                                onClick={() => { resetPoCreateForm(); openPoCreate() }}
                                className="theme-bg theme-hover text-white text-xs h-9 px-5 rounded-xl gap-2 shadow-lg"
                              >
                                <ShoppingCart className="h-4 w-4" />
                                Buat Pembelian Pertama
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : (
                        invList.map((item, index) => {
                          const isLow = item.stock <= item.lowStockAlert
                          const isSelected = selectedInvIds.has(item.id)
                          const colorClasses = item.category ? getCategoryColorClasses(item.category.color) : null
                          const isArchived = item.status === 'ARCHIVED'
                          // Calculate delete safety status for visual indicator
                          const deleteStatus = getDeleteSafetyStatus(item)
                          // Calculate edit block status
                          const editBlockStatus = getEditBlockStatus(item)
                          return (
                            <TableRow 
                              key={item.id} 
                              className={cn(
                                'group relative border-b border-white/[0.04] transition-all duration-150',
                                // Alternating row backgrounds
                                index % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]',
                                // Hover effect
                                'hover:bg-white/[0.04]',
                                // Selected state
                                isSelected && 'bg-emerald-500/[0.05] hover:bg-emerald-500/[0.08]',
                                // Archived state
                                isArchived && 'opacity-60',
                              )}
                            >
                              {/* Low stock left border indicator */}
                              {isLow && !isArchived && (
                                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-red-500 to-red-500/50 rounded-r" />
                              )}
                              {/* Archived left border indicator */}
                              {isArchived && (
                                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-amber-500 to-amber-500/50 rounded-r" />
                              )}
                              <TableCell className="pl-4">
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleInvSelect(item.id)}
                                  className="h-4 w-4 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                                />
                              </TableCell>
                              <TableCell className="py-3">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    'text-xs font-medium truncate max-w-[160px] block',
                                    isArchived ? 'text-slate-500 line-through decoration-slate-600' : 'text-slate-100'
                                  )}>
                                    {item.name}
                                  </span>
                                  {isArchived && (
                                    <Badge variant="secondary" className="text-[9px] px-2 py-0.5 bg-amber-500/15 text-amber-400 border-amber-500/25 rounded-full shrink-0">
                                      <Archive className="h-2.5 w-2.5 mr-1" />
                                      Nonaktif
                                    </Badge>
                                  )}
                                  {isLow && !isArchived && (
                                    <Badge variant="secondary" className="text-[9px] px-2 py-0.5 bg-red-500/15 text-red-400 border-red-500/25 rounded-full animate-pulse shrink-0">
                                      <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                                      Stok Rendah
                                    </Badge>
                                  )}
                                  {/* Delete Safety Indicator */}
                                  {!isArchived && deleteStatus.riskLevel === 'safe' && (
            <Badge variant="secondary" className="text-[8px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 rounded-full shrink-0" title={deleteStatus.description}>
              <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />
              Aman
            </Badge>
          )}
          {!isArchived && deleteStatus.riskLevel === 'warning' && (
            <Badge variant="secondary" className="text-[8px] px-1.5 py-0 bg-amber-500/10 text-amber-400 border-amber-500/20 rounded-full shrink-0" title={deleteStatus.description}>
              <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
              Migrasi
            </Badge>
          )}
          {!isArchived && deleteStatus.riskLevel === 'blocked' && (
            <Badge variant="secondary" className="text-[8px] px-1.5 py-0 bg-red-500/10 text-red-400 border-red-500/20 rounded-full shrink-0" title={deleteStatus.description}>
              <Lock className="h-2.5 w-2.5 mr-0.5" />
              Terkunci
            </Badge>
          )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {item.category && colorClasses ? (
                                  <Badge 
                                    variant="outline" 
                                    className={cn(
                                      'text-[10px] px-2.5 py-1 rounded-full border font-medium transition-colors',
                                      colorClasses.bg,
                                      colorClasses.text,
                                      colorClasses.border,
                                      'hover:opacity-80'
                                    )}
                                  >
                                    {item.category.name}
                                  </Badge>
                                ) : (
                                  <span className="text-[10px] text-slate-600 italic">Tanpa kategori</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <span className={cn(
                                  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg tabular-nums text-xs font-semibold',
                                  isLow 
                                    ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20' 
                                    : 'text-slate-200'
                                )}>
                                  {formatNumber(item.stock)}
                                  <span className={cn('font-normal text-[10px]', isLow ? 'text-red-400/70' : 'text-slate-500')}>{item.baseUnit}</span>
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <span className="text-xs text-slate-400 tabular-nums">
                                  {formatCurrency(item.avgCost)}<span className="text-slate-600">/{item.baseUnit}</span>
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <span className="text-xs text-emerald-400 font-semibold tabular-nums">
                                  {formatCurrency(item.stock * item.avgCost)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <span className={cn(
                                  'inline-flex items-center justify-center min-w-[24px] h-6 rounded-md text-xs tabular-nums font-medium',
                                  (item._count?.compositions ?? 0) > 0 
                                    ? 'bg-violet-500/15 text-violet-400' 
                                    : 'text-slate-600'
                                )}>
                                  {item._count?.compositions ?? 0}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                                    onClick={() => openInvDetail(item)}
                                    title="Lihat detail item"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                      "h-7 w-7 p-0 rounded-lg transition-colors",
                                      editBlockStatus.isBlocked
                                        ? 'text-slate-600 cursor-not-allowed'
                                        : 'text-slate-400 hover:text-amber-400 hover:bg-amber-500/10'
                                    )}
                                    onClick={() => {
                                      if (editBlockStatus.isBlocked) {
                                        toast.error(editBlockStatus.reason || 'Tidak bisa diedit')
                                        return
                                      }
                                      openInvForm(item)
                                    }}
                                    disabled={editBlockStatus.isBlocked}
                                    title={editBlockStatus.isBlocked ? editBlockStatus.reason : 'Edit item'}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                      'h-7 w-7 p-0 rounded-lg transition-colors',
                                      isArchived
                                        ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                                        : 'text-slate-400 hover:text-red-400 hover:bg-red-500/10',
                                    )}
                                    onClick={() => {
                                      if (isArchived) {
                                        handleRestoreInv(item.id)
                                      } else {
                                        void openDeleteInvDialog(item.id)
                                      }
                                    }}
                                    title={isArchived ? 'Aktifkan kembali' : 'Arsipkan item'}
                                  >
                                    {isArchived ? (
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
                </div>
              </Card>
            </div>

            {/* Enhanced Mobile Sort Chips - Modern Glass Design */}
            <div className="md:hidden">
              <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1 scrollbar-thin">
                <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm">
                  <ArrowUpDown className="h-3 w-3 text-slate-500" />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Sort</span>
                </div>
                {([
                  ['name-asc', 'A-Z', 'violet'],
                  ['name-desc', 'Z-A', 'violet'],
                  ['stock-desc', 'Stok ↓', 'emerald'],
                  ['stock-asc', 'Stok ↑', 'emerald'],
                  ['value-desc', 'Nilai ↓', 'cyan'],
                  ['value-asc', 'Nilai ↑', 'cyan'],
                  ['updatedAt-desc', 'Baru', 'amber'],
                  ['updatedAt-asc', 'Lama', 'amber'],
                ] as const).map(([val, label, color]) => (
                  <button
                    key={val}
                    onClick={() => { setInvSortBy(val); setInvPage(1); setSelectedInvIds(new Set()) }}
                    className={cn(
                      'shrink-0 px-3 py-1.5 rounded-full text-[10px] font-semibold transition-all duration-200 whitespace-nowrap backdrop-blur-sm',
                      invSortBy === val
                        ? cn(
                            'shadow-lg ring-1 ring-white/10 scale-[1.02]',
                            color === 'violet' && 'bg-gradient-to-r from-violet-500/20 to-purple-500/20 text-violet-300 border border-violet-400/30',
                            color === 'cyan' && 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-400/30',
                            color === 'emerald' && 'bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-300 border border-emerald-400/30',
                            color === 'amber' && 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-400/30',
                          )
                        : 'text-slate-500 bg-white/[0.02] border border-transparent hover:text-slate-300 hover:bg-white/[0.05] hover:border-white/[0.08]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Compact Mobile Cards - List Style Layout */}
            <div className="md:hidden space-y-2">
              {invList.length === 0 ? (
                <div className="relative overflow-hidden rounded-xl bg-white/[0.02] border border-white/[0.06]">
                  <div className="py-10 px-5 text-center">
                    <div className="flex flex-col items-center">
                      <div className="w-14 h-14 rounded-xl bg-white/[0.04] flex items-center justify-center mb-3">
                        <PackageOpen className="h-7 w-7 text-slate-600" />
                      </div>
                      <p className="text-sm text-slate-400 mb-1 font-medium">Inventory Kosong</p>
                      <p className="text-xs text-slate-600 mb-4">Buat pembelian pertama untuk menambah stok</p>
                      <Button
                        size="sm"
                        onClick={() => { resetPoCreateForm(); openPoCreate() }}
                        className="theme-bg theme-hover text-white text-xs h-9 px-5 rounded-lg gap-1.5"
                      >
                        <ShoppingCart className="h-4 w-4" />
                        Buat Pembelian
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {invList.map((item, index) => {
                    const isLow = item.stock <= item.lowStockAlert
                    const isSelected = selectedInvIds.has(item.id)
                    const colorClasses = item.category ? getCategoryColorClasses(item.category.color) : null
                    const isArchived = item.status === 'ARCHIVED'
                    // Calculate delete safety status for visual indicator
                    const deleteStatus = getDeleteSafetyStatus(item)
                    // Calculate edit block status
                    const editBlockStatus = getEditBlockStatus(item)
                    
                    return (
                      <motion.div
                        key={item.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15, delay: index * 0.015 }}
                      >
                        {/* Compact List Item - Single Row */}
                        <div 
                          className={cn(
                            'flex items-center gap-2.5 p-2.5 rounded-xl border transition-colors active:bg-white/[0.03]',
                            isSelected ? 'bg-emerald-500/[0.08] border-emerald-500/30' :
                            isLow && !isArchived ? 'bg-red-500/[0.03] border-red-500/15' :
                            isArchived ? 'bg-white/[0.01] border-white/[0.04] opacity-60' :
                            'bg-white/[0.02] border-white/[0.06]'
                          )}
                          onClick={() => toggleInvSelect(item.id)}
                        >
                          {/* Left accent bar */}
                          {isLow && !isArchived && (
                            <div className="w-[3px] h-10 rounded-full bg-red-500/60 shrink-0" />
                          )}
                          {isArchived && (
                            <div className="w-[3px] h-10 rounded-full bg-amber-500/60 shrink-0" />
                          )}
                          
                          {/* Checkbox - Compact */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleInvSelect(item.id) }}
                            className={cn(
                              'w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-all',
                              isSelected 
                                ? 'bg-emerald-500 border-emerald-500 text-white' 
                                : 'border-slate-600 hover:border-slate-500'
                            )}
                          >
                            {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                          </button>

                          {/* Main Content */}
                          <div className="flex-1 min-w-0">
                            {/* Name + Status Badges */}
                            <div className="flex items-center gap-1.5">
                              <span className={cn(
                                'text-sm font-semibold truncate',
                                isArchived ? 'text-slate-500 line-through' : 'text-white'
                              )}>
                                {item.name}
                              </span>
                              {isArchived && (
                                <span className="px-1 py-0 rounded bg-amber-500/15 text-amber-400 text-[8px] font-bold shrink-0">OFF</span>
                              )}
                              {isLow && !isArchived && (
                                <span className="px-1 py-0 rounded bg-red-500/15 text-red-400 text-[8px] font-bold shrink-0">!</span>
                              )}
                              {!isArchived && deleteStatus.riskLevel === 'safe' && (
                                <span className="px-1 py-0 rounded bg-emerald-500/15 text-emerald-400 text-[8px] font-bold shrink-0">✓</span>
                              )}
                            </div>
                            {/* Category + Stock + Unit - Single Line */}
                            <div className="flex items-center gap-2 mt-0.5 text-slate-500">
                              {item.category && colorClasses ? (
                                <span className={cn('text-[10px] px-1.5 py-0 rounded font-medium', colorClasses.bg, colorClasses.text)}>
                                  {item.category.name}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-600">-</span>
                              )}
                              <span className="text-[10px]">•</span>
                              <span className={cn('text-[12px] font-bold tabular-nums', isLow && !isArchived ? 'text-red-400' : 'text-slate-300')}>
                                {formatNumber(item.stock)}
                              </span>
                              <span className="text-[10px]">{item.baseUnit}</span>
                              <span className="text-[10px]">•</span>
                              <span className="text-[11px] text-slate-400">{formatCurrency(item.avgCost)}</span>
                            </div>
                          </div>

                          {/* Action Buttons - Compact Icon Only */}
                          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                              onClick={() => openInvDetail(item)}
                              title="Detail"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              className={cn(
                                "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
                                editBlockStatus.isBlocked
                                  ? "text-slate-700 cursor-not-allowed"
                                  : "text-slate-500 hover:text-amber-400 hover:bg-amber-500/10"
                              )}
                              onClick={() => {
                                if (editBlockStatus.isBlocked) {
                                  toast.error(editBlockStatus.reason || 'Tidak bisa diedit')
                                  return
                                }
                                openInvForm(item)
                              }}
                              disabled={editBlockStatus.isBlocked}
                              title={editBlockStatus.isBlocked ? editBlockStatus.reason : 'Edit'}
                            >
                              <Pencil className="h-3 w-3.5" />
                            </button>
                            <button
                              className={cn(
                                "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
                                isArchived
                                  ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                  : "text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                              )}
                              onClick={() => {
                                if (isArchived) {
                                  handleRestoreInv(item.id)
                                } else {
                                  void openDeleteInvDialog(item.id)
                                }
                              }}
                              title={isArchived ? 'Aktifkan' : 'Hapus'}
                            >
                              {isArchived ? (
                                <RotateCcw className="h-3 w-3.5" />
                              ) : (
                                <Trash2 className="h-3 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              )}
            </div>

            {/* Pagination */}
            <Pagination currentPage={invPage} totalPages={invTotalPages} onPageChange={(p) => { setInvPage(p) }} />
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
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-[10px] text-slate-500">
                              {formatNumber(item.purchaseQty)} {item.purchaseUnit || '-'} = {formatNumber(item.baseQty)} {item.baseUnit || '-'}
                            </span>
                            {item.batch && (
                              <span className="text-[9px] font-mono text-blue-400/70 bg-blue-500/10 px-1.5 py-0.5 rounded">
                                Batch: {item.batch}
                              </span>
                            )}
                            {item.expiredDate && (
                              <span className={cn(
                                "text-[9px] px-1.5 py-0.5 rounded font-medium",
                                new Date(item.expiredDate) < new Date()
                                  ? "text-red-400 bg-red-500/10"
                                  : "text-amber-400/70 bg-amber-500/10"
                              )}>
                                Exp: {formatDate(item.expiredDate)}
                              </span>
                            )}
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
              {isOwner && (
              <div>
                <div className="flex gap-2 pt-2 border-t border-white/[0.04]">
                  {/* EDIT BUTTON - SINKRON DENGAN TABLE LOGIC */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "flex-1 h-8 text-xs gap-1.5",
                      poDetailHasRealBusinessHistory
                        ? "text-slate-600 cursor-not-allowed"
                        : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
                    )}
                    onClick={() => {
                      if (poDetailHasRealBusinessHistory) {
                        toast.error('Pembelian memiliki riwayat bisnis (transfer/penjualan) — tidak bisa diedit')
                        return
                      }
                      openPoEdit(poDetailData!)
                    }}
                    disabled={poDetailHasRealBusinessHistory}
                    title={poDetailHasRealBusinessHistory ? 'Ada riwayat transfer/penjualan' : 'Edit pembelian'}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  {/* HAPUS BUTTON - SINKRON DENGAN TABLE LOGIC */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "flex-1 h-8 text-xs gap-1.5",
                      (poDetailHasRealBusinessHistory || poDetailHasUsageHistory)
                        ? "text-red-400/40 cursor-not-allowed"
                        : poDetailHasLinked
                          ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/[0.06]"
                          : "text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                    )}
                    onClick={() => {
                      if (poDetailHasRealBusinessHistory || poDetailHasUsageHistory) {
                        toast.error('Pembelian memiliki riwayat bisnis — tidak bisa dihapus')
                        return
                      }
                      if (poDetailHasLinked) {
                        toast.warning('Link ke produk akan dibersihkan otomatis')
                      }
                      setDeletePoId(poDetailData!.id)
                    }}
                    disabled={poDetailHasRealBusinessHistory || poDetailHasUsageHistory}
                    title={
                      (poDetailHasRealBusinessHistory || poDetailHasUsageHistory)
                        ? 'Ada riwayat bisnis — tidak bisa dihapus'
                        : poDetailHasLinked
                          ? 'Hapus (link produk akan dibersihkan)'
                          : 'Hapus pembelian'
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Hapus
                  </Button>
                </div>
                {/* Warning message - sinkron dengan table logic */}
                {poDetailHasRealBusinessHistory && (
                  <p className="text-[10px] text-red-400/70 text-center -mt-1">
                    ⚠ Pembelian memiliki riwayat transfer/penjualan — tidak bisa edit/hapus
                  </p>
                )}
                {!poDetailHasRealBusinessHistory && poDetailHasLinked && (
                  <p className="text-[10px] text-amber-400/70 text-center -mt-1">
                    ⚠ Item terkait produk — hapus pembelian bisa mengubah komposisi
                  </p>
                )}
                {!poDetailHasRealBusinessHistory && !poDetailHasLinked && poDetailHasUsageHistory && (
                  <p className="text-[10px] text-amber-400/70 text-center -mt-1">
                    ⚠ Item sudah terpakai dalam transaksi — tidak bisa dihapus
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
            {/* STEP-BY-STEP GUIDE (collapsible) — Linear / Stripe Style */}
            {/* ══════════════════════════════════════════════════════ */}
            <div className={cn(
              "rounded-lg border transition-all duration-200",
              showPurchaseDialogGuide
                ? "bg-white/[0.03] border-white/[0.08]"
                : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.1]"
            )}>
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.01] transition-colors"
                onClick={() => setShowPurchaseDialogGuide(prev => !prev)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-white/[0.04]">
                    <Info className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <span className="text-xs font-medium text-slate-300">Panduan 3 Langkah</span>
                </div>
                <ChevronDown className={cn(
                  "h-4 w-4 text-slate-500 transition-transform duration-200",
                  showPurchaseDialogGuide && 'rotate-180 text-slate-300'
                )} />
              </button>

              {showPurchaseDialogGuide && (
                <div className="px-4 pb-4 space-y-0 border-t border-white/[0.04] pt-4">
                  {/* Step 1 */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">1</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Cari atau ketik nama barang</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Ketik nama item di kolom pencarian. Jika barang belum ada, sistem akan otomatis meminta SKU dan satuan — item baru langsung tercatat saat pembelian disimpan.
                      </p>
                    </div>
                  </div>
                  <div className="h-px bg-white/[0.04]" />

                  {/* Step 2 */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">2</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Isi detail pembelian tiap item</p>
                      <ul className="text-[11px] text-slate-400 leading-relaxed space-y-1.5 mt-1.5 ml-0.5">
                        <li className="flex items-start gap-2">
                          <span className="text-slate-600 shrink-0 mt-0.5">—</span>
                          <span><span className="text-slate-200 font-medium">Satuan Beli</span> — Cara supplier menjual (cth: sak, karung, dus, ekor)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-slate-600 shrink-0 mt-0.5">—</span>
                          <span><span className="text-slate-200 font-medium">Jumlah</span> — Berapa satuan beli yang dipesan (cth: 5 sak)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-slate-600 shrink-0 mt-0.5">—</span>
                          <span><span className="text-slate-200 font-medium">Isi per Satuan</span> — Isi dalam satuan dasar (cth: 1 sak = 25 kg)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-slate-600 shrink-0 mt-0.5">—</span>
                          <span><span className="text-slate-200 font-medium">Harga per Satuan Beli</span> — Harga dari supplier per satuan beli (cth: Rp320.000/sak)</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-slate-600 shrink-0 mt-0.5">—</span>
                          <span><span className="text-slate-200 font-medium">Batch / No. Lot</span> — Nomor batch dari supplier <span className="text-slate-500">(opsional, otomatis dibuat jika kosong)</span></span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-slate-600 shrink-0 mt-0.5">—</span>
                          <span><span className="text-slate-200 font-medium">Tanggal Kadaluarsa</span> — Tanggal expired barang <span className="text-slate-500">(opsional, untuk tracking FEFO)</span></span>
                        </li>
                      </ul>
                    </div>
                  </div>
                  <div className="h-px bg-white/[0.04]" />

                  {/* Step 3 */}
                  <div className="flex gap-3 py-3">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center text-[10px] font-medium text-slate-300 mt-px">3</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 mb-1">Klik "Simpan Pembelian"</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Stok otomatis bertambah di inventory. HPP (Harga Pokok) dihitung rata-rata dari semua pembelian. Item baru otomatis tercatat.
                      </p>
                    </div>
                  </div>

                  {/* Example — Stripe-style callout */}
                  <div className="mt-1 rounded-md bg-white/[0.02] border border-white/[0.06] border-l-2 border-l-amber-500/50 px-3 py-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium mb-2">Contoh: Beli Tepung Segitiga</p>
                    <div className="space-y-1 text-[11px]">
                      <div className="flex justify-between text-slate-400">
                        <span>Satuan Beli</span>
                        <span className="text-slate-200 font-mono">sak</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Jumlah</span>
                        <span className="text-slate-200 font-mono">10</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Isi per sak</span>
                        <span className="text-slate-200 font-mono">25 kg</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Harga/sak</span>
                        <span className="text-slate-200 font-mono">Rp320.000</span>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-white/[0.04] text-[11px] text-slate-400 space-y-1">
                      <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span className="text-slate-200 font-medium">Rp3.200.000</span>
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
              <SupplierSearchInput
                value={poCreateSupplierId}
                onChange={setPoCreateSupplierId}
                options={supplierOptions}
                onCreateSupplier={handleCreateSupplierForCreate}
              />
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
                  onClick={() => void downloadBlob('/api/purchases/import-excel/template', 'template-pembelian-aether-pos.xlsx', setTemplateDownloadLoading)}
                  disabled={templateDownloadLoading}
                  title="Download template Excel untuk import pembelian"
                >
                  {templateDownloadLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
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
                            setPoCreateItems(prev => [...prev, { inventoryItemId: '', inventoryItemName: '', inventoryItemSku: null, baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0', batch: '', expiredDate: '' }])
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
                          {/* Batch / No. Lot */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Batch / No. Lot
                              <span className="text-slate-600 font-normal ml-1">(opsional)</span>
                            </label>
                            <Input
                              value={item.batch}
                              onChange={(e) => handleUpdatePoItem(idx, 'batch', e.target.value)}
                              className={inputClass}
                              placeholder="cth: B2025-001"
                            />
                          </div>
                          {/* Expired Date */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">
                              Expired
                              <span className="text-slate-600 font-normal ml-1">(opsional)</span>
                            </label>
                            <Input
                              type="date"
                              value={item.expiredDate}
                              onChange={(e) => handleUpdatePoItem(idx, 'expiredDate', e.target.value)}
                              className={cn(inputClass, expiredWarnings[idx] ? 'border-red-500/40 text-red-300' : 'text-slate-300')}
                            />
                            {expiredWarnings[idx] && (
                              <p className="text-[10px] text-red-400 flex items-center gap-1 mt-1">
                                <AlertCircle className="h-3 w-3 shrink-0" />
                                🔴 Barang sudah kadaluarsa. Tidak bisa disimpan.
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Smart Purchase Warnings */}
                        {batchWarnings[idx]?.warning && batchWarnings[idx].duplicate && (
                          <div className="bg-amber-500/[0.06] rounded-lg px-3 py-2 border border-amber-500/15 text-[10px] text-amber-300 flex items-start gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>
                              ⚠ Batch sudah pernah ada (sisa {formatNumber(batchWarnings[idx].duplicate!.remainingQty)} {batchWarnings[idx].duplicate!.baseUnit}
                              {batchWarnings[idx].duplicate!.expiredDate && `, Exp ${formatDate(batchWarnings[idx].duplicate!.expiredDate).split(' ')[0]}`}
                              {batchWarnings[idx].duplicate!.purchaseOrderNumber && `, PO-${batchWarnings[idx].duplicate!.purchaseOrderNumber}`})
                            </span>
                          </div>
                        )}

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
      <ResponsiveDialog open={showImportPreview} onOpenChange={(open) => { if (importPosting) return; if (!open) { setShowImportPreview(false); setImportPreviewData(null) } }}>
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
                    ? `${importPreviewData.filter(i => !i.error).length} item ditemukan, ${importPreviewData.filter(i => i.isNew).length} barang baru`
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
              <SupplierSearchInput
                value={importSupplierId}
                onChange={setImportSupplierId}
                options={supplierOptions}
                onCreateSupplier={handleCreateSupplierForImport}
              />
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
                      {item.batch && <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-blue-500/20 text-blue-400/80 bg-blue-500/[0.06] shrink-0 font-mono">B:{item.batch}</Badge>}
                      {item.isNew ? (
                        <Badge className="text-[9px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-400 border-amber-500/20 shrink-0">Baru</Badge>
                      ) : item.matchedItemName ? (
                        <Badge className="text-[9px] px-1.5 py-0 h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shrink-0">Match</Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      {item.expiredDate && (
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
                          new Date(item.expiredDate) < new Date()
                            ? "text-red-400 bg-red-500/10"
                            : "text-amber-400/70 bg-amber-500/10"
                        )}>
                          Exp: {formatDate(item.expiredDate)}
                        </span>
                      )}
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
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="pt-3 mt-auto border-t border-white/[0.06] space-y-2">
            {/* Progress bar (visible during posting) */}
            {importPosting && importProgress.total > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
                    {importProgress.label || 'Memproses...'}
                  </span>
                  <span className="text-slate-500 font-mono">
                    {importProgress.step} / {importProgress.total}
                  </span>
                </div>
                <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-emerald-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((importProgress.step / importProgress.total) * 100, 100)}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>
              </div>
            )}

            <Button
              className="w-full h-10 text-xs theme-bg theme-hover text-white font-medium"
              disabled={!importPreviewData || importPreviewData.filter(i => !i.error).length === 0 || importPosting}
              onClick={handleImportPost}
            >
              {!importPosting && <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
              {importPosting
                ? 'Memproses...'
                : `Posting ${importPreviewData ? importPreviewData.filter(i => !i.error).length : 0} Item`}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1 h-9 text-[11px] text-slate-400 hover:text-white"
                disabled={importPosting}
                onClick={() => { setShowImportPreview(false); setImportPreviewData(null) }}
              >
                {importPosting ? 'Menyimpan...' : 'Batal'}
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
                          {/* Batch / No. Lot */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">Batch / No. Lot</label>
                            <Input
                              value={item.batch}
                              onChange={(e) => handleUpdatePoEditItem(idx, 'batch', e.target.value)}
                              className={inputClass}
                              placeholder="B2025-001"
                            />
                          </div>
                          {/* Expired Date */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium">Expired</label>
                            <Input
                              type="date"
                              value={item.expiredDate}
                              onChange={(e) => handleUpdatePoEditItem(idx, 'expiredDate', e.target.value)}
                              className={cn(inputClass, 'text-slate-300')}
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

      {/* ══════════════════════════════════════════════════════════ */}
      {/* INVENTORY BULK DELETE / EDIT EXCEL DIALOGS               */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* Bulk Category Change */}
      <ResponsiveDialog open={bulkCatOpen} onOpenChange={(open) => { if (!open) { setBulkCatOpen(false); setBulkCatTarget('') } }}>
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06] sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">Pindah Kategori</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Pindahkan {selectedInvIds.size} item ke kategori baru
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="py-3">
            <Select value={bulkCatTarget} onValueChange={setBulkCatTarget}>
              <SelectTrigger className="bg-white/[0.04] border-white/[0.06] text-white text-xs">
                <SelectValue placeholder="Pilih kategori..." />
              </SelectTrigger>
              <SelectContent className="bg-nebula border-white/[0.06]">
                <SelectItem value="__none__" className="text-slate-200 text-xs">Tanpa Kategori</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-slate-200 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color || '#64748b' }} />
                      {c.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ResponsiveDialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setBulkCatOpen(false); setBulkCatTarget('') }} className="bg-white/[0.04] border-white/[0.06] text-slate-300 hover:bg-white/[0.06] text-xs h-9">
              Batal
            </Button>
            <Button
              onClick={() => {
                const catId = bulkCatTarget === '__none__' ? '' : bulkCatTarget
                setBulkCatTarget(catId)
                void handleBulkCategoryChange()
              }}
              disabled={bulkCatLoading || !bulkCatTarget}
              className="theme-bg theme-hover text-white text-xs h-9 gap-1.5"
            >
              {bulkCatLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
              Pindahkan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Bulk Delete Inventory */}
      <AlertDialog open={invBulkDeleteOpen} onOpenChange={setInvBulkDeleteOpen}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Hapus {selectedInvIds.size} Item Inventory?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-sm space-y-2">
              <p>Setiap item akan diperiksa terlebih dahulu:</p>
              <ul className="list-disc list-inside text-[11px] space-y-0.5 text-slate-500 ml-1">
                <li>Item dengan hanya stok awal migrasi <span className="text-emerald-400">akan dihapus</span> (data migrasi dibersihkan)</li>
                <li>Item dengan histori pembelian/transaksi <span className="text-amber-400">akan dilewati</span> (gunakan Nonaktifkan)</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-white/[0.04]">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"
              onClick={(e) => { e.preventDefault(); handleInvBulkDelete() }}
              disabled={invBulkDeleting}
            >
              {invBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Trash2 className="h-3.5 w-3.5 inline mr-1" />Hapus yang Bisa</>)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Inventory Excel Dialog */}
      <ResponsiveDialog open={invEditExcelOpen} onOpenChange={(open) => { if (!open) { setInvEditExcelOpen(false); setInvEditExcelFile(null); setInvEditExcelResult(null); setInvEditExcelProgress('') } }}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">Edit Inventory via Excel</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Update data inventory item via file Excel
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {!invEditExcelResult ? (
            <div className="space-y-3 py-1">
              {/* ⚠️ WARNING: Editability Notice */}
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-amber-300 font-semibold">PENTING: Status Edit Setiap Item</p>
                    <div className="space-y-1 text-[10px]">
                      <p className="text-amber-400/80">• File Excel berisi kolom <strong>"Status Edit"</strong> yang menunjukkan item bisa diedit atau tidak</p>
                      <p className="text-amber-400/80">• <strong>🔒 TERKUNCI</strong>: Hanya Nama, SKU, Kategori yang bisa diubah (sudah ada riwayat bisnis)</p>
                      <p className="text-amber-400/80">• <strong>⚠️ TERBATAS</strong>: Terlink ke produk - hati-hati ganti satuan!</p>
                      <p className="text-amber-400/80">• <strong>✅ BOLEH</strong>: Bebas edit semua kolom (item baru/tanpa riwayat)</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 space-y-2">
                <p className="text-[11px] text-slate-400 font-medium">Langkah-langkah:</p>
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 text-[11px] text-slate-300">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400 font-bold">1</span>
                    <span>Download data inventori (sudah termasuk status edit)</span>
                  </div>
                  <div className="flex items-start gap-2 text-[11px] text-slate-300">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400 font-bold">2</span>
                    <span>CEK kolom "Status Edit" sebelum mengubah data</span>
                  </div>
                  <div className="flex items-start gap-2 text-[11px] text-slate-300">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400 font-bold">3</span>
                    <span>Edit kolom yang diizinkan untuk status item tersebut</span>
                  </div>
                  <div className="flex items-start gap-2 text-[11px] text-slate-300">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400 font-bold">4</span>
                    <span>Upload file yang sudah diedit</span>
                  </div>
                </div>
              </div>
              <Button onClick={() => void downloadBlob('/api/inventory/items/export', `inventory-data-${new Date().toISOString().slice(0, 10)}.xlsx`, setInvEditExcelUploading)} disabled={invEditExcelUploading} variant="outline" className="w-full bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] h-9 text-xs">
                {invEditExcelUploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                Download Data Inventori
              </Button>
              {/* Progress Indicator */}
              {invEditExcelUploading && invEditExcelProgress && (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                    <span className="text-xs text-blue-300 font-medium">{invEditExcelProgress}</span>
                  </div>
                  <div className="w-full bg-white/[0.08] rounded-full h-1.5 overflow-hidden">
                    <div className="bg-blue-500 h-full rounded-full animate-pulse" style={{ width: '60%' }} />
                  </div>
                  <p className="text-[10px] text-slate-500">Mohon tunggu, proses ini bisa memakan waktu beberapa detik...</p>
                </div>
              )}
              
              <div
                onDragOver={(e) => { e.preventDefault(); setInvEditExcelDragOver(true) }}
                onDragLeave={() => setInvEditExcelDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setInvEditExcelDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv'))) {
                    setInvEditExcelFile(file)
                  }
                }}
                className={`relative rounded-xl border-2 border-dashed p-6 text-center transition-all ${invEditExcelUploading ? 'pointer-events-none opacity-50' : ''} ${invEditExcelDragOver ? 'border-emerald-500/50 bg-emerald-500/[0.05]' : invEditExcelFile ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 'border-white/[0.1] hover:border-white/[0.2]'}`}
              >
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setInvEditExcelFile(f); e.target.value = '' }} id="inv-edit-excel-input" disabled={invEditExcelUploading} />
                <label htmlFor="inv-edit-excel-input" className={`cursor-pointer ${invEditExcelUploading ? 'cursor-not-allowed' : ''}`}>
                  {invEditExcelFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <FileSpreadsheet className="h-8 w-8 text-emerald-400" />
                      <p className="text-xs text-white font-medium">{invEditExcelFile.name}</p>
                      <p className="text-[10px] text-slate-500">{(invEditExcelFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="h-8 w-8 text-slate-500" />
                      <p className="text-xs text-slate-300">Drag & drop atau <span className="text-emerald-400">klik untuk pilih</span></p>
                      <p className="text-[10px] text-slate-500">.xlsx, .xls, .csv — Maks. 5MB</p>
                    </div>
                  )}
                </label>
              </div>
              <Button onClick={handleInvEditExcelUpload} disabled={!invEditExcelFile || invEditExcelUploading} className="w-full h-9 text-xs">
                {invEditExcelUploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Memproses...</> : <><Upload className="h-3.5 w-3.5 mr-1.5" /> Upload & Update</>}
              </Button>
            </div>
          ) : (
            <div className="space-y-3 py-1">
              <div className={`rounded-lg border p-4 text-center space-y-2 ${
                invEditExcelResult.updated > 0 
                  ? 'bg-emerald-500/10 border-emerald-500/20' 
                  : invEditExcelResult.warnings.length > 0 && invEditExcelResult.errors.length === 0
                    ? 'bg-amber-500/10 border-amber-500/20'
                    : 'bg-red-500/10 border-red-500/20'
              }`}>
                {invEditExcelResult.updated > 0 ? (
                  <>
                    <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto" />
                    <p className="text-sm font-medium text-white">Update Selesai!</p>
                    <div className="flex justify-center gap-4 text-xs text-slate-400">
                      <span><span className="text-emerald-400 font-semibold">{invEditExcelResult.updated}</span> diupdate</span>
                      {invEditExcelResult.notFound > 0 && <span><span className="text-amber-400 font-semibold">{invEditExcelResult.notFound}</span> tidak ditemukan</span>}
                      {invEditExcelResult.warnings.length > 0 && <span><span className="text-amber-400 font-semibold">{invEditExcelResult.warnings.length}</span> diabaikan</span>}
                    </div>
                  </>
                ) : invEditExcelResult.warnings.length > 0 && invEditExcelResult.errors.length === 0 ? (
                  <>
                    <AlertCircle className="h-8 w-8 text-amber-400 mx-auto" />
                    <p className="text-sm font-medium text-white">Tidak Ada Perubahan Tersimpan</p>
                    <p className="text-[11px] text-slate-400">Kolom Stok & HPP bersifat read-only</p>
                  </>
                ) : (
                  <>
                    <XCircle className="h-8 w-8 text-red-400 mx-auto" />
                    <p className="text-sm font-medium text-white">Update Gagal</p>
                    <p className="text-[11px] text-slate-400">{invEditExcelResult.errors.length} error ditemukan</p>
                  </>
                )}
              </div>
              
              {/* Warnings section (read-only fields) */}
              {invEditExcelResult.warnings.length > 0 && (
                <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-3 max-h-24 overflow-y-auto custom-scrollbar">
                  <p className="text-[11px] text-amber-300 font-medium mb-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {invEditExcelResult.warnings.length} kolom read-only diabaikan:
                  </p>
                  <p className="text-[10px] text-slate-500 mb-2">Stok & HPP dihitung otomatis dari batch/pembelian</p>
                  {invEditExcelResult.warnings.slice(0, 5).map((w, i) => (
                    <p key={i} className="text-[11px] text-slate-400 truncate">• {w}</p>
                  ))}
                  {invEditExcelResult.warnings.length > 5 && (
                    <p className="text-[10px] text-slate-500">...dan {invEditExcelResult.warnings.length - 5} lainnya</p>
                  )}
                </div>
              )}
              
              {/* Errors section */}
              {invEditExcelResult.errors.length > 0 && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 max-h-28 overflow-y-auto custom-scrollbar">
                  <p className="text-[11px] text-red-300 font-medium mb-1.5">{invEditExcelResult.errors.length} error:</p>
                  {invEditExcelResult.errors.map((err, i) => (
                    <p key={i} className="text-[11px] text-slate-400">• {err}</p>
                  ))}
                </div>
              )}
              
              <Button onClick={() => { setInvEditExcelFile(null); setInvEditExcelResult(null) }} className="w-full bg-white/[0.04] border border-white/[0.06] text-slate-300 hover:text-white hover:bg-white/[0.04] h-8 text-xs">
                Selesai
              </Button>
            </div>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete / Archive Inventory Item Alert */}
      <AlertDialog open={!!deleteInvId} onOpenChange={(open) => { if (!open) { setDeleteInvId(null); setInvDeleteBlocked(null) } }}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {deleteInvLoading ? 'Memeriksa item...' : 
                invDeleteBlocked?.blockType === 'hasPurchases' ? (<><ShoppingCart className="h-4 w-4 inline mr-1.5 -mt-0.5" />Item Ada Riwayat Pembelian</>) :
                invDeleteBlocked?.blockType === 'hasTransfers' ? (<><ArrowRightLeft className="h-4 w-4 inline mr-1.5 -mt-0.5" />Item Ada Riwayat Transfer</>) :
                invDeleteBlocked?.blockType === 'hasSales' ? (<><Receipt className="h-4 w-4 inline mr-1.5 -mt-0.5" />Item Ada Riwayat Penjualan</>) :
                invDeleteBlocked?.blockType === 'hasCompositions' ? (<><Package className="h-4 w-4 inline mr-1.5 -mt-0.5" />Item Terhubung ke Produk</>) :
                invDeleteBlocked?.blockType === 'hasMixedHistory' ? (<><AlertTriangle className="h-4 w-4 inline mr-1.5 -mt-0.5" />Item Memiliki Berbagai Histori</>) :
                invDeleteBlocked?.blockType === 'hasHistory' ? (<><Link2 className="h-4 w-4 inline mr-1.5 -mt-0.5" />Item Terhubung ke Data Lain</>) : 
                'Hapus Item?'
              }
            </AlertDialogTitle>
            {!invDeleteBlocked && !deleteInvLoading ? (
              <AlertDialogDescription className="text-slate-400">
                Item ini bisa dihapus (belum ada riwayat pembelian).
                Stok awal dari migrasi akan ikut terhapus.
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>

          {/* Blocked: has purchase history → suggest archive */}
          {invDeleteBlocked && invDeleteBlocked.blockType === 'hasPurchases' && (
            <div className="space-y-3 my-2">
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                <ShoppingCart className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="text-red-300 font-medium">{invDeleteBlocked.message}</p>
                  <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                    Item yang sudah dibeli dari supplier tidak dapat dihapus untuk menjaga integritas data keuangan dan laporan pembelian.
                  </p>
                  <div className="mt-2 space-y-1">
                    {invDeleteBlocked.blockers?.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-slate-400 text-xs">
                        <span className="text-slate-600">•</span> {b}
                      </div>
                    ))}
                  </div>
                  <p className="text-amber-400/80 text-xs mt-2.5 leading-relaxed italic font-medium">
                    <Lightbulb className="h-3 w-3 inline text-amber-400" /> {invDeleteBlocked.suggestion}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Blocked: has transfer history → suggest archive */}
          {invDeleteBlocked && invDeleteBlocked.blockType === 'hasTransfers' && (
            <div className="space-y-3 my-2">
              <div className="flex items-start gap-2 rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
                <ArrowRightLeft className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="text-blue-300 font-medium">{invDeleteBlocked.message}</p>
                  <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                    Item yang sudah ditransfer antar outlet tidak dapat dihapus untuk menjaga konsistensi data inventari multi-outlet.
                  </p>
                  <div className="mt-2 space-y-1">
                    {invDeleteBlocked.blockers?.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-slate-400 text-xs">
                        <span className="text-slate-600">•</span> {b}
                      </div>
                    ))}
                  </div>
                  <p className="text-amber-400/80 text-xs mt-2.5 leading-relaxed italic font-medium">
                    <Lightbulb className="h-3 w-3 inline text-amber-400" /> {invDeleteBlocked.suggestion}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Blocked: has sales/consumption history → suggest archive */}
          {invDeleteBlocked && invDeleteBlocked.blockType === 'hasSales' && (
            <div className="space-y-3 my-2">
              <div className="flex items-start gap-2 rounded-lg bg-purple-500/10 border border-purple-500/20 p-3">
                <Receipt className="h-4 w-4 text-purple-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="text-purple-300 font-medium">{invDeleteBlocked.message}</p>
                  <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                    Item yang telah terpakai dalam transaksi penjualan tidak dapat dihapus untuk menjaga integritas data penjualan dan analisis.
                  </p>
                  <div className="mt-2 space-y-1">
                    {invDeleteBlocked.blockers?.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-slate-400 text-xs">
                        <span className="text-slate-600">•</span> {b}
                      </div>
                    ))}
                  </div>
                  <p className="text-amber-400/80 text-xs mt-2.5 leading-relaxed italic font-medium">
                    <Lightbulb className="h-3 w-3 inline text-amber-400" /> {invDeleteBlocked.suggestion}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Blocked: has composition/BOM links → suggest archive */}
          {invDeleteBlocked && invDeleteBlocked.blockType === 'hasCompositions' && (
            <div className="space-y-3 my-2">
              <div className="flex items-start gap-2 rounded-lg bg-orange-500/10 border border-orange-500/20 p-3">
                <Package className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="text-orange-300 font-medium">{invDeleteBlocked.message}</p>
                  <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                    Item ini digunakan sebagai bahan dalam resep/komposisi produk. Hapus atau ubah komposisi produk terlebih dahulu.
                  </p>
                  <div className="mt-2 space-y-1">
                    {invDeleteBlocked.blockers?.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-slate-400 text-xs">
                        <span className="text-slate-600">•</span> {b}
                      </div>
                    ))}
                  </div>
                  <p className="text-amber-400/80 text-xs mt-2.5 leading-relaxed italic font-medium">
                    <Lightbulb className="h-3 w-3 inline text-amber-400" /> {invDeleteBlocked.suggestion}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Blocked: mixed history types → suggest archive */}
          {invDeleteBlocked && invDeleteBlocked.blockType === 'hasMixedHistory' && (
            <div className="space-y-3 my-2">
              <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3">
                <AlertTriangle className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="text-rose-300 font-medium">{invDeleteBlocked.message}</p>
                  <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                    Item ini memiliki berbagai jenis histori bisnis dan tidak dapat dihapus untuk menjaga integritas data secara keseluruhan.
                  </p>
                  <div className="mt-2 space-y-1">
                    {invDeleteBlocked.blockers?.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-slate-400 text-xs">
                        <span className="text-slate-600">•</span> {b}
                      </div>
                    ))}
                  </div>
                  <p className="text-amber-400/80 text-xs mt-2.5 leading-relaxed italic font-medium">
                    <Lightbulb className="h-3 w-3 inline text-amber-400" /> {invDeleteBlocked.suggestion}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Blocked: other history (fallback for hasHistory) */}
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

          {/* Linked products list */}
          {invDeleteBlocked && invDeleteBlocked.linkedProducts.length > 0 && (
            <div className="my-2 space-y-1.5">
              <p className="text-[11px] text-slate-400 font-medium">{invDeleteBlocked.linkedProducts.length} produk terhubung:</p>
              <div className="max-h-32 overflow-y-auto rounded-lg bg-white/[0.03] border border-white/[0.06] p-2 custom-scrollbar">
                {invDeleteBlocked.linkedProducts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-[11px] py-1 px-1.5 rounded hover:bg-white/[0.04]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Link2 className="h-3 w-3 text-slate-500 shrink-0" />
                      <span className="text-slate-300 truncate">{p.productName}{p.variantName ? ` — ${p.variantName}` : ''}</span>
                    </div>
                    <span className="text-slate-500 shrink-0">{p.qty} {p.baseUnit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-white/[0.04]">Batal</AlertDialogCancel>
            {invDeleteBlocked?.blockType === 'hasPurchases' || 
             invDeleteBlocked?.blockType === 'hasTransfers' || 
             invDeleteBlocked?.blockType === 'hasSales' || 
             invDeleteBlocked?.blockType === 'hasCompositions' || 
             invDeleteBlocked?.blockType === 'hasMixedHistory' || 
             invDeleteBlocked?.blockType === 'hasHistory' ? (
              <AlertDialogAction
                className={cn(
                  "border transition-all",
                  invDeleteBlocked?.blockType === 'hasPurchases' && 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border-red-500/20',
                  invDeleteBlocked?.blockType === 'hasTransfers' && 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border-blue-500/20',
                  invDeleteBlocked?.blockType === 'hasSales' && 'bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 border-purple-500/20',
                  invDeleteBlocked?.blockType === 'hasCompositions' && 'bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 border-orange-500/20',
                  (invDeleteBlocked?.blockType === 'hasMixedHistory' || invDeleteBlocked?.blockType === 'hasHistory') && 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border-amber-500/20'
                )}
                onClick={(e) => handleArchiveInv(e)}
                disabled={archivingInv || deleteInvLoading}
              >
                {archivingInv ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    {invDeleteBlocked?.blockType === 'hasPurchases' && (<><Lock className="h-3.5 w-3.5 inline mr-1" />Nonaktifkan Saja</>)}
                    {invDeleteBlocked?.blockType === 'hasTransfers' && (<><Lock className="h-3.5 w-3.5 inline mr-1" />Nonaktifkan Saja</>)}
                    {invDeleteBlocked?.blockType === 'hasSales' && (<><Ban className="h-3.5 w-3.5 inline mr-1" />Nonaktifkan</>)}
                    {invDeleteBlocked?.blockType === 'hasCompositions' && (<><Ban className="h-3.5 w-3.5 inline mr-1" />Nonaktifkan</>)}
                    {(invDeleteBlocked?.blockType === 'hasMixedHistory' || invDeleteBlocked?.blockType === 'hasHistory') && (<><Ban className="h-3.5 w-3.5 inline mr-1" />Nonaktifkan</>)}
                  </>
                )}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"
                onClick={(e) => handleDeleteInv(e)}
                disabled={archivingInv || deleteInvLoading}
              >
                {deleteInvLoading || archivingInv ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Trash2 className="h-3.5 w-3.5 inline mr-1" />Hapus</>)}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* CATEGORY DIALOGS                                               */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* Category Management Dialog - Modern Glass Design */}
      <ResponsiveDialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col bg-nebula">
          {/* Modern Header with Glass Effect & Stats */}
          <div className="relative overflow-hidden rounded-t-xl">
            {/* Background Effects */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-cyan-500/5" />
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />
            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '20px 20px' }} />
            
            <div className="relative px-4 pt-4 pb-3">
              <ResponsiveDialogHeader className="text-left border-none pb-0 space-y-1">
                <ResponsiveDialogTitle className="text-white text-base font-bold flex items-center gap-2.5">
                  <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/15 border border-white/[0.10]">
                    <Tags className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="flex flex-col">
                    <span>Kelola Kategori</span>
                    <span className="text-[10px] font-normal text-slate-500 font-medium">Organisir item inventory Anda</span>
                  </div>
                </ResponsiveDialogTitle>
              </ResponsiveDialogHeader>
              
              {/* Quick Stats Bar - compact */}
              {categories.length > 0 && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.06]">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.06]">
                    <FolderOpen className="h-3 w-3 text-emerald-400" />
                    <span className="text-[10px] text-slate-400 font-medium">{categories.length} Kategori</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.06]">
                    <Package className="h-3 w-3 text-cyan-400" />
                    <span className="text-[10px] text-slate-400 font-medium">{categories.reduce((sum, c) => sum + (c._count?.items || 0), 0)} Item</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 mt-2 px-1 flex-1 overflow-y-auto custom-scrollbar">
            {/* Add/Edit Form - Compact Design */}
            {editingCatId ? (
              /* Edit Mode Form - Compact */
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.03] border border-amber-500/20">
                <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
                <div className="p-3.5 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/25 w-fit">
                      <Pencil className="h-3 w-3 text-amber-400" />
                      <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">Mode Edit</span>
                    </div>
                    <button onClick={cancelEditCategory} className="p-1 rounded-md hover:bg-white/[0.08] transition-colors text-slate-400 hover:text-white">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  
                  <Input
                    value={catFormName}
                    onChange={(e) => setCatFormName(e.target.value)}
                    placeholder="Nama kategori..."
                    className='w-full h-10 text-sm rounded-lg bg-white/[0.05] border-white/[0.10] focus:border-amber-500/40 focus:ring-amber-500/20'
                    onKeyDown={(e) => { if (e.key === 'Enter') handleEditCategorySave() }}
                    autoFocus
                  />
                  
                  <div className="space-y-2">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                      <Palette className="h-3 w-3 text-amber-400" />
                      Pilih Warna
                    </p>
                    <div className="grid grid-cols-6 gap-2 p-2 rounded-lg bg-black/10 border border-white/[0.04]">
                      {CATEGORY_COLORS.map((color) => {
                        const colorClass = getCategoryColorClasses(color)
                        const isSelected = catFormColor === color
                        return (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setCatFormColor(color)}
                            className={cn(
                              'flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all duration-200',
                              isSelected ? 'bg-white/[0.10] ring-2 ring-white/30 scale-105' : 'hover:bg-white/[0.06] hover:scale-102'
                            )}
                          >
                            <span className={cn(
                              'w-6 h-6 rounded-full transition-all duration-200 ring-offset-1 ring-offset-nebula shadow-sm',
                              colorClass.dot,
                              isSelected ? 'ring-2 ring-white scale-110 ring-offset-amber-500/20' : 'hover:ring-2 hover:ring-white/20'
                            )} />
                            <span className={cn('text-[8px] font-bold leading-none truncate w-full text-center uppercase', isSelected ? 'text-white' : 'text-slate-500')}>
                              {color.slice(0, 3)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1 h-9 text-xs border-white/[0.10] text-slate-300 hover:bg-white/[0.06] hover:text-white rounded-lg font-medium" onClick={cancelEditCategory}>Batal</Button>
                    <Button size="sm" className="flex-1 h-9 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white border-0 text-xs font-semibold shadow-md shadow-amber-500/25 rounded-lg disabled:opacity-50" disabled={catFormLoading} onClick={handleEditCategorySave}>
                      {catFormLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Menyimpan...</> : <><Check className="h-3.5 w-3.5 mr-1" />Simpan</>}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* Add Mode Form - Compact */
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-500/[0.06] to-cyan-500/[0.03] border border-emerald-500/15">
                <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
                <div className="p-3.5 space-y-3">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/25 w-fit">
                    <Plus className="h-3 w-3 text-emerald-400" />
                    <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Tambah Baru</span>
                  </div>
                  
                  <Input
                    value={catFormName}
                    onChange={(e) => setCatFormName(e.target.value)}
                    placeholder="Nama kategori baru..."
                    className='w-full h-10 text-sm rounded-lg bg-white/[0.05] border-white/[0.10] focus:border-emerald-500/40 focus:ring-emerald-500/20 placeholder:text-slate-500'
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCategorySubmit() }}
                  />
                  
                  <div className="space-y-2">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                      <Palette className="h-3 w-3 text-emerald-400" />
                      Pilih Warna
                    </p>
                    <div className="grid grid-cols-6 gap-2 p-2 rounded-lg bg-black/10 border border-white/[0.04]">
                      {CATEGORY_COLORS.map((color) => {
                        const colorClass = getCategoryColorClasses(color)
                        const isSelected = catFormColor === color
                        return (
                          <button
                            key={color}
                            type="button"
                            onClick={() => setCatFormColor(color)}
                            className={cn(
                              'flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all duration-200',
                              isSelected ? 'bg-white/[0.10] ring-2 ring-white/30 scale-105' : 'hover:bg-white/[0.06] hover:scale-102'
                            )}
                          >
                            <span className={cn(
                              'w-6 h-6 rounded-full transition-all duration-200 ring-offset-1 ring-offset-nebula shadow-sm',
                              colorClass.dot,
                              isSelected ? 'ring-2 ring-white scale-110 ring-offset-emerald-500/20' : 'hover:ring-2 hover:ring-white/20'
                            )} />
                            <span className={cn('text-[8px] font-bold leading-none truncate w-full text-center uppercase', isSelected ? 'text-white' : 'text-slate-500')}>
                              {color.slice(0, 3)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  
                  <Button
                    className="w-full h-9 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white text-xs font-semibold gap-1.5 rounded-lg shadow-md shadow-emerald-500/20 disabled:opacity-50 transition-all duration-200"
                    disabled={catFormLoading || !catFormName.trim()}
                    onClick={handleCategorySubmit}
                  >
                    {catFormLoading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Menambahkan...</> : <><Plus className="h-3.5 w-3.5" /> Tambah Kategori</>}
                  </Button>
                </div>
              </div>
            )}

            {/* Category List Section - Compact Cards */}
            {categories.length === 0 ? (
              /* Compact Empty State */
              <div className="py-10 text-center rounded-xl border border-dashed border-white/[0.08] bg-gradient-to-b from-white/[0.02] to-transparent relative overflow-hidden">
                <div className="absolute top-6 left-1/2 -translate-x-1/2 w-28 h-28 bg-emerald-500/5 rounded-full blur-2xl" />
                
                <div className="relative">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500/10 to-emerald-500/10 border border-white/[0.08] mb-3 shadow-inner">
                    <Tags className="h-6 w-6 text-slate-500" />
                  </div>
                  <p className="text-sm text-slate-300 font-semibold mb-1">Belum Ada Kategori</p>
                  <p className="text-xs text-slate-500 mb-4 max-w-[220px] mx-auto leading-snug">
                    Buat kategori pertama untuk mengelompokkan item inventory
                  </p>
                  <Button
                    variant="outline"
                    className="h-9 px-4 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 hover:border-emerald-500/50 gap-1.5 text-xs font-medium rounded-lg transition-all duration-200"
                    onClick={() => document.querySelector<HTMLInputElement>('input[placeholder*="kategori baru"]')?.focus()}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Buat Kategori Pertama
                  </Button>
                  <p className="text-[10px] text-slate-600 mt-3 flex items-center justify-center gap-1">
                    <Sparkles className="h-2.5 w-2.5" />
                    Tip: Gunakan warna berbeda untuk membedakan tipe item
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Modern Bulk Actions Bar */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] backdrop-blur-sm">
                  <label className="flex items-center gap-3 cursor-pointer select-none group">
                    <Checkbox
                      checked={categories.length > 0 && selectedCatIds.size === categories.length}
                      onCheckedChange={toggleSelectAllCats}
                      className="data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500 h-5 w-5 rounded-md data-[state=checked]:shadow-lg data-[state=checked]:shadow-emerald-500/30"
                    />
                    <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors font-medium">
                      {selectedCatIds.size === categories.length && selectedCatIds.size > 0 
                        ? `Semua (${categories.length})` 
                        : 'Pilih Semua'}
                    </span>
                  </label>
                  {selectedCatIds.size > 0 && (
                    <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 25 }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-4 text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs font-semibold gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.05]"
                        onClick={() => setBulkDeleteCatsOpen(true)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Hapus ({selectedCatIds.size})
                      </Button>
                    </motion.div>
                  )}
                </div>

                {/* Category Cards List - Redesigned with Always-Visible Actions */}
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/5">
                  {categories.map((c) => {
                    const cc = getCategoryColorClasses(c.color)
                    const isSelected = selectedCatIds.has(c.id)
                    const isEditing = editingCatId === c.id
                    
                    return (
                      <motion.div
                        key={c.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        whileHover={{ scale: 1.005 }}
                        className={cn(
                          'group relative flex items-center gap-3 p-3.5 rounded-xl transition-all duration-200',
                          'border backdrop-blur-sm',
                          isSelected 
                            ? 'bg-emerald-500/[0.08] border-emerald-500/25 shadow-lg shadow-emerald-500/5' 
                            : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.10]',
                          isEditing && 'ring-1 ring-amber-500/40 bg-amber-500/[0.04]'
                        )}
                      >
                        {/* Selection Checkbox - Always Visible with Emerald Theme */}
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleCatSelection(c.id)}
                          className={cn(
                            'shrink-0 h-4.5 w-4.5 transition-all duration-200',
                            isSelected 
                              ? 'data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500' 
                              : 'data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500'
                          )}
                        />

                        {/* Enhanced Color Dot + Info */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className={cn(
                            'w-4 h-4 rounded-full shrink-0 ring-2 ring-offset-2 ring-offset-nebula/80 shadow-md',
                            cc.dot,
                            cc.dot.replace('bg-', 'ring-')
                          )} />
                          <div className="min-w-0 flex-1">
                            <p className={cn(
                              'text-sm font-semibold truncate transition-colors',
                              isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'
                            )}>
                              {c.name}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              {c._count && c._count.items > 0 ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[11px] text-slate-400 font-medium tabular-nums">
                                  {c._count.items} item
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white/[0.03] text-[11px] text-slate-600 font-medium">
                                  kosong
                                </span>
                              )}
                              <span className="w-1 h-1 rounded-full bg-slate-700" />
                              <span className={cn('text-[11px] font-medium capitalize', cc.text)}>{c.color}</span>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons - ALWAYS VISIBLE for Touch-Friendly UX */}
                        <div className="flex items-center gap-1 shrink-0">
                          {!isEditing && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-9 p-0 text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors"
                              onClick={() => startEditCategory(c)}
                              title="Edit kategori"
                              aria-label={`Edit ${c.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            onClick={() => setDeleteCatId(c.id)}
                            title="Hapus kategori"
                            aria-label={`Hapus ${c.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>

                {/* Enhanced Footer Stats */}
                <div className="flex items-center justify-between px-2 pt-2 pb-1">
                  <p className="text-xs text-slate-500 font-medium">
                    {categories.length} kategori{categories.length === 1 ? '' : ''}
                    {selectedCatIds.size > 0 && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold">
                        {selectedCatIds.size} dipilih
                      </span>
                    )}
                  </p>
                </div>
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

      {/* Bulk Delete Categories Confirmation */}
      <AlertDialog open={bulkDeleteCatsOpen} onOpenChange={(open) => { if (!open) setBulkDeleteCatsOpen(false) }}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/10">
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <AlertDialogTitle className="text-white">Hapus {selectedCatIds.size} Kategori?</AlertDialogTitle>
              </div>
            </div>
            <AlertDialogDescription className="text-slate-400 text-sm leading-relaxed">
              <span className="text-red-400 font-medium">{selectedCatIds.size} kategori</span> yang dipilih akan dihapus permanen.
              Item dalam kategori ini akan menjadi tanpa kategori.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Preview of categories to delete */}
          <div className="py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.05] max-h-[120px] overflow-y-auto">
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-2">Kategori yang akan dihapus:</p>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selectedCatIds).map(id => {
                const cat = categories.find(c => c.id === id)
                if (!cat) return null
                const cc = getCategoryColorClasses(cat.color)
                return (
                  <span key={id} className={cn('inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full', cc.bg, cc.text)}>
                    <span className={cn('w-2 h-2 rounded-full', cc.dot)} />
                    {cat.name}
                  </span>
                )
              })}
            </div>
          </div>
          <AlertDialogFooter className="gap-2 pt-3">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-white/[0.04]" disabled={bulkDeletingCats}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"
              onClick={handleBulkDeleteCategories}
              disabled={bulkDeletingCats}
            >
              {bulkDeletingCats ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1" />Menghapus...</>
              ) : (
                <><Trash2 className="h-3.5 w-3.5 inline mr-1" />Hapus {selectedCatIds.size} Kategori</>
              )}
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
                <ResponsiveDialogDescription className="text-slate-400 text-xs truncate">
                  {invDetailData?.name || '-'}
                </ResponsiveDialogDescription>
              </div>
              {invDetailData && (
                <div className="flex items-center gap-1 shrink-0">
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
                    onClick={() => { setInvDetailOpen(false); void openDeleteInvDialog(invDetailData.id) }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
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
                {(() => {
                  // Check if all movements are migration (initial stock only)
                  const isMigrationOnly = invDetailData.movements.length > 0 && 
                    invDetailData.movements.every(m => m.referenceType === 'MIGRATION')
                  const hasMovements = invDetailData._count.movements > 0
                  
                  return (
                    <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04] text-center">
                      <p className="text-sm font-bold text-white">{invDetailData._count.movements}</p>
                      <p className="text-[10px] text-slate-500">
                        {!hasMovements ? 'Riwayat Stok' : 
                         isMigrationOnly ? 'Stok Awal' : 'Riwayat Stok'}
                      </p>
                    </div>
                  )
                })()}
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

              {/* Tabs: Produk Terkait, Stok/Movement, Batch */}
              <Tabs value={invDetailTab} onValueChange={(v) => {
                setInvDetailTab(v)
                if (v === 'batch' && invDetailData) void fetchBatchTimeline(invDetailData.id)
              }} className="w-full min-w-0">
                {(() => {
                  // Calculate once for both stats card and tab
                  const isMigrationOnly = invDetailData.movements.length > 0 && 
                    invDetailData.movements.every(m => m.referenceType === 'MIGRATION')
                  const movementCount = invDetailData._count.movements
                  const movementLabel = !movementCount ? 'Riwayat' : 
                    isMigrationOnly ? 'Stok Awal' : 'Riwayat'
                  
                  return (
                    <TabsList className="bg-white/[0.04] h-8 w-full grid grid-cols-3 min-w-0">
                      <TabsTrigger value="products" className="text-[10px] h-7 gap-1 data-[state=active]:bg-white/[0.08] text-slate-400 data-[state=active]:text-white">
                        <Link2 className="h-3 w-3" />
                        Produk ({invDetailData.linkedProducts.length})
                      </TabsTrigger>
                      <TabsTrigger value="movements" className="text-[10px] h-7 gap-1 data-[state=active]:bg-white/[0.08] text-slate-400 data-[state=active]:text-white">
                        <Activity className="h-3 w-3" />
                        {movementLabel} ({movementCount})
                      </TabsTrigger>
                      <TabsTrigger value="batch" className="text-[10px] h-7 gap-1 data-[state=active]:bg-white/[0.08] text-slate-400 data-[state=active]:text-white">
                        <Hash className="h-3 w-3" />
                        Batch
                      </TabsTrigger>
                    </TabsList>
                  )
                })()}

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

                {/* Movements Tab - menampilkan stok awal migrasi & pergerakan stok */}
                <TabsContent value="movements" className="mt-3">
                  {invDetailData.movements.length === 0 ? (
                    <div className="py-8 text-center">
                      <PackageOpen className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs text-slate-400 mb-1">Belum ada riwayat stok</p>
                      <p className="text-[10px] text-slate-600">Stok akan tercatat setelah pembelian pertama atau migrasi data</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Info card menjelaskan apa ini */}
                      <div className="rounded-lg bg-sky-500/5 border border-sky-500/10 px-3 py-2 flex items-start gap-2">
                        <Info className="h-3.5 w-3.5 text-sky-400 mt-0.5 shrink-0" />
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          <span className="text-sky-300 font-medium">Riwayat stok</span> mencatat perubahan qty: stok awal migrasi, pembelian, konsumsi, & penyesuaian.
                        </p>
                      </div>
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

                {/* Batch Timeline Tab */}
                <TabsContent value="batch" className="mt-3">
                  {batchTimelineLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 bg-white/[0.03] rounded-lg" />
                      ))}
                    </div>
                  ) : batchTimeline.length === 0 ? (
                    <div className="py-8 text-center">
                      <Hash className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs text-slate-500">Belum ada data batch untuk item ini.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto overflow-x-hidden pr-1">
                      {batchTimeline.map((b) => {
                        const statusColor = b.status === 'AVAILABLE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : b.status === 'EXPIRED' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                        const statusLabel = b.status === 'AVAILABLE' ? 'Tersedia' : b.status === 'EXPIRED' ? 'Expired' : b.status === 'CONSUMED' ? 'Habis' : b.status
                        const daysColor = b.daysUntilExpiry === null ? 'text-slate-500' : b.daysUntilExpiry < 0 ? 'text-red-400' : b.daysUntilExpiry < 7 ? 'text-amber-400' : b.daysUntilExpiry < 30 ? 'text-amber-300' : 'text-emerald-400'
                        const remainPct = b.initialQty > 0 ? Math.min((b.remainingQty / b.initialQty) * 100, 100) : 0
                        const barColor = b.status === 'EXPIRED' ? 'bg-red-400' : b.status === 'CONSUMED' ? 'bg-slate-500' : 'bg-emerald-400'
                        return (
                          <div key={b.id} className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.03] space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="text-[11px] text-white font-mono font-medium truncate">{b.batchNumber || '-'}</span>
                                <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 leading-none border shrink-0', statusColor)}>
                                  {statusLabel}
                                </Badge>
                              </div>
                              <span className={cn('text-[10px] font-medium shrink-0', daysColor)}>
                                {b.daysUntilExpiry === null ? '∞' : b.daysUntilExpiry < 0 ? `${Math.abs(b.daysUntilExpiry)} hari lalu` : `${b.daysUntilExpiry} hari`}
                              </span>
                            </div>
                            {/* Qty bar */}
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                                <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${remainPct}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{formatNumber(b.remainingQty)}/{formatNumber(b.initialQty)} {b.baseUnit}</span>
                            </div>
                            {/* Meta */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                              {b.supplierName && <span>👤 {b.supplierName}</span>}
                              {b.purchaseOrderNumber && <span>📋 PO-{b.purchaseOrderNumber}</span>}
                              {b.expiredDate && <span>📅 {formatDate(b.expiredDate).split(' ')[0]}</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          ) : null}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ══════════════════════════════════════════════════════ */}
      {/* BATCH SEARCH DIALOG                                    */}
      {/* ══════════════════════════════════════════════════════ */}
      <ResponsiveDialog open={batchSearchOpen} onOpenChange={(open) => { if (!open) { setBatchSearchOpen(false); setBatchSearchResult(null); setBatchSearchQuery('') } }}>
        <ResponsiveDialogContent className="sm:max-w-lg flex flex-col max-h-[80vh]">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Hash className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <span>Cari Batch</span>
                <p className="text-[11px] text-slate-500 font-normal mt-0.5">Telusuri batch berdasarkan nomor batch</p>
              </div>
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs sr-only">
              Cari batch berdasarkan nomor batch
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="mt-2 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <Input
                value={batchSearchQuery}
                onChange={(e) => setBatchSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleBatchSearch() }}
                placeholder="cth: FM24001"
                className={cn(inputClass, 'pl-8')}
              />
            </div>
            <Button
              className="theme-bg theme-hover text-white text-xs h-9 px-4 shrink-0"
              disabled={batchSearchLoading || !batchSearchQuery.trim()}
              onClick={() => void handleBatchSearch()}
            >
              {batchSearchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto mt-3">
            {batchSearchLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
                <span className="text-xs text-slate-400 ml-2">Mencari batch...</span>
              </div>
            )}

            {!batchSearchLoading && !batchSearchResult && (
              <div className="py-8 text-center">
                <Hash className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-400 mb-1">Cari Nomor Batch</p>
                <p className="text-xs text-slate-500 mb-4">Masukkan nomor batch untuk melacak stok, expiry, dan riwayat penggunaan</p>
                <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 text-left max-w-xs mx-auto">
                  <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-2">Contoh Format Batch</p>
                  <ul className="text-[11px] text-slate-400 space-y-1">
                    <li>• <span className="font-mono text-white">FM24001</span> — Format tanggal + urut</li>
                    <li>• <span className="font-mono text-white">BTH-2024-001</span> — Format supplier + tanggal</li>
                    <li>• <span className="font-mono text-white">EXP0724</span> — Format bulan/tahun expired</li>
                  </ul>
                </div>
              </div>
            )}

            {!batchSearchLoading && batchSearchQuery.trim() && !batchSearchResult && (
              <div className="py-6 text-center rounded-xl bg-red-500/[0.03] border border-red-500/10">
                <Search className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Batch <span className="font-mono text-white">"{batchSearchQuery.trim()}"</span> tidak ditemukan</p>
                <p className="text-xs text-slate-500 mt-1">Pastikan nomor batch sudah benar dan tercatat di sistem</p>
              </div>
            )}

            {batchSearchResult && !batchSearchLoading && (
              <div className="space-y-3">
                {/* Batch Info Card */}
                <div className="bg-white/[0.02] rounded-xl border border-white/[0.04] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white font-medium truncate">{batchSearchResult.batch.inventoryItem.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{batchSearchResult.batch.inventoryItem.sku || '-'}</p>
                    </div>
                    <Badge variant="outline" className={cn(
                      'text-[9px] px-1.5 py-0 leading-none border shrink-0',
                      batchSearchResult.batch.status === 'AVAILABLE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      batchSearchResult.batch.status === 'EXPIRED' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                      'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    )}>
                      {batchSearchResult.batch.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <span className="text-slate-500">Batch</span>
                      <p className="text-slate-200 font-mono font-medium mt-0.5">{batchSearchResult.batch.batchNumber || '-'}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Sisa / Awal</span>
                      <p className="text-slate-200 font-medium mt-0.5">{formatNumber(batchSearchResult.batch.remainingQty)} / {formatNumber(batchSearchResult.batch.initialQty)} {batchSearchResult.batch.baseUnit}</p>
                    </div>
                    {batchSearchResult.batch.expiredDate && (
                      <div>
                        <span className="text-slate-500">Tanggal Expired</span>
                        <p className="text-slate-200 mt-0.5">{formatDate(batchSearchResult.batch.expiredDate).split(' ')[0]}</p>
                      </div>
                    )}
                    {batchSearchResult.batch.daysUntilExpiry !== null && (
                      <div>
                        <span className="text-slate-500">Sisa Waktu</span>
                        <p className={cn('font-medium mt-0.5', batchSearchResult.batch.daysUntilExpiry < 0 ? 'text-red-400' : batchSearchResult.batch.daysUntilExpiry < 7 ? 'text-amber-400' : 'text-emerald-400')}>
                          {batchSearchResult.batch.daysUntilExpiry < 0 ? `${Math.abs(batchSearchResult.batch.daysUntilExpiry)} hari lalu` : `${batchSearchResult.batch.daysUntilExpiry} hari`}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Supplier + PO */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500 pt-1.5 border-t border-white/[0.04]">
                    {batchSearchResult.purchaseOrder?.supplierName && <span>👤 {batchSearchResult.purchaseOrder.supplierName}</span>}
                    {batchSearchResult.purchaseOrder && <span>📋 PO-{batchSearchResult.purchaseOrder.orderNumber}</span>}
                    {batchSearchResult.purchaseOrder && <span>📅 {formatDate(batchSearchResult.purchaseOrder.date).split(' ')[0]}</span>}
                  </div>
                </div>

                {/* Transactions */}
                {batchSearchResult.transactions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Transaksi yang Menggunakan Batch Ini</p>
                    {batchSearchResult.transactions.map((t) => (
                      <div key={t.id} className="bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.03]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-white font-medium">{t.invoiceNumber || '-'}</span>
                          <span className="text-[11px] text-red-400 font-semibold tabular-nums">-{formatNumber(t.qtyConsumed)} {batchSearchResult.batch.baseUnit}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                          <span>{formatDate(t.date).split(' ')[0]}</span>
                          {t.sourceProducts && <span className="truncate">• {t.sourceProducts}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {batchSearchResult.transactions.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-4">Belum ada transaksi yang menggunakan batch ini.</p>
                )}
              </div>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ══════════════════════════════════════════════════════ */}
      {/* WASTE REPORT DIALOG                                     */}
      {/* ══════════════════════════════════════════════════════ */}
      <ResponsiveDialog open={wasteReportOpen} onOpenChange={(open) => { if (!open) { setWasteReportOpen(false); setWasteReportData(null) } }}>
        <ResponsiveDialogContent className="sm:max-w-lg flex flex-col max-h-[85vh]">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-red-500/10 flex items-center justify-center">
                <Flame className="h-4 w-4 text-red-400" />
              </div>
              <div>
                <span>Laporan Kadaluarsa</span>
                <p className="text-[11px] text-slate-500 font-normal mt-0.5">Item expired & estimasi kerugian modal</p>
              </div>
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs sr-only">
              Laporan waste berdasarkan periode
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          {/* Date filter */}
          <div className="flex items-end gap-2 mt-2">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] text-slate-400 font-medium">Dari</label>
              <Input
                type="date"
                value={wasteReportStartDate}
                onChange={(e) => setWasteReportStartDate(e.target.value)}
                className={cn(inputClass, 'text-slate-300')}
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[10px] text-slate-400 font-medium">Sampai</label>
              <Input
                type="date"
                value={wasteReportEndDate}
                onChange={(e) => setWasteReportEndDate(e.target.value)}
                className={cn(inputClass, 'text-slate-300')}
              />
            </div>
            <Button
              className="theme-bg theme-hover text-white text-xs h-9 px-4 shrink-0"
              disabled={wasteReportLoading}
              onClick={() => void fetchWasteReport()}
            >
              {wasteReportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto mt-3">
            {wasteReportLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 text-red-400 animate-spin" />
                <span className="text-xs text-slate-400 ml-2">Memuat laporan...</span>
              </div>
            )}

            {!wasteReportLoading && !wasteReportData && (
              <div className="py-6 text-center">
                <Flame className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-400 mb-1">Cek Kerugian Kadaluarsa</p>
                <p className="text-xs text-slate-500 mb-4 max-w-xs mx-auto">Lihat item yang sudah kadaluarsa dan hitung estimasi kerugian modal berdasarkan HPP</p>
                <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 text-left max-w-xs mx-auto">
                  <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-2">Yang Ditampilkan</p>
                  <ul className="text-[11px] text-slate-400 space-y-1.5">
                    <li>• Item dengan status <span className="text-red-400 font-medium">EXPIRED</span></li>
                    <li>• Sisa qty yang terbuang (tidak terjual)</li>
                    <li>• Estimasi kerugian = sisa qty × HPP</li>
                    <li>• Filter berdasarkan tanggal expired</li>
                  </ul>
                </div>
              </div>
            )}

            {wasteReportData && !wasteReportLoading && (
              <div className="space-y-3">
                {/* Total Loss Card */}
                <div className="bg-red-500/5 rounded-xl border border-red-500/10 p-4 text-center">
                  <p className="text-[10px] text-red-400/70 uppercase tracking-wider font-medium">Total Kerugian</p>
                  <p className="text-2xl font-bold text-red-400 mt-1">{formatCurrency(wasteReportData.totalLoss)}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{wasteReportData.items.length} item expired</p>
                </div>

                {/* Items List */}
                {wasteReportData.items.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Rincian Item</p>
                    {wasteReportData.items.map((item) => (
                      <div key={item.id} className="bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.03]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-slate-200 font-medium truncate">{item.inventoryItemName}</p>
                            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                              {item.batchNumber && <span className="font-mono">{item.batchNumber}</span>}
                              <span>{formatNumber(item.remainingQty)}/{formatNumber(item.initialQty)} {item.baseUnit} tersisa</span>
                              {item.expiredDate && <span>Exp: {formatDate(item.expiredDate).split(' ')[0]}</span>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[11px] text-red-400 font-semibold">-{formatCurrency(item.totalLoss)}</p>
                            <p className="text-[9px] text-slate-600">{formatCurrency(item.unitCost)}/{item.baseUnit}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <Flame className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-emerald-400">✅ Tidak ada waste pada periode ini!</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Edit Excel Dialog */}
      <ResponsiveDialog open={editExcelOpen} onOpenChange={(open) => {
        if (!open) { setEditExcelFile(null); setEditExcelResult(null) }
        setEditExcelOpen(open)
      }}>
        <ResponsiveDialogContent className="bg-nebula border-white/[0.06]" desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-sm font-semibold">Edit Pembelian via Excel</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Update tanggal expired item pembelian via file Excel
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {!editExcelResult ? (
            <div className="space-y-3 py-1">
              {/* Step instructions */}
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 space-y-2">
                <p className="text-[11px] text-slate-400 font-medium">Langkah-langkah:</p>
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 text-[11px] text-slate-300">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400 font-bold">1</span>
                    <span>Download template edit berisi data pembelian saat ini</span>
                  </div>
                  <div className="flex items-start gap-2 text-[11px] text-slate-300">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400 font-bold">2</span>
                    <span>Edit kolom "Tanggal Expired" di Excel</span>
                  </div>
                  <div className="flex items-start gap-2 text-[11px] text-slate-300">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400 font-bold">3</span>
                    <span>Upload file yang sudah diedit</span>
                  </div>
                </div>
              </div>
              {/* Download template button */}
              <Button onClick={() => void downloadBlob('/api/purchases/export-template', `purchase-edit-template-${new Date().toISOString().slice(0, 10)}.xlsx`, setEditExcelUploading)} disabled={editExcelUploading} variant="outline" className="w-full bg-white/[0.04] border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] h-9 text-xs">
                {editExcelUploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                Download Template Edit
              </Button>
              {/* File drop area */}
              <div
                onDragOver={(e) => { e.preventDefault(); setEditExcelDragOver(true) }}
                onDragLeave={() => setEditExcelDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setEditExcelDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv'))) {
                    setEditExcelFile(file)
                  } else {
                    toast.error('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv')
                  }
                }}
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  editExcelDragOver ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
                    : editExcelFile ? 'border-emerald-500/20 bg-emerald-500/[0.02]'
                    : 'border-white/[0.04] hover:border-white/[0.06]'
                }`}
              >
                {editExcelFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                    <span className="text-xs text-slate-200">{editExcelFile.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => setEditExcelFile(null)} className="h-6 w-6 p-0 text-slate-500 hover:text-red-400">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 mx-auto mb-2 text-slate-600" />
                    <p className="text-xs text-slate-400">Drag & drop file Excel/CSV di sini</p>
                  </>
                )}
              </div>
              {!editExcelFile && (
                <label className="block">
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) setEditExcelFile(file)
                  }} className="hidden" />
                  <div className="w-full text-center py-2 rounded-md bg-white/[0.04] border border-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.04] cursor-pointer text-xs">
                    Pilih File
                  </div>
                </label>
              )}
              <Button onClick={async () => {
                if (!editExcelFile) return
                setEditExcelUploading(true)
                try {
                  const formData = new FormData()
                  formData.append('file', editExcelFile)
                  const res = await fetch('/api/purchases/bulk-update-excel', { method: 'POST', body: formData })
                  const data = await res.json()
                  if (!res.ok || data.error) {
                    toast.error(data.error || data.details || 'Gagal memproses file')
                    setEditExcelUploading(false)
                    return
                  }
                  setEditExcelResult(data)
                  toast.success(`Berhasil update ${data.updated} item`)
                  fetchPurchaseOrders() // refresh data
                } catch {
                  toast.error('Gagal memproses file')
                } finally {
                  setEditExcelUploading(false)
                }
              }} disabled={!editExcelFile || editExcelUploading} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold h-9 gap-2 disabled:opacity-40">
                {editExcelUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload & Update
              </Button>
            </div>
          ) : (
            <div className="space-y-3 py-1">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/15">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-white">Update Berhasil!</p>
                  <p className="text-xs text-slate-400">{editExcelResult.updated} item diperbarui</p>
                </div>
              </div>
              {editExcelResult.notFound > 0 && (
                <p className="text-xs text-amber-400">{editExcelResult.notFound} item tidak ditemukan</p>
              )}
              {editExcelResult.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3 space-y-1">
                  {editExcelResult.errors.map((err, i) => (
                    <p key={i} className="text-[11px] text-red-300">{err}</p>
                  ))}
                </div>
              )}
              <Button onClick={() => { setEditExcelFile(null); setEditExcelResult(null) }} className="w-full bg-white/[0.04] border border-white/[0.06] text-slate-300 hover:text-white hover:bg-white/[0.04] h-8 text-xs">
                Selesai
              </Button>
            </div>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </motion.div>
  )
}