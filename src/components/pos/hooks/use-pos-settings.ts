/**
 * usePosSettings() — Settings, outlets, and promos management for POS.
 *
 * Extracted from pos-page.tsx Phase 1A modularization.
 * Original lines: 125-158 (interfaces), 236-259 (states), 261-263 (derived),
 *                 266-378 (settings effects), 381-407 (outlets effect),
 *                 445-450 (payment reset), 452-464 (promos effect)
 *
 * @phase 1A — Move code without changing meaning
 * @boundary COCKPIT only — no engine imports
 */

'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { syncSettingsFromServer, getCachedSettings } from '@/lib/sync-service'

// ==================== INTERFACES (moved from pos-page.tsx) ====================

export interface OutletSettings {
  paymentMethods: string
  loyaltyEnabled: boolean
  loyaltyPointsPerAmount: number
  loyaltyPointValue: number
  receiptBusinessName: string
  receiptAddress: string
  receiptPhone: string
  receiptFooter: string
  receiptLogo: string
  themePrimaryColor: string
  ppnEnabled: boolean
  ppnRate: number
  manualDiscountEnabled: boolean
  receiptDoublePrintEnabled: boolean
  receiptMerchantCopyEnabled: boolean
  receiptCustomerCopyEnabled: boolean
  receiptBatchOrderEnabled: boolean
}

export interface OutletInfo {
  id: string
  name: string
  address: string | null
  phone: string | null
}

export interface UserOutlet {
  id: string
  name: string
  address: string | null
  phone: string | null
  isPrimary: boolean
}

export interface PromoInfo {
  id: string
  name: string
  type: string
  description: string
}

// ==================== DEFAULTS ====================

const DEFAULT_SETTINGS: OutletSettings = {
  paymentMethods: 'CASH,QRIS',
  loyaltyEnabled: true,
  loyaltyPointsPerAmount: 10000,
  loyaltyPointValue: 100,
  receiptBusinessName: 'Aether POS',
  receiptAddress: '',
  receiptPhone: '',
  receiptFooter: 'Terima kasih atas kunjungan Anda!',
  receiptLogo: '',
  themePrimaryColor: 'emerald',
  ppnEnabled: false,
  ppnRate: 11,
  manualDiscountEnabled: false,
  receiptDoublePrintEnabled: false,
  receiptMerchantCopyEnabled: true,
  receiptCustomerCopyEnabled: true,
  receiptBatchOrderEnabled: false,
}

// ==================== HELPER: Map API response to OutletSettings ====================
// Eliminates the duplication that existed in two useEffects (~75 lines × 2)

function mapApiDataToSettings(data: Record<string, unknown>): OutletSettings {
  return {
    paymentMethods: (data.paymentMethods as string) || 'CASH,QRIS',
    loyaltyEnabled: (data.loyaltyEnabled as boolean) ?? true,
    loyaltyPointsPerAmount: (data.loyaltyPointsPerAmount as number) || 10000,
    loyaltyPointValue: (data.loyaltyPointValue as number) || 100,
    receiptBusinessName: (data.receiptBusinessName as string) || 'Aether POS',
    receiptAddress: (data.receiptAddress as string) || '',
    receiptPhone: (data.receiptPhone as string) || '',
    receiptFooter: (data.receiptFooter as string) || 'Terima kasih atas kunjungan Anda!',
    receiptLogo: (data.receiptLogo as string) || '',
    themePrimaryColor: (data.themePrimaryColor as string) || 'emerald',
    ppnEnabled: (data.ppnEnabled as boolean) ?? false,
    ppnRate: (data.ppnRate as number) || 11,
    manualDiscountEnabled: (data.manualDiscountEnabled as boolean) ?? false,
    receiptDoublePrintEnabled: (data.receiptDoublePrintEnabled as boolean) ?? false,
    receiptMerchantCopyEnabled: (data.receiptMerchantCopyEnabled as boolean) ?? true,
    receiptCustomerCopyEnabled: (data.receiptCustomerCopyEnabled as boolean) ?? true,
    receiptBatchOrderEnabled: (data.receiptBatchOrderEnabled as boolean) ?? false,
  }
}

function mapCachedToSettings(cached: Record<string, unknown>): OutletSettings {
  return {
    paymentMethods: (cached.paymentMethods as string) || 'CASH,QRIS',
    loyaltyEnabled: (cached.loyaltyEnabled as boolean) ?? true,
    loyaltyPointsPerAmount: (cached.loyaltyPointsPerAmount as number) || 10000,
    loyaltyPointValue: (cached.loyaltyPointValue as number) || 100,
    receiptBusinessName: (cached.receiptBusinessName as string) || 'Aether POS',
    receiptAddress: (cached.receiptAddress as string) || '',
    receiptPhone: (cached.receiptPhone as string) || '',
    receiptFooter: (cached.receiptFooter as string) || 'Terima kasih atas kunjungan Anda!',
    receiptLogo: (cached.receiptLogo as string) || '',
    themePrimaryColor: (cached.themePrimaryColor as string) || 'emerald',
    ppnEnabled: (cached.ppnEnabled as boolean) ?? false,
    ppnRate: (cached.ppnRate as number) || 11,
    manualDiscountEnabled: (cached.manualDiscountEnabled as boolean) ?? false,
    receiptDoublePrintEnabled: (cached.receiptDoublePrintEnabled as boolean) ?? false,
    receiptMerchantCopyEnabled: (cached.receiptMerchantCopyEnabled as boolean) ?? true,
    receiptCustomerCopyEnabled: (cached.receiptCustomerCopyEnabled as boolean) ?? true,
    receiptBatchOrderEnabled: (cached.receiptBatchOrderEnabled as boolean) ?? false,
  }
}

