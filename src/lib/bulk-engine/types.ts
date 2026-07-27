/**
 * AETHER BULK ENGINE V1 — Universal bulk Excel engine for AetherPOS.
 *
 * SCOPE (V2 reset): 4 domains × 7 job types only.
 *  - purchase:add, purchase:edit
 *  - product:add, product:edit
 *  - inventory:edit
 *  - customer:add, customer:edit
 *
 * Design goals:
 *  - One reusable engine for every supported bulk flow.
 *  - Reuse existing domain services (purchase, product, inventory, customer).
 *    Do NOT invent domain logic — adapters call existing services.
 *  - Batch size 50, concurrency 1, atomic per batch.
 *  - No per-row queries; preload collectively into in-memory Maps.
 *  - Short transactions; all tx queries awaited; TransactionClient never
 *    escapes the callback.
 *  - Idempotent via operationId + payloadHash:
 *      same operationId + same hash    = already processed (cached)
 *      same operationId + diff hash    = conflict (reject)
 *
 * Two execution modes:
 *  - 'rows'           : client parses rows → POST JSON to /api/bulk-engine/execute
 *                       → server adapter preload+buildPlan+executeBatch in one tx.
 *  - 'file-delegate'  : client posts the file Blob per batch to an existing
 *                       domain route (e.g. /api/migration/import). Engine only
 *                       manages the queue/progress/errors. Domain logic stays
 *                       100% inside the existing route (no duplication).
 */

// ── Job / Batch lifecycle ──────────────────────────────────────────────────

export type BulkJobStatus =
  | 'queued'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'

export type BulkBatchStatus = 'queued' | 'processing' | 'completed' | 'failed'

// ── Parsed row (client-side) ───────────────────────────────────────────────

/** A single parsed Excel row, normalized by the adapter's parseFile. */
export interface ParsedRow {
  /** 1-based row index in the source sheet (for error reporting). */
  rowIndex: number
  /** Normalized cell values keyed by the adapter's column key. */
  data: Record<string, unknown>
  /** Original raw row (for error-export snapshots). */
  raw: Record<string, unknown>
}

export interface RowValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ── Cell semantics (universal) ─────────────────────────────────────────────

/**
 * Universal cell semantics:
 *  - blank  → no change (skip the field on update)
 *  - 0      → valid value (treated as 0, NOT blank)
 *  - CLEAR  → clear supported field (set to null)
 *  - DELETE → only when adapter explicitly supports it
 */
export type CellInterpretation =
  | { kind: 'blank' }
  | { kind: 'value'; value: string | number | boolean | null }
  | { kind: 'clear' }
  | { kind: 'delete' }

// ── Batch result (returned by server adapter or delegate route) ────────────

export interface BatchStats {
  processed: number
  created: number
  updated: number
  skipped: number
  failed: number
  deleted: number
}

/**
 * Stock-cap info attached to BatchError when a composition-cap violation
 * blocks a stock edit. Lets the UI surface a precise "max: N (limited by: X)"
 * hint without re-parsing the error message.
 */
export interface StockCapInfo {
  stockCapped: true
  /** Stock before the attempted change (snapshot from preload). */
  oldStock: number
  /** Stock the user tried to set. */
  newStock: number
  /** Maximum allowed stock based on current composition inventory. */
  maxStock: number
  /** Name of the limiting composition item, if known. */
  limitingItemName: string | null
}

export interface BatchError {
  rowIndex: number
  rowSnapshot?: Record<string, unknown>
  field?: string
  code: string
  message: string
  /** Present only when the error is a composition-cap violation. */
  stockCapInfo?: StockCapInfo
}

export interface BatchResult {
  status: 'completed' | 'failed'
  stats: BatchStats
  errors: BatchError[]
  warnings?: string[]
  /**
   * Per-entity change records (before/after). Populated by adapters instead of
   * writing per-row AuditLog rows. The /api/bulk-engine/execute route folds
   * these into a single BULK_BATCH audit event (AuditLog V2).
   */
  changes?: BulkChangeRecord[]
  /** Delegate-mode extras (e.g. migration final-sheet totals). */
  extras?: Record<string, unknown>
  /** Authoritative totalBatches/totalRows from server (for reconciliation). */
  totalBatches?: number
  totalRows?: number
  isLastBatch?: boolean
}

/**
 * A single entity change produced by a bulk adapter (create/update/skip/delete).
 * The execute route aggregates these into ONE BULK_BATCH audit event, so the
 * audit feed shows 1 row per batch (not 1 per row). `before`/`after` are
 * plain objects of changed fields — the audit-v2 builder formats them safely.
 */
