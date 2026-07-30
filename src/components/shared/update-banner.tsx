'use client'

/**
 * UpdateBanner — Global build-update banner with critical-activity gating.
 *
 * Renders when the build-version-store status is 'ready' or 'pending'.
 *
 *   ready   → shows a "Perbarui sekarang" button. NO auto-apply timer —
 *             the user explicitly triggers the reload so a build update
 *             can never surprise them mid-click (especially in POS).
 *             If the loop-safe sessionStorage guard is already set (we
 *             already reloaded once this session), shows a recovery
 *             message + a manual "Muat ulang" button instead.
 *
 *   pending → shows the list of active critical activities blocking the
 *             update + a force button whose behavior depends on the
 *             highest-severity active activity (3-tier safety ladder):
 *
 *             • any in-flight  → button DISABLED, with an explanation
 *               caption underneath. Reloading mid-API-call leaves the
 *               user unsure whether the transaction succeeded.
 *             • any data-loss  → button opens a HARD confirmation
 *               dialog listing every active activity. Only the second
 *               click ("Tetap muat ulang") triggers applyUpdate().
 *             • only interrupt → button opens a SIMPLE confirmation
 *               dialog. One click on "Muat ulang" triggers applyUpdate().
 *
 * The apply flow:
 *   1. markApplying()
 *   2. SW.postMessage(AETHER_ACTIVATE_UPDATE)
 *   3. SW skipWaiting + clients.claim
 *   4. controllerchange → useServiceWorker reloads once (sessionStorage-guarded)
 *
 * If the reload guard is already set (we already reloaded once this session),
 * the banner shows a recovery message + manual reload button, so a broken
 * update cycle can't trap the user.
 */

import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, AlertTriangle, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  useBuildVersionStore,
  canApplyBuildUpdate,
  markBuildUpdateReloading,
} from '@/lib/build-guard/build-version-store'
import { useCriticalActivityStore } from '@/lib/build-guard/critical-activity-registry'
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

type ConfirmTier = 'none' | 'simple' | 'hard'

