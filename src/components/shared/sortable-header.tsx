'use client'

import { ReactNode } from 'react'
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TableHead } from '@/components/ui/table'

export type SortDirection = 'asc' | 'desc' | null

interface SortableTableHeadProps {
  /** Currently active sort column id (e.g. 'name', 'stock', 'lastChangedAt'). */
  activeSortBy: string
  /** Current direction, or null if this column isn't the active one. */
  activeSortOrder: 'asc' | 'desc'
  /** The column id this header represents. */
  columnId: string
  /** Click handler — receives the column id. The parent decides toggle behavior. */
  onSort: (columnId: string) => void
  /** Header label. */
  children: ReactNode
  /** Optional className passthrough. */
  className?: string
  /** Text alignment for the label. */
  align?: 'left' | 'right' | 'center'
  /** Disable sorting for this header (renders as plain TableHead). */
  sortable?: boolean
}

/**
 * SortableTableHead — accessible sortable column header.
 *
 * Behavior:
 *   - Click a different column → ascending.
 *   - Click the active column → toggle asc/desc.
 *   - Inactive column shows ChevronsUpDown.
 *   - Ascending shows ArrowUp.
 *   - Descending shows ArrowDown.
 *   - Active column header is brighter (text-slate-200 vs text-slate-500).
 *   - aria-sort is set correctly per WAI-ARIA spec.
 *   - Keyboard accessible (button element with aria-label).
 */
export function SortableTableHead({
  activeSortBy,
  activeSortOrder,
  columnId,
  onSort,
  children,
  className,
  align = 'left',
  sortable = true,
}: SortableTableHeadProps) {
  if (!sortable) {
    return (
      <TableHead
        className={cn(
          'text-[11px] text-slate-500 font-semibold uppercase tracking-wider',
          align === 'right' && 'text-right',
          align === 'center' && 'text-center',
          className,
        )}
      >
        {children}
      </TableHead>
    )
  }

  const isActive = activeSortBy === columnId
  const direction: SortDirection = isActive ? activeSortOrder : null

  // aria-sort values: 'ascending' | 'descending' | 'none'
  const ariaSort: 'ascending' | 'descending' | 'none' =
    direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'

  const justifyClass =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'

  return (
    <TableHead
      aria-sort={ariaSort}
      className={cn(
        'text-[11px] font-semibold uppercase tracking-wider p-0',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(columnId)}
        className={cn(
          'w-full h-full px-3 py-2.5 inline-flex items-center gap-1.5 select-none transition-colors',
          justifyClass,
          isActive
            ? 'text-slate-200 hover:text-white'
            : 'text-slate-500 hover:text-slate-300',
        )}
        aria-label={`Urutkan berdasarkan kolom ini. Aktif: ${ariaSort === 'none' ? 'tidak' : ariaSort}`}
      >
        <span className="truncate">{children}</span>
        {direction === 'asc' && <ArrowUp className="h-3 w-3 shrink-0 text-amber-400" />}
        {direction === 'desc' && <ArrowDown className="h-3 w-3 shrink-0 text-amber-400" />}
        {direction === null && <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />}
      </button>
    </TableHead>
  )
}

/**
 * Helper: compute the next sort state given the current active column + direction
 * and the column the user just clicked.
 *
 * - Different column → asc.
 * - Same column, currently asc → desc.
 * - Same column, currently desc → asc (toggle, never turn off — there's always an active sort).
 */
export function nextSortState(
  currentSortBy: string,
  currentSortOrder: 'asc' | 'desc',
  clickedColumnId: string,
): { sortBy: string; sortOrder: 'asc' | 'desc' } {
  if (currentSortBy !== clickedColumnId) {
    return { sortBy: clickedColumnId, sortOrder: 'asc' }
  }
  return {
    sortBy: clickedColumnId,
    sortOrder: currentSortOrder === 'asc' ? 'desc' : 'asc',
  }
}
