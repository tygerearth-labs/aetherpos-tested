/**
 * usePlan.ts — Client-side Plan State Management
 *
 * Fetches the outlet's plan from the server on mount and
 * periodically (every 60s) to detect remote changes from
 * the Command Center.
 *
 * Usage:
 *   const { plan, features, usage, isSuspended, isLoading, refresh } = usePlan()
 *
 *   // Feature gating
 *   if (!features.exportExcel) { showUpgradeBanner() }
 *
 *   // Limit check
 *   if (!isUnlimited(features.maxProducts) && usage.products >= features.maxProducts) {
 *     toast('Produk已达上限，请升级')
 *   }
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { PlanFeatures } from '@/lib/plan-config'
import { getPlanFeatures, isUnlimited } from '@/lib/plan-config'

// ============================================================
// Types
// ============================================================

export interface PlanInfo {
  type: string
  label: string
  isSuspended: boolean
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

interface UsePlanReturn {
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

const POLL_INTERVAL = 60_000 // 60 seconds
const POLL_ON_FOCUS = true

export function usePlan(): UsePlanReturn {
  const [planData, setPlanData] = useState<PlanData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasFetchedOnce = useRef(false)

  const fetchPlan = useCallback(async () => {
    try {
      const res = await fetch('/api/outlet/plan')
      if (!res.ok) {
        // 401 = not logged in yet, silently ignore (don't spam console)
        // 500 = server/DB error (e.g. no session or DB not initialized), also ignore
        if (res.status === 401 || res.status === 500) return
        throw new Error(`HTTP ${res.status}`)
      }
      const data = (await res.json()) as PlanData
      setPlanData(data)
      setError(null)
      hasFetchedOnce.current = true
    } catch (err) {
      // Only show error on first fetch attempt (not on polling/focus retries)
      if (!hasFetchedOnce.current) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchPlan()
  }, [fetchPlan])

  // Polling interval
  useEffect(() => {
    intervalRef.current = setInterval(fetchPlan, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchPlan])

  // Refetch on window focus (tab switch back)
  useEffect(() => {
    if (!POLL_ON_FOCUS) return

    const onFocus = () => {
      fetchPlan()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchPlan])

  const isSuspended = planData?.plan.isSuspended ?? false

  return {
    planData,
    plan: planData?.plan ?? null,
    features: planData?.features ?? null,
    usage: planData?.usage ?? null,
    isSuspended,
    isLoading,
    error,
    refresh: fetchPlan,
  }
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

  // Boolean features
  if (typeof value === 'boolean') {
    return value
  }

  // Array features (promoTypes)
  if (Array.isArray(value)) {
    return value.length > 0
  }

  // Numeric features — check limit
  return true // Limit checking is separate
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
