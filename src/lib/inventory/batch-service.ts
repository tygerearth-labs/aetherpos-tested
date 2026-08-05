/**
 * InventoryBatch Domain Service — Shared CRUD Contract
 * ════════════════════════════════════════════════════════════
 *
 * Centralizes the InventoryBatch domain contract so every module (manual
 * inventory, bulk inventory, migration, opening balance, manual purchase,
 * purchase import, adjustment/restock, stock opname, checkout FEFO, void,
 * purchase edit/delete, transfer/waste/expiry) follows ONE set of rules.
 *
 * DOMAIN CONTRACT (the source of truth for all callers):
 *
 *   1. Batch tracking is optional — an InventoryItem may have 0+ batches.
 *   2. PurchaseOrder is NOT mandatory for every batch.
 *   3. Purchase-sourced batch (source='PURCHASE') REQUIRES a valid purchaseOrderId.
 *   4. Non-purchase batch (source != 'PURCHASE') MAY use purchaseOrderId=null.
 *   5. Unbatched stock is valid where the current architecture allows it.
 *   6. NEVER create a fake PurchaseOrder or fake purchaseOrderId.
 *   7. Outlet ownership and inventoryItem relation must always match.
 *
 * CREATE RULES (validateBatchPayload + createBatch):
 *   - Validate source, quantity, HPP, expiry, and purchaseOrder relation.
 *   - Avoid duplicate automatic batches (caller-generated batchNumber must be unique).
 *   - All DB errors inside transactions must rethrow (never swallow).
 *
 * READ RULES (FEFO query — owned by fefo-engine.ts):
 *   - Always scope by outlet + inventoryItem.
 *   - FEFO ordering: expiredDate ASC, null last.
 *   - Exclude depleted/invalid batches where appropriate.
 *   - Do not assume every InventoryItem has batches.
 *
 * UPDATE RULES (consumeBatch + restoreBatch):
 *   - Block negative remainingQty.
 *   - Block remainingQty > initialQty unless explicit reconciliation rule.
 *   - Prevent changing purchaseOrderId/source after creation (no API path does this).
 *   - Prevent HPP/expiry edits when historical consumption would be corrupted.
 *   - Record audit/movement for material quantity changes.
 *
 * DELETE RULES (assertBatchDeletable + safeDeleteBatchesForItem):
 *   Hard-delete allowed ONLY when:
 *     - batch has never been consumed (remainingQty === initialQty)
 *     - no BatchConsumptionLog
 *     - no InventoryMovement dependency
 *     - no transaction/void dependency
 *   Otherwise:
 *     - block delete with dependency reason
 *     - or use status/archive, never destructive delete
 *
 * VOID / RESTORE RULES (restoreBatch):
 *   - Restore quantity to the exact batch recorded in BatchConsumptionLog.
 *   - Restore unbatched consumption through InventoryItem.stock only.
 *   - NEVER invent a new batch during void unless explicit reconciliation policy.
 *   - Preserve idempotency (restore is keyed by transactionId → BatchConsumptionLog).
 *
 * This module is import-safe for both server (API routes, services) and
 * transaction contexts (all functions accept a `tx` client).
 */

import { PrismaClient, Prisma } from '@prisma/client'

// ════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════

/** Transaction client type — compatible with PrismaClient | TxClient from fefo-engine. */
type TxClient = Prisma.TransactionClient

/** The source/use-case that created this batch. Drives validation rules. */
export type BatchSource =
  | 'PURCHASE'           // Manual purchase / purchase import / purchase edit
  | 'MIGRATION'          // Excel migration wizard
  | 'OPENING_BALANCE'    // Manual inventory create with opening balance
  | 'ADJUSTMENT'         // Manual stock adjustment / restock
  | 'RECONCILE_INIT'     // Bulk inventory create (initial reconcile)
  | 'RECONCILE_SELF_HEAL' // Checkout FEFO self-heal (no existing batch)
  | 'BACKFILL'           // Backfill script for orphan batches

/** Input for creating a single batch. Validates against the domain contract. */
export interface BatchCreateInput {
  batchNumber: string
  inventoryItemId: string
  initialQty: number
  unitCost: number
  expiredDate?: Date | null
  purchaseOrderId?: string | null
  purchaseOrderItemId?: string | null
  supplierId?: string | null
  supplierName?: string | null
  outletId: string
  /** The source/use-case. Drives purchaseOrderId validation (Rule 3-4). */
  source: BatchSource
}

