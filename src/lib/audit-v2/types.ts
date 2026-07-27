/**
 * audit-v2/types.ts — Event-oriented AuditLog V2 type system.
 *
 * Core rule: ONE meaningful user/business action = ONE AuditLog event.
 *
 * The structured event payload (title, summary, sections, metadata) is the
 * human-readable business event layer. Technical ledgers
 * (InventoryMovement, TransactionConsumption, BulkOperationLog) remain the
 * system ledgers and are NOT replaced.
 *
 * Every value that reaches the UI is pre-formatted to a string by
 * `toDisplay()` (see emit.ts) so the UI NEVER renders "[object Object]".
 */

/** Supported V2 event types. */
export const EventType = {
  MIGRATION_BATCH: 'MIGRATION_BATCH',
  BULK_BATCH: 'BULK_BATCH',
  SALE: 'SALE',
  VOID: 'VOID',
  PURCHASE: 'PURCHASE',
  INVENTORY_ADJUSTMENT: 'INVENTORY_ADJUSTMENT',
  COMPOSITION_UPDATE: 'COMPOSITION_UPDATE',
  CUSTOMER_CHANGE: 'CUSTOMER_CHANGE',
  /** Legacy V1 audit rows (un-converted callers). */
  LEGACY: 'LEGACY',
} as const

export type EventTypeValue = (typeof EventType)[keyof typeof EventType]

/** Grouped detail-section kinds shown in the detail drawer. */
export type SectionType = 'summary' | 'changes' | 'inventory' | 'errors' | 'metadata'

/**
 * A single key/value pair. `v` is ALWAYS a pre-formatted string
 * (see `toDisplay`) — never a raw object — so the UI cannot produce
 * "[object Object]".
 */
export interface AuditField {
  k: string
  v: string
}

/**
 * A row in a list section. Every value is a pre-formatted string.
 */
export type AuditItem = Record<string, string>

/**
 * A grouped, UI-ready detail section.
 *
 * - `fields`  → key/value pairs (rendered as a definition list)
 * - `items`   → list of homogeneous rows (rendered as a table)
 * - `collapsed` → UI hint: start collapsed (large lists)
 * - `download`  → optional downloadable blob for very large payloads
 */
export interface AuditSection {
  type: SectionType
  label: string
  fields?: AuditField[]
  items?: AuditItem[]
  /** Header badge / tone hint for the UI. */
  tone?: 'default' | 'info' | 'success' | 'warning' | 'danger'
  /** Start collapsed in the drawer (large lists). */
  collapsed?: boolean
  /** Column order when rendering `items` as a table. */
  columns?: string[]
  /** Optional downloadable attachment for huge payloads. */
  download?: {
    filename: string
    contentType: string
    /** Plain-text or base64-encoded payload. */
    data: string
    encoding?: 'text' | 'base64'
  }
}

/**
 * A complete business audit event. This is the single input to the emitter.
 *
 * V1 mirror fields (action/entityType/entityId) default to the V2 values but
 * can be overridden (e.g. BULK_BATCH keeps action='BULK_BATCH' + entityId=
 * operationId for the existing idempotency marker unique index).
 */
export interface AuditEvent {
  eventType: EventTypeValue
  /** Concise human title, e.g. "Sale INV-20250101-1001 · Rp 45.000". */
  title: string
  /** One-line business summary. */
  summary: string
  /** Grouped detail sections (Summary / Changes / Inventory Impact / Errors / Metadata). */
  sections?: AuditSection[]
  /** Free-form structured metadata (JSON). */
  metadata?: Record<string, unknown>
  /** Idempotency / correlation id. */
  operationId?: string | null
  /** Primary source entity type (PRODUCT, TRANSACTION, PURCHASE_ORDER, ...). */
  sourceEntityType?: string | null
  /** Primary source entity id. */
  sourceEntityId?: string | null

  outletId: string
  userId: string

  // --- V1 mirror overrides (optional) ---
  /** Defaults to `eventType`. Override for backward-compat markers. */
  action?: string
  /** Defaults to `sourceEntityType`. */
  entityType?: string
  /** Defaults to `sourceEntityId` ?? `operationId`. */
  entityId?: string | null
  /** Raw JSON string for the V1 `details` column. Defaults to a compact JSON. */
  v1Details?: string
}
