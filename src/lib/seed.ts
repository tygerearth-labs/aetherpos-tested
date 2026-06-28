import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

// ============================================================
// MASTER DATA — shared across all outlets
// ============================================================

const ALL_PRODUCTS = [
  // Minuman
  { name: 'Kopi Susu Gula Aren', sku: 'KS-001', hpp: 8000, price: 18000, bruto: 350, netto: 300, stock: 50, lowStockAlert: 10, categoryId: null },
  { name: 'Es Teh Manis', sku: 'ET-002', hpp: 3000, price: 8000, bruto: 300, netto: 250, stock: 100, lowStockAlert: 15, categoryId: null },
  { name: 'Jus Alpukat', sku: 'JA-003', hpp: 7000, price: 15000, bruto: 350, netto: 300, stock: 35, lowStockAlert: 10, categoryId: null },
  { name: 'Es Jeruk Segar', sku: 'EJ-004', hpp: 2500, price: 7000, bruto: 250, netto: 200, stock: 60, lowStockAlert: 15, categoryId: null },
  { name: 'Teh Tarik', sku: 'TT-005', hpp: 3500, price: 10000, bruto: 280, netto: 240, stock: 45, lowStockAlert: 10, categoryId: null },
  { name: 'Matcha Latte', sku: 'ML-006', hpp: 9000, price: 22000, bruto: 350, netto: 300, stock: 30, lowStockAlert: 8, categoryId: null },
  { name: 'Coklat Hangat', sku: 'CH-007', hpp: 5000, price: 14000, bruto: 300, netto: 250, stock: 40, lowStockAlert: 10, categoryId: null },
  { name: 'Es Kelapa Muda', sku: 'EK-008', hpp: 4000, price: 12000, bruto: 400, netto: 350, stock: 25, lowStockAlert: 8, categoryId: null },
  { name: 'Air Mineral 600ml', sku: 'AM-009', hpp: 2000, price: 5000, bruto: 650, netto: 600, stock: 200, lowStockAlert: 50, categoryId: null },
  { name: 'Teh Botol Sosro', sku: 'TB-010', hpp: 3000, price: 7000, bruto: 450, netto: 400, stock: 80, lowStockAlert: 20, categoryId: null },
  // Makanan
  { name: 'Nasi Goreng Spesial', sku: 'NG-011', hpp: 12000, price: 25000, bruto: 500, netto: 400, stock: 30, lowStockAlert: 5, categoryId: null },
  { name: 'Mie Ayam Bakso', sku: 'MA-012', hpp: 10000, price: 20000, bruto: 450, netto: 380, stock: 25, lowStockAlert: 8, categoryId: null },
  { name: 'Ayam Geprek', sku: 'AG-013', hpp: 11000, price: 22000, bruto: 400, netto: 350, stock: 20, lowStockAlert: 5, categoryId: null },
  { name: 'Indomie Goreng', sku: 'IG-014', hpp: 4000, price: 10000, bruto: 150, netto: 120, stock: 80, lowStockAlert: 20, categoryId: null },
  { name: 'Roti Bakar Coklat', sku: 'RB-015', hpp: 5000, price: 12000, bruto: 200, netto: 180, stock: 40, lowStockAlert: 10, categoryId: null },
  { name: 'Sate Ayam (10 tusuk)', sku: 'SA-016', hpp: 15000, price: 30000, bruto: 350, netto: 300, stock: 15, lowStockAlert: 5, categoryId: null },
  { name: 'Dimsum Ayam', sku: 'DM-017', hpp: 8000, price: 18000, bruto: 250, netto: 220, stock: 7, lowStockAlert: 8, categoryId: null },
  { name: 'Pisang Goreng Keju', sku: 'PG-018', hpp: 4500, price: 12000, bruto: 200, netto: 170, stock: 3, lowStockAlert: 10, categoryId: null },
  { name: 'Nasi Uduk Komplit', sku: 'NU-019', hpp: 9000, price: 20000, bruto: 500, netto: 400, stock: 20, lowStockAlert: 5, categoryId: null },
  { name: 'Bakso Urat', sku: 'BU-020', hpp: 10000, price: 22000, bruto: 450, netto: 400, stock: 18, lowStockAlert: 5, categoryId: null },
  // Snack & Tambahan
  { name: 'Kerupuk Kulit', sku: 'KK-021', hpp: 1500, price: 5000, bruto: 100, netto: 80, stock: 5, lowStockAlert: 10, categoryId: null },
  { name: 'Kentang Goreng', sku: 'KG-022', hpp: 5000, price: 15000, bruto: 200, netto: 180, stock: 35, lowStockAlert: 10, categoryId: null },
  { name: 'Nasi Kuning', sku: 'NK-023', hpp: 9000, price: 20000, bruto: 500, netto: 400, stock: 25, lowStockAlert: 8, categoryId: null },
  { name: 'Soto Betawi', sku: 'SB-024', hpp: 14000, price: 28000, bruto: 500, netto: 450, stock: 15, lowStockAlert: 5, categoryId: null },
  { name: 'Gado-gado', sku: 'GG-025', hpp: 10000, price: 22000, bruto: 400, netto: 350, stock: 12, lowStockAlert: 5, categoryId: null },
  { name: 'Rendang Padang', sku: 'RP-026', hpp: 16000, price: 35000, bruto: 300, netto: 250, stock: 10, lowStockAlert: 3, categoryId: null },
  { name: 'Pempek Palembang', sku: 'PP-027', hpp: 8000, price: 18000, bruto: 300, netto: 250, stock: 20, lowStockAlert: 5, categoryId: null },
  { name: 'Es Campur', sku: 'EC-028', hpp: 6000, price: 15000, bruto: 400, netto: 350, stock: 30, lowStockAlert: 8, categoryId: null },
  { name: 'Klepon', sku: 'KP-029', hpp: 3000, price: 10000, bruto: 150, netto: 120, stock: 40, lowStockAlert: 10, categoryId: null },
  { name: 'Martabak Manis', sku: 'MM-030', hpp: 12000, price: 28000, bruto: 400, netto: 350, stock: 8, lowStockAlert: 3, categoryId: null },
];

