'use client'

/**
 * MIG-PARTIAL: State 2 — Partial Migration Entry card.
 *
 * Shown on the dashboard when an outlet already operates in Aether
 * (productCount > 0) but may still have remaining data in an old POS to
 * migrate gradually (e.g. waiting for year-end closing).
 *
 * This is a compact *operational* card — deliberately lower visual emphasis
 * than the State 1 onboarding banner (migration-banner.tsx). It only opens
 * the exact same Migration Wizard (entryMode = 'PARTIAL'); no backend,
 * template, validation, preview, duplicate, Dexie queue, batch processor,
 * audit log, or retry/resume behaviour is modified.
 *
 * Dismiss is local-only via the `partialMigrationCardDismissed` localStorage
 * flag (NOT migrationCompleted). The Migration Wizard remains permanently
 * accessible from Products → Import & Migration regardless of dismissal.
 */

import { motion } from 'framer-motion'
import { Boxes, ArrowRight, X, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useMigrationProcessor } from './migration-context'

interface PartialMigrationCardProps {
  /** Called when the user dismisses the card. The parent wires this to the
   *  `partialMigrationCardDismissed` localStorage flag + local state. */
  onDismiss: () => void
}

export function PartialMigrationCard({ onDismiss }: PartialMigrationCardProps) {
  const { openWizard } = useMigrationProcessor()

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="relative rounded-xl border border-white/[0.06] bg-nebula/60 backdrop-blur-sm overflow-hidden">
        {/* Subtle accent line on the left edge — lower emphasis than State 1's gradient */}
        <div className="absolute inset-y-0 left-0 w-0.5 bg-white/[0.08]" />

        {/* Dismiss button */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Tutup kartu migrasi bertahap"
          className="absolute top-2.5 right-2.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4">
          {/* Left: icon + flexible center content */}
          <div className="flex items-start gap-3 flex-1 min-w-0 pr-6 sm:pr-0">
            {/* Icon */}
            <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-white/[0.04] border border-white/[0.06] shrink-0">
              <Boxes className="h-4.5 w-4.5 text-slate-300" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-1">
              <Badge
                variant="outline"
                className="border-white/[0.1] bg-white/[0.03] text-slate-300 text-[10px] font-medium px-1.5"
              >
                Migrasi Bertahap
              </Badge>
              <h3 className="text-sm font-semibold text-white tracking-tight">
                Masih ada data di POS lama?
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Tambahkan sisa produk, stok, atau inventory secara bertahap tanpa menghentikan operasional toko.
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5 pt-0.5">
                <ShieldCheck className="h-3 w-3 mt-px shrink-0 text-slate-500" />
                <span>Data existing akan mengikuti validasi dan aturan duplikasi Migration Wizard.</span>
              </p>
            </div>
          </div>

          {/* Right: CTA — full-width on mobile, auto on desktop */}
          <div className="sm:shrink-0">
            <Button
              onClick={() => openWizard('PARTIAL')}
              className="w-full sm:w-auto bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white text-xs font-semibold h-9 px-4 gap-2 transition-all"
            >
              Lanjutkan Migrasi
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
