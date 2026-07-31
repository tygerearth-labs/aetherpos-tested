'use client'

/**
 * MIG-BATCH-V3: Migration Processor Provider.
 *
 * Mounted in the authenticated app shell so the batch loop survives page
 * navigation. The loop is NOT in the wizard component — it lives here.
 *
 * Responsibilities:
 *  - Owns the modal state (closed / mode_selection / upload / job).
 *  - Surfaces live job + batch data from Dexie (useLiveQuery).
 *  - Runs the sequential batch loop (CONCURRENCY = 1) per active job.
 *  - Uses the Web Locks API so two tabs never process the same job.
 *  - Handles non-JSON server responses gracefully.
 *  - Invalidates the dashboard query when a job finishes.
 *
 * Resume behaviour:
 *  - On reload, useLiveQuery re-surfaces PROCESSING jobs and the effect re-arms
 *    the loop. A stale PROCESSING batch (from a crashed tab) is retried — the
 *    server's name-based dedup makes this safe.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'

import {
  type MigrationJob,
  type MigrationBatch,
  getMigrationDB,
  isMigrationDBAvailable,
  createJobRecord,
  getJob,
  getJobByHash,
  updateJob,
  getBatchesForJob,
  getNextBatchToProcess,
  updateBatch,
  reconcileBatches,
  resetFailedBatches,
  deleteJob,
  mergeJobErrors,
} from '@/lib/migration/dexie-db'
import { computeFileHash } from '@/lib/migration/file-hash'
import { countProductsInFile } from '@/lib/migration/sheet-count'
import {
  MigrationProcessorContext,
  type MigrationProcessorContextValue,
} from './migration-context'
import type { ImportMode } from '@/components/migration/migration-banner'

// ── Provider ───────────────────────────────────────────────────────────────

export function MigrationProcessorProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const outletId = session?.user?.outletId || ''
  const queryClient = useQueryClient()

  const [modalState, setModalState] = useState<ModalState>({ type: 'closed' })
  const [dbReady, setDbReady] = useState(false)

  // Live: all jobs (newest first).
  const jobs = useLiveQuery(
    async () => {
      if (!isMigrationDBAvailable()) return [] as MigrationJob[]
      const list = await getMigrationDB().jobs.toArray()
      list.sort((a, b) => b.createdAt - a.createdAt)
      return list
    },
    [],
    [] as MigrationJob[],
  )

  // Live: the job currently shown in the modal (if any).
  const openJobId = modalState.type === 'job' ? modalState.jobId : null
  const openJob = useLiveQuery(
    async () => {
      if (!openJobId || !isMigrationDBAvailable()) return null
      return (await getMigrationDB().jobs.get(openJobId)) ?? null
    },
    [openJobId],
    null,
  )

  // Live: batches for the open job.
  const openBatches = useLiveQuery(
    async () => {
      if (!openJobId || !isMigrationDBAvailable()) return [] as MigrationBatch[]
      const list = await getMigrationDB().batches.where('jobId').equals(openJobId).toArray()
      list.sort((a, b) => a.batchNumber - b.batchNumber)
      return list
    },
    [openJobId],
    [] as MigrationBatch[],
  )

  // Mark DB ready once IndexedDB is available (client-only).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDbReady(isMigrationDBAvailable())
  }, [])

  // ── Batch loop ──────────────────────────────────────────────────────────

  // Track job ids we've already enqueued for processing (avoid double-kick).
  const processingRefs = useRef<Set<string>>(new Set())
  // Serialise job processing within this tab (CONCURRENCY = 1 across jobs).
  const processorChain = useRef<Promise<void>>(Promise.resolve())

  const enqueue = useCallback((task: () => Promise<void>) => {
    processorChain.current = processorChain.current.then(task).catch((err) => {
      console.error('[MigrationProcessor] job loop error:', err)
    })
  }, [])

  /** Mark a job PARTIAL/FAILED after a batch failure, accumulating stats. */
  const failJob = useCallback(
    async (
      jobId: string,
      errMsg: string,
      batchErrors: string[] = [],
      batchStats?: { batchCreated?: number; batchSkipped?: number; batchFailed?: number },
    ) => {
      const j = await getJob(jobId)
      if (!j) return
      const newCreated = j.createdCount + (batchStats?.batchCreated || 0)
      const newSkipped = j.skippedCount + (batchStats?.batchSkipped || 0)
      const newFailed = j.failedCount + (batchStats?.batchFailed || 0)
      // PARTIAL if at least one batch (or product) succeeded before; FAILED if
      // the very first batch failed with nothing created.
      const status: MigrationJob['status'] =
        j.createdCount > 0 || newCreated > 0 || j.currentBatch > 0 ? 'PARTIAL' : 'FAILED'
      await updateJob(jobId, {
        createdCount: newCreated,
        skippedCount: newSkipped,
        failedCount: newFailed,
        errors: mergeJobErrors(j, batchErrors),
        lastBatchError: errMsg,
        status,
        completedAt: Date.now(),
      })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    [queryClient],
  )

  /** Safety: a PROCESSING job with no pending batches → mark COMPLETED. */
  const finalizeJob = useCallback(async (jobId: string) => {
    const j = await getJob(jobId)
    if (!j || j.status !== 'PROCESSING') return
    const batches = await getBatchesForJob(jobId)
    const allCompleted = batches.length > 0 && batches.every((b) => b.status === 'COMPLETED')
    if (allCompleted) {
      await updateJob(jobId, {
        status: j.failedCount > 0 || j.errors.length > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
        completedAt: Date.now(),
      })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    } else {
      await updateJob(jobId, { status: 'PARTIAL', completedAt: Date.now() })
    }
  }, [queryClient])

  const processJobLoop = useCallback(
    async (jobId: string) => {
      if (!isMigrationDBAvailable()) return

      const lockName = `aetherpos-migration-${jobId}`
      const supportsLocks = typeof navigator !== 'undefined' && 'locks' in navigator

      const run = async () => {
        while (true) {
          const db = getMigrationDB()
          const job = await db.jobs.get(jobId)
          if (!job || job.status !== 'PROCESSING') break

          const batch = await getNextBatchToProcess(jobId)
          if (!batch) {
            // No pending/processing batches but status still PROCESSING — finalize.
            await finalizeJob(jobId)
            break
          }

          const batchStart = Date.now()
          await updateBatch(batch.id, { status: 'PROCESSING', processedAt: batchStart })
          await updateJob(jobId, { currentBatch: batch.batchNumber })

          const fileRec = await db.files.get(jobId)
          if (!fileRec) {
            await updateBatch(batch.id, {
              status: 'FAILED',
              error: 'File tidak ditemukan di penyimpanan lokal. Upload ulang file ini.',
              durationMs: Date.now() - batchStart,
            })
            await failJob(jobId, 'File tidak ditemukan di penyimpanan lokal')
            break
          }

          const formData = new FormData()
          const fileObj = new File([fileRec.blob], fileRec.name, {
            type: fileRec.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          })
          formData.append('file', fileObj)
          formData.append('mode', job.mode)
          formData.append('batchNumber', String(batch.batchNumber))

          // POST with non-JSON response safety.
          let data: Record<string, unknown> & {
            error?: string
            status?: string
            batchCreated?: number
            batchSkipped?: number
            batchFailed?: number
            batchDurationMs?: number
            batchError?: string | null
            errors?: string[]
            isLastBatch?: boolean
            totalBatches?: number
            totalProducts?: number
            barcodeCount?: number
          }
          try {
            const res = await fetch('/api/migration/import', { method: 'POST', body: formData })
            const contentType = res.headers.get('content-type') || ''
            if (!contentType.includes('application/json')) {
              const text = await res.text().catch(() => '')
              data = {
                error: `Server mengembalikan respons non-JSON (${res.status}): ${
                  text.substring(0, 200) || 'Empty response'
                }`,
              }
            } else {
              data = await res.json()
            }
          } catch (fetchErr) {
            data = {
              error:
                fetchErr instanceof Error
                  ? fetchErr.message
                  : 'Network error — gagal terhubung ke server',
            }
          }

          const durationMs = (data.batchDurationMs as number) || Date.now() - batchStart

          // Reconcile authoritative totalBatches/totalProducts from server.
          if (data.totalBatches && data.totalBatches > 0) {
            const fresh = await db.jobs.get(jobId)
            if (fresh) {
              if (fresh.totalBatches !== data.totalBatches) {
                await updateJob(jobId, {
                  totalBatches: data.totalBatches,
                  totalProducts: data.totalProducts ?? fresh.totalProducts,
                })
                await reconcileBatches(jobId, data.totalBatches)
              } else if (
                data.totalProducts != null &&
                fresh.totalProducts !== data.totalProducts
              ) {
                await updateJob(jobId, { totalProducts: data.totalProducts })
              }
            }
          }

          const batchErrors: string[] = data.errors || []

          // ── Failure ──
          if (!data || data.error || data.status === 'BATCH_FAILED') {
            const errMsg = data.error || data.batchError || 'Batch gagal diproses'
            await updateBatch(batch.id, {
              status: 'FAILED',
              created: data.batchCreated || 0,
              skipped: data.batchSkipped || 0,
              failed: data.batchFailed || 0,
              durationMs,
              error: errMsg,
              errors: batchErrors,
            })
            await failJob(jobId, errMsg, batchErrors, {
              batchCreated: data.batchCreated || 0,
              batchSkipped: data.batchSkipped || 0,
              batchFailed: data.batchFailed || 0,
            })
            break // stop subsequent batches
          }

          // ── Success ──
          await updateBatch(batch.id, {
            status: 'COMPLETED',
            created: data.batchCreated || 0,
            skipped: data.batchSkipped || 0,
            failed: data.batchFailed || 0,
            durationMs,
            error: null,
            errors: batchErrors,
          })

          const j = await db.jobs.get(jobId)
          const newCreated = (j?.createdCount || 0) + (data.batchCreated || 0)
          const newSkipped = (j?.skippedCount || 0) + (data.batchSkipped || 0)
          const newFailed = (j?.failedCount || 0) + (data.batchFailed || 0)
          const newBarcode = (j?.barcodeCount || 0) + (data.barcodeCount || 0)
          const mergedErrors = j ? mergeJobErrors(j, batchErrors) : batchErrors

          if (data.isLastBatch) {
            const finalStatus =
              newFailed > 0 || mergedErrors.length > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'
            await updateJob(jobId, {
              createdCount: newCreated,
              skippedCount: newSkipped,
              failedCount: newFailed,
              errors: mergedErrors,
              barcodeCount: newBarcode,
              status: finalStatus,
              completedAt: Date.now(),
              variantsCreated: data.variantsCreated as number | undefined,
              inventoryItemsCreated: data.inventoryItemsCreated as number | undefined,
              inventoryItemsSkipped: data.inventoryItemsSkipped as number | undefined,
              inventoryItemsUpdated: data.inventoryItemsUpdated as number | undefined,
              migrationDataCleaned: data.migrationDataCleaned as number | undefined,
              compositionsCreated: data.compositionsCreated as number | undefined,
              totalStock: data.totalStock as number | undefined,
              totalModalValue: data.totalModalValue as number | undefined,
              totalCategories: data.totalCategories as number | undefined,
              warnings: data.warnings as string[] | undefined,
            })
            // Refresh dashboard product counts.
            queryClient.invalidateQueries({ queryKey: ['dashboard'] })
            break
          } else {
            await updateJob(jobId, {
              createdCount: newCreated,
              skippedCount: newSkipped,
              failedCount: newFailed,
              errors: mergedErrors,
              barcodeCount: newBarcode,
            })
          }
        }
      }

      if (supportsLocks) {
        // Queue for the lock; when acquired, read fresh Dexie state and run.
        // If another tab finishes the job first, run() sees status != PROCESSING
        // and exits immediately (no double-write).
        await navigator.locks.request(lockName, { mode: 'exclusive' }, async (lock) => {
          if (!lock) return
          await run()
        })
      } else {
        await run()
      }
    },
    [queryClient, failJob, finalizeJob],
  )

  // ── Effect: arm the loop for any PROCESSING job ─────────────────────────

  useEffect(() => {
    if (!jobs || !isMigrationDBAvailable()) return
    for (const job of jobs) {
      if (job.status === 'PROCESSING' && !processingRefs.current.has(job.id)) {
        processingRefs.current.add(job.id)
        enqueue(() =>
          processJobLoop(job.id).finally(() => {
            processingRefs.current.delete(job.id)
          }),
        )
      }
    }
  }, [jobs, enqueue, processJobLoop])

  // ── Public actions ──────────────────────────────────────────────────────

  const openWizard = useCallback(() => {
    setModalState({ type: 'mode_selection' })
  }, [])

  const selectMode = useCallback((mode: ImportMode) => {
    setModalState({ type: 'upload', mode })
  }, [])

  const backToModeSelection = useCallback(() => {
    setModalState({ type: 'mode_selection' })
  }, [])

  const openModal = useCallback((jobId: string) => {
    setModalState({ type: 'job', jobId })
  }, [])

  const closeModal = useCallback(() => {
    setModalState({ type: 'closed' })
  }, [])

  const startJob = useCallback(
    async (file: File, mode: ImportMode) => {
      if (!outletId) {
        toast.error('Sesi tidak ditemukan. Muat ulang halaman lalu coba lagi.')
        return
      }
      try {
        const fileHash = await computeFileHash(file, mode, outletId)

        // Duplicate check — never create a second active job for the same file.
        const existing = await getJobByHash(fileHash, outletId)
        if (
          existing &&
          (existing.status === 'PROCESSING' ||
            existing.status === 'PARTIAL' ||
            existing.status === 'FAILED')
        ) {
          // Resume the existing job instead of creating a duplicate.
          setModalState({ type: 'job', jobId: existing.id })
          if (existing.status !== 'PROCESSING') {
            // PARTIAL/FAILED → reset FAILED batches and re-arm.
            await resetFailedBatches(existing.id)
            await updateJob(existing.id, {
              status: 'PROCESSING',
              lastBatchError: null,
              completedAt: null,
            })
          }
          toast.info('File ini sudah memiliki migrasi yang belum selesai. Melanjutkan…')
          return
        }

        const { totalProducts, totalBatches } = await countProductsInFile(file)
        if (totalProducts === 0) {
          toast.error('Tidak ada produk ditemukan di sheet non-varian. Periksa file Anda.')
          return
        }

        const jobId = await createJobRecord(file, fileHash, mode, outletId, totalProducts, totalBatches)
        setModalState({ type: 'job', jobId })
        // The effect above will pick up the new PROCESSING job and arm the loop.
      } catch (err) {
        console.error('[MigrationProcessor] startJob error:', err)
        toast.error(err instanceof Error ? err.message : 'Gagal memulai migrasi')
      }
    },
    [outletId],
  )

  const retryJob = useCallback(
    async (jobId: string) => {
      await resetFailedBatches(jobId)
      await updateJob(jobId, {
        status: 'PROCESSING',
        lastBatchError: null,
        completedAt: null,
      })
      toast.info('Melanjutkan migrasi dari batch gagal…')
    },
    [],
  )

  const dismissJob = useCallback(async (jobId: string) => {
    await updateJob(jobId, { status: 'DISMISSED', dismissedAt: Date.now() })
  }, [])

  const removeJob = useCallback(async (jobId: string) => {
    await deleteJob(jobId)
    setModalState((prev) => (prev.type === 'job' && prev.jobId === jobId ? { type: 'closed' } : prev))
  }, [])

  const checkDuplicate = useCallback(
    async (file: File, mode: ImportMode): Promise<MigrationJob | null> => {
      if (!outletId || !isMigrationDBAvailable()) return null
      try {
        const fileHash = await computeFileHash(file, mode, outletId)
        const existing = await getJobByHash(fileHash, outletId)
        if (
          existing &&
          (existing.status === 'PROCESSING' ||
            existing.status === 'PARTIAL' ||
            existing.status === 'FAILED')
        ) {
          return existing
        }
      } catch (err) {
        console.error('[MigrationProcessor] checkDuplicate error:', err)
      }
      return null
    },
    [outletId],
  )

  const value: MigrationProcessorContextValue = {
    jobs: jobs || [],
    modalState,
    openJob,
    openBatches,
    dbReady,
    openWizard,
    selectMode,
    backToModeSelection,
    startJob,
    openModal,
    closeModal,
    retryJob,
    dismissJob,
    removeJob,
    checkDuplicate,
  }

  return (
    <MigrationProcessorContext.Provider value={value}>{children}</MigrationProcessorContext.Provider>
  )
}
