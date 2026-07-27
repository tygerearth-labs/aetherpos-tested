/**
 * AETHER BULK ENGINE V2 — PURCHASE DELEGATE ROUTE.
 *
 * Receives FormData(file, mode, batchNumber, jobId, operationId) from the
 * bulk-worker-provider (file-delegate mode) and reuses the existing
 * /api/purchases routes (POST for add, PUT for edit) to create or update
 * PurchaseOrders per Excel PO group.
 *
 * WHY DELEGATE: the /api/purchases POST handler is ~380 lines of carefully
 * ordered 3-phase transactional logic with FEFO batch creation, HPP
 * recalculation, P2002 race-safety, and audit/movement logging. Inline
 * duplication would diverge. Calling the existing route via internal fetch
 * (with the user's auth cookie) keeps the logic in ONE place — zero
 * duplication, automatic reuse of all future fixes.
 *
 * FLOW (per batch):
 *  1. Auth (OWNER-only) — outletId + userId from JWT.
 *  2. Parse the Excel file server-side (dynamic xlsx import).
 *  3. Slice rows by batchIndex * batchSize .. (batchIndex+1) * batchSize.
 *  4. Group sliced rows by `poNumber` column (each group = one PO).
 *  5. For each PO group:
 *     a. subOperationId = `${operationId}-po${poIndex}` (per-PO idempotency).
 *     b. If an AuditLog row (action='BULK_BATCH', entityId=subOperationId)
 *        exists → skip (already done).
 *     c. mode='add'  : build POST /api/purchases payload (items + newItems)
 *                      → internal fetch POST /api/purchases with auth cookie.
 *     d. mode='edit' : lookup existing PO by orderNumber + outletId
 *                      → build PUT /api/purchases/[id] payload
 *                      → internal fetch PUT /api/purchases/[id].
 *     e. Write the AuditLog marker row (the internal fetch already committed
 *        its own tx — we just record that we did it).
 *     f. Collect per-PO errors / stats.
 *  6. Return aggregated BatchResult JSON.
 *
 * IDEMPOTENCY: per-PO subOperationId marker stored in the EXISTING AuditLog
 * model (no extra Prisma table). On retry, already-completed POs are skipped.
 * The small gap between the fetch commit and the marker write is accepted: a
 * crash there means a retry could duplicate that one PO (the server
 * auto-generates a fresh orderNumber, so no constraint violation — just a
 * duplicate PO). To minimize this, the marker is written IMMEDIATELY after
 * each successful fetch (before the next PO is processed).
 *
 * LIMITATIONS (documented):
 *  - A PO spanning more than `batchSize` rows will be split across batches.
 *    Each batch creates a separate PO with a fresh orderNumber. Users should
 *    keep POs ≤ 50 rows.
 *  - For mode='edit', items that don't yet exist as InventoryItems are
 *    rejected (the PUT route requires inventoryItemId). The user must create
 *    the item first via the add flow.
 *  - For mode='edit', changing supplier is supported via a pre-PUT update
 *    (the PUT route itself does not touch supplierId).
 *  - For mode='edit', the PUT route throws if any old batch was partially
 *    consumed (remainingQty < initialQty). This is intentional: protects
 *    FEFO consumption-log integrity. The error is surfaced per-PO.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import {
  findColumn,
  normalizeHeader,
  parseExcelDate,
  sanitizeNumber,
} from '@/lib/excel-utils'
import type { BatchError, BatchResult, BatchStats } from '@/lib/bulk-engine/types'

export const maxDuration = 120

const BATCH_SIZE = 50
const MAX_FILE_BYTES = 5 * 1024 * 1024

// ── Column aliases (must match the client adapter's COLUMNS spec) ──────────
const COL_PO_NUMBER = ['no po', 'po number', 'po', 'nomor po']
const COL_SUPPLIER = ['supplier', 'pemasok', 'supplier name']
const COL_NOTES = ['catatan', 'notes', 'keterangan']
const COL_ITEM_NAME = ['nama bahan', 'item name', 'nama item', 'nama']
const COL_ITEM_SKU = ['sku', 'kode bahan', 'item sku']
const COL_PURCHASE_QTY = ['qty beli', 'purchase qty', 'qty', 'jumlah']
const COL_PURCHASE_UNIT = ['satuan beli', 'purchase unit', 'satuan']
const COL_BASE_QTY = ['qty dasar', 'base qty', 'konversi']
const COL_BASE_UNIT = ['satuan dasar', 'base unit']
const COL_UNIT_COST = ['harga satuan', 'unit cost', 'harga']
const COL_BATCH = ['batch', 'no batch', 'batch number']
const COL_EXPIRED = ['expired', 'tgl expired', 'expired date', 'kadaluarsa']

interface ParsedPurchaseRow {
  rowIndex: number
  poNumber: string
  supplierName: string | null
  notes: string | null
  itemName: string
  itemSku: string | null
  purchaseQty: number
  purchaseUnit: string
  baseQty: number
  baseUnit: string
  unitCost: number
  batch: string | null
  expiredDate: string | null
  raw: Record<string, unknown>
}

interface PoGroup {
  poKey: string
  supplierName: string | null
  notes: string | null
  firstRowIndex: number
  items: ParsedPurchaseRow[]
}

/** Parse a single raw Excel row into a normalized ParsedPurchaseRow. */
function parseRow(raw: Record<string, unknown>, rowIndex: number): ParsedPurchaseRow | null {
  // Skip fully-empty rows.
  const hasData = Object.values(raw).some(
    (v) => v !== null && v !== undefined && String(v).trim() !== '',
  )
  if (!hasData) return null

  const poNumber = String(findColumn(raw, COL_PO_NUMBER) ?? '').trim()
  const supplierName = String(findColumn(raw, COL_SUPPLIER) ?? '').trim() || null
  const notes = String(findColumn(raw, COL_NOTES) ?? '').trim() || null
  const itemName = String(findColumn(raw, COL_ITEM_NAME) ?? '').trim()
  const itemSku = String(findColumn(raw, COL_ITEM_SKU) ?? '').trim() || null
  const purchaseQty = sanitizeNumber(findColumn(raw, COL_PURCHASE_QTY))
  const purchaseUnit = String(findColumn(raw, COL_PURCHASE_UNIT) ?? '').trim() || 'pcs'
  const baseQty = sanitizeNumber(findColumn(raw, COL_BASE_QTY)) || 1
  const baseUnit = String(findColumn(raw, COL_BASE_UNIT) ?? '').trim() || 'pcs'
  const unitCost = sanitizeNumber(findColumn(raw, COL_UNIT_COST))
  const batch = String(findColumn(raw, COL_BATCH) ?? '').trim() || null
  const expiredDate = parseExcelDate(findColumn(raw, COL_EXPIRED))

  return {
    rowIndex,
    poNumber,
    supplierName,
    notes,
    itemName,
    itemSku,
    purchaseQty,
    purchaseUnit,
    baseQty,
    baseUnit,
    unitCost,
    batch,
    expiredDate,
    raw,
  }
}

