'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  MessageSquare,
  Lock,
  Settings,
  Bell,
  UserCircle,
  CreditCardIcon,
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
  manualDiscountEnabled: boolean
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
  { name: 'emerald', label: 'Emerald', classes: 'theme-bg' },
  { name: 'blue', label: 'Biru', classes: 'bg-blue-500' },
  { name: 'violet', label: 'Violet', classes: 'bg-violet-500' },
  { name: 'rose', label: 'Rose', classes: 'bg-rose-500' },
  { name: 'amber', label: 'Amber', classes: 'bg-amber-500' },
  { name: 'cyan', label: 'Cyan', classes: 'bg-cyan-500' },
]

// ==================== REUSABLE UI PRIMITIVES ====================
// Design Language: Linear × Stripe × Mercury — Dark Minimal Enterprise Fintech

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[15px] font-semibold text-white tracking-tight">{title}</h2>
      {description && <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">{description}</p>}
    </div>
  )
}

function SectionGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1.5 h-1.5 rounded-full aether-gradient" />
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.14em]">{children}</p>
    </div>
  )
}

function SettingsRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3.5 px-5 group hover:bg-white/[0.015] transition-colors duration-150">
      <div className="pr-4">
        <p className="text-[13px] text-slate-300 font-medium">{label}</p>
        {description && <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function StripeInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full bg-white/[0.02] border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-600 outline-none focus:border-white/[0.14] focus:bg-white/[0.03] focus:ring-1 focus:ring-white/[0.04] transition-all duration-200 ${className}`}
      {...props}
    />
  )
}

function StripeTextarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full bg-white/[0.02] border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-600 outline-none focus:border-white/[0.14] focus:bg-white/[0.03] focus:ring-1 focus:ring-white/[0.04] transition-all duration-200 resize-none ${className}`}
      {...props}
    />
  )
}

function SaveButton({ onClick, disabled, saving, label = 'Simpan' }: { onClick: () => void; disabled: boolean; saving: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-white/[0.06] text-white hover:bg-white/[0.10] disabled:bg-white/[0.03] disabled:text-slate-600 disabled:cursor-not-allowed border border-white/[0.06] hover:border-white/[0.10] transition-all duration-200"
    >
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}

function SectionBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#0c0d10] rounded-xl border border-white/[0.05] divide-y divide-white/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.3)] ${className}`}>
      {children}
    </div>
  )
}

// ==================== MAIN COMPONENT ====================

