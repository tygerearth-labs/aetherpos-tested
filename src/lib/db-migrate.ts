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

    // CUST-002 (V14 fix): Partial unique index on Customer(whatsapp, outletId)
    // WHERE deletedAt IS NULL. This replaces the former @@unique([whatsapp, outletId])
    // in the Prisma schema, which was a FULL unique constraint and would throw
    // a unique-violation when re-creating a customer whose WhatsApp number was
    // previously soft-deleted. The partial index only enforces uniqueness among
    // ACTIVE (non-deleted) customers, matching the app-level check in
    // customers/route.ts (findFirst({ whatsapp, outletId, deletedAt: null })).
    // Works on both SQLite and PostgreSQL (both support partial unique indexes).
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "customer_whatsapp_outlet_active_uidx"
       ON "Customer" (whatsapp, "outletId") WHERE "deletedAt" IS NULL`
    )
    console.log('[db-migrate] ✅ Customer whatsapp partial unique index ensured')

    // BULK-ENGINE-V1 idempotency: partial unique index on AuditLog(entityId)
    // WHERE action='BULK_BATCH'. The bulk engine writes one marker row per
    // batch (entityId=operationId) inside the batch tx. On SQLite, the
    // database-level lock already prevents concurrent duplicates. On
    // PostgreSQL (READ COMMITTED), two concurrent txs could both read "no
    // marker exists" and both insert — this partial unique index makes the
    // second insert throw P2002, which the execute route can catch and
    // treat as "already processed" (returning the cached result).
    // The index is partial (WHERE action='BULK_BATCH') so it doesn't slow
    // down inserts for other audit log action types (CREATE, UPDATE, etc.).
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "auditlog_bulk_batch_opid_uidx"
       ON "AuditLog" ("entityId") WHERE action = 'BULK_BATCH'`
    )
    console.log('[db-migrate] ✅ Bulk batch idempotency unique index ensured')
  } catch (err) {
    // Non-fatal: if the index can't be created (e.g. duplicates already exist),
    // log and continue — the app still works, just without atomic dedup.
    console.warn('[db-migrate] sync dedup index creation skipped:', err instanceof Error ? err.message : err)
  }
}
