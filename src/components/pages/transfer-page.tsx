'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  Truck,
  Plus,
  Search,
  Eye,
  Send,
  CheckCircle2,
  XCircle,
  Package,
  ArrowRight,
  ArrowLeft,
  CalendarDays,
  StickyNote,
  Hash,
  Loader2,
  Store,
  Inbox,
  ArrowUpFromLine,
  Ban,
  PackageOpen,
  X,
  ShoppingCart,
  Info,
  CircleDot,
  Beaker,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──
type TransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'

interface TransferItem {
  id?: string
  productId: string
  productName: string
  sku?: string
  productBarcode?: string
  quantity: number
  price: number
  hpp?: number
  stockAtSource?: number
}

interface TransferItemApi {
  id?: string
  productName: string
  productSku?: string | null
  productBarcode?: string | null
  quantity: number
  hpp: number
  price: number
}

interface InventoryItemOption {
  id: string
  name: string
  sku?: string
  baseUnit: string
  stock: number
  avgCost: number
  category?: { id: string; name: string; color: string } | null
}

interface InventoryTransferForm {
  inventoryItemId: string
  itemName: string
  itemSku?: string | null
  itemBaseUnit: string
  quantity: number
  avgCost: number
  stockAtSource: number
}

interface InventoryTransferItemApi {
  id: string
  inventoryItemId?: string
  itemName: string
  itemSku?: string | null
  itemBaseUnit: string
  quantity: number
  avgCost: number
}

interface Transfer {
  id: string
  transferNumber: string
  fromOutletId: string
  fromOutletName?: string
  toOutletId: string
  toOutletName?: string
  fromOutlet?: { id: string; name: string; address?: string; phone?: string }
  toOutlet?: { id: string; name: string; address?: string; phone?: string }
  createdBy?: { id: string; name: string; email?: string } | null
  receivedBy?: { id: string; name: string; email?: string } | null
  receivedAt?: string | null
  status: TransferStatus
  notes?: string | null
  createdAt: string
  updatedAt: string
  items: TransferItem[] | TransferItemApi[]
  itemType?: string
  inventoryTransferItems?: InventoryTransferItemApi[]
  _count?: { items: number }
  itemCount?: number
  totalQty?: number
  totalPrice?: number
  direction?: string
}

interface OutletOption {
  id: string
  name: string
}

interface ProductOption {
  id: string
  name: string
  sku?: string
  barcode?: string
  price: number
  hpp: number
  stock: number
  hasVariants?: boolean
  variantCount?: number
  variants?: { id: string; name: string; sku?: string; barcode?: string; price: number; hpp: number; stock: number }[]
}

