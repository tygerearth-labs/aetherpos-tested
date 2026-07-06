/**
 * InventoryConsumptionService
 *
 * SINGLE SOURCE OF TRUTH untuk semua konsumsi inventory saat transaksi.
 *
 * CRITICAL: Service ini TIDAK bergantung pada flag `hasComposition` di Product.
 *   Malah langsung query ProductComposition — karena flag bisa stale/race condition.
 *   Jika ada composition row → proses. Tidak ada → skip. Simple & reliable.
 *
 * Alur:
 *   POS Checkout → db.$transaction
 *     ↓
 *   consumeForTransaction(tx, items)
 *     ↓
 *   Query ProductComposition langsung (bukan via hasComposition flag)
 *     ↓
 *   validateStock()      ← cek stok cukup, hitung dengan yield
 *     ↓
 *   deductStock()        ← kurangi stok inventory item
 *     ↓
 *   createMovement()      ← log pergerakan CONSUMPTION
 *     ↓
 *   createAuditLog()      ← audit trail
 *     ↓
 *   commit()
 *
 * KONSEP YIELD:
 *   qty = bahan per 1 batch
 *   yieldPerBatch = hasil per 1 batch
 *
 *   Contoh: 1kg kopi → 55 cup
 *     qty = 1, baseUnit = "kg", yieldPerBatch = 55
 *     Jika jual 110 cup → butuh 110/55 = 2 batch → konsumsi 2kg kopi
 *
 *   Default yieldPerBatch = 1 → behavior lama (per-unit, tanpa batch)
 *
 * ATOMICITY:
 *   Service ini MUST dipanggil di dalam prisma.$transaction.
 *   Jika update stok gagal → seluruh transaksi di-rollback.
 */

import { Prisma } from '@prisma/client'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export interface ConsumptionItem {
  productId: string
  variantId?: string | null
  productName: string
  variantName?: string | null
  qty: number
}

export interface InventoryDeduction {
  inventoryItemId: string
  itemName: string
  baseUnit: string
  totalDeducted: number
  previousStock: number
  newStock: number
  sources: Array<{
    productName: string
    variantName?: string
    productQty: number
    batchesUsed: number
    materialPerBatch: number
  }>
}

export interface ConsumptionResult {
  success: true
  deductions: InventoryDeduction[]
  totalMaterialCost: number
}

interface CompositionRow {
  productId: string
  variantId: string | null
  inventoryItemId: string
  qty: number
  yieldPerBatch: number
  baseUnit: string
  inventoryItem: {
    id: string
    name: string
    stock: number
    avgCost: number
  }
}

// ════════════════════════════════════════════════════════════
// Transaction Client Type
// ════════════════════════════════════════════════════════════

type TxClient = Parameters<Parameters<typeof Prisma.prototype.$transaction>[0]>[0]

// ════════════════════════════════════════════════════════════
// Service
// ════════════════════════════════════════════════════════════

export class InventoryConsumptionService {

