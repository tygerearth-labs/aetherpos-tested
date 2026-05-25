'use client'

import { useMemo } from 'react'

/**
 * useTimezone — provides the current device's timezone info.
 *
 * Returns:
 * - tzOffset: minutes from UTC (same format as Date.getTimezoneOffset()).
 *   Negative for east of UTC (e.g. WIB UTC+7 = -420).
 * - timeZoneName: IANA timezone name (e.g. "Asia/Jakarta") if supported.
 *
 * Usage:
 *   const { tzOffset, timeZoneName } = useTimezone()
 *   fetch('/api/dashboard?tzOffset=' + tzOffset)
 */
export function useTimezone() {
  return useMemo(() => {
    const tzOffset = new Date().getTimezoneOffset()

    let timeZoneName: string | undefined
    try {
      timeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      // Intl not supported
    }

    return { tzOffset, timeZoneName }
  }, [])
}
