"use client"

import * as React from "react"

// Dialog components (always centered, both mobile and desktop)
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { cn } from "@/lib/utils"

// ============================================================
// Root — transparent wrapper, always uses Dialog
// ============================================================
function ResponsiveDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  )
}

// ============================================================
// Content — always centered DialogContent, mobile-optimized
// ============================================================
function ResponsiveDialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogContent> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogContent
      showCloseButton={showCloseButton}
      className={cn(
        "bg-zinc-900 border-zinc-800 rounded-xl max-h-[85vh] overflow-y-auto",
        // Mobile: full-width with small margin, smaller padding
        "w-[calc(100%-1rem)] sm:max-w-lg",
        className
      )}
      {...props}
    >
      {children}
    </DialogContent>
  )
}

// ============================================================
// Header — always DialogHeader
// ============================================================
function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<typeof DialogHeader>) {
  return <DialogHeader className={className} {...props} />
}

// ============================================================
// Title — always DialogTitle
// ============================================================
function ResponsiveDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  return <DialogTitle className={className} {...props} />
}

// ============================================================
// Description — always DialogDescription
// ============================================================
function ResponsiveDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  return <DialogDescription className={className} {...props} />
}

// ============================================================
// Footer — always DialogFooter
// ============================================================
function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  return <DialogFooter className={className} {...props} />
}

export {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
}
