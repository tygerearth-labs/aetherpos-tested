import * as XLSX from 'xlsx'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getPlanFeatures } from '@/lib/plan-config'
import { buildDateFilter, resolvePlanType } from '@/lib/api-helpers'
import { safeJsonError } from '@/lib/safe-response'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    // Security: Only OWNER can export audit logs (contain sensitive user data)
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya pemilik yang dapat export audit log', 403)
    }
    const outletId = user.outletId

    // K2: Plan gating — only Pro/Enterprise can export Excel
    const outlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { accountType: true },
    })
    const accountType = resolvePlanType(outlet?.accountType)
    const features = getPlanFeatures(accountType)
    if (!features.exportExcel) {
      return safeJsonError('Fitur export Excel hanya tersedia untuk paket Pro ke atas. Upgrade sekarang!', 403)
    }

    const { searchParams } = request.nextUrl
    const action = searchParams.get('action') || ''
    const entityType = searchParams.get('entityType') || ''
    const dateFrom = searchParams.get('from') || ''
    const dateTo = searchParams.get('to') || ''
    const search = searchParams.get('search') || ''

    const where: Record<string, unknown> = { outletId }

    if (action && action !== 'ALL') {
      where.action = action
    }
    if (entityType && entityType !== 'ALL') {
      where.entityType = entityType
    }
    const dateFilter = buildDateFilter(dateFrom, dateTo)
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter
    }
    if (search) {
      where.OR = [
        { details: { contains: search } },
        { user: { name: { contains: search } } },
        { entityType: { contains: search } },
        { action: { contains: search } },
      ]
    }

    const data = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
      include: {
        user: {
          select: { name: true, email: true },
        },
      },
    })

    const rows = data.map((log) => ({
      'Timestamp': new Date(log.createdAt).toLocaleString('id-ID'),
      'User': log.user?.name || 'System',
      'Action': log.action,
      'Tipe Entity': log.entityType,
      'Entity ID': log.entityId || '-',
      'Detail': typeof log.details === 'string'
        ? (() => { try { return JSON.stringify(JSON.parse(log.details || '{}'), null, 2) } catch { return log.details || '-' } })()
        : (log.details || '-'),
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)

    // Set column widths for readability
    ws['!cols'] = [
      { wch: 22 },  // Timestamp
      { wch: 20 },  // User
      { wch: 14 },  // Action
      { wch: 16 },  // Tipe Entity
      { wch: 36 },  // Entity ID
      { wch: 60 },  // Detail
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Audit Logs')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.xlsx`

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Audit logs export error:', error)
    return safeJsonError('Failed to export audit logs')
  }
}
