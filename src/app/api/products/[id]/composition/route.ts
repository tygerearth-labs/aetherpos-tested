import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { getMaxStockFromComposition, getMaxStockFromVariantComposition } from '@/lib/comp-stock'
import { emitAuditEvent, buildCompositionUpdateEvent, type CompositionLineInput } from '@/lib/audit-v2'

// GET /api/products/[id]/composition — get composition items for a product
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { id } = await params

    // Verify product exists and belongs to outlet
    const product = await db.product.findFirst({
      where: { id, outletId: user.outletId },
      select: { id: true, name: true, hasComposition: true, hasVariants: true },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    if (product.hasVariants) {
      // Variant product: return per-variant compositions
      const variants = await db.productVariant.findMany({
        where: { productId: id, outletId: user.outletId },
        select: { id: true, name: true, stock: true, hpp: true },
        orderBy: { createdAt: 'asc' },
      })

      const allComps = await db.productComposition.findMany({
        where: { productId: id, variantId: { not: null } },
        include: {
          inventoryItem: {
            select: {
              id: true,
              name: true,
              sku: true,
              baseUnit: true,
              avgCost: true,
              stock: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      })

      // Group compositions by variantId
      const variantCompositions: Record<string, Array<{
        id: string
        inventoryItemId: string
        inventoryItemName: string
        inventoryItemSku: string | null
        qty: number
        baseUnit: string
        avgCost: number
        stock: number
        lineTotal: number
      }>> = {}

      for (const c of allComps) {
        const vid = c.variantId!
        if (!variantCompositions[vid]) variantCompositions[vid] = []
        const lineTotal = c.qty * c.inventoryItem.avgCost
        variantCompositions[vid].push({
          id: c.id,
          inventoryItemId: c.inventoryItemId,
          inventoryItemName: c.inventoryItem.name,
          inventoryItemSku: c.inventoryItem.sku,
          qty: c.qty,
          baseUnit: c.baseUnit,
          avgCost: c.inventoryItem.avgCost,
          stock: c.inventoryItem.stock,
          lineTotal,
        })
      }

      // Calculate per-variant HPP and max stock
      const variantData = await Promise.all(variants.map(async (v) => {
        const comps = variantCompositions[v.id] || []
        const autoHpp = comps.reduce((sum, c) => sum + c.lineTotal, 0)
        const { maxStock } = await getMaxStockFromVariantComposition(v.id)
        return {
          variantId: v.id,
          variantName: v.name,
          stock: v.stock,
          currentHpp: v.hpp,
          autoHpp,
          maxStock,
          compositions: comps,
        }
      }))

      return safeJson({
        hasComposition: product.hasComposition,
        hasVariants: true,
        variantCompositions: variantData,
      })
    } else {
      // Non-variant product: return product-level compositions
      const compositions = await db.productComposition.findMany({
        where: { productId: id, variantId: null },
        include: {
          inventoryItem: {
            select: {
              id: true,
              name: true,
              sku: true,
              baseUnit: true,
              avgCost: true,
              stock: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      })

      let autoHpp = 0
      const items = compositions.map((c) => {
        const lineTotal = c.qty * c.inventoryItem.avgCost
        autoHpp += lineTotal
        return {
          id: c.id,
          inventoryItemId: c.inventoryItemId,
          inventoryItemName: c.inventoryItem.name,
          inventoryItemSku: c.inventoryItem.sku,
          qty: c.qty,
          baseUnit: c.baseUnit,
          avgCost: c.inventoryItem.avgCost,
          stock: c.inventoryItem.stock,
          lineTotal,
        }
      })

      return safeJson({
        hasComposition: product.hasComposition,
        hasVariants: false,
        autoHpp,
        items,
      })
    }
  } catch (error) {
    console.error('Product composition GET error:', error)
    return safeJsonError('Failed to load product composition')
  }
}

// PUT /api/products/[id]/composition — set composition for a product
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    // CREW-007 FIX: Only OWNER can modify product composition (recalculates HPP — financial impact)
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya OWNER yang dapat melakukan aksi ini', 403)
    }
    const outletId = user.outletId
    const { id } = await params

    const body = await request.json()
    const { hasComposition, compositions, variantCompositions } = body as {
      hasComposition?: boolean
      compositions?: Array<{
        inventoryItemId: string
        qty: number
        baseUnit: string
        yieldPerBatch?: number
      }>
      variantCompositions?: Record<string, Array<{
        inventoryItemId: string
        qty: number
        baseUnit: string
        yieldPerBatch?: number
      }>>
    }

    // Verify product exists and belongs to outlet
    const product = await db.product.findFirst({
      where: { id, outletId },
      select: { id: true, name: true, hasVariants: true, hasComposition: true },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    // Validate all composition items
    const allCompItems = [
      ...(compositions || []),
      ...Object.values(variantCompositions || []).flat(),
    ]

    if (allCompItems.length > 0) {
      for (const comp of allCompItems) {
        if (!comp.inventoryItemId) {
          return safeJsonError('Each composition must have an inventoryItemId', 400)
        }
        if (!comp.qty || comp.qty <= 0) {
          return safeJsonError('Each composition must have qty > 0', 400)
        }
        if (!comp.baseUnit) {
          return safeJsonError('Each composition must have a baseUnit', 400)
        }
      }

      // Verify all inventory items belong to this outlet
      const invItemIds = [...new Set(allCompItems.map((c) => c.inventoryItemId))]
      const invItems = await db.inventoryItem.findMany({
        where: { id: { in: invItemIds }, outletId },
        select: { id: true, name: true, avgCost: true },
      })
      if (invItems.length !== invItemIds.length) {
        return safeJsonError('One or more inventory items not found', 400)
      }
    }

    const result = await db.$transaction(async (tx) => {
      // 0. Snapshot BEFORE composition (for the COMPOSITION_UPDATE audit event).
      //    Fetched before the delete so we capture the previous recipe exactly.
      const beforeRows = await tx.productComposition.findMany({
        where: { productId: id },
        include: { inventoryItem: { select: { name: true, avgCost: true } } },
      })
      const variantNameMap = new Map<string, string>()
      if (product.hasVariants) {
        const variants = await tx.productVariant.findMany({
          where: { productId: id, outletId },
          select: { id: true, name: true },
        })
        for (const v of variants) variantNameMap.set(v.id, v.name)
      }
      const toLine = (c: (typeof beforeRows)[number]): CompositionLineInput => ({
        inventoryItemName: c.inventoryItem.name,
        qty: c.qty,
        baseUnit: c.baseUnit,
        yieldPerBatch: c.yieldPerBatch,
        avgCost: c.inventoryItem.avgCost,
      })
      const beforeSimple: CompositionLineInput[] = beforeRows
        .filter((c) => c.variantId === null)
        .map(toLine)
      const beforeVariantMap = new Map<string, CompositionLineInput[]>()
      for (const c of beforeRows) {
        if (c.variantId) {
          const arr = beforeVariantMap.get(c.variantId) || []
          arr.push(toLine(c))
          beforeVariantMap.set(c.variantId, arr)
        }
      }

      // 1. Delete ALL existing compositions for this product (both product-level and variant-level)
      await tx.productComposition.deleteMany({
        where: { productId: id },
      })

      // 2. Build inventory item cost map
      const invItemIds = [...new Set(allCompItems.map((c) => c.inventoryItemId))]
      const invItems = await tx.inventoryItem.findMany({
        where: { id: { in: invItemIds } },
        select: { id: true, avgCost: true },
      })
      const invItemCostMap = new Map(invItems.map((ii) => [ii.id, ii.avgCost]))

      let productAutoHpp = 0

      if (product.hasVariants) {
        // ===== VARIANT PRODUCT: per-variant compositions =====
        if (variantCompositions && Object.keys(variantCompositions).length > 0) {
          // Verify all variant IDs belong to this product
          const variantIds = Object.keys(variantCompositions)
          const validVariants = await tx.productVariant.findMany({
            where: { id: { in: variantIds }, productId: id, outletId },
            select: { id: true },
          })
          const validVariantIds = new Set(validVariants.map((v) => v.id))

          for (const [vid, comps] of Object.entries(variantCompositions)) {
            if (!validVariantIds.has(vid)) {
              throw new Error(`Variant ${vid} not found or does not belong to this product`)
            }

            if (comps.length === 0) continue

            // Create composition records for this variant
            await tx.productComposition.createMany({
              data: comps.map((c) => ({
                productId: id,
                variantId: vid,
                inventoryItemId: c.inventoryItemId,
                qty: c.qty,
                yieldPerBatch: c.yieldPerBatch || 1,
                baseUnit: c.baseUnit,
              })),
            })

            // Calculate auto HPP for this variant (yield-aware)
            // HPP per unit = (total material cost per batch) / yieldPerBatch
            // If all comps have same yield, use that. Otherwise use min yield (conservative).
            const batchCost = comps.reduce((sum, c) => {
              const avgCost = invItemCostMap.get(c.inventoryItemId) || 0
              return sum + c.qty * avgCost
            }, 0)
            // Use the yield of the first comp as representative (all comps in 1 variant share same yield)
            const representativeYield = comps[0]?.yieldPerBatch || 1
            const variantHpp = representativeYield > 1 ? batchCost / representativeYield : batchCost

            // Update variant HPP
            await tx.productVariant.update({
              where: { id: vid },
              data: { hpp: variantHpp },
            })
          }
        }
      } else {
        // ===== NON-VARIANT PRODUCT: product-level composition =====
        if (compositions && compositions.length > 0) {
          await tx.productComposition.createMany({
            data: compositions.map((c) => ({
              productId: id,
              variantId: null,
              inventoryItemId: c.inventoryItemId,
              qty: c.qty,
              yieldPerBatch: c.yieldPerBatch || 1,
              baseUnit: c.baseUnit,
            })),
          })

          // HPP per unit = (total material cost per batch) / yieldPerBatch
          const batchCost = compositions.reduce((sum, c) => {
            const avgCost = invItemCostMap.get(c.inventoryItemId) || 0
            return sum + c.qty * avgCost
          }, 0)
          const representativeYield = compositions[0]?.yieldPerBatch || 1
          productAutoHpp = representativeYield > 1 ? batchCost / representativeYield : batchCost
        }
      }

      // 3. Update product hasComposition and hpp
      await tx.product.update({
        where: { id },
        data: {
          hasComposition: !!hasComposition,
          hpp: product.hasVariants ? 0 : productAutoHpp, // Product-level HPP only for non-variant
        },
      })

      // 4. Cap stock for non-variant products (within transaction)
      // V14.1 FIX (REAL ROOT CAUSE of "stock return 0 padahal toast sukses"):
      //   Bug sebelumnya: getMaxStockFromComposition pakai `db` (separate connection),
      //   di PostgreSQL Read Committed TIDAK melihat writes yang baru dilakukan di
      //   transaksi ini (delete komposisi lama + create komposisi baru). Akibatnya:
      //     - maxStock dihitung dari komposisi STALE (LAMA, sebelum delete)
      //     - jika salah satu inventory item di komposisi LAMA punya stock=0
      //       (misal sudah habis dipakai transaksi penjualan), maxStock = 0
      //     - UPDATE "Product" SET stock = CASE WHEN stock < 0 THEN stock ELSE 0 END
      //       → stock jadi 0 (karena stock < 0 selalu FALSE)
      //     - frontend terima 200 OK → toast "produk berhasil diperbarui"
      //     - PADAHAL stock diam-diam di-nol-kan berdasarkan data STALE
      //   Fix:
      //     (a) Pass `tx` ke getMaxStockFromComposition agar baca komposisi BARU
      //         yang baru di-create di transaksi ini
      //     (b) Jangan pernah cap ke 0 — jika maxStock = 0, berarti bahan baku
      //         tidak cukup untuk 1 batch baru, TAPI stok produk yang ada mungkin
      //         dibuat sebelumnya saat bahan masih ada. Biarkan stok apa adanya,
      //         hanya warning ke user.
      //     (c) Hanya cap jika maxStock > 0 DAN maxStock < current stock.
      let stockCapInfo: {
        stockCapped: boolean
        oldStock: number
        newStock: number
        maxStock: number
        limitingItemName: string | null
      } | null = null

      if (!product.hasVariants && compositions && compositions.length > 0) {
        // V14.1 FIX (a): pass `tx` so we read the FRESHLY-CREATED compositions
        // within this transaction, not the stale OLD ones outside.
        const { maxStock, limitingItem } = await getMaxStockFromComposition(id, outletId, tx)
        if (maxStock !== Infinity) {
          const beforeCap = await tx.product.findUnique({
            where: { id },
            select: { stock: true },
          })
          const oldStock = beforeCap?.stock ?? 0

          if (maxStock <= 0) {
            // V14.1 FIX (b): jangan cap ke 0. Stok produk yang ada mungkin
            // dibuat sebelumnya saat bahan masih cukup. Cukup warning ke user
            // bahwa mereka tidak bisa membuat produk baru sampai bahan di-restock.
            // (Tidak update stock di DB.)
            stockCapInfo = {
              stockCapped: false,
              oldStock,
              newStock: oldStock, // tidak berubah
              maxStock,
              limitingItemName: limitingItem?.name ?? null,
            }
          } else if (oldStock > maxStock) {
            // V14.1 FIX (c): hanya cap jika maxStock > 0 DAN oldStock > maxStock.
            // oldStock > maxStock berarti produk lebih banyak dari yang bisa
            // dibuat dari bahan tersedia → wajar untuk cap.
            await tx.$executeRaw`
              UPDATE "Product"
              SET stock = ${maxStock}
              WHERE id = ${id}
            `
            stockCapInfo = {
              stockCapped: true,
              oldStock,
              newStock: maxStock,
              maxStock,
              limitingItemName: limitingItem?.name ?? null,
            }
          }
          // else: maxStock > 0 dan oldStock <= maxStock → tidak perlu cap,
          // stockCapInfo tetap null (tidak ada perubahan)
        }
      }

      // 5. Cap stock for variant products (within transaction)
      // V14.1 FIX: sama dengan non-variant — pass `tx` & jangan cap ke 0.
      let variantStockCapInfo: Array<{
        variantId: string
        variantName: string
        oldStock: number
        newStock: number
        maxStock: number
        limitingItemName: string | null
      }> = []
      if (product.hasVariants && variantCompositions) {
        const variants = await tx.productVariant.findMany({
          where: { productId: id, outletId },
          select: { id: true, name: true, stock: true },
        })
        for (const v of variants) {
          // V14.1 FIX (a): pass `tx`
          const { maxStock, limitingItem } = await getMaxStockFromVariantComposition(v.id, tx)
          if (maxStock === Infinity) continue

          if (maxStock <= 0) {
            // V14.1 FIX (b): jangan cap ke 0, cukup catat untuk warning
            variantStockCapInfo.push({
              variantId: v.id,
              variantName: v.name,
              oldStock: v.stock,
              newStock: v.stock, // tidak berubah
              maxStock,
              limitingItemName: limitingItem?.name ?? null,
            })
            continue
          }

          if (v.stock > maxStock) {
            // V14.1 FIX (c): hanya cap jika maxStock > 0 DAN v.stock > maxStock
            await tx.productVariant.update({
              where: { id: v.id },
              data: { stock: maxStock },
            })
            variantStockCapInfo.push({
              variantId: v.id,
              variantName: v.name,
              oldStock: v.stock,
              newStock: maxStock,
              maxStock,
              limitingItemName: limitingItem?.name ?? null,
            })
          }
        }
        // Recalculate parent product stock
        const aggResult = await tx.productVariant.aggregate({
          where: { productId: id, outletId },
          _sum: { stock: true },
        })
        await tx.product.update({
          where: { id },
          data: { stock: aggResult._sum.stock ?? 0 },
        })
      }

      // 6. Snapshot AFTER composition + emit ONE COMPOSITION_UPDATE audit event.
      //    Captures before/after recipe and stock-cap info in a single readable
      //    event (previously this route created NO audit row at all).
      const afterRows = await tx.productComposition.findMany({
        where: { productId: id },
        include: { inventoryItem: { select: { name: true, avgCost: true } } },
      })
      const afterSimple: CompositionLineInput[] = afterRows
        .filter((c) => c.variantId === null)
        .map(toLine)
      const afterVariantMap = new Map<string, CompositionLineInput[]>()
      for (const c of afterRows) {
        if (c.variantId) {
          const arr = afterVariantMap.get(c.variantId) || []
          arr.push(toLine(c))
          afterVariantMap.set(c.variantId, arr)
        }
      }
      const variantBeforeAfter = Array.from(afterVariantMap.keys()).map((vid) => ({
        variantName: variantNameMap.get(vid) || vid,
        before: beforeVariantMap.get(vid) || [],
        after: afterVariantMap.get(vid) || [],
      }))
      // Include variants that existed before but were removed entirely.
      for (const [vid, beforeLines] of beforeVariantMap) {
        if (!afterVariantMap.has(vid)) {
          variantBeforeAfter.push({
            variantName: variantNameMap.get(vid) || vid,
            before: beforeLines,
            after: [],
          })
        }
      }
      await emitAuditEvent(
        tx,
        buildCompositionUpdateEvent({
          productId: id,
          productName: product.name,
          hasVariants: product.hasVariants,
          before: beforeSimple,
          after: afterSimple,
          variantBeforeAfter,
          stockCap: stockCapInfo ?? undefined,
          variantStockCaps: variantStockCapInfo.map((v) => ({
            variantName: v.variantName,
            stockCapped: v.newStock < v.oldStock,
            oldStock: v.oldStock,
            newStock: v.newStock,
            maxStock: v.maxStock,
            limitingItemName: v.limitingItemName,
          })),
          outletId,
          userId: user.id,
        }),
      )

      return { productAutoHpp, stockCapInfo, variantStockCapInfo }
    })

    return safeJson({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('Product composition PUT error:', error)
    if (error instanceof Error) {
      return safeJsonError(error.message, 400)
    }
    return safeJsonError('Failed to update product composition')
  }
}