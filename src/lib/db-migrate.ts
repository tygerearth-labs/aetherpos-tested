/**
 * Auto-migration helper for AetherPOS (SQLite).
 * Placeholder — schema changes are handled via prisma db push.
 */

import { db } from '@/lib/db'

let _migrated = false

export async function ensureMigrated(): Promise<void> {
  if (_migrated) return
  _migrated = true
  console.log('[db-migrate] ✅ Auto-migration skipped (SQLite — use prisma db push)')
}