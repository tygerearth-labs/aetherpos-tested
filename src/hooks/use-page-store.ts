import { create } from 'zustand'

export type PageType = 'dashboard' | 'products' | 'customers' | 'pos' | 'transactions' | 'audit-log' | 'crew' | 'settings' | 'multi-branch'

interface PageStore {
  currentPage: PageType
  setCurrentPage: (page: PageType) => void
}

export const usePageStore = create<PageStore>((set) => ({
  currentPage: 'dashboard',
  setCurrentPage: (page) => set({ currentPage: page }),
}))
