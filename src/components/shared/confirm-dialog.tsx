/**
 * Confirmation Dialog Pattern — Phase 0 UX Foundation
 * 
 * Standardized confirmation dialogs for destructive actions.
 * @see docs/UX-DESIGN-CONTRACT.md Section 4.4 (Confirmation Dialog Pattern)
 */

import React, { useState, useCallback, useRef } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

export interface ConfirmDialogOptions {
  /** Dialog title */
  title: string
  /** Dialog description - explain what will happen */
  description: string
  /** Consequence details (optional, shown as list) */
  consequences?: string[]
  /** Label for confirm button */
  confirmLabel?: string
  /** Label for cancel button */
  cancelLabel?: string
  /** Visual variant */
  variant?: 'danger' | 'warning' | 'info'
  /** Icon element (optional) */
  icon?: React.ReactNode
  /** Whether to show loading state during confirmation */
  isLoading?: boolean
}

export interface UseConfirmReturn {
  /** Confirmation dialog props (pass to <ConfirmDialog>) */
  dialogProps: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }
  /** Options for current confirmation */
  options: ConfirmDialogOptions | null
  /**
   * Request confirmation from user
   * Returns Promise<boolean> - true if confirmed, false if cancelled
   */
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
  /** Current loading state */
  isLoading: boolean
  /** Set loading state manually */
  setLoading: (loading: boolean) => void
}

// ============================================================================
// useConfirm Hook
// ============================================================================

/**
 * Hook for managing confirmation dialogs with async support
 * 
 * @example
 * ```tsx
 * const { confirm, dialogProps, isLoading } = useConfirm()
 * 
 * const handleDelete = async () => {
 *   const confirmed = await confirm({
 *     title: 'Hapus Produk',
 *     description: 'Produk akan dihapus permanen.',
 *     variant: 'danger',
 *   })
 *   if (confirmed) {
 *     await deleteProduct()
 *   }
 * }
 * 
 * return (
 *   <>
 *     <Button onClick={handleDelete}>Hapus</Button>
 *     <ConfirmDialog {...dialogProps} />
 *   </>
 * )
 * ```
 */
export function useConfirm(): UseConfirmReturn {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Use ref to store resolver - avoids modifying useCallback result
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback(
    (confirmOptions: ConfirmDialogOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        setOptions(confirmOptions)
        setOpen(true)
        
        // Store resolver in ref to call when user acts
        resolverRef.current = resolve
      })
    },
    []
  )

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      setOpen(newOpen)
      
      if (!newOpen) {
        // Dialog closed without confirming → resolve false
        if (resolverRef.current) {
          resolverRef.current(false)
          resolverRef.current = null
        }
        setOptions(null)
        setIsLoading(false)
      }
    },
    []
  )

  const handleConfirm = useCallback(async () => {
    // Resolve with true when user confirms
    if (resolverRef.current) {
      resolverRef.current(true)
      resolverRef.current = null
    }
    setOpen(false)
  }, [])

  const handleCancel = useCallback(() => {
    if (resolverRef.current) {
      resolverRef.current(false)
      resolverRef.current = null
    }
    setOpen(false)
  }, [])

  return {
    dialogProps: {
      open,
      onOpenChange: handleOpenChange,
    },
    options,
    confirm,
    isLoading,
    setLoading: setIsLoading,
  }
}

// ============================================================================
// ConfirmDialog Component
// ============================================================================

export interface ConfirmDialogProps {
  /** Dialog control props from useConfirm() */
  dialogProps: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }
  /** Current options from useConfirm() */
  options: ConfirmDialogOptions | null
  /** Loading state */
  isLoading?: boolean
  /** Custom confirm handler (overrides default) */
  onConfirm?: () => void | Promise<void>
  /** Custom cancel handler (overrides default) */
  onCancel?: () => void
}

/**
 * Confirmation dialog component implementing Aether UX pattern
 * 
 * Renders an AlertDialog with:
 * - Title and description
 * - Optional consequence list
 * - Variant-based styling (danger/warning/info)
 * - Loading state support
 */
export function ConfirmDialog({
  dialogProps,
  options,
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!options || !dialogProps.open) return null

  const {
    title,
    description,
    consequences,
    confirmLabel = 'Konfirmasi',
    cancelLabel = 'Batal',
    variant = 'danger',
    icon,
  } = options

  const variantStyles = {
    danger: {
      confirmClass: 'bg-red-600 hover:bg-red-500 text-white focus:ring-red-500',
      iconColor: 'text-red-400',
      iconBg: 'bg-red-500/10',
    },
    warning: {
      confirmClass: 'bg-amber-600 hover:bg-amber-500 text-white focus:ring-amber-500',
      iconColor: 'text-amber-400',
      iconBg: 'bg-amber-500/10',
    },
    info: {
      confirmClass: 'bg-emerald-600 hover:bg-emerald-500 text-white focus:ring-emerald-500',
      iconColor: 'text-emerald-400',
      iconBg: 'bg-emerald-500/10',
    },
  }

  const style = variantStyles[variant]

  return (
    <AlertDialog {...dialogProps}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          {/* Icon */}
          <div className={cn('mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center', style.iconBg)}>
            {icon || (
              <svg
                className={cn('h-7 w-7', style.iconColor)}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                {variant === 'danger' && (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                )}
                {variant === 'warning' && (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                )}
                {variant === 'info' && (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
            )}
          </div>

          {/* Title & Description */}
          <AlertDialogTitle className="text-center">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Consequences List */}
        {consequences && consequences.length > 0 && (
          <ul className="my-4 space-y-2 text-sm text-slate-400">
            {consequences.map((consequence, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-slate-500 mt-0.5">•</span>
                <span>{consequence}</span>
              </li>
            ))}
          </ul>
        )}

        <AlertDialogFooter className="!flex-col sm:!flex-row gap-2">
          <AlertDialogCancel
            onClick={onCancel}
            className="w-full sm:w-auto"
          >
            {cancelLabel}
          </AlertDialogCancel>
          
          <AlertDialogAction
            onClick={onConfirm}
            className={cn('w-full sm:w-auto', style.confirmClass)}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ============================================================================
// Quick Confirm Components (for simple cases)
// ============================================================================

/**
 * Simple delete confirmation hook
 * Convenience wrapper around useConfirm for delete actions
 */
export function useDeleteConfirm(itemName: string = 'item') {
  const { confirm, dialogProps, options, isLoading, setLoading } = useConfirm()

  const confirmDelete = useCallback((): Promise<boolean> => {
    return confirm({
      title: `Hapus ${itemName}`,
      description: `${itemName.charAt(0).toUpperCase() + itemName.slice(1)} yang dihapus tidak dapat dikembalikan.`,
      confirmLabel: 'Ya, Hapus',
      cancelLabel: 'Batal',
      variant: 'danger',
    })
  }, [confirm, itemName])

  return {
    confirmDelete,
    dialogProps,
    options,
    isLoading,
    setLoading,
  }
}

// ============================================================================
// Exports
// ============================================================================

export { useConfirm, ConfirmDialog, useDeleteConfirm }
export type { UseConfirmReturn, ConfirmDialogOptions, ConfirmDialogProps }
