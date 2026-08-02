'use client'

import { Sparkles, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SameDayBadgeProps {
  /** 'new' = created today, 'updated' = changed today but not created today. */
  variant: 'new' | 'updated'
  className?: string
}

/**
 * SameDayBadge — small inline badge shown next to the item name when the
 * row was created OR last changed today (outlet timezone).
 *
 * Visual per spec point E:
 *   - "Baru Hari Ini"  → amber tint, Sparkles icon
 *   - "Diperbarui Hari Ini" → emerald tint, RefreshCw icon
 *   - Compact, no full background.
 */
export function SameDayBadge({ variant, className }: SameDayBadgeProps) {
  const isNew = variant === 'new'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-semibold tracking-wide uppercase whitespace-nowrap shrink-0',
        isNew
          ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25'
          : 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25',
        className,
      )}
      title={isNew ? 'Dibuat hari ini' : 'Diperbarui hari ini'}
    >
      {isNew ? <Sparkles className="h-2.5 w-2.5" /> : <RefreshCw className="h-2.5 w-2.5" />}
      {isNew ? 'Baru' : 'Update'}
    </span>
  )
}

/**
 * Row tint classes for same-day highlight.
 *
 * Per spec point E:
 *   - row tint sangat tipis
 *   - left accent 2px
 *   - jangan gunakan background terang penuh
 *
 * Usage:
 *   <TableRow className={cn(rowTintClass, ...)}>
 *     <div className={accentClass} /> {/* left accent *​/}
 *     ...
 *   </TableRow>
 */
export const SAME_DAY_ROW_TINT = 'bg-amber-500/[0.04] hover:bg-amber-500/[0.07]'
export const SAME_DAY_LEFT_ACCENT = 'absolute left-0 top-0 bottom-0 w-[2px] bg-amber-500/60 rounded-r'
