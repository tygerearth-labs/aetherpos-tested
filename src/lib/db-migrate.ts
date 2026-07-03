/**
 * Auto-migration helper for AetherPOS (PostgreSQL).
 * On Vercel, schema changes are handled via prisma migrate deploy.
 */

import { db } from '@/lib/db'

let _migrated = false

export async function ensureMigrated(): Promise<void> {
  if (_migrated) return
  _migrated = true
  console.log('[db-migrate] ✅ Migration handled by Vercel build (prisma migrate deploy)')
}