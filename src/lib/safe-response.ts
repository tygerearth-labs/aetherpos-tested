/**
 * safe-response.ts — Safe JSON response helper
 *
 * Prevents 500 errors from Prisma model serialization.
 * Prisma returns special class instances (not plain objects) with Date fields
 * and lazy relation accessors. Direct JSON.stringify on these can fail in
 * edge cases on Vercel serverless, causing "data saves but 500" pattern.
 *
 * This helper:
 * 1. Converts Date objects to ISO strings (safe for JSON)
 * 2. Strips undefined values
 * 3. Handles BigInt (if any) by converting to String
 */

export function safeJson(data: unknown, status = 200): Response {
  const serialized = JSON.stringify(data, (_, value) => {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'bigint') return value.toString()
    if (value === undefined) return null
    return value
  })

  return new Response(serialized, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a 201 Created response with safe serialization.
 */
export function safeJsonCreated(data: unknown): Response {
  return safeJson(data, 201)
}

/**
 * Create an error response (4xx/5xx) with safe serialization.
 */
export function safeJsonError(error: string, status = 500): Response {
  return safeJson({ error }, status)
}