const CATEGORIES = [
  { name: 'Minuman', color: 'sky' },
  { name: 'Makanan', color: 'emerald' },
  { name: 'Snack', color: 'amber' },
];

const CUSTOMER_NAMES = [
  { name: 'Budi Santoso', whatsapp: '6281234560001' },
  { name: 'Siti Rahayu', whatsapp: '6281234560002' },
  { name: 'Ahmad Wijaya', whatsapp: '6281234560003' },
  { name: 'Dewi Lestari', whatsapp: '6281234560004' },
  { name: 'Rudi Hartono', whatsapp: '6281234560005' },
  { name: 'Lina Kusuma', whatsapp: '6281234560006' },
  { name: 'Hendra Pratama', whatsapp: '6281234560007' },
  { name: 'Yuni Astuti', whatsapp: '6281234560008' },
  { name: 'Agus Setiawan', whatsapp: '6281234560009' },
  { name: 'Rina Wulandari', whatsapp: '6281234560010' },
  { name: 'Fajar Nugroho', whatsapp: '6281234560011' },
  { name: 'Maya Sari', whatsapp: '6281234560012' },
  { name: 'Dani Firmansyah', whatsapp: '6281234560013' },
  { name: 'Putri Anggraini', whatsapp: '6281234560014' },
  { name: 'Irfan Hakim', whatsapp: '6281234560015' },
];

// ============================================================
// OUTLET SEED CONFIGS
// ============================================================

interface OutletSeedConfig {
  outletName: string;
  outletAddress: string;
  outletPhone: string;
  accountType: string;
  ownerEmail: string;
  ownerName: string;
  crewConfigs: { name: string; email: string; pages: string }[];
  productCount: number;
  customerCount: number;
  transactionCount: number;
  paymentMethods: string;
}

