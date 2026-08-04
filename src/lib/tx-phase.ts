/**
 * tx-phase.ts — Transaction phase markers + DB-error propagation guard
 *
 * PROBLEM (PostgreSQL 25P02):
 *   "current transaction is aborted, commands ignored until end of transaction
 *    block" — means an EARLIER query inside the same `db.$transaction` failed,
 *    and PostgreSQL has put the transaction into an ABORTED state. Every
 *    subsequent statement (including `createMany`) fails with 25P02 until the
 *    transaction is rolled back.
 *
 *   SQLite is lenient: a failed statement does NOT abort sibling statements.
 *   PostgreSQL is strict: the first failure poisons the whole transaction.
 *   Therefore the "best-effort / NON-FATAL" try/catch pattern (catch a DB
 *   error and keep going) is FUNDAMENTALLY INCOMPATIBLE with PostgreSQL
 *   transactions. On PG, a swallowed DB error guarantees that every later
 *   query in the same transaction will fail with 25P02.
 *
 * SOLUTION:
 *   `txPhase()` wraps every DB operation inside a transaction. It:
 *     1. Records the phase name + timing (reuses CheckoutPerf).
 *     2. Executes the operation.
 *     3. On success, ends the phase.
 *     4. On error, logs the phase name + PG/Prisma error code, then RETHROWS
 *        (NEVER swallows) so Prisma rolls back the transaction cleanly.
 *
 *   The rethrown error is annotated with `.checkoutPhase` and `.dbErrorCode`
 *   so the OUTER catch (checkout route) can report the FIRST failing query,
 *   not the downstream 25P02 symptom.
 *
 * RULES (see "FIX POSTGRES 25P02" task):
 *   - NEVER swallow a DB error inside an active PostgreSQL transaction.
 *   - On any DB error, immediately throw → Prisma auto-rollbacks.
 *   - If a side-effect is truly "best-effort" (audit log, movement log), it
 *     MUST run OUTSIDE the transaction using the `db` singleton (e.g.
 *     `safeEmitAuditEvent`), NEVER inside `tx`.
 */

import type { CheckoutPerf } from '@/lib/perf-timer'

/**
 * Wrap a DB operation inside a Prisma `$transaction`.
 *
 * Usage:
 *   const products = await txPhase(perf, 'productLoad', () =>
 *     tx.product.findMany({ where: { id: { in: productIds } } })
 *   )
 *
 * On error, the phase name is logged and the error is rethrown with
 * `.checkoutPhase` set so the outer handler can identify the FIRST failure.
 */
export async function txPhase<T>(
  perf: CheckoutPerf | null,
  phase: string,
  fn: () => Promise<T>,
): Promise<T> {
  perf?.start(phase)
  try {
    const result = await fn()
    perf?.end(phase)
    return result
  } catch (err) {
    perf?.end(phase)
    const code = extractDbErrorCode(err)
    const isAborted = isTransactionAbortedError(err)
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[txPhase] FAILED phase="${phase}" ` +
        `dbCode=${code || 'N/A'} ` +
        `txnAborted=${isAborted} ` +
        `:: ${msg}`
    )
    // Annotate + RETHROW. NEVER swallow. Prisma will rollback the transaction.
    if (err instanceof Error) {
      try {
        ;(err as Error & { checkoutPhase?: string; dbErrorCode?: string }).checkoutPhase = phase
        ;(err as Error & { dbErrorCode?: string }).dbErrorCode = code ?? undefined
      } catch {
        /* annotation is best-effort; the rethrow below is what matters */
      }
      throw err
    }
    throw new Error(`[phase=${phase}] ${String(err)}`)
  }
}

/**
 * Extract the PostgreSQL / Prisma error code from an error object.
 *
 * Prisma known-request errors carry `.code` (e.g. 'P2002' unique constraint,
 * 'P2003' FK violation, 'P2025' record not found). Raw PostgreSQL errors
 * carry `.code` as the SQLSTATE (e.g. '25P02', '23505', '23503').
 */
export function extractDbErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const anyErr = err as { code?: unknown; errno?: unknown }
  if (typeof anyErr.code === 'string' && anyErr.code) return anyErr.code
  if (typeof anyErr.errno === 'string' && anyErr.errno) return anyErr.errno
  return null
}

/**
 * Detect whether an error is the PostgreSQL "transaction aborted" symptom
 * (SQLSTATE 25P02) or Prisma's "transaction already closed" (P2028).
 *
 * IMPORTANT: when this returns true, the error is NOT the root cause — it's a
 * DOWNSTREAM symptom. The real failure happened in an EARLIER query inside the
 * same transaction (often one whose error was swallowed by a try/catch).
 */
export function isTransactionAbortedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const anyErr = err as { code?: unknown; message?: unknown }
  const msg = typeof anyErr.message === 'string' ? anyErr.message.toLowerCase() : ''
  return (
    anyErr.code === 'P2028' ||
    anyErr.code === '25P02' ||
    msg.includes('25p02') ||
    msg.includes('current transaction is aborted') ||
    msg.includes('commands ignored until end of transaction block')
  )
}

/**
 * Format an error for the checkout HTTP response, surfacing the FIRST failing
 * phase when available. If the error is a 25P02 symptom, note that an earlier
 * query is the real cause.
 */
export function formatTxError(err: unknown): string {
  if (err instanceof Error) {
    const phase = (err as Error & { checkoutPhase?: string }).checkoutPhase
    const code = (err as Error & { dbErrorCode?: string }).dbErrorCode
    const aborted = isTransactionAbortedError(err)
    const prefix = phase
      ? `[phase=${phase}${code ? ` code=${code}` : ''}${aborted ? ' (downstream 25P02 — earlier query is root cause)' : ''}]`
      : ''
    return `${prefix} ${err.message}`.trim()
  }
  return String(err)
}
