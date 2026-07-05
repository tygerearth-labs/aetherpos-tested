import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonError, CACHE } from '@/lib/api/safe-response'

/**
 * GET /api/enterprise/pending-transfers
 *
 * Enterprise-only endpoint.
 * Returns pending inbound and outbound transfers for all outlets in the group.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') return safeJsonError('Owner only', 403)

    // Check enterprise plan
    const outlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { accountType: true, groupId: true },
    })

    if (!outlet) return safeJsonError('Outlet not found', 404)

    const rawPlan = outlet.accountType.startsWith('suspended:')
      ? outlet.accountType.replace('suspended:', '')
      : outlet.accountType

    if (rawPlan !== 'enterprise') {
      return safeJsonError('Enterprise plan required', 403)
    }

    if (!outlet.groupId) {
      return safeJsonError('Outlet tidak tergabung dalam grup', 400)
    }

    // Fetch all outlets in the group
    const group = await db.outletGroup.findUnique({
      where: { id: outlet.groupId },
      include: {
        outlets: {
          select: { id: true, name: true, isMain: true },
          orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
        },
      },
    })

    if (!group) return safeJsonError('Grup outlet tidak ditemukan', 404)

    const outletIds = group.outlets.map((o) => o.id)
    const outletMap = new Map(group.outlets.map((o) => [o.id, o]))

    // Fetch pending transfers (DRAFT and IN_TRANSIT) across all group outlets
    const pendingTransfers = await db.outletTransfer.findMany({
      where: {
        status: { in: ['DRAFT', 'IN_TRANSIT'] },
        OR: [
          { fromOutletId: { in: outletIds } },
          { toOutletId: { in: outletIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        transferNumber: true,
        fromOutletId: true,
        toOutletId: true,
        status: true,
        itemType: true,
        notes: true,
        createdAt: true,
        items: {
          select: { id: true, productName: true, quantity: true },
        },
        inventoryTransferItems: {
          select: { id: true, itemName: true, quantity: true, baseUnit: true },
        },
      },
    })

    // Categorize into inbound and outbound per outlet
    const outboundMap = new Map<string, typeof pendingTransfers>()
    const inboundMap = new Map<string, typeof pendingTransfers>()

    for (const transfer of pendingTransfers) {
      // Outbound = from this outlet
      if (outletIds.includes(transfer.fromOutletId)) {
        const existing = outboundMap.get(transfer.fromOutletId) || []
        existing.push(transfer)
        outboundMap.set(transfer.fromOutletId, existing)
      }

      // Inbound = to this outlet
      if (outletIds.includes(transfer.toOutletId)) {
        const existing = inboundMap.get(transfer.toOutletId) || []
        existing.push(transfer)
        inboundMap.set(transfer.toOutletId, existing)
      }
    }

    // Build per-outlet summary
    const outletSummaries = group.outlets.map((o) => {
      const outbound = outboundMap.get(o.id) || []
      const inbound = inboundMap.get(o.id) || []

      const outboundItems = outbound.reduce((s, t) => {
        return s + (t.itemType === 'INVENTORY'
          ? t.inventoryTransferItems.reduce((is, i) => is + i.quantity, 0)
          : t.items.reduce((is, i) => is + i.quantity, 0))
      }, 0)

      const inboundItems = inbound.reduce((s, t) => {
        return s + (t.itemType === 'INVENTORY'
          ? t.inventoryTransferItems.reduce((is, i) => is + i.quantity, 0)
          : t.items.reduce((is, i) => is + i.quantity, 0))
      }, 0)

      return {
        id: o.id,
        name: o.name,
        isMain: o.isMain,
        pendingOutbound: outbound.length,
        pendingOutboundItems: Math.round(outboundItems),
        pendingInbound: inbound.length,
        pendingInboundItems: Math.round(inboundItems),
        outboundTransfers: outbound.slice(0, 5).map((t) => ({
          id: t.id,
          transferNumber: t.transferNumber,
          toOutlet: outletMap.get(t.toOutletId)?.name ?? '-',
          status: t.status,
          itemType: t.itemType,
          itemCount: t.itemType === 'INVENTORY'
            ? t.inventoryTransferItems.length
            : t.items.length,
          totalQty: Math.round(
            t.itemType === 'INVENTORY'
              ? t.inventoryTransferItems.reduce((s, i) => s + i.quantity, 0)
              : t.items.reduce((s, i) => s + i.quantity, 0)
          ),
          createdAt: t.createdAt.toISOString(),
          notes: t.notes,
        })),
        inboundTransfers: inbound.slice(0, 5).map((t) => ({
          id: t.id,
          transferNumber: t.transferNumber,
          fromOutlet: outletMap.get(t.fromOutletId)?.name ?? '-',
          status: t.status,
          itemType: t.itemType,
          itemCount: t.itemType === 'INVENTORY'
            ? t.inventoryTransferItems.length
            : t.items.length,
          totalQty: Math.round(
            t.itemType === 'INVENTORY'
              ? t.inventoryTransferItems.reduce((s, i) => s + i.quantity, 0)
              : t.items.reduce((s, i) => s + i.quantity, 0)
          ),
          createdAt: t.createdAt.toISOString(),
          notes: t.notes,
        })),
      }
    })

    const totalPendingOutbound = outletSummaries.reduce((s, o) => s + o.pendingOutbound, 0)
    const totalPendingInbound = outletSummaries.reduce((s, o) => s + o.pendingInbound, 0)

    return safeJson(
      {
        outlets: outletSummaries,
        totalPendingOutbound,
        totalPendingInbound,
        totalPending: totalPendingOutbound + totalPendingInbound,
      },
      200,
      CACHE.SHORT,
    )
  } catch (error) {
    console.error('[/api/enterprise/pending-transfers] error:', error)
    return safeJsonError('Failed to load pending transfers')
  }
}