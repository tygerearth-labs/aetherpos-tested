'use client'

import { lazy, Suspense, useState, useCallback, useEffect } from 'react'
import { SessionProvider, useSession } from 'next-auth/react'
import { usePageStore } from '@/hooks/use-page-store'
import { useSidebarStore } from '@/components/layout/sidebar'
import { useOnlineStatus, useBlockRefresh } from '@/hooks/use-online-status'
import { usePlan } from '@/hooks/use-plan'
import { useRoutePrefetch } from '@/hooks/use-route-prefetch'
import { PlanProvider } from '@/context/plan-context'
import Sidebar from '@/components/layout/sidebar'
import MobileBottomNav from '@/components/layout/mobile-bottom-nav'
import AuthView from '@/components/auth/auth-view'
import LandingPage from '@/components/landing/landing-page'
import { Loader2, WifiOff, ShieldCheck } from 'lucide-react'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { OfflineRouteBlocker } from '@/components/shared/offline-route-blocker'
import { MigrationProcessorProvider } from '@/components/migration/migration-processor-provider'
import { MigrationWizard } from '@/components/migration/migration-wizard'
import { MigrationFloatingWidget } from '@/components/migration/migration-floating-widget'
import { BulkWorkerProvider } from '@/components/bulk-engine/bulk-worker-provider'
import { BulkUploadDialog } from '@/components/bulk-engine/bulk-upload-dialog'
import { BulkFloatingWidget } from '@/components/bulk-engine/bulk-floating-widget'
import { BulkQueueDrawer } from '@/components/bulk-engine/bulk-queue-drawer'
import { navigateUnchecked } from '@/lib/navigate'
import { getRouteCapability } from '@/lib/route-capability'
import { hasCriticalActivity } from '@/lib/build-guard/critical-activity-registry'
import { useBuildVersionStore, resetBuildUpdateReloadGuard } from '@/lib/build-guard/build-version-store'
import { UpdateBanner } from '@/components/shared/update-banner'
import { useCriticalActivity } from '@/hooks/use-critical-activity'
import { useOutboxPending } from '@/hooks/use-outbox-pending'

// ── Lazy-loaded pages (code splitting for faster initial load) ──
const DashboardPage = lazy(() => import('@/components/pages/dashboard-page'))
const ProductsPage = lazy(() => import('@/components/pages/products-page'))
const CustomersPage = lazy(() => import('@/components/pages/customers-page'))
const PosPage = lazy(() => import('@/components/pages/pos-page'))
const TransactionsPage = lazy(() => import('@/components/pages/transactions-page'))
const AuditLogPage = lazy(() => import('@/components/pages/audit-log-page'))
const CrewPage = lazy(() => import('@/components/pages/crew-page'))
const SettingsPage = lazy(() => import('@/components/pages/settings-page'))
const PlanPage = lazy(() => import('@/components/pages/plan-page'))
const TransferPage = lazy(() => import('@/components/pages/transfer-page'))
const PurchasePage = lazy(() => import('@/components/pages/purchase-page'))
const MultiOutletTerminalPage = lazy(() => import('@/components/pages/multi-outlet-terminal-page'))
const InventoryMovementPage = lazy(() => import('@/components/pages/inventory-movement-page'))
const StockOpnamePage = lazy(() => import('@/components/pages/stock-opname-page'))

// ── Page-level Suspense fallback ──
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        <span className="text-xs text-slate-600">Loading...</span>
      </div>
    </div>
  )
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

// ── Init Loading Screen (session loading) ──
function InitScreen() {
  return (
    <div className="min-h-screen bg-deep-space flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <img src="/logo.png" alt="AETHER" className="h-8 w-8 rounded-lg object-contain animate-pulse" />
        <span className="text-[10px] text-slate-600 uppercase tracking-[0.15em] font-medium">Initializing</span>
      </div>
    </div>
  )
}

