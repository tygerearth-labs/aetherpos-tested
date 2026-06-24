import { create } from 'zustand'

export interface OutletOption {
  id: string
  name: string
  isPrimary: boolean
}

interface OutletStore {
  /** All outlets the current owner has access to */
  outlets: OutletOption[]
  /** Currently selected outlet ID (null = "all outlets") */
  selectedOutletId: string | null
  /** Whether multi-outlet is available (enterprise with >1 outlet) */
  isMultiOutlet: boolean
  /** Whether outlets have been fetched */
  isLoaded: boolean

  setOutlets: (outlets: OutletOption[], primaryOutletId: string) => void
  setSelectedOutletId: (id: string | null) => void
  reset: () => void
}

export const useOutletStore = create<OutletStore>((set) => ({
  outlets: [],
  selectedOutletId: null,
  isMultiOutlet: false,
  isLoaded: false,

  setOutlets: (outlets, primaryOutletId) => {
    const isMultiOutlet = outlets.length > 1
    set({
      outlets,
      isMultiOutlet,
      isLoaded: true,
      // Default to the primary outlet when not set, or keep current selection if valid
      selectedOutletId: isMultiOutlet ? primaryOutletId : null,
    })
  },

  setSelectedOutletId: (id) => set({ selectedOutletId: id }),

  reset: () =>
    set({
      outlets: [],
      selectedOutletId: null,
      isMultiOutlet: false,
      isLoaded: false,
    }),
}))