'use client'

/**
 * useCriticalActivity — declaratively register a critical activity while
 * `active` is true. Automatically unregisters on unmount or when active
 * becomes false.
 *
 * Usage:
 *   useCriticalActivity('pos-cart', 'pos-cart', 'Keranjang POS', cart.length > 0)
 *   useCriticalActivity('dirty-form', 'product-form', 'Form produk belum disimpan', isDirty)
 *   useCriticalActivity('file-upload', `export-${id}`, 'Export transaksi', isExporting, 'interrupt')
 *
 * The store's register() is idempotent, so re-renders with the same args are
 * cheap (no state change → no extra re-render).
 */

import { useEffect } from 'react'
import {
  useCriticalActivityStore,
  type CriticalActivityType,
  type ActivitySeverity,
} from '@/lib/build-guard/critical-activity-registry'

export function useCriticalActivity(
  type: CriticalActivityType,
  id: string,
  label: string,
  active: boolean,
  severity: ActivitySeverity = 'data-loss',
): void {
  useEffect(() => {
    if (!active) return
    useCriticalActivityStore.getState().register(id, type, label, severity)
    return () => {
      useCriticalActivityStore.getState().unregister(id)
    }
  }, [id, type, label, active, severity])
}
