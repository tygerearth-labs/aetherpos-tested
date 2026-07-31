'use client'

/**
 * MIG-BATCH-V3: Migration processor context.
 *
 * Extracted into its own module so the wizard, dialog, and floating widget can
 * consume the context without creating a circular import with the provider.
 */

import { createContext, useContext } from 'react'
import type { MigrationJob, MigrationBatch } from '@/lib/migration/dexie-db'
import type { ImportMode } from '@/components/migration/migration-banner'

export type ModalState =
  | { type: 'closed' }
  | { type: 'mode_selection' }
  | { type: 'upload'; mode: ImportMode }
  | { type: 'job'; jobId: string }

/**
 * MIG-PARTIAL: Entry mode for the Migration Wizard.
 *  - INITIAL : State 1 — outlet has 0 products, first-time onboarding.
 *  - PARTIAL : State 2 — outlet already operates in Aether but still has
 *              remaining data in an old POS to migrate gradually.
 *
 * Both modes open the exact same wizard + backend processing flow; only the
 * mode-selection header copy differs.
 */
export type MigrationEntryMode = 'INITIAL' | 'PARTIAL'

export interface MigrationProcessorContextValue {
  jobs: MigrationJob[]
  modalState: ModalState
  openJob: MigrationJob | null
  openBatches: MigrationBatch[]
  dbReady: boolean
  /** Current entry mode (INITIAL by default; PARTIAL when opened from the
   *  dashboard partial card or the permanent Products → Import & Migration menu). */
  entryMode: MigrationEntryMode

  openWizard: (entryMode?: MigrationEntryMode) => void
  selectMode: (mode: ImportMode) => void
  backToModeSelection: () => void
  startJob: (file: File, mode: ImportMode) => Promise<void>
  openModal: (jobId: string) => void
  closeModal: () => void
  retryJob: (jobId: string) => void
  dismissJob: (jobId: string) => void
  removeJob: (jobId: string) => void
  checkDuplicate: (file: File, mode: ImportMode) => Promise<MigrationJob | null>
}

export const MigrationProcessorContext = createContext<MigrationProcessorContextValue | null>(null)

export function useMigrationProcessor(): MigrationProcessorContextValue {
  const ctx = useContext(MigrationProcessorContext)
  if (!ctx) {
    throw new Error('useMigrationProcessor must be used within MigrationProcessorProvider')
  }
  return ctx
}
