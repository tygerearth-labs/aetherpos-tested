/**
 * audit-v2/emit.ts — Event emitters + safe value formatting.
 *
 * Two emit modes:
 *   - `emitAuditEvent(tx, event)`  → transactional. Use INSIDE `db.$transaction`
 *                                    so the audit row commits atomically with
 *                                    the domain mutation (idempotency + atomicity).
 *   - `safeEmitAuditEvent(event)`  → non-transactional. Use AFTER a tx commits.
 *                                    Never throws (audit is non-critical).
 *
 * `toDisplay()` is the SINGLE source of truth for value formatting. Every
 * value that flows into `AuditField.v` / `AuditItem` values MUST go through
 * it, which guarantees the UI can NEVER render "[object Object]".
 */

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { AuditEvent, AuditField } from './types'

/**
 * Format any value into a UI-safe string. NEVER returns "[object Object]".
 * - null/undefined → ''
 * - string/number/boolean → String(v)
 * - Date → ISO string
 * - object/array → JSON.stringify (falls back to String on failure)
 */
export function toDisplay(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

/** Build a single AuditField from a raw value. */
export function field(k: string, v: unknown): AuditField {
  return { k, v: toDisplay(v) }
}

/** Build a list of AuditFields from a plain object. */
export function fields(obj: Record<string, unknown>): AuditField[] {
  return Object.entries(obj).map(([k, v]) => field(k, v))
}

/**
 * Serialize an AuditEvent into the Prisma `auditLog.create({ data })` shape,
 * mirroring V1 fields from V2 so legacy readers (bulk findMarker, void dedup)
 * keep working.
 */
function serializeEvent(ev: AuditEvent) {
  const sectionsJson =
    ev.sections && ev.sections.length > 0 ? safeStringify(ev.sections) : null
  const metadataObj = ev.metadata && Object.keys(ev.metadata).length > 0 ? ev.metadata : null
  const metadataJson = metadataObj ? safeStringify(metadataObj) : null

  const action = ev.action ?? ev.eventType
  const entityType = ev.entityType ?? ev.sourceEntityType ?? 'UNKNOWN'
  const entityId = ev.entityId ?? ev.sourceEntityId ?? ev.operationId ?? null

  // V1 `details` column: allow an explicit override (e.g. BULK_BATCH marker
  // JSON that findMarker parses). Otherwise emit a compact JSON summary.
  const details = ev.v1Details
    ? ev.v1Details
    : safeStringify({
        eventType: ev.eventType,
        title: ev.title,
        summary: ev.summary,
        sectionCount: ev.sections?.length ?? 0,
        hasMetadata: !!metadataJson,
        operationId: ev.operationId ?? null,
        ...(metadataObj || {}),
      })

  return {
    action,
    entityType,
    entityId,
    details,
    eventType: ev.eventType,
    title: ev.title,
    summary: ev.summary,
    sections: sectionsJson,
    metadata: metadataJson,
    operationId: ev.operationId ?? null,
    sourceEntityType: ev.sourceEntityType ?? null,
    sourceEntityId: ev.sourceEntityId ?? null,
    outletId: ev.outletId,
    userId: ev.userId,
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * Transactional emit. Use INSIDE `db.$transaction(async (tx) => { ... })`.
 * The audit row commits in the SAME transaction as the domain mutation,
 * preserving atomicity and idempotency.
 */
export async function emitAuditEvent(
  tx: Prisma.TransactionClient,
  ev: AuditEvent,
): Promise<void> {
  await tx.auditLog.create({ data: serializeEvent(ev) })
}

/**
 * Non-transactional emit. Use AFTER a transaction commits (the audit row
 * must not be inside a tx that already committed). Never throws — audit
 * is non-critical, so a logging failure must never break the main operation.
 */
export async function safeEmitAuditEvent(ev: AuditEvent): Promise<void> {
  try {
    await db.auditLog.create({ data: serializeEvent(ev) })
  } catch (error) {
    console.warn(
      '[audit-v2] safeEmitAuditEvent failed:',
      error instanceof Error ? error.message : error,
    )
  }
}
