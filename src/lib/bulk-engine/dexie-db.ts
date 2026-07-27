/**
 * AETHER BULK ENGINE V1 — Dexie-backed bulk job queue.
 *
 * Dexie is ONLY a client-side queue / checkpoint / resume store. The server
 * remains the source of truth for all writes.
 *
 * Tables:
 *  - bulkJobs    : one per upload (kind, fileHash, totals, accumulated stats, summary)
 *  - bulkBatches : one per 50-row batch (status, per-batch stats, errors, rows[])
 *  - bulkErrors  : row-level errors (for export) — capped per job
 *  - bulkFiles   : the xlsx Blob (for file-delegate mode resume)
 *
 * Lifecycle:
 *  1. startJob() parses the file client-side, computes fileHash, inserts a job
 *     (status='queued') + N 'queued' batch records (each carrying its rows).
 *     For file-delegate mode, the file Blob is also stored.
 *  2. The worker provider (mounted in the app shell) loops over batches,
 *     POSTs each to /api/bulk-engine/execute (rows-mode) or the delegate
 *     endpoint (file-delegate), and updates Dexie after every response.
 *  3. On failure the batch is marked 'failed', the job 'partial'/'failed',
 *     and the loop stops. retryJob() resets failed→queued and re-arms.
 *  4. On reload, useLiveQuery re-surfaces 'processing' jobs and the worker
 *     resumes from the first non-completed batch (idempotent via operationId).
 */

import Dexie, { type Table } from 'dexie'
import type { BatchError, BatchStats, ParsedRow } from './types'

// ── Types ──────────────────────────────────────────────────────────────────

export interface BulkJob {
  id: string
  kind: string // adapter kind
  label: string // adapter label (snapshot)
  fileName: string
  fileHash: string
  outletId: string
  userId: string
  totalRows: number
  totalBatches: number
  status: import('./types').BulkJobStatus
  currentBatch: number // last attempted batch index
  config: Record<string, unknown> // adapter-specific config (e.g. migration mode)
  stats: BatchStats // accumulated across completed batches
  errorCount: number
  summary: { label: string; details: string[] } | null
  lastBatchError: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  completedAt: number | null
  dismissedAt: number | null
}

export interface BulkBatch {
  id: string // `${jobId}-${batchIndex}`
  jobId: string
  batchIndex: number
  status: import('./types').BulkBatchStatus
  rows: ParsedRow[] // the 50 rows for this batch (stored for resume)
  stats: BatchStats
  errors: BatchError[]
  durationMs: number
  error: string | null
  attemptCount: number
  startedAt: number | null
  completedAt: number | null
}

export interface BulkErrorRecord {
  id: string // `${jobId}-${batchIndex}-${rowIndex}`
  jobId: string
  batchIndex: number
  rowIndex: number
  rowSnapshot: Record<string, unknown>
  field?: string
  code: string
  message: string
  createdAt: number
}

export interface BulkFile {
  id: string // = jobId
  blob: Blob
  name: string
  type: string
}

// ── DB ─────────────────────────────────────────────────────────────────────

export const DEFAULT_BATCH_SIZE = 50
export const DEFAULT_CONCURRENCY = 1
const MAX_STORED_ERRORS_PER_JOB = 2000

class BulkEngineDB extends Dexie {
  bulkJobs!: Table<BulkJob, string>
  bulkBatches!: Table<BulkBatch, string>
  bulkErrors!: Table<BulkErrorRecord, string>
  bulkFiles!: Table<BulkFile, string>

  constructor() {
    super('aetherpos-bulk-engine')
    this.version(1).stores({
      bulkJobs: 'id, kind, fileHash, status, outletId, createdAt',
      bulkBatches: 'id, jobId, batchIndex, status, [jobId+batchIndex]',
      bulkErrors: 'id, jobId, batchIndex, [jobId+batchIndex]',
      bulkFiles: 'id',
    })
  }
}

let _db: BulkEngineDB | null = null

/** Lazily create the Dexie instance. Must only be called in the browser. */
export function getBulkDB(): BulkEngineDB {
  if (typeof window === 'undefined') {
    throw new Error('BulkEngineDB is browser-only')
  }
  if (!_db) _db = new BulkEngineDB()
  return _db
}

