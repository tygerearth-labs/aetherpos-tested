import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

type TransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'

/**
 * GET /api/transfers/[id] — Get transfer details with items
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { id } = await params

    const transfer = await db.outletTransfer.findUnique({
      where: { id },
      include: {
        fromOutlet: {
          select: { id: true, name: true, address: true, phone: true },
        },
        toOutlet: {
          select: { id: true, name: true, address: true, phone: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        receivedBy: {
          select: { id: true, name: true, email: true },
        },
        items: {
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!transfer) {
      return safeJsonError('Transfer tidak ditemukan', 404)
    }

    // Only allow access if the outlet is the sender or receiver
    if (
      transfer.fromOutletId !== user.outletId &&
      transfer.toOutletId !== user.outletId
    ) {
      return safeJsonError('Anda tidak memiliki akses ke transfer ini', 403)
    }

    return safeJson(
      {
        ...transfer,
        direction:
          transfer.fromOutletId === user.outletId ? 'OUTBOUND' : 'INBOUND',
      },
      200,
      CACHE.MEDIUM,
    )
  } catch (error) {
    console.error('[/api/transfers/[id]] GET error:', error)
    return safeJsonError('Failed to load transfer details')
  }
}

/**
 * PATCH /api/transfers/[id] — Update transfer status
 *
 * Status transitions:
 * - DRAFT → IN_TRANSIT: Deduct stock from source outlet
 * - IN_TRANSIT → RECEIVED: Add stock to destination outlet
 * - DRAFT → CANCELLED: Cancel the transfer
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { id } = await params
    const body = await request.json()
    const { status } = body as { status?: TransferStatus }

    const validStatuses: TransferStatus[] = [
      'IN_TRANSIT',
      'RECEIVED',
      'CANCELLED',
    ]

    if (!status || !validStatuses.includes(status)) {
      return safeJsonError(
        'Status tidak valid. Pilihan: IN_TRANSIT, RECEIVED, CANCELLED',
        400,
      )
    }

    // Fetch transfer with items
    const transfer = await db.outletTransfer.findUnique({
      where: { id },
      include: {
        items: true,
        fromOutlet: { select: { id: true, name: true } },
        toOutlet: { select: { id: true, name: true } },
      },
    })

    if (!transfer) {
      return safeJsonError('Transfer tidak ditemukan', 404)
    }

    // Validate the outlet is involved
    if (
      transfer.fromOutletId !== user.outletId &&
      transfer.toOutletId !== user.outletId
    ) {
      return safeJsonError('Anda tidak memiliki akses ke transfer ini', 403)
    }

    // Validate status transitions
    if (status === 'IN_TRANSIT' && transfer.status !== 'DRAFT') {
      return safeJsonError('Hanya transfer DRAFT yang dapat dikirim', 400)
    }

    if (status === 'RECEIVED' && transfer.status !== 'IN_TRANSIT') {
      return safeJsonError('Hanya transfer IN_TRANSIT yang dapat diterima', 400)
    }

    if (status === 'CANCELLED' && transfer.status !== 'DRAFT') {
      return safeJsonError('Hanya transfer DRAFT yang dapat dibatalkan', 400)
    }

    // Only sender can mark as IN_TRANSIT or CANCELLED
    if (
      (status === 'IN_TRANSIT' || status === 'CANCELLED') &&
      transfer.fromOutletId !== user.outletId
    ) {
      return safeJsonError(
        'Hanya outlet pengirim yang dapat mengubah status ini',
        403,
      )
    }

    // Only receiver can mark as RECEIVED
    if (status === 'RECEIVED' && transfer.toOutletId !== user.outletId) {
      return safeJsonError(
        'Hanya outlet penerima yang dapat mengkonfirmasi penerimaan',
        403,
      )
    }

    // ── IN_TRANSIT: Deduct stock from source outlet ──
    if (status === 'IN_TRANSIT') {
      await db.$transaction(async (tx) => {
        // Deduct stock from each product in the source outlet
        for (const item of transfer.items) {
          // Try to find product by SKU first, then barcode
          let product: { id: string; name: string; stock: number } | null = null
          if (item.productSku) {
            product = await tx.product.findFirst({
              where: {
                outletId: transfer.fromOutletId,
                sku: item.productSku,
              },
              })
          }
          if (!product && item.productBarcode) {
            product = await tx.product.findFirst({
              where: {
                outletId: transfer.fromOutletId,
                barcode: item.productBarcode,
              },
            })
          }

          if (product) {
            const newStock = product.stock - item.quantity
            if (newStock < 0) {
              throw new Error(
                `Stok ${product.name} tidak mencukupi (sisa: ${product.stock}, diminta: ${item.quantity})`,
              )
            }
            await tx.product.update({
              where: { id: product.id },
              data: { stock: newStock },
            })
          }
          // If product not found by SKU/barcode, still allow transfer
          // (product may have been deleted or SKU changed)
        }

        // Update transfer status
        await tx.outletTransfer.update({
          where: { id },
          data: { status: 'IN_TRANSIT' },
        })

        // Audit log at source outlet
        await tx.auditLog.create({
          data: {
            action: 'ADJUSTMENT',
            entityType: 'STOCK',
            entityId: id,
            details: JSON.stringify({
              action: 'TRANSFER_SENT',
              transferNumber: transfer.transferNumber,
              toOutlet: transfer.toOutlet.name,
              itemCount: transfer.items.length,
              items: transfer.items.map((i) => ({
                name: i.productName,
                sku: i.productSku,
                quantity: i.quantity,
              })),
            }),
            outletId: transfer.fromOutletId,
            userId: user.id,
          },
        })

        // Audit log at destination outlet
        await tx.auditLog.create({
          data: {
            action: 'ADJUSTMENT',
            entityType: 'STOCK',
            entityId: id,
            details: JSON.stringify({
              action: 'TRANSFER_INCOMING',
              transferNumber: transfer.transferNumber,
              fromOutlet: transfer.fromOutlet.name,
              itemCount: transfer.items.length,
            }),
            outletId: transfer.toOutletId,
            userId: user.id,
          },
        })
      })

      const updated = await db.outletTransfer.findUnique({
        where: { id },
        include: {
          fromOutlet: { select: { name: true } },
          toOutlet: { select: { name: true } },
          items: true,
        },
      })

      return safeJson({
        ...updated,
        message: `Transfer ${transfer.transferNumber} sedang dalam pengiriman`,
      })
    }

    // ── RECEIVED: Add stock to destination outlet ──
    if (status === 'RECEIVED') {
      await db.$transaction(async (tx) => {
        const destOutletId = transfer.toOutletId

        for (const item of transfer.items) {
          // Try to find existing product in destination by SKU first, then barcode
          let product: { id: string } | null = null
          if (item.productSku) {
            product = await tx.product.findFirst({
              where: { outletId: destOutletId, sku: item.productSku },
            })
          }
          if (!product && item.productBarcode) {
            product = await tx.product.findFirst({
              where: { outletId: destOutletId, barcode: item.productBarcode },
            })
          }

          if (product) {
            // Product exists in destination — increment stock
            await tx.product.update({
              where: { id: product.id },
              data: { stock: { increment: item.quantity } },
            })
          } else {
            // Product doesn't exist — create new product in destination
            // Check if a product with the same name already exists in destination
            const existingByName = await tx.product.findFirst({
              where: { outletId: destOutletId, name: item.productName },
            })

            if (!existingByName) {
              await tx.product.create({
                data: {
                  name: item.productName,
                  sku: item.productSku || null,
                  barcode: item.productBarcode || null,
                  hpp: item.hpp,
                  price: item.price,
                  stock: item.quantity,
                  outletId: destOutletId,
                  lowStockAlert: 10,
                  unit: 'pcs',
                },
              })
            } else {
              // Name match — increment stock on existing product
              await tx.product.update({
                where: { id: existingByName.id },
                data: { stock: { increment: item.quantity } },
              })
            }
          }
        }

        // Update transfer status
        await tx.outletTransfer.update({
          where: { id },
          data: {
            status: 'RECEIVED',
            receivedById: user.id,
            receivedAt: new Date(),
          },
        })

        // Audit log at destination outlet
        await tx.auditLog.create({
          data: {
            action: 'RESTOCK',
            entityType: 'STOCK',
            entityId: id,
            details: JSON.stringify({
              action: 'TRANSFER_RECEIVED',
              transferNumber: transfer.transferNumber,
              fromOutlet: transfer.fromOutlet.name,
              itemCount: transfer.items.length,
              items: transfer.items.map((i) => ({
                name: i.productName,
                sku: i.productSku,
                quantity: i.quantity,
              })),
            }),
            outletId: destOutletId,
            userId: user.id,
          },
        })
      })

      const updated = await db.outletTransfer.findUnique({
        where: { id },
        include: {
          fromOutlet: { select: { name: true } },
          toOutlet: { select: { name: true } },
          createdBy: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
          items: true,
        },
      })

      return safeJson({
        ...updated,
        message: `Transfer ${transfer.transferNumber} berhasil diterima`,
      })
    }

    // ── CANCELLED: Cancel DRAFT transfer ──
    if (status === 'CANCELLED') {
      await db.$transaction(async (tx) => {
        await tx.outletTransfer.update({
          where: { id },
          data: { status: 'CANCELLED' },
        })

        await tx.auditLog.create({
          data: {
            action: 'ADJUSTMENT',
            entityType: 'STOCK',
            entityId: id,
            details: JSON.stringify({
              action: 'TRANSFER_CANCELLED',
              transferNumber: transfer.transferNumber,
              toOutlet: transfer.toOutlet.name,
              itemCount: transfer.items.length,
            }),
            outletId: transfer.fromOutletId,
            userId: user.id,
          },
        })
      })

      const updated = await db.outletTransfer.findUnique({
        where: { id },
        include: {
          fromOutlet: { select: { name: true } },
          toOutlet: { select: { name: true } },
          items: true,
        },
      })

      return safeJson({
        ...updated,
        message: `Transfer ${transfer.transferNumber} dibatalkan`,
      })
    }

    return safeJsonError('Operasi tidak valid', 400)
  } catch (error: unknown) {
    console.error('[/api/transfers/[id]] PATCH error:', error)
    const message =
      error instanceof Error ? error.message : 'Failed to update transfer'
    // Distinguish validation errors from internal errors
    if (
      message.includes('Stok') ||
      message.includes('tidak mencukupi')
    ) {
      return safeJsonError(message, 400)
    }
    return safeJsonError('Failed to update transfer')
  }
}