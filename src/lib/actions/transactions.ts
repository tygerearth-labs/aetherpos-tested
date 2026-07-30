'use server';

import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/auth-utils';
import type { PaginatedResult, CheckoutInput } from '@/lib/types';
import { withInsensitiveMode } from '@/lib/api/api-helpers';
import { emitAuditEvent, buildSaleEvent } from '@/lib/audit-v2';

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
          OR: withInsensitiveMode([
            { invoiceNumber: { contains: search } },
            { customer: { name: { contains: search } } },
          ]) as Record<string, unknown>[],
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
    //    productName: server-verified from DB
    //    productSku: snapshotted from DB
    //    hpp: snapshotted from DB
    //    price: kept from client (effective selling price)
    await tx.transactionItem.createMany({
      data: data.items.map((item) => {
        const product = productMap.get(item.productId)!;

        // Server-side name verification — log if client name differs from DB
        const verifiedProductName = product.name
        if (item.name && item.name !== product.name) {
          console.warn(
            `[processCheckout] productName mismatch: client="${item.name}" db="${product.name}" productId=${product.id}`
          )
        }

        return {
          productId: item.productId,
          productName: verifiedProductName,
          productSku: product.sku || null,
          price: item.price,
          qty: item.qty,
          subtotal: item.price * item.qty,
          hpp: product.hpp,
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

    // 10. AuditLog V2 — ONE SALE event per transaction (NOT one row per item).
    //    The per-item createMany was the main source of LEGACY spam: a 10-item
    //    cart produced 10 "SALE · PRODUCT" LEGACY rows. Now we emit a single
    //    structured SALE event after the customer loyalty step so we can
    //    include customerName + points in the same event (see step 11 below).

    // 11. Handle customer loyalty
    let customerName: string | null = null;
    let earnedPoints = 0;
    if (data.customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: data.customerId, outletId: user.outletId },
      });
      if (!customer) {
        throw new Error('Customer not found');
      }
      customerName = customer.name;

      // Check points balance
      if (pointsToUse > customer.points) {
        throw new Error(
          `Insufficient points. Available: ${customer.points}, Requested: ${pointsToUse}`
        );
      }

      // P0-5: Use OutletSetting.loyaltyPointsPerAmount instead of hardcoded 10000
      const outletSetting = await db.outletSetting.findUnique({
        where: { outletId },
        select: { loyaltyPointsPerAmount: true },
      });
      const pointsPerAmount = outletSetting?.loyaltyPointsPerAmount || 10000;
      earnedPoints = Math.floor(total / pointsPerAmount);

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

    // 11b. AuditLog V2 — emit ONE structured SALE event for the whole
    //      transaction. Replaces the old per-item createMany that produced
    //      N LEGACY rows for an N-item cart.
    await emitAuditEvent(
      tx,
      buildSaleEvent({
        transactionId: transaction.id,
        invoiceNumber,
        items: data.items.map((item) => {
          const product = productMap.get(item.productId)!;
          return {
            productName: product.name,
            productSku: product.sku || null,
            qty: item.qty,
            price: item.price,
            subtotal: item.price * item.qty,
          };
        }),
        subtotal,
        discount,
        taxAmount: 0,
        total,
        paymentMethod: data.paymentMethod,
        paidAmount: data.paidAmount,
        change,
        customerName,
        customerId: data.customerId || null,
        pointsEarned: earnedPoints > 0 ? earnedPoints : undefined,
        pointsUsed: pointsToUse > 0 ? pointsToUse : undefined,
        outletId: user.outletId!,
        userId: user.id,
      }),
    );

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
