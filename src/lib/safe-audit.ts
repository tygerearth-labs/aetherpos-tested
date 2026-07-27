/**
 * safe-audit.ts — Legacy V1 audit helper, now routed through AuditLog V2.
 *
 * Audit logs are NON-CRITICAL. If they fail, the main operation must still
 * succeed. This helper wraps audit log creation in try/catch so it NEVER
 * throws and NEVER causes a 500 error.
 *
 * V2 ROUTING: legacy callers (action/entityType/details) are mapped to a
 * structured V2 event (eventType='LEGACY') with a title, summary, and a
 * metadata section. This guarantees the UI never renders "[object Object]"
 * even for call sites that have not yet been migrated to the explicit V2
 * builders.
 *
 * New code SHOULD use the explicit builders in `@/lib/audit-v2` instead.
 */

import { db } from '@/lib/db'
import { EventType, type AuditEvent, type AuditSection } from '@/lib/audit-v2/types'
import { safeEmitAuditEvent, toDisplay, fields } from '@/lib/audit-v2/emit'

interface AuditLogData {
  action: string
  entityType: string
  entityId?: string | null
  details?: string | null
  outletId: string
  userId: string
}

/** Parse a legacy `details` JSON string into a metadata section, best-effort. */
function legacyMetadataSection(details?: string | null): AuditSection | null {
  if (!details) return null
  let parsed: Record<string, unknown> = {}
  try {
    const v = JSON.parse(details)
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>
    else parsed = { value: v }
  } catch {
    // Not JSON → store as raw text
    parsed = { raw: details }
  }
  const f = fields(parsed)
  if (f.length === 0) return null
  return {
    type: 'metadata',
    label: 'Details',
    fields: f,
    collapsed: f.length > 6,
  }
}

/** Convert a legacy AuditLogData into a V2 AuditEvent. */
function toLegacyEvent(data: AuditLogData): AuditEvent {
  const metaSection = legacyMetadataSection(data.details)
  const title = `${data.action} · ${data.entityType}`
  const summary = data.details ? toDisplay(data.details).slice(0, 160) : `${data.action} on ${data.entityType}`
  return {
    eventType: EventType.LEGACY,
    title,
    summary,
    sections: metaSection ? [metaSection] : [],
    metadata: {
      legacyAction: data.action,
      legacyEntityType: data.entityType,
      legacyEntityId: data.entityId ?? null,
      legacyDetails: data.details ?? null,
    },
    sourceEntityType: data.entityType,
    sourceEntityId: data.entityId ?? null,
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId ?? null,
    v1Details: data.details ?? undefined,
    outletId: data.outletId,
    userId: data.userId,
  }
}

/**
 * Create an audit log entry. NEVER throws — failures are silently logged.
 * Use this for all audit log creation OUTSIDE of transactions.
 */
export async function safeAuditLog(data: AuditLogData): Promise<void> {
  await safeEmitAuditEvent(toLegacyEvent(data))
}

/**
 * Create multiple audit log entries. NEVER throws.
 *
 * NOTE: This is retained for backward compatibility. New event-oriented code
 * should emit ONE structured event per business action instead of N rows.
 */
export async function safeAuditLogMany(entries: AuditLogData[]): Promise<void> {
  try {
    // Emit each as a structured V2 legacy event (still one AuditLog row each,
    // but now UI-safe). Idempotency/atomicity is the caller's responsibility.
    await db.$transaction(
      async (tx) => {
        const { emitAuditEvent } = await import('@/lib/audit-v2/emit')
        for (const e of entries) {
          await emitAuditEvent(tx, toLegacyEvent(e))
        }
      },
      { timeout: 10000 },
    )
  } catch (error) {
    console.warn('[safe-audit] Failed to create audit logs:', error instanceof Error ? error.message : error)
  }
}
