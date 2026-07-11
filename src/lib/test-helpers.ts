/**
 * test-helpers.ts — Utility functions for AetherPOS business scenario tests.
 *
 * All test data uses "TEST-" prefix in names to avoid conflicts with real data.
 * Each helper creates data with a unique suffix using Date.now() + random.
 * Cleanup function deletes all test data by prefix.
 */

import { db } from '@/lib/db'
import { FEFOEngine } from '@/lib/fefo-engine'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

export interface TestContext {
  outletId: string
  userId: string
  outletGroupId?: string
}

export type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0]

// ════════════════════════════════════════════════════════════
// Unique Suffix Generator
// ════════════════════════════════════════════════════════════

let _suffixCounter = 0
function uniqueSuffix(): string {
  _suffixCounter++
  return `${Date.now()}-${_suffixCounter}`
}

// ════════════════════════════════════════════════════════════
// 1. getTestContext() — find or create outlet + OWNER user
// ════════════════════════════════════════════════════════════

export async function getTestContext(): Promise<TestContext> {
  const outlet = await db.outlet.findFirst({
    select: { id: true, groupId: true },
  })
  if (!outlet) {
    throw new Error('No outlet found in database. Seed data required.')
  }

  const user = await db.user.findFirst({
    where: { outletId: outlet.id, role: 'OWNER' },
    select: { id: true },
  })
  if (!user) {
    // Create a test OWNER user if none exists
    const suffix = uniqueSuffix()
    const createdUser = await db.user.create({
      data: {
        name: `TEST-Owner-${suffix}`,
        email: `test-owner-${suffix}@test.local`,
        password: 'test-password-hash',
        role: 'OWNER',
        outletId: outlet.id,
      },
      select: { id: true },
    })
    return { outletId: outlet.id, userId: createdUser.id, outletGroupId: outlet.groupId ?? undefined }
  }

  return { outletId: outlet.id, userId: user.id, outletGroupId: outlet.groupId ?? undefined }
}

// ════════════════════════════════════════════════════════════
// 2. createTestInventoryItem(outletId, overrides?)
// ════════════════════════════════════════════════════════════

export async function createTestInventoryItem(
  outletId: string,
  overrides?: {
    name?: string
    stock?: number
    avgCost?: number
    baseUnit?: string
    sku?: string
    categoryId?: string
    status?: string
  }
) {
  const suffix = uniqueSuffix()
  const item = await db.inventoryItem.create({
    data: {
      name: overrides?.name ?? `TEST-InventoryItem-${suffix}`,
      baseUnit: overrides?.baseUnit ?? 'kg',
      stock: overrides?.stock ?? 0,
      avgCost: overrides?.avgCost ?? 0,
      sku: overrides?.sku ?? null,
      categoryId: overrides?.categoryId ?? null,
      status: overrides?.status ?? 'ACTIVE',
      outletId,
    },
  })
  return item
}

// ════════════════════════════════════════════════════════════
// 3. createTestProduct(outletId, overrides?)
// ════════════════════════════════════════════════════════════

export async function createTestProduct(
  outletId: string,
  overrides?: {
    name?: string
    stock?: number
    price?: number
    hpp?: number
    categoryId?: string
    hasComposition?: boolean
  }
) {
  const suffix = uniqueSuffix()
  const product = await db.product.create({
    data: {
      name: overrides?.name ?? `TEST-Product-${suffix}`,
      price: overrides?.price ?? 10000,
      hpp: overrides?.hpp ?? 5000,
      stock: overrides?.stock ?? 0,
      outletId,
      categoryId: overrides?.categoryId ?? null,
      hasComposition: overrides?.hasComposition ?? false,
    },
  })
  return product
}

// ════════════════════════════════════════════════════════════
// 4. createTestCategory(outletId)
// ════════════════════════════════════════════════════════════

export async function createTestCategory(outletId: string, overrides?: { name?: string; color?: string }) {
  const suffix = uniqueSuffix()
  const category = await db.category.create({
    data: {
      name: overrides?.name ?? `TEST-Category-${suffix}`,
      color: overrides?.color ?? 'emerald',
      outletId,
    },
  })
  return category
}

// ════════════════════════════════════════════════════════════
// 5. createTestSupplier(outletId)
// ════════════════════════════════════════════════════════════

