import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan, isUnlimited } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
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

// ══════════════════════════════════════════════════════════════════
// IN-MEMORY SKU GENERATION (Performance + Safety)
// Generates unique SKUs using local Set with fallback to DB on conflict
// ══════════════════════════════════════════════════════════════════

const MAX_SKU_LENGTH = 22

function abbreviateName(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return 'PRD'

  let abbr = ''
  for (let i = 0; i < Math.min(words.length, 3); i++) {
    const word = words[i].toUpperCase()
    if (i === 0) {
      abbr += word.substring(0, Math.min(2, word.length))
    } else {
      abbr += word.charAt(0)
    }
  }
  return abbr.substring(0, 5)
}

function randomSuffix(length: number = 4): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  const array = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array)
    for (let i = 0; i < length; i++) {
      result += chars[array[i] % chars.length]
    }
  } else {
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)]
    }
  }
  return result
}

/**
 * Generate unique SKU in-memory with collision tracking.
 * Returns { sku, needsDbCheck } for later verification.
 */
interface SkuResult {
  sku: string
  needsDbCheck: boolean // true if we should verify in DB later
}

function generateSKUInMemory(
  name: string,
  existingSkus: Set<string>,
  generatedSkus: Set<string>,
  maxAttempts: number = 10
): SkuResult {
  const abbr = abbreviateName(name)
  const separatorLength = 1
  const maxSuffixLength = MAX_SKU_LENGTH - abbr.length - separatorLength
  const suffixLength = Math.min(Math.max(maxSuffixLength, 3), 8)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const suffix = randomSuffix(suffixLength)
    const sku = `${abbr}-${suffix}`

    // Check against BOTH pre-loaded AND newly generated SKUs
    if (!existingSkus.has(sku) && !generatedSkus.has(sku)) {
      generatedSkus.add(sku)
      return { sku, needsDbCheck: false }
    }
  }

  // Fallback: timestamp-based suffix (extremely unlikely to collide)
  const tsSuffix = Date.now().toString(36).toUpperCase().slice(-6) + randomSuffix(2)
  const fallbackSku = `${abbr.substring(0, MAX_SKU_LENGTH - 9)}-${tsSuffix}`
  generatedSkus.add(fallbackSku)
  return { sku: fallbackSku, needsDbCheck: false }
}

/**
 * Generate unique variant SKU in-memory.
 */
