/**
 * dual-profit.ts — Dual Financial Model helpers
 *
 * Implements the Dual Profit contract locked in docs/DOMAIN-INVARIANTS.md §3.4.
 *
 * Aether tracks TWO cost figures independently:
 *   - Estimated HPP (TransactionItem.hpp) — planning estimate from Product.hpp
 *   - Actual COGS (TransactionConsumption.materialCost) — real FEFO batch cost
 *
 * Every financial report endpoint SHOULD use these helpers to return:
 *   { revenue, estimatedHpp, actualCogs, estimatedGrossProfit, actualGrossProfit, variance }
 *
 * Variance interpretation:
 *   (+) positive = actual cost HIGHER than estimated (margin squeezed — supplier
 *       costs rose, or recipe yielded fewer units than planned)
 *   (-) negative = actual cost LOWER than estimated (margin better than planned —
 *       bulk discount, cheaper supplier, or recipe efficiency improved)
 */

import { Prisma, type PrismaClient } from '@prisma/client'

type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]
type DbOrTx = PrismaClient | TxClient

// ============================================================
// Types
// ============================================================

export interface DualProfit {
  /** Σ(Transaction.total) — excludes voided */
  revenue: number
  /** Σ(TransactionItem.hpp × qty) — Estimated HPP, excludes voided */
  estimatedHpp: number
  /** Σ(TransactionConsumption.materialCost) — Actual FEFO batch COGS, excludes voided */
  actualCogs: number
  /** revenue - estimatedHpp */
  estimatedGrossProfit: number
  /** revenue - actualCogs */
  actualGrossProfit: number
  /** estimatedGrossProfit - actualGrossProfit. (+) = actual cost higher */
  variance: number
}

// ============================================================
// Builder
// ============================================================

/**
 * Build the Dual Profit response shape from the three primary components.
 * Use this after fetching revenue, estimatedHpp, and actualCogs separately.
 */
export function buildDualProfit(
  revenue: number,
  estimatedHpp: number,
  actualCogs: number,
): DualProfit {
  const estimatedGrossProfit = revenue - estimatedHpp
  const actualGrossProfit = revenue - actualCogs
  const variance = estimatedGrossProfit - actualGrossProfit
  return {
    revenue,
    estimatedHpp,
    actualCogs,
    estimatedGrossProfit,
    actualGrossProfit,
    variance,
  }
}

// ============================================================
// Queries — single outlet
// ============================================================

/**
 * Compute the three Dual Profit components for a single outlet.
 *
 * Uses raw SQL with Prisma.sql fragments for efficiency (2 round-trips total,
 * no JS-side reduce over potentially thousands of TransactionItem rows).
 * Prisma.sql auto-translates placeholders for both SQLite (?) and Postgres ($N).
 *
 * @param db        Prisma client or transaction client
 * @param outletId  Outlet to aggregate
 * @param dateFilter  Prisma-style date filter applied to Transaction.createdAt
 *                    e.g. { gte: todayStart, lt: tomorrowStart } or {} for all-time
 * @param voidedTxIds  Transaction IDs to exclude (voided). Pass [] for none.
 */
export async function getDualProfitForOutlet(
  db: DbOrTx,
  outletId: string,
  dateFilter: { gte?: Date; lt?: Date; gt?: Date; lte?: Date } = {},
  voidedTxIds: string[] = [],
): Promise<DualProfit> {
  // Build conditional SQL fragments — Prisma.sql keeps this DB-agnostic
  const dateFragments: Prisma.Sql[] = []
  if (dateFilter.gte) dateFragments.push(Prisma.sql`AND t."createdAt" >= ${dateFilter.gte}`)
  if (dateFilter.lt) dateFragments.push(Prisma.sql`AND t."createdAt" < ${dateFilter.lt}`)
  if (dateFilter.gt) dateFragments.push(Prisma.sql`AND t."createdAt" > ${dateFilter.gt}`)
  if (dateFilter.lte) dateFragments.push(Prisma.sql`AND t."createdAt" <= ${dateFilter.lte}`)

  const voidFragment = voidedTxIds.length > 0
    ? Prisma.sql`AND t.id NOT IN (${Prisma.join(voidedTxIds)})`
    : Prisma.empty

  const dateFragment = dateFragments.length > 0
    ? Prisma.join(dateFragments, ' ')
    : Prisma.empty

  // Revenue + Estimated HPP in a single query (LEFT JOIN — items may be empty)
  const revenueHppRows = await db.$queryRaw<{ revenue: number; estimated_hpp: number }[]>`
    SELECT
      COALESCE(SUM(t.total), 0) AS revenue,
      COALESCE(SUM(ti.hpp * ti.qty), 0) AS estimated_hpp
    FROM "Transaction" t
    LEFT JOIN "TransactionItem" ti ON ti."transactionId" = t.id
    WHERE t."outletId" = ${outletId}
      ${dateFragment}
      ${voidFragment}
  `

  // Actual COGS — separate query (different join: TransactionConsumption)
  const cogsRows = await db.$queryRaw<{ actual_cogs: number }[]>`
    SELECT COALESCE(SUM(tc."materialCost"), 0) AS actual_cogs
    FROM "TransactionConsumption" tc
    JOIN "Transaction" t ON t.id = tc."transactionId"
    WHERE t."outletId" = ${outletId}
      ${dateFragment}
      ${voidFragment}
  `

  const revenue = Number(revenueHppRows[0]?.revenue ?? 0)
  const estimatedHpp = Number(revenueHppRows[0]?.estimated_hpp ?? 0)
  const actualCogs = Number(cogsRows[0]?.actual_cogs ?? 0)

  return buildDualProfit(revenue, estimatedHpp, actualCogs)
}

// ============================================================
// Queries — per outlet (multi-outlet / enterprise)
// ============================================================

/**
 * Compute Dual Profit for multiple outlets in a group.
 * Returns a Map<outletId, DualProfit>.
 *
 * @param db
 * @param outletIds  List of outlet IDs to aggregate
 * @param dateFilter  Date range applied to Transaction.createdAt
 * @param voidedByOutlet  Map<outletId, Set<voidedTxId>> — voided txs per outlet
 */
export async function getDualProfitPerOutlet(
  db: DbOrTx,
  outletIds: string[],
  dateFilter: { gte?: Date; lt?: Date } = {},
  voidedByOutlet: Map<string, Set<string>>,
): Promise<Map<string, DualProfit>> {
  const results = await Promise.all(
    outletIds.map(async (outletId) => {
      const voidedSet = voidedByOutlet.get(outletId)
      const voidedArr = voidedSet
        ? Array.from(voidedSet).filter(Boolean) as string[]
        : []
      const dp = await getDualProfitForOutlet(db, outletId, dateFilter, voidedArr)
      return [outletId, dp] as [string, DualProfit]
    }),
  )
  return new Map(results)
}

// ============================================================
// Per-transaction Actual COGS (for export / detail views)
// ============================================================

/**
 * Fetch Actual COGS per transaction for a set of transaction IDs.
 * Returns Map<transactionId, actualCogs>.
 *
 * Used by the Excel export to show Actual COGS alongside Estimated HPP per row.
 */
export async function getActualCogsByTransaction(
  db: DbOrTx,
  transactionIds: string[],
): Promise<Map<string, number>> {
  if (transactionIds.length === 0) return new Map()
  const rows = await db.transactionConsumption.groupBy({
    by: ['transactionId'],
    where: { transactionId: { in: transactionIds } },
    _sum: { materialCost: true },
  })
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(r.transactionId, r._sum.materialCost ?? 0)
  }
  return map
}
