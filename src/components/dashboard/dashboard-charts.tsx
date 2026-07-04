'use client'

import { motion } from 'framer-motion'

export function HealthRing({ score, size = 'md', onClick }: { score: number; size?: 'sm' | 'md'; onClick?: () => void }) {
  const radius = size === 'sm' ? 18 : 32
  const svgSize = size === 'sm' ? 44 : 72
  const sw = size === 'sm' ? 3 : 4
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color =
    score >= 75 ? 'theme-text' : score >= 50 ? 'text-amber-400' : 'text-red-400'
  const ringColor =
    score >= 75 ? 'stroke-theme-text' : score >= 50 ? 'stroke-amber-400' : 'stroke-red-400'
  const bgColor =
    score >= 75
      ? 'theme-border-light'
      : score >= 50
        ? 'border-amber-500/20'
        : 'border-red-500/20'

  return (
    <div 
      className={`relative ${size === 'sm' ? 'w-11 h-11' : 'w-16 h-16'} border ${bgColor} rounded-full flex items-center justify-center bg-nebula/80 ${onClick ? 'cursor-pointer hover:scale-105 transition-transform' : ''}`}
      onClick={onClick}
    >
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox={`0 0 ${svgSize} ${svgSize}`}>
        <circle
          cx={svgSize / 2}
          cy={svgSize / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-slate-700"
          strokeWidth={sw}
        />
        <circle
          cx={svgSize / 2}
          cy={svgSize / 2}
          r={radius}
          fill="none"
          className={ringColor}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <span className={`font-bold leading-none z-10 ${size === 'sm' ? 'text-xs' : 'text-sm'} ${color}`}>
        {score}
      </span>
    </div>
  )
}

export function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-white/[0.04] overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
      />
    </div>
  )
}

export function Sparkline({ data, color = 'theme-text', height = 40 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const w = data.length * 8
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={w} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={color}
      />
    </svg>
  )
}

export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}