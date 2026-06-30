import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'
import { getOutletPlan } from '@/lib/config/plan-config'

/**
 * GET /api/outlet-group — Get current outlet's group info
 *
 * If outlet has no groupId, returns { hasGroup: false, outlets: [currentOutlet] }
 * If outlet has a groupId, returns the group with all outlets
 *
 * Gracefully degrades if production DB hasn't been migrated (missing isMain/groupId columns).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    // Try full query with new schema fields (isMain, groupId)
    // If the DB hasn't been migrated, fall back to basic query
    let outlet: Record<string, unknown> | null = null
    let schemaMigrated = true

    try {
      outlet = await db.outlet.findUnique({
        where: { id: user.outletId },
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          isMain: true,
          accountType: true,
          groupId: true,
          _count: {
            select: { users: true, products: true, transactions: true },
          },
        },
      }) as unknown as Record<string, unknown> | null
    } catch {
      // Schema not migrated — fallback query without new fields
      schemaMigrated = false
      try {
        outlet = await db.outlet.findUnique({
          where: { id: user.outletId },
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
            accountType: true,
            _count: {
              select: { users: true, products: true, transactions: true },
            },
          },
        }) as unknown as Record<string, unknown> | null
      } catch {
        // Even basic query failed — return safe default
        return safeJson({ hasGroup: false, outlets: [] })
      }
    }

    if (!outlet) {
      return safeJsonError('Outlet tidak ditemukan', 404)
    }

    // Fetch plan info for UI (maxOutlets, multiOutlet)
    const planInfo = await getOutletPlan(user.outletId, db)
    const planMeta = planInfo ? {
      plan: planInfo.plan,
      multiOutlet: planInfo.features.multiOutlet,
      maxOutlets: planInfo.features.maxOutlets,
    } : { plan: 'free', multiOutlet: false, maxOutlets: 1 }

    // No group — standalone outlet
    const groupId = schemaMigrated ? (outlet.groupId as string | null) : null
    if (!groupId) {
      return safeJson({
        hasGroup: false,
        plan: planMeta,
        outlets: [
          {
            id: outlet.id,
            name: outlet.name,
            address: outlet.address,
            phone: outlet.phone,
            isMain: schemaMigrated ? (outlet.isMain as boolean) : true,
            accountType: outlet.accountType,
            _count: outlet._count,
          },
        ],
      })
    }

    // Has group — fetch all outlets in the group (only if schema is migrated)
    if (!schemaMigrated) {
      return safeJson({ hasGroup: false, outlets: [] })
    }

    try {
      const group = await db.outletGroup.findUnique({
        where: { id: groupId },
        include: {
          outlets: {
            select: {
              id: true,
              name: true,
              address: true,
              phone: true,
              isMain: true,
              accountType: true,
              _count: {
                select: { users: true, products: true, transactions: true },
              },
            },
            orderBy: { isMain: 'desc' },
          },
        },
      })

      if (!group) {
        return safeJson({ hasGroup: false, outlets: [] })
      }

      return safeJson({
        hasGroup: true,
        groupId: group.id,
        groupName: group.name,
        plan: planMeta,
        outlets: group.outlets,
      })
    } catch {
      // OutletGroup table doesn't exist yet
      return safeJson({ hasGroup: false, outlets: [] })
    }
  } catch (error) {
    console.error('[/api/outlet-group] GET error:', error)
    return safeJson({ hasGroup: false, outlets: [] })
  }
}

/**
 * POST /api/outlet-group — Create a new outlet group
 *
 * Sets the current outlet as the main outlet (isMain: true) and
 * the current user as the group owner.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat membuat grup outlet', 403)
    }

    const body = await request.json()
    const { name } = body as { name?: string }

    if (!name || name.trim().length < 2) {
      return safeJsonError('Nama grup minimal 2 karakter', 400)
    }

    // Check if outlet already has a group
    const currentOutlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { groupId: true, isMain: true, name: true, accountType: true, address: true, phone: true },
    })

    if (!currentOutlet) {
      return safeJsonError('Outlet tidak ditemukan', 404)
    }

    if (currentOutlet.groupId) {
      return safeJsonError('Outlet sudah tergabung dalam grup', 400)
    }

    // Check plan supports multi outlet
    const planInfo = await getOutletPlan(user.outletId, db)
    if (!planInfo) {
      return safeJsonError('Gagal memeriksa paket outlet', 500)
    }
    if (!planInfo.features.multiOutlet) {
      return safeJsonError(`Paket ${planInfo.plan} tidak mendukung multi outlet. Upgrade ke Pro atau Enterprise.`, 403)
    }
    if (planInfo.features.maxOutlets <= 1) {
      return safeJsonError(`Paket ${planInfo.plan} hanya mendukung 1 outlet. Upgrade untuk menambah cabang.`, 403)
    }

    // Check if user already owns a group
    const existingGroup = await db.outletGroup.findUnique({
      where: { ownerId: user.id },
    })

    if (existingGroup) {
      return safeJsonError('Anda sudah memiliki grup outlet', 400)
    }

    const result = await db.$transaction(async (tx) => {
      // Create the group
      const group = await tx.outletGroup.create({
        data: {
          name: name.trim(),
          ownerId: user.id,
        },
      })

      // Update current outlet to be the main outlet in the group
      await tx.outlet.update({
        where: { id: user.outletId },
        data: {
          groupId: group.id,
          isMain: true,
        },
      })

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'OUTLET',
          entityId: group.id,
          details: JSON.stringify({ action: 'CREATE_GROUP', groupName: group.name }),
          outletId: user.outletId,
          userId: user.id,
        },
      })

      return group
    })

    return safeJsonCreated({
      id: result.id,
      name: result.name,
      message: `Grup "${result.name}" berhasil dibuat. Outlet "${currentOutlet.name}" ditetapkan sebagai outlet utama.`,
    })
  } catch (error) {
    console.error('[/api/outlet-group] POST error:', error)
    return safeJsonError('Failed to create outlet group')
  }
}