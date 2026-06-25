'use client'

import { useState, useEffect } from 'react'
import { usePageStore, type PageType } from '@/hooks/use-page-store'
import { usePlan } from '@/hooks/use-plan'
import { useSession } from 'next-auth/react'
import { getPlanLabel, getPlanBadgeClass } from '@/lib/config/plan-config'
import { Badge } from '@/components/ui/badge'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Receipt,
  MoreHorizontal,
  Users,
  ClipboardList,
  Settings,
  UserCog,
  LogOut,
  Lock,
} from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'

// ── Bottom Tab Items ──
interface BottomTab {
  page: PageType
  icon: React.ReactNode
  activeIcon: React.ReactNode
  label: string
}

const bottomTabs: BottomTab[] = [
  {
    page: 'dashboard',
    icon: <LayoutDashboard className="h-[20px] w-[20px]" strokeWidth={1.5} />,
    activeIcon: <LayoutDashboard className="h-[20px] w-[20px]" strokeWidth={1.5} />,
    label: 'Dashboard',
  },
  {
    page: 'products',
    icon: <Package className="h-[20px] w-[20px]" strokeWidth={1.5} />,
    activeIcon: <Package className="h-[20px] w-[20px]" strokeWidth={1.5} />,
    label: 'Produk',
  },
  {
    page: 'pos',
    icon: <ShoppingCart className="h-[20px] w-[20px]" strokeWidth={1.5} />,
    activeIcon: <ShoppingCart className="h-[20px] w-[20px]" strokeWidth={1.5} />,
    label: 'POS',
  },
  {
    page: 'transactions',
    icon: <Receipt className="h-[20px] w-[20px]" strokeWidth={1.5} />,
    activeIcon: <Receipt className="h-[20px] w-[20px]" strokeWidth={1.5} />,
    label: 'Transaksi',
  },
]

// ── More Menu Items ──
interface MoreMenuItem {
  page?: PageType
  icon: React.ReactNode
  label: string
  section?: string
  danger?: boolean
  action?: () => void
}

const allMoreMenuItems: MoreMenuItem[] = [
  { page: 'customers', icon: <Users className="h-[18px] w-[18px]" strokeWidth={1.5} />, label: 'Customers', section: 'Main' },
  { page: 'audit-log', icon: <ClipboardList className="h-[18px] w-[18px]" strokeWidth={1.5} />, label: 'Audit Log', section: 'Admin' },
  { page: 'crew', icon: <UserCog className="h-[18px] w-[18px]" strokeWidth={1.5} />, label: 'Kelola Crew', section: 'Admin' },
  { page: 'settings', icon: <Settings className="h-[18px] w-[18px]" strokeWidth={1.5} />, label: 'Pengaturan', section: 'Admin' },
]

