'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
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
import { usePlan } from '@/hooks/use-plan'
import { PLANS, getPlanLabel, getPlanBadgeClass, formatLimit, isUnlimited, type AccountType } from '@/lib/plan-config'
import { ProGate } from '@/components/shared/pro-gate'
import {
  Banknote,
  QrCode,
  CreditCard,
  ArrowRightLeft,
  Store,
  Star,
  Tag,
  Palette,
  Receipt,
  ReceiptText,
  Save,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Check,
  Crown,
  Zap,
  X,
  ArrowUpRight,
  Send,
  KeyRound,
  Building2,
  Eye,
  EyeOff,
  Wifi,
  WifiOff,
  Link2,
  Unlink2,
  CircleHelp,
  ExternalLink,
  MessageSquare,
  UserCircle,
  Bot,
} from 'lucide-react'

// ==================== TYPES ====================

interface SettingsData {
  id: string
  outletId: string
  paymentMethods: string
  loyaltyEnabled: boolean
  loyaltyPointsPerAmount: number
  loyaltyPointValue: number
  receiptBusinessName: string
  receiptAddress: string
  receiptPhone: string
  receiptFooter: string
  receiptLogo: string
  themePrimaryColor: string
  ppnEnabled: boolean
  ppnRate: number
  telegramChatId: string | null
  telegramBotToken: string | null
  notifyOnTransaction: boolean
  notifyOnCustomer: boolean
  notifyDailyReport: boolean
  notifyWeeklyReport: boolean
  notifyMonthlyReport: boolean
  notifyOnInsight: boolean
  outlet?: { id: string; name: string; address: string | null; phone: string | null }
}

interface Promo {
  id: string
  name: string
  type: string
  value: number
  minPurchase: number | null
  maxDiscount: number | null
  active: boolean
  buyMinQty: number
  discountType: string
  categoryId: string | null
  categoryName?: string | null
}

interface PromoFormData {
  name: string
  type: string
  value: string
  minPurchase: string
  maxDiscount: string
  active: boolean
  buyMinQty: string
  discountType: string
  categoryId: string
}

const DEFAULT_PROMO_FORM: PromoFormData = {
  name: '',
  type: 'PERCENTAGE',
  value: '',
  minPurchase: '',
  maxDiscount: '',
  active: true,
  buyMinQty: '2',
  discountType: 'PERCENTAGE',
  categoryId: '__all__',
}

const THEME_COLORS = [
  { name: 'emerald', label: 'Emerald', classes: 'bg-emerald-500' },
  { name: 'blue', label: 'Biru', classes: 'bg-blue-500' },
  { name: 'violet', label: 'Violet', classes: 'bg-violet-500' },
  { name: 'rose', label: 'Rose', classes: 'bg-rose-500' },
  { name: 'amber', label: 'Amber', classes: 'bg-amber-500' },
  { name: 'cyan', label: 'Cyan', classes: 'bg-cyan-500' },
]

// ==================== MAIN COMPONENT ====================

export default function SettingsPage() {
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Pengaturan</h1>
        <p className="text-xs text-zinc-400 mt-0.5">Konfigurasi outlet dan preferensi sistem</p>
      </div>

      <SettingsTabs isOwner={isOwner} />
    </div>
  )
}

// ==================== TABS WRAPPER ====================

function SettingsTabs({ isOwner }: { isOwner: boolean }) {
  const [activeTab, setActiveTab] = useState('plan')

  const tabs = [
    { value: 'plan', label: 'Plan & Langganan', icon: <Crown className="h-4 w-4" /> },
    { value: 'outlet', label: 'Outlet & Struk', icon: <Store className="h-4 w-4" /> },
    ...(isOwner ? [{ value: 'kasir', label: 'Pembayaran & Promo', icon: <Banknote className="h-4 w-4" /> }] : [{ value: 'kasir', label: 'Kasir', icon: <Banknote className="h-4 w-4" /> }]),
    ...(isOwner ? [{ value: 'telegram', label: 'Telegram', icon: <Send className="h-4 w-4" /> }] : []),
    { value: 'account', label: 'Akun', icon: <KeyRound className="h-4 w-4" /> },
  ]

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      {/* Horizontal scrollable tab bar - no scrollbar */}
      <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
        <TabsList className="inline-flex h-auto w-max gap-1 bg-transparent p-0">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="theme-tab-trigger flex items-center gap-2 px-3 py-2.5 sm:py-2 rounded-lg text-xs font-medium whitespace-nowrap text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/80 transition-all duration-150 border border-transparent"
            >
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="min-w-0">
        <TabsContent value="plan">
          <PlanTab />
        </TabsContent>
        <TabsContent value="outlet">
          <OutletAndReceiptTab />
          {isOwner && (
            <div className="mt-4">
              <ProGate feature="multiOutlet" label="Multi-Outlet" description="Kelola beberapa outlet dalam satu akun" minHeight="200px">
                <MultiOutletTab />
              </ProGate>
            </div>
          )}
        </TabsContent>
        <TabsContent value="kasir">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="min-w-0"><PaymentMethodsTab /></div>
            <div className="min-w-0"><LoyaltyTab /></div>
          </div>
          {isOwner && (
            <div className="space-y-4 mt-4">
              <TaxTab />
              <PromoTab />
            </div>
          )}
        </TabsContent>
        {isOwner && (
          <TabsContent value="telegram">
            <ProGate feature="apiAccess" label="Telegram Notifikasi" description="Kirim notifikasi otomatis via Telegram" minHeight="200px">
              <TelegramTab />
            </ProGate>
          </TabsContent>
        )}
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>

      </div>
    </Tabs>
  )
}

// ==================== SHARED HOOK ====================

function useSettings() {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
      } else {
        toast.error('Gagal memuat pengaturan')
      }
    } catch {
      toast.error('Gagal memuat pengaturan')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const saveSettings = useCallback(async (updates: Partial<SettingsData>) => {
    if (!settings) {
      toast.error('Pengaturan belum dimuat, silakan tunggu')
      return false
    }
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
        toast.success('Pengaturan berhasil disimpan')
        return true
      } else {
        const errData = await res.json().catch(() => ({}))
        if (res.status === 403) {
          toast.error(errData.error || 'Hanya pemilik (OWNER) yang dapat mengubah pengaturan')
        } else {
          toast.error(errData.error || 'Gagal menyimpan pengaturan')
        }
        return false
      }
    } catch {
      toast.error('Gagal menyimpan pengaturan — periksa koneksi internet')
      return false
    } finally {
      setSaving(false)
    }
  }, [settings])

  return { settings, setSettings, loading, saving, saveSettings, refetch: fetchSettings }
}

// ==================== TAB: OUTLET & RECEIPT (Combined) ====================

function OutletAndReceiptTab() {
  return (
    <div className="space-y-4">
      <OutletInfoTab />
      <ThemeReceiptTab />
    </div>
  )
}

// ==================== TAB 1: PAYMENT METHODS ====================

function PaymentMethodsTab() {
  const { settings, loading, saving, saveSettings } = useSettings()
  const [editedPaymentMethods, setEditedPaymentMethods] = useState<string | null>(null)

  const paymentMethods = [
    { key: 'CASH', label: 'Tunai (CASH)', icon: <Banknote className="h-5 w-5" />, desc: 'Pembayaran tunai langsung' },
    { key: 'QRIS', label: 'QRIS', icon: <QrCode className="h-5 w-5" />, desc: 'Scan QR untuk pembayaran' },
    { key: 'DEBIT', label: 'Debit/Credit', icon: <CreditCard className="h-5 w-5" />, desc: 'Kartu debit atau kredit' },
    { key: 'TRANSFER', label: 'Transfer Bank', icon: <ArrowRightLeft className="h-5 w-5" />, desc: 'Transfer via mobile banking / ATM' },
  ]

  const currentPaymentMethods = editedPaymentMethods ?? settings?.paymentMethods ?? 'CASH,QRIS'
  const currentEnabled = currentPaymentMethods.split(',').filter(Boolean)

  const handleToggle = (key: string) => {
    const isActive = currentEnabled.includes(key)
    const updated = isActive
      ? currentEnabled.filter((m) => m !== key)
      : [...currentEnabled, key]
    if (updated.length === 0) {
      toast.error('Minimal satu metode pembayaran harus aktif')
      return
    }
    setEditedPaymentMethods(updated.join(','))
  }

  const handleSave = async () => {
    if (!settings) {
      toast.error('Pengaturan belum dimuat, silakan tunggu')
      return
    }
    const ok = await saveSettings({ paymentMethods: currentPaymentMethods })
    if (ok) {
      setEditedPaymentMethods(null)
    }
  }

  if (loading) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-36 bg-zinc-800" />
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 bg-zinc-800 rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Metode Pembayaran</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Pilih metode pembayaran yang tersedia di outlet Anda</p>
        </div>

        <div className="grid gap-3">
          {paymentMethods.map((method) => {
            const isActive = currentEnabled.includes(method.key)
            return (
              <div
                key={method.key}
                role="button"
                tabIndex={0}
                onClick={() => handleToggle(method.key)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(method.key) } }}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                  isActive
                    ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10'
                    : 'border-zinc-800 bg-zinc-800/50 hover:bg-zinc-800'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                }`}>
                  {method.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isActive ? 'text-emerald-400' : 'text-zinc-300'}`}>
                    {method.label}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">{method.desc}</p>
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={() => handleToggle(method.key)}
                  onClick={(e) => e.stopPropagation()}
                  className="theme-switch"
                />
              </div>
            )
          })}
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="theme-btn-primary h-9 text-xs"
          >
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Simpan
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ==================== TAB 2: TAX / PPN ====================

