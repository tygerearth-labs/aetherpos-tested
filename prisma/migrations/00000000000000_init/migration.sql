-- AetherPOS Initial Migration (PostgreSQL / Neon)
-- Created from Prisma schema

-- OutletGroup
CREATE TABLE "OutletGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletGroup_pkey" PRIMARY KEY ("id")
);

-- Outlet
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "accountType" TEXT NOT NULL DEFAULT 'free',
    "planExpiresAt" TIMESTAMP(3),
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- User
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CREW',
    "outletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- Category
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'zinc',
    "outletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- Product
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "hpp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL,
    "bruto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "lowStockAlert" INTEGER NOT NULL DEFAULT 10,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "image" TEXT,
    "categoryId" TEXT,
    "outletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hasVariants" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- ProductVariant
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "hpp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "outletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- Customer
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "totalSpend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "outletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- Transaction
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pointsUsed" INTEGER NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "change" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "outletId" TEXT NOT NULL,
    "customerId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- TransactionItem
CREATE TABLE "TransactionItem" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "variantName" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "qty" INTEGER NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "itemDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hpp" DOUBLE PRECISION NOT NULL,
    "transactionId" TEXT NOT NULL,

    CONSTRAINT "TransactionItem_pkey" PRIMARY KEY ("id")
);

-- LoyaltyLog
CREATE TABLE "LoyaltyLog" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyLog_pkey" PRIMARY KEY ("id")
);

-- AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "outletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- OutletSetting
CREATE TABLE "OutletSetting" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "paymentMethods" TEXT NOT NULL DEFAULT 'CASH,QRIS',
    "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "loyaltyPointsPerAmount" INTEGER NOT NULL DEFAULT 10000,
    "loyaltyPointValue" INTEGER NOT NULL DEFAULT 100,
    "receiptBusinessName" TEXT NOT NULL DEFAULT 'Aether POS',
    "receiptAddress" TEXT NOT NULL DEFAULT '',
    "receiptPhone" TEXT NOT NULL DEFAULT '',
    "receiptFooter" TEXT NOT NULL DEFAULT 'Terima kasih atas kunjungan Anda!',
    "receiptLogo" TEXT NOT NULL DEFAULT '',
    "ppnEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ppnRate" DOUBLE PRECISION NOT NULL DEFAULT 11,
    "manualDiscountEnabled" BOOLEAN NOT NULL DEFAULT false,
    "receiptDoublePrintEnabled" BOOLEAN NOT NULL DEFAULT false,
    "receiptMerchantCopyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "receiptCustomerCopyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "receiptBatchOrderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "themePrimaryColor" TEXT NOT NULL DEFAULT 'emerald',
    "telegramBotToken" TEXT,
    "telegramChatId" TEXT,
    "notifyOnTransaction" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnCustomer" BOOLEAN NOT NULL DEFAULT true,
    "notifyDailyReport" BOOLEAN NOT NULL DEFAULT true,
    "notifyWeeklyReport" BOOLEAN NOT NULL DEFAULT false,
    "notifyMonthlyReport" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnInsight" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletSetting_pkey" PRIMARY KEY ("id")
);

-- Promo
CREATE TABLE "Promo" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "minPurchase" DOUBLE PRECISION,
    "maxDiscount" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "outletId" TEXT NOT NULL,
    "buyMinQty" INTEGER NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promo_pkey" PRIMARY KEY ("id")
);

-- CrewPermission
CREATE TABLE "CrewPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pages" TEXT NOT NULL DEFAULT 'pos',
    "outletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewPermission_pkey" PRIMARY KEY ("id")
);

-- Plan
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration" INTEGER NOT NULL DEFAULT 1,
    "paymentLink" TEXT,
    "features" TEXT NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- OutletTransfer
CREATE TABLE "OutletTransfer" (
    "id" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "fromOutletId" TEXT NOT NULL,
    "toOutletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletTransfer_pkey" PRIMARY KEY ("id")
);

-- TransferItem
CREATE TABLE "TransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSku" TEXT,
    "productBarcode" TEXT,
    "quantity" INTEGER NOT NULL,
    "hpp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL,
    "productSnapshot" TEXT,
    "outletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferItem_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "OutletGroup_ownerId_key" ON "OutletGroup"("ownerId");
CREATE UNIQUE INDEX "User_email_outletId_key" ON "User"("email", "outletId");
CREATE UNIQUE INDEX "Category_name_outletId_key" ON "Category"("name", "outletId");
CREATE UNIQUE INDEX "Product_name_outletId_key" ON "Product"("name", "outletId");
CREATE UNIQUE INDEX "ProductVariant_name_productId_key" ON "ProductVariant"("name", "productId");
CREATE UNIQUE INDEX "Customer_whatsapp_outletId_key" ON "Customer"("whatsapp", "outletId");
CREATE UNIQUE INDEX "Transaction_invoiceNumber_key" ON "Transaction"("invoiceNumber");
CREATE UNIQUE INDEX "OutletSetting_outletId_key" ON "OutletSetting"("outletId");
CREATE UNIQUE INDEX "CrewPermission_userId_key" ON "CrewPermission"("userId");
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");
CREATE UNIQUE INDEX "OutletTransfer_transferNumber_key" ON "OutletTransfer"("transferNumber");