export default function MobileBottomNav() {
  const { currentPage, setCurrentPage } = usePageStore()
  const { data: session } = useSession()
  const { plan, isSuspended, isLoading: planLoading } = usePlan()
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const isOwner = session?.user?.role === 'OWNER'

  // ---- Crew permission-based access ----
  const [allowedPages, setAllowedPages] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (isOwner) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/settings/permissions/my')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setAllowedPages(new Set((data.pages as string).split(',').filter(Boolean)))
        } else {
          if (!cancelled) setAllowedPages(new Set(['pos']))
        }
      } catch {
        if (!cancelled) setAllowedPages(new Set(['pos']))
      }
    })()
    return () => { cancelled = true }
  }, [isOwner])

  const hasAccess = (page?: PageType): boolean => {
    if (!page) return true
    return isOwner || !allowedPages || allowedPages.has(page)
  }

  const handleNav = (page: PageType) => {
    setCurrentPage(page)
    setMoreOpen(false)
  }

  const handleSignOut = async () => {
    try {
      document.cookie.split(';').forEach(c => {
        const name = c.trim().split('=')[0]
        if (name.startsWith('next-auth') || name.startsWith('__Secure-next-auth')) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
        }
      })
      await signOut({ callbackUrl: '/', redirect: false })
    } catch {
      document.cookie.split(';').forEach(c => {
        const name = c.trim().split('=')[0]
        if (name.startsWith('next-auth') || name.startsWith('__Secure-next-auth')) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
        }
      })
    }
    router.push('/')
    router.refresh()
    window.location.href = '/'
  }

  const moreItems = allMoreMenuItems
  const sections = ['Main', 'Admin']

  const isActive = (page: PageType) => currentPage === page
  const isMoreActive = !bottomTabs.some(t => t.page === currentPage)

  return (
    <>
      {/* ── Bottom Tab Bar ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
        <div className="bg-deep-space/90 backdrop-blur-xl border-t border-white/[0.04]">
          <div className="flex items-end justify-around px-1 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
            {bottomTabs.map((tab) => {
              const active = isActive(tab.page)

              return (
                <button
                  key={tab.page}
                  onClick={() => handleNav(tab.page)}
                  className={`relative flex flex-col items-center gap-0.5 min-w-[56px] py-1 px-2 rounded-xl transition-all duration-200 active:scale-95 ${
                    active
                      ? 'text-white'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {/* Active indicator — gradient pill */}
                  {active && (
                    <motion.div
                      layoutId="activeTabPill"
                      className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-[2.5px] rounded-full w-6 aether-gradient"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative">
                    {tab.icon}
                  </span>
                  <span className={`text-[10px] font-medium leading-tight transition-colors ${
                    active ? 'text-white' : 'text-slate-600'
                  }`}>
                    {tab.label}
                  </span>
                </button>
              )
            })}

            {/* More Button */}
            <button
              onClick={() => setMoreOpen(true)}
              className={`relative flex flex-col items-center gap-0.5 min-w-[56px] py-1 px-2 rounded-xl transition-all duration-200 active:scale-95 ${
                isMoreActive
                  ? 'text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {isMoreActive && (
                <motion.div
                  layoutId="activeTabPill"
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-[2.5px] rounded-full w-6 aether-gradient"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <MoreHorizontal className="h-[20px] w-[20px]" strokeWidth={1.5} />
              <span className={`text-[10px] font-medium leading-tight transition-colors ${
                isMoreActive ? 'text-white' : 'text-slate-600'
              }`}>
                Lainnya
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* ── More Menu Sheet ── */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="bg-deep-space border-white/[0.06] rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 max-h-[70vh]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Menu Lainnya</SheetTitle>
            <SheetDescription>Navigasi tambahan</SheetDescription>
          </SheetHeader>

          {/* Drag Handle */}
          <div className="flex justify-center mb-3">
            <div className="w-10 h-1 rounded-full bg-white/[0.08]" />
          </div>

          {/* User Info Card */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] mb-4">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-500/20 to-cyan-500/20 flex items-center justify-center text-cyan-300 text-xs font-bold shrink-0 border border-white/[0.06]">
              {session?.user?.name
                ? session.user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
                : 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white truncate">
                  {session?.user?.name || 'User'}
                </p>
                {!planLoading && plan && (
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1.5 py-0 leading-none border shrink-0 ${
                      isSuspended
                        ? 'bg-red-500/10 border-red-500/20 text-red-400'
                        : getPlanBadgeClass(plan.type)
                    }`}
                  >
                    {isSuspended ? 'Suspended' : getPlanLabel(plan.type)}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                {session?.user?.role === 'OWNER' ? 'Owner' : 'Crew'}
              </p>
            </div>
          </div>

          {/* Menu Items by Section */}
          <div className="space-y-4">
            {sections.map((section) => {
              const sectionItems = moreItems.filter(i => i.section === section)
              if (sectionItems.length === 0) return null
              return (
                <div key={section}>
                  <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.12em] mb-1.5 px-1">
                    {section}
                  </p>
                  <div className="space-y-0.5">
                    {sectionItems.map((item) => {
                      const locked = item.page ? !hasAccess(item.page) : false
                      return (
                        <button
                          key={item.page || item.label}
                          onClick={() => !locked && (item.action ? item.action() : item.page && handleNav(item.page))}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 ${
                            locked
                              ? 'opacity-30 cursor-not-allowed pointer-events-none'
                              : item.page && isActive(item.page)
                                ? 'bg-white/[0.06] text-white'
                                : item.danger
                                  ? 'text-red-400 hover:bg-red-500/[0.04]'
                                  : 'text-slate-300 hover:bg-white/[0.03]'
                          }`}
                        >
                          <span className={`shrink-0 ${
                            locked
                              ? 'text-slate-600'
                              : item.page && isActive(item.page)
                                ? 'text-white'
                                : item.danger
                                  ? 'text-red-400'
                                  : 'text-slate-500'
                          }`}>
                            {item.icon}
                          </span>
                          <span className="text-sm font-medium flex-1">{item.label}</span>
                          {locked && (
                            <Lock className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                          )}
                          {!locked && item.page && isActive(item.page) && (
                            <motion.div
                              layoutId="more-menu-dot"
                              className="ml-auto w-1.5 h-1.5 rounded-full aether-gradient"
                              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Sign Out */}
            <div className="pt-2 border-t border-white/[0.04]">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-red-400 hover:bg-red-500/[0.04] transition-all duration-200"
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                <span className="text-sm font-medium">Sign Out</span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
