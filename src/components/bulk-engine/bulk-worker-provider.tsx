'use client'

/**
 * AETHER BULK ENGINE V1 — worker provider.
 *
 * Mounted in the authenticated app shell (sibling of MigrationProcessorProvider)
 * so the batch loop survives page navigation.
 *
 * Responsibilities:
 *  - Owns the dialog + queue-drawer state.
 *  - Surfaces live job + batch data from Dexie (useLiveQuery).
 *  - Runs the sequential batch loop (CONCURRENCY = 1) per active job.
 *  - Uses Web Locks so two tabs never process the same job.
 *  - Handles both row-mode (POST JSON to /api/bulk-engine/execute) and
 *    file-delegate mode (POST FormData to the adapter's delegateEndpoint).
 *  - Pause/resume/retry/cancel.
 *  - Error export to xlsx.
 *  - Invalidates dashboard query when a job finishes.
 *
 * Resume behaviour:
 *  - On reload, useLiveQuery re-surfaces 'processing' jobs and the effect
 *    re-arms the loop. A stale 'processing' batch (crashed tab) is retried —
 *    idempotent via operationId (AuditLog row with action='BULK_BATCH') for
 *    row-mode, or name-based dedup for file-delegate migration.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'

import {
  type BulkBatch,
  type BulkJob,
  addBatchErrors,
  addStats,
  clearCompletedJobs,
  createJobRecord,
  deleteJob,
  emptyStats,
  getBatchesForJob,
  getBulkDB,
  getJob,
  getJobByHash,
  getNextBatchToProcess,
  isBulkDBAvailable,
  reconcileBatches,
  resetFailedBatches,
  updateBatch,
  updateJob,
} from '@/lib/bulk-engine/dexie-db'
import { computeBulkFileHash, computeRowsPayloadHash } from '@/lib/bulk-engine/file-hash'
import { getClientAdapter } from '@/lib/bulk-engine/registry-client'
import { exportErrorsToXlsx, downloadErrorsBlob } from '@/lib/bulk-engine/error-export'
import type { BatchResult, BatchStats, ParsedRow } from '@/lib/bulk-engine/types'
import { useCriticalActivity } from '@/hooks/use-critical-activity'
import { BulkWorkerContext, type BulkModalState, type BulkWorkerContextValue } from './bulk-worker-context'

// ── Provider ───────────────────────────────────────────────────────────────

export function BulkWorkerProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const outletId = session?.user?.outletId || ''
  const userId = session?.user?.id || ''
  const queryClient = useQueryClient()

  const [modalState, setModalState] = useState<BulkModalState>({ type: 'closed' })
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false)
  const [dbReady, setDbReady] = useState(false)

  // Live: all jobs (newest first).
  const jobs = useLiveQuery(
    async () => {
      if (!isBulkDBAvailable()) return [] as BulkJob[]
      const list = await getBulkDB().bulkJobs.toArray()
      list.sort((a, b) => b.createdAt - a.createdAt)
      return list
    },
    [],
    [] as BulkJob[],
  )

  // Live: the job currently shown in the modal.
  const openJobId = modalState.type === 'job' ? modalState.jobId : null
  const openJob = useLiveQuery(
    async () => {
      if (!openJobId || !isBulkDBAvailable()) return null
      return (await getBulkDB().bulkJobs.get(openJobId)) ?? null
    },
    [openJobId],
    null,
  )

  // Live: batches for the open job.
  const openBatches = useLiveQuery(
    async () => {
      if (!openJobId || !isBulkDBAvailable()) return [] as BulkBatch[]
      const list = await getBulkDB().bulkBatches.where('jobId').equals(openJobId).toArray()
      list.sort((a, b) => a.batchIndex - b.batchIndex)
      return list
    },
    [openJobId],
    [] as BulkBatch[],
  )

  // ── Build guard: register a critical activity while any bulk job is processing ──
  const hasProcessingBulkJob = (jobs || []).some((j) => j.status === 'processing')
  useCriticalActivity(
    'bulk-job',
    'bulk-job',
    'Bulk engine sedang memproses',
    hasProcessingBulkJob,
    'interrupt',
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDbReady(isBulkDBAvailable())
  }, [])

  // ── Batch loop ──────────────────────────────────────────────────────────

  const processingRefs = useRef<Set<string>>(new Set())
  const processorChain = useRef<Promise<void>>(Promise.resolve())

  const enqueue = useCallback((task: () => Promise<void>) => {
    processorChain.current = processorChain.current.then(task).catch((err) => {
      console.error('[BulkWorker] job loop error:', err)
    })
  }, [])

  /** Mark a job partial/failed after a batch failure, accumulating stats. */
  const failJob = useCallback(
    async (
      jobId: string,
      errMsg: string,
      batchStats?: Partial<BatchStats>,
    ) => {
      const j = await getJob(jobId)
      if (!j) return
      const newStats = addStats(j.stats, batchStats || {})
      const status: BulkJob['status'] =
        j.stats.processed > 0 || j.currentBatch > 0 ? 'partial' : 'failed'
      await updateJob(jobId, {
        stats: newStats,
        lastBatchError: errMsg,
        status,
        completedAt: Date.now(),
      })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    [queryClient],
  )

  /** Safety: a processing job with no pending batches → mark completed/partial. */
  const finalizeJob = useCallback(
    async (jobId: string) => {
      const j = await getJob(jobId)
      if (!j || j.status !== 'processing') return
      const batches = await getBatchesForJob(jobId)
      const allCompleted = batches.length > 0 && batches.every((b) => b.status === 'completed')
      if (allCompleted) {
        const adapter = getClientAdapter(j.kind)
        let summary: { label: string; details: string[] } | null = null
        if (adapter) {
          try {
            summary = adapter.summarize(j.stats, j.errorCount, batches.map((b) => ({ batchIndex: b.batchIndex, status: b.status, durationMs: b.durationMs })))
          } catch { /* ignore summary errors */ }
        }
        const status: BulkJob['status'] = j.errorCount > 0 ? 'partial' : 'completed'
        await updateJob(jobId, { status, summary, completedAt: Date.now() })
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        if (status === 'completed') {
          toast.success(`${j.label} selesai`, { description: summary?.details.join(' · ') })
        } else {
          toast.warning(`${j.label} selesai dengan error`, { description: `${j.errorCount} baris gagal` })
        }
      } else {
        await updateJob(jobId, { status: 'partial', completedAt: Date.now() })
      }
    },
    [queryClient],
  )

  /** Process one batch — row-mode or file-delegate. */
  const processBatch = useCallback(
    async (job: BulkJob, batch: BulkBatch): Promise<BatchResult> => {
      const adapter = getClientAdapter(job.kind)
      if (!adapter) throw new Error(`Adapter "${job.kind}" tidak ditemukan`)

      if (adapter.executionMode === 'file-delegate') {
        // File-delegate: POST FormData(file, batchNumber, ...) to delegateEndpoint.
        const fileRec = await getBulkDB().bulkFiles.get(job.id)
        if (!fileRec) {
          return {
            status: 'failed',
            stats: emptyStats(),
            errors: [{ rowIndex: 0, code: 'FILE_MISSING', message: 'File tidak ditemukan di penyimpanan lokal. Upload ulang.' }],
          }
        }
        const formData = new FormData()
        const fileObj = new File([fileRec.blob], fileRec.name, {
          type: fileRec.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        formData.append('file', fileObj)
        formData.append('batchNumber', String(batch.batchIndex))
        // V2 PURCHASE-DELEGATE: send jobId + operationId so the delegate route
        // can write per-PO idempotency markers (AuditLog row with
        // action='BULK_BATCH') and skip already-completed POs on retry.
        // Matches the row-mode operationId pattern
        // `${job.id}-${batch.batchIndex}` for cross-mode consistency.
        formData.append('jobId', job.id)
        formData.append('batchIndex', String(batch.batchIndex))
        formData.append('operationId', `${job.id}-${batch.batchIndex}`)
        // Inject config fields (e.g. migration mode).
        for (const [k, v] of Object.entries(job.config)) {
          formData.append(k, String(v))
        }
        for (const [k, v] of Object.entries(adapter.delegateFields || {})) {
          formData.append(k, v)
        }

        let data: Record<string, unknown>
        try {
          const res = await fetch(adapter.delegateEndpoint!, { method: 'POST', body: formData })
          const contentType = res.headers.get('content-type') || ''
          if (!contentType.includes('application/json')) {
            const text = await res.text().catch(() => '')
            data = { error: `Server mengembalikan respons non-JSON (${res.status}): ${text.substring(0, 200) || 'Empty'}` }
          } else {
            data = await res.json()
          }
        } catch (fetchErr) {
          data = { error: fetchErr instanceof Error ? fetchErr.message : 'Network error' }
        }
        if (!adapter.mapDelegateResponse) {
          return { status: 'failed', stats: emptyStats(), errors: [{ rowIndex: 0, code: 'NO_MAPPER', message: 'Adapter tidak punya mapDelegateResponse' }] }
        }
        return adapter.mapDelegateResponse(data)
      }

      // Row-mode: POST JSON to /api/bulk-engine/execute.
      let data: BatchResult & { cached?: boolean; operationId?: string; error?: string }
      try {
        const payloadHash = await computeRowsPayloadHash(batch.rows)
        const res = await fetch('/api/bulk-engine/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: job.kind,
            jobId: job.id,
            batchIndex: batch.batchIndex,
            operationId: `${job.id}-${batch.batchIndex}`,
            payloadHash,
            rows: batch.rows,
            context: { config: job.config },
          }),
        })
        const contentType = res.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          const text = await res.text().catch(() => '')
          data = {
            status: 'failed',
            stats: emptyStats(),
            errors: [{ rowIndex: 0, code: 'NON_JSON', message: `Server non-JSON (${res.status}): ${text.substring(0, 200)}` }],
          }
        } else {
          data = (await res.json()) as BatchResult & { cached?: boolean; error?: string }
        }
      } catch (fetchErr) {
        data = {
          status: 'failed',
          stats: emptyStats(),
          errors: [{ rowIndex: 0, code: 'NETWORK', message: fetchErr instanceof Error ? fetchErr.message : 'Network error' }],
        }
      }
      if (data.error && !data.stats) {
        data.stats = emptyStats()
        data.errors = [{ rowIndex: 0, code: 'SERVER_ERROR', message: data.error }]
      }
      return data
    },
    [],
  )

  const processJobLoop = useCallback(
    async (jobId: string) => {
      if (!isBulkDBAvailable()) return
      const lockName = `aetherpos-bulk-${jobId}`
      const supportsLocks = typeof navigator !== 'undefined' && 'locks' in navigator

      const run = async () => {
        while (true) {
          const db = getBulkDB()
          const job = await db.bulkJobs.get(jobId)
          if (!job || job.status !== 'processing') break

          // Pause check.
          if (job.status === 'paused' || job.status === 'cancelled') break

          const batch = await getNextBatchToProcess(jobId)
          if (!batch) {
            await finalizeJob(jobId)
            break
          }

          const batchStart = Date.now()
          await updateBatch(batch.id, {
            status: 'processing',
            startedAt: batchStart,
            attemptCount: batch.attemptCount + 1,
          })
          await updateJob(jobId, { currentBatch: batch.batchIndex })

          let result: BatchResult
          try {
            result = await processBatch(job, batch)
          } catch (err) {
            result = {
              status: 'failed',
              stats: emptyStats(),
              errors: [{ rowIndex: 0, code: 'UNEXPECTED', message: err instanceof Error ? err.message : String(err) }],
            }
          }

          const durationMs = Date.now() - batchStart

          // Reconcile authoritative totalBatches (delegate-mode).
          if (result.totalBatches && result.totalBatches > 0) {
            const fresh = await db.bulkJobs.get(jobId)
            if (fresh && fresh.totalBatches !== result.totalBatches) {
              await updateJob(jobId, {
                totalBatches: result.totalBatches,
                totalRows: result.totalRows ?? fresh.totalRows,
              })
              const adapter = getClientAdapter(job.kind)
              await reconcileBatches(jobId, result.totalBatches, adapter?.batchSize || 50, job.config)
            }
          }

          // Store errors in bulkErrors table (for export).
          if (result.errors.length > 0) {
            await addBatchErrors(jobId, batch.batchIndex, result.errors)
          }

          if (result.status === 'failed') {
            const errMsg = result.errors[0]?.message || 'Batch gagal'
            await updateBatch(batch.id, {
              status: 'failed',
              stats: result.stats,
              errors: result.errors,
              durationMs,
              error: errMsg,
              completedAt: Date.now(),
            })
            await failJob(jobId, errMsg, result.stats)
            break
          }

          // Success.
          await updateBatch(batch.id, {
            status: 'completed',
            stats: result.stats,
            errors: result.errors,
            durationMs,
            error: null,
            completedAt: Date.now(),
          })

          const j = await db.bulkJobs.get(jobId)
          if (j) {
            const newStats = addStats(j.stats, result.stats)
            const newErrorCount = j.errorCount + result.errors.length
            await updateJob(jobId, { stats: newStats, errorCount: newErrorCount })
          }

          if (result.isLastBatch) {
            await finalizeJob(jobId)
            break
          }
        }
      }

      if (supportsLocks) {
        await navigator.locks.request(lockName, { mode: 'exclusive' }, async (lock) => {
          if (!lock) return
          await run()
        })
      } else {
        await run()
      }
    },
    [processBatch, failJob, finalizeJob],
  )

  // ── Effect: arm the loop for any processing job ──
  useEffect(() => {
    if (!jobs || !isBulkDBAvailable()) return
    for (const job of jobs) {
      if (job.status === 'processing' && !processingRefs.current.has(job.id)) {
        processingRefs.current.add(job.id)
        enqueue(() =>
          processJobLoop(job.id).finally(() => {
            processingRefs.current.delete(job.id)
          }),
        )
      }
    }
  }, [jobs, enqueue, processJobLoop])

  // ── Cleanup old completed jobs on mount ──
  useEffect(() => {
    if (!isBulkDBAvailable()) return
    clearCompletedJobs(24 * 60 * 60 * 1000).catch(() => { /* ignore */ })
  }, [])

  // ── Public actions ──────────────────────────────────────────────────────

  const startJob = useCallback(
    async (file: File, kind: string, config: Record<string, unknown> = {}) => {
      if (!outletId || !userId) {
        toast.error('Sesi tidak ditemukan. Muat ulang halaman lalu coba lagi.')
        return
      }
      const adapter = getClientAdapter(kind)
      if (!adapter) {
        toast.error(`Adapter "${kind}" tidak ditemukan.`)
        return
      }
      try {
        const fileHash = await computeBulkFileHash(file, kind, outletId)

        // Duplicate check — resume existing partial/failed job.
        const existing = await getJobByHash(fileHash, outletId)
        if (existing && (existing.status === 'processing' || existing.status === 'paused' || existing.status === 'partial' || existing.status === 'failed')) {
          setModalState({ type: 'job', jobId: existing.id })
          if (existing.status !== 'processing') {
            await resetFailedBatches(existing.id)
            await updateJob(existing.id, { status: 'processing', lastBatchError: null, completedAt: null })
          }
          toast.info('File ini sudah punya job belum selesai. Melanjutkan…')
          return
        }

        // Parse file (client-side).
        const parsed = await adapter.parseFile(file)
        if (parsed.rows.length === 0 && adapter.executionMode === 'rows') {
          toast.error('Tidak ada baris data ditemukan di file.')
          return
        }

        // For file-delegate mode, compute totalBatches via adapter-specific logic.
        let totalRows = parsed.rows.length
        let totalBatches: number
        if (adapter.executionMode === 'file-delegate' && kind === 'migration-products') {
          const { countMigrationProducts } = await import('@/lib/bulk-engine/adapters/migration-products')
          const counts = await countMigrationProducts(file)
          totalRows = counts.totalProducts
          totalBatches = counts.totalBatches
        } else {
          totalBatches = Math.max(1, Math.ceil(totalRows / adapter.batchSize))
        }

        const jobId = await createJobRecord({
          kind,
          label: adapter.label,
          fileName: file.name,
          fileHash,
          outletId,
          userId,
          totalRows,
          totalBatches,
          config,
          rows: parsed.rows,
          batchSize: adapter.batchSize,
          fileBlob: adapter.executionMode === 'file-delegate' ? file : undefined,
          fileType: file.type,
        })

        // Flip to processing so the effect arms the loop.
        await updateJob(jobId, { status: 'processing', startedAt: Date.now() })
        setModalState({ type: 'job', jobId })
        toast.info(`${adapter.label} dimulai (${totalRows} baris, ${totalBatches} batch)`)
      } catch (err) {
        console.error('[BulkWorker] startJob error:', err)
        toast.error(err instanceof Error ? err.message : 'Gagal memulai bulk job')
      }
    },
    [outletId, userId],
  )

  const pauseJob = useCallback(async (jobId: string) => {
    await updateJob(jobId, { status: 'paused' })
    toast.info('Job dijeda. Klik Lanjutkan untuk melanjutkan.')
  }, [])

  const resumeJob = useCallback(async (jobId: string) => {
    await updateJob(jobId, { status: 'processing', lastBatchError: null })
    toast.info('Melanjutkan job…')
  }, [])

  const retryJob = useCallback(async (jobId: string) => {
    await resetFailedBatches(jobId)
    await updateJob(jobId, { status: 'processing', lastBatchError: null, completedAt: null })
    toast.info('Mencoba ulang batch yang gagal…')
  }, [])

  const cancelJob = useCallback(async (jobId: string) => {
    await updateJob(jobId, { status: 'cancelled', completedAt: Date.now() })
    toast.info('Job dibatalkan.')
  }, [])

  const dismissJob = useCallback(async (jobId: string) => {
    await updateJob(jobId, { dismissedAt: Date.now() })
  }, [])

  const removeJob = useCallback(async (jobId: string) => {
    await deleteJob(jobId)
    setModalState((prev) => (prev.type === 'job' && prev.jobId === jobId ? { type: 'closed' } : prev))
  }, [])

  const exportErrors = useCallback(async (jobId: string) => {
    try {
      const { getErrorsForJob } = await import('@/lib/bulk-engine/dexie-db')
      const { getJob } = await import('@/lib/bulk-engine/dexie-db')
      const job = await getJob(jobId)
      if (!job) return
      const errors = await getErrorsForJob(jobId)
      if (errors.length === 0) {
        toast.info('Tidak ada error untuk diexport.')
        return
      }
      const blob = await exportErrorsToXlsx({ fileName: job.fileName, kind: job.kind }, errors)
      downloadErrorsBlob(blob, job.fileName)
      toast.success(`${errors.length} error diexport ke Excel.`)
    } catch (err) {
      toast.error('Gagal export error: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  // ── UI actions ──
  const openDialog = useCallback((kind: string) => setModalState({ type: 'upload', kind }), [])
  const closeDialog = useCallback(() => setModalState({ type: 'closed' }), [])
  const openJobModal = useCallback((jobId: string) => setModalState({ type: 'job', jobId }), [])
  const closeModal = useCallback(() => setModalState({ type: 'closed' }), [])
  const openQueueDrawer = useCallback(() => setQueueDrawerOpen(true), [])
  const closeQueueDrawer = useCallback(() => setQueueDrawerOpen(false), [])

  const value: BulkWorkerContextValue = {
    jobs: jobs || [],
    dbReady,
    modalState,
    openJob,
    openBatches,
    queueDrawerOpen,
    startJob,
    pauseJob,
    resumeJob,
    retryJob,
    cancelJob,
    dismissJob,
    removeJob,
    exportErrors,
    openDialog,
    closeDialog,
    openJobModal,
    closeModal,
    openQueueDrawer,
    closeQueueDrawer,
  }

  return <BulkWorkerContext.Provider value={value}>{children}</BulkWorkerContext.Provider>
}
