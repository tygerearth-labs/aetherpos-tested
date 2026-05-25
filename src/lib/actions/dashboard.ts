'use server';

import { db } from '@/lib/db';
import { getCurrentUser, requireOwner } from '@/lib/auth-utils';

export async function getDashboardStats() {
  const user = await getCurrentUser();
  const isOwner = user.role === 'OWNER';

  const outletId = user.outletId;

  // Total revenue — sum of all transaction totals
  const revenueResult = await db.transaction.aggregate({
    where: { outletId },
    _sum: { total: true },
  });
  const totalRevenue = revenueResult._sum.total ?? 0;

  // Total transactions
  const totalTransactions = await db.transaction.count({
    where: { outletId },
  });

  // Low stock products
  const lowStockProducts = await db.product.findMany({
    where: {
      outletId,
      stock: { lte: 10 },
    },
    orderBy: { stock: 'asc' },
    take: 50,
  });

  // Top 5 customers by totalSpend
  const topCustomers = await db.customer.findMany({
    where: { outletId },
    orderBy: { totalSpend: 'desc' },
    take: 5,
  });

  // Total profit — OWNER ONLY
  let totalProfit = 0;
  if (isOwner) {
    await requireOwner();
    const profitResult = await db.transactionItem.aggregate({
      where: {
        transaction: { outletId },
      },
      _sum: {
        subtotal: true,
      },
      // We need to calculate profit per item: (price - hpp) * qty
      // Since Prisma can't do computed sums easily, we'll fetch and calculate
    });

    // Alternative: fetch all items and calculate
    const items = await db.transactionItem.findMany({
      where: {
        transaction: { outletId },
      },
      select: {
        price: true,
        hpp: true,
        qty: true,
      },
    });

    totalProfit = items.reduce(
      (sum, item) => sum + (item.price - item.hpp) * item.qty,
      0
    );
  }

  return {
    totalRevenue,
    totalProfit: isOwner ? totalProfit : null,
    totalTransactions,
    lowStockProducts,
    topCustomers,
  };
}