// Standalone: Free
const FREE_CONFIG: OutletSeedConfig = {
  outletName: 'Warung Bahari',
  outletAddress: 'Jl. Pasar Baru No. 45, Jakarta Selatan',
  outletPhone: '021-7654321',
  accountType: 'free',
  ownerEmail: 'owner@free.aether.com',
  ownerName: 'Pak Bahari',
  crewConfigs: [
    { name: 'Kasir Bahari 1', email: 'crew1@free.aether.com', pages: 'pos' },
  ],
  productCount: 10,
  customerCount: 5,
  transactionCount: 5,
  paymentMethods: 'CASH,QRIS',
};

// Main outlet of RNB Group: Pro
const MAIN_CONFIG: OutletSeedConfig = {
  outletName: 'RNB Kopi Sudirman',
  outletAddress: 'Jl. Sudirman No. 123, Jakarta Pusat',
  outletPhone: '021-2345678',
  accountType: 'pro',
  ownerEmail: 'owner@rnb.aether.com',
  ownerName: 'Bu Rina Nusantara',
  crewConfigs: [
    { name: 'Kasir RNB 1', email: 'crew1@rnb.aether.com', pages: 'pos,products,customers,transactions' },
    { name: 'Kasir RNB 2', email: 'crew2@rnb.aether.com', pages: 'pos,products' },
  ],
  productCount: 20,
  customerCount: 8,
  transactionCount: 12,
  paymentMethods: 'CASH,QRIS,DEBIT',
};

// Branch outlets
const BRANCH_1_CONFIG: OutletSeedConfig = {
  outletName: 'RNB Senayan',
  outletAddress: 'Jl. Asia Afrika No. 8, Jakarta Selatan',
  outletPhone: '021-5551234',
  accountType: 'pro',
  ownerEmail: 'owner.branch1@rnb.aether.com', // This owner is a CREW-level manager
  ownerName: 'Pak Joko Senayan',
  crewConfigs: [
    { name: 'Kasir Senayan 1', email: 'crew1@senayan.aether.com', pages: 'pos' },
  ],
  productCount: 15,
  customerCount: 5,
  transactionCount: 8,
  paymentMethods: 'CASH,QRIS',
};

const BRANCH_2_CONFIG: OutletSeedConfig = {
  outletName: 'RNB Kelapa Gading',
  outletAddress: 'Jl. Boulevard Raya No. 99, Jakarta Utara',
  outletPhone: '021-4567890',
  accountType: 'pro',
  ownerEmail: 'owner.branch2@rnb.aether.com',
  ownerName: 'Bu Ani Gading',
  crewConfigs: [
    { name: 'Kasir Gading 1', email: 'crew1@gading.aether.com', pages: 'pos,products' },
    { name: 'Kasir Gading 2', email: 'crew2@gading.aether.com', pages: 'pos' },
  ],
  productCount: 18,
  customerCount: 6,
  transactionCount: 10,
  paymentMethods: 'CASH,QRIS,DEBIT',
};

// Standalone: Enterprise
const ENTERPRISE_CONFIG: OutletSeedConfig = {
  outletName: 'Restoran Maharani',
  outletAddress: 'Jl. Gatot Subroto No. 88, Jakarta Selatan',
  outletPhone: '021-3456789',
  accountType: 'enterprise',
  ownerEmail: 'owner@enterprise.aether.com',
  ownerName: 'Haji Maharani',
  crewConfigs: [
    { name: 'Kasir Maharani 1', email: 'crew1@enterprise.aether.com', pages: 'pos,products,customers,transactions,audit-log,crew,settings' },
    { name: 'Kasir Maharani 2', email: 'crew2@enterprise.aether.com', pages: 'pos,products,customers' },
    { name: 'Kasir Maharani 3', email: 'crew3@enterprise.aether.com', pages: 'pos' },
  ],
  productCount: 25,
  customerCount: 10,
  transactionCount: 15,
  paymentMethods: 'CASH,QRIS,DEBIT',
};

