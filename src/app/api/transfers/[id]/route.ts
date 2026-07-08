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
        inventoryTransferItems: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            inventoryItemId: true,
            itemName: true,
            itemSku: true,
            baseUnit: true,
            quantity: true,
            avgCost: true,
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
        inventoryTransferItems: {
          select: {
            id: true,
            inventoryItemId: true,
            itemName: true,
            itemSku: true,
            baseUnit: true,
            quantity: true,
            avgCost: true,
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

    if (status === 'CANCELLED' && transfer.status !== 'DRAFT' && transfer.status !== 'IN_TRANSIT') {
      return safeJsonError('Hanya transfer DRAFT atau IN_TRANSIT yang dapat dibatalkan', 400)
    }

    // Only sender can mark as IN_TRANSIT or CANCELLED (CANCELLED from IN_TRANSIT also by sender)
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

    // ── Helper: Build detailed audit items with variant info ──
    const buildAuditItems = (items: typeof transfer.items) =>
      items.map((i) => {
        const entry: Record<string, unknown> = {
          productName: i.productName,
          productSku: i.productSku,
          productBarcode: i.productBarcode,
          quantity: i.quantity,
          hpp: i.hpp,
          price: i.price,
          subtotal: i.quantity * i.price,
        }
        if (i.productSnapshot) {
          try {
            const snap = JSON.parse(i.productSnapshot)
            if (snap.hasVariants && Array.isArray(snap.variants) && snap.variants.length > 0) {
              entry.hasVariants = true
              entry.variants = snap.variants.map((v: { name: string; sku?: string; barcode?: string; hpp?: number; price: number; stock: number }) => ({
                name: v.name, sku: v.sku || null, price: v.price, hpp: v.hpp || 0, stock: v.stock,
              }))
            }
          } catch { /* ignore */ }
        }
        return entry
      })

    // ── IN_TRANSIT: Deduct stock from source outlet ──
    if (status === 'IN_TRANSIT') {
      // ── INVENTORY: Deduct InventoryItem stock + create InventoryMovement ──
      if (transfer.itemType === 'INVENTORY') {
        const invItems = transfer.inventoryTransferItems
        const totalQty = invItems.reduce((s, i) => s + i.quantity, 0)
        const totalValue = invItems.reduce((s, i) => s + i.quantity * i.avgCost, 0)

        await db.$transaction(async (tx) => {
          for (const item of invItems) {
            const invItem = await tx.inventoryItem.findFirst({
              where: { id: item.inventoryItemId, outletId: transfer.fromOutletId },
              select: { id: true, name: true, stock: true },
            })
            if (!invItem) {
              throw new Error(`Item ${item.itemName} tidak ditemukan di outlet pengirim`)
            }
            const prevStock = invItem.stock
            const newStock = invItem.stock - item.quantity
            if (newStock < 0) {
              throw new Error(`Stok ${item.itemName} tidak mencukupi (sisa: ${invItem.stock}, diminta: ${item.quantity})`)
            }
            await tx.inventoryItem.update({
              where: { id: invItem.id },
              data: { stock: newStock },
            })
            await tx.inventoryMovement.create({
              data: {
                type: 'TRANSFER_OUT',
                quantity: -item.quantity,
                previousStock: prevStock,
                newStock,
                referenceId: id,
                referenceType: 'TRANSFER',
                notes: `Transfer ke ${transfer.toOutlet.name} (${transfer.transferNumber})`,
                outletId: transfer.fromOutletId,
                inventoryItemId: invItem.id,
                userId: user.id,
              },
            })
          }

          // Update transfer status (atomic: only succeeds if still DRAFT)
          const statusAffected = await tx.$executeRaw`
            UPDATE "OutletTransfer" SET status = 'IN_TRANSIT' WHERE id = ${id} AND status = 'DRAFT'
          `
          if (statusAffected === 0) {
            throw new Error('Transfer sudah dikirim oleh pengguna lain')
          }

          // Audit log at source outlet
          await tx.auditLog.create({
            data: {
              action: 'ADJUSTMENT',
              entityType: 'STOCK',
              entityId: id,
              details: JSON.stringify({
                action: 'TRANSFER_SENT',
                itemType: 'INVENTORY',
                transferNumber: transfer.transferNumber,
                toOutlet: transfer.toOutlet.name,
                itemCount: invItems.length,
                totalQty,
                totalValue,
                items: invItems.map((i) => ({
                  itemName: i.itemName, itemSku: i.itemSku, baseUnit: i.baseUnit,
                  quantity: i.quantity, avgCost: i.avgCost, subtotal: i.quantity * i.avgCost,
                })),
              }),
              outletId: transfer.fromOutletId,
              userId: user.id,
            },
          })

          // Audit log at destination outlet
          await tx.auditLog.create({
            data: {
              action: 'RESTOCK',
              entityType: 'STOCK',
              entityId: id,
              details: JSON.stringify({
                action: 'TRANSFER_INCOMING',
                itemType: 'INVENTORY',
                transferNumber: transfer.transferNumber,
                fromOutlet: transfer.fromOutlet.name,
                itemCount: invItems.length,
                totalQty,
                totalValue,
                items: invItems.map((i) => ({
                  itemName: i.itemName, itemSku: i.itemSku, baseUnit: i.baseUnit,
                  quantity: i.quantity, avgCost: i.avgCost, subtotal: i.quantity * i.avgCost,
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
            inventoryTransferItems: {
              select: {
                id: true, inventoryItemId: true, itemName: true, itemSku: true,
                baseUnit: true, quantity: true, avgCost: true,
              },
            },
          },
        })

        return safeJson({
          ...updated,
          message: `Transfer ${transfer.transferNumber} sedang dalam pengiriman`,
        })
      }

      // ── PRODUCT: Deduct stock from source outlet (with variant sync) ──
      const auditItems = buildAuditItems(transfer.items)
      const totalQty = transfer.items.reduce((s, i) => s + i.quantity, 0)
      const totalValue = transfer.items.reduce((s, i) => s + i.quantity * i.price, 0)

      await db.$transaction(async (tx) => {
        // Track per-product/variant stock changes for per-product audit logs
        const productStockChanges: Array<{
          productId: string
          productName: string
          productSku: string | null
          quantity: number
          price: number
          hpp: number
          previousStock: number
          newStock: number
        }> = []
        const variantStockChanges: Array<{
          variantId: string
          productId: string
          productName: string
          variantName: string
          quantity: number
          price: number
          hpp: number
          previousStock: number
          newStock: number
        }> = []

        // Deduct stock from each product in the source outlet
        for (const item of transfer.items) {
          // Try to find product by SKU first, then barcode, then name
          let product: { id: string; name: string; stock: number; hasVariants: boolean; price: number; hpp: number } | null = null
          if (item.productSku) {
            product = await tx.product.findFirst({
              where: { outletId: transfer.fromOutletId, sku: item.productSku },
              select: { id: true, name: true, stock: true, hasVariants: true, price: true, hpp: true },
            })
          }
          if (!product && item.productBarcode) {
            product = await tx.product.findFirst({
              where: { outletId: transfer.fromOutletId, barcode: item.productBarcode },
              select: { id: true, name: true, stock: true, hasVariants: true, price: true, hpp: true },
            })
          }
          if (!product) {
            product = await tx.product.findFirst({
              where: { outletId: transfer.fromOutletId, name: item.productName },
              select: { id: true, name: true, stock: true, hasVariants: true, price: true, hpp: true },
            })
          }

          if (product) {
            // Parse snapshot for variant info
            let snapshot: Record<string, unknown> | null = null
            try { snapshot = item.productSnapshot ? JSON.parse(item.productSnapshot) : null } catch { /* ignore */ }
            const variants = (snapshot?.variants && Array.isArray(snapshot.variants)) ? snapshot.variants as Array<{ name: string; sku?: string; barcode?: string; hpp?: number; price: number; stock: number }> : []

            if (product.hasVariants && variants.length > 0) {
              // Product with variants — deduct per-variant stock
              for (const variant of variants) {
                const existingVariant = await tx.productVariant.findFirst({
                  where: { productId: product.id, name: variant.name, outletId: transfer.fromOutletId },
                  select: { id: true, name: true, stock: true, price: true, hpp: true },
                })
                if (existingVariant) {
                  const prevStock = existingVariant.stock
                  const newVarStock = existingVariant.stock - variant.stock
                  if (newVarStock < 0) {
                    throw new Error(`Stok variant ${variant.name} dari ${product.name} tidak mencukupi (sisa: ${existingVariant.stock}, diminta: ${variant.stock})`)
                  }
                  await tx.productVariant.update({
                    where: { id: existingVariant.id },
                    data: { stock: newVarStock },
                  })
                  // Track variant stock change for per-variant audit log
                  variantStockChanges.push({
                    variantId: existingVariant.id,
                    productId: product.id,
                    productName: product.name,
                    variantName: existingVariant.name,
                    quantity: variant.stock,
                    price: existingVariant.price,
                    hpp: existingVariant.hpp,
                    previousStock: prevStock,
                    newStock: newVarStock,
                  })
                }
              }
              // Also update parent product stock
              const prevParentStock = product.stock
              const newParentStock = product.stock - item.quantity
              if (newParentStock < 0) {
                throw new Error(`Stok ${product.name} tidak mencukupi (sisa: ${product.stock}, diminta: ${item.quantity})`)
              }
              await tx.product.update({ where: { id: product.id }, data: { stock: newParentStock } })
              // Track parent product stock change for per-product audit log
              productStockChanges.push({
                productId: product.id,
                productName: product.name,
                productSku: item.productSku || null,
                quantity: item.quantity,
                price: product.price,
                hpp: product.hpp,
                previousStock: prevParentStock,
                newStock: newParentStock,
              })
            } else {
              // Product without variants — simple stock deduction
              const prevStock = product.stock
              const newStock = product.stock - item.quantity
              if (newStock < 0) {
                throw new Error(`Stok ${product.name} tidak mencukupi (sisa: ${product.stock}, diminta: ${item.quantity})`)
              }
              await tx.product.update({ where: { id: product.id }, data: { stock: newStock } })
              // Track stock change for per-product audit log
              productStockChanges.push({
                productId: product.id,
                productName: product.name,
                productSku: item.productSku || null,
                quantity: item.quantity,
                price: product.price,
                hpp: product.hpp,
                previousStock: prevStock,
                newStock: newStock,
              })
            }
          }
        }

        // Update transfer status (atomic: only succeeds if still DRAFT)
        const statusAffected = await tx.$executeRaw`
          UPDATE "OutletTransfer" SET status = 'IN_TRANSIT' WHERE id = ${id} AND status = 'DRAFT'
        `
        if (statusAffected === 0) {
          throw new Error('Transfer sudah dikirim oleh pengguna lain')
        }

        // Audit log at source outlet (detailed)
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
              totalQty,
              totalValue,
              items: auditItems,
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
              totalQty,
              totalValue,
              items: auditItems,
            }),
            outletId: transfer.toOutletId,
            userId: user.id,
          },
        })

        // Per-product audit logs for non-variant products (so they appear in product movement history)
        for (const change of productStockChanges) {
          await tx.auditLog.create({
            data: {
              action: 'ADJUSTMENT',
              entityType: 'STOCK',
              entityId: change.productId,
              details: JSON.stringify({
                action: 'TRANSFER_SENT',
                productName: change.productName,
                productSku: change.productSku,
                transferNumber: transfer.transferNumber,
                toOutlet: transfer.toOutlet.name,
                quantity: change.quantity,
                price: change.price,
                hpp: change.hpp,
                totalValue: change.quantity * change.hpp,
                previousStock: change.previousStock,
                newStock: change.newStock,
              }),
              outletId: transfer.fromOutletId,
              userId: user.id,
            },
          })
        }

        // Per-variant audit logs for variant products
        for (const change of variantStockChanges) {
          await tx.auditLog.create({
            data: {
              action: 'ADJUSTMENT',
              entityType: 'VARIANT',
              entityId: change.variantId,
              details: JSON.stringify({
                action: 'TRANSFER_SENT',
                productName: change.productName,
                variantName: change.variantName,
                transferNumber: transfer.transferNumber,
                toOutlet: transfer.toOutlet.name,
                quantity: change.quantity,
                price: change.price,
                hpp: change.hpp,
                totalValue: change.quantity * change.hpp,
                previousStock: change.previousStock,
                newStock: change.newStock,
              }),
              outletId: transfer.fromOutletId,
              userId: user.id,
            },
          })
        }
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
    if (status === 'RECEIVED') {
      // ── INVENTORY: Add stock to destination InventoryItems ──
      if (transfer.itemType === 'INVENTORY') {
        const invItems = transfer.inventoryTransferItems
        const addedItems: string[] = []
        const restockedItems: string[] = []
        const destOutletId = transfer.toOutletId

        await db.$transaction(async (tx) => {
          for (const item of invItems) {
            // Try to find existing InventoryItem at destination by name
            const existingItem = await tx.inventoryItem.findFirst({
              where: { name: item.itemName, outletId: destOutletId },
              select: { id: true, name: true, stock: true },
            })

            if (existingItem) {
              // Increment stock
              const prevStock = existingItem.stock
              const newStock = existingItem.stock + item.quantity
              await tx.inventoryItem.update({
                where: { id: existingItem.id },
                data: { stock: newStock },
              })
              await tx.inventoryMovement.create({
                data: {
                  type: 'TRANSFER_IN',
                  quantity: item.quantity,
                  previousStock: prevStock,
                  newStock,
                  referenceId: id,
                  referenceType: 'TRANSFER',
                  notes: `Transfer dari ${transfer.fromOutlet.name} (${transfer.transferNumber})`,
                  outletId: destOutletId,
                  inventoryItemId: existingItem.id,
                  userId: user.id,
                },
              })
              restockedItems.push(item.itemName)
            } else {
              // Create new InventoryItem at destination
              const newItem = await tx.inventoryItem.create({
                data: {
                  name: item.itemName,
                  sku: item.itemSku,
                  baseUnit: item.baseUnit,
                  stock: item.quantity,
                  avgCost: item.avgCost,
                  outletId: destOutletId,
                },
              })
              await tx.inventoryMovement.create({
                data: {
                  type: 'TRANSFER_IN',
                  quantity: item.quantity,
                  previousStock: 0,
                  newStock: item.quantity,
                  referenceId: id,
                  referenceType: 'TRANSFER',
                  notes: `Transfer dari ${transfer.fromOutlet.name} (${transfer.transferNumber}) — item baru`,
                  outletId: destOutletId,
                  inventoryItemId: newItem.id,
                  userId: user.id,
                },
              })
              addedItems.push(item.itemName)
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

          const totalQty = invItems.reduce((s, i) => s + i.quantity, 0)
          const totalValue = invItems.reduce((s, i) => s + i.quantity * i.avgCost, 0)

          // Audit log at destination
          await tx.auditLog.create({
            data: {
              action: 'RESTOCK',
              entityType: 'STOCK',
              entityId: id,
              details: JSON.stringify({
                action: 'TRANSFER_RECEIVED',
                itemType: 'INVENTORY',
                transferNumber: transfer.transferNumber,
                fromOutlet: transfer.fromOutlet.name,
                itemCount: invItems.length,
                totalQty,
                totalValue,
                addedItems: addedItems.length > 0 ? addedItems : undefined,
                restockedItems: restockedItems.length > 0 ? restockedItems : undefined,
                items: invItems.map((i) => ({
                  itemName: i.itemName, itemSku: i.itemSku, baseUnit: i.baseUnit,
                  quantity: i.quantity, avgCost: i.avgCost, subtotal: i.quantity * i.avgCost,
                })),
              }),
              outletId: destOutletId,
              userId: user.id,
            },
          })

          // Audit log at source outlet
          await tx.auditLog.create({
            data: {
              action: 'ADJUSTMENT',
              entityType: 'STOCK',
              entityId: id,
              details: JSON.stringify({
                action: 'TRANSFER_RECEIVED_BY_BRANCH',
                itemType: 'INVENTORY',
                transferNumber: transfer.transferNumber,
                toOutlet: transfer.toOutlet.name,
                itemCount: invItems.length,
                totalQty,
                totalValue,
                items: invItems.map((i) => ({
                  itemName: i.itemName, itemSku: i.itemSku, baseUnit: i.baseUnit,
                  quantity: i.quantity, avgCost: i.avgCost, subtotal: i.quantity * i.avgCost,
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
            createdBy: { select: { id: true, name: true } },
            receivedBy: { select: { id: true, name: true } },
            inventoryTransferItems: {
              select: {
                id: true, inventoryItemId: true, itemName: true, itemSku: true,
                baseUnit: true, quantity: true, avgCost: true,
              },
            },
          },
        })

        const parts: string[] = []
        if (addedItems.length > 0) parts.push(`${addedItems.length} item baru ditambahkan`)
        if (restockedItems.length > 0) parts.push(`${restockedItems.length} item di-restock`)
        const detailMsg = parts.length > 0 ? ` (${parts.join(', ')})` : ''

        return safeJson({
          ...updated,
          message: `Transfer ${transfer.transferNumber} berhasil diterima${detailMsg}`,
          createdItems: addedItems,
          restockedItems,
        })
      }

      // ── PRODUCT: Products are created as new or restocked at the branch ──
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

            // Parse snapshot for variant info
            let snapshot: Record<string, unknown> | null = null
            try {
              snapshot = item.productSnapshot ? JSON.parse(item.productSnapshot) : null
            } catch { /* ignore */ }
            const variants = (snapshot?.variants && Array.isArray(snapshot.variants)) ? snapshot.variants as Array<{ name: string; sku?: string; barcode?: string; hpp?: number; price: number; stock: number }> : []

            // Sync variants — restock existing or create new ones
            const variantLog: Array<{ name: string; sku: string | null; previousStock: number; addedStock: number; newStock: number; created: boolean }> = []
            if (variants.length > 0) {
              await tx.product.update({ where: { id: product.id }, data: { hasVariants: true } })
              for (const v of variants) {
                const existingVar = await tx.productVariant.findFirst({
                  where: { productId: product.id, name: v.name, outletId: destOutletId },
                  select: { id: true, stock: true },
                })
                if (existingVar) {
                  const newVarStock = existingVar.stock + (v.stock || 0)
                  await tx.productVariant.update({ where: { id: existingVar.id }, data: { stock: newVarStock } })
                  variantLog.push({ name: v.name, sku: v.sku || null, previousStock: existingVar.stock, addedStock: v.stock || 0, newStock: newVarStock, created: false })
                } else {
                  await tx.productVariant.create({
                    data: { productId: product.id, name: v.name, sku: v.sku || null, barcode: v.barcode || null, hpp: v.hpp || 0, price: v.price, stock: v.stock || 0, outletId: destOutletId },
                  })
                  variantLog.push({ name: v.name, sku: v.sku || null, previousStock: 0, addedStock: v.stock || 0, newStock: v.stock || 0, created: true })
                }
              }
            }

            // Per-product audit log so it shows in product detail movement history
            const auditDetail: Record<string, unknown> = {
              action: 'TRANSFER_IN',
              transferNumber: transfer.transferNumber,
              fromOutlet: transfer.fromOutlet.name,
              productName: item.productName,
              productSku: item.productSku,
              quantityAdded: item.quantity,
              previousStock: product.stock,
              newStock,
              hpp: item.hpp,
              price: item.price,
              totalValue: item.quantity * item.hpp,
            }
            if (variantLog.length > 0) {
              auditDetail.hasVariants = true
              auditDetail.variants = variantLog
            }
            await tx.auditLog.create({
              data: {
                action: 'RESTOCK',
                entityType: 'STOCK',
                entityId: product.id,
                details: JSON.stringify(auditDetail),
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
                  price: item.price,
                  hpp: item.hpp || 0,
                  totalValue: item.quantity * (item.hpp || 0),
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

        // Build detailed audit items for summary logs
        const receivedTotalQty = transfer.items.reduce((s, i) => s + i.quantity, 0)
        const receivedTotalValue = transfer.items.reduce((s, i) => s + i.quantity * i.price, 0)
        const receivedAuditItems = transfer.items.map((i) => {
          const entry: Record<string, unknown> = {
            productName: i.productName, productSku: i.productSku, productBarcode: i.productBarcode,
            quantity: i.quantity, hpp: i.hpp, price: i.price, subtotal: i.quantity * i.price,
          }
          if (i.productSnapshot) {
            try {
              const snap = JSON.parse(i.productSnapshot)
              if (snap.hasVariants && Array.isArray(snap.variants) && snap.variants.length > 0) {
                entry.hasVariants = true
                entry.variants = snap.variants.map((v: { name: string; sku?: string; hpp?: number; price: number; stock: number }) => ({
                  name: v.name, sku: v.sku || null, price: v.price, hpp: v.hpp || 0, stock: v.stock,
                }))
              }
            } catch { /* ignore */ }
          }
          return entry
        })

        // Audit log at destination outlet (RECEIVED — detailed summary)
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
              totalQty: receivedTotalQty,
              totalValue: receivedTotalValue,
              createdProducts: createdProducts.length > 0 ? createdProducts : undefined,
              restockedProducts: restockedProducts.length > 0 ? restockedProducts : undefined,
              items: receivedAuditItems,
            }),
            outletId: destOutletId,
            userId: user.id,
          },
        })

        // Audit log at source outlet (confirmation that branch received — detailed)
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
              totalQty: receivedTotalQty,
              totalValue: receivedTotalValue,
              items: receivedAuditItems,
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

    // ── CANCELLED: Cancel transfer ──
    if (status === 'CANCELLED') {
      // ── IN_TRANSIT → CANCELLED: Return stock to source outlet ──
      if (transfer.status === 'IN_TRANSIT') {
        // ── INVENTORY: CANCELLED from IN_TRANSIT — return stock to source ──
        if (transfer.itemType === 'INVENTORY') {
        const invItems = transfer.inventoryTransferItems

        await db.$transaction(async (tx) => {
          for (const item of invItems) {
            const invItem = await tx.inventoryItem.findFirst({
              where: { id: item.inventoryItemId, outletId: transfer.fromOutletId },
              select: { id: true, name: true, stock: true },
            })
            if (invItem) {
              const prevStock = invItem.stock
              const newStock = invItem.stock + item.quantity
              await tx.inventoryItem.update({
                where: { id: invItem.id },
                data: { stock: newStock },
              })
              await tx.inventoryMovement.create({
                data: {
                  type: 'ADJUSTMENT',
                  quantity: item.quantity,
                  previousStock: prevStock,
                  newStock,
                  referenceId: id,
                  referenceType: 'TRANSFER',
                  notes: `Pembatalan transfer ke ${transfer.toOutlet.name} (${transfer.transferNumber}) — stok dikembalikan`,
                  outletId: transfer.fromOutletId,
                  inventoryItemId: invItem.id,
                  userId: user.id,
                },
              })
            }
          }

          // Update transfer status
          await tx.outletTransfer.update({
            where: { id },
            data: { status: 'CANCELLED' },
          })

          const totalQty = invItems.reduce((s, i) => s + i.quantity, 0)
          const totalValue = invItems.reduce((s, i) => s + i.quantity * i.avgCost, 0)

          // Audit log
          await tx.auditLog.create({
            data: {
              action: 'ADJUSTMENT',
              entityType: 'STOCK',
              entityId: id,
              details: JSON.stringify({
                action: 'TRANSFER_CANCELLED',
                itemType: 'INVENTORY',
                transferNumber: transfer.transferNumber,
                toOutlet: transfer.toOutlet.name,
                previousStatus: 'IN_TRANSIT',
                itemCount: invItems.length,
                totalQty,
                totalValue,
                stockReverted: true,
                items: invItems.map((i) => ({
                  itemName: i.itemName, itemSku: i.itemSku, baseUnit: i.baseUnit,
                  quantity: i.quantity, avgCost: i.avgCost, subtotal: i.quantity * i.avgCost,
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
            inventoryTransferItems: {
              select: {
                id: true, inventoryItemId: true, itemName: true, itemSku: true,
                baseUnit: true, quantity: true, avgCost: true,
              },
            },
          },
        })

        return safeJson({
          ...updated,
          message: `Transfer ${transfer.transferNumber} dibatalkan, stok item dikembalikan`,
        })
      }

      // ── PRODUCT: CANCELLED from IN_TRANSIT — return stock to source outlet ──
      if (transfer.itemType === 'PRODUCT') {
        const cancelProductItems = transfer.items
        const cancelAuditItems = buildAuditItems(cancelProductItems)
        const cancelTotalQty = cancelProductItems.reduce((s, i) => s + i.quantity, 0)
        const cancelTotalValue = cancelProductItems.reduce((s, i) => s + i.quantity * i.price, 0)

        await db.$transaction(async (tx) => {
          // Restore stock for each product at source outlet
          const productStockChanges: Array<{
            productId: string; productName: string; productSku: string | null
            quantity: number; previousStock: number; newStock: number
          }> = []
          const variantStockChanges: Array<{
            variantId: string; productId: string; productName: string; variantName: string
            quantity: number; previousStock: number; newStock: number
          }> = []

          for (const item of cancelProductItems) {
            // Find product at source outlet by SKU, barcode, or name
            let product: { id: string; name: string; stock: number; hasVariants: boolean; price: number; hpp: number } | null = null
            if (item.productSku) {
              product = await tx.product.findFirst({
                where: { outletId: transfer.fromOutletId, sku: item.productSku },
                select: { id: true, name: true, stock: true, hasVariants: true, price: true, hpp: true },
              })
            }
            if (!product && item.productBarcode) {
              product = await tx.product.findFirst({
                where: { outletId: transfer.fromOutletId, barcode: item.productBarcode },
                select: { id: true, name: true, stock: true, hasVariants: true, price: true, hpp: true },
              })
            }
            if (!product) {
              product = await tx.product.findFirst({
                where: { outletId: transfer.fromOutletId, name: item.productName },
                select: { id: true, name: true, stock: true, hasVariants: true, price: true, hpp: true },
              })
            }

            if (product) {
              // Parse snapshot for variant info
              let snapshot: Record<string, unknown> | null = null
              try { snapshot = item.productSnapshot ? JSON.parse(item.productSnapshot) : null } catch { /* ignore */ }
              const variants = (snapshot?.variants && Array.isArray(snapshot.variants)) ? snapshot.variants as Array<{ name: string; sku?: string; barcode?: string; hpp?: number; price: number; stock: number }> : []

              if (product.hasVariants && variants.length > 0) {
                // Restore per-variant stock
                for (const variant of variants) {
                  const existingVariant = await tx.productVariant.findFirst({
                    where: { productId: product.id, name: variant.name, outletId: transfer.fromOutletId },
                    select: { id: true, name: true, stock: true, price: true, hpp: true },
                  })
                  if (existingVariant) {
                    const prevStock = existingVariant.stock
                    const newVarStock = existingVariant.stock + variant.stock
                    await tx.productVariant.update({
                      where: { id: existingVariant.id },
                      data: { stock: newVarStock },
                    })
                    variantStockChanges.push({
                      variantId: existingVariant.id, productId: product.id,
                      productName: product.name, variantName: existingVariant.name,
                      quantity: variant.stock, previousStock: prevStock, newStock: newVarStock,
                    })
                  }
                }
                // Also restore parent product stock
                const prevParentStock = product.stock
                const newParentStock = product.stock + item.quantity
                await tx.product.update({ where: { id: product.id }, data: { stock: newParentStock } })
                productStockChanges.push({
                  productId: product.id, productName: product.name, productSku: item.productSku || null,
                  quantity: item.quantity, previousStock: prevParentStock, newStock: newParentStock,
                })
              } else {
                // Non-variant: simple stock restore
                const prevStock = product.stock
                const newStock = product.stock + item.quantity
                await tx.product.update({ where: { id: product.id }, data: { stock: newStock } })
                productStockChanges.push({
                  productId: product.id, productName: product.name, productSku: item.productSku || null,
                  quantity: item.quantity, previousStock: prevStock, newStock,
                })
              }
            }
          }

          // Update transfer status
          await tx.outletTransfer.update({ where: { id }, data: { status: 'CANCELLED' } })

          // Summary audit log at source outlet
          await tx.auditLog.create({
            data: {
              action: 'ADJUSTMENT',
              entityType: 'STOCK',
              entityId: id,
              details: JSON.stringify({
                action: 'TRANSFER_CANCELLED',
                itemType: 'PRODUCT',
                transferNumber: transfer.transferNumber,
                toOutlet: transfer.toOutlet.name,
                previousStatus: 'IN_TRANSIT',
                itemCount: cancelProductItems.length,
                totalQty: cancelTotalQty,
                totalValue: cancelTotalValue,
                stockReverted: true,
                items: cancelAuditItems,
              }),
              outletId: transfer.fromOutletId,
              userId: user.id,
            },
          })

          // Notification audit log at destination outlet
          await tx.auditLog.create({
            data: {
              action: 'ADJUSTMENT',
              entityType: 'STOCK',
              entityId: id,
              details: JSON.stringify({
                action: 'TRANSFER_CANCELLED_INCOMING',
                itemType: 'PRODUCT',
                transferNumber: transfer.transferNumber,
                fromOutlet: transfer.fromOutlet.name,
                itemCount: cancelProductItems.length,
                totalQty: cancelTotalQty,
              }),
              outletId: transfer.toOutletId,
              userId: user.id,
            },
          })

          // Per-product audit logs
          for (const change of productStockChanges) {
            await tx.auditLog.create({
              data: {
                action: 'RESTOCK',
                entityType: 'STOCK',
                entityId: change.productId,
                details: JSON.stringify({
                  action: 'TRANSFER_CANCEL_RESTOCK',
                  productName: change.productName,
                  productSku: change.productSku,
                  transferNumber: transfer.transferNumber,
                  toOutlet: transfer.toOutlet.name,
                  quantity: change.quantity,
                  previousStock: change.previousStock,
                  newStock: change.newStock,
                  reason: 'Pembatalan transfer dari IN_TRANSIT — stok dikembalikan',
                }),
                outletId: transfer.fromOutletId,
                userId: user.id,
              },
            })
          }

          // Per-variant audit logs
          for (const change of variantStockChanges) {
            await tx.auditLog.create({
              data: {
                action: 'RESTOCK',
                entityType: 'VARIANT',
                entityId: change.variantId,
                details: JSON.stringify({
                  action: 'TRANSFER_CANCEL_RESTOCK',
                  productName: change.productName,
                  variantName: change.variantName,
                  transferNumber: transfer.transferNumber,
                  toOutlet: transfer.toOutlet.name,
                  quantity: change.quantity,
                  previousStock: change.previousStock,
                  newStock: change.newStock,
                  reason: 'Pembatalan transfer dari IN_TRANSIT — stok dikembalikan',
                }),
                outletId: transfer.fromOutletId,
                userId: user.id,
              },
            })
          }
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
          message: `Transfer ${transfer.transferNumber} dibatalkan, stok produk dikembalikan`,
        })
      }
      } // end IN_TRANSIT cancels (INVENTORY + PRODUCT)

      // ── DRAFT → CANCELLED (both PRODUCT and INVENTORY) ──
      // Build detailed audit items with variant info
      const cancelAuditItems = transfer.items.map((i) => {
        const entry: Record<string, unknown> = {
          productName: i.productName, productSku: i.productSku, productBarcode: i.productBarcode,
          quantity: i.quantity, hpp: i.hpp, price: i.price, subtotal: i.quantity * i.price,
        }
        if (i.productSnapshot) {
          try {
            const snap = JSON.parse(i.productSnapshot)
            if (snap.hasVariants && Array.isArray(snap.variants) && snap.variants.length > 0) {
              entry.hasVariants = true
              entry.variants = snap.variants.map((v: { name: string; sku?: string; hpp?: number; price: number; stock: number }) => ({
                name: v.name, sku: v.sku || null, price: v.price, hpp: v.hpp || 0, stock: v.stock,
              }))
            }
          } catch { /* ignore */ }
        }
        return entry
      })
      const cancelTotalQty = transfer.items.reduce((s, i) => s + i.quantity, 0)
      const cancelTotalValue = transfer.items.reduce((s, i) => s + i.quantity * i.price, 0)

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
              totalQty: cancelTotalQty,
              totalValue: cancelTotalValue,
              items: cancelAuditItems,
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