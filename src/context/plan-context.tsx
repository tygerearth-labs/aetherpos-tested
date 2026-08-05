'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { PlanData } from '@/hooks/use-plan'

// ============================================================
// Context Shape — mirrors UsePlanReturn minus the hooks
// ============================================================

interface PlanContextValue {
  planData: PlanData | null
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const PlanContext = createContext<PlanContextValue | null>(null)

// ============================================================
// Provider — single source of truth for plan data
// ============================================================

const POLL_INTERVAL = 60_000
/** POST-CHECKOUT LATENCY FIX: minimum gap between focus-triggered refetches.
 *  Closing the print window (receipt) regains focus → without this throttle,
 *  /api/outlet/plan is re-fetched every time the cashier prints a receipt.
 *  30s is well below the 60s poll interval, so legitimate plan changes still
 *  propagate quickly while duplicate focus bursts are suppressed. */
const FOCUS_REFETCH_MIN_GAP_MS = 30_000

export function PlanProvider({ children }: { children: ReactNode }) {
  const [planData, setPlanData] = useState<PlanData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasFetchedOnce = useRef(false)
  const lastFetchAt = useRef(0)

  const fetchPlan = useCallback(async () => {
    try {
      const res = await fetch('/api/outlet/plan')
      if (!res.ok) {
        if (res.status === 401 || res.status === 500) return
        throw new Error(`HTTP ${res.status}`)
      }
      const data = (await res.json()) as PlanData
      setPlanData(data)
      setError(null)
      hasFetchedOnce.current = true
    } catch (err) {
      if (!hasFetchedOnce.current) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    void fetchPlan().then(() => {
      // Stamp the initial fetch time so the focus throttle doesn't immediately
      // re-fetch. Without this, `lastFetchAt` starts at 0 and the first focus
      // event always passes the throttle (Date.now() - 0 is always > 30s).
      lastFetchAt.current = Date.now()
    })
  }, [fetchPlan])

  // Polling
  useEffect(() => {
    const id = setInterval(fetchPlan, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchPlan])

  // Refetch on focus — THROTTLED to avoid duplicate fetches when the print
  // window closes (regains focus) immediately after checkout.
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now()
      if (now - lastFetchAt.current < FOCUS_REFETCH_MIN_GAP_MS) return
      lastFetchAt.current = now
      void fetchPlan()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchPlan])

  return (
    <PlanContext.Provider value={{ planData, isLoading, error, refresh: fetchPlan }}>
      {children}
    </PlanContext.Provider>
  )
}

// ============================================================
// Consumer hook (used by use-plan.ts)
// ============================================================

export function usePlanContext(): PlanContextValue | null {
  return useContext(PlanContext)
}