export async function createTestSupplier(outletId: string, overrides?: { name?: string }) {
  const suffix = uniqueSuffix()
  const supplier = await db.supplier.create({
    data: {
      name: overrides?.name ?? `TEST-Supplier-${suffix}`,
      phone: `081234567${suffix.slice(-4)}`,
      address: 'TEST Address',
      outletId,
    },
  })
  return supplier
}

// ════════════════════════════════════════════════════════════
// 6. createTestCustomer(outletId, overrides?)
// ════════════════════════════════════════════════════════════

export async function createTestCustomer(
  outletId: string,
  overrides?: { name?: string; whatsapp?: string }
) {
  const suffix = uniqueSuffix()
  const customer = await db.customer.create({
    data: {
      name: overrides?.name ?? `TEST-Customer-${suffix}`,
      whatsapp: overrides?.whatsapp ?? `6281234567${suffix.slice(-4)}`,
      outletId,
    },
  })
  return customer
}

// ════════════════════════════════════════════════════════════
// 7. createTestPurchaseOrder(outletId, userId, items)
// ════════════════════════════════════════════════════════════

export async function createTestPurchaseOrder(
  outletId: string,
  userId: string,
  items: Array<{
    inventoryItemId: string
    purchaseQty: number
    purchaseUnit: string
    baseQty: number
    baseUnit: string
    unitCost: number
    batch?: string | null
    expiredDate?: Date | null
  }>,
  overrides?: { supplierId?: string; notes?: string }
) {
  // Generate order number
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const todayStart = new Date(yyyy, now.getMonth(), now.getDate())
  const count = await db.purchaseOrder.count({
    where: { outletId, createdAt: { gte: todayStart } },
  })
  const orderNumber = `PO-${yyyy}${mm}${dd}-${String(count + 1).padStart(4, '0')}`

  // Fetch inventory items for names
  const itemIds = items.map(i => i.inventoryItemId)
  const inventoryItems = await db.inventoryItem.findMany({
    where: { id: { in: itemIds }, outletId },
  })

  // Calculate total cost
  const totalCost = items.reduce((sum, item) => sum + item.baseQty * item.unitCost, 0)

  const result = await db.$transaction(async (tx) => {
    // Create purchase order with items
    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId: overrides?.supplierId ?? null,
        totalCost,
        notes: overrides?.notes ?? null,
        outletId,
        userId,
        items: {
          create: items.map(item => {
            const invItem = inventoryItems.find(ii => ii.id === item.inventoryItemId)!
            return {
              inventoryItemId: item.inventoryItemId,
              name: invItem.name,
              purchaseQty: item.purchaseQty,
              purchaseUnit: item.purchaseUnit,
              baseQty: item.baseQty,
              baseUnit: item.baseUnit,
              unitCost: item.unitCost,
              totalCost: item.baseQty * item.unitCost,
              batch: item.batch?.trim() || null,
              expiredDate: item.expiredDate ?? null,
              outletId,
            }
          }),
        },
      },
      include: { items: true },
    })

    // Update inventory items: weighted average cost and stock
    // NOTE: Read from DB inside loop to handle duplicate inventoryItemId in same PO
    const affectedInventoryItemIds: string[] = []
    for (const item of items) {
      // Read current stock from DB (not pre-fetched) to handle duplicate items correctly
      const freshItem = await tx.inventoryItem.findUnique({
        where: { id: item.inventoryItemId },
        select: { stock: true, avgCost: true, name: true },
      })
      if (!freshItem) continue

      const existingStock = freshItem.stock
      const existingAvgCost = freshItem.avgCost
      const invItemName = freshItem.name
      const baseQty = item.baseQty
      const unitCost = item.unitCost

      const newStock = existingStock + baseQty
      let newAvgCost = 0
      if (newStock > 0) {
        newAvgCost = (existingStock * existingAvgCost + baseQty * unitCost) / newStock
      }

      await tx.inventoryItem.update({
        where: { id: item.inventoryItemId },
        data: { stock: newStock, avgCost: newAvgCost },
      })

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'PURCHASE',
          entityType: 'INVENTORY_ITEM',
          entityId: item.inventoryItemId,
          details: JSON.stringify({
            itemName: invItemName,
            purchaseOrderNumber: orderNumber,
            baseQtyAdded: baseQty,
            unitCost,
            previousStock: existingStock,
            newStock,
            previousAvgCost: existingAvgCost,
            newAvgCost,
            batch: item.batch?.trim() || null,
            expiredDate: item.expiredDate?.toISOString() ?? null,
          }),
          outletId,
          userId,
        },
      })

      // Inventory movement
      await tx.inventoryMovement.create({
        data: {
          type: 'PURCHASE',
          inventoryItemId: item.inventoryItemId,
          quantity: baseQty,
          previousStock: existingStock,
          newStock,
          referenceId: purchaseOrder.id,
          referenceType: 'PURCHASE_ORDER',
          notes: `Pembelian: ${invItemName} (${orderNumber})`,
          outletId,
          userId,
        },
      })

      affectedInventoryItemIds.push(item.inventoryItemId)
    }

    // Create InventoryBatch records
    await FEFOEngine.createBatchesFromPurchase(tx, {
      purchaseOrderId: purchaseOrder.id,
      items: items.map(item => ({
        inventoryItemId: item.inventoryItemId,
        name: inventoryItems.find(ii => ii.id === item.inventoryItemId)!.name,
        baseQty: item.baseQty,
        unitCost: item.unitCost,
        batch: item.batch?.trim() || null,
        expiredDate: item.expiredDate ?? null,
      })),
      outletId,
      supplierId: overrides?.supplierId ?? null,
      supplierName: null,
    })

    return purchaseOrder
  }, { timeout: 30000 })

  return result
}

