/**
 * Adapter: customer:edit (ROW-MODE).
 *
 * Updates existing active customers from Excel. Lookup priority:
 *   customerId → whatsapp → (email not supported — Customer has no email field)
 *
 * Rules (per V2 scope):
 *  - Only ACTIVE customers (deletedAt = null) can be edited.
 *  - Soft-deleted customers → row error (no silent restore).
 *  - WhatsApp uniqueness on update: if changing whatsapp, must not collide
 *    with another active customer (partial unique index enforced in DB).
 *  - Blank cell = no change (EDIT mode). 0 = valid value. CLEAR = clear field.
 *  - Audit create/update rows inside tx (tx.auditLog.createMany).
 *
 * Customer model has ONLY name + whatsapp (no email/phone/address/birthday).
 */

import type {
  BatchError,
  BatchResult,
  BatchStats,
  BulkChangeRecord,
  BulkClientAdapter,
  BulkServerAdapter,
  ColumnSpec,
  ExecutionPlan,
  ParsedRow,
  PreloadData,
  RowValidation,
} from '../types'
import { interpretCell } from '../cell-semantics'

const COLUMNS: ColumnSpec[] = [
  { key: 'id', label: 'ID Pelanggan', type: 'text', description: 'ID internal. Bisa kosong jika pakai WhatsApp.', aliases: ['id', 'id pelanggan', 'customer id'] },
  { key: 'whatsapp', label: 'WhatsApp (lookup)', type: 'text', description: 'WhatsApp existing untuk lookup. Wajib jika ID kosong.', aliases: ['whatsapp', 'wa', 'no hp', 'telepon', 'phone'] },
  { key: 'newName', label: 'Nama Baru', type: 'text', description: 'Kosongkan jika tidak mengubah nama.', aliases: ['nama', 'nama baru', 'name', 'new name'] },
  { key: 'newWhatsapp', label: 'WhatsApp Baru', type: 'text', description: 'Kosongkan jika tidak mengubah WhatsApp.', aliases: ['whatsapp baru', 'new whatsapp', 'new wa'] },
]

export const customerEditClient: BulkClientAdapter = {
  kind: 'customer:edit',
  label: 'Edit Pelanggan (Excel)',
  description: 'Update pelanggan existing secara massal dari Excel. Lookup by ID atau WhatsApp. Customer soft-deleted di-skip.',
  icon: 'UserCog',
  batchSize: 50,
  concurrency: 1,
  supportsClear: false,
  supportsDelete: false,
  templateColumns: COLUMNS,
  // V2: Edit-mode downloads EXISTING data formatted per COLUMNS (not blank
  // template). The export-existing endpoint emits active customers with
  // ID + WhatsApp (lookup) pre-filled; "Nama Baru" and "WhatsApp Baru"
  // columns left blank — user fills only what they want to change.
  templateEndpoint: '/api/bulk-engine/export-existing?kind=customer:edit',

  async parseFile(file: File) {
    const { parseWorkbookAsync } = await import('../sheet-parse')
    const res = await parseWorkbookAsync(file, { columns: COLUMNS, headerRow: 0 })
    return { rows: res.rows, sheetName: res.sheetName, warnings: res.warnings }
  },

  validateRow(row: ParsedRow): RowValidation {
    const errors: string[] = []
    const id = String(row.data.id || '').trim()
    const wa = String(row.data.whatsapp || '').trim()
    if (!id && !wa) {
      errors.push('ID atau WhatsApp wajib diisi (untuk lookup).')
    }
    const newWa = String(row.data.newWhatsapp || '').trim()
    if (newWa && !/^[0-9+\-\s]{8,20}$/.test(newWa)) {
      errors.push('Format WhatsApp Baru tidak valid (8-20 digit).')
    }
    return { valid: errors.length === 0, errors, warnings: [] }
  },

  executionMode: 'rows',
}

// ── Server adapter ─────────────────────────────────────────────────────────

interface CustomerEditPreload extends PreloadData {
  byId: Map<string, { id: string; name: string; whatsapp: string; deletedAt: Date | null }>
  byWhatsapp: Map<string, { id: string; name: string; whatsapp: string; deletedAt: Date | null }>
}

interface UpdateOp {
  rowIndex: number
  customerId: string
  fields: Record<string, unknown>
  rowSnapshot: Record<string, unknown>
}