function TaxTab() {
  const { settings, loading, saving, saveSettings } = useSettings()
  const [edits, setEdits] = useState<Record<string, string | boolean> | null>(null)

  const ppnEnabled = edits?.ppnEnabled ?? settings?.ppnEnabled ?? false
  const ppnRate = edits?.ppnRate ?? (settings ? String(settings.ppnRate) : '11')
  const dirty = edits !== null

  const handleChange = (key: string, value: string | boolean) => {
    setEdits((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!settings) {
      toast.error('Pengaturan belum dimuat, silakan tunggu')
      return
    }
    const ok = await saveSettings({
      ppnEnabled: ppnEnabled as boolean,
      ppnRate: Number(ppnRate),
    })
    if (ok) setEdits(null)
  }

  // Example calculation
  const rate = Number(ppnRate) || 11
  const exampleSubtotal = 100000
  const exampleTax = Math.round(exampleSubtotal * rate / 100)
  const exampleTotal = exampleSubtotal + exampleTax

  if (loading) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-36 bg-zinc-800" />
          <Skeleton className="h-16 bg-zinc-800 rounded-lg" />
          <Skeleton className="h-9 bg-zinc-800" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Pajak PPN</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Atur Pajak Pertambahan Nilai untuk transaksi</p>
        </div>

        {/* Enable toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-800/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <ReceiptText className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200">Aktifkan PPN</p>
              <p className="text-[11px] text-zinc-500">Pajak otomatis ditambahkan ke setiap transaksi</p>
            </div>
          </div>
          <Switch
            checked={ppnEnabled}
            onCheckedChange={(v) => handleChange('ppnEnabled', v)}
            className="theme-switch"
          />
        </div>

        {ppnEnabled && (
          <>
            <Separator className="bg-zinc-800" />

            <div className="space-y-1.5">
              <Label htmlFor="ppn-rate" className="text-xs text-zinc-300">
                Tarif PPN (%)
              </Label>
              <div className="relative">
                <Input
                  id="ppn-rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={ppnRate}
                  onChange={(e) => handleChange('ppnRate', e.target.value)}
                  placeholder="11"
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">%</span>
              </div>
              <p className="text-[10px] text-zinc-600">Tarif PPN standar Indonesia: 11%</p>
            </div>

            {/* Example formula */}
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <p className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider mb-1.5">Contoh Perhitungan</p>
              <div className="space-y-1 text-xs text-zinc-300">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-medium">{formatCurrency(exampleSubtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>PPN ({rate}%)</span>
                  <span className="font-medium text-emerald-400">+{formatCurrency(exampleTax)}</span>
                </div>
                <div className="flex justify-between border-t border-emerald-500/20 pt-1 mt-1">
                  <span className="font-semibold text-zinc-200">Total</span>
                  <span className="font-bold text-emerald-300">{formatCurrency(exampleTotal)}</span>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="theme-btn-primary h-9 text-xs"
          >
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Simpan
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ==================== TAB 3: OUTLET INFO ====================

function OutletInfoTab() {
  const { settings, loading, saving, saveSettings, refetch } = useSettings()
  const [edits, setEdits] = useState<Record<string, string> | null>(null)

  const outletName = edits?.outletName ?? settings?.outlet?.name ?? ''
  const outletAddress = edits?.outletAddress ?? settings?.outlet?.address ?? ''
  const outletPhone = edits?.outletPhone ?? settings?.outlet?.phone ?? ''
  const dirty = edits !== null

  const handleChange = (key: string, value: string) => {
    setEdits((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!settings) {
      toast.error('Pengaturan belum dimuat, silakan tunggu')
      return
    }
    const ok = await saveSettings({
      outletName,
      outletAddress,
      outletPhone,
    })
    if (ok) {
      setEdits(null)
      refetch()
    }
  }

  if (loading) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-36 bg-zinc-800" />
          <Skeleton className="h-9 bg-zinc-800" />
          <Skeleton className="h-9 bg-zinc-800" />
          <Skeleton className="h-9 bg-zinc-800" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Informasi Outlet</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Detail informasi usaha Anda</p>
        </div>

        <div className="space-y-4">
          {/* Desktop: name + phone side by side, address full width below */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="outlet-name" className="text-xs text-zinc-300">Nama Outlet</Label>
              <Input
                id="outlet-name"
                value={outletName}
                onChange={(e) => handleChange('outletName', e.target.value)}
                placeholder="Masukkan nama outlet"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outlet-phone" className="text-xs text-zinc-300">Telepon</Label>
              <Input
                id="outlet-phone"
                value={outletPhone}
                onChange={(e) => handleChange('outletPhone', e.target.value)}
                placeholder="Masukkan nomor telepon"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="outlet-address" className="text-xs text-zinc-300">Alamat</Label>
            <Textarea
              id="outlet-address"
              value={outletAddress}
              onChange={(e) => handleChange('outletAddress', e.target.value)}
              placeholder="Masukkan alamat outlet"
              rows={2}
              className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="theme-btn-primary h-9 text-xs"
          >
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Simpan
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ==================== TAB 3: LOYALTY PROGRAM ====================

function LoyaltyTab() {
  const { settings, loading, saving, saveSettings } = useSettings()
  const [edits, setEdits] = useState<Record<string, string | boolean> | null>(null)

  const loyaltyEnabled = edits?.loyaltyEnabled ?? settings?.loyaltyEnabled ?? true
  const pointsPerAmount = edits?.pointsPerAmount ?? (settings ? String(settings.loyaltyPointsPerAmount) : '10000')
  const pointValue = edits?.pointValue ?? (settings ? String(settings.loyaltyPointValue) : '100')
  const dirty = edits !== null

  const handleChange = (key: string, value: string | boolean) => {
    setEdits((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!settings) {
      toast.error('Pengaturan belum dimuat, silakan tunggu')
      return
    }
    const ok = await saveSettings({
      loyaltyEnabled: loyaltyEnabled as boolean,
      loyaltyPointsPerAmount: Number(pointsPerAmount),
      loyaltyPointValue: Number(pointValue),
    })
    if (ok) setEdits(null)
  }

  // Calculate example
  const ppa = Number(pointsPerAmount) || 10000
  const pv = Number(pointValue) || 100
  const exampleSpend = 50000
  const examplePoints = Math.floor(exampleSpend / ppa)
  const exampleDiscount = examplePoints * pv

  if (loading) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-36 bg-zinc-800" />
          <Skeleton className="h-9 bg-zinc-800" />
          <Skeleton className="h-9 bg-zinc-800" />
          <Skeleton className="h-9 bg-zinc-800" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Program Loyalti</h2>
          <p className="text-xs text-zinc-400 mt-0.5">Konfigurasi poin loyalitas pelanggan</p>
        </div>

        {/* Enable toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-800/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Star className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200">Aktifkan Program Loyalti</p>
              <p className="text-[11px] text-zinc-500">Pelanggan mendapat poin dari setiap transaksi</p>
            </div>
          </div>
          <Switch
            checked={loyaltyEnabled}
            onCheckedChange={(v) => handleChange('loyaltyEnabled', v)}
            className="data-[state=checked]:bg-amber-500"
          />
        </div>

        {loyaltyEnabled && (
          <>
            <Separator className="bg-zinc-800" />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="points-per-amount" className="text-xs text-zinc-300">
                  Setiap Rp X = 1 poin
                </Label>
                <Input
                  id="points-per-amount"
                  type="number"
                  min="1"
                  value={pointsPerAmount}
                  onChange={(e) => handleChange('pointsPerAmount', e.target.value)}
                  placeholder="10000"
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="point-value" className="text-xs text-zinc-300">
                  1 poin = Rp X diskon
                </Label>
                <Input
                  id="point-value"
                  type="number"
                  min="1"
                  value={pointValue}
                  onChange={(e) => handleChange('pointValue', e.target.value)}
                  placeholder="100"
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                />
              </div>
            </div>

            {/* Example formula */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-[11px] font-medium text-amber-400 uppercase tracking-wider mb-1.5">Contoh Perhitungan</p>
              <p className="text-xs text-zinc-300">
                Belanja <span className="font-semibold text-amber-300">{formatCurrency(exampleSpend)}</span> ={' '}
                <span className="font-semibold text-amber-300">{examplePoints} poin</span> ={' '}
                <span className="font-semibold text-amber-300">{formatCurrency(exampleDiscount)} diskon</span>
              </p>
            </div>
          </>
        )}

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="theme-btn-primary h-9 text-xs"
          >
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Simpan
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ==================== TAB 5: PROMO / DISKON ====================

function PromoTab() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editPromo, setEditPromo] = useState<Promo | null>(null)
  const [formData, setFormData] = useState<PromoFormData>(DEFAULT_PROMO_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])

  const fetchPromos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/promos')
      if (res.ok) {
        const data = await res.json()
        setPromos(data.promos || [])
      } else {
        toast.error('Gagal memuat promo')
      }
    } catch {
      toast.error('Gagal memuat promo')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPromos()
  }, [fetchPromos])

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch('/api/categories')
        if (res.ok) {
          const data = await res.json()
          setCategories(data.categories || [])
        }
      } catch { /* silent */ }
    }
    fetchCategories()
  }, [])

  const openCreate = () => {
    setEditPromo(null)
    setFormData(DEFAULT_PROMO_FORM)
    setDialogOpen(true)
  }

  const openEdit = (promo: Promo) => {
    setEditPromo(promo)
    setFormData({
      name: promo.name,
      type: promo.type,
      value: String(promo.value),
      minPurchase: promo.minPurchase ? String(promo.minPurchase) : '',
      maxDiscount: promo.maxDiscount ? String(promo.maxDiscount) : '',
      active: promo.active,
      buyMinQty: String(promo.buyMinQty || 2),
      discountType: promo.discountType || 'PERCENTAGE',
      categoryId: promo.categoryId ? String(promo.categoryId) : '__all__',
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formData.name || !formData.value) {
      toast.error('Nama dan nilai diskon wajib diisi')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        type: formData.type,
        value: Number(formData.value),
        minPurchase: formData.minPurchase ? Number(formData.minPurchase) : null,
        maxDiscount: (formData.type === 'PERCENTAGE' || formData.type === 'BUY_X_GET_DISCOUNT') && formData.maxDiscount ? Number(formData.maxDiscount) : null,
        active: formData.active,
      }
      if (formData.type === 'BUY_X_GET_DISCOUNT') {
        payload.buyMinQty = Number(formData.buyMinQty) || 2
        payload.discountType = formData.discountType || 'PERCENTAGE'
      }
      payload.categoryId = formData.categoryId === '__all__' ? null : formData.categoryId
      const url = editPromo ? `/api/settings/promos/${editPromo.id}` : '/api/settings/promos'
      const method = editPromo ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        toast.success(editPromo ? 'Promo berhasil diperbarui' : 'Promo berhasil ditambahkan')
        setDialogOpen(false)
        fetchPromos()
      } else {
        toast.error('Gagal menyimpan promo')
      }
    } catch {
      toast.error('Gagal menyimpan promo')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/settings/promos/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Promo berhasil dihapus')
        fetchPromos()
      } else {
        toast.error('Gagal menghapus promo')
      }
    } catch {
      toast.error('Gagal menghapus promo')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Promo / Diskon</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Kelola promo dan diskon untuk pelanggan</p>
          </div>
          <Button
            onClick={openCreate}
            className="theme-btn-primary h-8 text-xs"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Tambah Promo
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 bg-zinc-800 rounded" />
            ))}
          </div>
        ) : promos.length === 0 ? (
          <div className="py-8 text-center">
            <Tag className="h-10 w-10 text-zinc-700 mx-auto mb-2" />
            <p className="text-sm text-zinc-500">Belum ada promo</p>
            <p className="text-[11px] text-zinc-600 mt-0.5">Tambahkan promo untuk menarik pelanggan</p>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-500 text-[11px] font-medium h-8">Nama</TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-medium h-8">Tipe</TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-medium h-8">Kategori</TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-medium h-8 text-right">Nilai</TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-medium h-8 text-right">Min. Belanja</TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-medium h-8 text-right">Maks Diskon</TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-medium h-8 text-center">Status</TableHead>
                  <TableHead className="text-zinc-500 text-[11px] font-medium h-8 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promos.map((promo) => (
                  <TableRow key={promo.id} className="border-zinc-800 hover:bg-zinc-800/50">
                    <TableCell className="text-xs text-zinc-200 font-medium py-2">{promo.name}</TableCell>
                    <TableCell className="py-2">
                      <Badge
                        variant="outline"
                        className={`text-[11px] ${
                          promo.type === 'PERCENTAGE'
                            ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                            : promo.type === 'BUY_X_GET_DISCOUNT'
                              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                              : 'theme-accent-bg theme-accent-border theme-accent-text'
                        }`}
                      >
                        {promo.type === 'PERCENTAGE' ? 'Persentase' : promo.type === 'BUY_X_GET_DISCOUNT' ? 'Beli N Diskon' : 'Nominal'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400 py-2">
                      {promo.categoryId ? (promo.categoryName || 'Kategori spesifik') : (
                        <span className="text-zinc-500">Semua</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-200 text-right py-2">
                      {promo.type === 'BUY_X_GET_DISCOUNT'
                        ? `${promo.buyMinQty || 2} item → ${promo.discountType === 'PERCENTAGE' ? `${promo.value}%` : formatCurrency(promo.value)}`
                        : promo.type === 'PERCENTAGE' ? `${promo.value}%` : formatCurrency(promo.value)}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400 text-right py-2">
                      {promo.minPurchase ? formatCurrency(promo.minPurchase) : '-'}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400 text-right py-2">
                      {promo.maxDiscount ? formatCurrency(promo.maxDiscount) : '-'}
                    </TableCell>
                    <TableCell className="text-center py-2">
                      <Badge
                        className={`text-[11px] ${
                          promo.active
                            ? 'theme-accent-bg theme-accent-border theme-accent-text'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-500'
                        }`}
                      >
                        {promo.active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                          onClick={() => openEdit(promo)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => setDeleteId(promo.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Promo Form Dialog */}
        <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800 p-4">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="text-sm font-semibold text-zinc-100">
                {editPromo ? 'Edit Promo' : 'Tambah Promo Baru'}
              </ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Kategori (opsional)</Label>
                <Select
                  value={formData.categoryId}
                  onValueChange={(v) => setFormData((p) => ({ ...p, categoryId: v }))}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 w-full h-9 text-sm">
                    <SelectValue placeholder="Semua Kategori" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    <SelectItem value="__all__">Semua Kategori</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-zinc-500">Kosongkan untuk berlaku ke semua kategori</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Nama Promo</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Contoh: Diskon Akhir Tahun"
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Tipe Diskon</Label>
                <Select
                  value={formData.type}
                  onValueChange={(v) => setFormData((p) => ({ ...p, type: v }))}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 w-full h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-800">
                    <SelectItem value="PERCENTAGE">Persentase (%)</SelectItem>
                    <SelectItem value="NOMINAL">Nominal (Rp)</SelectItem>
                    <SelectItem value="BUY_X_GET_DISCOUNT">Beli N Produk Diskon</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">
                  Nilai Diskon {formData.type === 'PERCENTAGE' || (formData.type === 'BUY_X_GET_DISCOUNT' && formData.discountType === 'PERCENTAGE') ? '(%)' : '(Rp)'}
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.value}
                  onChange={(e) => setFormData((p) => ({ ...p, value: e.target.value }))}
                  placeholder={formData.type === 'PERCENTAGE' ? '10' : '50000'}
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Minimum Pembayaran (opsional)</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.minPurchase}
                  onChange={(e) => setFormData((p) => ({ ...p, minPurchase: e.target.value }))}
                  placeholder="100000"
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                />
              </div>
              {(formData.type === 'PERCENTAGE' || formData.type === 'BUY_X_GET_DISCOUNT') && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-300">Maks Diskon (opsional)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.maxDiscount}
                    onChange={(e) => setFormData((p) => ({ ...p, maxDiscount: e.target.value }))}
                    placeholder="50000"
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                  />
                </div>
              )}
              {formData.type === 'BUY_X_GET_DISCOUNT' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-300">Minimal Jumlah Item</Label>
                    <Input
                      type="number"
                      min="2"
                      value={formData.buyMinQty}
                      onChange={(e) => setFormData((p) => ({ ...p, buyMinQty: e.target.value }))}
                      placeholder="2"
                      className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                    />
                    <p className="text-[10px] text-zinc-500">Minimal jumlah item di keranjang untuk mendapat diskon</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-300">Tipe Diskon</Label>
                    <Select
                      value={formData.discountType}
                      onValueChange={(v) => setFormData((p) => ({ ...p, discountType: v }))}
                    >
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 w-full h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-800">
                        <SelectItem value="PERCENTAGE">Persentase (%)</SelectItem>
                        <SelectItem value="NOMINAL">Nominal (Rp)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <div className="flex items-center gap-2.5 pt-1">
                <Switch
                  checked={formData.active}
                  onCheckedChange={(v) => setFormData((p) => ({ ...p, active: v }))}
                  className="theme-switch"
                />
                <Label className="text-xs text-zinc-300">Promo aktif</Label>
              </div>
            </div>
            <ResponsiveDialogFooter>
              <Button
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs"
              >
                Batal
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formData.name || !formData.value}
                className="theme-btn-primary h-8 text-xs"
              >
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {editPromo ? 'Perbarui' : 'Tambah'}
              </Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent className="bg-zinc-900 border-zinc-800">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-sm font-semibold text-zinc-100">Hapus Promo</AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-zinc-400">
                Apakah Anda yakin ingin menghapus promo ini? Tindakan ini tidak dapat dibatalkan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs">
                Batal
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs"
              >
                {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

// ==================== TAB 6: THEME & RECEIPT ====================

function ThemeReceiptTab() {
  const { settings, loading, saving, saveSettings } = useSettings()
  const [edits, setEdits] = useState<Record<string, string> | null>(null)

  const themeColor = edits?.themeColor ?? settings?.themePrimaryColor ?? 'emerald'
  const receiptBusinessName = edits?.receiptBusinessName ?? settings?.receiptBusinessName ?? ''
  const receiptAddress = edits?.receiptAddress ?? settings?.receiptAddress ?? ''
  const receiptPhone = edits?.receiptPhone ?? settings?.receiptPhone ?? ''
  const receiptFooter = edits?.receiptFooter ?? settings?.receiptFooter ?? ''
  const receiptLogo = edits?.receiptLogo ?? settings?.receiptLogo ?? ''
  const dirty = edits !== null

  const handleChange = (key: string, value: string) => {
    setEdits((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!settings) return
    const ok = await saveSettings({
      themePrimaryColor: themeColor,
      receiptBusinessName,
      receiptAddress,
      receiptPhone,
      receiptFooter,
      receiptLogo,
    })
    if (ok) setEdits(null)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 space-y-4">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-36 bg-zinc-800" />
                <Skeleton className="h-9 bg-zinc-800" />
              </CardContent>
            </Card>
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-40 bg-zinc-800" />
                <Skeleton className="h-9 bg-zinc-800" />
                <Skeleton className="h-9 bg-zinc-800" />
                <Skeleton className="h-9 bg-zinc-800" />
                <Skeleton className="h-9 bg-zinc-800" />
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-36 bg-zinc-800" />
                <Skeleton className="h-72 w-full bg-zinc-800 rounded-lg" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 min-w-0">
      {/* Desktop: 2-col layout — form left (3/5), preview right (2/5) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left column: Theme + Receipt Form */}
        <div className="lg:col-span-3 space-y-4 min-w-0">
          {/* Theme Section */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Tema</h2>
                <p className="text-xs text-zinc-400 mt-0.5">Kustomisasi tampilan aplikasi</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Warna tema utama</Label>
                <div className="flex items-center gap-2.5 flex-wrap">
                  {THEME_COLORS.map((color) => {
                    const isSelected = themeColor === color.name
                    return (
                      <button
                        key={color.name}
                        onClick={() => handleChange('themeColor', color.name)}
                        className={`relative w-8 h-8 rounded-full ${color.classes} flex items-center justify-center transition-colors ${
                          isSelected ? 'ring-2 ring-offset-2 ring-offset-zinc-900 ring-white/50 scale-110' : 'hover:scale-105'
                        }`}
                        title={color.label}
                      >
                        {isSelected && <Check className="h-4 w-4 text-white" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Receipt Section */}
          <Card className="bg-zinc-900 border-zinc-800 overflow-hidden">
            <CardContent className="p-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Pengaturan Struk</h2>
                <p className="text-xs text-zinc-400 mt-0.5">Informasi yang ditampilkan pada struk belanja</p>
              </div>

              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="receipt-name" className="text-xs text-zinc-300">Nama Usaha</Label>
                  <Input
                    id="receipt-name"
                    value={receiptBusinessName}
                    onChange={(e) => handleChange('receiptBusinessName', e.target.value)}
                    placeholder="Masukkan nama usaha"
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="receipt-address" className="text-xs text-zinc-300">Alamat</Label>
                  <Textarea
                    id="receipt-address"
                    value={receiptAddress}
                    onChange={(e) => handleChange('receiptAddress', e.target.value)}
                    placeholder="Masukkan alamat usaha"
                    rows={2}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 text-sm resize-none"
                  />
                </div>
                {/* Desktop: phone + footer side by side */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="receipt-phone" className="text-xs text-zinc-300">Telepon</Label>
                    <Input
                      id="receipt-phone"
                      value={receiptPhone}
                      onChange={(e) => handleChange('receiptPhone', e.target.value)}
                      placeholder="08xxxxxxxxxx"
                      className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="receipt-footer" className="text-xs text-zinc-300">Pesan Footer</Label>
                    <Input
                      id="receipt-footer"
                      value={receiptFooter}
                      onChange={(e) => handleChange('receiptFooter', e.target.value)}
                      placeholder="Terima kasih atas kunjungan Anda!"
                      className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receipt-logo" className="text-xs text-zinc-300">Logo Outlet (Image URL)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="receipt-logo"
                      value={receiptLogo}
                      onChange={(e) => handleChange('receiptLogo', e.target.value)}
                      placeholder="https://example.com/logo.png"
                      className="flex-1 min-w-0 bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
                    />
                    {receiptLogo && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0 h-9 w-9 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => handleChange('receiptLogo', '')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {receiptLogo && (
                    <div className="mt-1 flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/30">
                      <img
                        src={receiptLogo}
                        alt="Logo Preview"
                        className="h-14 w-14 rounded-lg object-contain bg-white p-1"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-emerald-400">Logo berhasil dimuat</p>
                        <p className="text-[10px] text-zinc-500 truncate mt-0.5">{receiptLogo}</p>
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-zinc-500">Masukkan URL gambar logo. Logo akan ditampilkan pada struk belanja.</p>
                </div>
              </div>

              {/* Save Button — inside form card on desktop */}
              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="theme-btn-primary h-9 text-xs"
                >
                  {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  Simpan
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Receipt Preview — sticky on desktop */}
        <div className="lg:col-span-2 min-w-0">
          <Card className="bg-zinc-900 border-zinc-800 lg:sticky lg:top-4">
            <CardContent className="p-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Pratinjau Struk</h2>
                <p className="text-xs text-zinc-400 mt-0.5">Tampilan struk yang akan dicetak</p>
              </div>

              <div className="flex justify-center">
                <div className="w-[260px] bg-white rounded-lg p-3 shadow-lg font-mono overflow-hidden">
              <style dangerouslySetInnerHTML={{ __html: `
                .r-center{text-align:center}.r-right{text-align:right}
                .r-row{display:flex;justify-content:space-between;align-items:baseline}
                .r-row-items{display:flex;align-items:baseline}
                /* Thermal-printer optimized: pure black, no gray dithering */
                .r-bold{font-weight:700}.r-semibold{font-weight:600}.r-medium{font-weight:500}
                .r-space>*+*{margin-top:4px}.r-space-sm>*+*{margin-top:2px}.r-space-md>*+*{margin-top:6px}.r-space-lg>*+*{margin-top:8px}
                .r-py{padding-top:6px;padding-bottom:6px}.r-my{margin-top:6px;margin-bottom:6px}
                .r-sep{border:none;border-top:1px dashed #000;margin:6px 0}
                .r-sep-double{border:none;border-top:2px dashed #000;margin:6px 0}
                .r-label{color:#000;font-size:9.5px;font-weight:400}.r-value{color:#000;font-weight:600;font-size:10px}
                .r-value-bold{color:#000;font-weight:700}.r-muted{color:#000;font-size:9px;font-weight:400}
                .r-success{color:#000;font-weight:600}.r-warning{color:#000;font-weight:600}
                .r-upper{text-transform:uppercase;letter-spacing:0.5px}
                .r-lg{font-size:12px}.r-sm{font-size:9px}.r-xs{font-size:8.5px}
                .r-w8{width:28px;text-align:center;flex-shrink:0}.r-w16{width:60px;text-align:right;flex-shrink:0}
                .r-w20{width:72px;text-align:right;flex-shrink:0}.r-flex1{flex:1;min-width:0}.r-gap{gap:2px}
                .r-logo{max-width:36px;max-height:36px;object-fit:contain}
                .r-item-name{font-weight:600;font-size:10px;color:#000}
                .r-item-variant{font-size:8.5px;color:#000;font-weight:400}
                .r-item-price{font-size:9px;color:#000;font-weight:400}
                .r-total-row{font-size:11px}.r-footer{color:#000;font-size:8.5px;font-weight:400}
                .r-wrap{font-family:'Courier New',Courier,monospace;width:100%;color:#000;font-size:10px;line-height:1.5;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:auto}
              ` }} />
              <div className="r-wrap">
                {/* Header */}
                <div className="r-center r-space-lg">
                  {receiptLogo && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
                      <img src={receiptLogo} alt="Logo" className="r-logo" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    </div>
                  )}
                  <p className="r-bold r-lg">{receiptBusinessName || 'Nama Usaha'}</p>
                  {receiptAddress && <p className="r-muted" style={{ whiteSpace: 'pre-line' }}>{receiptAddress}</p>}
                  {receiptPhone && <p className="r-muted">{receiptPhone}</p>}
                </div>

                <hr className="r-sep" />

                {/* Transaction Info */}
                <div className="r-space-sm">
                  <div className="r-row"><span className="r-label">No. Invoice</span><span className="r-value-bold">INV-001234</span></div>
                  <div className="r-row"><span className="r-label">Tanggal</span><span className="r-value">01/01/2025 12:00</span></div>
                  <div className="r-row"><span className="r-label">Customer</span><span className="r-value">Walk-in</span></div>
                </div>

                <hr className="r-sep" />

                {/* Items Header */}
                <div className="r-row-items r-py r-upper">
                  <span className="r-flex1 r-semibold r-sm">Item</span>
                  <span className="r-w8 r-semibold r-sm">Qty</span>
                  <span className="r-w20 r-semibold r-sm">Subtotal</span>
                </div>
                <hr className="r-sep" />

                {/* Sample Items */}
                <div className="r-space-md">
                  <div className="r-space-sm">
                    <p className="r-item-name">Nasi Goreng Spesial</p>
                    <div className="r-row-items r-gap">
                      <span className="r-flex1 r-item-price">@ Rp15.000</span>
                      <span className="r-w8 r-value">2</span>
                      <span className="r-w20 r-value-bold">Rp30.000</span>
                    </div>
                  </div>
                  <div className="r-space-sm">
                    <p className="r-item-name">Es Teh Manis</p>
                    <div className="r-row-items r-gap">
                      <span className="r-flex1 r-item-price">@ Rp5.000</span>
                      <span className="r-w8 r-value">2</span>
                      <span className="r-w20 r-value-bold">Rp10.000</span>
                    </div>
                  </div>
                  <div className="r-space-sm">
                    <p className="r-item-name">Ayam Bakar Madu</p>
                    <div className="r-row-items r-gap">
                      <span className="r-flex1 r-item-price">@ Rp25.000</span>
                      <span className="r-w8 r-value">1</span>
                      <span className="r-w20 r-value-bold">Rp25.000</span>
                    </div>
                  </div>
                </div>

                <hr className="r-sep" />

                {/* Totals */}
                <div className="r-space-sm">
                  <div className="r-row"><span className="r-label">Subtotal</span><span className="r-value">Rp65.000</span></div>
                </div>

                <hr className="r-sep-double" />

                <div className="r-row r-total-row r-bold r-my">
                  <span>TOTAL</span>
                  <span>Rp65.000</span>
                </div>

                <hr className="r-sep" />

                {/* Payment */}
                <div className="r-space-sm">
                  <div className="r-row"><span className="r-label">Pembayaran</span><span className="r-semibold r-upper r-sm">CASH</span></div>
                  <div className="r-row"><span className="r-label">Dibayar</span><span className="r-value">Rp100.000</span></div>
                  <div className="r-row r-bold"><span>Kembalian</span><span>Rp35.000</span></div>
                </div>

                <hr className="r-sep" />

                {/* Footer */}
                <div className="r-center r-py">
                  <p className="r-footer">{receiptFooter || 'Terima kasih atas kunjungan Anda!'}</p>
                </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  )
}

// ==================== TAB 7: TELEGRAM NOTIFICATION ====================

function TelegramTab() {
  const { settings, loading, saving, saveSettings } = useSettings()
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; botName?: string } | null>(null)
  const [dirty, setDirty] = useState(false)

  const isConnected = !!settings?.telegramChatId && !!settings?.telegramBotToken

  useEffect(() => {
    if (settings) {
      setChatId(settings.telegramChatId || '')
      // Never expose the real token — always show placeholder
      setBotToken('')
    }
  }, [settings])

  const handleTestConnection = async () => {
    if (!botToken) {
      toast.error('Bot Token wajib diisi untuk test koneksi')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          botToken,
          chatId: chatId || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setTestResult({
          ok: true,
          message: data.message || 'Koneksi berhasil',
          botName: data.botInfo?.username ? `@${data.botInfo.username}` : data.botInfo?.name,
        })
        toast.success('Koneksi bot berhasil!')
      } else {
        setTestResult({ ok: false, message: data.error || 'Gagal terhubung' })
        toast.error(data.error || 'Gagal terhubung ke Telegram')
      }
    } catch {
      setTestResult({ ok: false, message: 'Gagal terhubung — periksa koneksi internet' })
      toast.error('Gagal terhubung — periksa koneksi internet')
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const updates: Partial<SettingsData> = {
      // Only save notification toggles (these don't need botToken/chatId changes)
      notifyOnTransaction: settings?.notifyOnTransaction ?? true,
      notifyOnCustomer: settings?.notifyOnCustomer ?? true,
      notifyOnInsight: settings?.notifyOnInsight ?? true,
      notifyDailyReport: settings?.notifyDailyReport ?? true,
      notifyWeeklyReport: settings?.notifyWeeklyReport ?? false,
      notifyMonthlyReport: settings?.notifyMonthlyReport ?? true,
    }

    // Only include botToken if user has entered a NEW token
    // (prevent wiping stored token when botToken field is empty after first save)
    if (botToken.trim()) {
      updates.telegramBotToken = botToken.trim()
    }

    // Always include chatId if user has entered one
    if (chatId.trim()) {
      updates.telegramChatId = chatId.trim()
    }

    const ok = await saveSettings(updates)
    if (ok) {
      setDirty(false)
      setBotToken('')
    }
  }

  const handleToggle = async (key: keyof Pick<SettingsData, 'notifyOnTransaction' | 'notifyOnCustomer' | 'notifyOnInsight' | 'notifyDailyReport' | 'notifyWeeklyReport' | 'notifyMonthlyReport'>, value: boolean) => {
    if (!settings) return

    // Save immediately — don't go through handleSave to avoid accidentally wiping botToken
    // saveSettings already updates settings state with server response, no need for local update
    await saveSettings({ [key]: value } as Partial<SettingsData>)
  }

  const handleDisconnect = async () => {
    try {
      const res = await fetch('/api/telegram/setup', { method: 'DELETE' })
      if (res.ok) {
        toast.success('Telegram terputus')
        setChatId('')
        setBotToken('')
        if (settings) {
          setSettings({
            ...settings,
            telegramChatId: null,
            telegramBotToken: null,
          })
        }
        setDirty(false)
      } else {
        toast.error('Gagal memutuskan koneksi')
      }
    } catch {
      toast.error('Gagal memutuskan koneksi')
    }
  }

  if (loading) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-36 bg-zinc-800" />
          <Skeleton className="h-9 bg-zinc-800" />
          <Skeleton className="h-9 bg-zinc-800" />
          <Skeleton className="h-12 bg-zinc-800 rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  const notificationToggles = [
    { key: 'notifyOnTransaction' as const, label: 'Transaksi Baru', desc: 'Setiap ada transaksi masuk' },
    { key: 'notifyOnCustomer' as const, label: 'Customer Baru', desc: 'Saat ada pelanggan terdaftar' },
    { key: 'notifyOnInsight' as const, label: 'Insight Bisnis', desc: 'Peringatan kritis & rekomendasi AI' },
    { key: 'notifyDailyReport' as const, label: 'Laporan Harian', desc: 'Ringkasan pendapatan harian' },
    { key: 'notifyWeeklyReport' as const, label: 'Laporan Mingguan', desc: 'Ringkasan pendapatan mingguan' },
    { key: 'notifyMonthlyReport' as const, label: 'Laporan Bulanan', desc: 'Ringkasan pendapatan bulanan' },
  ]

  return (
    <div className="space-y-4">
      {/* Setup Instructions */}
      <Card className="bg-sky-500/5 border-sky-500/15">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sky-500/15 flex items-center justify-center shrink-0">
              <CircleHelp className="h-4 w-4 text-sky-400" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-100">Cara Setup Telegram Bot</h2>
          </div>

          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[11px] font-bold text-sky-400">1</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200">Buat Bot Token dari BotFather</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Buka Telegram, cari <span className="text-sky-300 font-medium">@BotFather</span>. Kirim pesan <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-[10px] text-sky-300">/newbot</code>, ikuti instruksi, lalu copy <span className="text-zinc-300">Bot Token</span> yang diberikan.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[11px] font-bold text-sky-400">2</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200">Dapatkan Chat ID</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Kirim pesan apapun ke bot yang baru dibuat. Lalu buka browser, akses:{' '}
                  <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-[10px] text-sky-300 break-all">
                    https://api.telegram.org/bot{'{TOKEN}'}/getUpdates
                  </code>
                  {' '}Cari <span className="text-zinc-300">chat.id</span> di response JSON.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[11px] font-bold text-sky-400">3</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200">Masukkan & Test Koneksi</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Paste <span className="text-zinc-300">Bot Token</span> dan <span className="text-zinc-300">Chat ID</span> di form bawah, lalu klik <span className="text-emerald-400 font-medium">Test Koneksi</span>. Jika berhasil, klik <span className="text-emerald-400 font-medium">Simpan</span>.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/40">
            <MessageSquare className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-zinc-400">
              <span className="text-amber-400 font-medium">Tips:</span> Pastikan bot sudah di-Start (klik Start di chat bot) sebelum test koneksi. Chat ID biasanya berupa angka (contoh: <span className="text-zinc-300">123456789</span>).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Connection + Notifications side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Connection Card */}
        <div className="min-w-0">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Koneksi Telegram</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Hubungkan bot untuk notifikasi otomatis</p>
            </div>
            <Badge
              className={`text-[11px] ${
                isConnected
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-500'
              }`}
            >
              {isConnected ? (
                <span className="flex items-center gap-1"><Wifi className="h-3 w-3" /> Terhubung</span>
              ) : (
                <span className="flex items-center gap-1"><WifiOff className="h-3 w-3" /> Tidak Terhubung</span>
              )}
            </Badge>
          </div>

          <div className="space-y-3">
            {/* Bot Token */}
            <div className="space-y-1.5">
              <Label htmlFor="bot-token" className="text-xs text-zinc-300">Bot Token</Label>
              <div className="relative">
                <Input
                  id="bot-token"
                  type={showToken ? 'text' : 'password'}
                  value={botToken}
                  onChange={(e) => { setBotToken(e.target.value); setDirty(true) }}
                  placeholder={settings?.telegramBotToken === '••••••' ? 'Token tersimpan (kosongkan untuk mengganti)' : 'Masukkan token dari @BotFather'}
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Chat ID */}
            <div className="space-y-1.5">
              <Label htmlFor="chat-id" className="text-xs text-zinc-300">Chat ID</Label>
              <Input
                id="chat-id"
                value={chatId}
                onChange={(e) => { setChatId(e.target.value); setDirty(true) }}
                placeholder="Contoh: 123456789"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>

            {/* Test Connection Button */}
            <Button
              onClick={handleTestConnection}
              disabled={testing || !botToken}
              variant="outline"
              className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 h-9 text-xs"
            >
              {testing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Test Koneksi
            </Button>

            {/* Test Result */}
            {testResult && (
              <div className={`rounded-lg border p-3 ${
                testResult.ok
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-red-500/5 border-red-500/20'
              }`}>
                <div className="flex items-center gap-1.5">
                  {testResult.ok ? (
                    <Check className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Unlink2 className="h-4 w-4 text-red-400" />
                  )}
                  <p className={`text-xs font-medium ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testResult.message}
                  </p>
                </div>
                {testResult.botName && (
                  <p className="text-[11px] text-zinc-400 mt-1 ml-5.5">Bot: {testResult.botName}</p>
                )}
              </div>
            )}

            {/* Status info */}
            {isConnected && (
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <Link2 className="h-3.5 w-3.5" />
                <span>Chat ID: {settings?.telegramChatId}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            {isConnected && (
              <Button
                onClick={handleDisconnect}
                variant="outline"
                className="border-red-500/20 text-red-400 hover:bg-red-500/10 h-9 text-xs"
              >
                <Unlink2 className="mr-1.5 h-3.5 w-3.5" />
                Putuskan
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="theme-btn-primary h-9 text-xs"
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Simpan
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Notification Toggles */}
      <div className="min-w-0">
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Jenis Notifikasi</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Pilih event yang ingin dikirim via Telegram</p>
          </div>

          <div className="space-y-2">
            {notificationToggles.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-800 bg-zinc-800/30"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-200">{item.label}</p>
                  <p className="text-[11px] text-zinc-500">{item.desc}</p>
                </div>
                <Switch
                  checked={!!settings?.[item.key]}
                  onCheckedChange={(v) => handleToggle(item.key, v)}
                  className="theme-switch"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="theme-btn-primary h-9 text-xs"
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Simpan Notifikasi
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
      </div>
    </div>
  )
}

// ==================== TAB 7: PLAN & LANGGANAN ====================

/** Fictional pricing data for display */
const PLAN_PRICING: Record<AccountType, { price: string; period: string; description: string }> = {
  free: { price: 'Gratis', period: '', description: 'Untuk bisnis yang baru memulai' },
  pro: { price: 'Rp 149.000', period: '/bulan', description: 'Untuk bisnis yang sedang berkembang' },
  enterprise: { price: 'Rp 449.000', period: '/bulan', description: 'Untuk bisnis skala besar & multi-outlet' },
}

/** Modern circular ring component for usage tracking */
function UsageRing({ label, used, limit, icon }: { label: string; used: number; limit: number; icon: React.ReactNode }) {
  const unlimited = isUnlimited(limit)
  const pct = unlimited ? 100 : limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const isNearLimit = !unlimited && pct >= 80 && pct < 100
  const isAtLimit = !unlimited && pct >= 100

  const ringColor = isAtLimit
    ? '#ef4444'
    : isNearLimit
      ? '#f59e0b'
      : '#10b981'

  const radius = 18
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (pct / 100) * circumference

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: 48, height: 48 }}>
        <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90">
          <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-zinc-800" />
          <circle
            cx="24" cy="24" r={radius} fill="none"
            stroke={ringColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={isAtLimit ? 'text-red-400' : isNearLimit ? 'text-amber-400' : 'text-zinc-200'}>{icon}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-300 font-medium">{label}</p>
        <p className={`text-[11px] ${isAtLimit ? 'text-red-400' : isNearLimit ? 'text-amber-400' : 'text-zinc-500'}`}>
          {unlimited ? 'Unlimited' : `${used} / ${limit}`}
        </p>
      </div>
    </div>
  )
}

function PlanTab() {
  const { planData, plan, features, usage, isLoading } = usePlan()
  const currentPlan = (plan?.type || 'free') as AccountType

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-5 w-36 bg-zinc-800" />
            <Skeleton className="h-40 bg-zinc-800 rounded-lg" />
            <Skeleton className="h-24 bg-zinc-800 rounded-lg" />
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-5 w-48 bg-zinc-800" />
            <Skeleton className="h-48 bg-zinc-800 rounded-lg" />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Plan comparison rows
  const comparisonRows = [
    { label: 'Produk', key: 'maxProducts' as const, format: (v: number) => formatLimit(v) },
    { label: 'Kategori', key: 'maxCategories' as const, format: (v: number) => formatLimit(v) },
    { label: 'Foto Produk', key: 'productImage' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Crew', key: 'maxCrew' as const, format: (v: number) => formatLimit(v) },
    { label: 'Hak Akses Crew', key: 'crewPermissions' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Pelanggan', key: 'maxCustomers' as const, format: (v: number) => formatLimit(v) },
    { label: 'Loyalti', key: 'loyaltyProgram' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Transaksi/Bulan', key: 'maxTransactionsPerMonth' as const, format: (v: number) => formatLimit(v) },
    { label: 'Export Excel', key: 'exportExcel' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Promo', key: 'maxPromos' as const, format: (v: number) => formatLimit(v) },
    { label: 'Audit Log', key: 'auditLog' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Stock Movement', key: 'stockMovement' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Offline Mode', key: 'offlineMode' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Multi-Outlet', key: 'multiOutlet' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Bulk Upload', key: 'bulkUpload' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Ringkasan Transaksi', key: 'transactionSummary' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'API Access', key: 'apiAccess' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Support Prioritas', key: 'prioritySupport' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
  ]

  const planKeys: AccountType[] = ['free', 'pro', 'enterprise']

  const handleUpgrade = (targetPlan: string) => {
    toast.info(`Hubungi admin untuk upgrade ke ${getPlanLabel(targetPlan)}`)
  }

  const handleContactAdmin = () => {
    toast.info('Silakan hubungi admin Aether POS untuk perubahan plan')
  }

  // Plan accent colors
  const planAccent: Record<AccountType, { border: string; bg: string; text: string; icon: string }> = {
    free: { border: 'border-zinc-500/20', bg: 'bg-zinc-500/5', text: 'text-zinc-400', icon: 'bg-zinc-500/10 text-zinc-400' },
    pro: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400', icon: 'bg-emerald-500/10 text-emerald-400' },
    enterprise: { border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400', icon: 'bg-amber-500/10 text-amber-400' },
  }

  return (
    <div className="space-y-4">
      {/* ===== SECTION 1: Current Plan Card ===== */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Plan & Langganan</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Informasi paket langganan outlet Anda</p>
            </div>
            <div className="flex items-center gap-2">
              {plan?.isSuspended ? (
                <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-xs font-semibold px-2.5 py-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mr-1.5" />
                  Ditangguhkan
                </Badge>
              ) : (
                <Badge className={`${getPlanBadgeClass(currentPlan)} text-xs font-semibold px-2.5 py-1`}>
                  {getPlanLabel(currentPlan)}
                </Badge>
              )}
            </div>
          </div>

          {/* Suspended warning */}
          {plan?.isSuspended && (
            <Alert className="border-red-500/20 bg-red-500/5 p-3">
              <AlertDescription className="text-xs text-red-400">
                Akun Anda saat ini ditangguhkan. Hubungi admin untuk informasi lebih lanjut.
              </AlertDescription>
            </Alert>
          )}

          {/* Account & Plan Info */}
          {planData && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Nama Outlet</span>
                <span className="text-xs font-medium text-zinc-200">{planData.outletName || '-'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Tipe Plan</span>
                <span className={`text-xs font-medium ${planAccent[currentPlan].text}`}>{getPlanLabel(currentPlan)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Status</span>
                <Badge className={`text-[10px] px-1.5 py-0 ${plan?.isSuspended ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                  {plan?.isSuspended ? 'Ditangguhkan' : 'Aktif'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Harga</span>
                <span className="text-xs font-medium text-zinc-200">
                  {PLAN_PRICING[currentPlan].price}{PLAN_PRICING[currentPlan].period && <span className="text-zinc-500 font-normal">{PLAN_PRICING[currentPlan].period}</span>}
                </span>
              </div>
            </div>
          )}

          {/* Usage Stats with Circular Rings */}
          {features && usage && (
            <div className="space-y-3">
              <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Penggunaan Saat Ini</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <UsageRing
                  label="Produk"
                  used={usage.products}
                  limit={features.maxProducts}
                  icon={<Tag className="h-4 w-4" />}
                />
                <UsageRing
                  label="Kategori"
                  used={usage.categories}
                  limit={features.maxCategories}
                  icon={<Palette className="h-4 w-4" />}
                />
                <UsageRing
                  label="Crew"
                  used={usage.crew}
                  limit={features.maxCrew}
                  icon={<KeyRound className="h-4 w-4" />}
                />
                <UsageRing
                  label="Pelanggan"
                  used={usage.customers}
                  limit={features.maxCustomers}
                  icon={<Star className="h-4 w-4" />}
                />
                <UsageRing
                  label="Transaksi"
                  used={usage.transactions}
                  limit={features.maxTransactionsPerMonth}
                  icon={<Receipt className="h-4 w-4" />}
                />
              </div>
            </div>
          )}

          {/* ===== SECTION 2: Upgrade CTAs ===== */}
          {currentPlan === 'free' && !plan?.isSuspended && (
            <div className="space-y-3">
              {/* Upgrade to Pro */}
              <div className={`rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3`}>
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Zap className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div>
                      <p className="text-xs font-semibold text-emerald-300">Upgrade ke Pro</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Unlimited produk, export Excel, API access, foto produk, dan banyak lagi.
                      </p>
                      <p className="text-xs font-semibold text-emerald-400 mt-1">
                        {PLAN_PRICING.pro.price}<span className="text-emerald-400/60 font-normal">{PLAN_PRICING.pro.period}</span>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleUpgrade('pro')}
                        size="sm"
                        className="theme-btn-primary h-7 text-[11px]"
                      >
                        Upgrade ke Pro
                        <ArrowUpRight className="ml-1 h-3 w-3" />
                      </Button>
                      <Button
                        onClick={() => handleUpgrade('enterprise')}
                        variant="outline"
                        size="sm"
                        className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-7 text-[11px]"
                      >
                        Upgrade ke Enterprise
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentPlan === 'pro' && !plan?.isSuspended && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Crown className="h-4 w-4 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <p className="text-xs font-semibold text-amber-300">Upgrade ke Enterprise</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Multi-outlet management untuk bisnis yang berkembang dengan kontrol penuh.
                    </p>
                    <p className="text-xs font-semibold text-amber-400 mt-1">
                      {PLAN_PRICING.enterprise.price}<span className="text-amber-400/60 font-normal">{PLAN_PRICING.enterprise.period}</span>
                    </p>
                  </div>
                  <Button
                    onClick={() => handleUpgrade('enterprise')}
                    size="sm"
                    className="bg-amber-500 hover:bg-amber-600 text-white h-7 text-[11px]"
                  >
                    Upgrade ke Enterprise
                    <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {currentPlan === 'enterprise' && !plan?.isSuspended && (
            <div className={`rounded-lg border ${planAccent.enterprise.border} ${planAccent.enterprise.bg} p-3`}>
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg ${planAccent.enterprise.icon} flex items-center justify-center shrink-0`}>
                  <Crown className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-amber-300">Current Plan — Semua fitur terbuka</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Anda memiliki akses penuh ke semua fitur Aether POS termasuk multi-outlet.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ===== SECTION 3: Manage Subscription ===== */}
          <Separator className="bg-zinc-800" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-300">Kelola Langganan</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Upgrade, downgrade, atau perubahan plan lainnya</p>
            </div>
            <Button
              onClick={handleContactAdmin}
              variant="outline"
              size="sm"
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-8 text-xs gap-1.5"
            >
              <Send className="h-3.5 w-3.5" />
              Hubungi Admin
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== SECTION 4: Plan Comparison ===== */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Perbandingan Plan</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Bandingkan fitur dari setiap paket langganan</p>
          </div>

          {/* Pricing Cards Row */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {planKeys.map((key) => {
              const pricing = PLAN_PRICING[key]
              const isCurrent = key === currentPlan
              const accent = planAccent[key]
              return (
                <div
                  key={key}
                  className={`rounded-lg border p-3 text-center space-y-1.5 transition-colors ${
                    isCurrent
                      ? `${accent.border} ${accent.bg}`
                      : 'border-zinc-800 bg-zinc-800/20 hover:bg-zinc-800/40'
                  }`}
                >
                  <Badge className={`${getPlanBadgeClass(key)} text-[10px] font-semibold px-2 py-0`}>
                    {getPlanLabel(key)}
                  </Badge>
                  <div>
                    <p className={`text-sm font-bold ${isCurrent ? accent.text : 'text-zinc-200'}`}>
                      {pricing.price}
                    </p>
                    {pricing.period && (
                      <p className="text-[10px] text-zinc-500">{pricing.period}</p>
                    )}
                  </div>
                  {isCurrent && (
                    <span className="text-[9px] text-emerald-400 font-medium">Plan Anda</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block rounded-lg border border-zinc-800 overflow-hidden max-h-[420px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent bg-zinc-800/30 sticky top-0 z-10">
                  <TableHead className="text-zinc-500 text-[11px] font-medium h-9 w-[180px]">Fitur</TableHead>
                  {planKeys.map((key) => (
                    <TableHead key={key} className="text-center text-[11px] font-medium h-9">
                      <div className="flex flex-col items-center gap-1">
                        <Badge className={`${getPlanBadgeClass(key)} text-[10px] font-semibold px-2 py-0`}>
                          {getPlanLabel(key)}
                        </Badge>
                        {key === currentPlan && (
                          <span className="text-[9px] text-emerald-400 font-medium">Plan Anda</span>
                        )}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonRows.map((row, idx) => (
                  <TableRow key={row.key} className={`border-zinc-800 hover:bg-transparent ${idx % 2 === 0 ? 'bg-zinc-900/50' : ''}`}>
                    <TableCell className="text-xs text-zinc-300 font-medium py-2">{row.label}</TableCell>
                    {planKeys.map((key) => {
                      const planFeatures = PLANS[key]
                      const value = planFeatures[row.key]
                      const display = row.format(value as number & boolean)
                      const isCurrentPlan = key === currentPlan
                      const isBoolean = typeof value === 'boolean'
                      const isUnlimitedValue = typeof value === 'number' && value === -1

                      return (
                        <TableCell key={key} className={`text-center py-2 ${isCurrentPlan ? 'bg-emerald-500/[0.03]' : ''}`}>
                          {isBoolean ? (
                            value ? (
                              <Check className="h-4 w-4 text-emerald-400 mx-auto" />
                            ) : (
                              <X className="h-3.5 w-3.5 text-zinc-600 mx-auto" />
                            )
                          ) : (
                            <span className={`text-xs font-medium ${isUnlimitedValue ? 'text-emerald-400' : isCurrentPlan ? 'text-zinc-200' : 'text-zinc-400'}`}>
                              {display}
                            </span>
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3 max-h-[520px] overflow-y-auto">
            {planKeys.map((key) => {
              const planFeatures = PLANS[key]
              const isCurrentPlan = key === currentPlan
              const accent = planAccent[key]

              return (
                <div
                  key={key}
                  className={`rounded-lg border p-3 space-y-2.5 transition-colors ${
                    isCurrentPlan
                      ? `${accent.border} ${accent.bg}`
                      : 'border-zinc-800 bg-zinc-800/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Badge className={`${getPlanBadgeClass(key)} text-[11px] font-semibold px-2 py-0`}>
                      {getPlanLabel(key)}
                    </Badge>
                    {isCurrentPlan && (
                      <span className="text-[10px] text-emerald-400 font-medium">Plan Anda</span>
                    )}
                  </div>
                  <p className={`text-sm font-bold ${isCurrentPlan ? accent.text : 'text-zinc-200'}`}>
                    {PLAN_PRICING[key].price}{PLAN_PRICING[key].period && <span className="text-zinc-500 font-normal text-xs">{PLAN_PRICING[key].period}</span>}
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {comparisonRows.map((row) => {
                      const value = planFeatures[row.key]
                      const display = row.format(value as number & boolean)
                      const isBoolean = typeof value === 'boolean'
                      const isUnlimitedValue = typeof value === 'number' && value === -1

                      return (
                        <div key={row.key} className="flex items-center justify-between py-0.5">
                          <span className="text-[11px] text-zinc-500">{row.label}</span>
                          {isBoolean ? (
                            value ? (
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <X className="h-3 w-3 text-zinc-600" />
                            )
                          ) : (
                            <span className={`text-[11px] font-medium ${isUnlimitedValue ? 'text-emerald-400' : 'text-zinc-300'}`}>
                              {display}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {!isCurrentPlan && (key === 'pro' || key === 'enterprise') && (
                    <Button
                      onClick={() => handleUpgrade(key)}
                      variant="outline"
                      size="sm"
                      className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-7 text-[11px]"
                    >
                      Upgrade ke {getPlanLabel(key)}
                      <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Button>
                  )}
                  {isCurrentPlan && (
                    <div className="text-center pt-0.5">
                      <span className="text-[11px] text-emerald-400 font-medium">✓ Plan aktif</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ==================== TAB 8: ACCOUNT SECURITY ====================

function AccountTab() {
  const { data: session } = useSession()

  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [changingEmail, setChangingEmail] = useState(false)

  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [changingPwd, setChangingPwd] = useState(false)

  const handleChangeEmail = async () => {
    if (!newEmail || !emailPassword) {
      toast.error('Email baru dan password wajib diisi')
      return
    }
    if (!newEmail.includes('@')) {
      toast.error('Format email tidak valid')
      return
    }
    setChangingEmail(true)
    try {
      const res = await fetch('/api/auth/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, currentPassword: emailPassword }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Email berhasil diperbarui')
        setNewEmail('')
        setEmailPassword('')
      } else {
        toast.error(data.error || 'Gagal mengganti email')
      }
    } catch {
      toast.error('Gagal mengganti email')
    } finally {
      setChangingEmail(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd || !confirmPwd) {
      toast.error('Semua field wajib diisi')
      return
    }
    if (newPwd.length < 6) {
      toast.error('Password baru minimal 6 karakter')
      return
    }
    if (newPwd !== confirmPwd) {
      toast.error('Konfirmasi password tidak cocok')
      return
    }
    setChangingPwd(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Password berhasil diperbarui')
        setCurrentPwd('')
        setNewPwd('')
        setConfirmPwd('')
      } else {
        toast.error(data.error || 'Gagal mengganti password')
      }
    } catch {
      toast.error('Gagal mengganti password')
    } finally {
      setChangingPwd(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Current Account Info */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Informasi Akun</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Detail akun yang sedang digunakan</p>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Nama</span>
              <span className="text-xs font-medium text-zinc-200">{session?.user?.name || '-'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Email</span>
              <span className="text-xs font-medium text-zinc-200">{session?.user?.email || '-'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Peran</span>
              <Badge
                variant="outline"
                className={`text-[11px] px-1.5 py-0 ${
                  session?.user?.role === 'OWNER'
                    ? 'bg-amber-500/10 border-amber-500/15 text-amber-400'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-500'
                }`}
              >
                {session?.user?.role === 'OWNER' ? 'Owner' : 'Crew'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email + Password side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Change Email */}
        <div className="min-w-0">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Ganti Email</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Ubah email akun Anda</p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-email" className="text-xs text-zinc-300">Email Baru</Label>
              <Input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="email@contoh.com"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-password" className="text-xs text-zinc-300">Konfirmasi Password</Label>
              <Input
                id="email-password"
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder="Masukkan password saat ini"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
          </div>

          <Button
            onClick={handleChangeEmail}
            disabled={changingEmail || !newEmail || !emailPassword}
            className="theme-btn-primary h-9 text-xs"
          >
            {changingEmail ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Ganti Email
          </Button>
        </CardContent>
      </Card>
      </div>

      {/* Change Password */}
      <div className="min-w-0">
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Ganti Password</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Ubah password akun Anda</p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="current-password" className="text-xs text-zinc-300">Password Saat Ini</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                placeholder="Masukkan password saat ini"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-xs text-zinc-300">Password Baru</Label>
              <Input
                id="new-password"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="Minimal 6 karakter"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-xs text-zinc-300">Konfirmasi Password Baru</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Ulangi password baru"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
          </div>

          <Button
            onClick={handleChangePassword}
            disabled={changingPwd || !currentPwd || !newPwd || !confirmPwd || newPwd !== confirmPwd || newPwd.length < 6}
            className="theme-btn-primary h-9 text-xs"
          >
            {changingPwd ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            )}
            Ganti Password
          </Button>
        </CardContent>
      </Card>
      </div>
    </div>
    </div>
  )
}

// ==================== TAB 9: MULTI-OUTLET (PLACEHOLDER) ====================

function MultiOutletTab() {
  const { settings, loading } = useSettings()
  const [outlets, setOutlets] = useState<Array<{
    id: string; name: string; address: string | null; phone: string | null;
    accountType: string; isPrimary: boolean; createdAt: string;
    userCount: number; productCount: number; transactionCount: number; customerCount: number;
  }>>([])
  const [outletsLoading, setOutletsLoading] = useState(true)
  const [canAddMore, setCanAddMore] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formData, setFormData] = useState({ name: '', address: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchOutlets = useCallback(async () => {
    setOutletsLoading(true)
    try {
      const res = await fetch('/api/outlets')
      if (res.ok) {
        const data = await res.json()
        setOutlets(data.outlets || [])
        setCanAddMore(data.canAddMore || false)
      }
    } catch {
      toast.error('Gagal memuat outlet')
    } finally {
      setOutletsLoading(false)
    }
  }, [])

  useEffect(() => { fetchOutlets() }, [fetchOutlets])

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error('Nama outlet wajib diisi')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/outlets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Outlet "${data.outlet.name}" berhasil ditambahkan`)
        setDialogOpen(false)
        setFormData({ name: '', address: '', phone: '' })
        fetchOutlets()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Gagal menambah outlet')
      }
    } catch {
      toast.error('Gagal menambah outlet')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/outlets/${deleteId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Outlet berhasil dihapus')
        setDeleteId(null)
        fetchOutlets()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Gagal menghapus outlet')
      }
    } catch {
      toast.error('Gagal menghapus outlet')
    } finally {
      setDeleting(false)
    }
  }

  if (loading || outletsLoading) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-36 bg-zinc-800" />
          <Skeleton className="h-20 bg-zinc-800 rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  const isEnterprise = settings?.outlet?.accountType === 'enterprise' || canAddMore

  if (!isEnterprise) {
    return (
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Outlet Cabang</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Kelola beberapa outlet dalam satu akun</p>
          </div>

          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-400" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-emerald-400">Outlet Utama (Aktif)</p>
                <p className="text-[11px] text-zinc-400">{settings?.outlet?.name || '-'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
            <p className="text-[11px] text-zinc-500 text-center">
              Multi-outlet tersedia untuk akun <span className="text-amber-400 font-medium">Enterprise</span>. Upgrade untuk mengakses fitur ini.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Outlet Cabang</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {outlets.length} outlet terdaftar
              </p>
            </div>
            {canAddMore && (
              <Button onClick={() => { setFormData({ name: '', address: '', phone: '' }); setDialogOpen(true) }}
                className="theme-btn-primary h-8 text-xs">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Tambah Cabang
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {outlets.map((outlet) => (
              <div key={outlet.id}
                className={`rounded-lg border p-3 space-y-1.5 transition-colors ${
                  outlet.isPrimary
                    ? 'border-emerald-500/20 bg-emerald-500/5'
                    : 'border-zinc-800 bg-zinc-800/30 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className={`h-4 w-4 shrink-0 ${outlet.isPrimary ? 'text-emerald-400' : 'text-zinc-500'}`} />
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold truncate ${outlet.isPrimary ? 'text-emerald-400' : 'text-zinc-200'}`}>
                        {outlet.name}
                        {outlet.isPrimary && <span className="ml-1.5 text-[10px] font-normal text-emerald-300">(Utama)</span>}
                      </p>
                      {outlet.address && <p className="text-[11px] text-zinc-500 truncate">{outlet.address}</p>}
                    </div>
                  </div>
                  {!outlet.isPrimary && (
                    <Button variant="ghost" size="icon"
                      className="h-7 w-7 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                      onClick={() => setDeleteId(outlet.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="flex gap-3 text-[10px] text-zinc-500">
                  {outlet.userCount > 0 && <span>{outlet.userCount} crew</span>}
                  {outlet.productCount > 0 && <span>{outlet.productCount} produk</span>}
                  {outlet.customerCount > 0 && <span>{outlet.customerCount} customer</span>}
                  <span>{outlet.transactionCount} transaksi</span>
                </div>
              </div>
            ))}
          </div>

          {outlets.length === 0 && (
            <div className="py-6 text-center">
              <Building2 className="h-8 w-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-sm text-zinc-500">Belum ada outlet cabang</p>
              <p className="text-[11px] text-zinc-600">Tambahkan outlet cabang untuk memperluas bisnis Anda</p>
            </div>
          )}

          <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-2.5">
            <p className="text-[10px] text-zinc-500 text-center">
              💡 Gunakan email & password yang sama untuk login ke outlet cabang.
              Setiap outlet cabang memiliki data & transaksi terpisah.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Add Outlet Dialog */}
      <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <ResponsiveDialogContent className="bg-zinc-900 border-zinc-800 p-4">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-sm font-semibold text-zinc-100">Tambah Outlet Cabang</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Nama Outlet *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="Contoh: Toko Cabang Pondok Indah"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Alamat</Label>
              <Input
                value={formData.address}
                onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))}
                placeholder="Jl. Merdeka No. 10"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Telepon</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
                placeholder="081234567890"
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 h-9 text-sm"
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}
              className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs">
              Batal
            </Button>
            <Button onClick={handleCreate} disabled={saving || !formData.name.trim()}
              className="theme-btn-primary h-8 text-xs">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Tambah Outlet
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold text-zinc-100">Hapus Outlet</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Apakah Anda yakin ingin menghapus outlet ini? Semua data (produk, customer, transaksi, crew) akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 h-8 text-xs" />
            <AlertDialogAction onClick={handleDelete} disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs">
              {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
