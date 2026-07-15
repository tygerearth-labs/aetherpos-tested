import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan, isUnlimited } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import { generateUniqueSKU, generateVariantSKU } from '@/lib/sku-generator'
// Shared Excel utilities (fixes: inconsistent sanitizeNumber, code duplication)
import {
  sanitizeNumber,
  normalizeHeader,
  findColumn,
  validateUnit,
  VALID_UNITS,
} from '@/lib/excel-utils'

// Vercel serverless function timeout: 60s (default is 10s on Hobby plan)
export const maxDuration = 60

const MAX_ROWS = 500

export async function POST(request: NextRequest) {
  // Result containers (used inside and outside transaction)
  const result = {
    created: 0,
    skipped: 0,
    variantsCreated: 0,
    variantsSkipped: 0,
    compCreated: 0,
    compSkipped: 0,
    errors: [] as string[],
  }

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

    // ══════════════════════════════════════════════════════════════════
    // WRAP IN TRANSACTION for atomicity (Fix Bug #1: No Transaction)
    // If any error occurs, ALL changes are rolled back
    // ══════════════════════════════════════════════════════════════════
    await db.$transaction(async (tx) => {
      // Check product limit INSIDE transaction (Fix Bug #2: Race Condition)
      // This ensures atomic check-and-create
      if (!isUnlimited(outletPlan.features.maxProducts)) {
        const currentCount = await tx.product.count({ where: { outletId } })
        if (currentCount >= outletPlan.features.maxProducts) {
          throw new Error(`Batas produk untuk paket ${outletPlan.plan} sudah tercapai (${outletPlan.features.maxProducts}).`)
        }
        // Calculate how many new products we can create
        const remainingSlots = outletPlan.features.maxProducts - currentCount
        if (rows.length > remainingSlots) {
          result.errors.push(`Hanya bisa menambah ${remainingSlots} produk lagi. File memiliki ${rows.length} baris.`)
        }
      }

      // Cache categories to reduce DB queries
      const categoryCache = new Map<string, string | null>()

      // === Process Main Product Sheet ===
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowNum = i + 2 // Excel rows start at 1, header is row 1

        // Map column names using flexible header matching (supports any format)
        const name = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
        const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim() || null
        const barcode = String(findColumn(row, ['BARCODE', 'Barcode', 'barcode', 'BAR CODE', 'Bar Code']) || '').trim() || null
        const hpp = sanitizeNumber(findColumn(row, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
        const price = sanitizeNumber(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
        const stock = sanitizeNumber(findColumn(row, ['QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))
        const unitRaw = String(findColumn(row, ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat']) || 'pcs').trim().toLowerCase()
        const categoryRaw = String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim()
        const hasVariantsRaw = String(findColumn(row, ['PUNYA VARIAN', 'Punya Varian', 'Has Variants', 'hasVariants', 'Variants', 'Varian']) || '').trim().toLowerCase()
        const hasVariants = hasVariantsRaw === 'ya' || hasVariantsRaw === 'yes' || hasVariantsRaw === 'true'

        // Validate required fields
        if (!name) {
          result.errors.push(`Baris ${rowNum}: Nama produk wajib diisi`)
          continue
        }

        if (price < 0) {
          result.errors.push(`Baris ${rowNum}: Harga Jual tidak boleh negatif (Nama: ${name})`)
          continue
        }

        // Variant parent products must have price > 0 (price=0 only allowed for products WITH variants)
        if (price <= 0 && !hasVariants) {
          result.errors.push(`Baris ${rowNum}: Harga Jual harus lebih dari 0 (Nama: ${name})`)
          continue
        }

        // Validate stock is not negative (Fix Bug #7: Negative Stock Validation)
        if (stock < 0) {
          result.errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Nama: ${name}, Stok: ${stock})`)
          continue
        }

        const unit = validateUnit(unitRaw)

        // Check product limit INSIDE transaction (atomic)
        if (!isUnlimited(outletPlan.features.maxProducts)) {
          const currentCount = await tx.product.count({ where: { outletId } })
          if (currentCount >= outletPlan.features.maxProducts) {
            result.errors.push(`Baris ${rowNum}: Batas produk sudah tercapai, sisa produk dihentikan`)
            break
          }
        }

        // Skip duplicates (by name + outletId)
        const existing = await tx.product.findFirst({
          where: { name, outletId },
        })
        if (existing) {
          result.skipped++
          continue
        }

        // Auto-create category if needed (with cache)
        let categoryId: string | null = null
        if (categoryRaw) {
          if (categoryCache.has(categoryRaw)) {
            categoryId = categoryCache.get(categoryRaw)!
          } else {
            const existingCategory = await tx.category.findFirst({
              where: { name: categoryRaw, outletId },
            })
            if (existingCategory) {
              categoryId = existingCategory.id
              categoryCache.set(categoryRaw, categoryId)
            } else {
              const newCategory = await tx.category.create({
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

        // Auto-generate SKU if not provided
        const finalSku = sku || await generateUniqueSKU(name, outletId)
        // Auto-generate barcode from SKU if barcode not provided
        const finalBarcode = barcode || finalSku

        // Create product using transaction client
        await tx.product.create({
          data: {
            name,
            sku: finalSku,
            barcode: finalBarcode,
            hpp,
            price,
            stock,
            unit,
            categoryId,
            hasVariants,
            outletId,
          },
        })

        result.created++
      }

      // === Process "Varian Produk" sheet if it exists ===
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
            const variantBarcode = String(findColumn(vRow, ['BARCODE VARIAN', 'Barcode Varian', 'BARCODE', 'Barcode', 'barcode']) || '').trim() || null
            const variantHpp = sanitizeNumber(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
            const variantPrice = sanitizeNumber(findColumn(vRow, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
            const variantStock = sanitizeNumber(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))

            // Validate required fields
            if (!parentName) {
              result.errors.push(`Baris ${rowNum} (Varian): Nama Produk wajib diisi`)
              continue
            }

            if (!variantName) {
              result.errors.push(`Baris ${rowNum} (Varian): Nama Varian wajib diisi`)
              continue
            }

            if (!variantPrice || variantPrice <= 0) {
              result.errors.push(`Baris ${rowNum} (Varian): Harga Jual harus lebih dari 0 (Produk: ${parentName}, Varian: ${variantName})`)
              continue
            }

            // Validate variant stock is not negative (Fix Bug #7)
            if (variantStock < 0) {
              result.errors.push(`Baris ${rowNum} (Varian): Stok tidak boleh negatif (Produk: ${parentName}, Varian: ${variantName})`)
              continue
            }

            // Find parent product by name + outletId (use cache)
            let parentProduct = productCache.get(parentName)
            if (!parentProduct) {
              const found = await tx.product.findFirst({
                where: { name: parentName, outletId },
              })
              if (!found) {
                result.errors.push(`Baris ${rowNum}: Produk "${parentName}" tidak ditemukan. Upload produk terlebih dahulu`)
                result.variantsSkipped++
                continue
              }
              parentProduct = { id: found.id, hasVariants: !!found.hasVariants }
              productCache.set(parentName, parentProduct)
            }

            // Auto-generate variant SKU if not provided
            const finalVariantSku = variantSku || await generateVariantSKU(parentName, variantName, outletId)
            // Auto-generate variant barcode from SKU if not provided
            const finalVariantBarcode = variantBarcode || finalVariantSku

            // Skip duplicate variants (by name + productId) — allows safe re-upload
            const existingVariant = await tx.productVariant.findFirst({
              where: { name: variantName, productId: parentProduct.id },
            })
            if (existingVariant) {
              result.variantsSkipped++
              continue
            }

            // Create variant using transaction client
            await tx.productVariant.create({
              data: {
                name: variantName,
                sku: finalVariantSku,
                barcode: finalVariantBarcode,
                hpp: variantHpp,
                price: variantPrice,
                stock: variantStock,
                productId: parentProduct.id,
                outletId,
              },
            })

            // Set hasVariants = true on parent product
            if (!parentProduct.hasVariants) {
              await tx.product.update({
                where: { id: parentProduct.id },
                data: { hasVariants: true },
              })
              parentProduct.hasVariants = true
            }

            result.variantsCreated++
          } catch (variantError) {
            const rowNum = i + 2
            const errMessage = variantError instanceof Error ? variantError.message : 'Unknown error'
            console.error(`[Bulk Upload] Variant row ${rowNum} error:`, variantError)
            result.errors.push(`Baris ${rowNum} (Varian): Gagal memproses — ${errMessage}`)
            result.variantsSkipped++
          }
        }
      }

      // === Process "Komposisi" sheet if it exists ===
      const compSheetName = workbook.SheetNames.find(
        (n) => normalizeHeader(n).includes('komposisi')
      )

      if (compSheetName) {
        const compSheet = workbook.Sheets[compSheetName]
        const compRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(compSheet, { defval: '' })

        console.log(`[Bulk Upload] Found composition sheet "${compSheetName}" with ${compRows.length} rows`)

        // Cache products and inventory items
        const compProductCache = new Map<string, string>() // productName → productId
        const inventoryItemCache = new Map<string, { id: string; baseUnit: string }>()

        // Pre-load all inventory items for this outlet
        const allInventoryItems = await tx.inventoryItem.findMany({
          where: { outletId },
          select: { id: true, name: true, baseUnit: true },
        })
        for (const item of allInventoryItems) {
          inventoryItemCache.set(item.name, { id: item.id, baseUnit: item.baseUnit })
        }

        for (let i = 0; i < compRows.length; i++) {
          try {
            const cRow = compRows[i]
            const rowNum = i + 2

            const parentName = String(findColumn(cRow, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
            const variantName = String(findColumn(cRow, ['NAMA VARIAN', 'Nama Varian', 'Varian', 'Variant Name']) || '').trim()
            const bahanName = String(findColumn(cRow, ['NAMA BAHAN*', 'NAMA BAHAN', 'Nama Bahan', 'Bahan', 'BAHAN']) || '').trim()
            const qty = sanitizeNumber(findColumn(cRow, ['QTY*', 'QTY', 'Qty', 'qty', 'Jumlah', 'Quantity']))

            if (!parentName) {
              result.errors.push(`Baris ${rowNum} (Komposisi): Nama Produk wajib diisi`)
              continue
            }
            if (!bahanName) {
              result.errors.push(`Baris ${rowNum} (Komposisi): Nama Bahan wajib diisi (Produk: ${parentName})`)
              continue
            }
            if (!qty || qty <= 0) {
              result.errors.push(`Baris ${rowNum} (Komposisi): QTY harus lebih dari 0 (Produk: ${parentName}, Bahan: ${bahanName})`)
              continue
            }

            // Find parent product
            let productId = compProductCache.get(parentName)
            if (!productId) {
              const found = await tx.product.findFirst({ where: { name: parentName, outletId } })
              if (!found) {
                result.errors.push(`Baris ${rowNum} (Komposisi): Produk "${parentName}" tidak ditemukan`)
                result.compSkipped++
                continue
              }
              productId = found.id
              compProductCache.set(parentName, productId)
            }

            // Find inventory item
            const invItem = inventoryItemCache.get(bahanName)
            if (!invItem) {
              result.errors.push(`Baris ${rowNum} (Komposisi): Item "${bahanName}" tidak ditemukan. Daftarkan item terlebih dahulu.`)
              result.compSkipped++
              continue
            }

            // Find variant if specified
            let variantId: string | null = null
            if (variantName) {
              const foundVariant = await tx.productVariant.findFirst({
                where: { name: variantName, productId, outletId },
              })
              if (!foundVariant) {
                result.errors.push(`Baris ${rowNum} (Komposisi): Varian "${variantName}" tidak ditemukan untuk produk "${parentName}"`)
                result.compSkipped++
                continue
              }
              variantId = foundVariant.id
            }

            // Skip duplicate compositions (productId + variantId + inventoryItemId) — allows safe re-upload
            const existingComp = await tx.productComposition.findFirst({
              where: { productId, variantId: variantId || null, inventoryItemId: invItem.id },
            })
            if (existingComp) {
              result.compSkipped++
              continue
            }

            await tx.productComposition.create({
              data: {
                productId,
                variantId,
                inventoryItemId: invItem.id,
                qty,
                baseUnit: invItem.baseUnit,
              },
            })
            result.compCreated++
          } catch (compError) {
            const rowNum = i + 2
            const errMessage = compError instanceof Error ? compError.message : 'Unknown error'
            console.error(`[Bulk Upload] Composition row ${rowNum} error:`, compError)
            result.errors.push(`Baris ${rowNum} (Komposisi): Gagal memproses — ${errMessage}`)
            result.compSkipped++
          }
        }
      }
    }) // End of transaction

    // Create audit log for bulk upload (Fix Bug #14: Also log failed operations)
    await safeAuditLog({
      action: result.created > 0 ? 'CREATE' : 'UPLOAD_ATTEMPT',
      entityType: 'PRODUCT',
      details: JSON.stringify({
        bulkUpload: true,
        created: result.created,
        skipped: result.skipped,
        variantsCreated: result.variantsCreated,
        variantsSkipped: result.variantsSkipped,
        compCreated: result.compCreated,
        compSkipped: result.compSkipped,
        errors: result.errors.length,
        fileName: file.name,
        success: result.created > 0 || result.variantsCreated > 0 || result.compCreated > 0,
      }),
      outletId,
      userId,
    })

    return safeJson(result)
  } catch (error) {
    console.error('Bulk upload error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    
    // Check if this was a limit error (not a system error)
    if (message.includes('Batas produk')) {
      return safeJsonError(message, 400)
    }
    
    return safeJson({ error: 'Gagal memproses file upload', details: message }, 500)
  }
}
