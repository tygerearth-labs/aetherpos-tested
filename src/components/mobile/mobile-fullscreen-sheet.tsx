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
import { ArrowLeft, X } from 'lucide-react'

export interface MobileFullScreenSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Title shown in the sticky header. */
  title: React.ReactNode
  /** Optional subtitle / metadata below the title. */
  subtitle?: React.ReactNode
  /** Optional badge(s) shown next to the title (e.g. status badge). */
  badges?: React.ReactNode
  /** Main content — rendered in the single scroll container. */
  children: React.ReactNode
  /** Optional sticky footer (e.g. export button). */
  footer?: React.ReactNode
  /** Extra className on the Sheet content. */
  className?: string
}

/**
 * MobileFullScreenSheet — a mobile-only full-screen overlay for detailed
 * content (e.g. Audit Log migration detail).
 *
 * - Renders as a bottom-anchored Sheet on mobile (`< md`) with `h-[100dvh]`.
 * - On desktop (`md+`) it is NOT rendered — the caller should render a
 *   Dialog/Sheet for desktop separately.
 * - Sticky header with title, badges, subtitle, and a close/back button.
 * - Single main scroll container (`flex-1 overflow-y-auto overscroll-contain`).
 * - Safe-area top + bottom padding.
 * - Optional sticky footer.
 *
 * Usage pattern:
 * ```tsx
 * <MobileFullScreenSheet open={open} onOpenChange={setOpen} title="…">
 *   …content…
 * </MobileFullScreenSheet>
 *
 * {/* Desktop dialog separately *\/}
 * <Dialog open={open && !isMobile} onOpenChange={setOpen}>…</Dialog>
 * ```
 */
export function MobileFullScreenSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  badges,
  children,
  footer,
  className,
}: MobileFullScreenSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          'md:hidden bg-nebula border-white/[0.08] rounded-t-2xl',
          'flex flex-col h-[100dvh] max-h-[100dvh] p-0 gap-0',
          className,
        )}
        showCloseButton={false}
      >
        {/* Sticky header */}
        <div
          className="shrink-0 sticky top-0 z-10 bg-nebula/95 backdrop-blur-xl border-b border-white/[0.06]"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-10 w-10 shrink-0 rounded-xl hover:bg-white/[0.06]"
              aria-label="Tutup"
            >
              <ArrowLeft className="h-5 w-5 text-slate-300" />
            </Button>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-sm font-semibold text-white leading-tight line-clamp-2 break-words">
                {title}
              </SheetTitle>
            </div>
          </div>
          {(badges || subtitle) && (
            <div className="px-3 pb-2 space-y-1">
              {badges && (
                <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
              )}
              {subtitle && (
                <SheetDescription className="text-[11px] text-slate-500 break-words leading-snug">
                  {subtitle}
                </SheetDescription>
              )}
            </div>
          )}
        </div>

        {/* Main scroll container — single scroll */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 min-h-0">
          {children}
        </div>

        {/* Optional sticky footer */}
        {footer && (
          <div
            className="shrink-0 border-t border-white/[0.06] bg-nebula/95 backdrop-blur-xl px-3 py-2.5"
            style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
