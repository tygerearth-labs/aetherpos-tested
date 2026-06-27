import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'
import { getOutletPlan, isUnlimited } from '@/lib/plan-config'
import bcrypt from 'bcryptjs'

/**
 * POST /api/outlet-group/outlets — Add a new branch outlet to the group
 *
 * Creates the outlet, copies settings from main outlet, and creates
 * an OWNER user account for the new outlet.
 * Checks maxOutlets plan limit.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menambah outlet cabang', 403)
    }

    const body = await request.json()
    const { name, address, phone, ownerName, ownerEmail, ownerPassword } = body as {
      name?: string
      address?: string
      phone?: string
      ownerName?: string
      ownerEmail?: string
      ownerPassword?: string
    }

    // Validate outlet info
    if (!name || name.trim().length < 2) {
      return safeJsonError('Nama outlet minimal 2 karakter', 400)
    }

    // Validate owner account
    if (!ownerName || ownerName.trim().length < 2) {
      return safeJsonError('Nama pemilik outlet minimal 2 karakter', 400)
    }
    if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) {
      return safeJsonError('Format email tidak valid', 400)
    }
    if (!ownerPassword || ownerPassword.length < 8) {
      return safeJsonError('Password minimal 8 karakter', 400)
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

    // Check plan limits
    const planInfo = await getOutletPlan(user.outletId, db)
    if (!planInfo) {
      return safeJsonError('Gagal memeriksa paket outlet', 500)
    }
    if (!planInfo.features.multiOutlet) {
      return safeJsonError(`Paket ${planInfo.plan} tidak mendukung multi outlet. Upgrade ke Pro atau Enterprise.`, 403)
    }

    // Count current outlets in the group
    const currentOutletCount = await db.outlet.count({
      where: { groupId: group.id },
    })

    if (!isUnlimited(planInfo.features.maxOutlets) && currentOutletCount >= planInfo.features.maxOutlets) {
      return safeJsonError(
        `Batas outlet paket ${planInfo.plan} adalah ${planInfo.features.maxOutlets}. Anda sudah memiliki ${currentOutletCount} outlet.`,
        403
      )
    }

    // Check owner email uniqueness (global + per outlet)
    const normalizedEmail = ownerEmail.trim().toLowerCase()
    const existingEmail = await db.user.findFirst({
      where: { email: normalizedEmail },
      select: { id: true, outletId: true, outlet: { select: { name: true } } },
    })
    if (existingEmail) {
      return safeJsonError(
        `Email "${normalizedEmail}" sudah digunakan di outlet "${existingEmail.outlet.name}"`,
        409
      )
    }

    // Fetch the main outlet's settings to replicate
    const mainSettings = await db.outletSetting.findUnique({
      where: { outletId: user.outletId },
    })

    const hashedPassword = await bcrypt.hash(ownerPassword, 12)

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

      // Create OWNER user for the new outlet
      const newOwner = await tx.user.create({
        data: {
          name: ownerName.trim(),
          email: normalizedEmail,
          password: hashedPassword,
          role: 'OWNER',
          outletId: newOutlet.id,
        },
      })

      // Audit log (at the main outlet)
      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'OUTLET',
          entityId: newOutlet.id,
          details: JSON.stringify({
            action: 'ADD_BRANCH',
            outletName: newOutlet.name,
            groupId: group.id,
            ownerEmail: normalizedEmail,
          }),
          outletId: user.outletId,
          userId: user.id,
        },
      })

      // Audit log (at the new outlet)
      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'USER',
          entityId: newOwner.id,
          details: JSON.stringify({
            action: 'OWNER_CREATED_VIA_ADD_OUTLET',
            createdByName: user.name,
            createdById: user.id,
          }),
          outletId: newOutlet.id,
          userId: newOwner.id,
        },
      })

      return { outlet: newOutlet, owner: newOwner }
    })

    return safeJsonCreated({
      id: result.outlet.id,
      name: result.outlet.name,
      address: result.outlet.address,
      phone: result.outlet.phone,
      accountType: result.outlet.accountType,
      isMain: false,
      groupId: group.id,
      ownerEmail: result.owner.email,
      message: `Outlet cabang "${result.outlet.name}" berhasil ditambahkan. Akun owner telah dibuat untuk ${result.owner.email}.`,
    })
  } catch (error) {
    console.error('[/api/outlet-group/outlets] POST error:', error)
    return safeJsonError('Failed to add branch outlet')
  }
}