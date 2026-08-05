'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Check } from 'lucide-react'

/**
 * A single selectable option inside a MobileFilterSheet section.
 */
export interface MobileFilterOption {
  value: string
  label: string
  /** Optional trailing meta, e.g. a count. */
  meta?: string
}

/**
 * A labelled group of options inside the filter sheet.
 */
export interface MobileFilterSection {
  key: string
  title: string
  /** Optional helper subtitle. */
  subtitle?: string
  options: MobileFilterOption[]
  /** Currently selected value(s). */
  selected: string | string[]
  /** Selection handler — receives the value. For multi-select pass an array. */
  onSelect: (value: string) => void
  /** Whether multiple values can be selected. */
  multi?: boolean
}

export interface MobileFilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Title shown at the top of the sheet. */
  title?: string
  /** Optional description / subtitle. */
  description?: string
  /** Sections to render. */
  sections: MobileFilterSection[]
  /** Optional extra actions rendered at the bottom (e.g. "Kelola Kategori"). */
  footerActions?: Array<{
    key: string
    label: string
    icon?: React.ReactNode
    onClick: () => void
    variant?: 'default' | 'danger'
  }>
  /** Reset handler — if provided, shows a "Reset" button. */
  onReset?: () => void
}

/**
 * MobileFilterSheet — a reusable bottom sheet for consolidating secondary
 * filters / actions (Filter, Kategori, Urutkan, Aksi) on mobile.
 *
 * - Renders as a bottom-anchored Sheet (`side="bottom"`) on mobile only.
 * - Each section is a labelled list of selectable options with check marks.
 * - Supports single-select and multi-select sections.
 * - Has a sticky footer with optional "Reset" + footer actions.
 * - Safe-area aware (`pb-[max(1rem,env(safe-area-inset-bottom))]`).
 * - Single scroll container (`max-h-[70vh] overflow-y-auto overscroll-contain`).
 *
 * Desktop layouts should continue using inline Select / DropdownMenu — this
 * component is mobile-only (`md:hidden` via the Sheet being triggered only
 * on mobile).
 */
export function MobileFilterSheet({
  open,
  onOpenChange,
  title = 'Filter',
  description,
  sections,
  footerActions = [],
  onReset,
}: MobileFilterSheetProps) {
  const isSelected = (section: MobileFilterSection, value: string): boolean => {
    if (section.multi) return Array.isArray(section.selected) && section.selected.includes(value)
    return section.selected === value
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="md:hidden bg-nebula border-white/[0.08] rounded-t-2xl flex flex-col max-h-[85vh]"
        showCloseButton={false}
      >
        <SheetHeader className="pb-2 shrink-0">
          <SheetTitle className="text-sm text-white">{title}</SheetTitle>
          {description && (
            <SheetDescription className="text-xs text-slate-500">{description}</SheetDescription>
          )}
        </SheetHeader>

        {/* Single scroll container */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-2 min-h-0">
          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section.key} className="space-y-1.5">
                <div className="px-1">
                  <p className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">
                    {section.title}
                  </p>
                  {section.subtitle && (
                    <p className="text-[10px] text-slate-600 mt-0.5">{section.subtitle}</p>
                  )}
                </div>
                <div className="space-y-0.5">
                  {section.options.map((option) => {
                    const selected = isSelected(section, option.value)
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => section.onSelect(option.value)}
                        className={cn(
                          'w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors min-h-[44px] text-left',
                          selected
                            ? 'bg-emerald-500/10 text-white'
                            : 'text-slate-300 hover:bg-white/[0.04]',
                        )}
                      >
                        <span className="flex-1 truncate">{option.label}</span>
                        {option.meta && (
                          <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                            {option.meta}
                          </span>
                        )}
                        {selected && (
                          <Check className="h-4 w-4 text-emerald-400 shrink-0" strokeWidth={3} />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky footer */}
        {(onReset || footerActions.length > 0) && (
          <div className="shrink-0 border-t border-white/[0.06] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
            {footerActions.map((action) => (
              <Button
                key={action.key}
                variant="ghost"
                onClick={() => {
                  onOpenChange(false)
                  action.onClick()
                }}
                className={cn(
                  'w-full h-11 justify-start text-sm font-medium rounded-xl gap-2.5',
                  action.variant === 'danger'
                    ? 'text-red-400 hover:bg-red-500/10'
                    : 'text-slate-300 hover:bg-white/[0.06]',
                )}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
            {onReset && (
              <Button
                variant="outline"
                onClick={onReset}
                className="w-full h-11 text-sm font-medium rounded-xl border-white/[0.08] bg-white/[0.04] text-slate-300 hover:bg-white/[0.06]"
              >
                Reset Filter
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
