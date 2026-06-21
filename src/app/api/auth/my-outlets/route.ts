import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { resolvePlanType } from '@/lib/api-helpers'
import { safeJson, safeJsonError } from '@/lib/safe-response'

/**
 * GET /api/auth/my-outlets — Get all outlets the current user has access to
 *
 * For OWNER: returns all outlets linked by same email (enterprise pattern)
 * For CREW: returns outlets from UserOutlet records
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role === 'OWNER') {
      // Get the owner's primary outlet accountType
      const primaryOutlet = await db.outlet.findUnique({
        where: { id: user.outletId },
        select: { accountType: true },
      })

      const isEnterprise = resolvePlanType(primaryOutlet?.accountType) === 'enterprise'

      if (!isEnterprise) {
        // Non-enterprise: only return primary outlet
        const outlet = await db.outlet.findUnique({
          where: { id: user.outletId },
          select: { id: true, name: true, address: true, phone: true },
        })
        if (!outlet) {
          return safeJsonError('Outlet tidak ditemukan', 404)
        }
        return safeJson({
          outlets: [{
            id: outlet.id,
            name: outlet.name,
            address: outlet.address,
            phone: outlet.phone,
            isPrimary: true,
          }],
        })
      }

      // Enterprise: list ALL outlets created by this owner
      const allUsers = await db.user.findMany({
        where: {
          email: user.email ?? '',
          role: 'OWNER',
        },
        include: {
          outlet: {
            select: { id: true, name: true, address: true, phone: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      })

      const outlets = allUsers
        .filter((u): u is typeof u & { outlet: NonNullable<typeof u.outlet> } => u.outlet !== null)
        .map((u) => ({
          id: u.outlet.id,
          name: u.outlet.name,
          address: u.outlet.address,
          phone: u.outlet.phone,
          isPrimary: u.outlet.id === user.outletId,
        }))

      return safeJson({ outlets })
    }

    // CREW: get primary outlet + UserOutlet records
    const outletIds = user.outletIds.length > 0 ? user.outletIds : [user.outletId]

    const outlets = await db.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, name: true, address: true, phone: true },
      orderBy: { createdAt: 'asc' },
    })

    return safeJson({
      outlets: outlets.map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address,
        phone: o.phone,
        isPrimary: o.id === user.outletId,
      })),
    })
  } catch (error) {
    console.error('[/api/auth/my-outlets] GET error:', error)
    return safeJsonError('Gagal memuat daftar outlet')
  }
}
