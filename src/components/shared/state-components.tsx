/**
 * Shared State Components — Phase 0 UX Foundation
 * 
 * Consistent loading, empty, and error states for all domains.
 * @see docs/UX-DESIGN-CONTRACT.md Section 5 (Loading/Error/Empty States)
 */

import React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// Loading State Components
// ============================================================================

export interface PageLoaderProps {
  /** Optional message to display */
  message?: string
  /** Additional class names */
  className?: string
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Full-page loading spinner with optional message
 * Used during initial page load or route transitions
 */
export function PageLoader({ 
  message = 'Memuat data...', 
  className,
  size = 'md' 
}: PageLoaderProps) {
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  }

  return (
    <div 
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12',
        className
      )}
      role="status"
      aria-label={message}
    >
      <Loader2 className={cn('animate-spin text-emerald-500', sizeClasses[size])} />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  )
}

/**
 * Inline loading spinner for buttons/inputs
 * Replaces button content during mutation
 */
export function InlineLoader({ className }: { className?: string }) {
  return (
    <Loader2 
      className={cn('h-4 w-4 animate-spin', className)} 
      role="status"
      aria-label="Memproses"
    />
  )
}

/**
 * Skeleton loader component for content placeholders
 * Matches final layout shape during loading
 */
export function SkeletonLoader({ 
  lines = 3,
  className 
}: { 
  lines?: number
  className?: string 
}) {
  return (
    <div className={cn('space-y-3 p-4', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-4 rounded bg-white/[0.06] animate-pulse',
            i === lines - 1 ? 'w-3/4' : 'w-full'
          )}
        />
      ))}
    </div>
  )
}

/**
 * Table skeleton loader with header + rows
 */
