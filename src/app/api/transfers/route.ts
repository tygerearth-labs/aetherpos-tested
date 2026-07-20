import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination } from '@/lib/api/api-helpers'
import { safeJson, safeJsonCreated, safeJsonError, CACHE } from '@/lib/api/safe-response'

/**
 * GET /api/transfers — List transfers for the current outlet
 *
 * Returns both sent (fromOutlet) and received (toOutlet) transfers.
 * Supports filtering by status and pagination.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const { page, limit, skip } = parsePagination(searchParams, { limit: 20 })
    const status = searchParams.get('status') || ''
    const direction = searchParams.get('direction') || '' // 'outbound' or 'inbound'
    const itemType = searchParams.get('itemType') || '' // 'PRODUCT' or 'INVENTORY'

    const outletId = user.outletId

    // Build where clause: transfers where outlet is sender OR receiver
    const where: Record<string, unknown> = {}

    // Direction filter
    if (direction === 'outbound') {
      where.fromOutletId = outletId
    } else if (direction === 'inbound') {
      where.toOutletId = outletId
    } else {
      where.OR = [{ fromOutletId: outletId }, { toOutletId: outletId }]
    }

    if (status) {
      where.status = status
    }

    if (itemType) {
      where.itemType = itemType
    }

    const [transfers, total] = await Promise.all([
      db.outletTransfer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          transferNumber: true,
          fromOutletId: true,
          toOutletId: true,
          status: true,
          itemType: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          receivedAt: true,
          fromOutlet: {
            select: { id: true, name: true },
          },
          toOutlet: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: { id: true, name: true },
          },
          receivedBy: {
            select: { id: true, name: true },
          },
          items: {
            select: { id: true, quantity: true, price: true },
          },
          inventoryTransferItems: {
            select: { id: true, itemName: true, itemSku: true, baseUnit: true, quantity: true, avgCost: true },
          },
          _count: {
            select: { items: true },
          },
        },
      }),
      db.outletTransfer.count({ where }),
    ])

    const mappedTransfers = transfers.map((t) => ({
      id: t.id,
      transferNumber: t.transferNumber,
      fromOutletId: t.fromOutletId,
      toOutletId: t.toOutletId,
      fromOutletName: t.fromOutlet.name,
      toOutletName: t.toOutlet.name,
      status: t.status,
      itemType: t.itemType,
      notes: t.notes,
      itemCount: t.itemType === 'INVENTORY'
        ? t.inventoryTransferItems.length
        : t.items.length,
      totalQty: t.itemType === 'INVENTORY'
        ? t.inventoryTransferItems.reduce((sum, i) => sum + i.quantity, 0)
        : t.items.reduce((sum, i) => sum + i.quantity, 0),
      totalPrice: t.itemType === 'INVENTORY'
        ? t.inventoryTransferItems.reduce((sum, i) => sum + i.quantity * i.avgCost, 0)
        : t.items.reduce((sum, i) => sum + i.quantity * i.price, 0),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      receivedAt: t.receivedAt,
      createdBy: t.createdBy,
      receivedBy: t.receivedBy,
      direction: t.fromOutletId === outletId ? 'OUTBOUND' : 'INBOUND',
      _count: t._count,
    }))

    return safeJson(
      {
        transfers: mappedTransfers,
        totalPages: Math.ceil(total / limit),
      },
      200,
      CACHE.MEDIUM,
    )
  } catch (error) {
    console.error('[/api/transfers] GET error:', error)
    return safeJsonError('Failed to load transfers')
  }
}

/**
 * POST /api/transfers — Create a new transfer (Surat Jalan)
 *
 * Creates a DRAFT transfer. Stock is NOT deducted at this point.
 * Stock deduction happens when status changes to IN_TRANSIT.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()
    const {
      toOutletId,
      notes,
      items,
      itemType = 'PRODUCT',
    } = body as {
      toOutletId?: string
      notes?: string
      itemType?: string
      items?: Array<{
        productId?: string
        inventoryItemId?: string
        productName: string
        productSku?: string
        productBarcode?: string
        quantity: number
        hpp: number
        price: number
      }>
    }

    // Validate required fields
    if (!toOutletId) {
      return safeJsonError('Outlet tujuan wajib diisi', 400)
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return safeJsonError('Transfer harus memiliki minimal 1 item', 400)
    }

    // ═══════════════════════════════════════════════════════════════════
    // INVENTORY (Bahan Baku) Transfer
    // ═══════════════════════════════════════════════════════════════════
    if (itemType === 'INVENTORY') {
      // Validate each item has inventoryItemId
      const enrichedInventoryItems: Array<{
        inventoryItemId: string
        itemName: string
        itemSku: string | null
        baseUnit: string
        quantity: number
        avgCost: number
      }> = []

      for (const item of items) {
        if (!item.quantity || item.quantity <= 0) {
          return safeJsonError('Setiap item harus memiliki quantity > 0', 400)
        }
        if (!item.inventoryItemId) {
          return safeJsonError('Transfer item harus memiliki inventoryItemId pada setiap item', 400)
        }

        const invItem = await db.inventoryItem.findFirst({
          where: { id: item.inventoryItemId, outletId: user.outletId },
          select: { id: true, name: true, sku: true, baseUnit: true, stock: true, avgCost: true },
        })
        if (!invItem) {
          return safeJsonError(`Item dengan ID ${item.inventoryItemId} tidak ditemukan`, 400)
        }
        if (invItem.stock < item.quantity) {
          return safeJsonError(`Stok ${invItem.name} tidak mencukupi (sisa: ${invItem.stock})`, 400)
        }
        enrichedInventoryItems.push({
          inventoryItemId: invItem.id,
          itemName: invItem.name,
          itemSku: invItem.sku || null,
          baseUnit: invItem.baseUnit,
          quantity: item.quantity,
          avgCost: invItem.avgCost || 0,
        })
      }

      // Verify outlet group
      const currentOutlet = await db.outlet.findUnique({
        where: { id: user.outletId },
        select: { id: true, name: true, groupId: true },
      })
      if (!currentOutlet?.groupId) {
        return safeJsonError('Outlet belum tergabung dalam grup', 400)
      }
      const destOutlet = await db.outlet.findFirst({
        where: { id: toOutletId, groupId: currentOutlet.groupId },
        select: { id: true, name: true },
      })
      if (!destOutlet) {
        return safeJsonError('Outlet tujuan tidak ditemukan atau tidak dalam grup yang sama', 400)
      }
      if (toOutletId === user.outletId) {
        return safeJsonError('Tidak dapat transfer ke outlet yang sama', 400)
      }

      // Generate transfer number: TRF-INV-YYYYMMDD-XXXX
      const now = new Date()
      const dateStr =
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0')
      const prefix = `TRF-INV-${dateStr}-`
      const todayTransfers = await db.outletTransfer.findMany({
        where: { transferNumber: { startsWith: prefix } },
        select: { transferNumber: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      })
      let seq = 1
      if (todayTransfers.length > 0) {
        const lastSeq = parseInt(todayTransfers[0].transferNumber.slice(prefix.length), 10)
        if (!isNaN(lastSeq)) seq = lastSeq + 1
      }
      const transferNumber = `${prefix}${String(seq).padStart(4, '0')}`

      // Create transfer with inventory items in a transaction
      const result = await db.$transaction(async (tx) => {
        const transfer = await tx.outletTransfer.create({
          data: {
            transferNumber,
            fromOutletId: user.outletId,
            toOutletId,
            itemType: 'INVENTORY',
            status: 'DRAFT',
            notes: notes?.trim() || null,
            createdById: user.id,
            outletId: user.outletId,
            groupId: currentOutlet.groupId,
            inventoryTransferItems: {
              create: enrichedInventoryItems.map((item) => ({
                inventoryItemId: item.inventoryItemId,
                itemName: item.itemName,
                itemSku: item.itemSku,
                baseUnit: item.baseUnit,
                quantity: item.quantity,
                avgCost: item.avgCost,
                outletId: user.outletId,
              })),
            },
          },
          include: {
            fromOutlet: { select: { id: true, name: true } },
            toOutlet: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
            inventoryTransferItems: true,
          },
        })

        // Audit log
        const totalQty = enrichedInventoryItems.reduce((s, i) => s + i.quantity, 0)
        const totalValue = enrichedInventoryItems.reduce((s, i) => s + i.quantity * i.avgCost, 0)
        await tx.auditLog.create({
          data: {
            action: 'CREATE',
            entityType: 'STOCK',
            entityId: transfer.id,
            details: JSON.stringify({
              action: 'TRANSFER_DRAFT',
              itemType: 'INVENTORY',
              transferNumber,
              toOutlet: destOutlet.name,
              itemCount: enrichedInventoryItems.length,
              totalQty,
              totalValue,
              items: enrichedInventoryItems.map((i) => ({
                inventoryItemId: i.inventoryItemId,
                itemName: i.itemName,
                itemSku: i.itemSku,
                baseUnit: i.baseUnit,
                quantity: i.quantity,
                avgCost: i.avgCost,
                subtotal: i.quantity * i.avgCost,
              })),
            }),
            outletId: user.outletId,
            userId: user.id,
          },
        })

        return transfer
      })

      return safeJsonCreated({
        ...result,
        _count: { items: result.inventoryTransferItems.length },
      })
    }

    // ═══════════════════════════════════════════════════════════════════
    // PRODUCT Transfer (existing logic)
    // ═══════════════════════════════════════════════════════════════════

    // Look up products by productId and enrich with name/sku/barcode/hpp/price
    const enrichedItems: Array<{
      productName: string
      productSku: string | null
      productBarcode: string | null
      quantity: number
      hpp: number
      price: number
      productSnapshot: string | null
    }> = []

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) {
        return safeJsonError('Setiap item harus memiliki quantity > 0', 400)
      }

      if (item.productId) {
        // Look up product from database
        const product = await db.product.findFirst({
          where: { id: item.productId, outletId: user.outletId },
          select: {
            id: true, name: true, sku: true, barcode: true, hpp: true, price: true,
            stock: true, hasVariants: true, image: true, unit: true,
            lowStockAlert: true, bruto: true, netto: true,
            category: { select: { id: true, name: true, color: true } },
            variants: { select: { id: true, name: true, sku: true, barcode: true, hpp: true, price: true, stock: true } },
          },
        })
        if (!product) {
          return safeJsonError(`Produk dengan ID ${item.productId} tidak ditemukan`, 400)
        }

        // Compute real available stock (aggregate variants if needed)
        const availableStock = product.hasVariants && product.variants.length > 0
          ? product.variants.reduce((s, v) => s + v.stock, 0)
          : product.stock

        // AUDIT-2-001/002 FIX: Reject variant-product transfers at create time.
        // The transfer UI captures only an aggregate `item.quantity` and snapshots
        // each variant's FULL current stock. The IN_TRANSIT/RECEIVE code then
        // deducted/restocked the snapshot stock (not item.quantity) per variant,
        // breaking `parent.stock == sum(variants)` at BOTH source and destination.
        // Verified by audit: source Small 50→0, Large 30→0, parent 80→77 (drift 77).
        // The correct fix requires per-variant qty input in the UI (a larger
        // effort). Until then, REJECT with a clear error so no new corrupted
        // transfers are created. Non-variant products and INVENTORY items are
        // unaffected.
        if (product.hasVariants && product.variants.length > 0) {
          return safeJsonError(
            `Transfer produk dengan varian belum didukung. ` +
            `Produk "${product.name}" memiliki ${product.variants.length} varian. ` +
            `Silakan transfer produk tanpa varian, atau ubah produk menjadi non-varian terlebih dahulu.`,
            400
          )
        }

        // Compute real hpp (average from variants if needed)
        const realHpp = product.hasVariants && product.variants.length > 0
          ? Math.round(product.variants.reduce((s, v) => s + v.hpp, 0) / product.variants.length)
          : (product.hpp || 0)

        // Compute real price (min from variants if needed)
        const realPrice = product.hasVariants && product.variants.length > 0
          ? Math.min(...product.variants.map(v => v.price))
          : product.price

        if (availableStock < item.quantity) {
          return safeJsonError(`Stok ${product.name} tidak mencukupi (sisa: ${availableStock})`, 400)
        }
        enrichedItems.push({
          productName: product.name,
          productSku: product.sku || product.barcode || null,
          productBarcode: product.barcode || product.sku || null,
          quantity: item.quantity,
          hpp: realHpp,
          price: realPrice,
          productSnapshot: JSON.stringify({
            image: product.image || null,
            unit: product.unit || 'pcs',
            lowStockAlert: product.lowStockAlert || 10,
            bruto: product.bruto || 0,
            netto: product.netto || 0,
            hasVariants: product.hasVariants,
            categoryId: product.category?.id || null,
            categoryName: product.category?.name || null,
            categoryColor: product.category?.color || 'zinc',
            variants: product.variants.map(v => ({
              name: v.name,
              sku: v.sku || null,
              barcode: v.barcode || null,
              hpp: v.hpp || 0,
              price: v.price,
              stock: v.stock,
            })),
          }),
        })
      } else if (item.productName) {
        // Manual entry (no productId)
        if (!item.productName || item.price < 0) {
          return safeJsonError('Setiap item harus memiliki nama dan price >= 0', 400)
        }
        enrichedItems.push({
          productName: item.productName,
          productSku: item.productSku?.trim() || null,
          productBarcode: item.productBarcode?.trim() || null,
          quantity: item.quantity,
          hpp: item.hpp || 0,
          price: item.price,
          productSnapshot: null,
        })
      } else {
        return safeJsonError('Setiap item harus memiliki productId atau productName', 400)
      }
    }

    // Verify current outlet has a group
    const currentOutlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { id: true, name: true, groupId: true },
    })

    if (!currentOutlet?.groupId) {
      return safeJsonError('Outlet belum tergabung dalam grup', 400)
    }

    // Verify destination outlet is in the same group
    const destOutlet = await db.outlet.findFirst({
      where: { id: toOutletId, groupId: currentOutlet.groupId },
      select: { id: true, name: true },
    })

    if (!destOutlet) {
      return safeJsonError('Outlet tujuan tidak ditemukan atau tidak dalam grup yang sama', 400)
    }

    if (toOutletId === user.outletId) {
      return safeJsonError('Tidak dapat transfer ke outlet yang sama', 400)
    }

    // Generate transfer number: TRF-YYYYMMDD-XXXX
    const now = new Date()
    const dateStr =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0')

    // Find today's last transfer number for sequential padding
    const prefix = `TRF-${dateStr}-`
    const todayTransfers = await db.outletTransfer.findMany({
      where: {
        transferNumber: { startsWith: prefix },
      },
      select: { transferNumber: true },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })

    let seq = 1
    if (todayTransfers.length > 0) {
      const lastNumber = todayTransfers[0].transferNumber
      const lastSeq = parseInt(lastNumber.slice(prefix.length), 10)
      if (!isNaN(lastSeq)) {
        seq = lastSeq + 1
      }
    }
    const transferNumber = `${prefix}${String(seq).padStart(4, '0')}`

    // Create transfer with items in a transaction
    const result = await db.$transaction(async (tx) => {
      const transfer = await tx.outletTransfer.create({
        data: {
          transferNumber,
          fromOutletId: user.outletId,
          toOutletId,
          status: 'DRAFT',
          notes: notes?.trim() || null,
          createdById: user.id,
          outletId: user.outletId,
          groupId: currentOutlet.groupId,
          items: {
            create: enrichedItems.map((item) => ({
              productName: item.productName,
              productSku: item.productSku?.trim() || null,
              productBarcode: item.productBarcode?.trim() || null,
              quantity: item.quantity,
              hpp: item.hpp || 0,
              price: item.price,
              outletId: user.outletId,
              productSnapshot: item.productSnapshot || null,
            })),
          },
        },
        include: {
          fromOutlet: { select: { id: true, name: true } },
          toOutlet: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          items: true,
        },
      })

      // Audit log — detailed with item breakdown including variants
      const totalQty = enrichedItems.reduce((s, i) => s + i.quantity, 0)
      const totalValue = enrichedItems.reduce((s, i) => s + i.quantity * i.price, 0)
      const totalHpp = enrichedItems.reduce((s, i) => s + i.quantity * i.hpp, 0)

      const auditItems = enrichedItems.map((item) => {
        const parsed: Record<string, unknown> = {
          productName: item.productName,
          productSku: item.productSku,
          productBarcode: item.productBarcode,
          quantity: item.quantity,
          hpp: item.hpp,
          price: item.price,
          subtotal: item.quantity * item.price,
        }
        // Parse variant info from snapshot if available
        if (item.productSnapshot) {
          try {
            const snap = JSON.parse(item.productSnapshot)
            if (snap.hasVariants && Array.isArray(snap.variants) && snap.variants.length > 0) {
              parsed.hasVariants = true
              parsed.variants = snap.variants.map((v: { name: string; sku?: string; barcode?: string; hpp?: number; price: number; stock: number }) => ({
                name: v.name,
                sku: v.sku || null,
                price: v.price,
                hpp: v.hpp || 0,
                stock: v.stock,
              }))
            }
          } catch { /* ignore */ }
        }
        return parsed
      })

      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'STOCK',
          entityId: transfer.id,
          details: JSON.stringify({
            action: 'TRANSFER_DRAFT',
            transferNumber,
            toOutlet: destOutlet.name,
            itemCount: enrichedItems.length,
            totalQty,
            totalValue,
            totalHpp,
            items: auditItems,
          }),
          outletId: user.outletId,
          userId: user.id,
        },
      })

      return transfer
    })

    return safeJsonCreated({
      ...result,
      _count: { items: result.items.length },
    })
  } catch (error) {
    console.error('[/api/transfers] POST error:', error)
    return safeJsonError('Failed to create transfer')
  }
}