-- ============================================================
-- AETHER POS — Safe Migration (Additive Only)
-- ============================================================
-- Migration: 2025062700000_multi_outlet_and_plans
--
-- AMAN 100% — hanya:
--   1. CREATE TABLE (tabel baru, IF NOT EXISTS)
--   2. ADD COLUMN (kolom baru di tabel lama, IF NOT EXISTS)
--
-- TIDAK ADA:
--   ✗ DROP TABLE
--   ✗ DROP COLUMN
--   ✗ ALTER COLUMN (tipe data)
--   ✗ DELETE / UPDATE data
--
-- Jalankan di Neon Console SQL Editor atau:
--   psql $DATABASE_URL -f migrations/2025062700000_multi_outlet_and_plans.sql
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────
-- 1. ADD COLUMNS to existing "Outlet" table
-- ────────────────────────────────────────────

-- isMain: apakah outlet ini adalah outlet utama dalam grup
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Outlet' AND column_name = 'isMain'
  ) THEN
    ALTER TABLE "Outlet" ADD COLUMN "isMain" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- groupId: referensi ke OutletGroup (null = standalone)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Outlet' AND column_name = 'groupId'
  ) THEN
    ALTER TABLE "Outlet" ADD COLUMN "groupId" TEXT;
  END IF;
END $$;

-- Index untuk groupId lookup
CREATE INDEX IF NOT EXISTS "Outlet_groupId_idx" ON "Outlet"("groupId");

-- ────────────────────────────────────────────
-- 2. CREATE TABLE "Plan" (baru)
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Plan" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "slug"        TEXT NOT NULL UNIQUE,
  "price"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "duration"    INTEGER NOT NULL DEFAULT 1,
  "paymentLink" TEXT,
  "features"    TEXT NOT NULL DEFAULT '{}',
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ────────────────────────────────────────────
-- 3. CREATE TABLE "OutletGroup" (baru)
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "OutletGroup" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "ownerId"   TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutletGroup_ownerId_fkey" FOREIGN KEY ("ownerId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ────────────────────────────────────────────
-- 4. CREATE TABLE "OutletTransfer" / Surat Jalan (baru)
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "OutletTransfer" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "transferNumber" TEXT NOT NULL UNIQUE,
  "fromOutletId"   TEXT NOT NULL,
  "toOutletId"     TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'DRAFT',
  "notes"          TEXT,
  "receivedById"   TEXT,
  "receivedAt"     TIMESTAMP(3),
  "createdById"    TEXT NOT NULL,
  "outletId"       TEXT NOT NULL,
  "groupId"        TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutletTransfer_fromOutletId_fkey" FOREIGN KEY ("fromOutletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OutletTransfer_toOutletId_fkey" FOREIGN KEY ("toOutletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OutletTransfer_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "OutletGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "OutletTransfer_createdById_fkey" FOREIGN KEY ("createdById")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OutletTransfer_receivedById_fkey" FOREIGN KEY ("receivedById")
    REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Indexes untuk query performa
CREATE INDEX IF NOT EXISTS "OutletTransfer_fromOutletId_idx" ON "OutletTransfer"("fromOutletId");
CREATE INDEX IF NOT EXISTS "OutletTransfer_toOutletId_idx" ON "OutletTransfer"("toOutletId");
CREATE INDEX IF NOT EXISTS "OutletTransfer_groupId_idx" ON "OutletTransfer"("groupId");
CREATE INDEX IF NOT EXISTS "OutletTransfer_status_idx" ON "OutletTransfer"("status");

-- ────────────────────────────────────────────
-- 5. CREATE TABLE "TransferItem" (baru)
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TransferItem" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "transferId"     TEXT NOT NULL,
  "productName"    TEXT NOT NULL,
  "productSku"     TEXT,
  "productBarcode" TEXT,
  "quantity"       INTEGER NOT NULL,
  "hpp"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price"          DOUBLE PRECISION NOT NULL,
  "outletId"       TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TransferItem_transferId_fkey" FOREIGN KEY ("transferId")
    REFERENCES "OutletTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TransferItem_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TransferItem_transferId_idx" ON "TransferItem"("transferId");

-- ────────────────────────────────────────────
-- 6. Seed default plans (hanya jika tabel kosong)
-- ────────────────────────────────────────────

INSERT INTO "Plan" ("id", "name", "slug", "price", "duration", "features", "active", "sortOrder", "description")
SELECT
  'plan-free-default',
  'Free',
  'free',
  0,
  1,
  '{"maxProducts":50,"maxCategories":10,"maxCrew":3,"multiOutlet":false,"analytics":false,"forecasting":false,"aiInsights":false,"transactionSummary":false,"bulkBarcode":false}',
  true,
  0,
  'Gratis untuk UMKM yang baru memulai'
WHERE NOT EXISTS (SELECT 1 FROM "Plan" WHERE "slug" = 'free');

INSERT INTO "Plan" ("id", "name", "slug", "price", "duration", "features", "active", "sortOrder", "description")
SELECT
  'plan-pro-default',
  'Pro',
  'pro',
  99000,
  1,
  '{"maxProducts":500,"maxCategories":50,"maxCrew":15,"multiOutlet":true,"analytics":true,"forecasting":true,"aiInsights":true,"transactionSummary":true,"bulkBarcode":true}',
  true,
  1,
  'Untuk bisnis yang sedang berkembang'
WHERE NOT EXISTS (SELECT 1 FROM "Plan" WHERE "slug" = 'pro');

INSERT INTO "Plan" ("id", "name", "slug", "price", "duration", "features", "active", "sortOrder", "description")
SELECT
  'plan-enterprise-default',
  'Enterprise',
  'enterprise',
  249000,
  1,
  '{"maxProducts":9999,"maxCategories":999,"maxCrew":999,"multiOutlet":true,"analytics":true,"forecasting":true,"aiInsights":true,"transactionSummary":true,"bulkBarcode":true}',
  true,
  2,
  'Solusi lengkap untuk bisnis berskala besar'
WHERE NOT EXISTS (SELECT 1 FROM "Plan" WHERE "slug" = 'enterprise');

COMMIT;