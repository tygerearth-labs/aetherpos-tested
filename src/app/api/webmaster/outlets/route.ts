import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError, safeJsonCreated } from '@/lib/safe-response'
import { parsePagination } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'

// GET: List all outlets with stats
export async function GET(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (!auth || auth.role !== 'WEBMASTER') {
    return unauthorized()
  }

  try {
    const { searchParams } = new URL(request.url)
    const pagination = parsePagination(searchParams)
    const search = searchParams.get('search') || ''

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { address: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search, mode: 'insensitive' as const } },
            { users: { some: { name: { contains: search, mode: 'insensitive' as const } } } },
          ],
        }
      : {}

    const [outlets, total] = await Promise.all([
      db.outlet.findMany({
        where,
        skip: pagination.skip,
        take: pagination.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          users: {
            where: { role: 'OWNER' },
            select: { id: true, name: true, email: true },
            take: 1,
          },
          _count: {
            select: {
              users: true,
              transactions: true,
              products: true,
              customers: true,
            },
          },
        },
      }),
      db.outlet.count({ where }),
    ])

    const result = outlets.map((o) => {
      const owner = o.users[0]
      return {
        id: o.id,
        name: o.name,
        address: o.address,
        phone: o.phone,
        accountType: o.accountType,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        owner: owner || null,
        userCount: o._count.users,
        transactionCount: o._count.transactions,
        productCount: o._count.products,
        customerCount: o._count.customers,
      }
    })

    return safeJson({
      data: result,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    })
  } catch (error) {
    console.error('Webmaster outlets list error:', error)
    return safeJsonError('Terjadi kesalahan internal')
  }
}

// POST: Create a new outlet with initial owner
export async function POST(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (!auth || auth.role !== 'WEBMASTER') {
    return unauthorized()
  }

  try {
    const body = await request.json()
    const { name, address, phone, ownerName, ownerEmail, ownerPassword, accountType } = body

    if (!name || !ownerName || !ownerEmail || !ownerPassword) {
      return safeJsonError('Nama outlet, nama owner, email owner, dan password wajib diisi', 400)
    }

    // Check if owner email already exists
    const existingUser = await db.user.findFirst({ where: { email: ownerEmail } })
    if (existingUser) {
      return safeJsonError('Email owner sudah terdaftar', 409)
    }

    const hashedPassword = await bcrypt.hash(ownerPassword, 10)
    const validAccountType = ['free', 'pro', 'enterprise'].includes(accountType) ? accountType : 'free'

    const result = await db.$transaction(async (tx) => {
      const outlet = await tx.outlet.create({
        data: {
          name,
          address: address || null,
          phone: phone || null,
          accountType: validAccountType,
        },
      })

      await tx.outletSetting.create({
        data: {
          outletId: outlet.id,
          paymentMethods: 'CASH,QRIS',
          loyaltyEnabled: true,
          loyaltyPointsPerAmount: 10000,
          loyaltyPointValue: 100,
          receiptBusinessName: name,
          receiptAddress: '',
          receiptPhone: '',
          receiptFooter: 'Terima kasih atas kunjungan Anda!',
          receiptLogo: '',
          themePrimaryColor: 'emerald',
        },
      })

      const owner = await tx.user.create({
        data: {
          name: ownerName,
          email: ownerEmail,
          password: hashedPassword,
          role: 'OWNER',
          outletId: outlet.id,
        },
      })

      return { outlet, owner }
    })

    return safeJsonCreated({
      message: 'Outlet berhasil dibuat',
      outletId: result.outlet.id,
      ownerId: result.owner.id,
    })
  } catch (error) {
    console.error('Webmaster create outlet error:', error)
    return safeJsonError('Terjadi kesalahan internal')
  }
}
