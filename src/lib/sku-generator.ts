import { db } from '@/lib/db'

const MAX_SKU_LENGTH = 22

/**
 * Generate a short abbreviation from a product name.
 * Takes first consonants/letters of each word, uppercased.
 * Examples:
 *   "Nasi Goreng Spesial" → "NGS"
 *   "Kopi Susu Gula Aren" → "KSGA"
 *   "Ayam" → "AYM"
 */
function abbreviateName(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length === 0) return 'PRD'

  // Take up to first 3 words, take first 2 chars of first word, first char of rest
  let abbr = ''
  for (let i = 0; i < Math.min(words.length, 3); i++) {
    const word = words[i].toUpperCase()
    if (i === 0) {
      // Take first 2 chars of first word
      abbr += word.substring(0, Math.min(2, word.length))
    } else {
      abbr += word.charAt(0)
    }
  }
  return abbr.substring(0, 5)
}

/**
 * Generate a random alphanumeric suffix (4-6 chars).
 */
function randomSuffix(length: number = 4): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // exclude I, O, 0, 1 for readability
  let result = ''
  const array = new Uint8Array(length)
  // Use crypto for better randomness
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
 * Generate a unique SKU for a product within an outlet.
 * Format: {ABBR}-{RANDOM} e.g. "NGS-X7K2M" or "KSGA-P3N9QW"
 *
 * The function ensures uniqueness by checking against existing SKUs
 * in the database for the given outlet.
 *
 * @param name - Product name (used for abbreviation)
 * @param outletId - The outlet ID to ensure uniqueness within
 * @param maxAttempts - Max retries for collision resolution (default 10)
 * @returns A unique SKU string (max 22 characters)
 */
export async function generateUniqueSKU(
  name: string,
  outletId: string,
  maxAttempts: number = 10
): Promise<string> {
  const abbr = abbreviateName(name)

  // Determine suffix length to fit within MAX_SKU_LENGTH
  // Format: {ABBR}-{SUFFIX}
  const separatorLength = 1 // "-"
  const maxSuffixLength = MAX_SKU_LENGTH - abbr.length - separatorLength
  const suffixLength = Math.min(Math.max(maxSuffixLength, 3), 8)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const suffix = randomSuffix(suffixLength)
    const sku = `${abbr}-${suffix}`

    // Check uniqueness in database
    const existing = await db.product.findFirst({
      where: {
        sku,
        outletId,
      },
      select: { id: true },
    })

    if (!existing) {
      return sku
    }
  }

  // Fallback: use timestamp-based suffix
  const tsSuffix = Date.now().toString(36).toUpperCase().slice(-6)
  return `${abbr.substring(0, MAX_SKU_LENGTH - 7)}-${tsSuffix}`
}

/**
 * Generate a unique SKU for a variant.
 * Format: {PARENT_ABBR}-{VARIANT_NAME_ABBR}-{RANDOM}
 *
 * @param parentName - Parent product name
 * @param variantName - Variant name
 * @param outletId - Outlet ID for uniqueness check
 * @returns A unique variant SKU string (max 22 characters)
 */
export async function generateVariantSKU(
  parentName: string,
  variantName: string,
  outletId: string
): Promise<string> {
  const parentAbbr = abbreviateName(parentName).substring(0, 3)
  const varAbbr = variantName.substring(0, 3).toUpperCase()

  const prefix = `${parentAbbr}-${varAbbr}`
  const maxSuffixLength = MAX_SKU_LENGTH - prefix.length - 1 // -1 for "-"
  const suffixLength = Math.min(Math.max(maxSuffixLength, 3), 6)

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = randomSuffix(suffixLength)
    const sku = `${prefix}-${suffix}`

    const existing = await db.productVariant.findFirst({
      where: { sku, outletId },
      select: { id: true },
    })

    if (!existing) {
      return sku
    }
  }

  const tsSuffix = Date.now().toString(36).toUpperCase().slice(-4)
  return `${prefix.substring(0, MAX_SKU_LENGTH - 5)}-${tsSuffix}`
}

