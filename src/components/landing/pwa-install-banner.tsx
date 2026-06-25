"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X, Smartphone, Monitor } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Check if previously dismissed (expires after 7 days)
    const dismissedAt = localStorage.getItem("pwa-banner-dismissed");
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed < 7 * 24 * 60 * 60 * 1000) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDismissed(true);
        return;
      }
    }

    // Detect mobile
    const checkMobile = () => {
      setIsMobile(
        /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        ) || window.innerWidth < 768
      );
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);

    // Capture beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show banner after a short delay so user sees landing page first
      setTimeout(() => setShow(true), 3000);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShow(false);
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShow(false);
    setDismissed(true);
    localStorage.setItem("pwa-banner-dismissed", String(Date.now()));
  }, []);

  // Don't render if not eligible, dismissed, or no prompt event
  if (dismissed || !deferredPrompt) return null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="fixed bottom-0 inset-x-0 z-[60] p-3 sm:p-4"
        >
          <div className="max-w-lg mx-auto aether-card-elevated rounded-2xl p-4 border border-white/[0.08] relative overflow-hidden">
            {/* Subtle glow */}
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-aether-cyan/10 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-aether-purple/10 rounded-full blur-2xl pointer-events-none" />

            <div className="relative flex items-start gap-3">
              {/* Icon */}
              <div className="shrink-0 mt-0.5">
                <div className="aether-gradient-border rounded-xl p-2.5">
                  <div className="aether-gradient rounded-lg p-2">
                    {isMobile ? (
                      <Smartphone className="size-5 text-white" />
                    ) : (
                      <Monitor className="size-5 text-white" />
                    )}
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-slate-100">
                    Install Aether POS
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-aether-cyan bg-aether-cyan/10 px-1.5 py-0.5 rounded">
                    PWA
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {isMobile
                    ? "Akses langsung dari home screen. Cepat, offline-ready, tanpa buka browser."
                    : "Jalankan seperti aplikasi desktop. Buka di jendela terpisah, akses lebih cepat."}
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col items-end gap-2 shrink-0">
                <button
                  onClick={handleDismiss}
                  className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label="Tutup"
                >
                  <X className="size-4" />
                </button>
                <button
                  onClick={handleInstall}
                  className="theme-btn-primary text-xs font-semibold rounded-lg h-8 px-3.5 gap-1.5 border-0 shadow-none"
                >
                  <Download className="size-3.5" />
                  Install
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}