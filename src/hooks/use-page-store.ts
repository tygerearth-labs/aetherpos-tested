import { create } from 'zustand'

export type PageType = 'dashboard' | 'products' | 'customers' | 'pos' | 'transactions' | 'audit-log' | 'crew' | 'plan' | 'settings' | 'transfer' | 'multi-outlet' | 'purchase'

interface PageStore {
  currentPage: PageType
  setCurrentPage: (page: PageType) => void
}

export const usePageStore = create<PageStore>((set) => ({
  currentPage: 'dashboard',
  setCurrentPage: (page) => set({ currentPage: page }),
}))