// ════════════════════════════════════════════════════════════
// 8. createTestTransaction(outletId, userId, productItems)
//    Creates a complete checkout transaction directly in DB
// ════════════════════════════════════════════════════════════

export async function createTestTransaction(
  outletId: string,
  userId: string,
  productItems: Array<{
    productId: string
    qty: number
  }>,
  overrides?: { customerId?: string }
) {
  // Fetch product data
  const productIds = productItems.map(p => p.productId)
  const products = await db.product.findMany({
    where: { id: { in: productIds }, outletId },
  })

  // Generate invoice number
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const random = String(Math.floor(Math.random() * 100000)).padStart(5, '0')
  const invoiceNumber = `INV-${yyyy}${mm}${dd}-${random}`

  // Calculate totals
  let subtotal = 0
  let totalHpp = 0
  const itemData: Array<{
    productId: string
    productName: string
    productSku: string | null
    variantId: string | null
    variantName: string | null
    variantSku: string | null
    price: number
    qty: number
    subtotal: number
    itemDiscount: number
    hpp: number
  }> = []

  for (const pi of productItems) {
    const product = products.find(p => p.id === pi.productId)!
    const itemSubtotal = product.price * pi.qty
    subtotal += itemSubtotal
    totalHpp += product.hpp * pi.qty
    itemData.push({
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      variantId: null,
      variantName: null,
      variantSku: null,
      price: product.price,
      qty: pi.qty,
      subtotal: itemSubtotal,
      itemDiscount: 0,
      hpp: product.hpp,
    })
  }

  const total = subtotal

  const result = await db.$transaction(async (tx) => {
    // Create transaction
    const transaction = await tx.transaction.create({
      data: {
        invoiceNumber,
        subtotal,
        discount: 0,
        pointsUsed: 0,
        taxAmount: 0,
        total,
        paymentMethod: 'CASH',
        paidAmount: total,
        change: 0,
        outletId,
        customerId: overrides?.customerId ?? null,
        userId,
      },
    })

    // Create transaction items
    await tx.transactionItem.createMany({
      data: itemData.map(item => ({
        ...item,
        transactionId: transaction.id,
      })),
    })

    // Atomic stock deduction
    for (const pi of productItems) {
      const affected = await tx.$executeRaw`
        UPDATE "Product" SET stock = stock - ${pi.qty}
        WHERE id = ${pi.productId} AND stock >= ${pi.qty} AND "outletId" = ${outletId}
      `
      if (affected === 0) {
        throw new Error(`Insufficient stock for product ${pi.productId}`)
      }
    }

    // Re-read updated stock for audit logs
    const updatedProducts = await tx.product.findMany({
      where: { id: { in: productIds }, outletId },
      select: { id: true, stock: true },
    })
    const updatedStockMap = new Map(updatedProducts.map(p => [p.id, p.stock]))

    // Create audit logs
    await tx.auditLog.createMany({
      data: itemData.map(item => {
        const newStock = updatedStockMap.get(item.productId) ?? 0
        const previousStock = newStock + item.qty
        return {
          action: 'SALE' as const,
          entityType: 'PRODUCT' as const,
          entityId: item.productId,
          details: JSON.stringify({
            invoiceNumber,
            productName: item.productName,
            productSku: item.productSku,
            quantitySold: item.qty,
            price: item.price,
            subtotal: item.subtotal,
            previousStock,
            newStock,
          }),
          outletId,
          userId,
        }
      }),
    })

    return transaction
  }, { timeout: 15000 })

  return result
}

