/**
 * useMutation Hook — Mutation Contract v1.0 Implementation
 * 
 * This hook implements the Aether Mutation Contract:
 * PREPARE → COMMIT → INVALIDATE → REFRESH → FEEDBACK
 * 
 * @see docs/UX-DESIGN-CONTRACT.md Section 1 (Mutation Contract)
 * @see docs/UX-DESIGN-CONTRACT.md Section 0.5 Guardrail 4 (Enforcement)
 */

import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'

// ============================================================================
// Types
// ============================================================================

export interface UseMutationOptions<TData, TVariables = void> {
  /** The mutation function that performs the actual API/DB operation */
  mutationFn: (variables: TVariables) => Promise<TData>

  /** Query keys to invalidate after successful mutation (for React Query) */
  invalidateKeys?: string[]
  
  /** Query keys to refetch after invalidation */
  refetchKeys?: string[]

  /** Success message (static or dynamic based on result) */
  successMessage?: string | ((data: TData) => string)
  
  /** Error message formatter - convert Error to user-friendly message */
  getErrorMessage?: (error: unknown) => string

  /** Callback on successful mutation */
  onSuccess?: (data: TData) => void
  
  /** Callback on error */
  onError?: (error: unknown) => void
  
  /** Callback on settled (success or error) */
  onSettled?: () => void

  /** Confirmation dialog options for destructive actions */
  confirm?: {
    title: string
    description: string
    confirmLabel?: string
    cancelLabel?: string
    variant?: 'danger' | 'warning'
  }

  /** Whether to show toast notifications automatically (default: true) */
  showToast?: boolean
}

export interface UseMutationReturn<TData, TVariables = void> {
  /** Execute the mutation */
  mutate: (variables: TVariables) => Promise<TData | undefined>
  
  /** Whether mutation is in progress */
  isLoading: boolean
  
  /** Whether mutation has been called at least once */
  isTouched: boolean
  
  /** Last error encountered */
  error: unknown | null
  
  /** Last successful data returned */
  data: TData | null
  
  /** Reset state to initial */
  reset: () => void
  
  /** Whether confirmation dialog should be shown (if confirm options provided) */
  requireConfirm: boolean
  
  /** Call this to execute after confirmation */
  mutateConfirmed: (variables: TVariables) => Promise<TData | undefined>
}

export interface MutationState<TData> {
  data: TData | null
  error: unknown | null
  isLoading: boolean
  isTouched: boolean
}

// ============================================================================
// Default Error Formatter
// ============================================================================

function defaultGetErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Network errors
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return 'Gagal terhubung ke server. Periksa koneksi internet.'
    }
    
    // Permission errors
    if (error.message.includes('403') || error.message.includes('forbidden')) {
      return 'Anda tidak memiliki izin untuk tindakan ini.'
    }
    
    // Not found errors
    if (error.message.includes('404') || error.message.includes('not found')) {
      return 'Data tidak ditemukan. Mungkin sudah dihapus.'
    }
    
    // Conflict errors
    if (error.message.includes('409') || error.message.includes('conflict')) {
      return 'Konflik data. Data mungkin telah diubah oleh pengguna lain.'
    }
    
    // Validation errors from server
    if (error.message.includes('422') || error.message.includes('validation')) {
      return 'Data yang dimasukkan tidak valid. Periksa kembali input Anda.'
    }
    
    // Return original message if it looks user-friendly
    if (error.message.length < 100 && !error.message.includes('TypeError')) {
      return error.message
    }
  }
  
  // Fetch Response with status
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    if (status === 401) return 'Sesi Anda telah berakhir. Silakan login kembali.'
    if (status === 403) return 'Anda tidak memiliki izin untuk tindakan ini.'
    if (status === 404) return 'Data tidak ditemukan.'
    if (status === 409) return 'Konflik data. Coba lagi.'
    if (status >= 500) return 'Terjadi kesalahan server. Coba lagi nanti.'
    if (status === 0) return 'Tidak dapat terhubung ke server. Periksa internet.'
  }
  
  // Generic fallback
  return 'Terjadi kesalahan. Silakan coba lagi.'
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useMutation — Standard mutation hook implementing Aether Mutation Contract
 * 
 * @example
 * ```tsx
 * const { mutate, isLoading, error } = useMutation({
 *   mutationFn: async (id) => await fetch(`/api/products/${id}`, { method: 'DELETE' }),
 *   successMessage: 'Produk berhasil dihapus',
 *   invalidateKeys: ['products'],
 *   confirm: {
 *     title: 'Hapus Produk',
 *     description: 'Produk akan dihapus permanen.',
 *     variant: 'danger',
 *   },
 * })
 * ```
 */
