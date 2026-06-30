import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination } from '@/lib/api/api-helpers'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId

    const { id } = await params

    // Verify product belongs to this outlet
    const product = await db.product.findFirst({
      where: { id, outletId },
      include: {
        variants: { select: { id: true, name: true, sku: true, barcode: true, price: true, hpp: true, stock: true } },
        _count: { select: { variants: true } },
      },
    })
    if (!product) {
      return safeJsonError('Product not found', 404)
    }

    // Compute aggregated values for variant products
    const variantIds = product.variants.map((v) => v.id)
    const aggStock = product.hasVariants && variantIds.length > 0
      ? product.variants.reduce((s, v) => s + v.stock, 0)
      : product.stock
    const aggPrice = product.hasVariants && variantIds.length > 0
      ? Math.min(...product.variants.map((v) => v.price))
      : product.price
    const maxPrice = product.hasVariants && variantIds.length > 0
      ? Math.max(...product.variants.map((v) => v.price))
      : product.price

    const { limit, skip } = parsePagination(request.nextUrl.searchParams)

    // Fetch summary stats and movement logs in parallel
    const [auditLogs, stockAuditLogs, variantAuditLogs, productVariantAuditLogs, totalLogs, stockTotalLogs, totalSoldResult, lastRestockLog] =
      await Promise.all([
        // Audit logs for this product (restock, create, update, sale)
        db.auditLog.findMany({
          where: {
            entityId: id,
            entityType: 'PRODUCT',
            outletId,
          },
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        // Audit logs for stock adjustments — STOCK type (from adjustStock action)
        db.auditLog.findMany({
          where: {
            entityId: id,
            entityType: 'STOCK',
            outletId,
          },
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        // Audit logs for variants (if product has variants) — VARIANT type
        variantIds.length > 0
          ? db.auditLog.findMany({
              where: {
                entityType: 'VARIANT',
                entityId: { in: variantIds },
                outletId,
              },
              include: {
                user: {
                  select: { id: true, name: true, email: true, role: true },
                },
              },
              orderBy: { createdAt: 'desc' },
            })
          : Promise.resolve([]),
        // Audit logs for variants — PRODUCT_VARIANT type (from bulk updates)
        variantIds.length > 0
          ? db.auditLog.findMany({
              where: {
                entityType: 'PRODUCT_VARIANT',
                entityId: { in: variantIds },
                outletId,
              },
              include: {
                user: {
                  select: { id: true, name: true, email: true, role: true },
                },
              },
              orderBy: { createdAt: 'desc' },
            })
          : Promise.resolve([]),
        db.auditLog.count({
          where: {
            entityId: id,
            entityType: 'PRODUCT',
            outletId,
          },
        }),
        db.auditLog.count({
          where: {
            entityId: id,
            entityType: 'STOCK',
            outletId,
          },
        }),
        // Total sold qty and revenue from transaction items
        db.transactionItem.aggregate({
          where: { productId: id },
          _sum: { qty: true, subtotal: true },
        }),
        // Last RESTOCK log date for stock aging (check both PRODUCT and variant types)
        db.auditLog.findFirst({
          where: {
            OR: [
              { entityId: id, entityType: 'PRODUCT', action: 'RESTOCK', outletId },
              ...(variantIds.length > 0
                ? [{ entityId: { in: variantIds }, entityType: 'PRODUCT_VARIANT', action: 'BULK_UPDATE', outletId }]
                : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ])

    // Parse restock quantities — include RESTOCK logs and BULK_UPDATE stock changes
    const restockDetails = await db.auditLog.findMany({
      where: {
        entityId: id,
        entityType: 'PRODUCT',
        outletId,
        OR: [
          { action: 'RESTOCK' },
          { action: 'BULK_UPDATE' },
        ],
      },
      select: { details: true },
    })
    let totalRestocked = 0
    for (const log of restockDetails) {
      try {
        const details = JSON.parse(log.details || '{}')
        // RESTOCK logs store quantityAdded at top level
        if (details.quantityAdded) {
          totalRestocked += Number(details.quantityAdded) || 0
        }
        // BULK_UPDATE logs for parent product store stock under changes.stock
        if (details.changes && typeof details.changes === 'object') {
          const changes = details.changes as Record<string, { from: number; to: number }>
          if (changes.stock && changes.stock.from !== undefined && changes.stock.to !== undefined) {
            const diff = changes.stock.to - changes.stock.from
            if (diff > 0) totalRestocked += diff
          }
        }
      } catch {
        // Skip malformed details
      }
    }

    // Include bulk stock additions from variant audit logs (PRODUCT_VARIANT type)
    if (productVariantAuditLogs.length > 0) {
      for (const log of productVariantAuditLogs) {
        try {
          const details = JSON.parse(log.details || '{}')
          // PRODUCT_VARIANT logs store stock at top level
          if (details.stock && typeof details.stock === 'object' && details.stock.from !== undefined && details.stock.to !== undefined) {
            const diff = Number(details.stock.to) - Number(details.stock.from)
            if (diff > 0) totalRestocked += diff
          }
        } catch {
          // Skip malformed details
        }
      }
    }

    // Also count variant audit logs for total (both VARIANT and PRODUCT_VARIANT types)
    const variantTotalLogs = variantIds.length > 0
      ? await db.auditLog.count({
          where: {
            OR: [
              { entityType: 'VARIANT', entityId: { in: variantIds }, outletId },
              { entityType: 'PRODUCT_VARIANT', entityId: { in: variantIds }, outletId },
            ],
          },
        })
      : 0
    const combinedTotalLogs = totalLogs + stockTotalLogs + variantTotalLogs

    const totalSold = totalSoldResult._sum.qty || 0
    const revenue = totalSoldResult._sum.subtotal || 0

    // Merge product, stock, variant, and product variant audit logs, sort by date desc, apply pagination
    const allLogs = [
      ...auditLogs,
      ...stockAuditLogs,
      ...variantAuditLogs,
      ...productVariantAuditLogs,
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    // Build movement entries from merged audit logs
    const movements = allLogs.slice(skip, skip + limit).map((log) => {
      let parsedDetails: Record<string, unknown> = {}
      try {
        parsedDetails = JSON.parse(log.details || '{}')
      } catch {
        // Keep empty
      }

      return {
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        details: parsedDetails,
        user: log.user,
        createdAt: log.createdAt,
      }
    })

    // Fallback: barcode = sku for old products that don't have barcode yet
    const finalBarcode = product.barcode || product.sku || null
    const finalVariants = product.variants.map((v) => ({
      ...v,
      barcode: v.barcode || v.sku || null,
    }))

    return safeJson({
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: finalBarcode,
        hpp: product.hpp,
        price: aggPrice,
        stock: aggStock,
        lowStockAlert: product.lowStockAlert,
        image: product.image,
        hasVariants: !!product.hasVariants,
        _variantCount: product._count.variants,
        variants: finalVariants,
        _maxPrice: maxPrice,
        bruto: product.bruto || 0,
        netto: product.netto || 0,
      },
      summary: {
        totalSold,
        totalRestocked,
        currentStock: aggStock,
        revenue,
        lastRestockDate: lastRestockLog?.createdAt?.toISOString() || null,
      },
      movements,
      totalPages: Math.ceil(combinedTotalLogs / limit),
      totalLogs: combinedTotalLogs,
    })
  } catch (error) {
    console.error('Product movement GET error:', error)
    return safeJsonError('Failed to load product movement')
  }
}
