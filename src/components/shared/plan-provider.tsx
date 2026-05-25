'use client'

/**
 * PlanProvider — Centralized plan state for the entire application.
 *
 * Fetches plan data ONCE and shares it via React Context to all pages.
 * This eliminates redundant API calls (each page used to fetch independently)
 * and ensures all pages instantly have plan data when mounted.
 *
 * Features:
 * - Single fetch on mount (shared across all pages)
 * - Polling every 60s to detect remote plan changes from Command Center
 * - Refetch on window focus
 * - Error handling with silent retry
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { PlanFeatures } from '@/lib/plan-config'

// ============================================================
// Types (re-exported for convenience)
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

export interface PlanContextValue {
  planData: PlanData | null
  plan: PlanInfo | null
  features: PlanFeatures | null
  usage: PlanUsage | null
  isSuspended: boolean
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

// ============================================================
// Context
// ============================================================

const PlanContext = createContext<PlanContextValue | null>(null)

// ============================================================
// Constants
// ============================================================

const POLL_INTERVAL = 60_000 // 60 seconds

// ============================================================
// Provider
// ============================================================

export function PlanProvider({ children }: { children: ReactNode }) {
  const [planData, setPlanData] = useState<PlanData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasFetchedOnce = useRef(false)

  const fetchPlan = useCallback(async () => {
    try {
      // cache: 'no-store' ensures no browser/Service-Worker caching — plan changes from
      // webmaster must always be fresh
      const res = await fetch('/api/outlet/plan', { cache: 'no-store' })
      if (!res.ok) {
        // 401 = not logged in yet, silently ignore
        // 500 = server/DB error, silently ignore
        if (res.status === 401 || res.status === 500) return
        throw new Error(`HTTP ${res.status}`)
      }
      const data = (await res.json()) as PlanData
      setPlanData(data)
      setError(null)
      hasFetchedOnce.current = true
    } catch (err) {
      // Only show error on first fetch attempt
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

  // Polling interval (single global interval)
  useEffect(() => {
    const interval = setInterval(fetchPlan, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchPlan])

  // Refetch on window focus
  useEffect(() => {
    const onFocus = () => fetchPlan()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchPlan])

  const isSuspended = planData?.plan.isSuspended ?? false

  const value: PlanContextValue = {
    planData,
    plan: planData?.plan ?? null,
    features: planData?.features ?? null,
    usage: planData?.usage ?? null,
    isSuspended,
    isLoading,
    error,
    refresh: fetchPlan,
  }

  return (
    <PlanContext.Provider value={value}>
      {children}
    </PlanContext.Provider>
  )
}

// ============================================================
// usePlan hook (consumes from context)
// ============================================================

/**
 * Get the current outlet's plan data from the shared PlanContext.
 * Must be used inside a <PlanProvider>.
 */
export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext)
  if (!ctx) {
    // Fallback: return empty state if used outside PlanProvider
    // This shouldn't happen in normal usage but prevents crashes
    return {
      planData: null,
      plan: null,
      features: null,
      usage: null,
      isSuspended: false,
      isLoading: false,
      error: null,
      refresh: async () => {},
    }
  }
  return ctx
}
