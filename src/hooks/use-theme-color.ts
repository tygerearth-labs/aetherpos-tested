'use client'
import { useState, useEffect } from 'react'

// Full shade palette for each theme color — 9 shades (100–900) + 50
const THEME_COLORS: Record<string, { [shade: number]: string }> = {
  emerald: {
    50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399',
    500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b',
  },
  blue: {
    50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa',
    500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a',
  },
  violet: {
    50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa',
    500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95',
  },
  rose: {
    50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185',
    500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337',
  },
  amber: {
    50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24',
    500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f',
  },
  cyan: {
    50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee',
    500: '#06b6d4', 600: '#0891b2', 700: '#0e7490', 800: '#155e75', 900: '#164e63',
  },
}

// Shorthand accessor
export function getThemeColorMap() {
  return THEME_COLORS
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
    const root = document.documentElement

    // Set individual shade CSS variables
    for (const [shade, hex] of Object.entries(colors)) {
      root.style.setProperty(`--theme-${shade}`, hex)
    }

    // Backward-compat aliases
    root.style.setProperty('--theme-primary', colors[400])
    root.style.setProperty('--theme-css', colors[500])
    root.style.setProperty('--theme-bg', colors[600])

    // Also override shadcn primary/ring/chart-1 so native components theme correctly
    root.style.setProperty('--primary', colors[500])
    root.style.setProperty('--ring', colors[500])
    root.style.setProperty('--chart-1', colors[500])
    root.style.setProperty('--sidebar-primary', colors[500])
    root.style.setProperty('--sidebar-ring', colors[500])

    // Focus ring
    const focusStyle = document.getElementById('theme-focus-style')
    if (focusStyle) {
      focusStyle.textContent = `*:focus-visible{outline-color:${colors[500]};}`
    } else {
      const s = document.createElement('style')
      s.id = 'theme-focus-style'
      s.textContent = `*:focus-visible{outline-color:${colors[500]};}`
      document.head.appendChild(s)
    }
  }, [theme])

  return { theme, themeColors: THEME_COLORS[theme] || THEME_COLORS.emerald }
}