// ── App Ready Gate — waits for plan + permissions before rendering UI ──
function AppReadyGate({ children }: { children: React.ReactNode }) {
  const { plan, features, isLoading: planLoading } = usePlan()
  const { data: session } = useSession()
  const isOwner = session?.user?.role === 'OWNER'
  const [permissionsReady, setPermissionsReady] = useState(false)

  // Fetch permissions for crew users
  useEffect(() => {
    if (isOwner) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPermissionsReady(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await fetch('/api/settings/permissions/my')
      } catch { /* fallback */ }
      if (!cancelled) setPermissionsReady(true)
    })()
    return () => { cancelled = true }
  }, [isOwner])

  const ready = !planLoading && permissionsReady

  if (!ready) {
    return (
      <div className="min-h-screen bg-deep-space flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500/70" />
            <ShieldCheck className="h-4 w-4 text-emerald-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[11px] text-slate-400 font-medium">
              {planLoading ? 'Verifying account plan...' : 'Loading permissions...'}
            </span>
            {plan && (
              <span className="text-[9px] text-slate-600">
                {plan.label} {plan.isSuspended && '(Suspended)'}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

// ── Main App Content ──
function AppContent() {
  const { data: session, status } = useSession({
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
  const { currentPage, blockedPage, setBlockedPage } = usePageStore()
  const { collapsed } = useSidebarStore()
  const [showAuth, setShowAuth] = useState(false)
  const isOnline = useOnlineStatus()
  const updateStatus = useBuildVersionStore((s) => s.status)
  const updateBannerVisible = updateStatus === 'ready' || updateStatus === 'pending'

  // ── Critical activity: outbox has unsynced local transactions ──
  //
  // The Dexie `syncQueue` table holds PENDING/FAILED rows for transactions
  // and other mutations written locally while offline (or while a sync was
  // in flight). Reloading doesn't lose them (Dexie survives reload) but a
  // build update applied mid-outbox could mask a sync failure. Register as
  // 'interrupt' — warn the user, but allow the update to apply once they
  // acknowledge (the outbox will retry on next online window).
  const pendingOutboxCount = useOutboxPending()
  useCriticalActivity(
    'outbox-sync',
    'outbox-sync',
    'Sinkronisasi transaksi lokal',
    pendingOutboxCount > 0,
    'interrupt',
  )

  // Prefetch priority route chunks while online + idle
  useRoutePrefetch()

  // Block refresh (F5, Ctrl+R, Cmd+R, beforeunload) when offline OR when
  // critical activities are active (POS cart, bulk job, dirty form, etc.) so
  // the user doesn't accidentally lose unsaved work.
  const shouldBlock = useCallback(() => {
    if (!isOnline) return true
    return hasCriticalActivity()
  }, [isOnline])
  useBlockRefresh(shouldBlock)

  // ── Build update lifecycle: auto-apply when 'ready', reset guard on mount ──
  //
  // On mount, clear the build-update reload guard so a fresh session can
  // auto-apply future updates (prevents a stale guard from blocking the next
  // update after a successful reload).
  useEffect(() => {
    resetBuildUpdateReloadGuard()
    // E2E TEST DEBUG HOOK — expose build-guard stores on window so the
    // agent-browser E2E test can drive the update lifecycle without needing a
    // real build deployment. Safe to keep in production (read-only-ish — only
    // exposes store getters + existing actions, no new mutations).
    try {
      const w = window as unknown as { __aetherBuildGuard?: unknown }
      w.__aetherBuildGuard = {
        setClientBuildId: (id: string) =>
          useBuildVersionStore.getState().setClientBuildId(id),
        reportServerBuildId: (id: string) =>
          useBuildVersionStore.getState().reportServerBuildId(id),
        markReady: () => useBuildVersionStore.getState().markReady(),
        markPending: () => useBuildVersionStore.getState().markPending(),
        markApplying: () => useBuildVersionStore.getState().markApplying(),
        clearUpdate: () => useBuildVersionStore.getState().clearUpdate(),
        getStatus: () => useBuildVersionStore.getState(),
        resetReloadGuard: () => resetBuildUpdateReloadGuard(),
      }
    } catch {
      /* best-effort — window may be unavailable in some test contexts */
    }
    // Expose critical-activity store via dynamic import (avoids circular dep)
    void import('@/lib/build-guard/critical-activity-registry').then(
      ({ useCriticalActivityStore }) => {
        try {
          const w = window as unknown as {
            __aetherBuildGuard?: Record<string, unknown>
          }
          w.__aetherBuildGuard = {
            ...(w.__aetherBuildGuard || {}),
            registerActivity: (
              id: string,
              type: string,
              label: string,
              severity: string,
            ) =>
              useCriticalActivityStore.getState().register(
                id,
                type as never,
                label,
                severity as never,
              ),
            unregisterActivity: (id: string) =>
              useCriticalActivityStore.getState().unregister(id),
            getActivities: () => useCriticalActivityStore.getState().activities,
          }
        } catch {
          /* ignore */
        }
      },
    )
  }, [])

  // Auto-clear blocked page when we come back online
  useEffect(() => {
    if (isOnline && blockedPage) {
      setBlockedPage(null)
    }
  }, [isOnline, blockedPage, setBlockedPage])

  // Gate 1: Session loading
  if (status === 'loading') {
    return <InitScreen />
  }

  // Gate 2: Not authenticated
  if (!session) {
    if (showAuth) {
      return <AuthView />
    }
    return <LandingPage onGetStarted={() => setShowAuth(true)} />
  }

  // Gate 3: Authenticated — wrap in PlanProvider + AppReadyGate
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <LazyPage><DashboardPage /></LazyPage>
      case 'products':
        return <LazyPage><ProductsPage /></LazyPage>
      case 'customers':
        return <LazyPage><CustomersPage /></LazyPage>
      case 'pos':
        return <LazyPage><PosPage /></LazyPage>
      case 'transactions':
        return <LazyPage><TransactionsPage /></LazyPage>
      case 'audit-log':
        return <LazyPage><AuditLogPage /></LazyPage>
      case 'crew':
        return <LazyPage><CrewPage /></LazyPage>
      case 'plan':
        return <LazyPage><PlanPage /></LazyPage>
      case 'transfer':
        return <LazyPage><TransferPage /></LazyPage>
      case 'purchase':
        return <LazyPage><PurchasePage /></LazyPage>
      case 'multi-outlet':
        return <LazyPage><MultiOutletTerminalPage /></LazyPage>
      case 'settings':
        return <LazyPage><SettingsPage /></LazyPage>
      case 'inventory-movement':
        return <LazyPage><InventoryMovementPage /></LazyPage>
      case 'stock-opname':
        return <LazyPage><StockOpnamePage /></LazyPage>
      default:
        return <LazyPage><DashboardPage /></LazyPage>
    }
  }

  return (
    <PlanProvider>
      <MigrationProcessorProvider>
        <BulkWorkerProvider>
          <AppReadyGate>
            <div className={`bg-deep-space ${currentPage === 'pos' ? 'md:h-screen md:overflow-y-hidden' : 'min-h-screen'}`} data-offline-block>
              {/* Build Update Banner — activity-aware (shows when ready/pending) */}
              <UpdateBanner />
              {/* Offline Banner */}
              {!isOnline && (
                <div className={`fixed left-0 right-0 z-[100] bg-red-600/95 backdrop-blur-sm border-b border-red-500/50 ${updateBannerVisible ? 'top-14' : 'top-0'}`}>
                  <div className="flex items-center justify-center gap-2 py-1.5 px-4">
                    <WifiOff className="h-3.5 w-3.5 text-white shrink-0" />
                    <span className="text-[11px] text-white font-medium">Mode Offline — POS tersedia, transaksi tersimpan lokal. Beberapa halaman memerlukan koneksi.</span>
                  </div>
                </div>
              )}
              <Sidebar />
              <MobileBottomNav />
              <main
                className={`transition-all duration-300 ease-out ${
                  collapsed ? 'md:ml-[68px]' : 'md:ml-[260px]'
                } ${
                  currentPage === 'pos' ? 'md:h-full' : 'min-h-screen'
                }`}
              >
                <div className={`max-w-full ${
                  currentPage === 'pos'
                    ? 'pb-20 md:h-full md:pb-0 md:px-3 md:py-2 md:overflow-y-hidden'
                    : 'pb-20 md:pb-0 px-3 sm:px-4 md:py-4 lg:px-5 lg:py-4'
                }`}>
                  {renderPage()}
                </div>
              </main>
            </div>
          </AppReadyGate>
          {/* OfflineRouteBlocker: intentional dialog when the user tries to
              navigate to an ONLINE_ONLY route while offline. The navigation
              is blocked BEFORE the dynamic import, so no ChunkLoadError. */}
          <OfflineRouteBlocker
            blocked={blockedPage ? { page: blockedPage, capability: getRouteCapability(blockedPage) } : null}
            onDismiss={() => setBlockedPage(null)}
          />
          {/* MIG-BATCH-V3: migration dialog + floating widget live in the
              authenticated shell so the batch loop survives page navigation. */}
          <MigrationWizard />
          <MigrationFloatingWidget />
          {/* AETHER BULK ENGINE V1: universal bulk dialog + widget + drawer.
              Siblings of the migration components so the worker survives nav. */}
          <BulkUploadDialog />
          <BulkFloatingWidget />
          <BulkQueueDrawer />
        </BulkWorkerProvider>
      </MigrationProcessorProvider>
    </PlanProvider>
  )
}

interface AppShellProps {
  /** Initial session from the server (avoids client-side fetch round-trip). */
  session?: ReturnType<typeof useSession>['data'] | null
}

export default function AppShell({ session }: AppShellProps) {
  return (
    <SessionProvider session={session}>
      <AppContent />
    </SessionProvider>
  )
}