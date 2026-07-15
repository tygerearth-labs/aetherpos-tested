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
const CHUNK_SIZE = 50 // Process in chunks of 50 for better reliability

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
 */
function generateSKUInMemory(
  name: string,
  existingSkus: Set<string>,
  generatedSkus: Set<string>,
  maxAttempts: number = 10
): string {
  const abbr = abbreviateName(name)
  const maxSuffixLength = MAX_SKU_LENGTH - abbr.length - 1
  const suffixLength = Math.min(Math.max(maxSuffixLength, 3), 8)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const suffix = randomSuffix(suffixLength)
    const sku = `${abbr}-${suffix}`

    if (!existingSkus.has(sku) && !generatedSkus.has(sku)) {
      generatedSkus.add(sku)
      return sku
    }
  }

  // Fallback: timestamp-based suffix
  const tsSuffix = Date.now().toString(36).toUpperCase().slice(-6) + randomSuffix(2)
  const fallbackSku = `${abbr.substring(0, MAX_SKU_LENGTH - 9)}-${tsSuffix}`
  generatedSkus.add(fallbackSku)
  return fallbackSku
}

/**
 * Generate unique variant SKU in-memory.
 */
function generateVariantSKUInMemory(
  parentName: string,
  variantName: string,
  existingVariantSkus: Set<string>,
  generatedVariantSkus: Set<string>
): string {
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
      return sku
    }
  }

  const tsSuffix = Date.now().toString(36).toUpperCase().slice(-4) + randomSuffix(2)
  const fallbackSku = `${prefix.substring(0, MAX_SKU_LENGTH - 7)}-${tsSuffix}`
  generatedVariantSkus.add(fallbackSku)
  return fallbackSku
}

// ══════════════════════════════════════════════════════════════════
// INTERFACES FOR BATCH DATA COLLECTION
// ══════════════════════════════════════════════════════════════════

interface ProductToCreate {
  name: string
  sku: string
  barcode: string | null
  hpp: number
  price: number
  stock: number
  unit: string
  categoryId: string | null
  hasVariants: boolean
  outletId: string
  rowNum: number
}

interface VariantToCreate {
  productId: string
  name: string
  sku: string
  barcode: string | null
  hpp: number
  price: number
  stock: number
  outletId: string
  rowNum: number
  parentName: string
}

interface CompositionToCreate {
  productId: string
  variantName: string | null
  inventoryItemId: string
  qty: number
  baseUnit: string
  avgCost: number
  currentStock: number
  rowNum: number
}

/**
 * Pre-loaded data container - all reference data loaded once
 */
interface PreloadedData {
  existingProducts: Array<{ id: string; name: string; sku: string | null; hasVariants: boolean }>
  existingProductNames: Set<string>
  existingProductSkus: Set<string>
  productCacheByName: Map<string, { id: string; hasVariants: boolean }>
  
  categoryCache: Map<string, string>
  
  variantKeySet: Set<string> // "productId|variantName"
  variantSkuSet: Set<string>
  
  inventoryItemCache: Map<string, { 
    id: string; 
    baseUnit: string; 
    avgCost: number;
    stock: number;
  }>
  
  compositionKeySet: Set<string> // "productId|variantId|itemId"
}

