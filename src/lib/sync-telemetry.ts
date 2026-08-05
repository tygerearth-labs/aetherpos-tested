/**
 * sync-telemetry.ts — POS outbox sync instrumentation for the idle-auto-sync
 * contract.
 *
 * The POS sync engine has exactly three legitimate triggers:
 *   - idle15m   — 15 continuous minutes of user inactivity
 *   - reconnect — navigator 'online' event (or page mount) with pending outbox
 *   - manual    — cashier clicked the Sync button (or a cross-tab relay)
 *
 * Every sync run logs a SyncTelemetryEvent with the fields required by the
 * contract so we can verify (in dev / Agent Browser) that:
 *   - the periodic 60s interval and the window-focus trigger are GONE
 *   - the idle timer only fires after 15 min of true inactivity
 *   - reconnect only fires when the outbox is non-empty
 *   - the single-flight lock prevents duplicate concurrent syncs
 *   - failed items remain pending and retry on the next idle window
 *
 * Usage (inside use-pos-sync.runSync):
 *   const t0 = performance.now()
 *   const result = await syncOutboxTracked()
 *   logSyncTelemetry({
 *     trigger: 'idle15m',
 *     lastActivityAt: lastActivityAtRef.current,
 *     idleDuration: Date.now() - lastActivityAtRef.current,
 *     pendingCount,
 *     syncedCount: result.synced,
 *     failedCount: result.failed,
 *     duration: Math.round(performance.now() - t0),
 *   })
 */

export type SyncTrigger = 'idle15m' | 'reconnect' | 'manual'

export interface SyncTelemetryEvent {
  /** What initiated this sync run. */
  trigger: SyncTrigger
  /** Epoch ms of the last user activity (pointerdown/touchstart/click/
   *  keydown/scroll). Null only if activity tracking never started. */
  lastActivityAt: number | null
  /** Milliseconds between lastActivityAt and the sync start. Only meaningful
   *  for the idle15m trigger; null for reconnect/manual. */
  idleDuration: number | null
  /** Outbox rows (PENDING + retryable FAILED) counted just before the run. */
  pendingCount: number
  /** Rows successfully synced (including DEX-007 duplicate resolutions). */
  syncedCount: number
  /** Rows that failed this run (network / server error / stock mismatch). */
  failedCount: number
  /** Wall-clock duration of the sync run in milliseconds. */
  duration: number
  /** Epoch ms when the sync run started. */
  timestamp: number
}

const MAX_LOG_ENTRIES = 50

/**
 * Log a sync telemetry event to the console and expose it on window for
 * debugging / Agent Browser inspection. Safe to call from the client only —
 * guards on `typeof window`.
 */
export function logSyncTelemetry(event: SyncTelemetryEvent): void {
  // Console: one concise line per sync run.
  const idleStr =
    event.idleDuration !== null
      ? `idleMs=${Math.round(event.idleDuration)}, `
      : ''
  console.log(
    `[sync:telemetry] trigger=${event.trigger}, ${idleStr}` +
      `pending=${event.pendingCount}, synced=${event.syncedCount}, ` +
      `failed=${event.failedCount}, duration=${event.duration}ms, ` +
      `lastActivityAt=${event.lastActivityAt ?? 'null'}`,
  )

  if (typeof window === 'undefined') return
  const w = window as unknown as {
    __lastSyncTelemetry?: SyncTelemetryEvent
    __syncTelemetryLog?: SyncTelemetryEvent[]
  }
  w.__lastSyncTelemetry = event
  if (!w.__syncTelemetryLog) w.__syncTelemetryLog = []
  w.__syncTelemetryLog.push(event)
  // Trim to avoid unbounded growth during a long POS session.
  if (w.__syncTelemetryLog.length > MAX_LOG_ENTRIES) {
    w.__syncTelemetryLog.splice(0, w.__syncTelemetryLog.length - MAX_LOG_ENTRIES)
  }
}

/**
 * Read the most recent sync telemetry event (or null). Intended for
 * debugging / automated verification only.
 */
export function getLastSyncTelemetry(): SyncTelemetryEvent | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { __lastSyncTelemetry?: SyncTelemetryEvent }
  return w.__lastSyncTelemetry ?? null
}
