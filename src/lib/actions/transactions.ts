'use server';

import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-utils';
import type { PaginatedResult, CheckoutInput } from '@/lib/types';

const PAGE_SIZE = 20;

function generateInvoiceNumber(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
  return `INV-${yyyy}${mm}${dd}-${random}`;
}

export async function getTransactions(
  page: number = 1,
  search?: string
): Promise<PaginatedResult<{
  id: string;
  invoiceNumber: string;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  paidAmount: number;
  change: number;
  customerName: string | null;
  createdAt: Date;
}>> {
  const user = await getCurrentUser();
  const skip = (page - 1) * PAGE_SIZE;

  const where = {
    outletId: user.outletId,
    ...(search
      ? {
          OR: [
            { invoiceNumber: { contains: search } },
            { customer: { name: { contains: search } } },
          ],
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        invoiceNumber: true,
        subtotal: true,
        discount: true,
        total: true,
        paymentMethod: true,
        paidAmount: true,
        change: true,
        customer: {
          select: { name: true },
        },
        createdAt: true,
      },
    }),
    db.transaction.count({ where }),
  ]);

  const mappedData = data.map((t) => ({
    id: t.id,
    invoiceNumber: t.invoiceNumber,
    subtotal: t.subtotal,
    discount: t.discount,
    total: t.total,
    paymentMethod: t.paymentMethod,
    paidAmount: t.paidAmount,
    change: t.change,
    customerName: t.customer?.name ?? null,
    createdAt: t.createdAt,
  }));

  return {
    data: mappedData,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}

export async function getTransactionDetail(id: string) {
  const user = await getCurrentUser();

  const transaction = await db.transaction.findFirst({
    where: { id, outletId: user.outletId },
    include: {
      items: true,
      customer: true,
      user: {
        select: { id: true, name: true },
      },
    },
  });

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  return transaction;
}

export async function processCheckout(data: CheckoutInput) {
  const user = await getCurrentUser();

  if (!data.items || data.items.length === 0) {
    throw new Error('Cart is empty');
  }

  const result = await db.$transaction(async (tx) => {
    // 1. Validate all products exist, have enough stock. Calculate subtotals.
    const productIds = data.items.map((item) => item.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const item of data.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new Error(`Product ${item.name} not found`);
      }
      if (product.stock < item.qty) {
        throw new Error(
          `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.qty}`
        );
      }
    }

    // 2. Calculate subtotal = sum of (price * qty)
    const subtotal = data.items.reduce(
      (sum, item) => sum + item.price * item.qty,
      0
    );

    // 3. Calculate discount from points (1 point = Rp 100 discount)
    const pointsToUse = data.pointsToUse || 0;
    const discount = pointsToUse * 100;

    if (discount > subtotal) {
      throw new Error(
        'Points discount cannot exceed subtotal'
      );
    }

    // 4. Calculate total = subtotal - discount
    const total = subtotal - discount;

    // 5. Calculate change = paidAmount - total (for CASH)
    let change = 0;
    if (data.paymentMethod === 'CASH') {
      if (data.paidAmount < total) {
        throw new Error(
          `Insufficient payment. Total: Rp ${total.toLocaleString('id-ID')}, Paid: Rp ${data.paidAmount.toLocaleString('id-ID')}`
        );
      }
      change = data.paidAmount - total;
    }

    // 6. Generate invoice number
    const invoiceNumber = generateInvoiceNumber();

    // Check for invoice uniqueness
    const existingInvoice = await tx.transaction.findUnique({
      where: { invoiceNumber },
    });
    if (existingInvoice) {
      throw new Error('Invoice number collision — please try again');
    }

    // 7. Create Transaction record
    const transaction = await tx.transaction.create({
      data: {
        invoiceNumber,
        subtotal,
        discount,
        pointsUsed: pointsToUse,
        total,
        paymentMethod: data.paymentMethod,
        paidAmount: data.paidAmount,
        change,
        note: data.note || null,
        outletId: user.outletId,
        customerId: data.customerId || null,
        userId: user.id,
      },
    });

    // 8. Batch create TransactionItem records
    await tx.transactionItem.createMany({
      data: data.items.map((item) => {
        const product = productMap.get(item.productId)!;
        return {
          productId: item.productId,
          productName: item.name,
          price: item.price,
          qty: item.qty,
          subtotal: item.price * item.qty,
          hpp: item.hpp,
          transactionId: transaction.id,
        };
      }),
    });

    // 9. Decrease stock for each product
    for (const item of data.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.qty } },
      });
    }

    // 10. Batch create AuditLog for stock decrease (action: SALE)
    await tx.auditLog.createMany({
      data: data.items.map((item) => {
        const product = productMap.get(item.productId)!;
        return {
          action: 'SALE' as const,
          entityType: 'PRODUCT' as const,
          entityId: item.productId,
          details: JSON.stringify({
            invoiceNumber,
            productName: item.name,
            quantitySold: item.qty,
            previousStock: product.stock,
            newStock: product.stock - item.qty,
          }),
          outletId: user.outletId,
          userId: user.id,
        };
      }),
    });

    // 11. Handle customer loyalty
    if (data.customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: data.customerId, outletId: user.outletId },
      });
      if (!customer) {
        throw new Error('Customer not found');
      }

      // Check points balance
      if (pointsToUse > customer.points) {
        throw new Error(
          `Insufficient points. Available: ${customer.points}, Requested: ${pointsToUse}`
        );
      }

      // Calculate earned points: Math.floor(total / 10000)
      const earnedPoints = Math.floor(total / 10000);

      // Combine customer updates into a single query
      const customerUpdateData: { totalSpend: { increment: number }; points?: { increment: number } | { decrement: number } } = {
        totalSpend: { increment: total },
      };
      let netPointsDelta = 0;
      if (earnedPoints > 0) netPointsDelta += earnedPoints;
      if (pointsToUse > 0) netPointsDelta -= pointsToUse;
      if (netPointsDelta !== 0) {
        customerUpdateData.points = netPointsDelta > 0
          ? { increment: netPointsDelta }
          : { decrement: Math.abs(netPointsDelta) };
      }

      await tx.customer.update({
        where: { id: data.customerId },
        data: customerUpdateData,
      });

      // Batch create loyalty logs
      const loyaltyLogs = [];
      if (earnedPoints > 0) {
        loyaltyLogs.push({
          type: 'EARN' as const,
          points: earnedPoints,
          description: `Earned ${earnedPoints} points from transaction ${invoiceNumber} (Rp ${total.toLocaleString('id-ID')})`,
          customerId: data.customerId,
          transactionId: transaction.id,
        });
      }
      if (pointsToUse > 0) {
        loyaltyLogs.push({
          type: 'REDEEM' as const,
          points: -pointsToUse,
          description: `Redeemed ${pointsToUse} points for Rp ${discount.toLocaleString('id-ID')} discount on transaction ${invoiceNumber}`,
          customerId: data.customerId,
          transactionId: transaction.id,
        });
      }
      if (loyaltyLogs.length > 0) {
        await tx.loyaltyLog.createMany({ data: loyaltyLogs });
      }
    }

    // 12. Return the complete transaction
    const completeTransaction = await tx.transaction.findUnique({
      where: { id: transaction.id },
      include: {
        items: true,
        customer: true,
        user: {
          select: { id: true, name: true },
        },
      },
    });

    return completeTransaction;
  }, { timeout: 15000 });

  return result;
}
