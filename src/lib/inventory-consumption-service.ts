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
import type { CheckoutPerf } from '@/lib/perf-timer'

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
  materialCost: number                  // Actual COGS for this deduction: Σ(batch.qty × batch.unitCost) for batch items, OR avgCost × totalDeducted for non-batch
  unitCostSnapshot: string | null       // JSON: [{batchId, batchNumber, unitCost, quantityConsumed, expiredDate}] — null when no batches used (Mode B fallback to avgCost)
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
    perf: CheckoutPerf | null,
    params: {
      items: ConsumptionItem[]
      transactionId: string
      invoiceNumber: string
      outletId: string
      userId: string
    }
  ): Promise<ConsumptionResult> {
    const { items, transactionId, invoiceNumber, outletId, userId } = params

    const trackQuery = () => perf?.trackQuery()

    if (items.length === 0) {
      return { success: true, deductions: [], totalMaterialCost: 0 }
    }

    // ── 1. Kumpulkan semua product & variant ID dari item yang dijual ──
    const allProductIds = [...new Set(items.map(i => i.productId))]
    const soldVariantIds = items.filter(i => i.variantId).map(i => i.variantId!)

    // ── 2. LANGSUNG query ProductComposition — bukan via hasComposition flag ──
    //    Ini adalah fix utama: kita cek data aktual, bukan flag yang bisa stale.
    trackQuery()
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

    // ── 4. ATOMIC STOK VALIDASI + DEDUCT ──
    //    Race-condition-free: UPDATE SET stock = stock - qty WHERE stock >= qty
    //    Jika affected = 0 → stok tidak cukup (mungkin transaksi lain ambil duluan)
    const invItemIds = [...deductions.keys()]
    trackQuery()
    const invItems = await tx.inventoryItem.findMany({
      where: { id: { in: invItemIds } },
      select: { id: true, name: true, stock: true, avgCost: true },
    })
    const stockMap = new Map<string, number>(invItems.map(i => [i.id, i.stock]))
    const costMap = new Map<string, number>(invItems.map(i => [i.id, Number(i.avgCost)]))

    const resultDeductions: InventoryDeduction[] = []
    let totalMaterialCost = 0

    for (const [invItemId, deduction] of deductions) {
      const previousStock = stockMap.get(invItemId) ?? 0

      // Atomic: check + decrement in one SQL operation
      trackQuery()
      const affected = (await tx.$executeRaw`
        UPDATE "InventoryItem" SET stock = stock - ${deduction.totalDeducted}
        WHERE id = ${invItemId} AND stock >= ${deduction.totalDeducted}
      `) as number
      if (affected === 0) {
        const sourceDesc = deduction.sources
          .map(s => s.variantName ? `${s.productName} (${s.variantName})` : s.productName)
          .join(', ')
        throw new Error(
          `Stok item "${deduction.itemName}" tidak cukup. ` +
          `Tersedia: ${previousStock} ${deduction.baseUnit}, ` +
          `Dibutuhkan: ${deduction.totalDeducted} ${deduction.baseUnit} ` +
          `untuk: ${sourceDesc}. Kemungkinan stok terakhir sudah diambil transaksi lain.`
        )
      }

      const newStock = (previousStock as number) - deduction.totalDeducted
      const avgCost = costMap.get(invItemId) ?? 0

      // Placeholder materialCost using avgCost fallback (Mode B: non-batch).
      // Will be REPLACED by actual batch.unitCost-based COGS after step 8
      // (FEFO recordBatchConsumption) if batches exist for this item.
      const fallbackMaterialCost = deduction.totalDeducted * avgCost

      resultDeductions.push({
        inventoryItemId: invItemId,
        itemName: deduction.itemName,
        baseUnit: deduction.baseUnit,
        totalDeducted: deduction.totalDeducted,
        previousStock,
        newStock,
        materialCost: fallbackMaterialCost,            // placeholder; updated post-FEFO if batches exist
        unitCostSnapshot: null,                        // placeholder; set to JSON snapshot post-FEFO if batches exist
        sources: deduction.sources,
      })
    }

    // ── 6. FEFO: Record batch consumption (batch-aware deduction) ──
    //    This MUST run before steps 7-8 so we can capture per-batch unitCost
    //    and compute Actual COGS (Σ batch.qty × batch.unitCost) for each deduction.
    //    For non-batch items (Mode B), recordBatchConsumption returns null and
    //    we keep the avgCost-based fallback (weighted-average costing).
    //
    //    PERF: Batch-optimized — ALL deductions are processed in a SINGLE call
    //    to FEFOEngine.recordBatchConsumptionBatch, which fetches/marks/updates
    //    ALL affected batches in a handful of batched Prisma/Raw-SQL calls
    //    (vs N × ~10 queries for the per-item loop). For a cart with 2
    //    composition products sharing 1 inventory item, this drops the
    //    `invConsume` phase query count from ~20 to ~6-10.
    if (resultDeductions.length > 0) {
      try {
        const { FEFOEngine } = await import('@/lib/fefo-engine')
        const batchResults = await FEFOEngine.recordBatchConsumptionBatch(tx, perf, {
          transactionId,
          invoiceNumber,
          outletId,
          userId,
          deductions: resultDeductions.map(d => ({
            inventoryItemId: d.inventoryItemId,
            quantityNeeded: d.totalDeducted,
            sourceDetails: JSON.stringify(d.sources),
          })),
        })

        for (const deduction of resultDeductions) {
          const batchResult = batchResults.get(deduction.inventoryItemId)
          if (batchResult && batchResult.batchConsumptions.length > 0) {
            // Actual COGS = Σ(batch.quantityConsumed × batch.unitCost)
            const actualMaterialCost = batchResult.batchConsumptions.reduce(
              (sum, bc) => sum + bc.quantityConsumed * bc.unitCost, 0
            )
            // Immutable per-batch cost snapshot for audit / variance analysis
            const unitCostSnapshot = JSON.stringify(
              batchResult.batchConsumptions.map(bc => ({
                batchId: bc.batchId,
                batchNumber: bc.batchNumber,
                unitCost: bc.unitCost,
                quantityConsumed: bc.quantityConsumed,
                expiredDate: bc.expiredDate ? bc.expiredDate.toISOString() : null,
              }))
            )
            deduction.materialCost = actualMaterialCost
            deduction.unitCostSnapshot = unitCostSnapshot
          }
          // else: no batches for this item (Mode B non-batch). Keep avgCost fallback.
        }
      } catch (batchError) {
        // INV-HC-05 (REVISED): FEFO batch recording errors are now NON-FATAL.
        // The InventoryItem.stock was already deducted atomically above (the
        // authoritative ledger). Batch tracking is a CAPABILITY, not a requirement.
        // If batch recording fails (e.g., unexpected DB error), we log the error
        // but do NOT rollback the sale — the customer's transaction succeeds.
        // The materialCost stays at the avgCost fallback (best-effort Actual COGS).
        const msg = batchError instanceof Error ? batchError.message : String(batchError)
        console.error(
          `[InvConsumption] ${invoiceNumber} — FEFO batch recording failed (NON-FATAL, sale continues, avgCost fallback used for COGS): ${msg}`
        )
        // Do NOT re-throw — let the transaction commit with stock deduction intact.
      }
    }

    // Recompute totalMaterialCost from per-deduction actual costs (post-FEFO)
    totalMaterialCost = resultDeductions.reduce((sum, d) => sum + d.materialCost, 0)

    console.log(
      `[InvConsumption] ${invoiceNumber} — deducted ${resultDeductions.length} inventory item(s), ` +
      `total material cost: Rp ${totalMaterialCost.toLocaleString('id-ID')}`
    )

    // ── 7. CREATE INVENTORY MOVEMENTS ──
    if (resultDeductions.length > 0) {
      trackQuery()
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

    // ── 8. NO PER-DEDUCTION AUDIT LOG (AuditLog V2 — event-oriented) ──
    // Previously this created one COMPOSITION_DEDUCT AuditLog row per deducted
    // inventory item, which spammed the audit feed on every composition sale.
    // The deductions are RETURNED to the caller (checkout), which emits a
    // single SALE audit event that includes an "Inventory Impact" section
    // summarizing all consumption. The InventoryMovement technical ledger
    // (step 7 above) is unchanged and remains the system ledger.

    return {
      success: true,
      deductions: resultDeductions,
      totalMaterialCost,
    }
  }

  /**
   * Reverse inventory consumption for a voided transaction.
   *
   * Recalculates what was deducted using the SAME composition logic as consumeForTransaction,
   * then RESTORES the inventory stock. This ensures accuracy even if composition
   * was changed after the original sale.
   *
   * Called from void route within db.$transaction.
   */
  static async reverseForTransaction(
    tx: TxClient,
    params: {
      items: ConsumptionItem[]
      transactionId: string
      invoiceNumber: string
      outletId: string
      userId: string
    }
  ): Promise<void> {
    const { items, transactionId, invoiceNumber, outletId, userId } = params

    if (items.length === 0) return

    // ── 1. Query compositions (same logic as consumeForTransaction) ──
    const allProductIds = [...new Set(items.map(i => i.productId))]
    const soldVariantIds = items.filter(i => i.variantId).map(i => i.variantId!)

    const allComps: CompositionRow[] = await tx.productComposition.findMany({
      where: {
        productId: { in: allProductIds },
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

    if (allComps.length === 0) {
      console.log(`[InvConsumption:REVERSE] ${invoiceNumber} — no compositions found, skipping`)
      return
    }

    const compProductIds = new Set(allComps.map(c => c.productId))

    // ── 2. Calculate total restoration per inventory item ──
    const restorations = new Map<string, {
      itemName: string
      baseUnit: string
      totalRestored: number
      sources: Array<{
        productName: string
        variantName?: string
        productQty: number
        batchesUsed: number
        materialPerBatch: number
      }>
    }>()

    for (const item of items) {
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

        const existing = restorations.get(comp.inventoryItemId)
        if (existing) {
          existing.totalRestored += materialNeeded
          existing.sources.push({
            productName: item.productName,
            variantName: item.variantName || undefined,
            productQty: item.qty,
            batchesUsed: batchesNeeded,
            materialPerBatch: comp.qty,
          })
        } else {
          restorations.set(comp.inventoryItemId, {
            itemName: comp.inventoryItem.name,
            baseUnit: comp.baseUnit,
            totalRestored: materialNeeded,
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

    if (restorations.size === 0) return

    // ── 3. Restore inventory stock ──
    const invItemIds = [...restorations.keys()]
    const invItems = await tx.inventoryItem.findMany({
      where: { id: { in: invItemIds } },
      select: { id: true, name: true, stock: true },
    })
    const stockMap = new Map<string, number>(invItems.map(i => [i.id, i.stock]))

    const restoredEntries: Array<{
      inventoryItemId: string
      itemName: string
      baseUnit: string
      totalRestored: number
      previousStock: number
      newStock: number
      sources: Array<{
        productName: string
        variantName?: string
        productQty: number
        batchesUsed: number
        materialPerBatch: number
      }>
    }> = []

    for (const [invItemId, restoration] of restorations) {
      const previousStock = stockMap.get(invItemId) ?? 0
      const newStock = previousStock + restoration.totalRestored

      await tx.inventoryItem.update({
        where: { id: invItemId },
        data: { stock: newStock, lastBusinessChangeAt: new Date() },
      })

      restoredEntries.push({
        inventoryItemId: invItemId,
        itemName: restoration.itemName,
        baseUnit: restoration.baseUnit,
        totalRestored: restoration.totalRestored,
        previousStock,
        newStock,
        sources: restoration.sources,
      })
    }

    console.log(
      `[InvConsumption:REVERSE] ${invoiceNumber} — restored ${restoredEntries.length} inventory item(s)`
    )

    // ── 4. Create RESTORE inventory movements ──
    if (restoredEntries.length > 0) {
      await tx.inventoryMovement.createMany({
        data: restoredEntries.map(r => ({
          type: 'RESTOCK',
          inventoryItemId: r.inventoryItemId,
          quantity: r.totalRestored,
          previousStock: r.previousStock,
          newStock: r.newStock,
          referenceId: transactionId,
          referenceType: 'VOID',
          notes: `Restore (void ${invoiceNumber}): ${r.sources.map(s =>
            s.variantName
              ? `${s.productName} (${s.variantName}) ×${s.productQty}`
              : `${s.productName} ×${s.productQty}`
          ).join(', ')}`,
          outletId,
          userId,
        })),
      })
    }

    // ── 5. NO PER-ENTRY AUDIT LOG (AuditLog V2 — event-oriented) ──
    // The void route emits a single VOID audit event that includes an
    // "Inventory Restored" section. The InventoryMovement ledger (step 4)
    // is unchanged. `restoredEntries` is still computed for its side-effect
    // documentation in InventoryMovement.notes.
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
    const stockMap = new Map<string, number>(invItems.map(i => [i.id, i.stock]))

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

  /**
   * Restore inventory from saved consumption snapshots (TransactionConsumption).
   *
   * This is the PREFERRED way to reverse inventory on void — it uses the exact
   * quantities that were consumed at checkout time, regardless of whether the
   * product recipe/composition has since changed.
   *
   * Called from void route within db.$transaction.
   */
  static async restoreFromSnapshots(
    tx: TxClient,
    params: {
      transactionId: string
      invoiceNumber: string
      outletId: string
      userId: string
    }
  ): Promise<void> {
    const { transactionId, invoiceNumber, outletId, userId } = params

    // Read consumption snapshots for this transaction
    const snapshots = await tx.transactionConsumption.findMany({
      where: { transactionId },
    })

    if (snapshots.length === 0) {
      console.log(`[InvConsumption:SNAPSHOT_RESTORE] ${invoiceNumber} — no snapshots found, void will use recalculation fallback`)
      return
    }

    // Get current inventory item stocks
    const invItemIds = snapshots.map(s => s.inventoryItemId)
    const invItems = await tx.inventoryItem.findMany({
      where: { id: { in: invItemIds } },
      select: { id: true, name: true, stock: true },
    })
    const stockMap = new Map<string, number>(invItems.map(i => [i.id, i.stock]))

    // Restore each snapshot
    for (const snapshot of snapshots) {
      const previousStock = stockMap.get(snapshot.inventoryItemId) ?? 0
      const newStock = previousStock + snapshot.quantityUsed

      await tx.inventoryItem.update({
        where: { id: snapshot.inventoryItemId },
        data: { stock: newStock, lastBusinessChangeAt: new Date() },
      })

      // Create RESTORE inventory movement
      await tx.inventoryMovement.create({
        data: {
          type: 'RESTOCK',
          inventoryItemId: snapshot.inventoryItemId,
          quantity: snapshot.quantityUsed,
          previousStock,
          newStock,
          referenceId: transactionId,
          referenceType: 'VOID',
          notes: `Snapshot restore (void ${invoiceNumber}): ${snapshot.itemName} +${snapshot.quantityUsed} ${snapshot.baseUnit}`,
          outletId,
          userId,
        },
      })

      // NO per-snapshot audit log (AuditLog V2 — event-oriented).
      // The void route emits a single VOID event with an "Inventory Restored"
      // section built from these snapshots. InventoryMovement (above) is the
      // technical ledger and is unchanged.
    }

    console.log(
      `[InvConsumption:SNAPSHOT_RESTORE] ${invoiceNumber} — restored ${snapshots.length} inventory item(s) from snapshots`
    )
  }

  /**
   * Build TransactionConsumption records from the deduction result.
   * Called by checkout/sync routes to snapshot consumption data.
   * Returns array of objects ready for `createMany`.
   *
   * SCHEMA ALIGNMENT (fix: schema mismatch on sync):
   *   The TransactionConsumption Prisma model only has:
   *     { transactionId, inventoryItemId, itemName, baseUnit, quantityUsed, sourceDetails, createdAt }
   *   `materialCost` and `unitCostSnapshot` are NOT columns in the model and must
   *   NOT be sent to `createMany` (Prisma rejects unknown arguments).
   *
   *   Cost traceability is PRESERVED via:
   *     1. `auditLog.details` JSON — stores materialCost, unitCostSnapshot, costingMethod
   *        (written in step 8 of consumeForTransaction, per-deduction).
   *     2. `sourceDetails` (below) — preserves the per-product / per-batch source map
   *        so void reversal restores exactly the consumed quantity.
   *
   *   Void logic (restoreFromSnapshots) only reads: inventoryItemId, quantityUsed,
   *   itemName, baseUnit, sourceDetails — all still present below. ✅
   */
  static buildConsumptionSnapshots(
    deductions: InventoryDeduction[],
    transactionId: string,
  ): Array<{
    transactionId: string
    inventoryItemId: string
    itemName: string
    baseUnit: string
    quantityUsed: number
    sourceDetails: string
  }> {
    return deductions.map(d => ({
      transactionId,
      inventoryItemId: d.inventoryItemId,
      itemName: d.itemName,
      baseUnit: d.baseUnit,
      quantityUsed: d.totalDeducted,
      sourceDetails: JSON.stringify(d.sources),
    }))
  }
}