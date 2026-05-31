import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getOutletPlan } from '@/lib/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/safe-response'

// Vercel serverless function timeout: 60s
export const maxDuration = 60

const MAX_ROWS = 500

const VALID_UNITS = ['pcs', 'ml', 'lt', 'gr', 'kg', 'box', 'pack', 'botol', 'gelas', 'mangkuk', 'porsi', 'bungkus', 'sachet', 'dus', 'rim', 'lembar', 'meter', 'cm', 'ons']

/**
 * Sanitize numeric values from Excel — handles:
 * - "Rp 25.000" → 25000
 * - "Rp25000" → 25000
 * - "25.000" (Indonesian thousands) → 25000
 * - "25,000" (comma thousands) → 25000
 * - "25.500,00" (Indonesian decimal) → 25500
 * - 25000 (number) → 25000
 * - "" / empty → 0
 */
function sanitizeNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (val === null || val === undefined) return 0
  const str = String(val).trim()
  if (!str) return 0

  // Remove currency symbols & whitespace
  let cleaned = str.replace(/[Rp\s$€¥£.,\-]/g, (match) => {
    if (match === '.' || match === ',') return match
    return ''
  }).trim()

  // Detect format: if we have both dots and commas, the LAST separator is the decimal
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')

  if (lastDot > -1 && lastComma > -1) {
    if (lastDot > lastComma) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (lastDot > -1 && lastComma === -1) {
    const parts = cleaned.split('.')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      cleaned = cleaned.replace(/\./g, '')
    }
  } else if (lastComma > -1 && lastDot === -1) {
    const parts = cleaned.split(',')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      cleaned = cleaned.replace(/,/g, '')
    } else {
      cleaned = cleaned.replace(',', '.')
    }
  }

  const num = Number(cleaned)
  return isNaN(num) ? 0 : num
}

/** Normalize header key for flexible matching */
function normalizeHeader(key: string): string {
  return key.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase()
}

/** Find matching column from row by trying normalized header aliases */
function findColumn(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalizedMap = new Map<string, string>()
  for (const key of Object.keys(row)) {
    const norm = normalizeHeader(key)
    normalizedMap.set(norm, key)
  }

  for (const alias of aliases) {
    const norm = normalizeHeader(alias)
    if (normalizedMap.has(norm)) {
      return row[normalizedMap.get(norm)!]
    }
    for (const [normKey, actualKey] of normalizedMap) {
      if (normKey.includes(norm) || norm.includes(normKey)) {
        return row[actualKey]
      }
    }
  }
  return undefined
}

