import { create } from 'zustand'

export type PageType = 'dashboard' | 'products' | 'customers' | 'pos' | 'transactions' | 'audit-log' | 'crew' | 'plan' | 'settings' | 'transfer' | 'multi-outlet' | 'purchase' | 'inventory-movement' | 'stock-opname'

interface PageStore {
  currentPage: PageType
  setCurrentPage: (page: PageType) => void
  /**
   * Pending page the user tried to navigate to but was blocked because it is
   * ONLINE_ONLY and the browser is offline. The app-shell renders an
   * OfflineRouteBlocker dialog for this. Cleared when the user dismisses
   * the dialog or comes back online.
   */
  blockedPage: PageType | null
  setBlockedPage: (page: PageType | null) => void
}

export const usePageStore = create<PageStore>((set) => ({
  currentPage: 'dashboard',
  setCurrentPage: (page) => set({ currentPage: page, blockedPage: null }),
  blockedPage: null,
  setBlockedPage: (page) => set({ blockedPage: page }),
}))
