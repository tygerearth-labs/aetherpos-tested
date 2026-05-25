import { NextRequest } from 'next/server'
import { resolvePlanType } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/safe-response'

/**
 * GET /api/outlets — List all outlets owned by the current user's owner
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
    }

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
        include: {
          _count: { select: { users: true, products: true, transactions: true, customers: true } },
        },
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
          accountType: outlet.accountType,
          isPrimary: true,
          createdAt: outlet.createdAt,
          userCount: outlet._count.users,
          productCount: outlet._count.products,
          transactionCount: outlet._count.transactions,
          customerCount: outlet._count.customers,
        }],
        canAddMore: false,
      })
    }

    // Enterprise: list ALL outlets created by this owner
    // We store the "owner email" as a way to link outlets
    const allUsers = await db.user.findMany({
      where: {
        email: user.email ?? '',
        role: 'OWNER',
      },
      include: {
        outlet: {
          include: {
            _count: { select: { users: true, products: true, transactions: true, customers: true } },
          },
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
        accountType: u.outlet.accountType,
        isPrimary: u.outletId === user.outletId,
        createdAt: u.outlet.createdAt,
        userCount: u.outlet._count.users,
        productCount: u.outlet._count.products,
        transactionCount: u.outlet._count.transactions,
        customerCount: u.outlet._count.customers,
      }))

    return safeJson({
      outlets,
      canAddMore: true,
    })
  } catch (error) {
    console.error('[/api/outlets] GET error:', error)
    return safeJsonError('Failed to load outlets')
  }
}

/**
 * POST /api/outlets — Create a new outlet branch (Enterprise only)
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat menambah outlet cabang', 403)
    }

    // Check enterprise plan
    const primaryOutlet = await db.outlet.findUnique({
      where: { id: user.outletId },
      select: { accountType: true },
    })

    if (resolvePlanType(primaryOutlet?.accountType) !== 'enterprise') {
      return safeJsonError('Multi-outlet hanya tersedia untuk akun Enterprise. Upgrade untuk mengakses fitur ini.', 403)
    }

    const body = await request.json()
    const { name, address, phone } = body

    if (!name || name.trim().length < 2) {
      return safeJsonError('Nama outlet minimal 2 karakter', 400)
    }

    // Fetch the current user's full record to get the password hash
    const currentUser = await db.user.findUnique({
      where: { id: user.id },
    })
    if (!currentUser) {
      return safeJsonError('User tidak ditemukan', 404)
    }

    // Create the new outlet + create an owner entry with same credentials
    const result = await db.$transaction(async (tx) => {
      const newOutlet = await tx.outlet.create({
        data: {
          name: name.trim(),
          address: address?.trim() || null,
          phone: phone?.trim() || null,
          accountType: 'enterprise',
        },
      })

      // Create owner entry linked to this outlet (same email as current user)
      const newOwner = await tx.user.create({
        data: {
          name: currentUser.name,
          email: currentUser.email,
          password: currentUser.password,
          role: 'OWNER',
          outletId: newOutlet.id,
        },
      })

      // Create default settings for the new outlet
      await tx.outletSetting.create({
        data: {
          outletId: newOutlet.id,
          paymentMethods: 'CASH,QRIS',
          loyaltyEnabled: true,
          loyaltyPointsPerAmount: 10000,
          loyaltyPointValue: 100,
          receiptBusinessName: newOutlet.name,
          receiptAddress: '',
          receiptPhone: '',
          receiptFooter: 'Terima kasih atas kunjungan Anda!',
          themePrimaryColor: 'emerald',
        },
      })

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'OUTLET',
          entityId: newOutlet.id,
          details: JSON.stringify({ name: newOutlet.name, branchedFrom: user.outletId }),
          outletId: user.outletId,
          userId: user.id,
        },
      })

      return { outlet: newOutlet, owner: newOwner }
    })

    return safeJsonCreated({
      outlet: {
        id: result.outlet.id,
        name: result.outlet.name,
        address: result.outlet.address,
        phone: result.outlet.phone,
        accountType: result.outlet.accountType,
        isPrimary: false,
        createdAt: result.outlet.createdAt,
      },
      owner: {
        id: result.owner.id,
        email: result.owner.email,
        name: result.owner.name,
      },
      message: `Outlet "${result.outlet.name}" berhasil ditambahkan. Login dengan email ${result.owner.email} dan password yang sama untuk mengakses outlet cabang.`,
    })
  } catch (error) {
    console.error('[/api/outlets] POST error:', error)
    return safeJsonError('Internal server error')
  }
}
