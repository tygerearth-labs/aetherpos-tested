/**
 * usePosCustomers() — Customer loading, search, selection, and add-new for POS.
 *
 * PR 3 — Offline customer support:
 *   - Online: fetch /api/customers → render → cache working set to Dexie
 *   - Offline: read from Dexie customers
 *   - Add customer online: POST /api/customers → select
 *   - Add customer offline: write to customerOutbox (local UUID) → select
 *     (synced later; localCustomerId resolved to serverId on reconnect)
 *
 * @boundary COCKPIT only — no engine imports
 */

'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { tryGetPosDB, type CachedCustomer, type CustomerOutboxRow } from '@/lib/pos/pos-db'
import type { Customer } from './use-pos-customers'

// ==================== INTERFACES ====================

export interface Customer {
  id: string
  name: string
  whatsapp: string
  points: number
  /** PR 3: true if created locally (pending sync) */
  isLocal?: boolean
}

interface UsePosCustomersReturn {
  customers: Customer[]
  customerSearch: string
  selectedCustomer: Customer | null
  customerDropdownOpen: boolean
  addCustomerOpen: boolean
  newCustomer: { name: string; whatsapp: string }
  addingCustomer: boolean
  filteredCustomers: Customer[]
  setCustomerSearch: (value: string) => void
  setSelectedCustomer: (customer: Customer | null) => void
  setCustomerDropdownOpen: (open: boolean) => void
  setAddCustomerOpen: (open: boolean) => void
  setNewCustomer: (customer: { name: string; whatsapp: string }) => void
  handleAddCustomer: () => Promise<void>
  loadCustomersFromCache: () => Promise<void>
}

// ==================== HOOK IMPLEMENTATION ====================

export function usePosCustomers(options: { isOnline: boolean }): UsePosCustomersReturn {
  const { isOnline } = options

  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [addCustomerOpen, setAddCustomerOpen] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', whatsapp: '' })
  const [addingCustomer, setAddingCustomer] = useState(false)

  // ── Load customers (online: /api/customers; offline: Dexie) ──
  const loadCustomersFromCache = useCallback(async () => {
    try {
      const db = tryGetPosDB()
      if (isOnline) {
        const res = await fetch('/api/customers?limit=200')
        if (res.ok) {
          const data = await res.json()
          const list: Customer[] = (data.customers || []).map((c: Record<string, unknown>) => ({
            id: c.id as string, name: c.name as string, whatsapp: (c.whatsapp as string) || '',
            points: Number(c.points) || 0,
          }))
          setCustomers(list)
          // Cache working set to Dexie
          if (db && list.length > 0) {
            const cached: CachedCustomer[] = list.map(c => ({
              id: c.id, name: c.name, whatsapp: c.whatsapp, points: c.points,
              totalSpend: 0, isLocal: false, cachedAt: Date.now(),
            }))
            await db.customers.clear()
            await db.customers.bulkPut(cached)
          }
        }
      } else if (db) {
        // Offline: read from Dexie (including local outbox customers)
        const cached = await db.customers.toArray()
        const outbox = await db.customerOutbox.where('status').equals('PENDING').toArray()
        const localCustomers: Customer[] = outbox.map(o => ({
          id: o.id, name: o.name, whatsapp: o.whatsapp, points: 0, isLocal: true,
        }))
        setCustomers([
          ...localCustomers,
          ...cached.map(c => ({ id: c.id, name: c.name, whatsapp: c.whatsapp, points: c.points })),
        ])
      }
    } catch { /* silent */ }
  }, [isOnline])

  useEffect(() => { loadCustomersFromCache() }, [loadCustomersFromCache])

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 20)
    const q = customerSearch.toLowerCase()
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.whatsapp.includes(q))
  }, [customers, customerSearch])

  // ── Add customer (online: API; offline: customerOutbox) ──
  const handleAddCustomer = useCallback(async () => {
    if (!newCustomer.name.trim()) {
      toast.error('Nama pelanggan wajib diisi')
      return
    }
    setAddingCustomer(true)
    try {
      if (isOnline) {
        const res = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newCustomer.name.trim(), whatsapp: newCustomer.whatsapp.trim() || undefined }),
        })
        if (res.ok) {
          const created = await res.json()
          const customer: Customer = { id: created.id, name: created.name, whatsapp: created.whatsapp || '', points: 0 }
          setSelectedCustomer(customer)
          setCustomerSearch(''); setNewCustomer({ name: '', whatsapp: '' }); setAddCustomerOpen(false)
          toast.success(`Pelanggan ${created.name} ditambahkan`)
          await loadCustomersFromCache()
        } else {
          const err = await res.json()
          toast.error(err.message || 'Gagal menambah pelanggan')
        }
      } else {
        // PR 3: Offline — write to customerOutbox with local UUID
        const db = tryGetPosDB()
        if (!db) { toast.error('Offline DB tidak tersedia'); return }
        const localId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `local-cust-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        const row: CustomerOutboxRow = {
          id: localId,
          name: newCustomer.name.trim(),
          whatsapp: newCustomer.whatsapp.trim(),
          createdAt: Date.now(),
          status: 'PENDING',
          serverId: null,
          error: null,
          retryCount: 0,
        }
        await db.customerOutbox.put(row)
        // Also cache in customers table so it appears in search
        await db.customers.put({
          id: localId, name: row.name, whatsapp: row.whatsapp, points: 0,
          totalSpend: 0, isLocal: true, cachedAt: Date.now(),
        })
        const customer: Customer = { id: localId, name: row.name, whatsapp: row.whatsapp, points: 0, isLocal: true }
        setSelectedCustomer(customer)
        setCustomerSearch(''); setNewCustomer({ name: '', whatsapp: '' }); setAddCustomerOpen(false)
        toast.success(`Pelanggan ${row.name} ditambahkan (offline)`)
        await loadCustomersFromCache()
      }
    } catch {
      toast.error('Gagal menambah pelanggan')
    } finally {
      setAddingCustomer(false)
    }
  }, [newCustomer, isOnline, loadCustomersFromCache])

  return {
    customers, customerSearch, selectedCustomer, customerDropdownOpen, addCustomerOpen,
    newCustomer, addingCustomer, filteredCustomers,
    setCustomerSearch, setSelectedCustomer, setCustomerDropdownOpen, setAddCustomerOpen,
    setNewCustomer, handleAddCustomer, loadCustomersFromCache,
  }
}
