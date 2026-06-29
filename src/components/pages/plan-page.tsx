'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { usePlan } from '@/hooks/use-plan'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Crown,
  Check,
  X,
  ArrowUpRight,
  Tag,
  Palette,
  KeyRound,
  Star,
  Receipt,
  ExternalLink,
} from 'lucide-react'

// ============================================================
// Types
// ============================================================

interface PlanFeature {
  [key: string]: boolean | number | string[]
}

interface PlanRow {
  id: string
  name: string
  slug: string
  price: number
  duration: number
  paymentLink: string | null
  features: string // JSON
  active: boolean
  sortOrder: number
  description: string | null
}

interface PlanData {
  plans: PlanRow[]
  currentPlan: string
}

// ============================================================
// Feature label map (Indonesian)
// ============================================================

const FEATURE_LABELS: Record<string, string> = {
  maxProducts: 'Maks Produk',
  maxCategories: 'Maks Kategori',
  productImage: 'Foto Produk',
  maxCrew: 'Maks Crew',
  crewPermissions: 'Hak Akses Crew',
  maxCustomers: 'Maks Pelanggan',
  loyaltyProgram: 'Program Loyalti',
  maxTransactionsPerMonth: 'Transaksi/Bulan',
  exportExcel: 'Export Excel',
  maxPromos: 'Maks Promo',
  auditLog: 'Audit Log',
  stockMovement: 'Stock Movement',
  dashboardAnalytics: 'Dashboard Analitik',
  aiInsights: 'AI Insights',
  forecasting: 'Forecasting',
  offlineMode: 'Mode Offline',
  multiOutlet: 'Multi-Outlet',
  bulkUpload: 'Upload Bulk Excel',
  transactionSummary: 'Ringkasan Transaksi',
  apiAccess: 'API Access',
  prioritySupport: 'Support Prioritas',
  promoTypes: 'Tipe Promo',
}

// Display order for features in the table
const FEATURE_ORDER = [
  'maxProducts', 'maxCategories', 'productImage',
  'maxCrew', 'crewPermissions',
  'maxCustomers', 'loyaltyProgram',
  'maxTransactionsPerMonth', 'exportExcel',
  'maxPromos', 'promoTypes',
  'auditLog', 'stockMovement', 'dashboardAnalytics',
  'aiInsights', 'forecasting',
  'offlineMode', 'multiOutlet', 'bulkUpload',
  'transactionSummary', 'apiAccess', 'prioritySupport',
]

// ============================================================
// Helpers
// ============================================================

function parseFeatures(json: string): PlanFeature {
  try { return JSON.parse(json) } catch { return {} }
}

function formatDuration(months: number): string {
  if (months === 1) return '/bulan'
  if (months === 3) return '/3 bulan'
  if (months === 6) return '/6 bulan'
  if (months === 12) return '/tahun'
  return `/${months} bulan`
}

function getPlanBadge(slug: string): string {
  switch (slug) {
    case 'pro': return 'bg-violet-500/10 border-violet-500/20 text-violet-400'
    case 'enterprise': return 'bg-amber-500/10 border-amber-500/20 text-amber-400'
    default: return 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'
  }
}

// ============================================================
// Usage Ring
// ============================================================

function isUnlimitedVal(value: number): boolean {
  return value === -1
}

function UsageRing({ label, used, limit, icon }: { label: string; used: number; limit: number; icon: React.ReactNode }) {
  const unlimited = isUnlimitedVal(limit)
  const pct = unlimited ? 100 : limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const isNearLimit = !unlimited && pct >= 80 && pct < 100
  const isAtLimit = !unlimited && pct >= 100
  const ringColor = isAtLimit ? '#ef4444' : isNearLimit ? '#f59e0b' : '#10b981'
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (pct / 100) * circumference

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: 48, height: 48 }}>
        <svg width="48" height="48" viewBox="0 0 48 48" className="-rotate-90">
          <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-zinc-800" />
          <circle cx="24" cy="24" r={radius} fill="none" stroke={ringColor} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={isAtLimit ? 'text-red-400' : isNearLimit ? 'text-amber-400' : 'text-slate-200'}>{icon}</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-300 font-medium">{label}</p>
        <p className={`text-[11px] ${isAtLimit ? 'text-red-400' : isNearLimit ? 'text-amber-400' : 'text-slate-500'}`}>
          {unlimited ? 'Unlimited' : `${used} / ${limit}`}
        </p>
      </div>
    </div>
  )
}