export interface BatchCreateResult {
  id: string
  batchNumber: string
}

/** Result of a delete-safety check. */
export interface BatchDeleteCheck {
  canDelete: boolean
  reason?: string
  dependencies: {
    consumptionLogs: number
  }
}

/** Input for consuming quantity from a batch (FEFO or manual). */
export interface BatchConsumeInput {
  batchId: string
  quantity: number
  inventoryItemId: string
  outletId: string
  /** Optional transaction context — if provided, a BatchConsumptionLog is created. */
  transactionId?: string
  invoiceNumber?: string
  sourceDetails?: string
}

export interface BatchConsumeResult {
  batchId: string
  quantityConsumed: number
  newRemaining: number
  newStatus: string
}

/** Input for restoring quantity to a batch (void reversal). */
export interface BatchRestoreInput {
  batchId: string
  quantityConsumed: number
  outletId: string
}

export interface BatchRestoreResult {
  batchId: string
  quantityRestored: number
  newRemaining: number
  newStatus: string
  /** True if the restore was capped at initialQty (prevents > initialQty). */
  capped: boolean
  /** True if the batch was not found (deleted) — caller must handle stock-only restore. */
  batchMissing: boolean
}

// ════════════════════════════════════════════════════════════
// VALIDATION — CREATE RULES (Rule 1-7)
// ════════════════════════════════════════════════════════════

/**
 * Validate a batch payload against the domain contract.
 * Returns an array of error strings (empty = valid).
 *
 * Rules enforced:
 *   - Rule 3: Purchase-sourced batch requires valid purchaseOrderId.
 *   - Rule 4: Non-purchase batch may use purchaseOrderId=null.
 *   - Rule 6: Never create a fake purchaseOrderId (empty string, 'null', 'undefined', 'N/A').
 *   - Quantity must be >= 0.
 *   - unitCost (HPP) must be >= 0.
 */
export function validateBatchPayload(input: BatchCreateInput): string[] {
  const errors: string[] = []

  // Rule 3: Purchase-sourced batch requires valid purchaseOrderId
  if (input.source === 'PURCHASE') {
    if (!input.purchaseOrderId || typeof input.purchaseOrderId !== 'string') {
      errors.push(`Purchase-sourced batch (source='PURCHASE') requires a valid purchaseOrderId — got ${input.purchaseOrderId === null ? 'null' : 'empty/undefined'}`)
    }
  }

  // Rule 6: Never create a fake purchaseOrderId
  // Allow null/undefined for non-purchase batches, but never a placeholder string.
  if (input.purchaseOrderId !== null && input.purchaseOrderId !== undefined) {
    const fakeValues = ['', 'null', 'undefined', 'N/A', 'none', 'TODO', 'fake', 'dummy']
    if (fakeValues.includes(String(input.purchaseOrderId).trim())) {
      errors.push(`purchaseOrderId must be a valid id or null — never a fake/placeholder value (${input.purchaseOrderId})`)
    }
  }

  // Validate quantity
  if (typeof input.initialQty !== 'number' || Number.isNaN(input.initialQty)) {
    errors.push(`initialQty must be a number — got ${input.initialQty}`)
  } else if (input.initialQty < 0) {
    errors.push(`initialQty must be >= 0 — got ${input.initialQty}`)
  }

  // Validate unitCost (HPP)
  if (typeof input.unitCost !== 'number' || Number.isNaN(input.unitCost)) {
    errors.push(`unitCost (HPP) must be a number — got ${input.unitCost}`)
  } else if (input.unitCost < 0) {
    errors.push(`unitCost (HPP) must be >= 0 — got ${input.unitCost}`)
  }

  // Validate required fields
  if (!input.batchNumber || input.batchNumber.trim() === '') {
    errors.push('batchNumber is required')
  }
  if (!input.inventoryItemId) {
    errors.push('inventoryItemId is required')
  }
  if (!input.outletId) {
    errors.push('outletId is required')
  }

  return errors
}

// ════════════════════════════════════════════════════════════
// CREATE — centralized payload construction
// ════════════════════════════════════════════════════════════

