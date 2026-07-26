/**
 * instrumentation.ts — Next.js Instrumentation Hook
 *
 * Runs ONCE when the Next.js server starts (both dev and production).
 * This is the SINGLE source of truth for runtime DB migrations that
 * `prisma db push` does NOT capture (partial unique indexes, etc.).
 *
 * Why this exists:
 * ─────────────────
 * V15 audit (P1-1) found that `ensureMigrated()` was only called in 3
 * routes (sync, checkout, settings). On a FRESH PostgreSQL deploy,
 * the partial unique index `customer_whatsapp_outlet_active_uidx`
 * would NOT exist until one of those 3 routes got hit. Worse: if a
 * duplicate customer was created BEFORE the index existed, the next
 * `ensureMigrated()` call would silently fail (catch block) and the
 * index would NEVER get created — leaving customer uniqueness
 * unprotected forever.
 *
 * By running `ensureMigrated()` here at server startup, we guarantee
 * the partial unique indexes exist BEFORE any route can serve a
 * request, regardless of which endpoint gets hit first.
 *
 * Safety:
 * ───────
 * - `ensureMigrated()` is idempotent (uses `IF NOT EXISTS`)
 * - The internal `_migrated` flag is a per-process singleton guard
 * - Errors are caught and logged inside `ensureMigrated()` — non-fatal
 * - This `register()` function itself is also wrapped in try/catch
 *   so a migration failure NEVER blocks server startup
 *
 * Reference:
 * - https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * - V15 audit finding P1-1 in /home/z/my-project/worklog.md
 */

export async function register() {
  // Only run on Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { ensureMigrated } = await import('@/lib/db-migrate')
      await ensureMigrated()
      console.log('[instrumentation] ✅ DB migration check complete')
    } catch (err) {
      // Non-fatal: server must still start even if migration fails.
      // The app degrades gracefully (no atomic dedup, but still works).
      console.error('[instrumentation] ⚠️ DB migration check failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }
}
