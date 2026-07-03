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
  X,
  Settings2,
  Tags,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Scale,
  Edit3,
  SlidersHorizontal,
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
  totalCost: string
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
  const [poCreateSupplier, setPoCreateSupplier] = useState('')
  const [poCreateNotes, setPoCreateNotes] = useState('')
  const [poCreateItems, setPoCreateItems] = useState<PurchaseOrderItem[]>([
    { inventoryItemId: '', inventoryItemName: '', baseUnit: '', qty: '1', unit: '', baseQty: '0', totalCost: '0' },
  ])

  // Inventory item search for purchase
  const [invItemSearch, setInvItemSearch] = useState('')
  const [invItemResults, setInvItemResults] = useState<InventoryItemOption[]>([])
  const [invItemSearching, setInvItemSearching] = useState(false)
  const [showInvItemDropdown, setShowInvItemDropdown] = useState(false)
  const [activeItemSearchIdx, setActiveItemSearchIdx] = useState<number | null>(null)
  const invItemSearchRefs = useRef<Record<number, HTMLDivElement | null>>({})

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
  // Inventory item search for purchase (debounced)
  // ══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!invItemSearch.trim()) {
      setInvItemResults([])
      setShowInvItemDropdown(false)
      return
    }
    const t = setTimeout(async () => {
      setInvItemSearching(true)
      try {
        const res = await fetch(`/api/inventory/items?search=${encodeURIComponent(invItemSearch)}&limit=20`)
        if (res.ok) {
          const data = await res.json()
          setInvItemResults(data.items || [])
          setShowInvItemDropdown(true)
        }
      } catch {
        // silent
      } finally {
        setInvItemSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [invItemSearch])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (activeItemSearchIdx === null) return
      const el = invItemSearchRefs.current[activeItemSearchIdx]
      if (el && !el.contains(e.target as Node)) {
        setShowInvItemDropdown(false)
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
      toast.error('Tambahkan minimal 1 item bahan')
      return
    }
    setPoCreateLoading(true)
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: poCreateSupplier || undefined,
          notes: poCreateNotes || undefined,
          items: validItems.map(i => {
            const baseQty = parseFloat(i.baseQty) || 0
            const totalCost = parseFloat(i.totalCost) || 0
            const unitCost = baseQty > 0 ? totalCost / baseQty : 0
            return {
              inventoryItemId: i.inventoryItemId,
              purchaseQty: parseFloat(i.qty) || 0,
              purchaseUnit: i.unit || '',
              baseQty,
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
    setPoCreateSupplier('')
    setPoCreateNotes('')
    setPoCreateItems([{ inventoryItemId: '', inventoryItemName: '', baseUnit: '', qty: '1', unit: '', baseQty: '0', totalCost: '0' }])
  }

  const handleAddPoItem = () => {
    setPoCreateItems(prev => [
      ...prev,
      { inventoryItemId: '', inventoryItemName: '', baseUnit: '', qty: '1', unit: '', baseQty: '0', totalCost: '0' },
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
    setInvItemSearch('')
    setShowInvItemDropdown(false)
    setActiveItemSearchIdx(null)
  }

  const poTotalCost = useMemo(() => {
    return poCreateItems.reduce((sum, i) => sum + (parseFloat(i.totalCost) || 0), 0)
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
                  placeholder="Cari bahan..."
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
        <ResponsiveDialogContent className="sm:max-w-2xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">Buat Pembelian Baru</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Pilih supplier dan tambahkan item bahan yang dibeli
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 mt-2">
            {/* Supplier */}
            <div className="space-y-1.5">
              <label className={labelClass}>Supplier</label>
              <Select value={poCreateSupplier} onValueChange={setPoCreateSupplier}>
                <SelectTrigger className={cn(inputClass, 'w-full')}>
                  <SelectValue placeholder="Pilih supplier (opsional)" />
                </SelectTrigger>
                <SelectContent className="bg-nebula border-white/[0.06]">
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-slate-200 text-xs focus:bg-white/[0.06] focus:text-white">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className={labelClass}>Catatan</label>
              <Textarea
                value={poCreateNotes}
                onChange={(e) => setPoCreateNotes(e.target.value)}
                placeholder="Catatan pembelian (opsional)"
                className="bg-white/[0.04] border-white/[0.04] text-white text-xs min-h-[60px] rounded-lg resize-none placeholder:text-slate-500"
              />
            </div>

            <Separator className="bg-white/[0.06]" />

            {/* Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={labelClass}>Item Pembelian ({poCreateItems.filter(i => i.inventoryItemId).length})</label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                  onClick={handleAddPoItem}
                >
                  <Plus className="h-3 w-3" />
                  Tambah Item
                </Button>
              </div>

              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {poCreateItems.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 font-medium">Item #{idx + 1}</span>
                      {poCreateItems.length > 1 && (
                        <button
                          className="w-5 h-5 rounded bg-red-500/10 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/20 transition-colors"
                          onClick={() => handleRemovePoItem(idx)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    {/* Item search/select */}
                    <div className="relative" ref={(el) => { invItemSearchRefs.current[idx] = el }}>
                      {item.inventoryItemId ? (
                        <div className="flex items-center gap-2 bg-white/[0.04] rounded-lg px-2.5 h-9">
                          <Package className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span className="text-xs text-slate-200 truncate flex-1">{item.inventoryItemName}</span>
                          <button
                            className="w-5 h-5 rounded hover:bg-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white"
                            onClick={() => {
                              handleUpdatePoItem(idx, 'inventoryItemId', '')
                              handleUpdatePoItem(idx, 'inventoryItemName', '')
                              handleUpdatePoItem(idx, 'baseUnit', '')
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                          <Input
                            value={activeItemSearchIdx === idx ? invItemSearch : ''}
                            onFocus={() => { setActiveItemSearchIdx(idx); setInvItemSearch('') }}
                            onChange={(e) => setInvItemSearch(e.target.value)}
                            placeholder="Cari bahan..."
                            className={cn(inputClass, 'pl-8')}
                          />
                          {activeItemSearchIdx === idx && showInvItemDropdown && invItemResults.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-nebula border border-white/[0.06] rounded-lg shadow-xl z-50 max-h-[180px] overflow-y-auto">
                              {invItemResults.map((r) => (
                                <button
                                  key={r.id}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors first:rounded-t-lg last:rounded-b-lg"
                                  onClick={() => handleSelectInvItem(idx, r)}
                                >
                                  <Package className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-slate-200 truncate">{r.name}</p>
                                    <p className="text-[10px] text-slate-500">Stok: {formatNumber(r.stock)} {r.baseUnit}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                          {activeItemSearchIdx === idx && invItemSearching && (
                            <div className="absolute top-full left-0 right-0 mt-1 flex items-center justify-center gap-2 py-3 text-slate-500">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span className="text-[10px]">Mencari...</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Item fields */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500">Qty</label>
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
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500">Unit</label>
                        <Input
                          value={item.unit}
                          onChange={(e) => handleUpdatePoItem(idx, 'unit', e.target.value)}
                          className={inputClass}
                          placeholder="Ekor"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500">Berat/Volume</label>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={item.baseQty}
                          onChange={(e) => handleUpdatePoItem(idx, 'baseQty', e.target.value)}
                          className={cn(inputClass, 'text-center')}
                          placeholder="1.85"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500">Base Unit</label>
                        <div className="bg-white/[0.02] border border-white/[0.04] text-slate-400 text-xs h-9 rounded-lg flex items-center px-2.5">
                          {item.baseUnit || 'kg'}
                        </div>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <label className="text-[10px] text-slate-500">Harga Total (Rp)</label>
                        <Input
                          type="number"
                          min="0"
                          value={item.totalCost}
                          onChange={(e) => handleUpdatePoItem(idx, 'totalCost', e.target.value)}
                          className={inputClass}
                          placeholder="72000"
                        />
                      </div>
                    </div>

                    {/* Unit Cost (calculated) */}
                    {(parseFloat(item.baseQty) > 0 && parseFloat(item.totalCost) > 0) && (
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <Scale className="h-3 w-3 text-amber-400/70" />
                        <span className="text-slate-500">
                          HPP Satuan: <span className="text-amber-400 font-medium">{formatCurrency(parseFloat(item.totalCost) / parseFloat(item.baseQty))}/{item.baseUnit}</span>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Total Biaya</span>
                <span className="text-base font-bold text-emerald-400">{formatCurrency(poTotalCost)}</span>
              </div>
            </div>
          </div>
          <ResponsiveDialogFooter className="mt-4 gap-2">
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
                <Plus className="h-3.5 w-3.5" />
              )}
              Simpan
            </Button>
          </ResponsiveDialogFooter>
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