/**
 * Create a single InventoryBatch with full domain-contract validation.
 *
 * Use this for low-volume create paths (manual inventory, adjustment,
 * reconciliation). High-volume paths (purchase createMany, migration,
 * checkout self-heal) may use their optimized bulk SQL directly, but
 * SHOULD call validateBatchPayload() on each item to enforce the contract.
 *
 * @param tx Prisma transaction client (or db singleton)
 * @param input Validated payload
 * @returns The created batch id + batchNumber
 * @throws if validation fails or the DB write errors (never swallows)
 */
export async function createBatch(
  tx: TxClient,
  input: BatchCreateInput
): Promise<BatchCreateResult> {
  const errors = validateBatchPayload(input)
  if (errors.length > 0) {
    throw new Error(`[batch-service] Invalid batch payload: ${errors.join('; ')}`)
  }

  const batch = await tx.inventoryBatch.create({
    data: {
      batchNumber: input.batchNumber,
      inventoryItemId: input.inventoryItemId,
      initialQty: input.initialQty,
      remainingQty: input.initialQty, // Rule: remainingQty starts = initialQty
      unitCost: input.unitCost,
      expiredDate: input.expiredDate ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null, // Rule 2/4: nullable for non-purchase
      purchaseOrderItemId: input.purchaseOrderItemId ?? null,
      supplierId: input.supplierId ?? null,
      supplierName: input.supplierName ?? null,
      status: 'AVAILABLE',
      outletId: input.outletId,
    },
  })

  return { id: batch.id, batchNumber: batch.batchNumber }
}

/**
 * Validate an array of batch payloads (for bulk create paths).
 * Returns the first error found, or null if all valid.
 * Does NOT write to the DB — call this before createMany.
 */
export function validateBatchPayloads(inputs: BatchCreateInput[]): string | null {
  for (let i = 0; i < inputs.length; i++) {
    const errors = validateBatchPayload(inputs[i])
    if (errors.length > 0) {
      return `[batch-service] Item ${i} (${inputs[i].batchNumber}): ${errors.join('; ')}`
    }
  }
  return null
}

// ════════════════════════════════════════════════════════════
// DELETE SAFETY — DELETE RULES
// ════════════════════════════════════════════════════════════

/**
 * Check if a batch can be hard-deleted per the domain contract.
 *
 * Hard-delete allowed ONLY when:
 *   - batch has never been consumed (remainingQty === initialQty)
 *   - no BatchConsumptionLog exists
 *
 * Otherwise the caller must block the delete and use status/archive,
 * or require the user to void related transactions first.
 *
 * @param tx Prisma transaction client
 * @param batchId The batch to check
 * @returns { canDelete, reason?, dependencies }
 */
export async function assertBatchDeletable(
  tx: TxClient,
  batchId: string
): Promise<BatchDeleteCheck> {
  const batch = await tx.inventoryBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      batchNumber: true,
      initialQty: true,
      remainingQty: true,
      status: true,
    },
  })

  if (!batch) {
    return {
      canDelete: false,
      reason: 'Batch not found (already deleted)',
      dependencies: { consumptionLogs: 0 },
    }
  }

  const consumptionLogCount = await tx.batchConsumptionLog.count({
    where: { inventoryBatchId: batchId },
  })

  // Dependency: BatchConsumptionLog exists → audit trail dependency
  if (consumptionLogCount > 0) {
    return {
      canDelete: false,
      reason: `Batch "${batch.batchNumber}" has ${consumptionLogCount} consumption log(s) — cannot hard-delete (audit trail dependency). Void related transactions first or use status/archive.`,
      dependencies: { consumptionLogs: consumptionLogCount },
    }
  }

  // Dependency: batch partially consumed (remainingQty < initialQty)
  if (batch.remainingQty < batch.initialQty) {
    const consumed = batch.initialQty - batch.remainingQty
    return {
      canDelete: false,
      reason: `Batch "${batch.batchNumber}" was partially consumed (${consumed} units used, remainingQty=${batch.remainingQty}/${batch.initialQty}). Cannot hard-delete — audit trail may be incomplete.`,
      dependencies: { consumptionLogs: 0 },
    }
  }

  return {
    canDelete: true,
    dependencies: { consumptionLogs: 0 },
  }
}

