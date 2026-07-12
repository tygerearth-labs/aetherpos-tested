import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan, isUnlimited } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { generateUniqueSKU } from '@/lib/sku-generator'

export const maxDuration = 60

const MAX_ROWS = 500

const VALID_UNITS = ['pcs', 'ml', 'lt', 'gr', 'kg', 'box', 'pack', 'botol', 'gelas', 'mangkuk', 'porsi', 'bungkus', 'sachet', 'dus', 'rim', 'lembar', 'meter', 'cm', 'ons', 'roll', 'strip', 'ekor']

function sanitizeNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (val === null || val === undefined) return 0
  const str = String(val).trim()
  if (!str) return 0

  let isNegative = false
  let trimmed = str
  if (trimmed.startsWith('-') || trimmed.startsWith('\u2212')) {
    isNegative = true
    trimmed = trimmed.slice(1)
  }

  let cleaned = trimmed.replace(/[Rp\s$€¥£.,]/g, (match) => {
    if (match === '.' || match === ',') return match
    return ''
  }).trim()

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
  return isNaN(num) ? 0 : (isNegative ? -Math.abs(num) : num)
}

function normalizeHeader(key: string): string {
  return key.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase()
}

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

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return unauthorized()
    }
    const outletId = user.outletId
    const userId = user.id

    // Check plan
    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) {
      return safeJsonError('Outlet not found', 404)
    }

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const mode = String(formData.get('mode') || 'product_only') // 'product_only' | 'product_inventory'

    if (!file) {
      return safeJsonError('File tidak ditemukan', 400)
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      return safeJsonError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400)
    }

    if (file.size > 5 * 1024 * 1024) {
      return safeJsonError('Ukuran file maksimal 5MB', 400)
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    let workbook: XLSX.WorkBook
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch {
      return safeJsonError('File tidak dapat dibaca. Pastikan file adalah format Excel yang valid.', 400)
    }

    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      return safeJsonError('File Excel kosong', 400)
    }

    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    if (rows.length === 0) {
      return safeJsonError('File Excel tidak memiliki data baris', 400)
    }

    if (rows.length > MAX_ROWS) {
      return safeJsonError(`Maksimal ${MAX_ROWS} baris per upload. File Anda memiliki ${rows.length} baris.`, 400)
    }

    // Check product limit
    if (!isUnlimited(outletPlan.features.maxProducts)) {
      const currentCount = await db.product.count({ where: { outletId } })
      if (currentCount >= outletPlan.features.maxProducts) {
        return safeJsonError(`Batas produk sudah tercapai (${outletPlan.features.maxProducts}).`, 400)
      }
    }

    const includeInventory = mode === 'product_inventory'

    // Stats
    let productsCreated = 0
    let productsSkipped = 0
    let categoriesCreated = 0
    let barcodeCount = 0
    const errors: string[] = []

    // Inventory stats
    let inventoryItemsCreated = 0
    let totalStock = 0
    let totalModalValue = 0

    // Caches
    const categoryCache = new Map<string, string | null>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2

      const name = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
      const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim() || null
      const barcode = String(findColumn(row, ['BARCODE', 'Barcode', 'barcode', 'BAR CODE', 'Bar Code']) || '').trim() || null
      const hpp = sanitizeNumber(findColumn(row, ['HPP / MODAL (Rp)', 'HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal', 'HPP MODAL Rp']))
      const price = sanitizeNumber(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
      const stock = sanitizeNumber(findColumn(row, ['STOK AWAL', 'STOK', 'QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))
      const unitRaw = String(findColumn(row, ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat']) || 'pcs').trim().toLowerCase()
      const categoryRaw = String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim()

      if (!name) {
        errors.push(`Baris ${rowNum}: Nama produk wajib diisi`)
        continue
      }

      if (!price || price < 0) {
        errors.push(`Baris ${rowNum}: Harga Jual tidak valid (Nama: ${name})`)
        continue
      }

      const unit = VALID_UNITS.includes(unitRaw) ? unitRaw : 'pcs'

      // Check product limit
      if (!isUnlimited(outletPlan.features.maxProducts)) {
        const currentCount = await db.product.count({ where: { outletId } })
        if (currentCount >= outletPlan.features.maxProducts) {
          errors.push(`Baris ${rowNum}: Batas produk tercapai`)
          break
        }
      }

      // Skip duplicates
      const existing = await db.product.findFirst({
        where: { name, outletId },
      })
      if (existing) {
        productsSkipped++
        continue
      }

      // Category
      let categoryId: string | null = null
      if (categoryRaw) {
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
              data: { name: categoryRaw, outletId, color: 'zinc' },
            })
            categoryId = newCategory.id
            categoryCache.set(categoryRaw, categoryId)
            categoriesCreated++
          }
        }
      }

      // Auto-generate SKU/Barcode
      const finalSku = sku || await generateUniqueSKU(name, outletId)
      const finalBarcode = barcode || finalSku

      // Create Product
      await db.product.create({
        data: {
          name,
          sku: finalSku,
          barcode: finalBarcode,
          hpp,
          price,
          stock,
          unit,
          categoryId,
          outletId,
        },
      })

      productsCreated++
      if (finalBarcode) barcodeCount++

      // === If inventory mode: also create InventoryItem + Opening Balance ===
      if (includeInventory && stock > 0) {
        // Check if InventoryItem already exists
        const existingInv = await db.inventoryItem.findFirst({
          where: { name, outletId },
        })

        if (!existingInv) {
          const invItem = await db.inventoryItem.create({
            data: {
              name,
              sku: finalSku,
              baseUnit: unit,
              stock: stock,
              avgCost: hpp > 0 ? hpp : 0,
              lowStockAlert: 0,
              status: 'ACTIVE',
              outletId,
              categoryId: null, // InventoryCategory separate
            },
          })

          inventoryItemsCreated++
          totalStock += stock
          totalModalValue += hpp * stock

          // Create opening balance movement
          await db.inventoryMovement.create({
            data: {
              type: 'PURCHASE',
              quantity: stock,
              previousStock: 0,
              newStock: stock,
              referenceType: 'MIGRATION',
              notes: `Saldo awal migrasi dari ${file.name}`,
              outletId,
              inventoryItemId: invItem.id,
              userId,
            },
          })
        } else {
          // InventoryItem already exists — skip
        }
      }
    }

    // Count total categories
    const totalCategories = await db.category.count({ where: { outletId } })

    // Audit log
    if (productsCreated > 0) {
      await safeAuditLog({
        action: 'CREATE',
        entityType: 'PRODUCT',
        details: JSON.stringify({
          migration: true,
          mode,
          productsCreated,
          productsSkipped,
          categoriesCreated,
          barcodeCount,
          inventoryItemsCreated: includeInventory ? inventoryItemsCreated : 0,
          totalStock: includeInventory ? totalStock : 0,
          totalModalValue: includeInventory ? totalModalValue : 0,
          errors: errors.length,
          fileName: file.name,
        }),
        outletId,
        userId,
      })
    }

    return safeJson({
      productsCreated,
      productsSkipped,
      categoriesCreated,
      totalCategories,
      barcodeCount,
      errors,
      mode,
      // Inventory stats (only for product_inventory mode)
      ...(includeInventory ? {
        inventoryItemsCreated,
        totalStock,
        totalModalValue,
      } : {}),
    })
  } catch (error) {
    console.error('Migration import error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses import', details: message }, 500)
  }
}