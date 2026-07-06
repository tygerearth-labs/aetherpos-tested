/**
 * comp-stock.ts — Composition stock capacity helper (yield-aware)
 *
 * Calculates the maximum number of product/variant units that can be made
 * based on available inventory stock for each composition item.
 * Supports both product-level and per-variant compositions.
 *
 * YIELD AWARENESS:
 *   qty = bahan per 1 batch
 *   yieldPerBatch = hasil per 1 batch (default 1)
 *   Contoh: 1kg kopi → 55 cup → qty=1, yieldPerBatch=55
 *   maxStock dari kopi = floor(availableKopi_kg / qty) * yieldPerBatch
 *     = floor(2 / 1) * 55 = 110 cup
 */

import { db } from '@/lib/db'

interface MaxStockResult {
  maxStock: number
  limitingItem: { name: string; available: number; required: number; yieldPerBatch: number } | null
}

/**
 * Hitung max produk dari 1 item komposisi, yield-aware.
 */
function calcMaxFromComp(
  availableStock: number,
  compQty: number,
  yieldPerBatch: number,
  itemName: string
): MaxStockResult {
  if (compQty <= 0 || yieldPerBatch <= 0) {
    return { maxStock: Infinity, limitingItem: null }
  }
  const maxBatches = Math.floor(availableStock / compQty)
  const maxStock = maxBatches * yieldPerBatch
  const limitingItem = {
    name: itemName,
    available: availableStock,
    required: compQty,
    yieldPerBatch,
  }
  return { maxStock, limitingItem }
}

/**
 * Get max possible stock for a NON-VARIANT product based on its composition.
 *
 * Dengan yield:
 *   maxStock = min across all items of: floor(available / qty) * yieldPerBatch
 *
 * Tanpa yield (yieldPerBatch=1, backward compat):
 *   maxStock = min across all items of: floor(available / qty)
 */
export async function getMaxStockFromComposition(
  productId: string,
  outletId: string
): Promise<MaxStockResult> {
  const compositions = await db.productComposition.findMany({
    where: { productId, variantId: null },
    include: {
      inventoryItem: {
        select: { id: true, name: true, stock: true },
      },
    },
  })

  if (compositions.length === 0) {
    return { maxStock: Infinity, limitingItem: null }
  }

  let maxStock = Infinity
  let limitingItem: MaxStockResult['limitingItem'] = null

  for (const comp of compositions) {
    const result = calcMaxFromComp(
      comp.inventoryItem.stock,
      comp.qty,
      comp.yieldPerBatch || 1, // backward compat
      comp.inventoryItem.name
    )
    if (result.maxStock < maxStock) {
      maxStock = result.maxStock
      limitingItem = result.limitingItem
    }
  }

  return { maxStock, limitingItem }
}

/**
 * Get max possible stock for a VARIANT based on its own composition.
 */
export async function getMaxStockFromVariantComposition(
  variantId: string
): Promise<MaxStockResult> {
  const compositions = await db.productComposition.findMany({
    where: { variantId },
    include: {
      inventoryItem: {
        select: { id: true, name: true, stock: true },
      },
    },
  })

  if (compositions.length === 0) {
    return { maxStock: Infinity, limitingItem: null }
  }

  let maxStock = Infinity
  let limitingItem: MaxStockResult['limitingItem'] = null

  for (const comp of compositions) {
    const result = calcMaxFromComp(
      comp.inventoryItem.stock,
      comp.qty,
      comp.yieldPerBatch || 1,
      comp.inventoryItem.name
    )
    if (result.maxStock < maxStock) {
      maxStock = result.maxStock
      limitingItem = result.limitingItem
    }
  }

  return { maxStock, limitingItem }
}

/**
 * Validate that a target stock doesn't exceed composition capacity for a non-variant product.
 * Returns null if valid, or an error message string if invalid.
 */
export async function validateCompositionStock(
  productId: string,
  outletId: string,
  targetStock: number
): Promise<string | null> {
  const { maxStock, limitingItem } = await getMaxStockFromComposition(productId, outletId)

  if (maxStock === Infinity) return null

  if (targetStock > maxStock) {
    if (limitingItem) {
      const yieldInfo = limitingItem.yieldPerBatch > 1
        ? ` (1 batch = ${limitingItem.required} ${limitingItem?.name?.split(' ')[0] || ''} → ${limitingItem.yieldPerBatch} produk)`
        : ''
      return `Stok melebihi kapasitas item. "${limitingItem.name}" hanya tersedia ${limitingItem.available} (butuh ${limitingItem.required} per batch${yieldInfo}). Maksimal: ${maxStock} unit.`
    }
    return `Stok melebihi kapasitas item. Maksimal: ${maxStock} unit.`
  }

  return null
}

/**
 * Validate that a target stock doesn't exceed composition capacity for a variant.
 * Returns null if valid, or an error message string if invalid.
 */
export async function validateVariantCompositionStock(
  variantId: string,
  variantName: string,
  targetStock: number
): Promise<string | null> {
  const { maxStock, limitingItem } = await getMaxStockFromVariantComposition(variantId)

  if (maxStock === Infinity) return null

  if (targetStock > maxStock) {
    if (limitingItem) {
      const yieldInfo = limitingItem.yieldPerBatch > 1
        ? ` (1 batch = ${limitingItem.required} → ${limitingItem.yieldPerBatch} varian)`
        : ''
      return `Stok "${variantName}" melebihi kapasitas item. "${limitingItem.name}" hanya tersedia ${limitingItem.available} (butuh ${limitingItem.required} per batch${yieldInfo}). Maksimal: ${maxStock} unit.`
    }
    return `Stok "${variantName}" melebihi kapasitas item. Maksimal: ${maxStock} unit.`
  }

  return null
}

/**
 * Batch validate variant composition stock for multiple variants.
 * Returns an array of error messages (empty if all valid).
 */
export async function validateVariantCompositionStockBatch(
  variantStocks: Array<{ variantId: string; variantName: string; currentStock: number; addStock: number }>
): Promise<string[]> {
  const errors: string[] = []

  for (const vs of variantStocks) {
    // Only validate if this variant has compositions
    const compCount = await db.productComposition.count({
      where: { variantId: vs.variantId },
    })
    if (compCount === 0) continue

    const targetStock = vs.currentStock + vs.addStock
    const error = await validateVariantCompositionStock(vs.variantId, vs.variantName, targetStock)
    if (error) errors.push(error)
  }

  return errors
}