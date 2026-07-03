import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { safeJson, safeJsonCreated, safeJsonError } from '@/lib/api/safe-response'

// GET /api/suppliers — list all suppliers for outlet
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const suppliers = await db.supplier.findMany({
      where: { outletId: user.outletId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { purchases: true } },
      },
    })

    return safeJson({ suppliers })
  } catch (error) {
    console.error('Suppliers GET error:', error)
    return safeJsonError('Failed to load suppliers')
  }
}

// POST /api/suppliers — create new supplier
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()

    const body = await request.json()
    const { name, phone, address, notes } = body

    if (!name || !name.trim()) {
      return safeJsonError('Supplier name is required', 400)
    }

    const supplier = await db.supplier.create({
      data: {
        name: name.trim(),
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        notes: notes?.trim() || null,
        outletId: user.outletId,
      },
    })

    return safeJsonCreated(supplier)
  } catch (error) {
    console.error('Suppliers POST error:', error)
    return safeJsonError('Failed to create supplier')
  }
}