// ============================================================
// MAIN SEED FUNCTION
// ============================================================

export async function seedDatabase() {
  console.log('🌱 Multi-Outlet Seeding — Aether POS...\n');

  // Check if already seeded
  const existingCount = await db.outlet.count();
  if (existingCount >= 5) {
    console.log('✅ Database already seeded (5 outlets found) — skipping.');
    return getCredentials();
  }

  // Reset database
  if (existingCount > 0) {
    console.log(`⚠️  Found ${existingCount} existing outlet(s) — resetting database...`);
    await db.loyaltyLog.deleteMany();
    await db.transactionItem.deleteMany();
    await db.transaction.deleteMany();
    await db.crewPermission.deleteMany();
    await db.auditLog.deleteMany();
    await db.promo.deleteMany();
    await db.customer.deleteMany();
    await db.productVariant.deleteMany();
    await db.product.deleteMany();
    await db.category.deleteMany();
    await db.outletSetting.deleteMany();
    await db.outletGroup.deleteMany(); // before user (has FK to owner)
    await db.user.deleteMany();
    await db.outlet.deleteMany();
    console.log('✅ Database reset complete.\n');
  }

  const hashedPassword = await bcrypt.hash('password123', 10);

  // 1. Seed standalone Free outlet
  console.log('\n━━━ Seeding: Warung Bahari (FREE — Standalone) ━━━');
  await seedOutlet(FREE_CONFIG, hashedPassword, 0);

  // 2. Seed main outlet (RNB Sudirman) FIRST — we need the owner to create the group
  console.log('\n━━━ Seeding: RNB Kopi Sudirman (PRO — Main) ━━━');
  const mainResult = await seedOutlet(MAIN_CONFIG, hashedPassword, 1, undefined, false);

  // 3. Create RNB Group with owner
  console.log('\n━━━ Creating RNB Group ━━━');
  const group = await db.outletGroup.create({
    data: {
      name: 'RNB Group',
      ownerId: mainResult.ownerId,
    },
  });
  console.log(`  ✅ Group: ${group.name} (id: ${group.id.slice(0, 8)}...)`);
  console.log(`  ✅ Group owner: ${MAIN_CONFIG.ownerEmail}`);

  // 4. Set main outlet as group member + isMain
  await db.outlet.update({
    where: { id: mainResult.outletId },
    data: { groupId: group.id, isMain: true },
  });
  console.log(`  ✅ "${MAIN_CONFIG.outletName}" set as main outlet of group`);

  // 5. Seed branch 1 (RNB Senayan)
  console.log('\n━━━ Seeding: RNB Senayan (PRO — Branch 1) ━━━');
  await seedOutlet(BRANCH_1_CONFIG, hashedPassword, 2, group.id, false);

  // 6. Seed branch 2 (RNB Kelapa Gading)
  console.log('\n━━━ Seeding: RNB Kelapa Gading (PRO — Branch 2) ━━━');
  await seedOutlet(BRANCH_2_CONFIG, hashedPassword, 3, group.id, false);

  // 7. Seed standalone Enterprise outlet
  console.log('\n━━━ Seeding: Restoran Maharani (ENTERPRISE — Standalone) ━━━');
  await seedOutlet(ENTERPRISE_CONFIG, hashedPassword, 4);

  // 8. Seed default plans
  await seedPlans();

  console.log('\n🎉 All outlets seeded successfully!');
  return getCredentials();
}

function getCredentials() {
  return {
    message: 'Seeded: 1 Free + 3 RNB Group + 1 Enterprise',
    credentials: {
      free: { email: 'owner@free.aether.com', password: 'password123', note: 'Standalone outlet' },
      rnbMain: { email: 'owner@rnb.aether.com', password: 'password123', note: 'RNB Group — Main outlet (see Multi Outlet)' },
      rnbBranch1: { email: 'owner.branch1@rnb.aether.com', password: 'password123', note: 'RNB Group — Branch Senayan' },
      rnbBranch2: { email: 'owner.branch2@rnb.aether.com', password: 'password123', note: 'RNB Group — Branch Kelapa Gading' },
      enterprise: { email: 'owner@enterprise.aether.com', password: 'password123', note: 'Standalone outlet' },
    },
  };
}

