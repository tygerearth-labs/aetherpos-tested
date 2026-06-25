/**
 * safe-response.ts — Safe JSON response helpers with caching support
 *
 * Prevents 500 errors from Prisma model serialization.
 * Prisma returns special class instances (not plain objects) with Date fields
 * and lazy relation accessors. Direct JSON.stringify on these can fail in
 * edge cases on Vercel serverless, causing "data saves but 500" pattern.
 *
 * Optimizations:
 * 1. Converts Date objects to ISO strings (safe for JSON)
 * 2. Strips undefined values
 * 3. Handles BigInt (if any) by converting to String
 * 4. Adds optional Cache-Control headers for GET endpoints
 */

/** Cache duration presets (in seconds) */
export const CACHE = {
  /** 5 seconds — frequently changing data (dashboard, POS) */
  SHORT: 5,
  /** 30 seconds — moderately changing data (products, transactions) */
  MEDIUM: 30,
  /** 60 seconds — rarely changing data (settings, permissions) */
  LONG: 60,
  /** 300 seconds — static data (categories, outlet info) */
  STATIC: 300,
} as const

function serialize(data: unknown): string {
  return JSON.stringify(data, (_, value) => {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'bigint') return value.toString()
    if (value === undefined) return null
    return value
  })
}

/**
 * Create a JSON response with safe serialization and optional caching.
 */
export function safeJson(
  data: unknown,
  status = 200,
  cacheSeconds?: number
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (cacheSeconds && cacheSeconds > 0) {
    headers['Cache-Control'] = `private, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
  }
  return new Response(serialize(data), { status, headers })
}

/**
 * Create a 201 Created response with safe serialization.
 */
export function safeJsonCreated(data: unknown): Response {
  return safeJson(data, 201)
}

/**
 * Create an error response (4xx/5xx) with safe serialization.
 * Never cached.
 */
export function safeJsonError(error: string, status = 500): Response {
  return safeJson({ error }, status)
}