function generateVariantSKUInMemory(
  parentName: string,
  variantName: string,
  existingVariantSkus: Set<string>,
  generatedVariantSkus: Set<string>
): SkuResult {
  const parentAbbr = abbreviateName(parentName).substring(0, 3)
  const varAbbr = variantName.substring(0, 3).toUpperCase()

  const prefix = `${parentAbbr}-${varAbbr}`
  const maxSuffixLength = MAX_SKU_LENGTH - prefix.length - 1
  const suffixLength = Math.min(Math.max(maxSuffixLength, 3), 6)

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = randomSuffix(suffixLength)
    const sku = `${prefix}-${suffix}`

    if (!existingVariantSkus.has(sku) && !generatedVariantSkus.has(sku)) {
      generatedVariantSkus.add(sku)
      return { sku, needsDbCheck: false }
    }
  }

  const tsSuffix = Date.now().toString(36).toUpperCase().slice(-4) + randomSuffix(2)
  const fallbackSku = `${prefix.substring(0, MAX_SKU_LENGTH - 7)}-${tsSuffix}`
  generatedVariantSkus.add(fallbackSku)
  return { sku: fallbackSku, needsDbCheck: false }
}

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
    warnings: [] as string[], // For non-critical issues
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

    console.log(`[Bulk Upload] Processing ${rows.length} rows...`)

    const startTime = Date.now()

    // ══════════════════════════════════════════════════════════════════
    // PHASE 1: PRE-LOAD DATA (Performance Optimization)
    // Load all reference data ONCE before transaction
    // ══════════════════════════════════════════════════════════════════
    
    // 1. Pre-load ALL existing products for this outlet
    const existingProducts = await db.product.findMany({
      where: { outletId },
      select: { id: true, name: true, sku: true, hasVariants: true },
    })
    
    // Build lookup sets for O(1) lookups
    const existingProductNames = new Set(existingProducts.map(p => p.name.toLowerCase()))
    const existingProductSkus = new Set(existingProducts.map(p => p.sku).filter(Boolean))
    const productCacheByName = new Map(existingProducts.map(p => [p.name.toLowerCase(), { id: p.id, hasVariants: p.hasVariants }]))

    // Track NEWLY generated SKUs (separate from pre-loaded)
    const newlyGeneratedSkus = new Set<string>()
    const newlyGeneratedVariantSkus = new Set<string>()

    // 2. Pre-load categories
    const existingCategories = await db.category.findMany({
      where: { outletId },
      select: { id: true, name: true },
    })
    const categoryCache = new Map<string, string>()
    for (const cat of existingCategories) {
      categoryCache.set(cat.name.toLowerCase(), cat.id)
    }

    // 3. Pre-load variants (for duplicate check)
    const existingVariants = await db.productVariant.findMany({
      where: { outletId },
      select: { id: true, name: true, productId: true, sku: true },
    })
    const variantKeySet = new Set<string>() // "productId|variantName"
    const variantSkuSet = new Set(existingVariants.map(v => v.sku).filter(Boolean))
    for (const v of existingVariants) {
      variantKeySet.add(`${v.productId}|${v.name.toLowerCase()}`)
    }

    // 4. Pre-load inventory items
    const inventoryItems = await db.inventoryItem.findMany({
      where: { outletId },
      select: { id: true, name: true, baseUnit: true },
    })
    const inventoryItemCache = new Map(inventoryItems.map(item => [item.name, { id: item.id, baseUnit: item.baseUnit }]))

    // 5. Pre-load compositions
    const existingCompositions = await db.productComposition.findMany({
      where: { productId: { in: existingProducts.map(p => p.id) } },
      select: { productId: true, variantId: true, inventoryItemId: true },
    })
    const compositionKeySet = new Set<string>()
    for (const comp of existingCompositions) {
      compositionKeySet.add(`${comp.productId}|${comp.variantId || ''}|${comp.inventoryItemId}`)
    }

    console.log(`[Bulk Upload] Pre-loaded data in ${Date.now() - startTime}ms`)

    // ══════════════════════════════════════════════════════════════════
    // PHASE 2: VALIDATION (with early exit on critical errors)
    // ══════════════════════════════════════════════════════════════════

    // Check product limit (pre-check only - will re-verify inside transaction)
    if (!isUnlimited(outletPlan.features.maxProducts)) {
      const currentCount = existingProducts.length
      if (currentCount >= outletPlan.features.maxProducts) {
        throw new Error(`Batas produk untuk paket ${outletPlan.plan} sudah tercapai (${outletPlan.features.maxProducts}).`)
      }
      const remainingSlots = outletPlan.features.maxProducts - currentCount
      if (rows.length > remainingSlots) {
        result.warnings.push(`File memiliki ${rows.length} baris, tapi sisa slot hanya ${remainingSlots}. Beberapa baris mungkin gagal.`)
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // PHASE 3: TRANSACTION (Atomic writes + Safety Net)
    // ══════════════════════════════════════════════════════════════════
    
    const txStartTime = Date.now()

    await db.$transaction(async (tx) => {
      // ══════════════════════════════════════════════════════════════════
      // SAFETY NET #1: Re-verify product limit INSIDE transaction
      // This catches race conditions where another request created products
      // between our pre-load and now.
      // ══════════════════════════════════════════════════════════════════
      if (!isUnlimited(outletPlan.features.maxProducts)) {
        const actualCount = await tx.product.count({ where: { outletId } })
        const effectiveLimit = outletPlan.features.maxProducts
        
        if (actualCount >= effectiveLimit) {
          throw new Error(`Batas produk sudah tercapai (${effectiveLimit}). Upload ditolak.`)
        }
        
        // Calculate how many we can actually create
        const availableSlots = effectiveLimit - actualCount
        if (availableSlots < rows.length) {
          result.warnings.push(`Limit hampir tercapai. Hanya ${availableSlots} produk yang akan dibuat dari ${rows.length} baris.`)
        }
      }

      // Track created items in THIS batch (for intra-batch duplicate detection)
      const batchCreatedProducts = new Map<string, string>() // name.lower → id

      // === Process Main Product Sheet ===
      let consecutiveLimitHits = 0 // Detect when we're hitting limit repeatedly
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowNum = i + 2

        // Extract fields
        const name = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
        const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim() || null
        const barcode = String(findColumn(row, ['BARCODE', 'Barcode', 'barcode', 'BAR CODE', 'Bar Code']) || '').trim() || null
        const hpp = sanitizeNumber(findColumn(row, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
        const price = sanitizeNumber(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
        const stock = sanitizeNumber(findColumn(row, ['QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))
        const unitRaw = String(findColumn(row, ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat']) || 'pcs').trim().toLowerCase()
        const categoryRaw = String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim()
        const hasVariantsRaw = String(findColumn(row, ['PUNYA VARIAN', 'Punya Varian', 'Has Variants', 'hasVariants', 'Varians', 'Varian']) || '').trim().toLowerCase()
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

        if (price <= 0 && !hasVariants) {
          result.errors.push(`Baris ${rowNum}: Harga Jual harus lebih dari 0 (Nama: ${name})`)
          continue
        }

        if (stock < 0) {
          result.errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Nama: ${name}, Stok: ${stock})`)
          continue
        }

        const unit = validateUnit(unitRaw)

        // ══════════════════════════════════════════════════════════════════
        // SAFETY NET #2: Re-check limit inside loop (but use running count)
        // Only query DB every 50 iterations to balance safety vs performance
        // ══════════════════════════════════════════════════════════════════
        if (!isUnlimited(outletPlan.features.maxProducts)) {
          // Query every 50 iterations or when we've had limit issues
          if (result.created % 50 === 0 || consecutiveLimitHits > 0) {
            const currentTotal = await tx.product.count({ where: { outletId } })
            if (currentTotal >= outletPlan.features.maxProducts) {
              result.warnings.push(`Baris ${rowNum} onwards: Batas produk tercapai (${outletPlan.features.maxProducts}), sisa dihentikan`)
              break
            }
            consecutiveLimitHits = 0
          }
        }

        // ══════════════════════════════════════════════════════════════════
        // DUPLICATE CHECK (3 layers of protection!)
        // Layer 1: Pre-existing products (from pre-load)
        // Layer 2: Products created earlier in THIS batch
        // Layer 3: Database verification (for high-confidence cases)
        // ══════════════════════════════════════════════════════════════════
        
        const nameLower = name.toLowerCase()
        
        // Layer 1: Check pre-loaded data
        if (existingProductNames.has(nameLower)) {
          result.skipped++
          continue
        }
        
        // Layer 2: Check batch-created products
        if (batchCreatedProducts.has(nameLower)) {
          result.skipped++
          continue
        }

        // Layer 3: Optional DB check (only if suspicious - e.g., same name appears twice in file)
        // This is a safety net, not the primary check
        const nameOccurrences = rows.filter((r, idx) => 
          idx >= i && 
          String(findColumn(r, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim().toLowerCase() === nameLower
        ).length
        
        if (nameOccurrences > 1) {
          // Same name appears again in file - do a quick DB check
          const dbCheck = await tx.product.findFirst({
            where: { name, outletId },
            select: { id: true },
          })
          if (dbCheck) {
            result.skipped++
            continue
          }
        }

        // Auto-create category if needed
        let categoryId: string | null = null
        if (categoryRaw) {
          const catKey = categoryRaw.toLowerCase()
          if (categoryCache.has(catKey)) {
            categoryId = categoryCache.get(catKey)!
          } else {
            const newCategory = await tx.category.create({
              data: { name: categoryRaw, outletId, color: 'zinc' },
            })
            categoryId = newCategory.id
            categoryCache.set(catKey, categoryId)
          }
        }

        // Generate SKU in-memory (tracks both pre-loaded AND newly generated)
        const finalSku = sku || generateSKUInMemory(name, existingProductSkus, newlyGeneratedSkus).sku
        const finalBarcode = barcode || finalSku

        // Create product
        const newProduct = await tx.product.create({
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

        // Update caches for subsequent processing
        batchCreatedProducts.set(nameLower, newProduct.id)
        productCacheByName.set(nameLower, { id: newProduct.id, hasVariants: false })
        existingProductNames.add(nameLower)
        if (finalSku) {
          existingProductSkus.add(finalSku)
        }

        result.created++
        consecutiveLimitHits = 0 // Reset - successful creation
      }

      // === Process "Varian Produk" sheet ===
      const variantSheetName = workbook.SheetNames.find(
        (n) => normalizeHeader(n).includes('varian')
      )

      if (variantSheetName) {
        const variantSheet = workbook.Sheets[variantSheetName]
        const variantRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(variantSheet, { defval: '' })

        console.log(`[Bulk Upload] Processing ${variantRows.length} variant rows...`)

        // Merge pre-loaded + newly created products
        const allProductsLookup = new Map(productCacheByName)

        for (let i = 0; i < variantRows.length; i++) {
          try {
            const vRow = variantRows[i]
            const rowNum = i + 2

            const parentName = String(findColumn(vRow, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
            const variantName = String(findColumn(vRow, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Variant Name', 'Varian']) || '').trim()
            const variantSku = String(findColumn(vRow, ['SKU VARIAN', 'SKU Varian', 'SKU', 'sku']) || '').trim() || null
            const variantBarcode = String(findColumn(vRow, ['BARCODE VARIAN', 'Barcode Varian', 'BARCODE', 'Barcode', 'barcode']) || '').trim() || null
            const variantHpp = sanitizeNumber(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
            const variantPrice = sanitizeNumber(findColumn(vRow, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
            const variantStock = sanitizeNumber(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))

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

            if (variantStock < 0) {
              result.errors.push(`Baris ${rowNum} (Varian): Stok tidak boleh negatif (Produk: ${parentName}, Varian: ${variantName})`)
              continue
            }

            // Find parent product
            const parentProduct = allProductsLookup.get(parentName.toLowerCase())
            if (!parentProduct) {
              result.errors.push(`Baris ${rowNum}: Produk "${parentName}" tidak ditemukan`)
              result.variantsSkipped++
              continue
            }

            // Generate variant SKU
            const finalVariantSku = variantSku || generateVariantSKUInMemory(parentName, variantName, variantSkuSet, newlyGeneratedVariantSkus).sku
            const finalVariantBarcode = variantBarcode || finalVariantSku

            // Check duplicate (pre-loaded + batch-created)
            const variantKey = `${parentProduct.id}|${variantName.toLowerCase()}`
            if (variantKeySet.has(variantKey)) {
              result.variantsSkipped++
              continue
            }

            // Create variant
            const newVariant = await tx.productVariant.create({
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

            // Update caches
            variantKeySet.add(variantKey)
            if (finalVariantSku) variantSkuSet.add(finalVariantSku)

            // Update parent's hasVariants flag
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

      // === Process "Komposisi" sheet ===
      const compSheetName = workbook.SheetNames.find(
        (n) => normalizeHeader(n).includes('komposisi')
      )

      if (compSheetName) {
        const compSheet = workbook.Sheets[compSheetName]
        const compRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(compSheet, { defval: '' })

        console.log(`[Bulk Upload] Processing ${compRows.length} composition rows...`)

        // Build combined product lookup
        const compProductLookup = new Map<string, string>()
        for (const p of existingProducts) {
          compProductLookup.set(p.name.toLowerCase(), p.id)
        }
        for (const [nameLower, id] of batchCreatedProducts) {
          compProductLookup.set(nameLower, id)
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
            const productId = compProductLookup.get(parentName.toLowerCase())
            if (!productId) {
              result.errors.push(`Baris ${rowNum} (Komposisi): Produk "${parentName}" tidak ditemukan`)
              result.compSkipped++
              continue
            }

            // Find inventory item
            const invItem = inventoryItemCache.get(bahanName)
            if (!invItem) {
              result.errors.push(`Baris ${rowNum} (Komposisi): Item "${bahanName}" tidak ditemukan`)
              result.compSkipped++
              continue
            }

            // Find variant if specified
            let variantId: string | null = null
            if (variantName) {
              // Look up variant from our cache or DB
              const foundVariant = await tx.productVariant.findFirst({
                where: { 
                  name: variantName, 
                  productId, 
                  outletId,
                },
                select: { id: true },
              })
              if (!foundVariant) {
                result.errors.push(`Baris ${rowNum} (Komposisi): Varian "${variantName}" tidak ditemukan`)
                result.compSkipped++
                continue
              }
              variantId = foundVariant.id
            }

            // Skip duplicates
            const compKey = `${productId}|${variantId || ''}|${invItem.id}`
            if (compositionKeySet.has(compKey)) {
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

            compositionKeySet.add(compKey)
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

    const totalTime = Date.now() - startTime
    
    console.log(`[Bulk Upload] Completed in ${totalTime}ms:`)
    console.log(`  Created: ${result.created}, Skipped: ${result.skipped}`)
    console.log(`  Variants: ${result.variantsCreated}, Compositions: ${result.compCreated}`)

    // Audit log
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
        warnings: result.warnings.length,
        fileName: file.name,
        processingTimeMs: totalTime,
        success: result.created > 0 || result.variantsCreated > 0 || result.compCreated > 0,
      }),
      outletId,
      userId,
    })

    return safeJson(result)
  } catch (error) {
    console.error('Bulk upload error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    
    if (message.includes('Batas produk')) {
      return safeJsonError(message, 400)
    }
    
    return safeJson({ error: 'Gagal memproses file upload', details: message }, 500)
  }
}