// ==================== HOOK ====================

interface UsePosSettingsOptions {
  isOnline: boolean
  currentPage?: string
}

interface UsePosSettingsReturn {
  // State
  settings: OutletSettings
  outletInfo: OutletInfo | null
  userOutlets: UserOutlet[]
  outletsLoading: boolean
  availablePromos: PromoInfo[]

  // Payment methods (derived) — NOTE: active paymentMethod is owned by usePosCheckout
  // This hook only provides the AVAILABLE methods list from settings
  availablePaymentMethods: Array<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>
}

export function usePosSettings(options: UsePosSettingsOptions): UsePosSettingsReturn {
  const { isOnline, currentPage } = options

  // ── State (originally lines 236-259) ──
  const [settings, setSettings] = useState<OutletSettings>(DEFAULT_SETTINGS)
  const [outletInfo, setOutletInfo] = useState<OutletInfo | null>(null)
  const [userOutlets, setUserOutlets] = useState<UserOutlet[]>([])
  const [outletsLoading, setOutletsLoading] = useState(false)
  const [availablePromos, setAvailablePromos] = useState<PromoInfo[]>([])

  // ── Derived: Available payment methods (originally lines 261-263) ──
  // NOTE: Active paymentMethod ownership is in usePosCheckout. This hook only provides the list.

  const availablePaymentMethods = useMemo(() => {
    return settings.paymentMethods.split(',').map(m => m.trim().toUpperCase()).filter(Boolean) as Array<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>
  }, [settings.paymentMethods])

  // ── Effect 1: Fetch settings on mount / online change (originally lines 266-342) ──
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (isOnline) {
          const res = await fetch('/api/settings')
          if (res.ok) {
            const data = await res.json()
            setSettings(mapApiDataToSettings(data))
            // Extract outlet info from settings response
            if (data.outlet) {
              setOutletInfo({
                id: data.outlet.id,
                name: data.outlet.name,
                address: data.outlet.address,
                phone: data.outlet.phone,
              })
            }
            // Cache settings for offline use
            syncSettingsFromServer()
          }
        } else {
          // Offline: load from IndexedDB cache
          const cached = await getCachedSettings()
          if (cached) {
            setSettings(mapCachedToSettings(cached))
            // Extract outlet info from cached settings
            const cachedOutlet = cached.outlet as { id: string; name: string; address: string | null; phone: string | null } | undefined
            if (cachedOutlet) {
              setOutletInfo({
                id: cachedOutlet.id,
                name: cachedOutlet.name,
                address: cachedOutlet.address,
                phone: cachedOutlet.phone,
              })
            }
          }
        }
      } catch { /* use defaults */ }
    }
    fetchSettings()
  }, [isOnline])

  // ── Effect 2: Re-fetch settings when returning to POS page (originally lines 345-378) ──
  useEffect(() => {
    if (currentPage === 'pos') {
      const refetchSettings = async () => {
        try {
          if (isOnline) {
            const res = await fetch('/api/settings')
            if (res.ok) {
              const data = await res.json()
              setSettings(mapApiDataToSettings(data))
            }
          }
        } catch { /* silent */ }
      }
      refetchSettings()
    }
  }, [currentPage, isOnline])

  // ── Effect 3: Fetch user's outlets (enterprise multi-outlet) (originally lines 381-407) ──
  useEffect(() => {
    const fetchOutlets = async () => {
      if (!isOnline) return
      try {
        const res = await fetch('/api/outlets')
        if (res.ok) {
          const data = await res.json()
          if (data.outlets && Array.isArray(data.outlets)) {
            setUserOutlets(data.outlets.map((o: Record<string, unknown>) => ({
              id: o.id as string,
              name: o.name as string,
              address: (o.address as string) || null,
              phone: (o.phone as string) || null,
              isPrimary: (o.isPrimary as boolean) || false,
            })))
          }
        }
      } catch { /* silent - outlets list is non-critical */ }
      finally {
        setOutletsLoading(false)
      }
    }

    setOutletsLoading(true)
    void fetchOutlets()
  }, [isOnline])

  // NOTE: Payment method reset logic moved to usePosCheckout (single owner for active paymentMethod)

  // ── Effect 5: Fetch available promos (originally lines 452-464) ──
  useEffect(() => {
    const fetchPromos = async () => {
      try {
        const res = await fetch('/api/settings/promos?active=true')
        if (res.ok) {
          const data = await res.json()
          setAvailablePromos(data.promos || [])
        }
      } catch { /* silent */ }
    }
    if (isOnline) fetchPromos()
  }, [isOnline])

  return {
    // State
    settings,
    outletInfo,
    userOutlets,
    outletsLoading,
    availablePromos,

    // Derived
    availablePaymentMethods,
  }
}
