import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'

/**
 * POST /api/outlet-group/outlets — Add a new branch outlet to the group
 *
 * The new outlet inherits the same accountType as the main outlet.
 * Only OWNER can add branch outlets.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menambah outlet cabang', 403)
    }

    const body = await request.json()
    const { name, address, phone } = body as {
      name?: string
      address?: string
      phone?: string
    }

    if (!name || name.trim().length < 2) {
      return safeJsonError('Nama outlet minimal 2 karakter', 400)
    }

    // Verify current outlet is in a group
    const currentOutlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: {
        id: true,
        name: true,
        groupId: true,
        isMain: true,
        accountType: true,
      },
    })

    if (!currentOutlet) {
      return safeJsonError('Outlet tidak ditemukan', 404)
    }

    if (!currentOutlet.groupId) {
      return safeJsonError('Outlet belum tergabung dalam grup. Buat grup terlebih dahulu.', 400)
    }

    if (!currentOutlet.isMain) {
      return safeJsonError('Hanya outlet utama yang dapat menambah cabang', 403)
    }

    // Verify group ownership
    const group = await db.outletGroup.findUnique({
      where: { id: currentOutlet.groupId },
      select: { id: true, name: true, ownerId: true },
    })

    if (!group || group.ownerId !== user.id) {
      return safeJsonError('Anda bukan pemilik grup ini', 403)
    }

    // Fetch the main outlet's settings to replicate
    const mainSettings = await db.outletSetting.findUnique({
      where: { outletId: user.outletId },
    })

    const result = await db.$transaction(async (tx) => {
      // Create the new outlet
      const newOutlet = await tx.outlet.create({
        data: {
          name: name.trim(),
          address: address?.trim() || null,
          phone: phone?.trim() || null,
          accountType: currentOutlet.accountType,
          isMain: false,
          groupId: group.id,
        },
      })

      // Create default settings for the new outlet (copy from main)
      await tx.outletSetting.create({
        data: {
          outletId: newOutlet.id,
          paymentMethods: mainSettings?.paymentMethods || 'CASH,QRIS',
          loyaltyEnabled: mainSettings?.loyaltyEnabled ?? true,
          loyaltyPointsPerAmount: mainSettings?.loyaltyPointsPerAmount ?? 10000,
          loyaltyPointValue: mainSettings?.loyaltyPointValue ?? 100,
          receiptBusinessName: newOutlet.name,
          receiptAddress: newOutlet.address || '',
          receiptPhone: newOutlet.phone || '',
          receiptFooter: mainSettings?.receiptFooter || 'Terima kasih atas kunjungan Anda!',
          themePrimaryColor: mainSettings?.themePrimaryColor || 'emerald',
          ppnEnabled: mainSettings?.ppnEnabled ?? false,
          ppnRate: mainSettings?.ppnRate ?? 11,
        },
      })

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'OUTLET',
          entityId: newOutlet.id,
          details: JSON.stringify({
            action: 'ADD_BRANCH',
            outletName: newOutlet.name,
            groupId: group.id,
          }),
          outletId: user.outletId,
          userId: user.id,
        },
      })

      return newOutlet
    })

    return safeJsonCreated({
      id: result.id,
      name: result.name,
      address: result.address,
      phone: result.phone,
      accountType: result.accountType,
      isMain: false,
      groupId: group.id,
      message: `Outlet cabang "${result.name}" berhasil ditambahkan ke grup "${group.name}".`,
    })
  } catch (error) {
    console.error('[/api/outlet-group/outlets] POST error:', error)
    return safeJsonError('Failed to add branch outlet')
  }
}