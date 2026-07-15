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
  validateUnit,
} from '@/lib/excel-utils'

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
          updateData.name = name
          changes.name = { from: existing.name, to: name }
        }

        // SKU
        const sku = String(findColumn(row, ['SKU', 'sku', 'Kode']) || '').trim()
        if (isNonEmpty(sku)) {
          updateData.sku = sku || null
          if (sku !== (existing.sku || '')) changes.sku = { from: existing.sku || '', to: sku }
        }

        // HPP
        const hpp = sanitizeNumber(findColumn(row, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
        if (isNonEmpty(findColumn(row, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))) {
          updateData.hpp = hpp
          if (hpp !== existing.hpp) changes.hpp = { from: existing.hpp, to: hpp }
        }

        // Price
        const price = sanitizeNumber(findColumn(row, [
          'HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual',
          'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'
        ]))
        if (isNonEmpty(findColumn(row, [
          'HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual',
          'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'
        ]))) {
          if (price > 0) {
            updateData.price = price
            if (price !== existing.price) changes.price = { from: existing.price, to: price }
          }
        }

        // Stock with validation (Fix Bug #7)
        const stock = sanitizeNumber(findColumn(row, ['QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))
        if (isNonEmpty(findColumn(row, ['QTY / STOK', 'QTY', 'qty', 'Stok', 'stok', 'Stock', 'stock', 'Quantity', 'Jumlah']))) {
          if (stock < 0) {
            result.errors.push(`Baris ${rowNum}: Stok tidak boleh negatif (Nama: ${existing.name})`)
            continue
          }
          updateData.stock = Math.round(stock)
          if (Math.round(stock) !== existing.stock) changes.stock = { from: existing.stock, to: Math.round(stock) }
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

        // Low Stock Alert
        const lsa = sanitizeNumber(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'lowStockAlert', 'Alert Stok']))
        if (isNonEmpty(findColumn(row, ['LOW STOCK ALERT', 'Low Stock Alert', 'low_stock_alert', 'Low Stock', 'lowStockAlert', 'Alert Stok']))) {
          updateData.lowStockAlert = Math.round(lsa)
          if (Math.round(lsa) !== existing.lowStockAlert) changes.lowStockAlert = { from: existing.lowStockAlert, to: Math.round(lsa) }
        }

        if (Object.keys(updateData).length === 0) continue

        await tx.product.update({ where: { id: productId }, data: updateData })

        await safeAuditLog({
          action: 'BULK_UPDATE',
          entityType: 'PRODUCT',
          entityId: productId,
          details: JSON.stringify({ bulkUpdateExcel: true, changes, fileName: file.name }),
          outletId,
          userId,
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
              if (isNonEmpty(vSku)) vUpd.sku = vSku || null

              const vHpp = sanitizeNumber(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
              if (isNonEmpty(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))) vUpd.hpp = vHpp

              const vPr = sanitizeNumber(findColumn(vRow, [
                'HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual',
                'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'
              ]))
              if (isNonEmpty(findColumn(vRow, [
                'HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual',
                'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'
              ]))) {
                if (vPr > 0) vUpd.price = vPr
              }

              const vStk = sanitizeNumber(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))
              if (isNonEmpty(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))) {
                if (vStk < 0) {
                  result.errors.push(`Baris ${rNum} (Varian): Stok tidak boleh negatif`)
                  continue
                }
                vUpd.stock = Math.round(vStk)
              }

              if (Object.keys(vUpd).length === 0) continue

              await tx.productVariant.update({ where: { id: eVar.id }, data: vUpd })
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
            if (isNonEmpty(vName2)) vUpd2.name = vName2

            const vSku2 = String(findColumn(vRow, ['SKU VARIAN', 'SKU Varian', 'SKU', 'sku']) || '').trim()
            if (isNonEmpty(vSku2)) vUpd2.sku = vSku2 || null

            const vHpp2 = sanitizeNumber(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))
            if (isNonEmpty(findColumn(vRow, ['HPP (Rp)', 'HPP', 'Harga Pokok', 'harga_pokok', 'Cost', 'Modal']))) vUpd2.hpp = vHpp2

            const vPr2 = sanitizeNumber(findColumn(vRow, [
              'HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual',
              'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'
            ]))
            if (isNonEmpty(findColumn(vRow, [
              'HARGA JUAL* (Rp)', 'HARGA JUAL (Rp)', 'HARGA JUAL', 'Harga Jual',
              'Harga', 'Price', 'harga_jual', 'harga', 'price', 'Sell Price', 'Jual'
            ]))) {
              if (vPr2 > 0) vUpd2.price = vPr2
            }

            const vStk2 = sanitizeNumber(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))
            if (isNonEmpty(findColumn(vRow, ['STOK', 'Stok', 'stok', 'Stock', 'stock', 'QTY', 'qty', 'Quantity', 'Jumlah']))) {
              if (vStk2 < 0) {
                result.errors.push(`Baris ${rNum} (Varian): Stok tidak boleh negatif (ID: ${vId})`)
                continue
              }
              vUpd2.stock = Math.round(vStk2)
            }

            if (Object.keys(vUpd2).length === 0) continue

            await tx.productVariant.update({ where: { id: vId }, data: vUpd2 })
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
