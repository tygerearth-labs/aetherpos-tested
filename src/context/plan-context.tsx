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

export function PlanProvider({ children }: { children: ReactNode }) {
  const [planData, setPlanData] = useState<PlanData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasFetchedOnce = useRef(false)

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
    void fetchPlan()
  }, [fetchPlan])

  // Polling
  useEffect(() => {
    const id = setInterval(fetchPlan, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchPlan])

  // Refetch on focus
  useEffect(() => {
    const onFocus = () => fetchPlan()
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