'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ProGate } from '@/components/shared/pro-gate'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  UserCog,
  Mail,
  Calendar,
  Eye,
  EyeOff,
  Shield,
  ShieldCheck,
  Search,
  Users,
  RefreshCw,
  CheckCircle2,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Receipt,
  Truck,
  FileText,
  Settings,
  UserCircle,
  Layers,
  UserPlus,
  Sparkles,
} from 'lucide-react'

// ==================== TYPES ====================

interface CrewMember {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
  crewPermission?: { pages: string }
}

interface CrewFormData {
  name: string
  email: string
  password: string
  showPassword: boolean
}

interface CrewPermission {
  userId: string
  userName: string
  userEmail: string
  role: string
  pages: string
}

const DEFAULT_FORM: CrewFormData = {
  name: '',
  email: '',
  password: '',
  showPassword: false,
}

const AVAILABLE_PAGES = [
  { key: 'dashboard', label: 'Dashboard', section: 'Utama' },
  { key: 'products', label: 'Produk', section: 'Utama' },
  { key: 'customers', label: 'Pelanggan', section: 'Utama' },
  { key: 'pos', label: 'POS', section: 'Operasional' },
  { key: 'transactions', label: 'Transaksi', section: 'Operasional' },
  { key: 'purchase', label: 'Pembelian', section: 'Operasional' },
  { key: 'transfer', label: 'Kirim Barang', section: 'Operasional' },
  { key: 'audit-log', label: 'Audit Log', section: 'Manajemen' },
  { key: 'settings', label: 'Pengaturan', section: 'Manajemen' },
  { key: 'crew', label: 'Kelola Crew', section: 'Manajemen' },
]

// ==================== MAIN COMPONENT ====================

export default function CrewPage() {
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'

  if (!isOwner) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-white">Kelola Crew</h1>
          <p className="text-xs text-slate-400 mt-0.5">Manage cashier accounts and access</p>
        </div>
        <Card className="bg-nebula border-white/[0.06]">
          <CardContent className="p-6 text-center">
            <Shield className="h-10 w-10 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-slate-400">Akses Terbatas</p>
            <p className="text-xs text-slate-500 mt-1">Hanya pemilik (OWNER) yang dapat mengelola crew</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <CrewManagement />
}

// ==================== CREW MANAGEMENT ====================

