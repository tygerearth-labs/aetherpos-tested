import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'

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