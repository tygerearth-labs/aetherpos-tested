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
          toast: "bg-zinc-900 border-zinc-800 text-zinc-100 shadow-2xl shadow-black/30",
          title: "text-zinc-100 text-sm font-medium",
          description: "text-zinc-400 text-xs",
          actionButton: "bg-emerald-500 hover:bg-emerald-600 text-white",
          cancelButton: "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700",
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
