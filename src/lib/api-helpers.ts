/**
 * api-helpers.ts — Shared API Route Utilities
 *
 * Centralizes common patterns used across all API routes:
 * - Pagination parsing
 * - Plan type resolution (suspended prefix handling)
 * - Invoice number generation
 * - Owner/role authorization shortcuts
 */

import { type PrismaClient } from '@prisma/client'

// ============================================================
// Validation Helpers
// ============================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Validate email format. Returns error message or null if valid. */
export function validateEmail(email: string): string | null {
  if (!email) return 'Email wajib diisi'
  if (!EMAIL_REGEX.test(email)) return 'Format email tidak valid'
  return null
}

const MIN_PASSWORD_LENGTH = 8

/** Validate password minimum length. Returns error message or null if valid. */
export function validatePassword(password: string): string | null {
  if (!password) return 'Password wajib diisi'
  if (password.length < MIN_PASSWORD_LENGTH) return `Password minimal ${MIN_PASSWORD_LENGTH} karakter`
  return null
}

// ============================================================
// Pagination
// ============================================================

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export interface Pagination {
  page: number
  limit: number
  skip: number
}

/**
 * Parse page/limit from URL searchParams with safe defaults.
 */
export function parsePagination(
  searchParams: URLSearchParams,
  defaults?: { page?: number; limit?: number }
): Pagination {
  const page = Math.max(1, Number(searchParams.get('page')) || defaults?.page || DEFAULT_PAGE)
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(searchParams.get('limit')) || defaults?.limit || DEFAULT_LIMIT)
  )
  return { page, limit, skip: (page - 1) * limit }
}

// ============================================================
// Plan Resolution
// ============================================================

/**
 * Resolve the effective plan type from raw accountType string.
 * Handles "suspended:xxx" prefix transparently.
 */
export function resolvePlanType(accountType: string | null | undefined): string {
  if (!accountType) return 'free'
  return accountType.startsWith('suspended:')
    ? accountType.replace('suspended:', '')
    : accountType
}

// ============================================================
// Invoice Number
// ============================================================

/**
 * Generate a unique invoice number: INV-YYYYMMDD-XXXXX
 */
export function generateInvoiceNumber(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const random = String(Math.floor(Math.random() * 100000)).padStart(5, '0')
  return `INV-${yyyy}${mm}${dd}-${random}`
}

// ============================================================
// Date Range Builder
// ============================================================

/**
 * Build a Prisma-compatible date filter from query params.
 * Accepts both ISO datetime strings (e.g. "2025-07-12T00:00:00.000Z")
 * and plain date strings (e.g. "2025-07-12").
 * For plain dates, applies setHours which uses SERVER local time.
 * For ISO strings, uses the exact timestamp (timezone-aware).
 *
 * Returns an object like `{ gte: Date, lte: Date }` or empty object.
 */
export function buildDateFilter(
  dateFrom: string | null,
  dateTo: string | null,
  dateFromMs?: string | null,
  dateToMs?: string | null,
): Record<string, Date> {
  const filter: Record<string, Date> = {}
  
  // Prefer millisecond timestamps (timezone-safe)
  if (dateFromMs) {
    const ms = Number(dateFromMs)
    if (!isNaN(ms)) filter.gte = new Date(ms)
  } else if (dateFrom) {
    const d = new Date(dateFrom)
    if (isNaN(d.getTime())) return filter
    if (dateFrom.includes('T') || dateFrom.includes('Z') || dateFrom.includes('+')) {
      filter.gte = d
    } else {
      d.setHours(0, 0, 0, 0)
      filter.gte = d
    }
  }
  
  if (dateToMs) {
    const ms = Number(dateToMs)
    if (!isNaN(ms)) filter.lte = new Date(ms)
  } else if (dateTo) {
    const d = new Date(dateTo)
    if (isNaN(d.getTime())) return filter
    if (dateTo.includes('T') || dateTo.includes('Z') || dateTo.includes('+')) {
      filter.lte = d
    } else {
      d.setHours(23, 59, 59, 999)
      filter.lte = d
    }
  }
  
  return filter
}

// ============================================================
// Timezone-Aware Date Range Builder
// ============================================================

/**
 * Build a Prisma-compatible date filter that is explicitly timezone-aware.
 * Accepts date strings (YYYY-MM-DD) and a timezone offset in minutes from
 * getTimezoneOffset() (negative for east of UTC, positive for west).
 *
 * Constructs UTC Date ranges by converting client-local midnight to UTC.
 * Falls back to legacy buildDateFilter behavior if no tzOffset is provided.
 */
