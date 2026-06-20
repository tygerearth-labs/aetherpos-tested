"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"
import { useIsMobile } from "@/hooks/use-mobile"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const isMobile = useIsMobile()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={isMobile ? "top-center" : "bottom-right"}
      toastOptions={{
        classNames: {
          toast: "bg-nebula border-white/[0.06] text-white shadow-2xl shadow-black/30",
          title: "text-white text-sm font-medium",
          description: "text-slate-400 text-xs",
          actionButton: "theme-bg theme-hover text-white",
          cancelButton: "bg-white/[0.04] hover:bg-zinc-700 text-slate-300 border-zinc-700",
        },
      }}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
