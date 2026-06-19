'use client'
import { useThemeColor } from '@/hooks/use-theme-color'
import { Loader2 } from 'lucide-react'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { loaded } = useThemeColor()

  if (!loaded) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-950">
        <Loader2 className="h-6 w-6 text-zinc-600 animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}