'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { usePageStore, type PageType } from '@/hooks/use-page-store'
import { usePlan } from '@/hooks/use-plan'
import { getPlanBadgeClass } from '@/lib/config/plan-config'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import {
  LayoutDashboard,
  Package,
  Users,
  ShoppingCart,
  Receipt,
  ClipboardList,
  LogOut,
  Settings,
  ShieldAlert,
  PanelLeftClose,
  PanelLeft,
  UserCog,
  Lock,
  Command,
  Crown,
} from 'lucide-react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { create } from 'zustand'

// ============================================================
// Sidebar Collapsed State (shared with AppShell for margin)
// ============================================================

interface SidebarState {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: false,
  setCollapsed: (collapsed) => set({ collapsed }),
}))

// ============================================================
// Types
// ============================================================

interface NavItem {
  label: string
  icon: React.ReactNode
  page: PageType
  shortLabel: string
  section?: 'main' | 'operations' | 'admin'
}

// ============================================================
// Navigation Configuration
// ============================================================

const navItems: NavItem[] = [
  { label: 'Dashboard', shortLabel: 'Dash', icon: <LayoutDashboard className="h-[18px] w-[18px]" strokeWidth={1.5} />, page: 'dashboard', section: 'main' },
  { label: 'Products', shortLabel: 'Prod', icon: <Package className="h-[18px] w-[18px]" strokeWidth={1.5} />, page: 'products', section: 'main' },
  { label: 'Customers', shortLabel: 'Cust', icon: <Users className="h-[18px] w-[18px]" strokeWidth={1.5} />, page: 'customers', section: 'main' },
  { label: 'POS', shortLabel: 'POS', icon: <ShoppingCart className="h-[18px] w-[18px]" strokeWidth={1.5} />, page: 'pos', section: 'operations' },
  { label: 'Transactions', shortLabel: 'Txn', icon: <Receipt className="h-[18px] w-[18px]" strokeWidth={1.5} />, page: 'transactions', section: 'operations' },
  { label: 'Audit Log', shortLabel: 'Log', icon: <ClipboardList className="h-[18px] w-[18px]" strokeWidth={1.5} />, page: 'audit-log', section: 'admin' },
  { label: 'Kelola Crew', shortLabel: 'Crew', icon: <UserCog className="h-[18px] w-[18px]" strokeWidth={1.5} />, page: 'crew', section: 'admin' },
  { label: 'Plan & Pricing', shortLabel: 'Plan', icon: <Crown className="h-[18px] w-[18px]" strokeWidth={1.5} />, page: 'plan', section: 'admin' },
  { label: 'Pengaturan', shortLabel: 'Set', icon: <Settings className="h-[18px] w-[18px]" strokeWidth={1.5} />, page: 'settings', section: 'admin' },
]

const sectionLabels: Record<string, string> = {
  main: 'Main',
  operations: 'Operations',
  admin: 'Admin',
}

// ============================================================
// Framer Motion Variants
// ============================================================

const mobileGroupVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.1 + i * 0.05, duration: 0.3, ease: [0.25, 0.1, 0.25, 1] },
  }),
}

// ============================================================
// Sidebar Content
// ============================================================

