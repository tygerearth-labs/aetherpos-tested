/**
 * usePlan.ts — Client-side Plan State Management
 *
 * This module re-exports the usePlan hook from PlanProvider.
 * The hook consumes plan data from a centralized React Context
 * (PlanProvider) instead of making independent fetch calls per page.
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

export {
  usePlan,
  PlanProvider,
  type PlanInfo,
  type PlanUsage,
  type PlanData,
} from '@/components/shared/plan-provider'

import type { PlanFeatures } from '@/lib/plan-config'
import { getPlanFeatures } from '@/lib/plan-config'

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
  const unlimited = limit === -1

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

/** Check if a numeric limit is effectively unlimited */
export function isUnlimited(value: number): boolean {
  return value === -1
}
