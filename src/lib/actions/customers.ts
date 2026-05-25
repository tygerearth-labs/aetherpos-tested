'use server';

import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-utils';
import type { PaginatedResult } from '@/lib/types';

const PAGE_SIZE = 20;

export async function getCustomers(
  page: number = 1,
  search?: string
): Promise<PaginatedResult<{
  id: string;
  name: string;
  whatsapp: string;
  totalSpend: number;
  points: number;
  createdAt: Date;
}>> {
  const user = await getCurrentUser();
  const skip = (page - 1) * PAGE_SIZE;

  const where = {
    outletId: user.outletId,
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { whatsapp: { contains: search } },
          ],
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
    }),
    db.customer.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}

export async function createCustomer(data: { name: string; whatsapp: string }) {
  const user = await getCurrentUser();

  if (!data.name || !data.whatsapp) {
    throw new Error('Name and WhatsApp number are required');
  }

  // Validate whatsapp is unique globally
  const existing = await db.customer.findUnique({
    where: { whatsapp: data.whatsapp },
  });
  if (existing) {
    throw new Error('WhatsApp number already registered');
  }

  const customer = await db.customer.create({
    data: {
      name: data.name,
      whatsapp: data.whatsapp,
      outletId: user.outletId,
    },
  });

  return customer;
}

export async function updateCustomer(
  id: string,
  data: { name?: string; whatsapp?: string }
) {
  const user = await getCurrentUser();

  const existing = await db.customer.findFirst({
    where: { id, outletId: user.outletId },
  });
  if (!existing) {
    throw new Error('Customer not found');
  }

  // If whatsapp is being changed, check uniqueness
  if (data.whatsapp && data.whatsapp !== existing.whatsapp) {
    const whatsappExists = await db.customer.findUnique({
      where: { whatsapp: data.whatsapp },
    });
    if (whatsappExists) {
      throw new Error('WhatsApp number already registered');
    }
  }

  const customer = await db.customer.update({
    where: { id },
    data,
  });

  return customer;
}

export async function getCustomerLoyaltyHistory(customerId: string) {
  const user = await getCurrentUser();

  const customer = await db.customer.findFirst({
    where: { id: customerId, outletId: user.outletId },
  });
  if (!customer) {
    throw new Error('Customer not found');
  }

  const loyaltyLogs = await db.loyaltyLog.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
  });

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      whatsapp: customer.whatsapp,
      totalSpend: customer.totalSpend,
      points: customer.points,
    },
    loyaltyLogs,
  };
}
