-- ============================================================
-- AETHER POS — Migration: Add productSnapshot to TransferItem
-- ============================================================
-- Date: 2025-06-28
--
-- Adds the "productSnapshot" column to the "TransferItem" table.
-- This column stores a JSON string containing complete product data
-- (image, unit, category, variants, etc.) at the time of transfer,
-- so the receiving branch can fully recreate the product.
--
-- SAFE: Only adds a nullable column. No data loss possible.
--
-- Run in Neon Console SQL Editor, Supabase SQL Editor, or:
--   psql $DATABASE_URL -f prisma/migrations/2025062800000_add_product_snapshot/migration.sql
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'TransferItem' AND column_name = 'productSnapshot'
  ) THEN
    ALTER TABLE "TransferItem" ADD COLUMN "productSnapshot" TEXT;
    RAISE NOTICE 'Column "productSnapshot" added to "TransferItem"';
  ELSE
    RAISE NOTICE 'Column "productSnapshot" already exists — skipping';
  END IF;
END $$;

COMMIT;