import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'
import { safeEmitAuditEvent, buildBulkBatchEvent } from '@/lib/audit-v2'

/**
 * POST /api/inventory/items/bulk
 *
 * Bulk create inventory items. Used by Excel import to avoid N sequential requests.
 * Returns a map of { tempKey: realId } for the caller to reference.
 *
 * Handles:
 * - Duplicate names within batch → dedup, assign same ID
 * - Names already in DB → match to existing ID
 * - New items → createMany (chunked)
 * - Race-safe fetch-back using createdAt marker
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const outletId = user.outletId

    const body = await request.json()
    const items: Array<{
      key: string
      name: string
      sku?: string | null
      baseUnit: string
      stock?: number
      avgCost?: number
    }> = body.items

    if (!Array.isArray(items) || items.length === 0) {
      return safeJsonError('Items array is required and must not be empty', 400)
    }
    if (items.length > 500) {
      return safeJsonError('Maksimal 500 item per request', 400)
    }

    // ── 1. Validate all items ──
    const validItems: typeof items = []
    const errors: Array<{ key: string; name: string; error: string }> = []

    for (const item of items) {
      if (!item.name?.trim()) {
        errors.push({ key: item.key, name: item.name || '?', error: 'Nama item wajib diisi' })
        continue
      }
      if (!item.baseUnit?.trim()) {
        errors.push({ key: item.key, name: item.name, error: 'Satuan dasar wajib diisi' })
        continue
      }
      validItems.push(item)
    }

    if (validItems.length === 0) {
      return safeJsonError(
        JSON.stringify({ error: 'Tidak ada item valid', details: errors }),
        400
      )
    }

    // ── 2. Deduplicate within batch (keep first occurrence) ──
    const seenNames = new Map<string, string>() // lowercase name → first item key
    const dedupedItems: typeof validItems = []
    const dupKeyMap = new Map<string, string>() // dup key → first occurrence key

    for (const item of validItems) {
      const nameLower = item.name.trim().toLowerCase()
      if (seenNames.has(nameLower)) {
        dupKeyMap.set(item.key, seenNames.get(nameLower)!)
      } else {
        seenNames.set(nameLower, item.key)
        dedupedItems.push(item)
      }
    }

    // ── 3. Check which names already exist in DB (1 query) ──
    const uniqueNames = [...new Set(dedupedItems.map(i => i.name.trim()))]
    const existingItems = await db.inventoryItem.findMany({
      where: {
        outletId,
        name: { in: uniqueNames },
      },
      select: { name: true, id: true },
    })
    const existingByName = new Map<string, string>() // lowercase → id
    for (const e of existingItems) {
      existingByName.set(e.name.toLowerCase(), e.id)
    }

    // ── 4. Separate: existing vs new ──
    const toCreate: typeof dedupedItems = []
    const alreadyExist: Array<{ key: string; id: string }> = []

    for (const item of dedupedItems) {
      const nameLower = item.name.trim().toLowerCase()
      const existingId = existingByName.get(nameLower)
      if (existingId) {
        alreadyExist.push({ key: item.key, id: existingId })
      } else {
        toCreate.push(item)
      }
    }

    // ── 5. Bulk create new items (chunked, race-safe fetch-back) ──
    const createdIds: Array<{ key: string; id: string }> = []
    if (toCreate.length > 0) {
      // Marker: record count before creation
      const countBefore = await db.inventoryItem.count({ where: { outletId } })

      const CHUNK = 50
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        const chunk = toCreate.slice(i, i + CHUNK)
        await db.inventoryItem.createMany({
          data: chunk.map(item => ({
            name: item.name.trim(),
            sku: item.sku?.trim() || null,
            baseUnit: item.baseUnit.trim(),
            stock: item.stock || 0,
            avgCost: item.avgCost || 0,
            lowStockAlert: 0,
            outletId,
            categoryId: null,
          })),
        })
      }

      // Fetch-back: get items created after our marker
      const createdItems = await db.inventoryItem.findMany({
        where: { outletId },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
        skip: countBefore,
      })

      // Build name → id map for created items
      const createdByName = new Map<string, string>()
      for (const ci of createdItems) {
        createdByName.set(ci.name.toLowerCase(), ci.id)
      }

      // Map back to keys
      for (const item of toCreate) {
        const id = createdByName.get(item.name.trim().toLowerCase())
        if (id) {
          createdIds.push({ key: item.key, id })
        }
      }

      // ── 5b. Create RECONCILE-INIT- batches for items with stock > 0 ──
      // BATCH INVARIANT: InventoryItem.stock must equal Σ(available
      // batch.remainingQty). Mirrors the single-create pattern in
      // inventory/items/route.ts (call site #4). Without this, bulk-created
      // items would be "orphans" — FEFO would skip them at checkout (avgCost
      // fallback, no batch traceability, no precise void reversal).
      // purchaseOrderId is null (no source PO — opening balance batch).
      // Non-fatal: if batch creation fails, items still exist (same as pre-fix
      // behavior). A warning is logged so the drift can be backfilled later.
      const bulkBatchData: Array<{
        batchNumber: string
        inventoryItemId: string
        initialQty: number
        remainingQty: number
        unitCost: number
        expiredDate: Date | null
        purchaseOrderId: string | null
        purchaseOrderItemId: string | null
        supplierId: string | null
        supplierName: string | null
        status: string
        outletId: string
      }> = []
      const bulkNow = Date.now()
      for (let bi = 0; bi < toCreate.length; bi++) {
        const src = toCreate[bi]
        if (!src.stock || src.stock <= 0) continue
        const invId = createdByName.get(src.name.trim().toLowerCase())
        if (!invId) continue
        bulkBatchData.push({
          batchNumber: `RECONCILE-INIT-${invId.slice(-8)}-${bulkNow}-${bi}`,
          inventoryItemId: invId,
          initialQty: src.stock,
          remainingQty: src.stock,
          unitCost: src.avgCost ?? 0,
          expiredDate: null,
          purchaseOrderId: null,
          purchaseOrderItemId: null,
          supplierId: null,
          supplierName: null,
          status: 'AVAILABLE',
          outletId,
        })
      }
      if (bulkBatchData.length > 0) {
        try {
          const BATCH_CHUNK = 100
          for (let i = 0; i < bulkBatchData.length; i += BATCH_CHUNK) {
            await db.inventoryBatch.createMany({ data: bulkBatchData.slice(i, i + BATCH_CHUNK) })
          }
        } catch (batchErr) {
          // Non-fatal: items are already created. Log so the orphan can be
          // detected and backfilled by the MIGRATION-BACKFILL script later.
          console.warn('[Bulk Create] Failed to create RECONCILE-INIT batches (items still created):', batchErr)
        }
      }
    }

    // ── 6. Build final idMap ──
    const idMap: Record<string, string> = {}

    // Existing items
    for (const item of alreadyExist) {
      idMap[item.key] = item.id
    }
    // Newly created
    for (const item of createdIds) {
      idMap[item.key] = item.id
    }
    // Duplicates within batch → point to first occurrence's ID
    for (const [dupKey, firstKey] of dupKeyMap) {
      const resolvedId = idMap[firstKey]
      if (resolvedId) {
        idMap[dupKey] = resolvedId
      }
    }

    // ── 7. Validate: every valid item must have an ID ──
    const missingIds = validItems.filter(i => !idMap[i.key])
    if (missingIds.length > 0) {
      console.error('[Bulk Create] Missing IDs for items:', missingIds.map(i => i.name))
    }

    // ── 8. AuditLog V2 — ONE BULK_BATCH event for the entire bulk-create op.
    //    Emitted AFTER all chunked createMany commits via safeEmitAuditEvent
    //    (non-transactional, never throws — audit failure must not break the response).
    const operationId = `INV-BULK-${outletId.slice(-6)}-${Date.now()}`
    const changes = [
      // Newly created items
      ...createdIds.map((c) => {
        const src = toCreate.find((i) => i.key === c.key)
        return {
          entity: 'INVENTORY_ITEM',
          identifier: c.id,
          action: 'created' as const,
          after: {
            name: src?.name ?? '',
            sku: src?.sku ?? '',
            baseUnit: src?.baseUnit ?? '',
            stock: src?.stock ?? 0,
            avgCost: src?.avgCost ?? 0,
          },
        }
      }),
      // Items that already existed (matched by name)
      ...alreadyExist.map((a) => {
        const src = dedupedItems.find((i) => i.key === a.key)
        return {
          entity: 'INVENTORY_ITEM',
          identifier: a.id,
          action: 'skipped' as const,
          note: `Already exists: ${src?.name ?? ''}`,
        }
      }),
      // Items that failed validation
      ...errors.map((e) => ({
        entity: 'INVENTORY_ITEM',
        identifier: e.key,
        action: 'failed' as const,
        note: e.error,
      })),
    ]

    await safeEmitAuditEvent(
      buildBulkBatchEvent({
        adapterKind: 'inventory-bulk',
        operationId,
        jobId: operationId,
        batchIndex: 0,
        payloadHash: `${operationId}-${items.length}`,
        status: 'completed',
        stats: {
          processed: items.length,
          created: createdIds.length,
          skipped: alreadyExist.length + dupKeyMap.size,
          failed: errors.length,
        },
        changes,
        errors: errors.map((e) => ({ row: e.key, message: e.error })),
        outletId,
        userId: user.id,
        markerDetails: {
          bulkCreate: true,
          source: 'inventory-items-bulk',
          totalRequested: items.length,
          created: createdIds.length,
          matched: alreadyExist.length,
          duplicates: dupKeyMap.size,
          failed: errors.length,
        },
      }),
    )

    return safeJsonCreated({
      idMap,
      created: createdIds.length,
      matched: alreadyExist.length,
      duplicates: dupKeyMap.size,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('[Inventory Bulk Create] error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJsonError(`Gagal membuat item: ${msg}`)
  }
}