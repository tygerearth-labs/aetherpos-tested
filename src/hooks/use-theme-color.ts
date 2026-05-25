'use client'
import { useState, useEffect } from 'react'

const THEME_COLORS: Record<string, { css: string; primary: string; bg: string }> = {
  emerald: { css: '#10b981', primary: '#34d399', bg: '#059669' },
  blue: { css: '#3b82f6', primary: '#60a5fa', bg: '#2563eb' },
  violet: { css: '#8b5cf6', primary: '#a78bfa', bg: '#7c3aed' },
  rose: { css: '#f43f5e', primary: '#fb7185', bg: '#e11d48' },
  amber: { css: '#f59e0b', primary: '#fbbf24', bg: '#d97706' },
  cyan: { css: '#06b6d4', primary: '#22d3ee', bg: '#0891b2' },
}

export function useThemeColor() {
  const [theme, setTheme] = useState<string>('emerald')

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const res = await fetch('/api/settings')
        if (res.ok) {
          const data = await res.json()
          setTheme(data.themePrimaryColor || 'emerald')
        }
      } catch { /* silent */ }
    }
    loadTheme()
  }, [])

  useEffect(() => {
    const colors = THEME_COLORS[theme] || THEME_COLORS.emerald
    document.documentElement.style.setProperty('--theme-primary', colors.primary)
    document.documentElement.style.setProperty('--theme-bg', colors.bg)
    document.documentElement.style.setProperty('--theme-css', colors.css)
  }, [theme])

  return { theme, themeColors: THEME_COLORS[theme] || THEME_COLORS.emerald }
}