function CrewManagement() {
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('crew-list')

  // Dialogs
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editCrew, setEditCrew] = useState<CrewMember | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Form
  const [formData, setFormData] = useState<CrewFormData>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)

  // Fetch crew list
  const fetchCrew = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/outlet/crew')
      if (res.ok) {
        const data = await res.json()
        setCrew(data.crew || [])
      } else {
        toast.error('Gagal memuat daftar crew')
      }
    } catch {
      toast.error('Gagal memuat daftar crew')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
     
    void fetchCrew()
  }, [fetchCrew])

  // Filter crew by search
  const filteredCrew = crew.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  })

  // ==================== ADD CREW ====================

  const handleAdd = async () => {
    if (!formData.name.trim() || !formData.email.trim() || !formData.password.trim()) {
      toast.error('Nama, email, dan password wajib diisi')
      return
    }
    if (formData.password.length < 8) {
      toast.error('Password minimal 8 karakter')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/outlet/crew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim().toLowerCase(),
          password: formData.password,
        }),
      })
      if (res.ok) {
        toast.success('Crew berhasil ditambahkan')
        setAddOpen(false)
        setFormData(DEFAULT_FORM)
        // Delay refetch to let dialog close animation finish
        // before component re-renders (prevents overlay sticking)
        setTimeout(() => fetchCrew(), 300)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menambah crew')
      }
    } catch {
      toast.error('Gagal menambah crew')
    } finally {
      setSaving(false)
    }
  }

  // ==================== EDIT CREW ====================

  const openEdit = (member: CrewMember) => {
    setEditCrew(member)
    setFormData({
      name: member.name,
      email: member.email,
      password: '',
      showPassword: false,
    })
    setEditOpen(true)
  }

  const handleEdit = async () => {
    if (!editCrew) return
    if (!formData.name.trim() || !formData.email.trim()) {
      toast.error('Nama dan email wajib diisi')
      return
    }
    if (formData.password && formData.password.length < 8) {
      toast.error('Password minimal 8 karakter')
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, string> = {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
      }
      if (formData.password) {
        payload.password = formData.password
      }

      const res = await fetch(`/api/outlet/crew/${editCrew.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        toast.success('Data crew berhasil diperbarui')
        setEditOpen(false)
        setEditCrew(null)
        setFormData(DEFAULT_FORM)
        setTimeout(() => fetchCrew(), 300)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal memperbarui crew')
      }
    } catch {
      toast.error('Gagal memperbarui crew')
    } finally {
      setSaving(false)
    }
  }

  // ==================== DELETE CREW ====================

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/outlet/crew/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Crew berhasil dihapus')
        setTimeout(() => fetchCrew(), 300)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Gagal menghapus crew')
      }
    } catch {
      toast.error('Gagal menghapus crew')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  // ==================== RENDER ====================

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Kelola Crew</h1>
          <p className="text-xs text-slate-400 mt-0.5">Tambah dan kelola akun kasir untuk outlet Anda</p>
        </div>
        {activeTab === 'crew-list' && (
          <Button
            onClick={() => {
              setFormData(DEFAULT_FORM)
              setAddOpen(true)
            }}
            className="theme-bg hover:theme-hover text-white h-8 text-xs"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Tambah Crew
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        {/* Tab bar */}
        <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
          <TabsList className="inline-flex h-auto w-max gap-1 bg-transparent p-0">
            <TabsTrigger
              value="crew-list"
              className="flex items-center gap-2 px-3 py-2.5 sm:py-2 rounded-lg text-xs font-medium whitespace-nowrap data-[state=active]:theme-bg-lighter data-[state=active]:theme-text data-[state=active]:shadow-sm data-[state=active]:theme-shadow text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]/80 transition-all duration-150 border border-transparent data-[state=active]:theme-border-light data-[state=active]:shadow-none"
            >
              <Users className="h-4 w-4" />
              Daftar Crew
            </TabsTrigger>
            <TabsTrigger
              value="crew-permissions"
              className="flex items-center gap-2 px-3 py-2.5 sm:py-2 rounded-lg text-xs font-medium whitespace-nowrap data-[state=active]:theme-bg-lighter data-[state=active]:theme-text data-[state=active]:shadow-sm data-[state=active]:theme-shadow text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]/80 transition-all duration-150 border border-transparent data-[state=active]:theme-border-light data-[state=active]:shadow-none"
            >
              <Shield className="h-4 w-4" />
              Hak Akses
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab: Crew List */}
        <TabsContent value="crew-list" className="space-y-3">
          {/* Search */}
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <Input
              placeholder="Cari nama atau email crew..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 sm:h-10 text-xs bg-nebula border-white/[0.06] text-white placeholder:text-slate-500 w-full"
            />
          </div>

          {/* Content */}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[180px] bg-white/[0.03] rounded-xl" />
              ))}
            </div>
          ) : filteredCrew.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] py-16 px-6 flex flex-col items-center justify-center text-center">
              {/* Illustration */}
              <div className="relative mb-5">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/[0.08] to-purple-500/[0.05] border border-violet-500/[0.1] flex items-center justify-center">
                  <Users className="h-9 w-9 text-violet-500/40" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <UserPlus className="h-3.5 w-3.5 text-emerald-400/70" />
                </div>
              </div>

              {search ? (
                <>
                  <p className="text-sm font-medium text-slate-300">Tidak ada crew yang cocok</p>
                  <p className="text-xs text-slate-500 mt-1.5 max-w-[260px] leading-relaxed">
                    Coba kata kunci lain untuk menemukan crew yang kamu cari
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-slate-300">Belum ada crew</p>
                  <p className="text-xs text-slate-500 mt-1.5 max-w-[260px] leading-relaxed">
                    Tambahkan crew untuk membantu mengelola kasir dan operasional outlet
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 mb-4">
                    <Sparkles className="h-3 w-3 text-violet-400/60" />
                    <span className="text-[10px] text-violet-400/60 font-medium">Atur hak akses per halaman untuk setiap crew</span>
                  </div>
                  <Button
                    onClick={() => { setFormData(DEFAULT_FORM); setAddOpen(true) }}
                    className="h-8 text-xs font-medium gap-1.5 rounded-lg theme-bg theme-hover text-white shadow-lg theme-shadow"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah Crew
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Desktop: Table View */}
              <div className="hidden md:block rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/[0.06] hover:bg-transparent bg-nebula/80">
                      <TableHead className="text-slate-500 text-[11px] font-medium">Crew</TableHead>
                      <TableHead className="text-slate-500 text-[11px] font-medium">Email</TableHead>
                      <TableHead className="text-slate-500 text-[11px] font-medium text-center">Role</TableHead>
                      <TableHead className="text-slate-500 text-[11px] font-medium text-center">Halaman Akses</TableHead>
                      <TableHead className="text-slate-500 text-[11px] font-medium">Bergabung</TableHead>
                      <TableHead className="text-slate-500 text-[11px] font-medium text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCrew.map((member, idx) => {
                      const pages = member.crewPermission?.pages?.split(',').filter(Boolean) || []
                      const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length]
                      return (
                        <TableRow key={member.id} className="border-white/[0.06] hover:bg-white/[0.03]">
                          <TableCell className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${avatarColor}`}>
                                {getInitials(member.name)}
                              </div>
                              <p className="text-sm font-medium text-slate-200">{member.name}</p>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <Mail className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                              <span className="text-xs text-slate-400">{member.email}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center py-3 px-4">
                            <Badge variant="outline" className="text-[10px] font-medium bg-white/[0.04] border-white/[0.08] text-slate-400">
                              {member.role}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3 px-4">
                            <div className="flex flex-wrap justify-center gap-1">
                              {pages.length > 0 ? (
                                pages.map((p) => {
                                  const pageLabel = AVAILABLE_PAGES.find((ap) => ap.key === p)?.label || p
                                  return (
                                    <Badge key={p} className="text-[10px] theme-bg-very-light theme-border-light theme-text px-1.5 py-0">
                                      {pageLabel}
                                    </Badge>
                                  )
                                })
                              ) : (
                                <span className="text-[10px] text-slate-600">Default (POS)</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5 text-slate-500" />
                              <span className="text-xs text-slate-400">{formatDate(member.createdAt)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right py-3 px-4">
                            <div className="flex items-center justify-end gap-0.5">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/[0.04] rounded-lg" onClick={() => openEdit(member)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg" onClick={() => setDeleteId(member.id)}>
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

              {/* Mobile: Card View */}
              <div className="md:hidden space-y-3">
                {filteredCrew.map((member, idx) => {
                  const pages = member.crewPermission?.pages?.split(',').filter(Boolean) || []
                  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length]
                  return (
                    <div key={member.id} className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
                      <div className="px-4 py-3.5 flex items-center gap-3 border-b border-white/[0.04]">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold ${avatarColor}`}>
                          {getInitials(member.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-200 truncate">{member.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Mail className="h-3 w-3 text-slate-500" />
                            <span className="text-[11px] text-slate-500 truncate">{member.email}</span>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] font-medium bg-white/[0.04] border-white/[0.08] text-slate-400">
                          {member.role}
                        </Badge>
                      </div>
                      <div className="px-4 py-3 space-y-3">
                        <div>
                          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1.5">Halaman Akses</p>
                          {pages.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {pages.map((p) => {
                                const pageLabel = AVAILABLE_PAGES.find((ap) => ap.key === p)?.label || p
                                return (
                                  <Badge key={p} className="text-[10px] theme-bg-very-light theme-border-light theme-text px-1.5 py-0.5">
                                    {pageLabel}
                                  </Badge>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-[11px] text-slate-500">Default (POS)</p>
                          )}
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 text-slate-500" />
                            <span className="text-[11px] text-slate-500">{formatDate(member.createdAt)}</span>
                          </div>
                          <div className="flex items-center gap-0.5">
                            <button type="button" onClick={() => openEdit(member)} className="flex items-center justify-center h-9 w-9 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.04] transition-colors">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => setDeleteId(member.id)} className="flex items-center justify-center h-9 w-9 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="text-[10px] text-slate-600 text-center pb-1">
                {filteredCrew.length} crew ditampilkan{search && ` dari ${crew.length} total`}
              </p>
            </>
          )}
        </TabsContent>

        {/* Tab: Crew Permissions */}
        <TabsContent value="crew-permissions">
          <ProGate feature="crewPermissions" label="Hak Akses Crew" description="Kelola akses halaman per crew member" minHeight="200px">
            <CrewAccessTab />
          </ProGate>
        </TabsContent>
      </Tabs>

      {/* Add Crew Dialog */}
      <ResponsiveDialog open={addOpen} onOpenChange={setAddOpen}>
        <ResponsiveDialogContent className="p-4 max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-semibold text-white">
              Tambah Crew Baru
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Tambahkan akun kasir baru untuk outlet Anda. Crew dapat login dan menggunakan POS sesuai hak akses.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="add-name" className="text-xs text-slate-300">
                Nama Lengkap <span className="text-red-400">*</span>
              </Label>
              <Input
                id="add-name"
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="Nama crew"
                className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-email" className="text-xs text-slate-300">
                Email <span className="text-red-400">*</span>
              </Label>
              <Input
                id="add-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                placeholder="crew@email.com"
                className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-password" className="text-xs text-slate-300">
                Password <span className="text-red-400">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="add-password"
                  type={formData.showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Minimal 8 karakter"
                  className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 h-9 text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, showPassword: !p.showPassword }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {formData.showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {formData.password && formData.password.length < 8 && (
                <p className="text-[11px] text-red-400">Password minimal 8 karakter</p>
              )}
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAddOpen(false)}
              disabled={saving}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleAdd}
              disabled={saving || !formData.name.trim() || !formData.email.trim() || formData.password.length < 8}
              className="theme-bg hover:theme-hover text-white h-8 text-xs"
            >
              {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Tambah Crew
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Edit Crew Dialog */}
      <ResponsiveDialog open={editOpen} onOpenChange={setEditOpen}>
        <ResponsiveDialogContent className="p-4 max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-semibold text-white">
              Edit Data Crew
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-slate-400 text-xs">
              Ubah data crew. Biarkan password kosong jika tidak ingin mengubah.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name" className="text-xs text-slate-300">
                Nama Lengkap <span className="text-red-400">*</span>
              </Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="Nama crew"
                className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-email" className="text-xs text-slate-300">
                Email <span className="text-red-400">*</span>
              </Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                placeholder="crew@email.com"
                className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-password" className="text-xs text-slate-300">
                Password Baru <span className="text-slate-500">(opsional)</span>
              </Label>
              <div className="relative">
                <Input
                  id="edit-password"
                  type={formData.showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Kosongkan jika tidak ingin ubah"
                  className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 h-9 text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, showPassword: !p.showPassword }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {formData.showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {formData.password && formData.password.length < 8 && (
                <p className="text-[11px] text-red-400">Password minimal 8 karakter</p>
              )}
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setEditOpen(false)
                setEditCrew(null)
              }}
              disabled={saving}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleEdit}
              disabled={saving || !formData.name.trim() || !formData.email.trim() || (formData.password.length > 0 && formData.password.length < 8)}
              className="theme-bg hover:theme-hover text-white h-8 text-xs"
            >
              {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Simpan Perubahan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-nebula border-white/[0.06] max-w-sm p-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-sm font-semibold">
              Hapus Crew
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              Apakah Anda yakin ingin menghapus crew ini? Semua data hak akses crew akan dihapus. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] h-8 text-xs"
            >
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs border-0"
            >
              {deleting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ==================== CREW ACCESS TAB (moved from Settings) ====================

const SECTION_META: Record<string, { color: string; bg: string; border: string; icon: React.ReactNode }> = {
  Utama: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
  Operasional: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: <ShoppingCart className="h-3.5 w-3.5" /> },
  Manajemen: { color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', icon: <Shield className="h-3.5 w-3.5" /> },
}

const PAGE_ICONS: Record<string, React.ReactNode> = {
  dashboard: <LayoutDashboard className="h-3.5 w-3.5" />,
  products: <Package className="h-3.5 w-3.5" />,
  customers: <UserCircle className="h-3.5 w-3.5" />,
  pos: <Receipt className="h-3.5 w-3.5" />,
  transactions: <FileText className="h-3.5 w-3.5" />,
  purchase: <Truck className="h-3.5 w-3.5" />,
  transfer: <Layers className="h-3.5 w-3.5" />,
  'audit-log': <FileText className="h-3.5 w-3.5" />,
  settings: <Settings className="h-3.5 w-3.5" />,
  crew: <Users className="h-3.5 w-3.5" />,
}

const AVATAR_COLORS = [
  'bg-cyan-500/20 text-cyan-300',
  'bg-rose-500/20 text-rose-300',
  'bg-amber-500/20 text-amber-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-violet-500/20 text-violet-300',
  'bg-pink-500/20 text-pink-300',
]

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('')
}

function CrewAccessTab() {
  const [permissions, setPermissions] = useState<CrewPermission[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const sections = ['Utama', 'Operasional', 'Manajemen'] as const

  const fetchPermissions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/permissions')
      if (res.ok) {
        const data = await res.json()
        setPermissions(data.permissions || [])
      } else {
        toast.error('Gagal memuat hak akses crew')
      }
    } catch {
      toast.error('Gagal memuat hak akses crew')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPermissions()
  }, [fetchPermissions])

  const handleTogglePage = async (userId: string, pageKey: string, currentlyChecked: boolean) => {
    const crew = permissions.find((p) => p.userId === userId)
    if (!crew) return

    const pagesList = crew.pages.split(',').filter(Boolean)
    const updated = currentlyChecked
      ? pagesList.filter((p) => p !== pageKey)
      : [...pagesList, pageKey]

    if (updated.length === 0) {
      toast.error('Minimal satu halaman harus diaktifkan')
      return
    }

    // Optimistic update
    setPermissions((prev) =>
      prev.map((p) =>
        p.userId === userId ? { ...p, pages: updated.join(',') } : p
      )
    )

    setSavingId(userId)
    try {
      const res = await fetch(`/api/settings/permissions/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: updated.join(',') }),
      })
      if (res.ok) {
        toast.success(`Hak akses ${crew.userName} berhasil diperbarui`)
      } else {
        setPermissions((prev) =>
          prev.map((p) =>
            p.userId === userId ? { ...p, pages: crew.pages } : p
          )
        )
        toast.error('Gagal memperbarui hak akses')
      }
    } catch {
      setPermissions((prev) =>
        prev.map((p) =>
          p.userId === userId ? { ...p, pages: crew.pages } : p
        )
      )
      toast.error('Gagal memperbarui hak akses')
    } finally {
      setSavingId(null)
    }
  }

  const handleToggleSection = async (userId: string, sectionName: string) => {
    const crew = permissions.find((p) => p.userId === userId)
    if (!crew) return

    const pagesList = crew.pages.split(',').filter(Boolean)
    const sectionKeys = AVAILABLE_PAGES.filter((p) => p.section === sectionName).map((p) => p.key)
    const allGranted = sectionKeys.every((k) => pagesList.includes(k))
    const updated = allGranted
      ? pagesList.filter((p) => !sectionKeys.includes(p))
      : [...new Set([...pagesList, ...sectionKeys])]

    if (updated.length === 0) {
      toast.error('Minimal satu halaman harus diaktifkan')
      return
    }

    const prevPages = crew.pages
    setPermissions((prev) =>
      prev.map((p) =>
        p.userId === userId ? { ...p, pages: updated.join(',') } : p
      )
    )

    setSavingId(userId)
    try {
      const res = await fetch(`/api/settings/permissions/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: updated.join(',') }),
      })
      if (res.ok) {
        toast.success(`Akses ${sectionName} untuk ${crew.userName} ${allGranted ? 'dicabut' : 'diberikan'}`)
      } else {
        setPermissions((prev) =>
          prev.map((p) =>
            p.userId === userId ? { ...p, pages: prevPages } : p
          )
        )
        toast.error('Gagal memperbarui hak akses')
      }
    } catch {
      setPermissions((prev) =>
        prev.map((p) =>
          p.userId === userId ? { ...p, pages: prevPages } : p
        )
      )
      toast.error('Gagal memperbarui hak akses')
    } finally {
      setSavingId(null)
    }
  }

  // ---- Loading State ----
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-40 bg-white/[0.04]" />
            <Skeleton className="h-3.5 w-60 bg-white/[0.04]" />
          </div>
          <Skeleton className="h-8 w-8 rounded-lg bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 bg-white/[0.04] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 bg-white/[0.04] rounded-xl" />
      </div>
    )
  }

  // ---- Empty State ----
  if (permissions.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 theme-text" />
              Hak Akses Crew
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Kelola halaman yang dapat diakses oleh setiap crew</p>
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] py-16 px-6 flex flex-col items-center justify-center text-center">
          {/* Illustration */}
          <div className="relative mb-5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500/[0.08] to-purple-500/[0.05] border border-violet-500/[0.1] flex items-center justify-center">
              <Users className="h-9 w-9 text-violet-500/40" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/70" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-300">Belum ada crew</p>
          <p className="text-xs text-slate-500 mt-1.5 max-w-[260px] leading-relaxed">
            Tambahkan crew di tab <span className="text-slate-300 font-medium">Daftar Crew</span> terlebih dahulu, lalu atur hak aksesnya di sini.
          </p>
        </div>
      </div>
    )
  }

  // ---- Main Content ----
  const totalCrew = permissions.length
  const avgPages = Math.round(permissions.reduce((sum, p) => sum + p.pages.split(',').filter(Boolean).length, 0) / totalCrew)
  const allPagesGranted = AVAILABLE_PAGES.length * totalCrew
  const grantedCount = permissions.reduce((sum, p) => sum + p.pages.split(',').filter(Boolean).length, 0)
  const coveragePct = Math.round((grantedCount / allPagesGranted) * 100)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 theme-text" />
              Hak Akses Crew
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Kelola halaman yang dapat diakses oleh setiap crew</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void fetchPermissions()}
            className="h-8 w-8 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.06] text-slate-400 hover:text-slate-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-md bg-theme-ultra-light flex items-center justify-center">
                <Users className="h-3.5 w-3.5 theme-text" />
              </div>
              <span className="text-[11px] text-slate-500 font-medium">Total Crew</span>
            </div>
            <p className="text-xl font-bold text-white leading-none">{totalCrew}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <span className="text-[11px] text-slate-500 font-medium">Rata-rata Akses</span>
            </div>
            <p className="text-xl font-bold text-white leading-none">{avgPages}<span className="text-xs font-normal text-slate-500 ml-1">/ {AVAILABLE_PAGES.length}</span></p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-6 h-6 rounded-md bg-amber-500/10 flex items-center justify-center">
                <Shield className="h-3.5 w-3.5 text-amber-400" />
              </div>
              <span className="text-[11px] text-slate-500 font-medium">Cakupan</span>
            </div>
            <p className="text-xl font-bold text-white leading-none">{coveragePct}<span className="text-xs font-normal text-slate-500 ml-0.5">%</span></p>
          </div>
        </div>

        {/* Permission Matrix - Desktop */}
        <div className="hidden md:block rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          <ScrollArea className="w-full">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="sticky left-0 z-10 bg-[#0F172A] text-left px-4 py-3 w-[220px] min-w-[220px]">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Crew</span>
                  </th>
                  {sections.map((section) => {
                    const meta = SECTION_META[section]
                    const colSpan = AVAILABLE_PAGES.filter((p) => p.section === section).length
                    return (
                      <th
                        key={section}
                        colSpan={colSpan}
                        className={`${meta.bg} border-x border-white/[0.06] px-3 py-2.5`}
                      >
                        <div className={`flex items-center gap-1.5 ${meta.color}`}>
                          {meta.icon}
                          <span className="text-[11px] font-semibold uppercase tracking-wider">{section}</span>
                        </div>
                      </th>
                    )
                  })}
                  <th className="px-3 py-2.5 w-[60px]">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total</span>
                  </th>
                </tr>
                <tr className="border-b border-white/[0.06]">
                  <th className="sticky left-0 z-10 bg-[#0F172A] px-4 py-2">
                    <span className="text-[10px] text-slate-600">Halaman</span>
                  </th>
                  {sections.map((section) => {
                    const sectionPages = AVAILABLE_PAGES.filter((p) => p.section === section)
                    return sectionPages.map((page) => (
                      <th
                        key={page.key}
                        className="px-2 py-2 text-center"
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[10px] text-slate-500 leading-tight block">{page.label}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="bg-slate-800 border-white/[0.08] text-xs">
                            <span className="flex items-center gap-1.5">
                              <span className={SECTION_META[section].color}>{PAGE_ICONS[page.key]}</span>
                              {page.label}
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      </th>
                    ))
                  })}
                  <th className="px-3 py-2">
                    <span className="text-[10px] text-slate-600">%</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((crew, idx) => {
                  const crewPages = crew.pages.split(',').filter(Boolean)
                  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length]
                  const pct = Math.round((crewPages.length / AVAILABLE_PAGES.length) * 100)
                  const isSaving = savingId === crew.userId

                  return (
                    <tr
                      key={crew.userId}
                      className={`border-b border-white/[0.04] last:border-0 transition-colors ${isSaving ? 'bg-theme-ultra-light' : 'hover:bg-white/[0.02]'}`}
                    >
                      <td className="sticky left-0 z-10 bg-[#0F172A] px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${avatarColor}`}>
                            {getInitials(crew.userName)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-200 truncate max-w-[120px]">{crew.userName}</p>
                            <p className="text-[10px] text-slate-500 truncate max-w-[120px]">{crew.userEmail}</p>
                          </div>
                          {isSaving && <Loader2 className="h-3 w-3 animate-spin theme-text shrink-0" />}
                        </div>
                      </td>
                      {sections.map((section) => {
                        const sectionPages = AVAILABLE_PAGES.filter((p) => p.section === section)
                        return sectionPages.map((page) => {
                          const isChecked = crewPages.includes(page.key)
                          return (
                            <td key={page.key} className="px-2 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleTogglePage(crew.userId, page.key, isChecked)}
                                disabled={!!savingId}
                                className={`w-7 h-7 rounded-md border transition-all inline-flex items-center justify-center ${
                                  isChecked
                                    ? 'bg-theme-subtle border-theme/30 text-theme hover:bg-theme-medium'
                                    : 'bg-transparent border-white/[0.06] text-transparent hover:border-white/[0.12] hover:text-slate-600'
                                } ${savingId ? 'pointer-events-none' : 'cursor-pointer'}`}
                              >
                                {isChecked && <CheckCircle2 className="h-3.5 w-3.5" />}
                              </button>
                            </td>
                          )
                        })
                      })}
                      <td className="px-3 py-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-semibold px-1.5 py-0 h-5 rounded-md ${
                            pct === 100
                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                              : pct >= 50
                              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                              : 'bg-white/[0.04] border-white/[0.08] text-slate-400'
                          }`}
                        >
                          {pct}%
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ScrollArea>
        </div>

        {/* Permission Matrix - Mobile (Card per crew) */}
        <div className="md:hidden space-y-3">
          {permissions.map((crew, idx) => {
            const crewPages = crew.pages.split(',').filter(Boolean)
            const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length]
            const pct = Math.round((crewPages.length / AVAILABLE_PAGES.length) * 100)
            const isSaving = savingId === crew.userId

            return (
              <div
                key={crew.userId}
                className={`rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden transition-colors ${isSaving ? 'ring-1 ring-theme/20' : ''}`}
              >
                {/* Crew Header */}
                <div className="px-4 py-3 flex items-center gap-3 border-b border-white/[0.04]">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${avatarColor}`}>
                    {getInitials(crew.userName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-200 truncate">{crew.userName}</p>
                    <p className="text-[11px] text-slate-500 truncate">{crew.userEmail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin theme-text" />}
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-semibold px-1.5 py-0 h-5 rounded-md ${
                        pct === 100
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : pct >= 50
                          ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                          : 'bg-white/[0.04] border-white/[0.08] text-slate-400'
                      }`}
                    >
                      {crewPages.length}/{AVAILABLE_PAGES.length}
                    </Badge>
                  </div>
                </div>

                {/* Section Groups */}
                <div className="p-3 space-y-3">
                  {sections.map((section) => {
                    const meta = SECTION_META[section]
                    const sectionPages = AVAILABLE_PAGES.filter((p) => p.section === section)
                    const sectionKeys = sectionPages.map((p) => p.key)
                    const allGranted = sectionKeys.every((k) => crewPages.includes(k))
                    const someGranted = sectionKeys.some((k) => crewPages.includes(k))

                    return (
                      <div key={section} className="space-y-2">
                        {/* Section Header with toggle */}
                        <div className="flex items-center justify-between">
                          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md ${meta.bg}`}>
                            <span className={meta.color}>{meta.icon}</span>
                            <span className={`text-[11px] font-semibold uppercase tracking-wider ${meta.color}`}>{section}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleToggleSection(crew.userId, section)}
                            disabled={!!savingId}
                            className={`text-[10px] font-medium px-2 py-1 rounded-md transition-colors ${
                              allGranted
                                ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                : someGranted
                                ? 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                                : 'bg-white/[0.04] text-slate-500 hover:bg-white/[0.06]'
                            } ${savingId ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
                          >
                            {allGranted ? 'Semua Aktif' : someGranted ? 'Sebagian' : 'Tidak Ada'}
                          </button>
                        </div>
                        {/* Page checkboxes */}
                        <div className="grid grid-cols-2 gap-1.5">
                          {sectionPages.map((page) => {
                            const isChecked = crewPages.includes(page.key)
                            return (
                              <button
                                key={page.key}
                                type="button"
                                onClick={() => handleTogglePage(crew.userId, page.key, isChecked)}
                                disabled={!!savingId}
                                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all ${
                                  isChecked
                                    ? 'bg-theme-ultra-light border-theme/20 text-slate-200'
                                    : 'bg-transparent border-white/[0.04] text-slate-500 hover:bg-white/[0.03] hover:text-slate-400'
                                } ${savingId ? 'pointer-events-none' : 'cursor-pointer'}`}
                              >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${
                                  isChecked
                                    ? 'bg-theme border-theme'
                                    : 'border-white/[0.12]'
                                }`}>
                                  {isChecked && <CheckCircle2 className="h-3 w-3 text-white" />}
                                </div>
                                <span className="text-[11px] font-medium truncate">{page.label}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer hint */}
        <p className="text-[10px] text-slate-600 text-center pb-1">
          Klik tombol akses untuk mengaktifkan/menonaktifkan halaman. Perubahan disimpan otomatis.
        </p>
      </div>
    </TooltipProvider>
  )
}
