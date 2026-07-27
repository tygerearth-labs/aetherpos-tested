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
}

export function BulkEngineTrigger({ kind, label, className, variant = 'default' }: Props) {
  const { openDialog } = useBulkWorker()

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={() => openDialog(kind)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors ${className || ''}`}
        title="Import/Update via Excel (Aether Bulk Engine)"
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
        onClick={() => openDialog(kind)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors ${className || ''}`}
        title="Import/Update via Excel (Aether Bulk Engine)"
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        {label || 'Excel (Engine)'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => openDialog(kind)}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors ${className || ''}`}
      title="Import/Update via Excel (Aether Bulk Engine)"
    >
      <FileSpreadsheet className="h-3.5 w-3.5" />
      {label || 'Import Excel (Engine)'}
    </button>
  )
}
