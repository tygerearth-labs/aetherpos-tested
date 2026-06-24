'use server';

import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth-utils';
import type { PaginatedResult } from '@/lib/types';

const PAGE_SIZE = 20;

export async function getAuditLogs(
  page: number = 1,
  filters?: {
    action?: string;
    entityType?: string;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<PaginatedResult<{
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: string | null;
  createdAt: Date;
  userName: string;
  productName: string | null;
}>> {
  const user = await getCurrentUser();
  const skip = (page - 1) * PAGE_SIZE;

  const where: Record<string, unknown> = {
    outletId: user.outletId,
  };

  if (filters?.action) {
    where.action = filters.action;
  }
  if (filters?.entityType) {
    where.entityType = filters.entityType;
  }
  if (filters?.dateFrom || filters?.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) {
      (where.createdAt as Record<string, unknown>).gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      (where.createdAt as Record<string, unknown>).lte = new Date(filters.dateTo);
    }
  }

  const [data, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
      include: {
        user: {
          select: { name: true },
        },
        product: {
          select: { name: true },
        },
      },
    }),
    db.auditLog.count({ where }),
  ]);

  const mappedData = data.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    details: log.details,
    createdAt: log.createdAt,
    userName: log.user.name,
    productName: log.product?.name ?? null,
  }));

  return {
    data: mappedData,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}
