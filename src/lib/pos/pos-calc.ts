/**
 * pos-calc.ts — Shared calculation engine for POS (online + offline).
 *
 * RECOVERY 2026-07-24: service-charge/rounding FOLDING REMOVED.
 *   The locked server contract is `total = subtotal − discount + taxAmount`
 *   where discount = manualDiscount + promoDiscount + pointsDiscount.
 *   Service charge and rounding were POS-local features with no server field.
 *   Folding them into `discount` (as negative) broke calculation integrity
 *   (negative discounts, wrong audit trail, wrong reports). They are now
 *   REMOVED so the client total == server total == grandTotal exactly.
 *
 * Pipeline (matches LOCKED server formula exactly):
 *   subtotal          = Σ(item.price × qty)            [original price]
 *   manualDiscount    = Σ((origPrice − effPrice) × qty) [per-item customPrice]
 *   promoDiscount     = promo applied to (subtotal − manualDiscount)
 *   pointsDiscount    = pointsToUse × loyaltyPointValue
 *   taxAmount         = ppnEnabled ? round((subtotal − manualDiscount − promoDiscount − pointsDiscount) × ppnRate / 100) : 0
 *   grandTotal        = subtotal − manualDiscount − promoDiscount − pointsDiscount + taxAmount
 *
 *   discount (sent to server) = manualDiscount + promoDiscount + pointsDiscount
 *   server check: total = subtotal − discount + taxAmount = grandTotal  ✓
 *
 * Snapshots are persisted in the transactionOutbox for audit/receipt parity.
 *
 * @boundary COCKPIT only — pure calculation, no engine imports.
 */

// ════════════════════════════════════════════════════════════
// Input types
// ════════════════════════════════════════════════════════════

export interface CalcCartItem {
  product: {
    id: string
    name: string
    price: number
    hpp: number
    stock: number
    sku?: string | null
    barcode?: string | null
  }
  variant: {
    id: string
    name: string
    price: number
    hpp: number
    stock: number
    sku?: string | null
    barcode?: string | null
  } | null
  qty: number
  customPrice: number | null // override unit price (null = use original)
}

export interface CalcSettings {
  ppnEnabled: boolean
  ppnRate: number
  loyaltyPointValue: number
}

export interface CalcPromo {
  id: string | null
  type: string // 'PERCENTAGE' | 'NOMINAL'
  value: number
  minPurchase?: number | null
  maxDiscount?: number | null
}

// ════════════════════════════════════════════════════════════
// Output types
// ════════════════════════════════════════════════════════════

export interface CalcResult {
  subtotal: number
  manualDiscountTotal: number
  pointsDiscount: number
  promoDiscount: number
  taxAmount: number
  grandTotal: number
  /** discount value sent to the LOCKED server (= manual + promo + points). */
  discount: number
  /** max loyalty points the customer can spend. */
  maxPointsToUse: number
  /** change for CASH payment (0 for non-cash). */
  change: (paidAmount: number, paymentMethod: string) => number
  /** persisted snapshot for audit/receipt. */
  snapshot: {
    itemPrices: Array<{
      productId: string
      variantId: string | null
      price: number
      qty: number
      customPrice: number | null
      effectivePrice: number
      itemDiscount: number
    }>
    manualDiscount: number
    promoDiscount: number
    pointsDiscount: number
    taxAmount: number
    grandTotal: number
    promoId: string | null
    pointsUsed: number
    ppnRate: number
  }
}

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════

/** Round to nearest integer (Rp). */
function rp(n: number): number {
  return Math.round(n)
}

/** Get the original unit price for an item (variant or product). */
export function getItemPrice(item: CalcCartItem): number {
  return item.variant ? item.variant.price : item.product.price
}

/** Get the effective unit price (customPrice override or original). */
export function getEffectivePrice(item: CalcCartItem): number {
  return item.customPrice != null ? item.customPrice : getItemPrice(item)
}

/** Get stock for an item (variant or product). */
export function getItemStock(item: CalcCartItem): number {
  return item.variant ? item.variant.stock : item.product.stock
}

/** Get HPP for an item (variant or product). */
export function getItemHpp(item: CalcCartItem): number {
  return item.variant ? item.variant.hpp : item.product.hpp
}

/** Get display name for an item. */
export function getItemDisplayName(item: CalcCartItem): string {
  return item.variant ? `${item.product.name} - ${item.variant.name}` : item.product.name
}

/** Composite cart key for dedup. */
export function getCartKey(productId: string, variantId: string | null): string {
  return variantId ? `${productId}_${variantId}` : productId
}

// ════════════════════════════════════════════════════════════
// Main calculation
// ════════════════════════════════════════════════════════════

/**
 * Calculate the full POS totals using the shared engine.
 *
 * @param cart              cart items
 * @param settings          outlet settings (ppn, loyalty)
 * @param selectedCustomer  selected customer (for points); null = no customer
 * @param pointsToUse       loyalty points to redeem
 * @param promo             selected promo; null = no promo
 */
