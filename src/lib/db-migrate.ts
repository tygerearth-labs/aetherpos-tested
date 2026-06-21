/**
 * Auto-migration helper for AetherPOS.
 * Safely adds new columns to existing tables if they don't exist yet.
 * Uses raw SQL with column existence checks — safe for PostgreSQL (Neon).
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
    // Add manualDiscountEnabled to OutletSetting if missing
    await db.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'OutletSetting'
            AND column_name = 'manualDiscountEnabled'
        ) THEN
          ALTER TABLE "OutletSetting" ADD COLUMN "manualDiscountEnabled" BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END $$;
    `)

    // Add itemDiscount to TransactionItem if missing
    await db.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'TransactionItem'
            AND column_name = 'itemDiscount'
        ) THEN
          ALTER TABLE "TransactionItem" ADD COLUMN "itemDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;
        END IF;
      END $$;
    `)

    console.log('[db-migrate] ✅ Auto-migration complete')
  } catch (error) {
    console.error('[db-migrate] ⚠️ Auto-migration failed (non-fatal):', error)
    // Don't throw — APIs will use fallback defaults
  }
}
