/**
 * route-capability.ts — Central Route Capability Registry (LOCKED)
 *
 * Single source of truth for every route's offline behavior. Used by:
 *   - sidebar (offline indication)
 *   - mobile-bottom-nav (offline indication)
 *   - app-shell navigation guard (block ONLINE_ONLY when offline)
 *   - command menu / deep-link handling
 *   - offline fallback UI
 *
 * Do NOT duplicate route capability rules elsewhere.
 *
 * offlineMode:
 *   FULL        — works fully offline (read + local mutation + outbox sync)
 *   READ_ONLY   — renders cached/snapshot data offline, mutations disabled
 *   ONLINE_ONLY — cannot function offline; navigation blocked when offline
 *
 * cacheDataSource:
 *   DEXIE     — live Dexie/IndexedDB store (kept fresh by sync-service while online)
 *   SNAPSHOT  — one-time snapshot captured at last successful fetch
 *   NONE      — no offline data (route requires live server)
 */

import type { PageType } from '@/hooks/use-page-store'

export type OfflineMode = 'FULL' | 'READ_ONLY' | 'ONLINE_ONLY'
export type CacheDataSource = 'DEXIE' | 'SNAPSHOT' | 'NONE'

export interface RouteCapability {
  /** Route key (matches PageType) */
  page: PageType
  /** Human-readable label for the offline-unavailable dialog */
  label: string
  /** Offline capability classification */
  offlineMode: OfflineMode
  /** Where offline data comes from (NONE for ONLINE_ONLY) */
  cacheDataSource: CacheDataSource
  /** Whether this route's chunk should be prefetched while online+idle */
  prefetch: boolean
  /** Short user-facing reason when blocked offline */
  offlineReason?: string
}

/**
 * The capability registry. Every PageType MUST have an entry.
 *
 * Rationale:
 *   FULL: POS is the core revenue flow — must survive offline with local
 *         transactions queued in Dexie outbox for later sync.
 *   READ_ONLY: Dashboard/products/customers/transactions display a snapshot
 *              from the last successful API fetch (in-memory React state).
 *              The "last updated" timestamp is persisted in Dexie metadata
 *              (aetherDB.metadata) so it survives reloads. Mutations (create/
 *              edit/delete/void/export) are disabled when offline. The data
 *              is never replaced with an empty response on fetch failure.
 *              NOTE: This is NOT a full Dexie data fallback — if the user
 *              reloads offline, the in-memory snapshot is lost and the page
 *              shows a loading/empty state. True Dexie fallback would require
 *              wiring sync-service to aetherDB (future work).
 *   ONLINE_ONLY: Migration/bulk/purchase/stock-opname/transfer/audit/settings
 *                require live server for correctness (financial mutations,
 *                inventory consumption, sensitive config). No offline data
 *                is pretended.
 */
export const ROUTE_CAPABILITIES: Record<PageType, RouteCapability> = {
  pos: {
    page: 'pos',
    label: 'POS Terminal',
    offlineMode: 'FULL',
    cacheDataSource: 'DEXIE',
    prefetch: true,
  },
  dashboard: {
    page: 'dashboard',
    label: 'Dashboard',
    offlineMode: 'READ_ONLY',
    cacheDataSource: 'SNAPSHOT',
    prefetch: true,
  },
  products: {
    page: 'products',
    label: 'Produk',
    offlineMode: 'READ_ONLY',
    cacheDataSource: 'SNAPSHOT',
    prefetch: true,
  },
  customers: {
    page: 'customers',
    label: 'Pelanggan',
    offlineMode: 'READ_ONLY',
    cacheDataSource: 'SNAPSHOT',
    prefetch: true,
  },
  transactions: {
    page: 'transactions',
    label: 'Transaksi',
    offlineMode: 'READ_ONLY',
    cacheDataSource: 'SNAPSHOT',
    prefetch: true,
  },
  purchase: {
    page: 'purchase',
    label: 'Pembelian & Inventori',
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Pembelian dan perubahan inventory memerlukan koneksi server untuk menjaga keakuratan stok.',
  },
  transfer: {
    page: 'transfer',
    label: 'Kirim Stock/Barang',
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Transfer stok antar outlet memerlukan koneksi server.',
  },
  'audit-log': {
    page: 'audit-log',
    label: 'Audit Log',
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Audit log adalah catatan live dari server dan tidak dapat dilihat offline.',
  },
  settings: {
    page: 'settings',
    label: 'Pengaturan',
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Perubahan pengaturan memerlukan koneksi server.',
  },
  crew: {
    page: 'crew',
    label: 'Kelola Crew',
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Manajemen crew memerlukan koneksi server.',
  },
  plan: {
    page: 'plan',
    label: 'Plan & Pricing',
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Informasi plan memerlukan koneksi server.',
  },
  'multi-outlet': {
    page: 'multi-outlet',
    label: 'Multi Outlet',
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Manajemen multi-outlet memerlukan koneksi server.',
  },
  'inventory-movement': {
    page: 'inventory-movement',
    label: 'Pergerakan Inventory',
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Riwayat pergerakan inventory adalah data live dari server.',
  },
  'stock-opname': {
    page: 'stock-opname',
    label: 'Stock Opname',
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Stock opname mengubah stok di server dan memerlukan koneksi.',
  },
}

/**
 * Get the capability for a route. Returns a safe default (ONLINE_ONLY) for
 * unknown routes so a missing entry never silently enables offline mutation.
 */
export function getRouteCapability(page: PageType): RouteCapability {
  return ROUTE_CAPABILITIES[page] ?? {
    page,
    label: String(page),
    offlineMode: 'ONLINE_ONLY',
    cacheDataSource: 'NONE',
    prefetch: false,
    offlineReason: 'Halaman ini memerlukan koneksi server.',
  }
}

/**
 * Can the user navigate to this route while offline?
 * FULL + READ_ONLY → yes (chunk must be cached though)
 * ONLINE_ONLY → no (blocked before import)
 */
export function isNavigableOffline(page: PageType): boolean {
  const cap = getRouteCapability(page)
  return cap.offlineMode === 'FULL' || cap.offlineMode === 'READ_ONLY'
}

/**
 * Routes whose chunks should be prefetched while online and idle.
 * Used by the service-worker prefetch message.
 */
export const PREFETCH_ROUTES: PageType[] = (Object.values(ROUTE_CAPABILITIES))
  .filter((c) => c.prefetch)
  .map((c) => c.page)

/**
 * List of route labels that work offline (FULL or READ_ONLY),
 * for the "offline features" info dialog.
 */
export const OFFLINE_AVAILABLE_LABELS: string[] = (Object.values(ROUTE_CAPABILITIES))
  .filter((c) => c.offlineMode !== 'ONLINE_ONLY')
  .map((c) => c.label)