export const customerEditServer: BulkServerAdapter = {
  kind: 'customer:edit',

  async preloadBatch(rows, context): Promise<CustomerEditPreload> {
    const { db } = await import('@/lib/db')
    const ids: string[] = []
    const was: string[] = []
    for (const r of rows) {
      const id = String(r.data.id || '').trim()
      const wa = String(r.data.whatsapp || '').trim()
      if (id) ids.push(id)
      if (wa) was.push(wa)
    }
    const uniqueIds = [...new Set(ids)]
    const uniqueWas = [...new Set(was)]
    const [byIdRows, byWaRows] = await Promise.all([
      uniqueIds.length
        ? db.customer.findMany({
            where: { outletId: context.outletId, id: { in: uniqueIds } },
            select: { id: true, name: true, whatsapp: true, deletedAt: true },
          })
        : Promise.resolve([]),
      uniqueWas.length
        ? db.customer.findMany({
            where: { outletId: context.outletId, whatsapp: { in: uniqueWas } },
            select: { id: true, name: true, whatsapp: true, deletedAt: true },
          })
        : Promise.resolve([]),
    ])
    const byId = new Map<string, { id: string; name: string; whatsapp: string; deletedAt: Date | null }>()
    const byWhatsapp = new Map<string, { id: string; name: string; whatsapp: string; deletedAt: Date | null }>()
    for (const c of byIdRows) byId.set(c.id, c)
    for (const c of byWaRows) byWhatsapp.set(c.whatsapp, c)
    // Merge: byId entries also indexed by whatsapp for cross-lookup.
    for (const c of byIdRows) if (!byWhatsapp.has(c.whatsapp)) byWhatsapp.set(c.whatsapp, c)
    for (const c of byWaRows) if (!byId.has(c.id)) byId.set(c.id, c)
    return { byId, byWhatsapp }
  },

  buildPlan(rows, preload, _context): ExecutionPlan {
    const p = preload as CustomerEditPreload
    const ops: UpdateOp[] = []
    const errors: BatchError[] = []
    let skipped = 0
    const seenIds = new Set<string>()

    for (const row of rows) {
      const id = String(row.data.id || '').trim()
      const wa = String(row.data.whatsapp || '').trim()

      let customer: { id: string; name: string; whatsapp: string; deletedAt: Date | null } | undefined
      if (id) customer = p.byId.get(id)
      if (!customer && wa) customer = p.byWhatsapp.get(wa)

      if (!customer) {
        errors.push({
          rowIndex: row.rowIndex,
          rowSnapshot: row.raw,
          code: 'CUSTOMER_NOT_FOUND',
          message: `Pelanggan tidak ditemukan (id="${id}" whatsapp="${wa}").`,
        })
        continue
      }

      // Soft-deleted → row error (no silent restore).
      if (customer.deletedAt) {
        errors.push({
          rowIndex: row.rowIndex,
          rowSnapshot: row.raw,
          code: 'CUSTOMER_SOFT_DELETED',
          message: `Pelanggan "${customer.name}" sudah dihapus (soft-delete). Tidak dapat diedit.`,
        })
        continue
      }

      if (seenIds.has(customer.id)) {
        errors.push({
          rowIndex: row.rowIndex,
          rowSnapshot: row.raw,
          code: 'DUPLICATE_LOOKUP',
          message: `Pelanggan "${customer.name}" muncul lebih dari sekali di batch ini.`,
        })
        continue
      }
      seenIds.add(customer.id)

      const fields: Record<string, unknown> = {}

      // newName — blank = no change.
      const interpName = interpretCell(row.data.newName, { supportsClear: false })
      if (interpName.kind === 'value') {
        const newName = String(interpName.value).trim()
        if (newName && newName !== customer.name) fields.name = newName
      }

      // newWhatsapp — blank = no change. If changing, check uniqueness.
      const interpWa = interpretCell(row.data.newWhatsapp, { supportsClear: false })
      if (interpWa.kind === 'value') {
        const newWa = String(interpWa.value).trim()
        if (newWa && newWa !== customer.whatsapp) {
          // Check collision with another active customer.
          const collision = p.byWhatsapp.get(newWa)
          if (collision && collision.id !== customer.id && !collision.deletedAt) {
            errors.push({
              rowIndex: row.rowIndex,
              rowSnapshot: row.raw,
              code: 'WHATSAPP_CONFLICT',
              message: `WhatsApp "${newWa}" sudah dipakai pelanggan aktif lain ("${collision.name}").`,
            })
            continue
          }
          fields.whatsapp = newWa
        }
      }

      if (Object.keys(fields).length === 0) {
        // No changes — skip.
        skipped++
        continue
      }

      ops.push({ rowIndex: row.rowIndex, customerId: customer.id, fields, rowSnapshot: row.raw })
    }

    return { operations: { ops, errors, skipped } }
  },

  async executeBatch(plan, tx, context, operationId): Promise<BatchResult> {
    const { ops, errors, skipped } = plan.operations as {
      ops: UpdateOp[]
      errors: BatchError[]
      skipped: number
    }
    const allErrors = [...errors]
    let updatedCount = 0
    // AuditLog V2: per-entity change records; folded into ONE BULK_BATCH event.
    const changes: BulkChangeRecord[] = []

    for (const op of ops) {
      try {
        await tx.customer.update({
          where: { id: op.customerId },
          data: op.fields,
        })
        updatedCount++
        changes.push({
          entity: 'CUSTOMER',
          identifier: (op.rowSnapshot?.name as string) || op.customerId,
          action: 'updated',
          after: op.fields as Record<string, unknown>,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Gagal update pelanggan.'
        // P2002 = whatsapp unique constraint violation (race with another tx).
        const code = err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002'
          ? 'WHATSAPP_DUPLICATE'
          : 'UPDATE_FAILED'
        allErrors.push({
          rowIndex: op.rowIndex,
          rowSnapshot: op.rowSnapshot,
          code,
          message,
        })
      }
    }

    const stats: BatchStats = {
      processed: ops.length + skipped,
      created: 0,
      updated: updatedCount,
      skipped,
      failed: allErrors.length,
      deleted: 0,
    }
    return { status: 'completed', stats, errors: allErrors, changes }
  },

  formatError(error, row) {
    return {
      rowIndex: row?.rowIndex || 0,
      rowSnapshot: row?.raw,
      code: 'CUSTOMER_EDIT_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }
  },

  summarize(stats, errorCount, batches) {
    const details: string[] = []
    if (stats.updated > 0) details.push(`${stats.updated} pelanggan diperbarui`)
    if (stats.skipped > 0) details.push(`${stats.skipped} tanpa perubahan`)
    if (errorCount > 0) details.push(`${errorCount} error`)
    const totalMs = batches.reduce((s, b) => s + b.durationMs, 0)
    details.push(`Total ${batches.length} batch · ${(totalMs / 1000).toFixed(1)}s`)
    return { label: stats.updated > 0 ? 'Edit pelanggan selesai' : 'Tidak ada perubahan', details }
  },
}