  /**
   * Main entry point. Dipanggil dari dalam db.$transaction.
   *
   * LANGSUNG query ProductComposition — tidak bergantung pada hasComposition flag.
   * Ini mencegah bug dimana flag stale menyebabkan inventory tidak ter-deduct.
   *
   * 3 skenario produk:
   *   A) Produk + varian + komposisi → deduct per komposisi varian
   *   B) Produk tanpa komposisi      → tidak ada yang di-deduct (correct)
   *   C) Produk tanpa varian + komposisi → deduct per komposisi produk
   *
   * @throws Error jika stok inventory item tidak cukup
   */
  static async consumeForTransaction(
    tx: TxClient,
    params: {
      items: ConsumptionItem[]
      transactionId: string
      invoiceNumber: string
      outletId: string
      userId: string
    }
  ): Promise<ConsumptionResult> {
    const { items, transactionId, invoiceNumber, outletId, userId } = params

    if (items.length === 0) {
      return { success: true, deductions: [], totalMaterialCost: 0 }
    }

    // ── 1. Kumpulkan semua product & variant ID dari item yang dijual ──
    const allProductIds = [...new Set(items.map(i => i.productId))]
    const soldVariantIds = items.filter(i => i.variantId).map(i => i.variantId!)

    // ── 2. LANGSUNG query ProductComposition — bukan via hasComposition flag ──
    //    Ini adalah fix utama: kita cek data aktual, bukan flag yang bisa stale.
    const allComps: CompositionRow[] = await tx.productComposition.findMany({
      where: {
        productId: { in: allProductIds },
        // Fetch: product-level compositions (variantId: null) OR
        //         variant-level compositions for sold variants
        ...(soldVariantIds.length > 0
          ? { OR: [{ variantId: null }, { variantId: { in: soldVariantIds } }] }
          : { variantId: null }
        ),
      },
      include: {
        inventoryItem: {
          select: { id: true, name: true, stock: true, avgCost: true },
        },
      },
    })

    // Jika tidak ada komposisi sama sekali → tidak ada yang perlu di-deduct
    if (allComps.length === 0) {
      console.log(`[InvConsumption] ${invoiceNumber} — no compositions found for ${allProductIds.length} product(s), skipping inventory deduction`)
      return { success: true, deductions: [], totalMaterialCost: 0 }
    }

    // Build lookup: productId → Set of variant IDs that have compositions
    const compProductIds = new Set(allComps.map(c => c.productId))

    // ── 3. Hitung total konsumsi per inventory item ──
    const deductions = new Map<string, {
      itemName: string
      baseUnit: string
      totalDeducted: number
      sources: InventoryDeduction['sources']
    }>()

    for (const item of items) {
      // Skip items yang produknya tidak punya komposisi
      if (!compProductIds.has(item.productId)) continue

      const relevantComps = allComps.filter(c => {
        if (c.productId !== item.productId) return false
        if (item.variantId) return c.variantId === item.variantId
        return c.variantId === null
      })

      if (relevantComps.length === 0) continue

      for (const comp of relevantComps) {
        const yieldPerBatch = comp.yieldPerBatch || 1
        const batchesNeeded = Math.ceil(item.qty / yieldPerBatch)
        const materialNeeded = batchesNeeded * comp.qty

        const existing = deductions.get(comp.inventoryItemId)
        if (existing) {
          existing.totalDeducted += materialNeeded
          existing.sources.push({
            productName: item.productName,
            variantName: item.variantName || undefined,
            productQty: item.qty,
            batchesUsed: batchesNeeded,
            materialPerBatch: comp.qty,
          })
        } else {
          deductions.set(comp.inventoryItemId, {
            itemName: comp.inventoryItem.name,
            baseUnit: comp.baseUnit,
            totalDeducted: materialNeeded,
            sources: [{
              productName: item.productName,
              variantName: item.variantName || undefined,
              productQty: item.qty,
              batchesUsed: batchesNeeded,
              materialPerBatch: comp.qty,
            }],
          })
        }
      }
    }

    if (deductions.size === 0) {
      console.log(`[InvConsumption] ${invoiceNumber} — compositions exist but no relevant matches for sold items, skipping`)
      return { success: true, deductions: [], totalMaterialCost: 0 }
    }

    // ── 4. VALIDASI STOK ──
    const invItemIds = [...deductions.keys()]
    const invItems = await tx.inventoryItem.findMany({
      where: { id: { in: invItemIds } },
      select: { id: true, name: true, stock: true, avgCost: true },
    })
    const stockMap = new Map(invItems.map(i => [i.id, i.stock]))

    for (const [invItemId, deduction] of deductions) {
      const currentStock = stockMap.get(invItemId) ?? 0
      if (currentStock < deduction.totalDeducted) {
        const sourceDesc = deduction.sources
          .map(s => s.variantName ? `${s.productName} (${s.variantName})` : s.productName)
          .join(', ')
        throw new Error(
          `Stok item "${deduction.itemName}" tidak cukup. ` +
          `Tersedia: ${currentStock} ${deduction.baseUnit}, ` +
          `Dibutuhkan: ${deduction.totalDeducted} ${deduction.baseUnit} ` +
          `untuk: ${sourceDesc}`
        )
      }
    }

    // ── 5. DEDUCT STOK ──
    const resultDeductions: InventoryDeduction[] = []
    let totalMaterialCost = 0

    for (const [invItemId, deduction] of deductions) {
      const previousStock = stockMap.get(invItemId) ?? 0
      const newStock = previousStock - deduction.totalDeducted

      await tx.inventoryItem.update({
        where: { id: invItemId },
        data: { stock: newStock },
      })

      const avgCost = invItems.find(i => i.id === invItemId)?.avgCost ?? 0
      totalMaterialCost += deduction.totalDeducted * avgCost

      resultDeductions.push({
        inventoryItemId: invItemId,
        itemName: deduction.itemName,
        baseUnit: deduction.baseUnit,
        totalDeducted: deduction.totalDeducted,
        previousStock,
        newStock,
        sources: deduction.sources,
      })
    }

    console.log(
      `[InvConsumption] ${invoiceNumber} — deducted ${resultDeductions.length} inventory item(s), ` +
      `total material cost: Rp ${totalMaterialCost.toLocaleString('id-ID')}`
    )

    // ── 6. CREATE INVENTORY MOVEMENTS ──
    if (resultDeductions.length > 0) {
      await tx.inventoryMovement.createMany({
        data: resultDeductions.map(d => ({
          type: 'CONSUMPTION',
          inventoryItemId: d.inventoryItemId,
          quantity: -d.totalDeducted,
          previousStock: d.previousStock,
          newStock: d.newStock,
          referenceId: transactionId,
          referenceType: 'TRANSACTION',
          notes: `Konsumsi: ${d.sources.map(s =>
            s.variantName
              ? `${s.productName} (${s.variantName}) ×${s.productQty} [${s.batchesUsed} batch × ${s.materialPerBatch} ${d.baseUnit}]`
              : `${s.productName} ×${s.productQty} [${s.batchesUsed} batch × ${s.materialPerBatch} ${d.baseUnit}]`
          ).join(', ')} (${invoiceNumber})`,
          outletId,
          userId,
        })),
      })
    }

    // ── 7. CREATE AUDIT LOGS ──
    if (resultDeductions.length > 0) {
      await tx.auditLog.createMany({
        data: resultDeductions.map(d => ({
          action: 'COMPOSITION_DEDUCT',
          entityType: 'INVENTORY_ITEM',
          entityId: d.inventoryItemId,
          details: JSON.stringify({
            invoiceNumber,
            itemName: d.itemName,
            baseUnit: d.baseUnit,
            totalDeducted: d.totalDeducted,
            previousStock: d.previousStock,
            newStock: d.newStock,
            materialCost: d.totalDeducted * (invItems.find(i => i.id === d.inventoryItemId)?.avgCost ?? 0),
            sources: d.sources,
          }),
          outletId,
          userId,
        })),
      })
    }

    return {
      success: true,
      deductions: resultDeductions,
      totalMaterialCost,
    }
  }

