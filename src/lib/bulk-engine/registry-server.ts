/**
 * AETHER BULK ENGINE V1 — server adapter registry (V2 SCOPE RESET).
 *
 * Only row-mode adapters have server adapters (delegate-mode adapters call
 * existing domain routes directly via the client delegate endpoint).
 *
 * 5 server adapters:
 *  - product:edit, inventory:edit, customer:add, customer:edit
 *  - (purchase:add and purchase:edit are file-delegate mode → no server adapter)
 *  - (product:add is file-delegate mode → no server adapter)
 *
 * Used by /api/bulk-engine/execute to look up preload/buildPlan/executeBatch.
 */

import type { BulkServerAdapter } from './types'
import { productUpdateServer } from './adapters/product-update'
import { customerImportServer } from './adapters/customer-import'
import { customerEditServer } from './adapters/customer-edit'
import { inventoryAdjustmentServer } from './adapters/inventory-adjustment'

const REGISTRY = new Map<string, BulkServerAdapter>([
  [productUpdateServer.kind, productUpdateServer],
  [customerImportServer.kind, customerImportServer],
  [customerEditServer.kind, customerEditServer],
  [inventoryAdjustmentServer.kind, inventoryAdjustmentServer],
])

export function getServerAdapter(kind: string): BulkServerAdapter | undefined {
  return REGISTRY.get(kind)
}

export function hasServerAdapter(kind: string): boolean {
  return REGISTRY.has(kind)
}
