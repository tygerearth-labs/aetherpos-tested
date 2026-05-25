import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/get-auth'
import { getOutletPlan, isUnlimited } from '@/lib/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/safe-response'

// Vercel serverless function timeout: 60s (default is 10s on Hobby plan)
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
    // Keep dots and commas for number reconstruction, remove the rest
    if (match === '.' || match === ',') return match
    return ''
  }).trim()

  // Detect format: if we have both dots and commas, the LAST separator is the decimal
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')

  if (lastDot > -1 && lastComma > -1) {
    if (lastDot > lastComma) {
      // Format: 25.000,50 → Indonesian (dot=thousands, comma=decimal)
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      // Format: 25,000.50 → English (comma=thousands, dot=decimal)
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (lastDot > -1 && lastComma === -1) {
    // Only dots: check if it looks like thousands separator (25.000) or decimal (25.50)
    const parts = cleaned.split('.')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      // Likely thousands separator: 25.000 → 25000
      cleaned = cleaned.replace(/\./g, '')
    }
    // else it's already a valid decimal like 25.50
  } else if (lastComma > -1 && lastDot === -1) {
    // Only commas: check if thousands or decimal
    const parts = cleaned.split(',')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) {
      // Likely thousands: 25,000 → 25000
      cleaned = cleaned.replace(/,/g, '')
    } else {
      // Likely decimal: 25,50 → 25.50
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
  // Build a map of normalized headers → actual keys
  const normalizedMap = new Map<string, string>()
  for (const key of Object.keys(row)) {
    const norm = normalizeHeader(key)
    normalizedMap.set(norm, key)
  }

  for (const alias of aliases) {
    const norm = normalizeHeader(alias)
    // Try exact normalized match first
    if (normalizedMap.has(norm)) {
      return row[normalizedMap.get(norm)!]
    }
    // Try contains match (e.g., 'harga jual' matches 'HARGA JUAL* (Rp)')
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

    // Validate file type by extension (MIME type can be unreliable)
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
    console.log('[Bulk Upload] Detected headers:', detectedHeaders)

    // Check product limit
    if (!isUnlimited(outletPlan.features.maxProducts)) {
      const currentCount = await db.product.count({ where: { outletId } })
      if (currentCount >= outletPlan.features.maxProducts) {
        return safeJsonError(`Batas produk untuk paket ${outletPlan.plan} sudah tercapai (${outletPlan.features.maxProducts}).`, 400)
      }
    }

    // Process rows
    let created = 0
    let skipped = 0
    const errors: string[] = []

    // Cache categories to reduce DB queries
    const categoryCache = new Map<string, string | null>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2 // Excel rows start at 1, header is row 1

      // Map column names using flexible header matching (supports any format)
      const name = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
      const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim() || null
      const hpp = sanitizeNumber(findColumn(row, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
      const price = sanitizeNumber(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
      const stock = sanitizeNumber(findColumn(row, ['QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))
      const unitRaw = String(findColumn(row, ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat']) || 'pcs').trim().toLowerCase()
      const categoryRaw = String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim()
      const hasVariantsRaw = String(findColumn(row, ['PUNYA VARIAN', 'Punya Varian', 'Has Variants', 'hasVariants', 'Variants', 'Varian']) || '').trim().toLowerCase()
      const hasVariants = hasVariantsRaw === 'ya' || hasVariantsRaw === 'yes' || hasVariantsRaw === 'true'

      // Validate required fields
      if (!name) {
        errors.push(`Baris ${rowNum}: Nama produk wajib diisi`)
        continue
      }

      if (!price || price <= 0) {
        errors.push(`Baris ${rowNum}: Harga Jual harus lebih dari 0 (Nama: ${name})`)
        continue
      }

      const unit = VALID_UNITS.includes(unitRaw) ? unitRaw : 'pcs'

      // Check product limit before each creation
      if (!isUnlimited(outletPlan.features.maxProducts)) {
        const currentCount = await db.product.count({ where: { outletId } })
        if (currentCount >= outletPlan.features.maxProducts) {
          errors.push(`Baris ${rowNum}: Batas produk sudah tercapai, sisa produk dihentikan`)
          break
        }
      }

      // Skip duplicates (by name + outletId)
      const existing = await db.product.findFirst({
        where: { name, outletId },
      })
      if (existing) {
        skipped++
        continue
      }

      // Auto-create category if needed (with cache)
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
      }

      // Create product
      await db.product.create({
        data: {
          name,
          sku,
          hpp,
          price,
          stock,
          unit,
          categoryId,
          hasVariants,
          outletId,
        },
      })

      created++
    }

    // === Process "Varian Produk" sheet if it exists ===
    let variantsCreated = 0
    let variantsSkipped = 0

    const variantSheetName = workbook.SheetNames.find(
      (n) => normalizeHeader(n).includes('varian')
    )

    if (variantSheetName) {
      const variantSheet = workbook.Sheets[variantSheetName]
      const variantRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(variantSheet, { defval: '' })

      console.log(`[Bulk Upload] Found variant sheet "${variantSheetName}" with ${variantRows.length} rows`)

      // Cache parent products by name for this outlet to reduce DB queries
      const productCache = new Map<string, { id: string; hasVariants: boolean }>()

      for (let i = 0; i < variantRows.length; i++) {
        try {
          const vRow = variantRows[i]
          const rowNum = i + 2 // Excel rows start at 1, header is row 1

          const parentName = String(findColumn(vRow, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
          const variantName = String(findColumn(vRow, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Variant Name', 'Varian']) || '').trim()
          const variantSku = String(findColumn(vRow, ['SKU VARIAN', 'SKU Varian', 'SKU', 'sku']) || '').trim() || null
          const variantHpp = sanitizeNumber(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
          const variantPrice = sanitizeNumber(findColumn(vRow, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
          const variantStock = sanitizeNumber(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))

          // Validate required fields
          if (!parentName) {
            errors.push(`Baris ${rowNum} (Varian): Nama Produk wajib diisi`)
            continue
          }

          if (!variantName) {
            errors.push(`Baris ${rowNum} (Varian): Nama Varian wajib diisi`)
            continue
          }

          if (!variantPrice || variantPrice <= 0) {
            errors.push(`Baris ${rowNum} (Varian): Harga Jual harus lebih dari 0 (Produk: ${parentName}, Varian: ${variantName})`)
            continue
          }

          // Find parent product by name + outletId (use cache)
          let parentProduct = productCache.get(parentName)
          if (!parentProduct) {
            const found = await db.product.findFirst({
              where: { name: parentName, outletId },
            })
            if (!found) {
              errors.push(`Baris ${rowNum}: Produk "${parentName}" tidak ditemukan. Upload produk terlebih dahulu`)
              variantsSkipped++
              continue
            }
            parentProduct = { id: found.id, hasVariants: !!found.hasVariants }
            productCache.set(parentName, parentProduct)
          }

          // Create variant
          await db.productVariant.create({
            data: {
              name: variantName,
              sku: variantSku,
              hpp: variantHpp,
              price: variantPrice,
              stock: variantStock,
              productId: parentProduct.id,
              outletId,
            },
          })

          // Set hasVariants = true on parent product
          if (!parentProduct.hasVariants) {
            await db.product.update({
              where: { id: parentProduct.id },
              data: { hasVariants: true },
            })
            parentProduct.hasVariants = true
          }

          variantsCreated++
        } catch (variantError) {
          const rowNum = i + 2
          const errMessage = variantError instanceof Error ? variantError.message : 'Unknown error'
          console.error(`[Bulk Upload] Variant row ${rowNum} error:`, variantError)
          errors.push(`Baris ${rowNum} (Varian): Gagal memproses — ${errMessage}`)
          variantsSkipped++
        }
      }
    }

    // Create audit log for bulk upload
    if (created > 0 || variantsCreated > 0) {
      await safeAuditLog({
        action: 'CREATE',
        entityType: 'PRODUCT',
        details: JSON.stringify({
          bulkUpload: true,
          created,
          skipped,
          variantsCreated,
          variantsSkipped,
          errors: errors.length,
          fileName: file.name,
        }),
        outletId,
        userId,
      })
    }

    return safeJson({
      created,
      skipped,
      variantsCreated,
      variantsSkipped,
      errors,
    })
  } catch (error) {
    console.error('Bulk upload error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses file upload', details: message }, 500)
  }
}