// ════════════════════════════════════════════════════════════
// 9. createTestOutlet(groupId)
// ════════════════════════════════════════════════════════════

export async function createTestOutlet(groupId: string, overrides?: { name?: string }) {
  const suffix = uniqueSuffix()
  const outlet = await db.outlet.create({
    data: {
      name: overrides?.name ?? `TEST-Outlet-${suffix}`,
      groupId,
      isMain: false,
    },
  })

  // Create OutletSetting for the new outlet
  await db.outletSetting.create({
    data: { outletId: outlet.id },
  })

  return outlet
}

// ════════════════════════════════════════════════════════════
// 10. createTestUser(outletId, role?)
// ════════════════════════════════════════════════════════════

export async function createTestUser(outletId: string, role?: string) {
  const suffix = uniqueSuffix()
  const user = await db.user.create({
    data: {
      name: `TEST-User-${suffix}`,
      email: `test-user-${suffix}@test.local`,
      password: 'test-password-hash',
      role: role ?? 'CREW',
      outletId,
    },
  })
  return user
}

// ════════════════════════════════════════════════════════════
// 11. createTestInventoryCategory(outletId)
// ════════════════════════════════════════════════════════════

export async function createTestInventoryCategory(outletId: string, overrides?: { name?: string }) {
  const suffix = uniqueSuffix()
  const category = await db.inventoryCategory.create({
    data: {
      name: overrides?.name ?? `TEST-InvCategory-${suffix}`,
      color: 'amber',
      outletId,
    },
  })
  return category
}

// ════════════════════════════════════════════════════════════
// 12. cleanupTestData(outletId)
//    Deletes all test data (items with "TEST-" prefix in name)
// ════════════════════════════════════════════════════════════

