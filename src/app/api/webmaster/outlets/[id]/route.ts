import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { safeJson, safeJsonError } from '@/lib/safe-response'
import { db } from '@/lib/db'
import { NextRequest } from 'next/server'

// GET: Get outlet details with full stats
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser(request)
  if (!auth || auth.role !== 'WEBMASTER') {
    return unauthorized()
  }

  try {
    const { id } = await params

    const outlet = await db.outlet.findUnique({
      where: { id },
      include: {
        users: {
          where: { role: 'OWNER' },
          select: { id: true, name: true, email: true, createdAt: true },
          take: 1,
        },
        _count: {
          select: {
            users: true,
            transactions: true,
            products: true,
            customers: true,
            categories: true,
          },
        },
        transactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            paymentMethod: true,
            createdAt: true,
          },
        },
        setting: true,
      },
    })

    if (!outlet) {
      return safeJsonError('Outlet tidak ditemukan', 404)
    }

    // Calculate revenue
    const revenueResult = await db.transaction.aggregate({
      where: { outletId: id },
      _sum: { total: true },
    })

    const owner = outlet.users[0]

    return safeJson({
      id: outlet.id,
      name: outlet.name,
      address: outlet.address,
      phone: outlet.phone,
      accountType: outlet.accountType,
      createdAt: outlet.createdAt,
      updatedAt: outlet.updatedAt,
      owner: owner || null,
      stats: {
        userCount: outlet._count.users,
        transactionCount: outlet._count.transactions,
        productCount: outlet._count.products,
        customerCount: outlet._count.customers,
        categoryCount: outlet._count.categories,
        totalRevenue: revenueResult._sum.total || 0,
      },
      recentTransactions: outlet.transactions,
      setting: outlet.setting,
    })
  } catch (error) {
    console.error('Webmaster outlet detail error:', error)
    return safeJsonError('Terjadi kesalahan internal')
  }
}

// PUT: Update outlet
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser(request)
  if (!auth || auth.role !== 'WEBMASTER') {
    return unauthorized()
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { name, address, phone, accountType } = body

    const outlet = await db.outlet.findUnique({ where: { id } })
    if (!outlet) {
      return safeJsonError('Outlet tidak ditemukan', 404)
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (address !== undefined) updateData.address = address
    if (phone !== undefined) updateData.phone = phone
    if (accountType !== undefined) {
      if (!['free', 'pro', 'enterprise'].includes(accountType)) {
        return safeJsonError('Tipe akun tidak valid', 400)
      }
      updateData.accountType = accountType
    }

    const updated = await db.outlet.update({
      where: { id },
      data: updateData,
    })

    return safeJson({
      message: 'Outlet berhasil diperbarui',
      outlet: {
        id: updated.id,
        name: updated.name,
        address: updated.address,
        phone: updated.phone,
        accountType: updated.accountType,
      },
    })
  } catch (error) {
    console.error('Webmaster update outlet error:', error)
    return safeJsonError('Terjadi kesalahan internal')
  }
}

// DELETE: Delete an outlet
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser(request)
  if (!auth || auth.role !== 'WEBMASTER') {
    return unauthorized()
  }

  try {
    const { id } = await params

    const outlet = await db.outlet.findUnique({ where: { id } })
    if (!outlet) {
      return safeJsonError('Outlet tidak ditemukan', 404)
    }

    await db.outlet.delete({ where: { id } })

    return safeJson({ message: 'Outlet berhasil dihapus' })
  } catch (error) {
    console.error('Webmaster delete outlet error:', error)
    return safeJsonError('Terjadi kesalahan internal')
  }
}