export interface BulkChangeRecord {
  entity: string
  identifier: string
  action: 'created' | 'updated' | 'skipped' | 'deleted' | 'failed'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  note?: string
}

// ── Server adapter context ─────────────────────────────────────────────────

export interface AdapterContext {
  outletId: string
  userId: string
  role: string
  config: Record<string, unknown>
}

/** Opaque preload payload (adapter-specific in-memory Maps/sets). */
export type PreloadData = Record<string, unknown>

/** Opaque execution plan (adapter-specific operations). */
export interface ExecutionPlan {
  operations: unknown[]
}

// ── Column spec (for template generation + preview) ────────────────────────

export interface ColumnSpec {
  key: string
  label: string
  required?: boolean
  type?: 'text' | 'number' | 'date' | 'boolean'
  description?: string
  aliases?: string[]
}

// ── CLIENT adapter contract (runs in browser) ──────────────────────────────

export interface BulkClientAdapter {
  kind: string
  label: string
  description: string
  /** Lucide icon name for UI. */
  icon: string
  batchSize: number
  concurrency: number
  supportsClear: boolean
  supportsDelete: boolean

  /** Template columns (for in-browser preview + client-side template gen). */
  templateColumns: ColumnSpec[]
  /** If set, template is downloaded from this URL instead of generated. */
  templateEndpoint?: string

  /**
   * Parse the uploaded file into normalized rows.
   * Must use dynamic `import('xlsx')` to keep the browser bundle small.
   */
  parseFile(file: File): Promise<{
    rows: ParsedRow[]
    sheetName?: string
    warnings?: string[]
  }>

  /** Validate a single row client-side (for preview before start). */
  validateRow(row: ParsedRow): RowValidation

  /** Execution mode. */
  executionMode: 'rows' | 'file-delegate'

  /** file-delegate: endpoint to POST FormData to (per batch). */
  delegateEndpoint?: string
  /** file-delegate: extra static form fields (e.g. mode). */
  delegateFields?: Record<string, string>
  /** file-delegate: map the delegate route's JSON response → BatchResult. */
  mapDelegateResponse?: (data: Record<string, unknown>) => BatchResult
}

// ── SERVER adapter contract (runs in Node, inside /api/bulk-engine/execute) ─

export interface BulkServerAdapter {
  kind: string

  /**
   * Preload all data needed for this batch collectively (in-memory Maps).
   * NO per-row findFirst/count. Runs ONCE before executeBatch.
   * MUST run BEFORE the transaction (no DB writes here).
   */
  preloadBatch(
    rows: ParsedRow[],
    context: AdapterContext,
  ): Promise<PreloadData>

  /**
   * Build the execution plan from rows + preload. Pure function (no DB).
   * MUST run BEFORE the transaction.
   */
  buildPlan(
    rows: ParsedRow[],
    preload: PreloadData,
    context: AdapterContext,
  ): ExecutionPlan

  /**
   * Execute the plan inside a short Prisma transaction (≤50 rows).
   *
   * TRANSACTION RULE — inside this callback ONLY:
   *  - writes (create/update/delete via tx)
   *  - movements/batches via existing services (FEFOEngine, comp-stock, etc.)
   *  - audit createMany (tx.auditLog.createMany — atomic, no safeAuditLog)
   *  - idempotency marker is written by the /execute route AFTER this returns
   *
   * The TransactionClient is passed in and MUST NOT escape this callback.
   * Idempotency: the /api/bulk-engine/execute route checks an AuditLog row
   * (action='BULK_BATCH', entityId=operationId) by (operationId, payloadHash)
   * before calling this. Retry never duplicates. No extra Prisma model is
   * used — idempotency markers reuse the existing AuditLog table.
   *
   * Default tx timeout is 30s (not 60s) unless the adapter justifies more.
   */
  executeBatch(
    plan: ExecutionPlan,
    tx: import('@prisma/client').Prisma.TransactionClient,
    context: AdapterContext,
    operationId: string,
  ): Promise<BatchResult>

  /** Format a thrown error into a BatchError for export. */
  formatError(error: unknown, row?: ParsedRow): BatchError

  /** Summarize the completed job for the UI. */
  summarize(
    stats: BatchStats,
    errorCount: number,
    batches: { batchIndex: number; status: BulkBatchStatus; durationMs: number }[],
  ): { label: string; details: string[] }

  /**
   * Optional: compute a payload hash for this batch (for conflict detection).
   * Default: SHA-256 of the serialized rows. Override for delegate-mode.
   */
  computePayloadHash?: (rows: ParsedRow[]) => string

  /**
   * Optional: override the tx timeout for this adapter (ms).
   * Default: 30_000. Only increase if justified (e.g. composition validation).
   */
  txTimeoutMs?: number
}
