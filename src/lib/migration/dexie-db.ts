/**
 * MIG-BATCH-V3: Dexie-backed migration queue.
 *
 * Dexie is ONLY used as a client-side queue / checkpoint / resume store.
 * The server remains the source of truth for all product/inventory writes.
 *
 * Tables:
 *  - jobs:     one per upload (fileHash, totals, accumulated stats, final result)
 *  - batches:  one per 50-product batch (status, per-batch stats, errors)
 *  - files:    the xlsx Blob so we can resume after a browser close/reload
 *
 * Lifecycle:
 *  1. startJob() parses the file client-side, computes fileHash, inserts a job
 *     (status=PROCESSING) + N PENDING batch records + the file Blob.
 *  2. The processor (mounted in the authenticated app shell) loops over PENDING
 *     batches, POSTs each to /api/migration/import with batchNumber, and updates
 *     Dexie after every response.
 *  3. On failure the batch is marked FAILED, the job PARTIAL/FAILED, and the loop
 *     stops. retryJob() resets FAILED→PENDING and re-arms the processor.
 *  4. On reload the provider's useLiveQuery re-surfaces PROCESSING jobs and the
 *     processor resumes from the first non-COMPLETED batch (dedup-safe).
 */

import Dexie, { type Table } from 'dexie'

// ── Types ──────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'PROCESSING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'PARTIAL'
  | 'FAILED'
  | 'DISMISSED'

export type BatchStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface MigrationJob {
  id: string
  fileHash: string
  fileName: string
  mode: string // ImportMode
  outletId: string
  totalProducts: number
  totalBatches: number
  status: JobStatus
  currentBatch: number // last attempted batch number
  createdCount: number
  skippedCount: number
  failedCount: number
  errors: string[] // capped per-row errors (first 500)
  lastBatchError: string | null
  barcodeCount: number
  createdAt: number
  updatedAt: number
  startedAt: number | null
  completedAt: number | null
  dismissedAt: number | null
  // final-sheets extras (filled when the last batch completes)
  variantsCreated?: number
  inventoryItemsCreated?: number
  inventoryItemsSkipped?: number
  inventoryItemsUpdated?: number
  migrationDataCleaned?: number
  compositionsCreated?: number
  totalStock?: number
  totalModalValue?: number
  totalCategories?: number
  warnings?: string[]
}

export interface MigrationBatch {
  id: string // `${jobId}-${batchNumber}`
  jobId: string
  batchNumber: number
  status: BatchStatus
  created: number
  skipped: number
  failed: number
  durationMs: number
  error: string | null
  errors: string[]
  processedAt: number | null
}

export interface MigrationFile {
  id: string // = jobId
  blob: Blob
  name: string
  type: string
}

// ── DB ─────────────────────────────────────────────────────────────────────

export const MIGRATION_BATCH_SIZE = 50
const MAX_STORED_ERRORS = 500

class MigrationDB extends Dexie {
  jobs!: Table<MigrationJob, string>
  batches!: Table<MigrationBatch, string>
  files!: Table<MigrationFile, string>

  constructor() {
    super('aetherpos-migration')
    this.version(1).stores({
      jobs: 'id, fileHash, status, outletId, createdAt',
      batches: 'id, jobId, batchNumber, status, [jobId+batchNumber]',
      files: 'id',
    })
  }
}

let _db: MigrationDB | null = null

/** Lazily create the Dexie instance. Must only be called in the browser. */
export function getMigrationDB(): MigrationDB {
  if (typeof window === 'undefined') {
    throw new Error('MigrationDB is browser-only')
  }
  if (!_db) _db = new MigrationDB()
  return _db
}

