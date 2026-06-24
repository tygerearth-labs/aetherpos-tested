'use client'

import { useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { usePlan, useFeatureGate } from '@/hooks/use-plan'
import { useOutletStore } from '@/hooks/use-outlet-store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Store, Layers } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * OutletSwitcher — Global outlet selector for enterprise multi-outlet users.
 *
 * Fetches the owner's outlets from /api/outlets and renders a Select dropdown
 * that filters data on all pages. Only visible for enterprise users with >1 outlet.
 *
 * Automatically embedded in AppShell above page content.
 */
export default function OutletSwitcher() {
  const { data: session } = useSession()
  const { plan, features, isLoading: planLoading } = usePlan()
  const {
    outlets,
    selectedOutletId,
    isMultiOutlet,
    isLoaded,
    setOutlets,
    setSelectedOutletId,
  } = useOutletStore()

  const isOwner = session?.user?.role === 'OWNER'
  const isEnterprise = plan?.type === 'enterprise'
  const multiOutletFeature = features?.multiOutlet ?? false

  // Fetch outlets
  const fetchOutlets = useCallback(async () => {
    if (!isOwner || !isEnterprise || !multiOutletFeature) return
    try {
      const res = await fetch('/api/outlets')
      if (!res.ok) return
      const data = await res.json()
      const outletList: { id: string; name: string; isPrimary: boolean }[] = data.outlets || []
      const primaryOutlet = outletList.find((o) => o.isPrimary)
      setOutlets(
        outletList.map((o) => ({ id: o.id, name: o.name, isPrimary: o.isPrimary })),
        primaryOutlet?.id || session?.user?.outletId || ''
      )
    } catch {
      // Silently ignore
    }
  }, [isOwner, isEnterprise, multiOutletFeature, setOutlets, session?.user?.outletId])

  useEffect(() => {
    fetchOutlets()
  }, [fetchOutlets])

  // Reset on logout
  useEffect(() => {
    if (!session) {
      useOutletStore.getState().reset()
    }
  }, [session])

  // Don't render if not multi-outlet
  if (planLoading || !isLoaded || !isMultiOutlet) return null
  if (!isEnterprise || !multiOutletFeature) return null

  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
        <Layers className="h-3.5 w-3.5 text-amber-400" />
        <span className="hidden sm:inline font-medium">Outlet:</span>
      </div>
      <Select
        value={selectedOutletId || '__all__'}
        onValueChange={(val) => setSelectedOutletId(val === '__all__' ? null : val)}
      >
        <SelectTrigger className="h-8 w-[200px] sm:w-[260px] text-xs bg-white/[0.03] border-white/[0.06] text-slate-200 rounded-lg">
          <SelectValue placeholder="Pilih outlet..." />
        </SelectTrigger>
        <SelectContent className="bg-slate-800/95 backdrop-blur-sm border-white/[0.08]">
          {/* "All Outlets" option for aggregation pages */}
          <SelectItem value="__all__" className="text-xs text-slate-300 focus:bg-white/[0.06] focus:text-white">
            <div className="flex items-center gap-2">
              <Store className="h-3 w-3 text-amber-400" />
              <span>Semua Outlet</span>
            </div>
          </SelectItem>
          {outlets.map((outlet) => (
            <SelectItem
              key={outlet.id}
              value={outlet.id}
              className="text-xs text-slate-300 focus:bg-white/[0.06] focus:text-white"
            >
              <div className="flex items-center gap-2">
                {outlet.isPrimary && (
                  <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                    UTAMA
                  </span>
                )}
                <span>{outlet.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Loading skeleton for outlet switcher */
export function OutletSwitcherSkeleton() {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Skeleton className="h-4 w-16 bg-white/[0.04]" />
      <Skeleton className="h-8 w-[200px] bg-white/[0.04] rounded-lg" />
    </div>
  )
}