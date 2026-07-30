/**
 * use-offline-data.ts — Hook for READ_ONLY routes to declare offline data state
 *
 * READ_ONLY routes (dashboard, products, customers, transactions) render
 * cached/snapshot data when offline. This hook provides:
 *   - isOffline: whether the route is currently in offline-read mode
 *   - lastUpdated: timestamp of the last successful fetch (from Dexie metadata)
 *   - lastUpdatedLabel: human-readable relative time
 *
 * The route should:
 *   - display the data normally (never replace with empty on fetch failure)
 *   - show "Data terakhir diperbarui <time>" via <OfflineDataNotice>
 *   - disable create/edit/delete actions when isOffline
 *
 * Timestamp storage: uses the real Dexie `metadata` table in aether-db
 * (key: `lastFetch:<syncKey>`, value: JSON.stringify(Date.now())).
 * This survives page reloads — unlike the noop localDB.syncMeta shim.
 */

'use client'

import { useState, useEffect } from 'react'
import { useOnlineStatus } from '@/hooks/use-online-status'

export interface OfflineDataState {
  /** True when browser is offline (data shown is from cache) */
  isOffline: boolean
  /** Timestamp (ms) of last successful sync, or null if unknown */
  lastUpdated: number | null
  /** Human-readable relative time for "Data terakhir diperbarui ..." */
  lastUpdatedLabel: string | null
}

/**
 * @param syncKey The data type key (e.g. 'products', 'customers', 'transactions', 'dashboard')
 */
export function useOfflineData(syncKey?: string): OfflineDataState {
  const isOnline = useOnlineStatus()
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    ;(async () => {
      try {
        const { getAetherDB } = await import('@/lib/offline/aether-db')
        const db = getAetherDB()
        const meta = await db.metadata.get(`lastFetch:${syncKey || 'default'}`)
        if (!cancelled) {
          if (meta && typeof meta.value === 'string') {
            try {
              setLastUpdated(JSON.parse(meta.value))
            } catch {
              setLastUpdated(null)
            }
          } else {
            setLastUpdated(null)
          }
        }
      } catch {
        if (!cancelled) setLastUpdated(null)
      }
    })()
    return () => { cancelled = true }
  }, [syncKey])

  return {
    isOffline: !isOnline,
    lastUpdated,
    lastUpdatedLabel: formatRelativeTime(lastUpdated),
  }
}

/**
 * Record a successful data fetch timestamp in Dexie metadata.
 * Call this in each page's fetch success handler so that
 * useOfflineData can show "Data terakhir diperbarui <time>".
 *
 * Best-effort: silently fails if Dexie/IndexedDB is unavailable (SSR).
 */
export async function recordDataFetch(syncKey: string): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const { getAetherDB } = await import('@/lib/offline/aether-db')
    const db = getAetherDB()
    await db.metadata.put({
      key: `lastFetch:${syncKey}`,
      value: JSON.stringify(Date.now()),
      updatedAt: new Date().toISOString(),
    })
  } catch {
    // Dexie unavailable (SSR or IndexedDB blocked). Best-effort — the fetch
    // itself succeeded, so the caller has the fresh data in-memory.
  }
}

function formatRelativeTime(ts: number | null): string | null {
  if (!ts) return null
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'baru saja'
  if (min < 60) return `${min} menit lalu`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} jam lalu`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} hari lalu`
  return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}
