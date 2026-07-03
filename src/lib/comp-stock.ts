/**
 * comp-stock.ts — Composition stock capacity helper
 *
 * Calculates the maximum number of product/variant units that can be made
 * based on available inventory stock for each composition item.
 * Supports both product-level and per-variant compositions.
 */

import { db } from '@/lib/db'

interface MaxStockResult {
  maxStock: number
  limitingItem: { name: string; available: number; required: number } | null
}

/**
 * Get max possible stock for a NON-VARIANT product based on its composition.
 * maxStock = min(availableStock / compQty) across all composition items.
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
    const available = comp.inventoryItem.stock
    const required = comp.qty
    if (required <= 0) continue
    const possible = Math.floor(available / required)
    if (possible < maxStock) {
      maxStock = possible
      limitingItem = {
        name: comp.inventoryItem.name,
        available,
        required,
      }
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
    const available = comp.inventoryItem.stock
    const required = comp.qty
    if (required <= 0) continue
    const possible = Math.floor(available / required)
    if (possible < maxStock) {
      maxStock = possible
      limitingItem = {
        name: comp.inventoryItem.name,
        available,
        required,
      }
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
      return `Stok melebihi kapasitas bahan baku. "${limitingItem.name}" hanya tersedia ${limitingItem.available} (butuh ${limitingItem.required} per produk). Maksimal: ${maxStock} unit.`
    }
    return `Stok melebihi kapasitas bahan baku. Maksimal: ${maxStock} unit.`
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
      return `Stok "${variantName}" melebihi kapasitas bahan baku. "${limitingItem.name}" hanya tersedia ${limitingItem.available} (butuh ${limitingItem.required} per varian). Maksimal: ${maxStock} unit.`
    }
    return `Stok "${variantName}" melebihi kapasitas bahan baku. Maksimal: ${maxStock} unit.`
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