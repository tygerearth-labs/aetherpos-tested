/**
 * audit-v2/builders.ts — Pure constructors for each business event type.
 *
 * Each builder takes domain data + (outletId, userId) and returns a complete
 * `AuditEvent` (title, summary, grouped sections, metadata). The route
 * handler then calls `emitAuditEvent(tx, event)` (transactional) or
 * `safeEmitAuditEvent(event)` (non-tx).
 *
 * Builders are PURE — no DB access — so they are trivially testable and
 * cannot fail the surrounding transaction.
 *
 * v2.1: BULK_BATCH now supports an optional `breakdown` field for concise
 * sub-entity counts (e.g. "Varian Dibuat: 120") rendered in the Summary.
 *
 * v2.2: Concise before→after diffs. The audit log no longer dumps full
 * object JSON into the UI. Single-entity events (PRODUCT_CHANGE,
 * INVENTORY_ITEM_CHANGE, CUSTOMER_CHANGE, PURCHASE change) render only
 * CHANGED fields. BULK_BATCH renders a one-line "field: before → after"
 * summary per row instead of JSON blobs. Full objects remain in the
 * downloadable JSON log. VOID inventoryRestored/orphanedVariantItems now
 * truncate at 50 (matches SALE pattern).
 */

import { EventType, type AuditEvent, type AuditField, type AuditItem, type AuditSection } from './types'
import { field, fields, toDisplay } from './emit'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format a number as Indonesian Rupiah ("Rp 45.000"). */
export function rp(n: unknown): string {
  const num = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(num)) return toDisplay(n)
  return `Rp ${num.toLocaleString('id-ID')}`
}

/** Format an integer count with a noun, handling plural-ish Indonesian. */
function count(n: number, noun: string): string {
  return `${n} ${noun}`
}

/** Truncate a list for the summary table, marking how many were omitted. */
function truncate<T>(arr: T[], limit = 25): { shown: T[]; omitted: number } {
  if (arr.length <= limit) return { shown: arr, omitted: 0 }
  return { shown: arr.slice(0, limit), omitted: arr.length - limit }
}

/** Build an Errors section from a string[] (or {row,message}[]). */
function errorsSection(errors: Array<string | { row?: string | number; message: string }>): AuditSection | null {
  if (!errors || errors.length === 0) return null
  const items: AuditItem[] = errors.map((e): AuditItem => {
    if (typeof e === 'string') return { error: e }
    return { row: toDisplay(e.row ?? ''), message: e.message }
  })
  const { shown, omitted } = truncate(items, 50)
  const section: AuditSection = {
    type: 'errors',
    label: `Errors (${errors.length})`,
    tone: 'danger',
    items: shown,
    columns: ['row', 'message'],
    collapsed: items.length > 5,
  }
  if (omitted > 0) section.label = `Errors (${errors.length}, ${omitted} hidden)`
  return section
}

// ─────────────────────────────────────────────────────────────────────────────
// Concise before→after diff helpers (v2.2)
//
// Rule: the audit log must NOT dump full object JSON into the UI. Instead it
// renders a concise, human-readable field-level diff ("price: 10000 → 12000").
// Full before/after objects remain available in the downloadable JSON log for
// bulk batches and in the row's `metadata` for single-entity events when the
// route chooses to include them.
// ─────────────────────────────────────────────────────────────────────────────

/** Field name → display formatter hint. Keeps diffs scannable. */
const CURRENCY_FIELDS = new Set(['price', 'hpp', 'avgCost', 'unitCost', 'totalCost', 'totalValue', 'subtotal', 'total', 'paidAmount', 'change', 'lineTotal', 'materialCost', 'modal', 'lowStockAlert'])

function fmtVal(k: string, v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (CURRENCY_FIELDS.has(k) && (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v))))) {
    return rp(v)
  }
  return toDisplay(v)
}

/**
 * Compute a concise field-level diff between before/after objects.
 * Returns ONLY fields whose values differ (or that exist on only one side).
 */
export function diffChangedFields(
  before?: Record<string, unknown>,
  after?: Record<string, unknown>,
): Array<{ field: string; before: string; after: string }> {
  const b = before || {}
  const a = after || {}
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  const out: Array<{ field: string; before: string; after: string }> = []
  for (const k of keys) {
    const bv = b[k]
    const av = a[k]
    // Skip identical values (deep-ish compare for primitives + JSON for objects)
    const bs = typeof bv === 'object' && bv !== null ? JSON.stringify(bv) : bv
    const as = typeof av === 'object' && av !== null ? JSON.stringify(av) : av
    if (bs === as) continue
    out.push({ field: k, before: fmtVal(k, bv), after: fmtVal(k, av) })
  }
  return out
}

/**
 * Build a one-line concise diff summary string for a bulk change row.
 * - updated: "price: Rp 10.000 → Rp 12.000, stock: 50 → 60"
 * - created (after only): "Kopi · Rp 10.000 · 50 stk" (name + key fields)
 * - deleted (before only): "Kopi (SKU001)" (identity)
 * - skipped/failed: returns '' (use the `note` column instead)
 */
export function diffSummary(
  action: 'created' | 'updated' | 'skipped' | 'deleted' | 'failed',
  before?: Record<string, unknown>,
  after?: Record<string, unknown>,
): string {
  if (action === 'updated') {
    const diffs = diffChangedFields(before, after)
    if (diffs.length === 0) return ''
    return diffs.map((d) => `${d.field}: ${d.before} → ${d.after}`).join(', ')
  }
  if (action === 'created') {
    const a = after || {}
    const name = a.name || a.itemName || a.productName || ''
    const parts: string[] = []
    if (name) parts.push(String(name))
    for (const k of ['price', 'hpp', 'stock', 'qty', 'unit', 'sku']) {
      if (a[k] !== undefined && a[k] !== null && a[k] !== '') parts.push(fmtVal(k, a[k]))
    }
    return parts.join(' · ')
  }
  if (action === 'deleted') {
    const b = before || {}
    const name = b.name || b.itemName || b.productName || ''
    const sku = b.sku || ''
    return [name, sku].filter(Boolean).join(' · ')
  }
  return ''
}

