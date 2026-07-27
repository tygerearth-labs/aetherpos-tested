/**
 * audit-v2/index.ts — Public surface for the event-oriented AuditLog V2.
 *
 * Usage (transactional — preferred, commits atomically with the mutation):
 *   import { emitAuditEvent, buildSaleEvent } from '@/lib/audit-v2'
 *   await db.$transaction(async (tx) => {
 *     await tx.transaction.create({ ... })
 *     await emitAuditEvent(tx, buildSaleEvent({ ... }))
 *   })
 *
 * Usage (non-transactional — after a committed tx; never throws):
 *   import { safeEmitAuditEvent, buildMigrationBatchEvent } from '@/lib/audit-v2'
 *   await safeEmitAuditEvent(buildMigrationBatchEvent({ ... }))
 */

export * from './types'
export * from './emit'
export * from './builders'
