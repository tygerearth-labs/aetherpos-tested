-- ============================================================
-- AETHER POS — Initial PostgreSQL Migration
-- ============================================================
-- Creates all tables for a fresh Vercel deployment.
-- Run via: npx prisma db push  (recommended for first deploy)
--   or:   npx prisma migrate deploy
-- ============================================================

-- 1. OutletGroup
CREATE TABLE "OutletGroup" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "ownerId"   TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Outlet
CREATE TABLE "Outlet" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "address"       TEXT,
  "phone"         TEXT,
  "accountType"   TEXT NOT NULL DEFAULT 'free',
  "planExpiresAt" TIMESTAMP(3),
  "isMain"        BOOLEAN NOT NULL DEFAULT false,
  "groupId"       TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Outlet_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "OutletGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Outlet_groupId_idx" ON "Outlet"("groupId");

-- 3. User
CREATE TABLE "User" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "password"  TEXT NOT NULL,
  "role"      TEXT NOT NULL DEFAULT 'CREW',
  "outletId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "User_email_outletId_key" UNIQUE ("email", "outletId")
);

-- 4. Category
CREATE TABLE "Category" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "color"     TEXT NOT NULL DEFAULT 'zinc',
  "outletId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Category_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Category_name_outletId_key" UNIQUE ("name", "outletId")
);

-- 5. Product
CREATE TABLE "Product" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "name"           TEXT NOT NULL,
  "sku"            TEXT,
  "barcode"        TEXT,
  "hpp"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price"          DOUBLE PRECISION NOT NULL,
  "bruto"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "netto"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "stock"          INTEGER NOT NULL DEFAULT 0,
  "lowStockAlert"  INTEGER NOT NULL DEFAULT 10,
  "unit"           TEXT NOT NULL DEFAULT 'pcs',
  "image"          TEXT,
  "categoryId"     TEXT,
  "outletId"       TEXT NOT NULL,
  "hasVariants"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Product_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId")
    REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Product_name_outletId_key" UNIQUE ("name", "outletId")
);

-- 6. ProductVariant
CREATE TABLE "ProductVariant" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "sku"       TEXT,
  "barcode"   TEXT,
  "hpp"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price"     DOUBLE PRECISION NOT NULL,
  "stock"     INTEGER NOT NULL DEFAULT 0,
  "outletId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductVariant_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductVariant_name_productId_key" UNIQUE ("name", "productId")
);

-- 7. Customer
CREATE TABLE "Customer" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "name"       TEXT NOT NULL,
  "whatsapp"   TEXT NOT NULL,
  "totalSpend" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "points"     INTEGER NOT NULL DEFAULT 0,
  "outletId"   TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Customer_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Customer_whatsapp_outletId_key" UNIQUE ("whatsapp", "outletId")
);

-- 8. Transaction
CREATE TABLE "Transaction" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "invoiceNumber" TEXT NOT NULL UNIQUE,
  "subtotal"      DOUBLE PRECISION NOT NULL,
  "discount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pointsUsed"    INTEGER NOT NULL DEFAULT 0,
  "taxAmount"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total"         DOUBLE PRECISION NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "paidAmount"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "change"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "note"          TEXT,
  "outletId"      TEXT NOT NULL,
  "customerId"    TEXT,
  "userId"        TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Transaction_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId")
    REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 9. TransactionItem
CREATE TABLE "TransactionItem" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "productId"     TEXT,
  "variantId"     TEXT,
  "productName"   TEXT NOT NULL,
  "variantName"   TEXT,
  "price"         DOUBLE PRECISION NOT NULL,
  "qty"           INTEGER NOT NULL,
  "subtotal"      DOUBLE PRECISION NOT NULL,
  "itemDiscount"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hpp"           DOUBLE PRECISION NOT NULL,
  "transactionId" TEXT NOT NULL,

  CONSTRAINT "TransactionItem_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TransactionItem_variantId_fkey" FOREIGN KEY ("variantId")
    REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId")
    REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 10. LoyaltyLog
CREATE TABLE "LoyaltyLog" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "type"          TEXT NOT NULL,
  "points"        INTEGER NOT NULL,
  "description"   TEXT NOT NULL,
  "customerId"    TEXT NOT NULL,
  "transactionId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoyaltyLog_customerId_fkey" FOREIGN KEY ("customerId")
    REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LoyaltyLog_transactionId_fkey" FOREIGN KEY ("transactionId")
    REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 11. AuditLog
CREATE TABLE "AuditLog" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "action"     TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT,
  "details"    TEXT,
  "outletId"   TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 12. OutletSetting
