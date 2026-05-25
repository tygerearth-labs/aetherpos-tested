import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * DELETE /api/outlets/[id] — Delete an outlet branch (Enterprise only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menghapus outlet', 403)
    }

    const { id } = await params

    // Cannot delete primary outlet
    if (id === user.outletId) {
      return safeJsonError('Outlet utama tidak dapat dihapus', 400)
    }

    // Verify outlet belongs to same owner (same email)
    const targetOwner = await db.user.findFirst({
      where: { email: user.email ?? '', outletId: id, role: 'OWNER' },
    })
    if (!targetOwner) {
      return safeJsonError('Outlet tidak ditemukan atau bukan milik Anda', 404)
    }

    // Delete in correct order (FK constraints) — wrapped in a transaction for atomicity
    await db.$transaction([
      db.transactionItem.deleteMany({ where: { transaction: { outletId: id } } }),
      db.transaction.deleteMany({ where: { outletId: id } }),
      db.auditLog.deleteMany({ where: { outletId: id } }),
      db.crewPermission.deleteMany({ where: { outletId: id } }),
      db.promo.deleteMany({ where: { outletId: id } }),
      db.loyaltyLog.deleteMany({ where: { transaction: { outletId: id } } }),
      db.customer.deleteMany({ where: { outletId: id } }),
      db.product.deleteMany({ where: { outletId: id } }),
      db.outletSetting.deleteMany({ where: { outletId: id } }),
      db.user.deleteMany({ where: { outletId: id } }),
      db.outlet.delete({ where: { id } }),
    ])

    return safeJson({ message: 'Outlet berhasil dihapus' })
  } catch (error) {
    console.error('[/api/outlets] DELETE error:', error)
    return safeJsonError('Internal server error')
  }
}
