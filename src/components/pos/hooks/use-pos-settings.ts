/**
 * usePosSettings() — Settings, outlets, and promos management for POS.
 *
 * PR 3 — caches outlet settings + promos to the posDB working-set for offline use.
 *
 * RECOVERY 2026-07-24: POS-local serviceChargeRate + roundingEnabled REMOVED.
 *   They had no server field and were folded into `discount` (negative),
 *   breaking calculation integrity. The locked server contract is
 *   `total = subtotal − discount + taxAmount`; the POS now matches it exactly.
 *
 * @boundary COCKPIT only — no engine imports
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
import { getCachedSettings } from '@/lib/sync-service'
import { tryGetPosDB, type CachedPromo } from '@/lib/pos/pos-db'

// ==================== INTERFACES ====================

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
  value: number
  minPurchase: number | null
  maxDiscount: number | null
  active: boolean
  validUntil: string | null
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

function mapToSettings(data: Record<string, unknown>): OutletSettings {
  return {
    ...DEFAULT_SETTINGS,
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
    ppnRate: (data.ppnRate as number) ?? 11,
    manualDiscountEnabled: (data.manualDiscountEnabled as boolean) ?? false,
    receiptDoublePrintEnabled: (data.receiptDoublePrintEnabled as boolean) ?? false,
    receiptMerchantCopyEnabled: (data.receiptMerchantCopyEnabled as boolean) ?? true,
    receiptCustomerCopyEnabled: (data.receiptCustomerCopyEnabled as boolean) ?? true,
    receiptBatchOrderEnabled: (data.receiptBatchOrderEnabled as boolean) ?? false,
  }
}

// ==================== HOOK ====================

interface UsePosSettingsOptions {
  isOnline: boolean
  currentPage?: string
}

interface UsePosSettingsReturn {
  settings: OutletSettings
  outletInfo: OutletInfo | null
  userOutlets: UserOutlet[]
  outletsLoading: boolean
  availablePromos: PromoInfo[]
  availablePaymentMethods: Array<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>
}

export function usePosSettings(options: UsePosSettingsOptions): UsePosSettingsReturn {
  const { isOnline } = options
  // NOTE: `currentPage` option is accepted for backward compat but no longer
  // used — the previous `currentPage === 'pos'` refetch effect was removed
  // (it fetched /api/settings a third time on POS mount, redundantly).
  void options.currentPage

  const [settings, setSettings] = useState<OutletSettings>(DEFAULT_SETTINGS)
  const [outletInfo, setOutletInfo] = useState<OutletInfo | null>(null)
  const [userOutlets, setUserOutlets] = useState<UserOutlet[]>([])
  const [outletsLoading, setOutletsLoading] = useState(false)
  const [availablePromos, setAvailablePromos] = useState<PromoInfo[]>([])

  const availablePaymentMethods = useMemo(() => {
    return settings.paymentMethods.split(',').map(m => m.trim().toUpperCase()).filter(Boolean) as Array<'CASH' | 'QRIS' | 'DEBIT' | 'TRANSFER'>
  }, [settings.paymentMethods])

  // ── Fetch settings (online: server; offline: Dexie cache) ──
  // POST-CHECKOUT LATENCY FIX: removed the redundant `syncSettingsFromServer()`
  // call — it fetched /api/settings a SECOND time (the fetch above already
  // fetched it). Also removed the separate `currentPage === 'pos'` refetch
  // effect (was fetching /api/settings a THIRD time on POS mount).
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (isOnline) {
          const res = await fetch('/api/settings')
          if (res.ok) {
            const data = await res.json()
            const mapped = mapToSettings(data)
            setSettings(mapped)
            if (data.outlet) {
              setOutletInfo({ id: data.outlet.id, name: data.outlet.name, address: data.outlet.address, phone: data.outlet.phone })
            }
            // Cache settings to posDB for offline
            await cacheSettingsToPosDB(data)

            // POST-CHECKOUT LATENCY FIX: Pre-warm the receipt logo image so
            // it's in the browser cache when the receipt dialog opens. Without
            // this, the first receipt open fetches the logo synchronously
            // (can take ~10s for large unoptimized images on slow CDNs).
            if (mapped.receiptLogo) {
              try {
                const img = new Image()
                img.src = mapped.receiptLogo
              } catch { /* non-critical — logo just won't be pre-warmed */ }
            }
          }
        } else {
          const cached = await getCachedSettings()
          if (cached) {
            const mapped = mapToSettings(cached)
            setSettings(mapped)
            const cachedOutlet = cached.outlet as { id: string; name: string; address: string | null; phone: string | null } | undefined
            if (cachedOutlet) {
              setOutletInfo({ id: cachedOutlet.id, name: cachedOutlet.name, address: cachedOutlet.address, phone: cachedOutlet.phone })
            }
          } else {
            // Fall back to posDB cache
            const posCached = await readSettingsFromPosDB()
            if (posCached) {
              const mapped = mapToSettings(posCached)
              setSettings(mapped)
            }
          }
        }
      } catch { /* use defaults */ }
    }
    fetchSettings()
  }, [isOnline])

  // NOTE: The previous `currentPage === 'pos'` refetch effect was removed.
  // It fetched /api/settings a third time whenever the user navigated to POS,
  // which was redundant with the mount fetch above. Settings are cached in
  // posDB for offline use and refresh on the isOnline dependency change.

  // ── Fetch user outlets ──
  useEffect(() => {
    const fetchOutlets = async () => {
      if (!isOnline) return
      try {
        const res = await fetch('/api/outlets')
        if (res.ok) {
          const data = await res.json()
          if (data.outlets && Array.isArray(data.outlets)) {
            setUserOutlets(data.outlets.map((o: Record<string, unknown>) => ({
              id: o.id as string, name: o.name as string,
              address: (o.address as string) || null, phone: (o.phone as string) || null,
              isPrimary: (o.isPrimary as boolean) || false,
            })))
          }
        }
      } catch { /* silent */ }
      finally { setOutletsLoading(false) }
    }
    setOutletsLoading(true)
    void fetchOutlets()
  }, [isOnline])

  // ── Fetch promos (online) or read from posDB cache (offline) ──
  useEffect(() => {
    const fetchPromos = async () => {
      try {
        if (isOnline) {
          const res = await fetch('/api/settings/promos?active=true')
          if (res.ok) {
            const data = await res.json()
            const promos: PromoInfo[] = (data.promos || []).map((p: Record<string, unknown>) => ({
              id: p.id as string, name: p.name as string, type: p.type as string,
              description: (p.description as string) || '', value: Number(p.value) || 0,
              minPurchase: p.minPurchase ? Number(p.minPurchase) : null,
              maxDiscount: p.maxDiscount ? Number(p.maxDiscount) : null,
              active: Boolean(p.active), validUntil: (p.validUntil as string) || null,
            }))
            setAvailablePromos(promos)
            // Cache promos to posDB
            const db = tryGetPosDB()
            if (db && promos.length > 0) {
              const cached: CachedPromo[] = promos.map(p => ({
                id: p.id, name: p.name, type: p.type, value: p.value,
                minPurchase: p.minPurchase, maxDiscount: p.maxDiscount,
                active: p.active, validUntil: p.validUntil, cachedAt: Date.now(),
              }))
              await db.promos.clear()
              await db.promos.bulkPut(cached)
            }
          }
        } else {
          // Offline: read promos from posDB
          const db = tryGetPosDB()
          if (db) {
            const cached = await db.promos.toArray()
            setAvailablePromos(cached.map(p => ({
              id: p.id, name: p.name, type: p.type, description: '', value: p.value,
              minPurchase: p.minPurchase, maxDiscount: p.maxDiscount,
              active: p.active, validUntil: p.validUntil,
            })))
          }
        }
      } catch { /* silent */ }
    }
    fetchPromos()
  }, [isOnline])

  return {
    settings, outletInfo, userOutlets, outletsLoading, availablePromos,
    availablePaymentMethods,
  }
}

// ── Helpers: posDB settings cache ──

async function cacheSettingsToPosDB(data: Record<string, unknown>): Promise<void> {
  const db = tryGetPosDB()
  if (!db) return
  await db.outletSettings.put({ key: 'outlet-settings', value: JSON.stringify(data), updatedAt: new Date().toISOString() })
}

async function readSettingsFromPosDB(): Promise<Record<string, unknown> | null> {
  const db = tryGetPosDB()
  if (!db) return null
  const row = await db.outletSettings.get('outlet-settings')
  if (!row) return null
  try { return JSON.parse(row.value) as Record<string, unknown> } catch { return null }
}
