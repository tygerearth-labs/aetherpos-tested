/**
 * build-version-store.ts — Global Build Version State + Update Lifecycle
 *
 * State machine for the whole-app build version guard:
 *
 *   idle ──(server reports a different buildId)──▶ ready (safe to apply)
 *    │                                                │
 *    │                                    (critical activities active)
 *    │                                                ▼
 *    └──────────────────────────────────────▶ pending (deferred)
 *                                                   │
 *                                       (activities clear)
 *                                                   ▼
 *                                                ready
 *                                                   │
 *                                       (apply: SW skipWaiting + reload)
 *                                                   ▼
 *                                              applying
 *                                                   │
 *                                       (controllerchange → reload)
 *                                                   ▼
 *                                                idle
 *
 * CRITICAL: a build update never force-reloads while any critical activity
 * is active. When activities clear, a pending update auto-transitions to
 * 'ready' and the app-shell applies it (one controlled reload).
 *
 * The reload itself is guarded by sessionStorage so we never loop:
 *   - aether-build-update-reloaded = '1' → already reloaded for this update
 */

import { create } from 'zustand'
import {
  hasCriticalActivity,
  subscribeToCriticalActivities,
} from './critical-activity-registry'

export type UpdateStatus = 'idle' | 'ready' | 'pending' | 'applying'

interface BuildVersionStore {
  /** The buildId this tab is currently running (window.__NEXT_DATA__.buildId) */
  clientBuildId: string | null
  /** The latest buildId the SW has detected on the server */
  serverBuildId: string | null
  /** Current update lifecycle state */
  status: UpdateStatus
  /** When the new build was first detected (ms epoch) */
  detectedAt: number | null
  setClientBuildId: (id: string) => void
  /** Called when the SW reports a new buildId (AETHER_NEW_BUILD) */
  reportServerBuildId: (id: string) => void
  /** Force the status to 'ready' (e.g. user clicks "apply now") */
  markReady: () => void
  /** Force the status to 'pending' (e.g. new activity registered while ready) */
  markPending: () => void
  /** Transition to 'applying' (SW activation in progress) */
  markApplying: () => void
  /** Clear the update (after reload completes, or update is the same build) */
  clearUpdate: () => void
}

export const useBuildVersionStore = create<BuildVersionStore>((set, get) => ({
  clientBuildId: null,
  serverBuildId: null,
  status: 'idle',
  detectedAt: null,
  setClientBuildId: (id) =>
    set((s) => (s.clientBuildId === id ? s : { clientBuildId: id })),
  reportServerBuildId: (id) =>
    set((s) => {
      if (s.serverBuildId === id) return s
      // Only treat as an update if server differs from client build
      const isUpdate = !!s.clientBuildId && !!id && s.clientBuildId !== id
      if (!isUpdate) {
        return { serverBuildId: id }
      }
      const hasActive = hasCriticalActivity()
      return {
        serverBuildId: id,
        status: hasActive ? 'pending' : 'ready',
        detectedAt: Date.now(),
      }
    }),
  markReady: () => set({ status: 'ready' }),
  markPending: () => set({ status: 'pending' }),
  markApplying: () => set({ status: 'applying' }),
  clearUpdate: () =>
    set({ status: 'idle', serverBuildId: null, detectedAt: null }),
}))

// ── Auto-transitions driven by critical-activity changes ────────────────────
//
// Two transitions are driven by the critical-activity registry:
//
// 1. pending → ready: when all activities clear (the user finished their work,
//    safe to apply the update now). This is the "apply after all critical
//    activities clear" requirement.
//
// 2. ready → pending: when a NEW activity is registered while an update is
//    ready-but-not-yet-applied. The user started a new task (opened a form,
//    added items to cart, etc.) — the update should be deferred again until
//    they finish. Without this, a user could click "Perbarui sekarang" while
//    a data-loss activity is active (e.g., they opened a product form after
//    the banner appeared), losing unsaved work.
let wasActive = hasCriticalActivity()
subscribeToCriticalActivities((hasActive) => {
  const state = useBuildVersionStore.getState()
  if (wasActive && !hasActive) {
    // Activities cleared → pending becomes ready
    if (state.status === 'pending') {
      useBuildVersionStore.getState().markReady()
    }
  } else if (!wasActive && hasActive) {
    // New activity registered → ready becomes pending (defer the update)
    if (state.status === 'ready') {
      useBuildVersionStore.getState().markPending()
    }
  }
  wasActive = hasActive
})

// ── Controlled-reload guard (prevents infinite loops) ──────────────────────

const BUILD_UPDATE_RELOADED_KEY = 'aether-build-update-reloaded'

/**
 * Returns true if we have NOT yet reloaded for a build update this session.
 * The app-shell should: if true → set guard + apply; if false → show recovery.
 */
export function canApplyBuildUpdate(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(BUILD_UPDATE_RELOADED_KEY) !== '1'
  } catch {
    return false
  }
}

/**
 * Mark that a build-update reload has been attempted (so we don't loop).
 */
export function markBuildUpdateReloading(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(BUILD_UPDATE_RELOADED_KEY, '1')
  } catch {
    /* sessionStorage blocked — proceed anyway */
  }
}

/**
 * Reset the guard (called after a successful post-reload navigation, so a
 * future update can auto-apply again).
 */
export function resetBuildUpdateReloadGuard(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(BUILD_UPDATE_RELOADED_KEY)
  } catch {
    /* ignore */
  }
}
