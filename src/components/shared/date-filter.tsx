'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarDays, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ==================== HELPERS ====================

function getTodayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

function getRangeLabel(from: string, to: string): string | null {
  if (!from || !to) return null
  const today = getTodayLocal()
  const sevenAgo = shiftDate(-7)
  const thirtyAgo = shiftDate(-30)
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`

  if (from === today && to === today) return 'Hari Ini'
  if (from === sevenAgo && to === today) return '7 Hari'
  if (from === thirtyAgo && to === today) return '30 Hari'
  if (from === monthStart && to === today) return 'Bulan Ini'
  return null
}

// ==================== TYPES ====================

interface DateFilterProps {
  dateFrom: string
  dateTo: string
  onChange: (from: string, to: string) => void
  /** Additional CSS class for the outer wrapper */
  className?: string
}

// ==================== QUICK RANGES ====================

const QUICK_RANGES = [
  { label: 'Hari Ini', getRange: () => { const t = getTodayLocal(); return [t, t] } },
  { label: '7 Hari', getRange: () => [shiftDate(-6), getTodayLocal()] },
  { label: '30 Hari', getRange: () => [shiftDate(-29), getTodayLocal()] },
  { label: 'Bulan Ini', getRange: () => [`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`, getTodayLocal()] },
] as const

// ==================== COMPONENT ====================

export function DateFilter({ dateFrom, dateTo, onChange, className }: DateFilterProps) {
  const [open, setOpen] = useState(false)

  const rangeLabel = useMemo(() => getRangeLabel(dateFrom, dateTo), [dateFrom, dateTo])
  const hasFilter = !!(dateFrom || dateTo)

  // Display text in the trigger button
  const triggerText = useMemo(() => {
    if (!dateFrom && !dateTo) return 'Semua Tanggal'
    if (rangeLabel) return rangeLabel
    if (dateFrom === dateTo) return formatShortDate(dateFrom)
    return `${formatShortDate(dateFrom)} – ${formatShortDate(dateTo)}`
  }, [dateFrom, dateTo, rangeLabel])

  const handleQuickRange = (getRange: () => [string, string]) => {
    const [from, to] = getRange()
    onChange(from, to)
    setOpen(false)
  }

  const handleClear = () => {
    onChange('', '')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-medium transition-all shrink-0',
            hasFilter
              ? 'theme-bg-very-light theme-border-light border theme-text hover:theme-hover-light'
              : 'bg-white/[0.04] border border-zinc-700 text-slate-400 hover:text-slate-200 hover:bg-zinc-700 border',
            className
          )}
        >
          <CalendarDays className="h-3 w-3" />
          <span className="max-w-[130px] truncate">{triggerText}</span>
          {hasFilter && (
            <X
              className="h-2.5 w-2.5 text-slate-500 hover:text-slate-300 ml-0.5 shrink-0"
              onClick={(e) => { e.stopPropagation(); handleClear() }}
            />
          )}
          <ChevronDown className="h-2.5 w-2.5 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-auto p-3 bg-nebula border border-white/[0.06] rounded-xl shadow-xl"
      >
        {/* Quick range buttons */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {QUICK_RANGES.map(({ label, getRange }) => {
            const isActive = rangeLabel === label
            return (
              <button
                key={label}
                type="button"
                onClick={() => handleQuickRange(getRange)}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border',
                  isActive
                    ? 'theme-bg-very-light theme-border-light theme-text border'
                    : 'bg-white/[0.04] border-zinc-700 text-slate-400 hover:text-slate-200 hover:bg-zinc-700'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Custom date range */}
        <div className="border-t border-white/[0.06] pt-3">
          <p className="text-[10px] text-slate-500 font-medium mb-2 uppercase tracking-wider">Custom Range</p>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-slate-500 mb-0.5 block">Dari</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => onChange(e.target.value, dateTo)}
                className="w-full h-8 text-[11px] bg-white/[0.04] border border-zinc-700 rounded-lg text-slate-200 px-2 [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>
            <div className="pt-4">
              <span className="text-zinc-600 text-[10px]">–</span>
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-slate-500 mb-0.5 block">Sampai</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => onChange(dateFrom, e.target.value)}
                className="w-full h-8 text-[11px] bg-white/[0.04] border border-zinc-700 rounded-lg text-slate-200 px-2 [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>
          </div>
        </div>

        {/* Clear button */}
        {hasFilter && (
          <div className="border-t border-white/[0.06] mt-3 pt-2">
            <button
              type="button"
              onClick={handleClear}
              className="w-full text-[11px] text-slate-500 hover:text-slate-300 py-1.5 rounded-lg hover:bg-white/[0.04] transition-all"
            >
              Reset filter tanggal
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