export function UpdateBanner() {
  const status = useBuildVersionStore((s) => s.status)
  const markApplying = useBuildVersionStore((s) => s.markApplying)
  const clearUpdate = useBuildVersionStore((s) => s.clearUpdate)
  const activities = useCriticalActivityStore((s) => s.activities)

  // Ref to prevent double-apply (React strict mode + fast clicks)
  const applyingRef = useRef(false)
  // Which confirmation dialog is open (if any)
  const [confirmTier, setConfirmTier] = useState<ConfirmTier>('none')

  // ── Apply the build update (controlled reload) ────────────────────────
  const applyUpdate = useCallback(() => {
    if (applyingRef.current) return
    applyingRef.current = true
    markApplying()
    markBuildUpdateReloading()

    // Brief toast so the reload isn't a mystery (only shown after the user
    // explicitly clicks apply — never auto).
    toast.loading('Memperbarui aplikasi ke versi terbaru…', { duration: 4000 })

    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      // No SW controller — just reload directly
      window.location.reload()
      return
    }

    // Ask the SW to take over immediately. The controllerchange listener in
    // useServiceWorker does the reload. As a safety net, also schedule a
    // fallback reload in case the SW doesn't respond in time.
    navigator.serviceWorker.controller.postMessage({
      type: 'AETHER_ACTIVATE_UPDATE',
    })

    // Safety-net: if controllerchange doesn't fire within 4s, reload anyway.
    setTimeout(() => {
      window.location.reload()
    }, 4000)
  }, [markApplying])

  // ── Dismiss (only for 'pending' — hide the banner until activities change) ──
  // We don't truly dismiss a pending update (it'll come back), but we let the
  // user collapse the banner for the current session.
  const dismiss = () => {
    clearUpdate()
    toast.info('Update ditunda. Anda bisa memuat ulang kapan saja dari menu.', {
      duration: 3000,
    })
  }

  const activityList = Object.values(activities)
  const hasInFlight = activityList.some((a) => a.severity === 'in-flight')
  const hasDataLoss = activityList.some((a) => a.severity === 'data-loss')

  const visible = status === 'ready' || status === 'pending'
  const loopGuardOk = canApplyBuildUpdate() // false = already reloaded once

  const openConfirm = () => {
    if (hasInFlight) return // disabled — can't force during in-flight
    if (hasDataLoss) {
      setConfirmTier('hard')
    } else {
      setConfirmTier('simple')
    }
  }

  const onConfirmApply = () => {
    setConfirmTier('none')
    toast.warning('Memuat ulang paksa — perubahan yang belum tersimpan mungkin hilang.', {
      duration: 3000,
    })
    applyUpdate()
  }

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="fixed top-0 left-0 right-0 z-[150] flex justify-center px-3 pt-2 pointer-events-none"
          >
            <div
              className={`pointer-events-auto w-full max-w-2xl rounded-xl border shadow-2xl backdrop-blur-md ${
                status === 'pending'
                  ? 'bg-amber-950/90 border-amber-500/30'
                  : 'bg-cyan-950/90 border-cyan-500/30'
              }`}
            >
              <div className="flex items-start gap-3 p-3.5">
                {/* Icon */}
                <div className="shrink-0 mt-0.5">
                  {status === 'ready' ? (
                    <RefreshCw className="h-5 w-5 text-cyan-300" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-300" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Versi baru tersedia</p>
                  {status === 'pending' && (
                    <>
                      <p className="text-xs text-amber-200/80 mt-0.5">
                        {hasInFlight
                          ? 'Tidak dapat memuat ulang selama transaksi berlangsung. Tunggu hingga selesai.'
                          : hasDataLoss
                            ? 'Perubahan yang belum disimpan akan hilang jika dimuat ulang sekarang.'
                            : 'Ada proses berjalan. Update akan diterapkan otomatis setelah selesai.'}
                      </p>
                      {activityList.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {activityList.slice(0, 4).map((a) => (
                            <span
                              key={a.id}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${
                                a.severity === 'in-flight'
                                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-200'
                                  : a.severity === 'data-loss'
                                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
                                    : 'bg-sky-500/15 border-sky-500/30 text-sky-200'
                              }`}
                            >
                              {a.label}
                            </span>
                          ))}
                          {activityList.length > 4 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] text-amber-300/70">
                              +{activityList.length - 4} lainnya
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {status === 'ready' && (
                    <p className="text-xs text-cyan-200/70 mt-0.5">
                      {loopGuardOk
                        ? 'Klik "Perbarui sekarang" untuk menerapkan versi terbaru.'
                        : 'Pembaruan sebelumnya belum selesai. Coba muat ulang halaman secara manual.'}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {status === 'ready' ? (
                    loopGuardOk ? (
                      <button
                        onClick={applyUpdate}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 px-3 py-1.5 text-xs font-medium text-cyan-100 transition-colors"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Perbarui sekarang
                      </button>
                    ) : (
                      <button
                        onClick={() => window.location.reload()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 px-3 py-1.5 text-xs font-medium text-cyan-100 transition-colors"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Muat ulang
                      </button>
                    )
                  ) : (
                    <>
                      <button
                        onClick={openConfirm}
                        disabled={hasInFlight}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          hasInFlight
                            ? 'bg-white/[0.03] border-white/[0.06] text-slate-500 cursor-not-allowed'
                            : 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/40 text-amber-100'
                        }`}
                        title={
                          hasInFlight
                            ? 'Tidak dapat memuat ulang selama transaksi berlangsung'
                            : undefined
                        }
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Muat ulang paksa
                      </button>
                      <button
                        onClick={dismiss}
                        className="inline-flex items-center justify-center rounded-lg bg-transparent hover:bg-white/5 border border-white/10 p-1.5 text-amber-200/60 hover:text-amber-100 transition-colors"
                        aria-label="Tutup"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {status === 'pending' && hasInFlight && (
                <div className="px-3.5 pb-2.5 -mt-1">
                  <p className="text-[10px] text-rose-300/80">
                    Tidak dapat memuat ulang selama transaksi berlangsung. Tunggu hingga
                    selesai, lalu tombol akan aktif kembali secara otomatis.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Simple confirmation dialog (only interrupt activities) ────────── */}
      <AlertDialog
        open={confirmTier === 'simple'}
        onOpenChange={(open) => !open && setConfirmTier('none')}
      >
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-sm font-semibold">
              Muat ulang sekarang?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              Ada proses aktif yang akan terputus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmApply}
              className="bg-amber-500 hover:bg-amber-600 text-white h-8 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Muat ulang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Hard confirmation dialog (any data-loss activity) ─────────────── */}
      <AlertDialog
        open={confirmTier === 'hard'}
        onOpenChange={(open) => !open && setConfirmTier('none')}
      >
        <AlertDialogContent className="bg-nebula border-white/[0.06]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white text-sm font-semibold">
              Perubahan belum disimpan akan hilang
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-xs">
              Aktivitas aktif:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1.5 text-xs text-slate-300">
            {activityList.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                    a.severity === 'in-flight'
                      ? 'bg-rose-400'
                      : a.severity === 'data-loss'
                        ? 'bg-amber-400'
                        : 'bg-sky-400'
                  }`}
                />
                {a.label}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/[0.04] border-white/[0.04] text-slate-300 hover:bg-white/[0.04] h-8 text-xs">
              Kembali
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmApply}
              className="bg-red-500 hover:bg-red-600 text-white h-8 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tetap muat ulang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
