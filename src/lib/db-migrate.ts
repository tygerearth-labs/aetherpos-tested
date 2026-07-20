/**
 * Auto-migration helper for AetherPOS (SQLite).
 * Runs idempotent DDL that prisma db push doesn't capture (e.g. partial unique
 * indexes used as application-level locks / idempotency guards).
 *
 * Safe to call multiple times — each statement uses IF NOT EXISTS.
 */

import { db } from '@/lib/db'

let _migrated = false

export async function ensureMigrated(): Promise<void> {
  if (_migrated) return
  _migrated = true

  try {
    // AUDIT-1-004 FIX: Partial unique index on AuditLog(eventId) for SYNC_DEDUP.
    // This is the only way to make idempotency truly atomic in SQLite WAL mode:
    // two parallel sync transactions can both pass a SELECT-based dedup check
    // (neither sees the other's uncommitted write), but only ONE can insert the
    // SYNC_DEDUP marker — the second throws a unique-constraint violation which
    // the sync route catches and treats as "already processed".
    // The index is partial (WHERE action='SYNC_DEDUP') so it doesn't slow down
    // inserts for other audit log action types.
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "auditlog_sync_dedup_eventid_uidx"
       ON "AuditLog" ("entityId") WHERE action = 'SYNC_DEDUP'`
    )
    console.log('[db-migrate] ✅ Sync dedup unique index ensured')
  } catch (err) {
    // Non-fatal: if the index can't be created (e.g. duplicates already exist),
    // log and continue — the app still works, just without atomic dedup.
    console.warn('[db-migrate] sync dedup index creation skipped:', err instanceof Error ? err.message : err)
  }
}
