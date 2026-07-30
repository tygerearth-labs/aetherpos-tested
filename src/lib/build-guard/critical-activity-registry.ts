/**
 * critical-activity-registry.ts — Global Critical Activity Registry
 *
 * Single source of truth for "is the user doing something that a build
 * update / hard reload must NOT interrupt?"
 *
 * Tracked activity types (APP-WIDE):
 *   - pos-cart         — POS has items in the cart (data-loss if reloaded)
 *   - pos-payment      — POS payment dialog open (data-loss: payment in flight)
 *   - outbox-sync      — Dexie syncQueue has PENDING items (interrupt: will retry)
 *   - bulk-job         — bulk engine has a processing job (interrupt: resumes on reload)
 *   - migration-job    — migration engine has a PROCESSING job (interrupt: resumes)
 *   - stock-opname     — stock opname session in progress (data-loss: draft adjustments)
 *   - purchase-draft   — purchase form has unsaved changes (data-loss)
 *   - dirty-form       — any form is dirty (data-loss)
 *   - file-upload      — a file upload/export is in flight (interrupt: must restart)
 *   - domain-mutation  — an in-flight domain API mutation (in-flight: reload mid-request ambiguous)
 *
 * Severity (3 tiers, governs the force-update safety ladder):
 *   - 'interrupt'  — reloading interrupts a background process that resumes
 *                    (outbox sync, bulk job, migration job). Force: simple
 *                    confirmation dialog.
 *   - 'data-loss'  — reloading loses unsaved user input (dirty form, purchase
 *                    draft, stock opname draft). Force: hard confirmation
 *                    dialog listing every active data-loss activity.
 *   - 'in-flight'  — an API mutation is currently in flight (POS payment
 *                    committing, void transaction, customer merge, purchase
 *                    receive/cancel, settings save, stock transfer commit).
 *                    Force: DISABLED until the request completes/timeouts.
 *                    Reloading mid-request leaves the user unsure whether
 *                    the transaction succeeded or failed.
 *
 * Consumers:
 *   - build-version-store: gates auto-reload when status is 'ready'
 *   - error-boundary: gates auto-reload on ChunkLoadError (stale build)
 *   - app-shell useBlockRefresh: warns on beforeunload / F5
 *   - update-banner: lists active activities + tier-aware force button
 */

import { create } from 'zustand'

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

export type ActivitySeverity = 'data-loss' | 'interrupt' | 'in-flight'

export interface CriticalActivity {
  id: string
  type: CriticalActivityType
  label: string
  severity: ActivitySeverity
  startedAt: number
}

interface CriticalActivityStore {
  activities: Record<string, CriticalActivity>
  register: (
    id: string,
    type: CriticalActivityType,
    label: string,
    severity?: ActivitySeverity,
  ) => void
  unregister: (id: string) => void
  clear: () => void
}

export const useCriticalActivityStore = create<CriticalActivityStore>((set) => ({
  activities: {},
  register: (id, type, label, severity = 'data-loss') =>
    set((state) => {
      const existing = state.activities[id]
      if (existing) {
        // Idempotent re-register — only update if label/severity changed
        if (existing.label === label && existing.severity === severity) {
          return state
        }
        return {
          activities: {
            ...state.activities,
            [id]: { ...existing, type, label, severity },
          },
        }
      }
      return {
        activities: {
          ...state.activities,
          [id]: { id, type, label, severity, startedAt: Date.now() },
        },
      }
    }),
  unregister: (id) =>
    set((state) => {
      if (!state.activities[id]) return state
      const next = { ...state.activities }
      delete next[id]
      return { activities: next }
    }),
  clear: () => set({ activities: {} }),
}))

// ── Non-reactive getters (for use in guards / event handlers) ──────────────

export function hasCriticalActivity(): boolean {
  return Object.keys(useCriticalActivityStore.getState().activities).length > 0
}

export function getActiveActivities(): CriticalActivity[] {
  return Object.values(useCriticalActivityStore.getState().activities)
}

export function hasDataLossActivity(): boolean {
  return Object.values(useCriticalActivityStore.getState().activities).some(
    (a) => a.severity === 'data-loss',
  )
}

/**
 * Returns true if any active activity is `in-flight` (an API mutation is
 * currently in flight). The force-reload button MUST be disabled while this
 * is true — reloading mid-request leaves the user unsure whether the
 * transaction succeeded or failed.
 */
export function hasInFlightActivity(): boolean {
  return Object.values(useCriticalActivityStore.getState().activities).some(
    (a) => a.severity === 'in-flight',
  )
}

/**
 * Subscribe to "any activity active?" changes. Returns an unsubscribe fn.
 * Used by the build-version-store to auto-apply a pending update once all
 * activities clear.
 */
export function subscribeToCriticalActivities(cb: (hasActive: boolean) => void): () => void {
  let prev = hasCriticalActivity()
  return useCriticalActivityStore.subscribe((state) => {
    const next = Object.keys(state.activities).length > 0
    if (next !== prev) {
      prev = next
      cb(next)
    }
  })
}
