/**
 * Adapter: product:add (DELEGATE-MODE).
 *
 * Reuses the existing /api/migration/import route — the gold-standard product
 * import flow with 4-sheet detection, BOM capacity, re-migration intelligence,
 * FEFO/HPP integration, quota gates. The engine manages the queue/progress/
 * resume/retry/error-export UX; the migration route keeps 100% of its domain
 * logic (zero duplication).
 *
 * The client adapter counts products client-side (to seed Dexie batch records),
 * stores the file Blob, and the worker POSTs FormData(file, mode, batchNumber)
 * per batch — exactly as the legacy MigrationProcessorProvider did.
 */

import type { BatchResult, BulkClientAdapter, ParsedRow, RowValidation } from '../types'
import { countProductsInFile } from '@/lib/migration/sheet-count'

function mapMigrationResponse(data: Record<string, unknown>): BatchResult {
  const status = (data.status as string) === 'BATCH_FAILED' ? 'failed' : 'completed'
  const hasError = Boolean(data.error) || status === 'failed'
  const errors = (data.errors as string[]) || []
  return {
    status: hasError ? 'failed' : 'completed',
    stats: {
      processed: (data.batchProcessed as number) || 0,
      created: (data.batchCreated as number) || 0,
      updated: 0,
      skipped: (data.batchSkipped as number) || 0,
      failed: (data.batchFailed as number) || 0,
      deleted: 0,
    },
    errors: errors.map((msg, i) => ({
      rowIndex: i + 1,
      code: 'MIGRATION_ROW_ERROR',
      message: msg,
    })),
    warnings: (data.warnings as string[]) || undefined,
    extras: {
      variantsCreated: data.variantsCreated,
      inventoryItemsCreated: data.inventoryItemsCreated,
      inventoryItemsSkipped: data.inventoryItemsSkipped,
      inventoryItemsUpdated: data.inventoryItemsUpdated,
      migrationDataCleaned: data.migrationDataCleaned,
      compositionsCreated: data.compositionsCreated,
      totalStock: data.totalStock,
      totalModalValue: data.totalModalValue,
      totalCategories: data.totalCategories,
      barcodeCount: data.barcodeCount,
    },
    totalBatches: (data.totalBatches as number) || undefined,
    totalRows: (data.totalProducts as number) || undefined,
    isLastBatch: Boolean(data.isLastBatch),
  }
}

export const migrationProductsAdapter: BulkClientAdapter = {
  kind: 'product:add',
  label: 'Tambah Produk (Excel)',
  description: 'Import produk baru dari Excel (produk + stok + bahan baku + komposisi). Reuses migration import logic.',
  icon: 'PackagePlus',
  batchSize: 50,
  concurrency: 1,
  supportsClear: false,
  supportsDelete: false,
  templateColumns: [],
  templateEndpoint: '/api/migration/template',

  // Delegate-mode: the file is re-parsed server-side per batch.
  // parseFile here is only used to count total products/batches for Dexie seeding.
  async parseFile(file: File) {
    const { totalProducts, totalBatches } = await countProductsInFile(file)
    // Return empty rows — the file Blob is stored separately and re-sent per batch.
    return { rows: [] as ParsedRow[], sheetName: 'non_varian', warnings: [] }
  },

  validateRow(_row: ParsedRow): RowValidation {
    return { valid: true, errors: [], warnings: [] }
  },

  executionMode: 'file-delegate',
  delegateEndpoint: '/api/migration/import',
  delegateFields: {}, // 'mode' is injected dynamically from job.config
  mapDelegateResponse: mapMigrationResponse,
}

/** Count products in the file for Dexie batch seeding (delegate-mode). */
export async function countMigrationProducts(
  file: File,
): Promise<{ totalProducts: number; totalBatches: number }> {
  return countProductsInFile(file)
}