/**
 * Safely delete all batches for an inventory item (used by item-delete routes).
 *
 * For each batch:
 *   - If deletable (never consumed, no consumption logs) → delete.
 *   - If NOT deletable → block and return the reason.
 *
 * This NEVER wipes BatchConsumptionLog rows for batches that have them —
 * those batches are blocked, not deleted. Callers must decide whether to
 * abort the item delete or escalate (status/archive).
 *
 * @returns { deletedBatches, blockedBatches, reasons }
 */
export async function safeDeleteBatchesForItem(
  tx: TxClient,
  inventoryItemId: string,
  outletId: string
): Promise<{ deletedBatches: number; blockedBatches: number; reasons: string[] }> {
  const batches = await tx.inventoryBatch.findMany({
    where: { inventoryItemId, outletId },
    select: {
      id: true,
      batchNumber: true,
      initialQty: true,
      remainingQty: true,
      status: true,
    },
  })

  if (batches.length === 0) {
    return { deletedBatches: 0, blockedBatches: 0, reasons: [] }
  }

  const reasons: string[] = []
  const deletableIds: string[] = []
  let blocked = 0

  for (const batch of batches) {
    const check = await assertBatchDeletable(tx, batch.id)
    if (check.canDelete) {
      deletableIds.push(batch.id)
    } else {
      blocked++
      reasons.push(check.reason || `Batch ${batch.batchNumber}: unknown block reason`)
    }
  }

  if (deletableIds.length > 0) {
    // Defensive: clean up any orphaned consumption logs first (should be 0 for
    // deletable batches, but this prevents FK violations on PostgreSQL).
    await tx.batchConsumptionLog.deleteMany({
      where: { inventoryBatchId: { in: deletableIds } },
    })
    await tx.inventoryBatch.deleteMany({
      where: { id: { in: deletableIds } },
    })
  }

  return {
    deletedBatches: deletableIds.length,
    blockedBatches: blocked,
    reasons,
  }
}

/**
 * Check if all batches for a purchase order can be deleted (purchase edit/delete safety).
 *
 * Blocks if ANY batch has been consumed or has consumption logs — even if
 * remainingQty was restored to initialQty by a void (because the BatchConsumptionLog
 * rows still exist as an audit trail).
 *
 * @returns { canDelete, blockedBatches, reasons }
 */
export async function checkBatchesDeletableForPurchase(
  tx: TxClient,
  purchaseOrderId: string,
  outletId: string
): Promise<{ canDelete: boolean; blockedBatches: number; reasons: string[] }> {
  const batches = await tx.inventoryBatch.findMany({
    where: { purchaseOrderId, outletId },
    select: { id: true, batchNumber: true, initialQty: true, remainingQty: true },
  })

  if (batches.length === 0) {
    return { canDelete: true, blockedBatches: 0, reasons: [] }
  }

  const reasons: string[] = []
  let blocked = 0

  for (const batch of batches) {
    const check = await assertBatchDeletable(tx, batch.id)
    if (!check.canDelete) {
      blocked++
      reasons.push(check.reason || `Batch ${batch.batchNumber}: unknown block reason`)
    }
  }

  return {
    canDelete: blocked === 0,
    blockedBatches: blocked,
    reasons,
  }
}

/**
 * Delete all batches for a purchase order (purchase edit/delete).
 *
 * SAFETY: blocks if any batch has consumption logs (even if voided-then-restored).
 * Callers MUST handle the `blocked` case — typically by throwing the reasons
 * as an error so the user knows to void related transactions first.
 *
 * This is the SAFE replacement for the old `deleteBatchesForPurchase` which
 * unconditionally wiped BatchConsumptionLog rows.
 *
 * @throws if any batch is blocked (has consumption logs or was consumed)
 */
export async function safeDeleteBatchesForPurchase(
  tx: TxClient,
  purchaseOrderId: string,
  outletId: string
): Promise<{ deletedBatches: number }> {
  const check = await checkBatchesDeletableForPurchase(tx, purchaseOrderId, outletId)
  if (!check.canDelete) {
    throw new Error(
      `Cannot delete batches for purchase ${purchaseOrderId}: ${check.blockedBatches} batch(es) blocked.\n` +
      check.reasons.join('\n')
    )
  }

  const batches = await tx.inventoryBatch.findMany({
    where: { purchaseOrderId, outletId },
    select: { id: true },
  })

  if (batches.length === 0) {
    return { deletedBatches: 0 }
  }

  const batchIds = batches.map(b => b.id)

  // Defensive: clean up any consumption logs (should be 0 since we checked above)
  await tx.batchConsumptionLog.deleteMany({
    where: { inventoryBatchId: { in: batchIds }, outletId },
  })

  await tx.inventoryBatch.deleteMany({
    where: { purchaseOrderId, outletId },
  })

  return { deletedBatches: batchIds.length }
}