/** Check if a value is non-empty (not null, undefined, empty string, or whitespace-only) */
function isNonEmpty(val: unknown): boolean {
  if (val === null || val === undefined) return false
  if (typeof val === 'string') return val.trim().length > 0
  if (typeof val === 'number') return val !== 0
  return true
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const userId = user.id

    // Check plan: bulkUpload feature required
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) {
      return safeJsonError('Outlet not found', 404)
    }

    if (!outletPlan.features.bulkUpload) {
      return safeJsonError('Fitur bulk upload hanya tersedia untuk akun Pro. Upgrade untuk mengakses fitur ini.', 403)
    }

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return safeJsonError('File tidak ditemukan', 400)
    }

    // Validate file type by extension
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      return safeJsonError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400)
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return safeJsonError('Ukuran file maksimal 5MB', 400)
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Parse Excel
    let workbook: XLSX.WorkBook
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch (parseError) {
      console.error('Excel parse error:', parseError)
      return safeJsonError('File tidak dapat dibaca. Pastikan file adalah format Excel (.xlsx/.xls) yang valid.', 400)
    }

    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      return safeJsonError('File Excel kosong — tidak ada sheet', 400)
    }
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    if (rows.length === 0) {
      return safeJsonError('File Excel tidak memiliki data baris', 400)
    }

    if (rows.length > MAX_ROWS) {
      return safeJsonError(`Maksimal ${MAX_ROWS} baris per upload. File Anda memiliki ${rows.length} baris.`, 400)
    }

    // Debug: log detected column headers
    const detectedHeaders = Object.keys(rows[0])
    console.log('[Bulk Update Excel] Detected headers:', detectedHeaders)

    // Process product rows
    let updated = 0
    let notFound = 0
    const errors: string[] = []

    // Cache categories to reduce DB queries
    const categoryCache = new Map<string, string | null>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2

      // Extract product ID — required for update
      const productId = String(findColumn(row, ['ID*', 'ID', 'id', 'Id']) || '').trim()
      if (!productId) {
        errors.push(`Baris ${rowNum}: ID produk wajib diisi untuk update`)
        continue
      }

      // Find product by ID + outletId
      const existing = await db.product.findFirst({
        where: { id: productId, outletId },
      })
      if (!existing) {
        errors.push(`Baris ${rowNum}: Produk dengan ID "${productId}" tidak ditemukan`)
        notFound++
        continue
      }

      // Build update data object — only include non-empty fields
      const updateData: Record<string, unknown> = {}
      const changes: Record<string, { from: number | string | null; to: number | string }> = {}

      // Name (optional update)
      const name = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
      if (isNonEmpty(name) && name !== existing.name) {
        updateData.name = name
        changes.name = { from: existing.name, to: name }
      }

      // SKU
      const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim()
      if (isNonEmpty(sku)) {
        updateData.sku = sku || null
        if (sku !== (existing.sku || '')) {
          changes.sku = { from: existing.sku || '', to: sku }
        }
      }

      // HPP
      const hpp = sanitizeNumber(findColumn(row, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
      if (isNonEmpty(findColumn(row, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))) {
        updateData.hpp = hpp
        if (hpp !== existing.hpp) {
          changes.hpp = { from: existing.hpp, to: hpp }
        }
      }

      // Price
      const price = sanitizeNumber(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
      if (isNonEmpty(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))) {
        if (price > 0) {
          updateData.price = price
          if (price !== existing.price) {
            changes.price = { from: existing.price, to: price }
          }
        }
      }

      // Stock
      const stock = sanitizeNumber(findColumn(row, ['QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))
      if (isNonEmpty(findColumn(row, ['QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))) {
        updateData.stock = Math.round(stock)
        if (Math.round(stock) !== existing.stock) {
          changes.stock = { from: existing.stock, to: Math.round(stock) }
        }
      }

      // Unit
      const unitRaw = String(findColumn(row, ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat']) || '').trim().toLowerCase()
      if (isNonEmpty(unitRaw) && VALID_UNITS.includes(unitRaw)) {
        updateData.unit = unitRaw
        if (unitRaw !== existing.unit) {
          changes.unit = { from: existing.unit, to: unitRaw }
        }
      }

      // Category
      const categoryRaw = String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim()
      if (isNonEmpty(categoryRaw)) {
        let categoryId: string | null = null
        if (categoryCache.has(categoryRaw)) {
          categoryId = categoryCache.get(categoryRaw)!
        } else {
          const existingCategory = await db.category.findFirst({
            where: { name: categoryRaw, outletId },
          })
          if (existingCategory) {
            categoryId = existingCategory.id
            categoryCache.set(categoryRaw, categoryId)
          } else {
            const newCategory = await db.category.create({
              data: {
                name: categoryRaw,
                outletId,
                color: 'zinc',
              },
            })
            categoryId = newCategory.id
            categoryCache.set(categoryRaw, categoryId)
          }
        }
        updateData.categoryId = categoryId
        if (categoryId !== existing.categoryId) {
          changes.categoryId = { from: existing.categoryId, to: categoryId }
        }
      }

      // Low Stock Alert
      const lowStockAlert = sanitizeNumber(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'lowStockAlert', 'Alert Stok']))
      if (isNonEmpty(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'lowStockAlert', 'Alert Stok']))) {
        updateData.lowStockAlert = Math.round(lowStockAlert)
        if (Math.round(lowStockAlert) !== existing.lowStockAlert) {
          changes.lowStockAlert = { from: existing.lowStockAlert, to: Math.round(lowStockAlert) }
        }
      }

      // Skip if nothing to update
      if (Object.keys(updateData).length === 0) {
        continue
      }

      // Apply update
      await db.product.update({
        where: { id: productId },
        data: updateData,
      })

      // Audit log per product
      await safeAuditLog({
        action: 'BULK_UPDATE',
        entityType: 'PRODUCT',
        entityId: productId,
        details: JSON.stringify({
          bulkUpdateExcel: true,
          changes,
          fileName: file.name,
        }),
        outletId,
        userId,
      })

      updated++
    }

    // === Process "Varian Produk" sheet if it exists ===
    let variantsUpdated = 0
    let variantsNotFound = 0

    const variantSheetName = workbook.SheetNames.find(
      (n) => normalizeHeader(n).includes('varian')
    )

    if (variantSheetName) {
      const variantSheet = workbook.Sheets[variantSheetName]
      const variantRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(variantSheet, { defval: '' })

      console.log(`[Bulk Update Excel] Found variant sheet "${variantSheetName}" with ${variantRows.length} rows`)

      // Cache parent products by ID
      const parentProductCache = new Map<string, boolean>()

      for (let i = 0; i < variantRows.length; i++) {
        try {
          const vRow = variantRows[i]
          const rowNum = i + 2

          // Extract variant ID — match by ID Varian
          const variantId = String(findColumn(vRow, ['ID VARIAN*', 'ID VARIAN', 'ID Varian', 'ID', 'id', 'Id']) || '').trim()
          const parentProductId = String(findColumn(vRow, ['ID PRODUK*', 'ID PRODUK', 'ID Produk', 'ID', 'id', 'Id']) || '').trim()

          // We need at least a variant ID to match
          if (!variantId) {
            // Try matching by parent product + variant name
            const parentName = String(findColumn(vRow, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
            const variantName = String(findColumn(vRow, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Variant Name', 'Varian', 'name']) || '').trim()

            if (!parentName || !variantName) {
              errors.push(`Baris ${rowNum} (Varian): ID Varian atau Nama Produk + Nama Varian wajib diisi`)
              continue
            }

            // Find parent product by name
            let parentExists = parentProductCache.get(parentName)
            if (parentExists === undefined) {
              const found = await db.product.findFirst({
                where: { name: parentName, outletId },
              })
              parentProductCache.set(parentName, !!found)
              if (!found) {
                errors.push(`Baris ${rowNum} (Varian): Produk "${parentName}" tidak ditemukan`)
                variantsNotFound++
                continue
              }
            }

            const parent = await db.product.findFirst({
              where: { name: parentName, outletId },
            })
            if (!parent) {
              errors.push(`Baris ${rowNum} (Varian): Produk "${parentName}" tidak ditemukan`)
              variantsNotFound++
              continue
            }

            // Find variant by name + productId
            const existingVariant = await db.productVariant.findFirst({
              where: { name: variantName, productId: parent.id, outletId },
            })
            if (!existingVariant) {
              errors.push(`Baris ${rowNum} (Varian): Varian "${variantName}" tidak ditemukan untuk produk "${parentName}"`)
              variantsNotFound++
              continue
            }

            // Build update data for variant
            const variantUpdate: Record<string, unknown> = {}

            const vSku = String(findColumn(vRow, ['SKU VARIAN', 'SKU Varian', 'SKU', 'sku']) || '').trim()
            if (isNonEmpty(vSku)) {
              variantUpdate.sku = vSku || null
            }

            const vHpp = sanitizeNumber(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
            if (isNonEmpty(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))) {
              variantUpdate.hpp = vHpp
            }

            const vPrice = sanitizeNumber(findColumn(vRow, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
            if (isNonEmpty(findColumn(vRow, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))) {
              if (vPrice > 0) variantUpdate.price = vPrice
            }

            const vStock = sanitizeNumber(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))
            if (isNonEmpty(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))) {
              variantUpdate.stock = Math.round(vStock)
            }

            if (Object.keys(variantUpdate).length === 0) continue

            await db.productVariant.update({
              where: { id: existingVariant.id },
              data: variantUpdate,
            })

            variantsUpdated++
            continue
          }

          // Match by variant ID directly
          const existingVariant = await db.productVariant.findFirst({
            where: { id: variantId, outletId },
          })
          if (!existingVariant) {
            errors.push(`Baris ${rowNum} (Varian): Varian dengan ID "${variantId}" tidak ditemukan`)
            variantsNotFound++
            continue
          }

          // Build update data for variant
          const variantUpdate: Record<string, unknown> = {}

          const vName = String(findColumn(vRow, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Variant Name', 'Varian', 'name']) || '').trim()
          if (isNonEmpty(vName)) {
            variantUpdate.name = vName
          }

          const vSku = String(findColumn(vRow, ['SKU VARIAN', 'SKU Varian', 'SKU', 'sku']) || '').trim()
          if (isNonEmpty(vSku)) {
            variantUpdate.sku = vSku || null
          }

          const vHpp = sanitizeNumber(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
          if (isNonEmpty(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))) {
            variantUpdate.hpp = vHpp
          }

          const vPrice = sanitizeNumber(findColumn(vRow, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
          if (isNonEmpty(findColumn(vRow, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))) {
            if (vPrice > 0) variantUpdate.price = vPrice
          }

          const vStock = sanitizeNumber(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))
          if (isNonEmpty(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))) {
            variantUpdate.stock = Math.round(vStock)
          }

          if (Object.keys(variantUpdate).length === 0) continue

          await db.productVariant.update({
            where: { id: variantId },
            data: variantUpdate,
          })

          variantsUpdated++
        } catch (variantError) {
          const rowNum = i + 2
          const errMessage = variantError instanceof Error ? variantError.message : 'Unknown error'
          console.error(`[Bulk Update Excel] Variant row ${rowNum} error:`, variantError)
          errors.push(`Baris ${rowNum} (Varian): Gagal memproses — ${errMessage}`)
        }
      }
    }

    // Audit log for bulk update
    if (updated > 0 || variantsUpdated > 0) {
      await safeAuditLog({
        action: 'BULK_UPDATE',
        entityType: 'PRODUCT',
        details: JSON.stringify({
          bulkUpdateExcel: true,
          updated,
          notFound,
          variantsUpdated,
          variantsNotFound,
          errors: errors.length,
          fileName: file.name,
        }),
        outletId,
        userId,
      })
    }

    return safeJson({
      updated,
      notFound,
      variantsUpdated,
      variantsNotFound,
      errors,
    })
  } catch (error) {
    console.error('Bulk update excel error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses file update', details: message }, 500)
  }
}
