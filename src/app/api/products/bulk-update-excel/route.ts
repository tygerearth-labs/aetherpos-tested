import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized } from '@/lib/api/get-auth'
import { getOutletPlan } from '@/lib/config/plan-config'
import * as XLSX from 'xlsx'
import { safeAuditLog } from '@/lib/safe-audit'
import { safeJson, safeJsonError } from '@/lib/api/safe-response'
import {
  sanitizeNumber,
  normalizeHeader,
  findColumn,
  isNonEmpty,
  isPresent, // FIX-P0-4 (AUDIT-2): distinguishes "absent" from "0"
  validateUnit,
} from '@/lib/excel-utils'
import { validateCompositionStock, validateVariantCompositionStock } from '@/lib/comp-stock'

export const maxDuration = 60
const MAX_ROWS = 500

export async function POST(request: NextRequest) {
  const result = {
    updated: 0,
    notFound: 0,
    variantsUpdated: 0,
    variantsNotFound: 0,
    errors: [] as string[],
  }

  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    // CREW-009 FIX: Only OWNER can bulk-update products via Excel (mass-modifies catalog state)
    if (user.role !== 'OWNER') {
      return safeJsonError('Hanya OWNER yang dapat melakukan aksi ini', 403)
    }
    const outletId = user.outletId
    const userId = user.id

    const outletPlan = await getOutletPlan(outletId, db)
    if (!outletPlan) return safeJsonError('Outlet not found', 404)
    if (!outletPlan.features.bulkUpload) {
      return safeJsonError('Fitur bulk upload hanya tersedia untuk akun Pro.', 403)
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return safeJsonError('File tidak ditemukan', 400)

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      return safeJsonError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400)
    }
    if (file.size > 5 * 1024 * 1024) return safeJsonError('Ukuran file maksimal 5MB', 400)

    const buffer = Buffer.from(await file.arrayBuffer())
    let workbook: XLSX.WorkBook
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch {
      return safeJsonError('File tidak dapat dibaca. Pastikan format Excel valid.', 400)
    }

    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return safeJsonError('File Excel kosong - tidak ada sheet', 400)

    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

    if (rows.length === 0) return safeJsonError('File Excel tidak memiliki data baris', 400)
    if (rows.length > MAX_ROWS) {
      return safeJsonError(`Maksimal ${MAX_ROWS} baris per upload. File memiliki ${rows.length} baris.`, 400)
    }

    console.log('[Bulk Update Excel] Headers:', Object.keys(rows[0]))

    // WRAP IN TRANSACTION for atomicity (Fix Bug #1)
    await db.$transaction(async (tx) => {
      const categoryCache = new Map<string, string | null>()

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const rowNum = i + 2

        const productId = String(findColumn(row, ['ID*', 'ID', 'id', 'Id']) || '').trim()
        if (!productId) {
          result.errors.push(`Baris ${rowNum}: ID produk wajib diisi`)
          continue
        }

        const existing = await tx.product.findFirst({ where: { id: productId, outletId } })
        if (!existing) {
          result.errors.push(`Baris ${rowNum}: Produk dengan ID "${productId}" tidak ditemukan`)
          result.notFound++
          continue
        }

        const updateData: Record<string, unknown> = {}
        const changes: Record<string, { from: number | string | null; to: number | string }> = {}

        // Name
        const name = String(findColumn(row, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
        if (isNonEmpty(name) && name !== existing.name) {
          // FIX-P1-2 (AUDIT-2): Pre-check name uniqueness (excluding self).
          // Without this, the @@unique([name, outletId]) DB constraint throws
          // and rolls back the ENTIRE transaction (all 100+ rows fail).
          const nameClash = await tx.product.findFirst({
            where: { name, outletId, NOT: { id: productId } },
            select: { id: true },
          })
          if (nameClash) {
            result.errors.push(`Baris ${rowNum}: Nama produk "${name}" sudah digunakan oleh produk lain`)
            continue
          }
          updateData.name = name
          changes.name = { from: existing.name, to: name }
        }

        // SKU
        const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim()
        if (isNonEmpty(sku) && sku !== (existing.sku || '')) {
          // FIX-P0-5 (AUDIT-4): Pre-check SKU uniqueness (excluding self).
          const skuClash = await tx.product.findFirst({
            where: { sku, outletId, NOT: { id: productId } },
            select: { id: true },
          })
          if (skuClash) {
            result.errors.push(`Baris ${rowNum}: SKU "${sku}" sudah digunakan oleh produk lain`)
            continue
          }
          // Also check against variant SKUs
          const variantSkuClash = await tx.productVariant.findFirst({
            where: { sku, outletId, NOT: { product: { id: productId } } },
            select: { id: true },
          })
          if (variantSkuClash) {
            result.errors.push(`Baris ${rowNum}: SKU "${sku}" sudah digunakan oleh varian produk lain`)
            continue
          }
          updateData.sku = sku || null
          changes.sku = { from: existing.sku || '', to: sku }
        }

        // HPP — FIX-P0-4 (AUDIT-2): use isPresent so 0 is honored
        const hppRaw = findColumn(row, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal'])
        const hpp = sanitizeNumber(hppRaw)
        if (isPresent(hppRaw)) {
          if (hpp < 0) {
            result.errors.push(`Baris ${rowNum}: HPP tidak boleh negatif (Nama: ${existing.name})`)
            continue
          }
          updateData.hpp = hpp
          if (hpp !== existing.hpp) changes.hpp = { from: existing.hpp, to: hpp }
        }

        // Price — FIX-P0-4 (AUDIT-2): use isPresent so 0 is honored (e.g. freebie / variant-only product)
        const priceRaw = findColumn(row, [
          'HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual',
          'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'
        ])
        const price = sanitizeNumber(priceRaw)
        if (isPresent(priceRaw)) {
          if (price < 0) {
            result.errors.push(`Baris ${rowNum}: Harga Jual tidak boleh negatif (Nama: ${existing.name})`)
            continue
          }
          // Allow price=0 only if product has variants (variant-only product) — same logic as bulk-upload
          if (price > 0 || existing.hasVariants) {
            updateData.price = price
            if (price !== existing.price) changes.price = { from: existing.price, to: price }
          } else if (price === 0) {
            result.errors.push(`Baris ${rowNum}: Harga Jual harus lebih dari 0 untuk produk tanpa varian (Nama: ${existing.name})`)
            continue
          }
        }

        // Stock — FIX-P0-1+P0-2+P0-4 (AUDIT-2): composition validation + variant parent guard + isPresent
        const stockRaw = findColumn(row, ['QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah'])
        const stock = sanitizeNumber(stockRaw)
        if (isPresent(stockRaw)) {
          if (stock < 0) {
            result.errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Nama: ${existing.name})`)
            continue
          }
          const roundedStock = Math.round(stock)
          // FIX-P0-2 (AUDIT-2): For variant products, parent.stock must equal SUM(variant.stock).
          // Excel cannot directly set parent stock for variant products — must update variant rows instead.
          if (existing.hasVariants) {
            result.errors.push(
              `Baris ${rowNum}: Produk "${existing.name}" memiliki varian. ` +
              `Stok produk induk tidak dapat diubah langsung — ubah stok di sheet varian.`
            )
            continue
          }
          // FIX-P0-1 (AUDIT-2): Validate composition capacity for non-variant composed products.
          if (existing.hasComposition) {
            const compError = await validateCompositionStock(productId, outletId, roundedStock)
            if (compError) {
              result.errors.push(`Baris ${rowNum}: ${compError}`)
              continue
            }
          }
          updateData.stock = roundedStock
          if (roundedStock !== existing.stock) changes.stock = { from: existing.stock, to: roundedStock }
        }

        // Unit
        const unitRaw = String(findColumn(row, ['SATUAN', 'Satuan', 'satuan', 'Unit', 'unit', 'Sat']) || '').trim().toLowerCase()
        if (isNonEmpty(unitRaw)) {
          const unit = validateUnit(unitRaw)
          updateData.unit = unit
          if (unit !== existing.unit) changes.unit = { from: existing.unit, to: unit }
        }

        // Category
        const categoryRaw = String(findColumn(row, ['KATEGORI', 'Kategori', 'kategori', 'Category', 'category', 'Kat']) || '').trim()
        if (isNonEmpty(categoryRaw)) {
          let categoryId: string | null = null
          if (categoryCache.has(categoryRaw)) {
            categoryId = categoryCache.get(categoryRaw)!
          } else {
            const existingCat = await tx.category.findFirst({ where: { name: categoryRaw, outletId } })
            if (existingCat) {
              categoryId = existingCat.id
              categoryCache.set(categoryRaw, categoryId)
            } else {
              const newCat = await tx.category.create({ data: { name: categoryRaw, outletId, color: 'zinc' } })
              categoryId = newCat.id
              categoryCache.set(categoryRaw, categoryId)
            }
          }
          updateData.categoryId = categoryId
          if (categoryId !== existing.categoryId) changes.categoryId = { from: existing.categoryId || '', to: categoryId }
        }

        // Low Stock Alert — FIX-P0-4 (AUDIT-2): use isPresent so 0 is honored
        const lsaRaw = findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'lowStockAlert', 'Alert Stok'])
        const lsa = sanitizeNumber(lsaRaw)
        if (isPresent(lsaRaw)) {
          if (lsa < 0) {
            result.errors.push(`Baris ${rowNum}: Low Stock Alert tidak boleh negatif (Nama: ${existing.name})`)
            continue
          }
          updateData.lowStockAlert = Math.round(lsa)
          if (Math.round(lsa) !== existing.lowStockAlert) changes.lowStockAlert = { from: existing.lowStockAlert, to: Math.round(lsa) }
        }

        if (Object.keys(updateData).length === 0) continue

        await tx.product.update({ where: { id: productId }, data: updateData })

        // FIX-P1-1 (AUDIT-2): Use tx.auditLog.create (transactional) instead of safeAuditLog (global db).
        // safeAuditLog uses the GLOBAL db client, so audit logs would persist even if the
        // surrounding transaction rolls back → phantom audit logs for updates that never committed.
        await tx.auditLog.create({
          data: {
            action: 'BULK_UPDATE',
            entityType: 'PRODUCT',
            entityId: productId,
            details: JSON.stringify({ bulkUpdateExcel: true, changes, fileName: file.name }),
            outletId,
            userId,
          },
        })

        result.updated++
      }

      // === Process Variant Sheet ===
      const variantSheetName = workbook.SheetNames.find((n) => normalizeHeader(n).includes('varian'))
      if (variantSheetName) {
        const vSheet = workbook.Sheets[variantSheetName]
        const vRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(vSheet, { defval: '' })

        console.log(`[Bulk Update Excel] Found variant sheet "${variantSheetName}" with ${vRows.length} rows`)

        const pCache = new Map<string, { id: string } | null>()

        for (let i = 0; i < vRows.length; i++) {
          try {
            const vRow = vRows[i]
            const rNum = i + 2

            const vId = String(findColumn(vRow, ['ID VARIAN*', 'ID VARIAN', 'ID Varian', 'ID', 'id', 'Id']) || '').trim()
            const pProdId = String(findColumn(vRow, ['ID PRODUK*', 'ID PRODUK', 'ID Produk', 'ID', 'id', 'Id']) || '').trim()

            if (!vId) {
              const pName = String(findColumn(vRow, ['NAMA PRODUK*', 'NAMA PRODUK', 'Nama Produk', 'Nama', 'NAME', 'name', 'Product Name', 'Produk']) || '').trim()
              const vName = String(findColumn(vRow, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Variant Name', 'Varian', 'name']) || '').trim()

              if (!pName || !vName) {
                result.errors.push(`Baris ${rNum} (Varian): ID Varian atau Nama Produk + Nama Varian wajib diisi`)
                continue
              }

              let parent = pCache.get(pName)
              if (parent === undefined) {
                const found = await tx.product.findFirst({ where: { name: pName, outletId }, select: { id: true } })
                parent = found ? { id: found.id } : null
                pCache.set(pName, parent)
              }

              if (!parent) {
                result.errors.push(`Baris ${rNum} (Varian): Produk "${pName}" tidak ditemukan`)
                result.variantsNotFound++
                continue
              }

              const eVar = await tx.productVariant.findFirst({ where: { name: vName, productId: parent.id, outletId } })
              if (!eVar) {
                result.errors.push(`Baris ${rNum} (Varian): Varian "${vName}" tidak ditemukan`)
                result.variantsNotFound++
                continue
              }

              const vUpd: Record<string, unknown> = {}
              const vSku = String(findColumn(vRow, ['SKU VARIAN', 'SKU Varian', 'SKU', 'sku']) || '').trim()
              if (isNonEmpty(vSku) && vSku !== (eVar.sku || '')) {
                // FIX-P0-5 (AUDIT-4): Validate variant SKU uniqueness within outlet
                const vSkuClash = await tx.productVariant.findFirst({
                  where: { sku: vSku, outletId, NOT: { id: eVar.id } },
                  select: { id: true },
                })
                if (vSkuClash) {
                  result.errors.push(`Baris ${rNum} (Varian): SKU "${vSku}" sudah digunakan oleh varian lain`)
                  continue
                }
                const pSkuClash = await tx.product.findFirst({
                  where: { sku: vSku, outletId },
                  select: { id: true },
                })
                if (pSkuClash) {
                  result.errors.push(`Baris ${rNum} (Varian): SKU "${vSku}" sudah digunakan oleh produk lain`)
                  continue
                }
                vUpd.sku = vSku || null
              }

              // FIX-P0-4 (AUDIT-2): use isPresent so 0 is honored
              const vHppRaw = findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal'])
              const vHpp = sanitizeNumber(vHppRaw)
              if (isPresent(vHppRaw)) {
                if (vHpp < 0) {
                  result.errors.push(`Baris ${rNum} (Varian): HPP tidak boleh negatif`)
                  continue
                }
                vUpd.hpp = vHpp
              }

              const vPrRaw = findColumn(vRow, [
                'HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual',
                'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'
              ])
              const vPr = sanitizeNumber(vPrRaw)
              if (isPresent(vPrRaw)) {
                if (vPr < 0) {
                  result.errors.push(`Baris ${rNum} (Varian): Harga Jual tidak boleh negatif`)
                  continue
                }
                if (vPr > 0) vUpd.price = vPr
              }

              const vStkRaw = findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah'])
              const vStk = sanitizeNumber(vStkRaw)
              if (isPresent(vStkRaw)) {
                if (vStk < 0) {
                  result.errors.push(`Baris ${rNum} (Varian): Stok tidak boleh negatif`)
                  continue
                }
                const roundedVStk = Math.round(vStk)
                // FIX-P1-4 (AUDIT-2): Validate variant composition capacity
                const vCompError = await validateVariantCompositionStock(eVar.id, eVar.name, roundedVStk)
                if (vCompError) {
                  result.errors.push(`Baris ${rNum} (Varian): ${vCompError}`)
                  continue
                }
                vUpd.stock = roundedVStk
              }

              if (Object.keys(vUpd).length === 0) continue

              await tx.productVariant.update({ where: { id: eVar.id }, data: vUpd })
              // FIX-P0-3 (AUDIT-2): Recalculate parent product stock = SUM(variant.stock) after variant update.
              const vAgg = await tx.productVariant.aggregate({
                where: { productId: parent.id, outletId },
                _sum: { stock: true },
              })
              await tx.product.update({
                where: { id: parent.id },
                data: { stock: vAgg._sum.stock ?? 0 },
              })
              result.variantsUpdated++
              continue
            }

            // Match by variant ID directly
            const eVar = await tx.productVariant.findFirst({ where: { id: vId, outletId } })
            if (!eVar) {
              result.errors.push(`Baris ${rNum} (Varian): Varian dengan ID "${vId}" tidak ditemukan`)
              result.variantsNotFound++
              continue
            }

            const vUpd2: Record<string, unknown> = {}

            const vName2 = String(findColumn(vRow, ['NAMA VARIAN*', 'NAMA VARIAN', 'Nama Varian', 'Variant Name', 'Varian', 'name']) || '').trim()
            if (isNonEmpty(vName2) && vName2 !== eVar.name) {
              // FIX: Validate variant name uniqueness within the same product (excluding self)
              const vNameClash = await tx.productVariant.findFirst({
                where: { name: vName2, productId: eVar.productId, outletId, NOT: { id: vId } },
                select: { id: true },
              })
              if (vNameClash) {
                result.errors.push(`Baris ${rNum} (Varian): Nama varian "${vName2}" sudah digunakan di produk ini`)
                continue
              }
              vUpd2.name = vName2
            }

            const vSku2 = String(findColumn(vRow, ['SKU VARIAN', 'SKU Varian', 'SKU', 'sku']) || '').trim()
            if (isNonEmpty(vSku2) && vSku2 !== (eVar.sku || '')) {
              // FIX-P0-5 (AUDIT-4): Validate variant SKU uniqueness within outlet
              const vSkuClash = await tx.productVariant.findFirst({
                where: { sku: vSku2, outletId, NOT: { id: vId } },
                select: { id: true },
              })
              if (vSkuClash) {
                result.errors.push(`Baris ${rNum} (Varian): SKU "${vSku2}" sudah digunakan oleh varian lain`)
                continue
              }
              const pSkuClash = await tx.product.findFirst({
                where: { sku: vSku2, outletId },
                select: { id: true },
              })
              if (pSkuClash) {
                result.errors.push(`Baris ${rNum} (Varian): SKU "${vSku2}" sudah digunakan oleh produk lain`)
                continue
              }
              vUpd2.sku = vSku2 || null
            }

            // FIX-P0-4 (AUDIT-2): use isPresent so 0 is honored
            const vHpp2Raw = findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal'])
            const vHpp2 = sanitizeNumber(vHpp2Raw)
            if (isPresent(vHpp2Raw)) {
              if (vHpp2 < 0) {
                result.errors.push(`Baris ${rNum} (Varian): HPP tidak boleh negatif (ID: ${vId})`)
                continue
              }
              vUpd2.hpp = vHpp2
            }

            const vPr2Raw = findColumn(vRow, [
              'HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual',
              'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'
            ])
            const vPr2 = sanitizeNumber(vPr2Raw)
            if (isPresent(vPr2Raw)) {
              if (vPr2 < 0) {
                result.errors.push(`Baris ${rNum} (Varian): Harga Jual tidak boleh negatif (ID: ${vId})`)
                continue
              }
              if (vPr2 > 0) vUpd2.price = vPr2
            }

            const vStk2Raw = findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah'])
            const vStk2 = sanitizeNumber(vStk2Raw)
            if (isPresent(vStk2Raw)) {
              if (vStk2 < 0) {
                result.errors.push(`Baris ${rNum} (Varian): Stok tidak boleh negatif (ID: ${vId})`)
                continue
              }
              const roundedVStk2 = Math.round(vStk2)
              // FIX-P1-4 (AUDIT-2): Validate variant composition capacity
              const vCompError = await validateVariantCompositionStock(vId, eVar.name, roundedVStk2)
              if (vCompError) {
                result.errors.push(`Baris ${rNum} (Varian): ${vCompError}`)
                continue
              }
              vUpd2.stock = roundedVStk2
            }

            if (Object.keys(vUpd2).length === 0) continue

            await tx.productVariant.update({ where: { id: vId }, data: vUpd2 })
            // FIX-P0-3 (AUDIT-2): Recalculate parent product stock = SUM(variant.stock) after variant update.
            const vAgg2 = await tx.productVariant.aggregate({
              where: { productId: eVar.productId, outletId },
              _sum: { stock: true },
            })
            await tx.product.update({
              where: { id: eVar.productId },
              data: { stock: vAgg2._sum.stock ?? 0 },
            })
            result.variantsUpdated++
          } catch (vErr) {
            const errMsg = vErr instanceof Error ? vErr.message : 'Unknown error'
            console.error(`[Bulk Update Excel] Variant row ${rNum} error:`, vErr)
            result.errors.push(`Baris ${rNum} (Varian): Gagal memproses - ${errMsg}`)
          }
        }
      }
    }) // End transaction

    // Audit log (Fix Bug #14)
    await safeAuditLog({
      action: result.updated > 0 ? 'BULK_UPDATE' : 'UPDATE_ATTEMPT',
      entityType: 'PRODUCT',
      details: JSON.stringify({
        bulkUpdateExcel: true,
        updated: result.updated,
        notFound: result.notFound,
        variantsUpdated: result.variantsUpdated,
        variantsNotFound: result.variantsNotFound,
        errors: result.errors.length,
        fileName: file.name,
        success: result.updated > 0 || result.variantsUpdated > 0,
      }),
      outletId,
      userId,
    })

    return safeJson(result)
  } catch (error) {
    console.error('Bulk update excel error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return safeJson({ error: 'Gagal memproses file update', details: msg }, 500)
  }
}
