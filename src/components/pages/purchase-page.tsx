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
  Settings2,
  Tags,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Scale,
  Edit3,
  SlidersHorizontal,
  FileText,
  Ruler,
  Hash,
  Weight,
  Banknote,
  Info,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

interface Supplier {
  id: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
}

interface InventoryItemOption {
  id: string
  name: string
  baseUnit: string
  stock: number
}

interface PurchaseOrderItem {
  inventoryItemId: string
  inventoryItemName: string
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
  supplierId: string | null
  supplier?: { id: string; name: string } | null
  supplierName?: string | null
  notes: string | null
  totalCost: number
  itemCount?: number
  _count?: { items: number }
  items?: PurchaseOrderItemDetail[]
  createdAt: string
}

interface PurchaseOrderItemDetail {
  id: string
  name: string
  inventoryItem: { id: string; name: string; sku: string | null; baseUnit: string }
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
  _count?: { compositions: number }
}

interface InventoryStats {
  totalItems: number
  totalValue: number
  lowStockCount: number
}

interface InventoryListResponse {
  items: InventoryItem[]
  totalPages: number
  stats: InventoryStats
}

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

  // Quick add new item from purchase dialog
  const [showQuickAddItem, setShowQuickAddItem] = useState(false)
  const [quickItemName, setQuickItemName] = useState('')
  const [quickItemUnit, setQuickItemUnit] = useState('kg')
  const [quickItemCreating, setQuickItemCreating] = useState(false)

  // Suppliers
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false)
  const [supplierFormOpen, setSupplierFormOpen] = useState(false)
  const [supplierFormEdit, setSupplierFormEdit] = useState<Supplier | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')
  const [supplierNotes, setSupplierNotes] = useState('')
  const [supplierFormLoading, setSupplierFormLoading] = useState(false)
  const [deleteSupplierId, setDeleteSupplierId] = useState<string | null>(null)
  const [deletingSupplier, setDeletingSupplier] = useState(false)

  // Purchase delete
  const [deletePoId, setDeletePoId] = useState<string | null>(null)
  const [deletingPo, setDeletingPo] = useState(false)

  // ══════════════════════════════════════════════════════════
  // TAB 2: INVENTORY BAHAN (Inventory Items)
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

  // Inventory adjust dialog
  const [invAdjustOpen, setInvAdjustOpen] = useState(false)
  const [invAdjustItem, setInvAdjustItem] = useState<InventoryItem | null>(null)
  const [invAdjustNewStock, setInvAdjustNewStock] = useState('')
  const [invAdjustReason, setInvAdjustReason] = useState('')
  const [invAdjusting, setInvAdjusting] = useState(false)

  // Inventory delete
  const [deleteInvId, setDeleteInvId] = useState<string | null>(null)
  const [deletingInv, setDeletingInv] = useState(false)

  // Categories
  const [categories, setCategories] = useState<InventoryCategory[]>([])
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [catFormName, setCatFormName] = useState('')
  const [catFormColor, setCatFormColor] = useState('emerald')
  const [catFormLoading, setCatFormLoading] = useState(false)
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null)
  const [deletingCat, setDeletingCat] = useState(false)

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
  }, [invPage, invDebouncedSearch, invCategoryFilter])

  useEffect(() => {
    if (tab === 'inventory') void fetchInventoryItems()
  }, [tab, fetchInventoryItems])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setInvDebouncedSearch(invSearch), 300)
    return () => clearTimeout(t)
  }, [invSearch])

  // ══════════════════════════════════════════════════════════
  // Fetch: Suppliers
  // ══════════════════════════════════════════════════════════
  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await fetch('/api/suppliers')
      if (res.ok) {
        const data = await res.json()
        setSuppliers(data.suppliers || data || [])
      }
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    void fetchSuppliers()
  }, [fetchSuppliers])

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
  // Fetch: Pre-load item options for purchase dialog
  // ══════════════════════════════════════════════════════════
  const fetchPoItemOptions = useCallback(async () => {
    setPoItemOptionsLoading(true)
    try {
      const res = await fetch('/api/inventory/items?limit=200')
      if (res.ok) {
        const data = await res.json()
        setPoItemOptions((data.items || []).map((i: { id: string; name: string; baseUnit: string; stock: number }) => ({
          id: i.id,
          name: i.name,
          baseUnit: i.baseUnit,
          stock: i.stock ?? 0,
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
    return poItemOptions.filter(i => i.name.toLowerCase().includes(q))
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
  const openPoDetail = async (po: PurchaseOrder) => {
    setPoDetailOpen(true)
    setPoDetailData(null)
    setPoDetailLoading(true)
    try {
      const res = await fetch(`/api/purchases/${po.id}`)
      if (res.ok) {
        const data = await res.json()
        setPoDetailData(data)
      } else {
        setPoDetailData(po)
      }
    } catch {
      setPoDetailData(po)
    } finally {
      setPoDetailLoading(false)
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
    setPoCreateLoading(true)
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: poCreateNotes || undefined,
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
        toast.success('Pembelian berhasil dibuat')
        setPoCreateOpen(false)
        resetPoCreateForm()
        void fetchPurchaseOrders()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal membuat pembelian')
      }
    } catch {
      toast.error('Gagal membuat pembelian')
    } finally {
      setPoCreateLoading(false)
    }
  }

  const resetPoCreateForm = () => {
    setPoCreateNotes('')
    setPoCreateItems([{ inventoryItemId: '', inventoryItemName: '', baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' }])
    setShowItemPicker(false)
    setActiveItemSearchIdx(null)
    setItemPickerFilter('')
    setShowQuickAddItem(false)
  }

  const handleAddPoItem = () => {
    setPoCreateItems(prev => [
      ...prev,
      { inventoryItemId: '', inventoryItemName: '', baseUnit: '', qty: '1', unit: '', baseQty: '0', pricePerItem: '0' },
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
        ? { ...it, inventoryItemId: item.id, inventoryItemName: item.name, baseUnit: item.baseUnit }
        : it
    ))
    setShowItemPicker(false)
    setActiveItemSearchIdx(null)
    setItemPickerFilter('')
  }

  // Quick add new inventory item from purchase dialog
  const handleQuickAddItem = async (targetIdx: number) => {
    if (!quickItemName.trim()) {
      toast.error('Nama item wajib diisi')
      return
    }
    setQuickItemCreating(true)
    try {
      const res = await fetch('/api/inventory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: quickItemName.trim(), baseUnit: quickItemUnit, stock: 0, avgCost: 0 }),
      })
      if (res.ok) {
        const data = await res.json()
        const newItem: InventoryItemOption = { id: data.id, name: data.name, baseUnit: data.baseUnit, stock: 0 }
        setPoItemOptions(prev => [newItem, ...prev])
        handleSelectInvItem(targetIdx, newItem)
        setShowQuickAddItem(false)
        setQuickItemName('')
        setQuickItemUnit('kg')
        toast.success('Item baru ditambahkan')
      } else {
        const err = await res.json()
        toast.error(err.error || 'Gagal menambahkan item')
      }
    } catch {
      toast.error('Gagal menambahkan item')
    } finally {
      setQuickItemCreating(false)
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
  // Supplier CRUD
  // ══════════════════════════════════════════════════════════
  const openSupplierForm = (supplier?: Supplier) => {
    if (supplier) {
      setSupplierFormEdit(supplier)
      setSupplierName(supplier.name)
      setSupplierPhone(supplier.phone || '')
      setSupplierAddress(supplier.address || '')
      setSupplierNotes(supplier.notes || '')
    } else {
      setSupplierFormEdit(null)
      setSupplierName('')
      setSupplierPhone('')
      setSupplierAddress('')
      setSupplierNotes('')
    }
    setSupplierFormOpen(true)
  }

  const handleSupplierSubmit = async () => {
    if (!supplierName.trim()) {
      toast.error('Nama supplier wajib diisi')
      return
    }
    setSupplierFormLoading(true)
    try {
      const url = supplierFormEdit ? `/api/suppliers/${supplierFormEdit.id}` : '/api/suppliers'
      const method = supplierFormEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: supplierName,
          phone: supplierPhone || undefined,
          address: supplierAddress || undefined,
          notes: supplierNotes || undefined,
        }),
      })
      if (res.ok) {
        toast.success(supplierFormEdit ? 'Supplier berhasil diperbarui' : 'Supplier berhasil ditambahkan')
        setSupplierFormOpen(false)
        void fetchSuppliers()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menyimpan supplier')
      }
    } catch {
      toast.error('Gagal menyimpan supplier')
    } finally {
      setSupplierFormLoading(false)
    }
  }

  const handleDeleteSupplier = async () => {
    if (!deleteSupplierId) return
    setDeletingSupplier(true)
    try {
      const res = await fetch(`/api/suppliers/${deleteSupplierId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Supplier berhasil dihapus')
        setDeleteSupplierId(null)
        void fetchSuppliers()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menghapus supplier')
      }
    } catch {
      toast.error('Gagal menghapus supplier')
    } finally {
      setDeletingSupplier(false)
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
      toast.error('Nama bahan wajib diisi')
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
        toast.success(isEdit ? 'Bahan berhasil diperbarui' : 'Bahan berhasil ditambahkan')
        setInvFormOpen(false)
        void fetchInventoryItems()
        void fetchCategories()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menyimpan bahan')
      }
    } catch {
      toast.error('Gagal menyimpan bahan')
    } finally {
      setInvFormLoading(false)
    }
  }

  const handleDeleteInv = async () => {
    if (!deleteInvId) return
    setDeletingInv(true)
    try {
      const res = await fetch(`/api/inventory/items/${deleteInvId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Bahan berhasil dihapus')
        setDeleteInvId(null)
        void fetchInventoryItems()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menghapus bahan')
      }
    } catch {
      toast.error('Gagal menghapus bahan')
    } finally {
      setDeletingInv(false)
    }
  }

  // ══════════════════════════════════════════════════════════
  // Inventory Adjust
  // ══════════════════════════════════════════════════════════
  const openInvAdjust = (item: InventoryItem) => {
    setInvAdjustItem(item)
    setInvAdjustNewStock(String(item.stock))
    setInvAdjustReason('')
    setInvAdjustOpen(true)
  }

  const handleInvAdjustSubmit = async () => {
    if (!invAdjustItem) return
    const newStock = parseFloat(invAdjustNewStock)
    if (isNaN(newStock) || newStock < 0) {
      toast.error('Stok baru harus berupa angka positif')
      return
    }
    setInvAdjusting(true)
    try {
      const res = await fetch(`/api/inventory/items/${invAdjustItem.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newStock,
          reason: invAdjustReason || undefined,
        }),
      })
      if (res.ok) {
        toast.success('Stok berhasil disesuaikan')
        setInvAdjustOpen(false)
        void fetchInventoryItems()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menyesuaikan stok')
      }
    } catch {
      toast.error('Gagal menyesuaikan stok')
    } finally {
      setInvAdjusting(false)
    }
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
          <p className="text-sm text-slate-500">Kelola pembelian stok bahan dan inventory</p>
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
              Inventory Bahan
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
                  placeholder="Cari No. PO, supplier..."
                  className={cn(inputClass, 'pl-8')}
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-[10px] gap-1 text-slate-400 hover:text-white hover:bg-white/[0.04] border border-white/[0.06] shrink-0"
                  onClick={() => { void fetchSuppliers(); setSupplierDialogOpen(true) }}
                >
                  <Settings2 className="h-3 w-3" />
                  <span className="hidden sm:inline">Kelola Supplier</span>
                  <span className="sm:hidden">Supplier</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => { resetPoCreateForm(); setPoCreateOpen(true) }}
                  className="theme-bg theme-hover text-white text-xs font-medium h-8 px-3 rounded-lg gap-1.5 shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Buat Pembelian
                </Button>
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block">
              <Card className="bg-nebula border-white/[0.06] overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/[0.06] hover:bg-transparent">
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">No. PO</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Tanggal</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Supplier</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Jumlah Item</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Total Biaya</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poList.length === 0 ? (
                      <TableRow className="border-white/[0.04] hover:bg-transparent">
                        <TableCell colSpan={6} className="text-center py-12">
                          <ShoppingCart className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">Belum ada pembelian</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      poList.map((po) => (
                        <TableRow key={po.id} className="border-white/[0.04] hover:bg-transparent">
                          <TableCell className="text-xs text-slate-200 font-medium font-mono">{po.orderNumber}</TableCell>
                          <TableCell className="text-xs text-slate-400">{formatDate(po.createdAt)}</TableCell>
                          <TableCell className="text-xs text-slate-200">{po.supplier?.name || '-'}</TableCell>
                          <TableCell className="text-xs text-slate-300 text-right">{po.itemCount ?? po._count?.items ?? 0}</TableCell>
                          <TableCell className="text-xs text-emerald-400 text-right font-medium">{formatCurrency(po.totalCost)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
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
                                className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                                onClick={() => setDeletePoId(po.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
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
                <Card className="bg-nebula border-white/[0.06]">
                  <CardContent className="py-12 text-center">
                    <ShoppingCart className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">Belum ada pembelian</p>
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
                      <Card className="bg-nebula border-white/[0.06]">
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-white font-medium font-mono">{po.orderNumber}</span>
                            <span className="text-[11px] text-emerald-400 font-medium">{formatCurrency(po.totalCost)}</span>
                          </div>
                          <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[11px]">{po.supplier?.name || '-'}</span>
                            <span className="text-[11px]">{formatDate(po.createdAt)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <Package className="h-3 w-3" />
                            <span className="text-[11px]">{po.itemCount ?? po._count?.items ?? 0} item</span>
                          </div>
                          <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.04]">
                            <Button
                              size="sm"
                              className="flex-1 h-7 text-[10px] gap-1 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                              onClick={() => openPoDetail(po)}
                            >
                              <Eye className="h-3 w-3" />
                              Detail
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px] gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                              onClick={() => setDeletePoId(po.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
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
          {/* TAB 2: INVENTORY BAHAN                                */}
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
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[10px] gap-1 text-slate-400 hover:text-white hover:bg-white/[0.04] border border-white/[0.06] shrink-0"
                    onClick={() => setCategoryDialogOpen(true)}
                  >
                    <Tags className="h-3 w-3" />
                    <span className="hidden sm:inline">Kelola Kategori</span>
                    <span className="sm:hidden">Kategori</span>
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
                </div>
                <Button
                  size="sm"
                  onClick={() => openInvForm()}
                  className="theme-bg theme-hover text-white text-xs font-medium h-8 px-3 rounded-lg gap-1.5 shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Tambah Bahan
                </Button>
              </div>
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <Card className="bg-nebula border-white/[0.06]">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center">
                      <PackagePlus className="h-3.5 w-3.5 theme-text" />
                    </div>
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-white">{formatNumber(invStats.totalItems)}</p>
                  <p className="text-[10px] sm:text-xs text-slate-500">Total Item</p>
                </CardContent>
              </Card>
              <Card className="bg-nebula border-white/[0.06]">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center">
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-white">{formatCurrency(invStats.totalValue)}</p>
                  <p className="text-[10px] sm:text-xs text-slate-500">Total Nilai</p>
                </CardContent>
              </Card>
              <Card className="bg-nebula border-white/[0.06]">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center">
                      <AlertTriangle className={cn('h-3.5 w-3.5', invStats.lowStockCount > 0 ? 'text-amber-400' : 'text-slate-500')} />
                    </div>
                  </div>
                  <p className={cn('text-lg sm:text-xl font-bold', invStats.lowStockCount > 0 ? 'text-amber-400' : 'text-white')}>
                    {formatNumber(invStats.lowStockCount)}
                  </p>
                  <p className="text-[10px] sm:text-xs text-slate-500">Stok Rendah</p>
                </CardContent>
              </Card>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block">
              <Card className="bg-nebula border-white/[0.06] overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/[0.06] hover:bg-transparent">
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Nama</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Kategori</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Stok</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">HPP Satuan</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Total Nilai</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Digunakan</TableHead>
                      <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invList.length === 0 ? (
                      <TableRow className="border-white/[0.04] hover:bg-transparent">
                        <TableCell colSpan={7} className="text-center py-12">
                          <PackagePlus className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                          <p className="text-sm text-slate-500">Belum ada bahan</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      invList.map((item) => {
                        const isLow = item.stock <= item.lowStockAlert
                        const colorClasses = item.category ? getCategoryColorClasses(item.category.color) : null
                        return (
                          <TableRow key={item.id} className="border-white/[0.04] hover:bg-transparent">
                            <TableCell className="text-xs text-slate-200 font-medium">{item.name}</TableCell>
                            <TableCell>
                              {item.category && colorClasses ? (
                                <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 leading-none border font-medium', colorClasses.bg, colorClasses.text, colorClasses.border)}>
                                  {item.category.name}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-slate-500">-</span>
                              )}
                            </TableCell>
                            <TableCell className={cn('text-xs text-right font-medium', isLow ? 'text-red-400' : 'text-slate-200')}>
                              {formatNumber(item.stock)} {item.baseUnit}
                            </TableCell>
                            <TableCell className="text-xs text-slate-400 text-right">{formatCurrency(item.avgCost)}/{item.baseUnit}</TableCell>
                            <TableCell className="text-xs text-emerald-400 text-right font-medium">{formatCurrency(item.stock * item.avgCost)}</TableCell>
                            <TableCell className="text-xs text-slate-400 text-right">{item._count?.compositions ?? 0}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                                  onClick={() => openInvForm(item)}
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-sky-400 hover:text-sky-300 hover:bg-sky-500/[0.06]"
                                  onClick={() => openInvAdjust(item)}
                                >
                                  <SlidersHorizontal className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                                  onClick={() => setDeleteInvId(item.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
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
                    <PackagePlus className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">Belum ada bahan</p>
                  </CardContent>
                </Card>
              ) : (
                <AnimatePresence>
                  {invList.map((item) => {
                    const isLow = item.stock <= item.lowStockAlert
                    const colorClasses = item.category ? getCategoryColorClasses(item.category.color) : null
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Card className="bg-nebula border-white/[0.06]">
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs text-slate-200 font-medium truncate">{item.name}</p>
                                {item.category && colorClasses && (
                                  <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0 leading-none border font-medium mt-1', colorClasses.bg, colorClasses.text, colorClasses.border)}>
                                    {item.category.name}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                <p className={cn('text-sm font-bold', isLow ? 'text-red-400' : 'text-white')}>
                                  {formatNumber(item.stock)} <span className="text-[10px] text-slate-400 font-normal">{item.baseUnit}</span>
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-slate-500">
                              <span className="text-[11px]">HPP: {formatCurrency(item.avgCost)}/{item.baseUnit}</span>
                              <span className="text-[11px] text-emerald-400 font-medium">{formatCurrency(item.stock * item.avgCost)}</span>
                            </div>
                            <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.04]">
                              <Button
                                size="sm"
                                className="flex-1 h-7 text-[10px] gap-1 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                                onClick={() => openInvForm(item)}
                              >
                                <Edit3 className="h-3 w-3" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                className="flex-1 h-7 text-[10px] gap-1 text-sky-400 hover:text-sky-300 hover:bg-sky-500/[0.06]"
                                onClick={() => openInvAdjust(item)}
                              >
                                <SlidersHorizontal className="h-3 w-3" />
                                Stok
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                                onClick={() => setDeleteInvId(item.id)}
                              >
                                <Trash2 className="h-3 w-3" />
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
              <Skeleton className="h-10 bg-white/[0.04] rounded-lg" />
              <Skeleton className="h-20 bg-white/[0.04] rounded-lg" />
              <Skeleton className="h-10 bg-white/[0.04] rounded-lg" />
            </div>
          ) : poDetailData ? (
            <div className="space-y-4 mt-2">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Tanggal</p>
                  <p className="text-xs text-slate-200 font-medium">{formatDate(poDetailData.createdAt)}</p>
                </div>
                <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Supplier</p>
                  <p className="text-xs text-slate-200 font-medium">{poDetailData.supplier?.name || '-'}</p>
                </div>
              </div>

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
                        className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-200 font-medium truncate">{item.inventoryItem.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-slate-500">
                              {formatNumber(item.purchaseQty)} {item.purchaseUnit} = {formatNumber(item.baseQty)} {item.baseUnit}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-white font-medium">{formatCurrency(item.totalCost)}</p>
                          <p className="text-[10px] text-amber-400/70">{formatCurrency(item.unitCost)}/{item.baseUnit}</p>
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

              {/* Delete button */}
              <div className="pt-2 border-t border-white/[0.04]">
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full h-8 text-xs gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                  onClick={() => { setDeletePoId(poDetailData!.id) }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Hapus Pembelian
                </Button>
              </div>
            </div>
          ) : null}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Create Purchase Order Dialog ── */}
      <ResponsiveDialog
        open={poCreateOpen}
        onOpenChange={(open) => {
          if (!open) resetPoCreateForm()
          setPoCreateOpen(open)
        }}
      >
        <ResponsiveDialogContent className="sm:max-w-2xl flex flex-col max-h-[90vh]">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-emerald-400" />
              Pembelian Baru
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Catat pembelian bahan baku untuk stok toko
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="space-y-4 mt-2 flex-1 overflow-y-auto">
            {/* ── Step flow guide ── */}
            <div className="flex items-center gap-1.5 px-1">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-medium text-[9px]">1</span>
                <span className="text-slate-300">Pilih Item</span>
              </div>
              <ArrowRight className="h-2.5 w-2.5 text-slate-600" />
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-4 h-4 rounded-full bg-white/[0.06] text-slate-500 flex items-center justify-center font-medium text-[9px]">2</span>
                <span className="text-slate-500">Isi Detail</span>
              </div>
              <ArrowRight className="h-2.5 w-2.5 text-slate-600" />
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-4 h-4 rounded-full bg-white/[0.06] text-slate-500 flex items-center justify-center font-medium text-[9px]">3</span>
                <span className="text-slate-500">Simpan</span>
              </div>
            </div>

            {/* Catatan */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3 w-3 text-slate-500" />
                <label className="text-[11px] text-slate-300 font-medium">Catatan</label>
                <span className="text-[10px] text-slate-600">(opsional)</span>
              </div>
              <Textarea
                value={poCreateNotes}
                onChange={(e) => setPoCreateNotes(e.target.value)}
                placeholder="Cth: Bayar tempo 7 hari, PO dari PT Indomaret..."
                className="bg-white/[0.04] border-white/[0.04] text-white text-xs min-h-[48px] rounded-lg resize-none placeholder:text-slate-500"
              />
            </div>

            <Separator className="bg-white/[0.06]" />

            {/* Items */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 px-1">
                <Package className="h-3 w-3 text-slate-500" />
                <span className="text-[11px] text-slate-300 font-medium">
                  Item Pembelian
                </span>
                {poCreateItems.filter(i => i.inventoryItemId).length > 0 && (
                  <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full font-medium">
                    {poCreateItems.filter(i => i.inventoryItemId).length}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {poCreateItems.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] space-y-3">
                    {/* Item picker / selected display */}
                    <div className="relative" ref={(el) => { invItemSearchRefs.current[idx] = el }}>
                      {item.inventoryItemId ? (
                        <div className="flex items-center gap-2 bg-emerald-500/[0.06] rounded-lg px-2.5 h-9 border border-emerald-500/10">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span className="text-xs text-emerald-300 truncate flex-1 font-medium">{item.inventoryItemName}</span>
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
                              handleUpdatePoItem(idx, 'baseUnit', '')
                            }}
                            title="Ganti item"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          {/* Clickable trigger to open picker */}
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

                          {/* Picker dropdown */}
                          {activeItemSearchIdx === idx && showItemPicker && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-nebula border border-white/[0.06] rounded-lg shadow-xl z-50">
                              {/* Filter search */}
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

                              {/* Loading */}
                              {poItemOptionsLoading ? (
                                <div className="flex items-center justify-center gap-2 py-4 text-slate-500">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span className="text-[10px]">Memuat daftar item...</span>
                                </div>
                              ) : /* No results + not in quick-add mode */
                              filteredItemOptions.length === 0 && !showQuickAddItem ? (
                                <div className="py-6 text-center px-3">
                                  <Package className="h-6 w-6 text-slate-600 mx-auto mb-2" />
                                  {poItemOptions.length === 0 ? (
                                    <>
                                      <p className="text-[11px] text-slate-400 mb-1">Belum ada item di inventory</p>
                                      <p className="text-[10px] text-slate-600 mb-3">Buat item baru langsung dari sini</p>
                                    </>
                                  ) : (
                                    <p className="text-[11px] text-slate-400 mb-3">Tidak ada item yang cocok</p>
                                  )}
                                  <button
                                    className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
                                    onClick={() => setShowQuickAddItem(true)}
                                  >
                                    <PackageOpen className="h-3 w-3" />
                                    Buat Item Baru
                                  </button>
                                </div>
                              ) : /* Normal list */
                              !showQuickAddItem ? (
                                <div className="max-h-[180px] overflow-y-auto">
                                  {filteredItemOptions.map((r) => (
                                    <button
                                      key={r.id}
                                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
                                      onClick={() => handleSelectInvItem(idx, r)}
                                    >
                                      <Package className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs text-slate-200 truncate">{r.name}</p>
                                        <p className="text-[10px] text-slate-500">Stok: {formatNumber(r.stock)} {r.baseUnit}</p>
                                      </div>
                                    </button>
                                  ))}
                                  {/* Add new item option at bottom */}
                                  <button
                                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-left border-t border-white/[0.06] text-emerald-400 hover:bg-emerald-500/[0.06] transition-colors"
                                    onClick={() => setShowQuickAddItem(true)}
                                  >
                                    <PackageOpen className="h-3 w-3" />
                                    <span className="text-[11px] font-medium">Buat Item Baru</span>
                                  </button>
                                </div>
                              ) : null}

                              {/* Quick add inline form */}
                              {showQuickAddItem && (
                                <div className="p-3 border-t border-white/[0.06] space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                      <PackageOpen className="h-3.5 w-3.5 text-emerald-400" />
                                      <span className="text-[11px] text-slate-300 font-medium">Buat Item Baru</span>
                                    </div>
                                    <button
                                      className="w-5 h-5 rounded hover:bg-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white"
                                      onClick={() => setShowQuickAddItem(false)}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                  <p className="text-[10px] text-slate-500">Item akan otomatis masuk ke inventory toko</p>
                                  <div className="grid grid-cols-[1fr_auto] gap-2">
                                    <div className="space-y-1">
                                      <input
                                        autoFocus
                                        value={quickItemName}
                                        onChange={(e) => setQuickItemName(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAddItem(idx) }}
                                        placeholder="Nama item — cth: Susu UHT Full Cream"
                                        className="w-full bg-white/[0.04] border-white/[0.04] text-white text-xs h-8 rounded-md px-2.5 outline-none placeholder:text-slate-500"
                                      />
                                    </div>
                                    <select
                                      value={quickItemUnit}
                                      onChange={(e) => setQuickItemUnit(e.target.value)}
                                      className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-8 rounded-md px-2 outline-none min-w-[70px]"
                                    >
                                      {BASE_UNIT_OPTIONS.map(u => (
                                        <option key={u} value={u} className="bg-zinc-900">{u}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <button
                                    className="w-full h-8 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                                    onClick={() => handleQuickAddItem(idx)}
                                    disabled={quickItemCreating || !quickItemName.trim()}
                                  >
                                    {quickItemCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                                    Buat & Pilih Item
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Unit → Qty → Berat Aktual → Harga — with icons & helper text */}
                    {item.inventoryItemId && (
                      <div className="space-y-2.5 pl-0.5">
                        {/* Info banner */}
                        <div className="flex items-start gap-1.5 text-[10px] text-slate-500">
                          <Info className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>Isi detail pembelian item <span className="text-slate-300">{item.inventoryItemName}</span> di bawah ini</span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          {/* Satuan Beli */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Ruler className="h-2.5 w-2.5 text-slate-500" />
                              <label className="text-[10px] text-slate-300 font-medium">Satuan Beli</label>
                            </div>
                            <Input
                              value={item.unit}
                              onChange={(e) => handleUpdatePoItem(idx, 'unit', e.target.value)}
                              className={inputClass}
                              placeholder="Cth: sak"
                            />
                            <p className="text-[9px] text-slate-600">satuan dari supplier</p>
                          </div>
                          {/* Jumlah */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Hash className="h-2.5 w-2.5 text-slate-500" />
                              <label className="text-[10px] text-slate-300 font-medium">Jumlah</label>
                            </div>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={item.qty}
                              onChange={(e) => handleUpdatePoItem(idx, 'qty', e.target.value)}
                              className={cn(inputClass, 'text-center')}
                              placeholder="1"
                            />
                            <p className="text-[9px] text-slate-600">berapa {item.unit || 'unit'} yang dibeli</p>
                          </div>
                          {/* Isi per 1 Satuan Beli */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Weight className="h-2.5 w-2.5 text-slate-500" />
                              <label className="text-[10px] text-slate-300 font-medium">Isi per 1 {item.unit || 'unit'}</label>
                            </div>
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
                            <p className="text-[9px] text-slate-600">isi dalam 1 {item.unit || 'unit'} ({item.baseUnit || 'kg'})</p>
                          </div>
                          {/* Harga per Satuan */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Banknote className="h-2.5 w-2.5 text-slate-500" />
                              <label className="text-[10px] text-slate-300 font-medium">Harga</label>
                            </div>
                            <Input
                              type="number"
                              min="0"
                              value={item.pricePerItem}
                              onChange={(e) => handleUpdatePoItem(idx, 'pricePerItem', e.target.value)}
                              className={inputClass}
                              placeholder="72000"
                            />
                            <p className="text-[9px] text-slate-600">per 1 {item.unit || 'satuan beli'} (Rp)</p>
                          </div>
                        </div>

                        {/* Example calculation hint */}
                        {item.unit && parseFloat(item.qty) > 0 && parseFloat(item.pricePerItem) > 0 && (
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 px-1">
                            <Info className="h-2.5 w-2.5 shrink-0" />
                            <span>
                              {item.qty} {item.unit} × Rp{formatNumber(parseFloat(item.pricePerItem))} ={' '}
                              <span className="text-slate-300 font-medium">
                                {formatCurrency((parseFloat(item.pricePerItem) || 0) * (parseFloat(item.qty) || 0))}
                              </span>
                            </span>
                          </div>
                        )}
                        {/* Total base qty info */}
                        {parseFloat(item.baseQty) > 0 && parseFloat(item.qty) > 0 && (
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 px-1">
                            <ArrowRight className="h-2.5 w-2.5 shrink-0" />
                            <span>
                              Total stok masuk:{' '}
                              <span className="text-slate-300 font-medium">
                                {formatNumber(parseFloat(item.qty) * parseFloat(item.baseQty))} {item.baseUnit}
                              </span>
                              {' '}({item.qty} {item.unit} × {formatNumber(parseFloat(item.baseQty))} {item.baseUnit})
                            </span>
                          </div>
                        )}
                        {/* HPP per base unit */}
                        {(parseFloat(item.baseQty) > 0) && (parseFloat(item.pricePerItem) > 0) && (
                          <div className="flex items-center gap-1.5 text-[10px] text-amber-500/80 px-1">
                            <Scale className="h-2.5 w-2.5 shrink-0" />
                            <span>
                              HPP: Rp{formatNumber(Math.round((parseFloat(item.pricePerItem) || 0) / (parseFloat(item.baseQty) || 0)))} per {item.baseUnit}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* ── Tambah Item button ── */}
                <button
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-white/[0.08] text-slate-500 hover:text-slate-300 hover:border-white/[0.15] transition-colors text-xs"
                  onClick={handleAddPoItem}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Tambah Item Lain
                </button>
              </div>
            </div>
          </div>

          {/* ── Sticky Total Biaya + Footer ── */}
          <div className="pt-3 mt-auto border-t border-white/[0.06]">
            <div className="bg-emerald-500/[0.06] rounded-lg p-3 border border-emerald-500/[0.1] mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Banknote className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-xs text-slate-400">Total Pembelian</span>
                </div>
                <span className="text-lg font-bold text-emerald-400">{formatCurrency(poTotalCost)}</span>
              </div>
              {poCreateItems.filter(i => i.inventoryItemId).length > 0 && (
                <p className="text-[9px] text-slate-600 mt-1">
                  {poCreateItems.filter(i => i.inventoryItemId).length} item • Stok akan otomatis bertambah setelah disimpan
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1 h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
                onClick={() => setPoCreateOpen(false)}
              >
                Batal
              </Button>
              <Button
                className="flex-1 h-9 text-xs theme-bg theme-hover text-white"
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

      {/* ── Delete Purchase Order Alert ── */}
      <AlertDialog open={!!deletePoId} onOpenChange={(open) => { if (!open) setDeletePoId(null) }}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Hapus Pembelian?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Pembelian yang dihapus tidak dapat dikembalikan. Stok bahan yang sudah masuk dari pembelian ini juga akan dikurangi.
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
      {/* SUPPLIER DIALOGS                                               */}
      {/* ══════════════════════════════════════════════════════════ */}

      {/* Supplier List Dialog */}
      <ResponsiveDialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">Kelola Supplier</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Daftar supplier untuk pembelian bahan
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 mt-2">
            <Button
              size="sm"
              className="w-full h-8 text-xs gap-1.5 theme-bg theme-hover text-white"
              onClick={() => openSupplierForm()}
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Supplier
            </Button>

            {suppliers.length === 0 ? (
              <div className="py-8 text-center">
                <Settings2 className="h-6 w-6 text-slate-600 mx-auto mb-1.5" />
                <p className="text-xs text-slate-500">Belum ada supplier</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {suppliers.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-200 font-medium truncate">{s.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {s.phone && <span className="text-[10px] text-slate-500">{s.phone}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                        onClick={() => openSupplierForm(s)}
                      >
                        <Edit3 className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                        onClick={() => setDeleteSupplierId(s.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Supplier Form Dialog */}
      <ResponsiveDialog open={supplierFormOpen} onOpenChange={setSupplierFormOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">
              {supplierFormEdit ? 'Edit Supplier' : 'Tambah Supplier'}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label className={labelClass}>Nama *</Label>
              <Input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Nama supplier"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass}>Telepon</Label>
              <Input
                value={supplierPhone}
                onChange={(e) => setSupplierPhone(e.target.value)}
                placeholder="08xx-xxxx-xxxx"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass}>Alamat</Label>
              <Textarea
                value={supplierAddress}
                onChange={(e) => setSupplierAddress(e.target.value)}
                placeholder="Alamat supplier"
                className="bg-white/[0.04] border-white/[0.04] text-white text-xs min-h-[60px] rounded-lg resize-none placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label className={labelClass}>Catatan</Label>
              <Input
                value={supplierNotes}
                onChange={(e) => setSupplierNotes(e.target.value)}
                placeholder="Catatan (opsional)"
                className={inputClass}
              />
            </div>
          </div>
          <ResponsiveDialogFooter className="mt-4 gap-2">
            <Button
              variant="ghost"
              className="flex-1 h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
              onClick={() => setSupplierFormOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="flex-1 h-9 text-xs theme-bg theme-hover text-white"
              disabled={supplierFormLoading}
              onClick={handleSupplierSubmit}
            >
              {supplierFormLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Simpan'}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete Supplier Alert */}
      <AlertDialog open={!!deleteSupplierId} onOpenChange={(open) => { if (!open) setDeleteSupplierId(null) }}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Hapus Supplier?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Supplier yang dihapus tidak dapat dikembalikan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-white/[0.04]">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"
              onClick={handleDeleteSupplier}
              disabled={deletingSupplier}
            >
              {deletingSupplier ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hapus'}
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
              {invFormEdit ? 'Edit Bahan' : 'Tambah Bahan Baru'}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label className={labelClass}>Nama *</Label>
              <Input
                value={invFormName}
                onChange={(e) => setInvFormName(e.target.value)}
                placeholder="Nama bahan"
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

      {/* Inventory Adjust Dialog */}
      <ResponsiveDialog open={invAdjustOpen} onOpenChange={setInvAdjustOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">Penyesuaian Stok</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              {invAdjustItem?.name || ''}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {invAdjustItem && (
            <div className="space-y-4 mt-2">
              <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.04]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Stok Saat Ini</span>
                  <span className="text-sm font-bold text-white">
                    {formatNumber(invAdjustItem.stock)} {invAdjustItem.baseUnit}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Stok Baru *</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={invAdjustNewStock}
                  onChange={(e) => setInvAdjustNewStock(e.target.value)}
                  className={inputClass}
                  placeholder="Masukkan stok baru"
                />
              </div>

              <div className="space-y-1.5">
                <Label className={labelClass}>Alasan</Label>
                <Input
                  value={invAdjustReason}
                  onChange={(e) => setInvAdjustReason(e.target.value)}
                  placeholder="Alasan penyesuaian (opsional)"
                  className={inputClass}
                />
              </div>
            </div>
          )}
          <ResponsiveDialogFooter className="mt-4 gap-2">
            <Button
              variant="ghost"
              className="flex-1 h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
              onClick={() => setInvAdjustOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="flex-1 h-9 text-xs theme-bg theme-hover text-white"
              disabled={invAdjusting}
              onClick={handleInvAdjustSubmit}
            >
              {invAdjusting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Simpan'}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete Inventory Item Alert */}
      <AlertDialog open={!!deleteInvId} onOpenChange={(open) => { if (!open) setDeleteInvId(null) }}>
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Hapus Bahan?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Bahan yang dihapus tidak dapat dikembalikan. Pastikan bahan ini tidak digunakan dalam komposisi produk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="text-slate-400 hover:text-white hover:bg-white/[0.04]">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20"
              onClick={handleDeleteInv}
              disabled={deletingInv}
            >
              {deletingInv ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hapus'}
            </AlertDialogAction>
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
              Kategori untuk mengelompokkan bahan inventory
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
                          <p className="text-[10px] text-slate-500">{c._count.items} bahan</p>
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
              Kategori yang dihapus tidak dapat dikembalikan. Bahan dalam kategori ini akan menjadi tanpa kategori.
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
    </motion.div>
  )
}