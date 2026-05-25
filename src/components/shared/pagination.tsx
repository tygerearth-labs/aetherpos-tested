'use client'

import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = []
    
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (currentPage > 3) pages.push('ellipsis')
      
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)
      
      for (let i = start; i <= end; i++) pages.push(i)
      
      if (currentPage < totalPages - 2) pages.push('ellipsis')
      pages.push(totalPages)
    }
    
    return pages
  }

  return (
    <div className="flex items-center justify-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      
      {getPageNumbers().map((page, idx) => {
        if (page === 'ellipsis') {
          return (
            <span key={`ellipsis-${idx}`} className="px-2 text-zinc-500">
              ...
            </span>
          )
        }
        return (
          <Button
            key={page}
            variant={page === currentPage ? 'default' : 'ghost'}
            size="icon"
            className={
              page === currentPage
                ? 'h-8 w-8 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-400'
                : 'h-8 w-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }
            onClick={() => onPageChange(page)}
          >
            {page}
          </Button>
        )
      })}
      
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
