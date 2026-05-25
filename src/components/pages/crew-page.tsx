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
import { Checkbox } from '@/components/ui/checkbox'
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
  Search,
  Users,
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
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'products', label: 'Produk' },
  { key: 'customers', label: 'Pelanggan' },
  { key: 'pos', label: 'POS' },
  { key: 'transactions', label: 'Transaksi' },
  { key: 'audit-log', label: 'Audit Log' },
  { key: 'settings', label: 'Pengaturan' },
]

// ==================== MAIN COMPONENT ====================

export default function CrewPage() {
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'

  if (!isOwner) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Kelola Crew</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Manage cashier accounts and access</p>
        </div>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-6 text-center">
            <Shield className="h-10 w-10 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-400">Akses Terbatas</p>
            <p className="text-xs text-zinc-500 mt-1">Hanya pemilik (OWNER) yang dapat mengelola crew</p>
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
    fetchCrew()
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
          <h1 className="text-lg font-semibold text-zinc-100">Kelola Crew</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Tambah dan kelola akun kasir untuk outlet Anda</p>
        </div>
        {activeTab === 'crew-list' && (
          <Button
            onClick={() => {
              setFormData(DEFAULT_FORM)
              setAddOpen(true)
            }}
            className="bg-emerald-500 hover:bg-emerald-600 text-white h-8 text-xs"
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
              className="flex items-center gap-2 px-3 py-2.5 sm:py-2 rounded-lg text-xs font-medium whitespace-nowrap data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400 data-[state=active]:shadow-sm data-[state=active]:shadow-emerald-500/10 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 transition-all duration-150 border border-transparent data-[state=active]:border-emerald-500/20 data-[state=active]:shadow-none"
            >
              <Users className="h-4 w-4" />
              Daftar Crew
            </TabsTrigger>
            <TabsTrigger
              value="crew-permissions"
              className="flex items-center gap-2 px-3 py-2.5 sm:py-2 rounded-lg text-xs font-medium whitespace-nowrap data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400 data-[state=active]:shadow-sm data-[state=active]:shadow-emerald-500/10 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 transition-all duration-150 border border-transparent data-[state=active]:border-emerald-500/20 data-[state=active]:shadow-none"
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
            <Input
              placeholder="Cari nama atau email crew..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 sm:h-10 text-xs bg-zinc-900 border-zinc-800 text-zinc-100 placeholder:text-zinc-500 w-full"
            />
          </div>

          {/* Content */}
          {loading ? (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 bg-zinc-800 rounded-lg" />
                ))}
              </CardContent>
            </Card>
          ) : filteredCrew.length === 0 ? (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-8 text-center">
                <Users className="h-10 w-10 text-zinc-700 mx-auto mb-2" />
                <p className="text-sm text-zinc-400">
                  {search ? 'Tidak ada crew yang cocok dengan pencarian' : 'Belum ada crew'}
                </p>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  {search
                    ? 'Coba kata kunci lain'
                    : 'Tambahkan crew untuk membantu mengelola kasir outlet'
                  }
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4">
                <div className="rounded-lg border border-zinc-800 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-zinc-500 text-[11px] font-medium">Crew</TableHead>
                        <TableHead className="text-zinc-500 text-[11px] font-medium hidden sm:table-cell">Email</TableHead>
                        <TableHead className="text-zinc-500 text-[11px] font-medium text-center">Role</TableHead>
                        <TableHead className="text-zinc-500 text-[11px] font-medium text-center">Halaman Akses</TableHead>
                        <TableHead className="text-zinc-500 text-[11px] font-medium hidden lg:table-cell">Bergabung</TableHead>
                        <TableHead className="text-zinc-500 text-[11px] font-medium text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCrew.map((member) => {
                        const pages = member.crewPermission?.pages?.split(',').filter(Boolean) || []
                        return (
                          <TableRow key={member.id} className="border-zinc-800 hover:bg-zinc-800/50">
                            <TableCell className="py-2.5 px-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                                  <UserCog className="h-4 w-4 text-zinc-400" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-zinc-200 truncate">{member.name}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5 px-3 hidden sm:table-cell">
                              <div className="flex items-center gap-1.5">
                                <Mail className="h-3 w-3 text-zinc-500 shrink-0" />
                                <span className="text-xs text-zinc-400 truncate">{member.email}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-3">
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-zinc-800 border-zinc-700 text-zinc-400"
                              >
                                {member.role}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-3">
                              <div className="flex flex-wrap justify-center gap-1">
                                {pages.length > 0 ? (
                                  pages.map((p) => (
                                    <Badge
                                      key={p}
                                      className="text-[10px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400 px-1.5 py-0"
                                    >
                                      {p}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-[10px] text-zinc-600">Default (POS)</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5 px-3 hidden lg:table-cell">
                              <div className="flex items-center gap-1.5">
                                <Calendar className="h-3 w-3 text-zinc-500" />
                                <span className="text-xs text-zinc-400">{formatDate(member.createdAt)}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right py-2.5 px-3">
                              <div className="flex items-center justify-end gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                                  onClick={() => openEdit(member)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                                  onClick={() => setDeleteId(member.id)}
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

                {/* Crew count */}
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] text-zinc-500">
                    {filteredCrew.length} crew ditampilkan
                    {search && ` dari ${crew.length} total`}
                  </p>
                </div>
              </CardContent>
            </Card>
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
            <ResponsiveDialogTitle className="text-sm font-semibold text-zinc-100">
              Tambah Crew Baru
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-zinc-400 text-xs">
              Tambahkan akun kasir baru untuk outlet Anda. Crew dapat login dan menggunakan POS sesuai hak akses.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="add-name" className="text-xs text-zinc-300">
                Nama Lengkap <span className="text-red-400">*</span>
              </Label>
              <Input
                id="add-name"
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="Nama crew"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-email" className="text-xs text-zinc-300">
                Email <span className="text-red-400">*</span>
              </Label>
              <Input
                id="add-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                placeholder="crew@email.com"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-password" className="text-xs text-zinc-300">
                Password <span className="text-red-400">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="add-password"
                  type={formData.showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Minimal 8 karakter"
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, showPassword: !p.showPassword }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
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
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleAdd}
              disabled={saving || !formData.name.trim() || !formData.email.trim() || formData.password.length < 8}
              className="bg-emerald-500 hover:bg-emerald-600 text-white h-8 text-xs"
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
            <ResponsiveDialogTitle className="text-sm font-semibold text-zinc-100">
              Edit Data Crew
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-zinc-400 text-xs">
              Ubah data crew. Biarkan password kosong jika tidak ingin mengubah.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name" className="text-xs text-zinc-300">
                Nama Lengkap <span className="text-red-400">*</span>
              </Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="Nama crew"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-email" className="text-xs text-zinc-300">
                Email <span className="text-red-400">*</span>
              </Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                placeholder="crew@email.com"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-password" className="text-xs text-zinc-300">
                Password Baru <span className="text-zinc-500">(opsional)</span>
              </Label>
              <div className="relative">
                <Input
                  id="edit-password"
                  type={formData.showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Kosongkan jika tidak ingin ubah"
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, showPassword: !p.showPassword }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
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
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
            >
              Batal
            </Button>
            <Button
              onClick={handleEdit}
              disabled={saving || !formData.name.trim() || !formData.email.trim() || (formData.password.length > 0 && formData.password.length < 8)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white h-8 text-xs"
            >
              {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Simpan Perubahan
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800 max-w-sm p-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100 text-sm font-semibold">
              Hapus Crew
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs">
              Apakah Anda yakin ingin menghapus crew ini? Semua data hak akses crew akan dihapus. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
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

function CrewAccessTab() {
  const [permissions, setPermissions] = useState<CrewPermission[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

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
    fetchPermissions()
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
        // Revert on failure
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

  if (loading) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-36 bg-zinc-800" />
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 bg-zinc-800 rounded-lg" />
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Hak Akses Crew</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Kelola halaman yang dapat diakses oleh setiap crew</p>
        </div>

        {permissions.length === 0 ? (
          <div className="py-8 text-center">
            <Users className="h-10 w-10 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">Belum ada crew</p>
            <p className="text-[11px] text-zinc-600 mt-0.5">Crew akan muncul setelah terdaftar di outlet</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {permissions.map((crew) => {
              const crewPages = crew.pages.split(',').filter(Boolean)
              return (
                <div
                  key={crew.userId}
                  className="rounded-lg border border-zinc-800 bg-zinc-800/50 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <Users className="h-4 w-4 text-zinc-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-200">{crew.userName}</p>
                      <p className="text-[11px] text-zinc-500">{crew.userEmail}</p>
                    </div>
                    {savingId === crew.userId && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {AVAILABLE_PAGES.map((page) => {
                      const isChecked = crewPages.includes(page.key)
                      return (
                        <label
                          key={page.key}
                          className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer hover:text-zinc-200 transition-colors"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => handleTogglePage(crew.userId, page.key, isChecked)}
                            className="data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                          />
                          {page.label}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
