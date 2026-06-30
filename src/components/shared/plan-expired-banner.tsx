'use client'

import { usePlan } from '@/hooks/use-plan'
import { usePageStore } from '@/hooks/use-page-store'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Crown } from 'lucide-react'

/**
 * PlanExpiredBanner — Shows a warning banner when the plan has expired.
 *
 * For owners: shows a warning that the plan has expired and features
 * are limited, with a link to renew.
 * For branch users: shows a blocking message that the main outlet's
 * plan has expired.
 */
export function PlanExpiredBanner() {
  const { planData, isLoading, isPlanExpired } = usePlan()
  const { setCurrentPage } = usePageStore()

  if (isLoading || !planData) return null

  if (!isPlanExpired) return null

  return (
    <Alert className="mb-4 border-amber-500/30 bg-amber-500/10">
      <AlertTriangle className="h-4 w-4 text-amber-400" />
      <AlertDescription className="text-xs text-amber-300">
        <div className="flex items-center justify-between gap-2">
          <span>
            Langganan {planData.plan.label} telah berakhir. Fitur telah diturunkan ke Free.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] border-amber-500/30 text-amber-300 hover:bg-amber-500/20 shrink-0"
            onClick={() => setCurrentPage('plan')}
          >
            <Crown className="h-3 w-3 mr-1" />
            Perpanjang
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
