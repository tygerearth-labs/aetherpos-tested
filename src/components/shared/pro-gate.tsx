'use client'

import { usePlan } from '@/hooks/use-plan'
import { Lock, Crown, Sparkles } from 'lucide-react'

interface ProGateProps {
  /** The feature key from PlanFeatures to check */
  feature: keyof import('@/lib/plan-config').PlanFeatures
  /** Content to render for Pro users */
  children: React.ReactNode
  /** Optional custom label for the upgrade banner */
  label?: string
  /** Optional custom description */
  description?: string
  /** Blur intensity (default: 6) */
  blur?: number
  /** Minimum height for the blurred area */
  minHeight?: string
  /** 
   * Display variant:
   * - 'card': Full card overlay (default) — for sections, panels, feature blocks
   * - 'inline': Compact button-style — for inline buttons and actions
   * - 'badge': Minimal pill badge — for small inline indicators
   */
  variant?: 'card' | 'inline' | 'badge'
}

/**
 * ProGate — Blurs Pro-only features for free accounts.
 *
 * Wraps any UI element and shows a blurred overlay with
 * an upgrade prompt for users on the free plan.
 *
 * Usage:
 *   <ProGate feature="exportExcel" label="Export Excel">
 *     <ExportButton />
 *   </ProGate>
 *
 *   <ProGate feature="bulkUpload" variant="inline" label="Upload Excel">
 *     <UploadButton />
 *   </ProGate>
 */
export function ProGate({
  feature,
  children,
  label,
  description,
  blur = 6,
  minHeight = '120px',
  variant = 'card',
}: ProGateProps) {
  const { features, plan, isLoading } = usePlan()

  // Don't gate anything while loading or if plan data is unavailable
  if (isLoading || !features) {
    return <>{children}</>
  }

  const value = features[feature]

  // Determine if the feature is available
  let isAvailable = false
  if (typeof value === 'boolean') {
    isAvailable = value
  } else if (Array.isArray(value)) {
    isAvailable = value.length > 0
  } else {
    // Numeric feature - always show the UI, limits are handled separately
    isAvailable = true
  }

  if (isAvailable) {
    return <>{children}</>
  }

  const isPro = plan?.type === 'pro'
  const isEnterprise = plan?.type === 'enterprise'

  // Enterprise plan should have all features
  if (isPro || isEnterprise) {
    return <>{children}</>
  }

  const displayLabel = label || getFeatureLabel(feature)
  const displayDescription = description || 'Fitur ini tersedia untuk akun Pro'

  // ── INLINE variant: compact button-style lock ──
  if (variant === 'inline') {
    return (
      <div className="relative inline-flex">
        {/* Blurred button underneath */}
        <div
          className="pointer-events-none select-none"
          style={{ filter: `blur(${blur}px)`, opacity: 0.4 }}
        >
          {children}
        </div>

        {/* Inline lock overlay */}
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <button
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg
              bg-gradient-to-r from-violet-500/15 to-purple-500/15
              border border-violet-500/25
              backdrop-blur-sm cursor-default select-none"
            title={`${displayLabel} — ${displayDescription}`}
          >
            <Crown className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-[11px] font-semibold text-violet-300">{displayLabel}</span>
            <Lock className="h-3 w-3 text-violet-500/60" />
          </button>
        </div>
      </div>
    )
  }

  // ── BADGE variant: minimal pill ──
  if (variant === 'badge') {
    return (
      <div className="relative inline-flex">
        <div
          className="pointer-events-none select-none"
          style={{ filter: `blur(${blur}px)`, opacity: 0.35 }}
        >
          {children}
        </div>

        <div className="absolute inset-0 flex items-center justify-center z-10">
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full
              bg-violet-500/10 border border-violet-500/20 text-violet-400
              text-[10px] font-semibold select-none cursor-default"
            title={`${displayLabel} — ${displayDescription}`}
          >
            <Sparkles className="h-3 w-3" />
            Pro
          </span>
        </div>
      </div>
    )
  }

  // ── CARD variant (default): full overlay with upgrade CTA ──
  return (
    <div className="relative group" style={{ minHeight }}>
      {/* Blurred content underneath */}
      <div
        className="pointer-events-none select-none"
        style={{ filter: `blur(${blur}px)`, opacity: 0.5 }}
      >
        {children}
      </div>

      {/* Overlay with upgrade prompt */}
      <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-zinc-900/70 backdrop-blur-[2px] border border-dashed border-zinc-700/40 z-10">
        <div className="flex flex-col items-center gap-3 px-5 py-4 text-center max-w-[200px]">
          {/* Icon */}
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500/15 to-purple-500/10 border border-violet-500/20 flex items-center justify-center">
            <Crown className="h-5 w-5 text-violet-400" />
          </div>

          {/* Label & description */}
          <div>
            <p className="text-xs font-semibold text-zinc-200 leading-tight">{displayLabel}</p>
            <p className="text-[11px] text-zinc-500 mt-1 leading-snug">{displayDescription}</p>
          </div>

          {/* Pro badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20">
            <Sparkles className="h-3 w-3 text-violet-400" />
            <span className="text-[11px] font-semibold text-violet-300">Upgrade Pro</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Get a human-readable label for a feature key */
function getFeatureLabel(feature: string): string {
  const labels: Record<string, string> = {
    productImage: 'Upload Foto Produk',
    crewPermissions: 'Hak Akses Crew',
    bulkUpload: 'Upload Excel',
    exportExcel: 'Export Excel',
    offlineMode: 'Mode Offline',
    multiOutlet: 'Multi Outlet',
    apiAccess: 'API Access',
    prioritySupport: 'Support Prioritas',
    loyaltyProgram: 'Program Loyalti',
    dashboardAnalytics: 'Analytics Dashboard',
    stockMovement: 'Pergerakan Stok',
    auditLog: 'Audit Log',
    transactionSummary: 'Ringkasan Transaksi',
  }
  return labels[feature] || 'Fitur Pro'
}