/** True when Dexie/IndexedDB is usable (browser + indexedDB available). */
export function isBulkDBAvailable(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

// ── Helpers ────────────────────────────────────────────────────────────────

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function emptyStats(): BatchStats {
  return { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0, deleted: 0 }
}

export function addStats(a: BatchStats, b: Partial<BatchStats>): BatchStats {
  return {
    processed: a.processed + (b.processed || 0),
    created: a.created + (b.created || 0),
    updated: a.updated + (b.updated || 0),
    skipped: a.skipped + (b.skipped || 0),
    failed: a.failed + (b.failed || 0),
    deleted: a.deleted + (b.deleted || 0),
  }
}

// ── Job CRUD ───────────────────────────────────────────────────────────────

export interface CreateJobInput {
  kind: string
  label: string
  fileName: string
  fileHash: string
  outletId: string
  userId: string
  totalRows: number
  totalBatches: number
  config: Record<string, unknown>
  rows: ParsedRow[] // all rows (split into batches internally)
  batchSize: number
  fileBlob?: Blob // for file-delegate mode
  fileType?: string
}

export async function createJobRecord(input: CreateJobInput): Promise<string> {
  const db = getBulkDB()
  const jobId = newId()
  const now = Date.now()

  const job: BulkJob = {
    id: jobId,
    kind: input.kind,
    label: input.label,
    fileName: input.fileName,
    fileHash: input.fileHash,
    outletId: input.outletId,
    userId: input.userId,
    totalRows: input.totalRows,
    totalBatches: input.totalBatches,
    status: 'queued',
    currentBatch: -1,
    config: input.config,
    stats: emptyStats(),
    errorCount: 0,
    summary: null,
    lastBatchError: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    dismissedAt: null,
  }

  // Split rows into batches.
  const batches: BulkBatch[] = []
  for (let i = 0; i < input.totalBatches; i++) {
    const start = i * input.batchSize
    const batchRows = input.rows.slice(start, start + input.batchSize)
    batches.push({
      id: `${jobId}-${i}`,
      jobId,
      batchIndex: i,
      status: 'queued',
      rows: batchRows,
      stats: emptyStats(),
      errors: [],
      durationMs: 0,
      error: null,
      attemptCount: 0,
      startedAt: null,
      completedAt: null,
    })
  }

  await db.transaction('rw', db.bulkJobs, db.bulkBatches, async () => {
    await db.bulkJobs.add(job)
    await db.bulkBatches.bulkAdd(batches)
  })

  // Store file blob if provided (file-delegate mode).
  if (input.fileBlob) {
    await db.bulkFiles.add({
      id: jobId,
      blob: input.fileBlob,
      name: input.fileName,
      type: input.fileType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  }

  return jobId
}

export async function getJob(jobId: string): Promise<BulkJob | undefined> {
  return getBulkDB().bulkJobs.get(jobId)
}

export async function getJobByHash(
  fileHash: string,
  outletId: string,
): Promise<BulkJob | undefined> {
  const matches = await getBulkDB()
    .bulkJobs.where('fileHash')
    .equals(fileHash)
    .filter((j) => j.outletId === outletId)
    .toArray()
  if (matches.length === 0) return undefined
  matches.sort((a, b) => b.createdAt - a.createdAt)
  return matches[0]
}

export async function updateJob(jobId: string, patch: Partial<BulkJob>): Promise<void> {
  await getBulkDB().bulkJobs.update(jobId, { ...patch, updatedAt: Date.now() })
}

// ── Batch CRUD ─────────────────────────────────────────────────────────────

export async function getBatchesForJob(jobId: string): Promise<BulkBatch[]> {
  const list = await getBulkDB().bulkBatches.where('jobId').equals(jobId).toArray()
  list.sort((a, b) => a.batchIndex - b.batchIndex)
  return list
}

/**
 * Return the first batch (by batchIndex) that is 'queued' or 'processing'.
 * 'processing' is treated as retryable (stale from a crashed/closed tab).
 * 'completed' batches are skipped. 'failed' batches are retried only after
 * retryJob() flips them back to 'queued'.
 */
export async function getNextBatchToProcess(jobId: string): Promise<BulkBatch | undefined> {
  const list = await getBatchesForJob(jobId)
  return list.find((b) => b.status === 'queued' || b.status === 'processing')
}

export async function updateBatch(batchId: string, patch: Partial<BulkBatch>): Promise<void> {
  await getBulkDB().bulkBatches.update(batchId, patch)
}

/**
 * Ensure the job has exactly `totalBatches` batch records. Preserves existing
 * completed/processing records; adds missing queued ones; removes extra queued.
 */
export async function reconcileBatches(
  jobId: string,
  totalBatches: number,
  batchSize: number,
  config: Record<string, unknown>,
): Promise<void> {
  const db = getBulkDB()
  const existing = await getBatchesForJob(jobId)
  const existingByNum = new Map(existing.map((b) => [b.batchIndex, b]))

  const toAdd: BulkBatch[] = []
  for (let i = 0; i < totalBatches; i++) {
    if (!existingByNum.has(i)) {
      toAdd.push({
        id: `${jobId}-${i}`,
        jobId,
        batchIndex: i,
        status: 'queued',
        rows: [], // rows already sent for completed batches; missing batches
        // in delegate-mode are re-fetched from the file by the server.
        stats: emptyStats(),
        errors: [],
        durationMs: 0,
        error: null,
        attemptCount: 0,
        startedAt: null,
        completedAt: null,
      })
    }
  }

  const toDelete: string[] = []
  for (const b of existing) {
    if (b.batchIndex >= totalBatches && b.status === 'queued') {
      toDelete.push(b.id)
    }
  }

  if (toAdd.length === 0 && toDelete.length === 0) return

  await db.transaction('rw', db.bulkBatches, async () => {
    if (toAdd.length > 0) await db.bulkBatches.bulkAdd(toAdd)
    if (toDelete.length > 0) await db.bulkBatches.bulkDelete(toDelete)
  })
}

/** Reset failed batches back to queued so the worker retries them. */
export async function resetFailedBatches(jobId: string): Promise<void> {
  const db = getBulkDB()
  const list = await getBatchesForJob(jobId)
  const failed = list.filter((b) => b.status === 'failed')
  if (failed.length === 0) return
  await db.transaction('rw', db.bulkBatches, async () => {
    for (const b of failed) {
      await db.bulkBatches.update(b.id, {
        status: 'queued',
        error: null,
        errors: [],
        startedAt: null,
        completedAt: null,
      })
    }
  })
}

// ── Errors ─────────────────────────────────────────────────────────────────

export async function addBatchErrors(
  jobId: string,
  batchIndex: number,
  errors: BatchError[],
): Promise<void> {
  if (errors.length === 0) return
  const db = getBulkDB()
  const records: BulkErrorRecord[] = errors.map((e) => ({
    id: `${jobId}-${batchIndex}-${e.rowIndex}`,
    jobId,
    batchIndex,
    rowIndex: e.rowIndex,
    rowSnapshot: e.rowSnapshot || {},
    field: e.field,
    code: e.code,
    message: e.message,
    createdAt: Date.now(),
  }))

  // Cap stored errors per job to avoid unbounded growth.
  const existingCount = await db.bulkErrors.where('jobId').equals(jobId).count()
  const slots = Math.max(0, MAX_STORED_ERRORS_PER_JOB - existingCount)
  const toInsert = records.slice(0, slots)
  if (toInsert.length > 0) {
    await db.bulkErrors.bulkPut(toInsert)
  }
}

export async function getErrorsForJob(jobId: string): Promise<BulkErrorRecord[]> {
  const list = await getBulkDB().bulkErrors.where('jobId').equals(jobId).toArray()
  list.sort((a, b) => a.batchIndex - b.batchIndex || a.rowIndex - b.rowIndex)
  return list
}

// ── Delete ─────────────────────────────────────────────────────────────────

export async function deleteJob(jobId: string): Promise<void> {
  const db = getBulkDB()
  await db.transaction('rw', db.bulkJobs, db.bulkBatches, db.bulkErrors, db.bulkFiles, async () => {
    const batchIds = await db.bulkBatches.where('jobId').equals(jobId).primaryKeys()
    await db.bulkBatches.bulkDelete(batchIds)
    const errorIds = await db.bulkErrors.where('jobId').equals(jobId).primaryKeys()
    await db.bulkErrors.bulkDelete(errorIds)
    await db.bulkFiles.delete(jobId)
    await db.bulkJobs.delete(jobId)
  })
}

export async function clearCompletedJobs(olderThanMs: number): Promise<void> {
  const db = getBulkDB()
  const cutoff = Date.now() - olderThanMs
  const old = await db.bulkJobs
    .where('status')
    .anyOf(['completed', 'partial', 'failed', 'cancelled'])
    .filter((j) => (j.completedAt || j.updatedAt) < cutoff)
    .toArray()
  for (const j of old) {
    await deleteJob(j.id)
  }
}