/** Parse the workbook, slice by batchIndex, group by poNumber. */
async function parseAndGroup(
  file: File,
  batchIndex: number,
): Promise<{ groups: PoGroup[]; totalRows: number; warnings: string[] }> {
  const XLSXmod = await import('xlsx')
  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = XLSXmod.read(buffer, { type: 'buffer' })

  const warnings: string[] = []
  if (workbook.SheetNames.length === 0) {
    return { groups: [], totalRows: 0, warnings: ['File Excel kosong.'] }
  }

  // Pick the first sheet whose name suggests "purchase"/"po", else the first sheet.
  let sheetName = workbook.SheetNames[0]
  for (const n of workbook.SheetNames) {
    const norm = normalizeHeader(n)
    if (norm.includes('purchase') || norm.includes('po') || norm.includes('pembelian')) {
      sheetName = n
      break
    }
  }
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return { groups: [], totalRows: 0, warnings: [`Sheet "${sheetName}" tidak ditemukan.`] }
  }

  const rawRows = XLSXmod.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  })

  // Parse all rows.
  const allParsed: ParsedPurchaseRow[] = []
  for (let i = 0; i < rawRows.length; i++) {
    const parsed = parseRow(rawRows[i], i + 1)
    if (parsed) allParsed.push(parsed)
  }

  // Slice by batchIndex * BATCH_SIZE .. (batchIndex+1) * BATCH_SIZE.
  const start = batchIndex * BATCH_SIZE
  const end = Math.min(start + BATCH_SIZE, allParsed.length)
  const sliced = allParsed.slice(start, end)

  // Group by poNumber.
  const groupMap = new Map<string, PoGroup>()
  for (const row of sliced) {
    const poKey = row.poNumber || 'PO-DEFAULT'
    let g = groupMap.get(poKey)
    if (!g) {
      g = {
        poKey,
        supplierName: row.supplierName,
        notes: row.notes,
        firstRowIndex: row.rowIndex,
        items: [],
      }
      groupMap.set(poKey, g)
    } else {
      // First non-null values win for supplierName / notes.
      if (!g.supplierName && row.supplierName) g.supplierName = row.supplierName
      if (!g.notes && row.notes) g.notes = row.notes
    }
    g.items.push(row)
  }

  return {
    groups: [...groupMap.values()],
    totalRows: allParsed.length,
    warnings,
  }
}

