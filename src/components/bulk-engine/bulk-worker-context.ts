'use client'

/**
 * AETHER BULK ENGINE V1 — worker context.
 *
 * Exposes the worker state + actions to the UI (dialog, widget, drawer).
 */

import React from 'react'
import type { BulkBatch, BulkJob } from '@/lib/bulk-engine/dexie-db'

export interface BulkWorkerContextValue {
  // Live data
  jobs: BulkJob[]
  dbReady: boolean

  // Modal state
  modalState: BulkModalState
  openJob: BulkJob | null
  openBatches: BulkBatch[]

  // Drawer state
  queueDrawerOpen: boolean

  // Actions — job lifecycle
  startJob: (file: File, kind: string, config?: Record<string, unknown>) => Promise<void>
  pauseJob: (jobId: string) => Promise<void>
  resumeJob: (jobId: string) => Promise<void>
  retryJob: (jobId: string) => Promise<void>
  cancelJob: (jobId: string) => Promise<void>
  dismissJob: (jobId: string) => Promise<void>
  removeJob: (jobId: string) => Promise<void>
  exportErrors: (jobId: string) => Promise<void>

  // Actions — UI
  openDialog: (kind: string) => void
  closeDialog: () => void
  openJobModal: (jobId: string) => void
  closeModal: () => void
  openQueueDrawer: () => void
  closeQueueDrawer: () => void
}

export type BulkModalState =
  | { type: 'closed' }
  | { type: 'upload'; kind: string }
  | { type: 'job'; jobId: string }

export const BulkWorkerContext = React.createContext<BulkWorkerContextValue | null>(null)

export function useBulkWorker(): BulkWorkerContextValue {
  const ctx = React.useContext(BulkWorkerContext)
  if (!ctx) {
    throw new Error('useBulkWorker must be used within <BulkWorkerProvider>')
  }
  return ctx
}
