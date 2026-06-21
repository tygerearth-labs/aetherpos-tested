'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Store, Check, ChevronDown, ChevronRight, RefreshCw, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

// ==================== TYPES ====================

export interface OutletOption {
  id: string
  name: string
  address: string | null
  phone: string | null
  isPrimary: boolean
}

interface OutletSwitcherProps {
  /** Current active outlet ID */
  activeOutletId?: string | null
  /** Available outlets */
  outlets: OutletOption[]
  /** Whether outlets are still loading */
  loading?: boolean
  /** Compact mode — used in tight spaces like POS mobile header */
  compact?: boolean
  /** Variant: 'default' for sidebar, 'pos' for POS header */
  variant?: 'default' | 'pos'
  /** Extra class names for the trigger */
  className?: string
  /** Called after a successful switch (before reload) */
  onSwitched?: (outletId: string) => void
}

// ==================== COMPONENT ====================

export function OutletSwitcher({
  activeOutletId,
  outlets,
  loading = false,
  compact = false,
  variant = 'default',
  className,
  onSwitched,
}: OutletSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)

  const activeOutlet = outlets.find((o) => o.id === activeOutletId) || outlets.find((o) => o.isPrimary)
  const hasMultiple = outlets.length > 1

  const handleSwitch = useCallback(
    async (outlet: OutletOption) => {
      if (outlet.id === activeOutletId || switching) return

      setSwitching(outlet.id)
      setOpen(false)

      try {
        const res = await fetch('/api/auth/switch-outlet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outletId: outlet.id }),
        })

        if (res.ok) {
          toast.success(`Pindah ke "${outlet.name}"`, {
            duration: 2000,
          })
          onSwitched?.(outlet.id)
          // Small delay for toast to appear before reload
          setTimeout(() => window.location.reload(), 400)
        } else {
          const data = await res.json()
          toast.error(data.error || 'Gagal pindah outlet')
        }
      } catch {
        toast.error('Gagal pindah outlet')
      } finally {
        setSwitching(null)
      }
    },
    [activeOutletId, switching, onSwitched],
  )

  // ── Loading Skeleton ──
  if (loading) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] animate-pulse',
          compact ? 'h-8 px-3' : 'h-9 px-3',
          className,
        )}
      >
        <div className="h-3.5 w-3.5 rounded bg-white/[0.06]" />
        <div className={cn('rounded bg-white/[0.06]', compact ? 'h-3 w-20' : 'h-3.5 w-28')} />
      </div>
    )
  }

  // ── Single Outlet — Static Display ──
  if (!hasMultiple && activeOutlet) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl',
          variant === 'pos'
            ? 'aether-card text-[11px] font-semibold text-slate-300 px-2.5 py-1.5'
            : 'bg-white/[0.03] border border-white/[0.06] text-[11px] font-medium text-slate-400 px-2.5 py-2',
          compact && 'py-1.5',
          className,
        )}
      >
        <Store className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="truncate">{activeOutlet.name}</span>
      </div>
    )
  }

  // ── No Outlet ──
  if (outlets.length === 0 && !loading) {
    return (
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[11px] font-medium text-slate-600 px-2.5 py-1.5',
          className,
        )}
      >
        <Store className="h-3 w-3" strokeWidth={1.5} />
        <span>No outlet</span>
      </div>
    )
  }

  // ── Multi-Outlet — Dropdown ──
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 rounded-xl transition-all duration-200 outline-none',
            'focus-visible:ring-2 focus-visible:ring-white/[0.12] focus-visible:ring-offset-0',
            variant === 'pos'
              ? cn(
                  'bg-nebula border border-white/[0.08] hover:border-white/[0.14]',
                  compact ? 'h-8 px-2.5' : 'h-9 px-3',
                )
              : cn(
                  'bg-white/[0.04] border border-white/[0.07] hover:border-white/[0.12] hover:bg-white/[0.06]',
                  'px-3 py-2',
                ),
            className,
          )}
        >
          {/* Active outlet icon */}
          <div
            className={cn(
              'shrink-0 rounded-md flex items-center justify-center transition-colors',
              variant === 'pos' ? 'bg-white/[0.06] p-1.5' : 'bg-white/[0.06] p-1',
            )}
          >
            <Store
              className={cn(
                variant === 'pos' ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5',
                switching ? 'animate-spin' : '',
              )}
              strokeWidth={1.5}
            />
          </div>

          {/* Outlet name */}
          <span
            className={cn(
              'font-medium truncate transition-colors',
              variant === 'pos'
                ? cn('text-slate-200', compact ? 'text-[11px]' : 'text-xs')
                : 'text-slate-300 text-xs',
            )}
          >
            {activeOutlet?.name || 'Pilih outlet'}
          </span>

          {/* Chevron */}
          <ChevronDown
            className={cn(
              'shrink-0 text-slate-500 transition-transform duration-200',
              open && 'rotate-180',
              variant === 'pos' ? 'h-3 w-3' : 'h-3.5 w-3.5',
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align={variant === 'pos' ? 'start' : 'center'}
        side={variant === 'pos' ? 'bottom' : 'bottom'}
        sideOffset={6}
        className={cn(
          'w-72 p-1.5 rounded-xl',
          'bg-[#0f1319] border border-white/[0.08]',
          'shadow-xl shadow-black/40',
        )}
      >
        {/* Header */}
        <div className="px-2.5 pt-2 pb-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Pilih Outlet
          </p>
        </div>

        {/* Outlet List */}
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {outlets.map((outlet) => {
            const isActive = outlet.id === activeOutletId
            const isSwitching = switching === outlet.id

            return (
              <button
                key={outlet.id}
                disabled={isActive || isSwitching}
                onClick={() => handleSwitch(outlet)}
                className={cn(
                  'w-full flex items-start gap-3 rounded-lg px-2.5 py-2.5 transition-all duration-150 text-left group',
                  isActive
                    ? 'bg-white/[0.06]'
                    : 'hover:bg-white/[0.04]',
                  (isActive || isSwitching) ? 'cursor-default' : 'cursor-pointer',
                )}
              >
                {/* Icon */}
                <div
                  className={cn(
                    'shrink-0 mt-0.5 rounded-lg flex items-center justify-center transition-colors h-8 w-8',
                    isActive ? 'bg-white/[0.08]' : 'bg-white/[0.04] group-hover:bg-white/[0.06]',
                  )}
                >
                  {isSwitching ? (
                    <RefreshCw className="h-3.5 w-3.5 text-slate-400 animate-spin" strokeWidth={1.5} />
                  ) : (
                    <Store
                      className={cn(
                        'h-3.5 w-3.5',
                        isActive ? 'text-slate-200' : 'text-slate-500 group-hover:text-slate-400',
                      )}
                      strokeWidth={1.5}
                    />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-xs font-semibold truncate transition-colors',
                        isActive ? 'text-white' : 'text-slate-300 group-hover:text-white',
                      )}
                    >
                      {outlet.name}
                    </span>
                    {isActive && (
                      <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                        <span className="h-1 w-1 rounded-full bg-emerald-400" />
                        Aktif
                      </span>
                    )}
                  </div>
                  {outlet.address && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <MapPin className="h-2.5 w-2.5 text-slate-600 shrink-0" strokeWidth={1.5} />
                      <span className="text-[10px] text-slate-500 truncate">{outlet.address}</span>
                    </div>
                  )}
                </div>

                {/* Active Checkmark */}
                {isActive && !isSwitching && (
                  <div className="shrink-0 mt-1.5">
                    <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.5} />
                  </div>
                )}

                {/* Hover Arrow for non-active */}
                {!isActive && !isSwitching && (
                  <ChevronRight className="shrink-0 mt-1.5 h-3 w-3 text-slate-700 opacity-0 group-hover:opacity-100 group-hover:text-slate-400 transition-all" strokeWidth={1.5} />
                )}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-2.5 pt-1.5 pb-1 border-t border-white/[0.04] mt-1">
          <p className="text-[9px] text-slate-600 leading-tight">
            {outlets.length} outlet tersedia
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}