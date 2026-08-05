'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * A single column definition for a result list.
 */
export interface MobileResultColumn {
  /** The data key to read from each row object. */
  key: string
  /** Human-readable column header / card label. */
  label: string
  /** Whether this column is the "primary" field — shown prominently on the card. */
  primary?: boolean
  /** Whether to hide this column on the mobile card (table only). */
  hideOnMobile?: boolean
  /** Optional className for cell content. */
  className?: string
}

export interface MobileResultListProps {
  /** Column definitions. */
  columns: MobileResultColumn[]
  /** Row data — each row is a Record<string, string | number | undefined>. */
  rows: Array<Record<string, string | number | undefined>>
  /** Optional tone badge per row — maps to a tone. */
  rowTone?: 'success' | 'warning' | 'danger' | 'info' | 'default'
  /** Whether the list is collapsed by default (shows first 5). */
  defaultCollapsed?: boolean
  /** Label for the expand toggle, e.g. "Tampilkan semua (50)". */
  collapseLabel?: (total: number) => string
  /** Empty state message. */
  emptyMessage?: string
  /** Whether to render the desktop table (default true on md+). */
  showTable?: boolean
  /** Maximum card height before internal scroll (for long snapshots). */
  maxDetailHeight?: number
}

/**
 * MobileResultList — renders audit/import result rows as stacked cards on
 * mobile and as a table on desktop.
 *
 * - On mobile (`< md`): each row becomes a compact card with a row-number
 *   badge, a primary field (entity/name), and secondary fields as a
 *   key/value grid. Long detail fields are collapsible.
 * - On desktop (`md+`): renders a standard shadcn `<Table>` with all columns.
 *
 * This preserves the desktop table behavior while giving mobile a readable,
 * non-horizontal-scrolling layout.
 */
export function MobileResultList({
  columns,
  rows,
  defaultCollapsed = true,
  collapseLabel = (total) => `Tampilkan semua (${total})`,
  emptyMessage = 'Tidak ada data',
  showTable = true,
  maxDetailHeight = 120,
}: MobileResultListProps) {
  const [expanded, setExpanded] = React.useState(!defaultCollapsed)
  const [expandedRows, setExpandedRows] = React.useState<Set<number>>(new Set())

  const shouldCollapse = rows.length > 5
  const visibleRows = shouldCollapse && !expanded ? rows.slice(0, 5) : rows

  const toggleRowExpand = React.useCallback((index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const getCellValue = (
    row: Record<string, string | number | undefined>,
    key: string,
  ): string => {
    const v = row[key]
    if (v === undefined || v === null) return ''
    return String(v)
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-4 text-center">
        <p className="text-xs text-slate-500 italic">{emptyMessage}</p>
      </div>
    )
  }

  const primaryCol = columns.find((c) => c.primary)
  const secondaryCols = columns.filter((c) => !c.primary && !c.hideOnMobile)
  const detailCols = secondaryCols.filter(
    (c) => getCellValue({}, c.key).length > 0 || true,
  )

  return (
    <>
      {/* ── Mobile: stacked cards ── */}
      <div className="md:hidden space-y-2">
        {visibleRows.map((row, i) => {
          const primaryValue = primaryCol ? getCellValue(row, primaryCol.key) : ''
          // For the "row" column, show it as a badge
          const rowNum = getCellValue(row, 'row')
          const isExpanded = expandedRows.has(i)
          const hasLongDetail = secondaryCols.some((c) => {
            const v = getCellValue(row, c.key)
            return v.length > 80
          })

          return (
            <div
              key={i}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden"
            >
              <div className="p-3 space-y-2">
                {/* Row number + primary field */}
                <div className="flex items-start gap-2">
                  {rowNum && (
                    <Badge
                      variant="outline"
                      className="shrink-0 bg-white/[0.04] border-white/[0.08] text-slate-400 text-[9px] font-mono px-1.5 py-0 h-5"
                    >
                      #{rowNum}
                    </Badge>
                  )}
                  <div className="flex-1 min-w-0">
                    {primaryCol && primaryValue && (
                      <p className="text-sm font-semibold text-white break-words leading-tight">
                        {primaryValue}
                      </p>
                    )}
                    {/* Secondary fields as compact metadata */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                      {secondaryCols.slice(0, 3).map((col) => {
                        const v = getCellValue(row, col.key)
                        if (!v) return null
                        return (
                          <span
                            key={col.key}
                            className="text-[11px] text-slate-500 break-words"
                          >
                            <span className="text-slate-600">{col.label}:</span>{' '}
                            <span className="text-slate-400">{v}</span>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Long detail fields — collapsible */}
                {hasLongDetail && (
                  <>
                    <div
                      className={cn(
                        'space-y-1 overflow-hidden transition-all',
                        isExpanded ? 'max-h-[500px]' : `max-h-[${maxDetailHeight}px]`,
                      )}
                      style={{ maxHeight: isExpanded ? '500px' : `${maxDetailHeight}px` }}
                    >
                      {secondaryCols.slice(3).map((col) => {
                        const v = getCellValue(row, col.key)
                        if (!v) return null
                        return (
                          <div key={col.key} className="text-[11px]">
                            <span className="text-slate-600 font-medium">{col.label}: </span>
                            <span className="text-slate-400 break-words whitespace-pre-wrap">
                              {v}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleRowExpand(i)}
                      className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-3 w-3" /> Sembunyikan
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3 w-3" /> Selengkapnya
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}

        {/* Collapse toggle */}
        {shouldCollapse && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="w-full text-center text-[11px] text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline py-2"
          >
            {expanded ? 'Sembunyikan' : collapseLabel(rows.length)}
          </button>
        )}
      </div>

      {/* ── Desktop: table ── */}
      {showTable && (
        <div className="hidden md:block rounded-lg border border-white/[0.06] overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.06] hover:bg-transparent">
                {columns.map((c) => (
                  <TableHead
                    key={c.key}
                    className="text-[10px] text-slate-500 font-medium px-2 py-1.5 whitespace-nowrap"
                  >
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row, i) => (
                <TableRow key={i} className="border-white/[0.04]">
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        'text-[11px] text-slate-300 px-2 py-1.5 align-top break-words whitespace-normal',
                        c.className,
                      )}
                    >
                      {getCellValue(row, c.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
