'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { formatCurrency, formatNumber } from '@/lib/format'
import { motion, AnimatePresence } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  Building2,
  TrendingUp,
  TrendingDown,
  Receipt,
  Package,
  Store,
  Banknote,
  ShoppingCart,
  UserCircle,
  Layers,
  Users,
  Hash,
  Box,
  Search,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  Phone,
  MapPin,
  X,
  Pencil,
  Trash2,
  ShieldCheck,
  UserPlus,
  Calendar,
  Plus,
  KeyRound,
  AtSign,
  Lock,
  Sparkles,
  Info,
  LayoutGrid,
  Rows3,
} from 'lucide-react'

// ── Types ──
interface OutletSummary {
  id: string
  name: string
  isMain: boolean
  address?: string
  phone?: string
  accountType: string
  managerName: string
  revenue: number
  brutto: number
  discount: number
  tax: number
  transactions: number
  yesterdayRevenue: number
  revenueChangePercent: number
  totalProducts: number
  totalStock: number
  totalCustomers: number
}

interface GroupTotals {
  totalRevenue: number
  totalTransactions: number
  totalProducts: number
  totalStock: number
  totalCustomers: number
  totalBrutto: number
  totalDiscount: number
  totalTax: number
}

interface DrillDownOutlet {
  id: string
  name: string
  isMain: boolean
  address?: string
  phone?: string
  revenue: number
  transactions: number
  customers: number
  products: number
  totalStock: number
  managerName?: string
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

type DateFilter = 'today' | '7days' | '30days'
type DetailTab = 'transactions' | 'customers' | 'products' | 'crew'

const dateFilterConfig: Record<DateFilter, { label: string; param: string }> = {
  today: { label: 'Hari ini', param: 'today' },
  '7days': { label: '7 Hari', param: '7days' },
  '30days': { label: '30 Hari', param: '30days' },
}

const tabConfig: Record<DetailTab, { label: string; icon: React.ReactNode }> = {
  transactions: { label: 'Transaksi', icon: <Receipt className="h-3.5 w-3.5" /> },
  customers: { label: 'Customer', icon: <Users className="h-3.5 w-3.5" /> },
  products: { label: 'Produk', icon: <Package className="h-3.5 w-3.5" /> },
  crew: { label: 'Crew', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
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
const dialogVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, scale: 0.96, y: 20, transition: { duration: 0.15 } },
}

// ── Summary Stat Card ──
function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  color: string
}) {
  return (
    <Card className="bg-nebula border-white/[0.06]">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', color)}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] sm:text-[11px] text-slate-500 uppercase tracking-wider font-medium truncate">{label}</p>
            <p className="text-sm sm:text-base font-bold text-white truncate">{value}</p>
            {sub && <p className="text-[10px] text-slate-500 truncate">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Change Badge ──
function ChangeBadge({ percent }: { percent: number }) {
  if (percent === 0) return null
  const isUp = percent > 0
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-px rounded',
      isUp ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
    )}>
      {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {Math.abs(percent)}%
    </span>
  )
}

// ── Crew Types ──
interface CrewMember {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
  crewPermission?: { id: string; pages: string } | null
  _count?: { transactions: number }
}

// ── Plan Meta ──
interface PlanMeta {
  plan: string
  multiOutlet: boolean
  maxOutlets: number
}

// ── Create Group Dialog ──
function CreateGroupDialog({
  open,
  currentOutletName,
  onCreated,
  onClose,
}: {
  open: boolean
  currentOutletName: string
  onCreated: () => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) { setName(''); setTimeout(() => inputRef.current?.focus(), 100) }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim().length < 2) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/outlet-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Gagal membuat grup'); return }
      toast.success(data.message || `Grup "${name.trim()}" berhasil dibuat!`)
      onCreated()
    } catch {
      toast.error('Gagal membuat grup')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="bg-[#0c0d12] border-white/[0.06] max-w-sm w-[92vw] p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <DialogTitle className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            Buat Grup Outlet
          </DialogTitle>
          <DialogDescription className="text-[11px] text-slate-500 mt-0.5">
            Gabungkan outlet Anda ke dalam satu grup untuk mengelola beberapa cabang.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium text-slate-400">Nama Grup</Label>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: RNB Coffee Group"
              required
              minLength={2}
              className="h-9 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
            />
          </div>

          <div className="bg-amber-500/[0.06] rounded-lg p-3 border border-amber-500/10 space-y-1">
            <div className="flex items-start gap-2">
              <Info className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
              <div className="text-[10px] text-slate-400 leading-relaxed space-y-1">
                <p>Outlet <span className="text-white font-medium">&quot;{currentOutletName}&quot;</span> akan menjadi <span className="text-amber-400 font-medium">outlet utama</span> dalam grup ini.</p>
                <p>Setelah grup dibuat, Anda dapat menambahkan outlet cabang dari halaman ini.</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-[11px] text-slate-400">
              Batal
            </Button>
            <Button
              type="submit"
              disabled={submitting || name.trim().length < 2}
              className="h-8 px-4 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? 'Membuat...' : 'Buat Grup'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Add Outlet Dialog ──
function AddOutletDialog({
  open,
  groupName,
  currentOutletCount,
  maxOutlets,
  planLabel,
  onAdded,
  onClose,
}: {
  open: boolean
  groupName: string
  currentOutletCount: number
  maxOutlets: number
  planLabel: string
  onAdded: () => void
  onClose: () => void
}) {
  const [outletName, setOutletName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const outletLimit = maxOutlets === -1 ? 'Unlimited' : String(maxOutlets)
  const reachedLimit = maxOutlets !== -1 && currentOutletCount >= maxOutlets

  useEffect(() => {
    if (open) {
      setOutletName(''); setAddress(''); setPhone('')
      setOwnerName(''); setOwnerEmail(''); setOwnerPassword(''); setConfirmPassword('')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const canSubmit =
    outletName.trim().length >= 2 &&
    ownerName.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim()) &&
    ownerPassword.length >= 8 &&
    ownerPassword === confirmPassword &&
    !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/outlet-group/outlets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: outletName.trim(),
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          ownerName: ownerName.trim(),
          ownerEmail: ownerEmail.trim().toLowerCase(),
          ownerPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Gagal menambah outlet'); return }
      toast.success(data.message || `Outlet "${outletName.trim()}" berhasil ditambahkan!`)
      onAdded()
    } catch {
      toast.error('Gagal menambah outlet')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="bg-[#0c0d12] border-white/[0.06] max-w-md w-[95vw] p-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06] shrink-0">
          <DialogTitle className="text-sm font-bold text-white flex items-center gap-2">
            <Plus className="h-4 w-4 text-emerald-400" />
            Tambah Outlet Baru
          </DialogTitle>
          <DialogDescription className="text-[11px] text-slate-500 mt-0.5">
            Grup: <span className="text-slate-300 font-medium">{groupName}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-5">
            {/* Plan limit info */}
            <div className="flex items-center gap-2 text-[10px] bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.04]">
              <Info className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <span className="text-slate-400">
                Paket <span className="text-white font-medium">{planLabel}</span> —
                <span className="text-emerald-400 font-medium">{currentOutletCount}</span>/{outletLimit} outlet terpakai
              </span>
            </div>

            {/* Section 1: Outlet Info */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                <Store className="h-3.5 w-3.5 text-slate-500" />
                Informasi Outlet
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium text-slate-500">Nama Outlet <span className="text-red-400">*</span></Label>
                  <Input
                    ref={inputRef}
                    value={outletName}
                    onChange={(e) => setOutletName(e.target.value)}
                    placeholder="Contoh: RNB Kopi Kelapa Gading"
                    required
                    minLength={2}
                    className="h-8 text-xs bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium text-slate-500">Alamat</Label>
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Jl. Contoh No. 123"
                    className="h-8 text-xs bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium text-slate-500">Telepon</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="08xxxxxxxxxx"
                    className="h-8 text-xs bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
                  />
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-white/[0.06]" />

            {/* Section 2: Owner Account */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                Akun Pemilik (Owner)
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium text-slate-500">Nama Pemilik <span className="text-red-400">*</span></Label>
                  <Input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Nama lengkap pemilik"
                    required
                    minLength={2}
                    className="h-8 text-xs bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium text-slate-500">Email <span className="text-red-400">*</span></Label>
                  <Input
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="owner@outlet.com"
                    required
                    className="h-8 text-xs bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-medium text-slate-500">Password <span className="text-red-400">*</span></Label>
                    <Input
                      type="password"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      placeholder="Min. 8 karakter"
                      required
                      minLength={8}
                      className="h-8 text-xs bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-medium text-slate-500">Konfirmasi <span className="text-red-400">*</span></Label>
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Ulangi password"
                      required
                      minLength={8}
                      className={cn(
                        'h-8 text-xs bg-white/[0.04] border text-white placeholder:text-slate-600',
                        confirmPassword && confirmPassword !== ownerPassword
                          ? 'border-red-500/50 focus-visible:ring-red-500/30'
                          : 'border-white/[0.06]'
                      )}
                    />
                  </div>
                </div>
                {confirmPassword && confirmPassword !== ownerPassword && (
                  <p className="text-[10px] text-red-400 flex items-center gap-1">
                    <X className="h-3 w-3" />
                    Password tidak cocok
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2 shrink-0 bg-[#0c0d12]">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-[11px] text-slate-400">
              Batal
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || reachedLimit}
              className="h-8 px-4 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? 'Menambahkan...' : 'Tambah Outlet'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Outlet Detail Dialog ──
function OutletDetailDialog({
  outlet,
  period,
  open,
  onClose,
  canEdit,
}: {
  outlet: OutletSummary
  period: DateFilter
  open: boolean
  onClose: () => void
  canEdit: boolean
}) {
  const [tab, setTab] = useState<DetailTab>('transactions')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<unknown[]>([])
  const [outletInfo, setOutletInfo] = useState<DrillDownOutlet | null>(null)
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, limit: 20, total: 0, totalPages: 0 })

  // Crew tab state
  const [crewList, setCrewList] = useState<CrewMember[]>([])
  const [crewOwner, setCrewOwner] = useState<{ id: string; name: string; email: string; createdAt: string } | null>(null)
  const [crewPagination, setCrewPagination] = useState<PaginationInfo>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [crewLoading, setCrewLoading] = useState(false)
  const [addCrewOpen, setAddCrewOpen] = useState(false)
  const [editCrew, setEditCrew] = useState<CrewMember | null>(null)
  const [deleteCrew, setDeleteCrew] = useState<CrewMember | null>(null)

  // Version counter to prevent stale fetch responses from overwriting fresh data
  const fetchVersionRef = useRef(0)

  // Fetch data for transactions/customers/products tabs
  const fetchData = useCallback(async () => {
    if (tab === 'crew') return // Crew has its own fetch
    const version = ++fetchVersionRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams({
        outletId: outlet.id,
        tab,
        period: dateFilterConfig[period].param,
        page: String(page),
        limit: '15',
      })
      if (search) params.set('search', search)
      // Send timezone offset so server filters correctly
      params.set('tzOffset', String(-new Date().getTimezoneOffset()))

      const res = await fetch(`/api/multi-outlet/outlet?${params}`)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        console.error('[OutletDetail] API error:', res.status, errData)
        throw new Error(errData.error || `HTTP ${res.status}`)
      }
      const json = await res.json()
      console.log('[OutletDetail] Response:', { tab, dataLength: Array.isArray(json.data) ? json.data.length : 'not-array', outlet: json.outlet?.name })
      // Guard: ignore stale responses
      if (version !== fetchVersionRef.current) return
      setOutletInfo(json.outlet)
      setData(Array.isArray(json.data) ? json.data : [])
      setPagination(json.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 })
    } catch (err) {
      if (version !== fetchVersionRef.current) return // Stale — ignore
      console.error('[OutletDetail] Fetch error:', err)
      const msg = err instanceof Error ? err.message : 'Gagal memuat detail outlet'
      toast.error(msg)
      setData([])
    } finally {
      if (version !== fetchVersionRef.current) return // Stale — don't update loading
      setLoading(false)
    }
  }, [outlet.id, tab, period, page, search])

  // Fetch crew data
  const fetchCrew = useCallback(async () => {
    if (tab !== 'crew') return
    setCrewLoading(true)
    try {
      const params = new URLSearchParams({
        outletId: outlet.id,
        page: String(page),
        limit: '15',
      })
      if (search) params.set('search', search)

      const res = await fetch(`/api/multi-outlet/crew?${params}`)
      if (!res.ok) throw new Error()
      const json = await res.json()
      setCrewList(json.crew || [])
      setCrewOwner(json.owner || null)
      setCrewPagination(json.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 })
    } catch {
      toast.error('Gagal memuat data crew')
    } finally {
      setCrewLoading(false)
    }
  }, [outlet.id, tab, page, search])

  // Reset when dialog opens/tab changes
  useEffect(() => {
    if (open) {
      fetchVersionRef.current++ // Invalidate any in-flight requests
      setTab('transactions')
      setSearch('')
      setPage(1)
      setData([])
      setLoading(true)
      setCrewList([])
      setCrewOwner(null)
      setOutletInfo(null)
    }
  }, [open, outlet.id])

  useEffect(() => {
    if (!open) return
    void fetchData()
  }, [fetchData, open])

  useEffect(() => {
    if (!open) return
    void fetchCrew()
  }, [fetchCrew, open])

  // Crew CRUD handlers
  const handleAddCrew = async (form: { name: string; email: string; password: string }) => {
    try {
      const res = await fetch('/api/multi-outlet/crew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outletId: outlet.id, ...form }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Gagal menambah crew'); return }
      toast.success(`Crew "${form.name}" berhasil ditambahkan`)
      setAddCrewOpen(false)
      setTimeout(() => void fetchCrew(), 300)
    } catch {
      toast.error('Gagal menambah crew')
    }
  }

  const handleEditCrew = async (form: { name: string; email: string; password?: string }) => {
    if (!editCrew) return
    try {
      const body: Record<string, string> = { name: form.name, email: form.email }
      if (form.password) body.password = form.password
      const res = await fetch(`/api/multi-outlet/crew/${editCrew.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Gagal mengubah crew'); return }
      toast.success(`Crew "${form.name}" berhasil diubah`)
      setEditCrew(null)
      setTimeout(() => void fetchCrew(), 300)
    } catch {
      toast.error('Gagal mengubah crew')
    }
  }

  const handleDeleteCrew = async () => {
    if (!deleteCrew) return
    try {
      const res = await fetch(`/api/multi-outlet/crew/${deleteCrew.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Gagal menghapus crew'); return }
      toast.success(`Crew "${deleteCrew.name}" berhasil dihapus`)
      setDeleteCrew(null)
      setTimeout(() => void fetchCrew(), 300)
    } catch {
      toast.error('Gagal menghapus crew')
    }
  }

  const isCrewTab = tab === 'crew'
  const currentPagination = isCrewTab ? crewPagination : pagination

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent showCloseButton={false} className="bg-[#0c0d12] border-white/[0.06] max-w-4xl lg:max-w-6xl w-[95vw] max-h-[88vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-white/[0.06] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <DialogTitle className="text-base font-bold text-white truncate">{outlet.name}</DialogTitle>
                {outlet.isMain && (
                  <Badge className="text-[9px] px-1.5 py-0 bg-amber-500/10 border-amber-500/20 text-amber-400 border hover:bg-amber-500/10">
                    Utama
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                {outletInfo && (
                  <>
                    <span className="flex items-center gap-1"><UserCircle className="h-3 w-3" />{outletInfo.managerName || '-'}</span>
                    {outletInfo.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{outletInfo.phone}</span>}
                    {outletInfo.address && <span className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3" />{outletInfo.address}</span>}
                  </>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white shrink-0 rounded-lg" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Quick stats */}
          {outletInfo && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[
                { label: 'Omset', value: formatCurrency(outletInfo.revenue), icon: <Banknote className="h-3 w-3 text-emerald-400" /> },
                { label: 'Transaksi', value: formatNumber(outletInfo.transactions), icon: <Receipt className="h-3 w-3 text-sky-400" /> },
                { label: 'Customer', value: formatNumber(outletInfo.customers), icon: <Users className="h-3 w-3 text-violet-400" /> },
                { label: 'Produk', value: formatNumber(outletInfo.products), icon: <Package className="h-3 w-3 text-amber-400" /> },
              ].map((s) => (
                <div key={s.label} className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                  <div className="flex items-center gap-1 mb-0.5">
                    {s.icon}
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider">{s.label}</span>
                  </div>
                  <p className="text-xs font-bold text-white truncate">{s.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabs + Search */}
        <div className="px-5 pt-3 pb-2 border-b border-white/[0.04] shrink-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
              {(Object.entries(tabConfig) as [DetailTab, typeof tabConfig[DetailTab]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => { setTab(key); setPage(1); setSearch('') }}
                  className={cn(
                    'text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1.5',
                    tab === key ? 'bg-white/[0.08] text-white' : 'text-slate-500 hover:text-slate-300'
                  )}
                >
                  {cfg.icon}
                  {cfg.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {isCrewTab && canEdit && (
                <Button
                  size="sm"
                  onClick={() => setAddCrewOpen(true)}
                  className="h-7 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                  Tambah
                </Button>
              )}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder={
                    tab === 'transactions' ? 'Cari invoice...' :
                    tab === 'customers' ? 'Cari nama/WA...' :
                    tab === 'crew' ? 'Cari crew...' :
                    'Cari produk...'
                  }
                  className="h-7 pl-7 pr-2 text-[11px] bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600 w-40 sm:w-48"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Data */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isCrewTab ? (
            <CrewListContent
              loading={crewLoading}
              crewList={crewList}
              owner={crewOwner}
              canEdit={canEdit}
              onEdit={(c) => setEditCrew(c)}
              onDelete={(c) => setDeleteCrew(c)}
            />
          ) : loading ? (
            <div className="p-5 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 bg-white/[0.04] rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="p-3">
              {data.length === 0 ? (
                <div className="py-12 text-center">
                  <Receipt className="h-6 w-6 text-slate-700 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 mb-2">Tidak ada data {tab === 'transactions' ? 'transaksi' : tab === 'customers' ? 'customer' : 'produk'}</p>
                  <button
                    onClick={() => void fetchData()}
                    className="text-[10px] text-slate-500 hover:text-slate-300 underline transition-colors"
                  >
                    Coba lagi
                  </button>
                </div>
              ) : tab === 'transactions' ? (
                <TransactionsList data={data as TransactionRow[]} />
              ) : tab === 'customers' ? (
                <CustomersList data={data as CustomerRow[]} />
              ) : (
                <ProductsList data={data as ProductRow[]} />
              )}
            </div>
          )}
        </div>

        {/* Pagination */}
        {currentPagination.totalPages > 1 && (
          <div className="px-5 py-2.5 border-t border-white/[0.06] flex items-center justify-between shrink-0">
            <p className="text-[10px] text-slate-500">
              {currentPagination.page} / {currentPagination.totalPages} halaman ({currentPagination.total} data)
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-6 w-6"
                disabled={page >= currentPagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
    {/* Crew Dialogs — rendered outside parent DialogContent to prevent double close button */}
    <AddCrewDialog
      open={addCrewOpen}
      outletName={outlet.name}
      onClose={() => setAddCrewOpen(false)}
      onSubmit={handleAddCrew}
    />
    {editCrew && (
      <EditCrewDialog
        crew={editCrew}
        onClose={() => setEditCrew(null)}
        onSubmit={handleEditCrew}
      />
    )}
    {deleteCrew && (
      <DeleteCrewDialog
        crew={deleteCrew}
        onClose={() => setDeleteCrew(null)}
        onConfirm={handleDeleteCrew}
      />
    )}</>
  )
}

// ── Crew List Content ──
const AVAILABLE_PAGES_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  products: 'Produk',
  customers: 'Customer',
  pos: 'Kasir',
  transactions: 'Transaksi',
  'audit-log': 'Audit Log',
  crew: 'Crew',
  settings: 'Pengaturan',
  transfer: 'Transfer',
  'multi-outlet': 'Multi Outlet',
}

function CrewListContent({
  loading,
  crewList,
  owner,
  canEdit,
  onEdit,
  onDelete,
}: {
  loading: boolean
  crewList: CrewMember[]
  owner: { id: string; name: string; email: string; createdAt: string } | null
  canEdit: boolean
  onEdit: (crew: CrewMember) => void
  onDelete: (crew: CrewMember) => void
}) {
  if (loading) {
    return (
      <div className="p-5 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 bg-white/[0.04] rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-3 space-y-2">
      {/* Owner card */}
      {owner && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/[0.06] rounded-lg px-3 py-2.5 border border-amber-500/10">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-4 w-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[11px] font-semibold text-white truncate">{owner.name}</p>
                <Badge className="text-[8px] px-1 py-0 bg-amber-500/10 text-amber-400 border-0 hover:bg-amber-500/10 shrink-0">
                  Owner
                </Badge>
              </div>
              <p className="text-[10px] text-slate-500 truncate">{owner.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* Crew list */}
      {crewList.length === 0 && !owner ? (
        <div className="py-12 text-center">
          <ShieldCheck className="h-8 w-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-500">Belum ada crew di outlet ini</p>
        </div>
      ) : crewList.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-xs text-slate-500">Belum ada crew selain owner</p>
        </div>
      ) : (
        crewList.map((c) => {
          const pages = c.crewPermission?.pages ? c.crewPermission.pages.split(',') : ['pos']
          return (
            <div key={c.id} className="flex items-center justify-between gap-3 bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.04]">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <p className="text-[11px] font-semibold text-white truncate">{c.name}</p>
                  <Badge className="text-[8px] px-1 py-0 bg-sky-500/10 text-sky-400 border-0 hover:bg-sky-500/10 shrink-0">
                    Crew
                  </Badge>
                </div>
                <p className="text-[10px] text-slate-500 truncate mb-1">{c.email}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {pages.slice(0, 4).map((p) => (
                    <span key={p} className="text-[8px] px-1.5 py-px rounded bg-white/[0.06] text-slate-400">
                      {AVAILABLE_PAGES_LABELS[p] || p}
                    </span>
                  ))}
                  {pages.length > 4 && (
                    <span className="text-[8px] text-slate-500">+{pages.length - 4}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {canEdit && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onEdit(c)}
                    className="h-6 w-6 rounded-md flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onDelete(c)}
                    className="h-6 w-6 rounded-md flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                )}
                <div className="flex items-center gap-1 text-[9px] text-slate-600">
                  <Calendar className="h-2.5 w-2.5" />
                  {new Date(c.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                {c._count && (
                  <span className="text-[9px] text-slate-600">{c._count.transactions} transaksi</span>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ── Add Crew Dialog ──
function AddCrewDialog({
  open,
  outletName,
  onClose,
  onSubmit,
}: {
  open: boolean
  outletName: string
  onClose: () => void
  onSubmit: (form: { name: string; email: string; password: string }) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClose = useCallback(() => {
    setName(''); setEmail(''); setPassword('')
    onClose()
  }, [onClose])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password.trim()) return
    if (password.length < 8) { toast.error('Password minimal 8 karakter'); return }
    setSubmitting(true)
    await onSubmit({ name: name.trim(), email: email.trim().toLowerCase(), password })
    setSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="bg-[#0c0d12] border-white/[0.06] max-w-sm w-[92vw] p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <DialogTitle className="text-sm font-bold text-white">Tambah Crew</DialogTitle>
          <p className="text-[11px] text-slate-500 mt-0.5">Outlet: {outletName}</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-400">Nama</label>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama lengkap"
              required
              className="h-9 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-400">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@contoh.com"
              required
              className="h-9 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-400">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 karakter"
              required
              minLength={8}
              className="h-9 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-[11px] text-slate-400">
              Batal
            </Button>
            <Button type="submit" disabled={submitting || !name.trim() || !email.trim() || password.length < 8}
              className="h-8 px-4 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? 'Menyimpan...' : 'Tambah Crew'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit Crew Dialog ──
function EditCrewDialog({
  crew,
  onClose,
  onSubmit,
}: {
  crew: CrewMember
  onClose: () => void
  onSubmit: (form: { name: string; email: string; password?: string }) => void
}) {
  const [name, setName] = useState(crew.name)
  const [email, setEmail] = useState(crew.email)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    if (password && password.length < 8) { toast.error('Password minimal 8 karakter'); return }
    setSubmitting(true)
    await onSubmit({ name: name.trim(), email: email.trim().toLowerCase(), ...(password ? { password } : {}) })
    setSubmitting(false)
  }

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="bg-[#0c0d12] border-white/[0.06] max-w-sm w-[92vw] p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <DialogTitle className="text-sm font-bold text-white">Edit Crew</DialogTitle>
          <p className="text-[11px] text-slate-500 mt-0.5">{crew.name}</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-400">Nama</label>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="h-9 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-400">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-9 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-slate-400">
              Password <span className="text-slate-600 font-normal">(kosongkan jika tidak diubah)</span>
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 karakter"
              minLength={password ? 8 : 0}
              className="h-9 text-sm bg-white/[0.04] border-white/[0.06] text-white placeholder:text-slate-600"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="h-8 text-[11px] text-slate-400">
              Batal
            </Button>
            <Button type="submit" disabled={submitting || !name.trim() || !email.trim()}
              className="h-8 px-4 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Delete Crew Dialog ──
function DeleteCrewDialog({
  crew,
  onClose,
  onConfirm,
}: {
  crew: CrewMember
  onClose: () => void
  onConfirm: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    await onConfirm()
    setDeleting(false)
  }

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="bg-[#0c0d12] border-white/[0.06] max-w-sm w-[92vw] p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <DialogTitle className="text-sm font-bold text-white">Hapus Crew</DialogTitle>
        </DialogHeader>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            Apakah Anda yakin ingin menghapus crew <span className="text-white font-semibold">{crew.name}</span> ({crew.email})?
            Aksi ini tidak dapat dibatalkan.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} className="h-8 text-[11px] text-slate-400">
              Batal
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="h-8 px-4 text-[11px] bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Menghapus...' : 'Hapus'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Transaction List ──
interface TransactionRow {
  id: string
  invoiceNumber: string
  total: number
  paymentMethod: string
  createdAt: string
  customer?: { name: string } | null
  user?: { name: string } | null
}

function TransactionsList({ data }: { data: TransactionRow[] }) {
  return (
    <div className="space-y-1.5">
      {data.map((tx) => (
        <div key={tx.id} className="flex items-center justify-between gap-3 bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.04]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-[11px] font-mono font-semibold text-white">{tx.invoiceNumber}</p>
              <Badge className="text-[8px] px-1 py-0 bg-white/[0.06] text-slate-400 border-0 hover:bg-white/[0.06]">{tx.paymentMethod}</Badge>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <span>{tx.user?.name || '-'}</span>
              {tx.customer && <span>• {tx.customer.name}</span>}
              <span>• {new Date(tx.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          <p className="text-xs font-bold text-emerald-400 shrink-0">{formatCurrency(tx.total)}</p>
        </div>
      ))}
    </div>
  )
}

// ── Customer List ──
interface CustomerRow {
  id: string
  name: string
  whatsapp: string
  totalSpend: number
  points: number
  createdAt: string
  _count: { transactions: number }
}

function CustomersList({ data }: { data: CustomerRow[] }) {
  return (
    <div className="space-y-1.5">
      {data.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.04]">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-white truncate">{c.name}</p>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <span>{c.whatsapp}</span>
              <span>• {c._count.transactions} transaksi</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-bold text-white">{formatCurrency(c.totalSpend)}</p>
            <p className="text-[9px] text-amber-400">{c.points} pts</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Product List ──
interface ProductRow {
  id: string
  name: string
  sku?: string
  price: number
  hpp: number
  stock: number
  hasVariants: boolean
  category?: { name: string; color: string } | null
  _count: { variants: number }
}

function ProductsList({ data }: { data: ProductRow[] }) {
  return (
    <div className="space-y-1.5">
      {data.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3 bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.04]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <p className="text-[11px] font-semibold text-white truncate">{p.name}</p>
              {p.hasVariants && (
                <Badge className="text-[8px] px-1 py-0 bg-violet-500/10 text-violet-400 border-0 hover:bg-violet-500/10">
                  {p._count.variants} var
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              {p.category && <span>{p.category.name}</span>}
              {p.sku && <span>• SKU: {p.sku}</span>}
              <span>• Rp {formatNumber(p.price)}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className={cn('text-xs font-bold', p.stock <= 0 ? 'text-red-400' : p.stock <= 10 ? 'text-amber-400' : 'text-white')}>
              {formatNumber(p.stock)}
            </p>
            <p className="text-[9px] text-slate-500">stok</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════
export default function MultiOutletTerminalPage() {
  // ── Auth & Role ──
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'

  // ── State ──
  const [hasGroup, setHasGroup] = useState<boolean | null>(null)
  const [groupName, setGroupName] = useState('')
  const [currentOutletName, setCurrentOutletName] = useState('')
  const [planMeta, setPlanMeta] = useState<PlanMeta | null>(null)
  const [totals, setTotals] = useState<GroupTotals | null>(null)
  const [outlets, setOutlets] = useState<OutletSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState<DateFilter>('today')
  const [detailOutlet, setDetailOutlet] = useState<OutletSummary | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [addOutletOpen, setAddOutletOpen] = useState(false)
  const [deleteOutlet, setDeleteOutlet] = useState<OutletSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [horizontalScroll, setHorizontalScroll] = useState(false)

  // ── Fetch group + data ──
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [groupRes, terminalRes] = await Promise.all([
        fetch('/api/outlet-group'),
        fetch(`/api/multi-outlet/dashboard?period=${dateFilterConfig[dateFilter].param}`),
      ])

      if (groupRes.ok) {
        const groupData = await groupRes.json()
        setHasGroup(!!groupData.hasGroup && !!groupData.groupId)
        setGroupName(groupData.groupName || '')
        setCurrentOutletName(groupData.outlets?.[0]?.name || '')
        setPlanMeta(groupData.plan || null)
      } else {
        setHasGroup(false)
      }

      if (terminalRes.ok) {
        const data = await terminalRes.json()
        setTotals(data.totals || null)
        setOutlets(data.outlets || [])
      }
    } catch {
      toast.error('Gagal memuat data')
      setHasGroup(false)
    } finally {
      setLoading(false)
    }
  }, [dateFilter])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const openDetail = (outlet: OutletSummary) => {
    setDetailOutlet(outlet)
    setDetailOpen(true)
  }

  const handleDeleteOutlet = async () => {
    if (!deleteOutlet) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/outlet-group/outlets?outletId=${deleteOutlet.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Gagal menghapus outlet'); return }
      toast.success(data.message || `Outlet berhasil dihapus`)
      setDeleteOutlet(null)
      void fetchData()
    } catch {
      toast.error('Gagal menghapus outlet')
    } finally {
      setDeleting(false)
    }
  }

  // ── Loading skeleton ──
  if (loading && hasGroup === null) {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-52 bg-white/[0.04]" />
          <Skeleton className="h-3.5 w-64 bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 bg-nebula rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 bg-nebula rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ── No group ──
  if (!hasGroup) {
    const canCreateGroup = isOwner && planMeta?.multiOutlet
    const needsUpgrade = isOwner && planMeta && !planMeta.multiOutlet

    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-4"
      >
        <motion.div variants={itemVariants} className="space-y-1">
          <h1 className="text-xl font-bold text-white tracking-tight">Multi Outlet</h1>
          <p className="text-sm text-slate-500">Dashboard agregasi seluruh outlet</p>
        </motion.div>
        <motion.div variants={itemVariants}>
          <Card className="bg-nebula border-white/[0.06]">
            <CardContent className="py-16 text-center">
              <Building2 className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-sm text-slate-400 font-medium">Belum ada grup outlet</p>
              <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed mb-6">
                Hubungkan outlet Anda ke sebuah grup untuk mengelola beberapa cabang dari satu dashboard.
              </p>
              {canCreateGroup && (
                <Button
                  onClick={() => setCreateGroupOpen(true)}
                  className="h-9 px-5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Buat Grup Outlet
                </Button>
              )}
              {needsUpgrade && (
                <div className="bg-amber-500/[0.06] rounded-lg p-3 border border-amber-500/10 max-w-xs mx-auto space-y-1">
                  <p className="text-[11px] text-amber-400 font-medium">Fitur Multi Outlet tidak tersedia</p>
                  <p className="text-[10px] text-slate-500">
                    Paket <span className="text-white font-medium">{planMeta.plan}</span> Anda saat ini hanya mendukung 1 outlet.
                    Upgrade ke <span className="text-emerald-400 font-medium">Pro</span> atau <span className="text-amber-400 font-medium">Enterprise</span> untuk mengaktifkan fitur ini.
                  </p>
                </div>
              )}
              {!isOwner && (
                <p className="text-[10px] text-slate-500">Hanya pemilik (Owner) yang dapat membuat grup outlet.</p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <CreateGroupDialog
          open={createGroupOpen}
          currentOutletName={currentOutletName}
          onCreated={() => { setCreateGroupOpen(false); void fetchData() }}
          onClose={() => setCreateGroupOpen(false)}
        />
      </motion.div>
    )
  }

  return (
    <motion.div className="space-y-4" variants={containerVariants} initial="hidden" animate="visible">
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">Multi Outlet</h1>
            {groupName && (
              <Badge className="text-[9px] px-1.5 py-0 bg-white/[0.06] text-slate-400 border-0 hover:bg-white/[0.06]">
                {groupName}
              </Badge>
            )}
          </div>
          <p className="text-sm text-slate-500">Dashboard agregasi seluruh outlet</p>
        </div>
        {/* Date Filter */}
        <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-lg p-0.5">
          {(Object.keys(dateFilterConfig) as DateFilter[]).map((key) => (
            <button
              key={key}
              onClick={() => setDateFilter(key)}
              className={cn(
                'text-[11px] font-medium px-2.5 py-1.5 rounded-md transition-colors',
                dateFilter === key
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {dateFilterConfig[key].label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Summary Cards - 5 cards */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          icon={<Banknote className="h-4 w-4 text-emerald-400" />}
          label="Total Pendapatan"
          value={formatCurrency(totals?.totalRevenue ?? 0)}
          sub={dateFilterConfig[dateFilter].label}
          color="bg-emerald-500/10"
        />
        <StatCard
          icon={<Receipt className="h-4 w-4 text-sky-400" />}
          label="Total Transaksi"
          value={formatNumber(totals?.totalTransactions ?? 0)}
          color="bg-sky-500/10"
        />
        <StatCard
          icon={<Users className="h-4 w-4 text-violet-400" />}
          label="Total Customer"
          value={formatNumber(totals?.totalCustomers ?? 0)}
          sub="Akumulasi semua outlet"
          color="bg-violet-500/10"
        />
        <StatCard
          icon={<Package className="h-4 w-4 text-amber-400" />}
          label="Total Produk"
          value={formatNumber(totals?.totalProducts ?? 0)}
          color="bg-amber-500/10"
        />
        <StatCard
          icon={<Store className="h-4 w-4 text-rose-400" />}
          label="Total Outlet"
          value={formatNumber(outlets.length)}
          color="bg-rose-500/10"
        />
      </motion.div>

      {/* Per-outlet cards */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-300">Outlet</h2>
            {isOwner && (
              <Button
                size="sm"
                onClick={() => setAddOutletOpen(true)}
                disabled={planMeta?.maxOutlets !== -1 && outlets.length >= (planMeta?.maxOutlets ?? 0)}
                className="h-7 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Tambah Outlet
              </Button>
            )}
            {outlets.length > 0 && (
              <button
                onClick={() => setHorizontalScroll((v) => !v)}
                className="h-7 w-7 rounded-md flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
                title={horizontalScroll ? 'Tampilan grid' : 'Tampilan horizontal scroll'}
              >
                {horizontalScroll ? <LayoutGrid className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
              </button>
            )}
            <span className="text-[10px] text-slate-500 bg-white/[0.04] px-1.5 py-0.5 rounded-md font-medium">
              {outlets.length}{planMeta?.maxOutlets !== -1 ? `/${planMeta.maxOutlets}` : ''}
            </span>
          </div>
        </div>

        {outlets.length === 0 ? (
          <Card className="bg-nebula border-white/[0.06]">
            <CardContent className="py-12 text-center">
              <Store className="h-8 w-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Tidak ada data outlet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="relative">
            <div
              className={cn(
                horizontalScroll
                  ? 'flex gap-3 overflow-x-auto pb-2 snap-x scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/[0.08]'
                  : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'
              )}
            >
              {outlets.map((outlet, idx) => (
                <motion.div
                  key={outlet.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05, duration: 0.3 }}
                  className={cn(horizontalScroll && 'snap-start shrink-0 w-[280px] sm:w-[320px]')}
                >
                <Card
                  className="bg-nebula border-white/[0.06] hover:border-white/[0.12] transition-all cursor-pointer group"
                  onClick={() => openDetail(outlet)}
                >
                  <CardContent className="p-3.5 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                          <Store className="h-4 w-4 text-slate-400" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold text-white truncate">{outlet.name}</p>
                            {outlet.isMain && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 leading-none border bg-amber-500/10 border-amber-500/20 text-amber-400 shrink-0"
                              >
                                Utama
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <UserCircle className="h-3 w-3 text-slate-600" />
                            <p className="text-[10px] text-slate-500 truncate">{outlet.managerName}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <ChangeBadge percent={outlet.revenueChangePercent} />
                        {isOwner && !outlet.isMain && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteOutlet(outlet) }}
                            className="h-6 w-6 rounded-md flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Hapus outlet"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                        <Eye className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                      </div>
                    </div>

                    {/* Stats Grid - 2x3 */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Banknote className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Omset</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatCurrency(outlet.revenue)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <ShoppingCart className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Transaksi</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatNumber(outlet.transactions)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Users className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Customer</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatNumber(outlet.totalCustomers)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Hash className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Produk</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatNumber(outlet.totalProducts)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Box className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Stok</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatNumber(outlet.totalStock)}</p>
                      </div>
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.04]">
                        <div className="flex items-center gap-1 mb-0.5">
                          <ArrowUpRight className="h-2.5 w-2.5 text-slate-500" />
                          <span className="text-[8px] text-slate-500 uppercase tracking-wider">Brutto</span>
                        </div>
                        <p className="text-[11px] font-bold text-white leading-tight">{formatCurrency(outlet.brutto)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
            </div>
            {horizontalScroll && (
              <div className="pointer-events-none absolute top-0 right-0 h-full w-12 bg-gradient-to-l from-[#0b0d12] to-transparent" />
            )}
          </div>
        )}
      </motion.div>

      {/* Outlet Detail Dialog */}
      <AnimatePresence>
        {detailOutlet && detailOpen && (
          <OutletDetailDialog
            outlet={detailOutlet}
            period={dateFilter}
            open={detailOpen}
            onClose={() => setDetailOpen(false)}
            canEdit={isOwner && detailOutlet.isMain}
          />
        )}
      </AnimatePresence>

      {/* Add Outlet Dialog */}
      <AddOutletDialog
        open={addOutletOpen}
        groupName={groupName}
        currentOutletCount={outlets.length}
        maxOutlets={planMeta?.maxOutlets ?? 1}
        planLabel={planMeta?.plan ? (planMeta.plan.charAt(0).toUpperCase() + planMeta.plan.slice(1)) : 'Free'}
        onAdded={() => { setAddOutletOpen(false); void fetchData() }}
        onClose={() => setAddOutletOpen(false)}
      />

      {/* Delete Outlet Confirmation Dialog */}
      <Dialog open={!!deleteOutlet} onOpenChange={(v) => { if (!v) setDeleteOutlet(null) }}>
        <DialogContent className="bg-[#0c0d12] border-white/[0.06] max-w-sm w-[92vw] p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
            <DialogTitle className="text-sm font-bold text-white">Hapus Outlet</DialogTitle>
          </DialogHeader>
          <div className="p-5 space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed">
              Outlet &quot;{deleteOutlet?.name}&quot; beserta seluruh data (transaksi, produk, customer, crew) akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteOutlet(null)} className="h-8 text-[11px] text-slate-400">
                Batal
              </Button>
              <Button
                onClick={() => void handleDeleteOutlet()}
                disabled={deleting}
                className="h-8 px-4 text-[11px] bg-red-600 hover:bg-red-700 text-white"
              >
                {deleting ? 'Menghapus...' : 'Hapus'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}