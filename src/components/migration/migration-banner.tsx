'use client'

import { motion } from 'framer-motion'
import { PackagePlus, Sparkles, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMigrationProcessor } from './migration-context'

// ── Type exports (consumed by wizard, context, provider, import-mode-dialog) ──
export type ImportMode = 'product_only' | 'product_stock' | 'product_inventory'
export type WizardState = 'idle' | 'choosing_mode' | 'uploading' | 'processing' | 'success'

export type MigrationStatus = 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'PARTIAL' | 'FAILED'

export interface ImportResult {
  productsCreated: number
  variantsCreated: number
  productsSkipped: number
  totalCategories: number
  barcodeCount: number
  mode: ImportMode
  errors: string[]
  warnings?: string[]
  inventoryItemsCreated?: number
  inventoryItemsSkipped?: number
  inventoryItemsUpdated?: number
  migrationDataCleaned?: number
  compositionsCreated?: number
  totalStock?: number
  totalModalValue?: number
  // MIG-BATCH: batch processing + progress fields
  status?: MigrationStatus
  totalProducts?: number
  totalBatches?: number
  completedBatches?: number
  currentBatch?: number
  failedRows?: number
  remainingProducts?: number
  effectiveMaxProducts?: number
  startBatch?: number
  batchError?: string | null
}

// Animation variants
const bannerVariants = {
  hidden: { opacity: 0, y: -20, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, y: -20, scale: 0.95, transition: { duration: 0.3 } },
}

interface MigrationBannerProps {
  showBanner: boolean
}

/**
 * MIG-BATCH-V3: The banner is now a pure CTA card. The wizard dialog (mode
 * selection → upload → processing → success) is owned by the processor provider
 * and rendered globally so it survives navigation. Clicking "Import Sekarang"
 * calls ctx.openWizard().
 */
export function MigrationBanner({ showBanner: shouldShowBanner }: MigrationBannerProps) {
  const { openWizard } = useMigrationProcessor()

  if (!shouldShowBanner) return null

  return (
    <motion.div variants={bannerVariants}>
      <div className="relative overflow-hidden rounded-2xl border border-stellar-border">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.08] via-teal-500/[0.05] to-cyan-500/[0.08]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.1),transparent_60%)]" />

        {/* Decorative dots */}
        <div className="absolute top-3 right-4 flex gap-1 opacity-30">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <div className="h-1.5 w-1.5 rounded-full bg-teal-400" />
          <div className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
        </div>

        <div className="relative px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Left content */}
            <div className="space-y-2.5 flex-1 min-w-0">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20 shrink-0">
                  <PackagePlus className="h-4.5 w-4.5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">Migrasi dari POS Lama?</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Impor produk Anda dari Excel dan langsung siap berjualan</p>
                </div>
              </div>

              {/* Feature pills */}
              <div className="flex flex-wrap gap-1.5 ml-0 sm:ml-[46px]">
                {['Produk', 'SKU', 'Barcode', 'Harga Jual', 'Kategori'].map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium text-emerald-300/80 bg-emerald-500/10 border border-emerald-500/15 rounded-md"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-2.5 sm:shrink-0">
              <Button
                onClick={openWizard}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold h-9 px-4 gap-2 shadow-lg shadow-emerald-500/20 transition-all hover:shadow-emerald-500/30"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Import Sekarang
                <ChevronRight className="h-3 w-3 opacity-70" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
