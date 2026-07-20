import { NextRequest } from 'next/server'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { db } from '@/lib/db'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'

// SET-016 FIX: Known page whitelist for crew permission validation. Prevents
// typos like "pos,products,nonexistentpage" from being saved — those would
// grant access to a non-existent page (no crash, but inconsistent state).
// This mirrors the sidebar nav config (settings-page.tsx owner list).
const ALLOWED_CREW_PAGES = new Set([
  'dashboard', 'products', 'customers', 'pos', 'transactions',
  'purchase', 'transfer', 'audit-log', 'crew', 'settings',
])

// PUT /api/settings/permissions/[userId] — update crew permissions
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()

  // Only OWNER can manage permissions
  if (user.role !== 'OWNER') {
    return safeJsonError('Hanya pemilik yang dapat mengakses', 403)
  }

  try {
    const { userId } = await params

    // Verify crew belongs to same outlet
    const crew = await db.user.findUnique({
      where: { id: userId },
    })
    if (!crew || crew.outletId !== user.outletId || crew.role !== 'CREW') {
      return safeJsonError('Crew tidak ditemukan', 404)
    }

    const body = await request.json()
    const { pages } = body

    if (!pages || typeof pages !== 'string') {
      return safeJsonError('Pages wajib diisi', 400)
    }

    // SET-016 FIX: Validate that every page in the comma-separated list is a
    // known page. A malformed string like "pos,nonexistent" would otherwise
    // be persisted silently. Reject with 400 listing the invalid tokens.
    const requestedPages = pages.split(',').map((p) => p.trim()).filter(Boolean)
    if (requestedPages.length === 0) {
      return safeJsonError('Pages tidak boleh kosong', 400)
    }
    const invalidPages = requestedPages.filter((p) => !ALLOWED_CREW_PAGES.has(p))
    if (invalidPages.length > 0) {
      return safeJsonError(`Halaman tidak dikenal: ${invalidPages.join(', ')}. Yang tersedia: ${[...ALLOWED_CREW_PAGES].join(', ')}`, 400)
    }

    // Fetch the existing permission record (if any) so we can audit the delta.
    // SET-016 FIX: Previously this endpoint performed NO audit logging despite
    // granting/revoking page access (security-sensitive). Now we record the
    // from→to change for every permission update.
    const existingPerm = await db.crewPermission.findUnique({ where: { userId } })
    const normalizedPages = requestedPages.join(',')

    // Upsert crew permission
    const permission = await db.crewPermission.upsert({
      where: { userId },
      create: {
        userId,
        pages: normalizedPages,
        outletId: user.outletId,
      },
      update: {
        pages: normalizedPages,
      },
    })

    // SET-016 FIX: Audit-log the permission change. Compare against the
    // pre-update value so we only log when something actually changed.
    if (!existingPerm || existingPerm.pages !== permission.pages) {
      await safeAuditLog({
        action: 'UPDATE',
        entityType: 'CREW_PERMISSION',
        entityId: userId,
        details: JSON.stringify({
          crewName: crew.name,
          from: existingPerm?.pages ?? null,
          to: permission.pages,
        }),
        outletId: user.outletId,
        userId: user.id,
      })
    }

    return safeJson({
      userId: permission.userId,
      pages: permission.pages,
    })
  } catch (error) {
    console.error('PUT /api/settings/permissions/[userId] error:', error)
    return safeJsonError('Internal server error', 500)
  }
}