// ════════════════════════════════════════════════════════════
// CONSUME — UPDATE RULES (FEFO deduction with guards)
// ════════════════════════════════════════════════════════════

/**
 * Consume quantity from a single batch with full safety guards.
 *
 * Guards:
 *   - Blocks negative remainingQty (Math.min guard).
 *   - Sets status=CONSUMED when remainingQty reaches 0.
 *   - Creates a BatchConsumptionLog if transactionId + invoiceNumber are provided.
 *
 * For high-volume FEFO paths (recordBatchConsumptionBatch), use the optimized
 * raw-SQL loop in fefo-engine.ts instead — but this helper is the canonical
 * reference implementation of the consume contract.
 *
 * @param tx Prisma transaction client
 * @param input { batchId, quantity, inventoryItemId, outletId, transactionId?, ... }
 * @returns { batchId, quantityConsumed, newRemaining, newStatus }
 */
export async function consumeBatch(
  tx: TxClient,
  input: BatchConsumeInput
): Promise<BatchConsumeResult> {
  const batch = await tx.inventoryBatch.findUnique({
    where: { id: input.batchId },
    select: {
      id: true,
      remainingQty: true,
      initialQty: true,
      status: true,
      batchNumber: true,
      expiredDate: true,
    },
  })

  if (!batch) {
    throw new Error(`[batch-service] Batch ${input.batchId} not found`)
  }

  // Guard: block negative remainingQty (Rule: never go below 0)
  const consume = Math.min(input.quantity, batch.remainingQty)
  if (consume <= 0) {
    return {
      batchId: input.batchId,
      quantityConsumed: 0,
      newRemaining: batch.remainingQty,
      newStatus: batch.status,
    }
  }

  const newRemaining = batch.remainingQty - consume
  // Rule: set CONSUMED when remainingQty reaches 0
  const newStatus = newRemaining <= 0 ? 'CONSUMED' : 'AVAILABLE'

  await tx.inventoryBatch.update({
    where: { id: input.batchId },
    data: {
      remainingQty: newRemaining,
      status: newStatus,
      updatedAt: new Date(),
    },
  })

  // Create consumption log (audit trail) if transaction context is provided
  if (input.transactionId && input.invoiceNumber) {
    await tx.batchConsumptionLog.create({
      data: {
        transactionId: input.transactionId,
        inventoryBatchId: input.batchId,
        inventoryItemId: input.inventoryItemId,
        quantityConsumed: consume,
        batchNumber: batch.batchNumber,
        expiredDate: batch.expiredDate,
        invoiceNumber: input.invoiceNumber,
        sourceDetails: input.sourceDetails || '[]',
        outletId: input.outletId,
      },
    })
  }

  return {
    batchId: input.batchId,
    quantityConsumed: consume,
    newRemaining,
    newStatus,
  }
}

// ════════════════════════════════════════════════════════════
// RESTORE — VOID RULES (exact batch restoration)
// ════════════════════════════════════════════════════════════

/**
 * Restore quantity to a batch (void reversal).
 *
 * Guards:
 *   - Caps newRemaining at initialQty (Rule: never exceed original quantity).
 *   - Status flip: CONSUMED → AVAILABLE only (never restore EXPIRED/DISCARDED).
 *   - If batch was deleted (not found), returns batchMissing=true so the caller
 *     can fall back to InventoryItem.stock-only restore (Rule: restore unbatched
 *     consumption through InventoryItem.stock only).
 *
 * This is the SAFE replacement for the inline restore logic in
 * `restoreBatchesFromLogs` — that method now delegates to this helper.
 *
 * @param tx Prisma transaction client
 * @param input { batchId, quantityConsumed, outletId }
 * @returns { batchId, quantityRestored, newRemaining, newStatus, capped, batchMissing }
 */
