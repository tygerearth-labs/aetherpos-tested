'use client'

import * as React from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type Tone = 'sky' | 'emerald' | 'violet' | 'amber' | 'red' | 'slate'

const TONE_CLASSES: Record<Tone, { icon: string; hover: string }> = {
  sky:      { icon: 'text-sky-400',      hover: 'hover:bg-sky-500/10'      },
  emerald:  { icon: 'text-emerald-400',  hover: 'hover:bg-emerald-500/10'  },
  violet:   { icon: 'text-violet-400',   hover: 'hover:bg-violet-500/10'   },
  amber:    { icon: 'text-amber-400',    hover: 'hover:bg-amber-500/10'    },
  red:      { icon: 'text-red-400',      hover: 'hover:bg-red-500/10'      },
  slate:    { icon: 'text-slate-400',    hover: 'hover:bg-white/[0.06]'    },
}

export interface StatusIconPopoverProps {
  /** Accessible label — REQUIRED for screen readers (aria-label). */
  ariaLabel: string
  /** Icon node. Caller picks the lucide icon + size. */
  icon: React.ReactNode
  /** Short label shown in the hover tooltip (desktop). */
  tooltip: string
  /** Richer content shown in the click/tap popover (mobile + desktop). */
  popoverContent: React.ReactNode
  /** Optional trailing label/number rendered after the icon (e.g. variant count "6"). */
  trailing?: React.ReactNode
  /** Color tone of the icon. */
  tone?: Tone
  /** Size class for the icon button. Defaults to compact. */
  className?: string
  /** Disable the click popover (tooltip-only mode). Useful when content is trivial. */
  popoverDisabled?: boolean
}

/**
 * StatusIconPopover — compact status icon that replaces text badges in dense
 * table rows. Reduces visual noise while preserving discoverability.
 *
 * Interaction model:
 *   - Desktop: hover → Tooltip (short label). Click → Popover (rich content).
 *   - Mobile: tap → Popover. (Tooltip still appears on long-press via radix.)
 *
 * Constraints:
 *   - Does NOT increase row height — renders as inline-flex, h-4 button.
 *   - Accessible: aria-label on the button, role defaults from radix.
 *   - Max 3 visible per row is enforced by the caller (this component is dumb).
 */
export function StatusIconPopover({
  ariaLabel,
  icon,
  tooltip,
  popoverContent,
  trailing,
  tone = 'slate',
  className,
  popoverDisabled = false,
}: StatusIconPopoverProps) {
  const toneClasses = TONE_CLASSES[tone]

  // When the popover is disabled (trivial content), render a tooltip-only
  // span — no button, no click target, just hover label.
  if (popoverDisabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={ariaLabel}
            className={cn(
              'inline-flex items-center gap-0.5 h-4 px-0.5 rounded cursor-default align-middle',
              toneClasses.icon,
              className,
            )}
          >
            {icon}
            {trailing}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={ariaLabel}
              className={cn(
                'inline-flex items-center gap-0.5 h-4 px-0.5 rounded align-middle transition-colors outline-none',
                'focus-visible:ring-1 focus-visible:ring-white/30',
                toneClasses.icon,
                toneClasses.hover,
                className,
              )}
            >
              {icon}
              {trailing}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="center"
        className="w-64 bg-slate-900 border-white/10 text-slate-200 text-xs p-3 shadow-xl"
      >
        {popoverContent}
      </PopoverContent>
    </Popover>
  )
}

/**
 * PopoverContentBody — small helper to render a consistent popover body:
 * a bold title + a muted description. Used by most status icons.
 */
export function PopoverContentBody({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <p className="font-semibold text-white text-[12px] leading-tight">{title}</p>
      <div className="text-[11px] text-slate-400 leading-relaxed">{children}</div>
    </div>
  )
}
