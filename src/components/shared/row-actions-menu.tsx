'use client'

import * as React from 'react'
import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * RowActionsMenu — slim, consistent row-action pattern for tables.
 *
 * Visual contract:
 *   [ PRIMARY icon button ]  [ ⋮ kebab dropdown ]
 *
 * The PRIMARY action stays inline (e.g. "View / Detail").
 * Everything else collapses into a kebab dropdown menu.
 * Destructive actions are visually separated at the bottom of the menu
 * with danger styling.
 *
 * Used by: Products table, Inventory table.
 * Mobile + desktop supported via the `size` prop.
 */

export interface RowAction {
  /** Visible label inside the dropdown */
  label: string
  /** Leading icon node (lucide icon, ~h-3.5 w-3.5) */
  icon: React.ReactNode
  /** Click handler */
  onClick: () => void
  /** Disable the item (still rendered, greyed out, not clickable) */
  disabled?: boolean
  /** Optional tooltip/title */
  title?: string
}

export interface RowActionsMenuProps {
  /** The single always-visible primary action (usually View / Detail) */
  primaryAction: RowAction
  /** Regular dropdown items (Edit, Restock, etc.) */
  items: RowAction[]
  /** Destructive items — rendered in a separated danger section */
  dangerItems?: RowAction[]
  /** Button height: 'sm' = h-7 (desktop table rows), 'md' = h-9 (mobile cards) */
  size?: 'sm' | 'md'
  /** Dropdown alignment relative to trigger */
  align?: 'start' | 'center' | 'end'
  /** Optional className for the wrapping flex container */
  className?: string
}

export function RowActionsMenu({
  primaryAction,
  items,
  dangerItems = [],
  size = 'sm',
  align = 'end',
  className,
}: RowActionsMenuProps) {
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  const iconCls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  return (
    <div
      className={cn(
        'flex items-center justify-end gap-0.5',
        className,
      )}
    >
      {/* Primary visible action — typically View / Detail */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          dim,
          'p-0 text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 rounded-lg transition-colors',
        )}
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
        title={primaryAction.title || primaryAction.label}
        aria-label={primaryAction.label}
      >
        {primaryAction.icon}
      </Button>

      {/* Kebab dropdown for everything else */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              dim,
              'p-0 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors',
              'data-[state=open]:bg-white/[0.06] data-[state=open]:text-white',
            )}
            aria-label="Aksi lainnya"
          >
            <MoreVertical className={iconCls} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          className="w-[200px] rounded-xl border-white/[0.08] bg-nebula p-1 shadow-2xl shadow-black/60"
        >
          {items.map((item, idx) => (
            <DropdownMenuItem
              key={`${item.label}-${idx}`}
              onClick={() => {
                if (!item.disabled) item.onClick()
              }}
              disabled={item.disabled}
              title={item.title}
              className="flex items-center gap-2.5 px-2.5 py-2 text-xs text-slate-300 hover:bg-white/[0.04] hover:text-white rounded-lg cursor-pointer focus:bg-white/[0.04] focus:text-white"
            >
              <span className="text-slate-400 [&>svg]:h-3.5 [&>svg]:w-3.5">
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </DropdownMenuItem>
          ))}

          {dangerItems.length > 0 && (
            <>
              {items.length > 0 && (
                <DropdownMenuSeparator className="bg-white/[0.06] my-1" />
              )}
              {dangerItems.map((item, idx) => (
                <DropdownMenuItem
                  key={`danger-${item.label}-${idx}`}
                  onClick={() => {
                    if (!item.disabled) item.onClick()
                  }}
                  disabled={item.disabled}
                  title={item.title}
                  className="flex items-center gap-2.5 px-2.5 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-lg cursor-pointer focus:bg-red-500/10 focus:text-red-300"
                >
                  <span className="text-red-400 [&>svg]:h-3.5 [&>svg]:w-3.5">
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default RowActionsMenu
