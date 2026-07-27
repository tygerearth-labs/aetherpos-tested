/**
 * AETHER BULK ENGINE V1 — client adapter registry (V2 SCOPE RESET).
 *
 * 7 job types across 4 supported domains:
 *  - purchase:add, purchase:edit
 *  - product:add, product:edit
 *  - inventory:edit
 *  - customer:add, customer:edit
 *
 * Maps adapter `kind` → BulkClientAdapter. Imported by the worker provider
 * and the upload dialog to look up parse/validate/delegate config.
 */

import type { BulkClientAdapter } from './types'
import { migrationProductsAdapter } from './adapters/migration-products'
import { productUpdateClient } from './adapters/product-update'
import { customerImportClient } from './adapters/customer-import'
import { customerEditClient } from './adapters/customer-edit'
import { inventoryAdjustmentClient } from './adapters/inventory-adjustment'
import { purchaseImportClient } from './adapters/purchase-import'
import { purchaseEditClient } from './adapters/purchase-edit'

const REGISTRY = new Map<string, BulkClientAdapter>([
  // product:add — delegate to /api/migration/import (reuses migration business rules)
  [migrationProductsAdapter.kind, migrationProductsAdapter],
  // product:edit — row-mode, lookup productId→SKU→barcode→name, comp-stock validation
  [productUpdateClient.kind, productUpdateClient],
  // purchase:add — file-delegate, groups by PO number → POST /api/purchases per PO
  [purchaseImportClient.kind, purchaseImportClient],
  // purchase:edit — file-delegate, groups by PO number → PUT /api/purchases/[id] per PO
  [purchaseEditClient.kind, purchaseEditClient],
  // inventory:edit — row-mode, metadata only (stock/avgCost are read-only, denormalized)
  [inventoryAdjustmentClient.kind, inventoryAdjustmentClient],
  // customer:add — row-mode, createMany + audit
  [customerImportClient.kind, customerImportClient],
  // customer:edit — row-mode, update by id/whatsapp, soft-delete respect, audit
  [customerEditClient.kind, customerEditClient],
])

export function getClientAdapter(kind: string): BulkClientAdapter | undefined {
  return REGISTRY.get(kind)
}

export function listClientAdapters(): BulkClientAdapter[] {
  return [...REGISTRY.values()]
}

export function getAdapterKinds(): string[] {
  return [...REGISTRY.keys()]
}
