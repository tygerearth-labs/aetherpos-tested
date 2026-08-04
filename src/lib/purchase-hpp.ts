/**
 * purchase-hpp.ts — Shared HPP recalculation helper for purchase flows.
 *
 * Extracted from the file-local copies that existed in both
 * `src/app/api/purchases/route.ts` (POST) and
 * `src/app/api/purchases/[id]/route.ts` (PUT). Both had identical
 * implementations; this module is the single source of truth.
 *
 * Recomputes Product.hpp / ProductVariant.hpp for every product whose
 * composition references one of `inventoryItemIds`. Must run INSIDE the
 * caller's `$transaction` so it sees the freshest `InventoryItem.avgCost`
 * (V14.1 transaction-isolation rule — same as `recalculateAffectedProductStock`).
 */

import type { Prisma } from '@prisma/client'

type TxClient = Prisma.TransactionClient

export async function recalculateHppForAffectedProducts(
  tx: TxClient,
  inventoryItemIds: string[],
): Promise<void> {
  if (inventoryItemIds.length === 0) return

  const compositions = await tx.productComposition.findMany({
    where: {
      inventoryItemId: { in: inventoryItemIds },
      product: { hasComposition: true },
    },
    include: {
      product: { select: { id: true, hasVariants: true } },
      variant: { select: { id: true } },
      inventoryItem: { select: { avgCost: true } },
    },
  })

  if (compositions.length === 0) return

  const affectedProductIds = [...new Set(compositions.map((c) => c.productId))]

  for (const productId of affectedProductIds) {
    const productComps = compositions.filter((c) => c.productId === productId)
    const hasVariants = productComps[0].product.hasVariants

    if (hasVariants) {
      const variantIds = [...new Set(productComps.filter((c) => c.variantId).map((c) => c.variantId!))]
      for (const variantId of variantIds) {
        const variantComps = productComps.filter((c) => c.variantId === variantId)
        const batchCost = variantComps.reduce((sum, c) => sum + c.qty * c.inventoryItem.avgCost, 0)
        const yieldPerBatch = (variantComps[0] as typeof variantComps[0] & { yieldPerBatch?: number }).yieldPerBatch || 1
        const newHpp = yieldPerBatch > 1 ? batchCost / yieldPerBatch : batchCost
        await tx.productVariant.update({
          where: { id: variantId },
          data: { hpp: newHpp },
        })
      }
      // Parent product's own hpp is 0 when variants own their own cost.
      await tx.product.update({
        where: { id: productId },
        data: { hpp: 0 },
      })
    } else {
      const batchCost = productComps.reduce((sum, c) => sum + c.qty * c.inventoryItem.avgCost, 0)
      const yieldPerBatch = (productComps[0] as typeof productComps[0] & { yieldPerBatch?: number }).yieldPerBatch || 1
      const newHpp = yieldPerBatch > 1 ? batchCost / yieldPerBatch : batchCost
      await tx.product.update({
        where: { id: productId },
        data: { hpp: newHpp },
      })
    }
  }
}