-- Indexes
CREATE INDEX "OutletTransfer_fromOutletId_idx" ON "OutletTransfer"("fromOutletId");
CREATE INDEX "OutletTransfer_toOutletId_idx" ON "OutletTransfer"("toOutletId");
CREATE INDEX "OutletTransfer_groupId_idx" ON "OutletTransfer"("groupId");
CREATE INDEX "OutletTransfer_status_idx" ON "OutletTransfer"("status");
CREATE INDEX "TransferItem_transferId_idx" ON "TransferItem"("transferId");

-- Foreign keys
ALTER TABLE "OutletGroup" ADD CONSTRAINT "OutletGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OutletGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransactionItem" ADD CONSTRAINT "TransactionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TransactionItem" ADD CONSTRAINT "TransactionItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TransactionItem" ADD CONSTRAINT "TransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyLog" ADD CONSTRAINT "LoyaltyLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyLog" ADD CONSTRAINT "LoyaltyLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutletSetting" ADD CONSTRAINT "OutletSetting_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Promo" ADD CONSTRAINT "Promo_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Promo" ADD CONSTRAINT "Promo_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrewPermission" ADD CONSTRAINT "CrewPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrewPermission" ADD CONSTRAINT "CrewPermission_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutletTransfer" ADD CONSTRAINT "OutletTransfer_fromOutletId_fkey" FOREIGN KEY ("fromOutletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutletTransfer" ADD CONSTRAINT "OutletTransfer_toOutletId_fkey" FOREIGN KEY ("toOutletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutletTransfer" ADD CONSTRAINT "OutletTransfer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OutletGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutletTransfer" ADD CONSTRAINT "OutletTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutletTransfer" ADD CONSTRAINT "OutletTransfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TransferItem" ADD CONSTRAINT "TransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "OutletTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransferItem" ADD CONSTRAINT "TransferItem_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: Default Plans
INSERT INTO "Plan" ("id", "name", "slug", "price", "duration", "features", "active", "sortOrder", "description", "createdAt", "updatedAt") VALUES
('plan_free', 'Free', 'free', 0, 1, '{"maxProducts":50,"maxCategories":5,"productImage":false,"maxCrew":2,"crewPermissions":false,"maxCustomers":100,"loyaltyProgram":true,"maxTransactionsPerMonth":500,"exportExcel":true,"maxPromos":2,"promoTypes":["PERCENTAGE"],"auditLog":true,"stockMovement":true,"dashboardAnalytics":true,"aiInsights":false,"forecasting":false,"maxOutlets":1,"offlineMode":true,"multiOutlet":false,"bulkUpload":false,"transactionSummary":false,"apiAccess":false,"prioritySupport":false}', true, 0, 'Untuk usaha kecil yang baru mulai', NOW(), NOW()),
('plan_pro', 'Pro', 'pro', 99000, 1, '{"maxProducts":-1,"maxCategories":-1,"productImage":true,"maxCrew":-1,"crewPermissions":true,"maxCustomers":-1,"loyaltyProgram":true,"maxTransactionsPerMonth":-1,"exportExcel":true,"maxPromos":-1,"promoTypes":["PERCENTAGE","NOMINAL"],"auditLog":true,"stockMovement":true,"dashboardAnalytics":true,"aiInsights":true,"forecasting":true,"maxOutlets":5,"offlineMode":true,"multiOutlet":true,"bulkUpload":true,"transactionSummary":true,"apiAccess":true,"prioritySupport":true}', true, 1, 'Untuk bisnis yang sedang berkembang', NOW(), NOW()),
('plan_enterprise', 'Enterprise', 'enterprise', 249000, 1, '{"maxProducts":-1,"maxCategories":-1,"productImage":true,"maxCrew":-1,"crewPermissions":true,"maxCustomers":-1,"loyaltyProgram":true,"maxTransactionsPerMonth":-1,"exportExcel":true,"maxPromos":-1,"promoTypes":["PERCENTAGE","NOMINAL"],"auditLog":true,"stockMovement":true,"dashboardAnalytics":true,"aiInsights":true,"forecasting":true,"maxOutlets":-1,"offlineMode":true,"multiOutlet":true,"bulkUpload":true,"transactionSummary":true,"apiAccess":true,"prioritySupport":true}', true, 2, 'Untuk bisnis skala besar dengan banyak cabang', NOW(), NOW());
