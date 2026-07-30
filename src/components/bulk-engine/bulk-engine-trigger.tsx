'use client'

/**
 * AETHER BULK ENGINE V1 — trigger button.
 *
 * Drop-in button that opens the universal BulkUploadDialog for a given
 * adapter kind. Place it in any page to enable bulk Excel import/update.
 */

import { FileSpreadsheet } from 'lucide-react'
import { useBulkWorker } from './bulk-worker-context'

interface Props {
  kind: string
  label?: string
  className?: string
  variant?: 'default' | 'ghost' | 'compact'
  /** When true, renders a disabled (non-clickable, dimmed) button. */
  disabled?: boolean
}

export function BulkEngineTrigger({ kind, label, className, variant = 'default', disabled = false }: Props) {
  const { openDialog } = useBulkWorker()

  const baseClass = disabled
    ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.02] text-slate-600 border border-white/[0.04] cursor-not-allowed opacity-50'
    : 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors'

  const ghostClass = disabled
    ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-slate-600 cursor-not-allowed opacity-50'
    : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors'

  if (variant === 'compact') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) openDialog(kind) }}
        className={`${baseClass} ${className || ''}`}
        title={disabled ? 'Tidak tersedia offline' : 'Import/Update via Excel (Aether Bulk Engine)'}
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        {label || 'Excel (Engine)'}
      </button>
    )
  }

  if (variant === 'ghost') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) openDialog(kind) }}
        className={`${ghostClass} ${className || ''}`}
        title={disabled ? 'Tidak tersedia offline' : 'Import/Update via Excel (Aether Bulk Engine)'}
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        {label || 'Excel (Engine)'}
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (!disabled) openDialog(kind) }}
      className={`${baseClass} ${className || ''}`}
      title={disabled ? 'Tidak tersedia offline' : 'Import/Update via Excel (Aether Bulk Engine)'}
    >
      <FileSpreadsheet className="h-3.5 w-3.5" />
      {label || 'Import Excel (Engine)'}
    </button>
  )
}