// ──────────────────────────────────────────────────────────────────────────────
// BARCODE GENERATION — Aether internal barcode (CODE_128 compatible)
//
// AETHER BARCODE CONTRACT:
//   - Manual barcode: saved exactly as provided (string, no conversion)
//   - Auto-generated barcode: unique AET-{ABBR}-{SUFFIX} format
//   - Label encodes exact barcode value (CODE_128)
//   - Scanner reads exact same value
//   - DB barcode === encoded label === scanner rawValue
//
// Format:
//   Product:  AET-{ABBR}-{SUFFIX}  e.g. "AET-KSGA-X7K9M"
//   Variant:  AET-{ABBR}-{SUFFIX}  e.g. "AET-KSGA-I15P3"
//
// Rules:
//   - Unique per outlet
//   - String (never Number)
//   - CODE_128 safe (uppercase alphanumeric + hyphens)
//   - Not dependent on raw Product ID
//   - Immutable after save (never regenerated on edit)
//   - Only regenerated if user explicitly clears and confirms
// ──────────────────────────────────────────────────────────────────────────────

const MAX_BARCODE_LENGTH = 22

/**
 * Generate a unique internal barcode for a product within an outlet.
 * Format: AET-{ABBR}-{SUFFIX} e.g. "AET-KSGA-X7K9M"
 *
 * @param name - Product name (used for abbreviation)
 * @param outletId - The outlet ID to ensure uniqueness within
 * @param maxAttempts - Max retries for collision resolution (default 10)
 * @returns A unique barcode string (max 22 characters)
 */
export async function generateUniqueBarcode(
  name: string,
  outletId: string,
  maxAttempts: number = 10
): Promise<string> {
  const abbr = abbreviateName(name)

  // Format: AET-{ABBR}-{SUFFIX}
  const prefix = `AET-${abbr}`
  const maxSuffixLength = MAX_BARCODE_LENGTH - prefix.length - 1 // -1 for "-"
  const suffixLength = Math.min(Math.max(maxSuffixLength, 3), 6)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const suffix = randomSuffix(suffixLength)
    const barcode = `${prefix}-${suffix}`

    // Check uniqueness against BOTH product.barcode and productVariant.barcode
    const [existingProduct, existingVariant] = await Promise.all([
      db.product.findFirst({
        where: { barcode, outletId },
        select: { id: true },
      }),
      db.productVariant.findFirst({
        where: { barcode, outletId },
        select: { id: true },
      }),
    ])

    if (!existingProduct && !existingVariant) {
      return barcode
    }
  }

  // Fallback: timestamp-based suffix
  const tsSuffix = Date.now().toString(36).toUpperCase().slice(-6)
  return `AET-${abbr.substring(0, MAX_BARCODE_LENGTH - 11)}-${tsSuffix}`
}

/**
 * Generate a unique internal barcode for a variant within an outlet.
 * Format: AET-{PARENT_ABBR}-{VAR_ABBR}-{SUFFIX} e.g. "AET-KSG-SML-I15P3"
 *
 * @param parentName - Parent product name
 * @param variantName - Variant name
 * @param outletId - Outlet ID for uniqueness check
 * @returns A unique variant barcode string (max 22 characters)
 */
export async function generateVariantBarcode(
  parentName: string,
  variantName: string,
  outletId: string
): Promise<string> {
  const parentAbbr = abbreviateName(parentName).substring(0, 3)
  const varAbbr = variantName.substring(0, 3).toUpperCase()

  const prefix = `AET-${parentAbbr}-${varAbbr}`
  const maxSuffixLength = MAX_BARCODE_LENGTH - prefix.length - 1
  const suffixLength = Math.min(Math.max(maxSuffixLength, 3), 5)

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = randomSuffix(suffixLength)
    const barcode = `${prefix}-${suffix}`

    // Check uniqueness against BOTH product.barcode and productVariant.barcode
    const [existingProduct, existingVariant] = await Promise.all([
      db.product.findFirst({
        where: { barcode, outletId },
        select: { id: true },
      }),
      db.productVariant.findFirst({
        where: { barcode, outletId },
        select: { id: true },
      }),
    ])

    if (!existingProduct && !existingVariant) {
      return barcode
    }
  }

  const tsSuffix = Date.now().toString(36).toUpperCase().slice(-4)
  return `AET-${parentAbbr}-${varAbbr.substring(0, 1)}-${tsSuffix}`
}