// ============================================================
// SEED PLANS
// ============================================================

async function seedPlans() {
  const plans = [
    { name: 'Free', slug: 'free', price: 0, duration: 1, sortOrder: 0, description: 'Untuk usaha kecil yang baru mulai', features: JSON.stringify({ maxProducts: 50, maxCategories: 5, productImage: false, maxCrew: 2, crewPermissions: false, maxCustomers: 100, loyaltyProgram: true, maxTransactionsPerMonth: 500, exportExcel: true, maxPromos: 2, promoTypes: ['PERCENTAGE'], auditLog: true, stockMovement: true, dashboardAnalytics: true, aiInsights: false, forecasting: false, maxOutlets: 1, offlineMode: true, multiOutlet: false, bulkUpload: false, transactionSummary: false, apiAccess: false, prioritySupport: false }) },
    { name: 'Pro', slug: 'pro', price: 99000, duration: 1, sortOrder: 1, description: 'Untuk bisnis yang sedang berkembang', features: JSON.stringify({ maxProducts: -1, maxCategories: -1, productImage: true, maxCrew: -1, crewPermissions: true, maxCustomers: -1, loyaltyProgram: true, maxTransactionsPerMonth: -1, exportExcel: true, maxPromos: -1, promoTypes: ['PERCENTAGE', 'NOMINAL'], auditLog: true, stockMovement: true, dashboardAnalytics: true, aiInsights: true, forecasting: true, maxOutlets: 5, offlineMode: true, multiOutlet: true, bulkUpload: true, transactionSummary: true, apiAccess: true, prioritySupport: true }) },
    { name: 'Enterprise', slug: 'enterprise', price: 249000, duration: 1, sortOrder: 2, description: 'Untuk bisnis skala besar dengan banyak cabang', features: JSON.stringify({ maxProducts: -1, maxCategories: -1, productImage: true, maxCrew: -1, crewPermissions: true, maxCustomers: -1, loyaltyProgram: true, maxTransactionsPerMonth: -1, exportExcel: true, maxPromos: -1, promoTypes: ['PERCENTAGE', 'NOMINAL'], auditLog: true, stockMovement: true, dashboardAnalytics: true, aiInsights: true, forecasting: true, maxOutlets: -1, offlineMode: true, multiOutlet: true, bulkUpload: true, transactionSummary: true, apiAccess: true, prioritySupport: true }) },
  ];

  for (const plan of plans) {
    await db.plan.upsert({
      where: { slug: plan.slug },
      update: plan,
      create: plan,
    });
  }
  console.log('  ✅ Plans seeded: Free, Pro, Enterprise');
}

// ============================================================
// PER-OUTLET SEED
// ============================================================

interface SeedResult {
  ownerId: string;
  outletId: string;
  outlet: string;
  [key: string]: any;
}