CREATE TABLE "OutletSetting" (
  "id"                          TEXT NOT NULL PRIMARY KEY,
  "outletId"                    TEXT NOT NULL UNIQUE,
  "paymentMethods"              TEXT NOT NULL DEFAULT 'CASH,QRIS',
  "loyaltyEnabled"              BOOLEAN NOT NULL DEFAULT true,
  "loyaltyPointsPerAmount"      INTEGER NOT NULL DEFAULT 10000,
  "loyaltyPointValue"           INTEGER NOT NULL DEFAULT 100,
  "receiptBusinessName"         TEXT NOT NULL DEFAULT 'Aether POS',
  "receiptAddress"              TEXT NOT NULL DEFAULT '',
  "receiptPhone"                TEXT NOT NULL DEFAULT '',
  "receiptFooter"               TEXT NOT NULL DEFAULT 'Terima kasih atas kunjungan Anda!',
  "receiptLogo"                 TEXT NOT NULL DEFAULT '',
  "ppnEnabled"                  BOOLEAN NOT NULL DEFAULT false,
  "ppnRate"                     DOUBLE PRECISION NOT NULL DEFAULT 11,
  "manualDiscountEnabled"       BOOLEAN NOT NULL DEFAULT false,
  "receiptDoublePrintEnabled"   BOOLEAN NOT NULL DEFAULT false,
  "receiptMerchantCopyEnabled"  BOOLEAN NOT NULL DEFAULT true,
  "receiptCustomerCopyEnabled"  BOOLEAN NOT NULL DEFAULT true,
  "receiptBatchOrderEnabled"    BOOLEAN NOT NULL DEFAULT false,
  "themePrimaryColor"           TEXT NOT NULL DEFAULT 'emerald',
  "telegramBotToken"            TEXT,
  "telegramChatId"              TEXT,
  "notifyOnTransaction"         BOOLEAN NOT NULL DEFAULT true,
  "notifyOnCustomer"            BOOLEAN NOT NULL DEFAULT true,
  "notifyDailyReport"           BOOLEAN NOT NULL DEFAULT true,
  "notifyWeeklyReport"          BOOLEAN NOT NULL DEFAULT false,
  "notifyMonthlyReport"         BOOLEAN NOT NULL DEFAULT true,
  "notifyOnInsight"             BOOLEAN NOT NULL DEFAULT true,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutletSetting_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 13. Promo
CREATE TABLE "Promo" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "name"         TEXT NOT NULL,
  "type"         TEXT NOT NULL,
  "value"        DOUBLE PRECISION NOT NULL,
  "minPurchase"  DOUBLE PRECISION,
  "maxDiscount"  DOUBLE PRECISION,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "outletId"     TEXT NOT NULL,
  "buyMinQty"    INTEGER NOT NULL DEFAULT 0,
  "discountType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
  "categoryId"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Promo_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Promo_categoryId_fkey" FOREIGN KEY ("categoryId")
    REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 14. CrewPermission
CREATE TABLE "CrewPermission" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "userId"    TEXT NOT NULL UNIQUE,
  "pages"     TEXT NOT NULL DEFAULT 'pos',
  "outletId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrewPermission_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CrewPermission_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 15. Plan
CREATE TABLE "Plan" (
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

-- 16. OutletTransfer
CREATE TABLE "OutletTransfer" (
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

CREATE INDEX "OutletTransfer_fromOutletId_idx" ON "OutletTransfer"("fromOutletId");
CREATE INDEX "OutletTransfer_toOutletId_idx" ON "OutletTransfer"("toOutletId");
CREATE INDEX "OutletTransfer_groupId_idx" ON "OutletTransfer"("groupId");
CREATE INDEX "OutletTransfer_status_idx" ON "OutletTransfer"("status");

-- 17. TransferItem
CREATE TABLE "TransferItem" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "transferId"      TEXT NOT NULL,
  "productName"     TEXT NOT NULL,
  "productSku"      TEXT,
  "productBarcode"  TEXT,
  "quantity"        INTEGER NOT NULL,
  "hpp"             DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price"           DOUBLE PRECISION NOT NULL,
  "productSnapshot" TEXT,
  "outletId"        TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TransferItem_transferId_fkey" FOREIGN KEY ("transferId")
    REFERENCES "OutletTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TransferItem_outletId_fkey" FOREIGN KEY ("outletId")
    REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "TransferItem_transferId_idx" ON "TransferItem"("transferId");

-- 18. Foreign keys for OutletGroup → User (ownerId)
ALTER TABLE "OutletGroup"
  ADD CONSTRAINT "OutletGroup_ownerId_fkey" FOREIGN KEY ("ownerId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 19. Seed default plans
INSERT INTO "Plan" ("id", "name", "slug", "price", "duration", "features", "active", "sortOrder", "description")
VALUES
  ('plan-free-default', 'Free', 'free', 0, 1, '{"maxProducts":50,"maxCategories":10,"maxCrew":3,"multiOutlet":false,"analytics":false,"forecasting":false,"aiInsights":false,"transactionSummary":false,"bulkBarcode":false}', true, 0, 'Gratis untuk UMKM yang baru memulai'),
  ('plan-pro-default', 'Pro', 'pro', 99000, 1, '{"maxProducts":500,"maxCategories":50,"maxCrew":15,"multiOutlet":true,"analytics":true,"forecasting":true,"aiInsights":true,"transactionSummary":true,"bulkBarcode":true}', true, 1, 'Untuk bisnis yang sedang berkembang'),
  ('plan-enterprise-default', 'Enterprise', 'enterprise', 249000, 1, '{"maxProducts":9999,"maxCategories":999,"maxCrew":999,"multiOutlet":true,"analytics":true,"forecasting":true,"aiInsights":true,"transactionSummary":true,"bulkBarcode":true}', true, 2, 'Solusi lengkap untuk bisnis berskala besar');
