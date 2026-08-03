'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface UseRowHighlightOptions {
  /** How long the highlight stays on, in milliseconds. Default 2500ms. */
  durationMs?: number
}

interface UseRowHighlightResult<TId extends string | number> {
  /** The id of the currently-highlighted row, or null. */
  highlightedId: TId | null
  /** Highlight a row by id. Re-sets the timer if already highlighted. */
  highlight: (id: TId) => void
  /** Manually clear the highlight. */
  clear: () => void
  /** Convenience: returns the highlight className for a given row id. */
  classNameFor: (id: TId) => string
}

/**
 * useRowHighlight — temporary row highlight helper.
 *
 * Per spec point 3 (REMOVE AGGRESSIVE HIGHLIGHT) + point 6 (temporary highlight
 * only for: hasil scan, selesai create, selesai edit, selesai sync).
 *
 * Behavior:
 *   - Call `highlight(id)` to flash a row.
 *   - The highlight auto-fades after `durationMs` (default 2.5s, within the
 *     spec's "2–4 detik" range).
 *   - Calling `highlight` again on the same id resets the timer.
 *   - Calling `highlight` on a different id replaces the previous highlight.
 *
 * Visual: a very subtle emerald tint (bg-emerald-500/[0.08]) — distinct from
 * the deprecated red/amber row tints that signalled stock state.
 *
 * Usage:
 *   const rowHighlight = useRowHighlight<Product['id']>()
 *   // After a successful create/edit/scan/sync:
 *   rowHighlight.highlight(product.id)
 *   // In the row:
 *   <TableRow className={cn('...', rowHighlight.classNameFor(product.id))}>
 */
export function useRowHighlight<TId extends string | number = string>({
  durationMs = 2500,
}: UseRowHighlightOptions = {}): UseRowHighlightResult<TId> {
  const [highlightedId, setHighlightedId] = useState<TId | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setHighlightedId(null)
  }, [])

  const highlight = useCallback(
    (id: TId) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      setHighlightedId(id)
      timerRef.current = setTimeout(() => {
        setHighlightedId(null)
        timerRef.current = null
      }, durationMs)
    },
    [durationMs],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const classNameFor = useCallback(
    (id: TId) => {
      if (highlightedId !== id) return ''
      // Subtle emerald tint + smooth fade-out via transition.
      // Caller must add `transition-colors duration-500` to the row className.
      return 'bg-emerald-500/[0.10] !important'
    },
    [highlightedId],
  )

  return { highlightedId, highlight, clear, classNameFor }
}

/**
 * Build a highlight className for a row id, given the current highlightedId.
 * Pure version (no hook) — useful when the parent already manages the state.
 */
export function rowHighlightClassName<TId extends string | number>(
  id: TId,
  highlightedId: TId | null,
): string {
  if (highlightedId !== id) return ''
  return cn('bg-emerald-500/[0.10] transition-colors duration-500')
}

export default useRowHighlight
