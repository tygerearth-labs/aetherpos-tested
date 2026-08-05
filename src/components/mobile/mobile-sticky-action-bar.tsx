'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { MoreHorizontal, X } from 'lucide-react'

/**
 * A primary action shown directly on the MobileStickyActionBar.
 * Maximum two of these should be passed — additional actions go into the
 * "Lainnya" (More) overflow sheet.
 */
export interface MobileStickyAction {
  /** Stable key. */
  key: string
  /** Visible label (keep short, e.g. "Hapus", "Ubah Harga"). */
  label: string
  /** Optional leading icon. */
  icon?: React.ReactNode
  /** Click handler. */
  onClick: () => void
  /** Visual variant. */
  variant?: 'primary' | 'danger' | 'warning' | 'ghost'
  /** Disable the action. */
  disabled?: boolean
}

/**
 * A secondary action shown inside the "Lainnya" overflow sheet.
 */
export interface MobileOverflowAction {
  key: string
  label: string
  icon?: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger' | 'warning'
  disabled?: boolean
}

export interface MobileStickyActionBarProps {
  /** Primary count shown on the left, e.g. "20 dipilih". */
  selectedCount: number
  /** Unit label, default "dipilih". */
  countLabel?: string
  /** Optional secondary line under the count, e.g. "20 di halaman ini · 32 total". */
  secondaryText?: string
  /** Primary actions (max 2 recommended). */
  actions: MobileStickyAction[]
  /** Overflow actions rendered in the "Lainnya" sheet. */
  overflowActions?: MobileOverflowAction[]
  /** Cancel handler — if provided, shows a compact "Batal" text button. */
  onCancel?: () => void
  /** Optional "Pilih Semua" handler shown on the right of the count. */
  onSelectAll?: () => void
  /** Label for the select-all action. */
  selectAllLabel?: string
  /** Extra className on the outer bar. */
  className?: string
}

const variantClasses: Record<NonNullable<MobileStickyAction['variant']>, string> = {
  primary: 'theme-bg theme-hover text-white border-transparent',
  danger: 'bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25',
  warning: 'bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25',
  ghost: 'bg-white/[0.06] border border-white/[0.08] text-slate-200 hover:bg-white/[0.1]',
}

const overflowVariantClasses: Record<NonNullable<MobileOverflowAction['variant']>, string> = {
  default: 'text-slate-200 hover:bg-white/[0.06]',
  danger: 'text-red-400 hover:bg-red-500/10',
  warning: 'text-amber-400 hover:bg-amber-500/10',
}

/**
 * MobileStickyActionBar — a safe-area aware fixed bottom action bar for
 * mobile selection / bulk-action flows.
 *
 * Features:
 *  - Fixed to the bottom with `env(safe-area-inset-bottom)` padding so it
 *    never collides with the iOS home indicator.
 *  - On desktop (md+) the bar is hidden — desktop layouts use their own
 *    inline toolbars.
 *  - Renders a compact count + max 2 primary actions + a "Lainnya" overflow
 *    button that opens a bottom Sheet with additional actions.
 *  - Has a max-height of ~64–72px (content area) so it never gets too tall.
 *
 * When `selectionOverlayActive` is true, the app-shell hides the regular
 * MobileBottomNav so the two never overlap. This component itself does NOT
 * manage that flag — the caller is responsible for calling
 * `useMobileUiStore.setSelectionOverlay(true, height)` (usually via a
 * useEffect tied to the bar's visibility).
 */
export function MobileStickyActionBar({
  selectedCount,
  countLabel = 'dipilih',
  secondaryText,
  actions,
  overflowActions = [],
  onCancel,
  onSelectAll,
  selectAllLabel = 'Pilih Semua',
  className,
}: MobileStickyActionBarProps) {
  const [overflowOpen, setOverflowOpen] = React.useState(false)
  const primaryActions = actions.slice(0, 2)
  const hasOverflow = overflowActions.length > 0

  return (
    <>
      <div
        className={cn(
          'md:hidden fixed bottom-0 left-0 right-0 z-40',
          'bg-nebula/95 backdrop-blur-xl border-t border-white/[0.08]',
          'pb-[env(safe-area-inset-bottom)]',
          className,
        )}
        role="toolbar"
        aria-label="Aksi seleksi massal"
      >
        {/* Count + select-all / cancel row (compact, ~32px) */}
        <div className="flex items-center justify-between gap-2 px-3 pt-2 min-h-[28px]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full theme-bg shrink-0" />
            <span className="text-xs font-semibold text-white tabular-nums shrink-0">
              {selectedCount}{' '}
              <span className="font-normal text-slate-400">{countLabel}</span>
            </span>
            {secondaryText && (
              <span className="text-[10px] text-slate-500 truncate hidden min-[400px]:inline">
                {secondaryText}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onSelectAll && (
              <button
                type="button"
                onClick={onSelectAll}
                className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1 rounded-md hover:bg-white/[0.06] transition-colors min-h-[36px] flex items-center"
              >
                {selectAllLabel}
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="text-[11px] text-slate-400 hover:text-red-400 px-2 py-1 rounded-md hover:bg-red-500/10 transition-colors min-h-[36px] flex items-center gap-1"
              >
                <X className="h-3 w-3" />
                Batal
              </button>
            )}
          </div>
        </div>

        {/* Primary actions row (max 2 + overflow) — ~44px touch targets */}
        <div className="flex items-center gap-2 px-3 pb-2 pt-1">
          {primaryActions.map((action) => (
            <Button
              key={action.key}
              size="sm"
              onClick={action.onClick}
              disabled={action.disabled}
              className={cn(
                'flex-1 h-11 text-xs font-medium rounded-xl gap-1.5',
                variantClasses[action.variant ?? 'primary'],
              )}
            >
              {action.icon}
              <span className="truncate">{action.label}</span>
            </Button>
          ))}
          {hasOverflow && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOverflowOpen(true)}
              className="h-11 px-3 text-xs font-medium rounded-xl bg-white/[0.06] border border-white/[0.08] text-slate-200 hover:bg-white/[0.1] gap-1.5 shrink-0"
              aria-label="Lainnya"
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="hidden min-[400px]:inline">Lainnya</span>
            </Button>
          )}
        </div>
      </div>

      {/* Overflow sheet */}
      <Sheet open={overflowOpen} onOpenChange={setOverflowOpen}>
        <SheetContent
          side="bottom"
          className="md:hidden bg-nebula border-white/[0.08] rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
          showCloseButton={false}
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="text-sm text-white">Aksi Lainnya</SheetTitle>
            <SheetDescription className="text-xs text-slate-500">
              {selectedCount} {countLabel}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-2 space-y-1 max-h-[60vh] overflow-y-auto overscroll-contain">
            {overflowActions.map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={() => {
                  setOverflowOpen(false)
                  action.onClick()
                }}
                disabled={action.disabled}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors min-h-[48px] disabled:opacity-40 disabled:pointer-events-none',
                  overflowVariantClasses[action.variant ?? 'default'],
                )}
              >
                {action.icon && <span className="shrink-0">{action.icon}</span>}
                <span className="flex-1 text-left truncate">{action.label}</span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