/** True when Dexie/IndexedDB is usable (browser + indexedDB available). */
export function isMigrationDBAvailable(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

// ── Helpers ────────────────────────────────────────────────────────────────

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `mig-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function mergeErrors(existing: string[], incoming: string[]): string[] {
  const merged = [...existing, ...incoming]
  return merged.length > MAX_STORED_ERRORS ? merged.slice(0, MAX_STORED_ERRORS) : merged
}

// ── Job CRUD ───────────────────────────────────────────────────────────────

export async function createJobRecord(
  file: File,
  fileHash: string,
  mode: string,
  outletId: string,
  totalProducts: number,
  totalBatches: number,
): Promise<string> {
  const db = getMigrationDB()
  const jobId = newId()
  const now = Date.now()

  const job: MigrationJob = {
    id: jobId,
    fileHash,
    fileName: file.name,
    mode,
    outletId,
    totalProducts,
    totalBatches,
    status: 'PROCESSING',
    currentBatch: 0,
    createdCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
    lastBatchError: null,
    barcodeCount: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    dismissedAt: null,
  }

  const batches: MigrationBatch[] = Array.from({ length: totalBatches }, (_, i) => ({
    id: `${jobId}-${i}`,
    jobId,
    batchNumber: i,
    status: 'PENDING' as BatchStatus,
    created: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
    error: null,
    errors: [],
    processedAt: null,
  }))

  const fileRec: MigrationFile = {
    id: jobId,
    blob: file,
    name: file.name,
    type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }

  await db.transaction('rw', db.jobs, db.batches, db.files, async () => {
    await db.jobs.add(job)
    await db.batches.bulkAdd(batches)
    await db.files.add(fileRec)
  })

  return jobId
}

export async function getJob(jobId: string): Promise<MigrationJob | undefined> {
  return getMigrationDB().jobs.get(jobId)
}

export async function getJobByHash(fileHash: string, outletId: string): Promise<MigrationJob | undefined> {
  const matches = await getMigrationDB().jobs
    .where('fileHash')
    .equals(fileHash)
    .filter((j) => j.outletId === outletId)
    .toArray()
  if (matches.length === 0) return undefined
  // Most recent first
  matches.sort((a, b) => b.createdAt - a.createdAt)
  return matches[0]
}

export async function updateJob(jobId: string, patch: Partial<MigrationJob>): Promise<void> {
  await getMigrationDB().jobs.update(jobId, { ...patch, updatedAt: Date.now() })
}

// ── Batch CRUD ─────────────────────────────────────────────────────────────

export async function getBatchesForJob(jobId: string): Promise<MigrationBatch[]> {
  const list = await getMigrationDB().batches.where('jobId').equals(jobId).toArray()
  list.sort((a, b) => a.batchNumber - b.batchNumber)
  return list
}

/**
 * Return the first batch (by batchNumber) that is PENDING or PROCESSING.
 * PROCESSING is treated as retryable (stale from a crashed/closed tab).
 * COMPLETED batches are skipped (never re-sent). FAILED batches are retried
 * only after retryJob() flips them back to PENDING.
 */
export async function getNextBatchToProcess(jobId: string): Promise<MigrationBatch | undefined> {
  const list = await getBatchesForJob(jobId)
  return list.find((b) => b.status === 'PENDING' || b.status === 'PROCESSING')
}

export async function updateBatch(batchId: string, patch: Partial<MigrationBatch>): Promise<void> {
  await getMigrationDB().batches.update(batchId, patch)
}

/**
 * Ensure the job has exactly `totalBatches` batch records (0..N-1).
 * Used to reconcile when the server's authoritative totalBatches differs from
 * the client-side estimate. Preserves existing COMPLETED/PROCESSING records.
 */
export async function reconcileBatches(jobId: string, totalBatches: number): Promise<void> {
  const db = getMigrationDB()
  const existing = await getBatchesForJob(jobId)
  const existingByNum = new Map(existing.map((b) => [b.batchNumber, b]))

  const toAdd: MigrationBatch[] = []
  for (let i = 0; i < totalBatches; i++) {
    if (!existingByNum.has(i)) {
      toAdd.push({
        id: `${jobId}-${i}`,
        jobId,
        batchNumber: i,
        status: 'PENDING',
        created: 0,
        skipped: 0,
        failed: 0,
        durationMs: 0,
        error: null,
        errors: [],
        processedAt: null,
      })
    }
  }

  // Delete any extra PENDING records beyond totalBatches.
  const toDelete: string[] = []
  for (const b of existing) {
    if (b.batchNumber >= totalBatches && b.status === 'PENDING') {
      toDelete.push(b.id)
    }
  }

  if (toAdd.length === 0 && toDelete.length === 0) return

  await db.transaction('rw', db.batches, async () => {
    if (toAdd.length > 0) await db.batches.bulkAdd(toAdd)
    if (toDelete.length > 0) await db.batches.bulkDelete(toDelete)
  })
}

/**
 * Reset FAILED batches back to PENDING so the processor retries them.
 * COMPLETED batches are left untouched (never re-sent).
 */
export async function resetFailedBatches(jobId: string): Promise<void> {
  const db = getMigrationDB()
  const list = await getBatchesForJob(jobId)
  const failed = list.filter((b) => b.status === 'FAILED')
  if (failed.length === 0) return
  await db.transaction('rw', db.batches, async () => {
    for (const b of failed) {
      await db.batches.update(b.id, {
        status: 'PENDING',
        error: null,
        errors: [],
        processedAt: null,
      })
    }
  })
}

// ── Delete ─────────────────────────────────────────────────────────────────

export async function deleteJob(jobId: string): Promise<void> {
  const db = getMigrationDB()
  await db.transaction('rw', db.jobs, db.batches, db.files, async () => {
    const batchIds = await db.batches.where('jobId').equals(jobId).primaryKeys()
    await db.batches.bulkDelete(batchIds)
    await db.files.delete(jobId)
    await db.jobs.delete(jobId)
  })
}

// ── Stats helper (exported for the provider) ───────────────────────────────

export function mergeJobErrors(job: MigrationJob, incoming: string[]): string[] {
  return mergeErrors(job.errors || [], incoming)
}
