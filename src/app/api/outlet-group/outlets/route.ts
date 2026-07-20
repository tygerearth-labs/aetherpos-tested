import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'
import { getOutletPlan, isUnlimited } from '@/lib/config/plan-config'
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

/**
 * DELETE /api/outlet-group/outlets?outletId=xxx — Remove a branch outlet from the group
 *
 * Only the main outlet owner can delete branch outlets.
 * The main outlet CANNOT be deleted.
 * All related data (users, products, transactions, etc.) is cascade-deleted.
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menghapus outlet', 403)
    }

    const { searchParams } = request.nextUrl
    const targetOutletId = searchParams.get('outletId')
    if (!targetOutletId) return safeJsonError('outletId wajib diisi', 400)

    // Verify current user's outlet is main and in a group
    const currentOutlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { id: true, groupId: true, isMain: true },
    })
    if (!currentOutlet?.groupId) return safeJsonError('Outlet belum tergabung dalam grup', 400)
    if (!currentOutlet.isMain) return safeJsonError('Hanya outlet utama yang dapat menghapus cabang', 403)

    // Verify group ownership
    const group = await db.outletGroup.findUnique({
      where: { id: currentOutlet.groupId },
      select: { id: true, ownerId: true },
    })
    if (!group || group.ownerId !== user.id) return safeJsonError('Anda bukan pemilik grup ini', 403)

    // Fetch target outlet
    const targetOutlet = await db.outlet.findUnique({
      where: { id: targetOutletId },
      select: { id: true, name: true, groupId: true, isMain: true },
    })
    if (!targetOutlet) return safeJsonError('Outlet tidak ditemukan', 404)
    if (targetOutlet.groupId !== currentOutlet.groupId) return safeJsonError('Outlet bukan bagian dari grup Anda', 403)
    if (targetOutlet.isMain) return safeJsonError('Outlet utama tidak dapat dihapus', 400)
    if (targetOutlet.id === user.outletId) return safeJsonError('Tidak dapat menghapus outlet Anda sendiri', 400)

    // Cascade-delete all related data in a transaction
    await db.$transaction(async (tx) => {
      // 1. Delete transfer items (via transfer deletion)
      const transferIds = await tx.outletTransfer.findMany({
        where: { OR: [{ fromOutletId: targetOutletId }, { toOutletId: targetOutletId }] },
        select: { id: true },
      })
      if (transferIds.length > 0) {
        await tx.transferItem.deleteMany({
          where: { transferId: { in: transferIds.map((t) => t.id) } },
        })
        await tx.outletTransfer.deleteMany({
          where: { OR: [{ fromOutletId: targetOutletId }, { toOutletId: targetOutletId }] },
        })
      }

      // 2. Delete loyalty logs
      const txIds = await tx.transaction.findMany({
        where: { outletId: targetOutletId },
        select: { id: true },
      })
      if (txIds.length > 0) {
        await tx.loyaltyLog.deleteMany({
          where: { transactionId: { in: txIds.map((t) => t.id) } },
        })
      }

      // 3. Delete transactions (cascades transactionItems)
      await tx.transaction.deleteMany({ where: { outletId: targetOutletId } })

      // 4. Delete product variants, then products
      const productIds = await tx.product.findMany({
        where: { outletId: targetOutletId },
        select: { id: true },
      })
      if (productIds.length > 0) {
        await tx.productVariant.deleteMany({
          where: { productId: { in: productIds.map((p) => p.id) } },
        })
        await tx.product.deleteMany({ where: { outletId: targetOutletId } })
      }

      // 5. Delete categories
      await tx.category.deleteMany({ where: { outletId: targetOutletId } })

      // 6. Delete customers (cascades loyaltyLogs already handled above)
      await tx.customer.deleteMany({ where: { outletId: targetOutletId } })

      // 7. Delete crew permissions, then users
      await tx.crewPermission.deleteMany({ where: { outletId: targetOutletId } })
      await tx.user.deleteMany({ where: { outletId: targetOutletId } })

      // 8. PRESERVE audit logs — migrate to the main outlet (user.outletId) instead
      //    of deleting them. Contract Section 12 requires historical records to be
      //    preserved for financial/inventory traceability. We annotate each
      //    migrated log with provenance (originOutletId, originOutletName, migratedAt)
      //    so forensic investigations can still trace the original branch context.
      //    A new AuditLog entry is created at the main outlet to record the
      //    branch-deletion event itself (see step 10b below).
      const auditLogsToMigrate = await tx.auditLog.findMany({
        where: { outletId: targetOutletId },
        select: { id: true, details: true },
      })
      if (auditLogsToMigrate.length > 0) {
        const migratedAt = new Date().toISOString()
        for (const log of auditLogsToMigrate) {
          let existingDetails: Record<string, unknown> = {}
          try { existingDetails = log.details ? JSON.parse(log.details) : {} } catch { existingDetails = {} }
          const annotated = {
            ...existingDetails,
            _migratedFromOutletId: targetOutletId,
            _migratedFromOutletName: targetOutlet.name,
            _migratedAt: migratedAt,
            _migrationReason: 'BRANCH_DELETED',
          }
          await tx.auditLog.update({
            where: { id: log.id },
            data: {
              outletId: user.outletId,   // reparent to main outlet (FK stays valid)
              details: JSON.stringify(annotated),
            },
          })
        }
        console.log(`[OutletDelete] Migrated ${auditLogsToMigrate.length} audit log(s) from "${targetOutlet.name}" to main outlet`)
      }

      // 9. Delete outlet settings
      await tx.outletSetting.deleteMany({ where: { outletId: targetOutletId } })

      // 10. Delete the outlet itself
      await tx.outlet.delete({ where: { id: targetOutletId } })

      // 10b. Audit log at main outlet — records the branch deletion event with
      //     full context (outletId, outletName, txCount migrated, auditLogCount migrated)
      await tx.auditLog.create({
        data: {
          action: 'DELETE',
          entityType: 'OUTLET',
          entityId: targetOutletId,
          details: JSON.stringify({
            action: 'DELETE_BRANCH',
            outletName: targetOutlet.name,
            migratedAuditLogCount: auditLogsToMigrate.length,
            preservedAuditLogs: true,   // contract Section 12 compliance
            note: 'Audit logs migrated to main outlet; transactions/products/inventory were hard-deleted.',
          }),
          outletId: user.outletId,
          userId: user.id,
        },
      })
    })

    return safeJson({ message: `Outlet "${targetOutlet.name}" berhasil dihapus beserta seluruh datanya.` })
  } catch (error) {
    console.error('[/api/outlet-group/outlets] DELETE error:', error)
    return safeJsonError('Failed to delete outlet')
  }
}