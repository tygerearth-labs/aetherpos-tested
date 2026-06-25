'use client'

import { lazy, Suspense, useState } from 'react'
import { SessionProvider, useSession } from 'next-auth/react'
import { usePageStore } from '@/hooks/use-page-store'
import { useSidebarStore } from '@/components/layout/sidebar'
import Sidebar from '@/components/layout/sidebar'
import MobileBottomNav from '@/components/layout/mobile-bottom-nav'
import AuthView from '@/components/auth/auth-view'
import LandingPage from '@/components/landing/landing-page'
import { Loader2 } from 'lucide-react'

// ── Lazy-loaded pages (code splitting for faster initial load) ──
const DashboardPage = lazy(() => import('@/components/pages/dashboard-page'))
const ProductsPage = lazy(() => import('@/components/pages/products-page'))
const CustomersPage = lazy(() => import('@/components/pages/customers-page'))
const PosPage = lazy(() => import('@/components/pages/pos-page'))
const TransactionsPage = lazy(() => import('@/components/pages/transactions-page'))
const AuditLogPage = lazy(() => import('@/components/pages/audit-log-page'))
const CrewPage = lazy(() => import('@/components/pages/crew-page'))
const SettingsPage = lazy(() => import('@/components/pages/settings-page'))

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
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

function AppContent() {
  const { data: session, status } = useSession({
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
  const { currentPage } = usePageStore()
  const { collapsed } = useSidebarStore()
  const [showAuth, setShowAuth] = useState(false)

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
      case 'settings':
        return <LazyPage><SettingsPage /></LazyPage>
      default:
        return <LazyPage><DashboardPage /></LazyPage>
    }
  }

  return (
    <div className={`bg-deep-space ${currentPage === 'pos' ? 'md:h-screen md:overflow-y-hidden' : 'min-h-screen'}`}>
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