// ── Status Badge ──
function StatusBadge({ status }: { status: TransferStatus }) {
  const config: Record<TransferStatus, { label: string; className: string }> = {
    DRAFT: { label: 'Draft', className: 'bg-amber-500/10 border-amber-500/20 text-amber-400' },
    IN_TRANSIT: { label: 'Dikirim', className: 'bg-sky-500/10 border-sky-500/20 text-sky-400' },
    RECEIVED: { label: 'Diterima', className: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' },
    CANCELLED: { label: 'Dibatalkan', className: 'bg-red-500/10 border-red-500/20 text-red-400' },
  }
  const c = config[status] || config.DRAFT
  return (
    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 leading-none border font-medium', c.className)}>
      {c.label}
    </Badge>
  )
}

// ── Animation variants ──
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
export default function TransferPage() {
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'

  // ── Top-level mode ──
  const [transferMode, setTransferMode] = useState<'PRODUCT' | 'INVENTORY'>('PRODUCT')

  // ── State (Product) ──
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string>('outbound')
  const [hasGroup, setHasGroup] = useState(false)
  const [outlets, setOutlets] = useState<OutletOption[]>([])

  // Detail dialog
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null)

  // Create dialog (product)
  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [destOutlet, setDestOutlet] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [createItems, setCreateItems] = useState<TransferItem[]>([])

  // Product search
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<ProductOption[]>([])
  const [productSearching, setProductSearching] = useState(false)
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const [addQty, setAddQty] = useState('1')

  // ── State (Inventory) ──
  const [invTransfers, setInvTransfers] = useState<Transfer[]>([])
  const [invLoading, setInvLoading] = useState(true)
  const [invTab, setInvTab] = useState<string>('outbound')

  // Inventory create dialog
  const [invCreateOpen, setInvCreateOpen] = useState(false)
  const [invCreateLoading, setInvCreateLoading] = useState(false)
  const [invDestOutlet, setInvDestOutlet] = useState('')
  const [invCreateNotes, setInvCreateNotes] = useState('')
  const [invCreateItems, setInvCreateItems] = useState<InventoryTransferForm[]>([])

  // Inventory search
  const [invSearch, setInvSearch] = useState('')
  const [invResults, setInvResults] = useState<InventoryItemOption[]>([])
  const [invSearching, setInvSearching] = useState(false)
  const [showInvDropdown, setShowInvDropdown] = useState(false)
  const invSearchRef = useRef<HTMLDivElement>(null)
  const [invAddQty, setInvAddQty] = useState('1')

  // Action loading
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // ── Fetch outlet group ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/outlet-group')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) {
            const hasG = !!data.hasGroup || !!data.group
            setHasGroup(hasG)
            const groupData = data.group || data
            if (hasG && groupData?.outlets) {
              setOutlets(groupData.outlets.filter((o: { id: string }) => o.id !== session?.user?.outletId))
            }
          }
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [session?.user?.outletId])

  // ── Fetch transfers (Product) ──
  const fetchTransfers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/transfers?direction=${tab}`)
      if (res.ok) {
        const data = await res.json()
        setTransfers((data.transfers || []).filter((t: Transfer) => t.itemType !== 'INVENTORY'))
      }
    } catch {
      toast.error('Gagal memuat data transfer')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void fetchTransfers()
  }, [fetchTransfers])

  // ── Fetch transfers (Inventory) ──
  const fetchInvTransfers = useCallback(async () => {
    setInvLoading(true)
    try {
      const res = await fetch(`/api/transfers?direction=${invTab}&itemType=INVENTORY`)
      if (res.ok) {
        const data = await res.json()
        setInvTransfers(data.transfers || [])
      }
    } catch {
      toast.error('Gagal memuat data transfer bahan baku')
    } finally {
      setInvLoading(false)
    }
  }, [invTab])

  useEffect(() => {
    if (hasGroup) void fetchInvTransfers()
  }, [fetchInvTransfers, hasGroup])

  // ── Product search (debounced) ──
  useEffect(() => {
    if (!productSearch.trim()) {
      setProductResults([])
      setShowProductDropdown(false)
      return
    }
    const timeout = setTimeout(async () => {
      setProductSearching(true)
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(productSearch)}&limit=20`)
        if (res.ok) {
          const data = await res.json()
          setProductResults(data.products || [])
          setShowProductDropdown(true)
        }
      } catch {
        // Network error — silently ignore (user may be offline)
      } finally {
        setProductSearching(false)
      }
      // If response was not ok (e.g. 500), log for debugging but don't show toast on every keystroke
      // The API itself handles fallback queries
    }, 300)
    return () => clearTimeout(timeout)
  }, [productSearch])

  // Close dropdown on outside click (product)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Inventory search (debounced) ──
  useEffect(() => {
    if (!invSearch.trim()) {
      setInvResults([])
      setShowInvDropdown(false)
      return
    }
    const timeout = setTimeout(async () => {
      setInvSearching(true)
      try {
        const res = await fetch(`/api/inventory/items?search=${encodeURIComponent(invSearch)}`)
        if (res.ok) {
          const data = await res.json()
          setInvResults(data.items || [])
          setShowInvDropdown(true)
        }
      } catch {
        // ignore
      } finally {
        setInvSearching(false)
      }
    }, 300)
    return () => clearTimeout(timeout)
  }, [invSearch])

  // Close dropdown on outside click (inventory)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (invSearchRef.current && !invSearchRef.current.contains(e.target as Node)) {
        setShowInvDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Actions (shared for both modes) ──
  const handleSend = async (id: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/transfers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'IN_TRANSIT' }) })
      if (res.ok) {
        toast.success('Transfer berhasil dikirim')
        void fetchTransfers()
        void fetchInvTransfers()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal mengirim transfer')
      }
    } catch {
      toast.error('Gagal mengirim transfer')
    } finally {
      setActionLoading(null)
    }
  }

  const handleReceive = async (id: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/transfers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'RECEIVED' }) })
      if (res.ok) {
        const data = await res.json()
        const msg = data.message || 'Transfer berhasil diterima'
        toast.success(msg, { duration: 5000 })
        void fetchTransfers()
        void fetchInvTransfers()
        setDetailOpen(false)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menerima transfer')
      }
    } catch {
      toast.error('Gagal menerima transfer')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancel = async (id: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/transfers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CANCELLED' }) })
      if (res.ok) {
        toast.success('Transfer dibatalkan')
        void fetchTransfers()
        void fetchInvTransfers()
        setDetailOpen(false)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal membatalkan transfer')
      }
    } catch {
      toast.error('Gagal membatalkan transfer')
    } finally {
      setActionLoading(null)
    }
  }

  // ── Add product to create list ──
  const handleAddProduct = (product: ProductOption) => {
    if (createItems.find(i => i.productId === product.id)) {
      toast.error('Produk sudah ditambahkan')
      return
    }
    const qty = parseInt(addQty) || 1
    if (qty > product.stock) {
      toast.error(`Stok tersedia hanya ${product.stock}`)
      return
    }
    if (qty <= 0) {
      toast.error('Jumlah harus lebih dari 0')
      return
    }
    setCreateItems(prev => [...prev, {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      productBarcode: product.barcode,
      quantity: qty,
      price: product.price,
      hpp: product.hpp || 0,
      stockAtSource: product.stock,
    }])
    setProductSearch('')
    setShowProductDropdown(false)
    setAddQty('1')
  }

  const handleRemoveCreateItem = (productId: string) => {
    setCreateItems(prev => prev.filter(i => i.productId !== productId))
  }

  const handleUpdateCreateQty = (productId: string, qty: number) => {
    setCreateItems(prev => prev.map(i => {
      if (i.productId === productId) {
        if (qty > (i.stockAtSource ?? 9999)) {
          toast.error(`Stok tersedia hanya ${i.stockAtSource}`)
          return i
        }
        return { ...i, quantity: qty }
      }
      return i
    }))
  }

  // ── Add inventory item to create list ──
  const handleAddInvItem = (item: InventoryItemOption) => {
    if (invCreateItems.find(i => i.inventoryItemId === item.id)) {
      toast.error('Bahan baku sudah ditambahkan')
      return
    }
    const qty = parseInt(invAddQty) || 1
    if (qty > item.stock) {
      toast.error(`Stok tersedia hanya ${item.stock} ${item.baseUnit}`)
      return
    }
    if (qty <= 0) {
      toast.error('Jumlah harus lebih dari 0')
      return
    }
    setInvCreateItems(prev => [...prev, {
      inventoryItemId: item.id,
      itemName: item.name,
      itemSku: item.sku || null,
      itemBaseUnit: item.baseUnit,
      quantity: qty,
      avgCost: item.avgCost || 0,
      stockAtSource: item.stock,
    }])
    setInvSearch('')
    setShowInvDropdown(false)
    setInvAddQty('1')
  }

  const handleRemoveInvCreateItem = (inventoryItemId: string) => {
    setInvCreateItems(prev => prev.filter(i => i.inventoryItemId !== inventoryItemId))
  }

  const handleUpdateInvCreateQty = (inventoryItemId: string, qty: number) => {
    setInvCreateItems(prev => prev.map(i => {
      if (i.inventoryItemId === inventoryItemId) {
        if (qty > (i.stockAtSource ?? 9999)) {
          toast.error(`Stok tersedia hanya ${i.stockAtSource} ${i.itemBaseUnit}`)
          return i
        }
        return { ...i, quantity: qty }
      }
      return i
    }))
  }

  // ── Submit create (Product) ──
  const handleSubmitCreate = async () => {
    if (!destOutlet) {
      toast.error('Pilih outlet tujuan')
      return
    }
    if (createItems.length === 0) {
      toast.error('Tambahkan minimal 1 produk')
      return
    }
    setCreateLoading(true)
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toOutletId: destOutlet,
          notes: createNotes || undefined,
          items: createItems.map(i => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
        }),
      })
      if (res.ok) {
        toast.success('Transfer berhasil dibuat')
        setCreateOpen(false)
        setDestOutlet('')
        setCreateNotes('')
        setCreateItems([])
        void fetchTransfers()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal membuat transfer')
      }
    } catch {
      toast.error('Gagal membuat transfer')
    } finally {
      setCreateLoading(false)
    }
  }

  // ── Submit create (Inventory) ──
  const handleSubmitInvCreate = async () => {
    if (!invDestOutlet) {
      toast.error('Pilih outlet tujuan')
      return
    }
    if (invCreateItems.length === 0) {
      toast.error('Tambahkan minimal 1 bahan baku')
      return
    }
    setInvCreateLoading(true)
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemType: 'INVENTORY',
          toOutletId: invDestOutlet,
          notes: invCreateNotes || undefined,
          items: invCreateItems.map(i => ({
            inventoryItemId: i.inventoryItemId,
            quantity: i.quantity,
          })),
        }),
      })
      if (res.ok) {
        toast.success('Transfer bahan baku berhasil dibuat')
        setInvCreateOpen(false)
        setInvDestOutlet('')
        setInvCreateNotes('')
        setInvCreateItems([])
        void fetchInvTransfers()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal membuat transfer bahan baku')
      }
    } catch {
      toast.error('Gagal membuat transfer bahan baku')
    } finally {
      setInvCreateLoading(false)
    }
  }

  // ── Open detail ──
  const openDetail = async (transfer: Transfer) => {
    setDetailOpen(true)
    // Always fetch full detail (list doesn't include items data)
    try {
      const res = await fetch(`/api/transfers/${transfer.id}`)
      if (res.ok) {
        const data = await res.json()
        if (data.itemType === 'INVENTORY') {
          // Normalize inventory transfer
          const normalized: Transfer = {
            ...data,
            fromOutletName: data.fromOutlet?.name || transfer.fromOutletName || '-',
            toOutletName: data.toOutlet?.name || transfer.toOutletName || '-',
            items: [],
            inventoryTransferItems: data.inventoryTransferItems || [],
          }
          setSelectedTransfer(normalized)
        } else {
          // Normalize product transfer
          const normalized: Transfer = {
            ...data,
            fromOutletName: data.fromOutlet?.name || transfer.fromOutletName || '-',
            toOutletName: data.toOutlet?.name || transfer.toOutletName || '-',
            items: (data.items || []).map((item: TransferItemApi) => ({
              productId: '',
              productName: item.productName,
              sku: item.productSku || undefined,
              productBarcode: item.productBarcode || undefined,
              quantity: item.quantity,
              price: item.price,
              hpp: item.hpp || 0,
            })),
            inventoryTransferItems: [],
          }
          setSelectedTransfer(normalized)
        }
      } else {
        setSelectedTransfer(transfer)
      }
    } catch {
      setSelectedTransfer(transfer)
    }
  }

  // ── Render transfer list (reusable for both modes) ──
  const renderTransferList = (
    transfersList: Transfer[],
    currentTab: string,
    isLoading: boolean,
    isInventory: boolean,
  ) => {
    if (isLoading) {
      return (
        <div className="space-y-3 mt-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 bg-nebula rounded-xl" />
          ))}
        </div>
      )
    }

    return (
      <>
        {/* Desktop Table */}
        <div className="hidden md:block mt-4">
          <Card className="bg-nebula border-white/[0.06] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent">
                  <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">No. Transfer</TableHead>
                  <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">
                    {currentTab === 'outbound' ? 'Tujuan' : 'Asal'}
                  </TableHead>
                  <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Item</TableHead>
                  <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Qty</TableHead>
                  <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Total</TableHead>
                  <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Tanggal</TableHead>
                  <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Catatan</TableHead>
                  <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfersList.length === 0 ? (
                  <TableRow className="border-white/[0.04] hover:bg-transparent">
                    <TableCell colSpan={9} className="text-center py-12">
                      {isInventory ? (
                        <Beaker className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                      ) : (
                        <Package className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                      )}
                      <p className="text-sm text-slate-500">Belum ada transfer</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  transfersList.map((t) => (
                    <TableRow
                      key={t.id}
                      className="border-white/[0.04] hover:bg-transparent cursor-pointer"
                      onClick={() => openDetail(t)}
                    >
                      <TableCell className="text-xs text-slate-200 font-medium font-mono">
                        <div className="flex items-center gap-1.5">
                          {t.transferNumber}
                          {isInventory && (
                            <Badge className="text-[8px] px-1 py-0 leading-none bg-violet-500/10 border-violet-500/20 text-violet-400 font-medium">
                              Bahan Baku
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <Store className="h-3 w-3 text-slate-500 shrink-0" />
                          {currentTab === 'outbound' ? t.toOutletName : t.fromOutletName}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={t.status} />
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 text-right">
                        {isInventory
                          ? `${t._count?.items ?? t.itemCount ?? (t.inventoryTransferItems?.length ?? 0)} bahan`
                          : `${t._count?.items ?? t.itemCount ?? t.items?.length ?? 0} produk`
                        }
                      </TableCell>
                      <TableCell className="text-xs text-slate-300 text-right font-medium">
                        {formatNumber(t.totalQty ?? 0)}
                        {isInventory && t.inventoryTransferItems && t.inventoryTransferItems.length > 0 && (
                          <span className="text-slate-500 ml-1 text-[10px]">{t.inventoryTransferItems[0].itemBaseUnit}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-emerald-400 text-right font-medium">
                        {formatCurrency(t.totalPrice ?? 0)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatDate(t.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 max-w-[150px] truncate">
                        {t.notes || '-'}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                            onClick={() => openDetail(t)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {t.status === 'DRAFT' && currentTab === 'outbound' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-sky-400 hover:text-sky-300 hover:bg-sky-500/[0.06] gap-1"
                              disabled={actionLoading === t.id}
                              onClick={() => handleSend(t.id)}
                            >
                              {actionLoading === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                              <span className="text-[10px]">Kirim</span>
                            </Button>
                          )}
                          {t.status === 'IN_TRANSIT' && currentTab === 'inbound' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/[0.06] gap-1"
                              disabled={actionLoading === t.id}
                              onClick={() => handleReceive(t.id)}
                            >
                              {actionLoading === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                              <span className="text-[10px]">Terima</span>
                            </Button>
                          )}
                          {t.status !== 'RECEIVED' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06] gap-1"
                              disabled={actionLoading === t.id}
                              onClick={() => handleCancel(t.id)}
                            >
                              {actionLoading === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                              <span className="text-[10px]">Batalkan</span>
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
        <div className="md:hidden mt-4 space-y-2">
          {transfersList.length === 0 ? (
            <Card className="bg-nebula border-white/[0.06]">
              <CardContent className="py-12 text-center">
                {isInventory ? (
                  <Beaker className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                ) : (
                  <Package className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                )}
                <p className="text-sm text-slate-500">Belum ada transfer</p>
              </CardContent>
            </Card>
          ) : (
            <AnimatePresence>
              {transfersList.map((t) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card
                    className="bg-nebula border-white/[0.06] cursor-pointer active:scale-[0.98] transition-transform"
                    onClick={() => openDetail(t)}
                  >
                    <CardContent className="p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {currentTab === 'outbound' ? (
                            <ArrowRight className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                          ) : (
                            <ArrowLeft className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          )}
                          <span className="text-xs text-white font-medium font-mono">{t.transferNumber}</span>
                          {isInventory && (
                            <Badge className="text-[8px] px-1 py-0 leading-none bg-violet-500/10 border-violet-500/20 text-violet-400 font-medium">
                              Bahan Baku
                            </Badge>
                          )}
                        </div>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Store className="h-3 w-3 shrink-0" />
                        <span className="text-[11px]">
                          {currentTab === 'outbound' ? 'Ke' : 'Dari'} {currentTab === 'outbound' ? t.toOutletName : t.fromOutletName}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-500">
                        <div className="flex items-center gap-1.5">
                          {isInventory ? (
                            <Beaker className="h-3 w-3" />
                          ) : (
                            <Package className="h-3 w-3" />
                          )}
                          <span className="text-[11px]">
                            {isInventory
                              ? `${t._count?.items ?? t.itemCount ?? (t.inventoryTransferItems?.length ?? 0)} bahan`
                              : `${t._count?.items ?? t.itemCount ?? t.items?.length ?? 0} produk`
                            }
                          </span>
                          <span className="text-[10px]">•</span>
                          <span className="text-[11px] text-slate-300">Qty {formatNumber(t.totalQty ?? 0)}</span>
                          {isInventory && t.inventoryTransferItems && t.inventoryTransferItems.length > 0 && (
                            <span className="text-[10px] text-slate-500">{t.inventoryTransferItems[0].itemBaseUnit}</span>
                          )}
                        </div>
                        <span className="text-xs font-medium text-emerald-400">{formatCurrency(t.totalPrice ?? 0)}</span>
                      </div>
                      {t.status !== 'RECEIVED' && (
                        <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.04]" onClick={(e) => e.stopPropagation()}>
                          {t.status === 'DRAFT' && currentTab === 'outbound' && (
                            <Button
                              size="sm"
                              className="flex-1 h-7 text-[10px] gap-1 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/20"
                              disabled={actionLoading === t.id}
                              onClick={() => handleSend(t.id)}
                            >
                              {actionLoading === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              Kirim
                            </Button>
                          )}
                          {t.status === 'IN_TRANSIT' && currentTab === 'inbound' && (
                            <Button
                              size="sm"
                              className="flex-1 h-7 text-[10px] gap-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20"
                              disabled={actionLoading === t.id}
                              onClick={() => handleReceive(t.id)}
                            >
                              {actionLoading === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                              Terima
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[10px] gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                            disabled={actionLoading === t.id}
                            onClick={() => handleCancel(t.id)}
                          >
                            {actionLoading === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                            Batalkan
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </>
    )
  }

  // ── Skeleton ──
  if (loading && !invLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-40 bg-white/[0.04]" />
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
      {/* Flow Instructions */}
      <motion.div variants={itemVariants}>
        <div className="bg-sky-500/[0.06] border border-sky-500/15 rounded-xl p-3.5">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="space-y-2 min-w-0">
              <p className="text-xs font-medium text-sky-300">Alur Transfer Stok Antar Outlet</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-amber-400" /><span className="text-slate-300">1. Buat Draft</span></span>
                <span className="text-slate-600">→</span>
                <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-sky-400" /><span className="text-slate-300">2. Kirim (stok dikurangi)</span></span>
                <span className="text-slate-600">→</span>
                <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-emerald-400" /><span className="text-slate-300">3. Terima cabang (stok ditambah/restock otomatis)</span></span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">Transfer Stok</h1>
          <p className="text-sm text-slate-500">Kelola transfer stok antar outlet</p>
        </div>
        {hasGroup && isOwner && (
          <Button
            size="sm"
            onClick={() => {
              if (transferMode === 'PRODUCT') setCreateOpen(true)
              else setInvCreateOpen(true)
            }}
            className="theme-bg theme-hover text-white text-xs font-medium h-8 px-3 rounded-lg gap-1.5 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {transferMode === 'PRODUCT' ? 'Buat Transfer' : 'Transfer Bahan Baku'}
            </span>
          </Button>
        )}
      </motion.div>

      {!hasGroup ? (
        <motion.div variants={itemVariants}>
          <Card className="bg-nebula border-white/[0.06]">
            <CardContent className="py-12 text-center">
              <Truck className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Outlet belum tergabung dalam grup</p>
              <p className="text-xs text-slate-500 mt-1">Hubungkan outlet ke grup untuk mengaktifkan fitur transfer stok</p>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <>
          {/* Mode Switcher Tabs */}
          <motion.div variants={itemVariants}>
            <Tabs value={transferMode} onValueChange={(v) => setTransferMode(v as 'PRODUCT' | 'INVENTORY')}>
              <TabsList className="bg-white/[0.04] border border-white/[0.06] h-9 p-0.5 rounded-lg">
                <TabsTrigger
                  value="PRODUCT"
                  className="text-xs font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 px-3 gap-1.5"
                >
                  <Package className="h-3 w-3" />
                  Transfer Produk
                </TabsTrigger>
                <TabsTrigger
                  value="INVENTORY"
                  className="text-xs font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 px-3 gap-1.5"
                >
                  <Beaker className="h-3 w-3" />
                  Transfer Bahan Baku
                </TabsTrigger>
              </TabsList>

              {/* ═══ PRODUCT Mode ═══ */}
              <TabsContent value="PRODUCT" className="mt-0">
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList className="bg-white/[0.04] border border-white/[0.06] h-9 p-0.5 rounded-lg mt-4">
                    <TabsTrigger
                      value="outbound"
                      className="text-xs font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 px-3 gap-1.5"
                    >
                      <ArrowUpFromLine className="h-3 w-3" />
                      Outbound
                    </TabsTrigger>
                    <TabsTrigger
                      value="inbound"
                      className="text-xs font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 px-3 gap-1.5"
                    >
                      <Inbox className="h-3 w-3" />
                      Inbound
                    </TabsTrigger>
                  </TabsList>
                  {renderTransferList(transfers, tab, loading, false)}
                </Tabs>
              </TabsContent>

              {/* ═══ INVENTORY (Bahan Baku) Mode ═══ */}
              <TabsContent value="INVENTORY" className="mt-0">
                <Tabs value={invTab} onValueChange={setInvTab}>
                  <TabsList className="bg-white/[0.04] border border-white/[0.06] h-9 p-0.5 rounded-lg mt-4">
                    <TabsTrigger
                      value="outbound"
                      className="text-xs font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 px-3 gap-1.5"
                    >
                      <ArrowUpFromLine className="h-3 w-3" />
                      Outbound
                    </TabsTrigger>
                    <TabsTrigger
                      value="inbound"
                      className="text-xs font-medium h-7 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-slate-400 px-3 gap-1.5"
                    >
                      <Inbox className="h-3 w-3" />
                      Inbound
                    </TabsTrigger>
                  </TabsList>
                  {renderTransferList(invTransfers, invTab, invLoading, true)}
                </Tabs>
              </TabsContent>
            </Tabs>
          </motion.div>
        </>
      )}

      {/* ═══ Detail Dialog ═══ */}
      <ResponsiveDialog open={detailOpen} onOpenChange={setDetailOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <div className="flex items-center gap-2">
              <ResponsiveDialogTitle className="text-white text-base">Detail Transfer</ResponsiveDialogTitle>
              {selectedTransfer?.itemType === 'INVENTORY' && (
                <Badge className="text-[9px] px-1.5 py-0.5 leading-none bg-violet-500/10 border-violet-500/20 text-violet-400 font-medium">
                  Bahan Baku
                </Badge>
              )}
            </div>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              {selectedTransfer?.transferNumber}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          {selectedTransfer && (
            <div className="space-y-4 mt-2">
              {/* Info: From / To */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Asal</p>
                  <p className="text-xs text-slate-200 font-medium">{selectedTransfer.fromOutletName}</p>
                </div>
                <div className="bg-white/[0.03] rounded-lg p-2.5 border border-white/[0.04]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Tujuan</p>
                  <p className="text-xs text-slate-200 font-medium">{selectedTransfer.toOutletName}</p>
                </div>
              </div>

              {/* Status + Meta */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedTransfer.status} />
                  <span className="text-[11px] text-slate-500">{formatDate(selectedTransfer.createdAt)}</span>
                </div>
              </div>

              {/* Created By / Received By */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/[0.02] rounded-lg p-2 border border-white/[0.03]">
                  <p className="text-[10px] text-slate-500 mb-0.5">Dibuat oleh</p>
                  <p className="text-[11px] text-slate-300">{selectedTransfer.createdBy?.name || '-'}</p>
                </div>
                {selectedTransfer.status === 'RECEIVED' && (
                  <div className="bg-white/[0.02] rounded-lg p-2 border border-white/[0.03]">
                    <p className="text-[10px] text-slate-500 mb-0.5">Diterima oleh</p>
                    <p className="text-[11px] text-slate-300">{selectedTransfer.receivedBy?.name || '-'}</p>
                    {selectedTransfer.receivedAt && <p className="text-[10px] text-slate-500">{formatDate(selectedTransfer.receivedAt)}</p>}
                  </div>
                )}
              </div>

              {selectedTransfer.notes && (
                <div className="flex items-start gap-2 text-slate-400">
                  <StickyNote className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span className="text-xs">{selectedTransfer.notes}</span>
                </div>
              )}

              {/* Items: Product */}
              {selectedTransfer.itemType !== 'INVENTORY' && (
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-2">
                    Daftar Produk ({selectedTransfer.items?.length || 0} item)
                  </p>
                  <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                    {selectedTransfer.items && selectedTransfer.items.length > 0 ? (
                      selectedTransfer.items.map((item, idx) => (
                        <div
                          key={(item as TransferItem).id || idx}
                          className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-200 font-medium truncate">{item.productName}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {item.sku && <p className="text-[10px] text-slate-500 font-mono">{item.sku}</p>}
                              {item.hpp !== undefined && item.hpp > 0 && <p className="text-[10px] text-amber-400/70">HPP {formatCurrency(item.hpp)}</p>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-white font-medium">x{formatNumber(item.quantity)}</p>
                            <p className="text-[10px] text-slate-500">{formatCurrency(item.price)}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500 text-center py-4">Tidak ada item</p>
                    )}
                  </div>
                </div>
              )}

              {/* Items: Inventory */}
              {selectedTransfer.itemType === 'INVENTORY' && (
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-2">
                    Daftar Bahan Baku ({selectedTransfer.inventoryTransferItems?.length || 0} item)
                  </p>
                  <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                    {selectedTransfer.inventoryTransferItems && selectedTransfer.inventoryTransferItems.length > 0 ? (
                      selectedTransfer.inventoryTransferItems.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-200 font-medium truncate">{item.itemName}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {item.itemSku && <p className="text-[10px] text-slate-500 font-mono">{item.itemSku}</p>}
                              {item.avgCost > 0 && <p className="text-[10px] text-amber-400/70">Avg Cost {formatCurrency(item.avgCost)}</p>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-white font-medium">
                              x{formatNumber(item.quantity)}
                              <span className="text-[10px] text-slate-500 ml-1">{item.itemBaseUnit}</span>
                            </p>
                            <p className="text-[10px] text-emerald-400">{formatCurrency(item.avgCost * item.quantity)}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500 text-center py-4">Tidak ada item</p>
                    )}
                  </div>
                </div>
              )}

              {/* Actions in dialog */}
              {selectedTransfer.status !== 'RECEIVED' && selectedTransfer.status !== 'CANCELLED' && (
                <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04]">
                  {selectedTransfer.status === 'DRAFT' && (
                    (selectedTransfer.itemType === 'INVENTORY' ? invTab : tab) === 'outbound' && (
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs gap-1.5 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/20"
                        disabled={actionLoading === selectedTransfer.id}
                        onClick={() => handleSend(selectedTransfer.id)}
                      >
                        {actionLoading === selectedTransfer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        Kirim
                      </Button>
                    )
                  )}
                  {selectedTransfer.status === 'IN_TRANSIT' && (
                    (selectedTransfer.itemType === 'INVENTORY' ? invTab : tab) === 'inbound' && (
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs gap-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20"
                        disabled={actionLoading === selectedTransfer.id}
                        onClick={() => handleReceive(selectedTransfer.id)}
                      >
                        {actionLoading === selectedTransfer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Terima
                      </Button>
                    )
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 h-8 text-xs gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/[0.06]"
                    disabled={actionLoading === selectedTransfer.id}
                    onClick={() => handleCancel(selectedTransfer.id)}
                  >
                    {actionLoading === selectedTransfer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                    Batalkan
                  </Button>
                </div>
              )}
            </div>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ═══ Create Transfer Dialog (Product) ═══ */}
      <ResponsiveDialog open={createOpen} onOpenChange={(open) => {
        if (!open) {
          setDestOutlet('')
          setCreateNotes('')
          setCreateItems([])
          setProductSearch('')
        }
        setCreateOpen(open)
      }}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">Buat Transfer Baru</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Pilih outlet tujuan dan produk yang akan ditransfer
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 mt-2">
            {/* Destination outlet */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Outlet Tujuan</label>
              <Select value={destOutlet} onValueChange={setDestOutlet}>
                <SelectTrigger className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-9 rounded-lg">
                  <SelectValue placeholder="Pilih outlet" />
                </SelectTrigger>
                <SelectContent className="bg-nebula border-white/[0.06]">
                  {outlets.map((o) => (
                    <SelectItem key={o.id} value={o.id} className="text-slate-200 text-xs focus:bg-white/[0.06] focus:text-white">
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Catatan</label>
              <Textarea
                value={createNotes}
                onChange={(e) => setCreateNotes(e.target.value)}
                placeholder="Catatan transfer (opsional)"
                className="bg-white/[0.04] border-white/[0.04] text-white text-xs min-h-[60px] rounded-lg resize-none"
              />
            </div>

            {/* Product search */}
            <div className="space-y-1.5" ref={searchRef}>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Tambah Produk</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Cari produk..."
                    className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-9 pl-8 rounded-lg"
                  />
                  {showProductDropdown && productResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-nebula border border-white/[0.06] rounded-lg shadow-xl z-50 max-h-[200px] overflow-y-auto">
                      {productResults.map((p) => (
                        <button
                          key={p.id}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors first:rounded-t-lg last:rounded-b-lg"
                          onClick={() => handleAddProduct(p)}
                        >
                          <Package className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-200 truncate">{p.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {p.sku && <p className="text-[10px] text-slate-500 font-mono">{p.sku}</p>}
                              {p.hasVariants && p.variantCount && (
                                <span className="text-[9px] text-sky-400 bg-sky-500/10 px-1 py-px rounded">{p.variantCount} varian</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-slate-400">Stok: <span className={p.stock > 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>{formatNumber(p.stock)}</span></p>
                            <p className="text-[10px] text-amber-400/70">{formatCurrency(p.hpp)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Input
                  type="number"
                  min="1"
                  value={addQty}
                  onChange={(e) => setAddQty(e.target.value)}
                  className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-9 w-16 rounded-lg text-center"
                />
              </div>
              {productSearching && (
                <div className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-[10px]">Mencari...</span>
                </div>
              )}
            </div>

            {/* Added items */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                Produk ({createItems.length})
              </label>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {createItems.length === 0 ? (
                  <div className="py-6 text-center">
                    <ShoppingCart className="h-6 w-6 text-slate-600 mx-auto mb-1.5" />
                    <p className="text-[11px] text-slate-500">Cari dan tambahkan produk</p>
                  </div>
                ) : (
                  createItems.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-200 font-medium truncate">{item.productName}</p>
                        <p className="text-[10px] text-slate-500">Stok: {formatNumber(item.stockAtSource ?? 0)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          className="w-6 h-6 rounded bg-white/[0.04] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                          onClick={() => handleUpdateCreateQty(item.productId, Math.max(1, item.quantity - 1))}
                        >
                          <span className="text-xs">-</span>
                        </button>
                        <span className="text-xs text-white font-medium w-8 text-center">{item.quantity}</span>
                        <button
                          className="w-6 h-6 rounded bg-white/[0.04] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                          onClick={() => handleUpdateCreateQty(item.productId, item.quantity + 1)}
                        >
                          <span className="text-xs">+</span>
                        </button>
                        <button
                          className="w-6 h-6 rounded bg-red-500/10 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/20 transition-colors ml-1"
                          onClick={() => handleRemoveCreateItem(item.productId)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <ResponsiveDialogFooter className="mt-4 gap-2">
            <Button
              variant="ghost"
              className="flex-1 h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
              onClick={() => setCreateOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="flex-1 h-9 text-xs theme-bg theme-hover text-white"
              disabled={createLoading || !destOutlet || createItems.length === 0}
              onClick={handleSubmitCreate}
            >
              {createLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Buat Transfer
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ═══ Create Transfer Dialog (Inventory / Bahan Baku) ═══ */}
      <ResponsiveDialog open={invCreateOpen} onOpenChange={(open) => {
        if (!open) {
          setInvDestOutlet('')
          setInvCreateNotes('')
          setInvCreateItems([])
          setInvSearch('')
        }
        setInvCreateOpen(open)
      }}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <div className="flex items-center gap-2">
              <ResponsiveDialogTitle className="text-white text-base">Transfer Bahan Baku</ResponsiveDialogTitle>
              <Badge className="text-[9px] px-1.5 py-0.5 leading-none bg-violet-500/10 border-violet-500/20 text-violet-400 font-medium">
                Bahan Baku
              </Badge>
            </div>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Pilih outlet tujuan dan bahan baku yang akan ditransfer
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 mt-2">
            {/* Destination outlet */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Outlet Tujuan</label>
              <Select value={invDestOutlet} onValueChange={setInvDestOutlet}>
                <SelectTrigger className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-9 rounded-lg">
                  <SelectValue placeholder="Pilih outlet" />
                </SelectTrigger>
                <SelectContent className="bg-nebula border-white/[0.06]">
                  {outlets.map((o) => (
                    <SelectItem key={o.id} value={o.id} className="text-slate-200 text-xs focus:bg-white/[0.06] focus:text-white">
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Catatan</label>
              <Textarea
                value={invCreateNotes}
                onChange={(e) => setInvCreateNotes(e.target.value)}
                placeholder="Catatan transfer (opsional)"
                className="bg-white/[0.04] border-white/[0.04] text-white text-xs min-h-[60px] rounded-lg resize-none"
              />
            </div>

            {/* Inventory search */}
            <div className="space-y-1.5" ref={invSearchRef}>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Tambah Bahan Baku</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <Input
                    value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                    placeholder="Cari bahan baku (matcha, susu, kopi...)"
                    className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-9 pl-8 rounded-lg"
                  />
                  {showInvDropdown && invResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-nebula border border-white/[0.06] rounded-lg shadow-xl z-50 max-h-[200px] overflow-y-auto">
                      {invResults.map((item) => (
                        <button
                          key={item.id}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors first:rounded-t-lg last:rounded-b-lg"
                          onClick={() => handleAddInvItem(item)}
                        >
                          <Beaker className="h-3.5 w-3.5 text-violet-400/60 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-200 truncate">{item.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {item.sku && <p className="text-[10px] text-slate-500 font-mono">{item.sku}</p>}
                              {item.category && (
                                <span className="text-[9px] px-1 py-px rounded" style={{ backgroundColor: `${item.category.color}15`, color: item.category.color, border: `1px solid ${item.category.color}30` }}>
                                  {item.category.name}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-slate-400">
                              Stok: <span className={item.stock > 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>{formatNumber(item.stock)} {item.baseUnit}</span>
                            </p>
                            {item.avgCost > 0 && <p className="text-[10px] text-amber-400/70">{formatCurrency(item.avgCost)}/{item.baseUnit}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Input
                  type="number"
                  min="1"
                  value={invAddQty}
                  onChange={(e) => setInvAddQty(e.target.value)}
                  className="bg-white/[0.04] border-white/[0.04] text-white text-xs h-9 w-16 rounded-lg text-center"
                />
              </div>
              {invSearching && (
                <div className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-[10px]">Mencari...</span>
                </div>
              )}
            </div>

            {/* Added inventory items */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                Bahan Baku ({invCreateItems.length})
              </label>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {invCreateItems.length === 0 ? (
                  <div className="py-6 text-center">
                    <Beaker className="h-6 w-6 text-slate-600 mx-auto mb-1.5" />
                    <p className="text-[11px] text-slate-500">Cari dan tambahkan bahan baku</p>
                  </div>
                ) : (
                  invCreateItems.map((item) => (
                    <div
                      key={item.inventoryItemId}
                      className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-200 font-medium truncate">{item.itemName}</p>
                        <p className="text-[10px] text-slate-500">
                          Stok: {formatNumber(item.stockAtSource)} {item.itemBaseUnit}
                          {item.avgCost > 0 && (
                            <span className="ml-2 text-amber-400/70">{formatCurrency(item.avgCost)}/{item.itemBaseUnit}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          className="w-6 h-6 rounded bg-white/[0.04] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                          onClick={() => handleUpdateInvCreateQty(item.inventoryItemId, Math.max(1, item.quantity - 1))}
                        >
                          <span className="text-xs">-</span>
                        </button>
                        <span className="text-xs text-white font-medium w-8 text-center">{item.quantity}</span>
                        <button
                          className="w-6 h-6 rounded bg-white/[0.04] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                          onClick={() => handleUpdateInvCreateQty(item.inventoryItemId, item.quantity + 1)}
                        >
                          <span className="text-xs">+</span>
                        </button>
                        <button
                          className="w-6 h-6 rounded bg-red-500/10 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/20 transition-colors ml-1"
                          onClick={() => handleRemoveInvCreateItem(item.inventoryItemId)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <ResponsiveDialogFooter className="mt-4 gap-2">
            <Button
              variant="ghost"
              className="flex-1 h-9 text-xs text-slate-400 hover:text-white hover:bg-white/[0.04]"
              onClick={() => setInvCreateOpen(false)}
            >
              Batal
            </Button>
            <Button
              className="flex-1 h-9 text-xs theme-bg theme-hover text-white"
              disabled={invCreateLoading || !invDestOutlet || invCreateItems.length === 0}
              onClick={handleSubmitInvCreate}
            >
              {invCreateLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Buat Transfer
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </motion.div>
  )
}