/** Look up supplierId by name + outletId (case-insensitive). Returns null if not found. */
async function resolveSupplierByName(
  name: string,
  outletId: string,
): Promise<string | null> {
  const supplier = await db.supplier.findFirst({
    where: { outletId, name: { equals: name } },
    select: { id: true },
  })
  return supplier?.id ?? null
}

/**
 * Build the POST /api/purchases payload for a PO group.
 *
 * Splits items into:
 *  - `items`: existing InventoryItems (resolved by name + outletId)
 *  - `newItems`: items not yet in DB (route creates them inline by `key`)
 *
 * Returns `{ payload, errors }` where errors are per-row validation failures
 * that prevent the PO from being created.
 */
async function buildCreatePayload(
  group: PoGroup,
  outletId: string,
): Promise<{
  payload: Record<string, unknown>
  errors: BatchError[]
}> {
  const errors: BatchError[] = []

  // Pre-validate rows.
  for (const row of group.items) {
    if (!row.itemName) {
      errors.push({
        rowIndex: row.rowIndex,
        rowSnapshot: row.raw,
        code: 'MISSING_ITEM_NAME',
        message: 'Nama bahan wajib diisi.',
      })
    }
    if (row.purchaseQty <= 0) {
      errors.push({
        rowIndex: row.rowIndex,
        rowSnapshot: row.raw,
        code: 'INVALID_QTY',
        message: 'Qty beli harus > 0.',
      })
    }
    if (row.baseQty <= 0) {
      errors.push({
        rowIndex: row.rowIndex,
        rowSnapshot: row.raw,
        code: 'INVALID_BASE_QTY',
        message: 'Qty dasar harus > 0.',
      })
    }
    if (row.unitCost < 0) {
      errors.push({
        rowIndex: row.rowIndex,
        rowSnapshot: row.raw,
        code: 'INVALID_COST',
        message: 'Harga satuan tidak boleh negatif.',
      })
    }
  }
  if (errors.length > 0) return { payload: {}, errors }

  // Resolve existing inventory items by name (single query).
  const existing = await db.inventoryItem.findMany({
    where: { outletId, name: { in: group.items.map((r) => r.itemName) } },
    select: { id: true, name: true },
  })
  const existingByName = new Map(
    existing.map((e) => [e.name.toLowerCase(), e.id]),
  )

  // Resolve supplier. If supplierName is provided but not found, proceed
  // without a supplier (the POST /api/purchases route accepts supplierId=null).
  const supplierId = group.supplierName
    ? await resolveSupplierByName(group.supplierName, outletId)
    : null

  const items: Array<Record<string, unknown>> = []
  const newItems: Array<Record<string, unknown>> = []
  let newKeyCounter = 0
  const usedKeys = new Set<string>()

  for (const row of group.items) {
    const existingId = existingByName.get(row.itemName.toLowerCase())
    const totalCost = row.baseQty * row.unitCost
    const itemFields = {
      purchaseQty: row.purchaseQty,
      purchaseUnit: row.purchaseUnit,
      baseQty: row.baseQty,
      baseUnit: row.baseUnit,
      unitCost: row.unitCost,
      totalCost,
      batch: row.batch,
      expiredDate: row.expiredDate,
    }
    if (existingId) {
      items.push({ inventoryItemId: existingId, ...itemFields })
    } else {
      // Generate a unique key for this new item (deduped by name within the group).
      let key = `new-${row.itemName.toLowerCase().replace(/\s+/g, '-')}`
      if (usedKeys.has(key)) {
        newKeyCounter++
        key = `${key}-${newKeyCounter}`
      }
      usedKeys.add(key)
      newItems.push({
        key,
        name: row.itemName,
        sku: row.itemSku,
        ...itemFields,
      })
    }
  }

  const payload: Record<string, unknown> = {
    supplierId: supplierId || null,
    notes: group.notes || `Import PO: ${group.poKey}`,
    items,
    newItems,
  }

  return { payload, errors }
}

