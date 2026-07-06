/**
 * Auto-migration helper for AetherPOS (SQLite).
 * Handles schema-level data fixes that prisma db push doesn't cover.
 */

import { db } from '@/lib/db'

let _migrated = false

export async function ensureMigrated(): Promise<void> {
  if (_migrated) return
  _migrated = true

  try {
    // Fix: Products that have compositions but hasComposition=false
    // This can happen for products created before the hasComposition fix
    const fixed = await db.product.updateMany({
      where: {
        hasComposition: false,
        compositions: { some: {} },
      },
      data: { hasComposition: true },
    })
    if (fixed.count > 0) {
      console.log(`[db-migrate] ✅ Fixed hasComposition for ${fixed.count} product(s)`)
    }
  } catch (error) {
    console.error('[db-migrate] Error syncing hasComposition:', error)
  }

  console.log('[db-migrate] ✅ Auto-migration complete')
}