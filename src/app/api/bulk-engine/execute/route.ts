/**
 * AETHER BULK ENGINE V1 — generic batch executor (V3 — no extra Prisma model).
 *
 * POST /api/bulk-engine/execute
 * Body: { kind, jobId, batchIndex, operationId, payloadHash, rows, context }
 *
 * Flow:
 *  1. Auth (OWNER-only for mutations).
 *  2. Look up server adapter by kind.
 *  3. Idempotency check by operationId (stored in the EXISTING AuditLog model
 *     with action='BULK_BATCH', entityId=operationId, outletId — NO extra
 *     Prisma table is needed):
 *     - exists + same payloadHash  → return cached result (retry, no dup)
 *     - exists + different payload → 409 conflict (reject)
 *     - not exists                  → proceed
 *  4. adapter.preloadBatch(rows, context) — collective preload into Maps (no
 *     per-row queries). Runs BEFORE tx.
 *  5. adapter.buildPlan(rows, preload, context) — pure function. Runs BEFORE tx.
 *  6. db.$transaction(timeout = adapter.txTimeoutMs || 30s):
 *     adapter.executeBatch(plan, tx, ...) + tx.auditLog.create() for the
 *     idempotency marker — atomic per batch. TransactionClient never escapes
 *     the callback.
 *  7. Return BatchResult.
 *
 * Max 50 rows per request (enforced). Concurrency = 1 (the client worker sends
 * batches sequentially). Race-safety on concurrent duplicates (e.g. two browser
 * tabs submitting the same opId) is enforced by a PARTIAL UNIQUE INDEX on
 * AuditLog(entityId) WHERE action='BULK_BATCH' (created in db-migrate.ts) —
 * the second concurrent insert throws P2002, which is caught and treated as
 * "already processed" (returning the cached result). This works on both SQLite
 * and PostgreSQL. Domain-level natural-key uniqueness (customer whatsapp,
 * product sku, inventory name+outletId) is the final safety net.
 */

import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { getServerAdapter } from '@/lib/bulk-engine/registry-server'
import type { AdapterContext, BatchResult, ParsedRow } from '@/lib/bulk-engine/types'
import { emitAuditEvent, buildBulkBatchEvent } from '@/lib/audit-v2'

export const maxDuration = 60

interface ExecuteRequest {
  kind: string
  jobId: string
  batchIndex: number
  operationId: string
  payloadHash?: string
  rows: ParsedRow[]
  context: {
    config?: Record<string, unknown>
  }
}

const MAX_ROWS = 50
const DEFAULT_TX_TIMEOUT = 30_000
const DEFAULT_TX_MAX_WAIT = 5_000

/** AuditLog action used to mark a bulk batch as completed/failed (idempotency marker). */
const BULK_MARKER_ACTION = 'BULK_BATCH'
/** AuditLog entityType for bulk idempotency markers. */
const BULK_MARKER_ENTITY_TYPE = 'BULK'

interface BulkMarkerDetails {
  operationId: string
  payloadHash: string
  jobId: string
  batchIndex: number
  adapterKind: string
  status: 'completed' | 'failed'
  stats: BatchResult['stats']
  errorCount: number
}

/** Compute SHA-256 payload hash for a batch of rows (default if adapter doesn't override). */
function computeDefaultPayloadHash(rows: ParsedRow[]): string {
  const h = createHash('sha256')
  // Deterministic serialization: sort keys, stringify values.
  for (const row of rows) {
    h.update(String(row.rowIndex))
    h.update(':')
    const keys = Object.keys(row.data).sort()
    for (const k of keys) {
      h.update(k)
      h.update('=')
      h.update(String(row.data[k]))
      h.update(';')
    }
    h.update('|')
  }
  return h.digest('hex')
}

/**
 * Find an existing idempotency marker for (operationId, outletId).
 * Returns the parsed BulkMarkerDetails, or null if no marker exists.
 *
 * Uses the existing AuditLog model with action='BULK_BATCH'. No extra Prisma
 * model is required.
 */
