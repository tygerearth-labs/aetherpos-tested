/**
 * usePlan.ts — Client-side Plan State Management
 *
 * When used inside a <PlanProvider>, reads from the shared context
 * (single fetch, no duplicates). When used outside a provider,
 * falls back to local state (backward compatible).
 *
 * Usage:
 *   const { plan, features, usage, isSuspended, isLoading, refresh } = usePlan()
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { PlanFeatures } from '@/lib/config/plan-config'
import { getPlanFeatures, isUnlimited } from '@/lib/config/plan-config'
import { usePlanContext } from '@/context/plan-context'

// ============================================================
// Types
// ============================================================

export interface PlanInfo {
  type: string
  label: string
  isSuspended: boolean
  isExpired: boolean
  isExpiringSoon: boolean
  planExpiresAt: string | null
  daysRemaining: number
  planSource?: string
}

export interface PlanUsage {
  products: number
  categories: number
  customers: number
  crew: number
  promos: number
  transactions: number
}

export interface PlanData {
  outletId: string
  outletName: string
  plan: PlanInfo
  features: PlanFeatures
  usage: PlanUsage
  lastUpdated: string
}

export interface UsePlanReturn {
  /** Full plan data from server (null while loading) */
  planData: PlanData | null
  /** Current plan info */
  plan: PlanInfo | null
  /** Feature matrix for the current plan */
  features: PlanFeatures | null
  /** Current usage counts */
  usage: PlanUsage | null
  /** Whether the outlet is suspended by Command Center */
  isSuspended: boolean
  /** Loading state */
  isLoading: boolean
  /** Error message if fetch failed */
  error: string | null
  /** Manually refresh plan data */
  refresh: () => Promise<void>
}

// ============================================================
// Hook
// ============================================================

export function usePlan(): UsePlanReturn {
  const ctx = usePlanContext()

  // Fallback local state — always called (hooks rules) but only used when ctx is null
  const [localPlanData, setLocalPlanData] = useState<PlanData | null>(null)
  const [localLoading, setLocalLoading] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasFetchedOnce = useRef(false)

  const fetchPlan = useCallback(async () => {
    try {
      const res = await fetch('/api/outlet/plan')
      if (!res.ok) {
        if (res.status === 401 || res.status === 500) return
        throw new Error(`HTTP ${res.status}`)
      }
      const data = (await res.json()) as PlanData
      setLocalPlanData(data)
      setLocalError(null)
      hasFetchedOnce.current = true
    } catch (err) {
      if (!hasFetchedOnce.current) {
        setLocalError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      setLocalLoading(false)
    }
  }, [])

  // Only run local effects when NOT inside a PlanProvider
  useEffect(() => {
    if (ctx) return
    void fetchPlan()
  }, [fetchPlan, ctx])

  useEffect(() => {
    if (ctx) return
    intervalRef.current = setInterval(fetchPlan, 60_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchPlan, ctx])

  useEffect(() => {
    if (ctx) return
    const onFocus = () => fetchPlan()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchPlan, ctx])

  // Return shared context data when available, otherwise fallback
  const source = ctx
    ? { planData: ctx.planData, isLoading: ctx.isLoading, error: ctx.error, refresh: ctx.refresh }
    : { planData: localPlanData, isLoading: localLoading, error: localError, refresh: fetchPlan }

  return useMemo(() => ({
    planData: source.planData,
    plan: source.planData?.plan ?? null,
    features: source.planData?.features ?? null,
    usage: source.planData?.usage ?? null,
    isSuspended: source.planData?.plan.isSuspended ?? false,
    isLoading: source.isLoading,
    error: source.error,
    refresh: source.refresh,
  }), [source.planData, source.isLoading, source.error, source.refresh])
}

// ============================================================
// Feature Gate Helpers
// ============================================================

/**
 * Check if a feature is available.
 * Returns true if the feature is enabled AND within limits.
 */
export function useFeatureGate(feature: keyof PlanFeatures): boolean {
  const { features, plan } = usePlan()
  if (!features || !plan) return false

  const value = features[feature]

  if (typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  return true
}

/**
 * Check if a numeric limit has been reached.
 * Usage: const { isLimitReached, remaining } = useLimitCheck('maxProducts', usage.products)
 */
export function useLimitCheck(
  limitKey: 'maxProducts' | 'maxCrew' | 'maxCustomers' | 'maxPromos' | 'maxTransactionsPerMonth',
  currentCount: number
): { isLimitReached: boolean; remaining: number; isUnlimited: boolean } {
  const { features } = usePlan()

  if (!features) {
    return { isLimitReached: false, remaining: 0, isUnlimited: true }
  }

  const limit = features[limitKey] as number
  const unlimited = isUnlimited(limit)

  return {
    isLimitReached: !unlimited && currentCount >= limit,
    remaining: unlimited ? -1 : Math.max(0, limit - currentCount),
    isUnlimited: unlimited,
  }
}

// ============================================================
// Utility: Check plan without hook (for non-component code)
// ============================================================

/** Check if a specific feature is available for a plan type */
export function hasFeature(accountType: string, feature: keyof PlanFeatures): boolean {
  const features = getPlanFeatures(accountType)
  const value = features[feature]
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.length > 0
  return true
}