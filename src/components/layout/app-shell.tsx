'use client'

import { useState } from 'react'
import { SessionProvider, useSession } from 'next-auth/react'
import { usePageStore } from '@/hooks/use-page-store'
import { useSidebarStore } from '@/components/layout/sidebar'
import Sidebar from '@/components/layout/sidebar'
import MobileBottomNav from '@/components/layout/mobile-bottom-nav'
import AuthView from '@/components/auth/auth-view'
import LandingPage from '@/components/landing/landing-page'
import DashboardPage from '@/components/pages/dashboard-page'
import ProductsPage from '@/components/pages/products-page'
import CustomersPage from '@/components/pages/customers-page'
import PosPage from '@/components/pages/pos-page'
import TransactionsPage from '@/components/pages/transactions-page'
import AuditLogPage from '@/components/pages/audit-log-page'
import CrewPage from '@/components/pages/crew-page'
import SettingsPage from '@/components/pages/settings-page'
import { Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'

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