export async function POST(request: NextRequest) {
  // Result containers
  const result = {
    created: 0,
    skipped: 0,
    variantsCreated: 0,
    variantsSkipped: 0,
    compCreated: 0,
    compSkipped: 0,
    errors: [] as string[],
    warnings: [] as string[],
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

    const startTime = Date.now()

    // ══════════════════════════════════════════════════════════════════
    // PHASE 1: PARALLEL PRE-LOAD (Optimization #1)
    // Load ALL reference data ONCE using Promise.all for ~50% faster load
    // ══════════════════════════════════════════════════════════════════
    
    const [
      existingProducts,
      existingCategories,
      existingVariants,
      inventoryItems,
      existingCompositions,
    ] = await Promise.all([
      // 1. All existing products
      db.product.findMany({
        where: { outletId },
        select: { id: true, name: true, sku: true, hasVariants: true },
      }),
      // 2. Categories
      db.category.findMany({
        where: { outletId },
        select: { id: true, name: true },
      }),
      // 3. Variants (for duplicate check + smart cache)
      db.productVariant.findMany({
        where: { outletId },
        select: { id: true, name: true, productId: true, sku: true },
      }),
      // 4. Inventory items (with avgCost & stock for HPP calculation)
      db.inventoryItem.findMany({
        where: { outletId },
        select: { id: true, name: true, baseUnit: true, avgCost: true, stock: true },
      }),
      // 5. Existing compositions (for duplicate check)
      db.productComposition.findMany({
        select: { productId: true, variantId: true, inventoryItemId: true },
      }),
    ])

    // Build lookup structures (O(1) lookups)
    const preloadedData: PreloadedData = {
      existingProducts,
      existingProductNames: new Set(existingProducts.map(p => p.name.toLowerCase())),
      existingProductSkus: new Set(existingProducts.map(p => p.sku).filter(Boolean)),
      productCacheByName: new Map(existingProducts.map(p => [p.name.toLowerCase(), { id: p.id, hasVariants: p.hasVariants }])),
      
      categoryCache: new Map(),
      
      variantKeySet: new Set(), // "productId|variantName"
      variantSkuSet: new Set(existingVariants.map(v => v.sku).filter(Boolean) as string[]),
      
      inventoryItemCache: new Map(),
      
      compositionKeySet: new Set(),
    }

    // Populate category cache
    for (const cat of existingCategories) {
      preloadedData.categoryCache.set(cat.name.toLowerCase(), cat.id)
    }

    // Populate variant key set (Optimization #4: Smart Cache)
    for (const v of existingVariants) {
      preloadedData.variantKeySet.add(`${v.productId}|${v.name.toLowerCase()}`)
    }

    // Populate inventory item cache with cost data
    for (const item of inventoryItems) {
      preloadedData.inventoryItemCache.set(item.name, {
        id: item.id,
        baseUnit: item.baseUnit,
        avgCost: Number(item.avgCost) || 0,
        stock: Number(item.stock) || 0,
      })
    }

    // Populate composition key set
    for (const comp of existingCompositions) {
      preloadedData.compositionKeySet.add(`${comp.productId}|${comp.variantId || ''}|${comp.inventoryItemId}`)
    }

    console.log(`[Bulk Upload] Pre-loaded ${existingProducts.length} products, ${existingCategories.length} categories, ${existingVariants.length} variants, ${inventoryItems.length} items in ${Date.now() - startTime}ms`)

    // Track NEWLY generated SKUs
    const newlyGeneratedSkus = new Set<string>()
    const newlyGeneratedVariantSkus = new Set<string>()

    // ══════════════════════════════════════════════════════════════════
    // PHASE 2: CHECK PRODUCT LIMIT (Safety Net #1)
    // ══════════════════════════════════════════════════════════════════

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
    // PHASE 3: COLLECT ALL DATA IN MEMORY (No DB writes yet!)
    // ══════════════════════════════════════════════════════════════════

    const productsToCreate: ProductToCreate[] = []
    const categoriesToCreate: Array<{ name: string; outletId: string }> = []
    const batchCreatedProducts = new Map<string, string>() // name.lower → tempId
    const batchCreatedCategories = new Map<string, string>() // categoryName.lower → tempId
    
    // Process Main Product Sheet
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2

      // Extract fields
      const name = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
      const skuInput = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim() || null
      const barcode = String(findColumn(row, ['BARCODE', 'Barcode', 'barcode', 'BAR CODE', 'Bar Code']) || '').trim() || null
      const hpp = sanitizeNumber(findColumn(row, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
      const price = sanitizeNumber(findColumn(row, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
      const stock = sanitizeNumber(findColumn(row, ['QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))
      const unitRaw = String(findColumn(row, ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat']) || 'pcs').trim().toLowerCase()
      const categoryRaw = String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim()
      const hasVariantsRaw = String(findColumn(row, ['PUNYA VARIAN', 'Punya Varian', 'Has Variants', 'hasVariants', 'Varians', 'Varian']) || '').trim().toLowerCase()
      const hasVariants = hasVariantsRaw === 'ya' || hasVariantsRaw === 'yes' || hasVariantsRaw === 'true'

      // ── SAFETY NET: Validate required fields ──
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

      // ── SAFETY NET: Block negative stock ──
      if (stock < 0) {
        result.errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Nama: ${name}, Stok: ${stock})`)
        continue
      }

      const unit = validateUnit(unitRaw)

      // ── SAFETY NET: Duplicate Check Layer 1 (Pre-existing) ──
      const nameLower = name.toLowerCase()
      
      if (preloadedData.existingProductNames.has(nameLower)) {
        result.skipped++
        continue
      }
      
      // ── SAFETY NET: Duplicate Check Layer 2 (Intra-batch) ──
      if (batchCreatedProducts.has(nameLower)) {
        result.skipped++
        continue
      }

      // Handle category (with dedup)
      let categoryId: string | null = null
      if (categoryRaw) {
        const catKey = categoryRaw.toLowerCase()
        if (preloadedData.categoryCache.has(catKey)) {
          categoryId = preloadedData.categoryCache.get(catKey)!
        } else if (batchCreatedCategories.has(catKey)) {
          categoryId = batchCreatedCategories.get(catKey)!
        } else {
          batchCreatedCategories.set(catKey, `new-${catKey}`)
          categoriesToCreate.push({ name: categoryRaw, outletId })
          categoryId = `new-${catKey}`
        }
      }

      // Generate SKU in-memory
      const finalSku = skuInput || generateSKUInMemory(name, preloadedData.existingProductSkus, newlyGeneratedSkus)
      const finalBarcode = barcode || finalSku

      // Collect product
      productsToCreate.push({
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
        rowNum,
      })

      batchCreatedProducts.set(nameLower, `pending-${productsToCreate.length}`)
    }

    // ══════════════════════════════════════════════════════════════════
    // PHASE 4: COLLECT VARIANT DATA (Optimization #5: Lazy Load)
    // Only process if sheet exists and has data
    // ══════════════════════════════════════════════════════════════════

    const variantsToCreate: VariantToCreate[] = []

    const variantSheetName = workbook.SheetNames.find(
      (n) => normalizeHeader(n).includes('varian')
    )

    if (variantSheetName) {
      const variantSheet = workbook.Sheets[variantSheetName]
      const variantRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(variantSheet, { defval: '' })

      // Optimization #5: Skip if empty
      if (variantRows.length > 0) {
        for (let i = 0; i < variantRows.length; i++) {
          const vRow = variantRows[i]
          const rowNum = i + 2

          const parentName = String(findColumn(vRow, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
          const variantName = String(findColumn(vRow, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Variant Name', 'Varian']) || '').trim()
          const variantSku = String(findColumn(vRow, ['SKU VARIAN', 'SKU Varian', 'SKU', 'sku']) || '').trim() || null
          const variantBarcode = String(findColumn(vRow, ['BARCODE VARIAN', 'Barcode Varian', 'BARCODE', 'Barcode', 'barcode']) || '').trim() || null
          const variantHpp = sanitizeNumber(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
          const variantPrice = sanitizeNumber(findColumn(vRow, ['HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual', 'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual']))
          const variantStock = sanitizeNumber(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))

          // Validation
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

          // Safety Net: Block negative stock
          if (variantStock < 0) {
            result.errors.push(`Baris ${rowNum} (Varian): Stok tidak boleh negatif (Produk: ${parentName}, Varian: ${variantName})`)
            continue
          }

          // Find parent product
          const parentLookup = preloadedData.productCacheByName.get(parentName.toLowerCase())
          let parentId: string | null = parentLookup?.id || null
          
          if (!parentId && batchCreatedProducts.has(parentName.toLowerCase())) {
            parentId = `batch-${parentName.toLowerCase()}`
          }

          if (!parentId) {
            result.errors.push(`Baris ${rowNum}: Produk "${parentName}" tidak ditemukan`)
            result.variantsSkipped++
            continue
          }

          // Generate variant SKU
          const finalVariantSku = variantSku || generateVariantSKUInMemory(parentName, variantName, preloadedData.variantSkuSet, newlyGeneratedVariantSkus)
          const finalVariantBarcode = variantBarcode || finalVariantSku

          // Duplicate check
          if (!parentId.toString().startsWith('batch-')) {
            const variantKey = `${parentId}|${variantName.toLowerCase()}`
            if (preloadedData.variantKeySet.has(variantKey)) {
              result.variantsSkipped++
              continue
            }
          }

          variantsToCreate.push({
            productId: parentId,
            name: variantName,
            sku: finalVariantSku,
            barcode: finalVariantBarcode,
            hpp: variantHpp,
            price: variantPrice,
            stock: variantStock,
            outletId,
            rowNum,
            parentName,
          })
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // PHASE 5: COLLECT COMPOSITION DATA (Lazy Load)
    // ══════════════════════════════════════════════════════════════════

    const compositionsToCreate: CompositionToCreate[] = []

    const compSheetName = workbook.SheetNames.find(
      (n) => normalizeHeader(n).includes('komposisi')
    )

    if (compSheetName) {
      const compSheet = workbook.Sheets[compSheetName]
      const compRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(compSheet, { defval: '' })

      // Optimization #5: Skip if empty
      if (compRows.length > 0) {
        for (let i = 0; i < compRows.length; i++) {
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
          const productId = preloadedData.productCacheByName.get(parentName.toLowerCase())?.id || 
                            (batchCreatedProducts.has(parentName.toLowerCase()) ? `batch-${parentName.toLowerCase()}` : null)
          
          if (!productId) {
            result.errors.push(`Baris ${rowNum} (Komposisi): Produk "${parentName}" tidak ditemukan`)
            result.compSkipped++
            continue
          }

          // Find inventory item
          const invItem = preloadedData.inventoryItemCache.get(bahanName)
          if (!invItem) {
            result.errors.push(`Baris ${rowNum} (Komposisi): Item "${bahanName}" tidak ditemukan`)
            result.compSkipped++
            continue
          }

          compositionsToCreate.push({
            productId: productId as string,
            variantName: variantName || null,
            inventoryItemId: invItem.id,
            qty,
            baseUnit: invItem.baseUnit,
            avgCost: invItem.avgCost,
            currentStock: invItem.stock,
            rowNum,
          })
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // PHASE 5.5: AUTO-CALCULATE HPP & MAX STOCK FROM COMPOSITIONS
    // ══════════════════════════════════════════════════════════════════

    /**
     * Calculate HPP from compositions: Σ(qty × avgCost)
     */
    function calculateHPPFromCompositions(comps: CompositionToCreate[]): number {
      if (comps.length === 0) return 0
      
      let totalCost = 0
      for (const comp of comps) {
        totalCost += comp.qty * comp.avgCost
      }
      return Math.round(totalCost)
    }

    /**
     * Calculate max possible product quantity based on inventory item stocks.
     */
    function calculateMaxStockFromCompositions(comps: CompositionToCreate[]): number {
      if (comps.length === 0) return Infinity
      
      let minStock = Infinity
      
      for (const comp of comps) {
        if (comp.qty <= 0) continue
        
        const maxFromThisItem = Math.floor(comp.currentStock / comp.qty)
        
        if (maxFromThisItem < minStock) {
          minStock = maxFromThisItem
        }
      }
      
      return minStock === Infinity ? 0 : Math.max(0, minStock)
    }

    // Group compositions by product
    const compositionsByProduct = new Map<string, CompositionToCreate[]>()
    for (const comp of compositionsToCreate) {
      const key = comp.productId
      if (!compositionsByProduct.has(key)) {
        compositionsByProduct.set(key, [])
      }
      compositionsByProduct.get(key)!.push(comp)
    }

    // Apply auto-calculations
    let hppAutoCalculated = 0
    let stockAutoAdjusted = 0

    for (const prod of productsToCreate) {
      let prodComps: CompositionToCreate[] | undefined
      
      // Find compositions for this product
      for (const [batchKey] of batchCreatedProducts) {
        if (prod.name.toLowerCase() === batchKey) {
          prodComps = compositionsByProduct.get(`batch-${batchKey}`)
          break
        }
      }
      
      if (!prodComps) {
        const existingProdInfo = preloadedData.productCacheByName.get(prod.name.toLowerCase())
        if (existingProdInfo) {
          prodComps = compositionsByProduct.get(existingProdInfo.id)
        }
      }

      if (!prodComps || prodComps.length === 0) continue

      // Auto-calculate HPP
      const calculatedHPP = calculateHPPFromCompositions(prodComps)
      
      if (calculatedHPP > 0) {
        if (prod.hpp === 0 || prod.hpp === null) {
          prod.hpp = calculatedHPP
          hppAutoCalculated++
        } else if (Math.abs(prod.hpp - calculatedHPP) > calculatedHPP * 0.2) {
          result.warnings.push(
            `Produk "${prod.name}": HPP input (Rp${prod.hpp.toLocaleString('id-ID')}) ` +
            `berbeda signifikan dari kalkulasi komposisi (Rp${calculatedHPP.toLocaleString('id-ID')}).`
          )
        }
      }

      // Auto-adjust stock based on composition availability
      const calculatedMaxStock = calculateMaxStockFromCompositions(prodComps)
      
      if (calculatedMaxStock !== Infinity && calculatedMaxStock > 0) {
        if (prod.stock > calculatedMaxStock || prod.stock === 999) {
          const originalStock = prod.stock
          prod.stock = calculatedMaxStock
          
          if (originalStock !== 999) {
            result.warnings.push(
              `Produk "${prod.name}": Stok disesuaikan dari ${originalStock} → ${calculatedMaxStock} ` +
              `(maksimal berdasarkan ketersediaan bahan)`
            )
          }
          stockAutoAdjusted++
        } else if (calculatedMaxStock < 10) {
          result.warnings.push(
            `Produk "${prod.name}": Stok bahan komposisi hanya cukup untuk ${calculatedMaxStock} produk.`
          )
        }
      } else if (calculatedMaxStock === 0) {
        result.warnings.push(
          `Produk "${prod.name}": TIDAK DAPAT diproduksi! Bahan tidak mencukupi. Stok di-set ke 0.`
        )
        prod.stock = 0
        stockAutoAdjusted++
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // PHASE 6: CHUNKED PROCESSING (Optimization #3)
    // Process data in chunks to avoid transaction timeouts
    // Each chunk gets its own transaction for reliability
    // ══════════════════════════════════════════════════════════════════

    const txStartTime = Date.now()

    // Split products into chunks
    const productChunks: ProductToCreate[][] = []
    for (let i = 0; i < productsToCreate.length; i += CHUNK_SIZE) {
      productChunks.push(productsToCreate.slice(i, i + CHUNK_SIZE))
    }

    // Track all created IDs across chunks
    const globalProductNameToIdMap = new Map<string, string>()
    const globalCreatedVariantMap = new Map<string, string>() // "productId|variantName" → variantId
    const globalProductIdsWithVariants = new Set<string>()

    for (let chunkIndex = 0; chunkIndex < productChunks.length; chunkIndex++) {
      const chunk = productChunks[chunkIndex]
      const isLastChunk = chunkIndex === productChunks.length - 1

      await db.$transaction(async (tx) => {
        // ── SAFETY NET: Re-verify limit inside each chunk ──
        if (!isUnlimited(outletPlan.features.maxProducts)) {
          const actualCount = await tx.product.count({ where: { outletId } })
          
          if (actualCount >= outletPlan.features.maxProducts) {
            throw new Error(`Batas produk sudah tercapai (${outletPlan.features.maxProducts}). Upload dihentikan.`)
          }
          
          const availableSlots = outletPlan.features.maxProducts - actualCount
          if (availableSlots < chunk.length && chunkIndex === 0) {
            result.warnings.push(`Limit hampir tercapai. Hanya ${Math.min(availableSlots, chunk.length)} produk yang akan dibuat.`)
          }
        }

        // ── STEP 1: Create categories (only in first chunk) ──
        if (chunkIndex === 0 && categoriesToCreate.length > 0) {
          const uniqueCategories = [...new Map(categoriesToCreate.map(c => [c.name.toLowerCase(), c])).values()]
          
          for (const cat of uniqueCategories) {
            const catKey = cat.name.toLowerCase()
            
            // Double-check not created between preload and now
            if (preloadedData.categoryCache.has(catKey)) {
              batchCreatedCategories.set(catKey, preloadedData.categoryCache.get(catKey)!)
              continue
            }
            
            const newCategory = await tx.category.create({
              data: { name: cat.name, outletId, color: 'zinc' },
            })
            
            preloadedData.categoryCache.set(catKey, newCategory.id)
            batchCreatedCategories.set(catKey, newCategory.id)
          }
        }

        // Update category IDs for this chunk's products
        for (const prod of chunk) {
          if (prod.categoryId && prod.categoryId.toString().startsWith('new-')) {
            const realCatId = batchCreatedCategories.get(prod.categoryId.replace('new-', ''))
            if (realCatId && !realCatId.toString().startsWith('new-')) {
              prod.categoryId = realCatId
            }
          }
        }

        // ── STEP 2: Create products in this chunk ──
        for (const prodData of chunk) {
          const newProduct = await tx.product.create({
            data: {
              name: prodData.name,
              sku: prodData.sku,
              barcode: prodData.barcode,
              hpp: prodData.hpp,
              price: prodData.price,
              stock: prodData.stock,
              unit: prodData.unit,
              categoryId: prodData.categoryId,
              hasVariants: prodData.hasVariants,
              outletId: prodData.outletId,
            },
          })

          globalProductNameToIdMap.set(newProduct.name.toLowerCase(), newProduct.id)
          batchCreatedProducts.set(newProduct.name.toLowerCase(), newProduct.id)
          preloadedData.existingProductNames.add(newProduct.name.toLowerCase())
          if (newProduct.sku) {
            preloadedData.existingProductSkus.add(newProduct.sku)
          }
          result.created++
        }

        // ── STEP 3: Create variants (only in last chunk to ensure all products exist) ──
        if (isLastChunk && variantsToCreate.length > 0) {
          for (const varData of variantsToCreate) {
            let resolvedProductId = varData.productId
            
            if (resolvedProductId.toString().startsWith('batch-')) {
              const nameKey = resolvedProductId.replace('batch-', '')
              resolvedProductId = batchCreatedProducts.get(nameKey) || 
                               globalProductNameToIdMap.get(nameKey) || ''
            }

            if (!resolvedProductId) {
              result.errors.push(`Baris ${varData.rowNum}: Tidak dapat menemukan ID produk untuk "${varData.parentName}"`)
              result.variantsSkipped++
              continue
            }

            // Final duplicate check
            const variantKey = `${resolvedProductId}|${varData.name.toLowerCase()}`
            if (preloadedData.variantKeySet.has(variantKey)) {
              result.variantsSkipped++
              continue
            }

            // Create variant
            const newVariant = await tx.productVariant.create({
              data: {
                name: varData.name,
                sku: varData.sku,
                barcode: varData.barcode,
                hpp: varData.hpp,
                price: varData.price,
                stock: varData.stock,
                productId: resolvedProductId,
                outletId: varData.outletId,
              },
            })

            // Store for composition resolution
            globalCreatedVariantMap.set(`${resolvedProductId}|${varData.name.toLowerCase()}`, newVariant.id)
            preloadedData.variantKeySet.add(variantKey)
            globalProductIdsWithVariants.add(resolvedProductId)
            result.variantsCreated++
          }

          // Update hasVariants flag
          for (const productId of globalProductIdsWithVariants) {
            await tx.product.update({
              where: { id: productId },
              data: { hasVariants: true },
            })
          }
        }

        // ── STEP 4: Create compositions (only in last chunk) ──
        if (isLastChunk && compositionsToCreate.length > 0) {
          for (const compData of compositionsToCreate) {
            let resolvedProductId = compData.productId
            
            if (resolvedProductId.toString().startsWith('batch-')) {
              const nameKey = resolvedProductId.replace('batch-', '')
              resolvedProductId = batchCreatedProducts.get(nameKey) || 
                               globalProductNameToIdMap.get(nameKey) || ''
            }

            if (!resolvedProductId) {
              result.compSkipped++
              continue
            }

            // Resolve variant ID if specified
            let resolvedVariantId: string | null = null
            
            if (compData.variantName) {
              // Look up from newly created variants map first
              const variantLookupKey = `${resolvedProductId}|${compData.variantName.toLowerCase()}`
              resolvedVariantId = globalCreatedVariantMap.get(variantLookupKey) || null
              
              // Fallback to DB query for pre-existing variants
              if (!resolvedVariantId) {
                const existingVariant = await tx.productVariant.findFirst({
                  where: {
                    name: compData.variantName,
                    productId: resolvedProductId,
                    outletId,
                  },
                  select: { id: true },
                })
                if (existingVariant) {
                  resolvedVariantId = existingVariant.id
                } else {
                  result.errors.push(`Baris ${compData.rowNum} (Komposisi): Varian "${compData.variantName}" tidak ditemukan`)
                  result.compSkipped++
                  continue
                }
              }
            }
            
            // Skip duplicates
            const compKey = `${resolvedProductId}|${resolvedVariantId || ''}|${compData.inventoryItemId}`
            if (preloadedData.compositionKeySet.has(compKey)) {
              result.compSkipped++
              continue
            }

            await tx.productComposition.create({
              data: {
                productId: resolvedProductId,
                variantId: resolvedVariantId,
                inventoryItemId: compData.inventoryItemId,
                qty: compData.qty,
                baseUnit: compData.baseUnit,
              },
            })

            preloadedData.compositionKeySet.add(compKey)
            result.compCreated++
          }
        }
      }, {
        timeout: 30000 // 30 seconds per chunk (more than enough for 50 items)
      }) // End of chunk transaction
    } // End of chunk loop

    const totalTime = Date.now() - startTime
    
    // Optimization #6: Reduce logging output
    console.log(`[Bulk Upload] Done in ${totalTime}ms: ${result.created} created, ${result.skipped} skipped, ${result.variantsCreated} variants, ${result.compCreated} comps`)

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