// ============================================================
// Main Plan Page (View Only)
// ============================================================

export default function PlanPage() {
  const { plan: currentPlanInfo, features, usage, isLoading: planLoading } = usePlan()
  const currentPlanSlug = currentPlanInfo?.type || 'free'

  // Plans from database
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [loadingPlans, setLoadingPlans] = useState(true)

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch('/api/plans')
      if (res.ok) {
        const data: PlanData = await res.json()
        setPlans(data.plans)
      }
    } catch {
      // silent
    } finally {
      setLoadingPlans(false)
    }
  }, [])

  useEffect(() => {
    void fetchPlans()
  }, [fetchPlans])

  // Collect all unique feature keys across all plans (ordered)
  const allFeatureKeys = (() => {
    const keySet = new Set<string>()
    plans.forEach((p) => {
      const f = parseFeatures(p.features)
      Object.keys(f).forEach((k) => keySet.add(k))
    })
    return FEATURE_ORDER.filter((k) => keySet.has(k))
  })()

  // Handle upgrade — open payment link
  const handleUpgrade = (plan: PlanRow) => {
    if (plan.paymentLink) {
      window.open(plan.paymentLink, '_blank')
    } else {
      toast.info(`Hubungi admin untuk upgrade ke ${plan.name}`)
    }
  }

  const isLoading = planLoading || loadingPlans

  // Plan accent colors
  const getAccent = (slug: string) => {
    switch (slug) {
      case 'pro': return { border: 'border-violet-500/20', bg: 'bg-violet-500/5', text: 'text-violet-400' }
      case 'enterprise': return { border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400' }
      default: return { border: 'border-zinc-500/20', bg: 'bg-zinc-500/5', text: 'text-zinc-400' }
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48 bg-white/[0.04]" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72 bg-white/[0.04] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 bg-white/[0.04] rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <h1 className="text-base font-semibold text-white flex items-center gap-2">
          <Crown className="h-4 w-4 text-amber-400" />
          Plan & Pricing
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">Bandingkan paket langganan yang tersedia</p>
      </div>

      {/* Current Plan Card */}
      <Card className="bg-nebula border-white/[0.06]">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Plan Saat Ini</h2>
              <p className="text-xs text-slate-400 mt-0.5">Informasi langganan outlet Anda</p>
            </div>
            <Badge className={`${getPlanBadge(currentPlanSlug)} text-xs font-semibold px-2.5 py-1`}>
              {currentPlanSlug.charAt(0).toUpperCase() + currentPlanSlug.slice(1)}
            </Badge>
          </div>

          {currentPlanInfo?.isSuspended && (
            <Alert className="border-red-500/20 bg-red-500/5 p-3">
              <AlertDescription className="text-xs text-red-400">
                Akun Anda saat ini ditangguhkan. Hubungi admin untuk informasi lebih lanjut.
              </AlertDescription>
            </Alert>
          )}

          {/* Usage Rings */}
          {features && usage && (
            <div className="space-y-3">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Penggunaan Saat Ini</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <UsageRing label="Produk" used={usage.products} limit={features.maxProducts} icon={<Tag className="h-4 w-4" />} />
                <UsageRing label="Kategori" used={usage.categories} limit={features.maxCategories} icon={<Palette className="h-4 w-4" />} />
                <UsageRing label="Crew" used={usage.crew} limit={features.maxCrew} icon={<KeyRound className="h-4 w-4" />} />
                <UsageRing label="Pelanggan" used={usage.customers} limit={features.maxCustomers} icon={<Star className="h-4 w-4" />} />
                <UsageRing label="Transaksi" used={usage.transactions} limit={features.maxTransactionsPerMonth} icon={<Receipt className="h-4 w-4" />} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pricing Cards */}
      {plans.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.slug === currentPlanSlug
            const accent = getAccent(plan.slug)
            const featCount = Object.values(parseFeatures(plan.features)).filter((v) => v === true || v === -1).length

            return (
              <Card
                key={plan.id}
                className={`bg-nebula border transition-colors ${
                  isCurrent ? `${accent.border}` : 'border-white/[0.06] hover:border-white/[0.1]'
                }`}
              >
                <CardContent className="p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge className={`${getPlanBadge(plan.slug)} text-[10px] font-semibold px-2 py-0`}>
                        {plan.name}
                      </Badge>
                      {isCurrent && (
                        <p className="text-[10px] font-medium mt-1.5" style={{ color: accent.text === 'text-zinc-400' ? '#a1a1aa' : undefined }}
                        >
                          Plan Anda
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Price */}
                  <div>
                    <p className={`text-2xl font-bold ${isCurrent ? accent.text : 'text-white'}`}>
                      {plan.price === 0 ? 'Gratis' : formatCurrency(plan.price)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {plan.price > 0 && (
                        <span className="text-xs text-slate-500">{formatDuration(plan.duration)}</span>
                      )}
                      {plan.price > 0 && plan.duration > 1 && (
                        <span className="text-[10px] text-slate-600">
                          (~{formatCurrency(Math.round(plan.price / plan.duration))}/bulan)
                        </span>
                      )}
                    </div>
                  </div>

                  {plan.description && (
                    <p className="text-xs text-slate-400">{plan.description}</p>
                  )}

                  {/* Feature count */}
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Check className="h-3 w-3 text-emerald-500" />
                    <span>{featCount} fitur aktif</span>
                  </div>

                  {/* Action */}
                  {!isCurrent && plan.price > 0 && (
                    <Button
                      onClick={() => handleUpgrade(plan)}
                      className={`w-full h-9 text-xs font-medium gap-1.5 ${
                        plan.slug === 'enterprise'
                          ? 'bg-amber-600 hover:bg-amber-500 text-white'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      }`}
                    >
                      {plan.paymentLink ? (
                        <>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Bayar & Upgrade
                        </>
                      ) : (
                        <>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          Hubungi Admin
                        </>
                      )}
                    </Button>
                  )}

                  {isCurrent && (
                    <div className="w-full h-9 rounded-lg border border-white/[0.08] flex items-center justify-center text-xs font-medium text-slate-500">
                      Plan aktif
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Feature Comparison Table */}
      {plans.length > 0 && allFeatureKeys.length > 0 && (
        <Card className="bg-nebula border-white/[0.06]">
          <CardContent className="p-4 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Perbandingan Fitur</h2>
              <p className="text-xs text-slate-400 mt-0.5">Bandingkan fitur setiap plan</p>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block rounded-lg border border-white/[0.06] overflow-hidden max-h-[480px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent bg-white/[0.02] sticky top-0 z-10">
                    <TableHead className="text-slate-500 text-[11px] font-medium h-9 w-[200px]">Fitur</TableHead>
                    {plans.map((plan) => {
                      const isCurrent = plan.slug === currentPlanSlug
                      return (
                        <TableHead key={plan.id} className="text-center text-[11px] font-medium h-9">
                          <div className="flex flex-col items-center gap-1">
                            <Badge className={`${getPlanBadge(plan.slug)} text-[10px] font-semibold px-2 py-0`}>
                              {plan.name}
                            </Badge>
                            {isCurrent && (
                              <span className="text-[9px] text-emerald-400 font-medium">Plan Anda</span>
                            )}
                          </div>
                        </TableHead>
                      )
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allFeatureKeys.map((key, idx) => {
                    const label = FEATURE_LABELS[key] || key
                    return (
                      <TableRow key={key} className={`border-white/[0.06] hover:bg-transparent ${idx % 2 === 0 ? 'bg-nebula/50' : ''}`}>
                        <TableCell className="text-xs text-slate-300 font-medium py-2">{label}</TableCell>
                        {plans.map((plan) => {
                          const feat = parseFeatures(plan.features)
                          const value = feat[key]
                          const isCurrent = plan.slug === currentPlanSlug
                          const isBoolean = typeof value === 'boolean'
                          const isNumber = typeof value === 'number'
                          const isUnlimitedVal2 = isNumber && value === -1

                          return (
                            <TableCell key={plan.id} className={`text-center py-2 ${isCurrent ? 'bg-white/[0.02]' : ''}`}>
                              {value === undefined || value === null ? (
                                <X className="h-3.5 w-3.5 text-slate-700 mx-auto" />
                              ) : isBoolean ? (
                                value ? (
                                  <Check className="h-4 w-4 text-emerald-400 mx-auto" />
                                ) : (
                                  <X className="h-3.5 w-3.5 text-slate-600 mx-auto" />
                                )
                              ) : Array.isArray(value) ? (
                                <span className="text-[11px] text-slate-300">{value.join(', ')}</span>
                              ) : (
                                <span className={`text-xs font-medium ${isUnlimitedVal2 ? 'text-emerald-400' : 'text-slate-300'}`}>
                                  {isUnlimitedVal2 ? 'Unlimited' : String(value)}
                                </span>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3 max-h-[520px] overflow-y-auto">
              {plans.map((plan) => {
                const feat = parseFeatures(plan.features)
                const isCurrent = plan.slug === currentPlanSlug
                const accent = getAccent(plan.slug)

                return (
                  <div
                    key={plan.id}
                    className={`rounded-lg border p-3 space-y-2.5 transition-colors ${
                      isCurrent ? `${accent.border} ${accent.bg}` : 'border-white/[0.06] bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Badge className={`${getPlanBadge(plan.slug)} text-[11px] font-semibold px-2 py-0`}>
                        {plan.name}
                      </Badge>
                      {isCurrent && (
                        <span className="text-[10px] text-emerald-400 font-medium">Plan Anda</span>
                      )}
                    </div>
                    <p className={`text-sm font-bold ${isCurrent ? accent.text : 'text-white'}`}>
                      {plan.price === 0 ? 'Gratis' : formatCurrency(plan.price)}
                      {plan.price > 0 && <span className="text-slate-500 font-normal text-xs ml-1">{formatDuration(plan.duration)}</span>}
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {allFeatureKeys.map((key) => {
                        const label = FEATURE_LABELS[key] || key
                        const value = feat[key]
                        const isBoolean = typeof value === 'boolean'
                        const isNumber = typeof value === 'number'
                        const isUnlimitedVal2 = isNumber && value === -1

                        return (
                          <div key={key} className="flex items-center justify-between py-0.5">
                            <span className="text-[11px] text-slate-500">{label}</span>
                            {value === undefined || value === null ? (
                              <X className="h-3 w-3 text-slate-700" />
                            ) : isBoolean ? (
                              value ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <X className="h-3 w-3 text-slate-600" />
                            ) : Array.isArray(value) ? (
                              <span className="text-[10px] text-slate-300">{value.join(', ')}</span>
                            ) : (
                              <span className={`text-[11px] font-medium ${isUnlimitedVal2 ? 'text-emerald-400' : 'text-slate-300'}`}>
                                {isUnlimitedVal2 ? 'Unlimited' : String(value)}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {!isCurrent && plan.price > 0 && (
                      <Button
                        onClick={() => handleUpgrade(plan)}
                        variant="outline"
                        size="sm"
                        className="w-full border-white/[0.08] text-slate-300 hover:bg-white/[0.04] h-8 text-[11px] gap-1"
                      >
                        {plan.paymentLink ? (
                          <><ExternalLink className="h-3 w-3" /> Bayar & Upgrade</>
                        ) : (
                          <><ArrowUpRight className="h-3 w-3" /> Hubungi Admin</>
                        )}
                      </Button>
                    )}
                    {isCurrent && (
                      <div className="text-center pt-0.5">
                        <span className="text-[11px] text-emerald-400 font-medium">Plan aktif</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && plans.length === 0 && (
        <Card className="bg-nebula border-white/[0.06]">
          <CardContent className="p-8 text-center">
            <Crown className="h-8 w-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400 font-medium">Belum ada plan</p>
            <p className="text-xs text-slate-500 mt-1">Hubungi admin untuk mengatur plan langganan.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}