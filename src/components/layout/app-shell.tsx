'use client'

import { lazy, Suspense, useState, useCallback, Component, type ReactNode, type ErrorInfo } from 'react'
import { SessionProvider, useSession } from 'next-auth/react'
import { usePageStore } from '@/hooks/use-page-store'
import { useSidebarStore } from '@/components/layout/sidebar'
import { useOnlineStatus, useBlockRefresh } from '@/hooks/use-online-status'
import Sidebar from '@/components/layout/sidebar'
import MobileBottomNav from '@/components/layout/mobile-bottom-nav'
import AuthView from '@/components/auth/auth-view'
import LandingPage from '@/components/landing/landing-page'
import { Loader2, WifiOff } from 'lucide-react'

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
const MultiOutletTerminalPage = lazy(() => import('@/components/pages/multi-outlet-terminal-page'))

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

function PageErrorBoundary({ children }: { children: ReactNode }) {
  return <InnerErrorBoundary>{children}</InnerErrorBoundary>
}

class InnerErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; info: string }> {
  state = { error: null, info: '' }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, info.componentStack)
    this.setState({ info: info.componentStack })
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 space-y-4 max-w-2xl mx-auto">
          <p className="text-red-400 text-sm font-semibold">⚠️ Client-side Error</p>
          <pre className="text-xs text-red-300 bg-red-500/10 p-4 rounded-lg whitespace-pre-wrap break-all">{this.state.error.message}</pre>
          <pre className="text-[10px] text-slate-500 bg-white/[0.03] p-4 rounded-lg whitespace-pre-wrap break-all max-h-60 overflow-y-auto">{this.state.error.stack}</pre>
          {this.state.info && <pre className="text-[10px] text-slate-600 bg-white/[0.02] p-3 rounded-lg whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{this.state.info}</pre>}
          <button className="text-xs text-emerald-400 hover:text-emerald-300 underline" onClick={() => this.setState({ error: null, info: '' })}>Try Again</button>
        </div>
      )
    }
    return this.props.children
  }
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}><PageErrorBoundary>{children}</PageErrorBoundary></Suspense>
}

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

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-deep-space flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.png" alt="AETHER" className="h-8 w-8 rounded-lg object-contain animate-pulse" />
          <span className="text-[10px] text-slate-600 uppercase tracking-[0.15em] font-medium">Initializing</span>
        </div>
      </div>
    )
  }

  if (!session) {
    if (showAuth) {
      return <AuthView />
    }
    return <LandingPage onGetStarted={() => setShowAuth(true)} />
  }

  const renderPage = () => {
    // key forces full unmount/remount on page switch, preventing stale state
    const pageKey = currentPage
    switch (currentPage) {
      case 'dashboard':
        return <LazyPage key={pageKey}><DashboardPage /></LazyPage>
      case 'products':
        return <LazyPage key={pageKey}><ProductsPage /></LazyPage>
      case 'customers':
        return <LazyPage key={pageKey}><CustomersPage /></LazyPage>
      case 'pos':
        return <LazyPage key={pageKey}><PosPage /></LazyPage>
      case 'transactions':
        return <LazyPage key={pageKey}><TransactionsPage /></LazyPage>
      case 'audit-log':
        return <LazyPage key={pageKey}><AuditLogPage /></LazyPage>
      case 'crew':
        return <LazyPage key={pageKey}><CrewPage /></LazyPage>
      case 'plan':
        return <LazyPage key={pageKey}><PlanPage /></LazyPage>
      case 'transfer':
        return <LazyPage key={pageKey}><TransferPage /></LazyPage>
      case 'multi-outlet':
        return <LazyPage key={pageKey}><MultiOutletTerminalPage /></LazyPage>
      case 'settings':
        return <LazyPage key={pageKey}><SettingsPage /></LazyPage>
      default:
        return <LazyPage key={pageKey}><DashboardPage /></LazyPage>
    }
  }

  return (
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
  )
}

export default function AppShell() {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  )
}