export default function SettingsPage() {
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'

  return (
    <div className="max-w-[960px] mx-auto">
      {/* Page Header — Stripe-style */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
            <Settings className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-white tracking-tight">Settings</h1>
          </div>
        </div>
        <p className="text-[13px] text-slate-500 ml-11">Manage your outlet configuration and preferences</p>
      </div>

      {/* Layout: Left Nav + Content */}
      <div className="flex gap-10">
        <SettingsNav isOwner={isOwner} />
        <SettingsContent isOwner={isOwner} />
      </div>
    </div>
  )
}

// ==================== NAVIGATION ====================

type SectionId = 'general' | 'payments' | 'plan' | 'notifications' | 'account'

interface NavItem {
  id: SectionId
  label: string
  icon: React.ReactNode
  ownerOnly?: boolean
}

const NAV_SECTIONS: NavItem[] = [
  { id: 'general', label: 'General', icon: <Store className="h-[15px] w-[15px]" strokeWidth={1.5} /> },
  { id: 'payments', label: 'Payments', icon: <CreditCardIcon className="h-[15px] w-[15px]" strokeWidth={1.5} /> },
  { id: 'plan', label: 'Plan', icon: <Crown className="h-[15px] w-[15px]" strokeWidth={1.5} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="h-[15px] w-[15px]" strokeWidth={1.5} />, ownerOnly: true },
  { id: 'account', label: 'Account', icon: <UserCircle className="h-[15px] w-[15px]" strokeWidth={1.5} /> },
]

function SettingsNav({ isOwner }: { isOwner: boolean }) {
  const [activeSection, setActiveSection] = useState<SectionId>('general')

  // Expose activeSection to parent through a custom event or just keep it local
  // We use a data attribute approach - the content area reads the hash
  const handleNavClick = (id: SectionId) => {
    setActiveSection(id)
    // Scroll the target section into view
    const el = document.getElementById(`settings-section-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // Observe which section is in view to update active nav
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id.replace('settings-section-', '') as SectionId)
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )

    NAV_SECTIONS.forEach(({ id, ownerOnly }) => {
      if (ownerOnly && !isOwner) return
      const el = document.getElementById(`settings-section-${id}`)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [isOwner])

  const visibleSections = NAV_SECTIONS.filter((s) => !s.ownerOnly || isOwner)

  return (
    <>
      {/* Desktop sidebar — Linear-style sticky nav */}
      <nav className="hidden md:block w-[180px] shrink-0 sticky top-6 self-start">
        <div className="bg-[#0c0d10] rounded-xl border border-white/[0.05] p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
          {visibleSections.map((section) => (
            <button
              key={section.id}
              onClick={() => handleNavClick(section.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-[13px] font-medium transition-all duration-150 ${
                activeSection === section.id
                  ? 'bg-white/[0.06] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)]'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
              }`}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Mobile horizontal scrollable nav — pill style */}
      <nav className="md:hidden w-full shrink-0 mb-5">
        <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide">
          {visibleSections.map((section) => (
            <button
              key={section.id}
              onClick={() => handleNavClick(section.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-medium whitespace-nowrap transition-all duration-150 ${
                activeSection === section.id
                  ? 'bg-white/[0.07] text-white border border-white/[0.08]'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent hover:bg-white/[0.03]'
              }`}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </div>
      </nav>
    </>
  )
}

// ==================== CONTENT AREA ====================

function SettingsContent({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="flex-1 min-w-0 space-y-12">
      {/* General Section */}
      <section id="settings-section-general">
        <SectionGroupLabel>General</SectionGroupLabel>
        <OutletInfoTab />
        <div className="mt-10">
          <ThemeReceiptTab />
        </div>
        {isOwner && (
          <div className="mt-10">
            <ProGate feature="multiOutlet" label="Multi-Outlet" description="Kelola beberapa outlet dalam satu akun" minHeight="200px">
              <MultiOutletTab />
            </ProGate>
          </div>
        )}
      </section>

      {/* Payments Section */}
      <section id="settings-section-payments">
        <SectionGroupLabel>Payments</SectionGroupLabel>
        <PaymentMethodsTab />
        <div className="mt-10">
          <LoyaltyTab />
        </div>
        {isOwner && (
          <>
            <div className="mt-10">
              <TaxTab />
            </div>
            <div className="mt-10">
              <ManualDiscountTab />
            </div>
            <div className="mt-10">
              <PromoTab />
            </div>
          </>
        )}
      </section>

      {/* Plan Section */}
      <section id="settings-section-plan">
        <SectionGroupLabel>Plan</SectionGroupLabel>
        <PlanTab />
      </section>

      {/* Notifications Section */}
      {isOwner && (
        <section id="settings-section-notifications">
          <SectionGroupLabel>Notifications</SectionGroupLabel>
          <ProGate feature="apiAccess" label="Telegram Notifikasi" description="Kirim notifikasi otomatis via Telegram" minHeight="200px">
            <TelegramTab />
          </ProGate>
        </section>
      )}

      {/* Account Section */}
      <section id="settings-section-account">
        <SectionGroupLabel>Account</SectionGroupLabel>
        <AccountTab />
      </section>
    </div>
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

// ==================== OUTLET INFO ====================

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
      <div className="space-y-4">
        <Skeleton className="h-4 w-36 bg-white/[0.03]" />
        <SectionBox>
          <div className="p-5"><Skeleton className="h-5 w-40 bg-white/[0.03]" /></div>
          <div className="p-5"><Skeleton className="h-5 w-36 bg-white/[0.03]" /></div>
          <div className="p-5"><Skeleton className="h-5 w-48 bg-white/[0.03]" /></div>
        </SectionBox>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader title="Outlet & Struk" description="Basic details about your business" />
      <SectionBox>
        <div className="p-5">
          <p className="text-[12px] text-slate-500 mb-2 font-medium">Nama Outlet</p>
          <StripeInput
            value={outletName}
            onChange={(e) => handleChange('outletName', e.target.value)}
            placeholder="Masukkan nama outlet"
          />
        </div>
        <div className="p-5">
          <p className="text-[12px] text-slate-500 mb-2 font-medium">Telepon</p>
          <StripeInput
            value={outletPhone}
            onChange={(e) => handleChange('outletPhone', e.target.value)}
            placeholder="Masukkan nomor telepon"
          />
        </div>
        <div className="p-5">
          <p className="text-[12px] text-slate-500 mb-2 font-medium">Alamat</p>
          <StripeTextarea
            value={outletAddress}
            onChange={(e) => handleChange('outletAddress', e.target.value)}
            placeholder="Masukkan alamat outlet"
            rows={2}
          />
        </div>
      </SectionBox>
      <div className="flex justify-end mt-4">
        <SaveButton onClick={handleSave} disabled={saving || !dirty} saving={saving} />
      </div>
    </div>
  )
}

// ==================== PAYMENT METHODS ====================

function PaymentMethodsTab() {
  const { settings, loading, saving, saveSettings } = useSettings()
  const [editedPaymentMethods, setEditedPaymentMethods] = useState<string | null>(null)

  const paymentMethods = [
    { key: 'CASH', label: 'Tunai (CASH)', icon: <Banknote className="h-4 w-4" />, desc: 'Pembayaran tunai langsung' },
    { key: 'QRIS', label: 'QRIS', icon: <QrCode className="h-4 w-4" />, desc: 'Scan QR untuk pembayaran' },
    { key: 'DEBIT', label: 'Debit/Credit', icon: <CreditCard className="h-4 w-4" />, desc: 'Kartu debit atau kredit' },
    { key: 'TRANSFER', label: 'Transfer Bank', icon: <ArrowRightLeft className="h-4 w-4" />, desc: 'Transfer via mobile banking / ATM' },
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
      <div className="space-y-4">
        <Skeleton className="h-4 w-36 bg-white/[0.03]" />
        <SectionBox>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
          ))}
        </SectionBox>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader title="Metode Pembayaran" description="Pilih metode pembayaran yang tersedia di outlet Anda" />
      <SectionBox>
        {paymentMethods.map((method) => {
          const isActive = currentEnabled.includes(method.key)
          return (
            <SettingsRow key={method.key} label={method.label} description={method.desc}>
              <Switch
                checked={isActive}
                onCheckedChange={() => handleToggle(method.key)}
                className="theme-switch"
              />
            </SettingsRow>
          )
        })}
      </SectionBox>
      <div className="flex justify-end mt-4">
        <SaveButton onClick={handleSave} disabled={saving} saving={saving} />
      </div>
    </div>
  )
}

// ==================== LOYALTY PROGRAM ====================

function LoyaltyTab() {
  const { settings, loading, saving, saveSettings } = useSettings()
  const [edits, setEdits] = useState<Record<string, string | boolean> | null>(null)

  const loyaltyEnabled = (edits?.loyaltyEnabled ?? settings?.loyaltyEnabled ?? true) as boolean
  const pointsPerAmount = String(edits?.pointsPerAmount ?? (settings ? settings.loyaltyPointsPerAmount : 10000))
  const pointValue = String(edits?.pointValue ?? (settings ? settings.loyaltyPointValue : 100))
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
      <div className="space-y-4">
        <Skeleton className="h-4 w-36 bg-white/[0.03]" />
        <SectionBox>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
        </SectionBox>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader title="Program Loyalti" description="Konfigurasi poin loyalitas pelanggan" />
      <SectionBox>
        <SettingsRow label="Aktifkan Program Loyalti" description="Pelanggan mendapat poin dari setiap transaksi">
          <Switch
            checked={loyaltyEnabled}
            onCheckedChange={(v) => handleChange('loyaltyEnabled', v)}
            className="data-[state=checked]:bg-amber-500"
          />
        </SettingsRow>

        {loyaltyEnabled && (
          <>
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <p className="text-[12px] text-slate-500 mb-2 font-medium">Setiap Rp X = 1 poin</p>
                  <StripeInput
                    type="number"
                    min="1"
                    value={pointsPerAmount}
                    onChange={(e) => handleChange('pointsPerAmount', e.target.value)}
                    placeholder="10000"
                  />
                </div>
                <div>
                  <p className="text-[12px] text-slate-500 mb-2 font-medium">1 poin = Rp X diskon</p>
                  <StripeInput
                    type="number"
                    min="1"
                    value={pointValue}
                    onChange={(e) => handleChange('pointValue', e.target.value)}
                    placeholder="100"
                  />
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="rounded-lg border border-amber-500/10 bg-amber-500/[0.03] p-4">
                <p className="text-[11px] font-semibold text-amber-400/70 uppercase tracking-[0.12em] mb-2.5">Contoh Perhitungan</p>
                <p className="text-[13px] text-slate-300">
                  Belanja <span className="font-semibold text-amber-300">{formatCurrency(exampleSpend)}</span> ={' '}
                  <span className="font-semibold text-amber-300">{examplePoints} poin</span> ={' '}
                  <span className="font-semibold text-amber-300">{formatCurrency(exampleDiscount)} diskon</span>
                </p>
              </div>
            </div>
          </>
        )}
      </SectionBox>
      {loyaltyEnabled && (
        <div className="flex justify-end mt-4">
          <SaveButton onClick={handleSave} disabled={saving || !dirty} saving={saving} />
        </div>
      )}
    </div>
  )
}

// ==================== TAX / PPN ====================

function TaxTab() {
  const { settings, loading, saving, saveSettings } = useSettings()
  const [edits, setEdits] = useState<Record<string, string | boolean> | null>(null)

  const ppnEnabled = (edits?.ppnEnabled ?? settings?.ppnEnabled ?? false) as boolean
  const ppnRate = String(edits?.ppnRate ?? (settings ? settings.ppnRate : 11))
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
      <div className="space-y-4">
        <Skeleton className="h-4 w-36 bg-white/[0.03]" />
        <SectionBox>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
        </SectionBox>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader title="Pajak PPN" description="Atur Pajak Pertambahan Nilai untuk transaksi" />
      <SectionBox>
        <SettingsRow label="Aktifkan PPN" description="Pajak otomatis ditambahkan ke setiap transaksi">
          <Switch
            checked={ppnEnabled}
            onCheckedChange={(v) => handleChange('ppnEnabled', v)}
            className="theme-switch"
          />
        </SettingsRow>

        {ppnEnabled && (
          <>
            <div className="p-5">
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <p className="text-[12px] text-slate-500 mb-2 font-medium">Tarif PPN (%)</p>
                  <StripeInput
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={ppnRate}
                    onChange={(e) => handleChange('ppnRate', e.target.value)}
                    placeholder="11"
                  />
                </div>
                <p className="text-[11px] text-slate-600 pb-2">Tarif PPN standar Indonesia: 11%</p>
              </div>
            </div>
            <div className="p-5">
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.015] p-4">
                <p className="text-[11px] font-semibold text-slate-500/80 uppercase tracking-[0.12em] mb-2.5">Contoh Perhitungan</p>
                <div className="space-y-1.5 text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-slate-300">Subtotal</span>
                    <span className="font-medium text-slate-200">{formatCurrency(exampleSubtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-300">PPN ({rate}%)</span>
                    <span className="font-medium theme-text">+{formatCurrency(exampleTax)}</span>
                  </div>
                  <div className="flex justify-between border-t border-white/[0.06] pt-1.5 mt-1.5">
                    <span className="font-semibold text-white">Total</span>
                    <span className="font-bold theme-text">{formatCurrency(exampleTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </SectionBox>
      {ppnEnabled && (
        <div className="flex justify-end mt-4">
          <SaveButton onClick={handleSave} disabled={saving || !dirty} saving={saving} />
        </div>
      )}
    </div>
  )
}

// ==================== MANUAL DISCOUNT ====================

function ManualDiscountTab() {
  const { settings, loading, saving, saveSettings } = useSettings()

  const enabled = settings?.manualDiscountEnabled ?? false

  const handleToggle = async (value: boolean) => {
    const ok = await saveSettings({
      manualDiscountEnabled: value,
    })
    if (!ok) {
      toast.error('Gagal menyimpan pengaturan diskon manual')
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-44 bg-white/[0.03]" />
        <SectionBox>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
        </SectionBox>
      </div>
    )
  }

  return (
    <div>
      <SectionHeader title="Diskon Manual per Item" description="Berikan diskon langsung pada produk di keranjang POS" />
      <SectionBox>
        <SettingsRow label="Aktifkan Diskon Manual" description="Kasir bisa set diskon per produk di keranjang POS">
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={saving}
            className="theme-switch"
          />
        </SettingsRow>

        {enabled && (
          <div className="p-5">
            <div className="rounded-lg border border-white/[0.05] bg-white/[0.015] p-4 space-y-2.5">
              <p className="text-[11px] font-semibold text-slate-500/80 uppercase tracking-[0.12em]">Cara Kerja</p>
              <ul className="space-y-1.5 text-[13px] text-slate-300">
                <li className="flex items-start gap-2">
                  <Check className="h-3.5 w-3.5 theme-text shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span>Saat menambahkan produk ke keranjang, setiap item akan memiliki kolom <span className="font-medium text-white">Diskon (%)</span></span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-3.5 w-3.5 theme-text shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span>Masukkan persentase diskon (0-100%) untuk setiap produk</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-3.5 w-3.5 theme-text shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span>Diskon akan otomatis dihitung dan ditampilkan di ringkasan keranjang</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-3.5 w-3.5 theme-text shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span>Diskon manual akan tercatat di struk dan riwayat transaksi</span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </SectionBox>
    </div>
  )
}

// ==================== PROMO / DISKON ====================

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
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Promo</h2>
          <p className="text-[13px] text-slate-400 mt-1">Kelola promo dan diskon untuk pelanggan</p>
        </div>
        <button
          onClick={openCreate}
          className="text-[13px] font-medium text-slate-400 hover:text-white transition-colors duration-150 flex items-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Tambah Promo
        </button>
      </div>

      {loading ? (
        <SectionBox>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
          ))}
        </SectionBox>
      ) : promos.length === 0 ? (
        <div className="bg-[#0c0d10] rounded-xl border border-white/[0.05] py-14 text-center">
          <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center mx-auto mb-3">
            <Tag className="h-5 w-5 text-slate-600" />
          </div>
          <p className="text-[13px] text-slate-400 font-medium">Belum ada promo</p>
          <p className="text-[12px] text-slate-600 mt-0.5">Tambahkan promo untuk menarik pelanggan</p>
        </div>
      ) : (
        <div className="bg-[#0c0d10] rounded-xl border border-white/[0.05] overflow-x-auto shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.04] hover:bg-transparent">
                <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-[0.1em] h-9">Nama</TableHead>
                <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-[0.1em] h-9">Tipe</TableHead>
                <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-[0.1em] h-9">Kategori</TableHead>
                <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-[0.1em] h-9 text-right">Nilai</TableHead>
                <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-[0.1em] h-9 text-right">Min. Belanja</TableHead>
                <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-[0.1em] h-9 text-right">Maks Diskon</TableHead>
                <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-[0.1em] h-9 text-center">Status</TableHead>
                <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-[0.1em] h-9 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promos.map((promo) => (
                <TableRow key={promo.id} className="border-white/[0.04] hover:bg-white/[0.015]">
                  <TableCell className="text-[13px] text-slate-200 font-medium py-2.5">{promo.name}</TableCell>
                  <TableCell className="py-2.5">
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
                  <TableCell className="text-[13px] text-slate-400 py-2.5">
                    {promo.categoryId ? (promo.categoryName || 'Kategori spesifik') : (
                      <span className="text-slate-500">Semua</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-200 text-right py-2.5">
                    {promo.type === 'BUY_X_GET_DISCOUNT'
                      ? `${promo.buyMinQty || 2} item → ${promo.discountType === 'PERCENTAGE' ? `${promo.value}%` : formatCurrency(promo.value)}`
                      : promo.type === 'PERCENTAGE' ? `${promo.value}%` : formatCurrency(promo.value)}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-400 text-right py-2.5">
                    {promo.minPurchase ? formatCurrency(promo.minPurchase) : '-'}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-400 text-right py-2.5">
                    {promo.maxDiscount ? formatCurrency(promo.maxDiscount) : '-'}
                  </TableCell>
                  <TableCell className="text-center py-2.5">
                    <Badge
                      className={`text-[11px] ${
                        promo.active
                          ? 'theme-accent-bg theme-accent-border theme-accent-text'
                          : 'bg-white/[0.04] border-white/[0.08] text-slate-500'
                      }`}
                    >
                      {promo.active ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right py-2.5">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/[0.04]"
                        onClick={() => openEdit(promo)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
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
        <ResponsiveDialogContent className="bg-[#0c0d10] border-white/[0.06] p-6 shadow-xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-[15px] font-semibold text-white">
              {editPromo ? 'Edit Promo' : 'Tambah Promo Baru'}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-5 py-2">
            <div>
              <p className="text-[12px] text-slate-500 mb-2 font-medium">Kategori (opsional)</p>
              <Select
                value={formData.categoryId}
                onValueChange={(v) => setFormData((p) => ({ ...p, categoryId: v }))}
              >
                <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-white w-full h-10 text-[13px] rounded-lg">
                  <SelectValue placeholder="Semua Kategori" />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0d10] border-white/[0.06]">
                  <SelectItem value="__all__">Semua Kategori</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-600 mt-1">Kosongkan untuk berlaku ke semua kategori</p>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 mb-2 font-medium">Nama Promo</p>
              <StripeInput
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="Contoh: Diskon Akhir Tahun"
              />
            </div>
            <div>
              <p className="text-[12px] text-slate-500 mb-2 font-medium">Tipe Diskon</p>
              <Select
                value={formData.type}
                onValueChange={(v) => setFormData((p) => ({ ...p, type: v }))}
              >
                <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-white w-full h-10 text-[13px] rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0d10] border-white/[0.06]">
                  <SelectItem value="PERCENTAGE">Persentase (%)</SelectItem>
                  <SelectItem value="NOMINAL">Nominal (Rp)</SelectItem>
                  <SelectItem value="BUY_X_GET_DISCOUNT">Beli N Produk Diskon</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[12px] text-slate-500 mb-2 font-medium">
                Nilai Diskon {formData.type === 'PERCENTAGE' || (formData.type === 'BUY_X_GET_DISCOUNT' && formData.discountType === 'PERCENTAGE') ? '(%)' : '(Rp)'}
              </p>
              <StripeInput
                type="number"
                min="0"
                value={formData.value}
                onChange={(e) => setFormData((p) => ({ ...p, value: e.target.value }))}
                placeholder={formData.type === 'PERCENTAGE' ? '10' : '50000'}
              />
            </div>
            <div>
              <p className="text-[12px] text-slate-500 mb-2 font-medium">Minimum Pembayaran (opsional)</p>
              <StripeInput
                type="number"
                min="0"
                value={formData.minPurchase}
                onChange={(e) => setFormData((p) => ({ ...p, minPurchase: e.target.value }))}
                placeholder="100000"
              />
            </div>
            {(formData.type === 'PERCENTAGE' || formData.type === 'BUY_X_GET_DISCOUNT') && (
              <div>
                <p className="text-[12px] text-slate-500 mb-2 font-medium">Maks Diskon (opsional)</p>
                <StripeInput
                  type="number"
                  min="0"
                  value={formData.maxDiscount}
                  onChange={(e) => setFormData((p) => ({ ...p, maxDiscount: e.target.value }))}
                  placeholder="50000"
                />
              </div>
            )}
            {formData.type === 'BUY_X_GET_DISCOUNT' && (
              <>
                <div>
                  <p className="text-[12px] text-slate-500 mb-2 font-medium">Minimal Jumlah Item</p>
                  <StripeInput
                    type="number"
                    min="2"
                    value={formData.buyMinQty}
                    onChange={(e) => setFormData((p) => ({ ...p, buyMinQty: e.target.value }))}
                    placeholder="2"
                  />
                  <p className="text-[11px] text-slate-600 mt-1">Minimal jumlah item di keranjang untuk mendapat diskon</p>
                </div>
                <div>
                  <p className="text-[12px] text-slate-500 mb-2 font-medium">Tipe Diskon</p>
                  <Select
                    value={formData.discountType}
                    onValueChange={(v) => setFormData((p) => ({ ...p, discountType: v }))}
                  >
                    <SelectTrigger className="bg-white/[0.03] border-white/[0.06] text-white w-full h-10 text-[13px] rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0c0d10] border-white/[0.06]">
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
              <span className="text-[13px] text-slate-300">Promo aktif</span>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] h-9 text-[13px]"
            >
              Batal
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !formData.name || !formData.value}
              className="theme-btn-primary h-9 text-[13px]"
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {editPromo ? 'Perbarui' : 'Tambah'}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent className="bg-[#0c0d10] border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px] font-semibold text-white">Hapus Promo</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-slate-400">
              Apakah Anda yakin ingin menghapus promo ini? Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] border-white/[0.06] text-slate-300 hover:bg-white/[0.06] h-9 text-[13px]" />
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white h-9 text-[13px]"
            >
              {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ==================== THEME & RECEIPT ====================

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
        <Skeleton className="h-4 w-36 bg-white/[0.03]" />
        <SectionBox>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
        </SectionBox>
      </div>
    )
  }

  return (
    <div className="space-y-8 min-w-0">
      {/* Desktop: 2-col layout — form left (3/5), preview right (2/5) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left column: Theme + Receipt Form */}
        <div className="lg:col-span-3 space-y-8 min-w-0">
          {/* Theme Section */}
          <div>
            <SectionHeader title="Tema Warna" description="Kustomisasi tampilan aplikasi" />
            <SectionBox>
              <div className="p-5">
                <p className="text-[12px] text-slate-500 mb-3 font-medium">Warna tema utama</p>
                <div className="flex items-center gap-3 flex-wrap">
                  {THEME_COLORS.map((color) => {
                    const isSelected = themeColor === color.name
                    return (
                      <button
                        key={color.name}
                        onClick={() => handleChange('themeColor', color.name)}
                        className={`relative w-8 h-8 rounded-full ${color.classes} flex items-center justify-center transition-all duration-150 ${
                          isSelected ? 'ring-2 ring-offset-2 ring-offset-transparent ring-white/50 scale-110' : 'hover:scale-105'
                        }`}
                        title={color.label}
                      >
                        {isSelected && <Check className="h-4 w-4 text-white" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </SectionBox>
          </div>

          {/* Receipt Section */}
          <div>
            <SectionHeader title="Pengaturan Struk" description="Informasi yang ditampilkan pada struk belanja" />
            <SectionBox>
              <div className="p-5">
                <p className="text-[12px] text-slate-500 mb-2 font-medium">Nama Usaha</p>
                <StripeInput
                  value={receiptBusinessName}
                  onChange={(e) => handleChange('receiptBusinessName', e.target.value)}
                  placeholder="Masukkan nama usaha"
                />
              </div>
              <div className="p-5">
                <p className="text-[12px] text-slate-500 mb-2 font-medium">Alamat</p>
                <StripeTextarea
                  value={receiptAddress}
                  onChange={(e) => handleChange('receiptAddress', e.target.value)}
                  placeholder="Masukkan alamat usaha"
                  rows={2}
                />
              </div>
              {/* Desktop: phone + footer side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-white/[0.04]">
                <div className="p-5">
                  <p className="text-[12px] text-slate-500 mb-2 font-medium">Telepon</p>
                  <StripeInput
                    value={receiptPhone}
                    onChange={(e) => handleChange('receiptPhone', e.target.value)}
                    placeholder="08xxxxxxxxxx"
                  />
                </div>
                <div className="p-5">
                  <p className="text-[12px] text-slate-500 mb-2 font-medium">Pesan Footer</p>
                  <StripeInput
                    value={receiptFooter}
                    onChange={(e) => handleChange('receiptFooter', e.target.value)}
                    placeholder="Terima kasih atas kunjungan Anda!"
                  />
                </div>
              </div>
              <div className="p-5">
                <p className="text-[12px] text-slate-500 mb-2 font-medium">Logo Outlet (Image URL)</p>
                <div className="flex items-center gap-2">
                  <StripeInput
                    value={receiptLogo}
                    onChange={(e) => handleChange('receiptLogo', e.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="flex-1 min-w-0"
                  />
                  {receiptLogo && (
                    <button
                      type="button"
                      className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
                      onClick={() => handleChange('receiptLogo', '')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {receiptLogo && (
                  <div className="mt-3 flex items-center gap-3 p-3 rounded-lg bg-white/[0.015] border border-white/[0.04]">
                    <img
                      src={receiptLogo}
                      alt="Logo Preview"
                      className="h-12 w-12 rounded-lg object-contain bg-white p-1"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium theme-text">Logo berhasil dimuat</p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">{receiptLogo}</p>
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-slate-600 mt-1.5">Masukkan URL gambar logo. Logo akan ditampilkan pada struk belanja.</p>
              </div>
            </SectionBox>

            {/* Save Button */}
            <div className="flex justify-end mt-4">
              <SaveButton onClick={handleSave} disabled={saving || !dirty} saving={saving} />
            </div>
          </div>
        </div>

        {/* Right column: Receipt Preview — sticky on desktop */}
        <div className="lg:col-span-2 min-w-0">
          <div className="lg:sticky lg:top-4">
            <div className="mb-4">
              <h2 className="text-[15px] font-semibold text-white">Pratinjau Struk</h2>
              <p className="text-[13px] text-slate-400 mt-1">Tampilan struk yang akan dicetak</p>
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
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== TELEGRAM NOTIFICATION ====================

function TelegramTab() {
  const { settings, loading, saving, saveSettings, setSettings } = useSettings()
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
      <div className="space-y-4">
        <Skeleton className="h-4 w-36 bg-white/[0.03]" />
        <SectionBox>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
        </SectionBox>
      </div>
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
    <div className="space-y-8">
      {/* Setup Instructions — clean callout */}
      <div className="bg-[#0c0d10] rounded-xl border border-sky-500/10 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
            <CircleHelp className="h-3.5 w-3.5 text-sky-400" strokeWidth={1.5} />
          </div>
          <h2 className="text-[14px] font-semibold text-white">Cara Setup Telegram Bot</h2>
        </div>

        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[11px] font-bold text-sky-400">1</span>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-slate-200">Buat Bot Token dari BotFather</p>
              <p className="text-[12px] text-slate-400 mt-0.5">
                Buka Telegram, cari <span className="text-sky-300 font-medium">@BotFather</span>. Kirim pesan <code className="bg-white/[0.04] px-1.5 py-0.5 rounded text-[11px] text-sky-300">/newbot</code>, ikuti instruksi, lalu copy <span className="text-slate-300">Bot Token</span> yang diberikan.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[11px] font-bold text-sky-400">2</span>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-slate-200">Dapatkan Chat ID</p>
              <p className="text-[12px] text-slate-400 mt-0.5">
                Kirim pesan apapun ke bot yang baru dibuat. Lalu buka browser, akses:{' '}
                <code className="bg-white/[0.04] px-1.5 py-0.5 rounded text-[11px] text-sky-300 break-all">
                  https://api.telegram.org/bot{'{TOKEN}'}/getUpdates
                </code>
                {' '}Cari <span className="text-slate-300">chat.id</span> di response JSON.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[11px] font-bold text-sky-400">3</span>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-slate-200">Masukkan & Test Koneksi</p>
              <p className="text-[12px] text-slate-400 mt-0.5">
                Paste <span className="text-slate-300">Bot Token</span> dan <span className="text-slate-300">Chat ID</span> di form bawah, lalu klik <span className="theme-text font-medium">Test Koneksi</span>. Jika berhasil, klik <span className="theme-text font-medium">Simpan</span>.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
          <MessageSquare className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[12px] text-slate-400">
            <span className="text-amber-400 font-medium">Tips:</span> Pastikan bot sudah di-Start (klik Start di chat bot) sebelum test koneksi. Chat ID biasanya berupa angka (contoh: <span className="text-slate-300">123456789</span>).
          </p>
        </div>
      </div>

      {/* Connection + Notifications side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Connection Section */}
        <div className="min-w-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold text-white">Koneksi Telegram</h2>
              <p className="text-[13px] text-slate-400 mt-1">Hubungkan bot untuk notifikasi otomatis</p>
            </div>
            <Badge
              className={`text-[11px] ${
                isConnected
                  ? 'theme-bg-very-light theme-border-light theme-text'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-500'
              }`}
            >
              {isConnected ? (
                <span className="flex items-center gap-1"><Wifi className="h-3 w-3" /> Terhubung</span>
              ) : (
                <span className="flex items-center gap-1"><WifiOff className="h-3 w-3" /> Tidak Terhubung</span>
              )}
            </Badge>
          </div>

          <SectionBox>
            <div className="p-5">
              <p className="text-[12px] text-slate-500 mb-2 font-medium">Bot Token</p>
              <div className="relative">
                <StripeInput
                  type={showToken ? 'text' : 'password'}
                  value={botToken}
                  onChange={(e) => { setBotToken(e.target.value); setDirty(true) }}
                  placeholder={settings?.telegramBotToken === '••••••' ? 'Token tersimpan (kosongkan untuk mengganti)' : 'Masukkan token dari @BotFather'}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="p-5">
              <p className="text-[12px] text-slate-500 mb-2 font-medium">Chat ID</p>
              <StripeInput
                value={chatId}
                onChange={(e) => { setChatId(e.target.value); setDirty(true) }}
                placeholder="Contoh: 123456789"
              />
            </div>
            <div className="p-5">
              <button
                onClick={handleTestConnection}
                disabled={testing || !botToken}
                className="w-full text-[13px] font-medium border border-white/[0.06] rounded-lg py-2.5 text-slate-300 hover:bg-white/[0.04] hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-1.5"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Test Koneksi
              </button>
            </div>

            {/* Test Result */}
            {testResult && (
              <div className="mx-6 mb-4 rounded-lg border p-3">
                <div className={`rounded-lg border p-3 ${
                  testResult.ok
                    ? 'theme-bg-ultra-light theme-border-light'
                    : 'bg-red-500/5 border-red-500/20'
                }`}>
                  <div className="flex items-center gap-1.5">
                    {testResult.ok ? (
                      <Check className="h-4 w-4 theme-text" />
                    ) : (
                      <Unlink2 className="h-4 w-4 text-red-400" />
                    )}
                    <p className={`text-[13px] font-medium ${testResult.ok ? 'theme-text' : 'text-red-400'}`}>
                      {testResult.message}
                    </p>
                  </div>
                  {testResult.botName && (
                    <p className="text-[12px] text-slate-400 mt-1 ml-5.5">Bot: {testResult.botName}</p>
                  )}
                </div>
              </div>
            )}

            {/* Status info */}
            {isConnected && (
              <div className="px-6 py-3 flex items-center gap-2 text-[12px] text-slate-500">
                <Link2 className="h-3.5 w-3.5" />
                <span>Chat ID: {settings?.telegramChatId}</span>
              </div>
            )}
          </SectionBox>

          <div className="flex gap-3 justify-end mt-4">
            {isConnected && (
              <button
                onClick={handleDisconnect}
                className="text-[13px] font-medium text-red-400 hover:text-red-300 transition-colors duration-150 flex items-center gap-1.5"
              >
                <Unlink2 className="h-3.5 w-3.5" />
                Putuskan
              </button>
            )}
            <SaveButton onClick={handleSave} disabled={saving || !dirty} saving={saving} />
          </div>
        </div>

        {/* Notification Toggles */}
        <div className="min-w-0">
          <SectionHeader title="Jenis Notifikasi" description="Pilih event yang ingin dikirim via Telegram" />
          <SectionBox>
            {notificationToggles.map((item) => (
              <SettingsRow key={item.key} label={item.label} description={item.desc}>
                <Switch
                  checked={!!settings?.[item.key]}
                  onCheckedChange={(v) => handleToggle(item.key, v)}
                  className="theme-switch"
                />
              </SettingsRow>
            ))}
          </SectionBox>
        </div>
      </div>
    </div>
  )
}

// ==================== PLAN & LANGGANAN ====================

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
          <span className={isAtLimit ? 'text-red-400' : isNearLimit ? 'text-amber-400' : 'text-slate-200'}>{icon}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-slate-300 font-medium">{label}</p>
        <p className={`text-[12px] ${isAtLimit ? 'text-red-400' : isNearLimit ? 'text-amber-400' : 'text-slate-500'}`}>
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
        <Skeleton className="h-4 w-36 bg-white/[0.03]" />
        <SectionBox>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
        </SectionBox>
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
    { label: 'Upload & Edit Excel', key: 'bulkUpload' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Promo', key: 'maxPromos' as const, format: (v: number) => formatLimit(v) },
    { label: 'Audit Log', key: 'auditLog' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Stock Movement', key: 'stockMovement' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Offline Mode', key: 'offlineMode' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
    { label: 'Multi-Outlet', key: 'multiOutlet' as const, format: (v: boolean) => v ? 'Ya' : 'Tidak' },
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
    pro: { border: 'theme-border-light', bg: 'theme-bg-ultra-light', text: 'theme-text', icon: 'theme-bg-very-light theme-text' },
    enterprise: { border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400', icon: 'bg-amber-500/10 text-amber-400' },
  }

  return (
    <div className="space-y-8">
      {/* ===== SECTION 1: Current Plan ===== */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <SectionHeader title="Langganan" description="Informasi paket langganan outlet Anda" />
          <div className="shrink-0 ml-4 flex items-center gap-2">
            {plan?.isSuspended ? (
              <Badge className="bg-red-500/10 border-red-500/20 text-red-400 text-[13px] font-semibold px-2.5 py-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mr-1.5" />
                Ditangguhkan
              </Badge>
            ) : (
              <Badge className={`${getPlanBadgeClass(currentPlan)} text-[13px] font-semibold px-2.5 py-1`}>
                {getPlanLabel(currentPlan)}
              </Badge>
            )}
          </div>
        </div>

        {/* Suspended warning */}
        {plan?.isSuspended && (
          <Alert className="border-red-500/20 bg-red-500/5 p-4 mb-4">
            <AlertDescription className="text-[13px] text-red-400">
              Akun Anda saat ini ditangguhkan. Hubungi admin untuk informasi lebih lanjut.
            </AlertDescription>
          </Alert>
        )}

        {/* Account & Plan Info */}
        {planData && (
          <SectionBox className="mb-6">
            <SettingsRow label="Nama Outlet">
              <span className="text-[13px] font-medium text-slate-200">{planData.outletName || '-'}</span>
            </SettingsRow>
            <SettingsRow label="Tipe Plan">
              <span className={`text-[13px] font-medium ${planAccent[currentPlan].text}`}>{getPlanLabel(currentPlan)}</span>
            </SettingsRow>
            <SettingsRow label="Status">
              <Badge className={`text-[11px] px-1.5 py-0 ${plan?.isSuspended ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'theme-bg-very-light theme-border-light theme-text'}`}>
                {plan?.isSuspended ? 'Ditangguhkan' : 'Aktif'}
              </Badge>
            </SettingsRow>
            <SettingsRow label="Harga">
              <span className="text-[13px] font-medium text-slate-200">
                {PLAN_PRICING[currentPlan].price}{PLAN_PRICING[currentPlan].period && <span className="text-slate-500 font-normal">{PLAN_PRICING[currentPlan].period}</span>}
              </span>
            </SettingsRow>
          </SectionBox>
        )}

        {/* Usage Stats with Circular Rings */}
        {features && usage && (
          <div className="space-y-3 mb-6">
            <SectionGroupLabel>Penggunaan Saat Ini</SectionGroupLabel>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
          <div className={`rounded-xl border theme-border-light theme-bg-ultra-light p-5`}>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg theme-bg-very-light flex items-center justify-center shrink-0 mt-0.5">
                <Zap className="h-4 w-4 theme-text" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div>
                  <p className="text-[14px] font-semibold theme-text">Upgrade ke Pro</p>
                  <p className="text-[12px] text-slate-400 mt-1">
                    Unlimited produk, export Excel, API access, foto produk, dan banyak lagi.
                  </p>
                  <p className="text-[14px] font-semibold theme-text mt-2">
                    {PLAN_PRICING.pro.price}<span className="theme-text/60 font-normal">{PLAN_PRICING.pro.period}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleUpgrade('pro')}
                    size="sm"
                    className="theme-btn-primary h-8 text-[12px]"
                  >
                    Upgrade ke Pro
                    <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Button>
                  <Button
                    onClick={() => handleUpgrade('enterprise')}
                    variant="outline"
                    size="sm"
                    className="border-white/[0.08] text-slate-300 hover:bg-white/[0.04] h-8 text-[12px]"
                  >
                    Upgrade ke Enterprise
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentPlan === 'pro' && !plan?.isSuspended && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <Crown className="h-4 w-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div>
                  <p className="text-[14px] font-semibold text-amber-300">Upgrade ke Enterprise</p>
                  <p className="text-[12px] text-slate-400 mt-1">
                    Multi-outlet management untuk bisnis yang berkembang dengan kontrol penuh.
                  </p>
                  <p className="text-[14px] font-semibold text-amber-400 mt-2">
                    {PLAN_PRICING.enterprise.price}<span className="text-amber-400/60 font-normal">{PLAN_PRICING.enterprise.period}</span>
                  </p>
                </div>
                <Button
                  onClick={() => handleUpgrade('enterprise')}
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600 text-white h-8 text-[12px]"
                >
                  Upgrade ke Enterprise
                  <ArrowUpRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {currentPlan === 'enterprise' && !plan?.isSuspended && (
          <div className={`rounded-xl border ${planAccent.enterprise.border} ${planAccent.enterprise.bg} p-5`}>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg ${planAccent.enterprise.icon} flex items-center justify-center shrink-0`}>
                <Crown className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-amber-300">Current Plan — Semua fitur terbuka</p>
                <p className="text-[12px] text-slate-400 mt-1">
                  Anda memiliki akses penuh ke semua fitur Aether POS termasuk multi-outlet.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ===== SECTION 3: Manage Subscription ===== */}
        <div className="border-t border-white/[0.06] pt-5 mt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-slate-300">Kelola Langganan</p>
              <p className="text-[12px] text-slate-500 mt-0.5">Upgrade, downgrade, atau perubahan plan lainnya</p>
            </div>
            <Button
              onClick={handleContactAdmin}
              variant="outline"
              size="sm"
              className="border-white/[0.08] text-slate-300 hover:bg-white/[0.04] h-8 text-[12px] gap-1.5"
            >
              <Send className="h-3.5 w-3.5" />
              Hubungi Admin
            </Button>
          </div>
        </div>
      </div>

      {/* ===== SECTION 4: Plan Comparison ===== */}
      <div>
        <SectionHeader title="Perbandingan Plan" description="Bandingkan fitur dari setiap paket langganan" />

        {/* Pricing Cards Row */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {planKeys.map((key) => {
            const pricing = PLAN_PRICING[key]
            const isCurrent = key === currentPlan
            const accent = planAccent[key]
            return (
              <div
                key={key}
                className={`rounded-xl border p-4 text-center space-y-2.5 transition-all duration-150 ${
                  isCurrent
                    ? `${accent.border} ${accent.bg}`
                    : 'border-white/[0.05] hover:bg-white/[0.015] hover:border-white/[0.08]'
                }`}
              >
                <Badge className={`${getPlanBadgeClass(key)} text-[11px] font-semibold px-2 py-0`}>
                  {getPlanLabel(key)}
                </Badge>
                <div>
                  <p className={`text-[14px] font-bold ${isCurrent ? accent.text : 'text-slate-200'}`}>
                    {pricing.price}
                  </p>
                  {pricing.period && (
                    <p className="text-[11px] text-slate-500">{pricing.period}</p>
                  )}
                </div>
                {isCurrent && (
                  <span className="text-[11px] theme-text font-medium">Plan Anda</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block bg-[#0c0d10] rounded-xl border border-white/[0.05] overflow-hidden max-h-[420px] overflow-y-auto shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.04] hover:bg-transparent bg-white/[0.015] sticky top-0 z-10">
                <TableHead className="text-[11px] text-slate-500 font-medium uppercase tracking-[0.1em] h-9 w-[180px]">Fitur</TableHead>
                {planKeys.map((key) => (
                  <TableHead key={key} className="text-center text-[11px] font-medium h-9">
                    <div className="flex flex-col items-center gap-1">
                      <Badge className={`${getPlanBadgeClass(key)} text-[10px] font-semibold px-2 py-0`}>
                        {getPlanLabel(key)}
                      </Badge>
                      {key === currentPlan && (
                        <span className="text-[9px] theme-text font-medium">Plan Anda</span>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisonRows.map((row, idx) => (
                <TableRow key={row.key} className={`border-white/[0.06] hover:bg-transparent ${idx % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
                  <TableCell className="text-[13px] text-slate-300 font-medium py-2.5">{row.label}</TableCell>
                  {planKeys.map((key) => {
                    const planFeatures = PLANS[key]
                    const value = planFeatures[row.key]
                    const display = row.format(value as number & boolean)
                    const isCurrentPlan = key === currentPlan
                    const isBoolean = typeof value === 'boolean'
                    const isUnlimitedValue = typeof value === 'number' && value === -1

                    return (
                      <TableCell key={key} className={`text-center py-2.5 ${isCurrentPlan ? 'bg-white/[0.02]' : ''}`}>
                        {isBoolean ? (
                          value ? (
                            <Check className="h-4 w-4 theme-text mx-auto" />
                          ) : (
                            <X className="h-3.5 w-3.5 text-slate-600 mx-auto" />
                          )
                        ) : (
                          <span className={`text-[13px] font-medium ${isUnlimitedValue ? 'theme-text' : isCurrentPlan ? 'text-slate-200' : 'text-slate-400'}`}>
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
                className={`rounded-xl border p-4 space-y-3 transition-colors ${
                  isCurrentPlan
                    ? `${accent.border} ${accent.bg}`
                    : 'border-white/[0.06] bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Badge className={`${getPlanBadgeClass(key)} text-[11px] font-semibold px-2 py-0`}>
                    {getPlanLabel(key)}
                  </Badge>
                  {isCurrentPlan && (
                    <span className="text-[11px] theme-text font-medium">Plan Anda</span>
                  )}
                </div>
                <p className={`text-[14px] font-bold ${isCurrentPlan ? accent.text : 'text-slate-200'}`}>
                  {PLAN_PRICING[key].price}{PLAN_PRICING[key].period && <span className="text-slate-500 font-normal text-[12px]">{PLAN_PRICING[key].period}</span>}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {comparisonRows.map((row) => {
                    const value = planFeatures[row.key]
                    const display = row.format(value as number & boolean)
                    const isBoolean = typeof value === 'boolean'
                    const isUnlimitedValue = typeof value === 'number' && value === -1

                    return (
                      <div key={row.key} className="flex items-center justify-between py-0.5">
                        <span className="text-[11px] text-slate-500">{row.label}</span>
                        {isBoolean ? (
                          value ? (
                            <Check className="h-3.5 w-3.5 theme-text" />
                          ) : (
                            <X className="h-3 w-3 text-slate-600" />
                          )
                        ) : (
                          <span className={`text-[11px] font-medium ${isUnlimitedValue ? 'theme-text' : 'text-slate-300'}`}>
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
                    className="w-full border-white/[0.08] text-slate-300 hover:bg-white/[0.04] h-8 text-[12px]"
                  >
                    Upgrade ke {getPlanLabel(key)}
                    <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Button>
                )}
                {isCurrentPlan && (
                  <div className="text-center pt-0.5">
                    <span className="text-[11px] theme-text font-medium">✓ Plan aktif</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ==================== ACCOUNT ====================

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
    <div className="space-y-8">
      {/* Account Info */}
      <div>
        <SectionHeader title="Akun" description="Detail akun yang sedang digunakan" />
        <SectionBox>
          <SettingsRow label="Nama">
            <span className="text-[13px] font-medium text-slate-200">{session?.user?.name || '-'}</span>
          </SettingsRow>
          <SettingsRow label="Email">
            <span className="text-[13px] font-medium text-slate-200">{session?.user?.email || '-'}</span>
          </SettingsRow>
          <SettingsRow label="Peran">
            <Badge
              variant="outline"
              className={`text-[11px] px-1.5 py-0 ${
                session?.user?.role === 'OWNER'
                  ? 'bg-amber-500/10 border-amber-500/15 text-amber-400'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-500'
              }`}
            >
              {session?.user?.role === 'OWNER' ? 'Owner' : 'Crew'}
            </Badge>
          </SettingsRow>
        </SectionBox>
      </div>

      {/* Change Email + Password side by side on desktop */}
      <div>
        <SectionHeader title="Keamanan" description="Ubah email dan password akun Anda" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Change Email */}
          <div className="min-w-0">
            <div className="bg-[#0c0d10] rounded-xl border border-white/[0.05] p-5 space-y-5 shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
              <div>
                <p className="text-[12px] text-slate-500 mb-2 font-medium">Email Baru</p>
                <StripeInput
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="email@contoh.com"
                />
              </div>
              <div>
                <p className="text-[12px] text-slate-500 mb-2 font-medium">Konfirmasi Password</p>
                <StripeInput
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  placeholder="Masukkan password saat ini"
                />
              </div>
              <button
                onClick={handleChangeEmail}
                disabled={changingEmail || !newEmail || !emailPassword}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-white/[0.06] text-white hover:bg-white/[0.10] disabled:bg-white/[0.03] disabled:text-slate-600 disabled:cursor-not-allowed border border-white/[0.06] hover:border-white/[0.10] transition-all duration-200"
              >
                {changingEmail ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Ganti Email
              </button>
            </div>
          </div>

          {/* Change Password */}
          <div className="min-w-0">
            <div className="bg-[#0c0d10] rounded-xl border border-white/[0.05] p-5 space-y-5 shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
              <div>
                <p className="text-[12px] text-slate-500 mb-2 font-medium">Password Saat Ini</p>
                <StripeInput
                  type="password"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  placeholder="Masukkan password saat ini"
                />
              </div>
              <div>
                <p className="text-[12px] text-slate-500 mb-2 font-medium">Password Baru</p>
                <StripeInput
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="Minimal 6 karakter"
                />
              </div>
              <div>
                <p className="text-[12px] text-slate-500 mb-2 font-medium">Konfirmasi Password Baru</p>
                <StripeInput
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  placeholder="Ulangi password baru"
                />
              </div>
              <button
                onClick={handleChangePassword}
                disabled={changingPwd || !currentPwd || !newPwd || !confirmPwd || newPwd !== confirmPwd || newPwd.length < 6}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-white/[0.06] text-white hover:bg-white/[0.10] disabled:bg-white/[0.03] disabled:text-slate-600 disabled:cursor-not-allowed border border-white/[0.06] hover:border-white/[0.10] transition-all duration-200"
              >
                {changingPwd ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" />
                )}
                Ganti Password
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ==================== MULTI-OUTLET ====================

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
      <div className="space-y-4">
        <Skeleton className="h-4 w-36 bg-white/[0.03]" />
        <SectionBox>
          <div className="p-5"><Skeleton className="h-5 w-full bg-white/[0.03]" /></div>
        </SectionBox>
      </div>
    )
  }

  const isEnterprise = settings?.outlet?.accountType === 'enterprise' || canAddMore

  if (!isEnterprise) {
    return (
      <div>
        <SectionHeader title="Outlet Cabang" description="Kelola beberapa outlet dalam satu akun" />
        <SectionBox>
          <SettingsRow label="Outlet Utama (Aktif)">
            <span className="text-[13px] font-medium text-slate-200">{settings?.outlet?.name || '-'}</span>
          </SettingsRow>
        </SectionBox>
        <div className="border border-white/[0.06] rounded-xl p-4 mt-4">
          <p className="text-[12px] text-slate-500 text-center">
            Multi-outlet tersedia untuk akun <span className="text-amber-400 font-medium">Enterprise</span>. Upgrade untuk mengakses fitur ini.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionHeader title="Outlet Cabang" description={`${outlets.length} outlet terdaftar`} />
        {canAddMore && (
          <Button disabled
            className="theme-btn-primary h-8 text-[12px] opacity-50 cursor-not-allowed flex items-center gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" />
            Tambah Cabang
            <Lock className="h-3 w-3 ml-1" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {outlets.map((outlet) => (
          <div key={outlet.id}
            className={`rounded-xl border p-4 space-y-2 transition-colors ${
              outlet.isPrimary
                ? 'theme-border-light theme-bg-ultra-light'
                : 'border-white/[0.06] hover:border-white/[0.10]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className={`h-4 w-4 shrink-0 ${outlet.isPrimary ? 'theme-text' : 'text-slate-500'}`} />
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold truncate ${outlet.isPrimary ? 'theme-text' : 'text-slate-200'}`}>
                    {outlet.name}
                    {outlet.isPrimary && <span className="ml-1.5 text-[11px] font-normal theme-text">(Utama)</span>}
                  </p>
                  {outlet.address && <p className="text-[12px] text-slate-500 truncate">{outlet.address}</p>}
                </div>
              </div>
              {!outlet.isPrimary && (
                <Button variant="ghost" size="icon"
                  className="h-7 w-7 text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                  onClick={() => setDeleteId(outlet.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="flex gap-3 text-[11px] text-slate-500">
              {outlet.userCount > 0 && <span>{outlet.userCount} crew</span>}
              {outlet.productCount > 0 && <span>{outlet.productCount} produk</span>}
              {outlet.customerCount > 0 && <span>{outlet.customerCount} customer</span>}
              <span>{outlet.transactionCount} transaksi</span>
            </div>
          </div>
        ))}
      </div>

      {outlets.length === 0 && (
        <div className="bg-[#0c0d10] rounded-xl border border-white/[0.05] py-14 text-center">
          <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center mx-auto mb-3">
            <Building2 className="h-5 w-5 text-slate-600" />
          </div>
          <p className="text-[13px] text-slate-400 font-medium">Belum ada outlet cabang</p>
          <p className="text-[12px] text-slate-600 mt-0.5">Tambahkan outlet cabang untuk memperluas bisnis Anda</p>
        </div>
      )}

      <div className="border border-amber-500/20 bg-amber-500/[0.03] rounded-xl p-3 mt-4">
        <p className="text-[12px] text-amber-400 text-center">
          🔒 Fitur <span className="font-medium">Tambah Cabang</span> sedang dalam pengembangan. Segera hadir!
        </p>
      </div>

      {/* Add Outlet Dialog */}
      <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <ResponsiveDialogContent className="bg-[#0c0d10] border-white/[0.06] p-6 shadow-xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-[15px] font-semibold text-white">Tambah Outlet Cabang</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-5 py-2">
            <div>
              <p className="text-[12px] text-slate-500 mb-2 font-medium">Nama Outlet *</p>
              <StripeInput
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="Contoh: Toko Cabang Pondok Indah"
              />
            </div>
            <div>
              <p className="text-[12px] text-slate-500 mb-2 font-medium">Alamat</p>
              <StripeInput
                value={formData.address}
                onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))}
                placeholder="Jl. Merdeka No. 10"
              />
            </div>
            <div>
              <p className="text-[12px] text-slate-500 mb-2 font-medium">Telepon</p>
              <StripeInput
                value={formData.phone}
                onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
                placeholder="081234567890"
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}
              className="bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] h-9 text-[13px]">
              Batal
            </Button>
            <Button onClick={handleCreate} disabled={saving || !formData.name.trim()}
              className="theme-btn-primary h-9 text-[13px]">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Tambah Outlet
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-[#0c0d10] border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px] font-semibold text-white">Hapus Outlet</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-slate-400">
              Apakah Anda yakin ingin menghapus outlet ini? Semua data (produk, customer, transaksi, crew) akan dihapus permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] border-white/[0.06] text-slate-300 hover:bg-white/[0.06] h-9 text-[13px]" />
            <AlertDialogAction onClick={handleDelete} disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white h-9 text-[13px]">
              {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}