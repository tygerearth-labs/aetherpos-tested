import { useState, useEffect, useCallback, useRef } from 'react'
import { create } from 'zustand'

interface SidebarBadges {
  pendingInbound: number
}

interface SidebarBadgeStore extends SidebarBadges {
  setBadges: (badges: SidebarBadges) => void
}

const POLL_INTERVAL = 30_000 // 30 seconds

const useBadgeStore = create<SidebarBadgeStore>((set) => ({
  pendingInbound: 0,
  setBadges: (badges) => set(badges),
}))

/**
 * Shared hook to fetch sidebar badge counts.
 * Uses zustand store so both sidebar and mobile nav share the same data.
 * Polls every 30s and refetches on window focus.
 */
export function useSidebarBadges() {
  const { pendingInbound, setBadges } = useBadgeStore()
  const [isLoading, setIsLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasFetchedOnce = useRef(false)

  const fetchBadges = useCallback(async () => {
    try {
      const res = await fetch('/api/sidebar/badges')
      if (!res.ok) return
      const data = await res.json() as SidebarBadges
      setBadges(data)
      hasFetchedOnce.current = true
    } catch {
      // Silently ignore
    } finally {
      setIsLoading(false)
    }
  }, [setBadges])

  useEffect(() => {
    void fetchBadges()
  }, [fetchBadges])

  useEffect(() => {
    intervalRef.current = setInterval(fetchBadges, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchBadges])

  // Refetch on window focus
  useEffect(() => {
    const onFocus = () => fetchBadges()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchBadges])

  return { pendingInbound, isLoading }
}