export function buildDateFilterTz(
  dateFrom: string | null,
  dateTo: string | null,
  tzOffsetMinutes?: number | null,
): Record<string, Date> {
  const filter: Record<string, Date> = {}

  if (dateFrom && tzOffsetMinutes !== undefined && tzOffsetMinutes !== null) {
    const [y, m, d] = dateFrom.split('-').map(Number)
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      // Midnight in client's timezone converted to UTC
      const startMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + tzOffsetMinutes * 60000
      filter.gte = new Date(startMs)
    }
  } else if (dateFrom) {
    // Fallback: use server local time (legacy behavior)
    const d = new Date(dateFrom)
    if (!isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0)
      filter.gte = d
    }
  }

  if (dateTo && tzOffsetMinutes !== undefined && tzOffsetMinutes !== null) {
    const [y, m, d] = dateTo.split('-').map(Number)
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      const endMs = Date.UTC(y, m - 1, d, 23, 59, 59, 999) + tzOffsetMinutes * 60000
      filter.lte = new Date(endMs)
    }
  } else if (dateTo) {
    const d = new Date(dateTo)
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999)
      filter.lte = d
    }
  }

  return filter
}

// ============================================================
// Timezone-Aware Date Utilities
// ============================================================

/**
 * Get the hour (0-23) of a Date in a specific timezone.
 * Uses tzOffsetMinutes from getTimezoneOffset() (negative for east of UTC).
 *
 * Example: UTC 10:00, WIB (tzOffset=-420) → returns 17
 */
export function getHourInTimezone(date: Date, tzOffsetMinutes: number): number {
  // Convert UTC ms to local ms, then read UTC hour (which is now local hour)
  const localMs = date.getTime() - tzOffsetMinutes * 60000
  return new Date(localMs).getUTCHours()
}

/**
 * Get "today" and "yesterday" start in UTC, adjusted for the client's timezone.
 *
 * Returns { todayStart, yesterdayStart } as Date objects in UTC.
 * These can be used directly in Prisma { gte: todayStart, lt: tomorrowStart } filters.
 */
export function getTodayRangeTz(tzOffsetMinutes: number): {
  todayStart: Date
  yesterdayStart: Date
  dayOfWeek: number
  weekStart: Date
  monthStart: Date
  weekAgo: Date
} {
  const now = new Date()

  // Convert current time to local timezone
  const localMs = now.getTime() - tzOffsetMinutes * 60000
  const localNow = new Date(localMs)

  const y = localNow.getUTCFullYear()
  const m = localNow.getUTCMonth()
  const d = localNow.getUTCDate()
  const dayOfWeek = localNow.getUTCDay() // 0=Sun, 1=Mon, ...

  // Midnight of today in local timezone, expressed as UTC
  const todayStart = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) + tzOffsetMinutes * 60000)

  // Midnight of yesterday
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000)

  // Start of week (Monday)
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = new Date(todayStart.getTime() - mondayOffset * 86_400_000)

  // Start of month
  const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) + tzOffsetMinutes * 60000)

  // 7 days ago
  const weekAgo = new Date(todayStart.getTime() - 7 * 86_400_000)

  return { todayStart, yesterdayStart, dayOfWeek, weekStart, monthStart, weekAgo }
}

/**
 * Parse tzOffset from a request's searchParams.
 * Returns null if not provided or invalid.
 */
export function parseTzOffset(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get('tzOffset')
  if (!raw) return null
  const val = Number(raw)
  return isNaN(val) ? null : val
}

// ============================================================
// Voided Transaction Helper
// ============================================================

/**
 * Get a Set of voided transaction IDs for an outlet.
 * Used to filter out voided transactions from queries.
 */
export async function getVoidedTxIds(
  db: PrismaClient,
  outletId: string
): Promise<Set<string | null>> {
  const voided = await db.auditLog.findMany({
    where: {
      entityType: 'TRANSACTION',
      action: 'VOID',
      outletId,
    },
    select: { entityId: true },
  })
  return new Set(voided.map((v) => v.entityId))
}

/**
 * Parse void log details into structured info.
 */
export function parseVoidDetails(
  details: string | null
): { reason: string; voidedBy: string; voidedAt: string } | null {
  if (!details) return null
  try {
    const d = JSON.parse(details)
    return {
      reason: d.reason || '',
      voidedBy: d.voidedBy || '',
      voidedAt: d.voidedAt || '',
    }
  } catch {
    return { reason: '', voidedBy: '', voidedAt: '' }
  }
}

// ============================================================
// Void Map Builder
// ============================================================

/**
 * Build a map of transaction ID → void info from audit logs.
 */
export async function buildVoidMap(
  db: PrismaClient,
  transactionIds: string[],
  outletId: string
): Promise<Map<string, { reason: string; voidedBy: string; voidedAt: string }>> {
  if (transactionIds.length === 0) return new Map()

  const voidLogs = await db.auditLog.findMany({
    where: {
      entityType: 'TRANSACTION',
      entityId: { in: transactionIds },
      action: 'VOID',
      outletId,
    },
    select: { entityId: true, details: true },
  })

  const map = new Map<string, { reason: string; voidedBy: string; voidedAt: string }>()
  for (const log of voidLogs) {
    const info = parseVoidDetails(log.details)
    if (info && log.entityId) {
      map.set(log.entityId, info)
    }
  }
  return map
}