  /**
   * Helper: validasi saja tanpa mengurangi stok.
   * Berguna untuk pre-check di POS sebelum checkout.
   * Juga TIDAK bergantung pada hasComposition flag.
   */
  static async validateConsumption(
    tx: TxClient,
    items: ConsumptionItem[],
    outletId: string,
  ): Promise<{ valid: true } | { valid: false; error: string }> {
    if (items.length === 0) return { valid: true }

    const allProductIds = [...new Set(items.map(i => i.productId))]
    const soldVariantIds = items.filter(i => i.variantId).map(i => i.variantId!)

    const allComps = await tx.productComposition.findMany({
      where: {
        productId: { in: allProductIds },
        ...(soldVariantIds.length > 0
          ? { OR: [{ variantId: null }, { variantId: { in: soldVariantIds } }] }
          : { variantId: null }
        ),
      },
      include: { inventoryItem: { select: { id: true, name: true, stock: true } } },
    })

    if (allComps.length === 0) return { valid: true }

    const compProductIds = new Set(allComps.map(c => c.productId))

    const deductions = new Map<string, { itemName: string; baseUnit: string; totalDeducted: number; sources: string[] }>()

    for (const item of items) {
      if (!compProductIds.has(item.productId)) continue

      const relevantComps = allComps.filter(c => {
        if (c.productId !== item.productId) return false
        if (item.variantId) return c.variantId === item.variantId
        return c.variantId === null
      })

      for (const comp of relevantComps) {
        const yieldPerBatch = comp.yieldPerBatch || 1
        const batchesNeeded = Math.ceil(item.qty / yieldPerBatch)
        const materialNeeded = batchesNeeded * comp.qty
        const existing = deductions.get(comp.inventoryItemId)
        if (existing) {
          existing.totalDeducted += materialNeeded
          existing.sources.push(item.variantName
            ? `${item.productName} (${item.variantName})`
            : item.productName)
        } else {
          deductions.set(comp.inventoryItemId, {
            itemName: comp.inventoryItem.name,
            baseUnit: comp.baseUnit,
            totalDeducted: materialNeeded,
            sources: [item.variantName
              ? `${item.productName} (${item.variantName})`
              : item.productName],
          })
        }
      }
    }

    const invItemIds = [...deductions.keys()]
    const invItems = await tx.inventoryItem.findMany({
      where: { id: { in: invItemIds } },
      select: { id: true, stock: true },
    })
    const stockMap = new Map(invItems.map(i => [i.id, i.stock]))

    for (const [invItemId, deduction] of deductions) {
      const currentStock = stockMap.get(invItemId) ?? 0
      if (currentStock < deduction.totalDeducted) {
        return {
          valid: false,
          error: `Stok "${deduction.itemName}" tidak cukup. Tersedia: ${currentStock} ${deduction.baseUnit}, Dibutuhkan: ${deduction.totalDeducted} ${deduction.baseUnit} untuk: ${deduction.sources.join(', ')}`,
        }
      }
    }

    return { valid: true }
  }
}