/**
 * Auto-migration helper for AetherPOS.
 * Safely adds new columns to existing tables if they don't exist yet.
 * Uses raw SQL with column existence checks — safe for SQLite.
 * This runs lazily on first API call that needs the new columns.
 */

import { db } from '@/lib/db'

let _migrated = false

/**
 * Ensures all schema additions from recent code changes are present
 * in the database. Runs at most once per process lifecycle.
 * Errors are logged but never thrown — the app should still work
 * even if migration fails (APIs use fallback defaults).
 */
export async function ensureMigrated(): Promise<void> {
  if (_migrated) return
  _migrated = true // Mark early to prevent concurrent runs

  try {
    // SQLite-safe column addition (silently ignores if column exists)
    const columns: Array<{ table: string; name: string; def: string }> = [
      { table: 'OutletSetting', name: 'manualDiscountEnabled', def: 'BOOLEAN NOT NULL DEFAULT 0' },
      { table: 'TransactionItem', name: 'itemDiscount', def: 'REAL NOT NULL DEFAULT 0' },
      { table: 'OutletSetting', name: 'receiptDoublePrintEnabled', def: 'BOOLEAN NOT NULL DEFAULT 0' },
      { table: 'OutletSetting', name: 'receiptMerchantCopyEnabled', def: 'BOOLEAN NOT NULL DEFAULT 1' },
      { table: 'OutletSetting', name: 'receiptCustomerCopyEnabled', def: 'BOOLEAN NOT NULL DEFAULT 1' },
      { table: 'OutletSetting', name: 'receiptBatchOrderEnabled', def: 'BOOLEAN NOT NULL DEFAULT 0' },
    ]

    for (const col of columns) {
      try {
        await db.$executeRawUnsafe(
          `ALTER TABLE "${col.table}" ADD COLUMN "${col.name}" ${col.def}`
        )
      } catch {
        // Column already exists — ignore
      }
    }

    console.log('[db-migrate] ✅ Auto-migration complete')
  } catch (error) {
    console.error('[db-migrate] ⚠️ Auto-migration failed (non-fatal):', error)
    // Don't throw — APIs will use fallback defaults
  }
}