import { PrismaClient } from '@prisma/client'

/**
 * Get all outlet IDs that belong to the same owner (identified by email).
 * Owners may have accounts in multiple outlets with the same email.
 */
export async function getOwnerOutletIds(db: PrismaClient, email: string): Promise<string[]> {
  const owners = await db.user.findMany({
    where: { email, role: 'OWNER' },
    select: { outletId: true },
  })
  return owners.map(o => o.outletId)
}

/**
 * Check if a user (OWNER) has multiple outlets.
 * Returns the list of outlets if > 1, otherwise null.
 */
export async function getOwnerOutlets(db: PrismaClient, email: string, currentOutletId: string) {
  const outletIds = await getOwnerOutletIds(db, email)
  if (outletIds.length <= 1) {
    return null // Single outlet, no multi-outlet features needed
  }
  const outlets = await db.outlet.findMany({
    where: { id: { in: outletIds } },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  return { outletIds, outlets, primaryOutletId: currentOutletId }
}