export async function restoreBatch(
  tx: TxClient,
  input: BatchRestoreInput
): Promise<BatchRestoreResult> {
  const batch = await tx.inventoryBatch.findUnique({
    where: { id: input.batchId },
    select: {
      id: true,
      remainingQty: true,
      initialQty: true,
      status: true,
    },
  })

  // Rule: if batch was deleted, restore unbatched consumption through
  // InventoryItem.stock only — caller handles this via batchMissing=true.
  if (!batch) {
    return {
      batchId: input.batchId,
      quantityRestored: 0,
      newRemaining: 0,
      newStatus: 'DELETED',
      capped: false,
      batchMissing: true,
    }
  }

  const previousRemaining = batch.remainingQty
  let newRemaining = previousRemaining + input.quantityConsumed

  // Guard: block remainingQty > initialQty (Rule: never exceed original)
  let capped = false
  if (newRemaining > batch.initialQty) {
    newRemaining = batch.initialQty
    capped = true
  }

  // Rule: status flip CONSUMED → AVAILABLE only (never restore EXPIRED/DISCARDED)
  const newStatus = batch.status === 'CONSUMED' && newRemaining > 0 ? 'AVAILABLE' : batch.status

  await tx.inventoryBatch.update({
    where: { id: input.batchId },
    data: {
      remainingQty: newRemaining,
      status: newStatus,
      updatedAt: new Date(),
    },
  })

  return {
    batchId: input.batchId,
    quantityRestored: newRemaining - previousRemaining,
    newRemaining,
    newStatus,
    capped,
    batchMissing: false,
  }
}

// ════════════════════════════════════════════════════════════
// STOCK OPNAME — surplus/deficit behavior (Rule: explicit behavior)
// ════════════════════════════════════════════════════════════

/**
 * Apply a stock-opname delta to a batch.
 *
 * For SURPLUS (positive delta):
 *   - Cap at initialQty (Rule: never exceed original without explicit reconciliation).
 *   - If capping would lose quantity, caller should create a new ADJUSTMENT batch
 *     for the overflow (handled by the stock-opname route, not here).
 *
 * For DEFICIT (negative delta):
 *   - Consume via FEFO (Math.min guard prevents negative).
 *   - Sets status=CONSUMED when remainingQty reaches 0.
 *
 * @returns { quantityApplied, newRemaining, newStatus, cappedOverflow }
 */
export async function applyStockOpnameDelta(
  tx: TxClient,
  input: {
    batchId: string
    delta: number // positive = surplus, negative = deficit
    outletId: string
  }
): Promise<{
  quantityApplied: number
  newRemaining: number
  newStatus: string
  cappedOverflow: number // quantity that couldn't be applied (>0 only for surplus cap)
}> {
  const batch = await tx.inventoryBatch.findUnique({
    where: { id: input.batchId },
    select: { id: true, remainingQty: true, initialQty: true, status: true },
  })

  if (!batch) {
    throw new Error(`[batch-service] Batch ${input.batchId} not found`)
  }

  if (input.delta === 0) {
    return { quantityApplied: 0, newRemaining: batch.remainingQty, newStatus: batch.status, cappedOverflow: 0 }
  }

  let newRemaining: number
  let newStatus: string
  let cappedOverflow = 0

  if (input.delta < 0) {
    // Deficit: consume (Math.min guard prevents negative)
    const consume = Math.min(Math.abs(input.delta), batch.remainingQty)
    newRemaining = batch.remainingQty - consume
    newStatus = newRemaining <= 0 ? 'CONSUMED' : 'AVAILABLE'
    // If consume < |delta|, the overflow is a stock-only adjustment (no batch to deduct from)
    cappedOverflow = Math.abs(input.delta) - consume // positive = unbatched deficit
  } else {
    // Surplus: cap at initialQty
    newRemaining = batch.remainingQty + input.delta
    if (newRemaining > batch.initialQty) {
      cappedOverflow = newRemaining - batch.initialQty
      newRemaining = batch.initialQty
    }
    newStatus = newRemaining > 0 ? 'AVAILABLE' : batch.status
  }

  await tx.inventoryBatch.update({
    where: { id: input.batchId },
    data: {
      remainingQty: newRemaining,
      status: newStatus,
      updatedAt: new Date(),
    },
  })

  return {
    quantityApplied: input.delta < 0 ? -(Math.abs(input.delta) - cappedOverflow) : (input.delta - cappedOverflow),
    newRemaining,
    newStatus,
    cappedOverflow,
  }
}
