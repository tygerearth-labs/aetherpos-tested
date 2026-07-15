'use client'

import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { PackagePlus, Sparkles, Zap, Package, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

import { ImportModeDialog } from './import-mode-dialog'
import { MigrationWizard } from './migration-wizard'

export type ImportMode = 'product_only' | 'product_stock' | 'product_inventory'
export type WizardState = 'idle' | 'choosing_mode' | 'uploading' | 'processing' | 'success'

export interface ImportResult {
  productsCreated: number
  variantsCreated: number
  productsSkipped: number
  totalCategories: number
  barcodeCount: number
  mode: ImportMode
  errors: string[]
  warnings?: string[]           // Re-migration warnings (updated, skipped items)
  inventoryItemsCreated?: number
  inventoryItemsSkipped?: number
  inventoryItemsUpdated?: number   // Items replaced during re-migration
  migrationDataCleaned?: number    // Count of cleaned migration data
  compositionsCreated?: number
  totalStock?: number
  totalModalValue?: number
}

// Animation variants
const bannerVariants = {
  hidden: { opacity: 0, y: -20, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, y: -20, scale: 0.95, transition: { duration: 0.3 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } },
}

interface MigrationBannerProps {
  showBanner: boolean
}

export function MigrationBanner({ showBanner: shouldShowBanner }: MigrationBannerProps) {
  const queryClient = useQueryClient()
  const [wizardState, setWizardState] = useState<WizardState>('idle')
  const [selectedMode, setSelectedMode] = useState<ImportMode>('product_only')
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  const handleDismiss = useCallback(() => {
    setWizardState('idle')
    setSelectedMode('product_only')
    setImportResult(null)
  }, [])

  const handleImportSuccess = useCallback((result: ImportResult) => {
    setImportResult(result)
    setWizardState('success')
    // NOTE: Do NOT invalidateQueries here — it triggers dashboard refetch
    // which may unmount this component (totalProducts > 0) before user sees success dialog.
    // Refetch is deferred to handleCloseSuccess instead.
  }, [])

  const handleCloseSuccess = useCallback(() => {
    // Invalidate dashboard NOW — after user closes dialog, safe to refetch
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    handleDismiss()
  }, [queryClient, handleDismiss])

  // Banner card visibility — only show the banner card when:
  // 1. Parent says we should (totalProducts === 0)
  // 2. Wizard is NOT active (not in the middle of upload/process/success flow)
  //
  // CRITICAL: The dialogs are ALWAYS rendered (controlled by their `open` prop)
  // so they survive parent re-renders when totalProducts changes from 0 to >0.
  const isWizardActive = wizardState !== 'idle'
  const showBannerCard = shouldShowBanner && !isWizardActive

  // Render nothing at all when banner shouldn't show AND wizard is not active.
  // This avoids an empty Fragment being mounted on every dashboard page for
  // existing users who already have products.
  if (!shouldShowBanner && !isWizardActive) {
    return null
  }

  return (
    <>
      {/* ═══════════════════════════════════════════════════
          MIGRATION BANNER — New User (0 Products)
          ═══════════════════════════════════════════════════ */}
      {showBannerCard && (
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
                    <h3 className="text-base font-bold text-white tracking-tight">
                      Migrasi dari POS Lama?
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Impor produk Anda dari Excel dan langsung siap berjualan
                    </p>
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
                  onClick={() => setWizardState('choosing_mode')}
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
      )}

      {/* ═══════════════════════════════════════════════════
          IMPORT MODE SELECTION DIALOG
          ═══════════════════════════════════════════════════ */}
      <Dialog
        open={wizardState === 'choosing_mode'}
        onOpenChange={(open) => { if (!open) handleDismiss() }}
      >
        <DialogContent className="sm:max-w-[520px] max-h-[85vh] bg-nebula border-stellar-border p-0 overflow-hidden flex flex-col">
          <div className="px-6 pt-6 pb-2">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                <PackagePlus className="h-5 w-5 text-emerald-400" />
                Pilih Mode Import
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-400 mt-1.5">
                Pilih sesuai kebutuhan bisnis Anda. Data yang sama akan diproses sesuai mode.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 pb-6 space-y-3 mt-2 overflow-y-auto flex-1 custom-scrollbar">
            <ImportModeDialog
              selected={selectedMode}
              onSelect={(mode) => {
                setSelectedMode(mode)
                setWizardState('uploading')
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════
          MIGRATION WIZARD (Upload → Processing → Success)
          ═══════════════════════════════════════════════════ */}
      <Dialog
        open={wizardState === 'uploading' || wizardState === 'processing' || wizardState === 'success'}
        onOpenChange={(open) => {
          if (!open && wizardState !== 'processing') handleDismiss()
        }}
      >
        <DialogContent className="sm:max-w-[480px] max-h-[85vh] bg-nebula border-stellar-border p-0 overflow-hidden flex flex-col">
          <MigrationWizard
            mode={selectedMode}
            state={wizardState}
            onStateChange={setWizardState}
            onSuccess={handleImportSuccess}
            onClose={handleCloseSuccess}
            onDismiss={handleDismiss}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}