'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Pagination } from '@/components/shared/pagination'
import { ArrowUpDown } from 'lucide-react'

export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  render?: (item: T) => React.ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  emptyMessage?: string
  currentPage?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  onSort?: (key: string, direction: 'asc' | 'desc') => void
}

export function DataTable<T extends { id?: string }>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No data found',
  currentPage,
  totalPages,
  onPageChange,
  onSort,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: string) => {
    const newDir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc'
    setSortKey(key)
    setSortDir(newDir)
    onSort?.(key, newDir)
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <div className="bg-zinc-900 p-4 flex gap-4">
            {columns.map((col, i) => (
              <Skeleton key={i} className="h-4 w-24 bg-zinc-800" />
            ))}
          </div>
          {Array.from({ length: 5 }).map((_, rowIdx) => (
            <div key={rowIdx} className="p-4 flex gap-4 border-t border-zinc-800/50">
              {columns.map((col, i) => (
                <Skeleton key={i} className="h-4 w-24 bg-zinc-800/50" />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-zinc-400">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-zinc-800/50">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={`text-zinc-400 font-medium text-xs uppercase tracking-wider ${col.className || ''}`}
                >
                  {col.sortable ? (
                    <button
                      className="flex items-center gap-1 hover:text-zinc-100 transition-colors"
                      onClick={() => handleSort(col.key)}
                    >
                      {col.header}
                      <ArrowUpDown className={`h-3 w-3 ${sortKey === col.key ? 'text-emerald-400' : ''}`} />
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item, idx) => (
              <TableRow
                key={item.id || idx}
                className="border-zinc-800 hover:bg-zinc-800/50 transition-colors"
              >
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className || ''}>
                    {col.render
                      ? col.render(item)
                      : String((item as Record<string, unknown>)[col.key] ?? '')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      {currentPage && totalPages && onPageChange && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      )}
    </div>
  )
}
