/**
 * safe-audit.ts — Non-blocking audit log helper
 *
 * Audit logs are NON-CRITICAL. If they fail, the main operation
 * must still succeed. This helper wraps audit log creation in
 * try/catch so it NEVER throws and NEVER causes a 500 error.
 */

import { db } from '@/lib/db'

interface AuditLogData {
  action: string
  entityType: string
  entityId?: string | null
  details?: string | null
  outletId: string
  userId: string
}

/**
 * Create an audit log entry. NEVER throws — failures are silently logged.
 * Use this for all audit log creation OUTSIDE of transactions.
 */
export async function safeAuditLog(data: AuditLogData): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId ?? null,
        details: data.details ?? null,
        outletId: data.outletId,
        userId: data.userId,
      },
    })
  } catch (error) {
    // Audit logs are non-critical — log but never throw
    console.warn('[safe-audit] Failed to create audit log:', error instanceof Error ? error.message : error)
  }
}

/**
 * Create multiple audit log entries. NEVER throws.
 */
export async function safeAuditLogMany(entries: AuditLogData[]): Promise<void> {
  try {
    await db.auditLog.createMany({
      data: entries.map((e) => ({
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        details: e.details ?? null,
        outletId: e.outletId,
        userId: e.userId,
      })),
    })
  } catch (error) {
    console.warn('[safe-audit] Failed to create audit logs:', error instanceof Error ? error.message : error)
  }
}
