'use client'

import { Clock, WifiOff } from 'lucide-react'

interface OfflineDataNoticeProps {
  /** "Data terakhir diperbarui <label>" — null hides the timestamp line */
  lastUpdatedLabel: string | null
  /** Whether the route is currently offline (controls visibility + styling) */
  isOffline: boolean
  /** Optional className override */
  className?: string
}

/**
 * A compact banner shown at the top of READ_ONLY routes when offline.
 *
 * Shows:
 *   - WifiOff icon + "Mode Offline"
 *   - "Data terakhir diperbarui <time>" (from Dexie syncMeta)
 *
 * Does NOT show a retry/refresh button (refresh is guaranteed to fail offline
 * and is blocked by useBlockRefresh at the app-shell level).
 */
export function OfflineDataNotice({ lastUpdatedLabel, isOffline, className }: OfflineDataNoticeProps) {
  if (!isOffline) return null

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15 ${className || ''}`}
      role="status"
      aria-live="polite"
    >
      <WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      <span className="text-[11px] font-medium text-amber-300">
        Mode Offline — menampilkan data tersimpan
      </span>
      {lastUpdatedLabel && (
        <span className="text-[11px] text-amber-400/60 flex items-center gap-1 ml-auto">
          <Clock className="h-3 w-3" />
          Diperbarui {lastUpdatedLabel}
        </span>
      )}
    </div>
  )
}
