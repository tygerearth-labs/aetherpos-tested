/**
 * build-guard — barrel export for the whole-app build version guard system.
 *
 * Public API:
 *   - Critical Activity Registry: register/unregister activities, query state
 *   - Build Version Store: client/server buildId, update lifecycle
 *   - Controlled reload guards (sessionStorage-backed, loop-safe)
 */

export * from './critical-activity-registry'
export * from './build-version-store'
