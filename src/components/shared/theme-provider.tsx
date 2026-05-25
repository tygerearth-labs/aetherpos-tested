'use client'
import { useThemeColor } from '@/hooks/use-theme-color'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useThemeColor()
  return <>{children}</>
}
