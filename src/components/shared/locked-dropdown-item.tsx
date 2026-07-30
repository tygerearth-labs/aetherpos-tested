'use client'

import { useMemo } from 'react'
import { Crown, Lock } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { usePlan } from '@/hooks/use-plan'
import { usePageStore } from '@/hooks/use-page-store'
import { cn } from '@/lib/utils'

interface LockedDropdownItemProps {
  feature: keyof import('@/lib/plan-config').PlanFeatures
  icon: React.ReactNode
  iconColor: string
  iconHoverColor: string
  title: string
  subtitle: string
  onClick: () => void
}

/**
 * LockedDropdownItem — A DropdownMenuItem that conditionally locks itself
 * for free-plan users, showing a Crown+Lock badge instead.
 *
 * Pro/Enterprise users see the normal clickable item.
 * Free users see a disabled item with a violet lock indicator.
 */
export function LockedDropdownItem({
  feature,
  icon,
  iconColor,
  iconHoverColor,
  title,
  subtitle,
  onClick,
}: LockedDropdownItemProps) {
  const { features, plan, isLoading } = usePlan()
  const { setCurrentPage } = usePageStore()

  const isAvailable = useMemo(() => {
    if (isLoading || !features) return true
    const value = features[feature]
    if (typeof value === 'boolean') return value
    if (Array.isArray(value)) return value.length > 0
    return true
  }, [features, feature, isLoading])

  const isGated = !isAvailable && plan?.type !== 'pro' && plan?.type !== 'enterprise'

  if (!isGated) {
    return (
      <DropdownMenuItem
        onClick={onClick}
        className="flex items-center gap-3 px-2.5 py-2.5 text-xs text-slate-300 hover:bg-white/[0.05] hover:text-white rounded-lg cursor-pointer focus:bg-white/[0.05] focus:text-white group"
      >
        <span className={cn('transition-colors', iconColor, iconHoverColor)}>{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium">{title}</p>
          <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors">{subtitle}</p>
        </div>
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuItem
      disabled
      className="flex items-center gap-3 px-2.5 py-2.5 text-xs rounded-lg group"
      onClick={(e) => { e.preventDefault(); setCurrentPage('plan') }}
    >
      <span className="text-violet-500/50">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-400">{title}</p>
        <p className="text-[10px] text-slate-600">{subtitle}</p>
      </div>
      <span className="inline-flex items-center gap-1 shrink-0">
        <Crown className="h-3 w-3 text-violet-400/70" />
        <Lock className="h-3 w-3 text-violet-500/50" />
      </span>
    </DropdownMenuItem>
  )
}