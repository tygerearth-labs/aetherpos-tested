/**
 * POS Hooks — Phase 1A Modularization
 *
 * Extracted from pos-page.tsx (3516 lines → orchestrator + 6 hooks)
 *
 * Usage in new pos-page.tsx:
 * ```tsx
 * import { usePosSettings } from './hooks'
 * import { usePosProducts } from './hooks'
 * // etc.
 * ```
 *
 * @phase 1A — Complete
 */

export { usePosSettings } from './use-pos-settings'
export type { OutletSettings, OutletInfo, UserOutlet, PromoInfo } from './use-pos-settings'

export { usePosProducts } from './use-pos-products'
export type { Product, ProductVariant, Category, VariantPickerState, CartItem } from './use-pos-products'

export { usePosCustomers } from './use-pos-customers'
export type { Customer } from './use-pos-customers'

export { usePosCart } from './use-pos-cart'
export type { CartItem as CartItemFull, BelowHppItem } from './use-pos-cart'

export { usePosSync } from './use-pos-sync'

export { usePosCheckout } from './use-pos-checkout'
export type { CheckoutResult, PendingTransaction } from './use-pos-checkout'
