import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'
import { FEFOEngine } from '@/lib/fefo-engine'

// GET /api/inventory/promo-recommendations
// Suggests promotions for near-expiry inventory items
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    const result = await db.$transaction(async (tx) => {
      // Mark expired batches first
      await FEFOEngine.markExpiredBatches(tx, outletId)

      // Get expiry heatmap data
      const heatmap = await FEFOEngine.getExpiryHeatmap(tx, outletId)

      // Combine critical7d and warning30d items (skip expired — too late for promo)
      const candidates = [
        ...heatmap.critical7d.map((item) => ({
          ...item,
          urgency: 'critical' as const,
          // unitCost is available at runtime from the spread but not in typed return
          unitCost: (item as Record<string, unknown>).unitCost as number | undefined,
          batchId: (item as Record<string, unknown>).id as string,
        })),
        ...heatmap.warning30d.map((item) => ({
          ...item,
          urgency: 'warning' as const,
          unitCost: (item as Record<string, unknown>).unitCost as number | undefined,
          batchId: (item as Record<string, unknown>).id as string,
        })),
      ]

      if (candidates.length === 0) return []

      // Collect unique inventory item IDs
      const inventoryItemIds = [...new Set(candidates.map((c) => c.inventoryItemId))]

      // Fetch unit costs for items that may not have it in the heatmap return type
      const batchesWithCost = await tx.inventoryBatch.findMany({
        where: {
          id: { in: candidates.map((c) => c.batchId) },
        },
        select: { id: true, unitCost: true },
      })
      const costMap = new Map(batchesWithCost.map((b) => [b.id, b.unitCost]))

      // Find products that use these inventory items via ProductComposition
      const compositions = await tx.productComposition.findMany({
        where: {
          inventoryItemId: { in: inventoryItemIds },
          product: { isActive: true },
        },
        select: {
          inventoryItemId: true,
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              categoryId: true,
            },
          },
        },
      })

      // Build map: inventoryItemId → products
      const productMap = new Map<string, Array<{
        productId: string
        productName: string
        productPrice: number
        categoryId: string | null
      }>>()

      for (const comp of compositions) {
        const existing = productMap.get(comp.inventoryItemId) ?? []
        // Avoid duplicate products for the same inventory item
        if (!existing.some((p) => p.productId === comp.product.id)) {
          existing.push({
            productId: comp.product.id,
            productName: comp.product.name,
            productPrice: comp.product.price,
            categoryId: comp.product.categoryId,
          })
        }
        productMap.set(comp.inventoryItemId, existing)
      }

      // Build promo recommendations
      const recommendations = candidates.map((item) => {
        const unitCost = item.unitCost ?? costMap.get(item.batchId) ?? 0
        const potentialLoss = item.remainingQty * unitCost

        // Determine discount percentage
        let discountPercent: number
        if (item.urgency === 'critical') {
          discountPercent = 25
        } else {
          discountPercent = 15
        }
        // Extra 5% if potential loss > 500,000
        if (potentialLoss > 500000) {
          discountPercent += 5
        }

        const suggestedProducts = productMap.get(item.inventoryItemId) ?? []

        // Build reason string
        const daysText = item.daysUntilExpiry !== null && item.daysUntilExpiry > 0
          ? `${item.daysUntilExpiry} hari`
          : 'hari ini'
        const productListText = suggestedProducts.length > 0
          ? suggestedProducts[0].productName
          : item.itemName
        const reason = `Buat promo ${productListText} ${discountPercent}% untuk mengurangi stok ${item.itemName} (${item.remainingQty} ${item.baseUnit}, exp ${daysText})`

        return {
          inventoryItemId: item.inventoryItemId,
          inventoryItemName: item.itemName,
          baseUnit: item.baseUnit,
          remainingQty: item.remainingQty,
          expiredDate: item.expiredDate ? new Date(item.expiredDate).toISOString() : null,
          daysUntilExpiry: item.daysUntilExpiry,
          urgency: item.urgency as 'critical' | 'warning',
          potentialLoss,
          suggestedProducts,
          suggestedPromo: {
            type: 'PERCENTAGE' as const,
            value: discountPercent,
            reason,
          },
        }
      })

      // Sort by potentialLoss descending, then by daysUntilExpiry ascending
      recommendations.sort((a, b) => {
        if (b.potentialLoss !== a.potentialLoss) return b.potentialLoss - a.potentialLoss
        return (a.daysUntilExpiry ?? 999) - (b.daysUntilExpiry ?? 999)
      })

      return recommendations
    })

    return safeJson({ data: result }, 200, CACHE.MEDIUM)
  } catch (error) {
    console.error('Promo recommendations error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Gagal memuat rekomendasi promo: ${msg}`)
  }
}