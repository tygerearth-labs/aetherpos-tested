'use client'
import { useThemeColor } from '@/hooks/use-theme-color'
import { Loader2 } from 'lucide-react'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { loaded } = useThemeColor()

  if (!loaded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    )
  }

  return <>{children}</>
}