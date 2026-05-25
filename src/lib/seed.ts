import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

// ============================================================
// MASTER DATA — shared across all outlets
// ============================================================

const ALL_PRODUCTS = [
  // Minuman
  { name: 'Kopi Susu Gula Aren', sku: 'KS-001', hpp: 8000, price: 18000, bruto: 350, netto: 300, stock: 50, lowStockAlert: 10, category: 'Minuman' },
  { name: 'Es Teh Manis', sku: 'ET-002', hpp: 3000, price: 8000, bruto: 300, netto: 250, stock: 100, lowStockAlert: 15, category: 'Minuman' },
  { name: 'Jus Alpukat', sku: 'JA-003', hpp: 7000, price: 15000, bruto: 350, netto: 300, stock: 35, lowStockAlert: 10, category: 'Minuman' },
  { name: 'Es Jeruk Segar', sku: 'EJ-004', hpp: 2500, price: 7000, bruto: 250, netto: 200, stock: 60, lowStockAlert: 15, category: 'Minuman' },
  { name: 'Teh Tarik', sku: 'TT-005', hpp: 3500, price: 10000, bruto: 280, netto: 240, stock: 45, lowStockAlert: 10, category: 'Minuman' },
  { name: 'Matcha Latte', sku: 'ML-006', hpp: 9000, price: 22000, bruto: 350, netto: 300, stock: 30, lowStockAlert: 8, category: 'Minuman' },
  { name: 'Coklat Hangat', sku: 'CH-007', hpp: 5000, price: 14000, bruto: 300, netto: 250, stock: 40, lowStockAlert: 10, category: 'Minuman' },
  { name: 'Es Kelapa Muda', sku: 'EK-008', hpp: 4000, price: 12000, bruto: 400, netto: 350, stock: 25, lowStockAlert: 8, category: 'Minuman' },
  { name: 'Air Mineral 600ml', sku: 'AM-009', hpp: 2000, price: 5000, bruto: 650, netto: 600, stock: 200, lowStockAlert: 50, category: 'Minuman' },
  { name: 'Teh Botol Sosro', sku: 'TB-010', hpp: 3000, price: 7000, bruto: 450, netto: 400, stock: 80, lowStockAlert: 20, category: 'Minuman' },
  // Makanan
  { name: 'Nasi Goreng Spesial', sku: 'NG-011', hpp: 12000, price: 25000, bruto: 500, netto: 400, stock: 30, lowStockAlert: 5, category: 'Makanan' },
  { name: 'Mie Ayam Bakso', sku: 'MA-012', hpp: 10000, price: 20000, bruto: 450, netto: 380, stock: 25, lowStockAlert: 8, category: 'Makanan' },
  { name: 'Ayam Geprek', sku: 'AG-013', hpp: 11000, price: 22000, bruto: 400, netto: 350, stock: 20, lowStockAlert: 5, category: 'Makanan' },
  { name: 'Indomie Goreng', sku: 'IG-014', hpp: 4000, price: 10000, bruto: 150, netto: 120, stock: 80, lowStockAlert: 20, category: 'Makanan' },
  { name: 'Roti Bakar Coklat', sku: 'RB-015', hpp: 5000, price: 12000, bruto: 200, netto: 180, stock: 40, lowStockAlert: 10, category: 'Snack' },
  { name: 'Sate Ayam (10 tusuk)', sku: 'SA-016', hpp: 15000, price: 30000, bruto: 350, netto: 300, stock: 15, lowStockAlert: 5, category: 'Makanan' },
  { name: 'Dimsum Ayam', sku: 'DM-017', hpp: 8000, price: 18000, bruto: 250, netto: 220, stock: 7, lowStockAlert: 8, category: 'Makanan' },
  { name: 'Pisang Goreng Keju', sku: 'PG-018', hpp: 4500, price: 12000, bruto: 200, netto: 170, stock: 3, lowStockAlert: 10, category: 'Snack' },
  { name: 'Nasi Uduk Komplit', sku: 'NU-019', hpp: 13000, price: 28000, bruto: 550, netto: 450, stock: 20, lowStockAlert: 5, category: 'Makanan' },
  { name: 'Bakso Urat', sku: 'BU-020', hpp: 10000, price: 22000, bruto: 450, netto: 400, stock: 18, lowStockAlert: 5, category: 'Makanan' },
  // Snack & Tambahan
  { name: 'Kerupuk Kulit', sku: 'KK-021', hpp: 1500, price: 5000, bruto: 100, netto: 80, stock: 5, lowStockAlert: 10, category: 'Snack' },
  { name: 'Kentang Goreng', sku: 'KG-022', hpp: 5000, price: 15000, bruto: 200, netto: 180, stock: 35, lowStockAlert: 10, category: 'Snack' },
  { name: 'Nasi Kuning', sku: 'NK-023', hpp: 9000, price: 20000, bruto: 500, netto: 400, stock: 25, lowStockAlert: 8, category: 'Makanan' },
  { name: 'Soto Betawi', sku: 'SB-024', hpp: 14000, price: 28000, bruto: 500, netto: 450, stock: 15, lowStockAlert: 5, category: 'Makanan' },
  { name: 'Gado-gado', sku: 'GG-025', hpp: 10000, price: 22000, bruto: 400, netto: 350, stock: 12, lowStockAlert: 5, category: 'Makanan' },
  { name: 'Rendang Padang', sku: 'RP-026', hpp: 16000, price: 35000, bruto: 300, netto: 250, stock: 10, lowStockAlert: 3, category: 'Makanan' },
  { name: 'Pempek Palembang', sku: 'PP-027', hpp: 8000, price: 18000, bruto: 300, netto: 250, stock: 20, lowStockAlert: 5, category: 'Makanan' },
  { name: 'Es Campur', sku: 'EC-028', hpp: 6000, price: 15000, bruto: 400, netto: 350, stock: 30, lowStockAlert: 8, category: 'Minuman' },
  { name: 'Klepon', sku: 'KP-029', hpp: 3000, price: 10000, bruto: 150, netto: 120, stock: 40, lowStockAlert: 10, category: 'Snack' },
  { name: 'Martabak Manis', sku: 'MM-030', hpp: 12000, price: 28000, bruto: 400, netto: 350, stock: 8, lowStockAlert: 3, category: 'Snack' },
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
// PLAN-SPECIFIC SEED CONFIGS
// ============================================================

interface PlanSeedConfig {
  outletName: string;
  outletAddress: string;
  outletPhone: string;
  accountType: string;
  ownerEmail: string;
  ownerName: string;
  crewCount: number;
  productCount: number;
  customerCount: number;
  promoCount: number;
  transactionCount: number;
  paymentMethods: string;
  crewPermissions: boolean;
}

const PLAN_CONFIGS: PlanSeedConfig[] = [
  {
    outletName: 'Warung Bahari (Free)',
    outletAddress: 'Jl. Pasar Baru No. 45, Jakarta Selatan',
    outletPhone: '021-7654321',
    accountType: 'free',
    ownerEmail: 'owner@free.aether.com',
    ownerName: 'Pak Bahari',
    crewCount: 1,
    productCount: 15,
    customerCount: 5,
    promoCount: 2,
    transactionCount: 5,
    paymentMethods: 'CASH,QRIS',
    crewPermissions: false,
  },
  {
    outletName: 'Kopi Nusantara (Pro)',
    outletAddress: 'Jl. Sudirman No. 123, Jakarta Pusat',
    outletPhone: '021-2345678',
    accountType: 'pro',
    ownerEmail: 'owner@pro.aether.com',
    ownerName: 'Bu Nusantara',
    crewCount: 3,
    productCount: 25,
    customerCount: 10,
    promoCount: 4,
    transactionCount: 10,
    paymentMethods: 'CASH,QRIS,DEBIT',
    crewPermissions: true,
  },
  {
    outletName: 'Restoran Maharani (Enterprise)',
    outletAddress: 'Jl. Gatot Subroto No. 88, Jakarta Selatan',
    outletPhone: '021-3456789',
    accountType: 'enterprise',
    ownerEmail: 'owner@enterprise.aether.com',
    ownerName: 'Haji Maharani',
    crewCount: 5,
    productCount: 30,
    customerCount: 15,
    promoCount: 5,
    transactionCount: 15,
    paymentMethods: 'CASH,QRIS,DEBIT',
    crewPermissions: true,
  },
];

// ============================================================
// MAIN SEED FUNCTION
// ============================================================

export async function seedDatabase() {
  console.log('🌱 Multi-Plan Seeding — Aether POS...\n');

  // Check if already seeded
  const existingCount = await db.outlet.count();
  if (existingCount >= 3) {
    console.log('✅ Database already seeded (3 outlets found) — skipping.');
    return { message: 'Database already seeded', outlets: existingCount };
  }

  // If some outlets exist but not all 3, reset to avoid partial state
  if (existingCount > 0) {
    console.log(`⚠️  Found ${existingCount} existing outlet(s) — resetting database first...`);
    // Delete in correct order to respect foreign keys
    await db.loyaltyLog.deleteMany();
    await db.transactionItem.deleteMany();
    await db.transaction.deleteMany();
    await db.crewPermission.deleteMany();
    await db.auditLog.deleteMany();
    await db.promo.deleteMany();
    await db.customer.deleteMany();
    await db.product.deleteMany();
    await db.category.deleteMany();
    await db.outletSetting.deleteMany();
    await db.user.deleteMany();
    await db.outlet.deleteMany();
    console.log('✅ Database reset complete.\n');
  }

  const hashedPassword = await bcrypt.hash('password123', 10);
  const results: Record<string, any> = {};

  for (const config of PLAN_CONFIGS) {
    console.log(`\n━━━ Seeding: ${config.outletName} (${config.accountType.toUpperCase()}) ━━━`);
    const result = await seedOutlet(config, hashedPassword);
    results[config.accountType] = result;
  }

  console.log('\n🎉 All plans seeded successfully!');
  return {
    message: 'All 3 plans seeded successfully',
    results,
    credentials: {
      free: { email: 'owner@free.aether.com', password: 'password123' },
      pro: { email: 'owner@pro.aether.com', password: 'password123' },
      enterprise: { email: 'owner@enterprise.aether.com', password: 'password123' },
    },
  };
}

// ============================================================
// PER-OUTLET SEED
// ============================================================

async function seedOutlet(config: PlanSeedConfig, hashedPassword: string) {
  return await db.$transaction(async (tx) => {
    const now = new Date();

    // 1. Create Outlet
    const outlet = await tx.outlet.create({
      data: {
        name: config.outletName,
        address: config.outletAddress,
        phone: config.outletPhone,
        accountType: config.accountType,
      },
    });
    console.log(`  ✅ Outlet: ${outlet.name} (id: ${outlet.id.slice(0, 8)}...)`);

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

    // 3. Create Crew members
    const crews: any[] = [];
    for (let i = 0; i < config.crewCount; i++) {
      const crewName = `Crew ${config.accountType.charAt(0).toUpperCase() + config.accountType.slice(1)} ${i + 1}`;
      const crewEmail = `crew${i + 1}@${config.accountType}.aether.com`;
      const crew = await tx.user.create({
        data: {
          name: crewName,
          email: crewEmail,
          password: hashedPassword,
          role: 'CREW',
          outletId: outlet.id,
        },
      });
      crews.push(crew);

      // Create crew permission (for Pro/Enterprise)
      if (config.crewPermissions) {
        await tx.crewPermission.create({
          data: {
            userId: crew.id,
            outletId: outlet.id,
            pages: 'pos,inventory,customers,transactions',
          },
        });
      }
    }
    console.log(`  ✅ Crew: ${crews.length} member(s)`);

    // 4. Create Products (subset based on plan)
    const products: any[] = [];
    for (let i = 0; i < config.productCount && i < ALL_PRODUCTS.length; i++) {
      const p = ALL_PRODUCTS[i];
      const product = await tx.product.create({
        data: { ...p, outletId: outlet.id },
      });
      products.push(product);

      // Audit log for product creation
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

    // 5. Create Customers
    const customers: any[] = [];
    for (let i = 0; i < config.customerCount && i < CUSTOMER_NAMES.length; i++) {
      const c = CUSTOMER_NAMES[i];
      // Offset WhatsApp number per outlet to avoid unique constraint violation
      const offset = config.accountType === 'free' ? 0 : config.accountType === 'pro' ? 100 : 200;
      const whatsapp = `6281${String(2345600 + offset + i).padStart(9, '0')}`;
      const customer = await tx.customer.create({
        data: { name: c.name, whatsapp, outletId: outlet.id },
      });
      customers.push(customer);
    }
    console.log(`  ✅ Customers: ${customers.length} person(s)`);

    // 6. Create Promos
    const promos: any[] = [];
    const promoTemplates = [
      { name: 'Diskon Hemat 10%', type: 'PERCENTAGE', value: 10, minPurchase: 50000, maxDiscount: 20000 },
      { name: 'Diskon Akhir Pekan 15%', type: 'PERCENTAGE', value: 15, minPurchase: 75000, maxDiscount: 30000 },
      { name: 'Potongan Rp 25.000', type: 'NOMINAL', value: 25000, minPurchase: 100000, maxDiscount: null },
      { name: 'Cashback Rp 10.000', type: 'NOMINAL', value: 10000, minPurchase: 30000, maxDiscount: null },
      { name: 'Beli 3 Diskon 10%', type: 'BUY_X_GET_DISCOUNT', value: 10, minPurchase: 0, maxDiscount: 25000, buyMinQty: 3, discountType: 'PERCENTAGE' },
      { name: 'Grand Opening 20%', type: 'PERCENTAGE', value: 20, minPurchase: 0, maxDiscount: 50000 },
    ];
    for (let i = 0; i < config.promoCount && i < promoTemplates.length; i++) {
      const pt = promoTemplates[i];
      // Only create NOMINAL promo for Pro/Enterprise (plan gating)
      if (pt.type === 'NOMINAL' && config.accountType === 'free') {
        // Replace with PERCENTAGE for free plan
        const alt = { ...pt, type: 'PERCENTAGE', value: 5, name: 'Diskon Member 5%' };
        const promo = await tx.promo.create({
          data: { ...alt, outletId: outlet.id },
        });
        promos.push(promo);
      } else {
        const promo = await tx.promo.create({
          data: { ...pt, outletId: outlet.id },
        });
        promos.push(promo);
      }
    }
    console.log(`  ✅ Promos: ${promos.length} active`); // Free has 2 promos (PERCENTAGE only)

    // 7. Create Outlet Setting
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

    // 8. Create Transactions (spread across past 30 days)
    const transactions: any[] = [];
    const paymentMethods = config.paymentMethods.split(',');
    const daysSpread = 30;

    for (let t = 0; t < config.transactionCount; t++) {
      const daysAgo = Math.floor((t / config.transactionCount) * daysSpread) + 1;
      const tDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

      // Random customer assignment
      const customerIdx = t % customers.length;
      const customer = customers[customerIdx];

      // Random cashier assignment
      const cashier = t % 2 === 0 ? owner : crews[t % crews.length];

      // Random items (1-3 items per transaction)
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

      // Apply promo occasionally (every 4th transaction for pro/enterprise)
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

      const invoiceNumber = `INV-${formatDate(tDate)}-${1000 + t}${getPlanPrefix(config.accountType)}`;

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

      // Create transaction items
      await tx.transactionItem.createMany({
        data: items.map(item => ({ ...item, transactionId: transaction.id })),
      });

      // Decrease stock
      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.qty } },
        });
      }

      // Loyalty points: floor(total / loyaltyPointsPerAmount)
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
            description: `Earned ${pointsEarned} points from transaction ${invoiceNumber}`,
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

      // Audit log for transaction (entityId is null — FK only references Product)
      await tx.auditLog.create({
        data: {
          action: 'SALE',
          entityType: 'TRANSACTION',
          details: JSON.stringify({
            invoice: invoiceNumber,
            total,
            payment: paymentMethod,
            customer: customer.name,
          }),
          outletId: outlet.id,
          userId: cashier.id,
        },
      });

      transactions.push(transaction);
    }
    console.log(`  ✅ Transactions: ${transactions.length} record(s)`);

    // 9. Create a REDEEM loyalty log for one customer (to test redeem flow)
    if (customers.length > 0 && transactions.length > 0) {
      const luckyCustomer = customers[0];
      const redeemPoints = 3;
      await tx.customer.update({
        where: { id: luckyCustomer.id },
        data: { points: { decrement: redeemPoints } },
      });
      await tx.loyaltyLog.create({
        data: {
          type: 'REDEEM',
          points: -redeemPoints,
          description: `Redeemed ${redeemPoints} points (Rp${redeemPoints * 100} discount)`,
          customerId: luckyCustomer.id,
          transactionId: transactions[0].id,
        },
      });
      console.log(`  ✅ Loyalty redeem logged for ${luckyCustomer.name}`);
    }

    return {
      outlet: outlet.name,
      accountType: config.accountType,
      owner: owner.email,
      crews: crews.map((c: any) => c.email),
      products: products.length,
      customers: customers.length,
      transactions: transactions.length,
      promos: promos.length,
    };
  });
}

// ============================================================
// HELPERS
// ============================================================

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function getPlanPrefix(plan: string): string {
  switch (plan) {
    case 'free': return 'F';
    case 'pro': return 'P';
    case 'enterprise': return 'E';
    default: return 'X';
  }
}