async function findMarker(
  operationId: string,
  outletId: string,
): Promise<BulkMarkerDetails | null> {
  const row = await db.auditLog.findFirst({
    where: {
      action: BULK_MARKER_ACTION,
      entityId: operationId,
      outletId,
    },
    select: { details: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!row?.details) return null
  try {
    return JSON.parse(row.details) as BulkMarkerDetails
  } catch {
    return null
  }
}

/** Build the cached BatchResult from a marker's stored stats. */
function cachedResultFromMarker(marker: BulkMarkerDetails): BatchResult {
  return {
    status: marker.status === 'failed' ? 'failed' : 'completed',
    stats: marker.stats || {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      deleted: 0,
    },
    errors: [],
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()
  if (user.role !== 'OWNER') {
    return safeJsonError('Hanya pemilik yang dapat menjalankan bulk import.', 403)
  }

  let body: ExecuteRequest
  try {
    body = (await request.json()) as ExecuteRequest
  } catch {
    return safeJsonError('Body JSON tidak valid.', 400)
  }

  const { kind, jobId, batchIndex, operationId, rows } = body
  if (!kind || !jobId || !operationId || !Array.isArray(rows)) {
    return safeJsonError('Parameter tidak lengkap (kind, jobId, operationId, rows wajib).', 400)
  }
  if (rows.length > MAX_ROWS) {
    return safeJsonError(`Maksimal ${MAX_ROWS} baris per batch (diterima ${rows.length}).`, 413)
  }

  const adapter = getServerAdapter(kind)
  if (!adapter) {
    return safeJsonError(`Adapter "${kind}" tidak ditemukan atau tidak mendukung row-mode.`, 400)
  }

  const context: AdapterContext = {
    outletId: user.outletId,
    userId: user.id,
    role: user.role,
    config: body.context?.config || {},
  }

  // ── Compute payload hash (for conflict detection) ──
  const payloadHash =
    body.payloadHash || adapter.computePayloadHash?.(rows) || computeDefaultPayloadHash(rows)

  // ── Idempotency check (read-only, outside tx) ──
  const existing = await findMarker(operationId, context.outletId)
  if (existing) {
    // Conflict: same operationId but different payload → reject (don't silently re-run)
    if (existing.payloadHash !== payloadHash) {
      return safeJsonError(
        `Konflik idempotensi: operationId "${operationId}" sudah diproses dengan payload berbeda.`,
        409,
      )
    }
    // Same operationId + same payloadHash → already processed, return cached (retry is no-op)
    return safeJson({ ...cachedResultFromMarker(existing), cached: true, operationId })
  }

  // ── Preload (collective, in-memory Maps) — BEFORE tx ──
  let preload
  try {
    preload = await adapter.preloadBatch(rows, context)
  } catch (err) {
    console.error(`[bulk-engine] preloadBatch failed for ${kind}:`, err)
    return safeJsonError(`Preload gagal: ${err instanceof Error ? err.message : String(err)}`, 500)
  }

  // ── Build plan (pure function) — BEFORE tx ──
  const plan = adapter.buildPlan(rows, preload, context)

  // ── Execute inside a short tx + write ONE BULK_BATCH audit event INSIDE tx ──
  // AuditLog V2: the idempotency marker is now a full structured BULK_BATCH
  // event (title, summary, changes section with per-entity before/after, errors
  // section). ONE row per batch — no per-row AuditLog spam. The V1 `details`
  // column still carries the BulkMarkerDetails JSON so findMarker() (idempotency
  // re-check) keeps working unchanged.
  const txTimeout = adapter.txTimeoutMs || DEFAULT_TX_TIMEOUT
  try {
    const result = await db.$transaction(
      async (tx) => {
        const res = await adapter.executeBatch(plan, tx, context, operationId)
        const markerDetails: BulkMarkerDetails = {
          operationId,
          payloadHash,
          jobId,
          batchIndex,
          adapterKind: kind,
          status: res.status,
          stats: res.stats,
          errorCount: res.errors.length,
        }
        await emitAuditEvent(
          tx,
          buildBulkBatchEvent({
            adapterKind: kind,
            operationId,
            jobId,
            batchIndex,
            payloadHash,
            status: res.status === 'failed' ? 'failed' : 'completed',
            stats: res.stats,
            changes: res.changes || [],
            errors: res.errors.map((e) => ({ row: e.rowIndex, message: e.message })),
            outletId: context.outletId,
            userId: context.userId,
            markerDetails: markerDetails as unknown as Record<string, unknown>,
          }),
        )
        return res
      },
      { timeout: txTimeout, maxWait: DEFAULT_TX_MAX_WAIT },
    )
    return safeJson(result)
  } catch (err) {
    // P2002 on AuditLog(entityId) WHERE action='BULK_BATCH' → another
    // concurrent request already completed this batch (the partial unique
    // index in db-migrate.ts enforces this on both SQLite and PostgreSQL).
    // Treat as success: re-read the marker and return the cached result.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const cached = await findMarker(operationId, context.outletId)
      if (cached) {
        // If payload differs, this was a conflict that lost the race — reject.
        if (cached.payloadHash !== payloadHash) {
          return safeJsonError(
            `Konflik idempotensi: operationId "${operationId}" sudah diproses dengan payload berbeda.`,
            409,
          )
        }
        return safeJson({ ...cachedResultFromMarker(cached), cached: true, operationId })
      }
    }
    console.error(`[bulk-engine] executeBatch failed for ${kind} (op=${operationId}):`, err)
    const message = err instanceof Error ? err.message : String(err)
    return safeJsonError(`Batch gagal: ${message}`, 500)
  }
}
