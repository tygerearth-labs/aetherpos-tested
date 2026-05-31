'use client'

import { SessionProvider, useSession } from 'next-auth/react'
import { usePageStore } from '@/hooks/use-page-store'
import { useSidebarStore } from '@/components/layout/sidebar'
import Sidebar from '@/components/layout/sidebar'
import MobileBottomNav from '@/components/layout/mobile-bottom-nav'
import AuthView from '@/components/auth/auth-view'
import DashboardPage from '@/components/pages/dashboard-page'
import ProductsPage from '@/components/pages/products-page'
import CustomersPage from '@/components/pages/customers-page'
import PosPage from '@/components/pages/pos-page'
import TransactionsPage from '@/components/pages/transactions-page'
import AuditLogPage from '@/components/pages/audit-log-page'
import CrewPage from '@/components/pages/crew-page'
import SettingsPage from '@/components/pages/settings-page'
import { Loader2 } from 'lucide-react'

function AppContent() {
  // Reduce session polling to every 5 minutes to prevent premature session expiry detection
  // during offline→online transitions (default is every 5s which is too aggressive)
  const { data: session, status } = useSession({
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes instead of default 5s
    refetchOnWindowFocus: true,
  })
  const { currentPage } = usePageStore()
  const { collapsed } = useSidebarStore()

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin theme-text" />
      </div>
    )
  }

  if (!session) {
    return <AuthView />
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />
      case 'products':
        return <ProductsPage />
      case 'customers':
        return <CustomersPage />
      case 'pos':
        return <PosPage />
      case 'transactions':
        return <TransactionsPage />
      case 'audit-log':
        return <AuditLogPage />
      case 'crew':
        return <CrewPage />
      case 'settings':
        return <SettingsPage />
      default:
        return <DashboardPage />
    }
  }

  return (
    <div className={`bg-zinc-950 ${currentPage === 'pos' ? 'md:h-screen md:overflow-y-hidden' : 'min-h-screen'}`}>
      <Sidebar />
      <MobileBottomNav />
      <main
        className={`transition-all duration-300 ease-in-out ${
          collapsed ? 'md:ml-[68px]' : 'md:ml-64'
        } ${
          currentPage === 'pos' ? 'md:h-full' : 'min-h-screen'
        }`}
      >
        {/* Mobile: bottom padding for nav. Desktop POS: full screen. Others: normal padding */}
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