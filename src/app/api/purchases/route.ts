import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { parsePagination } from '@/lib/api/api-helpers'
import { safeJson, safeJsonCreated, safeJsonError, CACHE } from '@/lib/api/safe-response'

// Helper: recalculate HPP for products that use these inventory items
async function recalculateHppForAffectedProducts(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  inventoryItemIds: string[]
) {
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

  const productHppMap = new Map<string, number>()
  const variantHppMap = new Map<string, number>()
  const variantProductIds = new Set<string>()

  for (const c of compositions) {
    const comp = c as typeof c & { yieldPerBatch?: number }
    const yieldPerBatch = comp.yieldPerBatch || 1
    const cost = comp.qty * comp.inventoryItem.avgCost

    if (c.variantId && c.product.hasVariants) {
      const existing = variantHppMap.get(c.variantId) || 0
      variantHppMap.set(c.variantId, existing + cost)
      variantProductIds.add(c.productId)
    } else if (!c.product.hasVariants) {
      const existing = productHppMap.get(c.productId) || 0
      productHppMap.set(c.productId, existing + cost)
    }
  }

  // Update products (simple loop — composition count is small)
  for (const [productId, hpp] of productHppMap) {
    await tx.product.update({ where: { id: productId }, data: { hpp } })
  }
  // Set hpp=0 for variant products
  for (const productId of variantProductIds) {
    if (!productHppMap.has(productId)) {
      await tx.product.update({ where: { id: productId }, data: { hpp: 0 } })
    }
  }
  // Update variants
  for (const [variantId, hpp] of variantHppMap) {
    await tx.productVariant.update({ where: { id: variantId }, data: { hpp } })
  }
}

