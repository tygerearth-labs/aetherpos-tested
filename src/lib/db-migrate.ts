/**
 * Auto-migration helper for AetherPOS.
 * Safely adds new columns to existing tables if they don't exist yet.
 *
 * Supports both:
 *  - PostgreSQL (Neon / Vercel) — uses information_schema checks
 *  - SQLite (local dev) — uses PRAGMA table_info checks
 *
 * Runs lazily on first API call that needs the new columns.
 * Errors are logged but never thrown — the app should still work
 * even if migration fails (APIs use fallback defaults).
 */

import { db } from '@/lib/db'

let _migrated = false

/**
 * Check if we're running against PostgreSQL (Neon) or SQLite (local).
 */
function isPostgres(): boolean {
  const url = process.env.DATABASE_URL || ''
  return url.startsWith('postgresql://') || url.startsWith('postgres://')
}

/**
 * Check if a column exists in a table (PostgreSQL).
 */
async function columnExistsPg(table: string, column: string): Promise<boolean> {
  const result = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) as exists
  `
  return result[0]?.exists ?? false
}

/**
 * Check if a column exists in a table (SQLite).
 */
async function columnExistsSqlite(table: string, column: string): Promise<boolean> {
  const result = await db.$queryRaw<Array<{ name: string }>>`
    PRAGMA table_info(${table})
  `
  return result.some((row: any) => row.name === column)
}

/**
 * Add a column if it doesn't exist — works for both PostgreSQL and SQLite.
 */
async function addColumnIfMissing(
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  if (isPostgres()) {
    if (!(await columnExistsPg(table, column))) {
      await db.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition};`
      )
    }
  } else {
    if (!(await columnExistsSqlite(table, column))) {
      await db.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition};`
      )
    }
  }
}

/**
 * Ensures all schema additions from recent code changes are present
 * in the database. Runs at most once per process lifecycle.
 */
export async function ensureMigrated(): Promise<void> {
  if (_migrated) return
  _migrated = true // Mark early to prevent concurrent runs

  try {
    // Add manualDiscountEnabled to OutletSetting if missing
    await addColumnIfMissing('OutletSetting', 'manualDiscountEnabled', 'BOOLEAN NOT NULL DEFAULT false')

    // Add itemDiscount to TransactionItem if missing
    await addColumnIfMissing('TransactionItem', 'itemDiscount', isPostgres() ? 'DOUBLE PRECISION NOT NULL DEFAULT 0' : 'REAL NOT NULL DEFAULT 0')

    // Add double receipt print columns to OutletSetting if missing
    const receiptCols = [
      { name: 'receiptDoublePrintEnabled', def: 'BOOLEAN NOT NULL DEFAULT false' },
      { name: 'receiptMerchantCopyEnabled', def: 'BOOLEAN NOT NULL DEFAULT true' },
      { name: 'receiptCustomerCopyEnabled', def: 'BOOLEAN NOT NULL DEFAULT true' },
      { name: 'receiptBatchOrderEnabled', def: 'BOOLEAN NOT NULL DEFAULT false' },
    ]
    for (const col of receiptCols) {
      await addColumnIfMissing('OutletSetting', col.name, col.def)
    }

    console.log('[db-migrate] ✅ Auto-migration complete')
  } catch (error) {
    console.error('[db-migrate] ⚠️ Auto-migration failed (non-fatal):', error)
    // Don't throw — APIs will use fallback defaults
  }
}