export function calcTotals(
  cart: CalcCartItem[],
  settings: CalcSettings,
  selectedCustomer: { points: number } | null,
  pointsToUse: number,
  promo: CalcPromo | null,
): CalcResult {
  // ── 1. Subtotal + manual discount (per-item customPrice) ──
  let subtotal = 0
  let manualDiscountTotal = 0
  const itemPrices: CalcResult['snapshot']['itemPrices'] = []
  for (const item of cart) {
    const orig = getItemPrice(item)
    const eff = getEffectivePrice(item)
    const lineOrig = orig * item.qty
    const lineEff = eff * item.qty
    subtotal += lineOrig
    manualDiscountTotal += Math.round(lineOrig - lineEff)
    itemPrices.push({
      productId: item.product.id,
      variantId: item.variant?.id || null,
      price: orig,
      qty: item.qty,
      customPrice: item.customPrice,
      effectivePrice: eff,
      itemDiscount: Math.round(lineOrig - lineEff),
    })
  }
  subtotal = rp(subtotal)
  manualDiscountTotal = rp(manualDiscountTotal)

  // ── 2. Promo discount (applied to subtotal after manual discount) ──
  const baseForPromo = Math.max(0, subtotal - manualDiscountTotal)
  let promoDiscount = 0
  if (promo && promo.id) {
    const minPurchase = promo.minPurchase ?? 0
    if (baseForPromo >= minPurchase) {
      if (promo.type === 'PERCENTAGE') {
        const pct = Math.min(100, Math.max(0, promo.value))
        promoDiscount = rp((baseForPromo * pct) / 100)
        if (promo.maxDiscount && promo.maxDiscount > 0) {
          promoDiscount = Math.min(promoDiscount, promo.maxDiscount)
        }
      } else if (promo.type === 'NOMINAL') {
        promoDiscount = Math.max(0, rp(promo.value))
        if (promo.maxDiscount && promo.maxDiscount > 0) {
          promoDiscount = Math.min(promoDiscount, promo.maxDiscount)
        }
      }
      promoDiscount = Math.min(promoDiscount, baseForPromo)
    }
  }

  // ── 3. Loyalty points ──
  const maxPointsToUse = selectedCustomer ? selectedCustomer.points : 0
  const safePoints = Math.min(Math.max(0, pointsToUse), maxPointsToUse)
  const pointsDiscount = rp(safePoints * settings.loyaltyPointValue)

  // ── 4. Tax (PPN) on the discounted base ──
  const baseAfterAllDiscounts = Math.max(0, subtotal - manualDiscountTotal - promoDiscount - pointsDiscount)
  const taxAmount = settings.ppnEnabled
    ? rp((baseAfterAllDiscounts * (settings.ppnRate || 0)) / 100)
    : 0

  // ── 5. Grand total (matches LOCKED server formula exactly) ──
  //   grandTotal = subtotal − discount + taxAmount
  //   discount   = manualDiscount + promoDiscount + pointsDiscount
  const discount = manualDiscountTotal + promoDiscount + pointsDiscount
  const grandTotal = Math.max(0, rp(subtotal - discount + taxAmount))

  return {
    subtotal,
    manualDiscountTotal,
    pointsDiscount,
    promoDiscount,
    taxAmount,
    grandTotal,
    discount,
    maxPointsToUse,
    change: (paidAmount: number, paymentMethod: string) =>
      paymentMethod === 'CASH' ? Math.max(0, rp(paidAmount - grandTotal)) : 0,
    snapshot: {
      itemPrices,
      manualDiscount: manualDiscountTotal,
      promoDiscount,
      pointsDiscount,
      taxAmount,
      grandTotal,
      promoId: promo?.id || null,
      pointsUsed: safePoints,
      ppnRate: settings.ppnRate || 0,
    },
  }
}

/**
 * Build the checkout payload (shared by online + offline).
 * Uses the LOCKED server-expected shape.
 *
 * RECOVERY: `discount` is now the clean sum (manual + promo + points),
 * no service-charge/rounding folding. Server recomputes
 * `total = subtotal − discount + taxAmount` and it will equal grandTotal.
 */
export function buildCheckoutPayload(
  cart: CalcCartItem[],
  calc: CalcResult,
  opts: {
    customerId: string | null
    customerIsLocal?: boolean
    paymentMethod: string
    paidAmount: number
    promoId?: string | null
    pointsUsed: number
  },
): {
  customerId: string | null
  items: Array<{
    productId: string
    productName: string
    price: number
    qty: number
    subtotal: number
    variantId?: string | null
    variantName?: string | null
    itemDiscount?: number
  }>
  subtotal: number
  discount: number
  pointsUsed: number
  taxAmount: number
  total: number
  paymentMethod: string
  paidAmount: number
  change: number
  promoId?: string | null
  promoDiscount?: number
} {
  const items = cart.map((item) => {
    const price = getItemPrice(item)
    const eff = getEffectivePrice(item)
    const lineOrig = price * item.qty
    const lineEff = eff * item.qty
    return {
      productId: item.product.id,
      productName: item.product.name,
      price,
      qty: item.qty,
      subtotal: rp(lineOrig),
      variantId: item.variant?.id || null,
      variantName: item.variant?.name || null,
      itemDiscount: Math.round(lineOrig - lineEff),
    }
  })

  const change = opts.paymentMethod === 'CASH'
    ? Math.max(0, rp(opts.paidAmount - calc.grandTotal))
    : 0

  return {
    customerId: opts.customerId,
    items,
    subtotal: calc.subtotal,
    discount: calc.discount,
    pointsUsed: opts.pointsUsed,
    taxAmount: calc.taxAmount,
    total: calc.grandTotal,
    paymentMethod: opts.paymentMethod,
    paidAmount: opts.paymentMethod === 'CASH' ? opts.paidAmount : calc.grandTotal,
    change,
    promoId: opts.promoId || null,
    promoDiscount: calc.promoDiscount,
  }
}
