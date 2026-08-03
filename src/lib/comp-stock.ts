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
 *
 * V14.1 FIX (transaction isolation):
 *   Semua fungsi getMaxStockFrom* sekarang menerima parameter `tx` opsional.
 *   Jika dipanggil di dalam $transaction, WAJIB pass `tx` agar query melihat
 *   data yang baru di-create/delete di dalam transaksi yang sama. Sebelumnya
 *   semua fungsi pakai `db` (separate connection) → di PostgreSQL Read
 *   Committed, writes di dalam transaksi TIDAK terlihat oleh `db` query,
 *   sehingga maxStock dihitung dari data STALE (komposisi LAMA sebelum delete,
 *   atau kosong untuk first-time create). Ini penyebab bug "stock return 0
 *   padahal toast sukses" — komposisi baru tidak terlihat, maxStock jadi 0
 *   (karena salah satu inventory item di komposisi LAMA sudah habis),
 *   lalu produk di-cap ke 0 secara silent.
 */

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

type TxClient = Prisma.TransactionClient

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
 *
 * V14.1: Jika dipanggil di dalam $transaction, pass `tx` agar query melihat
 * writes yang baru dilakukan di transaksi tersebut.
 */
export async function getMaxStockFromComposition(
  productId: string,
  outletId: string,
  tx?: TxClient
): Promise<MaxStockResult> {
  const client = tx ?? db
  const compositions = await client.productComposition.findMany({
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
 *
 * V14.1: Jika dipanggil di dalam $transaction, pass `tx` agar query melihat
 * writes yang baru dilakukan di transaksi tersebut.
 */
export async function getMaxStockFromVariantComposition(
  variantId: string,
  tx?: TxClient
): Promise<MaxStockResult> {
  const client = tx ?? db
  const compositions = await client.productComposition.findMany({
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

/* -------------------------------------------------------------------------- */
/*  PRODUCT STOCK AUTO-SYNC FROM INVENTORY                                    */
/* -------------------------------------------------------------------------- */
/*
 * Goal:
 *   InventoryItem is the source of truth. Whenever InventoryItem.stock changes
 *   (purchase POST/PUT/DELETE, inventory adjust), recompute the sellable
 *   capacity of every linked Product and ProductVariant.
 *
 * Rules:
 *   - unlinked product (no composition)            → Product.stock UNCHANGED (manual)
 *   - linked non-variant product (hasComposition)  → Product.stock = capacity
 *   - linked variant                               → Variant.stock = capacity (independent)
 *   - parent product of variants                   → Product.stock = Σ variant.stock
 *   - capacity may increase, decrease, or become zero
 *   - run inside the caller's $transaction so the new InventoryItem.stock is visible
 *
 * Formula (per composition row):
 *   capacity = floor(inventoryItem.stock / qty) * yieldPerBatch
 *   product capacity = min across all composition rows (bottleneck)
 *
 * No audit / InventoryMovement is emitted here — those exist for inventory-level
 * events (RESTOCK / ADJUSTMENT / PURCHASE). Product.stock is a derived cache.
 */

export interface RecalcDetail {
  id: string
  name: string
  oldStock: number
  newStock: number
  type: 'product' | 'variant' | 'product-parent'
}

export interface RecalcResult {
  recalculated: number
  details: RecalcDetail[]
}

/**
 * Recalculate stock for every Product and ProductVariant that has a
 * composition row referencing any of the supplied inventoryItemIds.
 *
 * MUST be called inside the caller's $transaction so the freshest
 * InventoryItem.stock is read (V14.1 transaction-isolation rule).
 */
export async function recalculateAffectedProductStock(
  tx: TxClient,
  outletId: string,
  inventoryItemIds: string[]
): Promise<RecalcResult> {
  if (!inventoryItemIds.length) return { recalculated: 0, details: [] }

  // Find every composition row touching the affected inventory items.
  // This catches product-level (variantId=null) and variant-level rows.
  const affectedComps = await tx.productComposition.findMany({
    where: { inventoryItemId: { in: inventoryItemIds } },
    select: { productId: true, variantId: true, inventoryItemId: true },
  })

  if (affectedComps.length === 0) return { recalculated: 0, details: [] }

  const productIds = Array.from(new Set(affectedComps.map((c) => c.productId)))
  const variantIds = Array.from(
    new Set(affectedComps.filter((c) => c.variantId).map((c) => c.variantId as string))
  )

  const details: RecalcDetail[] = []

  // PHASE 1 — recompute each affected variant independently.
  // Bottleneck formula via getMaxStockFromVariantComposition (tx-aware).
  for (const variantId of variantIds) {
    const result = await getMaxStockFromVariantComposition(variantId, tx)
    if (result.maxStock === Infinity) continue // no real cap, leave as-is

    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, name: true, stock: true, productId: true },
    })
    if (!variant) continue

    const newStock = Math.max(0, Math.floor(result.maxStock))
    if (variant.stock !== newStock) {
      await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: newStock },
      })
      details.push({
        id: variantId,
        name: variant.name,
        oldStock: variant.stock,
        newStock,
        type: 'variant',
      })
    }
  }

  // PHASE 2 — recompute each affected product.
  for (const productId of productIds) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, stock: true, hasVariants: true, outletId: true, hasComposition: true },
    })
    if (!product) continue
    // Scope check — composition rows can technically link across outlets, but
    // we only update products owned by the supplied outletId to be safe.
    if (product.outletId !== outletId) continue

    if (product.hasVariants) {
      // Parent stock = Σ variant.stock (recalculated or unchanged).
      // This mirrors the existing POS checkout pattern (line ~318-331).
      const variants = await tx.productVariant.findMany({
        where: { productId },
        select: { stock: true },
      })
      const sumStock = variants.reduce((sum, v) => sum + v.stock, 0)
      if (product.stock !== sumStock) {
        await tx.product.update({
          where: { id: productId },
          data: { stock: sumStock },
        })
        details.push({
          id: productId,
          name: product.name,
          oldStock: product.stock,
          newStock: sumStock,
          type: 'product-parent',
        })
      }
    } else if (product.hasComposition) {
      // Non-variant linked product — recompute via bottleneck formula.
      const result = await getMaxStockFromComposition(productId, product.outletId, tx)
      if (result.maxStock === Infinity) continue

      const newStock = Math.max(0, Math.floor(result.maxStock))
      if (product.stock !== newStock) {
        await tx.product.update({
          where: { id: productId },
          data: { stock: newStock },
        })
        details.push({
          id: productId,
          name: product.name,
          oldStock: product.stock,
          newStock,
          type: 'product',
        })
      }
    }
    // If a product shows up in affectedComps but has hasComposition=false and
    // hasVariants=false, it means composition rows exist without the flag set
    // (data drift). We leave the product stock alone — only linked products
    // get auto-synced per the spec.
  }

  return { recalculated: details.length, details }
}