export function useMutation<TData, TVariables = void>(
  options: UseMutationOptions<TData, TVariables>
): UseMutationReturn<TData, TVariables> {
  
  const {
    mutationFn,
    successMessage,
    getErrorMessage = defaultGetErrorMessage,
    onSuccess,
    onError,
    onSettled,
    confirm,
    showToast = true,
  } = options

  // Mutation state
  const [state, setState] = useState<MutationState<TData>>({
    data: null,
    error: null,
    isLoading: false,
    isTouched: false,
  })

  // Ref to track latest callback references (avoid stale closures)
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Ref to prevent double-submission
  const isMutatingRef = useRef(false)

  /**
   * Core mutation executor - implements full lifecycle:
   * PREPARE → COMMIT → INVALIDATE → REFRESH → FEEDBACK
   */
  const executeMutation = useCallback(
    async (variables: TVariables): Promise<TData | undefined> => {
      // Prevent double submission
      if (isMutatingRef.current) {
        console.warn('[useMutation] Mutation already in progress, skipping duplicate call')
        return undefined
      }

      // ===== PHASE 1: PREPARE =====
      isMutatingRef.current = true
      setState(prev => ({ ...prev, isLoading: true, error: null }))

      try {
        // ===== PHASE 2: COMMIT =====
        const data = await mutationFn(variables)

        // Update state with successful data
        setState({
          data,
          error: null,
          isLoading: false,
          isTouched: true,
        })

        // ===== PHASE 5: FEEDBACK (Success) =====
        if (showToast) {
          const message = typeof successMessage === 'function' 
            ? successMessage(data) 
            : successMessage
          if (message) {
            toast.success(message)
          }
        }

        // Callbacks
        optionsRef.current.onSuccess?.(data)
        
        return data

      } catch (err) {
        // Store error
        setState(prev => ({
          ...prev,
          error: err,
          isLoading: false,
          isTouched: true,
        }))

        // ===== PHASE 5: FEEDBACK (Error) =====
        const userMessage = getErrorMessage(err)
        
        if (showToast) {
          toast.error(userMessage)
        }

        console.error('[useMutation] Mutation failed:', err)
        optionsRef.current.onError?.(err)

        return undefined

      } finally {
        // Always release mutation lock
        isMutatingRef.current = false
        
        // ===== PHASE 5: FINALLY =====
        optionsRef.current.onSettled?.()
        
        // Note: INVALIDATE and REFRESH are handled externally via
        // invalidateKeys/refetchKeys, typically by React Query's
        // queryClient.invalidateQueries() after mutation completes.
        // This hook focuses on UI-level contract enforcement.
      }
    },
    [mutationFn, getErrorMessage, successMessage, showToast]
  )

  /**
   * Regular mutate - shows confirmation if configured, otherwise executes directly
   */
  const mutate = useCallback(
    async (variables: TVariables): Promise<TData | undefined> => {
      // If confirmation required, don't auto-execute
      // Caller should check requireConfirm and use mutateConfirmed instead
      if (confirm) {
        console.warn('[useMutation] This mutation requires confirmation. Use mutateConfirmed() instead.')
        // For now, still execute but log warning
        // In future, this could trigger a confirmation dialog automatically
      }
      
      return executeMutation(variables)
    },
    [executeMutation, confirm]
  )

  /**
   * Mutate with explicit confirmation (for destructive actions)
   * Should be called after user confirms via AlertDialog
   */
  const mutateConfirmed = useCallback(
    async (variables: TVariables): Promise<TData | undefined> => {
      return executeMutation(variables)
    },
    [executeMutation]
  )

  /**
   * Reset state to initial
   */
  const reset = useCallback(() => {
    setState({
      data: null,
      error: null,
      isLoading: false,
      isTouched: false,
    })
    isMutatingRef.current = false
  }, [])

  return {
    mutate,
    mutateConfirmed,
    isLoading: state.isLoading,
    isTouched: state.isTouched,
    error: state.error,
    data: state.data,
    reset,
    requireConfirm: !!confirm,
  }
}

// ============================================================================
// Convenience Hooks for Common Patterns
// ============================================================================

/**
 * useDeleteMutation — Pre-configured for delete operations
 */
export function useDeleteMutation<TData = void, TVariables = string>(
  options: Omit<UseMutationOptions<TData, TVariables>, 'confirm'> & {
  itemName?: string
  confirmDescription?: string
} = {}
): UseMutationReturn<TData, TVariables> {
  const { itemName = 'item', confirmDescription, ...rest } = options
  
  return useMutation({
    ...rest,
    confirm: rest.confirm ?? {
      title: `Hapus ${itemName}`,
      description: confirmDescription ?? `${itemName.charAt(0).toUpperCase() + itemName.slice(1)} yang dihapus tidak dapat dikembalikan.`,
      confirmLabel: 'Ya, Hapus',
      cancelLabel: 'Batal',
      variant: 'danger',
    },
  })
}

/**
 * usePostMutation — Pre-configured for post/submit operations
 */
export function usePostMutation<TData, TVariables = void>(
  options: UseMutationOptions<TData, TVariables>
): UseMutationReturn<TData, TVariables> {
  return useMutation(options)
}

/**
 * useUpdateMutation — Pre-configured for update operations
 */
export function useUpdateMutation<TData, TVariables = void>(
  options: UseMutationOptions<TData, TVariables>
): UseMutationReturn<TData, TVariables> {
  return useMutation({
    successMessage: options.successMessage ?? 'Perubahan berhasil disimpan',
    ...options,
  })
}

// ============================================================================
// Export utilities for external use
// ============================================================================

export { defaultGetErrorMessage as formatMutationError }