function SidebarContent({ collapsed = false, onNavigate, onToggleCollapse, isMobile = false }: {
  collapsed?: boolean
  onNavigate?: () => void
  onToggleCollapse?: () => void
  isMobile?: boolean
}) {
  const { data: session } = useSession()
  const { currentPage, setCurrentPage } = usePageStore()
  const { plan, isSuspended } = usePlan()
  const router = useRouter()

  // ---- Crew permission-based filtering ----
  const userRole = session?.user?.role || 'CREW'
  const isOwner = userRole === 'OWNER'

  const [allowedPages, setAllowedPages] = useState<string[] | null>(null)
  const [permissionsLoaded, setPermissionsLoaded] = useState(false)

  const fetchPermissions = useCallback(async () => {
    if (isOwner) {
      setAllowedPages(null) // OWNER sees everything
      setPermissionsLoaded(true)
      return
    }
    try {
      const res = await fetch('/api/settings/permissions/my')
      if (res.ok) {
        const data = await res.json()
        const pages = (data.pages as string).split(',').filter(Boolean)
        setAllowedPages(pages)
      } else {
        setAllowedPages(['pos'])
      }
    } catch {
      setAllowedPages(['pos'])
    } finally {
      setPermissionsLoaded(true)
    }
  }, [isOwner])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPermissions()
  }, [fetchPermissions])

  // Page guard: redirect crew if they navigate to unauthorized page
  useEffect(() => {
    if (permissionsLoaded && !isOwner && allowedPages && currentPage) {
      if (!allowedPages.includes(currentPage)) {
        setCurrentPage('pos')
      }
    }
  }, [permissionsLoaded, isOwner, allowedPages, currentPage, setCurrentPage])

  // Build access map
  const navItemAccess = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const item of navItems) {
      map.set(item.page, isOwner || !allowedPages || allowedPages.includes(item.page))
    }
    return map
  }, [isOwner, allowedPages])

  // Group all items by section
  const groupedItems = useMemo(() => {
    const groups: { key: string; label: string; items: NavItem[] }[] = []
    const seen = new Set<string>()
    for (const item of navItems) {
      const sec = item.section || 'main'
      if (!seen.has(sec)) {
        seen.add(sec)
        groups.push({ key: sec, label: sectionLabels[sec] || sec, items: [] })
      }
      groups[groups.length - 1].items.push(item)
    }
    return groups
  }, [navItemAccess])

  const handleNav = (page: PageType) => {
    if (isOwner || !allowedPages || allowedPages.includes(page)) {
      setCurrentPage(page)
      onNavigate?.()
    }
  }

  const userInitials = session?.user?.name
    ? session.user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

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

  // ---- Render nav button ----
  const renderNavButton = (item: NavItem) => {
    const isActive = currentPage === item.page
    const isCompact = collapsed && !isMobile
    const isLocked = permissionsLoaded && !navItemAccess.get(item.page)

    const btn = (
      <motion.button
        onClick={() => !isLocked && handleNav(item.page)}
        whileTap={{ scale: 0.97 }}
        className={`group relative w-full flex items-center gap-3 rounded-lg text-[13px] font-medium transition-all duration-200 ${
          isCompact ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'
        } ${
          isLocked
            ? 'opacity-30 cursor-not-allowed pointer-events-none'
            : isActive
              ? 'bg-white/[0.06] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
              : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
        }`}
      >
        {isActive && !isCompact && !isLocked && (
          <motion.span
            layoutId="sidebar-active-indicator"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-4 rounded-r-full"
            style={{
              background: 'linear-gradient(180deg, #EC4899, #8B5CF6, #06B6D4)',
            }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          />
        )}
        <span className={`shrink-0 transition-colors duration-200 ${
          isLocked
            ? 'text-slate-600'
            : isActive
              ? 'text-white'
              : 'text-slate-500 group-hover:text-slate-300'
        }`}>
          {item.icon}
        </span>
        {!isCompact && (
          <span className="truncate flex-1">{item.label}</span>
        )}
        {!isCompact && isLocked && (
          <Lock className="h-3 w-3 shrink-0 text-slate-600" />
        )}
        {isCompact && isLocked && (
          <Lock className="h-3 w-3 absolute -top-0.5 -right-0.5 text-slate-500" />
        )}
      </motion.button>
    )

    if (isCompact) {
      return (
        <TooltipProvider key={item.page} delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={12}
              className="bg-slate-800 text-slate-100 border border-white/[0.06] shadow-xl rounded-lg px-3 py-1.5"
            >
              {item.label}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }

    return <div key={item.page}>{btn}</div>
  }

  const isCompact = collapsed && !isMobile

  return (
    <div className="flex flex-col h-full bg-deep-space">
      {/* Gradient accent line at top */}
      <div className="h-[2px] shrink-0 aether-gradient" />

      {/* Logo Header */}
      <div className={`flex items-center shrink-0 h-14 border-b border-white/[0.04] ${
        isCompact ? 'justify-center gap-1 px-2' : 'gap-3 px-4'
      }`}>
        <img
          src="/logo.png"
          alt="AETHER"
          className="h-7 w-7 rounded-lg shrink-0 object-contain"
        />
        {!isCompact && (
          <div className="min-w-0 flex-1">
            <h1 className="text-[13px] font-bold text-white tracking-tight leading-none" style={{ fontFamily: 'var(--font-geist-sans)' }}>
              AETHER
            </h1>
            <p className="text-[9px] text-slate-500 uppercase tracking-[0.18em] mt-0.5 font-medium">
              Mission Control
            </p>
          </div>
        )}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={`shrink-0 flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] transition-all duration-200 ${
              isCompact ? 'ml-0' : 'ml-auto'
            }`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> : <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.5} />}
          </button>
        )}
      </div>

      {/* Command hint */}
      {!isCompact && (
        <div className="px-4 py-2 border-b border-white/[0.03]">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] text-slate-500">
            <Command className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="text-[10px] font-medium">Command Menu</span>
            <span className="ml-auto text-[9px] font-mono text-slate-600 bg-white/[0.04] px-1.5 py-0.5 rounded">⌘K</span>
          </div>
        </div>
      )}

      {/* Navigation */}
      <ScrollArea className="flex-1 px-2 py-3">
        {groupedItems.map((group, groupIdx) => {
          const showSection = !isCompact
          const wrapper = isMobile ? (
            <motion.div
              key={group.key}
              custom={groupIdx}
              variants={mobileGroupVariants}
              initial="hidden"
              animate="visible"
              className={groupIdx > 0 ? 'mt-5' : ''}
            >
              {renderSectionContent(group, showSection, groupIdx)}
            </motion.div>
          ) : (
            <div key={group.key} className={groupIdx > 0 ? 'mt-5' : ''}>
              {renderSectionContent(group, showSection, groupIdx)}
            </div>
          )
          return wrapper
        })}
      </ScrollArea>

      {/* Suspended Warning */}
      {isSuspended && !isCompact && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mx-3 mb-2"
        >
          <div className="p-3 rounded-xl bg-red-500/[0.04] border border-red-500/10">
            <div className="flex items-center gap-2 text-red-400">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="text-[11px] font-semibold">Outlet Suspended</span>
            </div>
            <p className="text-[10px] text-red-400/50 mt-1.5 leading-relaxed pl-[22px]">
              Akun dinonaktifkan oleh admin. Hubungi support.
            </p>
          </div>
        </motion.div>
      )}

      {/* User Section */}
      <div className={`shrink-0 border-t border-white/[0.04] ${
        isCompact ? 'px-2' : 'px-3'
      } py-3`}>
        {!isCompact ? (
          <>
            {/* User Card */}
            <div className="flex items-center gap-3 p-2.5 mb-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-cyan-500/20 text-cyan-300 text-[11px] font-bold border border-white/[0.06]">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-200 truncate leading-tight">
                  {session?.user?.name || 'User'}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1.5 py-0 leading-none border ${
                      session?.user?.role === 'OWNER'
                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                        : 'bg-white/[0.03] border-white/[0.06] text-slate-500'
                    }`}
                  >
                    {session?.user?.role || 'CREW'}
                  </Badge>
                  {plan && (
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1.5 py-0 leading-none border ${getPlanBadgeClass(plan.type)}`}
                    >
                      {plan.label}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            {/* Sign Out */}
            <Button
              variant="ghost"
              className="w-full justify-start text-slate-500 hover:text-red-400 hover:bg-red-500/[0.04] h-8 text-xs gap-2 rounded-lg px-3"
              onClick={handleSignOut}
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Sign Out</span>
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Avatar className="h-8 w-8 cursor-default">
                    <AvatarFallback className="bg-gradient-to-br from-pink-500/20 to-cyan-500/20 text-cyan-300 text-[11px] font-bold border border-white/[0.06]">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={12}
                  className="bg-slate-800 text-slate-100 border border-white/[0.06] shadow-xl rounded-lg px-3 py-1.5"
                >
                  {session?.user?.name || 'User'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleSignOut}
                    className="flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/[0.04] transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={12}
                  className="bg-slate-800 text-slate-100 border border-white/[0.06] shadow-xl rounded-lg px-3 py-1.5"
                >
                  Sign Out
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
    </div>
  )

  // ---- Section renderer helper ----
  function renderSectionContent(group: { key: string; label: string; items: NavItem[] }, showSection: boolean, idx: number) {
    return (
      <>
        {showSection ? (
          <div className="flex items-center gap-2 mb-1.5 px-3">
            <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.12em] select-none">
              {group.label}
            </span>
            <div className="flex-1 h-px bg-white/[0.04]" />
          </div>
        ) : (
          idx > 0 && (
            <div className="flex justify-center my-1">
              <div className="w-5 h-px bg-white/[0.06] rounded-full" />
            </div>
          )
        )}
        <div className="space-y-0.5">
          {group.items.map((item) => renderNavButton(item))}
        </div>
      </>
    )
  }
}

// ============================================================
// Main Sidebar Export
// ============================================================

export default function Sidebar() {
  const { collapsed, setCollapsed } = useSidebarStore()

  return (
    <>
      {/* ─── Desktop Sidebar ─── */}
      <aside
        className={`hidden md:flex flex-col fixed top-0 left-0 h-full bg-deep-space border-r border-white/[0.04] z-40 transition-all duration-300 ease-in-out ${
          collapsed ? 'w-[68px]' : 'w-[260px]'
        }`}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
        />
      </aside>
    </>
  )
}
