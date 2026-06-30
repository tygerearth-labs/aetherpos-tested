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
  _count?: { items: number }
  direction?: string
  totalQty?: number
  totalPrice?: number
  firstProduct?: string | null
  itemCount?: number
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

  // ── State ──
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<string>('outbound')
  const [hasGroup, setHasGroup] = useState(false)
  const [outlets, setOutlets] = useState<OutletOption[]>([])

  // Detail dialog
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null)

  // Create dialog
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

  // ── Fetch transfers ──
  const fetchTransfers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/transfers?direction=${tab}`)
      if (res.ok) {
        const data = await res.json()
        setTransfers(data.transfers || [])
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

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Actions ──
  const handleSend = async (id: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/transfers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'IN_TRANSIT' }) })
      if (res.ok) {
        toast.success('Transfer berhasil dikirim')
        void fetchTransfers()
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

  // ── Submit create ──
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

  // ── Open detail ──
  const openDetail = async (transfer: Transfer) => {
    setDetailOpen(true)
    // Always fetch full detail (list doesn't include items data)
    try {
      const res = await fetch(`/api/transfers/${transfer.id}`)
      if (res.ok) {
        const data = await res.json()
        // Normalize: API returns nested fromOutlet/toOutlet objects + items as TransferItemApi
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
        }
        setSelectedTransfer(normalized)
      } else {
        setSelectedTransfer(transfer)
      }
    } catch {
      setSelectedTransfer(transfer)
    }
  }

  // ── Skeleton ──
  if (loading) {
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
            onClick={() => setCreateOpen(true)}
            className="theme-bg theme-hover text-white text-xs font-medium h-8 px-3 rounded-lg gap-1.5 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Buat Transfer</span>
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
          {/* Tabs */}
          <motion.div variants={itemVariants}>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="bg-white/[0.04] border border-white/[0.06] h-9 p-0.5 rounded-lg">
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

              {/* Desktop Table */}
              <div className="hidden md:block mt-4">
                <Card className="bg-nebula border-white/[0.06] overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/[0.06] hover:bg-transparent">
                        <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">No. Transfer</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">
                          {tab === 'outbound' ? 'Tujuan' : 'Asal'}
                        </TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Produk</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Total Qty</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Total Harga</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Status</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Tanggal</TableHead>
                        <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transfers.length === 0 ? (
                        <TableRow className="border-white/[0.04] hover:bg-transparent">
                          <TableCell colSpan={8} className="text-center py-12">
                            <Package className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                            <p className="text-sm text-slate-500">Belum ada transfer</p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        transfers.map((t) => (
                          <TableRow
                            key={t.id}
                            className="border-white/[0.04] hover:bg-transparent cursor-pointer"
                            onClick={() => openDetail(t)}
                          >
                            <TableCell className="text-xs text-slate-200 font-medium font-mono">
                              {t.transferNumber}
                            </TableCell>
                            <TableCell className="text-xs text-slate-200">
                              <div className="flex items-center gap-1.5">
                                <Store className="h-3 w-3 text-slate-500 shrink-0" />
                                {tab === 'outbound' ? t.toOutletName : t.fromOutletName}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-300 max-w-[180px]">
                              <div className="flex flex-col gap-0.5">
                                <span className="truncate">{t.firstProduct || '-'}</span>
                                {t.itemCount > 1 && (
                                  <span className="text-[10px] text-slate-500">+{t.itemCount - 1} produk lainnya</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-300 text-right font-medium">
                              {formatNumber(t.totalQty ?? 0)}
                            </TableCell>
                            <TableCell className="text-xs text-emerald-400 text-right font-medium">
                              {formatCurrency(t.totalPrice ?? 0)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={t.status} />
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">
                              {formatDate(t.createdAt)}
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
                                {t.status === 'DRAFT' && tab === 'outbound' && (
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
                                {t.status === 'IN_TRANSIT' && tab === 'inbound' && (
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
                {transfers.length === 0 ? (
                  <Card className="bg-nebula border-white/[0.06]">
                    <CardContent className="py-12 text-center">
                      <Package className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                      <p className="text-sm text-slate-500">Belum ada transfer</p>
                    </CardContent>
                  </Card>
                ) : (
                  <AnimatePresence>
                    {transfers.map((t) => (
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
                                {tab === 'outbound' ? (
                                  <ArrowRight className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                                ) : (
                                  <ArrowLeft className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                )}
                                <span className="text-xs text-white font-medium font-mono">{t.transferNumber}</span>
                              </div>
                              <StatusBadge status={t.status} />
                            </div>
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <Store className="h-3 w-3 shrink-0" />
                              <span className="text-[11px]">
                                {tab === 'outbound' ? 'Ke' : 'Dari'} {tab === 'outbound' ? t.toOutletName : t.fromOutletName}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-500">
                              <div className="flex items-center gap-1.5">
                                <Package className="h-3 w-3" />
                                <span className="text-[11px]">{t.firstProduct || '-'}{t.itemCount > 1 ? ` +${t.itemCount - 1}` : ''}</span>
                              </div>
                              <span className="text-[10px]">{formatDate(t.createdAt)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[10px]">
                                <span className="text-slate-400">Qty: <span className="text-slate-200 font-medium">{formatNumber(t.totalQty ?? 0)}</span></span>
                                <span className="text-emerald-400 font-medium">{formatCurrency(t.totalPrice ?? 0)}</span>
                              </div>
                            </div>
                            {t.status !== 'RECEIVED' && (
                              <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.04]" onClick={(e) => e.stopPropagation()}>
                                {t.status === 'DRAFT' && tab === 'outbound' && (
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
                                {t.status === 'IN_TRANSIT' && tab === 'inbound' && (
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
            </Tabs>
          </motion.div>
        </>
      )}

      {/* ═══ Detail Dialog ═══ */}
      <ResponsiveDialog open={detailOpen} onOpenChange={setDetailOpen}>
        <ResponsiveDialogContent className="sm:max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-white text-base">Detail Transfer</ResponsiveDialogTitle>
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

              {/* Items */}
              <div>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-2">
                  Daftar Produk ({selectedTransfer.items?.length || 0} item)
                </p>
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                  {selectedTransfer.items && selectedTransfer.items.length > 0 ? (
                    selectedTransfer.items.map((item, idx) => (
                      <div
                        key={item.id || idx}
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

              {/* Actions in dialog */}
              {selectedTransfer.status !== 'RECEIVED' && selectedTransfer.status !== 'CANCELLED' && (
                <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04]">
                  {selectedTransfer.status === 'DRAFT' && tab === 'outbound' && (
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs gap-1.5 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/20"
                      disabled={actionLoading === selectedTransfer.id}
                      onClick={() => handleSend(selectedTransfer.id)}
                    >
                      {actionLoading === selectedTransfer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Kirim
                    </Button>
                  )}
                  {selectedTransfer.status === 'IN_TRANSIT' && tab === 'inbound' && (
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs gap-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20"
                      disabled={actionLoading === selectedTransfer.id}
                      onClick={() => handleReceive(selectedTransfer.id)}
                    >
                      {actionLoading === selectedTransfer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Terima
                    </Button>
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

      {/* ═══ Create Transfer Dialog ═══ */}
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
    </motion.div>
  )
}