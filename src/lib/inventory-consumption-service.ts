/**
 * InventoryConsumptionService
 *
 * SINGLE SOURCE OF TRUTH untuk semua konsumsi inventory saat transaksi.
 *
 * Alur:
 *   CreateTransaction()
 *     ↓
 *   consumeInventory(tx, items)
 *     ↓ foreach TransactionItem
 *     validateStock()      ← cek stok cukup, hitung dengan yield
 *     ↓
 *     consumeInventory()    ← kurangi stok bahan baku
 *     ↓
 *     createMovement()      ← log pergerakan CONSUMPTION
 *     ↓
 *     createAuditLog()      ← audit trail
 *     ↓
 *   commit()                ← prisma.$transaction handle ini
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
 *   Tidak ada kondisi "transaksi berhasil tapi stok gagal".
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
  qty: number // qty produk yang dijual
}

export interface InventoryDeduction {
  inventoryItemId: string
  itemName: string
  baseUnit: string
  totalDeducted: number // jumlah bahan yang dikurangi (sudah dihitung dengan yield)
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
  totalMaterialCost: number // total biaya bahan yang dikonsumsi
}

interface CompositionRow {
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
   * 1. Validasi stok bahan baku cukup untuk semua item
   * 2. Kurangi stok bahan baku
   * 3. Buat inventory movement (CONSUMPTION)
   * 4. Buat audit log
   *
   * @throws Error jika stok bahan baku tidak cukup
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

    // 1. Identifikasi produk yang punya komposisi
    const compositionProductIds = [...new Set(
      items.map(i => i.productId)
    )]

    // Cek mana yang punya komposisi
    const products = await tx.product.findMany({
      where: { id: { in: compositionProductIds }, hasComposition: true },
      select: { id: true, hasVariants: true },
    })
    const compProductSet = new Set(products.map(p => p.id))

    const compItems = items.filter(i => compProductSet.has(i.productId))
    if (compItems.length === 0) {
      return { success: true, deductions: [], totalMaterialCost: 0 }
    }

    // 2. Fetch semua komposisi yang relevan (product-level + variant-level)
    const variantIds = compItems.filter(i => i.variantId).map(i => i.variantId!)

    const allComps: CompositionRow[] = await tx.productComposition.findMany({
      where: {
        productId: { in: compProductSet },
        ...(variantIds.length > 0 ? {
          OR: [
            { variantId: null },
            { variantId: { in: variantIds } },
          ]
        } : { variantId: null }),
      },
      include: {
        inventoryItem: {
          select: { id: true, name: true, stock: true, avgCost: true },
        },
      },
    })

    if (allComps.length === 0) {
      return { success: true, deductions: [], totalMaterialCost: 0 }
    }

    // 3. Hitung total konsumsi per inventory item
    //    Key insight: untuk setiap item terjual, hitung berapa batch yang dibutuhkan
    //    batchesNeeded = ceil(productQty / yieldPerBatch)
    //    materialNeeded = batchesNeeded * qty
    const deductions = new Map<string, {
      itemName: string
      baseUnit: string
      totalDeducted: number
      sources: InventoryDeduction['sources']
    }>()

    for (const item of compItems) {
      const relevantComps = allComps.filter(c => {
        if (c.productId !== item.productId) return false
        if (item.variantId) return c.variantId === item.variantId
        return c.variantId === null
      })

      for (const comp of relevantComps) {
        const yieldPerBatch = comp.yieldPerBatch || 1 // backward compat
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

    // 4. VALIDASI STOK — cek sebelum deduct
    const invItemIds = [...deductions.keys()]
    const invItems = await tx.inventoryItem.findMany({
      where: { id: { in: invItemIds } },
      select: { id: true, name: true, stock: true },
    })
    const stockMap = new Map(invItems.map(i => [i.id, i.stock]))

    for (const [invItemId, deduction] of deductions) {
      const currentStock = stockMap.get(invItemId) ?? 0
      if (currentStock < deduction.totalDeducted) {
        const sourceDesc = deduction.sources
          .map(s => s.variantName ? `${s.productName} (${s.variantName})` : s.productName)
          .join(', ')
        throw new Error(
          `Stok bahan "${deduction.itemName}" tidak cukup. ` +
          `Tersedia: ${currentStock} ${deduction.baseUnit}, ` +
          `Dibutuhkan: ${deduction.totalDeducted} ${deduction.baseUnit} ` +
          `untuk: ${sourceDesc}`
        )
      }
    }

    // 5. DEDUCT STOK — kurangi stok bahan baku
    const resultDeductions: InventoryDeduction[] = []
    let totalMaterialCost = 0

    for (const [invItemId, deduction] of deductions) {
      const previousStock = stockMap.get(invItemId) ?? 0
      const newStock = previousStock - deduction.totalDeducted

      await tx.inventoryItem.update({
        where: { id: invItemId },
        data: { stock: newStock },
      })

      // Hitung biaya material (avgCost × qty deducted)
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

    // 6. CREATE INVENTORY MOVEMENTS
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

    // 7. CREATE AUDIT LOGS
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
   */
  static async validateConsumption(
    tx: TxClient,
    items: ConsumptionItem[],
    outletId: string,
  ): Promise<{ valid: true } | { valid: false; error: string }> {
    const compositionProductIds = [...new Set(items.map(i => i.productId))]
    const products = await tx.product.findMany({
      where: { id: { in: compositionProductIds }, hasComposition: true, outletId },
      select: { id: true },
    })
    const compProductSet = new Set(products.map(p => p.id))
    const compItems = items.filter(i => compProductSet.has(i.productId))
    if (compItems.length === 0) return { valid: true }

    const variantIds = compItems.filter(i => i.variantId).map(i => i.variantId!)
    const allComps = await tx.productComposition.findMany({
      where: {
        productId: { in: compProductSet },
        ...(variantIds.length > 0 ? {
          OR: [
            { variantId: null },
            { variantId: { in: variantIds } },
          ]
        } : { variantId: null }),
      },
      include: { inventoryItem: { select: { id: true, name: true, stock: true } } },
    })

    if (allComps.length === 0) return { valid: true }

    const deductions = new Map<string, { itemName: string; baseUnit: string; totalDeducted: number; sources: string[] }>()

    for (const item of compItems) {
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