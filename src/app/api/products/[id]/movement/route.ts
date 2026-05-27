import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { parsePagination } from '@/lib/api-helpers'
import { safeJson, safeJsonError } from '@/lib/safe-response'

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
        variants: { select: { id: true, name: true, sku: true, price: true, hpp: true, stock: true } },
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
    const [auditLogs, variantAuditLogs, totalLogs, totalSoldResult, lastRestockLog] =
      await Promise.all([
        // Audit logs for this product (restock, create, update, sale, adjustments)
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
        // Audit logs for variants (if product has variants)
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
        db.auditLog.count({
          where: {
            entityId: id,
            entityType: 'PRODUCT',
            outletId,
          },
        }),
        // Total sold qty and revenue from transaction items
        db.transactionItem.aggregate({
          where: { productId: id },
          _sum: { qty: true, subtotal: true },
        }),
        // Last RESTOCK log date for stock aging
        db.auditLog.findFirst({
          where: {
            entityId: id,
            entityType: 'PRODUCT',
            action: 'RESTOCK',
            outletId,
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ])

    // Get restock total via aggregate instead of fetching all logs
    const restockTotalResult = await db.auditLog.aggregate({
      where: {
        entityId: id,
        entityType: 'PRODUCT',
        action: 'RESTOCK',
        outletId,
      },
      _count: { id: true },
    })

    // Parse restock quantities from audit log details (only fetch details column)
    const restockDetails = await db.auditLog.findMany({
      where: {
        entityId: id,
        entityType: 'PRODUCT',
        action: 'RESTOCK',
        outletId,
      },
      select: { details: true },
    })
    let totalRestocked = 0
    for (const log of restockDetails) {
      try {
        const details = JSON.parse(log.details || '{}')
        totalRestocked += Number(details.quantityAdded) || 0
      } catch {
        // Skip malformed details
      }
    }

    // Also count variant audit logs for total
    const variantTotalLogs = variantIds.length > 0
      ? await db.auditLog.count({
          where: {
            entityType: 'VARIANT',
            entityId: { in: variantIds },
            outletId,
          },
        })
      : 0
    const combinedTotalLogs = totalLogs + variantTotalLogs

    const totalSold = totalSoldResult._sum.qty || 0
    const revenue = totalSoldResult._sum.subtotal || 0

    // Merge product and variant audit logs, sort by date desc, apply pagination
    const allLogs = [
      ...auditLogs,
      ...variantAuditLogs,
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

    return safeJson({
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        hpp: product.hpp,
        price: aggPrice,
        stock: aggStock,
        lowStockAlert: product.lowStockAlert,
        image: product.image,
        hasVariants: !!product.hasVariants,
        _variantCount: product._count.variants,
        variants: product.variants,
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