// GET /api/purchases — list purchase orders with pagination
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const { searchParams } = request.nextUrl
    const { page, limit, skip } = parsePagination(searchParams, { limit: 20 })
    const search = searchParams.get('search') || ''
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') || 'desc'
    const allowedSort = ['createdAt', 'totalCost', 'orderNumber'] as const
    const validSort = allowedSort.includes(sortBy as typeof allowedSort[number]) ? sortBy : 'createdAt'
    const validOrder = sortOrder === 'asc' ? 'asc' as const : 'desc' as const

    const where: Record<string, unknown> = { outletId: user.outletId }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { supplier: { name: { contains: search } } },
        { notes: { contains: search } },
        { items: { some: { inventoryItem: { name: { contains: search } } } } },
        { items: { some: { inventoryItem: { sku: { contains: search } } } } },
        { createdBy: { name: { contains: search } } },
      ]
    }

    const [orders, total, linkedPoItems, usageCheckItems, transferLinkedPoItems, transactionLinkedPoItems] = await Promise.all([
      db.purchaseOrder.findMany({
        where,
        orderBy: { [validSort]: validOrder },
        skip,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          totalCost: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          supplier: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: { id: true, name: true },
          },
          items: {
            select: {
              id: true,
              inventoryItemId: true,
              baseQty: true,
              batch: true,
              expiredDate: true,
            },
          },
        },
      }),
      db.purchaseOrder.count({ where }),
      // Check 1: PO items linked to products (compositions)
      db.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: { outletId: user.outletId },
          inventoryItem: { compositions: { some: {} } },
        },
        select: { purchaseOrderId: true },
        distinct: ['purchaseOrderId'],
      }),
      // Check 2: PO items with usage history (stock < purchased qty)
      db.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: { outletId: user.outletId },
          inventoryItem: { stock: { lt: 0 } },  // Will filter in code below
        },
        select: { 
          purchaseOrderId: true,
          inventoryItemId: true,
          baseQty: true,
        },
      }),
      // Check 3: PO items linked to TRANSFERS
      db.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: { outletId: user.outletId },
          inventoryItem: { inventoryTransferItems: { some: {} } },
        },
        select: { purchaseOrderId: true },
        distinct: ['purchaseOrderId'],
      }),
      // Check 4: PO items linked to TRANSAKSI/PENJUALAN (POS)
      db.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: { outletId: user.outletId },
          inventoryItem: { consumptionSnapshots: { some: {} } },
        },
        select: { purchaseOrderId: true },
        distinct: ['purchaseOrderId'],
      }),
    ])

    // Combine all "linked" flags
    const productLinkedPoIds = new Set(linkedPoItems.map(p => p.purchaseOrderId))
    const transferLinkedPoIds = new Set(transferLinkedPoItems.map(p => p.purchaseOrderId))
    const transactionLinkedPoIds = new Set(transactionLinkedPoItems.map(p => p.purchaseOrderId))
    
    // hasLinkedItems = linked to products OR transfers OR transactions
    const hasLinkedItems = new Set<string>()
    for (const id of [...productLinkedPoIds, ...transferLinkedPoIds, ...transactionLinkedPoIds]) {
      hasLinkedItems.add(id)
    }
    
    // Build a map of PO ID -> array of {inventoryItemId, baseQty}
    // Then check each item's current stock to determine if PO has usage
    const poItemMap = new Map<string, Array<{inventoryItemId: string; baseQty: number}>>() 
    for (const item of usageCheckItems) {
      const existing = poItemMap.get(item.purchaseOrderId) || []
      existing.push({ inventoryItemId: item.inventoryItemId, baseQty: item.baseQty })
      poItemMap.set(item.purchaseOrderId, existing)
    }
    
    // Get all unique inventory item IDs from the usage check items
    const invItemIdsToCheck = [...new Set(usageCheckItems.map(i => i.inventoryItemId))]
    const currentStocks = new Map<string, number>()
    if (invItemIdsToCheck.length > 0) {
      const invItems = await db.inventoryItem.findMany({
        where: { id: { in: invItemIdsToCheck }, outletId: user.outletId },
        select: { id: true, stock: true },
      })
      for (const inv of invItems) {
        currentStocks.set(inv.id, inv.stock)
      }
    }
    
    // Determine which POs have usage history (cannot be safely deleted)
    const poWithUsageHistory = new Set<string>()
    for (const [poId, items] of poItemMap) {
      for (const item of items) {
        const currentStock = currentStocks.get(item.inventoryItemId) ?? 0
        // If current stock is less than what was added by this PO,
        // it means some quantity has been used/sold
        if (currentStock < item.baseQty) {
          poWithUsageHistory.add(poId)
          break
        }
      }
    }

    const mappedOrders = orders.map((o) => {
      const itemsWithBatch = o.items.filter(i => i.batch).length
      const itemsWithExp = o.items.filter(i => i.expiredDate).length
      const expiredItems = o.items.filter(i => i.expiredDate && new Date(i.expiredDate) < new Date()).length
      const sampleBatch = o.items.find(i => i.batch)?.batch || null
      const nearestExp = o.items
        .filter(i => i.expiredDate)
        .sort((a, b) => new Date(a.expiredDate!).getTime() - new Date(b.expiredDate!).getTime())[0]?.expiredDate || null

      // Granular flags for edit/delete control
      const hasProductLinks = productLinkedPoIds.has(o.id) && !transferLinkedPoIds.has(o.id) && !transactionLinkedPoIds.has(o.id)
      const hasTransferLinks = transferLinkedPoIds.has(o.id)
      const hasTransactionLinks = transactionLinkedPoIds.has(o.id)
      // hasRealBusinessHistory = blocks both edit and delete (transfers or sales)
      const hasRealBusinessHistory = hasTransferLinks || hasTransactionLinks

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        totalCost: o.totalCost,
        notes: o.notes,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        supplierName: o.supplier?.name || null,
        createdByName: o.createdBy.name,
        itemCount: o.items.length,
        // Legacy flag for backward compatibility
        hasLinkedItems: hasLinkedItems.has(o.id),
        hasUsageHistory: poWithUsageHistory.has(o.id),
        // New granular flags for precise control
        hasProductLinks,
        hasTransferLinks,
        hasTransactionLinks,
        hasRealBusinessHistory,
        _batchSummary: {
          itemsWithBatch,
          itemsWithExp,
          expiredItems,
          sampleBatch,
          nearestExp,
        },
      }
    })

    return safeJson(
      { orders: mappedOrders, totalPages: Math.ceil(total / limit) },
      200,
      CACHE.MEDIUM
    )
  } catch (error) {
    console.error('Purchases GET error:', error)
    return safeJsonError('Failed to load purchase orders')
  }
}