export async function cleanupTestData(outletId: string): Promise<void> {
  const TEST_PREFIX = 'TEST-'

  // Find all test entities first (for cascade cleanup ordering)
  try {
    // Clean test transactions (cascade deletes items, loyalty logs, consumption snapshots, batch consumption logs)
    const testTransactions = await db.transaction.findMany({
      where: {
        outletId,
        invoiceNumber: { startsWith: 'INV-' },
        items: { some: { productName: { startsWith: TEST_PREFIX } } },
      },
      select: { id: true },
    })
    if (testTransactions.length > 0) {
      await db.transaction.deleteMany({
        where: { id: { in: testTransactions.map(t => t.id) } },
      })
    }

    // Also clean transactions created with test customer IDs (may not have TEST- product names)
    const testTransactions2 = await db.transaction.findMany({
      where: {
        outletId,
        customer: { name: { startsWith: TEST_PREFIX } },
      },
      select: { id: true },
    })
    if (testTransactions2.length > 0) {
      await db.transaction.deleteMany({
        where: { id: { in: testTransactions2.map(t => t.id) } },
      })
    }
  } catch {
    // Ignore cleanup errors
  }

  try {
    // Clean test purchase orders (cascade deletes items, batches)
    const testPOs = await db.purchaseOrder.findMany({
      where: {
        outletId,
        items: { some: { name: { startsWith: TEST_PREFIX } } },
      },
      select: { id: true },
    })
    if (testPOs.length > 0) {
      // Delete batches first (they reference the PO)
      await db.inventoryBatch.deleteMany({
        where: { purchaseOrderId: { in: testPOs.map(po => po.id) }, outletId },
      })
      // Delete movements referencing these POs
      await db.inventoryMovement.deleteMany({
        where: { referenceId: { in: testPOs.map(po => po.id) }, referenceType: 'PURCHASE_ORDER', outletId },
      })
      await db.purchaseOrder.deleteMany({
        where: { id: { in: testPOs.map(po => po.id) } },
      })
    }
  } catch {
    // Ignore
  }

  try {
    // Clean test transfers
    const testTransfers = await db.outletTransfer.findMany({
      where: {
        outletId,
        items: { some: { productName: { startsWith: TEST_PREFIX } } },
      },
      select: { id: true },
    })
    if (testTransfers.length > 0) {
      await db.outletTransfer.deleteMany({
        where: { id: { in: testTransfers.map(t => t.id) } },
      })
    }
    // Also clean inventory transfers
    const testInvTransfers = await db.outletTransfer.findMany({
      where: {
        outletId,
        inventoryTransferItems: { some: { itemName: { startsWith: TEST_PREFIX } } },
      },
      select: { id: true },
    })
    if (testInvTransfers.length > 0) {
      await db.outletTransfer.deleteMany({
        where: { id: { in: testInvTransfers.map(t => t.id) } },
      })
    }
  } catch {
    // Ignore
  }

  try {
    // Clean test products (cascade deletes compositions, variants)
    await db.product.deleteMany({
      where: { outletId, name: { startsWith: TEST_PREFIX } },
    })
  } catch {
    // Ignore
  }

  try {
    // Clean test inventory items (cascade deletes compositions, movements, batches, etc.)
    await db.inventoryItem.deleteMany({
      where: { outletId, name: { startsWith: TEST_PREFIX } },
    })
  } catch {
    // Ignore
  }

  try {
    // Clean test customers (cascade deletes loyalty logs, but transactions are kept)
    const testCustomers = await db.customer.findMany({
      where: { outletId, name: { startsWith: TEST_PREFIX } },
      select: { id: true },
    })
    if (testCustomers.length > 0) {
      // Nullify transaction references first
      await db.transaction.updateMany({
        where: { customerId: { in: testCustomers.map(c => c.id) } },
        data: { customerId: null },
      })
      await db.customer.deleteMany({
        where: { id: { in: testCustomers.map(c => c.id) } },
      })
    }
  } catch {
    // Ignore
  }

  try {
    // Clean test categories
    await db.category.deleteMany({
      where: { outletId, name: { startsWith: TEST_PREFIX } },
    })
    await db.inventoryCategory.deleteMany({
      where: { outletId, name: { startsWith: TEST_PREFIX } },
    })
  } catch {
    // Ignore
  }

  try {
    // Clean test suppliers
    await db.supplier.deleteMany({
      where: { outletId, name: { startsWith: TEST_PREFIX } },
    })
  } catch {
    // Ignore
  }

  try {
    // Clean test users
    await db.user.deleteMany({
      where: { outletId, name: { startsWith: TEST_PREFIX } },
    })
  } catch {
    // Ignore
  }

  try {
    // Clean test outlets (only ones with TEST- prefix)
    const testOutlets = await db.outlet.findMany({
      where: { name: { startsWith: TEST_PREFIX } },
      select: { id: true },
    })
    if (testOutlets.length > 0) {
      await db.outlet.deleteMany({
        where: { id: { in: testOutlets.map(o => o.id) } },
      })
    }
  } catch {
    // Ignore
  }
}

// ════════════════════════════════════════════════════════════
// Helper: Generate invoice number (same logic as api-helpers)
// ════════════════════════════════════════════════════════════

export function generateTestInvoiceNumber(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const random = String(Math.floor(Math.random() * 100000)).padStart(5, '0')
  return `INV-${yyyy}${mm}${dd}-${random}`
}

// ════════════════════════════════════════════════════════════
// Helper: Generate PO number (same logic as purchases route)
// ════════════════════════════════════════════════════════════

export async function generateTestPONumber(outletId: string): Promise<string> {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const todayStart = new Date(yyyy, now.getMonth(), now.getDate())
  const count = await db.purchaseOrder.count({
    where: { outletId, createdAt: { gte: todayStart } },
  })
  return `PO-${yyyy}${mm}${dd}-${String(count + 1).padStart(4, '0')}`
}