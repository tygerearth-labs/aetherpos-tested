'use server';

import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-utils';
import { getPlanFeatures, isUnlimited } from '@/lib/plan-config';
import type { PaginatedResult } from '@/lib/types';

const PAGE_SIZE = 20;

export async function getProducts(
  page: number = 1,
  search?: string
): Promise<PaginatedResult<
  {
    id: string;
    name: string;
    sku: string | null;
    hpp: number;
    price: number;
    bruto: number;
    netto: number;
    stock: number;
    lowStockAlert: number;
    image: string | null;
  }
>> {
  const user = await getCurrentUser();
  const skip = (page - 1) * PAGE_SIZE;

  const where = {
    outletId: user.outletId,
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { sku: { contains: search } },
          ],
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
    }),
    db.product.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}

export async function createProduct(data: {
  name: string;
  sku?: string;
  hpp: number;
  price: number;
  bruto?: number;
  netto?: number;
  stock: number;
  lowStockAlert?: number;
  image?: string;
}) {
  const user = await getCurrentUser();

  // Check plan-based product limit
  const outlet = await db.outlet.findUnique({
    where: { id: user.outletId },
    select: { accountType: true },
  });
  const features = getPlanFeatures(outlet?.accountType || 'free');
  if (!isUnlimited(features.maxProducts)) {
    const count = await db.product.count({
      where: { outletId: user.outletId },
    });
    if (count >= features.maxProducts) {
      throw new Error(`Batas produk untuk paket ${(outlet?.accountType || 'free')} sudah tercapai (${features.maxProducts}). Upgrade ke Pro untuk unlimited!`);
    }
  }

  // Check unique name per outlet
  const existing = await db.product.findFirst({
    where: { name: data.name, outletId: user.outletId },
  });
  if (existing) {
    throw new Error('Product name already exists in this outlet');
  }

  const product = await db.$transaction(async (tx) => {
    const newProduct = await tx.product.create({
      data: {
        name: data.name,
        sku: data.sku || null,
        hpp: data.hpp,
        price: data.price,
        bruto: data.bruto || 0,
        netto: data.netto || 0,
        stock: data.stock,
        lowStockAlert: data.lowStockAlert || 10,
        image: data.image || null,
        outletId: user.outletId,
      },
    });

    await tx.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'PRODUCT',
        entityId: newProduct.id,
        details: JSON.stringify({
          name: newProduct.name,
          price: newProduct.price,
          stock: newProduct.stock,
        }),
        outletId: user.outletId,
        userId: user.id,
      },
    });

    return newProduct;
  });

  return product;
}

export async function updateProduct(
  id: string,
  data: {
    name?: string;
    sku?: string;
    hpp?: number;
    price?: number;
    bruto?: number;
    netto?: number;
    lowStockAlert?: number;
    image?: string | null;
  }
) {
  const user = await getCurrentUser();

  const existing = await db.product.findFirst({
    where: { id, outletId: user.outletId },
  });
  if (!existing) {
    throw new Error('Product not found');
  }

  // Check unique name if changed
  if (data.name && data.name !== existing.name) {
    const nameExists = await db.product.findFirst({
      where: { name: data.name, outletId: user.outletId },
    });
    if (nameExists) {
      throw new Error('Product name already exists in this outlet');
    }
  }

  const product = await db.product.update({
    where: { id },
    data,
  });

  return product;
}

export async function deleteProduct(id: string) {
  const user = await getCurrentUser();

  const existing = await db.product.findFirst({
    where: { id, outletId: user.outletId },
  });
  if (!existing) {
    throw new Error('Product not found');
  }

  await db.product.delete({
    where: { id },
  });

  return { success: true };
}

export async function restockProduct(id: string, qty: number) {
  const user = await getCurrentUser();

  if (qty <= 0) {
    throw new Error('Quantity must be greater than 0');
  }

  const existing = await db.product.findFirst({
    where: { id, outletId: user.outletId },
  });
  if (!existing) {
    throw new Error('Product not found');
  }

  const product = await db.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: { stock: { increment: qty } },
    });

    await tx.auditLog.create({
      data: {
        action: 'RESTOCK',
        entityType: 'PRODUCT',
        entityId: id,
        details: JSON.stringify({
          productName: updated.name,
          quantityAdded: qty,
          previousStock: existing.stock,
          newStock: updated.stock,
        }),
        outletId: user.outletId,
        userId: user.id,
      },
    });

    return updated;
  });

  return product;
}

export async function adjustStock(id: string, newStock: number) {
  const user = await getCurrentUser();

  if (newStock < 0) {
    throw new Error('Stock cannot be negative');
  }

  const existing = await db.product.findFirst({
    where: { id, outletId: user.outletId },
  });
  if (!existing) {
    throw new Error('Product not found');
  }

  const product = await db.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id },
      data: { stock: newStock },
    });

    await tx.auditLog.create({
      data: {
        action: 'ADJUSTMENT',
        entityType: 'STOCK',
        entityId: id,
        details: JSON.stringify({
          productName: updated.name,
          previousStock: existing.stock,
          newStock: updated.stock,
          adjustment: newStock - existing.stock,
        }),
        outletId: user.outletId,
        userId: user.id,
      },
    });

    return updated;
  });

  return product;
}
