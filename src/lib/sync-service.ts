/**
 * sync-service.ts
 *
 * Handles downloading Products, Customers, Promos, and Categories from the server
 * and storing them in IndexedDB (Dexie) as the offline-first data source.
 *
 * Flow:
 *  1. App opens → check connection
 *  2. Online → fetch all products/customers/promos/categories → bulkPut into IndexedDB
 *  3. User searches → reads from IndexedDB (instant, offline-capable)
 *  4. Offline → data is already cached, search still works
 */

import { localDB } from './local-db'
import { getAetherDB } from '@/lib/offline/aether-db'
import type { CachedProduct, CachedCustomer, CachedPromo, CachedCategory } from './local-db'

// ==================== HELPERS ====================

/**
 * Check if a fetch response indicates an authentication error.
 */
function isAuthError(res: Response): boolean {
  return res.status === 401 || res.status === 403
}

/** Common sync result type with optional authError flag */
interface SyncResultBase {
  success: boolean
  error?: string
  authError?: boolean
}

// ==================== SYNC FUNCTIONS ====================

/**
 * Download ALL products from server (paginated) and save to IndexedDB.
 * Returns `authError: true` if session expired so the caller can
 * show a user-friendly "please re-login" message.
 */
export async function syncProductsFromServer(): Promise<SyncResultBase & { count: number }> {
  try {
    const allProducts: CachedProduct[] = []
    let page = 1
    const limit = 200
    let hasMore = true

    while (hasMore) {
      const res = await fetch(`/api/products?limit=${limit}&page=${page}`)
      if (isAuthError(res)) {
        return { success: false, count: 0, error: 'Sesi telah berakhir. Silakan login ulang.', authError: true }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()
      const products: CachedProduct[] = (data.products || []).map(
        (p: Record<string, unknown>) => ({
          id: p.id as string,
          name: p.name as string,
          sku: (p.sku as string) || null,
          barcode: (p.barcode as string) || null,
          hpp: Number(p.hpp) || 0,
          price: Number(p.price) || 0,
          bruto: Number(p.bruto) || 0,
          netto: Number(p.netto) || 0,
          stock: Number(p.stock) || 0,
          lowStockAlert: Number(p.lowStockAlert) || 10,
          image: (p.image as string) || null,
          categoryId: (p.categoryId as string) || null,
          hasVariants: !!(p.hasVariants) as boolean,
          _variantCount: Number(p._variantCount) || 0,
          unit: (p.unit as string) || 'pcs',
          variants: Array.isArray(p.variants) ? p.variants.map((v: Record<string, unknown>) => ({
            id: v.id as string,
            name: v.name as string,
            sku: (v.sku as string) || null,
            price: Number(v.price) || 0,
            hpp: Number(v.hpp) || 0,
            stock: Number(v.stock) || 0,
          })) : [],
          updatedAt: p.updatedAt || new Date().toISOString(),
        })
      )

      allProducts.push(...products)

      const totalPages = data.totalPages || 1
      hasMore = page < totalPages
      page++
    }

    // ── GUARD (Fix #3 hardening): Non-destructive upsert + stale deletion ──
    // Previously this was `clear() + bulkPut` which (a) blanked the cache
    // during fetch — UI showed empty grid mid-sync, (b) lost all data if
    // fetch failed midway.
    //
    // Now: bulkPut (upsert) first, then delete stale IDs not in server response.
    // The UI can render from cache instantly while sync runs in background.
    //
    // CRITICAL SAFETY GUARD:
    //   `bulkDelete(stale)` runs ONLY when ALL of these hold:
    //     1. The entire pagination loop above completed without throwing
    //        (any HTTP/network/JSON error throws → caught by outer catch →
    //        we never reach this point → cache preserved).
    //     2. `allProducts.length > 0` — an empty server response from a store
    //        that previously had products is almost certainly a transient
    //        server error (not a legitimate "store is now empty"), and wiping
    //        the local cache would force a full re-download + blank the POS
    //        grid. If the store genuinely has 0 products, the user can clear
    //        cache via the Settings → Clear Cache action.
    //   Stale IDs are computed from the COMPLETE `allProducts` array
    //   (accumulated across all pages), never from a single page.
    if (allProducts.length > 0) {
      await localDB.products.bulkPut(allProducts)
      // Delete products that exist in cache but not on server (handled deletions)
      const serverProductIds = new Set(allProducts.map(p => p.id))
      const cachedProductIds = await localDB.products.toCollection().primaryKeys()
      const staleProductIds = cachedProductIds.filter(id => !serverProductIds.has(id as string))
      if (staleProductIds.length > 0) {
        await localDB.products.bulkDelete(staleProductIds as string[])
      }
    }

    await localDB.syncMeta.put({ key: 'lastProductSync', value: Date.now() })
    return { success: true, count: allProducts.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, count: 0, error: message }
  }
}

/**
 * Download ALL categories from server and save to IndexedDB.
 */
export async function syncCategoriesFromServer(): Promise<SyncResultBase & { count: number }> {
  try {
    const res = await fetch('/api/categories')
    if (isAuthError(res)) {
      return { success: false, count: 0, error: 'Sesi telah berakhir. Silakan login ulang.', authError: true }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    const categories: CachedCategory[] = (data.categories || []).map(
      (c: Record<string, unknown>) => ({
        id: c.id as string,
        name: c.name as string,
        color: (c.color as string) || 'zinc',
        updatedAt: new Date().toISOString(),
      })
    )

    // PERF: Non-destructive upsert (same rationale + GUARD as products).
    // bulkDelete(stale) only runs after successful fetch AND non-empty result.
    if (categories.length > 0) {
      await localDB.categories.bulkPut(categories)
      const serverCategoryIds = new Set(categories.map(c => c.id))
      const cachedCategoryIds = await localDB.categories.toCollection().primaryKeys()
      const staleCategoryIds = cachedCategoryIds.filter(id => !serverCategoryIds.has(id as string))
      if (staleCategoryIds.length > 0) {
        await localDB.categories.bulkDelete(staleCategoryIds as string[])
      }
    }

    await localDB.syncMeta.put({ key: 'lastCategorySync', value: Date.now() })
    return { success: true, count: categories.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, count: 0, error: message }
  }
}

/**
 * Download ALL customers from server (paginated) and save to IndexedDB.
 */
export async function syncCustomersFromServer(): Promise<SyncResultBase & { count: number }> {
  try {
    const allCustomers: CachedCustomer[] = []
    let page = 1
    const limit = 200
    let hasMore = true

    while (hasMore) {
      const res = await fetch(`/api/customers?limit=${limit}&page=${page}`)
      if (isAuthError(res)) {
        return { success: false, count: 0, error: 'Sesi telah berakhir. Silakan login ulang.', authError: true }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()
      const customers: CachedCustomer[] = (data.customers || []).map(
        (c: Record<string, unknown>) => ({
          id: c.id as string,
          name: c.name as string,
          whatsapp: c.whatsapp as string,
          points: Number(c.points) || 0,
          totalSpend: Number(c.totalSpend) || 0,
          updatedAt: c.updatedAt || new Date().toISOString(),
        })
      )

      allCustomers.push(...customers)

      const totalPages = data.totalPages || 1
      hasMore = page < totalPages
      page++
    }

    // PERF: Non-destructive upsert (same rationale + GUARD as products).
    // bulkDelete(stale) only runs after successful pagination AND non-empty result.
    if (allCustomers.length > 0) {
      await localDB.customers.bulkPut(allCustomers)
      const serverCustomerIds = new Set(allCustomers.map(c => c.id))
      const cachedCustomerIds = await localDB.customers.toCollection().primaryKeys()
      const staleCustomerIds = cachedCustomerIds.filter(id => !serverCustomerIds.has(id as string))
      if (staleCustomerIds.length > 0) {
        await localDB.customers.bulkDelete(staleCustomerIds as string[])
      }
    }

    await localDB.syncMeta.put({ key: 'lastCustomerSync', value: Date.now() })
    return { success: true, count: allCustomers.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, count: 0, error: message }
  }
}

/**
 * Download all promos from server and save to IndexedDB.
 */
export async function syncPromosFromServer(): Promise<SyncResultBase & { count: number }> {
  try {
    const res = await fetch('/api/settings/promos')
    if (isAuthError(res)) {
      return { success: false, count: 0, error: 'Sesi telah berakhir. Silakan login ulang.', authError: true }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    const promos: CachedPromo[] = (data.promos || []).map(
      (p: Record<string, unknown>) => ({
        id: p.id as string,
        name: p.name as string,
        type: p.type as string,
        value: Number(p.value) || 0,
        minPurchase: p.minPurchase ? Number(p.minPurchase) : null,
        maxDiscount: p.maxDiscount ? Number(p.maxDiscount) : null,
        active: Boolean(p.active),
        updatedAt: p.updatedAt || new Date().toISOString(),
      })
    )

    // PERF: Non-destructive upsert (same rationale + GUARD as products).
    // bulkDelete(stale) only runs after successful fetch AND non-empty result.
    if (promos.length > 0) {
      await localDB.promos.bulkPut(promos)
      const serverPromoIds = new Set(promos.map(p => p.id))
      const cachedPromoIds = await localDB.promos.toCollection().primaryKeys()
      const stalePromoIds = cachedPromoIds.filter(id => !serverPromoIds.has(id as string))
      if (stalePromoIds.length > 0) {
        await localDB.promos.bulkDelete(stalePromoIds as string[])
      }
    }

    await localDB.syncMeta.put({ key: 'lastPromoSync', value: Date.now() })
    return { success: true, count: promos.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, count: 0, error: message }
  }
}

// ==================== MASTER SYNC ====================

export interface SyncAllResult {
  products: { success: boolean; count: number; error?: string; authError?: boolean }
  categories: { success: boolean; count: number; error?: string; authError?: boolean }
  customers: { success: boolean; count: number; error?: string; authError?: boolean }
  promos: { success: boolean; count: number; error?: string; authError?: boolean }
  /** True if any sync returned auth error (session expired) */
  hasAuthError: boolean
}

/**
 * Sync all master data in parallel.
 * Returns `hasAuthError: true` if session expired during sync.
 */
export async function syncAllData(): Promise<SyncAllResult> {
  const [products, categories, customers, promos] = await Promise.all([
    syncProductsFromServer(),
    syncCategoriesFromServer(),
    syncCustomersFromServer(),
    syncPromosFromServer(),
  ])

  return {
    products, categories, customers, promos,
    hasAuthError: !!(products.authError || categories.authError || customers.authError || promos.authError),
  }
}

// ==================== UTILITY ====================

/**
 * Get the last sync timestamp for a given key.
 */
export async function getLastSyncTime(key: string): Promise<number | null> {
  const meta = await localDB.syncMeta.get(key)
  return meta ? meta.value : null
}

/**
 * Get all last sync timestamps.
 */
export async function getAllSyncTimes(): Promise<{
  products: number | null
  categories: number | null
  customers: number | null
  promos: number | null
}> {
  const [products, categories, customers, promos] = await Promise.all([
    getLastSyncTime('lastProductSync'),
    getLastSyncTime('lastCategorySync'),
    getLastSyncTime('lastCustomerSync'),
    getLastSyncTime('lastPromoSync'),
  ])
  return { products, categories, customers, promos }
}

/**
 * Check if IndexedDB has any cached data (first time sync check).
 */
export async function hasCachedData(): Promise<boolean> {
  const productCount = await localDB.products.count()
  return productCount > 0
}

// ==================== SETTINGS SYNC ====================

/**
 * SET-003 FIX: Persist cached settings in real Dexie (IndexedDB) instead of
 * the in-memory noop shim from local-db.ts. The noop shim lost all data on
 * page reload, which meant offline POS sessions fell back to hardcoded
 * defaults (ppnRate=11, loyaltyPointValue=100, etc.) instead of the actual
 * outlet settings — causing incorrect tax/loyalty calculation.
 *
 * The Dexie `settings` table (key/value, see aether-db.ts:298) survives
 * page reloads. We store the JSON-stringified settings payload under a
 * single 'outlet-settings' key.
 *
 * SSR guard: getAetherDB() throws on the server. These functions are only
 * called from client-side useEffect, but the try/catch keeps SSR safe if
 * something imports this module at module-load time.
 */
const SETTINGS_CACHE_KEY = 'outlet-settings'

/**
 * Sync outlet settings from server and cache in IndexedDB (Dexie) for offline use.
 */
export async function syncSettingsFromServer(): Promise<{
  success: boolean
  error?: string
  authError?: boolean
}> {
  try {
    const res = await fetch('/api/settings')
    if (isAuthError(res)) {
      return { success: false, error: 'Sesi telah berakhir. Silakan login ulang.', authError: true }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()

    try {
      const db = getAetherDB()
      await db.settings.put({
        key: SETTINGS_CACHE_KEY,
        value: JSON.stringify(data),
        updatedAt: new Date().toISOString(),
      })
    } catch (dexieErr) {
      // Dexie unavailable (SSR or IndexedDB blocked). Log and continue — the
      // fetch itself succeeded, so the caller has the fresh data in-memory
      // via the response. The cache is best-effort.
      console.warn('[sync-service] Dexie settings cache write failed:', dexieErr instanceof Error ? dexieErr.message : dexieErr)
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Get cached outlet settings from IndexedDB (Dexie).
 * Returns null if cache is empty, missing, corrupted, or unavailable.
 */
export async function getCachedSettings(): Promise<Record<string, unknown> | null> {
  try {
    const db = getAetherDB()
    const cached = await db.settings.get(SETTINGS_CACHE_KEY)
    if (!cached || typeof cached.value !== 'string') return null
    try {
      return JSON.parse(cached.value) as Record<string, unknown>
    } catch {
      // Corrupted JSON in cache — clear it so the next sync can overwrite.
      console.warn('[sync-service] Cached settings JSON corrupted — clearing.')
      await db.settings.delete(SETTINGS_CACHE_KEY).catch(() => {})
      return null
    }
  } catch (err) {
    // Dexie unavailable (SSR). Caller falls back to in-memory defaults.
    if (err instanceof Error && err.message.includes('Cannot access IndexedDB')) {
      return null
    }
    console.warn('[sync-service] getCachedSettings failed:', err instanceof Error ? err.message : err)
    return null
  }
}
