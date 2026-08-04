/**
 * perf-timer.ts — Checkout performance instrumentation
 *
 * Phase 1 (MEASURE ONLY) utility. Wraps each checkout phase with a high-resolution
 * timer and counts Prisma queries issued inside each phase.
 *
 * Usage:
 *   const perf = createCheckoutPerf()
 *   perf.start('auth')
 *   ... auth work ...
 *   perf.end('auth')
 *
 *   perf.start('productLoad')
 *   const products = await trackedQuery(perf, () => tx.product.findMany(...))
 *   perf.end('productLoad')
 *
 *   const report = perf.report()  // { phases: {...}, totalMs, queryCount }
 *
 * The report is returned in the checkout JSON response as `_perf` (only when
 * CHECKOUT_PERF=1 env is set, so production is unaffected).
 */

export interface PerfPhase {
  name: string
  start: number
  end?: number
  queries: number
}

export interface PerfReport {
  phases: Record<string, { ms: number; queries: number }>
  totalMs: number
  queryCount: number
  startTime: string
}

export interface CheckoutPerf {
  start: (name: string) => void
  end: (name: string) => void
  trackQuery: () => void
  setQueryCount: (n: number) => void
  report: () => PerfReport
  raw: () => Map<string, PerfPhase>
}

export function createCheckoutPerf(): CheckoutPerf {
  const phases = new Map<string, PerfPhase>()
  const order: string[] = []
  const startMs = Date.now()

  return {
    start(name: string) {
      phases.set(name, { name, start: performance.now(), queries: 0 })
      order.push(name)
    },
    end(name: string) {
      const p = phases.get(name)
      if (p && !p.end) {
        p.end = performance.now()
      }
    },
    trackQuery() {
      // Increment the most recently started phase that hasn't ended
      for (let i = order.length - 1; i >= 0; i--) {
        const p = phases.get(order[i])
        if (p && !p.end) {
          p.queries++
          return
        }
      }
    },
    setQueryCount(n: number) {
      // Set absolute count for current phase (for raw SQL we can't intercept)
      for (let i = order.length - 1; i >= 0; i--) {
        const p = phases.get(order[i])
        if (p && !p.end) {
          p.queries = n
          return
        }
      }
    },
    report() {
      const result: PerfReport = {
        phases: {},
        totalMs: Date.now() - startMs,
        queryCount: 0,
        startTime: new Date(startMs).toISOString(),
      }
      for (const name of order) {
        const p = phases.get(name)!
        const ms = p.end ? Math.round(p.end - p.start) : -1
        result.phases[name] = { ms, queries: p.queries }
        result.queryCount += p.queries
      }
      return result
    },
    raw() {
      return phases
    },
  }
}

/**
 * Wrap a Prisma query call to automatically count it in the current perf phase.
 * Usage: const products = await trackedQuery(perf, () => tx.product.findMany(...))
 */
export async function trackedQuery<T>(
  perf: CheckoutPerf,
  fn: () => Promise<T>
): Promise<T> {
  perf.trackQuery()
  return fn()
}

/**
 * Check if perf instrumentation is enabled.
 * Set CHECKOUT_PERF=1 in env to enable.
 */
export function isPerfEnabled(): boolean {
  return process.env.CHECKOUT_PERF === '1'
}