async function seedOutlet(
  config: OutletSeedConfig,
  hashedPassword: string,
  whatsappOffset: number,
  groupId?: string,
  isMain?: boolean,
): Promise<SeedResult> {
  return await db.$transaction(async (tx) => {
    const now = new Date();

    // 1. Create Outlet
    const outlet = await tx.outlet.create({
      data: {
        name: config.outletName,
        address: config.outletAddress,
        phone: config.outletPhone,
        accountType: config.accountType,
        groupId: groupId || null,
        isMain: isMain || false,
      },
    });
    console.log(`  ✅ Outlet: ${outlet.name} (id: ${outlet.id.slice(0, 8)}...)${isMain ? ' [MAIN]' : groupId ? ' [BRANCH]' : ' [STANDALONE]'}`);

    // 2. Create Owner
    const owner = await tx.user.create({
      data: {
        name: config.ownerName,
        email: config.ownerEmail,
        password: hashedPassword,
        role: 'OWNER',
        outletId: outlet.id,
      },
    });
    console.log(`  ✅ Owner: ${owner.email}`);

    // 3. Create Crew members with permissions
    const crews: any[] = [];
    for (const cc of config.crewConfigs) {
      const crew = await tx.user.create({
        data: {
          name: cc.name,
          email: cc.email,
          password: hashedPassword,
          role: 'CREW',
          outletId: outlet.id,
        },
      });
      crews.push(crew);

      await tx.crewPermission.create({
        data: {
          userId: crew.id,
          outletId: outlet.id,
          pages: cc.pages,
        },
      });
    }
    console.log(`  ✅ Crew: ${crews.length} member(s)`);

    // 4. Create Categories
    const categoryMap: Record<string, string> = {};
    for (const cat of CATEGORIES) {
      const category = await tx.category.create({
        data: { name: cat.name, color: cat.color, outletId: outlet.id },
      });
      categoryMap[cat.name] = category.id;
    }

    // 5. Create Products
    const products: any[] = [];
    for (let i = 0; i < config.productCount && i < ALL_PRODUCTS.length; i++) {
      const p = ALL_PRODUCTS[i];
      // Assign category based on index
      let catId: string | null = null;
      if (i < 10) catId = categoryMap['Minuman'] || null;
      else if (i < 20) catId = categoryMap['Makanan'] || null;
      else catId = categoryMap['Snack'] || null;

      const product = await tx.product.create({
        data: {
          name: p.name,
          sku: p.sku,
          hpp: p.hpp,
          price: p.price,
          bruto: p.bruto,
          netto: p.netto,
          stock: p.stock,
          lowStockAlert: p.lowStockAlert,
          categoryId: catId,
          outletId: outlet.id,
        },
      });
      products.push(product);

      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'PRODUCT',
          entityId: product.id,
          details: JSON.stringify({ name: product.name, price: product.price, stock: product.stock }),
          outletId: outlet.id,
          userId: owner.id,
        },
      });
    }
    console.log(`  ✅ Products: ${products.length} item(s)`);

    // 6. Create Customers (unique WhatsApp per outlet via offset)
    const customers: any[] = [];
    for (let i = 0; i < config.customerCount && i < CUSTOMER_NAMES.length; i++) {
      const c = CUSTOMER_NAMES[i];
      const whatsapp = `6281${String(2345600 + whatsappOffset * 100 + i).padStart(9, '0')}`;
      const customer = await tx.customer.create({
        data: { name: c.name, whatsapp, outletId: outlet.id },
      });
      customers.push(customer);
    }
    console.log(`  ✅ Customers: ${customers.length} person(s)`);

    // 7. Create Promos
    const promoTemplates = [
      { name: 'Diskon Hemat 10%', type: 'PERCENTAGE', value: 10, minPurchase: 50000, maxDiscount: 20000 },
      { name: 'Diskon Akhir Pekan 15%', type: 'PERCENTAGE', value: 15, minPurchase: 75000, maxDiscount: 30000 },
      { name: 'Potongan Rp 25.000', type: 'NOMINAL', value: 25000, minPurchase: 100000 },
      { name: 'Cashback Rp 10.000', type: 'NOMINAL', value: 10000, minPurchase: 30000 },
    ];
    const promos: any[] = [];
    const promoCount = config.accountType === 'free' ? 2 : 3;
    for (let i = 0; i < promoCount && i < promoTemplates.length; i++) {
      const pt = promoTemplates[i];
      const promo = await tx.promo.create({
        data: { ...pt, outletId: outlet.id },
      });
      promos.push(promo);
    }
    console.log(`  ✅ Promos: ${promos.length} active`);

    // 8. Create Outlet Setting
    await tx.outletSetting.create({
      data: {
        outletId: outlet.id,
        paymentMethods: config.paymentMethods,
        loyaltyEnabled: true,
        loyaltyPointsPerAmount: 10000,
        loyaltyPointValue: 100,
        receiptBusinessName: config.outletName,
        receiptAddress: config.outletAddress,
        receiptPhone: config.outletPhone,
        receiptFooter: 'Terima kasih atas kunjungan Anda!',
        themePrimaryColor: config.accountType === 'enterprise' ? 'amber' : config.accountType === 'pro' ? 'violet' : 'emerald',
      },
    });
    console.log(`  ✅ Outlet settings configured`);

    // 9. Create Transactions (spread across past 30 days)
    const transactions: any[] = [];
    const paymentMethods = config.paymentMethods.split(',');

    for (let t = 0; t < config.transactionCount; t++) {
      const daysAgo = Math.floor((t / config.transactionCount) * 30) + 1;
      const tDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      const customerIdx = t % customers.length;
      const customer = customers[customerIdx];
      const cashier = t % 2 === 0 ? owner : crews[t % crews.length];

      const itemCount = 1 + Math.floor((t * 7 + 3) % 3);
      const items: any[] = [];
      let subtotal = 0;

      for (let it = 0; it < itemCount; it++) {
        const prodIdx = (t * 3 + it * 7) % products.length;
        const product = products[prodIdx];
        const qty = 1 + Math.floor((t + it) % 3);
        const itemSubtotal = product.price * qty;
        items.push({
          productId: product.id,
          productName: product.name,
          price: product.price,
          qty,
          subtotal: itemSubtotal,
          hpp: product.hpp,
        });
        subtotal += itemSubtotal;
      }

      let discount = 0;
      if (promos.length > 0 && t % 4 === 0) {
        const promo = promos[t % promos.length];
        if (promo.type === 'PERCENTAGE') {
          discount = Math.min(subtotal * (promo.value / 100), promo.maxDiscount || Infinity);
        } else {
          discount = subtotal >= (promo.minPurchase || 0) ? promo.value : 0;
        }
      }

      const total = subtotal - discount;
      const paymentMethod = paymentMethods[t % paymentMethods.length];
      const paidAmount = paymentMethod === 'CASH' ? Math.ceil(total / 10000) * 10000 : total;
      const change = paymentMethod === 'CASH' ? paidAmount - total : 0;
      const invoiceNumber = `INV-${fmtDate(tDate)}-${1000 + whatsappOffset * 100 + t}`;

      const transaction = await tx.transaction.create({
        data: {
          invoiceNumber,
          subtotal,
          discount,
          pointsUsed: 0,
          total,
          paymentMethod,
          paidAmount,
          change,
          outletId: outlet.id,
          customerId: customer.id,
          userId: cashier.id,
          createdAt: tDate,
        },
      });

      await tx.transactionItem.createMany({
        data: items.map(item => ({ ...item, transactionId: transaction.id })),
      });

      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.qty } },
        });
      }

      const pointsEarned = Math.floor(total / 10000);
      if (pointsEarned > 0) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { totalSpend: { increment: total }, points: { increment: pointsEarned } },
        });
        await tx.loyaltyLog.create({
          data: {
            type: 'EARN',
            points: pointsEarned,
            description: `Earned ${pointsEarned} points from ${invoiceNumber}`,
            customerId: customer.id,
            transactionId: transaction.id,
          },
        });
      } else {
        await tx.customer.update({
          where: { id: customer.id },
          data: { totalSpend: { increment: total } },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'SALE',
          entityType: 'TRANSACTION',
          details: JSON.stringify({ invoice: invoiceNumber, total, payment: paymentMethod, customer: customer.name }),
          outletId: outlet.id,
          userId: cashier.id,
        },
      });

      transactions.push(transaction);
    }
    console.log(`  ✅ Transactions: ${transactions.length} record(s)`);

    return { ownerId: owner.id, outletId: outlet.id, outlet: outlet.name, accountType: config.accountType };
  });
}

// ============================================================
// HELPERS
// ============================================================

function fmtDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

// Auto-run when executed directly
seedDatabase().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});