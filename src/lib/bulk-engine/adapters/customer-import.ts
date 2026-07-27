/**
 * Adapter: customer:add (ROW-MODE, GREENFIELD).
 *
 * New flow built on the AETHER BULK ENGINE. Creates new customers only.
 * Matched by WhatsApp — if an active customer with same WhatsApp exists, the
 * row is SKIPPED (not updated — use customer:edit for updates).
 *
 * Engine approach:
 *  - Client parses customer rows (≤50/batch).
 *  - Server preloadBatch: ONE findMany for all customers by whatsapp → Map.
 *  - buildPlan: pure-function create ops using Map (skip existing).
 *  - executeBatch: createMany for new + ONE auditLog.createMany.
 *    TransactionClient never escapes.
 *
 * Idempotency: operationId + payloadHash via AuditLog row
 * (action='BULK_BATCH'). Domain-level: whatsapp dedup (existing active
 * customer → skip, never duplicate create). Soft-deleted customers do NOT
 * block re-creation (partial unique index).
 *
 * Customer model has ONLY name + whatsapp (no email/phone/address/birthday).
 */

import type {
  BatchError,
  BatchResult,
  BatchStats,
  BulkClientAdapter,
  BulkServerAdapter,
  ColumnSpec,
  ExecutionPlan,
  ParsedRow,
  PreloadData,
  RowValidation,
} from '../types'

const COLUMNS: ColumnSpec[] = [
  { key: 'name', label: 'Nama', required: true, type: 'text', aliases: ['nama', 'name', 'nama pelanggan'] },
  { key: 'whatsapp', label: 'WhatsApp', required: true, type: 'text', aliases: ['whatsapp', 'wa', 'no hp', 'telepon', 'phone'] },
]

export const customerImportClient: BulkClientAdapter = {
  kind: 'customer:add',
  label: 'Tambah Pelanggan (Excel)',
  description: 'Tambah pelanggan baru secara massal dari Excel. Customer existing di-skip (gunakan Edit untuk update).',
  icon: 'UserPlus',
  batchSize: 50,
  concurrency: 1,
  supportsClear: false,
  supportsDelete: false,
  templateColumns: COLUMNS,

  async parseFile(file: File) {
    const { parseWorkbookAsync } = await import('../sheet-parse')
    const res = await parseWorkbookAsync(file, { columns: COLUMNS, headerRow: 0 })
    return { rows: res.rows, sheetName: res.sheetName, warnings: res.warnings }
  },

  validateRow(row: ParsedRow): RowValidation {
    const errors: string[] = []
    const name = String(row.data.name || '').trim()
    const whatsapp = String(row.data.whatsapp || '').trim()
    if (!name) errors.push('Nama wajib diisi.')
    if (!whatsapp) errors.push('WhatsApp wajib diisi.')
    else if (!/^[0-9+\-\s]{8,20}$/.test(whatsapp))
      errors.push('Format WhatsApp tidak valid (8-20 digit).')
    return { valid: errors.length === 0, errors, warnings: [] }
  },

  executionMode: 'rows',
}

// ── Server adapter ─────────────────────────────────────────────────────────

interface CustomerPreload extends PreloadData {
  byWhatsapp: Map<string, { id: string; name: string }>
}

interface CreateOp {
  rowIndex: number
  name: string
  whatsapp: string
  rowSnapshot: Record<string, unknown>
}

export const customerImportServer: BulkServerAdapter = {
  kind: 'customer:add',

  async preloadBatch(rows, context): Promise<CustomerPreload> {
    const { db } = await import('@/lib/db')
    const was = rows
      .map((r) => String(r.data.whatsapp || '').trim())
      .filter(Boolean)
    const uniqueWas = [...new Set(was)]
    const existing = await db.customer.findMany({
      where: { outletId: context.outletId, deletedAt: null, whatsapp: { in: uniqueWas } },
      select: { id: true, name: true, whatsapp: true },
    })
    const byWhatsapp = new Map<string, { id: string; name: string }>()
    for (const c of existing) byWhatsapp.set(c.whatsapp, { id: c.id, name: c.name })
    return { byWhatsapp }
  },

  buildPlan(rows, preload, _context): ExecutionPlan {
    const p = preload as CustomerPreload
    const creates: CreateOp[] = []
    const errors: BatchError[] = []
    let skipped = 0

    for (const row of rows) {
      const name = String(row.data.name || '').trim()
      const whatsapp = String(row.data.whatsapp || '').trim()
      if (!name || !whatsapp) {
        errors.push({
          rowIndex: row.rowIndex,
          rowSnapshot: row.raw,
          code: 'MISSING_REQUIRED',
          message: 'Nama dan WhatsApp wajib diisi.',
        })
        continue
      }
      const existing = p.byWhatsapp.get(whatsapp)
      if (existing) {
        // Skip — customer already exists (use customer:edit to update).
        skipped++
        continue
      }
      creates.push({ rowIndex: row.rowIndex, name, whatsapp, rowSnapshot: row.raw })
    }
    return { operations: { creates, errors, skipped } }
  },

  async executeBatch(plan, tx, context, operationId): Promise<BatchResult> {
    const { creates, errors, skipped } = plan.operations as {
      creates: CreateOp[]
      errors: BatchError[]
      skipped: number
    }
    const allErrors = [...errors]
    let createdCount = 0
    const auditData: Array<Record<string, unknown>> = []

    if (creates.length > 0) {
      try {
        const CHUNK = 100
        for (let i = 0; i < creates.length; i += CHUNK) {
          await tx.customer.createMany({
            data: creates.slice(i, i + CHUNK).map((c) => ({
              name: c.name,
              whatsapp: c.whatsapp,
              outletId: context.outletId,
            })),
          })
        }
        createdCount = creates.length
        for (const c of creates) {
          auditData.push({
            action: 'CREATE',
            entityType: 'CUSTOMER',
            entityId: '',
            details: JSON.stringify({ customerName: c.name, whatsapp: c.whatsapp, bulkOperationId: operationId }),
            outletId: context.outletId,
            userId: context.userId,
          })
        }
      } catch (err) {
        allErrors.push({
          rowIndex: 0,
          code: 'CREATE_BATCH_FAILED',
          message: err instanceof Error ? err.message : 'Gagal membuat pelanggan baru.',
        })
      }
    }

    if (auditData.length > 0) {
      const CHUNK = 100
      for (let i = 0; i < auditData.length; i += CHUNK) {
        await tx.auditLog.createMany({ data: auditData.slice(i, i + CHUNK) as never })
      }
    }

    const stats: BatchStats = {
      processed: creates.length + skipped,
      created: createdCount,
      updated: 0,
      skipped,
      failed: allErrors.length,
      deleted: 0,
    }
    return { status: 'completed', stats, errors: allErrors }
  },

  formatError(error, row) {
    return {
      rowIndex: row?.rowIndex || 0,
      rowSnapshot: row?.raw,
      code: 'CUSTOMER_ADD_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }
  },

  summarize(stats, errorCount, batches) {
    const details: string[] = []
    if (stats.created > 0) details.push(`${stats.created} pelanggan baru`)
    if (stats.skipped > 0) details.push(`${stats.skipped} di-skip (sudah ada)`)
    if (errorCount > 0) details.push(`${errorCount} error`)
    const totalMs = batches.reduce((s, b) => s + b.durationMs, 0)
    details.push(`Total ${batches.length} batch · ${(totalMs / 1000).toFixed(1)}s`)
    return { label: stats.created > 0 ? 'Tambah pelanggan selesai' : 'Tidak ada pelanggan baru', details }
  },
}
