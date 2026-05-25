"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

const DISMISSED_KEY = "pwa-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Listen for the beforeinstallprompt event
  useEffect(() => {
    const handler = (e: Event) => {
      // Prevent the default mini-infobar on mobile
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);

      // Show the install banner unless previously dismissed
      if (localStorage.getItem(DISMISSED_KEY) !== "true") {
        setIsVisible(true);
      }
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Hide banner if app is already installed
    window.addEventListener("appinstalled", () => {
      setIsVisible(false);
      setDeferredPrompt(null);
      localStorage.removeItem(DISMISSED_KEY);
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setIsVisible(false);
    }

    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    localStorage.setItem(DISMISSED_KEY, "true");
  }, []);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl shadow-emerald-500/10">
      <button
        onClick={handleDismiss}
        className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        aria-label="Dismiss install prompt"
      >
        <X className="size-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
          <img
            src="/logo.png"
            alt="Aether POS"
            className="size-7 rounded"
          />
        </div>

        <div className="flex-1 space-y-1.5">
          <p className="text-sm font-medium text-zinc-100">
            Install Aether POS
          </p>
          <p className="text-xs leading-relaxed text-zinc-400">
            Add Aether POS to your home screen for quick access and offline
            support.
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          onClick={handleInstall}
          className="flex-1 bg-emerald-500 text-white hover:bg-emerald-600"
        >
          <Download className="size-4" />
          Install App
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          className="text-zinc-400 hover:text-zinc-200"
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
