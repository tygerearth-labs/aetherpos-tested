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

    await localDB.products.clear()
    if (allProducts.length > 0) {
      await localDB.products.bulkPut(allProducts)
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

    await localDB.categories.clear()
    if (categories.length > 0) {
      await localDB.categories.bulkPut(categories)
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

    await localDB.customers.clear()
    if (allCustomers.length > 0) {
      await localDB.customers.bulkPut(allCustomers)
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

    await localDB.promos.clear()
    if (promos.length > 0) {
      await localDB.promos.bulkPut(promos)
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
 * Sync outlet settings from server and cache in IndexedDB for offline use.
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

    await localDB.settings.put({
      key: 'outlet-settings',
      data,
      updatedAt: new Date().toISOString(),
    })

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Get cached outlet settings from IndexedDB.
 */
export async function getCachedSettings(): Promise<Record<string, unknown> | null> {
  const cached = await localDB.settings.get('outlet-settings')
  return cached ? cached.data : null
}