/**
 * Build the PUT /api/purchases/[id] payload for a PO group.
 *
 * Edit mode requires all items to have an `inventoryItemId` — the PUT route
 * does NOT support inline item creation. Items not found in DB are errors.
 *
 * Returns `{ payload, errors, poId, supplierUpdate }`:
 *  - `poId`: the existing PurchaseOrder ID (null if PO not found)
 *  - `supplierUpdate`: optional { supplierId } to apply via a separate
 *    pre-PUT update (the PUT route itself does not touch supplierId).
 */
async function buildEditPayload(
  group: PoGroup,
  outletId: string,
): Promise<{
  payload: Record<string, unknown> | null
  poId: string | null
  supplierUpdate: { supplierId: string | null } | null
  errors: BatchError[]
}> {
  const errors: BatchError[] = []

  // Look up the existing PO by orderNumber + outletId.
  const existingPo = await db.purchaseOrder.findFirst({
    where: { orderNumber: group.poKey, outletId },
    select: { id: true, supplierId: true },
  })
  if (!existingPo) {
    return {
      payload: null,
      poId: null,
      supplierUpdate: null,
      errors: [
        {
          rowIndex: group.firstRowIndex,
          rowSnapshot: group.items[0]?.raw || {},
          code: 'PO_NOT_FOUND',
          message: `PO dengan orderNumber "${group.poKey}" tidak ditemukan di outlet ini.`,
        },
      ],
    }
  }

  // Pre-validate rows.
  for (const row of group.items) {
    if (!row.itemName) {
      errors.push({
        rowIndex: row.rowIndex,
        rowSnapshot: row.raw,
        code: 'MISSING_ITEM_NAME',
        message: 'Nama bahan wajib diisi.',
      })
    }
    if (row.purchaseQty <= 0) {
      errors.push({
        rowIndex: row.rowIndex,
        rowSnapshot: row.raw,
        code: 'INVALID_QTY',
        message: 'Qty beli harus > 0.',
      })
    }
    if (row.baseQty <= 0) {
      errors.push({
        rowIndex: row.rowIndex,
        rowSnapshot: row.raw,
        code: 'INVALID_BASE_QTY',
        message: 'Qty dasar harus > 0.',
      })
    }
    if (row.unitCost < 0) {
      errors.push({
        rowIndex: row.rowIndex,
        rowSnapshot: row.raw,
        code: 'INVALID_COST',
        message: 'Harga satuan tidak boleh negatif.',
      })
    }
  }
  if (errors.length > 0) {
    return { payload: null, poId: existingPo.id, supplierUpdate: null, errors }
  }

  // Resolve all item names → IDs (edit mode requires existing items).
  const existing = await db.inventoryItem.findMany({
    where: { outletId, name: { in: group.items.map((r) => r.itemName) } },
    select: { id: true, name: true },
  })
  const existingByName = new Map(
    existing.map((e) => [e.name.toLowerCase(), e.id]),
  )

  const items: Array<Record<string, unknown>> = []
  for (const row of group.items) {
    const existingId = existingByName.get(row.itemName.toLowerCase())
    if (!existingId) {
      errors.push({
        rowIndex: row.rowIndex,
        rowSnapshot: row.raw,
        code: 'ITEM_NOT_FOUND',
        message: `Item "${row.itemName}" tidak ditemukan. Edit mode memerlukan item yang sudah ada (gunakan flow Tambah untuk item baru).`,
      })
      continue
    }
    items.push({
      inventoryItemId: existingId,
      purchaseQty: row.purchaseQty,
      purchaseUnit: row.purchaseUnit,
      baseQty: row.baseQty,
      baseUnit: row.baseUnit,
      unitCost: row.unitCost,
      totalCost: row.baseQty * row.unitCost,
      batch: row.batch,
      expiredDate: row.expiredDate,
    })
  }
  if (errors.length > 0 || items.length === 0) {
    return { payload: null, poId: existingPo.id, supplierUpdate: null, errors }
  }

  // Supplier change (optional pre-PUT update).
  let supplierUpdate: { supplierId: string | null } | null = null
  if (group.supplierName) {
    const newSupplierId = await resolveSupplierByName(group.supplierName, outletId)
    if (newSupplierId && newSupplierId !== existingPo.supplierId) {
      supplierUpdate = { supplierId: newSupplierId }
    }
  }

  const payload: Record<string, unknown> = {
    notes: group.notes ?? null,
    items,
  }

  return { payload, poId: existingPo.id, supplierUpdate, errors }
}