// POST /api/purchases — create purchase order
//
// Supports two modes:
//   1. Normal: { supplierId, notes, items: [{ inventoryItemId, ... }] }
//   2. Import: { supplierId, notes, items: [{ inventoryItemId, ... }], newItems: [{ key, name, ... }] }
//
// Import mode creates new inventory items inline, then creates the PO.
// Everything critical is in ONE transaction. Non-critical (audit, HPP) runs after.
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const userId = user.id
    const outletId = user.outletId

    const body = await request.json()
    const supplierId = body.supplierId as string | undefined
    const notes = body.notes as string | undefined
    const newItems = body.newItems as Array<{
      key: string; name: string; sku?: string | null; baseUnit: string
      purchaseQty: number; purchaseUnit: string; baseQty: number
      unitCost: number; totalCost: number; batch?: string | null; expiredDate?: string | null
    }> | undefined
    let items = body.items as Array<{
      inventoryItemId: string; purchaseQty: number; purchaseUnit: string
      baseQty: number; baseUnit: string; unitCost: number; totalCost: number
      batch?: string | null; expiredDate?: string | null
    }> | undefined

    if (!items || !Array.isArray(items) || items.length === 0) {
      // Allow empty `items` if `newItems` is provided (import-only mode)
      if (!newItems || newItems.length === 0) {
        return safeJsonError('Purchase order must have at least 1 item', 400)
      }
    }

    // ── Validate supplier & capture name ──
    let supplierName: string | null = null
    if (supplierId) {
      const supplier = await db.supplier.findFirst({
        where: { id: supplierId, outletId },
        select: { name: true },
      })
      if (!supplier) return safeJsonError('Supplier not found', 400)
      supplierName = supplier.name
    }

    // ── Create new inventory items if provided (Excel import) ──
    // Returns map: key → real inventoryItemId
    let newItemIdMap: Record<string, string> = {}

    if (newItems && newItems.length > 0) {
      // Deduplicate by name within batch
      const seenNames = new Map<string, string>() // lowercase name → first key
      const deduped: typeof newItems = []
      const dupKeyMap = new Map<string, string>() // dup key → first key

      for (const item of newItems) {
        if (!item.name?.trim()) continue
        const nameLower = item.name.trim().toLowerCase()
        if (seenNames.has(nameLower)) {
          dupKeyMap.set(item.key, seenNames.get(nameLower)!)
        } else {
          seenNames.set(nameLower, item.key)
          deduped.push(item)
        }
      }

      // Check which names already exist in DB (1 query)
      const uniqueNames = [...new Set(deduped.map(i => i.name.trim()))]
      const existing = await db.inventoryItem.findMany({
        where: { outletId, name: { in: uniqueNames } },
        select: { name: true, id: true },
      })
      const existingByName = new Map(existing.map(e => [e.name.toLowerCase(), e.id]))

      // Separate: existing vs truly new
      const toCreate: Array<{ name: string; sku: string | null; baseUnit: string }> = []
      for (const item of deduped) {
        const nameLower = item.name.trim().toLowerCase()
        const existingId = existingByName.get(nameLower)
        if (existingId) {
          newItemIdMap[item.key] = existingId
        } else {
          toCreate.push({
            name: item.name.trim(),
            sku: item.sku?.trim() || null,
            baseUnit: item.baseUnit.trim(),
          })
        }
      }

      // Create truly new items (createMany + fetch-back by name)
      if (toCreate.length > 0) {
        const CHUNK = 100
        for (let i = 0; i < toCreate.length; i += CHUNK) {
          await db.inventoryItem.createMany({
            data: toCreate.slice(i, i + CHUNK).map(item => ({
              name: item.name,
              sku: item.sku,
              baseUnit: item.baseUnit,
              stock: 0,
              avgCost: 0,
              lowStockAlert: 0,
              outletId,
              categoryId: null,
            })),
          })
        }

        // Fetch-back by name (reliable — names are unique per outlet)
        const created = await db.inventoryItem.findMany({
          where: { outletId, name: { in: toCreate.map(i => i.name) } },
          select: { id: true, name: true },
        })
        const createdByName = new Map(created.map(c => [c.name.toLowerCase(), c.id]))

        for (const item of deduped) {
          if (newItemIdMap[item.key]) continue
          const id = createdByName.get(item.name.trim().toLowerCase())
          if (id) newItemIdMap[item.key] = id
        }
      }

      // Map duplicates to first occurrence's ID
      for (const [dupKey, firstKey] of dupKeyMap) {
        if (newItemIdMap[firstKey]) {
          newItemIdMap[dupKey] = newItemIdMap[firstKey]
        }
      }

      // Convert newItems into purchase items with real IDs
      const newPurchaseItems = newItems
        .filter(ni => newItemIdMap[ni.key])
        .map(ni => ({
          inventoryItemId: newItemIdMap[ni.key],
          purchaseQty: ni.purchaseQty,
          purchaseUnit: ni.purchaseUnit || '',
          baseQty: ni.baseQty || 1,
          baseUnit: ni.baseUnit || 'pcs',
          unitCost: ni.unitCost,
          totalCost: ni.totalCost,
          batch: ni.batch?.trim() || null,
          expiredDate: ni.expiredDate || null,
        }))

      // Merge into items
      items = [...(items || []), ...newPurchaseItems]
      console.log(`[Purchase Import] ${toCreate.length} created, ${existing.length} matched, ${dupKeyMap.size} dups → ${newPurchaseItems.length} purchase items`)
    }

    // ── Validate each item ──
    if (!items || items.length === 0) {
      return safeJsonError('Tidak ada item valid untuk pembelian', 400)
    }

    const normalizedItems = items.map(item => ({
      ...item,
      baseQty: item.baseQty || 1,
    }))

    for (const item of normalizedItems) {
      if (!item.inventoryItemId) {
        return safeJsonError('Setiap item harus memiliki inventoryItemId', 400)
      }
      if (!item.purchaseQty || item.purchaseQty <= 0) {
        return safeJsonError('Jumlah pembelian harus lebih dari 0', 400)
      }
      if (item.unitCost === undefined || item.unitCost < 0) {
        return safeJsonError('Harga satuan tidak boleh negatif', 400)
      }
      if (!item.totalCost || item.totalCost <= 0) {
        return safeJsonError('Total biaya item harus lebih dari 0', 400)
      }
    }

    // ── Validate all inventory item IDs (deduplicated for Excel rows with same item) ──
    const itemIds = normalizedItems.map(i => i.inventoryItemId)
    const uniqueItemIds = [...new Set(itemIds)]
    const inventoryItems = await db.inventoryItem.findMany({
      where: { id: { in: uniqueItemIds }, outletId },
    })
    if (inventoryItems.length !== uniqueItemIds.length) {
      const found = new Set(inventoryItems.map(ii => ii.id))
      const missing = uniqueItemIds.filter(id => !found.has(id))
      console.error('[Purchase] Items not found:', missing)
      return safeJsonError('One or more inventory items not found', 400)
    }
    const invItemMap = new Map(inventoryItems.map(ii => [ii.id, ii]))

    // ── Generate order number ──
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const todayStart = new Date(yyyy, now.getMonth(), now.getDate())
    const count = await db.purchaseOrder.count({
      where: { outletId, createdAt: { gte: todayStart } },
    })
    const orderNumber = `PO-${yyyy}${mm}${dd}-${String(Math.min(count + 1, 9999)).padStart(4, '0')}`

    const totalCost = normalizedItems.reduce((sum, item) => sum + (item.totalCost || 0), 0)

    // ── Pre-calculate all stock updates (pure math, O(N)) ──
    type StockUpdate = {
      inventoryItemId: string; newStock: number; newAvgCost: number
      existingStock: number; name: string; baseQty: number
      unitCost: number; existingAvgCost: number
      batch: string | null; expiredDate: string | null
    }

    const rawUpdates: StockUpdate[] = normalizedItems.map(item => {
      const invItem = invItemMap.get(item.inventoryItemId)!
      const existingStock = invItem.stock
      const existingAvgCost = invItem.avgCost
      const baseQty = item.baseQty
      const unitCost = item.unitCost
      const newStock = existingStock + baseQty
      const newAvgCost = newStock > 0
        ? (existingStock * existingAvgCost + baseQty * unitCost) / newStock
        : 0
      return {
        inventoryItemId: item.inventoryItemId, newStock, newAvgCost,
        existingStock, name: invItem.name, baseQty, unitCost, existingAvgCost,
        batch: item.batch?.trim() || null,
        expiredDate: item.expiredDate || null,
      }
    })

    // Merge duplicate inventoryItemId updates
    const updateMap = new Map<string, StockUpdate>()
    for (const u of rawUpdates) {
      const existing = updateMap.get(u.inventoryItemId)
      if (existing) {
        const mergedStock = existing.existingStock + u.baseQty
        updateMap.set(u.inventoryItemId, {
          ...u,
          newStock: mergedStock,
          newAvgCost: mergedStock > 0
            ? (existing.existingStock * existing.existingAvgCost + u.baseQty * u.unitCost) / mergedStock
            : 0,
          existingStock: existing.existingStock,
          existingAvgCost: existing.existingAvgCost,
        })
      } else {
        updateMap.set(u.inventoryItemId, u)
      }
    }

    // ── Pre-build batch data ──
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '')
    const needsAutoBatch = rawUpdates.some(u => !u.batch)
    let autoBatchCounter = 0
    if (needsAutoBatch) {
      autoBatchCounter = await db.inventoryBatch.count({
        where: { outletId, batchNumber: { startsWith: `AUTO-${dateStr}` } },
      })
    }

    const batchData: Array<{
      batchNumber: string; inventoryItemId: string
      initialQty: number; remainingQty: number; unitCost: number
      expiredDate: Date | null; purchaseOrderId: string
      supplierId: string | null; supplierName: string | null
      status: string; outletId: string
    }> = []

    for (const u of rawUpdates) {
      let batchNumber: string
      if (u.batch) {
        batchNumber = u.batch
      } else {
        autoBatchCounter++
        batchNumber = `AUTO-${dateStr}-${String(autoBatchCounter).padStart(4, '0')}`
      }
      batchData.push({
        batchNumber, inventoryItemId: u.inventoryItemId,
        initialQty: u.baseQty, remainingQty: u.baseQty, unitCost: u.unitCost,
        expiredDate: u.expiredDate ? new Date(u.expiredDate) : null,
        purchaseOrderId: '', supplierId: supplierId || null,
        supplierName: supplierName || null, status: 'AVAILABLE', outletId,
      })
    }

    // ══════════════════════════════════════════════════════
    // PHASE 1 (CRITICAL): PO + items + stock + batches
    // Pure Prisma ORM — no raw SQL, works on any DB
    // ══════════════════════════════════════════════════════
    let purchaseOrder: Awaited<ReturnType<typeof db.purchaseOrder.create>>
    try {
      purchaseOrder = await db.$transaction(async (tx) => {
        // 1. Create PO with nested items
        const po = await tx.purchaseOrder.create({
          data: {
            orderNumber, supplierId: supplierId || null, totalCost,
            notes: notes?.trim() || null, outletId, userId,
            items: {
              create: normalizedItems.map(item => {
                const invItem = invItemMap.get(item.inventoryItemId)!
                return {
                  inventoryItemId: item.inventoryItemId, name: invItem.name,
                  purchaseQty: item.purchaseQty, purchaseUnit: item.purchaseUnit,
                  baseQty: item.baseQty, baseUnit: item.baseUnit,
                  unitCost: item.unitCost,
                  totalCost: item.totalCost || (item.baseQty * item.unitCost),
                  batch: item.batch?.trim() || null,
                  expiredDate: item.expiredDate ? new Date(item.expiredDate) : null,
                  outletId,
                }
              }),
            },
          },
          include: {
            items: true,
            supplier: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
          },
        })

        // 2. Update inventory stock (simple Prisma loop — fast for daily 10-50 items)
        for (const [id, update] of updateMap) {
          await tx.inventoryItem.update({
            where: { id },
            data: { stock: update.newStock, avgCost: update.newAvgCost },
          })
        }

        // 3. Create batches (createMany)
        if (batchData.length > 0) {
          const filled = batchData.map(bd => ({ ...bd, purchaseOrderId: po.id }))
          const CHUNK = 100
          for (let i = 0; i < filled.length; i += CHUNK) {
            await tx.inventoryBatch.createMany({ data: filled.slice(i, i + CHUNK) })
          }
        }

        return po
      }, { timeout: 60000 })
    } catch (error) {
      console.error('[Purchase Phase 1] Critical:', error)
      const msg = error instanceof Error ? error.message : 'Unknown error'
      if (msg.includes('P2002') || msg.includes('Unique constraint')) {
        if (msg.includes('batchNumber')) {
          return safeJsonError('Gagal: nomor batch sudah ada. Cek kolom Batch di Excel.', 409)
        }
        return safeJsonError('Gagal membuat PO: nomor order sudah ada. Silakan coba lagi.', 409)
      }
      return safeJsonError(`Gagal membuat pembelian: ${msg}`)
    }

    // ══════════════════════════════════════════════════════
    // PHASE 2 (NON-CRITICAL): Audit + movements
    // ══════════════════════════════════════════════════════
    try {
      await db.$transaction(async (tx) => {
        const CHUNK = 100

        const auditData = rawUpdates.map(u => ({
          action: 'PURCHASE' as const,
          entityType: 'INVENTORY_ITEM' as const,
          entityId: u.inventoryItemId,
          details: JSON.stringify({
            itemName: u.name, purchaseOrderNumber: orderNumber,
            baseQtyAdded: u.baseQty, unitCost: u.unitCost,
            previousStock: u.existingStock, newStock: u.newStock,
            previousAvgCost: u.existingAvgCost, newAvgCost: u.newAvgCost,
            batch: u.batch, expiredDate: u.expiredDate,
          }),
          outletId, userId,
        }))
        for (let i = 0; i < auditData.length; i += CHUNK) {
          await tx.auditLog.createMany({ data: auditData.slice(i, i + CHUNK) })
        }

        const movementData = rawUpdates.map(u => ({
          type: 'PURCHASE' as const,
          inventoryItemId: u.inventoryItemId, quantity: u.baseQty,
          previousStock: u.existingStock, newStock: u.newStock,
          referenceId: purchaseOrder.id, referenceType: 'PURCHASE_ORDER' as const,
          notes: `Pembelian: ${u.name} (${orderNumber})${u.batch ? ` [Batch: ${u.batch}]` : ''}${u.expiredDate ? ` [Exp: ${u.expiredDate.split('T')[0]}]` : ''}`,
          outletId, userId,
        }))
        for (let i = 0; i < movementData.length; i += CHUNK) {
          await tx.inventoryMovement.createMany({ data: movementData.slice(i, i + CHUNK) })
        }
      }, { timeout: 60000 })
    } catch (error) {
      console.error('[Purchase Phase 2] Non-critical:', error)
    }

    // ══════════════════════════════════════════════════════
    // PHASE 3 (NON-CRITICAL): HPP recalculation
    // ══════════════════════════════════════════════════════
    try {
      const ids = [...updateMap.keys()]
      if (ids.length > 0) {
        await db.$transaction(async (tx) => {
          await recalculateHppForAffectedProducts(tx, ids)
        }, { timeout: 60000 })
      }
    } catch (error) {
      console.error('[Purchase Phase 3] Non-critical:', error)
    }

    return safeJsonCreated({
      ...purchaseOrder,
      _importStats: newItems?.length
        ? { newItemsCreated: Object.keys(newItemIdMap).length }
        : undefined,
    })
  } catch (error) {
    console.error('Purchases POST error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Gagal membuat pembelian: ${msg}`)
  }
}