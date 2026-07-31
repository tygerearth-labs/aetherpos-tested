'use client'

/**
 * useCriticalActivity — NO-OP STUB (patch-safe version).
 *
 * This is a minimal stub that satisfies the import in
 *   - src/components/bulk-engine/bulk-worker-provider.tsx
 *   - src/components/migration/migration-processor-provider.tsx
 *
 * The full implementation (which registers activities into a Zustand store
 * so that build-update reloads can be gated) lives in the build-guard
 * infrastructure task and is not required for the React #31 fix to work.
 *
 * Signature is kept identical so that if the full build-guard files are
 * later added, this stub can be replaced without touching call sites.
 *
 * Usage (unchanged):
 *   useCriticalActivity('bulk-job', 'bulk-job', 'Bulk engine sedang memproses', isActive, 'interrupt')
 */

import { useEffect } from 'react'

export type CriticalActivityType =
  | 'pos-cart'
  | 'pos-payment'
  | 'outbox-sync'
  | 'bulk-job'
  | 'migration-job'
  | 'stock-opname'
  | 'purchase-draft'
  | 'dirty-form'
  | 'file-upload'
  | 'domain-mutation'

export type ActivitySeverity = 'data-loss' | 'interrupt'

export function useCriticalActivity(
  _type: CriticalActivityType,
  _id: string,
  _label: string,
  active: boolean,
  _severity: ActivitySeverity = 'data-loss',
): void {
  useEffect(() => {
    // No-op: registration logic intentionally omitted in this stub.
    // The `active` param is referenced here only to satisfy exhaustive-deps
    // and avoid an unused-variable lint error.
    void active
  }, [active])
}
