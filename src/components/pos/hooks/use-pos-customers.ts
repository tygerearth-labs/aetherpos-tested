/**
 * usePosCustomers() — Customer loading, search, selection, and add-new for POS.
 *
 * Extracted from pos-page.tsx Phase 1A modularization.
 * Original lines: 97-102 (Customer interface), 409-416 (states),
 *                 893-900 (loadCustomersFromCache), 996-1003 (filteredCustomers),
 *                 customer-related handlers in render
 *
 * @phase 1A — Move code without changing meaning
 * @boundary COCKPIT only — no engine imports
 */

'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { localDB } from '@/lib/local-db'
import { toast } from 'sonner'

// ==================== INTERFACES ====================

export interface Customer {
  id: string
  name: string
  whatsapp: string
  points: number
}

// ==================== HOOK RETURN ====================

interface UsePosCustomersReturn {
  // State
  customers: Customer[]
  customerSearch: string
  selectedCustomer: Customer | null
  customerDropdownOpen: boolean
  addCustomerOpen: boolean
  newCustomer: { name: string; whatsapp: string }
  addingCustomer: boolean

  // Derived
  filteredCustomers: Customer[]

  // Actions
  setCustomerSearch: (value: string) => void
  setSelectedCustomer: (customer: Customer | null) => void
  setCustomerDropdownOpen: (open: boolean) => void
  setAddCustomerOpen: (open: boolean) => void
  setNewCustomer: (customer: { name: string; whatsapp: string }) => void
  handleAddCustomer: () => Promise<void>
  loadCustomersFromCache: () => Promise<void>
}

// ==================== HOOK IMPLEMENTATION ====================

export function usePosCustomers(): UsePosCustomersReturn {
  // ── State (originally lines 409-416) ──
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [addCustomerOpen, setAddCustomerOpen] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', whatsapp: '' })
  const [addingCustomer, setAddingCustomer] = useState(false)

  // ── Load customers from IndexedDB cache (originally lines 893-900) ──
  const loadCustomersFromCache = useCallback(async () => {
    try {
      const cached = await localDB.customers.toArray()
      setCustomers(cached as unknown as Customer[])
    } catch { /* silent */ }
  }, [])

  useEffect(() => { loadCustomersFromCache() }, [loadCustomersFromCache])

  // ── Derived: Filtered customers for dropdown (originally lines 996-1003) ──
  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 20)
    const q = customerSearch.toLowerCase()
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.whatsapp.includes(q)
    )
  }, [customers, customerSearch])

  // ── Handler: Add new customer (originally in pos-page around line 1314) ──
  const handleAddCustomer = useCallback(async () => {
    if (!newCustomer.name.trim()) {
      toast.error('Nama pelanggan wajib diisi')
      return
    }

    setAddingCustomer(true)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCustomer.name.trim(),
          whatsapp: newCustomer.whatsapp.trim() || undefined,
          outletId: undefined, // Server will infer from auth session
        }),
      })

      if (res.ok) {
        const created = await res.json()
        setSelectedCustomer(created)
        setCustomerSearch('')
        setNewCustomer({ name: '', whatsapp: '' })
        setAddCustomerOpen(false)
        toast.success(`Pelanggan ${created.name} ditambahkan`)
        // Refresh customer list
        await loadCustomersFromCache()
      } else {
        const err = await res.json()
        toast.error(err.message || 'Gagal menambah pelanggan')
      }
    } catch {
      toast.error('Gagal menambah pelanggan')
    } finally {
      setAddingCustomer(false)
    }
  }, [newCustomer, loadCustomersFromCache])

  return {
    // State
    customers,
    customerSearch,
    selectedCustomer,
    customerDropdownOpen,
    addCustomerOpen,
    newCustomer,
    addingCustomer,

    // Derived
    filteredCustomers,

    // Actions
    setCustomerSearch,
    setSelectedCustomer,
    setCustomerDropdownOpen,
    setAddCustomerOpen,
    setNewCustomer,
    handleAddCustomer,
    loadCustomersFromCache,
  }
}
