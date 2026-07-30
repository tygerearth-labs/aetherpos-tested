'use client'

import { WifiOff, ShoppingCart, CheckCircle2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { navigateUnchecked } from '@/lib/navigate'
import { OFFLINE_AVAILABLE_LABELS } from '@/lib/route-capability'
import type { RouteCapability } from '@/lib/route-capability'
import type { PageType } from '@/hooks/use-page-store'

interface OfflineRouteBlockerProps {
  /** The blocked route + its capability metadata, or null to hide the dialog */
  blocked: { page: PageType; capability: RouteCapability } | null
  /** Called when the user dismisses the dialog (Back to POS / close) */
  onDismiss: () => void
}

/**
 * Intentional offline-unavailable dialog for ONLINE_ONLY routes.
 *
 * Shown when the user clicks a sidebar/bottom-nav item for an ONLINE_ONLY
 * route while offline. The navigation is blocked BEFORE the dynamic import
 * is attempted, so no ChunkLoadError is ever thrown.
 *
 * Actions:
 *   - Kembali ke POS (primary — POS is FULL offline, chunk already cached)
 *   - Lihat fitur offline (expands the list of routes that DO work offline)
 *
 * The dialog explains that locally stored transactions remain safe.
 */
export function OfflineRouteBlocker({ blocked, onDismiss }: OfflineRouteBlockerProps) {
  const goBackToPOS = () => {
    // Recovery path: POS is FULL offline (chunk already cached), so bypass
    // the guard. This is a user-initiated "go to safe page" action.
    navigateUnchecked('pos')
    onDismiss()
  }

  return (
    <AnimatePresence>
      {blocked && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onDismiss}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-white/[0.08] shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-4 text-center border-b border-white/[0.04]">
              <div className="mx-auto h-12 w-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-3">
                <WifiOff className="h-6 w-6 text-amber-400" />
              </div>
              <h2 className="text-base font-semibold text-white">
                {blocked.capability.label} tidak tersedia offline
              </h2>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                {blocked.capability.offlineReason ||
                  'Halaman ini memerlukan koneksi server dan tidak dapat dibuka saat offline.'}
              </p>
            </div>

            {/* Safe data notice */}
            <div className="px-6 py-4 bg-emerald-500/[0.03] border-b border-white/[0.04]">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-emerald-300">
                    Transaksi lokal Anda tetap aman
                  </p>
                  <p className="text-[11px] text-emerald-400/60 mt-0.5 leading-relaxed">
                    Transaksi yang tersimpan di perangkat akan disinkronkan otomatis saat koneksi kembali.
                  </p>
                </div>
              </div>
            </div>

            {/* Offline-available features */}
            <div className="px-6 py-4 border-b border-white/[0.04]">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Tersedia offline
              </p>
              <div className="flex flex-wrap gap-1.5">
                {OFFLINE_AVAILABLE_LABELS.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10px] text-slate-300"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-4 flex flex-col gap-2">
              <button
                onClick={goBackToPOS}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.08] border border-white/[0.1] px-4 py-2.5 text-sm font-medium text-white hover:bg-white/[0.12] transition-colors"
              >
                <ShoppingCart className="h-4 w-4" />
                Kembali ke POS
              </button>
              <button
                onClick={onDismiss}
                className="w-full text-center text-xs text-slate-500 hover:text-slate-300 transition-colors py-1"
              >
                Tutup
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
