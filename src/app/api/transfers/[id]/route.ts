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
          select: {
            id: true,
            productName: true,
            productSku: true,
            productBarcode: true,
            quantity: true,
            hpp: true,
            price: true,
            productSnapshot: true,
            createdAt: true,
          },
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
 * - IN_TRANSIT → RECEIVED: Add stock to destination outlet (create new product or restock)
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
        items: {
          select: {
            id: true,
            productName: true,
            productSku: true,
            productBarcode: true,
            quantity: true,
            hpp: true,
            price: true,
            productSnapshot: true,
          },
        },
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
          if (!product) {
            // Try by name as last resort
            product = await tx.product.findFirst({
              where: {
                outletId: transfer.fromOutletId,
                name: item.productName,
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
                productName: i.productName,
                productSku: i.productSku,
                quantity: i.quantity,
              })),
            }),
            outletId: transfer.fromOutletId,
            userId: user.id,
          },
        })

        // Audit log at destination outlet (incoming notification)
        await tx.auditLog.create({
          data: {
            action: 'RESTOCK',
            entityType: 'STOCK',
            entityId: id,
            details: JSON.stringify({
              action: 'TRANSFER_INCOMING',
              transferNumber: transfer.transferNumber,
              fromOutlet: transfer.fromOutlet.name,
              itemCount: transfer.items.length,
              items: transfer.items.map((i) => ({
                productName: i.productName,
                productSku: i.productSku,
                quantity: i.quantity,
              })),
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
          items: {
            select: {
              id: true, productName: true, productSku: true, productBarcode: true,
              quantity: true, hpp: true, price: true, productSnapshot: true,
            },
          },
        },
      })

      return safeJson({
        ...updated,
        message: `Transfer ${transfer.transferNumber} sedang dalam pengiriman`,
      })
    }

    // ── RECEIVED: Add stock to destination outlet ──
    // Products are created as new or restocked at the branch
    if (status === 'RECEIVED') {
      const createdProducts: string[] = []
      const restockedProducts: string[] = []

      await db.$transaction(async (tx) => {
        const destOutletId = transfer.toOutletId

        for (const item of transfer.items) {
          // Try to find existing product in destination by SKU first, then barcode
          let product: { id: string; name: string; stock: number } | null = null
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
          if (!product) {
            // Fallback: match by name (case-insensitive via contains)
            product = await tx.product.findFirst({
              where: { outletId: destOutletId, name: item.productName },
            })
          }

          if (product) {
            // Product exists in destination — increment stock (restock)
            const newStock = product.stock + item.quantity
            await tx.product.update({
              where: { id: product.id },
              data: { stock: newStock },
            })
            restockedProducts.push(item.productName)

            // If snapshot has variants and destination product has none, create them
            let snapshot: Record<string, unknown> | null = null
            try {
              snapshot = item.productSnapshot ? JSON.parse(item.productSnapshot) : null
            } catch { /* ignore */ }

            if (snapshot?.variants && Array.isArray(snapshot.variants) && snapshot.variants.length > 0) {
              const existingVariants = await tx.productVariant.count({
                where: { productId: product.id },
              })
              if (existingVariants === 0) {
                for (const v of snapshot.variants) {
                  const variant = v as { name: string; sku?: string; barcode?: string; hpp?: number; price: number; stock: number }
                  await tx.productVariant.create({
                    data: {
                      productId: product.id,
                      name: variant.name,
                      sku: variant.sku || null,
                      barcode: variant.barcode || null,
                      hpp: variant.hpp || 0,
                      price: variant.price,
                      stock: variant.stock || 0,
                      outletId: destOutletId,
                    },
                  })
                }
                await tx.product.update({
                  where: { id: product.id },
                  data: { hasVariants: true },
                })
              }
            }

            // Per-product audit log so it shows in product detail movement history
            await tx.auditLog.create({
              data: {
                action: 'RESTOCK',
                entityType: 'STOCK',
                entityId: product.id,
                details: JSON.stringify({
                  action: 'TRANSFER_IN',
                  transferNumber: transfer.transferNumber,
                  fromOutlet: transfer.fromOutlet.name,
                  productName: item.productName,
                  productSku: item.productSku,
                  quantityAdded: item.quantity,
                  previousStock: product.stock,
                  newStock,
                }),
                outletId: destOutletId,
                userId: user.id,
              },
            })
          } else {
            // Product doesn't exist — create new product in destination
            // Parse product snapshot for full data
            let snapshot: Record<string, unknown> | null = null
            try {
              snapshot = item.productSnapshot ? JSON.parse(item.productSnapshot) : null
            } catch { /* ignore */ }

            const productData: Record<string, unknown> = {
              name: item.productName,
              sku: item.productSku || null,
              barcode: item.productBarcode || null,
              hpp: item.hpp || 0,
              price: item.price,
              stock: item.quantity,
              outletId: destOutletId,
              // Use snapshot data if available, otherwise defaults
              image: (snapshot?.image as string) || null,
              unit: (snapshot?.unit as string) || 'pcs',
              lowStockAlert: (snapshot?.lowStockAlert as number) || 10,
              bruto: (snapshot?.bruto as number) || 0,
              netto: (snapshot?.netto as number) || 0,
              hasVariants: (snapshot?.hasVariants as boolean) || false,
            }

            // Match or create category at destination
            if (snapshot?.categoryName) {
              let destCategory = await tx.category.findFirst({
                where: { name: snapshot.categoryName as string, outletId: destOutletId },
              })
              if (!destCategory) {
                // Auto-create category at branch if it doesn't exist
                const color = (snapshot?.categoryColor as string) || 'zinc'
                destCategory = await tx.category.create({
                  data: { name: snapshot.categoryName as string, color, outletId: destOutletId },
                })
              }
              productData.categoryId = destCategory.id
            }

            const newProduct = await tx.product.create({ data: productData })
            createdProducts.push(item.productName)

            // Create variants if snapshot has them
            if (snapshot?.variants && Array.isArray(snapshot.variants) && snapshot.variants.length > 0) {
              for (const v of snapshot.variants) {
                const variant = v as { name: string; sku?: string; barcode?: string; hpp?: number; price: number; stock: number }
                await tx.productVariant.create({
                  data: {
                    productId: newProduct.id,
                    name: variant.name,
                    sku: variant.sku || null,
                    barcode: variant.barcode || null,
                    hpp: variant.hpp || 0,
                    price: variant.price,
                    stock: variant.stock || 0,
                    outletId: destOutletId,
                  },
                })
              }
            }

            // Per-product audit log: CREATE
            await tx.auditLog.create({
              data: {
                action: 'CREATE',
                entityType: 'PRODUCT',
                entityId: newProduct.id,
                details: JSON.stringify({
                  action: 'TRANSFER_IN_NEW',
                  transferNumber: transfer.transferNumber,
                  fromOutlet: transfer.fromOutlet.name,
                  productName: item.productName,
                  productSku: item.productSku,
                  initialStock: item.quantity,
                  price: item.price,
                  hpp: item.hpp || 0,
                }),
                outletId: destOutletId,
                userId: user.id,
              },
            })

            // Per-product audit log: RESTOCK (initial stock from transfer)
            await tx.auditLog.create({
              data: {
                action: 'RESTOCK',
                entityType: 'STOCK',
                entityId: newProduct.id,
                details: JSON.stringify({
                  action: 'TRANSFER_IN',
                  transferNumber: transfer.transferNumber,
                  fromOutlet: transfer.fromOutlet.name,
                  productName: item.productName,
                  productSku: item.productSku,
                  quantityAdded: item.quantity,
                  previousStock: 0,
                  newStock: item.quantity,
                }),
                outletId: destOutletId,
                userId: user.id,
              },
            })
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

        // Audit log at destination outlet (RECEIVED)
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
              createdProducts: createdProducts.length > 0 ? createdProducts : undefined,
              restockedProducts: restockedProducts.length > 0 ? restockedProducts : undefined,
              items: transfer.items.map((i) => ({
                productName: i.productName,
                productSku: i.productSku,
                quantity: i.quantity,
                price: i.price,
                hpp: i.hpp,
              })),
            }),
            outletId: destOutletId,
            userId: user.id,
          },
        })

        // Audit log at source outlet (confirmation that branch received)
        await tx.auditLog.create({
          data: {
            action: 'ADJUSTMENT',
            entityType: 'STOCK',
            entityId: id,
            details: JSON.stringify({
              action: 'TRANSFER_RECEIVED_BY_BRANCH',
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
          createdBy: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
          items: {
            select: {
              id: true, productName: true, productSku: true, productBarcode: true,
              quantity: true, hpp: true, price: true, productSnapshot: true,
            },
          },
        },
      })

      // Build success message with detail
      const parts: string[] = []
      if (createdProducts.length > 0) parts.push(`${createdProducts.length} produk baru ditambahkan`)
      if (restockedProducts.length > 0) parts.push(`${restockedProducts.length} produk di-restock`)
      const detailMsg = parts.length > 0 ? ` (${parts.join(', ')})` : ''

      return safeJson({
        ...updated,
        message: `Transfer ${transfer.transferNumber} berhasil diterima${detailMsg}`,
        createdProducts,
        restockedProducts,
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
              items: transfer.items.map((i) => ({
                productName: i.productName,
                productSku: i.productSku,
                quantity: i.quantity,
              })),
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
          items: {
            select: {
              id: true, productName: true, productSku: true, productBarcode: true,
              quantity: true, hpp: true, price: true, productSnapshot: true,
            },
          },
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
      message.includes('tidak mencukupi') ||
      message.includes('Unique constraint')
    ) {
      return safeJsonError(message, 400)
    }
    return safeJsonError('Failed to update transfer')
  }
}