// ─────────────────────────────────────────────────────────────────────────────
// SALE — one row per transaction
// ─────────────────────────────────────────────────────────────────────────────

export interface SaleItemInput {
  productName: string
  productSku?: string | null
  variantName?: string | null
  variantSku?: string | null
  qty: number
  price: number
  subtotal: number
  itemDiscount?: number
}
export interface SaleConsumptionInput {
  itemName: string
  baseUnit: string
  quantityUsed: number
  materialCost?: number
  sources?: unknown
}
export interface SaleEventInput {
  transactionId: string
  invoiceNumber: string
  items: SaleItemInput[]
  subtotal: number
  discount: number
  taxAmount: number
  total: number
  paymentMethod: string
  paidAmount: number
  change: number
  customerName?: string | null
  customerId?: string | null
  pointsEarned?: number
  pointsUsed?: number
  consumption?: SaleConsumptionInput[]
  outletId: string
  userId: string
}

export function buildSaleEvent(input: SaleEventInput): AuditEvent {
  const totalQty = input.items.reduce((s, i) => s + i.qty, 0)
  const hasComposition = (input.consumption?.length ?? 0) > 0

  const title = `Sale ${input.invoiceNumber} · ${rp(input.total)}`
  const summary = [
    `${input.items.length} item${input.items.length > 1 ? 's' : ''} (${totalQty} unit)`,
    input.paymentMethod,
    input.customerName ? `· ${input.customerName}` : '',
    hasComposition ? '· composition' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []

  // Summary
  sections.push({
    type: 'summary',
    label: 'Summary',
    tone: 'success',
    fields: fields({
      Invoice: input.invoiceNumber,
      Customer: input.customerName || 'Walk-in',
      Payment: input.paymentMethod,
      Subtotal: rp(input.subtotal),
      Discount: input.discount > 0 ? rp(input.discount) : '-',
      Tax: input.taxAmount > 0 ? rp(input.taxAmount) : '-',
      Total: rp(input.total),
      'Paid Amount': rp(input.paidAmount),
      Change: input.change > 0 ? rp(input.change) : '-',
      ...(input.pointsEarned ? { 'Points Earned': input.pointsEarned } : {}),
      ...(input.pointsUsed ? { 'Points Used': input.pointsUsed } : {}),
    }),
  })

  // Changes — items sold
  const itemRows = input.items.map((i) => ({
    product: [i.productName, i.variantName].filter(Boolean).join(' · '),
    sku: i.productSku || i.variantSku || '',
    qty: String(i.qty),
    price: rp(i.price),
    subtotal: rp(i.subtotal),
  }))
  const { shown: shownItems, omitted: omittedItems } = truncate(itemRows, 50)
  sections.push({
    type: 'changes',
    label: `Items (${input.items.length})`,
    items: shownItems,
    columns: ['product', 'sku', 'qty', 'price', 'subtotal'],
    collapsed: itemRows.length > 8,
  })
  if (omittedItems > 0) sections[sections.length - 1].label = `Items (${input.items.length}, ${omittedItems} hidden)`

  // Inventory Impact — composition consumption (single source of truth for the SALE)
  if (hasComposition) {
    const consRows = input.consumption!.map((c) => ({
      item: c.itemName,
      used: `${c.quantityUsed} ${c.baseUnit}`,
      cost: c.materialCost != null ? rp(c.materialCost) : '-',
    }))
    const { shown: shownCons, omitted: omittedCons } = truncate(consRows, 50)
    sections.push({
      type: 'inventory',
      label: `Inventory Impact (${input.consumption!.length} item${input.consumption!.length > 1 ? 's' : ''})`,
      tone: 'info',
      items: shownCons,
      columns: ['item', 'used', 'cost'],
      collapsed: consRows.length > 5,
    })
    if (omittedCons > 0) sections[sections.length - 1].label = `Inventory Impact (${input.consumption!.length}, ${omittedCons} hidden)`
  }

  return {
    eventType: EventType.SALE,
    title,
    summary,
    sections,
    metadata: {
      transactionId: input.transactionId,
      invoiceNumber: input.invoiceNumber,
      customerId: input.customerId ?? null,
      itemCount: input.items.length,
      totalQty,
      total: input.total,
      paymentMethod: input.paymentMethod,
      hasComposition,
      consumptionCount: input.consumption?.length ?? 0,
    },
    operationId: input.transactionId,
    sourceEntityType: 'TRANSACTION',
    sourceEntityId: input.transactionId,
    action: 'SALE',
    entityType: 'TRANSACTION',
    entityId: input.transactionId,
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VOID — one row per void
// ─────────────────────────────────────────────────────────────────────────────

export interface VoidRestoredItemInput {
  productName: string
  variantName?: string | null
  qty: number
  target: 'PRODUCT' | 'VARIANT' | 'ORPHANED_VARIANT_SKIPPED'
}
export interface VoidRestoredInventoryInput {
  itemName: string
  baseUnit: string
  quantityRestored: number
  method?: string
}
export interface VoidEventInput {
  transactionId: string
  invoiceNumber: string
  total: number
  reason: string
  voidedBy: string
  itemsRestored: VoidRestoredItemInput[]
  inventoryRestored: VoidRestoredInventoryInput[]
  inventoryRestoreMethod: 'SNAPSHOT' | 'RECALC' | 'NONE'
  loyaltyReversed: boolean
  pointsDelta?: number
  orphanedVariantItems?: Array<{ productName: string; variantName?: string | null; qty: number }>
  outletId: string
  userId: string
}

export function buildVoidEvent(input: VoidEventInput): AuditEvent {
  const title = `Void ${input.invoiceNumber} · ${rp(input.total)}`
  const summary = [
    `Restored ${input.itemsRestored.length} item line(s)`,
    input.inventoryRestored.length > 0 ? `· ${input.inventoryRestored.length} inventory item(s)` : '',
    input.loyaltyReversed ? '· loyalty reversed' : '',
    `· ${input.inventoryRestoreMethod}`,
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []

  sections.push({
    type: 'summary',
    label: 'Summary',
    tone: 'warning',
    fields: fields({
      Invoice: input.invoiceNumber,
      Total: rp(input.total),
      Reason: input.reason,
      'Voided By': input.voidedBy,
      'Restore Method': input.inventoryRestoreMethod,
      'Loyalty Reversed': input.loyaltyReversed ? 'Yes' : 'No',
      ...(input.pointsDelta != null ? { 'Points Delta': input.pointsDelta } : {}),
    }),
  })

  // Restored items (stock snapshot restore)
  const itemRows = input.itemsRestored.map((i) => ({
    product: [i.productName, i.variantName].filter(Boolean).join(' · '),
    qty: String(i.qty),
    target: i.target,
  }))
  const { shown: shownItems, omitted: omittedItems } = truncate(itemRows, 50)
  sections.push({
    type: 'changes',
    label: `Restored Items (${input.itemsRestored.length})`,
    items: shownItems,
    columns: ['product', 'qty', 'target'],
    collapsed: itemRows.length > 8,
  })
  if (omittedItems > 0) sections[sections.length - 1].label = `Restored Items (${input.itemsRestored.length}, ${omittedItems} hidden)`

  // Inventory Impact — raw material restore (truncated to 50 for UI safety)
  if (input.inventoryRestored.length > 0) {
    const invRows = input.inventoryRestored.map((r) => ({
      item: r.itemName,
      restored: `${r.quantityRestored} ${r.baseUnit}`,
      method: r.method || input.inventoryRestoreMethod,
    }))
    const { shown: shownInv, omitted: omittedInv } = truncate(invRows, 50)
    const invSection: AuditSection = {
      type: 'inventory',
      label: `Inventory Restored (${input.inventoryRestored.length})`,
      tone: 'info',
      items: shownInv,
      columns: ['item', 'restored', 'method'],
      collapsed: invRows.length > 5,
    }
    if (omittedInv > 0) invSection.label = `Inventory Restored (${input.inventoryRestored.length}, ${omittedInv} hidden)`
    sections.push(invSection)
  }

  if (input.orphanedVariantItems && input.orphanedVariantItems.length > 0) {
    const orphRows = input.orphanedVariantItems.map((o) => ({
      product: [o.productName, o.variantName].filter(Boolean).join(' · '),
      qty: String(o.qty),
      note: 'Variant deleted after sale; variant stock NOT restored',
    }))
    const { shown: shownOrph, omitted: omittedOrph } = truncate(orphRows, 50)
    const orphSection: AuditSection = {
      type: 'errors',
      label: `Orphaned Variants (${input.orphanedVariantItems.length})`,
      tone: 'warning',
      items: shownOrph,
      columns: ['product', 'qty', 'note'],
      collapsed: true,
    }
    if (omittedOrph > 0) orphSection.label = `Orphaned Variants (${input.orphanedVariantItems.length}, ${omittedOrph} hidden)`
    sections.push(orphSection)
  }

  return {
    eventType: EventType.VOID,
    title,
    summary,
    sections,
    metadata: {
      transactionId: input.transactionId,
      invoiceNumber: input.invoiceNumber,
      total: input.total,
      restoreMethod: input.inventoryRestoreMethod,
      itemsRestored: input.itemsRestored.length,
      inventoryRestored: input.inventoryRestored.length,
      loyaltyReversed: input.loyaltyReversed,
      orphanedCount: input.orphanedVariantItems?.length ?? 0,
    },
    operationId: input.transactionId,
    sourceEntityType: 'TRANSACTION',
    sourceEntityId: input.transactionId,
    action: 'VOID',
    entityType: 'TRANSACTION',
    entityId: input.transactionId,
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION_BATCH — one row per completed batch
// ─────────────────────────────────────────────────────────────────────────────

export interface MigrationBatchEventInput {
  mode: string
  fileName: string
  batchIndex: number
  totalBatches: number
  isLastBatch: boolean
  status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'PARTIAL' | 'FAILED' | 'BATCH_OK' | 'BATCH_LAST_OK' | 'BATCH_FAILED'
  productsCreated: number
  productsSkipped: number
  productsFailed: number
  variantsCreated?: number
  categoriesCreated?: number
  barcodeCount?: number
  inventoryItemsCreated?: number
  inventoryItemsSkipped?: number
  inventoryItemsUpdated?: number
  compositionsCreated?: number
  totalStock?: number
  totalModalValue?: number
  errors: Array<string | { row?: string | number; message: string }>
  batchError?: string | null
  outletId: string
  userId: string
  operationId?: string
}

export function buildMigrationBatchEvent(input: MigrationBatchEventInput): AuditEvent {
  const totalProcessed = input.productsCreated + input.productsSkipped + input.productsFailed
  const title = `Migration · Batch ${input.batchIndex + 1}/${input.totalBatches} · ${input.fileName}`
  const summary = [
    input.mode,
    `· ${count(input.productsCreated, 'created')}`,
    input.productsSkipped > 0 ? `${count(input.productsSkipped, 'skipped')}` : '',
    input.productsFailed > 0 ? `${count(input.productsFailed, 'failed')}` : '',
    `· ${input.status}`,
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []

  const summaryFields: AuditField[] = [
    field('Mode', input.mode),
    field('File', input.fileName),
    field('Batch', `${input.batchIndex + 1} / ${input.totalBatches}`),
    field('Status', input.status),
    field('Processed', String(totalProcessed)),
    field('Created', String(input.productsCreated)),
    ...(input.productsSkipped > 0 ? [field('Skipped', String(input.productsSkipped))] : []),
    ...(input.productsFailed > 0 ? [field('Failed', String(input.productsFailed))] : []),
  ]
  if (input.inventoryItemsCreated != null && input.inventoryItemsCreated > 0) {
    summaryFields.push(field('Inventory Items Created', String(input.inventoryItemsCreated)))
  }
  if (input.compositionsCreated != null && input.compositionsCreated > 0) {
    summaryFields.push(field('Compositions Created', String(input.compositionsCreated)))
  }
  if (input.totalStock != null && input.totalStock > 0) {
    summaryFields.push(field('Total Stock', String(input.totalStock)))
    summaryFields.push(field('Total Modal Value', rp(input.totalModalValue ?? 0)))
  }
  sections.push({ type: 'summary', label: 'Summary', tone: input.status === 'COMPLETED' || input.status === 'BATCH_LAST_OK' || input.status === 'BATCH_OK' ? 'success' : 'warning', fields: summaryFields })

  const errSection = errorsSection(input.errors)
  if (errSection) sections.push(errSection)

  if (input.batchError) {
    sections.push({
      type: 'errors',
      label: 'Batch Error',
      tone: 'danger',
      fields: [field('Error', input.batchError)],
    })
  }

  return {
    eventType: EventType.MIGRATION_BATCH,
    title,
    summary,
    sections,
    metadata: {
      mode: input.mode,
      fileName: input.fileName,
      batchIndex: input.batchIndex,
      totalBatches: input.totalBatches,
      isLastBatch: input.isLastBatch,
      status: input.status,
      productsCreated: input.productsCreated,
      productsSkipped: input.productsSkipped,
      productsFailed: input.productsFailed,
      variantsCreated: input.variantsCreated ?? 0,
      categoriesCreated: input.categoriesCreated ?? 0,
      barcodeCount: input.barcodeCount ?? 0,
      inventoryItemsCreated: input.inventoryItemsCreated ?? 0,
      inventoryItemsSkipped: input.inventoryItemsSkipped ?? 0,
      inventoryItemsUpdated: input.inventoryItemsUpdated ?? 0,
      compositionsCreated: input.compositionsCreated ?? 0,
      totalStock: input.totalStock ?? 0,
      totalModalValue: input.totalModalValue ?? 0,
      errorCount: input.errors.length,
    },
    operationId: input.operationId ?? `mig:${input.fileName}:${input.batchIndex}`,
    sourceEntityType: 'PRODUCT',
    sourceEntityId: input.operationId ?? null,
    action: 'CREATE',
    entityType: 'PRODUCT',
    entityId: input.operationId ?? null,
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK_BATCH — one row per batch (idempotency marker + human-readable changes)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkChangeInput {
  entity: string
  identifier: string
  action: 'created' | 'updated' | 'skipped' | 'deleted' | 'failed'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  note?: string
}
export interface BulkBatchBreakdownItem {
  label: string
  value: string | number
  /** Optional tone hint (e.g. "warning" for skipped sub-counts). */
  tone?: 'default' | 'info' | 'success' | 'warning' | 'danger'
}

export interface BulkBatchEventInput {
  adapterKind: string
  operationId: string
  jobId: string
  batchIndex: number
  payloadHash: string
  status: 'completed' | 'failed'
  stats: { processed?: number; created?: number; updated?: number; skipped?: number; failed?: number; deleted?: number }
  changes: BulkChangeInput[]
  errors: Array<string | { row?: string | number; message: string }>
  outletId: string
  userId: string
  /** Raw marker JSON written to V1 `details` so findMarker() still works. */
  markerDetails: Record<string, unknown>
  /**
   * Optional concise sub-entity breakdown rendered in the Summary section
   * (e.g. "Variants Created: 120", "Compositions Created: 50"). Use this
   * instead of dumping every object into `changes` when the human reader
   * only needs aggregate counts. The per-entity `changes` array remains
   * the detailed ledger (truncated + downloadable).
   */
  breakdown?: BulkBatchBreakdownItem[]
}

export function buildBulkBatchEvent(input: BulkBatchEventInput): AuditEvent {
  const total = input.stats.processed ?? input.changes.length
  const title = `Bulk ${input.adapterKind} · Batch ${input.batchIndex} · ${input.status}`
  const summary = [
    `${total} row(s)`,
    input.stats.created ? `· ${count(input.stats.created, 'created')}` : '',
    input.stats.updated ? `· ${count(input.stats.updated, 'updated')}` : '',
    input.stats.skipped ? `· ${count(input.stats.skipped, 'skipped')}` : '',
    input.stats.failed ? `· ${count(input.stats.failed, 'failed')}` : '',
    input.stats.deleted ? `· ${count(input.stats.deleted, 'deleted')}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []

  // Base summary fields (standard stats)
  const summaryFields: AuditField[] = fields({
    Operation: input.adapterKind,
    'Operation ID': input.operationId,
    'Job ID': input.jobId,
    Batch: String(input.batchIndex),
    Status: input.status,
    Processed: input.stats.processed ?? input.changes.length,
    Created: input.stats.created ?? 0,
    Updated: input.stats.updated ?? 0,
    Skipped: input.stats.skipped ?? 0,
    Failed: input.stats.failed ?? 0,
    Deleted: input.stats.deleted ?? 0,
  })

  // Optional concise breakdown (sub-entity counts like "Variants Created: 120").
  // Rendered as additional summary fields so the human reader sees aggregate
  // counts WITHOUT having to expand the (potentially huge) Changes table.
  if (input.breakdown && input.breakdown.length > 0) {
    for (const b of input.breakdown) {
      summaryFields.push({ k: b.label, v: toDisplay(b.value) })
    }
  }

  sections.push({
    type: 'summary',
    label: 'Summary',
    tone: input.status === 'completed' ? 'success' : 'danger',
    fields: summaryFields,
  })

  // Changes — concise per-entity diff (NOT full JSON dumps).
  // Each row shows entity + action + a one-line "field: before → after" summary.
  // The full before/after objects remain in the downloadable JSON log below.
  if (input.changes.length > 0) {
    const changeRows = input.changes.map((c) => ({
      entity: c.entity,
      id: c.identifier,
      action: c.action,
      // Concise diff: "price: Rp 10.000 → Rp 12.000, stock: 50 → 60"
      // For created/deleted rows, shows identity + key fields.
      change: diffSummary(c.action, c.before, c.after),
      note: c.note || '',
    }))
    const { shown, omitted } = truncate(changeRows, 50)
    const section: AuditSection = {
      type: 'changes',
      label: `Changes (${input.changes.length})`,
      items: shown,
      columns: ['entity', 'id', 'action', 'change', 'note'],
      collapsed: changeRows.length > 8,
    }
    if (omitted > 0) section.label = `Changes (${input.changes.length}, ${omitted} hidden)`
    sections.push(section)

    // Full before/after objects available as a downloadable JSON log for traceability.
    if (input.changes.length > 0) {
      sections.push({
        type: 'changes',
        label: 'Full Change Log (download)',
        tone: 'info',
        download: {
          filename: `bulk-${input.adapterKind}-${input.operationId}-batch-${input.batchIndex}.json`,
          contentType: 'application/json',
          encoding: 'text',
          data: toDisplay(input.changes),
        },
      })
    }
  }

  const errSection = errorsSection(input.errors)
  if (errSection) sections.push(errSection)

  return {
    eventType: EventType.BULK_BATCH,
    title,
    summary,
    sections,
    metadata: { ...input.markerDetails, adapterKind: input.adapterKind, changesCount: input.changes.length },
    operationId: input.operationId,
    sourceEntityType: 'BULK',
    sourceEntityId: input.operationId,
    action: 'BULK_BATCH',
    entityType: 'BULK',
    entityId: input.operationId,
    v1Details: toDisplay(input.markerDetails),
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION_UPDATE — one row, before/after + stockCapInfo
// ─────────────────────────────────────────────────────────────────────────────

export interface CompositionLineInput {
  inventoryItemName: string
  qty: number
  baseUnit: string
  yieldPerBatch?: number
  avgCost?: number
}
export interface StockCapInfoInput {
  stockCapped: boolean
  oldStock: number
  newStock: number
  maxStock: number
  limitingItemName: string | null
}
export interface CompositionUpdateEventInput {
  productId: string
  productName: string
  hasVariants: boolean
  before: CompositionLineInput[]
  after: CompositionLineInput[]
  variantBeforeAfter?: Array<{ variantName: string; before: CompositionLineInput[]; after: CompositionLineInput[]; stockCap?: StockCapInfoInput }>
  stockCap?: StockCapInfoInput
  variantStockCaps?: Array<{ variantName: string } & StockCapInfoInput>
  outletId: string
  userId: string
}

function compRows(lines: CompositionLineInput[]) {
  return lines.map((l) => ({
    item: l.inventoryItemName,
    qty: `${l.qty} ${l.baseUnit}`,
    yield: l.yieldPerBatch && l.yieldPerBatch !== 1 ? String(l.yieldPerBatch) : '1',
    cost: l.avgCost != null ? rp(l.avgCost) : '-',
  }))
}

export function buildCompositionUpdateEvent(input: CompositionUpdateEventInput): AuditEvent {
  const title = `Composition Update · ${input.productName}`
  const summary = [
    input.hasVariants ? 'variant product' : 'simple product',
    `· before ${input.before.length} line(s)`,
    `→ after ${input.after.length} line(s)`,
    input.stockCap?.stockCapped ? '· stock capped' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []

  sections.push({
    type: 'summary',
    label: 'Summary',
    tone: 'info',
    fields: fields({
      Product: input.productName,
      Type: input.hasVariants ? 'Variant' : 'Simple',
      'Before Lines': input.before.length,
      'After Lines': input.after.length,
      ...(input.stockCap ? { 'Stock Capped': input.stockCap.stockCapped ? 'Yes' : 'No' } : {}),
    }),
  })

  // Changes — before/after composition
  if (!input.hasVariants) {
    sections.push({
      type: 'changes',
      label: 'Before',
      items: compRows(input.before),
      columns: ['item', 'qty', 'yield', 'cost'],
      collapsed: input.before.length > 5,
    })
    sections.push({
      type: 'changes',
      label: 'After',
      tone: 'success',
      items: compRows(input.after),
      columns: ['item', 'qty', 'yield', 'cost'],
      collapsed: input.after.length > 5,
    })
  } else if (input.variantBeforeAfter && input.variantBeforeAfter.length > 0) {
    for (const v of input.variantBeforeAfter) {
      sections.push({
        type: 'changes',
        label: `${v.variantName} — Before`,
        items: compRows(v.before),
        columns: ['item', 'qty', 'yield', 'cost'],
        collapsed: true,
      })
      sections.push({
        type: 'changes',
        label: `${v.variantName} — After`,
        tone: 'success',
        items: compRows(v.after),
        columns: ['item', 'qty', 'yield', 'cost'],
        collapsed: true,
      })
    }
  }

  // Inventory Impact — stock cap info
  const caps: AuditField[] = []
  if (input.stockCap) {
    caps.push(
      field('Stock Capped', input.stockCap.stockCapped ? 'Yes' : 'No'),
      field('Old Stock', String(input.stockCap.oldStock)),
      field('New Stock', String(input.stockCap.newStock)),
      field('Max Stock', input.stockCap.maxStock === Infinity ? '∞' : String(input.stockCap.maxStock)),
      field('Limiting Item', input.stockCap.limitingItemName ?? '-'),
    )
  }
  if (input.variantStockCaps && input.variantStockCaps.length > 0) {
    sections.push({
      type: 'inventory',
      label: `Variant Stock Caps (${input.variantStockCaps.length})`,
      tone: 'warning',
      items: input.variantStockCaps.map((v) => ({
        variant: v.variantName,
        capped: v.stockCapped ? 'Yes' : 'No',
        old: String(v.oldStock),
        new: String(v.newStock),
        max: v.maxStock === Infinity ? '∞' : String(v.maxStock),
        limiting: v.limitingItemName ?? '-',
      })),
      columns: ['variant', 'capped', 'old', 'new', 'max', 'limiting'],
      collapsed: input.variantStockCaps.length > 4,
    })
  } else if (caps.length > 0) {
    sections.push({ type: 'inventory', label: 'Stock Cap', tone: 'warning', fields: caps })
  }

  return {
    eventType: EventType.COMPOSITION_UPDATE,
    title,
    summary,
    sections,
    metadata: {
      productId: input.productId,
      productName: input.productName,
      hasVariants: input.hasVariants,
      beforeCount: input.before.length,
      afterCount: input.after.length,
      stockCapped: input.stockCap?.stockCapped ?? false,
      variantCount: input.variantBeforeAfter?.length ?? 0,
    },
    sourceEntityType: 'PRODUCT',
    sourceEntityId: input.productId,
    action: 'UPDATE',
    entityType: 'PRODUCT',
    entityId: input.productId,
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE — one row per purchase document
// ─────────────────────────────────────────────────────────────────────────────

export interface PurchaseItemInput {
  name: string
  qty: number
  unit: string
  unitCost: number
  batchNumber?: string
  expiredDate?: string | null
  lineTotal: number
}
export interface PurchaseEventInput {
  purchaseOrderId: string
  orderNumber: string
  supplierName?: string | null
  items: PurchaseItemInput[]
  totalValue: number
  stockMovementCount: number
  hppImpactNote?: string
  outletId: string
  userId: string
}

export function buildPurchaseEvent(input: PurchaseEventInput): AuditEvent {
  const title = `Purchase ${input.orderNumber} · ${rp(input.totalValue)}`
  const summary = [
    `${input.items.length} item line(s)`,
    input.supplierName ? `· ${input.supplierName}` : '',
    `· ${input.stockMovementCount} stock movement(s)`,
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []
  sections.push({
    type: 'summary',
    label: 'Summary',
    tone: 'info',
    fields: fields({
      'PO Number': input.orderNumber,
      Supplier: input.supplierName || '-',
      'Item Lines': input.items.length,
      'Total Value': rp(input.totalValue),
      'Stock Movements': input.stockMovementCount,
      ...(input.hppImpactNote ? { 'HPP Impact': input.hppImpactNote } : {}),
    }),
  })

  const itemRows = input.items.map((i) => ({
    item: i.name,
    qty: `${i.qty} ${i.unit}`,
    'unit cost': rp(i.unitCost),
    batch: i.batchNumber || '-',
    expiry: i.expiredDate || '-',
    total: rp(i.lineTotal),
  }))
  const { shown, omitted } = truncate(itemRows, 50)
  const section: AuditSection = {
    type: 'changes',
    label: `Items (${input.items.length})`,
    items: shown,
    columns: ['item', 'qty', 'unit cost', 'batch', 'expiry', 'total'],
    collapsed: itemRows.length > 8,
  }
  if (omitted > 0) section.label = `Items (${input.items.length}, ${omitted} hidden)`
  sections.push(section)

  sections.push({
    type: 'inventory',
    label: 'Inventory Impact',
    tone: 'info',
    fields: fields({
      'Stock Movements Created': input.stockMovementCount,
      'Batches Created': input.items.filter((i) => i.batchNumber).length,
      'HPP Recalculation': input.hppImpactNote || 'avgCost updated from weighted purchase cost',
    }),
  })

  return {
    eventType: EventType.PURCHASE,
    title,
    summary,
    sections,
    metadata: {
      purchaseOrderId: input.purchaseOrderId,
      orderNumber: input.orderNumber,
      supplierName: input.supplierName ?? null,
      itemCount: input.items.length,
      totalValue: input.totalValue,
      stockMovementCount: input.stockMovementCount,
    },
    sourceEntityType: 'PURCHASE_ORDER',
    sourceEntityId: input.purchaseOrderId,
    action: 'PURCHASE',
    entityType: 'PURCHASE_ORDER',
    entityId: input.purchaseOrderId,
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY_ADJUSTMENT — one row per adjustment action
// ─────────────────────────────────────────────────────────────────────────────

export interface InventoryAdjustmentLineInput {
  itemName: string
  beforeStock: number
  afterStock: number
  delta: number
  unit: string
  reason?: string
}
export interface InventoryAdjustmentEventInput {
  lines: InventoryAdjustmentLineInput[]
  reason: string
  source: 'manual' | 'stock-opname' | 'bulk'
  outletId: string
  userId: string
  operationId?: string
}

export function buildInventoryAdjustmentEvent(input: InventoryAdjustmentEventInput): AuditEvent {
  const totalDelta = input.lines.reduce((s, l) => s + l.delta, 0)
  const title = `Inventory Adjustment · ${input.lines.length} item(s) · ${input.source}`
  const summary = [
    `${input.lines.length} item(s) adjusted`,
    `· net ${totalDelta >= 0 ? '+' : ''}${totalDelta}`,
    `· ${input.reason || input.source}`,
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []
  sections.push({
    type: 'summary',
    label: 'Summary',
    tone: 'warning',
    fields: fields({
      Source: input.source,
      Reason: input.reason || '-',
      'Items Adjusted': input.lines.length,
      'Net Delta': `${totalDelta >= 0 ? '+' : ''}${totalDelta}`,
    }),
  })

  const rows = input.lines.map((l) => ({
    item: l.itemName,
    before: String(l.beforeStock),
    after: String(l.afterStock),
    delta: `${l.delta >= 0 ? '+' : ''}${l.delta} ${l.unit}`,
    reason: l.reason || input.reason || '',
  }))
  const { shown, omitted } = truncate(rows, 50)
  const section: AuditSection = {
    type: 'changes',
    label: `Changes (${input.lines.length})`,
    items: shown,
    columns: ['item', 'before', 'after', 'delta', 'reason'],
    collapsed: rows.length > 8,
  }
  if (omitted > 0) section.label = `Changes (${input.lines.length}, ${omitted} hidden)`
  sections.push(section)

  sections.push({
    type: 'inventory',
    label: 'Inventory Impact',
    tone: 'info',
    fields: [field('Stock movements recorded', `${input.lines.length} (InventoryMovement ledger)`)],
  })

  return {
    eventType: EventType.INVENTORY_ADJUSTMENT,
    title,
    summary,
    sections,
    metadata: {
      source: input.source,
      reason: input.reason,
      lineCount: input.lines.length,
      netDelta: totalDelta,
    },
    operationId: input.operationId,
    sourceEntityType: 'INVENTORY_ITEM',
    sourceEntityId: input.operationId ?? null,
    action: 'ADJUSTMENT',
    entityType: 'INVENTORY_ITEM',
    entityId: input.operationId ?? null,
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER_CHANGE — one row per customer create/update/delete/merge
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomerChangeEventInput {
  customerId: string
  customerName: string
  changeType: 'created' | 'updated' | 'deleted' | 'merged' | 'loyalty-adjusted'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  mergedIntoName?: string
  pointsDelta?: number
  note?: string
  outletId: string
  userId: string
}

export function buildCustomerChangeEvent(input: CustomerChangeEventInput): AuditEvent {
  const title = `Customer ${input.changeType} · ${input.customerName}`
  const summary = [
    input.changeType,
    `· ${input.customerName}`,
    input.mergedIntoName ? `→ ${input.mergedIntoName}` : '',
    input.pointsDelta != null ? `· points ${input.pointsDelta >= 0 ? '+' : ''}${input.pointsDelta}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []
  sections.push({
    type: 'summary',
    label: 'Summary',
    tone: input.changeType === 'deleted' ? 'danger' : input.changeType === 'created' ? 'success' : 'info',
    fields: fields({
      Customer: input.customerName,
      Action: input.changeType,
      ...(input.mergedIntoName ? { 'Merged Into': input.mergedIntoName } : {}),
      ...(input.pointsDelta != null ? { 'Points Delta': input.pointsDelta } : {}),
      ...(input.note ? { Note: input.note } : {}),
    }),
  })

  // Concise diff: only CHANGED fields are shown (not the full object dump).
  const diffs = diffChangedFields(input.before, input.after)
  if (diffs.length > 0) {
    sections.push({
      type: 'changes',
      label: `Changes (${diffs.length} field${diffs.length > 1 ? 's' : ''})`,
      items: diffs.map((d) => ({ field: d.field, before: d.before, after: d.after })),
      columns: ['field', 'before', 'after'],
      collapsed: diffs.length > 8,
    })
  }

  return {
    eventType: EventType.CUSTOMER_CHANGE,
    title,
    summary,
    sections,
    metadata: {
      customerId: input.customerId,
      customerName: input.customerName,
      changeType: input.changeType,
      pointsDelta: input.pointsDelta ?? null,
    },
    sourceEntityType: 'CUSTOMER',
    sourceEntityId: input.customerId,
    action: input.changeType === 'created' ? 'CREATE' : input.changeType === 'deleted' ? 'DELETE' : 'UPDATE',
    entityType: 'CUSTOMER',
    entityId: input.customerId,
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT_CHANGE — one row per product create/update/delete (manual or bulk)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductChangeEventInput {
  productId: string
  productName: string
  sku?: string | null
  changeType: 'created' | 'updated' | 'deleted'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  source: 'manual' | 'bulk' | 'migration'
  note?: string
  operationId?: string | null
  outletId: string
  userId: string
}

export function buildProductChangeEvent(input: ProductChangeEventInput): AuditEvent {
  const title = `Product ${input.changeType} · ${input.productName}`
  const summary = [
    input.changeType,
    `· ${input.productName}`,
    input.sku ? `(${input.sku})` : '',
    `· ${input.source}`,
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []
  sections.push({
    type: 'summary',
    label: 'Summary',
    tone: input.changeType === 'deleted' ? 'danger' : input.changeType === 'created' ? 'success' : 'info',
    fields: fields({
      Product: input.productName,
      SKU: input.sku || '-',
      Action: input.changeType,
      Source: input.source,
      ...(input.note ? { Note: input.note } : {}),
    }),
  })

  // Concise diff: only CHANGED fields are shown (not the full object dump).
  // For 'created' (after-only) and 'deleted' (before-only), all keys appear
  // as a one-side snapshot — this is intentional (no diff to compute).
  const diffs = diffChangedFields(input.before, input.after)
  if (diffs.length > 0) {
    sections.push({
      type: 'changes',
      label: `Changes (${diffs.length} field${diffs.length > 1 ? 's' : ''})`,
      items: diffs.map((d) => ({ field: d.field, before: d.before, after: d.after })),
      columns: ['field', 'before', 'after'],
      collapsed: diffs.length > 8,
    })
  }

  return {
    eventType: EventType.PRODUCT_CHANGE,
    title,
    summary,
    sections,
    metadata: {
      productId: input.productId,
      productName: input.productName,
      sku: input.sku ?? null,
      changeType: input.changeType,
      source: input.source,
    },
    operationId: input.operationId ?? null,
    sourceEntityType: 'PRODUCT',
    sourceEntityId: input.productId,
    action: input.changeType === 'created' ? 'CREATE' : input.changeType === 'deleted' ? 'DELETE' : 'UPDATE',
    entityType: 'PRODUCT',
    entityId: input.productId,
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY_ITEM_CHANGE — one row per inventory item create/update/delete/archive/restore
// ─────────────────────────────────────────────────────────────────────────────

export interface InventoryItemChangeEventInput {
  inventoryItemId: string
  itemName: string
  sku?: string | null
  changeType: 'created' | 'updated' | 'deleted' | 'archived' | 'restored'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  source: 'manual' | 'bulk'
  note?: string
  operationId?: string | null
  outletId: string
  userId: string
}

export function buildInventoryItemChangeEvent(input: InventoryItemChangeEventInput): AuditEvent {
  const title = `Inventory Item ${input.changeType} · ${input.itemName}`
  const summary = [
    input.changeType,
    `· ${input.itemName}`,
    input.sku ? `(${input.sku})` : '',
    `· ${input.source}`,
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []
  sections.push({
    type: 'summary',
    label: 'Summary',
    tone:
      input.changeType === 'deleted'
        ? 'danger'
        : input.changeType === 'archived'
          ? 'warning'
          : input.changeType === 'created'
            ? 'success'
            : 'info',
    fields: fields({
      Item: input.itemName,
      SKU: input.sku || '-',
      Action: input.changeType,
      Source: input.source,
      ...(input.note ? { Note: input.note } : {}),
    }),
  })

  // Concise diff: only CHANGED fields are shown (not the full object dump).
  const diffs = diffChangedFields(input.before, input.after)
  if (diffs.length > 0) {
    sections.push({
      type: 'changes',
      label: `Changes (${diffs.length} field${diffs.length > 1 ? 's' : ''})`,
      items: diffs.map((d) => ({ field: d.field, before: d.before, after: d.after })),
      columns: ['field', 'before', 'after'],
      collapsed: diffs.length > 8,
    })
  }

  return {
    eventType: EventType.INVENTORY_ITEM_CHANGE,
    title,
    summary,
    sections,
    metadata: {
      inventoryItemId: input.inventoryItemId,
      itemName: input.itemName,
      sku: input.sku ?? null,
      changeType: input.changeType,
      source: input.source,
    },
    operationId: input.operationId ?? null,
    sourceEntityType: 'INVENTORY_ITEM',
    sourceEntityId: input.inventoryItemId,
    action:
      input.changeType === 'created'
        ? 'CREATE'
        : input.changeType === 'deleted'
          ? 'DELETE'
          : input.changeType === 'archived'
            ? 'ARCHIVE'
            : input.changeType === 'restored'
              ? 'RESTORE'
              : 'UPDATE',
    entityType: 'INVENTORY_ITEM',
    entityId: input.inventoryItemId,
    outletId: input.outletId,
    userId: input.userId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE_UPDATE / PURCHASE_DELETE — extend PURCHASE event with edit/delete modes
// ─────────────────────────────────────────────────────────────────────────────

export interface PurchaseChangeEventInput {
  purchaseOrderId: string
  orderNumber: string
  supplierName?: string | null
  changeType: 'created' | 'updated' | 'deleted' | 'cancelled'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  itemsReversed?: number
  stockMovementsReversed?: number
  note?: string
  outletId: string
  userId: string
}

export function buildPurchaseChangeEvent(input: PurchaseChangeEventInput): AuditEvent {
  const title = `Purchase ${input.changeType} · ${input.orderNumber}`
  const summary = [
    input.changeType,
    `· ${input.orderNumber}`,
    input.supplierName ? `· ${input.supplierName}` : '',
    input.itemsReversed != null ? `· ${input.itemsReversed} item(s) reversed` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const sections: AuditSection[] = []
  sections.push({
    type: 'summary',
    label: 'Summary',
    tone:
      input.changeType === 'deleted' || input.changeType === 'cancelled'
        ? 'danger'
        : input.changeType === 'created'
          ? 'success'
          : 'info',
    fields: fields({
      'PO Number': input.orderNumber,
      Supplier: input.supplierName || '-',
      Action: input.changeType,
      ...(input.itemsReversed != null ? { 'Items Reversed': input.itemsReversed } : {}),
      ...(input.stockMovementsReversed != null ? { 'Stock Movements Reversed': input.stockMovementsReversed } : {}),
      ...(input.note ? { Note: input.note } : {}),
    }),
  })

  // Concise diff: only CHANGED fields are shown (not the full object dump).
  const diffs = diffChangedFields(input.before, input.after)
  if (diffs.length > 0) {
    sections.push({
      type: 'changes',
      label: `Changes (${diffs.length} field${diffs.length > 1 ? 's' : ''})`,
      items: diffs.map((d) => ({ field: d.field, before: d.before, after: d.after })),
      columns: ['field', 'before', 'after'],
      collapsed: diffs.length > 8,
    })
  }

  return {
    eventType: EventType.PURCHASE,
    title,
    summary,
    sections,
    metadata: {
      purchaseOrderId: input.purchaseOrderId,
      orderNumber: input.orderNumber,
      supplierName: input.supplierName ?? null,
      changeType: input.changeType,
      itemsReversed: input.itemsReversed ?? null,
      stockMovementsReversed: input.stockMovementsReversed ?? null,
    },
    sourceEntityType: 'PURCHASE_ORDER',
    sourceEntityId: input.purchaseOrderId,
    action:
      input.changeType === 'created'
        ? 'PURCHASE'
        : input.changeType === 'deleted'
          ? 'DELETE'
          : input.changeType === 'cancelled'
            ? 'CANCEL'
            : 'UPDATE',
    entityType: 'PURCHASE_ORDER',
    entityId: input.purchaseOrderId,
    outletId: input.outletId,
    userId: input.userId,
  }
}