export function TableSkeletonLoader({ 
  rows = 5,
  cols = 4 
}: { 
  rows?: number
  cols?: number 
}) {
  return (
    <div className="w-full" aria-hidden="true">
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 border-b border-white/[0.06]">
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={`h-${i}`}
            className="h-4 w-20 rounded bg-white/[0.08] animate-pulse"
          />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={`r-${rowIdx}`}
          className="flex gap-4 px-4 py-3 border-b border-white/[0.04]"
        >
          {Array.from({ length: cols }).map((_, colIdx) => (
            <div
              key={`c-${rowIdx}-${colIdx}`}
              className={cn(
                'h-4 rounded bg-white/[0.04] animate-pulse',
                colIdx === 0 ? 'w-24' : colIdx === cols - 1 ? 'w-16' : 'flex-1'
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Empty State Components
// ============================================================================

export interface EmptyStateProps {
  /** Icon or illustration element */
  icon?: React.ReactNode
  /** Main heading */
  title: string
  /** Descriptive text */
  description?: string
  /** Primary action button */
  primaryAction?: {
    label: string
    onClick: () => void
    icon?: React.ReactNode
  }
  /** Secondary action button */
  secondaryAction?: {
    label: string
    onClick: () => void
    icon?: React.ReactNode
  }
  /** Additional class names */
  className?: string
}

/**
 * Standard empty state component with consistent styling
 * Used when list/table has no items
 */
export function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-4 text-center',
        className
      )}
      role="status"
    >
      {/* Icon/Illustration */}
      {icon && (
        <div className="mb-4 text-slate-500">
          {icon}
        </div>
      )}

      {/* Title */}
      <h3 className="text-base font-medium text-slate-300 mb-2">
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-slate-500 max-w-sm mb-6">
          {description}
        </p>
      )}

      {/* Actions */}
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {primaryAction && (
            <button
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
            >
              {primaryAction.icon && <span>{primaryAction.icon}</span>}
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 text-slate-300 text-sm font-medium transition-colors"
            >
              {secondaryAction.icon && <span>{secondaryAction.icon}</span>}
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Search empty state - shown when search returns no results
 */
export function SearchEmptyState({
  query,
  onClear,
  className,
}: {
  query: string
  onClear: () => void
  className?: string
}) {
  return (
    <EmptyState
      icon={
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      }
      title='Tidak ada hasil ditemukan'
      description={`Tidak ditemukan data untuk pencarian "${query}". Coba kata kunci lain atau reset filter.`}
      primaryAction={{
        label: 'Reset Pencarian',
        onClick: onClear,
      }}
      className={className}
    />
  )
}

/**
 * Filter empty state - shown when active filter returns no results
 */
export function FilterEmptyState({
  onReset,
  className,
}: {
  onReset: () => void
  className?: string
}) {
  return (
    <EmptyState
      icon={
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3c2.755 0 5.455.232 7.52 1.25 1.48 1.09 2.643 2.593 3.198 4.397.073.19.11.386.11.587v.002c0 .658-.083 1.297-.24 1.906-.11.493-.21.99-.3 1.49a18.08 18.08 0 01-.55 3.378M12 21a9 9 0 110-18 0 9 9 0 0118 0z" />
        </svg>
      }
      title='Tidak ada data dengan filter ini'
      description='Coba ubah atau reset filter untuk melihat data.'
      primaryAction={{
        label: 'Reset Filter',
        onClick: onReset,
      }}
      className={className}
    />
  )
}

// ============================================================================
// Error State Components
// ============================================================================

export interface ErrorStateProps {
  /** Error title */
  title?: string
  /** User-friendly error message */
  message: string
  /** Technical details (shown in dev mode) */
  details?: string
  /** Primary recovery action */
  retryAction?: {
    label: string
    onClick: () => void
  }
  /** Secondary action */
  secondaryAction?: {
    label: string
    onClick: () => void
  }
  /** Additional class names */
  className?: string
  /** Whether this is a "full page" error vs inline error */
  fullPage?: boolean
}

/**
 * Standard error state component with actionable recovery
 * Used when API call fails or unexpected error occurs
 */
export function ErrorState({
  title = 'Terjadi kesalahan',
  message,
  details,
  retryAction,
  secondaryAction,
  className,
  fullPage = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center py-12 px-4 text-center',
        fullPage ? 'min-h-[400px]' : '',
        className
      )}
    >
      {/* Error Icon */}
      <div className="mb-4 w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
        <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>

      {/* Title */}
      <h3 className="text-base font-medium text-slate-200 mb-2">
        {title}
      </h3>

      {/* Message */}
      <p className="text-sm text-slate-400 max-w-md mb-2">
        {message}
      </p>

      {/* Details (dev only) */}
      {details && process.env.NODE_ENV === 'development' && (
        <pre className="mt-2 p-3 bg-red-500/10 rounded-lg text-xs text-red-300 overflow-auto max-w-md text-left mb-4">
          {details}
        </pre>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
        {retryAction && (
          <button
            onClick={retryAction.onClick}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {retryAction.label}
          </button>
        )}
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 text-slate-300 text-sm font-medium transition-colors"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Network error state - specific for connectivity issues
 */
export function NetworkErrorState({
  onRetry,
  className,
}: {
  onRetry: () => void
  className?: string
}) {
  return (
    <ErrorState
      title='Koneksi terputus'
      message='Tidak dapat terhubung ke server. Periksa koneksi internet Anda dan coba lagi.'
      retry={{ label: 'Coba Lagang', onClick: onRetry }}
      className={className}
      fullPage
    />
  )
}

/**
 * Permission error state - specific for access denied
 */
export function PermissionErrorState({
  className,
}: {
  className?: string
}) {
  return (
    <ErrorState
      title='Akses ditolak'
      message='Anda tidak memiliki izin untuk mengakses halaman ini. Hubungi administrator jika ini adalah kesalahan.'
      className={className}
    />
  )
}

/**
 * Not found error state - specific for 404 cases
 */
export function NotFoundErrorState({
  resource = 'Data',
  onBack,
  className,
}: {
  resource?: string
  onBack?: () => void
  className?: string
}) {
  return (
    <ErrorState
      title={`${resource} tidak ditemukan`}
      message={`${resource} yang Anda cari mungkin telah dihapus atau dipindahkan.`}
      secondaryAction={onBack ? { label: 'Kembali', onClick: onBack } : undefined}
      className={className}
    />
  )
}

// ============================================================================
// Stale Data Indicator
// ============================================================================

export interface StaleDataIndicatorProps {
  /** When the data was last updated */
  lastUpdated?: Date | null
  /** Whether currently in stale state (data may be outdated) */
  isStale?: boolean
  /** Manual refresh handler */
  onRefresh?: () => void
  /** Is refresh in progress */
  isRefreshing?: boolean
  /** Compact mode for inline use */
  compact?: boolean
}

/**
 * Shows data freshness status with manual refresh option
 * Implements Cache & Freshness pattern from UX Contract
 */
export function StaleDataIndicator({
  lastUpdated,
  isStale = false,
  onRefresh,
  isRefreshing = false,
  compact = false,
}: StaleDataIndicatorProps) {
  if (!lastUpdated && !onRefresh) return null

  const timeAgo = lastUpdated ? formatTimeAgo(lastUpdated) : null
  const showWarning = isStale || (lastUpdated ? Date.now() - lastUpdated.getTime() > 5 * 60 * 1000 : false)

  if (compact) {
    return (
      <button
        onClick={onRefresh}
        disabled={!onRefresh || isRefreshing}
        className={cn(
          'inline-flex items-center gap-1.5 text-xs transition-colors',
          showWarning ? 'text-amber-400' : 'text-slate-500',
          onRefresh && 'hover:text-slate-300 cursor-pointer'
        )}
        title={timeAgi ? `Terakhir diperbarui: ${timeAgi}` : undefined}
      >
        {isRefreshing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}
        {timeAgi && <span>{timeAgi}</span>}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs',
        showWarning ? 'bg-amber-500/10 text-amber-400' : 'bg-white/[0.04] text-slate-500'
      )}
    >
      {showWarning && (
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      )}
      
      <span>
        {timeAgi ? `Diperbarui ${timeAgi}` : 'Data mungkin tidak terbaru'}
      </span>

      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className={cn(
            'ml-1 inline-flex items-center gap-1 hover:text-slate-300 transition-colors',
            isRefreshing && 'animate-pulse'
          )}
          title="Segarkan data"
        >
          {isRefreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
      )}
    </div>
  )
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a date as relative time ago (Indonesian)
 */
function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'Baru saja'
  if (diffMin < 60) return `${diffMin} menit lalu`
  if (diffHour < 24) return `${diffHour} jam lalu`
  if (diffDay < 7) return `${diffDay} hari lalu`
  
  // Fallback to locale date for older dates
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ============================================================================
// Exports
// ============================================================================

// Re-export for convenience
export { PageLoader, InlineLoader, SkeletonLoader, TableSkeletonLoader }
export type { PageLoaderProps }
