'use client'

import { lazy, Suspense, useState, useCallback, useEffect } from 'react'
import { SessionProvider, useSession } from 'next-auth/react'
import { usePageStore } from '@/hooks/use-page-store'
import { useSidebarStore } from '@/components/layout/sidebar'
import { useOnlineStatus, useBlockRefresh } from '@/hooks/use-online-status'
import { usePlan } from '@/hooks/use-plan'
import { PlanProvider } from '@/context/plan-context'
import Sidebar from '@/components/layout/sidebar'
import MobileBottomNav from '@/components/layout/mobile-bottom-nav'
import AuthView from '@/components/auth/auth-view'
import LandingPage from '@/components/landing/landing-page'
import { Loader2, WifiOff, ShieldCheck } from 'lucide-react'
import { ErrorBoundary } from '@/components/shared/error-boundary'
import { MigrationProcessorProvider } from '@/components/migration/migration-processor-provider'
import { MigrationWizard } from '@/components/migration/migration-wizard'
import { MigrationFloatingWidget } from '@/components/migration/migration-floating-widget'

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
  const { currentPage } = usePageStore()
  const { collapsed } = useSidebarStore()
  const [showAuth, setShowAuth] = useState(false)
  const isOnline = useOnlineStatus()

  // Block refresh (F5, Ctrl+R, Cmd+R, beforeunload) when offline
  const isOffline = useCallback(() => !isOnline, [isOnline])
  useBlockRefresh(isOffline)

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
        <AppReadyGate>
          <div className={`bg-deep-space ${currentPage === 'pos' ? 'md:h-screen md:overflow-y-hidden' : 'min-h-screen'}`} data-offline-block>
            {/* Offline Banner */}
            {!isOnline && (
              <div className="fixed top-0 left-0 right-0 z-[100] bg-red-600/95 backdrop-blur-sm border-b border-red-500/50">
                <div className="flex items-center justify-center gap-2 py-1.5 px-4">
                  <WifiOff className="h-3.5 w-3.5 text-white shrink-0" />
                  <span className="text-[11px] text-white font-medium">Mode Offline — Data terakhir yang dimuat masih bisa dilihat. Refresh dinonaktifkan.</span>
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
                  ? 'pb-20 px-3 pt-3 sm:px-4 md:h-full md:pb-0 md:px-3 md:py-2 md:overflow-y-hidden'
                  : 'pb-20 md:pb-0 px-3 sm:px-4 md:py-4 lg:px-5 lg:py-4'
              }`}>
                {renderPage()}
              </div>
            </main>
          </div>
        </AppReadyGate>
        {/* MIG-BATCH-V3: migration dialog + floating widget live in the
            authenticated shell so the batch loop survives page navigation. */}
        <MigrationWizard />
        <MigrationFloatingWidget />
      </MigrationProcessorProvider>
    </PlanProvider>
  )
}

export default function AppShell() {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  )
}