/** Make an internal fetch to /api/purchases (or /api/purchases/[id]) with the user's auth cookie. */
async function callPurchaseRoute(
  method: 'POST' | 'PUT',
  path: string,
  payload: Record<string, unknown>,
  cookieHeader: string | null,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`http://localhost:3000${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(payload),
  })
  const contentType = res.headers.get('content-type') || ''
  let data: Record<string, unknown> = {}
  if (contentType.includes('application/json')) {
    data = (await res.json()) as Record<string, unknown>
  } else {
    const text = await res.text().catch(() => '')
    data = { error: text.substring(0, 500) || `Non-JSON response (${res.status})` }
  }
  return { ok: res.ok, status: res.status, data }
}

/** Write the per-PO idempotency marker as an AuditLog row (no extra Prisma model). */
async function writeIdempotencyMarker(params: {
  subOperationId: string
  operationId: string
  jobId: string
  batchIndex: number
  adapterKind: 'purchase:add' | 'purchase:edit'
  outletId: string
  userId: string
  status: 'completed' | 'failed'
  stats: BatchStats
  errorCount: number
}): Promise<void> {
  try {
    const details = JSON.stringify({
      operationId: params.subOperationId,
      payloadHash: `delegate-${params.operationId}-po`,
      jobId: params.jobId,
      batchIndex: params.batchIndex,
      adapterKind: params.adapterKind,
      status: params.status,
      stats: params.stats,
      errorCount: params.errorCount,
    })
    await db.auditLog.create({
      data: {
        action: 'BULK_BATCH',
        entityType: 'BULK',
        entityId: params.subOperationId,
        details,
        outletId: params.outletId,
        userId: params.userId,
      },
    })
  } catch (err) {
    // Log but don't throw — the PO was already created/edited successfully.
    console.error(`[purchase-delegate] marker write failed for ${params.subOperationId}:`, err)
  }
}

export async function POST(request: NextRequest) {
  // ── Auth ──
  const user = await getAuthUser(request)
  if (!user) return unauthorized()
  if (user.role !== 'OWNER') {
    return safeJsonError('Hanya OWNER yang dapat menjalankan bulk import pembelian.', 403)
  }
  const outletId = user.outletId
  const cookieHeader = request.headers.get('cookie')

  // ── Parse FormData ──
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return safeJsonError('FormData tidak valid.', 400)
  }

  const file = formData.get('file') as File | null
  const mode = String(formData.get('mode') || 'add') // 'add' | 'edit'
  const jobId = String(formData.get('jobId') || '')
  const batchIndexRaw = parseInt(String(formData.get('batchIndex') ?? formData.get('batchNumber') ?? '0'), 10)
  const batchIndex = isNaN(batchIndexRaw) ? 0 : batchIndexRaw
  const operationId = String(formData.get('operationId') || `${jobId}-${batchIndex}`)

  if (!file) {
    return safeJsonError('File tidak ditemukan di FormData.', 400)
  }
  if (mode !== 'add' && mode !== 'edit') {
    return safeJsonError(`Mode tidak valid: "${mode}" (harus "add" atau "edit").`, 400)
  }
  if (file.size > MAX_FILE_BYTES) {
    return safeJsonError('Ukuran file melebihi 5MB.', 400)
  }
  if (!jobId || !operationId) {
    return safeJsonError('Parameter jobId/operationId wajib diisi.', 400)
  }

  const adapterKind: 'purchase:add' | 'purchase:edit' = mode === 'edit' ? 'purchase:edit' : 'purchase:add'

  // ── Parse + slice + group ──
  let parsed: { groups: PoGroup[]; totalRows: number; warnings: string[] }
  try {
    parsed = await parseAndGroup(file, batchIndex)
  } catch (err) {
    console.error('[purchase-delegate] parse error:', err)
    return safeJsonError(
      `Gagal parse Excel: ${err instanceof Error ? err.message : String(err)}`,
      400,
    )
  }

  const { groups, totalRows, warnings } = parsed
  const errors: BatchError[] = []
  let created = 0
  let updated = 0
  let skipped = 0
  let failed = 0
  let processed = 0

  // ── Process each PO group ──
  for (let poIndex = 0; poIndex < groups.length; poIndex++) {
    const group = groups[poIndex]
    const subOperationId = `${operationId}-po${poIndex}`

    // Idempotency check: skip if an AuditLog marker row already exists.
    try {
      const existing = await db.auditLog.findFirst({
        where: {
          action: 'BULK_BATCH',
          entityId: subOperationId,
          outletId,
        },
        select: { id: true },
      })
      if (existing) {
        skipped++
        processed += group.items.length
        continue
      }
    } catch {
      // Non-fatal — proceed with the fetch.
    }

    processed += group.items.length

    if (mode === 'add') {
      // ── ADD: POST /api/purchases ──
      const { payload, errors: payloadErrors } = await buildCreatePayload(group, outletId)
      if (payloadErrors.length > 0) {
        errors.push(...payloadErrors)
        failed += payloadErrors.length
        // Write a failed marker so retry doesn't re-validate the same broken rows.
        await writeIdempotencyMarker({
          subOperationId,
          operationId,
          jobId,
          batchIndex,
          adapterKind,
          outletId,
          userId: user.id,
          status: 'failed',
          stats: { processed: group.items.length, created: 0, updated: 0, skipped: 0, failed: payloadErrors.length, deleted: 0 },
          errorCount: payloadErrors.length,
        })
        continue
      }

      const result = await callPurchaseRoute('POST', '/api/purchases', payload, cookieHeader)
      if (!result.ok) {
        const msg = (result.data.error as string) || `HTTP ${result.status}`
        errors.push({
          rowIndex: group.firstRowIndex,
          rowSnapshot: group.items[0]?.raw || {},
          code: 'PO_CREATE_FAILED',
          message: `Gagal membuat PO "${group.poKey}": ${msg}`,
        })
        failed += group.items.length
        await writeIdempotencyMarker({
          subOperationId,
          operationId,
          jobId,
          batchIndex,
          adapterKind,
          outletId,
          userId: user.id,
          status: 'failed',
          stats: { processed: group.items.length, created: 0, updated: 0, skipped: 0, failed: group.items.length, deleted: 0 },
          errorCount: 1,
        })
        continue
      }

      created++
      await writeIdempotencyMarker({
        subOperationId,
        operationId,
        jobId,
        batchIndex,
        adapterKind,
        outletId,
        userId: user.id,
        status: 'completed',
        stats: { processed: group.items.length, created: 1, updated: 0, skipped: 0, failed: 0, deleted: 0 },
        errorCount: 0,
      })
    } else {
      // ── EDIT: PUT /api/purchases/[id] ──
      const { payload, poId, supplierUpdate, errors: payloadErrors } = await buildEditPayload(group, outletId)
      if (payloadErrors.length > 0 || !payload || !poId) {
        errors.push(...payloadErrors)
        failed += Math.max(payloadErrors.length, group.items.length)
        await writeIdempotencyMarker({
          subOperationId,
          operationId,
          jobId,
          batchIndex,
          adapterKind,
          outletId,
          userId: user.id,
          status: 'failed',
          stats: { processed: group.items.length, created: 0, updated: 0, skipped: 0, failed: payloadErrors.length || group.items.length, deleted: 0 },
          errorCount: payloadErrors.length || 1,
        })
        continue
      }

      const result = await callPurchaseRoute('PUT', `/api/purchases/${poId}`, payload, cookieHeader)
      if (!result.ok) {
        const msg = (result.data.error as string) || `HTTP ${result.status}`
        errors.push({
          rowIndex: group.firstRowIndex,
          rowSnapshot: group.items[0]?.raw || {},
          code: 'PO_EDIT_FAILED',
          message: `Gagal edit PO "${group.poKey}": ${msg}`,
        })
        failed += group.items.length
        await writeIdempotencyMarker({
          subOperationId,
          operationId,
          jobId,
          batchIndex,
          adapterKind,
          outletId,
          userId: user.id,
          status: 'failed',
          stats: { processed: group.items.length, created: 0, updated: 0, skipped: 0, failed: group.items.length, deleted: 0 },
          errorCount: 1,
        })
        continue
      }

      // Optional post-PUT supplier change. Done AFTER the PUT succeeds so a
      // PUT failure leaves the PO's existing supplier untouched (the PUT route
      // itself does not modify supplierId). Best-effort: a failure here is
      // logged but does not flip the PO to "failed" — the items were edited.
      if (supplierUpdate) {
        try {
          await db.purchaseOrder.update({
            where: { id: poId },
            data: { supplierId: supplierUpdate.supplierId },
          })
        } catch (err) {
          console.warn(`[purchase-delegate] supplier update failed for PO ${poId}:`, err)
        }
      }

      updated++
      await writeIdempotencyMarker({
        subOperationId,
        operationId,
        jobId,
        batchIndex,
        adapterKind,
        outletId,
        userId: user.id,
        status: 'completed',
        stats: { processed: group.items.length, created: 0, updated: 1, skipped: 0, failed: 0, deleted: 0 },
        errorCount: 0,
      })
    }
  }

  // ── Build aggregated BatchResult ──
  const stats: BatchStats = {
    processed,
    created,
    updated,
    skipped,
    failed,
    deleted: 0,
  }

  // Compute totalBatches for the engine (so the worker can reconcile Dexie
  // batch records if the file has more/fewer batches than initially estimated).
  const totalBatches = Math.max(1, Math.ceil(totalRows / BATCH_SIZE))
  const isLastBatch = batchIndex >= totalBatches - 1

  const result: BatchResult = {
    status: failed > 0 && created + updated === 0 ? 'failed' : 'completed',
    stats,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
    totalBatches,
    totalRows,
    isLastBatch,
  }

  return safeJson(result)
}
