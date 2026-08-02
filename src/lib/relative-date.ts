/**
 * relative-date.ts — timezone-aware relative date formatting for the
 * "Terakhir Diubah" column and same-day highlight logic.
 *
 * Output formats (Indonesian, outlet timezone):
 *   - "Hari ini, 14:32"
 *   - "Kemarin, 19:10"
 *   - "28 Jul 2026"
 *
 * The "today" / "yesterday" boundary is computed against the user's local
 * device timezone (which the spec assumes equals the outlet timezone; if not,
 * we fall back to Asia/Jakarta per spec point D). We do NOT compare raw UTC
 * timestamps — that would misclassify "today" for users east or west of UTC.
 */

const FALLBACK_TZ = 'Asia/Jakarta'

function getDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz || FALLBACK_TZ
  } catch {
    return FALLBACK_TZ
  }
}

/** Returns the YYYY-MM-DD date key in the device/outlet timezone. */
function dateKey(d: Date, tz: string): string {
  // Use Intl with timeZone option to get the correct Y/M/D in that zone.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${day}`
}

/** True if the given timestamp falls on the same calendar date as "now" in the outlet tz. */
export function isToday(timestamp: string | Date | null | undefined): boolean {
  if (!timestamp) return false
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return false
  const tz = getDeviceTimezone()
  return dateKey(d, tz) === dateKey(new Date(), tz)
}

/** True if the given timestamp falls on yesterday's calendar date in the outlet tz. */
export function isYesterday(timestamp: string | Date | null | undefined): boolean {
  if (!timestamp) return false
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return false
  const tz = getDeviceTimezone()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return dateKey(d, tz) === dateKey(yesterday, tz)
}

const MONTHS_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/**
 * Format a timestamp as a compact "Terakhir Diubah" string.
 *   - Same day (outlet tz):  "Hari ini, 14:32"
 *   - Yesterday (outlet tz): "Kemarin, 19:10"
 *   - Older / future:        "28 Jul 2026"
 */
export function formatRelativeDateTime(timestamp: string | Date | null | undefined): string {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return '-'

  const tz = getDeviceTimezone()

  // Extract HH:mm in the outlet timezone.
  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const hh = timeParts.find((p) => p.type === 'hour')?.value ?? '00'
  const mm = timeParts.find((p) => p.type === 'minute')?.value ?? '00'
  const timeStr = `${hh}:${mm}`

  if (isToday(d)) return `Hari ini, ${timeStr}`
  if (isYesterday(d)) return `Kemarin, ${timeStr}`

  // Older date — use "dd MMM yyyy" in the outlet timezone.
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(d)
  const day = dateParts.find((p) => p.type === 'day')?.value ?? '01'
  const monthIdx = parseInt(dateParts.find((p) => p.type === 'month')?.value ?? '1', 10) - 1
  const year = dateParts.find((p) => p.type === 'year')?.value ?? '1970'
  return `${day} ${MONTHS_SHORT_ID[monthIdx] ?? 'Jan'} ${year}`
}

/**
 * Decide which "same-day" badge to show, if any.
 *   - Priority 1: createdAt is today  → "Baru Hari Ini"
 *   - Priority 2: lastChangedAt is today → "Diperbarui Hari Ini"
 *   - Otherwise: null
 */
export function getSameDayBadge(
  createdAt: string | Date | null | undefined,
  lastChangedAt: string | Date | null | undefined,
): 'new' | 'updated' | null {
  if (isToday(createdAt)) return 'new'
  if (isToday(lastChangedAt)) return 'updated'
  return null
}
